/**
 * The automation engine.
 *
 *   trigger (schedule | event | manual | retry)
 *     → claim the rule (one runner at a time, across server instances)
 *     → evaluate the rule against PostgreSQL → planned actions
 *     → for each action, in its own transaction: record it in the action ledger
 *       (automation_actions, primary key = the action's occurrence key) and perform it only if
 *       the ledger row is new → task / notification / escalation (all audited)
 *     → record the run (automation_runs): trigger, input, actions taken, result, error, retries
 *
 * Idempotent: processing the same event twice finds the ledger row and does nothing.
 * Retry-safe: a failed action rolls back with its ledger row, so the next run retries it.
 * Failure-tolerant: a failing rule is logged and retried with backoff; other rules still run.
 * Runs on the server; nobody needs the app open.
 */
import { randomUUID } from 'crypto';
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool, PoolClient } from '../db/pool';
import { DataService, onCommitted } from '../modules/service';
import { People } from './people';
import { RULES, RULE_BY_KEY } from './rules';
import type { NoteSpec, PlannedAction, RuleDef } from './types';

type Row = Record<string, any>;
export type Trigger = 'schedule' | 'event' | 'manual' | 'retry';

export const SYSTEM_USER: AuthUser = {
  id: 'system-automation', name: 'NW OS Automation', email: 'automation@nwos.local', role: 'Owner / CEO', is_active: true, is_dev_seed: false,
  client_id: null, contractor_id: null, phone: null, department: null, title: null, created_at: '', updated_at: '', last_login: null,
};
export const SYSTEM_ACTOR: AuditActor = { id: null, name: 'NW OS Automation', role: 'system' };
const MAX_BACKOFF_MINUTES = 60;

export interface RunResult {
  rule: string;
  run_id: number | null;
  status: 'succeeded' | 'failed' | 'skipped';
  actions_taken: number;
  error?: string;
}

