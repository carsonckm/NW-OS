/**
 * Phase 4 end-to-end acceptance: one new project from client enquiry to closure, every step
 * through the authenticated API as the role that does it in real life, and every step
 * checked against what PostgreSQL holds (the next step only works because the previous one
 * was stored).
 */
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { signIn } from '../test/app';
import type express from 'express';
import { demoData } from './demo';
import { runAutomation } from './automation';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 4 end-to-end acceptance: enquiry to closure', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let app: express.Express;
  const D = demoData();
  const s: Row = {}; // what each step hands to the next (ids only; values come from the database)
  beforeAll(async () => {
    ({ db, as, app } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const pm = () => as['Project Manager'];
  const site = () => as['Site Supervisor'];
  const buyer = () => as['Purchasing'];
  const accountant = () => as['Accountant'];
  const prodMgr = () => as['Production Manager'];
  const staff = () => as['Production Staff'];
  /** Expects a status and shows the server's message when it differs. */
  const ok = async (req: PromiseLike<request.Response>, status: number) => {
    const res = await req;
    if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body)}`);
    return res;
  };
  const one = async (sql: string, params: unknown[] = []) => (await db.pool.query(sql, params)).rows[0] as Row;

  it('1. client enquiry', async () => {
    await ok(pm().post('/api/client-enquiries').send({ id: 'e2e-enq', enquiry_number: 'ENQ-E2E', client_id: 'client-2', client_name: 'Horizon', project_name: 'Horizon Sky Lounge', contact_person: 'Ms Lim', source: 'Referral', scope_description: 'Bar counter and wine display', received_date: '2026-10-05', target_submission_date: '2026-10-20', status: 'New', assigned_estimator: 'Marcus', follow_up_date: '2026-10-08' }), 201);
    expect(await one(`SELECT status FROM client_enquiries WHERE id = 'e2e-enq'`)).toEqual({ status: 'New' });
  });

  it('2. tender from the enquiry', async () => {
    await ok(pm().post('/api/tenders').send({ id: 'e2e-tdr', tender_number: 'TDR-E2E', enquiry_id: 'e2e-enq', client_id: 'client-2', client_name: 'Horizon', project_name: 'Horizon Sky Lounge', submission_deadline: '2026-10-20', estimated_value: 60000, status: 'In Preparation', documents: [], assigned_lead: 'Marcus', bq_reference: 'BQ-E2E' }), 201);
    expect(await one(`SELECT enquiry_id FROM commercial_tenders WHERE id = 'e2e-tdr'`)).toEqual({ enquiry_id: 'e2e-enq' });
  });

  it('3-4. quotation with internal costing, priced by the server', async () => {
    const line = (id: string, code: string, price: number, cost: Row) => ({ id, item_code: code, description: code, category: 'Joinery', specification: 'Oak', quantity: 1, unit: 'nos', unit_selling_price: price, estimated_cost_breakdown: cost, cost_source: 'Material Price', cost_confidence: 'High', notes: 'INTERNAL', total_selling_price: 1, total_estimated_cost: 1 });
    const res = await pm()
      .post('/api/quotations')
      .send({ id: 'e2e-qt', quotation_number: 'QT-E2E', version: 1, version_code: 'QT-E2E-V1', client_id: 'client-2', client_name: 'Horizon', enquiry_id: 'e2e-enq', tender_id: 'e2e-tdr', project_name: 'Horizon Sky Lounge', date: '2026-10-06', validity_days: 30, status: 'Draft', items: [line('l1', 'BAR-01', 40000, { material: 14000, labour: 8000 }), line('l2', 'WIN-01', 20000, { material: 7000, labour: 3000 })], tax_applicable: false, total_selling_price: 1, terms: '50% deposit' })
      .expect(201);
    expect(res.body).toMatchObject({ subtotal_selling_price: 60000, total_estimated_cost: 32000, estimated_gross_profit: 28000 });
  });

  it('5. internal approval by someone else, then submission; the client copy has no costs', async () => {
    await ok(pm().patch('/api/quotations/e2e-qt').send({ status: 'Internal Review' }), 200);
    expect((await pm().patch('/api/quotations/e2e-qt').send({ approval_status: 'Approved' })).status).toBe(403);
    await ok(accountant().patch('/api/quotations/e2e-qt').send({ approval_status: 'Approved' }), 200);
    await ok(pm().patch('/api/quotations/e2e-qt').send({ status: 'Submitted' }), 200);
    const client = JSON.stringify((await ok(owner().get('/api/quotations/e2e-qt/client-view'), 200)).body);
    expect(client).not.toMatch(/cost|margin|profit|INTERNAL/i);
  });

  it('6-7. award and convert to a project carrying the quotation forward', async () => {
    await ok(pm().patch('/api/quotations/e2e-qt').send({ status: 'Accepted' }), 200);
    const res = await ok(owner().post('/api/quotations/e2e-qt/convert').send({ project_number: 'NW-2026-E2E', start_date: '2026-11-01', end_date: '2027-02-28', site_address: 'Horizon Tower L38', project_manager_id: 'user-pm' }), 201);
    s.project = res.body.project.id;
    expect(await one(`SELECT project_status, contract_value::float AS v, client_id FROM projects WHERE id = $1`, [s.project])).toEqual({ project_status: 'Awarded', v: 60000, client_id: 'client-2' });
    expect((await one(`SELECT status FROM client_enquiries WHERE id = 'e2e-enq'`)).status).toBe('Won');
    // Site team, production staff and the contractor work on this project from now on.
    await ok(owner().patch(`/api/projects/${s.project}`).send({ site_supervisor_id: 'user-site', project_status: 'Active' }), 200);
    await ok(as['Admin'].put('/api/users/user-prod-staff/projects').send({ project_ids: ['proj-1', s.project] }), 200);
  });

  it('8-10. drawing upload, review and approval; NW production drawing approved for production', async () => {
    await ok(pm().post('/api/drawings').send({ id: 'e2e-dwg', project_id: s.project, drawing_number: 'E2E-101', title: 'Bar counter', category: 'Carpentry', created_at: '2026-11-02', revisions: [], nw_production_drawings: [] }), 201);
    await ok(pm().post('/api/drawings/e2e-dwg/revisions').send({ id: 'e2e-rev1', revision: 'Rev 1', title: 'Bar counter Rev 1', file_url: '/e2e/bar-rev1.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }), 201);
    await ok(pm().post('/api/drawings/e2e-dwg/revisions/e2e-rev1/status').send({ status: 'Internal Review' }), 200);
    expect((await pm().post('/api/drawings/e2e-dwg/revisions/e2e-rev1/status').send({ status: 'Approved' })).status).toBe(403);
    await ok(owner().post('/api/drawings/e2e-dwg/revisions/e2e-rev1/status').send({ status: 'Approved' }), 200);
    expect(await one(`SELECT approval_status, is_current, data->>'approved_by' AS by FROM drawing_revisions WHERE id = 'e2e-rev1'`)).toEqual({ approval_status: 'Approved', is_current: true, by: 'Owner / CEO' });
    const drawing = (await ok(owner().get('/api/drawings/e2e-dwg'), 200)).body;
    const nw = { ...D.drawings[0].nw_production_drawings[0], id: 'e2e-nwd', drawing_number: 'E2E-101-NW', linked_client_drawing_id: 'e2e-dwg', linked_client_revision: 'Rev 1', status: 'Draft', approved_for_production: false, approved_by: undefined, approved_date: undefined };
    await ok(prodMgr().patch('/api/drawings/e2e-dwg').send({ ...drawing, nw_production_drawings: [nw] }), 200);
    await ok(owner().patch('/api/drawings/e2e-dwg').send({ ...drawing, nw_production_drawings: [{ ...nw, status: 'Approved', approved_for_production: true }] }), 200);
    expect(await one(`SELECT approved_for_production, linked_client_revision_id FROM drawing_revisions WHERE id = 'e2e-nwd'`)).toEqual({ approved_for_production: true, linked_client_revision_id: 'e2e-rev1' });
  });

  it('11-12. work package and work items on the approved drawing', async () => {
    const wp = (await ok(pm().post('/api/work-packages').send({ id: 'e2e-wp', project_id: s.project, name: 'BAR JOINERY', category: 'Carpentry', contractor_id: 'con-1', project_manager_id: 'user-pm', start_date: '2026-11-03', end_date: '2027-01-31', status: 'Assigned', progress_percent: 0 }), 201)).body;
    s.wp = wp.id;
    const item = (await ok(pm().post('/api/work-items').send({ id: 'e2e-item', work_package_id: s.wp, item_code: 'BAR-01', description: 'Bar counter 3600mm', location: 'Sky lounge', quantity: 1, unit: 'unit', drawing_id: 'e2e-dwg', drawing_revision: 'Rev 1', material: '18mm plywood', finish: 'Oak', dimensions: '3600 x 700 x 1100mm', required_date: '2027-01-15', contractor_id: 'con-1', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started' }), 201)).body;
    s.item = item.id;
    expect(await one(`SELECT project_id, work_package_id FROM work_items WHERE id = $1`, [s.item])).toEqual({ project_id: s.project, work_package_id: s.wp });
  });

  it('13. production order on the exact approved revisions', async () => {
    const order = { ...D.productionOrders[0], id: 'e2e-po', order_number: 'PO-E2E', project_id: s.project, project_name: 'Horizon Sky Lounge', work_package_id: s.wp, work_item_id: s.item, work_item_code: 'BAR-01', contractor_id: 'con-1', status: 'Not Started', current_stage: 'Not Started', approved_client_drawing_id: 'e2e-dwg', approved_client_drawing_revision: 'E2E-101 Rev 1', approved_nw_production_drawing_id: 'e2e-nwd', approved_nw_production_drawing_revision: 'E2E-101-NW Rev 1', stage_history: [] };
    const res = await ok(prodMgr().post('/api/production-orders').send(order), 201);
    expect(res.body).toMatchObject({ client_drawing_revision_id: 'e2e-rev1', nw_drawing_revision_id: 'e2e-nwd', drawing_check: 'valid' });
    // The item links to its order (set by the server); a production user can't point it at another item's order.
    expect((await one(`SELECT production_order_id FROM work_items WHERE id = $1`, [s.item])).production_order_id).toBe('e2e-po');
    await ok(prodMgr().patch(`/api/work-items/${s.item}`).send({ production_order_id: 'e2e-po' }), 200);
    expect((await prodMgr().patch(`/api/work-items/${s.item}`).send({ production_order_id: 'po-102' })).status).toBe(400);
  });

  it('14-15. material request and a purchase order approved as a major purchase', async () => {
    await ok(pm().post('/api/material-requests').send({ ...D.materialRequests[0], id: 'e2e-mr', request_number: 'MR-E2E', project_id: s.project, project_name: 'Horizon Sky Lounge', material_name: 'Oak veneer plywood', required_quantity: 20, unit: 'sheet', status: 'Pending' }), 201);
    await ok(buyer().post('/api/purchase-orders').send({ id: 'e2e-po-buy', po_number: 'PUR-E2E', project_id: s.project, project_name: 'Horizon Sky Lounge', supplier_name: 'Timber Co', material_request_id: 'e2e-mr', items: [{ id: 'pl-1', item_description: 'Oak veneer plywood', specification: 'E1', quantity: 20, unit: 'sheet', unit_price: 1100, total_price: 0 }], total_amount: 0, status: 'Pending Approval', requested_by: 'Purchasing', expected_delivery_date: '2026-11-20', created_at: '' }), 201);
    expect((await one(`SELECT total_amount::float AS t FROM purchase_orders WHERE id = 'e2e-po-buy'`)).t).toBe(22000);
    await ok(buyer().post('/api/approvals').send({ id: 'e2e-apr', approval_number: 'APR-E2E', approval_type: 'Major Purchase', title: 'PUR-E2E RM 22,000', description: 'Plywood', project_id: s.project, project_name: 'Horizon Sky Lounge', related_entity_type: 'purchase', related_entity_id: 'e2e-po-buy', assigned_approver_role: 'Owner / CEO', date_requested: '2026-11-05', decision: 'Pending', created_at: '', updated_at: '' }), 201);
    await ok(owner().post('/api/approvals/e2e-apr/decision').send({ decision: 'Approved' }), 200);
    await ok(buyer().patch('/api/purchase-orders/e2e-po-buy').send({ status: 'Issued' }), 200);
    expect((await ok(accountant().get(`/api/projects/${s.project}/profitability`), 200)).body.committed_cost).toBe(22000);
  });

  it('16. goods received (with a short line) against the PO', async () => {
    await ok(site().post('/api/goods-received').send({ id: 'e2e-grn', grn_number: 'GRN-E2E', po_id: 'e2e-po-buy', project_id: s.project, delivery_note_number: 'DN-1', items: [{ po_item_id: 'pl-1', received_qty: 18, notes: '2 sheets to follow' }], photos: ['dn.jpg'] }), 201);
    expect(await one(`SELECT status FROM purchase_orders WHERE id = 'e2e-po-buy'`)).toEqual({ status: 'Partially Received' });
    await ok(site().post('/api/goods-received').send({ id: 'e2e-grn2', grn_number: 'GRN-E2E-2', po_id: 'e2e-po-buy', project_id: s.project, items: [{ po_item_id: 'pl-1', received_qty: 2 }] }), 201);
    expect(await one(`SELECT status FROM purchase_orders WHERE id = 'e2e-po-buy'`)).toEqual({ status: 'Goods Received' });
  });

  it('17. production moves through its stages; the work item follows', async () => {
    for (const st of ['Cutting', 'CNC', 'Edge Banding', 'Assembly', 'Finishing', 'QC']) await ok(staff().patch('/api/production-orders/e2e-po').send({ status: st }), 200);
    expect(await one(`SELECT production_status FROM work_items WHERE id = $1`, [s.item])).toEqual({ production_status: 'QC' });
  });

  it('18. factory QC passes', async () => {
    await ok(staff().post('/api/factory-qc').send({ ...D.factoryQCInspections[0], id: 'e2e-fqc', production_order_id: 'e2e-po', production_order_number: 'PO-E2E', work_item_code: 'BAR-01', result: 'Passed' }), 201);
    expect(await one(`SELECT result FROM factory_qc_inspections WHERE id = 'e2e-fqc'`)).toEqual({ result: 'Passed' });
  });

  it('19. packing, ready for delivery', async () => {
    await ok(staff().post('/api/packing-packages').send({ ...D.packingPackages[0], id: 'e2e-pkg', package_number: 'PKG-E2E-1/1', production_order_id: 'e2e-po', production_order_number: 'PO-E2E', work_item_code: 'BAR-01', barcode: 'BC-E2E', qr_code: 'NW-QR://pkg/E2E' }), 201);
    await ok(staff().patch('/api/production-orders/e2e-po').send({ status: 'Packing' }), 200);
    await ok(prodMgr().patch('/api/production-orders/e2e-po').send({ status: 'Ready for Delivery' }), 200);
    expect(await one(`SELECT production_status FROM work_items WHERE id = $1`, [s.item])).toEqual({ production_status: 'Ready for Delivery' });
  });

  it('20-21. delivery and site receiving (receipt by the signed-in supervisor)', async () => {
    await ok(pm().post('/api/deliveries').send({ ...D.deliveryRecords[0], id: 'e2e-del', delivery_number: 'DEL-E2E', project_id: s.project, project_name: 'Horizon Sky Lounge', work_package_id: s.wp, work_item_ids: [s.item], work_item_codes: ['BAR-01'], production_order_ids: ['e2e-po'], package_ids: ['e2e-pkg'], status: 'Scheduled', status_history: [], site_receipt: undefined }), 201);
    const receipt = { id: 'e2e-rcpt', delivery_id: 'e2e-del', delivery_number: 'DEL-E2E', project_id: s.project, project_name: 'Horizon Sky Lounge', receiving_user_id: 'forged', receiving_user_name: 'Forged', receiving_role: 'Owner / CEO', received_at: '2027-01-05T10:00:00Z', condition_status: 'Good Condition', packages_expected: 1, packages_received: 1, damaged_quantity: 0, missing_quantity: 0, photos: ['unload.jpg'], receiver_signature: 'sig' };
    await ok(site().patch('/api/deliveries/e2e-del').send({ status: 'Received / Confirmed', site_receipt: receipt }), 200);
    expect(await one(`SELECT receiver_id FROM delivery_receipts WHERE id = 'e2e-rcpt'`)).toEqual({ receiver_id: 'user-site' });
    expect(await one(`SELECT delivery_status, installation_status FROM work_items WHERE id = $1`, [s.item])).toEqual({ delivery_status: 'Delivered', installation_status: 'Not Started' });
  });

  it('22. installation', async () => {
    await ok(pm().post('/api/installation-jobs').send({ ...D.installationJobs[0], id: 'e2e-inst', job_number: 'INS-E2E', work_item_id: s.item, work_item_code: 'BAR-01', project_id: s.project, project_name: 'Horizon Sky Lounge', work_package_id: s.wp, status: 'Scheduled' }), 201);
    await ok(site().patch('/api/installation-jobs/e2e-inst').send({ status: 'In Progress' }), 200);
  });

  it('23-25. site QC fails, a rectification task is raised and done, re-inspection passes', async () => {
    const qc = (id: string, result: string, date: string) => ({ id, inspection_number: id, work_item_id: s.item, work_item_code: 'BAR-01', installation_job_id: 'e2e-inst', project_id: s.project, project_name: 'Horizon Sky Lounge', inspection_date: date, result, level_and_alignment_pass: result === 'Pass', hardware_and_mechanism_pass: true, finish_and_surfaces_pass: true, safety_and_fixing_pass: true, cleanliness_and_protection_pass: true, snag_items: [], inspector_signoff: true, photos: ['qc.jpg'], comments: '' });
    const failed = (await ok(site().post('/api/site-qc').send(qc('e2e-sqc1', 'Fail / Rectification Required', '2027-01-08')), 201)).body;
    expect((await site().patch('/api/installation-jobs/e2e-inst').send({ status: 'Completed' })).status).toBe(403);
    await runAutomation(db.pool, '2027-01-08');
    const task = await one(`SELECT id, status, assigned_user_id FROM tasks WHERE issue_id = $1`, [failed.rectification_issue_id]);
    expect(task).toMatchObject({ status: 'Open', assigned_user_id: 'user-site' });
    await ok(site().patch(`/api/tasks/${task.id}`).send({ status: 'Completed', completion_evidence: 'Re-levelled with packers; photo of digital level reading attached' }), 200);
    await ok(pm().patch(`/api/issues/${failed.rectification_issue_id}`).send({ status: 'Resolved', resolution_notes: 'Re-levelled the counter' }), 200);
    await ok(site().post('/api/site-qc').send(qc('e2e-sqc2', 'Pass', '2027-01-10')), 201);
    await ok(site().patch('/api/installation-jobs/e2e-inst').send({ status: 'Completed' }), 200);
  });

  it('26. handover drafted and signed; the project stays Active', async () => {
    await ok(pm().post('/api/handovers').send({ id: 'e2e-ho', project_id: s.project, project_name: 'Horizon Sky Lounge', client_id: 'x', client_name: 'Horizon', client_representative: 'Ms Lim', cpc_certificate_number: 'CPC-E2E', handover_date: '2027-01-20', status: 'Draft', work_items_included: [s.item], all_site_qc_passed: true, open_snags_count: 0, nw_pm_signoff_name: '', as_built_drawings_approved: true, as_built_drawing_revision: 'Rev 1', operation_maintenance_manual_ref: 'OM-E2E', dlp_duration_months: 12, dlp_start_date: '2027-01-20', dlp_end_date: '2028-01-20', retention_sum_amount_rm: 3000, retention_sum_status: 'Held in Retention (5%)', cmgd_target_date: '2028-01-20', documents: [] }), 201);
    await ok(pm().patch('/api/handovers/e2e-ho').send({ status: 'Formal CPC Handover Signed', client_signoff_name: 'Ms Lim', client_signoff_signature: 'Lim (signed)' }), 200);
    expect((await one(`SELECT project_status FROM projects WHERE id = $1`, [s.project])).project_status).toBe('Active');
  });

  it('27-28. variation: costed, approved internally by someone else, then by the client', async () => {
    await ok(pm().post('/api/variations').send({ id: 'e2e-vo', variation_number: 'VO-E2E', project_id: s.project, project_name: 'Horizon Sky Lounge', title: 'Extra wine rack', description: 'Add 2 bays', reason: 'Client request', requested_by: 'Client', estimated_cost: 3000, client_amount: 5000, status: 'Identified', created_at: '' }), 201);
    await ok(pm().post('/api/variations/e2e-vo/transition').send({ status: 'Costing' }), 200);
    await ok(pm().post('/api/variations/e2e-vo/transition').send({ status: 'Internal Approval' }), 200);
    expect((await pm().post('/api/variations/e2e-vo/transition').send({ status: 'Client Approval' })).status).toBe(403);
    await ok(owner().post('/api/variations/e2e-vo/transition').send({ status: 'Client Approval' }), 200);
    expect((await as['Client'].get(`/api/variations/e2e-vo`)).status).toBe(404); // another client's project
    // The client (Horizon) signs in with their own account and approves it.
    await ok(as['Admin'].post('/api/users').send({ name: 'Ms Lim', email: 'lim@horizon.test', role: 'Client', client_id: 'client-2', password: 'horizon-password-1' }), 201);
    const lim = await signIn(app, 'lim@horizon.test', 'horizon-password-1');
    const seen = (await ok(lim.get('/api/variations/e2e-vo'), 200)).body;
    expect(seen.estimated_cost).toBeUndefined(); // internal cost hidden from the client
    await ok(lim.post('/api/variations/e2e-vo/transition').send({ status: 'Approved', note: 'Approved by Ms Lim' }), 200);
    const contract = (await ok(accountant().get(`/api/projects/${s.project}/contract-summary`), 200)).body;
    expect(contract).toMatchObject({ original_contract_value: 60000, approved_variations_total: 5000, current_contract_value: 65000 });
  });

  it('29-30. supplier invoice matched and approved by finance posts actual cost', async () => {
    await ok(accountant().post('/api/invoices').send({ id: 'e2e-inv', invoice_number: 'TC-E2E', invoice_type: 'Supplier Invoice', party_name: 'Timber Co', project_id: s.project, project_name: 'Horizon Sky Lounge', po_id: 'e2e-po-buy', amount_before_tax: 22000, tax_amount: 0, invoice_date: '2026-11-25', due_date: '2026-12-25', status: 'Pending Approval', paid_amount: 0 }), 201);
    await ok(owner().patch('/api/invoices/e2e-inv').send({ status: 'Approved' }), 200);
    const p = (await ok(accountant().get(`/api/projects/${s.project}/profitability`), 200)).body;
    expect(p).toMatchObject({ actual_cost: 22000, committed_cost: 22000 });
  });

  it('31-32. progress claim and the client payment', async () => {
    await ok(accountant().post('/api/claims').send({ ...D.financialClaims[0], id: 'e2e-clm', claim_number: 'IPC-E2E-01', project_id: s.project, project_name: 'Horizon Sky Lounge', cumulative_claimed: 65000, retention_amount: 3250, net_claim_amount: 61750, status: 'Submitted', certified_amount: undefined, payment_received_date: undefined, invoice_number: 'INV-E2E-01' }), 201);
    await ok(accountant().patch('/api/claims/e2e-clm').send({ status: 'Certified', certified_amount: 61750 }), 200);
    await ok(accountant().post('/api/payments').send({ ...D.payments[0], id: 'e2e-pay', reference_no: 'TRF-E2E', project_id: s.project, type: 'Client Inflow', party_name: 'Horizon', amount: 61750, date: '2027-02-05', status: 'Reconciled', notes: 'IPC-E2E-01' }), 201);
    await ok(accountant().patch('/api/claims/e2e-clm').send({ status: 'Paid', payment_received_date: '2027-02-05' }), 200);
    expect(await one(`SELECT status FROM financial_claims WHERE id = 'e2e-clm'`)).toEqual({ status: 'Paid' });
  });

  it('33. profitability from the server; browser totals ignored', async () => {
    const p = (await ok(accountant().get(`/api/projects/${s.project}/profitability`), 200)).body;
    // Budget (32,000) from the quotation; actual 22,000; forecast stays at budget; selling 65,000 incl. the variation.
    expect(p).toMatchObject({ selling_price: 65000, estimated_direct_cost: 32000, actual_cost: 22000, forecast_final_cost: 32000, project_gross_profit: 33000 });
    const baseline = (await ok(owner().get(`/api/commercial-baselines/${s.project}`), 200)).body;
    await ok(owner().post('/api/data/sync').send({ upserts: { commercialBaselines: [{ ...baseline, forecast_gross_profit: 1e9, actual_cost: 0 }] } }), 200);
    expect((await ok(owner().get(`/api/commercial-baselines/${s.project}`), 200)).body).toMatchObject({ actual_cost: 22000, forecast_gross_profit: 33000 });
    expect((await site().get(`/api/projects/${s.project}/profitability`)).status).toBe(403);
  });

  it('34. completion and closure, by the Owner, only after the signed handover', async () => {
    expect((await owner().patch(`/api/projects/${s.project}`).send({ project_status: 'Closed' })).status).toBe(403);
    await ok(owner().patch(`/api/projects/${s.project}`).send({ project_status: 'Completed' }), 200);
    await ok(owner().patch(`/api/projects/${s.project}`).send({ project_status: 'Closed' }), 200);
    expect((await one(`SELECT project_status FROM projects WHERE id = $1`, [s.project])).project_status).toBe('Closed');
    const actions = (await db.pool.query(`SELECT DISTINCT action FROM audit_logs WHERE project_id = $1 OR entity_id = $1`, [s.project])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['quotation.convert', 'update']));
    // A closed project no longer shows up as an exception for the owner.
    expect(((await ok(owner().get('/api/exceptions'), 200)).body as Row[]).some((e) => e.project_id === s.project)).toBe(false);
  });
});
