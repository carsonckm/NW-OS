import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { permissionsFor, ROLES } from '../auth/permissions';
import { MAJOR_PURCHASE_THRESHOLD } from './hooks/purchasing';
import { AccessContext } from '../auth/access';
import { authorityCeiling, projectOf } from './authorityCeiling';

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
      // 19 rows from batch 1, plus batch 2 (migration 018): the approval_request type's two
      // sensitivity rows, SYS-PURCHASE-APPROVED and the two assigned-approver rows.
      expect(sys.length).toBe(24);
      expect(sys.every((r) => r.granted_by === null && r.active)).toBe(true);
      const by = Object.fromEntries(sys.map((r) => [r.code, r]));
      expect(by['SYS-DRAWING']).toMatchObject({ effect: 'allow', target_permission: 'drawings.approve' });
      expect(by['SYS-VARIATION']).toMatchObject({ effect: 'allow', target_permission: 'variations.approve' });
      // The purchase threshold mirrors the code constant exactly.
      expect(Number(by['SYS-PURCHASE-MAJOR'].min_value)).toBe(MAJOR_PURCHASE_THRESHOLD);
      expect(Number(by['SYS-PURCHASE-STANDARD'].max_value)).toBe(MAJOR_PURCHASE_THRESHOLD - 0.01);
      expect(by['SYS-PURCHASE-ACCOUNTANT']).toMatchObject({ target_role: 'Accountant' });
      expect(by['SYS-TECHNICAL-PRODMGR']).toMatchObject({ target_role: 'Production Manager' });
      // The sensitivity ceiling rows are locked; the rest of System Policy is not.
      const ceiling = (code: string) => code.startsWith('SYS-STRATEGIC-') || code.startsWith('SYS-SENSITIVE-');
      expect(sys.filter((r) => ceiling(r.code)).length).toBe(12);
      expect(sys.filter((r) => ceiling(r.code)).every((r) => r.locked)).toBe(true);
      expect(sys.filter((r) => !ceiling(r.code)).every((r) => !r.locked)).toBe(true);
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
      expect(Object.fromEntries(types.map((t) => [t.key, t.baseline_permission]))).toEqual({ drawing: 'drawings.review', variation: 'variations.review', purchase: 'purchasing.view', invoice: 'finance.view', ai_proposal: 'approvals.request', approval_request: 'approvals.view' });
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
      await owner().post('/api/authority/rules/sys-ai-proposal/deactivate').send({ reason: 'Trial without asker approvals' }).expect(200);
      await owner().post('/api/authority/rules/sys-ai-proposal/reactivate').send({ reason: 'Back to policy' }).expect(200);
      for (const code of ['sys-strategic-purchase', 'sys-sensitive-invoice']) {
        const locked = await owner().post(`/api/authority/rules/${code}/deactivate`).send({ reason: 'try' });
        expect(locked.status, code).toBe(403);
        expect(locked.body.message).toMatch(/locked System Policy/);
      }
      // No delete route: the rule is still there.
      expect([404, 405]).toContain((await owner().delete(`/api/authority/rules/${id}`)).status);
      expect((await db.pool.query('SELECT 1 FROM delegated_authorities WHERE id = $1', [id])).rowCount).toBe(1);
      expect((await audits(id)).map((a) => a.action)).toEqual(['authority.rule.create', 'authority.rule.update', 'authority.rule.deactivate', 'authority.rule.reactivate']);
      expect((await audits('sys-ai-proposal')).map((a) => a.action)).toEqual(['authority.rule.deactivate', 'authority.rule.reactivate']);
      expect(await audits('sys-sensitive-invoice')).toEqual([]);
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
      // The PM variation rule on proj-1 is now above the ceiling: reported, kept, overridden.
      expect(r.rules_above_ceiling).toHaveLength(1);
      const log = (await db.pool.query(`SELECT actor_id, before, after, details FROM audit_logs WHERE action = 'project.sensitivity.change' AND entity_id = 'proj-1'`)).rows;
      expect(log).toEqual([{ actor_id: 'user-owner', before: { sensitivity: 'Normal' }, after: { sensitivity: 'Sensitive', rules_above_ceiling: r.rules_above_ceiling }, details: 'Flagship client' }]);
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
    it('without a rule the PM approves nothing; a drawing rule (batch 2) lets the PM approve drawings only', async () => {
      // Variation internal approval: still Owner-only.
      await as['Project Manager'].post('/api/variations').send({ id: 'vo-b1', variation_number: 'VO-B1', project_id: 'proj-1', project_name: 'Aurora', title: 'Shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 500, status: 'Identified', created_at: '' }).expect(201);
      await as['Project Manager'].post('/api/variations/vo-b1/transition').send({ status: 'Internal Approval' }).expect(200);
      expect((await as['Production Manager'].post('/api/variations/vo-b1/transition').send({ status: 'Client Approval' })).status).toBe(403);
      expect((await db.pool.query(`SELECT status FROM variations WHERE id = 'vo-b1'`)).rows[0].status).toBe('Internal Approval');
      // Drawing approval: without a rule, drawings.approve only.
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id: 'rev-b1', revision: 'Rev 21', title: 'x', file_url: '/r21.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-b1/status').send({ status: 'Internal Review' }).expect(200);
      expect((await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-b1/status').send({ status: 'Approved' })).status).toBe(403);
      // With the Owner's drawing rule for the PM on this project, the PM may approve (batch 2);
      // the drawing rule gives nothing for variations.
      const r = (await owner().post('/api/authority/rules').send(rule({ name: 'PM drawings', decision_type: 'drawing', min_value: undefined, max_value: undefined, max_risk: undefined })).expect(201)).body;
      expect((await as['Production Manager'].post('/api/variations/vo-b1/transition').send({ status: 'Client Approval' })).status).toBe(403);
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-b1/status').send({ status: 'Approved' }).expect(200);
      await owner().post(`/api/authority/rules/${r.id}/deactivate`).send({ reason: 'Back to the default for the rest of the suite' }).expect(200);
    });

    it('a deactivated user is refused', async () => {
      await db.pool.query(`UPDATE users SET is_active = false WHERE id = 'user-admin'`);
      expect((await as['Admin'].get('/api/authority/rules')).status).toBe(401);
      await db.pool.query(`UPDATE users SET is_active = true WHERE id = 'user-admin'`);
    });
  });
  // ---- Batch 1 review fixes -------------------------------------------------------------------
  const TYPES = ['drawing', 'variation', 'purchase', 'invoice', 'ai_proposal'] as const;
  /** A real internal user holding each type's baseline permission (and not the final approval permission). */
  const HOLDER: Record<string, string> = { drawing: 'user-pm', variation: 'user-pm', purchase: 'user-pm', invoice: 'user-accountant', ai_proposal: 'user-pm' };
  const ctxOf = async (userId: string) => AccessContext.load(db.pool, (await db.pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0]);
  const gate = async (userId: string, type: string, projectId: string | null) => (await authorityCeiling(db.pool, await ctxOf(userId), type, projectId)).outcome;
  const setSensitivity = async (projectId: string, sensitivity: string, reason: string) =>
    (await owner().put(`/api/projects/${projectId}/sensitivity`).send({ sensitivity, reason }).expect(200)).body as Row;
  const drawingRule = (over: Row = {}) => rule({ name: 'PM approves drawings', decision_type: 'drawing', min_value: undefined, max_value: undefined, max_risk: undefined, ...over });
  let revN = 30;
  /** A client revision of dwg-1 under internal review, uploaded by the PM. */
  const revisionInReview = async () => {
    const id = `rev-c${++revN}`;
    await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id, revision: `Rev ${revN}`, title: 'x', file_url: `/r${revN}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
    await as['Project Manager'].post(`/api/drawings/dwg-1/revisions/${id}/status`).send({ status: 'Internal Review' }).expect(200);
    return id;
  };
  const revStatus = async (id: string) => (await db.pool.query('SELECT approval_status FROM drawing_revisions WHERE id = $1', [id])).rows[0].approval_status;

  describe('fix 1: project sensitivity is a hard authority ceiling', () => {
    let dwgProject = '';
    let pmDrawingRule: Row;
    beforeAll(async () => {
      dwgProject = (await projectOf(db.pool, 'drawings', 'dwg-1'))!;
    });

    it('Normal: delegation may apply, but a delegate still needs a matching rule; the Owner decides', async () => {
      expect((await db.pool.query('SELECT sensitivity FROM projects WHERE id = $1', [dwgProject])).rows[0].sensitivity).toBe('Normal');
      for (const t of TYPES) {
        expect(await gate(HOLDER[t], t, dwgProject), t).toBe('rule_required');
        expect(await gate('user-owner', t, dwgProject), t).toBe('owner');
      }
    });

    it('Sensitive: a PM with a matching delegated rule cannot approve a protected decision; the Owner can', async () => {
      pmDrawingRule = (await owner().post('/api/authority/rules').send(drawingRule({ project_id: dwgProject, name: 'PM approves Aurora drawings' })).expect(201)).body;
      const res = await setSensitivity(dwgProject, 'Sensitive', 'Flagship client asked for Owner sign-off');
      expect(res.rules_above_ceiling).toContain(pmDrawingRule.code);
      // The rule is kept (and still active) but the ceiling overrides it.
      expect((await db.pool.query('SELECT active FROM delegated_authorities WHERE id = $1', [pmDrawingRule.id])).rows[0].active).toBe(true);
      for (const t of TYPES) {
        expect(await gate(HOLDER[t], t, dwgProject), t).toBe('owner_required');
        expect(await gate('user-owner', t, dwgProject), t).toBe('owner');
      }
      for (const u of ['user-prod-mgr', 'user-accountant', 'user-purchasing', 'user-admin']) expect(await gate(u, 'drawing', dwgProject), u).toBe('owner_required');
      const rev = await revisionInReview();
      expect((await as['Project Manager'].post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved' })).status).toBe(403);
      expect(await revStatus(rev)).toBe('Internal Review');
      await owner().post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved' }).expect(200);
      expect(await revStatus(rev)).toBe('Approved');
    });

    it('Sensitive protection cannot be switched off through delegated authority management', async () => {
      for (const t of TYPES) {
        const res = await owner().post(`/api/authority/rules/sys-sensitive-${t}/deactivate`).send({ reason: 'try' });
        expect(res.status, t).toBe(403);
        expect(res.body.message).toMatch(/locked System Policy/);
      }
      expect((await owner().patch('/api/authority/rules/sys-sensitive-drawing').send({ priority: 1, change_reason: 'x' })).status).toBe(403);
      // Defence in depth: the database itself refuses to switch a locked row off or delete it.
      await expect(db.pool.query(`UPDATE delegated_authorities SET active = false WHERE id = 'sys-sensitive-drawing'`)).rejects.toThrow(/locked/);
      await expect(db.pool.query(`UPDATE delegated_authorities SET conditions = '{}' WHERE id = 'sys-strategic-drawing'`)).rejects.toThrow(/locked/);
      await expect(db.pool.query(`DELETE FROM delegated_authorities WHERE id = 'sys-sensitive-purchase'`)).rejects.toThrow(/locked/);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM delegated_authorities WHERE locked AND active`)).rows[0].n).toBe(12);
      // Which types Sensitive protects is not editable through any API.
      const types = (await owner().get('/api/authority/decision-types').expect(200)).body as Row[];
      expect(types.every((t) => t.sensitive_protected === true)).toBe(true);
      expect([404, 405]).toContain((await owner().patch('/api/authority/decision-types/drawing').send({ sensitive_protected: false })).status);
      expect([404, 405]).toContain((await owner().put('/api/authority/decision-types/drawing').send({ sensitive_protected: false })).status);
      expect((await db.pool.query(`SELECT bool_and(sensitive_protected) AS ok FROM authority_decision_types`)).rows[0].ok).toBe(true);
    });

    it('refuses to create, change or reactivate an allow rule above the Sensitive ceiling', async () => {
      const create = await owner().post('/api/authority/rules').send(drawingRule({ project_id: dwgProject, name: 'Another PM drawing rule' }));
      expect(create.status).toBe(400);
      expect(create.body.message).toMatch(/is Sensitive: only the Owner may approve its drawing decisions/);
      for (const t of ['variation', 'purchase', 'invoice', 'ai_proposal']) {
        const target = t === 'invoice' ? 'Accountant' : 'Project Manager';
        const body = rule({ name: `PM ${t} on sensitive`, decision_type: t, target_role: target, project_id: dwgProject, max_risk: undefined, ...(t === 'ai_proposal' ? { min_value: undefined, max_value: undefined } : {}) });
        const res = await owner().post('/api/authority/rules').send(body);
        expect(res.status, t).toBe(400);
        expect(res.body.message, t).toMatch(/is Sensitive/);
      }
      // Moving a rule from a Normal project onto the Sensitive one is refused.
      const elsewhere = (await owner().post('/api/authority/rules').send(drawingRule({ project_id: 'proj-2', client_id: undefined, name: 'PM drawings on Horizon' })).expect(201)).body;
      const move = await owner().patch(`/api/authority/rules/${elsewhere.id}`).send({ project_id: dwgProject, change_reason: 'move' });
      expect(move.status).toBe(400);
      expect((await db.pool.query('SELECT project_id FROM delegated_authorities WHERE id = $1', [elsewhere.id])).rows[0].project_id).toBe('proj-2');
      // A rule above the ceiling may be switched off (less authority), never back on.
      await owner().post(`/api/authority/rules/${pmDrawingRule.id}/deactivate`).send({ reason: 'Project is Sensitive now' }).expect(200);
      const back = await owner().post(`/api/authority/rules/${pmDrawingRule.id}/reactivate`).send({ reason: 'try' });
      expect(back.status).toBe(400);
      expect(back.body.message).toMatch(/is Sensitive/);
      // Asking for more Owner involvement is always allowed.
      await owner().post('/api/authority/rules').send({ name: 'Owner signs Aurora variations', description: 'Belt and braces', effect: 'require_owner', decision_type: 'variation', project_id: dwgProject }).expect(201);
    });

    it('Strategic: nobody but the Owner can approve any decision type, whatever the rules say', async () => {
      // A client-wide rule can be stored, but it never reaches above a project's ceiling.
      const clientId = (await db.pool.query('SELECT client_id FROM projects WHERE id = $1', [dwgProject])).rows[0].client_id;
      await owner().post('/api/authority/rules').send(drawingRule({ project_id: undefined, client_id: clientId, name: 'PM drawings for this client' })).expect(201);
      await setSensitivity(dwgProject, 'Strategic', 'Board-level contract');
      for (const t of TYPES) {
        for (const u of ['user-pm', 'user-accountant', 'user-prod-mgr', 'user-purchasing', 'user-admin', 'user-site', 'user-client', 'user-contractor']) {
          expect(await gate(u, t, dwgProject), `${u} ${t}`).toBe('owner_required');
        }
        expect(await gate('user-owner', t, dwgProject), t).toBe('owner');
      }
      // Including decision types added later (and unknown ones fail closed).
      await db.pool.query(`INSERT INTO authority_decision_types (key, label, baseline_permission, has_value, sensitive_protected) VALUES ('site_instruction', 'Site instruction', 'drawings.review', false, false)`);
      expect(await gate('user-pm', 'site_instruction', dwgProject)).toBe('owner_required');
      expect(await gate('user-pm', 'site_instruction', 'proj-2')).toBe('rule_required');
      expect(await gate('user-pm', 'no_such_type', 'proj-2')).toBe('owner_required');
      await db.pool.query(`DELETE FROM authority_decision_types WHERE key = 'site_instruction'`);
      for (const t of TYPES) {
        const target = t === 'invoice' ? 'Accountant' : 'Project Manager';
        const body = rule({ name: `Strategic ${t}`, decision_type: t, target_role: target, project_id: dwgProject, max_risk: undefined, ...(['drawing', 'ai_proposal'].includes(t) ? { min_value: undefined, max_value: undefined } : {}) });
        const res = await owner().post('/api/authority/rules').send(body);
        expect(res.status, t).toBe(400);
        expect(res.body.message, t).toMatch(/is Strategic/);
      }
      // Live approvals: the PM is refused, the Owner can still decide.
      const rev = await revisionInReview();
      expect((await as['Project Manager'].post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved' })).status).toBe(403);
      await owner().post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved' }).expect(200);
      await as['Project Manager'].post('/api/variations').send({ id: 'vo-strat', variation_number: 'VO-STRAT', project_id: dwgProject, project_name: 'Aurora', title: 'Panel', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 500, status: 'Identified', created_at: '' }).expect(201);
      await as['Project Manager'].post('/api/variations/vo-strat/transition').send({ status: 'Internal Approval' }).expect(200);
      expect((await as['Project Manager'].post('/api/variations/vo-strat/transition').send({ status: 'Client Approval' })).status).toBe(403);
      await owner().post('/api/variations/vo-strat/transition').send({ status: 'Client Approval' }).expect(200);
    });

    it('cannot be bypassed by changing project, user or role IDs in the request', async () => {
      // The decision's project comes from the stored record, never from the request.
      expect(await projectOf(db.pool, 'drawings', 'dwg-1')).toBe(dwgProject);
      await expect(projectOf(db.pool, 'drawings', 'dwg-nope')).rejects.toThrow(/does not exist/);
      await expect(projectOf(db.pool, 'projects', dwgProject)).rejects.toThrow(/No project lookup/);
      // A project the server can't find is escalated, not treated as Normal.
      expect(await gate('user-pm', 'drawing', 'proj-nope')).toBe('owner_required');
      const rev = await revisionInReview();
      const forged = await as['Project Manager']
        .post(`/api/drawings/dwg-1/revisions/${rev}/status`)
        .send({ status: 'Approved', project_id: 'proj-2', user_id: 'user-owner', role: 'Owner / CEO', approved_by_id: 'user-owner', sensitivity: 'Normal', authority_id: 'da-forged' });
      expect([400, 403]).toContain(forged.status);
      expect(await revStatus(rev)).toBe('Internal Review');
      // Lowering the ceiling through the general APIs is ignored; a non-Owner can't use the sensitivity API.
      await owner().patch(`/api/projects/${dwgProject}`).send({ sensitivity: 'Normal' }).expect(200);
      expect((await as['Project Manager'].put(`/api/projects/${dwgProject}/sensitivity`).send({ sensitivity: 'Normal', reason: 'x' })).status).toBe(403);
      expect((await db.pool.query('SELECT sensitivity FROM projects WHERE id = $1', [dwgProject])).rows[0].sensitivity).toBe('Strategic');
      // A forged authority rule id or a rule for another project changes nothing.
      expect((await as['Project Manager'].post(`/api/authority/rules/${pmDrawingRule.id}/reactivate`).send({ reason: 'x' })).status).toBe(403);
      expect(await gate('user-pm', 'drawing', dwgProject)).toBe('owner_required');
    });

    it('sensitivity changes stay Owner-only, need a reason, and are audited before and after', async () => {
      expect((await owner().put(`/api/projects/${dwgProject}/sensitivity`).send({ sensitivity: 'Sensitive' })).status).toBe(400);
      await setSensitivity(dwgProject, 'Sensitive', 'Contract signed; board review over');
      const normal = await setSensitivity(dwgProject, 'Normal', 'Routine project again');
      expect(normal.rules_above_ceiling).toEqual([]);
      const log = (await db.pool.query(`SELECT actor_id, before, after, details FROM audit_logs WHERE action = 'project.sensitivity.change' AND entity_id = $1 ORDER BY id`, [dwgProject])).rows;
      expect(log.map((l) => `${l.before.sensitivity}->${l.after.sensitivity}`).slice(-4)).toEqual(['Normal->Sensitive', 'Sensitive->Strategic', 'Strategic->Sensitive', 'Sensitive->Normal']);
      expect(log.slice(-2).map((l) => l.details)).toEqual(['Contract signed; board review over', 'Routine project again']);
      expect(log.every((l) => l.actor_id === 'user-owner')).toBe(true);
      // Back to Normal: delegation may apply again (the client-wide and Horizon rules are still there).
      expect(await gate('user-pm', 'drawing', dwgProject)).toBe('rule_required');
    });
  });

  describe('fix 2: a baseline permission is never approval authority', () => {
    const BASELINE: Record<string, string> = { drawing: 'drawings.review', variation: 'variations.review', purchase: 'purchasing.view', invoice: 'finance.view', ai_proposal: 'approvals.request' };
    /** A signed-in internal user holding only this one permission (not a real role). */
    const onlyBaseline = (perm: string) => ({ user: { id: 'user-x', name: 'X', role: 'Project Manager' }, can: (p: string) => p === perm }) as unknown as AccessContext;
    // No Owner delegation in force: the baseline permission is all these users have.
    beforeAll(async () => {
      for (const r of (await owner().get('/api/authority/rules?kind=owner&active=true').expect(200)).body as Row[]) {
        if (r.effect === 'allow') await owner().post(`/api/authority/rules/${r.id}/deactivate`).send({ reason: 'Baseline-only checks' }).expect(200);
      }
    });

    it('for every decision type, the baseline permission alone never yields approval', async () => {
      for (const t of TYPES) {
        const r = await authorityCeiling(db.pool, onlyBaseline(BASELINE[t]), t, 'proj-2');
        expect(r, t).toMatchObject({ outcome: 'rule_required', baseline_permission: BASELINE[t] });
        expect(r.reason).toMatch(/alone approves nothing/);
        // Without the baseline, no rule could ever help.
        expect((await authorityCeiling(db.pool, onlyBaseline('projects.view'), t, 'proj-2')).outcome, t).toBe('denied');
      }
    });

    it('drawings.review alone cannot approve a drawing', async () => {
      const rev = await revisionInReview();
      for (const role of ['Project Manager', 'Production Manager']) {
        expect((await as[role].post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved' })).status, role).toBe(403);
      }
      expect(await revStatus(rev)).toBe('Internal Review');
    });

    it('variations.review alone cannot approve a variation', async () => {
      await owner().post('/api/variations').send({ id: 'vo-base', variation_number: 'VO-BASE', project_id: 'proj-1', project_name: 'Aurora', title: 'Door', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 500, status: 'Identified', created_at: '' }).expect(201);
      await owner().post('/api/variations/vo-base/transition').send({ status: 'Internal Approval' }).expect(200);
      expect((await as['Project Manager'].post('/api/variations/vo-base/transition').send({ status: 'Client Approval' })).status).toBe(403);
      expect((await db.pool.query(`SELECT status FROM variations WHERE id = 'vo-base'`)).rows[0].status).toBe('Internal Approval');
    });

    it('purchasing.view alone cannot approve a purchase', async () => {
      const po = { id: 'po-base', po_number: 'PO-BASE', project_id: 'proj-2', project_name: 'Horizon', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-a', item_description: 'Plywood', specification: '', quantity: 30, unit: 'sheet', unit_price: 1000, total_price: 1 }], total_amount: 1, requested_by: 'Faridah', expected_delivery_date: '2026-10-20', created_at: '', status: 'Pending Approval' };
      await as['Purchasing'].post('/api/purchase-orders').send(po).expect(201);
      await as['Purchasing']
        .post('/api/approvals')
        .send({ id: 'apr-base', approval_number: 'APR-BASE', approval_type: 'Major Purchase', title: 'PO-BASE RM 30,000', description: 'Plywood', project_id: 'proj-2', project_name: 'Horizon', related_entity_type: 'purchase', related_entity_id: 'po-base', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' })
        .expect(201);
      for (const role of ['Project Manager', 'Production Manager', 'Admin']) {
        expect((await as[role].patch('/api/purchase-orders/po-base').send({ status: 'Issued' })).status, role).toBe(403);
        expect((await as[role].post('/api/approvals/apr-base/decision').send({ decision: 'Approved' })).status, role).toBe(403);
      }
      expect((await db.pool.query(`SELECT status FROM purchase_orders WHERE id = 'po-base'`)).rows[0].status).toBe('Pending Approval');
      expect((await db.pool.query(`SELECT decision FROM approvals WHERE id = 'apr-base'`)).rows[0].decision).toBe('Pending');
    });

    it('finance.view alone cannot approve an invoice', async () => {
      // No role today holds finance.view without finance.edit, so the gate test above covers
      // finance.view alone; here, roles without finance.edit are refused on the live path.
      await owner().post('/api/invoices').send({ id: 'inv-base', invoice_number: 'INV-BASE', invoice_type: 'Client Billing Invoice', party_name: 'Client', project_id: 'proj-2', project_name: 'Horizon', amount_before_tax: 1000, tax_amount: 0, total_amount: 1, invoice_date: '2026-10-22', due_date: '2026-11-21', status: 'Pending Approval', paid_amount: 0 }).expect(201);
      for (const role of ['Project Manager', 'Purchasing', 'Production Manager', 'Admin']) {
        expect((await as[role].patch('/api/invoices/inv-base').send({ status: 'Approved' })).status, role).toBe(403);
      }
      expect((await db.pool.query(`SELECT status FROM commercial_invoices WHERE id = 'inv-base'`)).rows[0].status).toBe('Pending Approval');
    });

    it('approvals.request alone cannot approve someone else\'s AI proposal', async () => {
      const res = await as['Site Supervisor'].post('/api/assistant/proposals').send({ action: 'create_task', params: { project_id: 'proj-1', title: 'Order more hinges', assigned_user_id: 'user-purchasing' } }).expect(201);
      for (const role of ['Project Manager', 'Purchasing', 'Production Manager']) {
        const denied = await as[role].post(`/api/approvals/${res.body.id}/decision`).send({ decision: 'Approved' });
        expect([403, 404], role).toContain(denied.status);
      }
      expect((await db.pool.query('SELECT decision FROM approvals WHERE id = $1', [res.body.id])).rows[0].decision).toBe('Pending');
    });

    it('existing behaviour is kept: final approval permissions stay Owner-only, System Policy unchanged', async () => {
      const holders = (perm: string) => ROLES.filter((r) => permissionsFor(r).has(perm as never)).sort();
      expect(holders('drawings.approve')).toEqual(['Owner / CEO']);
      expect(holders('variations.approve')).toEqual(['Owner / CEO']);
      expect(Number((await db.pool.query(`SELECT min_value FROM delegated_authorities WHERE id = 'sys-purchase-major'`)).rows[0].min_value)).toBe(MAJOR_PURCHASE_THRESHOLD);
      const sys = (await db.pool.query(`SELECT code, target_role, conditions FROM delegated_authorities WHERE id IN ('sys-purchase-accountant', 'sys-technical-prodmgr', 'sys-invoice', 'sys-invoice-mismatch', 'sys-ai-proposal')`)).rows;
      expect(sys).toHaveLength(5);
      expect(Object.fromEntries(sys.map((r) => [r.code, r.conditions]))).toMatchObject({
        'SYS-PURCHASE-ACCOUNTANT': { approval_types: ['Major Purchase', 'Major Cost'] },
        'SYS-TECHNICAL-PRODMGR': { approval_types: ['Technical Change', 'NW Production Drawing Approval'] },
        'SYS-INVOICE': { match_status: ['Matched', 'Not applicable'], no_self_approval: true },
        'SYS-INVOICE-MISMATCH': { match_status_not: ['Matched', 'Not applicable'] },
        'SYS-AI-PROPOSAL': { assigned_approver: true },
      });
    });
  });
});
