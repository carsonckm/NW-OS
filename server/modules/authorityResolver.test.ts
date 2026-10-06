import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { AccessContext } from '../auth/access';
import type { Pool } from '../db/pool';
import { AI_PROPOSAL_TYPE } from './assistantActions';
import { AI_PROPOSAL_APPROVAL_TYPE, REASON_CODES, decisionTypeForApprovalType, resolveApprovalAuthority, type AuthorityResolution, type ResolveInput } from './authorityResolver';
import { MAJOR_PURCHASE_THRESHOLD } from './hooks/purchasing';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 2: authority resolution engine', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let app: Parameters<typeof request>[0];
  /** Two Normal projects the PM works on, with their clients. */
  let projA = '';
  let projB = '';
  let clientA = '';
  let clientB = '';
  const seen = new Set<string>();
  beforeAll(async () => {
    ({ db, as, app } = (await setupDemoWorld()) as never);
    const pm = await ctxOf('user-pm');
    const projects = (await db.pool.query(`SELECT id, client_id FROM projects WHERE id <> 'proj-x' ORDER BY id`)).rows.filter((p) => pm.canSeeProject(p.id));
    [projA, projB] = [projects[0].id, projects[1].id];
    [clientA, clientB] = [projects[0].client_id, projects[1].client_id];
    expect(projA).toBe('proj-1');
  });
  afterAll(async () => {
    await db?.close();
  });
  // Every test starts with no Owner rule (test database only).
  afterEach(async () => {
    await db.pool.query(`DELETE FROM delegated_authorities WHERE kind = 'owner'`);
  });

  const owner = () => as['Owner / CEO'];
  const future = new Date(Date.now() + 90 * 86400_000).toISOString();
  async function ctxOf(userId: string) {
    const u = (await db.pool.query('SELECT * FROM users WHERE id = $1', [userId])).rows[0];
    return AccessContext.load(db.pool, u);
  }
  const resolve = async (userId: string, input: ResolveInput, pool: Pool = db.pool) => resolveApprovalAuthority(pool, await ctxOf(userId), input);
  const grant = async (over: Row = {}) =>
    (
      await owner()
        .post('/api/authority/rules')
        .send({ name: 'PM variations', description: 'Test delegation', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: projA, end_at: future, priority: 200, ...over })
        .expect(201)
    ).body as Row;
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  /** A variation raised by the Owner, waiting for internal approval. */
  const variation = async (projectId: string, amount: number) => {
    const id = next('vo-r');
    await owner().post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: 'Extra shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    return id;
  };
  const vo = (id: string): ResolveInput => ({ resource: { kind: 'variation', id } });
  /** A client revision of dwg-1 (project A) under internal review. */
  const revision = async () => {
    const id = next('rev-r');
    await owner().post('/api/drawings/dwg-1/revisions').send({ id, revision: id, title: 'x', file_url: `/${id}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
    await owner().post(`/api/drawings/dwg-1/revisions/${id}/status`).send({ status: 'Internal Review' }).expect(200);
    return id;
  };
  const approveRevision = (role: string, rev: string, extra: Row = {}) => as[role].post(`/api/drawings/dwg-1/revisions/${rev}/status`).send({ status: 'Approved', ...extra });
  /** An approval request raised by `requester`, assigned as given. */
  const approvalRequest = async (requester: string, over: Row = {}) => {
    const id = next('apr-r');
    await as[requester]
      .post('/api/approvals')
      .send({ id, approval_number: id.toUpperCase(), approval_type: 'Major Purchase', title: 'Request', description: 'x', project_id: projA, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '', ...over })
      .expect(201);
    return id;
  };
  const decide = (role: string, id: string, decision = 'Approved', extra: Row = {}) => as[role].post(`/api/approvals/${id}/decision`).send({ decision, ...extra });
  const purchaseOrder = async (projectId: string, total: number) => {
    const id = next('po-r');
    await as['Purchasing']
      .post('/api/purchase-orders')
      .send({ id, po_number: id.toUpperCase(), project_id: projectId, project_name: 'P', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: total, total_price: 1 }], total_amount: 1, requested_by: 'Faridah', expected_delivery_date: '2026-10-20', created_at: '', status: 'Pending Approval' })
      .expect(201);
    return id;
  };
  const setSensitivity = (projectId: string, sensitivity: string, reason = 'test') => owner().put(`/api/projects/${projectId}/sensitivity`).send({ sensitivity, reason }).expect(200);
  const codesSeen = (r: AuthorityResolution) => {
    seen.add(r.reasonCode);
    return r;
  };

  describe('the resolver result', () => {
    it('is structured, never just true/false, and explains a blocked approval for the Owner Center', async () => {
      const id = await variation(projA, 5000);
      const r = codesSeen(await resolve('user-pm', vo(id)));
      expect(r).toMatchObject({
        allowed: false,
        reasonCode: 'NO_MATCHING_AUTHORITY',
        decisionType: 'variation',
        userId: 'user-pm',
        userRole: 'Project Manager',
        resourceType: 'variation',
        resourceId: id,
        projectId: projA,
        clientId: clientA,
        projectSensitivity: 'Normal',
        baselinePermission: 'variations.review',
        requiresOwner: false,
        matchedRuleId: null,
      });
      expect(r.reason).toMatch(/variations.review alone approves nothing/);
      // Every rule considered, and why it did not help.
      expect(r.rules.find((x) => x.rule_code === 'SYS-VARIATION')).toMatchObject({ applies: false, reason_code: 'NOT_APPLICABLE' });
      for (const key of ['evaluatedConditions', 'evaluatedScope', 'evaluatedValue', 'evaluatedRisk', 'evaluatedDates', 'resolvedAt']) expect(r).toHaveProperty(key);
    });

    it('lets the Owner decide without any rule', async () => {
      await db.pool.query(`UPDATE delegated_authorities SET active = false WHERE id = 'sys-variation'`);
      const id = await variation(projB, 5000);
      const r = codesSeen(await resolve('user-owner', vo(id)));
      expect(r).toMatchObject({ allowed: true, reasonCode: 'ALLOWED', basis: 'owner', matchedRuleId: null });
      await db.pool.query(`UPDATE delegated_authorities SET active = true WHERE id = 'sys-variation'`);
    });

    it('keeps its decision types and reason codes stable', () => {
      expect(REASON_CODES).toEqual(['ALLOWED', 'OWNER_REQUIRED', 'SENSITIVITY_BLOCKED', 'NO_MATCHING_AUTHORITY', 'INSUFFICIENT_PERMISSION', 'OUT_OF_SCOPE', 'VALUE_LIMIT_EXCEEDED', 'RISK_LIMIT_EXCEEDED', 'AUTHORITY_NOT_YET_ACTIVE', 'AUTHORITY_EXPIRED', 'AUTHORITY_DEACTIVATED', 'CONDITION_NOT_MET', 'SELF_APPROVAL_BLOCKED', 'INVALID_AUTHORITY_CONTEXT']);
      expect(AI_PROPOSAL_APPROVAL_TYPE).toBe(AI_PROPOSAL_TYPE);
      expect(['Major Purchase', 'Major Cost', AI_PROPOSAL_TYPE, 'Technical Change', 'Variation', 'Safety-Critical Decision', 'Anything new'].map(decisionTypeForApprovalType)).toEqual(['purchase', 'purchase', 'ai_proposal', 'approval_request', 'approval_request', 'approval_request', 'approval_request']);
    });
  });

  describe('sensitivity is the first gate', () => {
    it('Normal: a valid delegated rule allows', async () => {
      const rule = await grant({ max_value: 10000 });
      const r = codesSeen(await resolve('user-pm', vo(await variation(projA, 5000))));
      expect(r).toMatchObject({ allowed: true, reasonCode: 'ALLOWED', basis: 'rule', matchedRuleId: rule.id, matchedRuleCode: rule.code, evaluatedValue: { value: 5000, max: 10000, passed: true } });
    });

    it('Sensitive and Strategic: the same delegated rule gives way to the Owner', async () => {
      await grant({ project_id: undefined, max_value: 10000, name: 'PM variations everywhere' });
      const id = await variation(projB, 5000);
      expect((await resolve('user-pm', vo(id))).allowed).toBe(true);
      for (const level of ['Sensitive', 'Strategic']) {
        await setSensitivity(projB, level);
        const r = codesSeen(await resolve('user-pm', vo(id)));
        expect(r, level).toMatchObject({ allowed: false, reasonCode: 'SENSITIVITY_BLOCKED', requiresOwner: true, projectSensitivity: level });
        expect((await resolve('user-owner', vo(id))).allowed).toBe(true);
      }
      await setSensitivity(projB, 'Normal');
      expect((await resolve('user-pm', vo(id))).allowed).toBe(true);
    });

    it('fails closed on an unknown sensitivity, an unknown decision type or a record it cannot find', async () => {
      await grant({ project_id: undefined, max_value: 10000 });
      const id = await variation(projA, 5000);
      const lying = { query: (sql: string, args?: unknown[]) => (/SELECT sensitivity FROM projects/.test(sql) ? Promise.resolve({ rows: [{ sensitivity: 'Secret' }], rowCount: 1 }) : db.pool.query(sql, args as never)) } as unknown as Pool;
      expect(codesSeen(await resolve('user-pm', vo(id), lying))).toMatchObject({ allowed: false, reasonCode: 'INVALID_AUTHORITY_CONTEXT', requiresOwner: true });
      const req = await approvalRequest('Purchasing', { approval_type: 'Safety-Critical Decision', assigned_approver_role: 'Project Manager' });
      expect((await resolve('user-pm', { resource: { kind: 'approval', id: req } })).allowed).toBe(true);
      await db.pool.query(`UPDATE authority_decision_types SET active = false WHERE key = 'approval_request'`);
      expect(await resolve('user-pm', { resource: { kind: 'approval', id: req } })).toMatchObject({ allowed: false, reasonCode: 'INVALID_AUTHORITY_CONTEXT', requiresOwner: true });
      await db.pool.query(`UPDATE authority_decision_types SET active = true WHERE key = 'approval_request'`);
      expect(await resolve('user-pm', vo('vo-nope'))).toMatchObject({ allowed: false, reasonCode: 'INVALID_AUTHORITY_CONTEXT', requiresOwner: true });
    });
  });

  describe('baseline permission is necessary, never sufficient', () => {
    it('baseline without a rule: denied', async () => {
      expect(codesSeen(await resolve('user-pm', vo(await variation(projA, 100))))).toMatchObject({ allowed: false, reasonCode: 'NO_MATCHING_AUTHORITY' });
    });

    it('a rule without the baseline: denied', async () => {
      // A rule the API would refuse (Admin lacks drawings.review), as if the role had lost it.
      await db.pool.query(`INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, target_role, granted_by) VALUES ('da-nobase', 'DA-NOBASE', 'Admin drawings', 'x', 'owner', 'allow', 'drawing', 'Admin', 'user-owner')`);
      const r = codesSeen(await resolve('user-admin', { resource: { kind: 'drawing_revision', id: await revision() } }));
      expect(r).toMatchObject({ allowed: false, reasonCode: 'INSUFFICIENT_PERMISSION', baselinePermission: 'drawings.review' });
      await db.pool.query(`DELETE FROM delegated_authorities WHERE id = 'da-nobase'`);
    });

    it('both: allowed (subject to everything else)', async () => {
      await grant({ decision_type: 'drawing' });
      expect((await resolve('user-pm', { resource: { kind: 'drawing_revision', id: await revision() } })).allowed).toBe(true);
    });

    it('a permission-targeted System Policy row covers holders of that permission', async () => {
      const pm = await ctxOf('user-pm');
      const approver = Object.assign(Object.create(Object.getPrototypeOf(pm)), pm, { can: (p: string) => p === 'drawings.review' || p === 'drawings.approve' }) as AccessContext;
      const r = await resolveApprovalAuthority(db.pool, approver, { resource: { kind: 'drawing_revision', id: await revision() } });
      expect(r).toMatchObject({ allowed: true, matchedRuleCode: 'SYS-DRAWING' });
    });
  });

  describe('scope and conditions', () => {
    it('project and client scope', async () => {
      await grant({ project_id: projB });
      const r = codesSeen(await resolve('user-pm', vo(await variation(projA, 100))));
      expect(r).toMatchObject({ allowed: false, reasonCode: 'OUT_OF_SCOPE', evaluatedScope: { project: { required: projB, actual: projA, passed: false } } });
      await grant({ project_id: undefined, client_id: clientB, name: 'PM for client B' });
      if (clientA !== clientB) expect((await resolve('user-pm', vo(await variation(projA, 100)))).reasonCode).toBe('OUT_OF_SCOPE');
      expect((await resolve('user-pm', vo(await variation(projB, 100)))).allowed).toBe(true);
      // A global rule applies where the sensitivity allows it.
      await grant({ project_id: undefined, name: 'PM everywhere' });
      expect((await resolve('user-pm', vo(await variation(projA, 100)))).allowed).toBe(true);
    });

    it('value range', async () => {
      await grant({ min_value: 1000, max_value: 5000 });
      expect((await resolve('user-pm', vo(await variation(projA, 3000)))).allowed).toBe(true);
      const over = codesSeen(await resolve('user-pm', vo(await variation(projA, 9000))));
      expect(over).toMatchObject({ reasonCode: 'VALUE_LIMIT_EXCEEDED', evaluatedValue: { value: 9000, min: 1000, max: 5000, passed: false } });
      expect((await resolve('user-pm', vo(await variation(projA, 500)))).reasonCode).toBe('VALUE_LIMIT_EXCEEDED');
    });

    it('project risk', async () => {
      await grant({ max_risk: 'Attention' });
      const id = await variation(projA, 100);
      expect((await resolve('user-pm', vo(id))).evaluatedRisk).not.toBeNull();
      // Three overdue urgent tasks make the project at least At Risk.
      for (const t of ['t-risk-1', 't-risk-2', 't-risk-3']) {
        await db.pool.query(`INSERT INTO tasks (id, project_id, status, priority, due_date, data) VALUES ($1, $2, 'Open', 'Urgent', '2020-01-01', '{"title": "Overdue"}')`, [t, projA]);
      }
      const r = codesSeen(await resolve('user-pm', vo(id)));
      expect(r).toMatchObject({ allowed: false, reasonCode: 'RISK_LIMIT_EXCEEDED', evaluatedRisk: { max: 'Attention', passed: false } });
      expect(['At Risk', 'Critical']).toContain(r.evaluatedRisk!.actual);
      await db.pool.query(`DELETE FROM tasks WHERE id LIKE 't-risk-%'`);
    });

    it('start and end dates, and deactivation', async () => {
      const id = await variation(projA, 100);
      const later = await grant({ start_at: new Date(Date.now() + 86400_000).toISOString() });
      expect(codesSeen(await resolve('user-pm', vo(id)))).toMatchObject({ reasonCode: 'AUTHORITY_NOT_YET_ACTIVE', matchedRuleCode: later.code, evaluatedDates: { passed: false } });
      await db.pool.query(`UPDATE delegated_authorities SET start_at = now() - interval '10 days', end_at = now() - interval '1 day' WHERE id = $1`, [later.id]);
      expect(codesSeen(await resolve('user-pm', vo(id)))).toMatchObject({ reasonCode: 'AUTHORITY_EXPIRED', matchedRuleCode: later.code });
      await db.pool.query('DELETE FROM delegated_authorities WHERE id = $1', [later.id]);
      const off = await grant({ name: 'Paused' });
      await owner().post(`/api/authority/rules/${off.id}/deactivate`).send({ reason: 'PM on leave' }).expect(200);
      expect(codesSeen(await resolve('user-pm', vo(id)))).toMatchObject({ reasonCode: 'AUTHORITY_DEACTIVATED', matchedRuleCode: off.code });
      expect((await resolve('user-pm', vo(id))).reason).toMatch(/PM on leave/);
    });

    it('priority: an Owner rule outranks a lower requirement; ties go to the Owner', async () => {
      const id = await variation(projA, 60000);
      const allow = await grant({ priority: 200 });
      const need = (await owner().post('/api/authority/rules').send({ name: 'Big variations', description: 'Mine', effect: 'require_owner', decision_type: 'variation', min_value: 50000, priority: 300 }).expect(201)).body;
      expect(codesSeen(await resolve('user-pm', vo(id)))).toMatchObject({ allowed: false, reasonCode: 'OWNER_REQUIRED', requiresOwner: true, matchedRuleCode: need.code });
      await owner().patch(`/api/authority/rules/${allow.id}`).send({ priority: 400, change_reason: 'PM trusted with big variations' }).expect(200);
      expect(await resolve('user-pm', vo(id))).toMatchObject({ allowed: true, matchedRuleCode: allow.code });
      await owner().patch(`/api/authority/rules/${allow.id}`).send({ priority: 300, change_reason: 'tie' }).expect(200);
      expect((await resolve('user-pm', vo(id))).reasonCode).toBe('OWNER_REQUIRED');
    });

    it('user-specific and role-specific rules', async () => {
      await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-pm2', 'Second PM', 'pm2@test.local', 'x', 'Project Manager', true) ON CONFLICT DO NOTHING`);
      await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-pm2') ON CONFLICT DO NOTHING`, [projA]);
      const id = await variation(projA, 100);
      await grant({ target_role: undefined, target_user_id: 'user-pm' });
      expect((await resolve('user-pm', vo(id))).allowed).toBe(true);
      expect((await resolve('user-pm2', vo(id))).reasonCode).toBe('NO_MATCHING_AUTHORITY');
      await grant({ name: 'All PMs' });
      expect((await resolve('user-pm2', vo(id))).allowed).toBe(true);
    });
  });

  describe('existing behaviour on Normal projects, now through the resolver', () => {
    it('drawings: Owner-only by default (drawings.approve)', async () => {
      const rev = await revision();
      for (const role of ['Project Manager', 'Production Manager', 'Admin', 'Accountant']) expect((await approveRevision(role, rev)).status, role).toBe(403);
      expect((await approveRevision('Project Manager', rev)).body.reason_code).toBe('NO_MATCHING_AUTHORITY');
      await approveRevision('Owner / CEO', rev).expect(200);
    });

    it('variations: Owner-only internal approval, never by the person who raised it', async () => {
      const id = await variation(projA, 100);
      expect((await as['Project Manager'].post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' })).status).toBe(403);
      // The Owner raised it, so even the Owner may not internally approve it (unchanged).
      const self = await owner().post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' });
      expect(self.status).toBe(403);
      expect(self.body.message).toMatch(/you raised/);
    });

    it('purchases: RM 20,000 policy, Major Purchase approval by the Accountant, then Purchasing issues', async () => {
      const small = await purchaseOrder(projA, 5000);
      const r = codesSeen(await resolve('user-purchasing', { resource: { kind: 'purchase_order', id: small } }));
      expect(r).toMatchObject({ allowed: true, matchedRuleCode: 'SYS-PURCHASE-STANDARD' });
      await as['Purchasing'].patch(`/api/purchase-orders/${small}`).send({ status: 'Issued' }).expect(200);
      const big = await purchaseOrder(projA, MAJOR_PURCHASE_THRESHOLD);
      const refused = await as['Purchasing'].patch(`/api/purchase-orders/${big}`).send({ status: 'Issued' });
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ reason_code: 'OWNER_REQUIRED', requires_owner: true });
      expect(refused.body.message).toMatch(/Major Purchase approval/);
      codesSeen(await resolve('user-purchasing', { resource: { kind: 'purchase_order', id: big } }));
      const req = await approvalRequest('Purchasing', { related_entity_type: 'purchase', related_entity_id: big });
      for (const role of ['Project Manager', 'Production Manager', 'Purchasing']) expect((await decide(role, req)).status, role).toBe(403);
      await decide('Accountant', req).expect(200);
      const audit = (await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'approval.approve' AND entity_id = $1`, [req])).rows[0].after;
      expect(audit.authority).toMatchObject({ decision_type: 'purchase', matched_rule_code: 'SYS-PURCHASE-ACCOUNTANT', reason_code: 'ALLOWED', sensitivity: 'Normal', actor_id: 'user-accountant' });
      expect(await resolve('user-purchasing', { resource: { kind: 'purchase_order', id: big } })).toMatchObject({ allowed: true, matchedRuleCode: 'SYS-PURCHASE-APPROVED' });
      await as['Purchasing'].patch(`/api/purchase-orders/${big}`).send({ status: 'Issued' }).expect(200);
      const issued = (await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'purchase_order.issued' AND entity_id = $1`, [big])).rows[0].after;
      expect(issued.authority).toMatchObject({ matched_rule_code: 'SYS-PURCHASE-APPROVED', decision_type: 'purchase' });
    });

    it('the Owner may explicitly override System Policy with a higher-priority rule', async () => {
      const po = await purchaseOrder(projA, 30000);
      await grant({ decision_type: 'purchase', target_role: 'Purchasing', max_value: 50000, priority: 200, name: 'Purchasing issues up to RM 50k on A' });
      await as['Purchasing'].patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' }).expect(200);
    });

    it('invoices: matched by finance, mismatched by the Owner only, never by the recorder', async () => {
      const invoice = async (role: string) => {
        const id = next('inv-r');
        await as[role].post('/api/invoices').send({ id, invoice_number: id.toUpperCase(), invoice_type: 'Client Billing Invoice', party_name: 'Client', project_id: projA, project_name: 'P', amount_before_tax: 1000, tax_amount: 0, total_amount: 1, invoice_date: '2026-10-22', due_date: '2026-11-21', status: 'Pending Approval', paid_amount: 0 }).expect(201);
        return id;
      };
      const mine = await invoice('Accountant');
      const self = await as['Accountant'].patch(`/api/invoices/${mine}`).send({ status: 'Approved' });
      expect(self.status).toBe(403);
      expect(self.body).toMatchObject({ reason_code: 'SELF_APPROVAL_BLOCKED' });
      expect(self.body.message).toMatch(/you recorded/);
      codesSeen(await resolve('user-accountant', { resource: { kind: 'invoice', id: mine } }));
      const theirs = await invoice('Owner / CEO');
      expect((await as['Purchasing'].patch(`/api/invoices/${theirs}`).send({ status: 'Approved' })).status).toBe(403);
      await as['Accountant'].patch(`/api/invoices/${theirs}`).send({ status: 'Approved' }).expect(200);
      const stored = (await db.pool.query('SELECT data FROM commercial_invoices WHERE id = $1', [theirs])).rows[0].data;
      expect(stored.approval_authority).toMatchObject({ decision_type: 'invoice', matched_rule_code: 'SYS-INVOICE', actor_id: 'user-accountant' });
      // A supplier invoice that does not match: the Owner only.
      const mismatched = await resolve('user-accountant', { resource: { kind: 'invoice', id: theirs }, pending: { matchStatus: 'Exceeds PO' } });
      expect(mismatched).toMatchObject({ allowed: false, reasonCode: 'OWNER_REQUIRED', matchedRuleCode: 'SYS-INVOICE-MISMATCH' });
      expect((await resolve('user-owner', { resource: { kind: 'invoice', id: theirs }, pending: { matchStatus: 'Exceeds PO' } })).allowed).toBe(true);
    });

    it('approval requests: the assigned approver decides, never the requester; DAM needs approvals.decide', async () => {
      const toPm = await approvalRequest('Purchasing', { approval_type: 'Safety-Critical Decision', assigned_approver_role: 'Project Manager' });
      expect((await decide('Production Manager', toPm)).status).toBe(403);
      await decide('Project Manager', toPm, 'Changes Requested').expect(200);
      const tech = await approvalRequest('Project Manager', { approval_type: 'Technical Change', assigned_approver_role: 'Owner / CEO' });
      const pmgr = await decide('Production Manager', tech);
      expect(pmgr.status).toBe(403);
      expect(pmgr.body.reason_code).toBe('CONDITION_NOT_MET');
      codesSeen(await resolve('user-prod-mgr', { resource: { kind: 'approval', id: tech } }));
      const dam = await approvalRequest('Project Manager', { approval_type: 'Technical Change', assigned_approver_role: 'Designated Authorized Manager' });
      expect((await decide('Production Manager', dam)).status).toBe(403);
      await decide('Accountant', dam).expect(200);
      const own = await approvalRequest('Accountant', { approval_type: 'Major Cost' });
      const selfDecision = await decide('Accountant', own);
      expect(selfDecision.status).toBe(403);
      expect(selfDecision.body.reason_code).toBe('SELF_APPROVAL_BLOCKED');
      await decide('Owner / CEO', own).expect(200);
    });

    it('AI proposals: decided by the person they were put to, or the Owner', async () => {
      const p = await as['Site Supervisor'].post('/api/assistant/proposals').send({ action: 'create_task', params: { project_id: projA, title: 'Order more hinges', assigned_user_id: 'user-purchasing' } }).expect(201);
      expect(await resolve('user-pm', { resource: { kind: 'approval', id: p.body.id } })).toMatchObject({ allowed: false, decisionType: 'ai_proposal' });
      expect(await resolve('user-site', { resource: { kind: 'approval', id: p.body.id } })).toMatchObject({ allowed: true, matchedRuleCode: 'SYS-AI-PROPOSAL' });
      expect((await decide('Project Manager', p.body.id)).status).toBe(403);
    });

    it('client consent on client-facing requests is kept, on the client\'s own project only', async () => {
      const mine = await approvalRequest('Project Manager', { approval_type: 'Variation', assigned_approver_role: 'Client' });
      await decide('Client', mine).expect(200);
      const audit = (await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'approval.approve' AND entity_id = $1`, [mine])).rows[0].after;
      expect(audit.consent).toBe('client');
    });
  });

  describe('security: the browser decides nothing', () => {
    it('forged role, user, project, client, authority id, sensitivity and permission are ignored', async () => {
      await setSensitivity(projB, 'Sensitive');
      const req = await approvalRequest('Purchasing', { project_id: projB, approval_type: 'Safety-Critical Decision', assigned_approver_role: 'Owner / CEO' });
      const forged = { role: 'Owner / CEO', user_id: 'user-owner', decision_by_id: 'user-owner', decision_by_role: 'Owner / CEO', authority_id: 'sys-drawing', matched_rule_id: 'sys-drawing', project_id: projA, client_id: clientA, sensitivity: 'Normal', permissions: ['approvals.decide'], assigned_approver_role: 'Project Manager' };
      const res = await decide('Project Manager', req, 'Approved', forged);
      expect(res.status).toBe(403);
      expect(res.body.reason_code).toBe('SENSITIVITY_BLOCKED');
      const hdr = await as['Project Manager'].post(`/api/approvals/${req}/decision`).set('x-user-role', 'Owner / CEO').set('x-user-id', 'user-owner').send({ decision: 'Approved' });
      expect(hdr.status).toBe(403);
      // Re-assigning the request to yourself is the requester's field.
      expect((await as['Project Manager'].patch(`/api/approvals/${req}`).send({ assigned_approver_role: 'Project Manager' })).status).toBe(403);
      expect((await db.pool.query('SELECT decision, data FROM approvals WHERE id = $1', [req])).rows[0]).toMatchObject({ decision: 'Pending', data: { assigned_approver_role: 'Owner / CEO' } });
      // A drawing revision approved with forged fields: still refused, still under review.
      const rev = await revision();
      const r2 = await approveRevision('Project Manager', rev, forged);
      expect(r2.status).toBe(403);
      expect((await db.pool.query('SELECT approval_status FROM drawing_revisions WHERE id = $1', [rev])).rows[0].approval_status).toBe('Internal Review');
      await setSensitivity(projB, 'Normal');
    });

    it('a record moved onto a protected project is checked against that project too', async () => {
      await setSensitivity(projB, 'Strategic');
      const po = await purchaseOrder(projA, 500);
      const r = await resolve('user-purchasing', { resource: { kind: 'purchase_order', id: po }, pending: { projectId: projB } });
      expect(r).toMatchObject({ allowed: false, reasonCode: 'SENSITIVITY_BLOCKED', projectId: projB });
      expect((await as['Purchasing'].patch(`/api/purchase-orders/${po}`).send({ status: 'Issued', project_id: projB })).status).toBe(403);
      await setSensitivity(projB, 'Normal');
    });

    it('contractors and clients cannot decide approvals on other projects or clients', async () => {
      const x = await approvalRequest('Owner / CEO', { project_id: 'proj-x', approval_type: 'Variation', assigned_approver_role: 'Client' });
      expect((await decide('Client', x)).status).toBe(403);
      expect((await decide('Contractor', x)).status).toBe(403);
      const ctx = await ctxOf('user-contractor');
      const r = codesSeen(await resolveApprovalAuthority(db.pool, ctx, { resource: { kind: 'approval', id: x } }));
      expect(r).toMatchObject({ allowed: false, reasonCode: 'OUT_OF_SCOPE' });
      expect((await db.pool.query('SELECT decision FROM approvals WHERE id = $1', [x])).rows[0].decision).toBe('Pending');
      // Clients and contractors hold no internal approval authority even when assigned.
      const assigned = await approvalRequest('Project Manager', { approval_type: 'Safety-Critical Decision', assigned_approver_role: 'Client' });
      const c = await decide('Client', assigned);
      expect(c.status).toBe(403);
      expect(c.body.reason_code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('direct API access without a session, or with a deactivated account, is refused', async () => {
      const req = await approvalRequest('Purchasing', { approval_type: 'Safety-Critical Decision', assigned_approver_role: 'Project Manager' });
      expect((await request(app).post(`/api/approvals/${req}/decision`).send({ decision: 'Approved' })).status).toBe(401);
      await db.pool.query(`UPDATE users SET is_active = false WHERE id = 'user-pm'`);
      expect((await decide('Project Manager', req)).status).toBe(401);
      const stale = await ctxOf('user-pm');
      expect(codesSeen(await resolveApprovalAuthority(db.pool, stale, { resource: { kind: 'approval', id: req } }))).toMatchObject({ allowed: false, reasonCode: 'INVALID_AUTHORITY_CONTEXT' });
      await db.pool.query(`UPDATE users SET is_active = true WHERE id = 'user-pm'`);
    });
  });

  describe('acceptance: one PM, one rule, three sensitivity levels', () => {
    it('Normal allows, Sensitive and Strategic need the Owner, back to Normal allows again; every step audited', async () => {
      await setSensitivity(projA, 'Normal');
      const rule = await grant({ decision_type: 'drawing', name: 'PM approves Aurora drawings' });

      const r1 = await revision();
      await approveRevision('Project Manager', r1).expect(200);
      const a1 = (await db.pool.query(`SELECT actor_id, after FROM audit_logs WHERE action = 'drawing.revision.approve' AND entity_id = $1`, [r1])).rows[0];
      expect(a1.actor_id).toBe('user-pm');
      expect(a1.after.authority).toMatchObject({ decision_type: 'drawing', project_id: projA, sensitivity: 'Normal', matched_rule_code: rule.code, reason_code: 'ALLOWED', basis: 'rule', result: 'allowed' });

      for (const level of ['Sensitive', 'Strategic']) {
        await setSensitivity(projA, level, `Raising to ${level}`);
        const rev = await revision();
        const res = await approveRevision('Project Manager', rev);
        expect(res.status, level).toBe(403);
        expect(res.body).toMatchObject({ reason_code: 'SENSITIVITY_BLOCKED', requires_owner: true });
        expect((await db.pool.query('SELECT approval_status FROM drawing_revisions WHERE id = $1', [rev])).rows[0].approval_status).toBe('Internal Review');
        await approveRevision('Owner / CEO', rev).expect(200);
      }

      // Lowering is the Owner's, with a reason; the PM is not allowed to.
      expect((await as['Project Manager'].put(`/api/projects/${projA}/sensitivity`).send({ sensitivity: 'Normal', reason: 'x' })).status).toBe(403);
      expect((await owner().put(`/api/projects/${projA}/sensitivity`).send({ sensitivity: 'Normal' })).status).toBe(400);
      await setSensitivity(projA, 'Normal', 'Board review finished');
      const r4 = await revision();
      await approveRevision('Project Manager', r4).expect(200);

      const changes = (await db.pool.query(`SELECT actor_id, before, after, details FROM audit_logs WHERE action = 'project.sensitivity.change' AND entity_id = $1 ORDER BY id`, [projA])).rows.slice(-3);
      expect(changes.map((c) => `${c.before.sensitivity}->${c.after.sensitivity}: ${c.details}`)).toEqual(['Normal->Sensitive: Raising to Sensitive', 'Sensitive->Strategic: Raising to Strategic', 'Strategic->Normal: Board review finished']);
      expect(changes.every((c) => c.actor_id === 'user-owner')).toBe(true);
      const approvals = (await db.pool.query(`SELECT actor_id, after FROM audit_logs WHERE action = 'drawing.revision.approve' AND entity_id = ANY($1) ORDER BY id`, [[r1, r4]])).rows;
      expect(approvals.map((a) => [a.actor_id, a.after.authority.matched_rule_code])).toEqual([['user-pm', rule.code], ['user-pm', rule.code]]);
    });
  });

  it('every reason code is produced by a test', () => {
    // Codes the tests above saw directly from the resolver (plus the HTTP checks).
    for (const code of ['ALLOWED', 'OWNER_REQUIRED', 'SENSITIVITY_BLOCKED', 'NO_MATCHING_AUTHORITY', 'INSUFFICIENT_PERMISSION', 'OUT_OF_SCOPE', 'VALUE_LIMIT_EXCEEDED', 'RISK_LIMIT_EXCEEDED', 'AUTHORITY_NOT_YET_ACTIVE', 'AUTHORITY_EXPIRED', 'AUTHORITY_DEACTIVATED', 'CONDITION_NOT_MET', 'SELF_APPROVAL_BLOCKED', 'INVALID_AUTHORITY_CONTEXT']) {
      expect(seen.has(code), code).toBe(true);
    }
  });
});
