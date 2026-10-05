import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { runAutomation } from './automation';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL)('Phase 4 users, notifications, automation, knowledge, WhatsApp', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
  });
  afterAll(async () => {
    await db?.close();
  });
  const owner = () => as['Owner / CEO'];
  const admin = () => as['Admin'];

  describe('user management', () => {
    it('lets only users.manage create users, never an Owner by an Admin, and audits role changes', async () => {
      expect((await as['Project Manager'].get('/api/users')).status).toBe(403);
      expect((await admin().post('/api/users').send({ name: 'Boss 2', email: 'boss2@test.local', role: 'Owner / CEO', password: 'long-password-1' })).status).toBe(403);
      const u = (await admin().post('/api/users').send({ name: 'New Site', email: 'newsite@test.local', role: 'Site Supervisor', password: 'long-password-1' }).expect(201)).body;
      await admin().put(`/api/users/${u.id}/projects`).send({ project_ids: ['proj-2'] }).expect(200);
      await admin().patch(`/api/users/${u.id}`).send({ role: 'Project Manager' }).expect(200);
      expect((await admin().patch('/api/users/user-admin').send({ role: 'Owner / CEO' })).status).toBe(403);
      const actions = (await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY id`, [u.id])).rows.map((r) => r.action);
      expect(actions).toEqual(['user.create', 'user.assignments', 'user.role_change']);
    });
  });

  describe('notifications and automation', () => {
    it('notifies approvers of a drawing in review, once, and only them', async () => {
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id: 'rev-auto', revision: 'Rev 8', title: 'x', file_url: '/r8.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-auto/status').send({ status: 'Internal Review' }).expect(200);
      await runAutomation(db.pool);
      const again = await runAutomation(db.pool);
      const rows = (await db.pool.query(`SELECT user_id FROM notifications WHERE rule_key = 'drawing_review:rev-auto'`)).rows.map((r) => r.user_id);
      expect(rows).toEqual(['user-owner']);
      expect(again.notifications).toBe(0);
      const mine = (await owner().get('/api/notifications').expect(200)).body as Row[];
      const n = mine.find((x) => x.entity_id === 'rev-auto');
      expect(n).toMatchObject({ link_tab: 'drawings', is_read: false });
      expect(((await as['Site Supervisor'].get('/api/notifications').expect(200)).body as Row[]).some((x) => x.entity_id === 'rev-auto')).toBe(false);
      // Nobody can read or mark someone else's notification.
      expect((await as['Site Supervisor'].post(`/api/notifications/${n.id}/read`)).status).toBe(404);
      await owner().post(`/api/notifications/${n.id}/read`).expect(200);
      expect(((await owner().get('/api/notifications').expect(200)).body as Row[]).find((x) => x.id === n.id).is_read).toBe(true);
      // Automation never approved the drawing.
      expect((await db.pool.query(`SELECT approval_status FROM drawing_revisions WHERE id = 'rev-auto'`)).rows[0].approval_status).toBe('Internal Review');
    });

    it('raises one rectification task for a failed site QC and never approves or completes anything', async () => {
      await as['Site Supervisor']
        .post('/api/site-qc')
        .send({ id: 'sqc-auto', inspection_number: 'SQC-AUTO', work_item_id: 'item-3', work_item_code: 'CAR-001', installation_job_id: 'inst-1', project_id: 'proj-1', project_name: 'Aurora', inspection_date: '2026-12-02', result: 'Fail / Rectification Required', snag_items: [], photos: [], comments: '' })
        .expect(201);
      const first = await runAutomation(db.pool);
      await runAutomation(db.pool);
      const tasks = (await db.pool.query(`SELECT id, issue_id, project_id, status, assigned_user_id FROM tasks WHERE issue_id = 'issue-rect-sqc-auto'`)).rows;
      expect(first.tasks).toBeGreaterThanOrEqual(1);
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toMatchObject({ project_id: 'proj-1', status: 'Open' });
      expect((await db.pool.query(`SELECT status FROM issues WHERE id = 'issue-rect-sqc-auto'`)).rows[0].status).toBe('Reported');
      expect((await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = $1`, [tasks[0].id])).rows.map((r) => r.action)).toContain('create');
    });

    it('notifies variation approvers other than the author, and overdue assignees', async () => {
      const v = { id: 'vo-auto', variation_number: 'VO-AUTO', project_id: 'proj-1', project_name: 'Aurora', title: 'Extra shelf', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: 300, status: 'Identified', created_at: '' };
      await owner().post('/api/variations').send(v).expect(201);
      await owner().post('/api/variations/vo-auto/transition').send({ status: 'Costing' }).expect(200);
      await owner().post('/api/variations/vo-auto/transition').send({ status: 'Internal Approval' }).expect(200);
      await runAutomation(db.pool);
      expect((await db.pool.query(`SELECT count(*)::int AS n FROM notifications WHERE rule_key = 'variation_internal:vo-auto'`)).rows[0].n).toBe(0); // the only approver wrote it
      expect((await db.pool.query(`SELECT status FROM variations WHERE id = 'vo-auto'`)).rows[0].status).toBe('Internal Approval');

      await as['Project Manager'].post('/api/tasks').send({ id: 'tsk-late', task_number: 'TSK-LATE', title: 'Late thing', description: '', project_id: 'proj-1', project_name: 'Aurora', source_event: 'x', source_module: 'PM', assigned_user_id: 'user-site', assigned_user_name: 'S', assigned_role: 'Site Supervisor', priority: 'High', due_date: '2026-01-01', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' }).expect(201);
      await runAutomation(db.pool, '2026-01-10');
      const who = (await db.pool.query(`SELECT user_id FROM notifications WHERE rule_key = 'task_overdue:tsk-late:2026-01-01' ORDER BY user_id`)).rows.map((r) => r.user_id);
      expect(who).toContain('user-site');
    });

    it('exposes the rules with their human-in-loop limits, and only managers can force a run', async () => {
      const rules = (await as['Site Supervisor'].get('/api/automation/rules').expect(200)).body;
      expect(rules.rules.length).toBe(8);
      expect(rules.ai_forbidden_actions).toContain('Approve or reject drawings');
      expect((await as['Site Supervisor'].post('/api/automation/run')).status).toBe(403);
      await admin().post('/api/automation/run').expect(200);
      expect((await as['Client'].get('/api/automation/rules')).status).toBe(403);
    });
  });

  describe('knowledge base', () => {
    const article = { id: 'kb-p4', title: 'Edge band before CNC drilling', category: 'Joinery', description: 'x', reason: 'y', example: 'z', created_by: 'Forged', status: 'Draft', created_at: '' };
    it('lets proposers write drafts, only knowledge editors publish, and locks published articles', async () => {
      expect((await as['Production Manager'].post('/api/knowledge').send({ ...article, status: 'Approved' })).status).toBe(403);
      const created = (await as['Production Manager'].post('/api/knowledge').send(article).expect(201)).body;
      expect(created).toMatchObject({ created_by: 'Production Manager', created_by_id: 'user-prod-mgr', status: 'Draft' });
      await as['Production Manager'].patch('/api/knowledge/kb-p4').send({ status: 'Review' }).expect(200);
      expect((await as['Production Manager'].patch('/api/knowledge/kb-p4').send({ status: 'Approved' })).status).toBe(403);
      expect((await as['Project Manager'].post('/api/knowledge').send({ ...article, id: 'kb-x' })).status).toBe(403);
      const approved = (await owner().patch('/api/knowledge/kb-p4').send({ status: 'Approved' }).expect(200)).body;
      expect(approved).toMatchObject({ approved_by: 'Owner / CEO', approved_by_id: 'user-owner' });
      expect((await owner().patch('/api/knowledge/kb-p4').send({ description: 'rewritten' })).status).toBe(403);
      await owner().patch('/api/knowledge/kb-p4').send({ status: 'Archived' }).expect(200);
      expect((await as['Client'].get('/api/knowledge')).status).toBe(403);
      expect((await db.pool.query(`SELECT action FROM audit_logs WHERE entity_id = 'kb-p4' AND action LIKE 'knowledge.%' ORDER BY id`)).rows.map((r) => r.action)).toEqual(['knowledge.draft', 'knowledge.review', 'knowledge.approved', 'knowledge.archived']);
    });
  });

  describe('WhatsApp gateway', () => {
    it('gives unknown numbers nothing, and answers known numbers within their own access', async () => {
      const unknown = (await admin().post('/api/whatsapp/simulate-inbound').send({ from: '+60111111111', text: 'status Aurora', contacts: [{ phone_number: '+60111111111', role: 'Owner / CEO' }] }).expect(200)).body;
      expect(unknown).toMatchObject({ recognized: false, delivered: false });
      expect(unknown.reply).not.toMatch(/Aurora|Horizon|task|issue/i);

      await admin().post('/api/whatsapp/contacts').send({ phone: '+60 12-345 6789', user_id: 'user-client' }).expect(201);
      await admin().post('/api/whatsapp/contacts').send({ phone: '+60198765432', user_id: 'user-site' }).expect(201);
      const client = (await admin().post('/api/whatsapp/simulate-inbound').send({ from: '+60123456789', text: 'status' }).expect(200)).body;
      expect(client).toMatchObject({ recognized: true, user_id: 'user-client' });
      expect(client.reply).not.toMatch(/Horizon|task|issue|RM /i);
      const site = (await admin().post('/api/whatsapp/simulate-inbound').send({ from: '+60198765432', text: 'my tasks' }).expect(200)).body;
      expect(site.reply).toMatch(/open tasks|no open tasks/i);

      expect((await as['Project Manager'].post('/api/whatsapp/simulate-inbound').send({ from: '+60123456789', text: 'x' })).status).toBe(403);
      expect((await as['Project Manager'].post('/api/whatsapp/webhook').send({})).status).toBe(501);
      const log = (await db.pool.query(`SELECT direction, outcome FROM whatsapp_messages WHERE phone = '+60111111111' ORDER BY id`)).rows;
      expect(log).toEqual([{ direction: 'inbound', outcome: 'unknown_contact' }, { direction: 'outbound', outcome: 'provider_not_configured' }]);
      // Deactivated users are not recognised.
      await admin().patch('/api/users/user-site').send({ is_active: false }).expect(200);
      expect((await admin().post('/api/whatsapp/simulate-inbound').send({ from: '+60198765432', text: 'x' }).expect(200)).body.recognized).toBe(false);
      await admin().patch('/api/users/user-site').send({ is_active: true }).expect(200);
    });
  });
});
