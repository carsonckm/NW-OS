import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { seedUsers, signIn } from '../test/app';
import { withTransaction } from '../db/pool';
import { AccessContext } from '../auth/access';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { reevaluateRoutes, unroutedDecisions } from './approvalRouting';
import { resolveApprovalAuthority } from './authorityResolver';

type Row = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)('Phase 6 batch 6: delegation coverage, temporary authority and Owner absence', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let raiser: request.Agent;
  let engine: AutomationEngine;
  let A = '';
  let S = '';
  let T = '';
  beforeAll(async () => {
    let app: Parameters<typeof request>[0];
    ({ db, as, app } = (await setupDemoWorld()) as never);
    await withTransaction(db.pool, (c) => reevaluateRoutes(c, { name: 'test start' }));
    await seedUsers(db.pool, [{ id: 'user-raiser', role: 'Project Manager', email: 'raiser@test.local' }]);
    raiser = await signIn(app as never, 'raiser@test.local');
    await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-gone', 'Former PM', 'gone@test.local', 'x', 'Project Manager', false)`);
    await ensureRules(db.pool);
    engine = new AutomationEngine(db.pool);
    A = await newProject('a');
    S = await newProject('s');
    T = await newProject('t');
    await owner().put(`/api/projects/${S}/sensitivity`).send({ sensitivity: 'Sensitive', reason: 'Board asked' }).expect(200);
    await owner().put(`/api/projects/${T}/sensitivity`).send({ sensitivity: 'Strategic', reason: 'Board-level' }).expect(200);
  });
  afterAll(async () => {
    await engine?.stop();
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  async function newProject(tag: string) {
    const id = next(`proj-b6${tag}`);
    await owner().post('/api/projects').send({ id, project_number: id.toUpperCase(), project_name: `B6 ${tag.toUpperCase()}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-raiser') ON CONFLICT DO NOTHING`, [id]);
    return id;
  }
  const variation = async (projectId: string, amount: number) => {
    const id = next('vo-b6');
    await raiser.post('/api/variations').send({ id, variation_number: id.toUpperCase(), project_id: projectId, project_name: 'P', title: 'Shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }).expect(201);
    return id;
  };
  const route = async (kind: string, id: string) => (await db.pool.query(`SELECT ar.*, u.role AS assignee_role FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE resource_kind = $1 AND resource_id = $2 AND status = 'open'`, [kind, id])).rows[0] as Row;
  const approveVo = (role: string, id: string) => as[role].post(`/api/variations/${id}/transition`).send({ status: 'Client Approval' });
  const coverage = async () => (await owner().get('/api/authority/coverage').expect(200)).body as { cells: Row[]; health: Row; gaps: Row[]; conflicts: Row[] };
  const cell = (c: Row[], type: string, test: (x: Row) => boolean = () => true) => c.filter((x) => x.decision_type === type && x.scope === 'Normal').find(test)!;
  const future = (ms: number) => new Date(Date.now() + ms).toISOString();
  const DAY = 86400_000;
  /** Preview, then create temporary authority with the server's confirmation (the normal flow). */
  const temporary = async (body: Row) => {
    const pr = await owner().post('/api/authority/temporary/preview').send(body);
    if (pr.status !== 200) throw new Error(`preview ${pr.status}: ${JSON.stringify(pr.body)}`);
    const prev = pr.body;
    return (await owner().post('/api/authority/temporary').send({ ...body, confirmation: prev.confirmation }).expect(201)).body as Row;
  };
  const watch = () => engine.runRule('delegation_watch', 'manual');
  const count = async (sql: string, params: unknown[] = []) => Number((await db.pool.query(sql, params)).rows[0].n);
  const noOrphans = async () => expect(await unroutedDecisions(db.pool)).toEqual([]);
  const permanent = async (over: Row = {}) => (await owner().post('/api/authority/rules').send({ name: 'PM variations', description: 'Routine variations', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', max_value: 20000, priority: 150, ...over }).expect(201)).body as Row;

  let pmRule: Row;

  it('1. Coverage: a PM variation delegation up to RM 20,000 shows Covered (from the rule), above it Uncovered; System Policy shows Owner Only', async () => {
    pmRule = await permanent();
    const c = await coverage();
    const low = cell(c.cells, 'variation', (x) => x.value_to === 20000);
    expect(low).toMatchObject({ status: 'Covered', value_from: 0, value_label: 'up to RM 20,000', rules: [pmRule.code] });
    expect(low.approvers.find((a: Row) => a.role === 'Project Manager').users).toBeGreaterThanOrEqual(2);
    expect(cell(c.cells, 'variation', (x) => x.value_from === 20000)).toMatchObject({ status: 'Uncovered', value_to: null });
    // Purchases of RM 20,000+ are reserved for the Owner by SYS-PURCHASE-MAJOR (the Accountant only by request).
    const major = cell(c.cells, 'purchase', (x) => x.value_from === 20000);
    // Above it: only by an approved Major Purchase request (Accountant) or a prior Owner approval.
    expect(major).toMatchObject({ status: 'Partially Covered', value_to: null });
    expect(major.reasons.join(' ')).toMatch(/only applies when/);
    expect(cell(c.cells, 'purchase', (x) => x.value_to === 20000)).toMatchObject({ status: 'Covered', value_label: 'up to RM 20,000' });
    // Sensitive / Strategic rows: the ceiling.
    expect(c.cells.find((x) => x.decision_type === 'drawing' && x.scope === 'Sensitive')).toMatchObject({ status: 'Blocked by Sensitivity' });
    expect(c.cells.find((x) => x.decision_type === 'variation' && x.scope === 'Strategic')).toMatchObject({ status: 'Blocked by Sensitivity' });
    expect(c.health.definition).toMatch(/÷ cells that may be delegated/);
    expect(c.health.overall_percent).toBeGreaterThan(0);
  });

  it('2. Coverage gap: the delegate goes, coverage becomes Uncovered, the Owner sees an exception and is told once', async () => {
    await owner().post(`/api/authority/rules/${pmRule.id}/deactivate`).send({ reason: 'test gap' }).expect(200);
    const vo = await variation(A, 5000);
    expect((await route('variation', vo)).assignee_role).toBe('Owner / CEO');
    const c = await coverage();
    const gap = c.gaps.find((g) => g.decision_type === 'variation' && g.status === 'Uncovered')!;
    expect(gap).toMatchObject({ scope: 'Normal projects, any amount', recommended_action: expect.stringMatching(/Create a delegation/) });
    expect(gap.pending_affected).toBeGreaterThanOrEqual(1);
    const ex = (await owner().get('/api/owner/exceptions').expect(200)).body.exceptions as Row[];
    expect(ex.find((e) => e.type === 'COVERAGE_GAP' && e.decision === 'variation')).toMatchObject({ severity: 'urgent', link: { tab: 'authority' } });
    await watch();
    await watch();
    expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key LIKE 'delegation_watch:coverage:variation|Normal|%:Uncovered:%' AND user_id = 'user-owner'`)).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'delegation.coverage.change' AND entity_id LIKE 'variation|Normal|%'`)).toBeGreaterThanOrEqual(1);
  });

  let temp: Row;
  it('3. Temporary authority: 7 days for one PM on one project up to RM 10,000; valid decisions route to them, outside scope does not', async () => {
    temp = await temporary({ decision_type: 'variation', target_user_id: 'user-pm', project_id: A, max_value: 10000, max_risk: 'Attention', end_at: future(7 * DAY), reason: 'Owner travelling' });
    expect(temp).toMatchObject({ authority_type: 'temporary', priority: 150, target_user_id: 'user-pm', project_id: A });
    expect((await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [temp.id])).rows.map((r) => r.action)).toEqual(expect.arrayContaining(['authority.rule.create', 'authority.temporary.create']));
    const ok = await variation(A, 8000);
    expect(await route('variation', ok)).toMatchObject({ assigned_user_id: 'user-pm', authority_rule_id: temp.id });
    const big = await variation(A, 15000);
    expect((await route('variation', big)).assignee_role).toBe('Owner / CEO');
    const r = await approveVo('Project Manager', big);
    expect(r.status).toBe(403);
    // The temporary rule's limit fails; the deactivated permanent PM rule ranks first in the reason precedence.
    expect(['VALUE_LIMIT_EXCEEDED', 'AUTHORITY_DEACTIVATED']).toContain(r.body.reason_code);
    await approveVo('Project Manager', ok).expect(200);
    const list = (await owner().get('/api/authority/temporary').expect(200)).body;
    expect(list.active.find((x: Row) => x.id === temp.id)).toMatchObject({ state: 'active', expires_in: '7 days', reason: 'Owner travelling' });
  });

  it('5. Extension: previewed, with a reason; a new rule replaces the old one; audited; the resolver uses the new end', async () => {
    expect((await owner().post(`/api/authority/temporary/${temp.id}/extend`).send({ end_at: future(10 * DAY), reason: 'Trip extended' })).status).toBe(400);
    expect((await owner().post(`/api/authority/temporary/${temp.id}/extend/preview`).send({ end_at: future(10 * DAY) })).status).toBe(400);
    const prev = (await owner().post(`/api/authority/temporary/${temp.id}/extend/preview`).send({ end_at: future(10 * DAY), reason: 'Trip extended' }).expect(200)).body;
    const ext = (await owner().post(`/api/authority/temporary/${temp.id}/extend`).send({ end_at: prev.rule.end_at, reason: 'Trip extended', confirmation: prev.confirmation }).expect(201)).body;
    expect(ext).toMatchObject({ authority_type: 'temporary', extended_from: temp.id, active: true });
    expect(new Date(ext.end_at).getTime()).toBeGreaterThan(new Date(temp.end_at).getTime());
    expect((await db.pool.query(`SELECT active, deactivation_reason FROM delegated_authorities WHERE id = $1`, [temp.id])).rows[0]).toEqual({ active: false, deactivation_reason: 'Replaced by its extension' });
    expect((await db.pool.query(`SELECT before, after, details FROM audit_logs WHERE action = 'authority.temporary.extend' AND entity_id = $1`, [ext.id])).rows[0]).toMatchObject({ details: 'Trip extended', after: { extended_from: temp.code } });
    const vo = await variation(A, 3000);
    expect(await route('variation', vo)).toMatchObject({ assigned_user_id: 'user-pm', authority_rule_id: ext.id });
    // No silent extension: temporary authority is not edited or reactivated in place.
    expect((await owner().patch(`/api/authority/rules/${ext.id}`).send({ end_at: future(80 * DAY), change_reason: 'longer' })).status).toBe(400);
    expect((await owner().post(`/api/authority/rules/${temp.id}/reactivate`).send({ reason: 'again' })).status).toBe(400);
    temp = ext;
  });

  it('4 + 18. Expiry: once the end passes the resolver refuses, the watch switches it off and the pending approval re-routes (never orphaned)', async () => {
    const short = await temporary({ decision_type: 'variation', target_user_id: 'user-pm', project_id: await newProject('x'), max_value: 5000, end_at: future(2500), reason: 'Short cover' });
    const vo = await variation(short.project_id, 2000);
    expect(await route('variation', vo)).toMatchObject({ assigned_user_id: 'user-pm', authority_rule_id: short.id });
    await sleep(2800);
    const refused = await approveVo('Project Manager', vo);
    expect(refused.status).toBe(403);
    expect(refused.body.reason_code).toBe('AUTHORITY_EXPIRED');
    expect((await watch()).status).toBe('succeeded');
    expect((await db.pool.query(`SELECT active, expiry_processed_at IS NOT NULL AS processed, deactivation_reason FROM delegated_authorities WHERE id = $1`, [short.id])).rows[0]).toEqual({ active: false, processed: true, deactivation_reason: 'Expired' });
    expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'authority.temporary.expire' AND entity_id = $1`, [short.id])).toBe(1);
    const r = await route('variation', vo);
    expect(r).toMatchObject({ assignee_role: 'Owner / CEO', routing_basis: 'OWNER_FALLBACK', owner_reason_code: 'AUTHORITY_EXPIRED' });
    await noOrphans();
    // A second watch run does nothing more.
    await watch();
    expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'authority.temporary.expire' AND entity_id = $1`, [short.id])).toBe(1);
    // Expired authority receives nothing new.
    const fresh = await variation(short.project_id, 1000);
    expect((await route('variation', fresh)).assignee_role).toBe('Owner / CEO');
  });

  it('exact boundaries: active from its start instant, expired at its end instant (server time)', async () => {
    const t = (await db.pool.query(`SELECT start_at, end_at FROM delegated_authorities WHERE id = $1`, [temp.id])).rows[0];
    const vo = await variation(A, 1000);
    const pm = (await db.pool.query(`SELECT * FROM users WHERE id = 'user-pm'`)).rows[0];
    const ctx = await AccessContext.load(db.pool, pm);
    const at = async (when: Date) => resolveApprovalAuthority(db.pool, ctx, { resource: { kind: 'variation', id: vo }, now: when });
    expect((await at(new Date(t.start_at))).allowed).toBe(true);
    expect((await at(new Date(new Date(t.end_at).getTime() - 1))).allowed).toBe(true);
    const atEnd = await at(new Date(t.end_at));
    expect(atEnd.allowed).toBe(false);
    expect(atEnd.reasonCode).toBe('AUTHORITY_EXPIRED');
    expect((await at(new Date(new Date(t.start_at).getTime() - 1))).reasonCode).not.toBe('ALLOWED');
  });

  it('6–9 + conflicts B–E. Temporary authority is refused on Sensitive / Strategic projects, without the permission, for inactive users, without a limit, or beyond System Policy', async () => {
    const base = { decision_type: 'variation', target_user_id: 'user-pm', max_value: 5000, end_at: future(3 * DAY), reason: 'cover' };
    const sensitive = await owner().post('/api/authority/temporary/preview').send({ ...base, project_id: S });
    expect(sensitive.status).toBe(400);
    expect(sensitive.body.message).toMatch(/Sensitive/);
    const strategic = await owner().post('/api/authority/temporary/preview').send({ ...base, project_id: T });
    expect(strategic.status).toBe(400);
    expect(strategic.body.message).toMatch(/Strategic/);
    const perm = await owner().post('/api/authority/temporary/preview').send({ ...base, target_user_id: 'user-site' });
    expect(perm.status).toBe(400);
    expect(perm.body.message).toMatch(/variations.review/);
    const inactive = await owner().post('/api/authority/temporary/preview').send({ ...base, target_user_id: 'user-gone' });
    expect(inactive.status).toBe(400);
    expect(inactive.body.message).toMatch(/deactivated/);
    expect((await owner().post('/api/authority/temporary/preview').send({ ...base, target_user_id: 'user-client' })).status).toBe(400);
    expect((await owner().post('/api/authority/temporary/preview').send({ ...base, max_value: undefined })).body.message).toMatch(/needs a value limit/);
    const beyond = await owner().post('/api/authority/temporary/preview').send({ decision_type: 'purchase', target_role: 'Purchasing', max_value: 25000, end_at: future(3 * DAY), reason: 'cover' });
    expect(beyond.status).toBe(400);
    expect(beyond.body.message).toMatch(/Exceeds permanent authority: SYS-PURCHASE-MAJOR/);
    expect((await owner().post('/api/authority/temporary/preview').send({ ...base, end_at: future(100 * DAY) })).body.message).toMatch(/at most 90 days/);
    expect((await owner().post('/api/authority/temporary/preview').send({ ...base, reason: '' })).status).toBe(400);
  });

  let absence: Row;
  it('10. Absence: preview (delegated / not delegated / impact), confirm; configured decisions route to the backup, others stay with the Owner', async () => {
    const body = { backup_user_id: 'user-pm2', decision_types: ['variation', 'purchase'], max_value: 10000, max_risk: 'Attention', end_at: future(5 * DAY), reason: 'Overseas trip' };
    await db.pool.query(`INSERT INTO users (id, name, email, password_hash, role, is_active) VALUES ('user-pm2', 'Backup PM', 'pm2@test.local', 'x', 'Project Manager', true)`);
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-pm2')`, [A]);
    // The Owner's own extension above covers the PM on project A; use a project the PM rule does not cover.
    const B = await newProject('b');
    await db.pool.query(`INSERT INTO project_assignments (project_id, user_id) VALUES ($1, 'user-pm2')`, [B]);
    const waiting = await variation(B, 4000);
    expect((await route('variation', waiting)).assignee_role).toBe('Owner / CEO');
    const prev = (await owner().post('/api/authority/absence/preview').send(body).expect(200)).body;
    expect(prev.backup).toMatchObject({ id: 'user-pm2', role: 'Project Manager' });
    expect(prev.delegated.map((d: Row) => d.decision_type)).toEqual(['variation', 'purchase']);
    expect(prev.not_delegated.join(' | ')).toMatch(/Drawing approval \(not chosen\).*Strategic projects: B6 T.*Sensitive projects: B6 S/);
    expect(prev.impact).toMatchObject({ estimated: true, decision_types_covered: 2 });
    expect(prev.impact.pending_that_would_route_to_backup).toBeGreaterThanOrEqual(1);
    expect((await owner().post('/api/authority/absence').send({ ...body, confirmation: 'x' })).status).toBe(400);
    absence = (await owner().post('/api/authority/absence').send({ ...body, confirmation: prev.confirmation }).expect(201)).body;
    expect(absence).toMatchObject({ status: 'active' });
    expect(absence.rules.map((r: Row) => r.decision_type)).toEqual(['variation', 'purchase']);
    expect(await route('variation', waiting)).toMatchObject({ assigned_user_id: 'user-pm2' });
    const big = await variation(B, 15000);
    expect((await route('variation', big)).assignee_role).toBe('Owner / CEO');
    expect((await db.pool.query(`SELECT action, details FROM audit_logs WHERE action = 'owner_absence.activate' AND entity_id = $1`, [absence.id])).rows[0].details).toBe('Overseas trip');
    expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key = $1`, [`delegation_watch:absence:${absence.id}:started`])).toBeGreaterThanOrEqual(2);
    // An overlapping absence is refused; the backup is never another Owner.
    expect((await owner().post('/api/authority/absence/preview').send(body)).status).toBe(400);
    expect((await owner().post('/api/authority/absence/preview').send({ ...body, backup_user_id: 'user-owner' })).status).toBe(400);
  });

  it('12. The backup cannot decide outside the configured limit (the resolver refuses)', async () => {
    const B = (await db.pool.query(`SELECT project_id FROM delegated_authorities WHERE absence_id = $1 LIMIT 1`, [absence.id])).rows[0]?.project_id;
    expect(B ?? null).toBeNull(); // global scope
    const rule = (await db.pool.query(`SELECT * FROM delegated_authorities WHERE absence_id = $1 AND decision_type = 'variation'`, [absence.id])).rows[0];
    expect(Number(rule.max_value)).toBe(10000);
    const pm2 = (await db.pool.query(`SELECT * FROM users WHERE id = 'user-pm2'`)).rows[0];
    const ctx = await AccessContext.load(db.pool, pm2);
    const vo = (await db.pool.query(`SELECT resource_id FROM approval_routes WHERE status = 'open' AND resource_kind = 'variation' AND value = 15000 ORDER BY id DESC LIMIT 1`)).rows[0].resource_id;
    const r = await resolveApprovalAuthority(db.pool, ctx, { resource: { kind: 'variation', id: vo } });
    expect(r.allowed).toBe(false);
    expect(['VALUE_LIMIT_EXCEEDED', 'AUTHORITY_DEACTIVATED']).toContain(r.reasonCode);
    expect(r.rules.find((x) => x.rule_code === rule.code)).toMatchObject({ applies: false, reason_code: 'VALUE_LIMIT_EXCEEDED' });
  });

  it('11. Absence ends: its authority is switched off, pending approvals re-evaluate and go back to the Owner', async () => {
    const waiting = (await db.pool.query(`SELECT resource_id FROM approval_routes WHERE status = 'open' AND assigned_user_id = 'user-pm2' AND resource_kind = 'variation' LIMIT 1`)).rows[0].resource_id;
    expect((await owner().post(`/api/authority/absence/${absence.id}/end`).send({})).status).toBe(400);
    const res = (await owner().post(`/api/authority/absence/${absence.id}/end`).send({ reason: 'Back early' }).expect(200)).body;
    expect(res).toMatchObject({ status: 'ended' });
    expect(res.routing_changes.rerouted).toBeGreaterThanOrEqual(1);
    expect(await count(`SELECT count(*) AS n FROM delegated_authorities WHERE absence_id = $1 AND active`, [absence.id])).toBe(0);
    expect((await route('variation', waiting)).assignee_role).toBe('Owner / CEO');
    expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'owner_absence.end' AND entity_id = $1`, [absence.id])).toBe(1);
    await noOrphans();
    // An absence that runs out on its own is ended by the watch.
    const prev = (await owner().post('/api/authority/absence/preview').send({ backup_user_id: 'user-pm2', decision_types: ['variation'], max_value: 5000, end_at: future(2500), reason: 'Short trip' }).expect(200)).body;
    const short = (await owner().post('/api/authority/absence').send({ backup_user_id: 'user-pm2', decision_types: ['variation'], max_value: 5000, end_at: prev.period.end_at, reason: 'Short trip', confirmation: prev.confirmation }).expect(201)).body;
    await sleep(2800);
    await watch();
    expect((await db.pool.query(`SELECT status FROM owner_absences WHERE id = $1`, [short.id])).rows[0].status).toBe('ended');
    expect(await count(`SELECT count(*) AS n FROM delegated_authorities WHERE absence_id = $1 AND active`, [short.id])).toBe(0);
    await noOrphans();
  });

  it('13. Conflicts: overlapping rules are listed with the one that applies; the resolver picks it deterministically', async () => {
    const C = await newProject('c');
    const wide = await permanent({ name: 'PM up to 20k on C', project_id: C, priority: 150 });
    const narrow = await permanent({ name: 'PM up to 10k on C', project_id: C, max_value: 10000, priority: 200 });
    const conflict = (await coverage()).conflicts.find((x) => x.rules.includes(wide.code) && x.rules.includes(narrow.code))!;
    expect(conflict).toMatchObject({ selected: narrow.code, message: expect.stringMatching(/highest priority rule applies/) });
    const vo = await variation(C, 5000);
    const res = (await as['Project Manager'].get(`/api/authority/resolve?items=variation:${vo}`).expect(200)).body[0];
    expect(res).toMatchObject({ allowed: true, matched_rule_code: narrow.code });
    const vo2 = await variation(C, 15000);
    expect((await as['Project Manager'].get(`/api/authority/resolve?items=variation:${vo2}`).expect(200)).body[0]).toMatchObject({ allowed: true, matched_rule_code: wide.code });
  });

  it('14. Delegation effectiveness: delegated, Owner fallback (with reasons), escalated and turnaround per delegation', async () => {
    const e = (await owner().get('/api/authority/effectiveness').expect(200)).body;
    const t = e.delegations.find((d: Row) => d.code === temp.code) ?? e.delegations.find((d: Row) => d.authority_type === 'temporary' && d.delegated > 0);
    expect(t).toBeTruthy();
    const originalId = (await db.pool.query(`SELECT extended_from FROM delegated_authorities WHERE id = $1`, [temp.id])).rows[0].extended_from;
    const original = e.delegations.find((d: Row) => d.rule_id === originalId);
    expect(original).toMatchObject({ delegated: 1 });
    expect(original.approvals).toBeGreaterThanOrEqual(1);
    expect(e.note).toMatch(/not a measure of any person/);
    // A delegation whose decisions mostly returned to the Owner is flagged (5+ decisions, 30%+ fallback).
    const D = await newProject('d');
    const rule = await permanent({ name: 'PM up to 3k on D', project_id: D, max_value: 3000, max_risk: 'Critical', priority: 150 });
    for (let i = 0; i < 6; i++) {
      const vo = await variation(D, 1000 + i);
      if (i < 2) await approveVo('Project Manager', vo).expect(200);
      else {
        await owner().post(`/api/approval-routing/assign`).send({ kind: 'variation', id: vo, user_id: 'user-owner', reason: 'I take it' }).expect(200);
        await approveVo('Owner / CEO', vo).expect(200);
      }
    }
    const eff = (await owner().get('/api/authority/effectiveness').expect(200)).body.delegations.find((d: Row) => d.rule_id === rule.id);
    expect(eff).toMatchObject({ approvals: 6, delegated: 2, owner_fallback: 4, percent_delegated: 33.3, owner_fallback_rate: 66.7 });
    expect(eff.fallback_reasons[0]).toMatchObject({ reason: 'Owner decided it anyway', count: 4 });
    expect(eff.finding).toMatch(/covers only part of the observed workload: 4 of 6/);
    const ex = (await owner().get('/api/owner/exceptions').expect(200)).body.exceptions as Row[];
    expect(ex.find((x) => x.id === `delegation:${rule.id}:ineffective`)).toMatchObject({ type: 'DELEGATION_INEFFECTIVE', severity: 'attention' });
  });

  it('15. Recommendations see coverage: temporary cover is shown, only permanent authority counts as delegated, nothing is granted automatically', async () => {
    const R = await newProject('r');
    for (let i = 1; i <= 6; i++) {
      const vo = await variation(R, i * 1000);
      await approveVo('Owner / CEO', vo).expect(200);
      await db.pool.query(`UPDATE approval_routes SET requested_at = now() - make_interval(days => $2, hours => 2), completed_at = now() - make_interval(days => $2) WHERE resource_id = $1 AND status = 'completed'`, [vo, i * 2]);
    }
    const rules = await count(`SELECT count(*) AS n FROM delegated_authorities`);
    const rec = async () => {
      await owner().post('/api/delegation/recommendations/generate').send({}).expect(200);
      return (await owner().get('/api/delegation/recommendations').expect(200)).body;
    };
    let l = await rec();
    let r = l.active.find((x: Row) => x.decision_type === 'variation' && x.project_id === R);
    expect(r).toMatchObject({ coverage_now: 'Owner only' });
    const cover = await temporary({ decision_type: 'variation', target_role: 'Project Manager', project_id: R, max_value: 6000, end_at: future(4 * DAY), reason: 'For now' });
    l = await rec();
    r = l.active.find((x: Row) => x.decision_type === 'variation' && x.project_id === R);
    expect(r.coverage_now).toBe(`temporary (${cover.code})`);
    expect(r.reasons.join(' ')).toMatch(new RegExp(`Currently covered only by temporary authority ${cover.code}`));
    const perm = await permanent({ name: 'PM on R', project_id: R, max_value: 6000 });
    l = await rec();
    expect(l.active.find((x: Row) => x.decision_type === 'variation' && x.project_id === R)).toBeUndefined();
    expect(l.not_recommended.find((x: Row) => x.reason === `Already delegated by ${perm.code}`)).toBeTruthy();
    // Generation created no authority (the two rules above were created by the Owner).
    expect(await count(`SELECT count(*) AS n FROM delegated_authorities`)).toBe(rules + 2);
  });

  it('16. Notification idempotency: reminders before authority ends are sent once per stage, however often the watch runs', async () => {
    const E = await newProject('e');
    const soon = await temporary({ decision_type: 'variation', target_user_id: 'user-pm', project_id: E, max_value: 2000, end_at: future(2 * DAY), reason: 'Two days' });
    await watch();
    await watch();
    await watch();
    expect(await count(`SELECT count(*) AS n FROM notifications WHERE rule_key LIKE $1`, [`delegation_watch:expiry:${soon.id}:%`])).toBe(1);
    expect((await db.pool.query(`SELECT rule_key FROM notifications WHERE rule_key LIKE $1`, [`delegation_watch:expiry:${soon.id}:%`])).rows[0].rule_key).toMatch(/:3$/);
    expect((await owner().get('/api/authority/temporary').expect(200)).body.expiring_soon.find((x: Row) => x.id === soon.id)).toMatchObject({ expires_in: '3 days' });
  });

  describe('17. Security', () => {
    const tempBody = () => ({ decision_type: 'variation', target_user_id: 'user-pm', max_value: 1000, end_at: future(2 * DAY), reason: 'x' });
    it('only the Owner creates, extends or ends temporary authority and absences (Admin, PM, Accountant, Contractor, Client: 403)', async () => {
      const t = (await db.pool.query(`SELECT id FROM delegated_authorities WHERE authority_type = 'temporary' AND active ORDER BY code DESC LIMIT 1`)).rows[0].id;
      const abs = { backup_user_id: 'user-pm', decision_types: ['variation'], max_value: 1000, end_at: future(2 * DAY), reason: 'x' };
      for (const role of ['Admin', 'Project Manager', 'Accountant', 'Contractor', 'Client']) {
        const a = as[role];
        expect((await a.post('/api/authority/temporary/preview').send(tempBody())).status, role).toBe(403);
        expect((await a.post('/api/authority/temporary').send({ ...tempBody(), confirmation: 'x' })).status, role).toBe(403);
        expect((await a.post(`/api/authority/temporary/${t}/extend/preview`).send({ end_at: future(5 * DAY), reason: 'x' })).status, role).toBe(403);
        expect((await a.post(`/api/authority/temporary/${t}/extend`).send({ end_at: future(5 * DAY), reason: 'x', confirmation: 'x' })).status, role).toBe(403);
        expect((await a.post(`/api/authority/temporary/${t}/end`).send({ reason: 'x' })).status, role).toBe(403);
        expect((await a.post('/api/authority/absence/preview').send(abs)).status, role).toBe(403);
        expect((await a.post('/api/authority/absence').send({ ...abs, confirmation: 'x' })).status, role).toBe(403);
        expect((await a.post(`/api/authority/rules`).send({ name: 'x', description: 'x', effect: 'allow', decision_type: 'variation', target_role: role, max_value: 1 })).status, role).toBe(403);
      }
      // Reading coverage needs authority.view (Owner, Admin).
      await as['Admin'].get('/api/authority/coverage').expect(200);
      expect((await as['Project Manager'].get('/api/authority/coverage')).status).toBe(403);
      expect((await as['Client'].get('/api/authority/temporary')).status).toBe(403);
    });

    it('the backup cannot extend or end their own authority, or activate an absence', async () => {
      const own = (await db.pool.query(`SELECT id FROM delegated_authorities WHERE authority_type = 'temporary' AND target_user_id = 'user-pm' AND active ORDER BY code DESC LIMIT 1`)).rows[0].id;
      expect((await as['Project Manager'].post(`/api/authority/temporary/${own}/extend/preview`).send({ end_at: future(20 * DAY), reason: 'mine' })).status).toBe(403);
      expect((await as['Project Manager'].patch(`/api/authority/rules/${own}`).send({ max_value: 99999, change_reason: 'mine' })).status).toBe(403);
      expect((await as['Project Manager'].post('/api/authority/absence/preview').send({ backup_user_id: 'user-pm', decision_types: ['variation'], max_value: 1, end_at: future(DAY), reason: 'x' })).status).toBe(403);
    });

    it('forged fields are refused: authority type, priority, Owner identity, kind, approval of the rule', async () => {
      for (const forged of [{ authority_type: 'permanent' }, { priority: 899 }, { created_by: 'user-pm' }, { granted_by: 'user-pm' }, { kind: 'system' }, { owner_id: 'user-pm' }, { active: true }, { conditions: {} }]) {
        expect((await owner().post('/api/authority/temporary/preview').send({ ...tempBody(), ...forged })).status, JSON.stringify(forged)).toBe(400);
      }
      for (const forged of [{ owner_id: 'user-pm' }, { status: 'active' }, { rules: [] }]) {
        expect((await owner().post('/api/authority/absence/preview').send({ backup_user_id: 'user-pm', decision_types: ['variation'], max_value: 1000, end_at: future(DAY), reason: 'x', ...forged })).status).toBe(400);
      }
      // A changed field after the preview makes the confirmation invalid (value, target, expiry).
      const prev = (await owner().post('/api/authority/temporary/preview').send(tempBody()).expect(200)).body;
      for (const change of [{ max_value: 9000 }, { target_user_id: 'user-raiser' }, { end_at: future(9 * DAY) }, { reason: 'other' }]) {
        expect((await owner().post('/api/authority/temporary').send({ ...tempBody(), ...change, confirmation: prev.confirmation })).status, JSON.stringify(change)).toBe(400);
      }
    });
  });

  it('the invariant holds: every pending approval is routed to an active person', async () => {
    await noOrphans();
    expect(await count(`SELECT count(*) AS n FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.status = 'open' AND NOT u.is_active`)).toBe(0);
  });
});
