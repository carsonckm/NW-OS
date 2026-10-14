/**
 * The controlled pilot, rehearsed through the API on the real restricted runtime role, with the
 * fictional project of docs/pilot/segar-mart-outlet-12.md (synthetic data only): Segar Mart
 * Sdn Bhd, Outlet 12 Retail Fit-Out, contract RM 650,000.
 *
 * Quotation → project → drawings (real files) → purchasing → subcontractor assignment →
 * delivery → installation (subcontractor's site photos) → variation → invoice and payment →
 * Owner reporting. Every step through the same endpoints the screens use.
 */
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoData } from './demo';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { signIn } from '../test/app';

type Row = Record<string, any>;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n% Segar Mart Outlet 12 gondola layout\n'), Buffer.alloc(4096, 0x20), Buffer.from('%%EOF\n')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('ceiling grid installed'), Buffer.alloc(1024, 9), Buffer.from([0xff, 0xd9])]);

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('pilot rehearsal: Segar Mart Outlet 12 Retail Fit-Out (synthetic)', () => {
  let db: TestDb;
  let app: express.Express;
  let as: Record<string, request.Agent> = {};
  const D = demoData();
  const s: Row = {};
  beforeAll(async () => {
    ({ db, as, app } = (await setupDemoWorld({ restricted: true })) as never);
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  const admin = () => as['Admin'];
  const pm = () => as['Project Manager'];
  const site = () => as['Site Supervisor'];
  const buyer = () => as['Purchasing'];
  const accountant = () => as['Accountant'];
  const ok = async (req: PromiseLike<request.Response>, status: number) => {
    const res = await req;
    if (res.status !== status) throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 400)}`);
    return res;
  };
  const one = async (sql: string, params: unknown[] = []) => (await db.owner.query(sql, params)).rows[0] as Row;
  const upload = (agent: request.Agent, query: Record<string, string>, name: string, bytes: Buffer) =>
    agent.post(`/api/files?${new URLSearchParams(query)}`).set({ 'Content-Type': 'application/octet-stream', 'X-NWOS-Upload': '1', 'X-File-Name': encodeURIComponent(name) }).send(bytes);
  /** A new account: created by the Owner/Admin, activated by its holder with the one-time code. */
  const account = async (by: request.Agent, user: Row, password: string) => {
    const created = (await ok(by.post('/api/users').send(user), 201)).body;
    await ok(request(app).post('/api/auth/activate').send({ email: user.email, code: created.activation.code, password }), 200);
    return signIn(app, user.email, password);
  };

  it('1. client, enquiry, tender and the RM 650,000 quotation, approved by someone else', async () => {
    await ok(owner().post('/api/clients').send({ ...D.clients[0], id: 'client-segar', client_type: 'Retail', company_name: 'Segar Mart Sdn Bhd', registration_number: 'SYNTHETIC-0001', contact_person: 'Puan Aisyah (Store Development)', email: 'aisyah@segarmart.example', phone: '+60 3-0000 0012', billing_address: 'Synthetic address, Shah Alam' }), 201);
    // Sales for a new client is done by the Owner (a Project Manager sees only their projects' clients).
    await ok(owner().post('/api/client-enquiries').send({ id: 'sm-enq', enquiry_number: 'ENQ-SM12', client_id: 'client-segar', client_name: 'Segar Mart Sdn Bhd', project_name: 'Outlet 12 Retail Fit-Out', contact_person: 'Puan Aisyah', source: 'Repeat client', scope_description: 'Supermarket fit-out: gondolas, checkouts, ceiling & lighting, signage', received_date: '2026-10-12', target_submission_date: '2026-10-26', status: 'New', assigned_estimator: 'PM', follow_up_date: '2026-10-15' }), 201);
    await ok(owner().post('/api/tenders').send({ id: 'sm-tdr', tender_number: 'TDR-SM12', enquiry_id: 'sm-enq', client_id: 'client-segar', client_name: 'Segar Mart Sdn Bhd', project_name: 'Outlet 12 Retail Fit-Out', submission_deadline: '2026-10-26', estimated_value: 650000, status: 'In Preparation', documents: [], assigned_lead: 'PM', bq_reference: 'BQ-SM12' }), 201);
    const line = (id: string, code: string, price: number, cost: Row) => ({ id, item_code: code, description: code, category: 'Joinery', specification: 'Retail fit-out', quantity: 1, unit: 'lot', unit_selling_price: price, estimated_cost_breakdown: cost, cost_source: 'Material Price', cost_confidence: 'High', notes: 'INTERNAL', total_selling_price: 1, total_estimated_cost: 1 });
    const qt = await ok(owner().post('/api/quotations').send({
      id: 'sm-qt', quotation_number: 'QT-SM12', version: 1, version_code: 'QT-SM12-V1', client_id: 'client-segar', client_name: 'Segar Mart Sdn Bhd', enquiry_id: 'sm-enq', tender_id: 'sm-tdr', project_name: 'Outlet 12 Retail Fit-Out', date: '2026-10-13', validity_days: 30, status: 'Draft',
      items: [
        line('l1', 'GONDOLA', 220000, { material: 150000, labour: 10000 }),
        line('l2', 'CHECKOUT', 160000, { material: 70000, labour: 40000 }),
        line('l3', 'CEILING-LIGHT', 190000, { material: 60000, labour: 70000 }),
        line('l4', 'SIGNAGE', 80000, { material: 40000, labour: 15000 }),
      ],
      tax_applicable: false, total_selling_price: 1, terms: '30% deposit, monthly progress claims',
    }), 201);
    expect(qt.body).toMatchObject({ subtotal_selling_price: 650000, total_estimated_cost: 455000, estimated_gross_profit: 195000 });
    await ok(owner().patch('/api/quotations/sm-qt').send({ status: 'Internal Review' }), 200);
    // A Project Manager has no access to a client outside their projects.
    expect((await pm().get('/api/quotations/sm-qt')).status).toBe(404);
    await ok(accountant().patch('/api/quotations/sm-qt').send({ approval_status: 'Approved' }), 200);
    await ok(owner().patch('/api/quotations/sm-qt').send({ status: 'Submitted' }), 200);
    expect(JSON.stringify((await ok(owner().get('/api/quotations/sm-qt/client-view'), 200)).body)).not.toMatch(/cost|margin|profit|INTERNAL/i);
  });

  it('2. award and project setup: contract RM 650,000, team assigned', async () => {
    await ok(owner().patch('/api/quotations/sm-qt').send({ status: 'Accepted' }), 200);
    const res = await ok(owner().post('/api/quotations/sm-qt/convert').send({ project_number: 'SM-2026-012', start_date: '2026-11-02', end_date: '2027-01-29', site_address: 'Outlet 12, Shah Alam (synthetic)', project_manager_id: 'user-pm' }), 201);
    s.project = res.body.project.id;
    await ok(owner().patch(`/api/projects/${s.project}`).send({ site_supervisor_id: 'user-site', project_status: 'Active' }), 200);
    await ok(owner().put('/api/users/user-prod-mgr/projects').send({ project_ids: ['proj-1', 'proj-2', s.project] }), 200);
    expect(await one(`SELECT contract_value::float AS v, client_id FROM projects WHERE id = $1`, [s.project])).toEqual({ v: 650000, client_id: 'client-segar' });
    // The client's own account (activation code, own password).
    s.client = await account(admin(), { name: 'Puan Aisyah', email: 'aisyah@segarmart.example', role: 'Client', client_id: 'client-segar' }, 'segar-client-pass-1');
    expect(((await ok(s.client.get('/api/projects'), 200)).body as Row[]).map((p) => p.id)).toEqual([s.project]);
  });

  it('3. drawings: the real layout PDF is stored, reviewed, approved, and only then shared with the client', async () => {
    await ok(pm().post('/api/drawings').send({ id: 'sm-dwg', project_id: s.project, drawing_number: 'SM12-A-101', title: 'Gondola layout', category: 'Carpentry', created_at: '2026-11-03', revisions: [], nw_production_drawings: [] }), 201);
    const file = (await ok(upload(pm(), { purpose: 'drawing', project_id: s.project }, 'SM12-A-101_Rev1.pdf', PDF), 201)).body;
    await ok(pm().post('/api/drawings/sm-dwg/revisions').send({ id: 'sm-rev1', revision: 'Rev 1', title: 'Gondola layout Rev 1', file_url: file.url, notes: 'Issued for review', drawing_type: 'Client / Designer Drawing' }), 201);
    expect(await one(`SELECT record_id, revision_id FROM files WHERE id = $1`, [file.id])).toEqual({ record_id: 'sm-dwg', revision_id: 'sm-rev1' });
    expect((await s.client.get(file.url)).status).toBe(404); // draft: not shared yet
    await ok(pm().post('/api/drawings/sm-dwg/revisions/sm-rev1/status').send({ status: 'Internal Review' }), 200);
    await ok(owner().post('/api/drawings/sm-dwg/revisions/sm-rev1/status').send({ status: 'Approved' }), 200);
    const got = await s.client.get(file.url).buffer(true).parse((r, cb) => { const c: Buffer[] = []; r.on('data', (d: Buffer) => c.push(d)); r.on('end', () => cb(null, Buffer.concat(c))); });
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body, PDF)).toBe(0);
    s.drawingFile = file.url;
  });

  it('4. purchasing: gondola PO approved as a major purchase, issued, received', async () => {
    await ok(pm().post('/api/material-requests').send({ ...D.materialRequests[0], id: 'sm-mr', request_number: 'MR-SM12', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', material_name: 'Gondola shelving bays', required_quantity: 80, unit: 'bay', status: 'Pending' }), 201);
    await ok(buyer().post('/api/purchase-orders').send({ id: 'sm-po', po_number: 'PUR-SM12-01', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', supplier_name: 'Rak Jaya Shelving (synthetic)', material_request_id: 'sm-mr', items: [{ id: 'g-1', item_description: 'Gondola bay 1200mm', specification: 'Powder coated', quantity: 80, unit: 'bay', unit_price: 1500, total_price: 0 }], total_amount: 0, status: 'Pending Approval', requested_by: 'Purchasing', expected_delivery_date: '2026-11-25', created_at: '' }), 201);
    expect((await one(`SELECT total_amount::float AS t FROM purchase_orders WHERE id = 'sm-po'`)).t).toBe(120000);
    await ok(buyer().post('/api/approvals').send({ id: 'sm-apr', approval_number: 'APR-SM12-01', approval_type: 'Major Purchase', title: 'PUR-SM12-01 RM 120,000', description: 'Gondola shelving', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', related_entity_type: 'purchase', related_entity_id: 'sm-po', date_requested: '2026-11-05', decision: 'Pending', created_at: '', updated_at: '' }), 201);
    expect((await pm().post('/api/approvals/sm-apr/decision').send({ decision: 'Approved' })).status).toBe(403);
    await ok(owner().post('/api/approvals/sm-apr/decision').send({ decision: 'Approved' }), 200);
    await ok(buyer().patch('/api/purchase-orders/sm-po').send({ status: 'Issued' }), 200);
    await ok(site().post('/api/goods-received').send({ id: 'sm-grn', grn_number: 'GRN-SM12-01', po_id: 'sm-po', project_id: s.project, delivery_note_number: 'DN-SM12', items: [{ po_item_id: 'g-1', received_qty: 80 }] }), 201);
    expect(await one(`SELECT status FROM purchase_orders WHERE id = 'sm-po'`)).toEqual({ status: 'Goods Received' });
  });

  it('5. subcontractor: registered once, assigned through its work package, with its own account', async () => {
    await ok(admin().post('/api/contractors').send({ id: 'con-cahaya', company_name: 'Cahaya Siling Sdn Bhd (synthetic)', contact_person: 'Encik Hafiz', phone: '+60 12-000 0012', trade: 'Ceiling & lighting' }), 201);
    expect((await pm().get('/api/contractors/con-cahaya')).status).toBe(404);
    s.wp = (await ok(pm().post('/api/work-packages').send({ id: 'sm-wp-ceiling', project_id: s.project, name: 'CEILING & LIGHTING', category: 'Ceiling', contractor_id: 'con-cahaya', project_manager_id: 'user-pm', start_date: '2026-11-10', end_date: '2027-01-15', status: 'Assigned', progress_percent: 0 }), 201)).body.id;
    expect((await ok(pm().get('/api/contractors/con-cahaya'), 200)).body.project_ids).toEqual([s.project]);
    s.item = (await ok(pm().post('/api/work-items').send({ id: 'sm-item-ceiling', work_package_id: s.wp, item_code: 'CL-01', description: 'Ceiling grid and LED panels, sales floor', location: 'Sales floor', quantity: 1, unit: 'lot', drawing_id: 'sm-dwg', drawing_revision: 'Rev 1', material: 'Gypsum, LED 600x600', finish: 'White', dimensions: '1,450 m²', required_date: '2027-01-10', contractor_id: 'con-cahaya', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started' }), 201)).body.id;
    s.sub = await account(admin(), { name: 'Encik Hafiz', email: 'hafiz@cahaya.example', role: 'Contractor', contractor_id: 'con-cahaya' }, 'cahaya-sub-pass-1');
  });

  it('6. delivery to site and installation, with the subcontractor\'s own site photo', async () => {
    await ok(pm().post('/api/deliveries').send({ ...D.deliveryRecords[0], id: 'sm-del', delivery_number: 'DEL-SM12-01', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', work_package_id: s.wp, work_item_ids: [s.item], work_item_codes: ['CL-01'], production_order_ids: [], package_ids: [], contractor_id: 'con-cahaya', status: 'Scheduled', status_history: [], site_receipt: undefined }), 201);
    await ok(pm().post('/api/installation-jobs').send({ ...D.installationJobs[0], id: 'sm-inst', job_number: 'INS-SM12-01', work_item_id: s.item, work_item_code: 'CL-01', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', work_package_id: s.wp, contractor_id: 'con-cahaya', status: 'Scheduled' }), 201);
    await ok(site().patch('/api/installation-jobs/sm-inst').send({ status: 'In Progress' }), 200);
    const photo = (await ok(upload(s.sub, { purpose: 'site_photo', record_collection: 'installationJobs', record_id: 'sm-inst' }, 'ceiling-grid.jpg', JPEG), 201)).body;
    await ok(site().get(photo.url), 200);
    // The subcontractor sees its own job, not another project's or another subcontractor's.
    expect(((await ok(s.sub.get('/api/installation-jobs'), 200)).body as Row[]).map((j) => j.id)).toEqual(['sm-inst']);
    const qc = { id: 'sm-sqc', inspection_number: 'SQC-SM12-01', work_item_id: s.item, work_item_code: 'CL-01', installation_job_id: 'sm-inst', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', inspection_date: '2027-01-12', result: 'Pass', level_and_alignment_pass: true, hardware_and_mechanism_pass: true, finish_and_surfaces_pass: true, safety_and_fixing_pass: true, cleanliness_and_protection_pass: true, snag_items: [], inspector_signoff: true, photos: [photo.url], comments: '' };
    await ok(site().post('/api/site-qc').send(qc), 201);
    await ok(site().patch('/api/installation-jobs/sm-inst').send({ status: 'Completed' }), 200);
  });

  it('7. variation RM 18,000: internal approval by the Owner, then the client; contract RM 668,000', async () => {
    await ok(pm().post('/api/variations').send({ id: 'sm-vo', variation_number: 'VO-SM12-01', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', title: 'Additional chiller-zone lighting', description: '12 extra LED panels at the chiller aisle', reason: 'Client request', requested_by: 'Client', estimated_cost: 12000, client_amount: 18000, status: 'Identified', created_at: '' }), 201);
    await ok(pm().post('/api/variations/sm-vo/transition').send({ status: 'Costing' }), 200);
    await ok(pm().post('/api/variations/sm-vo/transition').send({ status: 'Internal Approval' }), 200);
    expect((await pm().post('/api/variations/sm-vo/transition').send({ status: 'Client Approval' })).status).toBe(403);
    await ok(owner().post('/api/variations/sm-vo/transition').send({ status: 'Client Approval' }), 200);
    expect((await ok(s.client.get('/api/variations/sm-vo'), 200)).body.estimated_cost).toBeUndefined();
    await ok(s.client.post('/api/variations/sm-vo/transition').send({ status: 'Approved', note: 'Approved by Puan Aisyah' }), 200);
    expect((await ok(accountant().get(`/api/projects/${s.project}/contract-summary`), 200)).body).toMatchObject({ original_contract_value: 650000, approved_variations_total: 18000, current_contract_value: 668000 });
  });

  it('8. supplier invoice approved by finance, progress claim and the client payment', async () => {
    await ok(accountant().post('/api/invoices').send({ id: 'sm-inv', invoice_number: 'RJ-SM12-01', invoice_type: 'Supplier Invoice', party_name: 'Rak Jaya Shelving (synthetic)', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', po_id: 'sm-po', amount_before_tax: 120000, tax_amount: 0, invoice_date: '2026-11-28', due_date: '2026-12-28', status: 'Pending Approval', paid_amount: 0 }), 201);
    await ok(owner().patch('/api/invoices/sm-inv').send({ status: 'Approved' }), 200);
    await ok(accountant().post('/api/claims').send({ ...D.financialClaims[0], id: 'sm-clm', claim_number: 'IPC-SM12-01', project_id: s.project, project_name: 'Outlet 12 Retail Fit-Out', cumulative_claimed: 200000, retention_amount: 10000, net_claim_amount: 190000, status: 'Submitted', certified_amount: undefined, payment_received_date: undefined, invoice_number: 'INV-SM12-01' }), 201);
    await ok(accountant().patch('/api/claims/sm-clm').send({ status: 'Certified', certified_amount: 190000 }), 200);
    await ok(accountant().post('/api/payments').send({ ...D.payments[0], id: 'sm-pay', reference_no: 'TRF-SM12-01', project_id: s.project, type: 'Client Inflow', party_name: 'Segar Mart Sdn Bhd', amount: 190000, date: '2026-12-20', status: 'Reconciled', notes: 'IPC-SM12-01' }), 201);
    await ok(accountant().patch('/api/claims/sm-clm').send({ status: 'Paid', payment_received_date: '2026-12-20' }), 200);
  });

  it('9. Owner reporting: margin from the server, the decision trail, no leakage to the client', async () => {
    const p = (await ok(owner().get(`/api/projects/${s.project}/profitability`), 200)).body;
    expect(p).toMatchObject({ selling_price: 668000, estimated_direct_cost: 455000, committed_cost: 120000, actual_cost: 120000 });
    expect((await s.client.get(`/api/projects/${s.project}/profitability`)).status).toBe(403);
    await ok(owner().get('/api/exceptions'), 200);
    const actions = (await db.owner.query(`SELECT DISTINCT action FROM audit_logs WHERE project_id = $1`, [s.project])).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['file.upload']));
    // Every file of the pilot is in the project, private, and attributed to a verified uploader.
    const files = (await db.owner.query(`SELECT purpose, uploaded_by_verified FROM files WHERE project_id = $1 ORDER BY purpose`, [s.project])).rows;
    expect(files).toEqual([{ purpose: 'drawing', uploaded_by_verified: true }, { purpose: 'site_photo', uploaded_by_verified: true }]);
  });
});
