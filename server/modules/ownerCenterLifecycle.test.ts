/**
 * Phase 6 Batch 9: the Owner Center's decision sections come from the current routing, and the
 * Owner Exception Center has a persistent, append-only lifecycle.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { seedUsers, signIn } from '../test/app';
import { withTransaction } from '../db/pool';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { reevaluateRoutes } from './approvalRouting';
import { STALE_DAYS } from './exceptionLifecycle';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 9: Owner Center correctness and exception lifecycle', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let raiser: request.Agent;
  let engine: AutomationEngine;
  const P: Record<string, string> = {};
  beforeAll(async () => {
    let app: Parameters<typeof request>[0];
    ({ db, as, app } = (await setupDemoWorld()) as never);
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    await seedUsers(db.pool, [{ id: 'user-raiser', role: 'Project Manager', email: 'raiser9@test.local' }]);
    raiser = await signIn(app as never, 'raiser9@test.local');
    await ensureRules(db.pool);
    engine = new AutomationEngine(db.pool);
    for (const t of ['deleg', 'own', 'strat', 'risk', 'crit']) P[t] = await newProject(t);
    await owner().put(`/api/projects/${P.strat}/sensitivity`).send({ sensitivity: 'Strategic', reason: 'Board-level' }).expect(200);
  }, 60000);
  afterAll(async () => {
    await engine?.stop();
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  async function newProject(tag: string) {
    const id = next(`proj-b9${tag}`);
    await owner().post('/api/projects').send({ id, project_number: id.toUpperCase(), project_name: `B9 ${tag}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-raiser') ON CONFLICT DO NOTHING`, [id]);
    return id;
  }
  const variation = async (projectId: string, amount: number) => {
    const id = next('vo-b9');
    await raiser.post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: `Shelf ${id}`, description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    return id;
  };
  const approvalRequest = async (type: string, projectId: string, assignedRole: string) => {
    const id = next('apr-b9');
    await as['Purchasing'].post('/api/approvals').send({ id, approval_number: id.toUpperCase(), approval_type: type, title: `${type} ${id}`, description: 'x', project_id: projectId, project_name: 'P', assigned_approver_role: assignedRole, date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' }).expect(201);
    return id;
  };
  const center = async (agent = owner()) => (await agent.get('/api/owner/center').expect(200)).body as Row;
  const ids = (list: Row[]) => list.map((d) => d.id);
  const routeOf = async (kind: string, id: string) => (await db.pool.query(`SELECT ar.*, u.role FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE resource_kind = $1 AND resource_id = $2 AND status = 'open'`, [kind, id])).rows[0] as Row;
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as Row[];
  let pmRule: Row;

  // ================================================================ Owner Center decisions
  describe('Requires my decision, from routing', () => {
    it('a Major Purchase routed to the Accountant is not the Owner’s, whatever assignee the request carried', async () => {
      const id = await approvalRequest('Major Purchase', P.deleg, 'Owner / CEO');
      expect((await routeOf('approval', id)).role).toBe('Accountant');
      const c = await center();
      expect(ids(c.decisions)).not.toContain(`approval:${id}`);
      const d = c.recently_delegated.find((x: Row) => x.id === `approval:${id}`);
      expect(d).toMatchObject({ delegation: 'active', assignee: { role: 'Accountant' }, rule_code: 'SYS-PURCHASE-ACCOUNTANT' });
      expect(d.why).toMatch(/Delegated to .* \(Accountant\) under SYS-PURCHASE-ACCOUNTANT/);
    });

    it('a variation routed to a delegated PM is not the Owner’s; one with no delegate is, with the reason', async () => {
      pmRule = (await owner().post('/api/authority/rules').send({ name: 'PM VOs B9', description: 'Routine variations', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: P.deleg, max_value: 10000, priority: 140 }).expect(201)).body;
      const toPm = await variation(P.deleg, 4000);
      const toOwner = await variation(P.own, 4000);
      expect((await routeOf('variation', toPm)).assigned_user_id).toBe('user-pm');
      expect((await routeOf('variation', toOwner)).role).toBe('Owner / CEO');
      const c = await center();
      expect(ids(c.decisions)).not.toContain(`variation:${toPm}`);
      const mine = c.decisions.find((d: Row) => d.id === `variation:${toOwner}`);
      expect(mine).toMatchObject({ entity_type: 'variation', entity_id: toOwner, tab: 'variations', severity: 'high' });
      expect(mine.detail).toMatch(/^Variation RM 4,000 — Owner required: /);
      expect(c.recently_delegated.find((x: Row) => x.id === `variation:${toPm}`)).toMatchObject({ delegation: 'active', assignee: { id: 'user-pm' }, rule_code: pmRule.code, rule_status: { state: 'in_force' } });
      // The health tile counts the same list.
      expect(c.health.outstanding_approvals).toBe(c.decisions.length);
    });

    it('a stale or tampered stored assignee never overrides the current route (both directions)', async () => {
      // Generic approval requests are routed by the resolver's System Policy (SYS-REQUEST-ASSIGNEE-*:
      // the named approver decides). The Owner Center reads the route, never the request's field.
      const own = await approvalRequest('Date Change', P.deleg, 'Owner / CEO');
      expect((await routeOf('approval', own)).role).toBe('Owner / CEO');
      const major = await approvalRequest('Major Purchase', P.deleg, 'Owner / CEO');
      expect((await routeOf('approval', major)).role).toBe('Accountant');
      // The stored field drifts / is tampered with in the database, without re-routing.
      await db.pool.query(`UPDATE approvals SET data = jsonb_set(data, '{assigned_approver_role}', '"Accountant"') WHERE id = $1`, [own]);
      await db.pool.query(`UPDATE approvals SET data = jsonb_set(data, '{assigned_approver_role}', '"Owner / CEO"') WHERE id = $1`, [major]);
      const c = await center();
      expect(ids(c.decisions)).toContain(`approval:${own}`);
      expect(ids(c.decisions)).not.toContain(`approval:${major}`);
      // Someone other than the requester cannot change who was asked.
      const req = (await owner().get(`/api/approvals/${major}`).expect(200)).body;
      expect((await as['Accountant'].patch(`/api/approvals/${major}`).send({ ...req, assigned_approver_role: 'Admin' })).status).toBe(403);
    });

    it('an escalated decision comes to the Owner and says so', async () => {
      const vo = await variation(P.deleg, 3000);
      await db.pool.query(`UPDATE approval_routes SET requested_at = now() - interval '30 days', routed_at = now() - interval '30 days' WHERE resource_id = $1 AND status = 'open'`, [vo]);
      await engine.runRule('approval_monitor', 'manual');
      const r = await routeOf('variation', vo);
      const c = await center();
      if (r.role === 'Owner / CEO') {
        const item = c.decisions.find((d: Row) => d.id === `variation:${vo}`);
        expect(item.severity).toBe('critical');
        expect(item.detail).toMatch(/escalated to you/);
      } else {
        // Escalated to the next eligible delegate: still not the Owner's decision, shown as delegated.
        expect(ids(c.decisions)).not.toContain(`variation:${vo}`);
        expect(r.lifecycle_state).toBe('escalated');
      }
    });

    it('a delegate that becomes invalid falls to the Owner: at once in the view, then by re-routing', async () => {
      const vo = await variation(P.deleg, 2000);
      expect((await routeOf('variation', vo)).assigned_user_id).toBe('user-pm');
      // Revoked: before the monitor runs, the route still names the PM, who may no longer decide.
      await owner().post(`/api/authority/rules/${pmRule.id}/deactivate`).send({ reason: 'Paused for audit' }).expect(200);
      await db.pool.query(`UPDATE approval_routes SET assigned_user_id = 'user-pm', routing_basis = 'PROJECT_ROLE_RULE', authority_rule_id = $2, authority_rule_code = $3, owner_reason_code = NULL WHERE resource_id = $1 AND status = 'open'`, [vo, pmRule.id, pmRule.code]);
      let c = await center();
      const pending = c.decisions.find((d: Row) => d.id === `variation:${vo}`);
      expect(pending).toMatchObject({ severity: 'critical' });
      expect(pending.detail).toMatch(/may no longer decide it/);
      expect(c.recently_delegated.find((x: Row) => x.id === `variation:${vo}`)).toMatchObject({ delegation: 'pending_reroute', rule_status: { state: 'revoked' } });
      // The authoritative fallback: re-routing gives it to the Owner with the resolver's reason.
      await withTransaction(db.pool, (cl) => reevaluateRoutes(cl, { name: 'test' }));
      expect((await routeOf('variation', vo)).role).toBe('Owner / CEO');
      c = await center();
      expect(c.decisions.find((d: Row) => d.id === `variation:${vo}`).detail).toMatch(/Owner required/);
      await owner().post(`/api/authority/rules/${pmRule.id}/reactivate`).send({ reason: 'Audit done' }).expect(200);
      await withTransaction(db.pool, (cl) => reevaluateRoutes(cl, { name: 'test' }));
    });

    it('an unavailable (deactivated) delegate is handled the same way', async () => {
      await seedUsers(db.pool, [{ id: 'user-acc2', role: 'Accountant', email: 'acc2@test.local' }]);
      const id = await approvalRequest('Major Purchase', P.deleg, 'Owner / CEO');
      const r = await routeOf('approval', id);
      await db.pool.query(`UPDATE approval_routes SET assigned_user_id = 'user-acc2' WHERE id = $1`, [r.id]);
      await db.pool.query(`UPDATE users SET is_active = false WHERE id = 'user-acc2'`);
      const c = await center();
      expect(c.decisions.find((d: Row) => d.id === `approval:${id}`)).toMatchObject({ severity: 'critical' });
      await withTransaction(db.pool, (cl) => reevaluateRoutes(cl, { name: 'test' }));
      expect((await routeOf('approval', id)).assigned_user_id).not.toBe('user-acc2');
    });

    it('routing changes after a decision change the current view, never the decision’s historical snapshot', async () => {
      const vo = await variation(P.deleg, 2500);
      await as['Project Manager'].post(`/api/variations/${vo}/transition`).send({ status: 'Client Approval' }).expect(200);
      let c = await center();
      const decided = c.recently_delegated.find((x: Row) => x.id === `variation:${vo}`);
      expect(decided).toMatchObject({ delegation: 'decided', outcome: 'approved', assignee: { id: 'user-pm' }, rule_code: pmRule.code });
      await owner().patch(`/api/authority/rules/${pmRule.id}`).send({ max_value: 1000, change_reason: 'Tighter' }).expect(200);
      c = await center();
      const after = c.recently_delegated.find((x: Row) => x.id === `variation:${vo}`);
      expect(after.rule_status.state).toBe('changed');
      expect(after.why).toMatch(/valid under the terms at the time/);
      const trace = (await owner().get(`/api/approval-routing/trace?kind=variation&id=${vo}`).expect(200)).body;
      expect(trace.decisions[0].trace.rule.max_value).toBe(10000);
      // One entry per decision.
      expect(c.recently_delegated.filter((x: Row) => x.id === `variation:${vo}`)).toHaveLength(1);
      await owner().patch(`/api/authority/rules/${pmRule.id}`).send({ max_value: 10000, change_reason: 'Restore' }).expect(200);
    });

    it('high-risk decisions: the server’s risk factors only, with the reason', async () => {
      const strat = await variation(P.strat, 1000);
      const normal = await variation(P.deleg, 1500);
      await db.pool.query(`UPDATE approval_routes SET requested_at = now() - interval '20 days' WHERE resource_id = $1 AND status = 'open'`, [normal]);
      const c = await center();
      const hr = c.high_risk.find((x: Row) => x.id === `variation:${strat}`);
      expect(hr.reasons).toContain('STRATEGIC');
      expect(hr.why).toMatch(/^High risk: Strategic project/);
      // Overdue / delegated alone is not high risk.
      expect(ids(c.high_risk)).not.toContain(`variation:${normal}`);
    });

    it('only the Owner and Admin see the Owner Center; clients and contractors get nothing', async () => {
      for (const role of ['Project Manager', 'Accountant', 'Purchasing', 'Site Supervisor', 'Client', 'Contractor']) expect((await as[role].get('/api/owner/center')).status, role).toBe(403);
      const admin = await center(as['Admin']);
      expect(Array.isArray(admin.high_risk) && Array.isArray(admin.recently_delegated)).toBe(true);
    });
  });

  // ================================================================ exception lifecycle
  describe('Owner exception lifecycle', () => {
    const exc = async (state?: string) => (await owner().get(`/api/owner/exceptions${state ? `?state=${state}` : ''}`).expect(200)).body as Row;
    const act = (action: string, body: Row, agent = owner()) => agent.post(`/api/owner/exceptions/${action}`).send(body);
    const history = async (id: string) => (await owner().get(`/api/owner/exceptions/history?id=${encodeURIComponent(id)}`).expect(200)).body as Row;
    const sync = () => engine.runRule('exception_lifecycle', 'manual');
    const setRisk = (id: string, level: string) => db.pool.query(`UPDATE projects SET risk_status = $2, risk_reason = 'test signal' WHERE id = $1`, [id, level]);
    const riskKey = () => `project:${P.risk}:At Risk`;
    const critKey = () => `project:${P.crit}:Critical`;

    it('records new exceptions; viewing never writes', async () => {
      await setRisk(P.risk, 'At Risk');
      await setRisk(P.crit, 'Critical');
      await sync();
      const before = await q(`SELECT exception_key, last_activity_at, version FROM owner_exception_states WHERE exception_key = ANY($1)`, [[riskKey(), critKey()]]);
      expect(before).toHaveLength(2);
      for (let i = 0; i < 3; i++) await exc();
      expect(await q(`SELECT exception_key, last_activity_at, version FROM owner_exception_states WHERE exception_key = ANY($1)`, [[riskKey(), critKey()]])).toEqual(before);
      const e = (await exc()).exceptions.find((x: Row) => x.id === riskKey());
      expect(e).toMatchObject({ severity: 'urgent', lifecycle: { state: 'active', tracked: true } });
      expect((await history(riskKey())).events.map((x: Row) => x.action)).toEqual(['observed']);
    });

    it('acknowledge → wait (reason) → acknowledge → resolve, each recorded with who, when and why', async () => {
      expect((await act('acknowledge', { id: riskKey() }).expect(200)).body).toMatchObject({ state: 'acknowledged', changed: true });
      expect((await act('wait', { id: riskKey() })).status).toBe(400); // what are we waiting for?
      await act('wait', { id: riskKey(), reason: 'Waiting for the client to sign the revised scope' }).expect(200);
      expect((await exc()).exceptions.find((x: Row) => x.id === riskKey()).lifecycle).toMatchObject({ state: 'waiting', waiting_for: 'Waiting for the client to sign the revised scope' });
      await act('acknowledge', { id: riskKey() }).expect(200);
      await act('resolve', { id: riskKey(), reason: 'Scope signed' }).expect(200);
      const h = await history(riskKey());
      expect(h.events.map((x: Row) => [x.action, x.from_state, x.to_state])).toEqual([
        ['observed', null, 'active'],
        ['acknowledge', 'active', 'acknowledged'],
        ['wait', 'acknowledged', 'waiting'],
        ['acknowledge', 'waiting', 'acknowledged'],
        ['resolve', 'acknowledged', 'resolved'],
      ]);
      expect(h.events[2]).toMatchObject({ actor: { id: 'user-owner', role: 'Owner / CEO' }, reason: 'Waiting for the client to sign the revised scope' });
      expect((await q(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'owner_exception' AND entity_id = $1`, [riskKey()]))[0].n).toBe(4);
      // Resolved, non-critical: moves to the closed list (still discoverable), not deleted.
      const now = await exc();
      expect(ids(now.exceptions)).not.toContain(riskKey());
      expect(now.closed.find((x: Row) => x.id === riskKey())).toMatchObject({ state: 'resolved', present: true });
    });

    it('invalid transitions are refused; reopening is explicit with a reason; recurrence never reopens', async () => {
      const ackResolved = await act('acknowledge', { id: riskKey() });
      expect(ackResolved.status, JSON.stringify(ackResolved.body)).toBe(400); // resolved → acknowledge
      expect((await act('dismiss', { id: riskKey(), reason: 'x' })).status).toBe(400);
      expect((await act('reopen', { id: riskKey() })).status).toBe(400); // reason required
      await act('reopen', { id: riskKey(), reason: 'Client withdrew the signature' }).expect(200);
      // A replayed reopen (already active) changes nothing and records nothing.
      const evs = (await history(riskKey())).events.length;
      expect((await act('reopen', { id: riskKey(), reason: 'again' }).expect(200)).body.changed).toBe(false);
      expect((await history(riskKey())).events.length).toBe(evs);
      expect((await act('resolve', { id: riskKey() }).expect(200)).body.state).toBe('resolved');
      expect((await act('wait', { id: riskKey(), reason: 'x' })).status).toBe(400); // resolved → wait
      await act('reopen', { id: riskKey(), reason: 'Not actually fixed' }).expect(200);
      expect((await act('frobnicate', { id: riskKey() })).status).toBe(404);
      expect((await act('acknowledge', { id: 'project:nope:At Risk' })).status).toBe(404);
      // Condition clears → resolved by NW OS; comes back → only "recurred", still resolved.
      await setRisk(P.risk, 'On Track');
      await sync();
      expect((await history(riskKey())).events.at(-1)).toMatchObject({ action: 'auto_resolve', to_state: 'resolved', actor: { name: 'NW OS' } });
      await setRisk(P.risk, 'At Risk');
      await sync();
      const h = await history(riskKey());
      expect(h.state).toBe('resolved');
      expect(h.events.at(-1)).toMatchObject({ action: 'recurred', to_state: 'resolved' });
      // A cleared condition cannot be reopened.
      await setRisk(P.risk, 'On Track');
      await sync();
      expect((await act('reopen', { id: riskKey(), reason: 'x' })).status).toBe(400);
      await setRisk(P.risk, 'At Risk');
      await sync();
      await act('reopen', { id: riskKey(), reason: 'Back again' }).expect(200);
    });

    it('dismissal needs a reason; a critical exception can never be dismissed or snoozed, even with forged fields', async () => {
      expect((await act('dismiss', { id: riskKey() })).status).toBe(400);
      expect((await act('dismiss', { id: riskKey(), reason: '   ' })).status).toBe(400);
      await act('dismiss', { id: riskKey(), reason: 'Known; the PM has a recovery plan' }).expect(200);
      const crit = (await exc()).exceptions.find((x: Row) => x.id === critKey());
      expect(crit.severity).toBe('critical');
      const refused = await act('dismiss', { id: critKey(), reason: 'Not important' });
      expect(refused.status).toBe(400);
      expect(refused.body.message).toMatch(/critical exception cannot be dismissed/);
      expect((await act('dismiss', { id: critKey(), reason: 'x', severity: 'info' })).status).toBe(400);
      expect((await act('dismiss', { id: critKey(), reason: 'x', state: 'dismissed', actor: 'user-pm' })).status).toBe(400);
      expect((await owner().post('/api/owner/exceptions/snooze').send({ id: critKey(), hours: 4, reason: 'later' })).status).toBe(400);
      // ...but it can be acknowledged, put on waiting and resolved — and stays visible while present.
      await act('acknowledge', { id: critKey() }).expect(200);
      await act('wait', { id: critKey(), reason: 'Waiting for the structural engineer' }).expect(200);
      await act('resolve', { id: critKey(), reason: 'Engineer signed off' }).expect(200);
      const e = (await exc()).exceptions.find((x: Row) => x.id === critKey());
      expect(e.lifecycle.state).toBe('resolved');
      expect((await q(`SELECT state FROM owner_exception_states WHERE exception_key = $1`, [critKey()]))[0].state).toBe('resolved');
    });

    it('an approval exception resolves by deciding the approval, not by "resolve"', async () => {
      const vo = await variation(P.own, 1200);
      const id = `approval:variation:${vo}`;
      expect(ids((await exc()).exceptions)).toContain(id);
      const r = await act('resolve', { id, reason: 'done' });
      expect(r.status).toBe(400);
      expect(r.body.message).toMatch(/decide it on its record/);
      await act('acknowledge', { id }).expect(200);
      await owner().post(`/api/variations/${vo}/transition`).send({ status: 'Client Approval' }).expect(200);
      await sync();
      expect((await history(id)).events.at(-1)).toMatchObject({ action: 'auto_resolve', from_state: 'acknowledged', to_state: 'resolved' });
    });

    it('stale after 14 days without meaningful activity; still listed, never "resolved"; any action moves it on', async () => {
      expect(STALE_DAYS).toBe(14);
      await setRisk(P.risk, 'At Risk');
      await sync();
      await db.pool.query(`UPDATE owner_exception_states SET last_activity_at = now() - interval '13 days' WHERE exception_key = $1`, [riskKey()]);
      await sync();
      expect((await q(`SELECT state FROM owner_exception_states WHERE exception_key = $1`, [riskKey()]))[0].state).toBe('dismissed'); // dismissed above: not eligible
      await act('reopen', { id: riskKey(), reason: 'Look again' }).expect(200);
      await db.pool.query(`UPDATE owner_exception_states SET last_activity_at = now() - interval '13 days' WHERE exception_key = $1`, [riskKey()]);
      await sync();
      expect((await q(`SELECT state FROM owner_exception_states WHERE exception_key = $1`, [riskKey()]))[0].state).toBe('active'); // 13 days: not yet
      await db.pool.query(`UPDATE owner_exception_states SET last_activity_at = now() - interval '15 days' WHERE exception_key = $1`, [riskKey()]);
      for (let i = 0; i < 5; i++) await exc(); // polling is not activity
      await sync();
      await sync(); // idempotent
      const listed = (await exc()).exceptions.find((x: Row) => x.id === riskKey());
      expect(listed.lifecycle.state).toBe('stale');
      expect(ids((await exc('stale')).exceptions)).toContain(riskKey());
      expect((await exc('stale')).exceptions.every((x: Row) => x.lifecycle.state === 'stale')).toBe(true);
      expect((await exc('resolved')).closed.some((x: Row) => x.id === riskKey())).toBe(false);
      expect((await history(riskKey())).events.filter((x: Row) => x.action === 'stale')).toHaveLength(1);
      await act('acknowledge', { id: riskKey() }).expect(200);
      expect((await owner().get('/api/owner/exceptions?state=bogus')).status).toBe(400);
    });

    it('a material change is activity; repeats and replays add nothing', async () => {
      await db.pool.query(`UPDATE owner_exception_states SET last_activity_at = now() - interval '10 days' WHERE exception_key = $1`, [riskKey()]);
      await db.pool.query(`UPDATE owner_exception_states SET fingerprint = 'old' WHERE exception_key = $1`, [riskKey()]);
      await sync();
      const row = (await q(`SELECT last_activity_at FROM owner_exception_states WHERE exception_key = $1`, [riskKey()]))[0];
      expect(Date.now() - new Date(row.last_activity_at).getTime()).toBeLessThan(60_000);
      const before = (await history(riskKey())).events.length;
      for (let i = 0; i < 3; i++) expect((await act('acknowledge', { id: riskKey() }).expect(200)).body.changed).toBe(false);
      expect((await history(riskKey())).events.length).toBe(before);
    });

    it('concurrent updates: one wins, the rest are no-ops or conflicts; history loses nothing', async () => {
      await act('wait', { id: riskKey(), reason: 'Waiting on the PM' }).expect(200);
      const same = await Promise.all(Array.from({ length: 6 }, () => act('acknowledge', { id: riskKey(), expected_state: 'waiting' })));
      const statuses = same.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      expect(statuses.every((s) => s === 200 || s === 409)).toBe(true);
      expect(same.filter((r) => r.status === 200 && r.body.changed)).toHaveLength(1);
      // Two different actions racing from the same state: exactly one applies.
      await act('wait', { id: riskKey(), reason: 'Waiting on the PM again' }).expect(200);
      const race = await Promise.all([act('resolve', { id: riskKey(), reason: 'fixed', expected_state: 'waiting' }), act('dismiss', { id: riskKey(), reason: 'noise', expected_state: 'waiting' })]);
      expect(race.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(race.find((r) => r.status === 409)!.body.error).toBe('conflict');
      const h = await history(riskKey());
      expect(h.events.filter((x: Row) => ['resolve', 'dismiss'].includes(x.action) && x.from_state === 'waiting' && x.reason !== null).length).toBeGreaterThanOrEqual(1);
      // Every recorded transition chains: each from_state is the previous to_state.
      const owners = h.events.filter((x: Row) => x.actor.role !== 'system' || x.from_state !== null);
      for (let i = 1; i < owners.length; i++) if (owners[i].from_state !== null) expect(owners[i].from_state).toBe(owners[i - 1].to_state);
    });

    it('history and records cannot be changed or deleted; un-snooze keeps the snooze', async () => {
      await expect(db.pool.query(`UPDATE owner_exception_events SET reason = 'x' WHERE exception_key = $1`, [riskKey()])).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`DELETE FROM owner_exception_events WHERE exception_key = $1`, [riskKey()])).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`DELETE FROM owner_exception_states WHERE exception_key = $1`, [riskKey()])).rejects.toThrow(/never deleted/);
      // Snooze a non-critical exception, then un-snooze: both in its history, the row kept.
      const id = (await exc()).exceptions.find((x: Row) => x.severity !== 'critical' && x.lifecycle.state !== 'resolved')!.id as string;
      await owner().post('/api/owner/exceptions/snooze').send({ id, hours: 2, reason: 'After the site meeting' }).expect(200);
      await owner().delete(`/api/owner/exceptions/snooze/${encodeURIComponent(id)}`).expect(200);
      expect((await q(`SELECT count(*)::int AS n FROM owner_exception_snoozes WHERE exception_key = $1`, [id]))[0].n).toBe(1);
      expect((await history(id)).events.map((x: Row) => x.action)).toEqual(expect.arrayContaining(['snooze', 'unsnooze']));
      await expect(db.pool.query(`DELETE FROM owner_exception_snoozes WHERE exception_key = $1`, [id])).rejects.toThrow(/never deleted/);
    });

    it('only the Owner may act or read history; everyone else is refused', async () => {
      for (const role of ['Admin', 'Project Manager', 'Accountant', 'Client', 'Contractor']) {
        expect((await act('acknowledge', { id: riskKey() }, as[role])).status, role).toBe(403);
        expect((await as[role].get(`/api/owner/exceptions/history?id=${encodeURIComponent(riskKey())}`)).status, role).toBe(403);
        expect((await as[role].get('/api/owner/exceptions')).status, role).toBe(403);
      }
    });
  });
});
