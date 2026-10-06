import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { runAutomation } from './automation';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 task engine, escalation and notification center', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const pm = () => as['Project Manager'];
  const site = () => as['Site Supervisor'];
  const owner = () => as['Owner / CEO'];
  const task = (over: Row) => ({ title: 'Task', description: '', project_id: 'proj-1', project_name: 'Aurora', source_event: 'manual', source_module: 'PM', assigned_user_id: 'user-site', assigned_user_name: 'x', assigned_role: 'Site Supervisor', priority: 'Normal', due_date: '2026-12-31', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '', ...over });
  const one = async (sql: string, p: unknown[] = []) => (await db.pool.query(sql, p)).rows[0] as Row;

  describe('tasks', () => {
    it('links a task to the records it is about, on the same project only', async () => {
      const otherProject = (await one(`SELECT id FROM variations WHERE project_id <> 'proj-1' LIMIT 1`))?.id;
      if (otherProject) expect((await pm().post('/api/tasks').send(task({ id: 't-bad', task_number: 'T-BAD', variation_id: otherProject }))).status).toBe(400);
      expect((await pm().post('/api/tasks').send(task({ id: 't-bad2', task_number: 'T-BAD2', delivery_id: 'no-such' }))).status).toBe(400);
      const v = (await one(`SELECT id FROM variations WHERE project_id = 'proj-1' LIMIT 1`)).id;
      const d = (await one(`SELECT id FROM drawings WHERE project_id = 'proj-1' LIMIT 1`)).id;
      const created = (await pm().post('/api/tasks').send(task({ id: 't-link', task_number: 'T-LINK', variation_id: v, drawing_id: d, reviewer_id: 'user-pm' })).expect(201)).body;
      expect(created).toMatchObject({ variation_id: v, drawing_id: d, reviewer_id: 'user-pm', history: [] });
      expect(await one(`SELECT variation_id, drawing_id, reviewer_id FROM tasks WHERE id = 't-link'`)).toEqual({ variation_id: v, drawing_id: d, reviewer_id: 'user-pm' });
    });

    it('lets the assignee progress their own task but not re-plan it or touch others', async () => {
      await site().patch('/api/tasks/t-link').send({ status: 'In Progress' }).expect(200);
      expect((await site().patch('/api/tasks/t-link').send({ due_date: '2027-06-01' })).status).toBe(403);
      expect((await site().patch('/api/tasks/t-link').send({ assigned_user_id: 'user-pm' })).status).toBe(403);
      await pm().post('/api/tasks').send(task({ id: 't-pm', task_number: 'T-PM', assigned_user_id: 'user-pm' })).expect(201);
      expect((await site().patch('/api/tasks/t-pm').send({ status: 'Completed' })).status).toBe(403);
      // The manager can re-plan; history records who changed what.
      await pm().patch('/api/tasks/t-link').send({ due_date: '2027-01-15', priority: 'High' }).expect(200);
      const history = (await one(`SELECT data->'history' AS h FROM tasks WHERE id = 't-link'`)).h as Row[];
      expect(history.map((e) => [e.field, e.to, e.by_id])).toEqual([
        ['status', 'In Progress', 'user-site'],
        ['due_date', '2027-01-15', 'user-pm'],
        ['priority', 'High', 'user-pm'],
      ]);
      expect((await pm().patch('/api/tasks/t-link').send({ history: [] })).body.history).toHaveLength(3); // history is the server's
    });

    it('needs a reason for Blocked, waits for dependencies, and evidence where required', async () => {
      expect((await site().patch('/api/tasks/t-link').send({ status: 'Blocked' })).status).toBe(400);
      await site().patch('/api/tasks/t-link').send({ status: 'Blocked', blocked_reason: 'Waiting for hinge delivery' }).expect(200);
      await pm().post('/api/tasks').send(task({ id: 't-dep', task_number: 'T-DEP', dependency_task_ids: ['t-link'], requires_evidence: true })).expect(201);
      const waiting = await site().patch('/api/tasks/t-dep').send({ status: 'In Progress' });
      expect(waiting.status).toBe(403);
      expect(waiting.body.message).toMatch(/Waiting for: Task/);
      await site().patch('/api/tasks/t-link').send({ status: 'Completed' }).expect(200);
      await site().patch('/api/tasks/t-dep').send({ status: 'In Progress' }).expect(200);
      expect((await site().patch('/api/tasks/t-dep').send({ status: 'Completed' })).status).toBe(400);
      const done = (await site().patch('/api/tasks/t-dep').send({ status: 'Completed', completion_evidence: 'Fitted and tested; photo IMG_204' }).expect(200)).body;
      expect(done).toMatchObject({ completed_by_id: 'user-site', completion_evidence: 'Fitted and tested; photo IMG_204' });
      expect((await site().patch('/api/tasks/t-dep').send({ status: 'Open' })).status).toBe(403); // reopen = manager
      expect((await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = 't-dep' AND action = 'task.complete'`)).rowCount).toBe(1);
    });

    it('assigns only to active people who work on the project', async () => {
      const res = await pm().post('/api/tasks').send(task({ id: 't-out', task_number: 'T-OUT', project_id: 'proj-x', assigned_user_id: 'user-contractor', assigned_role: 'Contractor' }));
      expect([400, 403]).toContain(res.status);
      await pm().post('/api/tasks').send(task({ id: 't-con', task_number: 'T-CON', assigned_user_id: 'user-contractor', assigned_role: 'Contractor', work_item_id: 'item-3' })).expect(201);
    });

    it('shows a contractor only the tasks assigned to them', async () => {
      const mine = ((await as['Contractor'].get('/api/tasks').expect(200)).body as Row[]).map((t) => t.id);
      expect(mine).toContain('t-con');
      expect(mine).not.toContain('t-link');
      const all = (await db.pool.query(`SELECT id FROM tasks WHERE assigned_user_id = 'user-contractor'`)).rows.map((r) => r.id).sort();
      expect([...mine].sort()).toEqual(all);
    });
  });

  describe('escalation', () => {
    it('climbs the ladder (assignee, manager, owner) once each, and only to people who can see the project', async () => {
      await pm().post('/api/tasks').send(task({ id: 't-late', task_number: 'T-LATE', title: 'Fix plinth', priority: 'High', due_date: '2026-11-01' })).expect(201);
      // Day 1 late: assignee only.
      await runAutomation(db.pool, '2026-11-02');
      const keys = async () => (await db.pool.query(`SELECT user_id, rule_key FROM notifications WHERE rule_key LIKE 'task_overdue:t-late:%' ORDER BY rule_key, user_id`)).rows.map((r) => `${r.rule_key.split(':').slice(3).join(':') || 'L0'}>${r.user_id}`);
      expect(await keys()).toEqual(['L0>user-site']);
      // 2 days late: manager (PM).
      await runAutomation(db.pool, '2026-11-03');
      expect(await keys()).toEqual(['L0>user-site', 'L1>user-pm']);
      // 5 days late: owner.
      await runAutomation(db.pool, '2026-11-06');
      await runAutomation(db.pool, '2026-11-06'); // re-run: nothing new
      expect(await keys()).toEqual(['L0>user-site', 'L1>user-pm', 'L2>user-owner']);
      const esc = (await db.pool.query(`SELECT level, status, data->>'current_level' AS lvl FROM escalations WHERE source_record_id = 't-late' ORDER BY level`)).rows;
      expect(esc).toEqual([{ level: 1, status: 'Open', lvl: 'PM' }, { level: 2, status: 'Open', lvl: 'Owner' }]);
      expect((await one(`SELECT data->>'escalation_level' AS l FROM tasks WHERE id = 't-late'`)).l).toBe('Owner');
      const note = (await db.pool.query(`SELECT requires_ack, source, type FROM notifications WHERE rule_key = 'task_overdue:t-late:2026-11-01:L2'`)).rows[0];
      expect(note).toEqual({ requires_ack: true, source: 'task_overdue', type: 'escalation' });
    });

    it('does not take normal-priority work to the owner, and keeps a contractor task with the site team first', async () => {
      await pm().post('/api/tasks').send(task({ id: 't-con-late', task_number: 'T-CL', title: 'Install trims', assigned_user_id: 'user-contractor', assigned_role: 'Contractor', work_item_id: 'item-3', due_date: '2026-11-01' })).expect(201);
      await runAutomation(db.pool, '2026-11-10');
      const who = (await db.pool.query(`SELECT user_id, split_part(rule_key, ':', 4) AS lvl FROM notifications WHERE rule_key LIKE 'task_overdue:t-con-late:%' ORDER BY 2, 1`)).rows.map((r) => `${r.lvl || 'L0'}>${r.user_id}`);
      expect(who).toEqual(['L0>user-contractor', 'L1>user-pm', 'L1>user-site']);
    });

    it('is acknowledged from the notification and resolved when the work is done', async () => {
      const n = (await owner().get('/api/notifications?group=escalation').expect(200)).body.find((x: Row) => x.entity_id === 't-late');
      expect(n).toMatchObject({ group: 'escalation', requires_ack: true, acknowledged_at: null, source: 'task_overdue' });
      expect((await site().post(`/api/notifications/${n.id}/acknowledge`)).status).toBe(404); // not theirs
      const ack = (await owner().post(`/api/notifications/${n.id}/acknowledge`).expect(200)).body;
      expect(ack.escalations_acknowledged).toBe(1);
      expect((await one(`SELECT status, acknowledged_by FROM escalations WHERE source_record_id = 't-late' AND level = 2`))).toEqual({ status: 'Acknowledged', acknowledged_by: 'user-owner' });
      await site().patch('/api/tasks/t-late').send({ status: 'Completed' }).expect(200);
      await runAutomation(db.pool, '2026-11-07');
      expect((await db.pool.query(`SELECT DISTINCT status FROM escalations WHERE source_record_id = 't-late'`)).rows).toEqual([{ status: 'Resolved' }]);
    });
  });

  describe('notification center', () => {
    it('groups, filters and counts only the signed-in user notifications', async () => {
      const summary = (await pm().get('/api/notifications/summary').expect(200)).body as Row[];
      expect(summary.map((s) => s.group).sort()).toEqual(expect.arrayContaining(['escalation']));
      const unread = (await pm().get('/api/notifications?unread=true').expect(200)).body as Row[];
      expect(unread.every((n) => !n.is_read)).toBe(true);
      expect(unread.every((n) => ['action', 'approval', 'warning', 'escalation', 'information'].includes(n.group))).toBe(true);
      const ids = new Set(unread.map((n) => n.id));
      const theirs = (await db.pool.query(`SELECT id FROM notifications WHERE user_id <> 'user-pm'`)).rows.map((r) => r.id);
      expect(theirs.some((id) => ids.has(id))).toBe(false);
    });
  });
});
