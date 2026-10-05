import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

const item = (over: Row = {}) => ({
  id: 'qi-1',
  item_code: 'CAR-01',
  description: 'Reception counter, 2400mm',
  category: 'Joinery',
  specification: 'Oak veneer, Corian top',
  quantity: 2,
  unit: 'nos',
  length: 2400,
  width: 600,
  height: 1050,
  unit_selling_price: 18000,
  estimated_cost_breakdown: { material: 6000, labour: 4000 },
  cost_source: 'Material Price',
  cost_confidence: 'High',
  supplier_reference: 'Supplier SUP-9 quote 4411',
  contractor_reference: 'Hock Seng labour rate',
  notes: 'INTERNAL: tight margin on Corian',
  // A browser can't set these; the server computes them.
  total_selling_price: 1,
  total_estimated_cost: 999999,
  ...over,
});

describe.skipIf(!TEST_DATABASE_URL)('Phase 4 sales workflow', () => {
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
  const accountant = () => as['Accountant'];
  const quote = (id: string) => owner().get(`/api/quotations/${id}`).expect(200).then((r) => r.body as Row);

  it('records an enquiry and a tender linked to it', async () => {
    await pm()
      .post('/api/client-enquiries')
      .send({ id: 'enq-p4', enquiry_number: 'ENQ-P4', client_id: 'client-2', client_name: 'Horizon', project_name: 'Horizon Lobby', contact_person: 'Ms Lim', source: 'Referral', scope_description: 'Lobby joinery', received_date: '2026-10-05', target_submission_date: '2026-10-20', status: 'New', assigned_estimator: 'Marcus', follow_up_date: '2026-10-08' })
      .expect(201);
    await pm()
      .post('/api/tenders')
      .send({ id: 'tdr-p4', tender_number: 'TDR-P4', enquiry_id: 'enq-p4', client_id: 'client-2', client_name: 'Horizon', project_name: 'Horizon Lobby', submission_deadline: '2026-10-20', estimated_value: 40000, status: 'In Preparation', documents: [], assigned_lead: 'Marcus', bq_reference: 'BQ-1' })
      .expect(201);
    expect((await db.pool.query(`SELECT enquiry_id FROM commercial_tenders WHERE id = 'tdr-p4'`)).rows[0].enquiry_id).toBe('enq-p4');
  });

  it('prices a new quotation on the server, ignoring browser totals', async () => {
    const res = await pm()
      .post('/api/quotations')
      .send({ id: 'qt-p4', quotation_number: 'QT-P4', version: 1, version_code: 'QT-P4-V1', client_id: 'client-2', client_name: 'Horizon', enquiry_id: 'enq-p4', tender_id: 'tdr-p4', project_name: 'Horizon Lobby', date: '2026-10-06', validity_days: 30, valid_until: '2026-11-05', status: 'Draft', items: [item()], tax_applicable: true, tax_rate: 8, total_selling_price: 5, estimated_gross_profit: 999999, approval_status: 'Approved', prepared_by: 'Someone else', terms: '50% deposit' })
      .expect(201);
    expect(res.body).toMatchObject({
      status: 'Draft',
      approval_status: 'Pending',
      prepared_by_id: 'user-pm',
      subtotal_selling_price: 36000,
      tax_amount: 2880,
      total_selling_price: 38880,
      total_estimated_cost: 10000, // the cost breakdown is for the whole line, as in the existing data
      estimated_gross_profit: 26000,
    });
    expect(res.body.items[0]).toMatchObject({ total_selling_price: 36000, total_estimated_cost: 10000 });
  });

  it('needs internal approval by someone else before it is submitted', async () => {
    await pm().patch('/api/quotations/qt-p4').send({ status: 'Internal Review' }).expect(200);
    expect((await pm().patch('/api/quotations/qt-p4').send({ status: 'Submitted' })).status).toBe(403);
    const selfApproval = await pm().patch('/api/quotations/qt-p4').send({ approval_status: 'Approved' });
    expect(selfApproval.status).toBe(403);
    expect(selfApproval.body.message).toMatch(/View Commercial Margins/);
    await accountant().patch('/api/quotations/qt-p4').send({ approval_status: 'Approved' }).expect(200);
    expect(await quote('qt-p4')).toMatchObject({ approval_status: 'Approved', approved_by_id: 'user-accountant' });
    await pm().patch('/api/quotations/qt-p4').send({ status: 'Submitted' }).expect(200);
  });

  it('blocks owners from approving their own quotation', async () => {
    await owner().post('/api/quotations').send({ id: 'qt-own', quotation_number: 'QT-OWN', version: 1, version_code: 'QT-OWN-V1', client_id: 'client-2', client_name: 'Horizon', project_name: 'x', status: 'Draft', items: [item()], validity_days: 30 }).expect(201);
    await owner().patch('/api/quotations/qt-own').send({ status: 'Internal Review' }).expect(200);
    const res = await owner().patch('/api/quotations/qt-own').send({ approval_status: 'Approved' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/you prepared/);
  });

  it('gives the client a quotation without any internal information', async () => {
    const res = await owner().get('/api/quotations/qt-p4/client-view').expect(200);
    const text = JSON.stringify(res.body);
    expect(res.body).toMatchObject({ quotation_number: 'QT-P4', total_selling_price: 38880, terms: '50% deposit' });
    expect(res.body.items[0]).toMatchObject({ description: 'Reception counter, 2400mm', unit_selling_price: 18000, total_selling_price: 36000 });
    for (const secret of ['estimated', 'cost', 'margin', 'profit', 'SUP-9', 'Hock Seng', 'INTERNAL', 'cost_confidence', 'approved_by']) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it('freezes a submitted quotation; negotiation is a new version', async () => {
    const edit = await pm().patch('/api/quotations/qt-p4').send({ items: [item({ unit_selling_price: 17000 })] });
    expect(edit.status).toBe(403);
    expect(edit.body.message).toMatch(/new version/);
    await pm().patch('/api/quotations/qt-p4').send({ status: 'Negotiation' }).expect(200);
    const v2 = await pm().post('/api/quotations/qt-p4/versions').send({ items: [item({ unit_selling_price: 17000 })] }).expect(201);
    expect(v2.body).toMatchObject({ version: 2, version_code: 'QT-P4-V2', status: 'Draft', approval_status: 'Pending', subtotal_selling_price: 34000, previous_version_id: 'qt-p4' });
    expect((await quote('qt-p4')).status).toBe('Superseded');
  });

  it('awards and converts to a project carrying the quotation forward', async () => {
    const v2 = 'qt-p4-v2';
    await pm().patch(`/api/quotations/${v2}`).send({ status: 'Internal Review' }).expect(200);
    await owner().patch(`/api/quotations/${v2}`).send({ approval_status: 'Approved' }).expect(200);
    await pm().patch(`/api/quotations/${v2}`).send({ status: 'Submitted' }).expect(200);
    expect((await pm().post(`/api/quotations/${v2}/convert`).send({ project_number: "NW-2026-401", start_date: "2026-11-01", end_date: "2027-01-31" })).status).toBe(403); // PM cannot create projects
    expect((await owner().post(`/api/quotations/${v2}/convert`).send({ project_number: 'NW-2026-401', start_date: '2026-11-01', end_date: '2027-01-31' })).status).toBe(400); // not awarded yet
    await pm().patch(`/api/quotations/${v2}`).send({ status: 'Accepted' }).expect(200);
    const res = await owner()
      .post(`/api/quotations/${v2}/convert`)
      .send({ project_number: 'NW-2026-401', start_date: '2026-11-01', end_date: '2027-01-31', site_address: 'Horizon Tower lobby', project_manager_id: 'user-pm' })
      .expect(201);
    const project = res.body.project as Row;
    expect(project).toMatchObject({ project_number: 'NW-2026-401', project_name: 'Horizon Lobby', client_id: 'client-2', contract_value: 34000, project_status: 'Awarded', site_address: 'Horizon Tower lobby' });
    expect(res.body.quotation).toMatchObject({ project_id: project.id, converted_project_id: project.id, status: 'Accepted' });
    const baseline = (await owner().get(`/api/commercial-baselines/${project.id}`).expect(200)).body;
    expect(baseline).toMatchObject({ original_contract_value: 34000, original_budget_direct_cost: 10000, source_quotation_id: v2 });
    expect((await owner().get('/api/client-enquiries/enq-p4')).body).toMatchObject({ status: 'Won', project_id: project.id });
    expect((await owner().get('/api/tenders/tdr-p4')).body).toMatchObject({ status: 'Awarded', project_id: project.id });
    const profit = (await accountant().get(`/api/projects/${project.id}/profitability`).expect(200)).body;
    expect(profit).toMatchObject({ selling_price: 34000, estimated_direct_cost: 10000, project_gross_profit: 24000 });
    // Nothing technical is created.
    for (const t of ['work_packages', 'drawings', 'production_orders']) {
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM ${t} WHERE project_id = $1`, [project.id])).rows[0].n).toBe(0);
    }
    const audit = (await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id IN ($1, $2) ORDER BY id`, [v2, project.id])).rows.map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(['quotation.approve', 'quotation.submitted', 'quotation.accepted', 'create', 'quotation.convert']));
    expect((await owner().post(`/api/quotations/${v2}/convert`).send({ project_number: 'NW-2026-402', start_date: '2026-11-01', end_date: '2027-01-31' })).status).toBe(400);
    expect((await owner().patch(`/api/quotations/${v2}`).send({ project_id: 'proj-1' })).body.project_id).toBe(project.id);
  });

  it('records lost and cancelled quotations', async () => {
    await pm().post('/api/quotations').send({ id: 'qt-lost', quotation_number: 'QT-LOST', version: 1, version_code: 'QT-LOST-V1', client_id: 'client-2', client_name: 'Horizon', project_name: 'x', status: 'Draft', items: [item()], validity_days: 30 }).expect(201);
    await pm().patch('/api/quotations/qt-lost').send({ status: 'Cancelled', cancel_reason: 'Client postponed' }).expect(200);
    expect((await pm().patch('/api/quotations/qt-lost').send({ status: 'Draft' })).status).toBe(403);
    await pm().patch('/api/quotations/qt-own').send({ status: 'Draft' }).expect(200); // back from review
    expect((await quote('qt-own')).approval_status).toBe('Pending');
  });

  it('keeps sales records away from roles without commercial access', async () => {
    for (const role of ['Site Supervisor', 'Production Staff', 'Contractor', 'Client']) {
      expect((await as[role].get('/api/quotations/qt-p4/client-view')).status, role).toBe(403);
      expect((await as[role].get('/api/client-enquiries')).status, role).toBe(403);
    }
  });
});
