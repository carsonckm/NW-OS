import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 4 issue -> task, site QC, handover, completion', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const pm = () => as['Project Manager'];
  const site = () => as['Site Supervisor'];
  const task = (over: Row) => ({ title: 'Task', description: '', project_name: 'Aurora', source_event: 'manual', source_module: 'PM', assigned_user_id: 'user-site', assigned_user_name: 'Suresh', assigned_role: 'Site Supervisor', priority: 'High', due_date: '2026-10-12', status: 'Open', escalation_level: 0, comments: [], attachments: [], created_date: '2026-10-06', ...over });
  const issue = (over: Row) => ({ project_id: 'proj-1', title: 'Issue', category: 'Site Condition', priority: 'High', status: 'Reported', reported_by: 'x', reported_by_role: 'x', assigned_to: 'x', escalation_level: 'PM', action_required: 'x', description: 'x', created_at: '', updated_at: '', ...over });

  it('links a task to the issue it was raised from, and resolves the issue only when the task is done', async () => {
    await pm().post('/api/issues').send(issue({ id: 'iss-p4', title: 'Counter does not fit', work_item_id: 'item-2' })).expect(201);
    const t = await pm().post('/api/tasks').send(task({ id: 'tsk-p4', task_number: 'TSK-P4', title: 'Re-measure counter', issue_id: 'iss-p4', project_id: 'proj-2' }));
    expect(t.status).toBe(400); // wrong project for the issue
    const created = await pm().post('/api/tasks').send(task({ id: 'tsk-p4', task_number: 'TSK-P4', title: 'Re-measure counter', issue_id: 'iss-p4' })).expect(201);
    expect(created.body).toMatchObject({ issue_id: 'iss-p4', project_id: 'proj-1', work_item_id: 'item-2' });
    expect((await db.pool.query(`SELECT issue_id FROM tasks WHERE id = 'tsk-p4'`)).rows[0].issue_id).toBe('iss-p4');
    expect((await pm().get('/api/tasks?issue_id=iss-p4').expect(200)).body.map((x: Row) => x.id)).toEqual(['tsk-p4']);

    const early = await pm().patch('/api/issues/iss-p4').send({ status: 'Resolved', resolution_notes: 'Trimmed plinth' });
    expect(early.status).toBe(403);
    expect(early.body.message).toMatch(/Re-measure counter/);
    expect((await pm().patch('/api/issues/iss-p4').send({ status: 'Resolved' })).status).toBe(400); // needs a note
    await site().patch('/api/tasks/tsk-p4').send({ status: 'Completed' }).expect(200);
    expect((await pm().patch('/api/issues/iss-p4').send({ status: 'Resolved', resolution_notes: ' ' })).status).toBe(400); // blank note
    const done = await pm().patch('/api/issues/iss-p4').send({ status: 'Resolved', resolution_notes: 'Trimmed plinth 100mm' }).expect(200);
    expect(done.body).toMatchObject({ status: 'Resolved', resolved_by_id: 'user-pm' });
    expect([403, 404]).toContain((await as['Contractor'].patch('/api/issues/iss-p4').send({ status: 'Closed', resolution_notes: 'x' })).status); // contractors can't resolve
  });

  it('runs a failed site QC through rectification and re-inspection to completion', async () => {
    const qc = (id: string, result: string, date: string) => ({ id, inspection_number: id.toUpperCase(), work_item_id: 'item-3', work_item_code: 'CAR-001', installation_job_id: 'inst-1', project_id: 'proj-1', project_name: 'Aurora', inspector_name: 'Forged', inspector_role: '', inspection_date: date, inspected_at: date, result, level_and_alignment_pass: result === 'Pass', hardware_and_mechanism_pass: true, finish_and_surfaces_pass: result === 'Pass', safety_and_fixing_pass: true, cleanliness_and_protection_pass: true, snag_items: [], inspector_signoff: true, photos: ['p1.jpg'], comments: '' });
    const failed = await site().post('/api/site-qc').send(qc('sqc-p4-1', 'Fail / Rectification Required', '2026-11-01')).expect(201);
    const issueId = failed.body.rectification_issue_id;
    expect(issueId).toBe('issue-rect-sqc-p4-1');
    expect(failed.body.inspector_name).toBe('Site Supervisor');
    expect((await owner().patch('/api/installation-jobs/inst-1').send({ status: 'Completed' })).status).toBe(403);

    // Rectification is a task raised from the rectification issue.
    await pm().post('/api/tasks').send(task({ id: 'tsk-rect', task_number: 'TSK-RECT', title: 'Re-level counter', issue_id: issueId })).expect(201);
    await site().patch('/api/tasks/tsk-rect').send({ status: 'Completed' }).expect(200);
    await pm().patch(`/api/issues/${issueId}`).send({ status: 'Resolved', resolution_notes: 'Re-levelled and refixed' }).expect(200);
    // Still blocked until a re-inspection passes.
    expect((await owner().patch('/api/installation-jobs/inst-1').send({ status: 'Completed' })).status).toBe(403);
    await site().post('/api/site-qc').send(qc('sqc-p4-2', 'Pass', '2026-11-03')).expect(201);
    await owner().patch('/api/installation-jobs/inst-1').send({ status: 'Completed' }).expect(200);
  });

  it('creates a handover draft, signs it with the client, locks it, and leaves the project Active', async () => {
    const draft = { id: 'ho-p4', project_id: 'proj-2', project_name: 'Horizon', client_id: 'client-x', client_name: 'Horizon', client_representative: 'Mr Tan', cpc_certificate_number: 'CPC-P4', handover_date: '2026-11-10', status: 'Formal CPC Handover Signed', work_items_included: [], all_site_qc_passed: true, open_snags_count: 0, nw_pm_signoff_name: 'Forged', as_built_drawings_approved: true, as_built_drawing_revision: 'Rev 2', operation_maintenance_manual_ref: 'OM-1', dlp_duration_months: 12, dlp_start_date: '2026-11-10', dlp_end_date: '2027-11-10', retention_sum_amount_rm: 5000, retention_sum_status: 'Held in Retention (5%)', cmgd_target_date: '2027-11-10', documents: [] };
    expect((await pm().post('/api/handovers').send(draft)).status).toBe(403); // can't be created signed
    const created = await pm().post('/api/handovers').send({ ...draft, status: 'Draft' }).expect(201);
    expect(created.body).toMatchObject({ client_id: 'client-2', prepared_by_id: 'user-pm' });
    expect((await pm().patch('/api/handovers/ho-p4').send({ status: 'Formal CPC Handover Signed' })).status).toBe(400); // no signature
    const signed = await pm().patch('/api/handovers/ho-p4').send({ status: 'Formal CPC Handover Signed', client_signoff_name: 'Mr Tan', client_signoff_signature: 'Tan (signed on tablet)' }).expect(200);
    expect(signed.body).toMatchObject({ nw_pm_signoff_name: 'Project Manager', nw_signed_by_id: 'user-pm' });
    expect((await pm().patch('/api/handovers/ho-p4').send({ client_representative: 'Someone else' })).status).toBe(403);
    expect((await owner().get('/api/projects/proj-2').expect(200)).body.project_status).toBe('Active');
  });

  it('completes and closes a project only when its handover is signed and no site QC failure is open', async () => {
    const proj1 = await owner().patch('/api/projects/proj-1').send({ project_status: 'Completed' });
    expect(proj1.status).toBe(403); // proj-1 has no signed handover in this world... or open QC failures
    expect((await owner().patch('/api/projects/proj-2').send({ project_status: 'Closed' })).status).toBe(403); // not completed yet
    await owner().patch('/api/projects/proj-2').send({ project_status: 'Completed' }).expect(200);
    await owner().patch('/api/projects/proj-2').send({ project_status: 'Closed' }).expect(200);
    const audit = (await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = 'proj-2' AND entity_type = 'projects' ORDER BY id`)).rows.map((r) => r.action);
    expect(audit.filter((a) => a === 'update').length).toBeGreaterThanOrEqual(2);
  });
});
