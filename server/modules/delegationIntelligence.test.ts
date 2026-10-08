import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { seedUsers, signIn } from '../test/app';
import { withTransaction } from '../db/pool';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { reevaluateRoutes } from './approvalRouting';
import { generateDelegationRecommendations, niceCeil, ROLE_PREFERENCE, suggestLimit } from './delegationIntelligence';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 5: Owner dependency and delegation recommendations', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let raiser: request.Agent;
  let A = '';
  let S = '';
  let T = '';
  beforeAll(async () => {
    let app: Parameters<typeof request>[0];
    ({ db, as, app } = (await setupDemoWorld()) as never);
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    // A second PM raises the variations, so the Owner (and a delegated PM) may decide them.
    await seedUsers(db.pool, [{ id: 'user-raiser', role: 'Project Manager', email: 'raiser@test.local' }]);
    raiser = await signIn(app as never, 'raiser@test.local');
    await ensureRules(db.pool);
    A = await newProject('a');
    S = await newProject('s');
    T = await newProject('t');
  });
  afterAll(async () => {
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  async function newProject(tag: string) {
    const id = next(`proj-b5${tag}`);
    await owner().post('/api/projects').send({ id, project_number: id.toUpperCase(), project_name: `B5 ${tag.toUpperCase()}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-raiser') ON CONFLICT DO NOTHING`, [id]);
    return id;
  }
  const route = async (kind: string, id: string) => (await db.pool.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 ORDER BY id DESC LIMIT 1`, [kind, id])).rows[0] as Row;
  /** Simulated history: the decision is moved back `days` days (the only shortcut; the decision itself went through the API). */
  const backdate = (kind: string, id: string, days: number) =>
    db.pool.query(`UPDATE approval_routes SET requested_at = now() - make_interval(days => $3, hours => 3), completed_at = now() - make_interval(days => $3) WHERE resource_kind = $1 AND resource_id = $2 AND status = 'completed'`, [kind, id, days]);
  const ownerApprovesVariation = async (projectId: string, amount: number, daysAgo: number) => {
    const id = next('vo-b5');
    await raiser.post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: 'Extra shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    await owner().post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' }).expect(200);
    await backdate('variation', id, daysAgo);
    return id;
  };
  const ownerIssuesPo = async (projectId: string, amount: number, daysAgo: number) => {
    const id = next('po-b5');
    await as['Purchasing'].post('/api/purchase-orders').send({ id, po_number: id.toUpperCase(), project_id: projectId, project_name: 'P', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: amount, total_price: 1 }], total_amount: 1, requested_by: 'Purchasing', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }).expect(201);
    await owner().patch(`/api/purchase-orders/${id}`).send({ status: 'Issued' }).expect(200);
    await backdate('purchase_order', id, daysAgo);
    return id;
  };
  const ownerDecidesRequest = async (projectId: string, type: string, decision: string, daysAgo: number) => {
    const id = next('apr-b5');
    await as['Project Manager'].post('/api/approvals').send({ id, approval_number: id.toUpperCase(), approval_type: type, title: `${type} request`, description: 'x', project_id: projectId, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-01', decision: 'Pending', created_at: '', updated_at: '' }).expect(201);
    await owner().post(`/api/approvals/${id}/decision`).send({ decision }).expect(200);
    await backdate('approval', id, daysAgo);
    return id;
  };
  const list = async () => (await owner().get('/api/delegation/recommendations').expect(200)).body as { active: Row[]; snoozed: Row[]; history: Row[]; not_recommended: Row[] };
  const generate = async () => (await owner().post('/api/delegation/recommendations/generate').send({}).expect(200)).body as Row;
  const recFor = async (decisionType: string, approvalType: string | null = null) => (await list()).active.find((r) => r.decision_type === decisionType && (r.approval_type ?? null) === approvalType);
  const count = async (sql: string, params: unknown[] = []) => Number((await db.pool.query(sql, params)).rows[0].n);

  it('the value limit rule is conservative: 90th percentile, rounded up to a plain step, capped', () => {
    expect(suggestLimit([1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000], 50000)).toBe(8000);
    expect(suggestLimit([1200, 2600, 3100, 7800], 50000)).toBe(8000);
    expect(suggestLimit([90000, 95000, 99000], 50000)).toBe(50000);
    expect(niceCeil(9400)).toBe(9500);
    expect(niceCeil(21300)).toBe(22000);
  });

  describe('history', () => {
    it('builds Owner decision history through the normal APIs', async () => {
      // G1: 8 routine variations, RM 1k–8k, on a Normal project, on 8 different days.
      for (let i = 1; i <= 8; i++) await ownerApprovesVariation(A, i * 1000, i * 3);
      const v = await route('variation', `vo-b5-${n}`);
      expect(v).toMatchObject({ status: 'completed', completion_result: 'approved', completed_by: 'user-owner', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'NO_MATCHING_AUTHORITY' });
      // Variations decided on project S while it was Normal; S then becomes Sensitive.
      for (let i = 1; i <= 6; i++) await ownerApprovesVariation(S, 2000, i * 4);
      await owner().put(`/api/projects/${S}/sensitivity`).send({ sensitivity: 'Sensitive', reason: 'Board asked' }).expect(200);
      // Variations decided on Strategic project T (only the Owner may decide them there).
      await owner().put(`/api/projects/${T}/sensitivity`).send({ sensitivity: 'Strategic', reason: 'Board-level' }).expect(200);
      for (let i = 1; i <= 6; i++) await ownerApprovesVariation(T, 2000, i * 5);
      expect((await route('variation', `vo-b5-${n}`)).owner_reason_code).toBe('SENSITIVITY_BLOCKED');
      // G2: 6 major purchase orders (RM 21k–26k): the Owner issues them (System Policy requires the Owner from RM 20,000).
      for (let i = 1; i <= 6; i++) await ownerIssuesPo(A, 20000 + i * 1000, i * 6);
      expect(await route('purchase_order', `po-b5-${n}`)).toMatchObject({ completed_by: 'user-owner', owner_reason_code: 'OWNER_REQUIRED', completion_result: 'approved' });
      // G3: 5 project date changes, all approved. G4: only 2 drawing-approval requests. G5: client scope changes, half rejected.
      for (let i = 1; i <= 5; i++) await ownerDecidesRequest(A, 'Project Date Change', 'Approved', i * 7);
      for (let i = 1; i <= 2; i++) await ownerDecidesRequest(A, 'Drawing Approval', 'Approved', i * 2);
      for (let i = 1; i <= 6; i++) await ownerDecidesRequest(A, 'Client Scope Change', i % 2 ? 'Rejected' : 'Approved', i * 2);
      expect((await route('approval', `apr-b5-${n}`)).routing_basis).toBe('OWNER_FALLBACK');
    });
  });

  describe('acceptance tests', () => {
    let snapshot: Row;
    const state = async () =>
      (
        await db.pool.query(`SELECT
          (SELECT md5(string_agg(id || decision || data::text, ',' ORDER BY id)) FROM approvals) AS approvals,
          (SELECT md5(string_agg(id || status || data::text, ',' ORDER BY id)) FROM variations) AS variations,
          (SELECT md5(string_agg(id || status || data::text, ',' ORDER BY id)) FROM purchase_orders) AS pos,
          (SELECT md5(string_agg(id || sensitivity || coalesce(risk_status, '') || contract_value::text, ',' ORDER BY id)) FROM projects) AS projects,
          (SELECT md5(string_agg(id || active::text || coalesce(max_value::text, ''), ',' ORDER BY id)) FROM delegated_authorities) AS authority,
          (SELECT md5(string_agg(id::text || status || coalesce(completion_result, '') || coalesce(completed_at::text, ''), ',' ORDER BY id)) FROM approval_routes) AS routes,
          (SELECT count(*) FROM project_cost_ledger) AS costs`)
      ).rows[0];

    it('13 (first half). Generation changes no approval, project, cost, route or authority', async () => {
      snapshot = await state();
      await generate();
      expect(await state()).toEqual(snapshot);
    });

    it('1. Repeated Owner decisions: a recommendation is generated, with its evidence', async () => {
      const r = (await recFor('variation'))!;
      expect(r).toMatchObject({ target_role: 'Project Manager', project_id: A, suggested_max_risk: 'Attention', confidence: 'Medium', status: 'generated' });
      expect(r.evidence).toMatchObject({ decisions: 8, approved: 8, rejected: 0, escalated: 0, distinct_days: 8, max_value: 8000, typical_value: 4500, owner_approval_rate: 100, eligible_users: expect.any(Number) });
      expect(r.required_permission).toBe('variations.review');
      expect(r.recommendation).toMatch(/Consider delegating variations to Project Manager up to RM 8,000/);
      expect(r.reasons.join(' ')).toMatch(/8 similar decisions/);
      expect(r.confidence_explanation[0]).toMatch(/8 decisions \(8\+\) on 8 days/);
      expect(r.decisions).toHaveLength(8);
      // Opening the list marked it viewed.
      expect((await recFor('variation'))!.status).toBe('viewed');
    });

    it('2. Insufficient history: two decisions make no recommendation, and the screen says why', async () => {
      const l = await list();
      expect(l.active.find((r) => r.approval_type === 'Drawing Approval')).toBeUndefined();
      expect(l.not_recommended.find((x) => x.key === 'approval_request|Drawing Approval').reason).toMatch(/Not enough evidence: 2 comparable/);
    });

    it('3. Rejected history: repeated rejection suppresses the recommendation', async () => {
      const l = await list();
      expect(l.active.find((r) => r.approval_type === 'Client Scope Change')).toBeUndefined();
      expect(l.not_recommended.find((x) => x.key === 'approval_request|Client Scope Change').reason).toMatch(/Repeated rejection: 3 of 6/);
    });

    it('4. Sensitive project: its decisions are excluded and nothing is recommended for it', async () => {
      const l = await list();
      expect(l.active.some((r) => r.project_id === S)).toBe(false);
      const r = (await recFor('variation'))!;
      expect(r.excluded.sensitive_or_strategic).toBe(6);
      expect(r.evidence.decisions).toBe(8);
      // Even the Owner cannot widen it onto the Sensitive project: the authority validator refuses.
      const bad = await owner().post(`/api/delegation/recommendations/${r.id}/preview`).send({ modifications: { project_id: S } });
      expect(bad.status).toBe(400);
      expect(bad.body.message).toMatch(/Sensitive/);
    });

    it('5. Strategic project: no delegate recommendation for it', async () => {
      const l = await list();
      expect(l.active.some((r) => r.project_id === T)).toBe(false);
      expect([...l.active, ...l.history].some((r) => r.project_id === T)).toBe(false);
    });

    it('6. Value range: RM 1k–8k history never suggests more than the conservative rule', async () => {
      const r = (await recFor('variation'))!;
      expect(r.suggested_max_value).toBe(8000);
      expect(r.suggested_max_value).toBeLessThanOrEqual(r.evidence.max_value);
      const p = (await recFor('purchase'))!;
      expect(p.suggested_max_value).toBe(26000);
      expect(p.suggested_max_value).toBeLessThanOrEqual(50000);
    });

    it('7. Delegate eligibility: a role without the baseline permission is never recommended', async () => {
      const saved = [...ROLE_PREFERENCE.variation];
      try {
        // Site Supervisor does not hold variations.review: skipped, the PM is chosen.
        ROLE_PREFERENCE.variation = ['Site Supervisor', 'Project Manager'] as never;
        const res = await generate();
        expect(res.not_recommended.find((x: Row) => x.key === 'variation|*')).toBeUndefined();
        const r = (await recFor('variation'))!;
        expect(r.target_role).toBe('Project Manager');
        // Only roles without it: no recommendation at all.
        ROLE_PREFERENCE.variation = ['Site Supervisor'] as never;
        const none = await generate();
        expect(none.not_recommended.find((x: Row) => x.key === 'variation|*').reason).toMatch(/No eligible delegate \(Site Supervisor does not hold variations.review\)/);
        expect((await list()).active.find((x) => x.decision_type === 'variation')).toBeUndefined();
      } finally {
        ROLE_PREFERENCE.variation = saved as never;
      }
      await generate();
      expect((await recFor('variation'))!.target_role).toBe('Project Manager');
    });

    it('12. Duplicate generation: running it again keeps one active recommendation per opportunity', async () => {
      const before = (await list()).active.map((r) => r.id).sort();
      await generate();
      await generate();
      const after = (await list()).active.map((r) => r.id).sort();
      expect(after).toEqual(before);
      expect(await count(`SELECT count(*) AS n FROM (SELECT opportunity_key FROM delegation_recommendations WHERE status IN ('generated', 'viewed', 'snoozed') GROUP BY 1 HAVING count(*) > 1) x`)).toBe(0);
    });

    it('8. Accept: authority preview, Owner confirms, the rule is created through the authority API, audited', async () => {
      const p = (await recFor('purchase'))!;
      expect(p.target_role).toBe('Purchasing');
      const prev = (await owner().post(`/api/delegation/recommendations/${p.id}/preview`).send({}).expect(200)).body;
      expect(prev.rule).toMatchObject({ effect: 'allow', decision_type: 'purchase', target_role: 'Purchasing', max_value: 26000, max_risk: 'Attention', project_id: A, priority: 200 });
      expect(prev.preview.summary).toBeTruthy();
      expect(prev.preview.warnings.map((w: Row) => w.code)).toContain('BROADENS_SYSTEM_POLICY');
      // No authority yet.
      expect(await count(`SELECT count(*) AS n FROM delegated_authorities WHERE decision_type = 'purchase' AND kind = 'owner'`)).toBe(0);
      // Confirming without (or with a stale) preview is refused.
      expect((await owner().post(`/api/delegation/recommendations/${p.id}/accept`).send({})).status).toBe(400);
      expect((await owner().post(`/api/delegation/recommendations/${p.id}/accept`).send({ confirmation: 'x' })).status).toBe(400);
      const res = (await owner().post(`/api/delegation/recommendations/${p.id}/accept`).send({ confirmation: prev.confirmation }).expect(201)).body;
      expect(res.recommendation).toMatchObject({ status: 'accepted', authority_rule_id: res.rule.id, authority_rule_code: res.rule.code });
      const rule = (await db.pool.query(`SELECT * FROM delegated_authorities WHERE id = $1`, [res.rule.id])).rows[0];
      expect(rule).toMatchObject({ kind: 'owner', effect: 'allow', decision_type: 'purchase', target_role: 'Purchasing', project_id: A, max_risk: 'Attention', created_by: 'user-owner' });
      expect(Number(rule.max_value)).toBe(26000);
      expect((await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [res.rule.id])).rows.map((r) => r.action)).toContain('authority.rule.create');
      expect((await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'delegation.recommendation.accept' AND entity_id = $1`, [p.id])).rows[0].after).toMatchObject({ authority_rule_code: res.rule.code });
      // The resolver now lets Purchasing issue a RM 24,000 PO on project A by themselves.
      const po = next('po-b5');
      await as['Purchasing'].post('/api/purchase-orders').send({ id: po, po_number: po.toUpperCase(), project_id: A, project_name: 'P', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 24000, total_price: 1 }], total_amount: 1, requested_by: 'Purchasing', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }).expect(201);
      expect(await route('purchase_order', po)).toMatchObject({ assigned_user_id: 'user-purchasing', authority_rule_id: res.rule.id });
      // It is not suggested again.
      await generate();
      expect(await recFor('purchase')).toBeUndefined();
    });

    it('9. Modify: the Owner changes RM 8,000 to RM 5,000; the rule is created with RM 5,000', async () => {
      const r = (await recFor('variation'))!;
      const mods = { max_value: 5000 };
      const prev = (await owner().post(`/api/delegation/recommendations/${r.id}/preview`).send({ modifications: mods }).expect(200)).body;
      expect(prev.modified).toBe(true);
      expect(prev.rule.max_value).toBe(5000);
      // The confirmation belongs to the previewed rule: accepting different values is refused.
      expect((await owner().post(`/api/delegation/recommendations/${r.id}/accept`).send({ modifications: { max_value: 9000 }, confirmation: prev.confirmation })).status).toBe(400);
      const res = (await owner().post(`/api/delegation/recommendations/${r.id}/accept`).send({ modifications: mods, confirmation: prev.confirmation }).expect(201)).body;
      expect(res.recommendation.status).toBe('modified');
      expect(Number((await db.pool.query(`SELECT max_value FROM delegated_authorities WHERE id = $1`, [res.rule.id])).rows[0].max_value)).toBe(5000);
      // A variation of RM 4,000 now goes to the PM; RM 6,000 still to the Owner.
      const small = next('vo-b5');
      await raiser.post('/api/variations').send({ id: small, variation_number: small.toUpperCase(), project_id: A, project_name: 'P', title: 'Shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 4000, status: 'Internal Approval', created_at: '' }).expect(201);
      expect((await route('variation', small)).assigned_user_id).toBe('user-pm');
      const big = next('vo-b5');
      await raiser.post('/api/variations').send({ id: big, variation_number: big.toUpperCase(), project_id: A, project_name: 'P', title: 'Shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 6000, status: 'Internal Approval', created_at: '' }).expect(201);
      expect((await route('variation', big)).assigned_user_id).toBe('user-owner');
      // The delegated PM decides the small one: a delegated decision in the analytics.
      await as['Project Manager'].post(`/api/variations/${small}/transition`).send({ status: 'Client Approval' }).expect(200);
    });

    it('11. Snooze: hidden until the snooze ends, no authority change', async () => {
      const r = (await recFor('approval_request', 'Project Date Change'))!;
      expect(r).toMatchObject({ target_role: 'Project Manager', suggested_max_value: null });
      const rules = await count(`SELECT count(*) AS n FROM delegated_authorities`);
      expect((await owner().post(`/api/delegation/recommendations/${r.id}/snooze`).send({ days: 7 })).status).toBe(400);
      await owner().post(`/api/delegation/recommendations/${r.id}/snooze`).send({ days: 7, reason: 'Revisit after the audit' }).expect(200);
      let l = await list();
      expect(l.active.find((x) => x.id === r.id)).toBeUndefined();
      expect(l.snoozed.find((x) => x.id === r.id)).toMatchObject({ status: 'snoozed', review_reason: 'Revisit after the audit' });
      await generate();
      expect((await list()).snoozed.find((x) => x.id === r.id)).toBeTruthy();
      // Eight days later it is back (same recommendation).
      await generateDelegationRecommendations(db.pool, new Date(Date.now() + 8 * 86400_000));
      l = await list();
      expect(l.active.find((x) => x.id === r.id)).toBeTruthy();
      expect(await count(`SELECT count(*) AS n FROM delegated_authorities`)).toBe(rules);
    });

    it('10. Reject: marked rejected with the reason, no authority change, not suggested again during the cool-down', async () => {
      const r = (await recFor('approval_request', 'Project Date Change'))!;
      const rules = await count(`SELECT count(*) AS n FROM delegated_authorities`);
      expect((await owner().post(`/api/delegation/recommendations/${r.id}/reject`).send({})).status).toBe(400);
      const res = (await owner().post(`/api/delegation/recommendations/${r.id}/reject`).send({ reason: 'Date changes affect the client: I keep them' }).expect(200)).body;
      expect(res).toMatchObject({ status: 'rejected', review_reason: 'Date changes affect the client: I keep them', authority_rule_id: null });
      expect(await count(`SELECT count(*) AS n FROM delegated_authorities`)).toBe(rules);
      await generate();
      expect(await recFor('approval_request', 'Project Date Change')).toBeUndefined();
      expect((await db.pool.query(`SELECT details FROM audit_logs WHERE action = 'delegation.recommendation.reject' AND entity_id = $1`, [r.id])).rows[0].details).toMatch(/I keep them/);
      // A reviewed recommendation cannot be accepted afterwards.
      expect((await owner().post(`/api/delegation/recommendations/${r.id}/preview`).send({})).status).toBe(400);
    });

    it('13 (second half). Generation never alters approval history or authority', async () => {
      const before = await state();
      await generate();
      expect(await state()).toEqual(before);
      // Recommendations are never deleted.
      expect(await count(`SELECT count(*) AS n FROM delegation_recommendations WHERE status IN ('accepted', 'modified', 'rejected')`)).toBe(3);
    });
  });

  describe('Owner dependency analytics', () => {
    it('counts Owner and delegated decisions from the server, with explainable dependency and time saved', async () => {
      const a = (await owner().get('/api/owner/dependency/analytics?days=90').expect(200)).body;
      expect(a.totals.owner_decisions).toBeGreaterThanOrEqual(39);
      expect(a.totals.delegated_decisions).toBeGreaterThanOrEqual(1);
      expect(a.totals.total_decisions).toBe(a.totals.owner_decisions + a.totals.delegated_decisions);
      const v = a.by_decision_type.find((t: Row) => t.decision_type === 'variation');
      expect(v).toMatchObject({ label: 'Variations', delegated: expect.any(Number), escalation_rate: 0 });
      expect(v.owner).toBeGreaterThanOrEqual(20);
      expect(v.median_hours).toBeGreaterThan(0);
      expect(a.by_reason.map((r: Row) => r.code)).toEqual(expect.arrayContaining(['NO_ELIGIBLE_DELEGATE', 'STRATEGIC_PROJECT', 'POLICY_REQUIRES_OWNER']));
      expect(a.dependency.definition).toMatch(/routine decisions the Owner took/);
      expect(a.dependency.percent).toBeGreaterThan(0);
      expect(a.time_saved.formula).toBe(`${a.time_saved.delegated_decisions} decisions taken by delegates × 20 minutes = ${a.time_saved.estimated_hours} hours`);
      expect(a.trend).toHaveLength(6);
      expect(a.repeated.find((r: Row) => r.decision_type === 'variation' && r.scope === 'one project' && r.project_id === A)).toMatchObject({ count: expect.any(Number) });
      expect(a.by_value.find((b: Row) => b.band === 'RM 20,000 – 99,999').owner_decisions).toBeGreaterThanOrEqual(6);
    });

    it('tells the Owner at most once a week, through the existing notification engine', async () => {
      const engine = new AutomationEngine(db.pool);
      await db.pool.query(`UPDATE delegation_recommendations SET status = 'rejected', reviewed_at = now() - interval '200 days', review_reason = 'reset' WHERE status IN ('generated', 'viewed')`);
      await db.pool.query(`UPDATE delegation_recommendations SET status = 'rejected', reviewed_at = now() - interval '200 days', review_reason = 'reset', snoozed_until = NULL WHERE status = 'snoozed'`);
      // Fresh opportunities this week (the rejections above are outside the cool-down).
      expect((await engine.runRule('delegation_recommendations', 'manual')).status).toBe('succeeded');
      expect((await engine.runRule('delegation_recommendations', 'manual')).status).toBe('succeeded');
      const notes = (await db.pool.query(`SELECT user_id, title FROM notifications WHERE rule_key LIKE 'delegation_recommendations:week:%'`)).rows;
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatchObject({ user_id: 'user-owner', title: expect.stringMatching(/delegation opportunit/) });
    });
  });

  describe('security', () => {
    it('only the Owner reads analytics and recommendations, generates, previews, accepts, rejects or snoozes', async () => {
      const id = (await db.pool.query(`SELECT id FROM delegation_recommendations ORDER BY id LIMIT 1`)).rows[0].id;
      for (const role of ['Admin', 'Project Manager', 'Accountant', 'Purchasing', 'Client', 'Contractor']) {
        const a = as[role];
        expect((await a.get('/api/owner/dependency/analytics')).status, role).toBe(403);
        expect((await a.get('/api/delegation/recommendations')).status, role).toBe(403);
        expect((await a.post('/api/delegation/recommendations/generate').send({})).status, role).toBe(403);
        expect((await a.post(`/api/delegation/recommendations/${id}/preview`).send({})).status, role).toBe(403);
        expect((await a.post(`/api/delegation/recommendations/${id}/accept`).send({ confirmation: 'x' })).status, role).toBe(403);
        expect((await a.post(`/api/delegation/recommendations/${id}/reject`).send({ reason: 'x' })).status, role).toBe(403);
        expect((await a.post(`/api/delegation/recommendations/${id}/snooze`).send({ days: 1, reason: 'x' })).status, role).toBe(403);
      }
    });

    it('a PM cannot generate a recommendation for themselves through forged parameters', async () => {
      expect((await as['Project Manager'].post('/api/delegation/recommendations/generate').send({ target_user_id: 'user-pm', decision_type: 'variation', max_value: 999999 })).status).toBe(403);
      // Even the Owner's generate takes no parameters.
      expect((await owner().post('/api/delegation/recommendations/generate').send({ target_user_id: 'user-pm' })).status).toBe(400);
      expect(await count(`SELECT count(*) AS n FROM delegation_recommendations WHERE target_user_id = 'user-pm'`)).toBe(0);
    });

    it('the browser cannot change evidence, forge acceptance or bypass the authority API', async () => {
      await generate();
      const r = (await list()).active[0];
      expect(r).toBeTruthy();
      for (const forged of [{ evidence_count: 999 }, { authority_rule_id: 'sys-x' }, { decision_type: 'invoice' }, { status: 'accepted' }, { effect: 'require_owner' }]) {
        expect((await owner().post(`/api/delegation/recommendations/${r.id}/accept`).send({ ...forged, confirmation: 'x' })).status).toBe(400);
        expect((await owner().post(`/api/delegation/recommendations/${r.id}/preview`).send({ modifications: forged })).status).toBe(400);
      }
      // Modifications still go through the authority validator: a client, a role without the permission, a Sensitive project.
      expect((await owner().post(`/api/delegation/recommendations/${r.id}/preview`).send({ modifications: { target_user_id: 'user-client', target_role: '' } })).status).toBe(400);
      expect((await owner().post(`/api/delegation/recommendations/${r.id}/preview`).send({ modifications: { target_role: 'Contractor' } })).status).toBe(400);
      const stored = (await db.pool.query(`SELECT evidence_count, status, authority_rule_id FROM delegation_recommendations WHERE id = $1`, [r.id])).rows[0];
      expect(stored).toMatchObject({ status: 'viewed', authority_rule_id: null });
      // Historical decisions cannot be touched through these APIs (there is no route that writes them).
      expect((await owner().patch(`/api/delegation/recommendations/${r.id}`).send({ evidence_count: 1 })).status).toBe(404);
    });
  });
});
