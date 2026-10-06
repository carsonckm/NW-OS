import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 schedule calendar and automation admin', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    await as['Project Manager']
      .post('/api/tasks')
      .send({ id: 'cal-t1', task_number: 'CAL-1', title: 'Confirm site access', description: '', project_id: 'proj-1', project_name: 'Aurora', source_event: 'm', source_module: 'PM', assigned_user_id: 'user-site', assigned_user_name: 'Site', assigned_role: 'Site Supervisor', priority: 'Normal', due_date: '2026-10-20', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' })
      .expect(201);
  });
  afterAll(async () => {
    await db?.close();
  });
  const cal = async (role: string, q = '') => (await as[role].get(`/api/calendar?from=2020-01-01&to=2030-12-31&status=${q}`).expect(200)).body as Row[];

  it('lists recorded dates from every source, scoped to the user', async () => {
    const owner = await cal('Owner / CEO');
    const types = new Set(owner.map((e) => e.type));
    for (const t of ['task', 'delivery', 'handover']) expect(types, t).toContain(t);
    expect(owner.find((e) => e.id === 'task:cal-t1')).toMatchObject({ date: '2026-10-20', person_id: 'user-site', role: 'Site Supervisor', project_id: 'proj-1', tab: 'automation' });
    expect(owner.map((e) => e.project_id)).toContain('proj-x');
    // Sorted by date.
    expect(owner.map((e) => e.date)).toEqual([...owner.map((e) => e.date)].sort());
  });

  it('keeps contractor, client and financial isolation', async () => {
    const con = await cal('Contractor');
    expect(con.map((e) => e.project_id)).not.toContain('proj-x');
    expect(con.some((e) => e.type === 'invoice')).toBe(false);
    expect(con.some((e) => e.id === 'task:cal-t1')).toBe(false); // not their task
    const deliveries = con.filter((e) => e.type === 'delivery').map((e) => e.id.slice(9));
    if (deliveries.length) {
      const owners = (await db.pool.query('SELECT DISTINCT contractor_id FROM deliveries WHERE id = ANY($1)', [deliveries])).rows.map((r) => r.contractor_id);
      expect(owners).toEqual(['con-1']);
    }
    expect((await cal('Site Supervisor')).some((e) => e.type === 'invoice')).toBe(false);
    expect((await cal('Production Staff')).map((e) => e.project_id).filter(Boolean).every((p) => p === 'proj-1')).toBe(true);
  });

  it('filters by project, person, role, type and status', async () => {
    const f = (await as['Owner / CEO'].get('/api/calendar?from=2026-10-01&to=2026-10-31&project_id=proj-1&person_id=user-site&role=Site%20Supervisor&type=task').expect(200)).body as Row[];
    expect(f.map((e) => e.id)).toContain('task:cal-t1');
    expect(f.every((e) => e.project_id === 'proj-1' && e.person_id === 'user-site' && e.type === 'task')).toBe(true);
    await as['Site Supervisor'].patch('/api/tasks/cal-t1').send({ status: 'Completed' }).expect(200);
    expect((await cal('Owner / CEO', 'open')).some((e) => e.id === 'task:cal-t1')).toBe(false);
    expect((await cal('Owner / CEO', 'overdue')).every((e) => e.overdue)).toBe(true);
  });

  it('records automation admin changes in an audit trail visible on the rule', async () => {
    await as['Admin'].patch('/api/automation/rules/task_overdue').send({ interval_minutes: 20, config: { manager_after_hours: 12 } }).expect(200);
    await as['Admin'].post('/api/automation/run').send({ rule: 'task_overdue' }).expect(200);
    const audit = (await as['Admin'].get('/api/automation/audit?rule=task_overdue').expect(200)).body as Row[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['automation.rule.update', 'automation.run']));
    expect(audit.find((a) => a.action === 'automation.rule.update')).toMatchObject({ actor_name: expect.any(String) });
    expect((await as['Admin'].patch('/api/automation/rules/task_overdue').send({ config: { nonsense: 1 } })).status).toBe(400);
    expect((await as['Site Supervisor'].patch('/api/automation/rules/task_overdue').send({ enabled: false })).status).toBe(403);
    expect((await as['Client'].get('/api/automation/audit')).status).toBe(403);
    const rules = (await as['Admin'].get('/api/automation/rules').expect(200)).body.rules as Row[];
    expect(rules.find((r) => r.key === 'task_overdue')).toMatchObject({ interval_minutes: 20, config: expect.objectContaining({ manager_after_hours: 12 }) });
  });
});
