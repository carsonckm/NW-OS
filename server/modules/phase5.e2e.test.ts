/**
 * Phase 5 end-to-end acceptance (18 steps): a healthy project runs into real problems, the
 * server-side automation detects them on its own (events and the scheduler, no browser),
 * raises tasks, notifications and escalations, the Owner sees only the exceptions, asks the
 * assistant why, approves one consequential action that the system then executes, and once
 * the people fix the problems the project returns to healthy and the Owner's list clears.
 * Every step is checked against PostgreSQL.
 */
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { demoData } from './demo';

type Row = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 end-to-end acceptance: automation, owner exceptions, AI, back to healthy', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let engine: AutomationEngine;
  const D = demoData();
  const P = 'proj-p5';
  const s: Row = {};
  const owner = () => as['Owner / CEO'];
  const pm = () => as['Project Manager'];
  const site = () => as['Site Supervisor'];
  const prodMgr = () => as['Production Manager'];
  const one = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0] as Row;
  const count = async (sql: string, params: unknown[] = []) => Number((await one(sql, params)).n);
  const ledger = async () => ({
    tasks: await count(`SELECT count(*) AS n FROM tasks WHERE project_id = $1`, [P]),
    notifications: await count(`SELECT count(*) AS n FROM notifications WHERE project_id = $1`, [P]),
    escalations: await count(`SELECT count(*) AS n FROM escalations WHERE project_id = $1`, [P]),
    actions: await count(`SELECT count(*) AS n FROM automation_actions WHERE project_id = $1`, [P]),
  });
  const risk = async () => (await owner().get(`/api/projects/${P}/risk`).expect(200)).body as Row;
  const center = async () => (await owner().get('/api/owner/center').expect(200)).body as Row;
  const mine = (list: Row[]) => list.filter((x) => x.project_id === P);
  const waitFor = async <T>(fn: () => Promise<T | undefined>, ms = 8000) => {
    for (let t = 0; t < ms; t += 100) {
      const v = await fn();
      if (v) return v;
      await sleep(100);
    }
    return undefined;
  };

  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    await ensureRules(db.pool);
    engine = new AutomationEngine(db.pool);
    // A healthy project with an approved drawing, a valid production order and installation under way.
    await owner().post('/api/projects').send({ id: P, project_number: 'NW-P5-1', project_name: 'Phase 5 Gallery', client_id: 'client-2', site_address: 'KL', contract_value: 80000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' }).expect(201);
    await as['Admin'].put('/api/users/user-prod-staff/projects').send({ project_ids: ['proj-1', P] }).expect(200);
    await pm().post('/api/drawings').send({ id: 'p5-dwg', project_id: P, drawing_number: 'P5-101', title: 'Display wall', category: 'Carpentry', created_at: '2026-10-01', revisions: [], nw_production_drawings: [] }).expect(201);
    await pm().post('/api/drawings/p5-dwg/revisions').send({ id: 'p5-rev1', revision: 'Rev 1', title: 'Rev 1', file_url: '/p5.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
    await pm().post('/api/drawings/p5-dwg/revisions/p5-rev1/status').send({ status: 'Internal Review' }).expect(200);
    await owner().post('/api/drawings/p5-dwg/revisions/p5-rev1/status').send({ status: 'Approved' }).expect(200);
    const drawing = (await owner().get('/api/drawings/p5-dwg').expect(200)).body;
    const nw = { ...D.drawings[0].nw_production_drawings[0], id: 'p5-nwd', drawing_number: 'P5-101-NW', linked_client_drawing_id: 'p5-dwg', linked_client_revision: 'Rev 1', status: 'Approved', approved_for_production: true };
    await owner().patch('/api/drawings/p5-dwg').send({ ...drawing, nw_production_drawings: [nw] }).expect(200);
    await pm().post('/api/work-packages').send({ id: 'p5-wp', project_id: P, name: 'GALLERY JOINERY', category: 'Carpentry', contractor_id: 'con-1', project_manager_id: 'user-pm', start_date: '2026-01-01', end_date: '2027-12-01', status: 'Assigned', progress_percent: 0 }).expect(201);
    await pm().post('/api/work-items').send({ id: 'p5-item', work_package_id: 'p5-wp', item_code: 'GAL-01', description: 'Display wall', location: 'L1', quantity: 1, unit: 'unit', drawing_id: 'p5-dwg', drawing_revision: 'Rev 1', material: 'ply', finish: 'oak', dimensions: '3000x2400', required_date: '2027-06-01', contractor_id: 'con-1', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started' }).expect(201);
    await prodMgr().post('/api/production-orders').send({ ...D.productionOrders[0], id: 'p5-po', order_number: 'PO-P5', project_id: P, project_name: 'Phase 5 Gallery', work_package_id: 'p5-wp', work_item_id: 'p5-item', work_item_code: 'GAL-01', contractor_id: 'con-1', status: 'Cutting', current_stage: 'Cutting', required_date: '2027-05-01', approved_client_drawing_id: 'p5-dwg', approved_client_drawing_revision: 'P5-101 Rev 1', approved_nw_production_drawing_id: 'p5-nwd', approved_nw_production_drawing_revision: 'P5-101-NW Rev 1', stage_history: [] }).expect(201);
    await pm().post('/api/installation-jobs').send({ ...D.installationJobs[0], id: 'p5-inst', job_number: 'INS-P5', work_item_id: 'p5-item', work_item_code: 'GAL-01', project_id: P, project_name: 'Phase 5 Gallery', work_package_id: 'p5-wp', contractor_id: 'con-1', site_supervisor_id: 'user-site', status: 'In Progress', planned_start_date: '2026-10-01', planned_completion_date: '2027-11-30' }).expect(201);
    expect((await one(`SELECT drawing_check FROM production_orders WHERE id = 'p5-po'`)).drawing_check).toBe('valid');
    await engine.runAll('schedule');
    expect((await risk()).level).toBe('On Track');
    expect(mine((await center()).critical)).toEqual([]);
    s.baseline = await ledger();
  });
  afterAll(async () => {
    await engine?.stop();
    await db?.close();
  });

  it('1. an event creates a task: production blocked → a task for the production manager, raised by the server on the write', async () => {
    const listening = new AutomationEngine(db.pool);
    await listening.start(3_600_000); // timer effectively off: only the write event can trigger it
    try {
      await sleep(300);
      await prodMgr().patch('/api/production-orders/p5-po').send({ status: 'Blocked', blocked_reason: 'Edge bander down' }).expect(200);
      s.prodTask = await waitFor(async () => (await db.pool.query(`SELECT id, assigned_user_id, status, source_rule FROM tasks WHERE id = 'tsk-auto-prod-p5-po'`)).rows[0]);
    } finally {
      await listening.stop();
    }
    expect(s.prodTask).toMatchObject({ assigned_user_id: 'user-prod-mgr', status: 'Open', source_rule: 'production_blocked' });
    expect((await one(`SELECT trigger FROM automation_runs WHERE rule_key = 'production_blocked' ORDER BY id DESC LIMIT 1`)).trigger).toBe('event');
  });

  it('2. a notification is generated for the right people, grouped and linked', async () => {
    const notes = (await prodMgr().get('/api/notifications').expect(200)).body as Row[];
    const n = notes.find((x) => x.entity_id === 'p5-po' || x.entity_id === 'tsk-auto-prod-p5-po');
    expect(n).toMatchObject({ project_id: P, source: 'production_blocked' });
    expect(n.group).toBeTruthy();
    // Nobody outside the project's scope was told.
    expect(await count(`SELECT count(*) AS n FROM notifications WHERE project_id = $1 AND user_id IN ('user-client', 'user-prod-staff') AND rule_key LIKE 'production_blocked%'`, [P])).toBe(0);
  });

  it('3. scheduled automation runs on the server without any browser', async () => {
    const before = await count(`SELECT count(*) AS n FROM automation_runs WHERE trigger = 'schedule'`);
    const scheduler = new AutomationEngine(db.pool);
    await db.pool.query(`UPDATE automation_rules SET next_run_at = now() - interval '1 second'`);
    const since = await count(`SELECT coalesce(max(id), 0) AS n FROM automation_runs`);
    await scheduler.start(200);
    try {
      // Every rule has a finished scheduled run (started runs are logged as 'running' first).
      await waitFor(async () => (await count(`SELECT count(DISTINCT rule_key) AS n FROM automation_runs WHERE trigger = 'schedule' AND status <> 'running' AND id > $1`, [since])) >= 12 || undefined, 20000);
    } finally {
      await scheduler.stop();
    }
    expect(await count(`SELECT count(*) AS n FROM automation_runs WHERE trigger = 'schedule'`)).toBeGreaterThanOrEqual(before + 12);
    const runs = (await db.pool.query(`SELECT DISTINCT ON (rule_key) rule_key, status FROM automation_runs WHERE trigger = 'schedule' ORDER BY rule_key, id DESC`)).rows;
    expect(runs.length).toBe(12); // ten Phase 5 rules + the Phase 6 approval monitor and delegation recommendations
    expect(runs.every((r) => r.status === 'succeeded')).toBe(true);
    expect(await count(`SELECT count(*) AS n FROM automation_rules WHERE next_run_at <= now()`)).toBe(0);
  });

  it('4. an overdue task is escalated: first the manager, then the Owner for high priority', async () => {
    await pm()
      .post('/api/tasks')
      .send({ id: 'p5-late', task_number: 'P5-LATE', title: 'Confirm site access for wall install', description: '', project_id: P, project_name: 'Phase 5 Gallery', source_event: 'm', source_module: 'PM', assigned_user_id: 'user-pm', assigned_user_name: 'PM', assigned_role: 'Project Manager', priority: 'High', due_date: '2026-01-05', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' })
      .expect(201);
    await engine.runRule('task_overdue', 'schedule');
    const esc = (await db.pool.query(`SELECT data->>'level' AS level, status FROM escalations WHERE source_record_id = 'p5-late' ORDER BY 1`)).rows;
    expect(esc.map((e) => e.level)).toEqual(['1', '2']);
    expect(esc.every((e) => e.status === 'Open')).toBe(true);
    const ownerNote = await one(`SELECT type, requires_ack FROM notifications WHERE user_id = 'user-owner' AND entity_id = 'p5-late' AND type = 'escalation'`);
    expect(ownerNote).toMatchObject({ requires_ack: true });
  });

  it('5. blocked production is an exception on the Owner center', async () => {
    const c = await center();
    expect(mine(c.critical).some((x) => /Production PO-P5 blocked/.test(x.title))).toBe(true);
  });

  it('6. a failed site QC starts the rectification workflow', async () => {
    await site().post('/api/site-qc').send({ id: 'p5-sqc1', inspection_number: 'SQC-P5-1', work_item_id: 'p5-item', work_item_code: 'GAL-01', installation_job_id: 'p5-inst', project_id: P, project_name: 'Phase 5 Gallery', inspection_date: '2026-10-04', result: 'Fail / Rectification Required', snag_items: [{ id: 's1', description: 'Panel gap 4mm' }], photos: [], comments: '' }).expect(201);
    await engine.runRule('site_qc_failed', 'schedule');
    const task = await one(`SELECT assigned_user_id, issue_id, data->>'requires_evidence' AS ev FROM tasks WHERE id = 'tsk-auto-p5-sqc1'`);
    expect(task).toMatchObject({ assigned_user_id: 'user-site', issue_id: 'issue-rect-p5-sqc1', ev: 'true' });
    expect(await one(`SELECT status, installation_status FROM work_items WHERE id = 'p5-item'`)).toEqual({ status: 'QC Failed', installation_status: 'Rectification' });
  });

  it('7. risk changes with the real conditions, with reasons', async () => {
    const r = await risk();
    expect(['At Risk', 'Critical']).toContain(r.level);
    const dims = new Set(r.reasons.map((x: Row) => x.dimension));
    for (const d of ['Production', 'Quality', 'Schedule']) expect(dims, d).toContain(d);
    await engine.runRule('project_risk', 'schedule');
    expect((await one(`SELECT risk_status FROM projects WHERE id = $1`, [P])).risk_status).toBe(r.level);
  });

  it("8. the Owner's dashboard shows the exceptions (not the routine)", async () => {
    const c = await center();
    const titles = mine(c.critical).map((x) => x.title);
    expect(titles.some((t) => /blocked/.test(t))).toBe(true);
    expect(titles.some((t) => /Site QC failed/.test(t))).toBe(true);
    expect(mine(c.critical).some((x) => x.entity_type === 'escalation')).toBe(true);
    expect(c.risk.find((x: Row) => x.project_id === P).level).toMatch(/At Risk|Critical/);
  });

  it("9. the PM's dashboard shows the task", async () => {
    const b = (await pm().get('/api/briefing').expect(200)).body;
    expect(b.today.tasks_overdue.map((t: Row) => t.entity_id)).toContain('p5-late');
    expect(b.risks.map((r: Row) => r.project_id)).toContain(P);
  });

  it('10-12. the Owner asks the assistant why; it answers from authorized records and recommends, deciding nothing', async () => {
    const before = await ledger();
    const a = (await owner().post('/api/assistant/ask').send({ question: 'Why is this project at risk?', project_id: P }).expect(200)).body;
    s.answer = a;
    // 10: the reasons, each Confirmed with its record.
    const confirmed = a.facts.filter((f: Row) => f.confidence === 'Confirmed').map((f: Row) => f.text).join('\n');
    expect(confirmed).toMatch(/Production PO-P5 blocked/);
    expect(confirmed).toMatch(/Site QC failed/);
    expect(confirmed).toMatch(/overdue task/);
    // 11: only authorized data — every source is on this project, and other roles get their own boundaries.
    const sources = (await one(`SELECT after FROM audit_logs WHERE action = 'ai.query' AND entity_id = $1`, [a.id])).after.sources as string[];
    expect(sources.length).toBeGreaterThan(0);
    for (const src of a.facts.filter((f: Row) => f.source).map((f: Row) => f.source)) expect(src.project_id).toBe(P);
    const contractor = (await as['Contractor'].post('/api/assistant/ask').send({ question: 'Why is this project at risk?', project_id: P }).expect(200)).body;
    expect(contractor.answer).toMatch(/internal to NW/);
    const staff = (await as['Production Staff'].post('/api/assistant/ask').send({ question: 'What is the profit on this project?', project_id: P }).expect(200)).body;
    expect(staff.answer).toBe('Financial information is not available to your role.');
    // 12: recommendations for a person to decide; asking changed nothing.
    expect(a.recommendations.length).toBeGreaterThan(0);
    expect(a.recommendations.every((r: Row) => r.decided_by === 'human')).toBe(true);
    s.proposal = a.recommendations.find((r: Row) => r.proposal?.action === 'create_task')?.proposal;
    expect(s.proposal).toBeTruthy();
    expect(await ledger()).toEqual(before);
  });

  it('13-15. the Owner approves the consequential action; the system executes it; the audit log records it', async () => {
    const created = (await owner().post('/api/assistant/proposals').send({ action: s.proposal.action, params: s.proposal.params, rationale: s.answer.answer }).expect(201)).body;
    expect((await one(`SELECT 1 AS x FROM tasks WHERE id = $1`, [`tsk-ai-${created.id}`])) ?? null).toBeNull();
    // 13
    await owner().post(`/api/approvals/${created.id}/decision`).send({ decision: 'Approved' }).expect(200);
    // 14
    s.aiTask = `tsk-ai-${created.id}`;
    expect(await one(`SELECT assigned_user_id, status, production_order_id FROM tasks WHERE id = $1`, [s.aiTask])).toEqual({ assigned_user_id: 'user-prod-mgr', status: 'Open', production_order_id: 'p5-po' });
    // 15
    const trail = (await db.pool.query(`SELECT action, actor_id FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [created.id])).rows;
    expect(trail.map((t) => t.action)).toEqual(expect.arrayContaining(['ai.proposal.create', 'approval.approve', 'ai.proposal.execute']));
    expect(trail.find((t) => t.action === 'ai.proposal.execute')!.actor_id).toBe('user-owner');
    expect(await count(`SELECT count(*) AS n FROM audit_logs WHERE action = 'create' AND entity_type = 'tasks' AND entity_id = $1`, [s.aiTask])).toBe(1);
  });

  it('16. processing the same events again creates no duplicates', async () => {
    const before = await ledger();
    await engine.runAll('schedule');
    await engine.runAll('schedule');
    await engine.runRule('production_blocked', 'event', { collections: ['productionOrders'] });
    await engine.runRule('site_qc_failed', 'event', { collections: ['siteQCInspections'] });
    expect(await ledger()).toEqual(before);
  });

  it('17. the people fix it and the project returns to healthy', async () => {
    await prodMgr().patch('/api/production-orders/p5-po').send({ status: 'Assembly', current_stage: 'Assembly' }).expect(200);
    await pm().patch('/api/tasks/p5-late').send({ status: 'Completed' }).expect(200);
    await prodMgr().patch(`/api/tasks/${s.aiTask}`).send({ status: 'Completed' }).expect(200);
    await site().patch('/api/tasks/tsk-auto-p5-sqc1').send({ status: 'Completed', completion_evidence: 'Gap closed, photo attached' }).expect(200);
    await pm().patch('/api/issues/issue-rect-p5-sqc1').send({ status: 'Resolved', resolution_notes: 'Panel re-set' }).expect(200);
    await site().post('/api/site-qc').send({ id: 'p5-sqc2', inspection_number: 'SQC-P5-2', work_item_id: 'p5-item', work_item_code: 'GAL-01', installation_job_id: 'p5-inst', project_id: P, project_name: 'Phase 5 Gallery', inspection_date: '2026-10-06', result: 'Pass', snag_items: [], photos: [], comments: '' }).expect(201);
    await engine.runAll('schedule');
    // The automation closed its own production task once production moved on; escalations resolved.
    expect((await one(`SELECT status FROM tasks WHERE id = 'tsk-auto-prod-p5-po'`)).status).toBe('Completed');
    expect(await count(`SELECT count(*) AS n FROM escalations WHERE project_id = $1 AND status <> 'Resolved'`, [P])).toBe(0);
    const r = await risk();
    expect(r).toMatchObject({ level: 'On Track', reasons: [] });
    expect(await one(`SELECT risk_status, is_at_risk FROM projects WHERE id = $1`, [P])).toEqual({ risk_status: 'On Track', is_at_risk: false });
    expect(await one(`SELECT status, installation_status FROM work_items WHERE id = 'p5-item'`)).toEqual({ status: 'Installation In Progress', installation_status: 'In Progress' }); // the job is still being installed
  });

  it("18. the Owner's exception list updates", async () => {
    const c = await center();
    expect(mine(c.critical)).toEqual([]);
    expect(mine(c.decisions)).toEqual([]);
    expect(c.risk.find((x: Row) => x.project_id === P)?.level ?? 'On Track').toBe('On Track');
  });
});
