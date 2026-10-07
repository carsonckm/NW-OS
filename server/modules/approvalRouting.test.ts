import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { withTransaction } from '../db/pool';
import { reevaluateRoutes, ROUTING_PRECEDENCE, unroutedDecisions } from './approvalRouting';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 3: approval routing and Owner authority settings', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let app: Parameters<typeof request>[0];
  const projA = 'proj-1';
  let projB = '';
  beforeAll(async () => {
    ({ db, as, app } = (await setupDemoWorld()) as never);
    // Records imported before routing existed get their routes (what the server does at start).
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    projB = (await db.pool.query(`SELECT p.id FROM projects p WHERE p.id NOT IN ('proj-1', 'proj-x') AND p.project_manager_id = 'user-pm' ORDER BY p.id LIMIT 1`)).rows[0]?.id ?? 'proj-2';
    // A second PM on project A, for the multiple-candidate scenario.
    await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-pm2', 'Second PM', 'pm2@test.local', 'x', 'Project Manager', true)`);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-pm2')`, [projA]);
  });
  afterAll(async () => {
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  const future = new Date(Date.now() + 90 * 86400_000).toISOString();
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  const grant = async (over: Row = {}) =>
    (await owner().post('/api/authority/rules').send({ name: 'PM variations', description: 'Routine variations', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: projA, end_at: future, priority: 200, ...over }).expect(201)).body as Row;
  const deactivate = (id: string, reason = 'test') => owner().post(`/api/authority/rules/${id}/deactivate`).send({ reason }).expect(200);
  const variation = async (projectId: string, amount: number) => {
    const id = next('vo-rt');
    await owner().post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: 'Extra shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    return id;
  };
  /** A fresh Normal project the PM manages (so earlier scenarios' rules do not touch it). */
  const newProject = async () => {
    const id = next('proj-rt');
    await owner().post('/api/projects').send({ id, project_number: id.toUpperCase(), project_name: id, client_id: 'client-2', site_address: 'KL', contract_value: 1, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    return id;
  };
  const route = async (kind: string, id: string) => (await db.pool.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 AND status = 'open'`, [kind, id])).rows[0] as Row | undefined;
  const history = async (kind: string, id: string) => (await db.pool.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 ORDER BY id`, [kind, id])).rows as Row[];
  const inbox = async (role: string) => (await as[role].get('/api/approval-routing/inbox').expect(200)).body as { items: Row[]; unrouted: Row[] };
  const approveVo = (role: string, id: string) => as[role].post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' });
  const setSensitivity = (projectId: string, sensitivity: string, reason = 'test') => owner().put(`/api/projects/${projectId}/sensitivity`).send({ sensitivity, reason }).expect(200);
  const noOrphans = async () => expect(await unroutedDecisions(db.pool)).toEqual([]);
  const approvalRequest = async (requester: string, over: Row = {}) => {
    const id = next('apr-rt');
    await as[requester]
      .post('/api/approvals')
      .send({ id, approval_number: id.toUpperCase(), approval_type: 'Safety-Critical Decision', title: 'Request', description: 'x', project_id: projA, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '', ...over })
      .expect(201);
    return id;
  };

  it('every pending decision starts with a route (no orphans), and the precedence is documented in code', async () => {
    await noOrphans();
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM approval_routes WHERE status = 'open'`)).rows[0].n).toBeGreaterThan(0);
    expect(ROUTING_PRECEDENCE).toEqual(['USER_RULE', 'PROJECT_ROLE_RULE', 'PROJECT_PERMISSION_RULE', 'CLIENT_RULE', 'GLOBAL_RULE', 'SYSTEM_POLICY', 'PRIOR_OWNER_APPROVAL', 'OWNER_FALLBACK']);
  });

  describe('acceptance scenarios', () => {
    let rule: Row;
    let pending: string;

    it('A. Normal: routed to the delegated PM, in their inbox, approved, audited', async () => {
      rule = await grant({ max_value: 20000 });
      const id = await variation(projA, 5000);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-pm', routing_basis: 'PROJECT_ROLE_RULE', authority_rule_id: rule.id, authority_rule_code: rule.code, project_sensitivity: 'Normal', decision_type: 'variation', owner_reason_code: null });
      const mine = (await inbox('Project Manager')).items.find((i) => i.resource_id === id)!;
      expect(mine).toMatchObject({ routing_basis: 'PROJECT_ROLE_RULE', authority_rule_code: rule.code, value: 5000, project_sensitivity: 'Normal', current: { allowed: true, reason_code: 'ALLOWED' } });
      expect((await inbox('Owner / CEO')).items.find((i) => i.resource_id === id)).toBeUndefined();
      await approveVo('Project Manager', id).expect(200);
      const [closed] = await history('variation', id);
      expect(closed).toMatchObject({ status: 'completed', completion_result: 'approved', completed_by: 'user-pm' });
      const audit = (await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'variation.transition' AND entity_id = $1`, [id])).rows[0].after;
      expect(audit.authority).toMatchObject({ matched_rule_code: rule.code, reason_code: 'ALLOWED' });
      const assign = (await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'approval.route.assign' AND entity_id = $1`, [String(closed.id)])).rows[0].after;
      expect(assign).toMatchObject({ resource: `variation:${id}`, assignee: 'user-pm', basis: 'PROJECT_ROLE_RULE', rule: rule.code, sensitivity: 'Normal' });
      pending = await variation(projA, 6000);
      expect((await route('variation', pending))!.assigned_user_id).toBe('user-pm');
    });

    it('B. Sensitive: new and pending approvals go to the Owner; the PM is refused (SENSITIVITY_BLOCKED)', async () => {
      const res = (await setSensitivity(projA, 'Sensitive', 'Board asked')).body;
      expect(res.routing_changes.rerouted).toBeGreaterThanOrEqual(1);
      expect(await route('variation', pending)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'SENSITIVITY_BLOCKED', project_sensitivity: 'Sensitive' });
      const reroute = (await db.pool.query(`SELECT before, after, details FROM audit_logs WHERE action = 'approval.route.reroute' AND after->>'resource' = $1`, [`variation:${pending}`])).rows.at(-1);
      expect(reroute).toMatchObject({ before: { assignee: 'user-pm' }, after: { assignee: 'user-owner', owner_reason: 'SENSITIVITY_BLOCKED' }, details: 'sensitivity Normal -> Sensitive' });
      const fresh = await variation(projA, 1000);
      expect((await route('variation', fresh))!.assigned_user_id).toBe('user-owner');
      expect((await inbox('Project Manager')).items.map((i) => i.resource_id)).not.toContain(fresh);
      const owners = (await as['Owner / CEO'].get('/api/approval-routing/owner').expect(200)).body.items as Row[];
      expect(owners.find((i) => i.resource_id === fresh)).toMatchObject({ owner_reason_code: 'SENSITIVITY_BLOCKED', project_sensitivity: 'Sensitive' });
      const refused = await approveVo('Project Manager', fresh);
      expect(refused.status).toBe(403);
      expect(refused.body.reason_code).toBe('SENSITIVITY_BLOCKED');
      await noOrphans();
    });

    it('C. Strategic: the Owner receives it; lowering back to Normal (Owner, reason) routes to the PM again', async () => {
      await setSensitivity(projA, 'Strategic', 'Board-level');
      const id = await variation(projA, 1000);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'SENSITIVITY_BLOCKED', project_sensitivity: 'Strategic' });
      expect((await approveVo('Project Manager', id)).body.reason_code).toBe('SENSITIVITY_BLOCKED');
      expect((await as['Project Manager'].put(`/api/projects/${projA}/sensitivity`).send({ sensitivity: 'Normal', reason: 'x' })).status).toBe(403);
      expect((await owner().put(`/api/projects/${projA}/sensitivity`).send({ sensitivity: 'Normal' })).status).toBe(400);
      expect((await route('variation', id))!.assigned_user_id).toBe('user-owner');
      await setSensitivity(projA, 'Normal', 'Board review finished');
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-pm', routing_basis: 'PROJECT_ROLE_RULE', project_sensitivity: 'Normal' });
      await noOrphans();
    });

    it('D. Authority expires while pending: the PM is refused, re-evaluation routes to the Owner with the reason', async () => {
      const short = await grant({ project_id: projB, name: 'Short PM authority' });
      const id = await variation(projB, 1000);
      expect((await route('variation', id))!.authority_rule_id).toBe(short.id);
      await db.pool.query(`UPDATE delegated_authorities SET start_at = now() - interval '9 days', end_at = now() - interval '1 minute' WHERE id = $1`, [short.id]);
      const refused = await approveVo('Project Manager', id);
      expect(refused.status).toBe(403);
      expect(refused.body.reason_code).toBe('AUTHORITY_EXPIRED');
      expect((await inbox('Project Manager')).items.find((i) => i.resource_id === id)).toMatchObject({ current: { allowed: false, reason_code: 'AUTHORITY_EXPIRED' } });
      const run = (await owner().post('/api/approval-routing/reevaluate').send({ project_id: projB }).expect(200)).body;
      expect(run.rerouted).toBeGreaterThanOrEqual(1);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'AUTHORITY_EXPIRED' });
      await noOrphans();
    });

    it('E. The Owner deactivates the rule: the pending approval is routed to the Owner at once', async () => {
      const id = await variation(projA, 2000);
      expect((await route('variation', id))!.assigned_user_id).toBe('user-pm');
      const impact = (await owner().get(`/api/authority/rules/${rule.id}/impact?action=deactivate`).expect(200)).body;
      expect(impact).toMatchObject({ allowed: true, pending_routed_by_this_rule: expect.any(Number) });
      expect(impact.pending_routed_by_this_rule).toBeGreaterThanOrEqual(1);
      expect(impact.users.map((u: Row) => u.id)).toEqual(expect.arrayContaining(['user-pm', 'user-pm2']));
      const res = (await deactivate(rule.id, 'PM on leave')).body;
      expect(res.routing_changes.rerouted).toBeGreaterThanOrEqual(1);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'AUTHORITY_DEACTIVATED' });
      expect((await approveVo('Project Manager', id)).body.reason_code).toBe('AUTHORITY_DEACTIVATED');
      await noOrphans();
    });

    it('F. Two eligible PMs: deterministic winner; an explicit user rule outranks a role rule; the explanation says why', async () => {
      const roleRule = await grant({ name: 'All PMs on A' });
      const id = await variation(projA, 1000);
      const r1 = (await route('variation', id))!;
      expect(r1).toMatchObject({ assigned_user_id: 'user-pm', routing_basis: 'PROJECT_ROLE_RULE' });
      expect(r1.data.eligible.map((e: Row) => e.user_id)).toEqual(['user-pm', 'user-pm2']);
      // Same result every time.
      await owner().post('/api/approval-routing/route').send({ kind: 'variation', id }).expect(200);
      expect((await route('variation', id))!.id).toBe(r1.id);
      const userRule = await grant({ name: 'Second PM by name', target_role: undefined, target_user_id: 'user-pm2', priority: 100 });
      const r2 = (await route('variation', id))!;
      expect(r2).toMatchObject({ assigned_user_id: 'user-pm2', routing_basis: 'USER_RULE', authority_rule_id: userRule.id });
      const explain = (await owner().get(`/api/approval-routing/explain?kind=variation&id=${id}`).expect(200)).body;
      expect(explain.current_route).toMatchObject({ routing_basis: 'USER_RULE', assignee: { id: 'user-pm2' } });
      expect(explain.current_route.eligible.map((e: Row) => `${e.user_id}:${e.basis}`)).toEqual(['user-pm2:USER_RULE', 'user-pm:PROJECT_ROLE_RULE']);
      expect(explain.history.map((h: Row) => h.status)).toEqual(['open', 'rerouted']);
      // The assignee may see their own explanation; another PM may not.
      await as['Project Manager'].get(`/api/approval-routing/explain?kind=variation&id=${id}`).expect(403);
      await deactivate(userRule.id);
      await deactivate(roleRule.id);
    });

    it('G. No delegate at all: the Owner receives it (never an orphan)', async () => {
      const id = await variation(projA, 1000);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'AUTHORITY_DEACTIVATED' });
      const other = await approvalRequest('Purchasing', { approval_type: 'Project Date Change', assigned_approver_role: 'Owner / CEO' });
      expect(await route('approval', other)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK' });
      await noOrphans();
    });

    it('H. Value above the delegation: Owner fallback with VALUE_LIMIT_EXCEEDED', async () => {
      const p = await newProject();
      const r = await grant({ project_id: p, max_value: 20000, name: 'PM to RM 20k' });
      expect((await route('variation', await variation(p, 15000)))!.assigned_user_id).toBe('user-pm');
      expect(await route('variation', await variation(p, 35000))).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'VALUE_LIMIT_EXCEEDED' });
      await deactivate(r.id);
    });

    it('I. Project risk rises above the delegation: Owner fallback with RISK_LIMIT_EXCEEDED', async () => {
      const p = await newProject();
      const r = await grant({ project_id: p, max_risk: 'Critical', name: 'PM, any risk' });
      const id = await variation(p, 1000);
      expect((await route('variation', id))!.assigned_user_id).toBe('user-pm');
      await owner().patch(`/api/authority/rules/${r.id}`).send({ max_risk: 'At Risk', change_reason: 'Only while the project is not critical' }).expect(200);
      // The project goes past its completion date: Critical.
      await db.pool.query(`UPDATE projects SET end_date = '2026-01-01' WHERE id = $1`, [p]);
      await owner().post('/api/approval-routing/reevaluate').send({ project_id: p }).expect(200);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'RISK_LIMIT_EXCEEDED' });
      await deactivate(r.id);
    });

    it('J. The PM loses the baseline permission (role change): no longer eligible, Owner fallback', async () => {
      const r = await grant({ target_role: undefined, target_user_id: 'user-pm2', name: 'Second PM by name again' });
      const id = await variation(projA, 1000);
      expect((await route('variation', id))!.assigned_user_id).toBe('user-pm2');
      // Site Supervisor has no variations.review (the variation baseline permission).
      await owner().patch('/api/users/user-pm2').send({ role: 'Site Supervisor' }).expect(200);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK' });
      await owner().patch('/api/users/user-pm2').send({ role: 'Project Manager' }).expect(200);
      expect((await route('variation', id))!.assigned_user_id).toBe('user-pm2');
      // A deactivated user is never selected.
      await owner().patch('/api/users/user-pm2').send({ is_active: false }).expect(200);
      expect((await route('variation', id))!.assigned_user_id).toBe('user-owner');
      await owner().patch('/api/users/user-pm2').send({ is_active: true }).expect(200);
      await deactivate(r.id);
      await noOrphans();
    });
  });

  describe('existing approval paths are routed', () => {
    it('Major Purchase request -> the Accountant (System Policy); a PO waiting for approval -> the Owner; issuing closes it', async () => {
      const po = next('po-rt');
      await as['Purchasing'].post('/api/purchase-orders').send({ id: po, po_number: po.toUpperCase(), project_id: projA, project_name: 'P', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 25000, total_price: 1 }], total_amount: 1, requested_by: 'x', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }).expect(201);
      expect(await route('purchase_order', po)).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'OWNER_REQUIRED', value: 25000, priority: 'High' });
      const req = await approvalRequest('Purchasing', { approval_type: 'Major Purchase', related_entity_type: 'purchase', related_entity_id: po });
      expect(await route('approval', req)).toMatchObject({ assigned_user_id: 'user-accountant', routing_basis: 'SYSTEM_POLICY', authority_rule_code: 'SYS-PURCHASE-ACCOUNTANT' });
      await as['Accountant'].post(`/api/approvals/${req}/decision`).send({ decision: 'Approved' }).expect(200);
      expect((await history('approval', req))[0]).toMatchObject({ status: 'completed', completion_result: 'approved' });
      // Once the Major Purchase approval is in, issuing the PO is Purchasing's.
      await owner().post('/api/approval-routing/route').send({ kind: 'purchase_order', id: po }).expect(200);
      expect(await route('purchase_order', po)).toMatchObject({ assigned_user_id: 'user-purchasing', authority_rule_code: 'SYS-PURCHASE-APPROVED' });
      await as['Purchasing'].patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' }).expect(200);
      expect(await route('purchase_order', po)).toBeUndefined();
      await noOrphans();
    });

    it('drawing revision in review -> the Owner (drawings.approve); approving closes the route', async () => {
      const rev = next('rev-rt');
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id: rev, revision: rev, title: 'x', file_url: `/${rev}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
      expect(await route('drawing_revision', rev)).toBeUndefined();
      await as['Project Manager'].post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Internal Review' }).expect(200);
      expect(await route('drawing_revision', rev)).toMatchObject({ assigned_user_id: 'user-owner', decision_type: 'drawing' });
      await owner().post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved' }).expect(200);
      expect((await history('drawing_revision', rev))[0]).toMatchObject({ status: 'completed', completion_result: 'approved', completed_by: 'user-owner' });
    });

    it('AI proposal -> the person it was put to', async () => {
      const p = await as['Site Supervisor'].post('/api/assistant/proposals').send({ action: 'create_task', params: { project_id: projA, title: 'Order hinges', assigned_user_id: 'user-purchasing' } }).expect(201);
      expect(await route('approval', p.body.id)).toMatchObject({ assigned_user_id: 'user-site', routing_basis: 'SYSTEM_POLICY', authority_rule_code: 'SYS-AI-PROPOSAL' });
    });

    it('client consent -> the client; an internal request assigned to Client -> never the client', async () => {
      const consent = await approvalRequest('Project Manager', { approval_type: 'Client Scope Change', assigned_approver_role: 'Client' });
      expect(await route('approval', consent)).toMatchObject({ assigned_user_id: 'user-client', routing_basis: 'CLIENT_CONSENT' });
      const internal = await approvalRequest('Project Manager', { assigned_approver_role: 'Client' });
      expect(await route('approval', internal)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK' });
      const clientInbox = await inbox('Client');
      expect(clientInbox.items.map((i) => i.resource_id)).toEqual([consent]);
      expect(clientInbox.items[0].current).toMatchObject({ allowed: true });
      expect((await inbox('Contractor')).items).toEqual([]);
    });

    it('Changes Requested closes the route; resubmitting routes it again', async () => {
      const id = await approvalRequest('Purchasing', { assigned_approver_role: 'Project Manager' });
      expect((await route('approval', id))!.assigned_user_id).toBe('user-pm');
      await as['Project Manager'].post(`/api/approvals/${id}/decision`).send({ decision: 'Changes Requested' }).expect(200);
      expect((await history('approval', id))[0]).toMatchObject({ status: 'completed', completion_result: 'changes_requested' });
      await as['Purchasing'].patch(`/api/approvals/${id}`).send({ decision: 'Pending' }).expect(200);
      expect((await route('approval', id))!.assigned_user_id).toBe('user-pm');
    });
  });

  describe('security: routing cannot be steered from the browser', () => {
    it('only the Owner creates authority rules', async () => {
      for (const role of ['Project Manager', 'Admin', 'Accountant', 'Contractor', 'Client']) {
        expect((await as[role].post('/api/authority/rules').send({ name: 'Self grant', description: 'x', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager' })).status, role).toBe(403);
        expect((await as[role].post('/api/authority/rules/preview').send({ name: 'Self grant', description: 'x', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager' })).status, role).toBe(403);
      }
    });

    it('forged assignee, basis, rule and project fields change nothing; self-assignment never routes to the requester', async () => {
      const forged = { assigned_user_id: 'user-pm', routing_basis: 'USER_RULE', authority_rule_id: 'sys-drawing', authority_rule_code: 'SYS-DRAWING', project_sensitivity: 'Normal' };
      const self = await approvalRequest('Project Manager', { assigned_approver_id: 'user-pm', assigned_approver_role: 'Project Manager', ...forged });
      expect(await route('approval', self)).toMatchObject({ routing_basis: 'SYSTEM_POLICY' });
      expect((await route('approval', self))!.assigned_user_id).not.toBe('user-pm');
      expect((await as['Project Manager'].post(`/api/approvals/${self}/decision`).send({ decision: 'Approved' })).status).toBe(403);
      // Assigned to someone who may not decide it: never routed to them.
      const site = await approvalRequest('Purchasing', { approval_type: 'Major Purchase', assigned_approver_id: 'user-site', assigned_approver_role: 'Site Supervisor' });
      expect((await route('approval', site))!.assigned_user_id).toBe('user-accountant');
      // The routing API takes no assignee and is not open to delegates; there is no route-writing API.
      expect((await as['Project Manager'].post('/api/approval-routing/route').send({ kind: 'approval', id: site, assigned_user_id: 'user-pm' })).status).toBe(403);
      expect((await as['Project Manager'].post('/api/approval-routing/reevaluate').send({})).status).toBe(403);
      await owner().post('/api/approval-routing/route').send({ kind: 'approval', id: site, assigned_user_id: 'user-pm', routing_basis: 'USER_RULE' }).expect(200);
      expect((await route('approval', site))!.assigned_user_id).toBe('user-accountant');
      expect([404, 405]).toContain((await as['Project Manager'].patch(`/api/approval-routing/routes/1`).send({ assigned_user_id: 'user-pm' })).status);
      // Re-assigning the approver is the requester's field, and still decides nothing.
      expect((await as['Project Manager'].patch(`/api/approvals/${site}`).send({ assigned_approver_id: 'user-pm' })).status).toBe(403);
    });

    it('a PM never receives another project\'s approval without a rule that covers it; contractors / clients never receive internal approvals', async () => {
      const global = await grant({ project_id: undefined, name: 'PM variations everywhere' });
      const x = await variation('proj-x', 1000);
      expect((await route('variation', x))!.assigned_user_id).toBe('user-owner');
      expect((await inbox('Project Manager')).items.map((i) => i.resource_id)).not.toContain(x);
      const internal = (await db.pool.query(`SELECT count(*)::int AS n FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE u.role IN ('Contractor', 'Client') AND ar.routing_basis <> 'CLIENT_CONSENT'`)).rows[0].n;
      expect(internal).toBe(0);
      await deactivate(global.id);
    });

    it('baseline permission alone creates no eligibility', async () => {
      const id = await variation(projA, 1000);
      // PM holds variations.review but no rule is active: Owner.
      expect((await route('variation', id))!.assigned_user_id).toBe('user-owner');
    });

    it('a decision cannot be created when no Owner exists to fall back on (no orphan)', async () => {
      await db.pool.query(`UPDATE users SET is_active = false WHERE id = 'user-owner'`);
      const id = next('apr-rt');
      const res = await as['Purchasing'].post('/api/approvals').send({ id, approval_number: id, approval_type: 'Project Date Change', title: 'x', description: 'x', project_id: projA, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' });
      await db.pool.query(`UPDATE users SET is_active = true WHERE id = 'user-owner'`);
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/No active Owner/);
      expect((await db.pool.query('SELECT 1 FROM approvals WHERE id = $1', [id])).rowCount).toBe(0);
    });

    it('routing APIs need a session', async () => {
      expect((await request(app).get('/api/approval-routing/inbox')).status).toBe(401);
      expect((await request(app).get('/api/authority/overview')).status).toBe(401);
    });
  });

  describe('Owner Authority Settings (server side)', () => {
    it('dashboard for the Owner and Admin only', async () => {
      const o = (await owner().get('/api/authority/overview').expect(200)).body;
      expect(o.counts).toMatchObject({ system_policies: 24, pending_approvals: expect.any(Number) });
      expect(o.counts.pending_to_owner + o.counts.pending_delegated).toBe(o.counts.pending_approvals);
      expect(o.owner_only_types.map((t: Row) => t.key)).toEqual(expect.arrayContaining(['drawing', 'variation']));
      await as['Admin'].get('/api/authority/overview').expect(200);
      for (const role of ['Project Manager', 'Accountant', 'Contractor', 'Client']) expect((await as[role].get('/api/authority/overview')).status, role).toBe(403);
    });

    it('preview: server-written summary, warnings, impact; never saves; refuses what saving would refuse', async () => {
      const before = (await db.pool.query(`SELECT count(*)::int AS n FROM delegated_authorities`)).rows[0].n;
      await setSensitivity(projB, 'Sensitive');
      const p = (await owner().post('/api/authority/rules/preview').send({ name: 'PM drawings everywhere', description: 'Routine drawings', effect: 'allow', decision_type: 'drawing', target_role: 'Project Manager', priority: 200, end_at: new Date(Date.now() + 5 * 86400_000).toISOString() }).expect(200)).body;
      expect(p.summary).toMatch(/^Project Manager may approve drawing approval/);
      const codes = p.warnings.map((w: Row) => w.code);
      expect(codes).toEqual(expect.arrayContaining(['OVERRIDDEN_BY_SENSITIVITY', 'BROADENS_SYSTEM_POLICY', 'EXPIRES_SOON']));
      expect(p.impact.users.map((u: Row) => u.id)).toEqual(expect.arrayContaining(['user-pm', 'user-pm2']));
      expect(p.immediately_usable).toBe(true);
      const big = (await owner().post('/api/authority/rules/preview').send({ name: 'Purchasing to 50k', description: 'x', effect: 'allow', decision_type: 'purchase', target_role: 'Purchasing', max_value: 50000, priority: 50 }).expect(200)).body;
      expect(big.warnings.map((w: Row) => w.code)).toContain('MAY_NEVER_APPLY');
      const refused = await owner().post('/api/authority/rules/preview').send({ name: 'PM on B', description: 'x', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: projB });
      expect(refused.status).toBe(400);
      expect(refused.body.message).toMatch(/is Sensitive/);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM delegated_authorities`)).rows[0].n).toBe(before);
      await setSensitivity(projB, 'Normal');
    });

    it('rule details carry who created / changed it', async () => {
      const r = await grant({ name: 'Detail check' });
      await owner().patch(`/api/authority/rules/${r.id}`).send({ max_value: 900, change_reason: 'Tighter' }).expect(200);
      const d = (await owner().get(`/api/authority/rules/${r.id}`).expect(200)).body;
      expect(d).toMatchObject({ created_by_name: expect.any(String), updated_by_name: expect.any(String), source: expect.stringMatching(/^Granted by /) });
      await deactivate(r.id);
      expect((await owner().get(`/api/authority/rules/${r.id}`).expect(200)).body).toMatchObject({ deactivated_by_name: expect.any(String), deactivation_reason: 'test' });
    });
  });

  it('after everything: no pending decision without a route, and no route to an inactive user', async () => {
    await noOrphans();
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.status = 'open' AND NOT u.is_active`)).rows[0].n).toBe(0);
  });
});
