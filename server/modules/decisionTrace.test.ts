import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { seedUsers, signIn } from '../test/app';
import { withTransaction } from '../db/pool';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { reevaluateRoutes } from './approvalRouting';
import { notifyRejection } from './decisionTrace';
import { aiRuntime } from '../ai/gateway';
import { MockProvider } from '../ai/provider';

type Row = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400_000;
const future = (ms: number) => new Date(Date.now() + ms).toISOString();

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 8: approval traceability and rejection notifications', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let raiser: request.Agent;
  let engine: AutomationEngine;
  const mock = new MockProvider();
  const P: Record<string, string> = {};
  beforeAll(async () => {
    let app: Parameters<typeof request>[0];
    ({ db, as, app } = (await setupDemoWorld()) as never);
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    await seedUsers(db.pool, [{ id: 'user-raiser', role: 'Project Manager', email: 'raiser@test.local' }]);
    raiser = await signIn(app as never, 'raiser@test.local');
    await ensureRules(db.pool);
    engine = new AutomationEngine(db.pool);
    for (const t of ['perm', 'temp', 'abs', 'sens', 'strat', 'exp', 'role']) P[t] = await newProject(t);
    await owner().put(`/api/projects/${P.sens}/sensitivity`).send({ sensitivity: 'Sensitive', reason: 'Board asked' }).expect(200);
    await owner().put(`/api/projects/${P.strat}/sensitivity`).send({ sensitivity: 'Strategic', reason: 'Board-level' }).expect(200);
    aiRuntime().provider = mock;
  }, 60000);
  afterAll(async () => {
    aiRuntime().provider = null;
    await engine?.stop();
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  async function newProject(tag: string) {
    const id = next(`proj-b8${tag}`);
    await owner().post('/api/projects').send({ id, project_number: id.toUpperCase(), project_name: `B8 ${tag}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-raiser') ON CONFLICT DO NOTHING`, [id]);
    return id;
  }
  const variation = async (projectId: string, amount: number) => {
    const id = next('vo-b8');
    await raiser.post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: 'Shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    return id;
  };
  const approveVo = (agent: request.Agent, id: string) => agent.post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' });
  const trace = (agent: request.Agent, kind: string, id: string) => agent.get(`/api/approval-routing/trace?kind=${kind}&id=${encodeURIComponent(id)}`);
  const traceOk = async (kind: string, id: string) => (await trace(owner(), kind, id).expect(200)).body as Row;
  const lastDecision = (t: Row) => t.decisions[t.decisions.length - 1] as Row;
  const temporary = async (body: Row) => {
    const pr = (await owner().post('/api/authority/temporary/preview').send(body).expect(200)).body;
    return (await owner().post('/api/authority/temporary').send({ ...body, confirmation: pr.confirmation }).expect(201)).body as Row;
  };
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as Row[];

  let permRule: Row;
  let voPerm = '';

  // 1, 4, 5. Permanent authority, project scope, value limit at the boundary, risk check recorded.
  it('1/4/5. permanent authority: requester, approver, permission, rule terms, scope, value and risk at decision time', async () => {
    permRule = (await owner().post('/api/authority/rules').send({ name: 'PM routine variations', description: 'Routine variations on B8 perm', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: P.perm, max_value: 20000, max_risk: 'Critical', priority: 140 }).expect(201)).body;
    voPerm = await variation(P.perm, 20000); // exactly at the limit
    await approveVo(as['Project Manager'], voPerm).expect(200);
    const t = await traceOk('variation', voPerm);
    const d = lastDecision(t);
    expect(d).toMatchObject({ outcome: 'Client Approval', allowed: true, terms_recorded: true, matched_rule_code: permRule.code, decided_by: { id: 'user-pm', role: 'Project Manager' } });
    expect(d.trace).toMatchObject({
      version: 1,
      authority_type: 'Permanent',
      permission: 'variations.review',
      requester: { id: 'user-raiser' },
      approver: { id: 'user-pm', role: 'Project Manager' },
      decision: { project_id: P.perm, sensitivity: 'Normal', client_id: 'client-2' },
      value: { amount: 20000 },
      rule: { id: permRule.id, code: permRule.code, kind: 'owner', authority_type: 'permanent', project_id: P.perm, max_value: 20000, max_risk: 'Critical', end_at: null },
    });
    expect(d.trace.rule.project_name).toBe('B8 perm');
    expect(d.trace.checks.value).toMatchObject({ value: 20000, max: 20000, passed: true });
    expect(d.trace.checks.risk).toMatchObject({ max: 'Critical', passed: true });
    expect(typeof d.trace.checks.risk.actual).toBe('string');
    expect(d.trace.checks.scope.project).toMatchObject({ required: P.perm, actual: P.perm, passed: true });
    expect(t.requester).toMatchObject({ id: 'user-raiser' });
    // One cent over the limit: refused by the resolver, so no decision record is written.
    const over = await variation(P.perm, 20000.01);
    expect((await approveVo(as['Project Manager'], over)).status).toBe(403);
    expect((await traceOk('variation', over)).decisions).toEqual([]);
    // Outside the rule's project: refused too.
    const elsewhere = await variation(P.role, 1000);
    expect((await approveVo(as['Project Manager'], elsewhere)).status).toBe(403);
  });

  // 2. Temporary authority.
  it('2. temporary authority is traced as Temporary with its decision-time end date', async () => {
    const temp = await temporary({ decision_type: 'variation', target_user_id: 'user-pm', project_id: P.temp, max_value: 8000, end_at: future(5 * DAY), reason: 'Owner travelling' });
    const vo = await variation(P.temp, 5000);
    await approveVo(as['Project Manager'], vo).expect(200);
    const d = lastDecision(await traceOk('variation', vo));
    expect(d.trace).toMatchObject({ authority_type: 'Temporary', rule: { id: temp.id, authority_type: 'temporary', max_value: 8000, target_user_id: 'user-pm', target_user_name: expect.any(String) } });
    expect(d.trace.rule.end_at).toBe(new Date(temp.end_at).toISOString());
  });

  // 3. Absence authority.
  it('3. absence authority is traced as Absence', async () => {
    const body = { backup_user_id: 'user-pm', end_at: future(2 * DAY), decision_types: ['variation'], max_value: 6000, project_id: P.abs, reason: 'Annual leave' };
    const pr = (await owner().post('/api/authority/absence/preview').send(body).expect(200)).body;
    const abs = (await owner().post('/api/authority/absence').send({ ...body, confirmation: pr.confirmation }).expect(201)).body;
    const vo = await variation(P.abs, 3000);
    await approveVo(as['Project Manager'], vo).expect(200);
    const d = lastDecision(await traceOk('variation', vo));
    expect(d.trace).toMatchObject({ authority_type: 'Absence', rule: { authority_type: 'absence', absence_id: abs.id, max_value: 6000 } });
    await owner().post(`/api/authority/absence/${abs.id}/end`).send({ reason: 'back' }).expect(200);
    // Still Absence after the absence ended.
    expect(lastDecision(await traceOk('variation', vo)).trace.authority_type).toBe('Absence');
  });

  // 4. Global scope / System Policy, and the Owner.
  it('4. System Policy (global scope) and Owner decisions are traced as such', async () => {
    const id = next('apr-b8');
    await as['Purchasing'].post('/api/approvals').send({ id, approval_number: id.toUpperCase(), approval_type: 'Major Purchase', title: 'Timber', description: 'x', project_id: P.perm, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' }).expect(201);
    await as['Accountant'].post(`/api/approvals/${id}/decision`).send({ decision: 'Approved', comments: 'Within budget' }).expect(200);
    const d = lastDecision(await traceOk('approval', id));
    expect(d).toMatchObject({ outcome: 'Approved', comments: 'Within budget', decided_by: { role: 'Accountant' } });
    expect(d.trace).toMatchObject({ authority_type: 'System Policy', requester: { id: 'user-purchasing' }, rule: { kind: 'system', code: 'SYS-PURCHASE-ACCOUNTANT', project_id: null, client_id: null } });
    const ownerVo = await variation(P.perm, 25000);
    await approveVo(owner(), ownerVo).expect(200);
    expect(lastDecision(await traceOk('variation', ownerVo)).trace).toMatchObject({ authority_type: 'Owner', basis: 'owner', rule: null, approver: { role: 'Owner / CEO' } });
  });

  // 6. Sensitive / Strategic.
  it('6. Sensitive and Strategic projects: delegates are refused (no decision record); the Owner decision records the sensitivity', async () => {
    for (const [tag, sens] of [['sens', 'Sensitive'], ['strat', 'Strategic']] as const) {
      const cr = await owner().post('/api/authority/rules').send({ name: `PM on ${tag}`, description: 'Test', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: P[tag], max_value: 50000, priority: 140 });
      expect(cr.status, tag).toBe(400); // delegation on a Sensitive/Strategic project is refused outright
      expect(cr.body.message, tag).toMatch(/only the Owner may approve/);
      const vo = await variation(P[tag], 1000);
      const r = await approveVo(as['Project Manager'], vo);
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect((await traceOk('variation', vo)).decisions, tag).toEqual([]);
      await approveVo(owner(), vo).expect(200);
      expect(lastDecision(await traceOk('variation', vo)).trace, tag).toMatchObject({ authority_type: 'Owner', decision: { sensitivity: sens } });
    }
  });

  // 7. Rule edits.
  it('7. editing the rule later does not change the past explanation; the change is shown as current status', async () => {
    await owner().patch(`/api/authority/rules/${permRule.id}`).send({ max_value: 5000, change_reason: 'Tighter limit from November' }).expect(200);
    const t = await traceOk('variation', voPerm);
    expect(lastDecision(t).trace.rule.max_value).toBe(20000);
    expect(t.current_rule_status.find((c: Row) => c.id === permRule.id)).toMatchObject({ in_force_now: true, changed_since: true });
  });

  // 8. Revocation and expiry.
  it('8. revocation and real expiry do not change the past explanation', async () => {
    await owner().post(`/api/authority/rules/${permRule.id}/deactivate`).send({ reason: 'Revoked for audit' }).expect(200);
    const t = await traceOk('variation', voPerm);
    expect(lastDecision(t)).toMatchObject({ allowed: true, trace: { authority_type: 'Permanent', rule: { active: true, max_value: 20000 } } });
    expect(t.current_rule_status.find((c: Row) => c.id === permRule.id)).toMatchObject({ in_force_now: false, active: false });
    const temp = await temporary({ decision_type: 'variation', target_user_id: 'user-pm', project_id: P.exp, max_value: 9000, end_at: future(2500), reason: 'Short cover' });
    const vo = await variation(P.exp, 2000);
    await approveVo(as['Project Manager'], vo).expect(200);
    await sleep(2800);
    await engine.runRule('delegation_watch', 'manual');
    const after = await traceOk('variation', vo);
    expect(lastDecision(after)).toMatchObject({ allowed: true, trace: { authority_type: 'Temporary', rule: { id: temp.id, active: true } } });
    expect(after.current_rule_status.find((c: Row) => c.id === temp.id)).toMatchObject({ in_force_now: false, deactivation_reason: 'Expired' });
  });

  // 9. Permission (role) change.
  it('9. changing the approver role later does not change the recorded role and permission', async () => {
    await seedUsers(db.pool, [{ id: 'user-pm2', role: 'Project Manager', email: 'pm2@test.local' }]);
    await db.pool.query(`UPDATE projects SET project_manager_id = 'user-pm2' WHERE id = $1`, [P.role]);
    const pm2 = await signIn((await import('../test/app')).buildApp(db.pool), 'pm2@test.local');
    const cr = await owner().post('/api/authority/rules').send({ name: 'PM2 on role project', description: 'Test', effect: 'allow', decision_type: 'variation', target_user_id: 'user-pm2', project_id: P.role, max_value: 9000, priority: 140 });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    const vo = await variation(P.role, 1500);
    await approveVo(pm2, vo).expect(200);
    await as['Admin'].patch('/api/users/user-pm2').send({ role: 'Site Supervisor' }).expect(200);
    const d = lastDecision(await traceOk('variation', vo));
    expect(d).toMatchObject({ decided_by: { role: 'Project Manager' }, trace: { permission: 'variations.review', approver: { id: 'user-pm2', role: 'Project Manager' } } });
  });

  // 10-12. Access.
  it('10/11/12. access: Owner, Admin, requester, approver and assignee only; others, clients and contractors get the same 404 as a missing record', async () => {
    for (const [name, agent] of [['Owner', owner()], ['Admin', as['Admin']], ['requester', raiser], ['approver', as['Project Manager']]] as [string, request.Agent][]) {
      expect((await trace(agent, 'variation', voPerm)).status, name).toBe(200);
    }
    const missing = await trace(as['Production Manager'], 'variation', 'vo-does-not-exist');
    for (const role of ['Production Manager', 'Site Supervisor', 'Accountant', 'Purchasing', 'Production Staff', 'Contractor', 'Client']) {
      const r = await trace(as[role], 'variation', voPerm);
      expect(r.status, role).toBe(404);
      expect(r.body.message.replace(voPerm, 'X'), role).toBe(missing.body.message.replace('vo-does-not-exist', 'X'));
      expect(JSON.stringify(r.body), role).not.toMatch(/rule|authority_type|SYS-|DA-/);
    }
    // A pending decision's current assignee may read it.
    const pending = await variation(P.temp, 1200);
    expect((await trace(as['Project Manager'], 'variation', pending)).status).toBe(200);
    // Client on its own project's approval: still no internal authority details.
    const own = (await q(`SELECT id FROM approvals WHERE project_id = 'proj-1' LIMIT 1`))[0];
    if (own) expect((await trace(as['Client'], 'approval', own.id)).status).toBe(404);
    expect((await as['Owner / CEO'].get('/api/approval-routing/trace?kind=nonsense&id=x')).status).toBe(400);
  });

  // 13. Forgery.
  it('13. traceability cannot be forged: decision records are append-only and browser fields are ignored', async () => {
    await expect(db.pool.query(`UPDATE audit_logs SET after = '{}' WHERE entity_id = $1`, [voPerm])).rejects.toThrow(/append-only/);
    await expect(db.pool.query(`DELETE FROM audit_logs WHERE entity_id = $1`, [voPerm])).rejects.toThrow(/append-only/);
    const vo = await variation(P.temp, 900);
    await as['Project Manager'].post(`/api/variations/${vo}/transition`).send({ status: 'Client Approval', authority: { authority_type: 'Owner' }, trace: { rule: { max_value: 1e9 } }, approval_authority: 'forged' }).expect(200);
    const d = lastDecision(await traceOk('variation', vo));
    expect(d.trace.authority_type).toBe('Temporary');
    expect(d.trace.rule.max_value).toBe(8000);
    // Query parameters beyond kind/id change nothing; the user cannot pick another record's trace.
    expect((await as['Production Manager'].get(`/api/approval-routing/trace?kind=variation&id=${voPerm}&as=user-owner&role=Owner%20%2F%20CEO`)).status).toBe(404);
  });

  // 14-16. AI.
  it('14/15/16. the AI explains from the persisted record, never from current rules; says when the reason is not established; cannot decide', async () => {
    const num = (await q(`SELECT data->>'variation_number' AS n FROM variations WHERE id = $1`, [voPerm]))[0].n;
    const a = (await owner().post('/api/ai/ops/ask').send({ question: `Why was ${num} approved?` }).expect(200)).body;
    expect(a.ai.status).toBe('ok');
    const fact = a.facts.find((f: Row) => f.section === 'Decision record' && /Authority: Permanent/.test(f.text));
    expect(fact.text).toContain(permRule.code);
    expect(fact.text).toContain('RM 20,000'); // the decision-time limit, not today's RM 5,000
    expect(fact.text).not.toContain('RM 5,000');
    expect(a.facts.some((f: Row) => f.section === 'Current rule status' && /no longer in force/.test(f.text))).toBe(true);
    // A decision recorded before traceability: no snapshot → not established.
    const legacy = await variation(P.temp, 700);
    await db.pool.query(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, project_id, after) VALUES ('user-pm', 'PM', 'Project Manager', 'variation.transition', 'variation', $1, $2, $3)`, [legacy, P.temp, JSON.stringify({ status: 'Client Approval', authority: { matched_rule_code: 'DA-OLD', result: 'allowed' } })]);
    const legacyNum = (await q(`SELECT data->>'variation_number' AS n FROM variations WHERE id = $1`, [legacy]))[0].n;
    const l = (await owner().post('/api/ai/ops/ask').send({ question: `Why was ${legacyNum} approved?` }).expect(200)).body;
    expect(l.facts.find((f: Row) => /cannot be established from the available record/.test(f.text))).toMatchObject({ confidence: 'Unknown' });
    expect(l.facts.some((f: Row) => f.confidence === 'Confirmed' && /Authority:/.test(f.text))).toBe(false);
    const none = (await owner().post('/api/ai/ops/ask').send({ question: 'Why was VO-NOPE-1 approved?' }).expect(200)).body;
    expect(none.answer + JSON.stringify(none.facts)).toMatch(/cannot be established from the available record/);
    // People who may not read the trace get nothing from the AI either.
    const site = (await as['Site Supervisor'].post('/api/ai/ops/ask').send({ question: `Why was ${num} approved?` }).expect(200)).body;
    expect(JSON.stringify(site.facts)).not.toContain(permRule.code);
    // The AI cannot decide.
    const pending = await variation(P.temp, 650);
    const pendingNum = (await q(`SELECT data->>'variation_number' AS n FROM variations WHERE id = $1`, [pending]))[0].n;
    const refuse = (await owner().post('/api/ai/ops/ask').send({ question: `Approve variation ${pendingNum} now` }).expect(200)).body;
    expect(refuse.ai.status).toBe('refused');
    expect((await q('SELECT status FROM variations WHERE id = $1', [pending]))[0].status).toBe('Internal Approval');
  });

  // 17-19. Rejection notifications.
  it('17/18/19. a rejection notifies the original requester exactly once; nobody else; existing notifications unchanged', async () => {
    const before = (await q(`SELECT count(*)::int AS n FROM notifications WHERE rule_key LIKE 'rejection:%'`))[0].n;
    const vo = await variation(P.temp, 1100);
    // The routed approver was told to decide (existing behaviour).
    expect((await q(`SELECT n.title FROM notifications n JOIN approval_routes r ON n.entity_id = r.id::text WHERE n.user_id = 'user-pm' AND r.resource_id = $1`, [vo])).map((r) => r.title).join(' ')).toMatch(/To decide/);
    await as['Project Manager'].post(`/api/variations/${vo}/transition`).send({ status: 'Rejected', note: 'Not in scope of the contract' }).expect(200);
    const notes = await q(`SELECT user_id, title, message, rule_key FROM notifications WHERE rule_key = $1`, [`rejection:variation:${vo}`]);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ user_id: 'user-raiser' });
    expect(notes[0].message).toMatch(/rejected your request.*Not in scope of the contract/);
    expect(notes[0].message + notes[0].title).not.toMatch(/DA-|SYS-|authority|rule/i);
    // Approval request rejected → its requester.
    const apr = next('apr-b8');
    await raiser.post('/api/approvals').send({ id: apr, approval_number: apr.toUpperCase(), approval_type: 'Safety-Critical Decision', title: 'Scaffold', description: 'x', project_id: P.temp, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' }).expect(201);
    await owner().post(`/api/approvals/${apr}/decision`).send({ decision: 'Rejected', comments: 'Use the certified scaffold' }).expect(200);
    expect(await q(`SELECT user_id FROM notifications WHERE rule_key = $1`, [`rejection:approval:${apr}`])).toEqual([{ user_id: 'user-raiser' }]);
    // Replays: submitting the same rejection again, or processing it again, adds nothing.
    await owner().post(`/api/approvals/${apr}/decision`).send({ decision: 'Rejected', comments: 'Use the certified scaffold' });
    for (let i = 0; i < 3; i++) {
      await withTransaction(db.pool, (c) => notifyRejection(c, { kind: 'approval', id: apr, requesterId: 'user-raiser', deciderId: 'user-owner', deciderName: 'Owner', title: 'x', projectId: P.temp, comment: 'again', linkTab: 'approvals' }));
    }
    expect(await q(`SELECT user_id FROM notifications WHERE rule_key = $1`, [`rejection:approval:${apr}`])).toHaveLength(1);
    // Rejecting your own request notifies nobody; a requester who cannot see the project is not told.
    expect(await withTransaction(db.pool, (c) => notifyRejection(c, { kind: 'approval', id: 'self', requesterId: 'user-owner', deciderId: 'user-owner', deciderName: 'Owner', title: 'x', projectId: P.temp, linkTab: 'approvals' }))).toBe(0);
    expect(await withTransaction(db.pool, (c) => notifyRejection(c, { kind: 'approval', id: 'scope', requesterId: 'user-contractor', deciderId: 'user-owner', deciderName: 'Owner', title: 'x', projectId: P.temp, linkTab: 'approvals' }))).toBe(0);
    expect((await q(`SELECT count(*)::int AS n FROM notifications WHERE rule_key LIKE 'rejection:%'`))[0].n).toBe(before + 2);
  });

  it('a drawing revision rejection notifies its uploader once', async () => {
    const revId = next('rev-b8');
    await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id: revId, revision: `Rev ${revId}`, title: 'x', file_url: `/${revId}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
    await owner().post(`/api/drawings/dwg-1/revisions/${revId}/status`).send({ status: 'Rejected' }).expect(200);
    await owner().post(`/api/drawings/dwg-1/revisions/${revId}/status`).send({ status: 'Rejected' });
    const notes = await q(`SELECT user_id, message FROM notifications WHERE rule_key = $1`, [`rejection:drawing_revision:${revId}`]);
    expect(notes).toHaveLength(1);
    expect(notes[0].user_id).toBe('user-pm');
    const d = lastDecision(await traceOk('drawing_revision', revId));
    expect(d).toMatchObject({ outcome: 'Rejected', trace: { authority_type: 'Owner', requester: { id: 'user-pm' } } });
  });
});
