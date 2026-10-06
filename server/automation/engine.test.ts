import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { AutomationEngine, ensureRules } from './engine';
import { RULES, RULE_BY_KEY } from './rules';
import type { PlannedAction, RuleDef } from './types';

type Row = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!TEST_DATABASE_URL)('Phase 5 automation engine and scheduler', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};
  let engine: AutomationEngine;
  // A test-only rule whose behaviour the tests control.
  const control: { fail: boolean; plan: PlannedAction[] } = { fail: false, plan: [] };
  const testRule: RuleDef = {
    key: 'test_rule',
    name: 'Test rule',
    description: 'test',
    watches: [],
    interval_minutes: 5,
    defaults: {},
    actions: 'test',
    human_in_loop: 'test',
    evaluate: async () => {
      if (control.fail) throw new Error('evaluation exploded');
      return control.plan;
    },
  };
  beforeAll(async () => {
    ({ db, as } = await setupDemoWorld());
    RULES.push(testRule);
    RULE_BY_KEY.set(testRule.key, testRule);
    await ensureRules(db.pool);
    await db.pool.query(`UPDATE automation_rules SET next_run_at = now() + interval '1 day'`); // nothing due unless a test says so
    engine = new AutomationEngine(db.pool);
  });
  afterAll(async () => {
    await engine?.stop();
    RULES.splice(RULES.indexOf(testRule), 1);
    RULE_BY_KEY.delete(testRule.key);
    await db?.close();
  });
  const runs = async (rule: string) => (await db.pool.query(`SELECT * FROM automation_runs WHERE rule_key = $1 ORDER BY id`, [rule])).rows as Row[];
  const ruleRow = async (rule: string) => (await db.pool.query(`SELECT * FROM automation_rules WHERE key = $1`, [rule])).rows[0] as Row;
  const note = (id: string) => ({ title: `Test ${id}`, message: 'm', type: 'information' as const, priority: 'normal' as const, project_id: 'proj-1', link_tab: 'automation', entity_type: 'test', entity_id: id });

  it('creates a configuration row for every rule with its defaults', async () => {
    const rows = (await db.pool.query(`SELECT key, enabled, interval_minutes, config FROM automation_rules ORDER BY key`)).rows as Row[];
    for (const r of RULES) expect(rows.find((x) => x.key === r.key)).toMatchObject({ enabled: true, interval_minutes: r.interval_minutes, config: r.defaults });
  });

  it('runs only due rules on schedule, logs the run and moves the next run forward', async () => {
    await db.pool.query(`UPDATE automation_rules SET next_run_at = now() - interval '1 minute' WHERE key = 'test_rule'`);
    control.plan = [{ kind: 'notification', key: 'test:sched:1', users: ['user-pm'], note: note('sched') }];
    const results = await engine.runDue();
    expect(results.map((r) => r.rule)).toEqual(['test_rule']);
    const [run] = await runs('test_rule');
    expect(run).toMatchObject({ trigger: 'schedule', status: 'succeeded', actions_taken: 1, retry_count: 0 });
    expect(run.finished_at).toBeTruthy();
    expect(run.actions).toEqual([{ kind: 'notification', key: 'test:sched:1' }]);
    const row = await ruleRow('test_rule');
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect((await engine.runDue()).length).toBe(0); // not due again yet
  });

  it('never repeats an action when the same event is processed twice', async () => {
    control.plan = [{ kind: 'notification', key: 'test:dup:1', users: ['user-pm', 'user-site'], note: note('dup') }];
    const first = await engine.runRule('test_rule', 'event', { collections: ['tasks'] });
    const second = await engine.runRule('test_rule', 'event', { collections: ['tasks'] });
    expect([first.actions_taken, second.actions_taken]).toEqual([1, 0]);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM notifications WHERE rule_key = 'test:dup:1'`)).rows[0].n).toBe(2);
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM automation_actions WHERE action_key = 'test:dup:1'`)).rows[0].n).toBe(1);
  });

  it('logs a failing rule, backs off, and succeeds on retry', async () => {
    control.fail = true;
    const failed = await engine.runRule('test_rule', 'schedule');
    expect(failed).toMatchObject({ status: 'failed', error: 'evaluation exploded' });
    const row = await ruleRow('test_rule');
    expect(row.consecutive_failures).toBe(1);
    expect(new Date(row.next_run_at).getTime()).toBeGreaterThan(Date.now()); // backoff
    const logged = (await runs('test_rule')).at(-1)!;
    expect(logged).toMatchObject({ status: 'failed', error: 'evaluation exploded' });
    control.fail = false;
    control.plan = [];
    await db.pool.query(`UPDATE automation_rules SET next_run_at = now() - interval '1 second' WHERE key = 'test_rule'`);
    const [retry] = await engine.runDue();
    expect(retry).toMatchObject({ rule: 'test_rule', status: 'succeeded' });
    expect((await runs('test_rule')).at(-1)).toMatchObject({ trigger: 'retry', retry_count: 1, status: 'succeeded' });
    expect((await ruleRow('test_rule')).consecutive_failures).toBe(0);
  });

  it('rolls back a failed action with its ledger entry, so the next run retries it', async () => {
    const task = (project: string) => ({ id: 'tsk-auto-test-fk', task_number: 'T-FK', title: 'FK test', description: '', project_id: project, project_name: '', source_event: 'test', source_module: 'System Automation', assigned_user_id: 'user-pm', assigned_user_name: 'PM', assigned_role: 'Project Manager', priority: 'Normal', due_date: '2026-12-01', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' });
    control.plan = [{ kind: 'task', key: 'test:fk', task: task('no-such-project') }];
    const bad = await engine.runRule('test_rule', 'manual');
    expect(bad.status).toBe('failed');
    expect((await db.pool.query(`SELECT count(*)::int AS n FROM automation_actions WHERE action_key = 'test:fk'`)).rows[0].n).toBe(0);
    control.plan = [{ kind: 'task', key: 'test:fk', task: task('proj-1') }];
    const good = await engine.runRule('test_rule', 'manual');
    expect(good).toMatchObject({ status: 'succeeded', actions_taken: 1 });
    expect((await db.pool.query(`SELECT status, project_id FROM tasks WHERE id = 'tsk-auto-test-fk'`)).rows[0]).toEqual({ status: 'Open', project_id: 'proj-1' });
    const audit = (await db.pool.query(`SELECT actor_name, action FROM audit_logs WHERE entity_id = 'tsk-auto-test-fk'`)).rows[0];
    expect(audit).toMatchObject({ actor_name: 'NW OS Automation', action: 'create' });
  });

  it('does not run a rule twice at the same time (lease), and recovers a dead server\'s lease', async () => {
    // Another server is running it right now.
    await db.pool.query(`UPDATE automation_rules SET lease_until = now() + interval '5 minutes', lease_token = 'other-server' WHERE key = 'test_rule'`);
    expect((await engine.runRule('test_rule', 'manual')).status).toBe('skipped');
    // That server died: its lease expires and the rule runs again.
    await db.pool.query(`UPDATE automation_rules SET lease_until = now() - interval '1 second' WHERE key = 'test_rule'`);
    expect((await engine.runRule('test_rule', 'manual')).status).toBe('succeeded');
    expect((await db.pool.query(`SELECT lease_until, lease_token FROM automation_rules WHERE key = 'test_rule'`)).rows[0]).toEqual({ lease_until: null, lease_token: null });
  });

  it('never starves the connection pool when many different rules run at once (regression: CI hang)', async () => {
    // Two servers' engines, every rule at once, on a 5-connection pool. With the old session
    // advisory lock each run pinned a connection and waited for another: a deadlock.
    const engines = [new AutomationEngine(db.pool), new AutomationEngine(db.pool)];
    const statuses = await Promise.all(RULES.flatMap((r) => engines.map((e) => e.runRule(r.key, 'manual').then((x) => x.status))));
    expect(statuses.every((st) => st === 'succeeded' || st === 'skipped')).toBe(true);
    expect(statuses.filter((st) => st === 'succeeded').length).toBeGreaterThanOrEqual(RULES.length);
  }, 30_000);

  it('skips disabled rules on schedule', async () => {
    await db.pool.query(`UPDATE automation_rules SET enabled = false, next_run_at = now() - interval '1 minute' WHERE key = 'test_rule'`);
    expect((await engine.runDue()).find((r) => r.rule === 'test_rule')).toBeUndefined();
    expect((await engine.runRule('test_rule', 'schedule')).status).toBe('skipped');
    await db.pool.query(`UPDATE automation_rules SET enabled = true, next_run_at = now() + interval '1 day' WHERE key = 'test_rule'`);
  });

  it('runs on its own on the server: the scheduler fires due rules and writes trigger rules right after commit', async () => {
    const started = new AutomationEngine(db.pool);
    await started.start(150);
    try {
      // Scheduled: make the test rule due; the timer picks it up with nobody calling anything.
      control.plan = [{ kind: 'notification', key: 'test:timer:1', users: ['user-owner'], note: note('timer') }];
      const before = (await runs('test_rule')).length;
      await db.pool.query(`UPDATE automation_rules SET next_run_at = now() - interval '1 second' WHERE key = 'test_rule'`);
      for (let i = 0; i < 40 && (await runs('test_rule')).length === before; i++) await sleep(100);
      expect((await runs('test_rule')).at(-1)).toMatchObject({ trigger: 'schedule', status: 'succeeded' });

      // Event: a drawing revision goes to review through the API; the review task appears.
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions').send({ id: 'rev-evt', revision: 'Rev 7', title: 'x', file_url: '/r7.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }).expect(201);
      await as['Project Manager'].post('/api/drawings/dwg-1/revisions/rev-evt/status').send({ status: 'Internal Review' }).expect(200);
      let task: Row | undefined;
      for (let i = 0; i < 50 && !task; i++) {
        await sleep(100);
        task = (await db.pool.query(`SELECT status, assigned_user_id, data FROM tasks WHERE id = 'tsk-auto-drw-rev-evt'`)).rows[0];
      }
      expect(task).toMatchObject({ status: 'Open', assigned_user_id: 'user-owner' });
      expect(task!.data).toMatchObject({ drawing_id: 'dwg-1', drawing_revision_id: 'rev-evt', source_module: 'System Automation' });
      expect((await runs('drawing_review')).some((r) => r.trigger === 'event')).toBe(true);

      // Deciding the revision closes the automation's task (the decision itself stays human).
      await as['Owner / CEO'].post('/api/drawings/dwg-1/revisions/rev-evt/status').send({ status: 'Rejected' }).expect(200);
      let closed = '';
      for (let i = 0; i < 50 && closed !== 'Completed'; i++) {
        await sleep(100);
        closed = (await db.pool.query(`SELECT status FROM tasks WHERE id = 'tsk-auto-drw-rev-evt'`)).rows[0].status;
      }
      expect(closed).toBe('Completed');
      expect((await db.pool.query(`SELECT approval_status FROM drawing_revisions WHERE id = 'rev-evt'`)).rows[0].approval_status).toBe('Rejected');
    } finally {
      await started.stop();
    }
  }, 30_000);

  describe('rule administration API', () => {
    it('shows rules with schedule, run counts and limits to automation viewers', async () => {
      const body = (await as['Site Supervisor'].get('/api/automation/rules').expect(200)).body;
      const drawing = body.rules.find((r: Row) => r.key === 'drawing_review');
      expect(drawing).toMatchObject({ enabled: true, interval_minutes: 15, watches: ['drawings'] });
      expect(drawing.run_count).toBeGreaterThan(0);
      expect(body.ai_forbidden_actions).toContain('Approve or reject drawings');
      expect((await as['Client'].get('/api/automation/rules')).status).toBe(403);
      expect((await as['Client'].get('/api/automation/runs')).status).toBe(403);
    });

    it('lets only rule managers change thresholds, validates them and audits the change', async () => {
      expect((await as['Project Manager'].patch('/api/automation/rules/task_overdue').send({ enabled: false })).status).toBe(403);
      expect((await as['Admin'].patch('/api/automation/rules/task_overdue').send({ config: { nonsense: 1 } })).status).toBe(400);
      expect((await as['Admin'].patch('/api/automation/rules/task_overdue').send({ config: { owner_after_hours: 'soon' } })).status).toBe(400);
      expect((await as['Admin'].patch('/api/automation/rules/task_overdue').send({ interval_minutes: 0 })).status).toBe(400);
      const ok = (await as['Admin'].patch('/api/automation/rules/task_overdue').send({ interval_minutes: 10, config: { owner_after_hours: 96 } }).expect(200)).body;
      expect(ok).toMatchObject({ enabled: true, interval_minutes: 10, config: { owner_after_hours: 96, manager_after_hours: 24 } });
      const audit = (await db.pool.query(`SELECT action, actor_id FROM audit_logs WHERE entity_type = 'automation_rule' AND entity_id = 'task_overdue'`)).rows;
      expect(audit).toEqual([{ action: 'automation.rule.update', actor_id: 'user-admin' }]);
    });

    it('lists runs and retries a failed one', async () => {
      control.fail = true;
      const failed = await engine.runRule('test_rule', 'manual');
      control.fail = false;
      const list = (await as['Admin'].get('/api/automation/runs?status=failed').expect(200)).body as Row[];
      expect(list[0]).toMatchObject({ id: failed.run_id, status: 'failed', error: 'evaluation exploded' });
      expect((await as['Project Manager'].post(`/api/automation/runs/${failed.run_id}/retry`)).status).toBe(403);
      const retried = (await as['Admin'].post(`/api/automation/runs/${failed.run_id}/retry`).expect(200)).body;
      expect(retried).toMatchObject({ rule: 'test_rule', status: 'succeeded' });
      expect((await as['Admin'].post(`/api/automation/runs/${retried.run_id}/retry`)).status).toBe(400); // only failed runs
    });
  });
});
