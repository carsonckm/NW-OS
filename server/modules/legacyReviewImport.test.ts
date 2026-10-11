/**
 * Phase 6 Batch 12A (review follow-up): the Owner's legacy review and /api/data/import.
 *
 *  - Legacy invoices (a protected status with no recorded approval) and legacy Major Purchase
 *    approvals (no approved facts) are identified, never changed, and only the Owner can release /
 *    re-authorize / decline them, once, with a reason, as a new append-only record.
 *  - /api/data/import cannot create approval or release evidence, an approver, an AI proposal, or an
 *    issued PO the importer could not issue, and cannot overwrite a protected record.
 * Attacks are made through the API by signed-in users (as the app role in restricted mode).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessContext } from '../auth/access';
import { withTransaction } from '../db/pool';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { guardImportedRecord } from './importGuard';
import { IDENTIFY_SQL } from './legacyReview';
import { DataService } from './service';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Batch 12A: legacy review and import protection', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const accountant = () => as['Accountant'];
  const purchasing = () => as['Purchasing'];
  const PROJ = 'proj-2';
  let n = 0;
  const next = (p: string) => `${p}-${++n}`;
  const q = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows as Row[];
  const review = (agent: request.Agent, kind: string, id: string, body: Row) => agent.post(`/api/legacy-reviews/${kind}/${id}/decision`).send(body);
  const importData = (data: Row) => owner().post('/api/data/import').send(data);
  const invoiceRow = (id: string, over: Row = {}) => ({ id, invoice_number: id.toUpperCase(), invoice_type: 'Subcontractor Claim Invoice', party_name: 'Joinery Co', project_id: PROJ, project_name: 'Horizon', amount_before_tax: 10_000, tax_amount: 0, total_amount: 10_000, invoice_date: '2026-09-01', due_date: '2026-10-01', status: 'Draft', paid_amount: 0, ...over });
  const createPo = async (total: number) => {
    const id = next('po-lr');
    await purchasing().post('/api/purchase-orders').send({ id, po_number: id.toUpperCase(), project_id: PROJ, project_name: 'Horizon', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: total, total_price: 1 }], total_amount: 1, requested_by: 'Faridah', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }).expect(201);
    return id;
  };
  const legacyApproval = (id: string, poId: string, over: Row = {}) => ({ id, approval_number: id.toUpperCase(), approval_type: 'Major Purchase', title: `Legacy ${poId}`, description: 'x', project_id: PROJ, project_name: 'Horizon', related_entity_type: 'purchase', related_entity_id: poId, requested_by_id: 'user-purchasing', decision: 'Approved', decision_by_id: 'user-owner', decision_by_name: 'Owner', decision_by_role: 'Owner / CEO', decision_date: '2026-01-05', date_requested: '2026-01-04', created_at: '', updated_at: '', ...over });

  // ================================================================ scope
  describe('scope: what the demo data needs reviewed (a non-production database)', () => {
    it('the seeded legacy invoices are identified at import; nothing was changed', async () => {
      const items = await q(`SELECT kind, record_id, identified_by, details FROM legacy_review_items ORDER BY id`);
      const invoices = items.filter((i) => i.kind === 'invoice');
      // The demo seed: two Partially Paid and one Paid invoice, none with a recorded approval.
      expect(invoices.map((i) => i.details.status).sort()).toEqual(['Paid', 'Partially Paid', 'Partially Paid']);
      expect(items.filter((i) => i.kind === 'purchase_approval')).toEqual([]);
      expect(items.every((i) => i.identified_by === 'import')).toBe(true);
      const stored = await q(`SELECT id, status, data FROM commercial_invoices WHERE id = ANY($1)`, [invoices.map((i) => i.record_id)]);
      expect(stored.every((r) => !r.data.approved_at && !r.data.legacy_release)).toBe(true);
    });

    it('the identification in migration 030 and in the server select the same records', async () => {
      const sql = readFileSync(path.join(__dirname, '../../db/migrations/030_phase6_legacy_review_and_request_approvers.sql'), 'utf8');
      const selectOf = (stmt: string) => stmt.slice(stmt.indexOf('SELECT'), stmt.indexOf('ON CONFLICT')).replace('$1', `'x'`).replace(`'migration 030'`, `'x'`);
      const migration = sql.split('INSERT INTO legacy_review_items').slice(1).map((s) => selectOf(s));
      expect(migration).toHaveLength(2);
      for (const [i, kind] of (['invoice', 'purchase_approval'] as const).entries()) {
        const a = (await db.pool.query(migration[i])).rows;
        const b = (await db.pool.query(selectOf(IDENTIFY_SQL[kind]))).rows;
        expect(b, kind).toEqual(a);
      }
    });
  });

  // ================================================================ 1. legacy invoices
  describe('1. legacy invoice release', () => {
    let pp: string[];
    let paid: string;
    beforeAll(async () => {
      const items = await q(`SELECT record_id, details FROM legacy_review_items WHERE kind = 'invoice' ORDER BY id`);
      pp = items.filter((i) => i.details.status === 'Partially Paid').map((i) => i.record_id);
      paid = items.find((i) => i.details.status === 'Paid')!.record_id;
    });
    const total = async (id: string) => Number((await q('SELECT data FROM commercial_invoices WHERE id = $1', [id]))[0].data.total_amount);

    it('without a release a legacy invoice cannot be paid, by anyone', async () => {
      for (const agent of [accountant(), owner()]) {
        const res = await agent.patch(`/api/invoices/${pp[0]}`).send({ status: 'Paid', paid_amount: await total(pp[0]) });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/Owner reviews and releases it/);
      }
    });

    it('only the Owner reviews; the browser sends only the decision and a reason', async () => {
      for (const role of ['Accountant', 'Admin', 'Purchasing', 'Project Manager', 'Client']) {
        expect((await as[role].get('/api/legacy-reviews')).status, role).toBe(403);
        expect((await review(as[role], 'invoice', pp[0], { decision: 'released', reason: 'x' })).status, role).toBe(403);
      }
      expect((await review(owner(), 'invoice', pp[0], { decision: 'released' })).status).toBe(400);
      expect((await review(owner(), 'invoice', pp[0], { decision: 'approved', reason: 'x' })).status).toBe(400);
      expect((await review(owner(), 'invoice', pp[0], { decision: 'released', reason: 'x', reviewed_by_id: 'user-accountant' })).status).toBe(400);
      expect((await review(owner(), 'payment', pp[0], { decision: 'released', reason: 'x' })).status).toBe(400);
      // Only identified records: a new invoice is never reviewable (no general bypass).
      const fresh = next('inv-lr');
      await accountant().post('/api/invoices').send(invoiceRow(fresh)).expect(201);
      expect((await review(owner(), 'invoice', fresh, { decision: 'released', reason: 'x' })).status).toBe(404);
      expect(await q('SELECT 1 FROM legacy_review_decisions')).toEqual([]);
    });

    it('authorized release: recorded as an administrative decision; nothing approved or paid; then paid through the normal checks', async () => {
      const before = (await q('SELECT status, data FROM commercial_invoices WHERE id = $1', [pp[0]]))[0];
      const res = await review(owner(), 'invoice', pp[0], { decision: 'released', reason: 'Checked against the bank statement of 3 Sep 2026' }).expect(201);
      expect(res.body).toMatchObject({ decision: 'released', reviewed_by: { id: 'user-owner' }, reason: 'Checked against the bank statement of 3 Sep 2026' });
      const d = (await q('SELECT * FROM legacy_review_decisions WHERE id = $1', [res.body.id]))[0];
      expect(d).toMatchObject({ decision: 'released', reviewed_by_id: 'user-owner', reviewed_by_role: 'Owner / CEO', facts: null });
      expect(Number.isNaN(Date.parse(String(d.reviewed_at)))).toBe(false);
      const audit = (await q(`SELECT actor_id, before, after FROM audit_logs WHERE action = 'legacy_review.released' AND entity_id = $1`, [pp[0]]))[0];
      expect(audit).toMatchObject({ actor_id: 'user-owner', after: { decision: 'released', administrative: true, review_id: res.body.id } });
      // The invoice itself is unchanged: no approval is fabricated, no status changed.
      const after = (await q('SELECT status, data FROM commercial_invoices WHERE id = $1', [pp[0]]))[0];
      expect(after).toEqual(before);
      expect(after.data.approved_at).toBeUndefined();
      // Duplicate review: refused.
      expect((await review(owner(), 'invoice', pp[0], { decision: 'released', reason: 'again' })).status).toBe(409);
      expect((await review(owner(), 'invoice', pp[0], { decision: 'declined', reason: 'changed my mind' })).status).toBe(409);
      // Payment permission and payment checks still apply.
      const t = await total(pp[0]);
      expect((await purchasing().patch(`/api/invoices/${pp[0]}`).send({ status: 'Paid', paid_amount: t })).status).toBe(403);
      expect((await accountant().patch(`/api/invoices/${pp[0]}`).send({ status: 'Paid', paid_amount: t - 1 })).status).toBe(400);
      expect((await accountant().patch(`/api/invoices/${pp[0]}`).send({ status: 'Draft' })).status).toBe(403);
      await accountant().patch(`/api/invoices/${pp[0]}`).send({ status: 'Paid', paid_amount: t }).expect(200);
    });

    it('declined: the invoice stays blocked; a Paid legacy invoice is acknowledged, never released', async () => {
      await review(owner(), 'invoice', pp[1], { decision: 'declined', reason: 'No supporting documents' }).expect(201);
      expect((await accountant().patch(`/api/invoices/${pp[1]}`).send({ status: 'Paid', paid_amount: await total(pp[1]) })).status).toBe(403);
      expect((await review(owner(), 'invoice', paid, { decision: 'released', reason: 'x' })).status).toBe(409);
      await review(owner(), 'invoice', paid, { decision: 'acknowledged', reason: 'Paid in 2025, before NW OS' }).expect(201);
      const list = (await owner().get('/api/legacy-reviews').expect(200)).body;
      expect(list.items.filter((i: Row) => i.kind === 'invoice').map((i: Row) => i.decision?.decision).sort()).toEqual(['acknowledged', 'declined', 'released']);
    });

    it('review records are append-only for the runtime role', async () => {
      for (const sql of ['UPDATE legacy_review_decisions SET decision = \'released\'', 'DELETE FROM legacy_review_decisions', 'UPDATE legacy_review_items SET reason = \'x\'', 'DELETE FROM legacy_review_items']) {
        await expect(db.pool.query(sql), sql).rejects.toThrow(/permission denied|append-only/);
      }
    });
  });

  // ================================================================ 2. legacy purchase approvals
  describe('2. legacy Major Purchase approvals: Owner re-authorization', () => {
    it('an imported approval without approval evidence does not count; the Owner re-authorizes it against the PO as it is now', async () => {
      const po = await createPo(30_000);
      const apr = next('apr-lr');
      // Even with forged approved facts, an imported approval is unbound.
      const res = await importData({ approvals: [legacyApproval(apr, po, { approved_facts: { po_id: po, project_id: PROJ, total_amount: 9e9 } })] }).expect(200);
      expect(res.body.ok).toBe(true);
      const original = (await q('SELECT * FROM approvals WHERE id = $1', [apr]))[0];
      expect(original.data.approved_facts).toBeUndefined();
      expect((await q(`SELECT 1 FROM legacy_review_items WHERE kind = 'purchase_approval' AND record_id = $1`, [apr])).length).toBe(1);
      expect((await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' })).status).toBe(403);
      // Unauthorized attempts.
      for (const role of ['Accountant', 'Purchasing', 'Admin']) expect((await review(as[role], 'purchase_approval', apr, { decision: 'reauthorized', reason: 'x' })).status, role).toBe(403);
      // The PO changed since the legacy approval: the re-authorization is taken on the PO as it is now.
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 32_000 }] }).expect(200);
      const ok = await review(owner(), 'purchase_approval', apr, { decision: 'reauthorized', reason: 'Re-checked the supplier quote' }).expect(201);
      expect(ok.body.facts).toMatchObject({ po_id: po, project_id: PROJ, total_amount: 32_000 });
      const d = (await q('SELECT * FROM legacy_review_decisions WHERE id = $1', [ok.body.id]))[0];
      expect(d.authority).toMatchObject({ decision_type: 'purchase', actor_id: 'user-owner', result: 'allowed' });
      // The original approval record is untouched; the decision is a new record.
      expect((await q('SELECT * FROM approvals WHERE id = $1', [apr]))[0]).toEqual(original);
      expect((await review(owner(), 'purchase_approval', apr, { decision: 'reauthorized', reason: 'again' })).status).toBe(409);
      // Raised above what was re-authorized: refused; at the re-authorized total: issued.
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 40_000 }] }).expect(200);
      expect((await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' })).status).toBe(403);
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 32_000 }] }).expect(200);
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' }).expect(200);
    });

    it('declined, or a non-identified approval: no effect', async () => {
      const po = await createPo(25_000);
      const apr = next('apr-lr');
      await importData({ approvals: [legacyApproval(apr, po)] }).expect(200);
      await review(owner(), 'purchase_approval', apr, { decision: 'declined', reason: 'Approved by someone who has left; ask again' }).expect(201);
      expect((await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' })).status).toBe(403);
      expect((await review(owner(), 'purchase_approval', 'apr-not-identified', { decision: 'reauthorized', reason: 'x' })).status).toBe(404);
    });
  });

  // ================================================================ 3. import
  describe('3. /api/data/import cannot bypass the protections', () => {
    it('cannot modify an Issued PO or re-point an approved request (existing ids are never overwritten)', async () => {
      const po = await createPo(5_000);
      await purchasing().patch(`/api/purchase-orders/${po}`).send({ status: 'Issued' }).expect(200);
      const apr = next('apr-lr');
      await owner().post('/api/approvals').send({ id: apr, approval_type: 'Safety-Critical Decision', title: 'x', project_id: PROJ, decision: 'Pending' }).expect(201);
      await owner().post(`/api/approvals/${apr}/decision`).send({ decision: 'Approved' }).expect(200);
      const poBefore = (await q('SELECT * FROM purchase_orders WHERE id = $1', [po]))[0];
      const aprBefore = (await q('SELECT * FROM approvals WHERE id = $1', [apr]))[0];
      const res = await importData({
        purchaseOrders: [{ ...poBefore.data, items: [{ id: 'l-1', item_description: 'Plywood', quantity: 1, unit_price: 900_000 }] }],
        approvals: [{ ...aprBefore.data, related_entity_id: 'po-elsewhere', project_id: 'proj-1' }],
      }).expect(200);
      expect(res.body.summary.purchaseOrders).toMatchObject({ skippedExisting: 1, new: 0 });
      expect(res.body.summary.approvals).toMatchObject({ skippedExisting: 1, new: 0 });
      expect((await q('SELECT * FROM purchase_orders WHERE id = $1', [po]))[0]).toEqual(poBefore);
      expect((await q('SELECT * FROM approvals WHERE id = $1', [apr]))[0]).toEqual(aprBefore);
    });

    it('a PO imported as issued needs the importer\'s own authority to issue it (as the API would)', async () => {
      const purchasingUser = (await q(`SELECT * FROM users WHERE id = 'user-purchasing'`))[0];
      const ctx = await AccessContext.load(db.pool, purchasingUser as never);
      const big = { id: next('po-imp'), project_id: PROJ, status: 'Issued', supplier_id: null, items: [{ id: 'l-1', quantity: 1, unit_price: 500_000 }], total_amount: 1 };
      await expect(withTransaction(db.pool, async (c) => guardImportedRecord({ db: c, ctx } as never, 'purchaseOrders', big))).rejects.toThrow(/may not issue it/);
      // Below the threshold Purchasing may issue: accepted, with the server's total.
      const small = await withTransaction(db.pool, async (c) => guardImportedRecord({ db: c, ctx } as never, 'purchaseOrders', { ...big, items: [{ id: 'l-1', quantity: 2, unit_price: 1_000 }] }));
      expect(small.total_amount).toBe(2_000);
    });

    it('cannot import an approver, an AI proposal, approval facts or approval evidence', async () => {
      const req = next('apr-imp');
      const ai = next('apr-imp');
      const res = await importData({ approvals: [{ id: req, approval_type: 'Safety-Critical Decision', title: 'x', project_id: PROJ, decision: 'Pending', assigned_approver_id: 'user-pm', assigned_approver_name: 'PM', assigned_approver_role: 'Project Manager' }] }).expect(200);
      expect(res.body.ok).toBe(true);
      const stored = (await q('SELECT data FROM approvals WHERE id = $1', [req]))[0].data;
      expect(stored.assigned_approver_id).toBeUndefined();
      expect(stored.assigned_approver_role).toBeUndefined();
      expect(stored.imported_assigned_approver).toMatchObject({ id: 'user-pm', role: 'Project Manager' });
      expect((await as['Project Manager'].post(`/api/approvals/${req}/decision`).send({ decision: 'Approved' })).status).toBe(403);
      const aiRes = await importData({ approvals: [{ id: ai, approval_type: 'AI Proposal', title: 'x', project_id: PROJ, decision: 'Pending', assigned_approver_id: 'user-pm', proposal: { action: 'create_task', params: {} } }] });
      expect(aiRes.status).toBe(422);
      expect(aiRes.body.problems[0]).toMatch(/AI proposal/);
      expect(await q('SELECT 1 FROM approvals WHERE id = $1', [ai])).toEqual([]);
    });

    it('cannot mark an invoice paid or approved: evidence is stripped, the invoice is listed for review and stays blocked', async () => {
      const paidLike = next('inv-imp');
      const partly = next('inv-imp');
      const res = await importData({
        commercialInvoices: [
          invoiceRow(paidLike, { status: 'Paid', paid_amount: 10_000, approved_at: '2026-01-01T00:00:00Z', approved_by_id: 'user-owner', approval_authority: { result: 'allowed' }, recorded_by_id: 'user-owner' }),
          invoiceRow(partly, { status: 'Partially Paid', paid_amount: 4_000, approved_at: '2026-01-01T00:00:00Z', legacy_release: { review_id: 1 } }),
        ],
      }).expect(200);
      expect(res.body.ok).toBe(true);
      for (const id of [paidLike, partly]) {
        const data = (await q('SELECT data FROM commercial_invoices WHERE id = $1', [id]))[0].data;
        expect(data.approved_at).toBeUndefined();
        expect(data.approved_by_id).toBeUndefined();
        expect(data.approval_authority).toBeUndefined();
        expect(data.recorded_by_id).toBe('user-owner');
        expect((await q(`SELECT 1 FROM legacy_review_items WHERE kind = 'invoice' AND record_id = $1`, [id])).length).toBe(1);
      }
      // The legacy review cannot be bypassed: no release, so no payment.
      expect((await accountant().patch(`/api/invoices/${partly}`).send({ status: 'Paid', paid_amount: 10_000 })).status).toBe(403);
      expect(await q(`SELECT d.* FROM legacy_review_decisions d JOIN legacy_review_items i ON i.id = d.item_id WHERE i.record_id = ANY($1)`, [[paidLike, partly]])).toEqual([]);
      // Paid amounts must agree with the status; unknown statuses are refused.
      for (const bad of [{ status: 'Paid', paid_amount: 2_000 }, { status: 'Partially Paid', paid_amount: 0 }, { status: 'Draft', paid_amount: 500 }, { status: 'Settled' }]) {
        const r = await importData({ commercialInvoices: [invoiceRow(next('inv-imp'), bad)] });
        expect(r.status, JSON.stringify(bad)).toBe(422);
      }
      // Legacy review tables are not importable.
      const sneaky = await importData({ legacy_review_decisions: [{ item_id: 1, decision: 'released', reason: 'x' }], legacyReviewDecisions: [{ item_id: 1 }] } as Row);
      expect(sneaky.status).toBe(200);
      expect((await q(`SELECT count(*)::int AS n FROM legacy_review_decisions WHERE reason = 'x'`))[0].n).toBe(0);
    });
  });

  it('a dry run of DataService.importData applies the same guard', async () => {
    const ownerUser = (await q(`SELECT * FROM users WHERE id = 'user-owner'`))[0];
    const ctx = await AccessContext.load(db.pool, ownerUser as never);
    const r = await new DataService(db.pool).importData(ctx, { approvals: [{ id: next('apr-imp'), approval_type: 'AI Proposal', title: 'x', project_id: PROJ, decision: 'Pending' }] }, { dryRun: true }, { id: 'user-owner' });
    expect(r.ok).toBe(false);
    expect(r.problems[0]).toMatch(/AI proposal/);
  });
});
