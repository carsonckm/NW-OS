import type express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../../src/data/initialData';
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import { migrate } from '../db/migrate';
import { buildApp, seedUsers, signIn, type SeedUser } from '../test/app';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { demoData } from './demo';
import { MODULES } from './registry';
import { DataService } from './service';

type Row = Record<string, any>;

const USERS: SeedUser[] = [
  { id: 'user-owner', role: 'Owner / CEO', email: 'owner@test.local' },
  { id: 'user-admin', role: 'Admin', email: 'admin@test.local' },
  { id: 'user-pm', role: 'Project Manager', email: 'pm@test.local' },
  { id: 'user-site', role: 'Site Supervisor', email: 'site@test.local' },
  { id: 'user-purchasing', role: 'Purchasing', email: 'purchasing@test.local' },
  { id: 'user-accountant', role: 'Accountant', email: 'accountant@test.local' },
  { id: 'user-prod-mgr', role: 'Production Manager', email: 'prodmgr@test.local' },
  { id: 'user-prod-staff', role: 'Production Staff', email: 'staff@test.local', assigned: ['proj-1'] },
  { id: 'user-contractor', role: 'Contractor', email: 'contractor@test.local', contractor_id: 'con-1' },
  { id: 'user-client', role: 'Client', email: 'client@test.local', client_id: 'client-1' },
];

const SYSTEM: AuthUser = {
  id: 'system-import', name: 'System', email: 'system@test.local', role: 'Owner / CEO', is_active: true, is_dev_seed: false,
  client_id: null, contractor_id: null, phone: null, department: null, title: null, created_at: '', updated_at: '', last_login: null,
};

/** An unrelated project (client-3, other PM, contractor con-9) for cross-project tests. */
function unrelatedProject(): Record<string, Row[]> {
  const project = { ...INITIAL_PROJECTS[0], id: 'proj-x', project_number: 'NW-2026-999', project_name: 'Unrelated', client_id: 'client-3', project_manager_id: 'someone-else', site_supervisor_id: 'someone-else' };
  const wp = { ...INITIAL_WORK_PACKAGES[0], id: 'wp-x', project_id: 'proj-x', contractor_id: 'con-9' };
  const item = { ...INITIAL_WORK_ITEMS[0], id: 'item-x', project_id: 'proj-x', work_package_id: 'wp-x', contractor_id: 'con-9', drawing_id: 'dwg-x', drawing_revision: 'Rev 1' };
  const drawing = {
    id: 'dwg-x', project_id: 'proj-x', drawing_number: 'X-1', title: 'Unrelated drawing', category: 'Joinery', current_revision_id: 'rev-x1', created_at: '2026-01-01',
    revisions: [{ id: 'rev-x1', drawing_id: 'dwg-x', revision: 'Rev 1', title: 'X', file_url: '/x.pdf', uploaded_date: '2026-01-01', uploaded_by: 'PM', approved_status: 'Approved', notes: '', is_current: true, drawing_type: 'Client / Designer Drawing', markups: [] }],
  };
  const delivery = { id: 'del-x', delivery_number: 'DEL-X', project_id: 'proj-x', project_name: 'Unrelated', work_package_id: 'wp-x', work_package_name: 'X', work_item_ids: ['item-x'], work_item_codes: ['X'], production_order_ids: [], contractor_id: 'con-9', contractor_name: 'Other', driver_name: '', driver_contact: '', vehicle_plate: '', vehicle_type: '', delivery_date: '2026-10-10', delivery_time: '10:00', estimated_arrival: '11:00', destination_site: 'X', special_instructions: '', package_count: 1, status: 'Scheduled', status_history: [], loading_checklist: {}, scanned_packages: [], qr_code: 'X', barcode: 'X', photos: [] };
  return { projects: [project], workPackages: [wp], workItems: [item], drawings: [drawing], deliveryRecords: [delivery] };
}

