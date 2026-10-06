import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { permissionsFor, ROLES } from '../auth/permissions';
import { MAJOR_PURCHASE_THRESHOLD } from './hooks/purchasing';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 1: delegated authority data model, API and audit', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let app: Parameters<typeof request>[0];
  beforeAll(async () => {
    ({ db, as, app } = (await setupDemoWorld()) as never);
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const future = new Date(Date.now() + 90 * 86400_000).toISOString();
  const rule = (over: Row = {}) => ({
    name: 'PM variations on Aurora',
    description: 'PM handles routine variations on Aurora',
    effect: 'allow',
    decision_type: 'variation',
    target_role: 'Project Manager',
    project_id: 'proj-1',
    min_value: 0,
    max_value: 20000,
    max_risk: 'At Risk',
    end_at: future,
    priority: 200,
    ...over,
  });
  const audits = async (entityId: string) => (await db.pool.query(`SELECT action, actor_id, before, after, details FROM audit_logs WHERE entity_type = 'delegated_authority' AND entity_id = $1 ORDER BY id`, [entityId])).rows;

  describe('migration and defaults', () => {
    it('records today\'s behaviour as System Policy, created by nobody', async () => {
      const sys = (await db.pool.query(`SELECT code, effect, decision_type, target_role, target_permission, min_value, max_value, granted_by, locked, active FROM delegated_authorities WHERE kind = 'system' ORDER BY code`)).rows;
      expect(sys.length).toBe(19);
      expect(sys.every((r) => r.granted_by === null && r.active)).toBe(true);
      const by = Object.fromEntries(sys.map((r) => [r.code, r]));
      expect(by['SYS-DRAWING']).toMatchObject({ effect: 'allow', target_permission: 'drawings.approve' });
      expect(by['SYS-VARIATION']).toMatchObject({ effect: 'allow', target_permission: 'variations.approve' });
      // The purchase threshold mirrors the code constant exactly.
      expect(Number(by['SYS-PURCHASE-MAJOR'].min_value)).toBe(MAJOR_PURCHASE_THRESHOLD);
      expect(Number(by['SYS-PURCHASE-STANDARD'].max_value)).toBe(MAJOR_PURCHASE_THRESHOLD - 0.01);
      expect(by['SYS-PURCHASE-ACCOUNTANT']).toMatchObject({ target_role: 'Accountant' });
      expect(by['SYS-TECHNICAL-PRODMGR']).toMatchObject({ target_role: 'Production Manager' });
      expect(sys.filter((r) => r.code.startsWith('SYS-STRATEGIC-')).every((r) => r.locked)).toBe(true);
      expect(sys.filter((r) => !r.code.startsWith('SYS-STRATEGIC-')).every((r) => !r.locked)).toBe(true);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM delegated_authorities WHERE kind = 'owner'`)).rows[0].n).toBe(0);
    });

    it('starts every project Normal', async () => {
      expect((await db.pool.query(`SELECT DISTINCT sensitivity FROM projects`)).rows).toEqual([{ sensitivity: 'Normal' }]);
    });

    it('adds narrow baseline permissions without giving anyone the final approval permissions', () => {
      const holders = (perm: string) => ROLES.filter((r) => permissionsFor(r).has(perm as never)).sort();
      expect(holders('drawings.approve')).toEqual(['Owner / CEO']);
      expect(holders('variations.approve')).toEqual(['Owner / CEO']);
      expect(holders('drawings.review')).toEqual(['Owner / CEO', 'Production Manager', 'Project Manager']);
      expect(holders('variations.review')).toEqual(['Owner / CEO', 'Project Manager']);
      expect(holders('authority.manage')).toEqual(['Owner / CEO']);
      expect(holders('authority.view')).toEqual(['Admin', 'Owner / CEO']);
    });

    it('lists the decision types with their baseline permissions', async () => {
      const types = (await owner().get('/api/authority/decision-types').expect(200)).body as Row[];
      expect(Object.fromEntries(types.map((t) => [t.key, t.baseline_permission]))).toEqual({ drawing: 'drawings.review', variation: 'variations.review', purchase: 'purchasing.view', invoice: 'finance.view', ai_proposal: 'approvals.request' });
    });
  });

  describe('access', () => {
    it('lets the Owner and Admin read, and nobody else', async () => {
      await owner().get('/api/authority/rules').expect(200);
      const list = (await as['Admin'].get('/api/authority/rules').expect(200)).body as Row[];
      expect(list.find((r) => r.code === 'SYS-PURCHASE-MAJOR')).toMatchObject({ source: 'System Policy', summary: 'The Owner must approve every purchase approval (of RM 20,000 or more).' });
      for (const role of ['Project Manager', 'Accountant', 'Production Manager', 'Site Supervisor', 'Contractor', 'Client']) {
        expect((await as[role].get('/api/authority/rules')).status, role).toBe(403);
      }
      expect((await request(app).get('/api/authority/rules')).status).toBe(401);
    });

    it('lets only the Owner create, change, deactivate or set sensitivity', async () => {
      for (const role of ['Admin', 'Project Manager', 'Accountant']) {
        expect((await as[role].post('/api/authority/rules').send(rule())).status, role).toBe(403);
        expect((await as[role].post('/api/authority/rules/sys-sensitive-invoice/deactivate').send({ reason: 'x' })).status, role).toBe(403);
        expect((await as[role].put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Normal', reason: 'x' })).status, role).toBe(403);
      }
      // A PM can't grant themselves authority either.
      expect((await as['Project Manager'].post('/api/authority/rules').send(rule({ target_user_id: 'user-pm', target_role: undefined }))).status).toBe(403);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM delegated_authorities WHERE kind = 'owner'`)).rows[0].n).toBe(0);
    });
  });

  describe('Owner rules', () => {
    let id = '';
    it('creates a rule stamped by the server, with a readable summary, and audits it', async () => {
      const r = (await owner().post('/api/authority/rules').send(rule()).expect(201)).body;
      id = r.id;
      expect(r).toMatchObject({ kind: 'owner', effect: 'allow', active: true, granted_by: 'user-owner', created_by: 'user-owner', target_role: 'Project Manager', min_value: 0, max_value: 20000, priority: 200 });
      expect(r.code).toMatch(/^DA-\d{4}$/);
      expect(r.source).toMatch(/^Granted by /);
      expect(r.summary).toMatch(/^Project Manager may approve variation \(internal approval\) from RM 0 to RM 20,000 on .+, while project risk is At Risk or lower, until \d{4}-\d{2}-\d{2}\.$/);
      const log = await audits(id);
      expect(log).toEqual([expect.objectContaining({ action: 'authority.rule.create', actor_id: 'user-owner' })]);
      expect(log[0].after).toMatchObject({ code: r.code, max_value: 20000, target_role: 'Project Manager' });
    });

    it('refuses anything the browser must not decide', async () => {
      for (const forged of [{ id: 'da-forged' }, { code: 'DA-9999' }, { kind: 'system' }, { system_key: 'x' }, { locked: true }, { granted_by: 'user-pm' }, { created_by: 'user-pm' }, { target_permission: 'drawings.approve' }]) {
        const res = await owner().post('/api/authority/rules').send(rule(forged));
        expect(res.status, JSON.stringify(forged)).toBe(400);
        expect(res.body.message).toMatch(/set by the server or not allowed/);
      }
    });

    it.each([
      [{ decision_type: 'payroll' }, /decision_type/],
      [{ target_role: 'Client' }, /cannot hold internal approval authority/],
      [{ target_role: 'Contractor' }, /cannot hold internal approval authority/],
      [{ target_role: 'Boss' }, /Unknown role/],
      [{ decision_type: 'drawing', target_role: 'Purchasing', min_value: undefined, max_value: undefined }, /does not have drawings.review/],
      [{ target_role: undefined }, /needs a target role or a target user/],
      [{ target_role: undefined, target_user_id: 'user-nobody' }, /does not exist/],
      [{ target_role: 'Project Manager', target_user_id: 'user-accountant' }, /is not a Project Manager/],
      [{ project_id: 'proj-nope' }, /does not exist/],
      [{ client_id: 'client-2' }, /does not belong to that client/],
      [{ decision_type: 'drawing', target_role: 'Project Manager' }, /has no amount/],
      [{ min_value: 30000, max_value: 100 }, /min_value must not be more than max_value/],
      [{ max_value: -5 }, /max_value must be an amount/],
      [{ max_risk: 'Fine' }, /max_risk must be one of/],
      [{ conditions: { auto_approve: true } }, /Unknown condition/],
      [{ conditions: { sensitivity: ['Sensitive'] } }, /only for require_owner rules/],
      [{ end_at: '2020-01-01T00:00:00Z' }, /already in the past/],
      [{ start_at: future, end_at: future }, /end_at must be after start_at/],
      [{ priority: 950 }, /priority must be a whole number from 1 to 899/],
      [{ effect: 'require_owner' }, /has no target role or user/],
      [{ name: '' }, /name must be/],
      [{ description: '' }, /description/],
    ])('validates %j', async (over, message) => {
      const res = await owner().post('/api/authority/rules').send(rule(over as Row));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(message);
    });

    it('refuses a deactivated target user', async () => {
      await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-pm-old', 'Old PM', 'oldpm@test.local', 'x', 'Project Manager', false)`);
      const res = await owner().post('/api/authority/rules').send(rule({ target_role: undefined, target_user_id: 'user-pm-old' }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/is deactivated/);
    });

    it('accepts a require_owner rule adding Sensitive projects for a type', async () => {
      const r = (await owner().post('/api/authority/rules').send({ name: 'Big variations need me', description: 'Variations over RM 50k', effect: 'require_owner', decision_type: 'variation', min_value: 50000 }).expect(201)).body;
      expect(r.summary).toBe('The Owner must approve every variation (internal approval) (of RM 50,000 or more).');
    });

    it('updates with a reason, audits before and after, and never edits System Policy', async () => {
      expect((await owner().patch(`/api/authority/rules/${id}`).send({ max_value: 15000 })).status).toBe(400); // no reason
      const r = (await owner().patch(`/api/authority/rules/${id}`).send({ max_value: 15000, change_reason: 'Tighter limit for Q4' }).expect(200)).body;
      expect(r.max_value).toBe(15000);
      const upd = (await audits(id)).find((a) => a.action === 'authority.rule.update');
      expect(upd).toMatchObject({ details: 'Tighter limit for Q4' });
      expect(upd.before.max_value).toBe(20000);
      expect(upd.after.max_value).toBe(15000);
      // Type and effect are fixed for a rule; a new rule is created instead.
      expect((await owner().patch(`/api/authority/rules/${id}`).send({ decision_type: 'purchase', change_reason: 'x' })).status).toBe(400);
      expect((await owner().patch(`/api/authority/rules/${id}`).send({ granted_by: 'user-pm', change_reason: 'x' })).status).toBe(400);
      // A change is validated as a whole rule.
      expect((await owner().patch(`/api/authority/rules/${id}`).send({ min_value: 99999, change_reason: 'x' })).status).toBe(400);
      const sys = await owner().patch('/api/authority/rules/sys-purchase-major').send({ min_value: 1, change_reason: 'x' });
      expect(sys.status).toBe(403);
      expect(sys.body.message).toMatch(/System Policy cannot be edited/);
      expect(Number((await db.pool.query(`SELECT min_value FROM delegated_authorities WHERE id = 'sys-purchase-major'`)).rows[0].min_value)).toBe(MAJOR_PURCHASE_THRESHOLD);
    });

    it('deactivates and reactivates with a reason (System Policy too, unless locked); never deletes', async () => {
      expect((await owner().post(`/api/authority/rules/${id}/deactivate`).send({})).status).toBe(400);
      const off = (await owner().post(`/api/authority/rules/${id}/deactivate`).send({ reason: 'PM on leave' }).expect(200)).body;
      expect(off).toMatchObject({ active: false, deactivated_by: 'user-owner', deactivation_reason: 'PM on leave' });
      expect((await owner().post(`/api/authority/rules/${id}/deactivate`).send({ reason: 'again' })).status).toBe(400);
      const on = (await owner().post(`/api/authority/rules/${id}/reactivate`).send({ reason: 'PM back' }).expect(200)).body;
      expect(on).toMatchObject({ active: true, deactivated_at: null, deactivation_reason: null });
      // System Policy: explicit and reversible.
      await owner().post('/api/authority/rules/sys-sensitive-invoice/deactivate').send({ reason: 'Invoices on sensitive projects go to finance' }).expect(200);
      await owner().post('/api/authority/rules/sys-sensitive-invoice/reactivate').send({ reason: 'Back to policy' }).expect(200);
      const locked = await owner().post('/api/authority/rules/sys-strategic-purchase/deactivate').send({ reason: 'try' });
      expect(locked.status).toBe(403);
      expect(locked.body.message).toMatch(/locked System Policy/);
      // No delete route: the rule is still there.
      expect([404, 405]).toContain((await owner().delete(`/api/authority/rules/${id}`)).status);
      expect((await db.pool.query('SELECT 1 FROM delegated_authorities WHERE id = $1', [id])).rowCount).toBe(1);
      expect((await audits(id)).map((a) => a.action)).toEqual(['authority.rule.create', 'authority.rule.update', 'authority.rule.deactivate', 'authority.rule.reactivate']);
      expect((await audits('sys-sensitive-invoice')).map((a) => a.action)).toEqual(['authority.rule.deactivate', 'authority.rule.reactivate']);
    });

    it('never extends an authority past its end date', async () => {
      const r = (await owner().post('/api/authority/rules').send(rule({ name: 'Short lived', max_value: 1000 })).expect(201)).body;
      await owner().post(`/api/authority/rules/${r.id}/deactivate`).send({ reason: 'done' }).expect(200);
      await db.pool.query(`UPDATE delegated_authorities SET end_at = now() - interval '1 day', start_at = now() - interval '10 days' WHERE id = $1`, [r.id]);
      const res = await owner().post(`/api/authority/rules/${r.id}/reactivate`).send({ reason: 'again' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/create a new rule instead/);
    });

    it('shows the history to the Owner and Admin', async () => {
      const hist = (await as['Admin'].get(`/api/authority/rules/${id}/history`).expect(200)).body as Row[];
      expect(hist.map((h) => h.action)).toEqual(['authority.rule.create', 'authority.rule.update', 'authority.rule.deactivate', 'authority.rule.reactivate']);
      expect((await as['Project Manager'].get(`/api/authority/rules/${id}/history`)).status).toBe(403);
      expect((await owner().get('/api/authority/rules/da-nope')).status).toBe(404);
    });
  });

  describe('project sensitivity', () => {
    it('is set only by the Owner, with a reason, and audited', async () => {
      expect((await owner().put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Secret', reason: 'x' })).status).toBe(400);
      expect((await owner().put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Sensitive' })).status).toBe(400);
      expect((await owner().put('/api/projects/proj-nope/sensitivity').send({ sensitivity: 'Sensitive', reason: 'x' })).status).toBe(404);
      const r = (await owner().put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Sensitive', reason: 'Flagship client' }).expect(200)).body;
      expect(r).toMatchObject({ project_id: 'proj-1', sensitivity: 'Sensitive', changed: true });
      const log = (await db.pool.query(`SELECT actor_id, before, after, details FROM audit_logs WHERE action = 'project.sensitivity.change' AND entity_id = 'proj-1'`)).rows;
      expect(log).toEqual([{ actor_id: 'user-owner', before: { sensitivity: 'Normal' }, after: { sensitivity: 'Sensitive' }, details: 'Flagship client' }]);
    });

    it('cannot be changed through the general project APIs or the browser sync', async () => {
      await owner().patch('/api/projects/proj-1').send({ sensitivity: 'Normal' }).expect(200);
      const project = (await owner().get('/api/projects/proj-1').expect(200)).body;
      expect(project.sensitivity).toBe('Sensitive');
      await owner().post('/api/data/sync').send({ upserts: { projects: [{ ...project, sensitivity: 'Strategic' }] } }).expect(200);
      expect((await db.pool.query(`SELECT sensitivity FROM projects WHERE id = 'proj-1'`)).rows[0].sensitivity).toBe('Sensitive');
      await owner()
        .post('/api/projects')
        .send({ id: 'proj-s', project_number: 'NW-S', project_name: 'S', client_id: 'client-2', site_address: 'KL', contract_value: 1, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-01-01', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '', sensitivity: 'Strategic' })
        .expect(201);
      expect((await db.pool.query(`SELECT sensitivity FROM projects WHERE id = 'proj-s'`)).rows[0].sensitivity).toBe('Normal');
      await owner().put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Normal', reason: 'Back to normal for the rest of the suite' }).expect(200);
    });
  });

  describe('existing approval behaviour is unchanged by default', () => {
    it('an Owner rule does not yet let the PM approve anything (no approval path reads rules in batch 1)', async () => {
      await owner().post('/api/authority/rules').send(rule({ name: 'PM drawings', decision_type: 'drawing', min_value: undefined, max_value: undefined, max_risk: undefined })).expect(201);
      // Variation internal approval: still Owner-only.
      await as['Project Manager'].post('/api/variations').send({ id: 'vo-b1', variation_number: 'VO-B1', project_id: 'proj-1', project_name: 'Aurora', title: 'Shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 500, status: 'Identified', created_at: '' }).expect(201);
      await as['Project Manager'].post('/api/variations/vo-b1/transition').send({ status: 'Internal Approval' }).expect(200);
      expect((await as['Production Manager'].post('/api/variations/vo-b1/transition').send({ status: 'Client Approval' })).status).toBe(403);
      expect((await db.pool.query(`SELECT status FROM variations WHERE id = 'vo-b1'`)).rows[0].status).toBe('Internal Approval');
      // Drawing approval: still drawings.approve only.
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id: 'rev-b1', revision: 'Rev 21', title: 'x', file_url: '/r21.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-b1/status').send({ status: 'Internal Review' }).expect(200);
      expect((await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-b1/status').send({ status: 'Approved' })).status).toBe(403);
      await owner().post('/api/drawings/dwg-1/revisions/rev-b1/status').send({ status: 'Approved' }).expect(200);
    });

    it('a deactivated user is refused', async () => {
      await db.pool.query(`UPDATE users SET is_active = false WHERE id = 'user-admin'`);
      expect((await as['Admin'].get('/api/authority/rules')).status).toBe(401);
      await db.pool.query(`UPDATE users SET is_active = true WHERE id = 'user-admin'`);
    });
  });
});
