/**
 * Phase 6 Batch 12A: approval integrity and workflow enforcement.
 *
 * Each attack is made by an ordinary signed-in user through the API (never with elevated
 * database credentials), and each legitimate workflow next to it still works:
 *   1. an Issued purchase order cannot be re-priced or re-scoped without a new purchase decision;
 *   2. a Major Purchase approval stays bound to the PO, project, supplier and total it approved;
 *   3. an invoice is paid only after it was approved, by holders of finance.record_payments;
 *   4. the requester cannot choose who approves a Major Purchase / Major Cost request.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Batch 12A: approval integrity', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let supA: string;
  let supB: string;
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    [supA, supB] = (await db.pool.query('SELECT id FROM suppliers ORDER BY id LIMIT 2')).rows.map((r) => r.id);
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const purchasing = () => as['Purchasing'];
  const accountant = () => as['Accountant'];
  const PROJ = 'proj-2';
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as Row[];
  const poRow = async (id: string) => (await q('SELECT status, total_amount::float AS total, supplier_id, project_id, data FROM purchase_orders WHERE id = $1', [id]))[0];
  const lines = (unitPrice: number, quantity = 1) => [{ id: 'l-1', item_description: 'Plywood', specification: 'E1', quantity, unit: 'lot', unit_price: unitPrice, total_price: 1 }];
  const createPo = async (total: number, over: Row = {}) => {
    const id = next('po-12a');
    await purchasing()
      .post('/api/purchase-orders')
      .send({ id, po_number: id.toUpperCase(), project_id: PROJ, project_name: 'Horizon', supplier_id: supA, supplier_name: 'Supplier A', items: lines(total), total_amount: 1, requested_by: 'Faridah', expected_delivery_date: '2026-10-20', created_at: '', status: 'Pending Approval', ...over })
      .expect(201);
    return id;
  };
  const majorPurchase = async (poId: string, over: Row = {}) => {
    const id = next('apr-12a');
    await purchasing()
      .post('/api/approvals')
      .send({ id, approval_number: id.toUpperCase(), approval_type: 'Major Purchase', title: `Major purchase ${poId}`, description: 'x', project_id: PROJ, project_name: 'Horizon', related_entity_type: 'purchase', related_entity_id: poId, date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '', ...over })
      .expect(201);
    return id;
  };
  const approve = (role: string, id: string) => as[role].post(`/api/approvals/${id}/decision`).send({ decision: 'Approved' });
  const issue = (id: string, agent = purchasing()) => agent.patch(`/api/purchase-orders/${id}`).send({ status: 'Issued' });

  // ================================================================ 1. Issued PO integrity
  describe('1. an Issued purchase order cannot be changed without a new purchase decision', () => {
    it('attack: Purchasing issues a small PO, then raises its lines and total past the Major Purchase threshold', async () => {
      const po = await createPo(15_000);
      await issue(po).expect(200);
      for (const patch of [{ items: lines(15_000, 3) }, { items: lines(90_000) }, { supplier_id: supB, supplier_name: 'Supplier B' }, { project_id: 'proj-1' }]) {
        const res = await purchasing().patch(`/api/purchase-orders/${po}`).send(patch);
        expect(res.status, JSON.stringify(patch)).toBe(403);
      }
      // A total on its own is ignored: the server always computes it from the lines.
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ total_amount: 90_000 }).expect(200);
      // The same edit through the bulk sync endpoint.
      const stored = (await purchasing().get(`/api/purchase-orders/${po}`).expect(200)).body;
      expect((await purchasing().post('/api/data/sync').send({ upserts: { purchaseOrders: [{ ...stored, items: lines(90_000) }] } })).status).toBe(403);
      // Nothing changed; the Owner is held to the same rule (the decision record is what was issued).
      expect((await owner().patch(`/api/purchase-orders/${po}`).send({ items: lines(90_000) })).status).toBe(403);
      expect(await poRow(po)).toMatchObject({ status: 'Issued', total: 15_000, supplier_id: supA });
    });

    it('legitimate: non-material fields of an Issued PO can still change', async () => {
      const po = await createPo(12_000);
      await issue(po).expect(200);
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ expected_delivery_date: '2026-11-30', notes: 'Supplier asked for a later slot' }).expect(200);
      expect((await poRow(po)).data).toMatchObject({ expected_delivery_date: '2026-11-30', notes: 'Supplier asked for a later slot' });
    });

    it('legitimate: to change what was ordered the PO returns to Draft, and issuing it again needs authority again', async () => {
      const po = await createPo(15_000);
      await issue(po).expect(200);
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Draft', items: lines(25_000) }).expect(200);
      expect(await poRow(po)).toMatchObject({ status: 'Draft', total: 25_000 });
      const refused = await issue(po);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/Major Purchase approval/);
      const apr = await majorPurchase(po);
      await approve('Accountant', apr).expect(200);
      await issue(po).expect(200);
    });

    it('goods received: the PO cannot return to Draft or change; a PO is completed only after it was issued', async () => {
      const po = await createPo(10_000);
      await issue(po).expect(200);
      await as['Site Supervisor'].post('/api/goods-received').send({ id: next('grn-12a'), po_id: po, project_id: PROJ, items: [{ po_item_id: 'l-1', received_qty: 0.5 }] }).expect(201);
      expect((await poRow(po)).status).toBe('Partially Received');
      expect((await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Draft' })).status).toBe(403);
      expect((await purchasing().patch(`/api/purchase-orders/${po}`).send({ items: lines(50_000) })).status).toBe(403);
      // Created as Completed, or a cancelled PO marked Completed, would skip the issuing decision.
      expect((await purchasing().post('/api/purchase-orders').send({ id: next('po-12a'), project_id: PROJ, supplier_id: supA, items: lines(80_000), status: 'Completed' })).status).toBe(403);
      const cancelled = await createPo(80_000);
      await purchasing().patch(`/api/purchase-orders/${cancelled}`).send({ status: 'Cancelled' }).expect(200);
      expect((await purchasing().patch(`/api/purchase-orders/${cancelled}`).send({ status: 'Completed' })).status).toBe(403);
      // An issued PO is still completed as before.
      const done = await createPo(5_000);
      await issue(done).expect(200);
      await purchasing().patch(`/api/purchase-orders/${done}`).send({ status: 'Completed' }).expect(200);
    });
  });

  // ================================================================ 2. Approval binding
  describe('2. a Major Purchase approval stays bound to what it approved', () => {
    it('records the approved PO, project, supplier and total from the server, never from the browser', async () => {
      const po = await createPo(30_000);
      const apr = await majorPurchase(po, { approved_facts: { po_id: 'po-anything', total_amount: 9e9 } });
      expect((await q('SELECT data FROM approvals WHERE id = $1', [apr]))[0].data.approved_facts).toBeUndefined();
      await purchasing().patch(`/api/approvals/${apr}`).send({ approved_facts: { po_id: po, total_amount: 9e9 } }).expect(200);
      expect((await q('SELECT data FROM approvals WHERE id = $1', [apr]))[0].data.approved_facts).toBeUndefined();
      await approve('Accountant', apr).expect(200);
      expect((await q('SELECT data FROM approvals WHERE id = $1', [apr]))[0].data.approved_facts).toMatchObject({ po_id: po, project_id: PROJ, supplier_id: supA, total_amount: 30_000 });
    });

    it('attack: the requester re-points an approved Major Purchase approval at another PO (and the Owner cannot either)', async () => {
      const small = await createPo(25_000);
      const big = await createPo(400_000);
      const apr = await majorPurchase(small);
      await approve('Accountant', apr).expect(200);
      for (const patch of [{ related_entity_id: big }, { project_id: 'proj-1' }, { approval_type: 'Major Cost' }, { related_entity_type: 'variation' }]) {
        expect((await purchasing().patch(`/api/approvals/${apr}`).send(patch)).status, JSON.stringify(patch)).toBe(403);
        expect((await owner().patch(`/api/approvals/${apr}`).send(patch)).status, `Owner ${JSON.stringify(patch)}`).toBe(403);
      }
      expect((await q('SELECT related_entity_id FROM approvals WHERE id = $1', [apr]))[0].related_entity_id).toBe(small);
      const refused = await issue(big);
      expect(refused.status).toBe(403);
      // Even a request re-pointed before Batch 12A (stored data) does not carry its approval over.
      await db.pool.query('UPDATE approvals SET related_entity_id = $2 WHERE id = $1', [apr, big]);
      expect((await issue(big)).status).toBe(403);
      await db.pool.query('UPDATE approvals SET related_entity_id = $2 WHERE id = $1', [apr, small]);
      await issue(small).expect(200);
    });

    it('a material change after approval needs a new approval; an unchanged or cheaper PO does not', async () => {
      const raised = await createPo(30_000);
      await approve('Accountant', await majorPurchase(raised)).expect(200);
      await purchasing().patch(`/api/purchase-orders/${raised}`).send({ items: lines(36_000) }).expect(200);
      expect((await issue(raised)).status).toBe(403);
      // Raising the price and issuing in one write is refused the same way.
      const oneWrite = await createPo(30_000);
      await approve('Accountant', await majorPurchase(oneWrite)).expect(200);
      expect((await purchasing().patch(`/api/purchase-orders/${oneWrite}`).send({ items: lines(36_000), status: 'Issued' })).status).toBe(403);
      // A new supplier is a new purchase decision.
      const moved = await createPo(30_000);
      await approve('Accountant', await majorPurchase(moved)).expect(200);
      await purchasing().patch(`/api/purchase-orders/${moved}`).send({ supplier_id: supB, supplier_name: 'Supplier B' }).expect(200);
      expect((await issue(moved)).status).toBe(403);
      // Re-approved at the new terms: issued.
      await approve('Accountant', await majorPurchase(moved)).expect(200);
      await issue(moved).expect(200);
      // Unchanged, or cheaper: no re-approval needed.
      const same = await createPo(30_000);
      await approve('Accountant', await majorPurchase(same)).expect(200);
      await purchasing().patch(`/api/purchase-orders/${same}`).send({ notes: 'Confirmed by phone' }).expect(200);
      await issue(same).expect(200);
      const cheaper = await createPo(30_000);
      await approve('Accountant', await majorPurchase(cheaper)).expect(200);
      await purchasing().patch(`/api/purchase-orders/${cheaper}`).send({ items: lines(28_500) }).expect(200);
      await issue(cheaper).expect(200);
    });

    it('an approval for a PO on another project counts for nothing', async () => {
      const po = await createPo(30_000);
      const apr = await majorPurchase(po, { project_id: 'proj-1', project_name: 'Aurora' });
      await approve('Owner / CEO', apr).expect(200);
      expect((await q('SELECT data FROM approvals WHERE id = $1', [apr]))[0].data.approved_facts).toBeNull();
      expect((await issue(po)).status).toBe(403);
    });

    it('the request cannot be changed in the same write that decides it', async () => {
      const a = await createPo(30_000);
      const b = await createPo(300_000);
      const apr = await majorPurchase(a);
      const stored = (await owner().get(`/api/approvals/${apr}`).expect(200)).body;
      expect((await owner().patch(`/api/approvals/${apr}`).send({ ...stored, decision: 'Approved', related_entity_id: b })).status).toBe(403);
      expect((await q('SELECT decision, related_entity_id FROM approvals WHERE id = $1', [apr]))[0]).toMatchObject({ decision: 'Pending', related_entity_id: a });
      // Before a decision the requester may still correct what the request is about.
      await purchasing().patch(`/api/approvals/${apr}`).send({ related_entity_id: b }).expect(200);
    });

    it('concurrent: raising the price while the PO is being issued never leaves it issued above the approved total', async () => {
      for (let i = 0; i < 4; i++) {
        const po = await createPo(30_000);
        await approve('Accountant', await majorPurchase(po)).expect(200);
        await Promise.all([issue(po), purchasing().patch(`/api/purchase-orders/${po}`).send({ items: lines(60_000), status: 'Pending Approval' })]);
        const row = await poRow(po);
        expect(row.status === 'Issued' && row.total > 30_000, JSON.stringify(row)).toBe(false);
      }
    });

    it('upgrade: migration 029 binds existing approvals from their decision-time audit record; others stay unbound', async () => {
      const po = await createPo(40_000);
      const legacy = await majorPurchase(po);
      await approve('Accountant', legacy).expect(200);
      // As stored before Batch 12A: no approved facts.
      await db.pool.query(`UPDATE approvals SET data = data - 'approved_facts' WHERE id = $1`, [legacy]);
      // A legacy approved request with no decision audit record (stored, as before audit existed).
      const orphanPo = await createPo(50_000);
      const orphan = next('apr-12a');
      await db.pool.query(
        `INSERT INTO approvals (id, project_id, approval_type, related_entity_type, related_entity_id, decision, data)
         VALUES ($1, $2, 'Major Purchase', 'purchase', $3, 'Approved', jsonb_build_object('id', $1::text, 'decision', 'Approved', 'decision_by_role', 'Accountant'))`,
        [orphan, PROJ, orphanPo]
      );
      expect((await issue(po)).status).toBe(403);
      // The backfill exactly as migration 029 runs it, run here by the runtime role.
      const sql = readFileSync(path.join(__dirname, '../../db/migrations/029_phase6_approval_integrity.sql'), 'utf8');
      await db.pool.query(sql.slice(sql.indexOf('UPDATE approvals a')));
      const facts = async (id: string) => (await q('SELECT data FROM approvals WHERE id = $1', [id]))[0].data.approved_facts;
      expect(await facts(legacy)).toMatchObject({ po_id: po, project_id: PROJ, total_amount: 40_000 });
      expect(await facts(legacy)).not.toHaveProperty('supplier_id');
      expect(await facts(orphan)).toBeUndefined();
      await issue(po).expect(200);
      expect((await issue(orphanPo)).status).toBe(403);
    });
  });

  // ================================================================ 3. Invoice lifecycle
  describe('3. an invoice is paid only after it was approved', () => {
    const invoice = (id: string, over: Row = {}) => ({ id, invoice_number: id.toUpperCase(), invoice_type: 'Subcontractor Claim Invoice', party_name: 'Joinery Co', project_id: PROJ, project_name: 'Horizon', amount_before_tax: 10_000, tax_amount: 0, total_amount: 1, invoice_date: '2026-10-22', due_date: '2026-11-21', status: 'Draft', paid_amount: 0, ...over });
    const status = async (id: string) => (await q('SELECT status, data FROM commercial_invoices WHERE id = $1', [id]))[0];

    it('attack: Draft or Pending Approval straight to Paid / Partially Paid / Overdue is refused, also for the Owner', async () => {
      const id = next('inv-12a');
      await accountant().post('/api/invoices').send(invoice(id)).expect(201);
      for (const [agent, patch] of [
        [accountant(), { status: 'Paid', paid_amount: 10_000 }],
        [accountant(), { status: 'Partially Paid', paid_amount: 4_000 }],
        [accountant(), { status: 'Overdue' }],
        [accountant(), { paid_amount: 10_000 }],
        [owner(), { status: 'Paid', paid_amount: 10_000 }],
      ] as const) {
        expect((await agent.patch(`/api/invoices/${id}`).send(patch)).status, JSON.stringify(patch)).toBe(403);
      }
      await accountant().patch(`/api/invoices/${id}`).send({ status: 'Pending Approval' }).expect(200);
      expect((await accountant().patch(`/api/invoices/${id}`).send({ status: 'Paid', paid_amount: 10_000 })).status).toBe(403);
      expect((await status(id)).status).toBe('Pending Approval');
      // Recorded as paid (or partly paid / overdue, or with money against it) from the start.
      for (const over of [{ status: 'Paid' }, { status: 'Partially Paid', paid_amount: 1 }, { status: 'Overdue' }, { status: 'Approved' }, { paid_amount: 5_000 }]) {
        expect((await accountant().post('/api/invoices').send(invoice(next('inv-12a'), over))).status, JSON.stringify(over)).toBe(403);
      }
    });

    it('legitimate: approved by someone with authority, then part paid and paid by finance', async () => {
      const id = next('inv-12a');
      await accountant().post('/api/invoices').send(invoice(id, { status: 'Pending Approval' })).expect(201);
      await owner().patch(`/api/invoices/${id}`).send({ status: 'Approved' }).expect(200);
      // Purchasing cannot record payments; amounts stay consistent with the status.
      expect((await purchasing().patch(`/api/invoices/${id}`).send({ status: 'Paid', paid_amount: 10_000 })).status).toBe(403);
      expect((await accountant().patch(`/api/invoices/${id}`).send({ status: 'Paid', paid_amount: 2_000 })).status).toBe(400);
      expect((await accountant().patch(`/api/invoices/${id}`).send({ status: 'Partially Paid', paid_amount: 12_000 })).status).toBe(400);
      expect((await accountant().patch(`/api/invoices/${id}`).send({ paid_amount: 4_000 })).status).toBe(400);
      await accountant().patch(`/api/invoices/${id}`).send({ status: 'Partially Paid', paid_amount: 4_000 }).expect(200);
      expect((await accountant().patch(`/api/invoices/${id}`).send({ paid_amount: 3_000 })).status).toBe(403);
      await accountant().patch(`/api/invoices/${id}`).send({ status: 'Overdue' }).expect(200);
      await accountant().patch(`/api/invoices/${id}`).send({ status: 'Paid', paid_amount: 10_000 }).expect(200);
      expect(await status(id)).toMatchObject({ status: 'Paid', data: { paid_amount: 10_000, approved_by_id: 'user-owner' } });
      // Paid is final; an approved invoice never goes back to Draft (it would escape its approval).
      for (const s of ['Draft', 'Pending Approval', 'Approved', 'Partially Paid']) {
        expect((await accountant().patch(`/api/invoices/${id}`).send({ status: s })).status, s).toBe(403);
      }
      const approved = next('inv-12a');
      await accountant().post('/api/invoices').send(invoice(approved, { status: 'Pending Approval' })).expect(201);
      await owner().patch(`/api/invoices/${approved}`).send({ status: 'Approved' }).expect(200);
      expect((await accountant().patch(`/api/invoices/${approved}`).send({ status: 'Draft' })).status).toBe(403);
      expect((await owner().patch(`/api/invoices/${approved}`).send({ status: 'Overdue', amount_before_tax: 99 })).status).toBe(403);
    });

    it('a legacy invoice in a payment state with no recorded approval cannot be marked paid', async () => {
      const id = next('inv-12a');
      await accountant().post('/api/invoices').send(invoice(id)).expect(201);
      await db.pool.query(`UPDATE commercial_invoices SET status = 'Overdue', data = data || '{"status": "Overdue"}'::jsonb WHERE id = $1`, [id]);
      expect((await accountant().patch(`/api/invoices/${id}`).send({ status: 'Paid', paid_amount: 10_000 })).status).toBe(403);
    });
  });

  // ================================================================ 4. Major Purchase approver
  describe('4. the requester cannot choose who approves a Major Purchase / Major Cost request', () => {
    it('attack: naming an accomplice (by user or role) when raising the request, or afterwards', async () => {
      const po = await createPo(500_000);
      for (const type of ['Major Purchase', 'Major Cost']) {
        for (const named of [{ assigned_approver_id: 'user-pm' }, { assigned_approver_role: 'Project Manager' }, { assigned_approver_role: 'Designated Authorized Manager' }, { assigned_approver_id: 'user-owner', assigned_approver_role: 'Owner / CEO' }]) {
          const res = await purchasing().post('/api/approvals').send({ id: next('apr-12a'), approval_type: type, title: 'x', project_id: PROJ, related_entity_type: 'purchase', related_entity_id: po, decision: 'Pending', ...named });
          expect(res.status, `${type} ${JSON.stringify(named)}`).toBe(403);
        }
      }
      const apr = await majorPurchase(po);
      expect((await purchasing().patch(`/api/approvals/${apr}`).send({ assigned_approver_role: 'Project Manager', assigned_approver_id: 'user-pm' })).status).toBe(403);
      // Raised as another type with an approver, then turned into a Major Purchase.
      const tech = next('apr-12a');
      await purchasing().post('/api/approvals').send({ id: tech, approval_type: 'Technical Change', title: 'x', project_id: PROJ, decision: 'Pending', assigned_approver_role: 'Project Manager', assigned_approver_id: 'user-pm' }).expect(201);
      expect((await purchasing().patch(`/api/approvals/${tech}`).send({ approval_type: 'Major Purchase', related_entity_type: 'purchase', related_entity_id: po })).status).toBe(403);
      // The accomplice cannot decide it; it is routed by the resolver.
      expect((await approve('Project Manager', apr)).status).toBe(403);
      const route = (await q(`SELECT assigned_user_id, routing_basis, authority_rule_code FROM approval_routes WHERE resource_kind = 'approval' AND resource_id = $1 AND status = 'open'`, [apr]))[0];
      expect(route).toMatchObject({ assigned_user_id: 'user-accountant', authority_rule_code: 'SYS-PURCHASE-ACCOUNTANT' });
      await approve('Accountant', apr).expect(200);
    });

    it('legitimate: no approver, or the Owner, may be named; other request types keep their assigned approver', async () => {
      const po = await createPo(60_000);
      await majorPurchase(po, { assigned_approver_role: 'Owner / CEO' });
      const plain = await majorPurchase(po);
      await purchasing().patch(`/api/approvals/${plain}`).send({ title: 'Plywood for level 3' }).expect(200);
      const safety = next('apr-12a');
      await as['Project Manager'].post('/api/approvals').send({ id: safety, approval_type: 'Safety-Critical Decision', title: 'x', project_id: PROJ, decision: 'Pending', assigned_approver_role: 'Accountant' }).expect(201);
      await approve('Accountant', safety).expect(200);
    });
  });
});
