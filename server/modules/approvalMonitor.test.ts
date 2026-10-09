import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { seedUsers, signIn } from '../test/app';
import { withTransaction } from '../db/pool';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { reevaluateRoutes, unroutedDecisions } from './approvalRouting';
import { addBusinessDays, businessElapsedMs, DAY_MS, loadCalendar, type BusinessCalendar } from './businessCalendar';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 4: proactive approval management (monitor, escalation, re-routing, Owner exceptions)', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let raiser: request.Agent;
  let engine: AutomationEngine;
  let cal: BusinessCalendar;
  let clock = new Date();
  beforeAll(async () => {
    let app: Parameters<typeof request>[0];
    ({ db, as, app } = (await setupDemoWorld()) as never);
    // Raises the test variations (a PM on the project who never decides their own), so the
    // delegated PM and the Owner may both decide them.
    await seedUsers(db.pool, [{ id: 'user-raiser', role: 'Project Manager', email: 'raiser@test.local' }]);
    raiser = await signIn(app as never, 'raiser@test.local');
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-pm2', 'Second PM', 'pm2@test.local', 'x', 'Project Manager', true), ('user-pm3', 'Third PM', 'pm3@test.local', 'x', 'Project Manager', true)`);
    engine = new AutomationEngine(db.pool, () => clock);
    await ensureRules(db.pool);
    cal = await loadCalendar(db.pool);
  });
  afterAll(async () => {
    await engine?.stop();
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  const future = new Date(Date.now() + 120 * 86400_000).toISOString();
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  /** A fresh Normal project managed by the PM, with the second and third PM assigned. */
  const newProject = async () => {
    const id = next('proj-b4');
    await owner().post('/api/projects').send({ id, project_number: id.toUpperCase(), project_name: id, client_id: 'client-2', site_address: 'KL', contract_value: 1, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-pm2'), ($1, 'user-pm3'), ($1, 'user-raiser') ON CONFLICT DO NOTHING`, [id]);
    return id;
  };
  const grant = async (projectId: string, over: Row = {}) =>
    (await owner().post('/api/authority/rules').send({ name: 'PM variations', description: 'Routine variations', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: projectId, end_at: future, priority: 200, ...over }).expect(201)).body as Row;
  const variation = async (projectId: string, amount = 1000) => {
    const id = next('vo-b4');
    await raiser.post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: 'Extra shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    return id;
  };
  const approvalRequest = async (projectId: string, over: Row = {}) => {
    const id = next('apr-b4');
    await as['Project Manager']
      .post('/api/approvals')
      .send({ id, approval_number: id.toUpperCase(), approval_type: 'Technical Change', title: 'Request', description: 'x', project_id: projectId, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '', ...over })
      .expect(201);
    return id;
  };
  const route = async (kind: string, id: string) => (await db.pool.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 AND status = 'open'`, [kind, id])).rows[0] as Row;
  const routes = async (kind: string, id: string) => (await db.pool.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 ORDER BY id`, [kind, id])).rows as Row[];
  /** The instant a route reaches `pct` percent of its SLA (working time), plus a minute. */
  const at = (r: Row, pct: number) => new Date(addBusinessDays(cal, new Date(r.requested_at), (Number(r.sla_business_days) * pct) / 100).getTime() + 60_000);
  const monitor = async (when?: Date) => {
    if (when) clock = when;
    return engine.runRule('approval_monitor', 'manual');
  };
  const count = async (sql: string, params: unknown[] = []) => Number((await db.pool.query(sql, params)).rows[0].n);
  const exceptions = async () => (await owner().get('/api/owner/exceptions').expect(200)).body as { summary: Row; exceptions: Row[]; informational: Row[]; snoozed: Row[] };
  const noOrphans = async () => expect(await unroutedDecisions(db.pool)).toEqual([]);
  const approveVo = (role: string, id: string) => as[role].post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' });

  it('the business calendar counts working days only (Sunday and public holidays add nothing)', () => {
    // Saturday 2026-08-29 12:00 MYT + 1 working day: Sunday skipped, Monday 31 Aug is National Day -> Tuesday.
    const sat = new Date('2026-08-29T04:00:00Z');
    expect(addBusinessDays(cal, sat, 1).toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(businessElapsedMs(cal, sat, new Date('2026-09-01T04:00:00Z'))).toBe(DAY_MS);
  });

  describe('acceptance tests', () => {
    let P = '';
    let rule: Row;
    let vo = '';

    it('1. Normal approval: routed to the delegated PM, in their inbox with a due date, no Owner exception', async () => {
      P = await newProject();
      rule = await grant(P);
      vo = await variation(P);
      const r = await route('variation', vo);
      expect(r).toMatchObject({ assigned_user_id: 'user-pm', routing_basis: 'PROJECT_ROLE_RULE', lifecycle_state: 'assigned', route_reason: 'initial', reroute_count: 0, escalation_count: 0 });
      expect(Number(r.sla_business_days)).toBe(2);
      expect(new Date(r.due_at).getTime()).toBe(addBusinessDays(cal, new Date(r.requested_at), 2).getTime());
      const mine = ((await as['Project Manager'].get('/api/approval-routing/inbox').expect(200)).body.items as Row[]).find((i) => i.resource_id === vo)!;
      expect(mine.lifecycle).toMatchObject({ status: 'Assigned', reroute_count: 0, escalation_count: 0, overdue_hours: null });
      expect(mine.lifecycle.due_at).toBe(new Date(r.due_at).toISOString());
      expect((await exceptions()).exceptions.find((e) => e.id === `approval:variation:${vo}`)).toBeUndefined();
      const run = await monitor(new Date());
      expect(run.status).toBe('succeeded');
      expect((await route('variation', vo)).id).toBe(r.id); // a valid, on-time route is left alone
    });

    it('2. Reminder: one reminder at the threshold; a second run sends nothing more', async () => {
      const r = await route('variation', vo);
      await monitor(at(r, 55));
      expect(await route('variation', vo)).toMatchObject({ lifecycle_state: 'reminded', assigned_user_id: 'user-pm' });
      const key = `approval_monitor:variation:${vo}:reminded:user-pm`;
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key = $1`, [key])).toBe(1);
      await monitor(at(r, 60));
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key = $1`, [key])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM automation_actions WHERE action_key = $1`, [key])).toBe(1);
    });

    it('3. Overdue: the status moves on, the approver is told once, and the Owner sees it as an exception', async () => {
      const r = await route('variation', vo);
      await monitor(at(r, 105));
      const now = await route('variation', vo);
      expect(now).toMatchObject({ lifecycle_state: 'overdue', assigned_user_id: 'user-pm' });
      expect(now.due_soon_at).not.toBeNull();
      expect(now.overdue_at).not.toBeNull();
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key = $1`, [`approval_monitor:variation:${vo}:overdue:user-pm`])).toBe(1);
      const e = (await exceptions()).exceptions.find((x) => x.id === `approval:variation:${vo}`)!;
      expect(e).toMatchObject({ type: 'OVERDUE_APPROVAL', severity: 'urgent', status: 'Overdue', current_approver: { id: 'user-pm' } });
      expect(e.reasons.map((x: Row) => x.code)).toContain('OVERDUE');
      expect(e.recommended).toMatch(/Chase/);
    });

    it('4. Escalation: past the threshold it goes to the Owner, once, with an escalation record and audit; re-evaluation does not undo it', async () => {
      const r = await route('variation', vo);
      const run = await monitor(at(r, 155));
      expect(run.status).toBe('succeeded');
      const esc = await route('variation', vo);
      expect(esc).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'ESCALATED_OVERDUE', route_reason: 'escalated_overdue', lifecycle_state: 'escalated', escalation_count: 1, reroute_count: 0 });
      expect(new Date(esc.requested_at).getTime()).toBe(new Date(r.requested_at).getTime()); // the clock carried over
      const audit = (await db.pool.query(`SELECT action, details, after FROM audit_logs WHERE entity_type = 'approval_route' AND entity_id = $1`, [String(esc.id)])).rows[0];
      expect(audit).toMatchObject({ action: 'approval.route.escalate', after: { reason: 'escalated_overdue', assignee: 'user-owner' } });
      expect(audit.details).toMatch(/Overdue by/);
      const records = (await db.pool.query(`SELECT id, status, level FROM escalations WHERE source_record_id = $1`, [vo])).rows;
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ status: 'Open', level: 2 });
      // The PM is told it moved; the Owner is notified.
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE user_id = 'user-pm' AND rule_key = $1`, [`approval-route:${esc.id}:moved`])).toBe(1);
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE user_id = 'user-owner' AND rule_key = $1`, [`approval-route:${esc.id}`])).toBe(1);
      // Again: nothing new.
      await monitor(at(r, 170));
      expect((await routes('variation', vo)).length).toBe(2);
      expect(await count(`SELECT count(*) AS n FROM escalations WHERE source_record_id = $1`, [vo])).toBe(1);
      // A full re-evaluation keeps the escalation (the PM could still decide, but it was escalated).
      await owner().post('/api/approval-routing/reevaluate').send({ project_id: P }).expect(200);
      expect((await route('variation', vo)).id).toBe(esc.id);
      // History tells the story.
      const h = (await owner().get(`/api/approval-routing/history?kind=variation&id=${vo}`).expect(200)).body.timeline as Row[];
      const steps = h.map((x) => x.action);
      expect(steps[0]).toMatch(/^Routed to /);
      expect(steps.some((s) => /^Reminder sent to user-pm/.test(s))).toBe(true);
      expect(steps.some((s) => /^Overdue notice sent/.test(s))).toBe(true);
      expect(steps.some((s) => /^Escalated to /.test(s))).toBe(true);
      // The Owner decides: the escalation is resolved on the next run.
      await approveVo('Owner / CEO', vo).expect(200); // the resolver allows the Owner
      expect((await routes('variation', vo)).at(-1)).toMatchObject({ status: 'completed', completion_result: 'approved', completed_by: 'user-owner' });
      await monitor();
      expect((await db.pool.query(`SELECT status FROM escalations WHERE source_record_id = $1`, [vo])).rows[0].status).toBe('Resolved');
    });

    it('4b. Escalation to the next eligible delegate when the SLA policy says so (Owner only if none)', async () => {
      await owner().put('/api/authority/sla/variation').send({ escalate_to: 'next_eligible', reason: 'Try the second PM first' }).expect(200);
      try {
        const id = await variation(P);
        const r = await route('variation', id);
        expect(r.assigned_user_id).toBe('user-pm');
        await monitor(at(r, 155));
        expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-pm2', route_reason: 'escalated_overdue', lifecycle_state: 'escalated', owner_reason_code: null });
        clock = new Date();
      } finally {
        await owner().put('/api/authority/sla/variation').send({ escalate_to: 'owner', reason: 'Back to the default' }).expect(200);
      }
    });

    it('5. Authority expiry: the PM is refused and the monitor re-routes it with the reason (a re-route, not an escalation)', async () => {
      const Q = await newProject();
      const short = await grant(Q, { name: 'Short PM authority' });
      const id = await variation(Q);
      expect((await route('variation', id)).authority_rule_id).toBe(short.id);
      await db.pool.query(`UPDATE delegated_authorities SET start_at = now() - interval '9 days', end_at = now() - interval '1 minute' WHERE id = $1`, [short.id]);
      const refused = await approveVo('Project Manager', id);
      expect(refused.status).toBe(403);
      expect(refused.body.reason_code).toBe('AUTHORITY_EXPIRED');
      // Nothing else re-evaluated it: the monitor is what notices.
      expect((await route('variation', id)).assigned_user_id).toBe('user-pm');
      await monitor(new Date());
      const now = await route('variation', id);
      expect(now).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'AUTHORITY_EXPIRED', route_reason: 'authority_changed', reroute_count: 1, escalation_count: 0 });
      const audit = (await db.pool.query(`SELECT action, details FROM audit_logs WHERE entity_type = 'approval_route' AND entity_id = $1`, [String(now.id)])).rows[0];
      expect(audit.action).toBe('approval.route.reroute');
      expect(audit.details).toMatch(/AUTHORITY_EXPIRED/);
      await noOrphans();
    });

    it('6. Normal -> Sensitive: the protected approval goes to the Owner; the PM is refused; the monitor finds nothing more to do', async () => {
      const Q = await newProject();
      await grant(Q);
      const id = await variation(Q);
      expect((await route('variation', id)).assigned_user_id).toBe('user-pm');
      await owner().put(`/api/projects/${Q}/sensitivity`).send({ sensitivity: 'Sensitive', reason: 'Board asked' }).expect(200);
      const r = await route('variation', id);
      expect(r).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'SENSITIVITY_BLOCKED' });
      expect((await approveVo('Project Manager', id)).body.reason_code).toBe('SENSITIVITY_BLOCKED');
      await monitor(new Date());
      expect((await route('variation', id)).id).toBe(r.id);
      // The Owner cannot hand a Sensitive protected approval to the PM either.
      const assign = await owner().post('/api/approval-routing/assign').send({ kind: 'variation', id, user_id: 'user-pm', reason: 'try' });
      expect(assign.status).toBe(400);
      expect(assign.body.message ?? assign.body.error).toMatch(/SENSITIVITY_BLOCKED/);
    });

    it('7. Normal -> Strategic: every internal approval on the project routes to the Owner, and shows as critical', async () => {
      const Q = await newProject();
      await grant(Q);
      const id = await variation(Q);
      const req = await approvalRequest(Q);
      await owner().put(`/api/projects/${Q}/sensitivity`).send({ sensitivity: 'Strategic', reason: 'Board-level' }).expect(200);
      for (const [kind, rid] of [['variation', id], ['approval', req]]) expect((await route(kind, rid)).assigned_user_id).toBe('user-owner');
      const fresh = await variation(Q);
      expect(await route('variation', fresh)).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'SENSITIVITY_BLOCKED', project_sensitivity: 'Strategic' });
      const e = (await exceptions()).exceptions.find((x) => x.id === `approval:approval:${req}`)!;
      expect(e.severity).toBe('critical');
      expect(e.reasons.map((x: Row) => x.code)).toContain('STRATEGIC');
    });

    it('8. User deactivation: the assigned delegate is deactivated; the monitor re-routes it; no orphan', async () => {
      const Q = await newProject();
      await grant(Q, { name: 'PM2 by name', target_role: undefined, target_user_id: 'user-pm2', priority: 210 });
      const id = await variation(Q);
      expect((await route('variation', id)).assigned_user_id).toBe('user-pm2');
      await db.pool.query(`UPDATE users SET is_active = false WHERE id = 'user-pm2'`); // directly: no API re-evaluation
      try {
        await monitor(new Date());
        const r = await route('variation', id);
        expect(r.assigned_user_id).not.toBe('user-pm2');
        expect(r.route_reason).toBe('authority_changed');
        const audit = (await db.pool.query(`SELECT details FROM audit_logs WHERE entity_type = 'approval_route' AND entity_id = $1`, [String(r.id)])).rows[0];
        expect(audit.details).toMatch(/APPROVER_INACTIVE/);
        await noOrphans();
      } finally {
        await db.pool.query(`UPDATE users SET is_active = true WHERE id = 'user-pm2'`);
      }
    });

    it('9. Permission removal: the delegate loses the baseline permission; the monitor re-routes it', async () => {
      const Q = await newProject();
      await grant(Q, { name: 'PM3 by name', target_role: undefined, target_user_id: 'user-pm3', priority: 220 });
      const id = await variation(Q);
      expect((await route('variation', id)).assigned_user_id).toBe('user-pm3');
      await db.pool.query(`UPDATE users SET role = 'Production Staff' WHERE id = 'user-pm3'`);
      try {
        await monitor(new Date());
        const r = await route('variation', id);
        expect(r.assigned_user_id).not.toBe('user-pm3');
        expect(r.route_reason).toBe('authority_changed');
        await noOrphans();
      } finally {
        await db.pool.query(`UPDATE users SET role = 'Project Manager' WHERE id = 'user-pm3'`);
      }
    });

    it('10. No delegate: the Owner receives it and it is an Owner exception explaining why', async () => {
      const Q = await newProject();
      const req = await approvalRequest(Q);
      expect(await route('approval', req)).toMatchObject({ assigned_user_id: 'user-owner', routing_basis: 'OWNER_FALLBACK' });
      const e = (await exceptions()).exceptions.find((x) => x.id === `approval:approval:${req}`)!;
      expect(e).toMatchObject({ type: 'OWNER_DECISION', status: 'Owner Required', current_approver: { id: 'user-owner' } });
      expect(e.why_owner).toMatch(/Routed to you/);
      expect(e.reasons[0].code).toBe('OWNER_REQUIRED');
      expect(e.actions).toEqual(expect.arrayContaining(['open', 'approve', 'reject', 'request_changes', 'assign', 'reroute']));
    });

    it('11. Multiple Owners: the primary Owner receives Owner fallbacks; without a primary, the highest priority; only the Owner configures it', async () => {
      const Q = await newProject();
      await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-owner2', 'Second Owner', 'owner2@test.local', 'x', 'Owner / CEO', true)`);
      try {
        const before = await approvalRequest(Q);
        expect((await route('approval', before)).assigned_user_id).toBe('user-owner'); // equal priority: user id, as before
        expect((await as['Admin'].put('/api/authority/owner-routing').send({ owners: [{ id: 'user-owner2', owner_priority: 0, is_primary_owner: true }] })).status).toBe(403);
        const set = (await owner().put('/api/authority/owner-routing').send({ owners: [{ id: 'user-owner2', owner_priority: 0, is_primary_owner: true }] }).expect(200)).body;
        expect(set.receives_fallbacks.id).toBe('user-owner2');
        expect((await route('approval', before)).assigned_user_id).toBe('user-owner2'); // re-routed with the policy change
        const req = await approvalRequest(Q);
        expect((await route('approval', req)).assigned_user_id).toBe('user-owner2');
        // No primary: the highest priority wins.
        await owner().put('/api/authority/owner-routing').send({ owners: [{ id: 'user-owner2', owner_priority: 5, is_primary_owner: false }, { id: 'user-owner', owner_priority: 10, is_primary_owner: false }] }).expect(200);
        expect((await route('approval', req)).assigned_user_id).toBe('user-owner');
        expect((await db.pool.query(`SELECT action FROM audit_logs WHERE action = 'authority.owner_routing.update'`)).rowCount).toBe(2);
        // Two primaries are refused.
        expect((await owner().put('/api/authority/owner-routing').send({ owners: [{ id: 'user-owner2', owner_priority: 0, is_primary_owner: true }, { id: 'user-owner', owner_priority: 0, is_primary_owner: true }] })).status).toBe(400);
      } finally {
        await db.pool.query(`UPDATE users SET is_active = false, owner_priority = 0, is_primary_owner = false WHERE id = 'user-owner2'`);
        await db.pool.query(`UPDATE users SET owner_priority = 0, is_primary_owner = false WHERE id = 'user-owner'`);
        await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test cleanup' }));
      }
    });

    it('12. Duplicate scheduler: two engines at once and repeated runs create no duplicate reminder, escalation or route', async () => {
      const Q = await newProject();
      await grant(Q);
      const id = await variation(Q);
      const r = await route('variation', id);
      clock = at(r, 160);
      const other = new AutomationEngine(db.pool, () => clock);
      const results = await Promise.all([engine.runRule('approval_monitor', 'manual'), other.runRule('approval_monitor', 'manual')]);
      expect(results.map((x) => x.status).sort()).toEqual(['skipped', 'succeeded']);
      const snapshot = async () => ({
        routes: (await routes('variation', id)).length,
        escalations: await count(`SELECT count(*) AS n FROM escalations WHERE source_record_id = $1`, [id]),
        notes: await count(`SELECT count(*) AS n FROM notifications WHERE rule_key LIKE $1 OR rule_key LIKE 'approval-route:%' AND entity_id IN (SELECT id::text FROM approval_routes WHERE resource_id = $2)`, [`approval_monitor:variation:${id}:%`, id]),
        open: await count(`SELECT count(*) AS n FROM approval_routes WHERE status = 'open'`),
      });
      const first = await snapshot();
      expect(first.routes).toBe(2);
      expect(first.escalations).toBe(1);
      await monitor();
      await other.runRule('approval_monitor', 'manual');
      expect(await snapshot()).toEqual(first);
      clock = new Date();
    });

    it('13. Notification failure: the approval stays assigned, the failure is logged, the next run delivers it once', async () => {
      const Q = await newProject();
      await grant(Q);
      const id = await variation(Q);
      const r = await route('variation', id);
      await db.owner.query(`CREATE FUNCTION b4_fail_note() RETURNS trigger AS $$ BEGIN IF NEW.rule_key LIKE 'approval_monitor:variation:${id}:%' THEN RAISE EXCEPTION 'simulated notification failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await db.owner.query(`CREATE TRIGGER b4_fail_note BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION b4_fail_note()`);
      let run;
      try {
        run = await monitor(at(r, 55));
      } finally {
        await db.owner.query(`DROP TRIGGER b4_fail_note ON notifications; DROP FUNCTION b4_fail_note()`);
      }
      expect(run.status).toBe('failed');
      expect(run.error).toMatch(/simulated notification failure/);
      expect((await db.pool.query(`SELECT error FROM automation_runs WHERE id = $1`, [run.run_id])).rows[0].error).toMatch(/simulated/);
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-pm', lifecycle_state: 'reminded', status: 'open' });
      const key = `approval_monitor:variation:${id}:reminded:user-pm`;
      expect(await count(`SELECT count(*) AS n FROM automation_actions WHERE action_key = $1`, [key])).toBe(0);
      expect((await monitor()).status).toBe('succeeded');
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key = $1`, [key])).toBe(1);
      await monitor();
      expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key = $1`, [key])).toBe(1);
      clock = new Date();
    });

    it('14. Routing failure: with no Owner to fall back to, the re-route rolls back, the approval keeps its route, the run is failed and retried', async () => {
      const Q = await newProject();
      const short = await grant(Q, { name: 'Ends soon' });
      const id = await variation(Q);
      const before = await route('variation', id);
      await db.pool.query(`UPDATE delegated_authorities SET start_at = now() - interval '9 days', end_at = now() - interval '1 minute' WHERE id = $1`, [short.id]);
      await db.pool.query(`UPDATE users SET is_active = false WHERE role = 'Owner / CEO'`);
      let run;
      try {
        run = await monitor(new Date());
        expect(run.status).toBe('failed');
        expect(run.error).toMatch(/No active Owner/);
        expect((await route('variation', id)).id).toBe(before.id); // rolled back: never orphaned
        await noOrphans();
      } finally {
        await db.pool.query(`UPDATE users SET is_active = true WHERE id = 'user-owner'`);
      }
      expect((await monitor()).status).toBe('succeeded');
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'AUTHORITY_EXPIRED' });
    });

    it('15. Owner Exception: a critical blocked approval appears with the right severity, explainable reasons and actions; it cannot be snoozed', async () => {
      const Q = await newProject();
      const req = await approvalRequest(Q, { approval_type: 'Safety-Critical Decision', title: 'Temporary works sign-off' });
      const ex = await exceptions();
      const e = ex.exceptions.find((x) => x.id === `approval:approval:${req}`)!;
      expect(e).toMatchObject({ severity: 'critical', project_id: Q, decision: 'approval_request', current_approver: { id: 'user-owner' } });
      expect(e.reasons.map((x: Row) => x.code)).toEqual(expect.arrayContaining(['OWNER_REQUIRED', 'SAFETY']));
      expect(e.priority_score).toBe(e.reasons.reduce((s: number, x: Row) => s + x.points, 0));
      expect(e.actions).toContain('approve');
      expect(ex.summary.critical).toBeGreaterThanOrEqual(1);
      // Critical items come first.
      expect(ex.exceptions[0].severity).toBe('critical');
      const snooze = await owner().post('/api/owner/exceptions/snooze').send({ id: e.id, hours: 24, reason: 'later' });
      expect(snooze.status).toBe(400);
      // A non-critical one can be snoozed (bounded, with a reason, audited) and comes back after.
      const plain = await approvalRequest(Q);
      const pid = `approval:approval:${plain}`;
      expect((await owner().post('/api/owner/exceptions/snooze').send({ id: pid, hours: 500, reason: 'x' })).status).toBe(400);
      expect((await owner().post('/api/owner/exceptions/snooze').send({ id: pid, hours: 4 })).status).toBe(400);
      await owner().post('/api/owner/exceptions/snooze').send({ id: pid, hours: 4, reason: 'Waiting for the engineer' }).expect(200);
      const after = await exceptions();
      expect(after.exceptions.find((x) => x.id === pid)).toBeUndefined();
      expect(after.snoozed.find((x) => x.id === pid)).toMatchObject({ snoozed_until: expect.any(String) });
      expect((await db.pool.query(`SELECT details FROM audit_logs WHERE action = 'owner_exception.snooze' AND entity_id = $1`, [pid])).rows[0].details).toBe('Waiting for the engineer');
      // The Owner decides through the normal endpoint (the resolver checks again); it leaves the list.
      await owner().post(`/api/approvals/${req}/decision`).send({ decision: 'Approved' }).expect(200);
      const done = await exceptions();
      expect(done.exceptions.find((x) => x.id === e.id)).toBeUndefined();
      expect(done.informational.find((x) => x.id === `done:approval:${req}`)).toMatchObject({ type: 'APPROVAL_COMPLETED' });
    });

    it('16. Resolver re-check: forged approval and assignment requests through the API are refused', async () => {
      const Q = await newProject();
      const req = await approvalRequest(Q);
      const pm = as['Project Manager'];
      const forged = await pm.post(`/api/approvals/${req}/decision`).send({ decision: 'Approved', assigned_user_id: 'user-pm', routing_basis: 'USER_RULE', authority_rule_id: 'x', role: 'Owner / CEO' });
      expect(forged.status).toBe(403);
      expect((await route('approval', req)).assigned_user_id).toBe('user-owner');
      expect((await db.pool.query(`SELECT decision FROM approvals WHERE id = $1`, [req])).rows[0].decision).toBe('Pending');
    });
  });

  describe('security', () => {
    it('only the Owner sees the Owner Exception Center (not Admin, PM, client or contractor)', async () => {
      for (const role of ['Admin', 'Project Manager', 'Accountant', 'Client', 'Contractor']) expect((await as[role].get('/api/owner/exceptions')).status, role).toBe(403);
      expect((await as['Admin'].post('/api/owner/exceptions/snooze').send({ id: 'x', hours: 1, reason: 'x' })).status).toBe(403);
    });

    it('only the Owner changes the Owner routing policy and SLAs (Admin may read them)', async () => {
      await as['Admin'].get('/api/authority/owner-routing').expect(200);
      await as['Admin'].get('/api/authority/sla').expect(200);
      expect((await as['Project Manager'].get('/api/authority/sla')).status).toBe(403);
      expect((await as['Admin'].put('/api/authority/sla/variation').send({ sla_business_days: 9, reason: 'x' })).status).toBe(403);
      expect((await as['Project Manager'].put('/api/authority/owner-routing').send({ owners: [] })).status).toBe(403);
      // Validated: thresholds in order, no unknown fields, a reason.
      expect((await owner().put('/api/authority/sla/variation').send({ due_soon_pct: 40, reason: 'x' })).status).toBe(400);
      expect((await owner().put('/api/authority/sla/variation').send({ sla_business_days: 3, assigned_user_id: 'x', reason: 'x' })).status).toBe(400);
      expect((await owner().put('/api/authority/sla/variation').send({ sla_business_days: 3 })).status).toBe(400);
    });

    it('a non-owner cannot assign an approval (to themselves or anyone), force escalation or choose the Owner fallback', async () => {
      const P = (await db.pool.query(`SELECT project_id FROM approval_routes WHERE status = 'open' AND resource_kind = 'approval' AND project_id IS NOT NULL ORDER BY id DESC LIMIT 1`)).rows[0].project_id;
      const id = (await db.pool.query(`SELECT resource_id FROM approval_routes WHERE status = 'open' AND resource_kind = 'approval' AND project_id = $1 ORDER BY id DESC LIMIT 1`, [P])).rows[0].resource_id;
      for (const role of ['Project Manager', 'Admin', 'Accountant']) {
        expect((await as[role].post('/api/approval-routing/assign').send({ kind: 'approval', id, user_id: (await db.pool.query(`SELECT id FROM users WHERE role = $1 LIMIT 1`, [role])).rows[0].id, reason: 'mine' })).status, role).toBe(403);
      }
      // Routing basis, fallback, rule and escalation reason are never accepted from the browser, even from the Owner.
      for (const extra of [{ routing_basis: 'OWNER_FALLBACK' }, { authority_rule_id: 'sys-x' }, { route_reason: 'escalated_overdue' }, { owner_reason_code: 'ESCALATED_OVERDUE' }]) {
        expect((await owner().post('/api/approval-routing/assign').send({ kind: 'approval', id, user_id: 'user-owner', reason: 'x', ...extra })).status).toBe(400);
      }
      // A PM cannot force a run (or re-route); Admin running the monitor escalates nothing that is not overdue.
      expect((await as['Project Manager'].post('/api/automation/run')).status).toBe(403);
      expect((await as['Project Manager'].post('/api/approval-routing/route').send({ kind: 'approval', id })).status).toBe(403);
      const escalations = await count(`SELECT count(*) AS n FROM approval_routes WHERE route_reason = 'escalated_overdue'`);
      await as['Admin'].post('/api/automation/run').expect(200);
      expect(await count(`SELECT count(*) AS n FROM approval_routes WHERE route_reason = 'escalated_overdue'`)).toBe(escalations);
    });

    it('the Owner can only assign to someone the resolver allows; the assignment sticks and is audited', async () => {
      const P = (await db.pool.query(`SELECT id FROM projects WHERE id LIKE 'proj-b4-%' AND sensitivity = 'Normal' ORDER BY id LIMIT 1`)).rows[0].id;
      const id = `vo-b4-assign`;
      await raiser.post('/api/variations').send({ id, variation_number: 'VO-B4-ASSIGN', project_id: P, project_name: 'P', title: 'Assign test', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 500, status: 'Internal Approval', created_at: '' }).expect(201);
      const start = await route('variation', id);
      // The client and a contractor are never assignable; someone the resolver refuses neither.
      expect((await owner().post('/api/approval-routing/assign').send({ kind: 'variation', id, user_id: 'user-client', reason: 'x' })).status).toBe(400);
      expect((await owner().post('/api/approval-routing/assign').send({ kind: 'variation', id, user_id: 'user-site', reason: 'x' })).status).toBe(400);
      const target = start.assigned_user_id === 'user-pm' ? 'user-pm2' : 'user-pm';
      const res = (await owner().post('/api/approval-routing/assign').send({ kind: 'variation', id, user_id: target, reason: 'Balance the workload' }).expect(200)).body;
      expect(res).toMatchObject({ assignee: { id: target }, current: expect.any(Object) });
      expect(await route('variation', id)).toMatchObject({ assigned_user_id: target, route_reason: 'owner_assigned' });
      await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test' }));
      expect((await route('variation', id)).assigned_user_id).toBe(target);
      expect((await db.pool.query(`SELECT details FROM audit_logs WHERE action = 'approval.route.reroute' AND after->>'resource' = $1 ORDER BY id DESC LIMIT 1`, [`variation:${id}`])).rows[0].details).toMatch(/Balance the workload/);
    });

    it('cross-project and portal isolation: no one outside the project sees its history; clients and contractors see no internal approvals', async () => {
      const other = (await db.pool.query(`SELECT resource_kind, resource_id FROM approval_routes WHERE project_id = 'proj-x' AND status = 'open' LIMIT 1`)).rows[0];
      if (other) expect((await as['Project Manager'].get(`/api/approval-routing/history?kind=${other.resource_kind}&id=${other.resource_id}`)).status).toBe(404);
      const anyInternal = (await db.pool.query(`SELECT resource_kind, resource_id FROM approval_routes WHERE status = 'open' AND routing_basis <> 'CLIENT_CONSENT' AND project_id = 'proj-1' LIMIT 1`)).rows[0];
      expect((await as['Contractor'].get('/api/approval-routing/inbox').expect(200)).body.items).toEqual([]);
      const client = (await as['Client'].get('/api/approval-routing/inbox').expect(200)).body.items as Row[];
      expect(client.every((i) => i.routing_basis === 'CLIENT_CONSENT')).toBe(true);
      if (anyInternal) {
        expect((await as['Client'].get(`/api/approval-routing/history?kind=${anyInternal.resource_kind}&id=${anyInternal.resource_id}`)).status).toBeGreaterThanOrEqual(403);
        expect((await as['Contractor'].get(`/api/approval-routing/history?kind=${anyInternal.resource_kind}&id=${anyInternal.resource_id}`)).status).toBeGreaterThanOrEqual(403);
      }
    });

    it('closed projects: pending approvals go to the Owner for review (never deleted), with no reminders', async () => {
      const Q = await newProject();
      await grant(Q);
      const id = await variation(Q);
      await db.pool.query(`UPDATE projects SET project_status = 'Closed' WHERE id = $1`, [Q]);
      await monitor(new Date());
      const r = await route('variation', id);
      expect(r).toMatchObject({ assigned_user_id: 'user-owner', owner_reason_code: 'PROJECT_CLOSED', route_reason: 'project_closed' });
      expect((await db.pool.query(`SELECT status FROM variations WHERE id = $1`, [id])).rows[0].status).toBe('Internal Approval');
      await monitor(at(r, 200));
      expect(await route('variation', id)).toMatchObject({ id: r.id, lifecycle_state: r.lifecycle_state });
      const e = (await exceptions()).exceptions.find((x) => x.id === `approval:variation:${id}`)!;
      expect(e.reasons.map((x: Row) => x.code)).toContain('PROJECT_CLOSED');
      clock = new Date();
    });

    it('routes created before SLAs existed get their SLA and due date on the first check', async () => {
    const r = (await db.pool.query(`SELECT * FROM approval_routes WHERE status = 'open' AND routing_basis <> 'CLIENT_CONSENT' ORDER BY id LIMIT 1`)).rows[0];
    await db.pool.query(`UPDATE approval_routes SET sla_business_days = NULL, due_at = NULL, last_checked_at = NULL WHERE id = $1`, [r.id]);
    await monitor(new Date());
    const after = (await db.pool.query(`SELECT * FROM approval_routes WHERE id = $1`, [r.id])).rows[0];
    const sla = Number((await db.pool.query(`SELECT sla_business_days FROM approval_sla_policies WHERE decision_type = $1`, [r.decision_type])).rows[0].sla_business_days);
    expect(Number(after.sla_business_days)).toBe(sla);
    expect(new Date(after.due_at).getTime()).toBe(addBusinessDays(cal, new Date(after.requested_at), sla).getTime());
  });

  it('the invariant holds at the end: every pending approval has an open route to an active person', async () => {
      await noOrphans();
      expect(await count(`SELECT count(*) AS n FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.status = 'open' AND NOT u.is_active`)).toBe(0);
    });
  });
});
