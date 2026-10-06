import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { runAutomation } from './automation';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 project risk, health and the daily briefing', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    // A clean project to watch: nothing late, nothing blocked.
    await as['Owner / CEO']
      .post('/api/projects')
      .send({ id: 'proj-r', project_number: 'NW-R-1', project_name: 'Risk Test', client_id: 'client-2', site_address: 'KL', contract_value: 50000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: 'user-pm', site_supervisor_id: 'user-site', progress_percent: 0, description: '' })
      .expect(201);
    await as['Owner / CEO'].post('/api/work-packages').send({ id: 'wp-r', project_id: 'proj-r', name: 'JOINERY', category: 'Carpentry', contractor_id: 'con-1', project_manager_id: 'user-pm', start_date: '2026-01-01', end_date: '2027-12-01', status: 'Assigned', progress_percent: 0 }).expect(201);
    await as['Owner / CEO'].post('/api/work-items').send({ id: 'item-r', work_package_id: 'wp-r', item_code: 'R-1', description: 'Counter', location: 'L1', quantity: 1, unit: 'unit', drawing_id: 'dwg-1', drawing_revision: 'Rev 3', material: 'ply', finish: 'oak', dimensions: '1x1', required_date: '2027-06-01', contractor_id: 'con-1', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started' }).expect(201);
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const pm = () => as['Project Manager'];
  const risk = async (who = owner()) => (await who.get('/api/projects/proj-r/risk').expect(200)).body as Row;
  const task = (id: string, due: string, priority = 'Normal') => ({ id, task_number: id, title: `Task ${id}`, description: '', project_id: 'proj-r', project_name: 'Risk Test', source_event: 'm', source_module: 'PM', assigned_user_id: 'user-pm', assigned_user_name: 'PM', assigned_role: 'Project Manager', priority, due_date: due, status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' });

  it('starts On Track with no reasons', async () => {
    const r = await risk();
    expect(r).toMatchObject({ level: 'On Track', reasons: [] });
    expect(r.dimensions.map((d: Row) => d.dimension)).toEqual(['Schedule', 'Production', 'Materials', 'Site', 'Quality', 'Commercial', 'Client', 'Issues']);
    expect(r.basis).toMatch(/not a financial or contractual/i);
  });

  it('explains why a project needs attention, and escalates with more signals', async () => {
    await pm().post('/api/tasks').send(task('r-t1', '2026-01-10')).expect(201);
    let r = await risk();
    expect(r.level).toBe('Attention');
    expect(r.reasons[0]).toMatchObject({ dimension: 'Schedule', level: 'Attention', signal: '1 overdue task', tab: 'automation', entity_id: 'r-t1' });
    await pm().post('/api/tasks').send(task('r-t2', '2026-01-11')).expect(201);
    await pm().post('/api/tasks').send(task('r-t3', '2026-01-12')).expect(201);
    r = await risk();
    expect(r).toMatchObject({ level: 'At Risk' });
    expect(r.reasons[0].signal).toBe('3 overdue tasks');
    expect(r.dimensions.find((d: Row) => d.dimension === 'Schedule')).toMatchObject({ level: 'At Risk', reasons: ['3 overdue tasks'] });
  });

  it('adds failed QC and a material shortage; three At Risk signals make it Critical', async () => {
    await owner().post('/api/installation-jobs').send({ id: 'inst-r', job_number: 'INS-R', work_item_id: 'item-r', work_item_code: 'R-1', work_item_description: 'Counter', project_id: 'proj-r', project_name: 'Risk Test', work_package_id: 'wp-r', location: 'L1', contractor_id: 'con-1', contractor_name: 'HS', lead_installer: 'A', installer_contact: '', site_supervisor_id: 'user-site', site_supervisor_name: 'S', team_headcount: 2, status: 'In Progress', planned_start_date: '2026-01-01', planned_completion_date: '2027-12-01', drawing_reference: 'dwg-1', drawing_revision: 'Rev 3', checklist: {}, progress_percent: 0, photos: [] }).expect(201);
    await as['Site Supervisor'].post('/api/site-qc').send({ id: 'sqc-r', inspection_number: 'SQC-R', work_item_id: 'item-r', work_item_code: 'R-1', installation_job_id: 'inst-r', project_id: 'proj-r', project_name: 'Risk Test', inspection_date: '2026-02-01', result: 'Fail / Rectification Required', snag_items: [], photos: [], comments: '' }).expect(201);
    await as['Purchasing'].post('/api/material-requests').send({ id: 'mr-r', request_number: 'MR-R', project_id: 'proj-r', project_name: 'Risk Test', material_name: 'Hinges', required_quantity: 10, unit: 'pcs', needed_by_date: '2026-01-05', requested_by: 'x', purpose: 'y', status: 'Pending', created_at: '' }).expect(201);
    const r = await risk();
    expect(r.level).toBe('Critical');
    const signals = r.reasons.map((x: Row) => `${x.dimension}:${x.level}:${x.signal}`);
    expect(signals).toEqual(expect.arrayContaining(['Quality:At Risk:Site QC failed on 1 work item(s)', 'Materials:At Risk:Material shortage: 1 request(s) past their needed-by date with no PO', 'Schedule:At Risk:3 overdue tasks']));
  });

  it('keeps commercial reasons from roles without financial access, and keeps risk from clients and contractors', async () => {
    const asSite = await risk(as['Site Supervisor']);
    expect(asSite.dimensions.map((d: Row) => d.dimension)).not.toContain('Commercial');
    expect(asSite.reasons.some((x: Row) => x.dimension === 'Commercial')).toBe(false);
    expect((await as['Client'].get('/api/projects/proj-r/risk')).status).toBe(403);
    expect((await as['Contractor'].get('/api/risk')).status).toBe(403);
    expect((await as['Production Staff'].get('/api/projects/proj-r/risk')).status).toBe(404); // not their project
  });

  it('is stored on the project by automation, audited, and cannot be set from the browser', async () => {
    await owner().patch('/api/projects/proj-r').send({ risk_status: 'On Track', is_at_risk: false }).expect(200);
    expect((await db.pool.query(`SELECT risk_status FROM projects WHERE id = 'proj-r'`)).rows[0].risk_status).toBeNull();
    await runAutomation(db.pool);
    const stored = (await db.pool.query(`SELECT risk_status, is_at_risk, risk_reason FROM projects WHERE id = 'proj-r'`)).rows[0];
    expect(stored).toMatchObject({ risk_status: 'Critical', is_at_risk: true });
    expect(stored.risk_reason).toMatch(/overdue tasks/);
    const audit = (await db.pool.query(`SELECT after FROM audit_logs WHERE action = 'project.risk_change' AND entity_id = 'proj-r'`)).rows;
    expect(audit[0].after.risk_status).toBe('Critical');
    const notes = (await db.pool.query(`SELECT user_id FROM notifications WHERE rule_key LIKE 'project_risk:proj-r:%' ORDER BY user_id`)).rows.map((r) => r.user_id);
    expect(notes).toEqual(['user-owner', 'user-pm']);
    await owner().patch('/api/projects/proj-r').send({ risk_status: 'On Track' }).expect(200);
    expect((await db.pool.query(`SELECT risk_status FROM projects WHERE id = 'proj-r'`)).rows[0].risk_status).toBe('Critical');
  });

  it('returns to On Track when the problems are resolved', async () => {
    for (const id of ['r-t1', 'r-t2', 'r-t3']) await pm().patch(`/api/tasks/${id}`).send({ status: 'Completed' }).expect(200);
    await as['Site Supervisor'].post('/api/site-qc').send({ id: 'sqc-r2', inspection_number: 'SQC-R2', work_item_id: 'item-r', work_item_code: 'R-1', installation_job_id: 'inst-r', project_id: 'proj-r', project_name: 'Risk Test', inspection_date: '2026-02-03', result: 'Pass', snag_items: [], photos: [], comments: '' }).expect(201);
    await as['Purchasing'].patch('/api/material-requests/mr-r').send({ status: 'PO Created' }).expect(200);
    // The automated rectification task from the failed QC is also open: close it.
    for (const t of (await db.pool.query(`SELECT id FROM tasks WHERE project_id = 'proj-r' AND status NOT IN ('Completed', 'Cancelled')`)).rows) {
      await pm().patch(`/api/tasks/${t.id}`).send({ status: 'Completed', completion_evidence: 'done' }).expect(200);
    }
    for (const i of (await db.pool.query(`SELECT id FROM issues WHERE project_id = 'proj-r' AND status NOT IN ('Resolved', 'Closed')`)).rows) {
      await pm().patch(`/api/issues/${i.id}`).send({ status: 'Resolved', resolution_notes: 'Rectified and re-inspected' }).expect(200);
    }
    expect((await risk()).level).toBe('On Track');
    await runAutomation(db.pool);
    expect((await db.pool.query(`SELECT risk_status, is_at_risk FROM projects WHERE id = 'proj-r'`)).rows[0]).toEqual({ risk_status: 'On Track', is_at_risk: false });
  });

  describe('daily briefing', () => {
    it("gives the PM today's work, risks and decisions from live records", async () => {
      await pm().post('/api/tasks').send(task('r-today', new Date().toISOString().slice(0, 10), 'High')).expect(201);
      await pm().post('/api/tasks').send(task('r-late', '2026-01-02')).expect(201);
      const b = (await pm().get('/api/briefing').expect(200)).body;
      expect(b.for).toMatchObject({ id: 'user-pm', role: 'Project Manager' });
      expect(b.today.tasks_due.map((t: Row) => t.entity_id)).toContain('r-today');
      expect(b.today.tasks_overdue.map((t: Row) => t.entity_id)).toContain('r-late');
      expect(b.projects.map((p: Row) => p.id)).toContain('proj-r');
      expect(b.risks.every((r: Row) => ['At Risk', 'Critical'].includes(r.level))).toBe(true);
      expect(Array.isArray(b.decisions)).toBe(true);
      expect(b.source).toMatch(/Live NW OS records/);
    });

    it("puts a variation decision in the approver's briefing, not the author's, and stays in scope", async () => {
      await pm().post('/api/variations').send({ id: 'vo-r', variation_number: 'VO-R', project_id: 'proj-r', project_name: 'Risk Test', title: 'Extra shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 300, status: 'Identified', created_at: '' }).expect(201);
      await pm().post('/api/variations/vo-r/transition').send({ status: 'Internal Approval' }).expect(200);
      const ownerB = (await owner().get('/api/briefing').expect(200)).body;
      expect(ownerB.decisions.map((d: Row) => d.entity_id)).toContain('vo-r');
      const pmB = (await pm().get('/api/briefing').expect(200)).body;
      expect(pmB.decisions.map((d: Row) => d.entity_id)).not.toContain('vo-r');
      const staff = (await as['Production Staff'].get('/api/briefing').expect(200)).body;
      expect(staff.projects.map((p: Row) => p.id)).toEqual(['proj-1']);
      expect((await as['Client'].get('/api/briefing')).status).toBe(403);
    });
  });
});
