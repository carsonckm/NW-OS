import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 Owner Exception Center and owner dependency', () => {
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
  const center = async () => (await owner().get('/api/owner/center').expect(200)).body as Row;
  const approval = (id: string, related: string, type = 'Major Purchase') => ({ id, approval_number: id.toUpperCase(), approval_type: type, title: `${type} ${id}`, description: 'x', project_id: 'proj-1', project_name: 'Aurora', related_entity_type: 'purchase', related_entity_id: related, assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-01', decision: 'Pending', created_at: '', updated_at: '' });

  it('is for the owner (and admin) only', async () => {
    for (const role of ['Project Manager', 'Accountant', 'Site Supervisor', 'Client', 'Contractor']) {
      expect((await as[role].get('/api/owner/center')).status, role).toBe(403);
      expect((await as[role].get('/api/owner/dependency')).status, role).toBe(403);
    }
    await as['Admin'].get('/api/owner/center').expect(200);
  });

  it('lists only decisions the owner must take', async () => {
    await pm().post('/api/drawings/dwg-1/revisions').send({ id: 'rev-oc', revision: 'Rev 11', title: 'x', file_url: '/r11.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
    await pm().post('/api/drawings/dwg-1/revisions/rev-oc/status').send({ status: 'Internal Review' }).expect(200);
    await pm().post('/api/variations').send({ id: 'vo-oc', variation_number: 'VO-OC', project_id: 'proj-1', project_name: 'Aurora', title: 'Extra plinth', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 1500, status: 'Identified', created_at: '' }).expect(201);
    await pm().post('/api/variations/vo-oc/transition').send({ status: 'Internal Approval' }).expect(200);
    await owner().post('/api/variations').send({ id: 'vo-own', variation_number: 'VO-OWN', project_id: 'proj-1', project_name: 'Aurora', title: 'Own', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 1, client_amount: 2, status: 'Identified', created_at: '' }).expect(201);
    await owner().post('/api/variations/vo-own/transition').send({ status: 'Internal Approval' }).expect(200);
    await as['Purchasing'].post('/api/approvals').send(approval('apr-oc', 'po-x')).expect(201);
    const c = await center();
    const ids = c.decisions.map((d: Row) => d.id);
    expect(ids).toEqual(expect.arrayContaining(['drw-rev-oc', 'vo-vo-oc', 'apr-apr-oc']));
    expect(ids).not.toContain('vo-vo-own'); // the owner can't approve their own variation
    const vo = c.decisions.find((d: Row) => d.id === 'vo-vo-oc');
    expect(vo).toMatchObject({ tab: 'variations', entity_type: 'variation', entity_id: 'vo-oc', project_id: 'proj-1' });
    expect(vo.detail).toMatch(/RM 1,500/);
    expect(c.question).toBe('What needs me today?');
  });

  it('shows critical, financial and client exceptions with reasons, not normal events', async () => {
    const c = await center();
    expect(c.critical.length).toBeGreaterThan(0);
    expect(c.critical.every((x: Row) => ['critical', 'high'].includes(x.severity))).toBe(true);
    expect(c.critical.some((x: Row) => /Production .* (blocked|unapproved)/.test(x.title))).toBe(true);
    // Severity order: critical first.
    const ranks = c.critical.map((x: Row) => ({ critical: 0, high: 1, medium: 2 })[x.severity as 'critical']);
    expect([...ranks].sort((a: number, b: number) => a - b)).toEqual(ranks);
    // A cost overrun appears as a financial exception, from the server's figures.
    const baseline = (await owner().get('/api/commercial-baselines/proj-1').expect(200)).body;
    await owner().patch('/api/commercial-baselines/proj-1').send({ original_budget_direct_cost: 1000 }).expect(200);
    const fin = (await center()).financial.map((x: Row) => x.title);
    expect(fin).toEqual(expect.arrayContaining(['Forecast cost over budget']));
    await owner().patch('/api/commercial-baselines/proj-1').send({ original_budget_direct_cost: baseline.original_budget_direct_cost }).expect(200);
  });

  it('reports company health from server figures', async () => {
    const c = await center();
    let committed = 0;
    let actual = 0;
    for (const p of (await db.pool.query(`SELECT id FROM projects WHERE project_status NOT IN ('Completed', 'Closed')`)).rows) {
      const prof = (await owner().get(`/api/projects/${p.id}/profitability`).expect(200)).body;
      committed += prof.committed_cost;
      actual += prof.actual_cost;
    }
    expect(c.health).toMatchObject({ committed_cost: Math.round(committed), actual_cost: Math.round(actual), outstanding_approvals: c.decisions.length });
    expect(c.health.open_projects).toBeGreaterThan(0);
    expect(c.health.at_risk + c.health.critical).toBe(c.risk.filter((r: Row) => ['At Risk', 'Critical'].includes(r.level)).length);
  });

  it('measures owner dependency and recommends (never performs) delegation', async () => {
    // Three routine approvals the owner decided this week, plus one waiting more than 2 days.
    for (const id of ['apr-d1', 'apr-d2', 'apr-d3']) {
      await as['Purchasing'].post('/api/approvals').send(approval(id, `po-${id}`)).expect(201);
      await db.pool.query(`UPDATE approvals SET created_at = now() - interval '5 hours' WHERE id = $1`, [id]);
      await owner().post(`/api/approvals/${id}/decision`).send({ decision: 'Approved' }).expect(200);
    }
    await db.pool.query(`UPDATE approvals SET created_at = now() - interval '3 days' WHERE id = 'apr-oc'`);
    const d = (await owner().get('/api/owner/dependency').expect(200)).body;
    expect(d.week.owner_actions).toBeGreaterThanOrEqual(3);
    expect(d.week.by_category.find((c: Row) => c.category === 'Major Purchase approval')).toMatchObject({ count: 3, routine: 3 });
    expect(d.average_response_hours).toBeGreaterThanOrEqual(4);
    expect(d.today.decisions).toBeGreaterThan(0);
    expect(d.waiting.approvals_waiting_for_owner).toBe((await center()).decisions.length);
    expect(d.waiting.projects_blocked_by_owner.map((p: Row) => p.project_id)).toContain('proj-1');
    const rec = d.recommendations.find((r: Row) => r.category === 'Major Purchase approval');
    expect(rec).toMatchObject({ automatic: false });
    expect(rec.suggestion).toMatch(/Consider delegating/);
    expect(d.note).toMatch(/Nothing is delegated/);
    // Nothing was actually delegated: the role table is unchanged.
    expect((await as['Project Manager'].post('/api/approvals/apr-oc/decision').send({ decision: 'Approved' })).status).toBe(403);
  });
});
