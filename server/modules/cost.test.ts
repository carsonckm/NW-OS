import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 4 cost control: PO -> goods received -> invoice -> actual cost', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const purchasing = () => as['Purchasing'];
  const accountant = () => as['Accountant'];
  const site = () => as['Site Supervisor'];
  const profit = () => accountant().get('/api/projects/proj-2/profitability').expect(200).then((r) => r.body as Row);
  const po = { id: 'po-p4', po_number: 'PO-P4', project_id: 'proj-2', project_name: 'Horizon', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-a', item_description: '18mm plywood', specification: 'E1', quantity: 10, unit: 'sheet', unit_price: 1000, total_price: 1 }, { id: 'l-b', item_description: 'Oak veneer', specification: '', quantity: 4, unit: 'roll', unit_price: 4000, total_price: 1 }], total_amount: 5, requested_by: 'Faridah', expected_delivery_date: '2026-10-20', created_at: '' };
  let start: Row;

  it('computes the PO total and needs a Major Purchase approval to issue a large PO', async () => {
    start = await profit();
    expect((await purchasing().post('/api/purchase-orders').send({ ...po, status: 'Issued' })).status).toBe(403);
    const created = await purchasing().post('/api/purchase-orders').send({ ...po, status: 'Pending Approval' }).expect(201);
    expect(created.body).toMatchObject({ total_amount: 26000 });
    expect(created.body.items[1].total_price).toBe(16000);
    const refused = await purchasing().patch('/api/purchase-orders/po-p4').send({ status: 'Issued' });
    expect(refused.status).toBe(403);
    expect(refused.body.message).toMatch(/Major Purchase approval/);

    await purchasing()
      .post('/api/approvals')
      .send({ id: 'apr-po-p4', approval_number: 'APR-PO-P4', approval_type: 'Major Purchase', title: 'PO-P4 RM 26,000', description: 'Plywood and veneer', project_id: 'proj-2', project_name: 'Horizon', related_entity_type: 'purchase', related_entity_id: 'po-p4', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' })
      .expect(201);
    await owner().post('/api/approvals/apr-po-p4/decision').send({ decision: 'Approved' }).expect(200);
    await purchasing().patch('/api/purchase-orders/po-p4').send({ status: 'Issued' }).expect(200);
    expect((await profit()).committed_cost).toBe(start.committed_cost + 26000);
  });

  it('marks a PO received only through goods received', async () => {
    const res = await purchasing().patch('/api/purchase-orders/po-p4').send({ status: 'Goods Received' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/goods received/);
  });

  it('records short, damaged and wrong quantities per line; the receiver is the signed-in user', async () => {
    const grn = await site()
      .post('/api/goods-received')
      .send({ id: 'grn-p4-1', grn_number: 'GRN-P4-1', po_id: 'po-p4', project_id: 'proj-1', received_by: 'Forged', delivery_note_number: 'DN-881', items: [{ po_item_id: 'l-a', received_qty: 10 }, { po_item_id: 'l-b', received_qty: 2, damaged_qty: 1, notes: 'One roll creased' }], photos: ['dn-881.jpg'] });
    expect(grn.body.message).toBeUndefined();
    expect(grn.status).toBe(201);
    expect(grn.body).toMatchObject({ received_by_id: 'user-site', project_id: 'proj-2', po_number: 'PO-P4', condition: 'Damaged / Rejected' });
    expect(grn.body.items[1]).toMatchObject({ ordered_qty: 4, received_qty: 2, short_qty: 2, damaged_qty: 1 });
    expect((await db.pool.query(`SELECT status FROM purchase_orders WHERE id = 'po-p4'`)).rows[0].status).toBe('Partially Received');
    expect((await site().patch('/api/goods-received/grn-p4-1').send({ notes: 'edited' })).status).toBe(403);
    expect((await site().post('/api/goods-received').send({ id: 'grn-x', po_id: 'po-p4', project_id: 'proj-2', items: [{ po_item_id: 'l-b', received_qty: 9 }] })).status).toBe(400); // over-receipt
    await site().post('/api/goods-received').send({ id: 'grn-p4-2', grn_number: 'GRN-P4-2', po_id: 'po-p4', project_id: 'proj-2', items: [{ po_item_id: 'l-b', received_qty: 2 }] }).expect(201);
    expect((await db.pool.query(`SELECT status FROM purchase_orders WHERE id = 'po-p4'`)).rows[0].status).toBe('Goods Received');
    // Nothing else on the project changed.
    const audit = (await db.pool.query(`SELECT DISTINCT entity_type FROM audit_logs WHERE entity_id IN ('grn-p4-1','grn-p4-2')`)).rows.map((r) => r.entity_type);
    expect(audit).toEqual(['goodsReceived']);
  });

  it('matches the supplier invoice, approves it by finance and posts actual cost once', async () => {
    const invoice = { invoice_number: 'TC-5521', invoice_type: 'Supplier Invoice', party_name: 'Timber Co', project_id: 'proj-2', project_name: 'Horizon', po_id: 'po-p4', amount_before_tax: 26000, tax_amount: 2080, total_amount: 1, invoice_date: '2026-10-22', due_date: '2026-11-21', status: 'Pending Approval', paid_amount: 0 };
    expect((await purchasing().post('/api/invoices').send({ ...invoice, id: 'inv-x' })).status).toBe(403);
    const inv = await accountant()
      .post('/api/invoices')
      .send({ id: 'inv-p4', invoice_number: 'TC-5521', invoice_type: 'Supplier Invoice', party_name: 'Timber Co', project_id: 'proj-2', project_name: 'Horizon', po_id: 'po-p4', amount_before_tax: 26000, tax_amount: 2080, total_amount: 1, invoice_date: '2026-10-22', due_date: '2026-11-21', status: 'Pending Approval', paid_amount: 0 })
      .expect(201);
    expect(inv.body).toMatchObject({ total_amount: 28080, match_status: 'Matched', po_reference: 'PO-P4', recorded_by_id: 'user-accountant' });
    const self = await accountant().patch('/api/invoices/inv-p4').send({ status: 'Approved' });
    expect(self.status).toBe(403);
    expect(self.body.message).toMatch(/you recorded/);
    const before = await profit();
    await owner().patch('/api/invoices/inv-p4').send({ status: 'Approved' }).expect(200);
    const after = await profit();
    expect(after.actual_cost).toBe(before.actual_cost + 26000);
    expect(after.committed_cost).toBe(before.committed_cost);
    expect(after.project_gross_profit).toBe(Math.round((after.selling_price - after.forecast_final_cost) * 100) / 100);
    const ledger = (await db.pool.query(`SELECT id, status, amount::float AS amount FROM project_cost_ledger WHERE id = 'cst-inv-inv-p4'`)).rows;
    expect(ledger).toEqual([{ id: 'cst-inv-inv-p4', status: 'Incurred', amount: 26000 }]);
    // Saving the approved invoice again never posts twice, and its amount is locked.
    await owner().patch('/api/invoices/inv-p4').send({ notes: 'checked' }).expect(200);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM project_cost_ledger WHERE id LIKE 'cst-inv-inv-p4%'`)).rows[0].n).toBe(1);
    expect((await owner().patch('/api/invoices/inv-p4').send({ amount_before_tax: 1 })).status).toBe(403);
  });

  it('lets only the Owner approve an invoice that does not match', async () => {
    await owner()
      .post('/api/invoices')
      .send({ id: 'inv-over', invoice_number: 'TC-5599', invoice_type: 'Supplier Invoice', party_name: 'Timber Co', project_id: 'proj-2', project_name: 'Horizon', po_id: 'po-p4', amount_before_tax: 30000, tax_amount: 0, invoice_date: '2026-10-25', due_date: '2026-11-25', status: 'Pending Approval', paid_amount: 0 })
      .expect(201);
    const res = await accountant().patch('/api/invoices/inv-over').send({ status: 'Approved' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/Exceeds PO/);
  });

  it('keeps browser-sent totals out of the figures', async () => {
    const baseline = (await owner().get('/api/commercial-baselines/proj-2').expect(200)).body;
    await owner().post('/api/data/sync').send({ upserts: { commercialBaselines: [{ ...baseline, actual_cost: 1, committed_cost: 1, forecast_gross_profit: 1e9 }] } }).expect(200);
    const official = await profit();
    const read = (await owner().get('/api/commercial-baselines/proj-2').expect(200)).body;
    expect(read).toMatchObject({ actual_cost: official.actual_cost, committed_cost: official.committed_cost, forecast_gross_profit: official.project_gross_profit });
  });
});
