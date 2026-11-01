import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld, unrelatedProject } from '../test/demoWorld';

type Row = Record<string, any>;

/**
 * QA remediation batch 1 (transaction integrity), on the real restricted runtime role.
 * A production order or delivery is one atomic operation: refused as a whole, it leaves no
 * order, delivery, link, schedule or audit row behind. A work item can only reference an
 * existing order made for it, for every role including the Owner, and its delivery status
 * follows a committed delivery record only. Stored values are never rewritten by these rules.
 */
describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('QA batch 1: production and delivery transaction integrity', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  const baseItem = { work_package_id: 'wp-1', quantity: 1, unit: 'unit', drawing_id: 'dwg-1', drawing_revision: 'Rev 3', material: 'ply', finish: 'oak', dimensions: '1x1', required_date: '2027-06-01', contractor_id: 'con-1', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started', location: 'L1' };

  beforeAll(async () => {
    ({ db, as } = (await setupDemoWorld({ restricted: true })) as never);
    for (const [id, code] of [['item-ti-1', 'TI-1'], ['item-ti-2', 'TI-2'], ['item-ti-3', 'TI-3']]) {
      await as['Owner / CEO'].post('/api/work-items').send({ ...baseItem, id, item_code: code, description: `Counter ${code}` }).expect(201);
    }
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  const sync = (agent: request.Agent, upserts: Record<string, Row[]>) => agent.post('/api/data/sync').send({ upserts, deletes: {} });
  const itemRow = async (id: string) =>
    (await db.owner.query(`SELECT production_order_id, production_status, delivery_status, scheduled_delivery_date, scheduled_delivery_time, status FROM work_items WHERE id = $1`, [id])).rows[0] as Row;
  const counts = async () =>
    (await db.owner.query(
      `SELECT (SELECT count(*) FROM production_orders)::int AS orders, (SELECT count(*) FROM deliveries)::int AS deliveries,
              (SELECT count(*) FROM delivery_items)::int AS delivery_items, (SELECT count(*) FROM audit_logs)::int AS audits`
    )).rows[0] as Row;
  const auditsFor = async (entityId: string) =>
    (await db.owner.query(`SELECT action, entity_type FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [entityId])).rows as Row[];
  const workItem = async (id: string) => (await owner().get(`/api/work-items/${id}`).expect(200)).body as Row;

  const order = (id: string, itemId: string, extra: Row = {}): Row => ({
    id, order_number: id.toUpperCase(), project_id: 'proj-1', project_name: 'Aurora', work_package_id: 'wp-1', work_item_id: itemId, work_item_code: itemId.toUpperCase(),
    client_id: 'client-1', location: 'L1', contractor_id: 'con-1', contractor_name: 'Hock Seng', production_manager_id: 'user-prod-mgr', required_date: '2026-11-01',
    current_stage: 'Not Started', priority: 'Normal', status: 'Not Started', approved_client_drawing_id: 'dwg-1', approved_client_drawing_revision: 'A-103 Rev 3',
    approved_nw_production_drawing_id: 'nwd-1', approved_nw_production_drawing_revision: 'A-103-NW Rev 1', production_method: 'NW-PM-Counter-001 Rev 2',
    material: 'Plywood', finish: 'Oak', dimensions: '1x1', quantity: 1, notes: '', photos: [], barcode: 'B', qr_code: 'Q', stage_history: [], created_at: '2026-10-01', updated_at: '2026-10-01',
    ...extra,
  });
  const delivery = (id: string, itemIds: string[], extra: Row = {}): Row => ({
    ...unrelatedProject().deliveryRecords[0],
    id, delivery_number: id.toUpperCase(), project_id: 'proj-1', project_name: 'Aurora', work_package_id: 'wp-1', work_item_ids: itemIds, work_item_codes: itemIds,
    production_order_ids: [], contractor_id: 'con-1', contractor_name: 'Hock Seng', driver_name: 'Driver', driver_contact: '012', vehicle_plate: 'WXX 1', vehicle_type: 'Lorry',
    delivery_date: '2026-11-20', delivery_time: '10:00 AM', status: 'Scheduled', status_history: [], site_receipt: undefined,
    ...extra,
  });

  it('refuses a work item link to a production order that does not exist, for every role including the Owner; nothing is written', async () => {
    const before = await counts();
    for (const role of ['Owner / CEO', 'Admin', 'Project Manager', 'Production Manager']) {
      const current = await workItem('item-ti-1');
      const viaSync = await sync(as[role], { workItems: [{ ...current, production_order_id: 'po-does-not-exist' }] });
      expect(viaSync.status, `${role} sync`).toBe(400);
      expect(viaSync.body.message, role).toMatch(/po-does-not-exist does not exist/);
      const viaRest = await as[role].patch('/api/work-items/item-ti-1').send({ production_order_id: 'po-does-not-exist' });
      expect(viaRest.status, `${role} REST`).toBe(400);
    }
    // A new item cannot be created with an orphan link either.
    const created = await owner().post('/api/work-items').send({ ...baseItem, id: 'item-ti-orphan', item_code: 'TI-O', description: 'x', production_order_id: 'po-does-not-exist' });
    expect(created.status).toBe(400);
    expect((await itemRow('item-ti-1')).production_order_id).toBeNull();
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM work_items WHERE id = 'item-ti-orphan'`)).rows[0].n).toBe(0);
    expect(await counts()).toEqual(before);
  });

  it('a failed production save leaves no order, no link and no audit row, even with the link in the same batch', async () => {
    const before = await counts();
    const current = await workItem('item-ti-1');
    // No approved production method: the order is refused, and with it the whole batch.
    const res = await sync(owner(), {
      productionOrders: [order('po-ti-bad', 'item-ti-1', { production_method: '' })],
      workItems: [{ ...current, production_order_id: 'po-ti-bad', production_status: 'Not Started' }],
    });
    expect(res.status).toBe(400);
    // An unapproved drawing revision: refused the same way.
    const res2 = await sync(owner(), { productionOrders: [order('po-ti-bad2', 'item-ti-1', { approved_client_drawing_revision: 'A-103 Rev 99' })] });
    expect(res2.status).toBe(400);
    expect(await counts()).toEqual(before);
    expect((await itemRow('item-ti-1')).production_order_id).toBeNull();
    expect(await auditsFor('po-ti-bad')).toEqual([]);
  });

  it('a work item cannot be linked to another item\'s order', async () => {
    await sync(as['Production Manager'], { productionOrders: [order('po-ti-2', 'item-ti-2')] }).expect(200);
    const res = await as['Owner / CEO'].patch('/api/work-items/item-ti-1').send({ production_order_id: 'po-ti-2' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not an order for work item item-ti-1/);
    expect((await itemRow('item-ti-1')).production_order_id).toBeNull();
  });

  it('a valid production order is one transaction: the server links its work item and audits it once', async () => {
    await sync(owner(), { productionOrders: [order('po-ti-1', 'item-ti-1')] }).expect(200);
    expect(await itemRow('item-ti-1')).toMatchObject({ production_order_id: 'po-ti-1', production_status: 'Not Started' });
    expect(await auditsFor('po-ti-1')).toEqual([{ action: 'create', entity_type: 'productionOrders' }]);
    // Sending the same order again (a retry after an unconfirmed save) creates no second order.
    await sync(owner(), { productionOrders: [order('po-ti-1', 'item-ti-1')] }).expect(200);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM production_orders WHERE work_item_id = 'item-ti-1'`)).rows[0].n).toBe(1);
  });

  it('a delivery with a work item of another project is refused, and leaves every item\'s schedule unchanged', async () => {
    const before = await counts();
    const itemBefore = await itemRow('item-ti-2');
    const crossBefore = await itemRow('item-x');
    for (const role of ['Owner / CEO', 'Project Manager', 'Contractor']) {
      const res = await sync(as[role], { deliveryRecords: [delivery('del-ti-cross', ['item-ti-2', 'item-x'])] });
      expect(res.status, role).toBe(400);
      expect(res.body.message, role).toMatch(/item-x is on another project/);
    }
    expect(await counts()).toEqual(before);
    expect(await itemRow('item-ti-2')).toEqual(itemBefore);
    expect(await itemRow('item-x')).toEqual(crossBefore);
    expect(await auditsFor('del-ti-cross')).toEqual([]);
  });

  it('Scheduled cannot be set without a delivery: the browser\'s delivery status is ignored, and a new item starts Not Scheduled', async () => {
    const current = await workItem('item-ti-3');
    await sync(owner(), { workItems: [{ ...current, delivery_status: 'Scheduled', notes: 'edited' }] }).expect(200);
    expect((await itemRow('item-ti-3')).delivery_status).toBe('Not Scheduled');
    await owner().patch('/api/work-items/item-ti-3').send({ delivery_status: 'Delivered' }).expect(200);
    expect((await itemRow('item-ti-3')).delivery_status).toBe('Not Scheduled');
    await owner().post('/api/work-items').send({ ...baseItem, id: 'item-ti-4', item_code: 'TI-4', description: 'x', delivery_status: 'Scheduled' }).expect(201);
    expect((await itemRow('item-ti-4')).delivery_status).toBe('Not Scheduled');
  });

  it('a stored delivery status is never rewritten by an unrelated edit (existing records stay as they are)', async () => {
    // As an existing record with Scheduled and no delivery (like the QA checklist's CAR-665).
    await db.owner.query(`UPDATE work_items SET delivery_status = 'Scheduled' WHERE id = 'item-ti-4'`);
    const current = await workItem('item-ti-4');
    await sync(owner(), { workItems: [{ ...current, notes: 'unrelated edit' }] }).expect(200);
    expect(await itemRow('item-ti-4')).toMatchObject({ delivery_status: 'Scheduled' });
  });

  it('a valid delivery is one transaction: its items take its status and slot, it is audited once, and a resend adds nothing', async () => {
    await sync(as['Contractor'], { deliveryRecords: [delivery('del-ti-1', ['item-ti-2', 'item-ti-3'])] }).expect(200);
    for (const id of ['item-ti-2', 'item-ti-3']) {
      expect(await itemRow(id), id).toMatchObject({ delivery_status: 'Scheduled', scheduled_delivery_date: '2026-11-20', scheduled_delivery_time: '10:00 AM' });
    }
    expect(await auditsFor('del-ti-1')).toEqual([{ action: 'create', entity_type: 'deliveryRecords' }]);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM delivery_items WHERE delivery_id = 'del-ti-1'`)).rows[0].n).toBe(2);
    await sync(as['Contractor'], { deliveryRecords: [delivery('del-ti-1', ['item-ti-2', 'item-ti-3'])] }).expect(200);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM deliveries WHERE id = 'del-ti-1'`)).rows[0].n).toBe(1);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM delivery_items WHERE delivery_id = 'del-ti-1'`)).rows[0].n).toBe(2);
  });

  it('keeps project scope: a Project Manager cannot schedule another project\'s delivery', async () => {
    const res = await sync(as['Project Manager'], { deliveryRecords: [{ ...delivery('del-ti-x', ['item-x']), project_id: 'proj-x', work_package_id: 'wp-x' }] });
    expect(res.status).toBe(403);
    expect((await db.owner.query(`SELECT count(*)::int AS n FROM deliveries WHERE id = 'del-ti-x'`)).rows[0].n).toBe(0);
  });
});