/** Creates the configuration row for every rule the code defines (keeps existing settings). */
export async function ensureRules(pool: Pool) {
  for (const r of RULES) {
    await pool.query(
      `INSERT INTO automation_rules (key, interval_minutes, config) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
      [r.key, r.interval_minutes, JSON.stringify(r.defaults)]
    );
  }
}

async function insertNotifications(db: PoolClient, users: string[], note: NoteSpec, ruleKey: string) {
  let n = 0;
  for (const userId of new Set(users)) {
    const res = await db.query(
      `INSERT INTO notifications (id, user_id, title, message, type, priority, project_id, link_tab, entity_type, entity_id, rule_key)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2 AND is_active)
       ON CONFLICT (user_id, rule_key) DO NOTHING`,
      [`ntf-${randomUUID()}`, userId, note.title, note.message, note.type, note.priority, note.project_id, note.link_tab, note.entity_type, note.entity_id, ruleKey]
    );
    n += res.rowCount ?? 0;
  }
  return n;
}

export class AutomationEngine {
  private service: DataService;
  private systemCtx?: AccessContext;
  private timer?: NodeJS.Timeout;
  private intervalMs = 0;
  private ticking = false;
  private stopped = false;
  private pendingEvents = new Set<string>();
  private eventTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;

  constructor(private pool: Pool, private clock: () => Date = () => new Date()) {
    this.service = new DataService(pool);
  }

  private async ctx() {
    return (this.systemCtx ??= await AccessContext.load(this.pool, SYSTEM_USER));
  }

  /** Performs one planned action exactly once (ledger + action in one transaction). */
  private async perform(rule: RuleDef, runId: number, a: PlannedAction, people: People): Promise<boolean> {
    if (a.kind === 'close_task') {
      return this.service.transact(await this.ctx(), SYSTEM_ACTOR, async (h) => {
        const row = (await h.db.query(`SELECT data FROM tasks WHERE id = $1 AND status NOT IN ('Completed', 'Cancelled') FOR UPDATE`, [a.task_id])).rows[0];
        if (!row) return false;
        const comments = Array.isArray(row.data.comments) ? row.data.comments : [];
        await h.insertSystemRecord(
          'tasks',
          { ...row.data, status: 'Completed', completed_date: this.clock().toISOString(), comments: [...comments, { id: `c-${randomUUID()}`, user_name: SYSTEM_ACTOR.name, role: 'System', text: `Closed automatically: ${a.note}`, timestamp: this.clock().toISOString() }] },
          `${rule.key}: source resolved (${a.note})`
        );
        return true;
      });
    }
    return this.service.transact(await this.ctx(), SYSTEM_ACTOR, async (h) => {
      const target = a.kind === 'task' ? ['task', String(a.task.id), (a.task.project_id as string) ?? null] : a.kind === 'escalation' ? [a.record.source_record_type, a.record.source_record_id, a.record.project_id] : [a.note.entity_type, a.note.entity_id, a.note.project_id];
      const fresh = await h.db.query(
        `INSERT INTO automation_actions (action_key, rule_key, run_id, kind, target_type, target_id, project_id, detail)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (action_key) DO NOTHING`,
        [a.key, rule.key, runId, a.kind, target[0], target[1], target[2], JSON.stringify(a.kind === 'notification' ? { users: a.users } : a.kind === 'escalation' ? { level: a.level, users: a.users } : { assignee: a.task.assigned_user_id })]
      );
      if (!fresh.rowCount) return false; // already done for this occurrence
      if (a.kind === 'notification') {
        const users = [];
        for (const u of a.users) if (await people.canSee(u, a.note.project_id)) users.push(u);
        await insertNotifications(h.db, users, a.note, a.key);
      } else if (a.kind === 'task') {
        const exists = (await h.db.query('SELECT 1 FROM tasks WHERE id = $1', [a.task.id])).rowCount;
        if (!exists) await h.insertSystemRecord('tasks', a.task, `${rule.key}: ${String(a.task.source_event ?? '')}`);
        const assignee = String(a.task.assigned_user_id);
        await insertNotifications(
          h.db,
          [assignee],
          a.note ?? { title: `New task: ${String(a.task.title)}`, message: `Due ${String(a.task.due_date ?? '')}. Raised by automation (${rule.name}).`, type: 'action', priority: a.task.priority === 'Urgent' ? 'urgent' : 'high', project_id: (a.task.project_id as string) ?? null, link_tab: 'automation', entity_type: 'task', entity_id: String(a.task.id) },
          `${a.key}:assigned`
        );
      } else if (a.kind === 'escalation') {
        const id = `esc-auto-${randomUUID()}`;
        await h.insertSystemRecord(
          'escalations',
          {
            id,
            escalation_number: `ESC-${id.slice(9, 17).toUpperCase()}`,
            ...a.record,
            project_name: people.projectName(a.record.project_id),
            assigned_user_name: a.users.map((u) => people.user(u)?.name).filter(Boolean).join(', '),
            requires_acknowledgement: a.record.is_critical,
            rule_key: rule.key,
            level: a.level,
            created_at: this.clock().toISOString(),
          },
          `${rule.key}: escalation level ${a.level}`
        );
        if (a.record.source_record_type === 'Task') {
          const task = (await h.db.query('SELECT data FROM tasks WHERE id = $1', [a.record.source_record_id])).rows[0];
          if (task) await h.insertSystemRecord('tasks', { ...task.data, escalation_level: a.record.current_level }, `${rule.key}: escalated to ${a.record.current_level}`);
        }
        const users = [];
        for (const u of a.users) if (await people.canSee(u, a.record.project_id)) users.push(u);
        await insertNotifications(h.db, users, a.note, a.key);
      }
      return true;
    });
  }

  /** Runs one rule now. Concurrent runs of the same rule are prevented with an advisory lock. */
  async runRule(key: string, trigger: Trigger, event: Row | null = null): Promise<RunResult> {
    const rule = RULE_BY_KEY.get(key);
    if (!rule) throw new Error(`Unknown automation rule ${key}`);
    const lockClient = await this.pool.connect();
    try {
      const locked = (await lockClient.query(`SELECT pg_try_advisory_lock(hashtext('nwos-automation:' || $1)) AS ok`, [key])).rows[0].ok;
      if (!locked) return { rule: key, run_id: null, status: 'skipped', actions_taken: 0 };
      try {
        const cfgRow = (await this.pool.query('SELECT enabled, config, consecutive_failures FROM automation_rules WHERE key = $1', [key])).rows[0];
        if (!cfgRow) return { rule: key, run_id: null, status: 'skipped', actions_taken: 0 };
        if (!cfgRow.enabled && trigger !== 'manual') return { rule: key, run_id: null, status: 'skipped', actions_taken: 0 };
        const retryCount = trigger === 'retry' ? cfgRow.consecutive_failures : 0;
        const runId = Number(
          (await this.pool.query(`INSERT INTO automation_runs (rule_key, trigger, event, status, retry_count) VALUES ($1, $2, $3, 'running', $4) RETURNING id`, [key, trigger, event ? JSON.stringify(event) : null, retryCount])).rows[0].id
        );
        const taken: Row[] = [];
        try {
          const now = this.clock();
          const people = await People.load(this.pool);
          const planned = await rule.evaluate({ pool: this.pool, now, today: now.toISOString().slice(0, 10), config: { ...rule.defaults, ...(cfgRow.config ?? {}) }, people });
          let firstError: unknown;
          for (const a of planned) {
            try {
              if (await this.perform(rule, runId, a, people)) taken.push({ kind: a.kind, key: a.key });
            } catch (err) {
              firstError ??= err; // keep going; the failed action stays un-ledgered and is retried
            }
          }
          if (firstError) throw firstError;
          await this.pool.query(`UPDATE automation_runs SET status = 'succeeded', finished_at = now(), actions_taken = $2, actions = $3 WHERE id = $1`, [runId, taken.length, JSON.stringify(taken)]);
          await this.pool.query(
            `UPDATE automation_rules SET last_run_at = now(), consecutive_failures = 0,
               next_run_at = CASE WHEN $2 IN ('schedule', 'retry') THEN now() + make_interval(mins => interval_minutes) ELSE next_run_at END WHERE key = $1`,
            [key, trigger]
          );
          return { rule: key, run_id: runId, status: 'succeeded', actions_taken: taken.length };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await this.pool.query(`UPDATE automation_runs SET status = 'failed', finished_at = now(), actions_taken = $2, actions = $3, error = $4 WHERE id = $1`, [runId, taken.length, JSON.stringify(taken), message.slice(0, 2000)]);
          // Retry with backoff: 1, 2, 4 ... minutes, capped.
          await this.pool.query(
            `UPDATE automation_rules SET last_run_at = now(), consecutive_failures = consecutive_failures + 1,
               next_run_at = now() + make_interval(mins => LEAST($2, power(2, consecutive_failures)::int)) WHERE key = $1`,
            [key, MAX_BACKOFF_MINUTES]
          );
          return { rule: key, run_id: runId, status: 'failed', actions_taken: taken.length, error: message };
        }
      } finally {
        await lockClient.query(`SELECT pg_advisory_unlock(hashtext('nwos-automation:' || $1))`, [key]);
      }
    } finally {
      lockClient.release();
    }
  }

  /** Runs every enabled rule whose next run time has come (the scheduler tick). */
  async runDue(): Promise<RunResult[]> {
    const due = (await this.pool.query(`SELECT key, consecutive_failures FROM automation_rules WHERE enabled AND next_run_at <= now() ORDER BY key`)).rows as { key: string; consecutive_failures: number }[];
    const out: RunResult[] = [];
    for (const r of due) {
      if (!RULE_BY_KEY.has(r.key)) continue;
      out.push(await this.runRule(r.key, r.consecutive_failures > 0 ? 'retry' : 'schedule'));
    }
    return out;
  }

  /** Runs all rules now (manual "run now" or tests). */
  async runAll(trigger: Trigger = 'manual') {
    const out: RunResult[] = [];
    for (const r of RULES) out.push(await this.runRule(r.key, trigger));
    return out;
  }

  /** Event-driven: rules watching the written collections run shortly after the commit. */
  private onWrite = (collections: string[]) => {
    for (const r of RULES) if (r.watches.some((c) => collections.includes(c))) this.pendingEvents.add(r.key);
    if (!this.pendingEvents.size || this.eventTimer) return;
    this.eventTimer = setTimeout(() => {
      this.eventTimer = undefined;
      if (this.stopped) return;
      const keys = [...this.pendingEvents];
      this.pendingEvents.clear();
      void (async () => {
        for (const k of keys) await this.runRule(k, 'event', { collections }).catch((err) => console.error(`automation ${k} failed:`, err));
      })();
    }, 250);
    this.eventTimer.unref?.();
  };

  /** Starts the scheduler (and event triggers). Safe to call once per server process. */
  async start(intervalMs = 30_000) {
    await ensureRules(this.pool);
    this.unsubscribe = onCommitted(this.onWrite);
    this.stopped = false;
    const tick = async () => {
      if (this.ticking || this.stopped) return;
      this.ticking = true;
      try {
        await this.runDue();
      } catch (err) {
        console.error('automation scheduler tick failed:', err);
      } finally {
        this.ticking = false;
      }
    };
    this.intervalMs = intervalMs;
    this.timer = setInterval(() => void tick(), intervalMs);
    this.timer.unref?.();
    void tick();
  }

  isRunning() {
    return !!this.timer;
  }

  tickSeconds() {
    return this.intervalMs / 1000;
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.eventTimer) clearTimeout(this.eventTimer);
    this.unsubscribe?.();
  }
}