describe.skipIf(!TEST_DATABASE_URL)('Phase 3 modules', () => {
  let db: TestDb;
  let app: express.Express;
  const as: Record<string, request.Agent> = {};

  beforeAll(async () => {
    db = await createTestDb();
    const service = new DataService(db.pool);
    const ctx = await AccessContext.load(db.pool, SYSTEM);
    const demo = demoData();
    const extra = unrelatedProject();
    for (const [k, rows] of Object.entries(extra)) demo[k] = [...(demo[k] ?? []), ...rows];
    const imported = await service.importData(ctx, demo, {}, { id: SYSTEM.id });
    expect(imported.problems).toEqual([]);
    await seedUsers(db.pool, USERS);
    app = buildApp(db.pool);
    for (const u of USERS) as[u.role] = await signIn(app, u.email);
  });
  afterAll(async () => {
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];

  // ------------------------------------------------------------------ database
  describe('database', () => {
    it('applies every migration once (re-running is a no-op)', async () => {
      expect(await migrate(db.pool)).toEqual([]);
      const applied = (await db.pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);
      expect(applied).toEqual(['001_core_chain.sql', '002_auth.sql', '003_audit_drawings_documents.sql', '004_workflow.sql', '005_production.sql', '006_delivery_site.sql', '007_commercial.sql']);
    });

    it('has a table with the registered columns for every module', async () => {
      for (const def of MODULES) {
        const cols = new Set(
          (await db.pool.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2', [db.schema, def.table])).rows.map((r) => r.column_name)
        );
        expect(cols.size, def.table).toBeGreaterThan(0);
        for (const c of def.columns) expect(cols.has(c.col), `${def.table}.${c.col}`).toBe(true);
        expect(cols.has('data') || def.key === 'deliveryReceipts', `${def.table}.data`).toBe(true);
      }
    });

    it('rejects invalid references and statuses', async () => {
      const issue = { id: 'issue-bad', project_id: 'proj-1', work_item_id: 'item-nope', title: 'x', category: 'Other', priority: 'Low', status: 'Reported', reported_by: 'x', reported_by_role: 'x', assigned_to: 'x', escalation_level: 'PM', action_required: 'x', description: 'x', created_at: '', updated_at: '' };
      expect((await owner().post('/api/issues').send(issue)).status).toBe(409);
      expect((await owner().post('/api/issues').send({ ...issue, work_item_id: 'item-1', status: 'Teleported' })).status).toBe(400);
      expect((await owner().post('/api/production-parts').send({ id: 'part-bad', production_order_id: 'po-nope', status: 'Cutting' })).status).toBe(403);
    });

    it('protects drawing revisions and the audit log at the database level', async () => {
      await expect(db.pool.query(`UPDATE drawing_revisions SET file_url = '/other.pdf' WHERE id = 'rev-3'`)).rejects.toThrow(/immutable/);
      await expect(db.pool.query(`DELETE FROM drawing_revisions WHERE id = 'rev-1'`)).rejects.toThrow(/cannot be deleted/);
      await expect(db.pool.query(`UPDATE drawing_revisions SET approval_status = 'Approved' WHERE id = 'rev-1'`)).rejects.toThrow(/cannot be reinstated/);
      await expect(db.pool.query(`UPDATE audit_logs SET action = 'x'`)).rejects.toThrow(/append-only/);
      await expect(db.pool.query(`DELETE FROM audit_logs`)).rejects.toThrow(/append-only/);
    });
  });

  // ------------------------------------------------------------ authentication
  describe('authentication', () => {
    it.each(['/api/drawings', '/api/production-orders', '/api/data/snapshot', '/api/audit-logs', '/api/projects/proj-1/profitability'])('GET %s without a session -> 401', async (path) => {
      expect((await request(app).get(path)).status).toBe(401);
    });

    it('POST /api/data/sync without a session -> 401', async () => {
      expect((await request(app).post('/api/data/sync').send({ upserts: {} })).status).toBe(401);
    });

    it('accepts a signed-in Owner', async () => {
      const snap = (await owner().get('/api/data/snapshot').expect(200)).body;
      expect(snap.drawings.length).toBeGreaterThan(0);
      expect(snap.productionOrders.length).toBe(12);
      expect(snap.purchaseOrders.length).toBeGreaterThan(0);
    });
  });

  // ------------------------------------------------------------- authorisation
  describe('authorisation', () => {
    it.each([
      ['Production Staff', '/api/purchase-orders'],
      ['Production Staff', '/api/cost-ledger'],
      ['Production Staff', '/api/projects/proj-1/profitability'],
      ['Site Supervisor', '/api/quotations'],
      ['Site Supervisor', '/api/price-database'],
      ['Site Supervisor', '/api/projects/proj-1/profitability'],
      ['Contractor', '/api/purchase-orders'],
      ['Contractor', '/api/variations'],
      ['Client', '/api/purchase-orders'],
      ['Client', '/api/cost-ledger'],
      ['Client', '/api/projects/proj-1/profitability'],
      ['Contractor', '/api/audit-logs'],
    ] as const)('%s GET %s -> 403', async (role, path) => {
      expect((await as[role].get(path)).status).toBe(403);
    });

    it('Contractor sees only its own installation jobs and deliveries, nothing on other projects', async () => {
      const jobs = (await as['Contractor'].get('/api/installation-jobs').expect(200)).body as Row[];
      expect(jobs.length).toBeGreaterThan(0);
      expect(jobs.every((j) => j.contractor_id === 'con-1')).toBe(true);
      expect((await as['Contractor'].get('/api/deliveries/del-x')).status).toBe(404);
      expect((await as['Contractor'].get('/api/drawings?project_id=proj-x').expect(200)).body).toEqual([]);
      const snap = (await as['Contractor'].get('/api/data/snapshot').expect(200)).body;
      expect(snap.purchaseOrders).toEqual([]);
      expect(snap.deliveryRecords.every((d: Row) => d.contractor_id === 'con-1')).toBe(true);
    });

    it('Client sees only its own projects’ records', async () => {
      const deliveries = (await as['Client'].get('/api/deliveries').expect(200)).body as Row[];
      expect(deliveries.every((d) => d.project_id === 'proj-1' || d.project_id === 'proj-demo-1')).toBe(true);
      expect((await as['Client'].get('/api/deliveries/del-x')).status).toBe(404);
      const variations = (await as['Client'].get('/api/variations').expect(200)).body as Row[];
      expect(variations.every((v) => v.project_id === 'proj-1')).toBe(true);
    });

    it('rejects writes into another project and ignores a forged role', async () => {
      const res = await as['Contractor']
        .post('/api/deliveries?role=Owner')
        .set('X-User-Role', 'Owner / CEO')
        .send({ ...unrelatedProject().deliveryRecords[0], id: 'del-forged', role: 'Owner / CEO' });
      expect([403, 404]).toContain(res.status);
      expect((await db.pool.query(`SELECT 1 FROM deliveries WHERE id = 'del-forged'`)).rowCount).toBe(0);
    });

    it('rolls back a whole sync batch that contains one forbidden record', async () => {
      const ok = { ...(await owner().get('/api/issues/issue-1').expect(200)).body, title: 'Changed by PM' };
      const forbidden = { ...(await owner().get('/api/purchase-orders').expect(200)).body[0], total_amount: 1 };
      const res = await as['Project Manager'].post('/api/data/sync').send({ upserts: { issues: [ok], purchaseOrders: [forbidden] } });
      expect(res.status).toBe(403);
      expect((await owner().get('/api/issues/issue-1')).body.title).not.toBe('Changed by PM');
    });
  });

  // ---------------------------------------------------------------- drawings
  describe('drawing revisions', () => {
    it('adds a new revision without overwriting the old one, which becomes superseded', async () => {
      const res = await owner()
        .post('/api/drawings/dwg-2/revisions')
        .send({ id: 'rev-202', revision: 'Rev 2', title: 'Feature wall Rev 2', file_url: '/drawings/A-104_Rev2.pdf', notes: 'Wider panels', drawing_type: 'Client / Designer Drawing' })
        .expect(201);
      const revs = res.body.revisions as Row[];
      expect(revs.map((r) => r.id)).toEqual(['rev-201', 'rev-202']);
      expect(revs.find((r) => r.id === 'rev-201')).toMatchObject({ approved_status: 'Superseded', is_current: false, file_url: expect.any(String) });
      expect(revs.find((r) => r.id === 'rev-202')).toMatchObject({ is_current: true, approved_status: 'Pending Review' });
      expect(res.body.current_revision_id).toBe('rev-202');
    });

    it('refuses to change a stored revision through the API', async () => {
      const drawing = (await owner().get('/api/drawings/dwg-1').expect(200)).body;
      const tampered = { ...drawing, revisions: drawing.revisions.map((r: Row) => (r.id === 'rev-3' ? { ...r, file_url: '/swapped.pdf' } : r)) };
      const res = await owner().post('/api/data/sync').send({ upserts: { drawings: [tampered] } });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/immutable/);
    });

    it('records the exact revision a work item was created from', async () => {
      const item = (await db.pool.query(`SELECT source_drawing_revision_id FROM work_items WHERE id = 'item-1'`)).rows[0];
      expect(item.source_drawing_revision_id).toBe('rev-3');
    });

    it('lets uploaders record the client issue, but only drawings.approve releases an NW drawing for production', async () => {
      const drawing = (await owner().get('/api/drawings/dwg-2').expect(200)).body;
      const approve = { ...drawing, revisions: drawing.revisions.map((r: Row) => (r.id === 'rev-202' ? { ...r, approved_status: 'Approved' } : r)) };
      expect((await as['Site Supervisor'].post('/api/data/sync').send({ upserts: { drawings: [approve] } })).status).toBe(403);
      expect((await as['Project Manager'].post('/api/data/sync').send({ upserts: { drawings: [approve] } })).status).toBe(200);
      const nw = { id: 'nwd-202', drawing_number: 'A-104-NW', revision: 'Rev 1', title: 'NW A-104', linked_client_drawing_id: 'dwg-2', linked_client_revision: 'Rev 2', status: 'Draft', approved_for_production: false };
      const withNw = (n: Row) => ({ ...approve, nw_production_drawings: [n] });
      expect((await as['Project Manager'].post('/api/data/sync').send({ upserts: { drawings: [withNw({ ...nw, status: 'Approved', approved_for_production: true })] } })).status).toBe(403);
      await as['Project Manager'].post('/api/data/sync').send({ upserts: { drawings: [withNw(nw)] } }).expect(200);
      expect((await as['Project Manager'].post('/api/data/sync').send({ upserts: { drawings: [withNw({ ...nw, status: 'Approved', approved_for_production: true })] } })).status).toBe(403);
      await owner().post('/api/data/sync').send({ upserts: { drawings: [withNw({ ...nw, status: 'Approved', approved_for_production: true })] } }).expect(200);
      const stored = (await db.pool.query(`SELECT approval_status, approved_for_production, linked_client_revision_id FROM drawing_revisions WHERE id = 'nwd-202'`)).rows[0];
      expect(stored).toEqual({ approval_status: 'Approved', approved_for_production: true, linked_client_revision_id: 'rev-202' });
    });
  });

  // -------------------------------------------------------------- production
  describe('production orders', () => {
    const order = (over: Row = {}) => ({
      id: 'po-new',
      order_number: 'PO-NEW',
      project_id: 'proj-1',
      project_number: 'NW-2026-088',
      project_name: 'Aurora',
      work_package_id: 'wp-1',
      work_package_name: 'Carpentry',
      work_item_id: 'item-16',
      work_item_code: 'CAR-006',
      client_id: 'client-1',
      client_name: 'Pavilion',
      location: 'Fitting rooms',
      contractor_id: 'con-1',
      contractor_name: 'Hock Seng',
      production_manager_id: 'user-prod-mgr',
      production_manager_name: 'Tan',
      required_date: '2026-11-01',
      current_stage: 'Not Started',
      priority: 'Normal',
      status: 'Not Started',
      approved_client_drawing_id: 'dwg-1',
      approved_client_drawing_revision: 'A-103 Rev 3',
      approved_nw_production_drawing_id: 'nwd-1',
      approved_nw_production_drawing_revision: 'A-103-NW Rev 1',
      production_method: 'NW-PM-Counter-001 Rev 2',
      material: 'Plywood',
      finish: 'Oak',
      dimensions: '1200x2400',
      quantity: 3,
      notes: '',
      photos: [],
      barcode: 'B',
      qr_code: 'Q',
      stage_history: [],
      created_at: '2026-10-01',
      updated_at: '2026-10-01',
      ...over,
    });

    it('accepts an order on the approved, current revision and records the exact revisions', async () => {
      const res = await as['Production Manager'].post('/api/production-orders').send(order()).expect(201);
      expect(res.body).toMatchObject({ client_drawing_revision_id: 'rev-3', nw_drawing_revision_id: 'nwd-1', drawing_check: 'valid' });
    });

    it('rejects an order on a superseded revision', async () => {
      const res = await as['Production Manager'].post('/api/production-orders').send(order({ id: 'po-old', approved_client_drawing_revision: 'A-103 Rev 2' }));
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/superseded/);
    });

    it('rejects an order on a missing or unapproved production drawing', async () => {
      const res = await as['Production Manager'].post('/api/production-orders').send(order({ id: 'po-nonw', approved_nw_production_drawing_id: 'nwd-missing' }));
      expect(res.status).toBe(400);
    });

    it('lets a flagged legacy order be parked but not advanced', async () => {
      const legacy = (await owner().get('/api/production-orders/po-102').expect(200)).body;
      expect(legacy.drawing_check).toBe('invalid');
      expect((await as['Production Manager'].patch('/api/production-orders/po-102').send({ status: 'Packing' })).status).toBe(400);
      expect((await as['Production Manager'].patch('/api/production-orders/po-102').send({ status: 'Blocked' })).status).toBe(200);
    });

    it('blocks advancing once the revision is superseded', async () => {
      await owner().post('/api/drawings/dwg-1/revisions').send({ id: 'rev-4', revision: 'Rev 4', title: 'Counter Rev 4', file_url: '/A-103_Rev4.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
      const res = await as['Production Manager'].patch('/api/production-orders/po-new').send({ status: 'Cutting' });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/superseded/);
    });

    it('keeps production records away from roles without production.view', async () => {
      expect((await as['Client'].get('/api/production-orders')).status).toBe(403);
    });
  });

  // ---------------------------------------------------------- delivery & site
  describe('delivery, receiving, installation', () => {
    it('records a contractor-arranged delivery', async () => {
      const del = { ...unrelatedProject().deliveryRecords[0], id: 'del-new', delivery_number: 'DEL-NEW', project_id: 'proj-1', work_package_id: 'wp-1', work_item_ids: ['item-3'], work_item_codes: ['CAR-001'], contractor_id: 'con-1', contractor_name: 'Hock Seng' };
      const res = await as['Contractor'].post('/api/deliveries').send(del).expect(201);
      expect(res.body.arranged_by).toBe('Contractor');
      expect((await db.pool.query(`SELECT work_item_id FROM delivery_items WHERE delivery_id = 'del-new'`)).rows).toEqual([{ work_item_id: 'item-3' }]);
    });

    it('creates an append-only receipt record and never starts installation', async () => {
      const before = (await db.pool.query(`SELECT status FROM installation_jobs WHERE work_item_id = 'item-3' ORDER BY id`)).rows;
      const itemBefore = (await owner().get('/api/work-items/item-3')).body.installation_status;
      const receipt = { id: 'rcpt-1', delivery_id: 'del-new', delivery_number: 'DEL-NEW', project_id: 'proj-1', project_name: 'Aurora', receiving_user_id: 'forged', receiving_user_name: 'Forged', receiving_role: 'Owner / CEO', received_at: '2026-10-10T10:00:00Z', condition_status: 'Short Quantity', packages_expected: 3, packages_received: 2, damaged_quantity: 0, missing_quantity: 1, photos: [], receiver_signature: 'sig' };
      await as['Site Supervisor'].patch('/api/deliveries/del-new').send({ status: 'Received / Confirmed', site_receipt: receipt }).expect(200);
      const stored = (await db.pool.query(`SELECT receiver_id, missing_quantity, condition_status FROM delivery_receipts WHERE id = 'rcpt-1'`)).rows[0];
      expect(stored).toEqual({ receiver_id: 'user-site', missing_quantity: 1, condition_status: 'Short Quantity' });
      expect((await db.pool.query(`SELECT status FROM installation_jobs WHERE work_item_id = 'item-3' ORDER BY id`)).rows).toEqual(before);
      expect((await owner().get('/api/work-items/item-3')).body.installation_status).toBe(itemBefore);
      const changed = await as['Site Supervisor'].patch('/api/deliveries/del-new').send({ site_receipt: { ...receipt, receiving_user_id: 'user-site', receiving_user_name: 'Site Supervisor', receiving_role: 'Site Supervisor', missing_quantity: 0 } });
      expect(changed.status).toBe(403);
      const audit = (await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = 'del-new' AND action = 'delivery.receipt'`)).rowCount;
      expect(audit).toBe(1);
      const listed = (await as['Site Supervisor'].get('/api/delivery-receipts?delivery_id=del-new').expect(200)).body as Row[];
      expect(listed.map((r) => [r.id, r.project_id])).toEqual([['rcpt-1', 'proj-1']]);
      expect((await as['Site Supervisor'].post('/api/delivery-receipts').send({ id: 'rcpt-fake' })).status).toBe(403);
    });

    it('lets only the installation flow change installation status', async () => {
      const job = (await as['Contractor'].get('/api/installation-jobs').expect(200)).body[0];
      expect((await as['Client'].patch(`/api/installation-jobs/${job.id}`).send({ status: 'In Progress' })).status).toBe(403);
    });
  });

  describe('site QC', () => {
    const qc = (over: Row) => ({
      id: 'sqc-new', inspection_number: 'SQC-NEW', work_item_id: 'item-3', work_item_code: 'CAR-001', installation_job_id: 'inst-1', project_id: 'proj-1', project_name: 'Aurora',
      inspector_name: 'forged', inspector_role: 'forged', inspection_date: '2026-10-11', result: 'Fail / Rectification Required',
      level_and_alignment_pass: false, hardware_and_mechanism_pass: true, finish_and_surfaces_pass: false, safety_and_fixing_pass: true, cleanliness_and_protection_pass: true,
      snag_items: [{ id: 's1', description: 'Edge banding lifting' }], inspector_signoff: true, photos: [], comments: '', ...over,
    });

    it('a failed QC creates and links a rectification issue', async () => {
      const res = await as['Site Supervisor'].post('/api/site-qc').send(qc({})).expect(201);
      expect(res.body.rectification_issue_id).toBe('issue-rect-sqc-new');
      expect(res.body.inspector_name).toBe('Site Supervisor');
      const issue = (await owner().get('/api/issues/issue-rect-sqc-new').expect(200)).body;
      expect(issue).toMatchObject({ project_id: 'proj-1', work_item_id: 'item-3', status: 'Reported' });
    });

    it('a failed QC blocks completing the work item and its installation', async () => {
      const item = (await owner().get('/api/work-items/item-3')).body;
      const res = await owner().post('/api/data/sync').send({ upserts: { workItems: [{ ...item, status: 'Completed', installation_status: 'Completed' }] } });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/site QC failed/);
      expect((await owner().patch('/api/installation-jobs/inst-1').send({ status: 'Completed' })).status).toBe(403);
    });

    it('a passing re-inspection allows completion', async () => {
      await as['Site Supervisor'].post('/api/site-qc').send(qc({ id: 'sqc-re', inspection_number: 'SQC-RE', result: 'Pass', inspection_date: '2026-10-12', snag_items: [] })).expect(201);
      const item = (await owner().get('/api/work-items/item-3')).body;
      expect((await owner().post('/api/data/sync').send({ upserts: { workItems: [{ ...item, status: 'Completed' }] } })).status).toBe(200);
    });
  });

  // --------------------------------------------------------------- variations
  describe('variations and contract value', () => {
    const variation = { id: 'vo-new', project_id: 'proj-2', variation_number: 'VO-NEW', title: 'Extra shelving', description: 'x', estimated_cost: 6000, client_amount: 10000, status: 'Identified', requested_by: 'PM', schedule_impact_days: 2, created_at: '2026-10-01' };

    it('a proposed variation never changes the contract value', async () => {
      const before = (await owner().get('/api/projects/proj-2/contract-summary').expect(200)).body;
      await owner().post('/api/variations').send(variation).expect(201);
      const after = (await owner().get('/api/projects/proj-2/contract-summary').expect(200)).body;
      expect(after.current_contract_value).toBe(before.current_contract_value);
      expect(after.pending_variations_total).toBe(before.pending_variations_total + 10000);
      expect(after.original_contract_value).toBe(before.original_contract_value);
    });

    it('cannot be created already approved, or skip internal approval', async () => {
      expect((await owner().post('/api/variations').send({ ...variation, id: 'vo-x', status: 'Approved' })).status).toBe(403);
      expect((await owner().post('/api/variations/vo-new/transition').send({ status: 'Approved' })).status).toBe(403);
    });

    it('follows Costing -> Internal Approval -> Client Approval -> Approved, gated by role', async () => {
      await as['Project Manager'].post('/api/variations/vo-new/transition').send({ status: 'Costing' }).expect(200);
      await as['Project Manager'].post('/api/variations/vo-new/transition').send({ status: 'Internal Approval' }).expect(200);
      // Internal approval needs variations.approve (Owner), not the PM.
      expect((await as['Project Manager'].post('/api/variations/vo-new/transition').send({ status: 'Client Approval' })).status).toBe(403);
      await owner().post('/api/variations/vo-new/transition').send({ status: 'Client Approval' }).expect(200);
      const before = (await owner().get('/api/projects/proj-2/contract-summary')).body;
      await owner().post('/api/variations/vo-new/transition').send({ status: 'Approved' }).expect(200);
      const after = (await owner().get('/api/projects/proj-2/contract-summary')).body;
      expect(after.approved_variations_total).toBe(before.approved_variations_total + 10000);
      expect(after.current_contract_value).toBe(after.original_contract_value + after.approved_variations_total);
      const project = (await owner().get('/api/projects/proj-2')).body;
      expect(project.contract_value).toBe(after.original_contract_value); // original stays separate
    });

    it('freezes amounts once approved', async () => {
      expect((await owner().patch('/api/variations/vo-new').send({ client_amount: 99999 })).status).toBe(403);
    });

    it('lets the client accept a variation on their own project only', async () => {
      const vo = (await owner().get('/api/variations/vo-1').expect(200)).body;
      expect(vo.status).toBe('Client Approval');
      await as['Client'].post('/api/variations/vo-1/transition').send({ status: 'Approved' }).expect(200);
      expect((await as['Client'].post('/api/variations/vo-new/transition').send({ status: 'Implemented' })).status).toBe(403);
    });
  });

  // ---------------------------------------------------------------- approvals
  describe('approvals', () => {
    it('records the signed-in requester, not the one in the body', async () => {
      const res = await as['Project Manager']
        .post('/api/approvals')
        .send({ id: 'apr-new', approval_number: 'APR-NEW', approval_type: 'Technical Change', title: 'Change', description: 'x', project_id: 'proj-1', project_name: 'Aurora', requested_by_id: 'user-owner', requested_by_name: 'Forged', requested_by_role: 'Owner / CEO', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-01', decision: 'Approved', created_at: '', updated_at: '' })
        .expect(201);
      expect(res.body).toMatchObject({ requested_by_id: 'user-pm', decision: 'Pending' });
    });

    it('only an authorised approver can decide; self-approval is blocked; decisions are final', async () => {
      expect((await as['Project Manager'].post('/api/approvals/apr-new/decision').send({ decision: 'Approved' })).status).toBe(403);
      expect((await as['Contractor'].post('/api/approvals/apr-new/decision').send({ decision: 'Approved' })).status).toBe(403);
      const forged = await as['Site Supervisor'].post('/api/data/sync').send({ upserts: { approvals: [{ ...(await owner().get('/api/approvals/apr-new')).body, decision: 'Approved', decision_by_id: 'user-owner' }] } });
      expect(forged.status).toBe(403);
      const res = await owner().post('/api/approvals/apr-new/decision').send({ decision: 'Approved', comments: 'OK' }).expect(200);
      expect(res.body).toMatchObject({ decision: 'Approved', decision_by_id: 'user-owner', decision_by_role: 'Owner / CEO' });
      expect((await owner().post('/api/approvals/apr-new/decision').send({ decision: 'Rejected' })).status).toBe(403);
      const audit = (await db.pool.query(`SELECT action, actor_id FROM audit_logs WHERE entity_id = 'apr-new' AND action LIKE 'approval.%'`)).rows;
      expect(audit).toEqual([{ action: 'approval.approve', actor_id: 'user-owner' }]);
    });
  });

  // --------------------------------------------------------------- commercial
  describe('commercial', () => {
    it('counts an issued PO as committed cost and keeps actual cost separate', async () => {
      const before = (await as['Accountant'].get('/api/projects/proj-2/profitability').expect(200)).body;
      const supplier = (await owner().get('/api/suppliers').expect(200)).body[0];
      await as['Purchasing']
        .post('/api/purchase-orders')
        .send({ id: 'po-c1', po_number: 'PO-C1', project_id: 'proj-2', project_name: 'Horizon', supplier_id: supplier.id, supplier_name: supplier.name, items: [], total_amount: 10000, status: 'Issued', created_at: '', updated_at: '' })
        .expect(201);
      const afterPo = (await as['Accountant'].get('/api/projects/proj-2/profitability').expect(200)).body;
      expect(afterPo.committed_cost).toBe(before.committed_cost + 10000);
      expect(afterPo.actual_cost).toBe(before.actual_cost);

      await as['Accountant']
        .post('/api/cost-ledger')
        .send({ cost_id: 'cst-c1', project_id: 'proj-2', project_name: 'Horizon', cost_category: 'Material', party_name: 'Supplier', po_reference: 'PO-C1', description: 'Invoice', amount: 4000, date: '2026-10-05', status: 'Incurred', cost_source: 'PO-C1', created_by: 'Accountant' })
        .expect(201);
      const afterInvoice = (await as['Accountant'].get('/api/projects/proj-2/profitability').expect(200)).body;
      expect(afterInvoice.actual_cost).toBe(afterPo.actual_cost + 4000);
      expect(afterInvoice.committed_cost).toBe(afterPo.committed_cost); // invoicing does not add commitment
      // Forecast counts the PO once: invoiced part as actual, the rest as open commitment.
      expect(afterInvoice.forecast_final_cost).toBeGreaterThanOrEqual(afterInvoice.estimated_direct_cost);
      expect(afterInvoice.project_gross_profit).toBe(Math.round((afterInvoice.selling_price - afterInvoice.forecast_final_cost) * 100) / 100);
      expect(Object.keys(afterInvoice).some((k) => /net/i.test(k))).toBe(false);
    });

    it('a draft PO is not committed cost', async () => {
      const before = (await as['Accountant'].get('/api/projects/proj-2/profitability')).body;
      await as['Purchasing'].post('/api/purchase-orders').send({ id: 'po-c2', po_number: 'PO-C2', project_id: 'proj-2', project_name: 'Horizon', supplier_id: null, supplier_name: '', items: [], total_amount: 5000, status: 'Draft', created_at: '', updated_at: '' }).expect(201);
      expect((await as['Accountant'].get('/api/projects/proj-2/profitability')).body.committed_cost).toBe(before.committed_cost);
    });
  });

  // -------------------------------------------------------------------- audit
  describe('audit trail', () => {
    it('records logins and changes, and is readable only with audit.view', async () => {
      const logins = (await db.pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'login'`)).rows[0].n;
      expect(logins).toBeGreaterThanOrEqual(USERS.length);
      const rows = (await owner().get('/api/audit-logs?entity_type=variations').expect(200)).body as Row[];
      expect(rows.some((r) => r.entity_id === 'vo-new')).toBe(true);
      expect((await as['Production Staff'].get('/api/audit-logs')).status).toBe(403);
    });
  });

  // -------------------------------------------------------- persistence check
  describe('persistence', () => {
    it('survives a new connection pool (server restart) with every collection intact', async () => {
      const { createPool } = await import('../db/pool');
      const fresh = createPool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${db.schema}` });
      try {
        const agent = await signIn(buildApp(fresh), 'owner@test.local');
        const snap = (await agent.get('/api/data/snapshot').expect(200)).body;
        expect(snap.variations.find((v: Row) => v.id === 'vo-new').status).toBe('Approved');
        expect(snap.drawings.find((d: Row) => d.id === 'dwg-1').revisions.map((r: Row) => r.id)).toEqual(['rev-1', 'rev-2', 'rev-3', 'rev-4']);
      } finally {
        await fresh.end();
      }
    });
  });
});
