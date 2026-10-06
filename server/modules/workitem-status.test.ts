import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld, unrelatedProject } from '../test/demoWorld';

type Row = Record<string, any>;

/**
 * A work item's production, delivery, installation and overall statuses are derived on the
 * server from its production order, delivery, installation job and site QC, so they cannot
 * contradict each other (Phase 4 limitation: completing installation never moved the item).
 */
describe.skipIf(!TEST_DATABASE_URL)('Phase 5 work item status consistency', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    await as['Owner / CEO']
      .post('/api/work-items')
      .send({ id: 'item-ws', work_package_id: 'wp-1', item_code: 'WS-1', description: 'Display counter', location: 'L1', quantity: 1, unit: 'unit', drawing_id: 'dwg-1', drawing_revision: 'Rev 3', material: 'ply', finish: 'oak', dimensions: '1x1', required_date: '2027-06-01', contractor_id: 'con-1', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started' })
      .expect(201);
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const site = () => as['Site Supervisor'];
  const item = async () => (await db.pool.query(`SELECT status, production_status, delivery_status, installation_status, progress_percent FROM work_items WHERE id = 'item-ws'`)).rows[0] as Row;
  const order: Row = { id: 'po-ws', order_number: 'PO-WS', project_id: 'proj-1', project_name: 'Aurora', work_package_id: 'wp-1', work_item_id: 'item-ws', work_item_code: 'WS-1', client_id: 'client-1', location: 'L1', contractor_id: 'con-1', contractor_name: 'Hock Seng', production_manager_id: 'user-prod-mgr', required_date: '2026-11-01', current_stage: 'Not Started', priority: 'Normal', status: 'Not Started', approved_client_drawing_id: 'dwg-1', approved_client_drawing_revision: 'A-103 Rev 3', approved_nw_production_drawing_id: 'nwd-1', approved_nw_production_drawing_revision: 'A-103-NW Rev 1', production_method: 'NW-PM-Counter-001 Rev 2', material: 'Plywood', finish: 'Oak', dimensions: '1x1', quantity: 1, notes: '', photos: [], barcode: 'B', qr_code: 'Q', stage_history: [], created_at: '2026-10-01', updated_at: '2026-10-01' };
  const qc = (id: string, result: string, date: string) => ({ id, inspection_number: id.toUpperCase(), work_item_id: 'item-ws', work_item_code: 'WS-1', installation_job_id: 'inst-ws', project_id: 'proj-1', project_name: 'Aurora', inspection_date: date, inspected_at: date, result, snag_items: [], photos: [], comments: '' });

  it('follows production: running → In Progress, factory QC → Ready for QC, blocked → Blocked, ready → Ready for Delivery', async () => {
    await as['Production Manager'].post('/api/production-orders').send(order).expect(201);
    expect(await item()).toMatchObject({ status: 'Assigned', production_status: 'Not Started' }); // nothing started yet: kept
    for (const [stage, overall] of [
      ['Cutting', 'In Progress'],
      ['QC', 'Ready for QC'],
      ['Blocked', 'Blocked'],
      ['Ready for Delivery', 'Ready for Delivery'],
    ]) {
      await as['Production Manager'].patch('/api/production-orders/po-ws').send({ status: stage, current_stage: stage }).expect(200);
      expect(await item(), stage).toMatchObject({ production_status: stage, status: overall });
    }
  });

  it('follows the delivery and its site receipt', async () => {
    const del = { ...unrelatedProject().deliveryRecords[0], id: 'del-ws', delivery_number: 'DEL-WS', project_id: 'proj-1', work_package_id: 'wp-1', work_item_ids: ['item-ws'], work_item_codes: ['WS-1'], production_order_ids: ['po-ws'], contractor_id: 'con-1', contractor_name: 'Hock Seng', status: 'In Transit', status_history: [], site_receipt: undefined };
    await as['Contractor'].post('/api/deliveries').send(del).expect(201);
    expect(await item()).toMatchObject({ delivery_status: 'In Transit', status: 'Ready for Delivery' });
    const receipt = { id: 'rcpt-ws', delivery_id: 'del-ws', project_id: 'proj-1', received_at: '2026-10-10T10:00:00Z', condition_status: 'All In Order', packages_expected: 1, packages_received: 1, damaged_quantity: 0, missing_quantity: 0, photos: [], receiver_signature: 'sig' };
    await site().patch('/api/deliveries/del-ws').send({ status: 'Received / Confirmed', site_receipt: receipt }).expect(200);
    expect(await item()).toMatchObject({ delivery_status: 'Delivered', status: 'Delivered', installation_status: 'Not Started' });
  });

  it('follows installation, and completes the item when installation completes', async () => {
    const job = { id: 'inst-ws', job_number: 'INS-WS', work_item_id: 'item-ws', work_item_code: 'WS-1', work_item_description: 'Display counter', project_id: 'proj-1', project_name: 'Aurora', work_package_id: 'wp-1', location: 'L1', contractor_id: 'con-1', contractor_name: 'Hock Seng', lead_installer: 'A', installer_contact: '', site_supervisor_id: 'user-site', site_supervisor_name: 'S', team_headcount: 2, status: 'Scheduled', planned_start_date: '2026-10-01', planned_completion_date: '2027-12-01', drawing_reference: 'dwg-1', drawing_revision: 'Rev 3', checklist: {}, progress_percent: 0, photos: [] };
    await owner().post('/api/installation-jobs').send(job).expect(201);
    expect(await item()).toMatchObject({ installation_status: 'Scheduled', status: 'Delivered' });
    await site().patch('/api/installation-jobs/inst-ws').send({ status: 'In Progress' }).expect(200);
    expect(await item()).toMatchObject({ installation_status: 'In Progress', status: 'Installation In Progress' });
    await site().patch('/api/installation-jobs/inst-ws').send({ status: 'Awaiting Inspection' }).expect(200);
    expect(await item()).toMatchObject({ installation_status: 'Awaiting Inspection', status: 'Installation QC' });
  });

  it('a failed site QC puts the item into rectification; the pass after it completes the item', async () => {
    await site().post('/api/site-qc').send(qc('sqc-ws1', 'Fail / Rectification Required', '2026-10-11')).expect(201);
    expect(await item()).toMatchObject({ installation_status: 'Rectification', status: 'QC Failed' });
    expect((await site().patch('/api/installation-jobs/inst-ws').send({ status: 'Completed' })).status).toBe(403);
    await site().post('/api/site-qc').send(qc('sqc-ws2', 'Pass', '2026-10-12')).expect(201);
    expect(await item()).toMatchObject({ installation_status: 'Awaiting Inspection', status: 'Installation QC' });
    await site().patch('/api/installation-jobs/inst-ws').send({ status: 'Completed' }).expect(200);
    expect(await item()).toEqual({ status: 'Completed', production_status: 'Ready for Delivery', delivery_status: 'Delivered', installation_status: 'Completed', progress_percent: 100 });
  });

  it('ignores contradictory statuses sent by the browser', async () => {
    const current = (await owner().get('/api/work-items/item-ws').expect(200)).body;
    await owner()
      .post('/api/data/sync')
      .send({ upserts: { workItems: [{ ...current, status: 'In Progress', production_status: 'Cutting', delivery_status: 'Not Scheduled', installation_status: 'Not Started' }] } })
      .expect(200);
    expect(await item()).toMatchObject({ status: 'Completed', production_status: 'Ready for Delivery', delivery_status: 'Delivered', installation_status: 'Completed' });
    await owner().patch('/api/work-items/item-ws').send({ status: 'Ready for QC' }).expect(200);
    expect((await item()).status).toBe('Completed');
  });

  it('still refuses completing an item over an open failed site QC, and keeps management holds', async () => {
    await site().patch('/api/installation-jobs/inst-ws').send({ status: 'Rectification' }).expect(200);
    await site().post('/api/site-qc').send(qc('sqc-ws3', 'Fail / Rectification Required', '2026-10-13')).expect(201);
    expect(await item()).toMatchObject({ status: 'QC Failed', installation_status: 'Rectification' });
    const current = (await owner().get('/api/work-items/item-ws').expect(200)).body;
    const res = await owner().post('/api/data/sync').send({ upserts: { workItems: [{ ...current, status: 'Completed' }] } });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/site QC failed/);
    // On Hold is a management decision, kept while the records still change.
    await owner().patch('/api/work-items/item-ws').send({ status: 'On Hold' }).expect(200);
    await site().patch('/api/installation-jobs/inst-ws').send({ status: 'In Progress' }).expect(200);
    expect(await item()).toMatchObject({ status: 'On Hold', installation_status: 'Rectification' });
  });

  it('leaves items with no production, delivery or installation records alone', async () => {
    const before = (await db.pool.query(`SELECT id, status FROM work_items WHERE id NOT IN (SELECT work_item_id FROM production_orders) AND id NOT IN (SELECT work_item_id FROM delivery_items) AND id NOT IN (SELECT work_item_id FROM installation_jobs WHERE work_item_id IS NOT NULL) AND id NOT IN (SELECT work_item_id FROM site_qc_inspections) ORDER BY id LIMIT 1`)).rows[0];
    expect(before).toBeTruthy();
    const current = (await owner().get(`/api/work-items/${before.id}`).expect(200)).body;
    await owner().patch(`/api/work-items/${before.id}`).send({ status: current.status === 'Assigned' ? 'Contractor Confirmed' : 'Assigned' }).expect(200);
    expect((await db.pool.query('SELECT status FROM work_items WHERE id = $1', [before.id])).rows[0].status).not.toBe(before.status);
  });
});
