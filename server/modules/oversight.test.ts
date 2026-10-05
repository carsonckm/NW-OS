import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 4 drawing clarity, exceptions and project overview', () => {
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
  const revision = async (id: string) => ((await owner().get('/api/drawings/dwg-1').expect(200)).body.revisions as Row[]).find((r) => r.id === id)!;

  it('records who uploaded, sent for review and approved a revision; browser-sent stamps are ignored', async () => {
    await pm().post('/api/drawings/dwg-1/revisions').send({ id: 'rev-p4', revision: 'Rev 9', title: 'Counter rev 9', file_url: '/rev9.pdf', notes: '', drawing_type: 'Client / Designer Drawing', approved_by: 'Forged', approved_at: '2020-01-01' }).expect(201);
    let rev = await revision('rev-p4');
    expect(rev).toMatchObject({ approved_status: 'Draft', uploaded_by: 'Project Manager', uploaded_by_id: 'user-pm' });
    expect(rev.approved_by).toBeUndefined();

    await pm().post('/api/drawings/dwg-1/revisions/rev-p4/status').send({ status: 'Internal Review' }).expect(200);
    rev = await revision('rev-p4');
    expect(rev).toMatchObject({ approved_status: 'Internal Review', review_requested_by: 'Project Manager' });

    const exceptions = (await owner().get('/api/exceptions').expect(200)).body as Row[];
    expect(exceptions.find((e) => e.id === 'drw-rev-p4')).toMatchObject({ kind: 'drawing_review', project_id: 'proj-1', tab: 'drawings', owner_action: true });

    await owner().post('/api/drawings/dwg-1/revisions/rev-p4/status').send({ status: 'Approved' }).expect(200);
    rev = await revision('rev-p4');
    expect(rev).toMatchObject({ approved_status: 'Approved', is_current: true, approved_by: 'Owner / CEO', approved_by_id: 'user-owner' });
    expect(Date.parse(rev.approved_at)).toBeGreaterThan(Date.parse('2026-01-01'));
    const approvedAt = rev.approved_at;

    // A sync that sends the drawing back with a forged approver keeps the server's record.
    const drawing = (await owner().get('/api/drawings/dwg-1').expect(200)).body;
    drawing.revisions = drawing.revisions.map((r: Row) => (r.id === 'rev-p4' ? { ...r, approved_by: 'Somebody', approved_at: '1999-01-01' } : r));
    await owner().post('/api/data/sync').send({ upserts: { drawings: [drawing] } }).expect(200);
    expect(await revision('rev-p4')).toMatchObject({ approved_by: 'Owner / CEO', approved_at: approvedAt });

    // The previous approved revision is now superseded, with a date.
    const superseded = ((await owner().get('/api/drawings/dwg-1').expect(200)).body.revisions as Row[]).filter((r) => r.approved_status === 'Superseded');
    expect(superseded.length).toBeGreaterThan(0);
    expect(superseded.every((r) => r.superseded_at)).toBe(true);
    expect((await owner().get('/api/exceptions').expect(200)).body.find((e: Row) => e.id === 'drw-rev-p4')).toBeUndefined();
  });

  it('lists which production orders use which revision, for roles that can see production', async () => {
    const usage = (await as['Production Manager'].get('/api/drawings/dwg-1/production-usage').expect(200)).body as Record<string, Row[]>;
    const orders = Object.values(usage).flat();
    expect(orders.length).toBeGreaterThan(0);
    expect(orders[0]).toHaveProperty('order_number');
    expect((await as['Client'].get('/api/drawings/dwg-1/production-usage')).status).toBe(403);
  });

  it('reports exceptions only to NW staff and only within their projects', async () => {
    expect((await as['Client'].get('/api/exceptions')).status).toBe(403);
    expect((await as['Contractor'].get('/api/exceptions')).status).toBe(403);
    const staff = (await as['Production Staff'].get('/api/exceptions').expect(200)).body as Row[];
    expect(staff.every((e) => e.project_id === 'proj-1')).toBe(true);
    const site = (await as['Site Supervisor'].get('/api/exceptions').expect(200)).body as Row[];
    expect(site.some((e) => e.kind === 'cost_overrun' || e.kind.startsWith('invoice'))).toBe(false);
    for (const e of (await owner().get('/api/exceptions').expect(200)).body as Row[]) {
      expect(['critical', 'high', 'medium']).toContain(e.severity);
      expect(e.title).toBeTruthy();
    }
  });

  it('flags a failed site QC and a cost overrun for the owner', async () => {
    await as['Site Supervisor']
      .post('/api/site-qc')
      .send({ id: 'sqc-ov', inspection_number: 'SQC-OV', work_item_id: 'item-3', work_item_code: 'CAR-001', installation_job_id: 'inst-1', project_id: 'proj-1', project_name: 'Aurora', inspection_date: '2026-12-01', result: 'Fail / Rectification Required', snag_items: [], photos: [], comments: '' })
      .expect(201);
    const baseline = (await owner().get('/api/commercial-baselines/proj-1').expect(200)).body;
    await owner().patch('/api/commercial-baselines/proj-1').send({ original_budget_direct_cost: 1 }).expect(200);
    const list = (await owner().get('/api/exceptions').expect(200)).body as Row[];
    expect(list.find((e) => e.kind === 'site_qc_failed' && e.project_id === 'proj-1')).toBeTruthy();
    expect(list.find((e) => e.kind === 'cost_overrun' && e.project_id === 'proj-1')).toMatchObject({ owner_action: true });
    // Critical first.
    const ranks = list.map((e) => ({ critical: 0, high: 1, medium: 2 })[e.severity as 'critical']);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    await owner().patch('/api/commercial-baselines/proj-1').send({ original_budget_direct_cost: baseline.original_budget_direct_cost }).expect(200);
  });

  it('gives a project overview from the database, with money only for financial roles', async () => {
    const full = (await owner().get('/api/projects/proj-1/overview').expect(200)).body;
    expect(full.project).toMatchObject({ id: 'proj-1' });
    expect(full.work_items.total).toBeGreaterThan(0);
    expect(full.profitability).toHaveProperty('project_gross_profit');
    expect(Array.isArray(full.exceptions)).toBe(true);
    const site = (await as['Site Supervisor'].get('/api/projects/proj-1/overview').expect(200)).body;
    expect(site.profitability).toBeNull();
    expect((await as['Production Staff'].get('/api/projects/proj-2/overview')).status).toBe(404);
    expect((await as['Client'].get('/api/projects/proj-1/overview')).status).toBe(403);
  });
});
