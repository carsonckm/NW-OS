import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { ValidationError } from '../core/repository';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { AI_FORBIDDEN_ACTIONS } from './automation';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { RULES, RULE_BY_KEY } from '../automation/rules';
import { NullProvider, handleInbound, normalizePhone } from './whatsapp';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

/**
 * Notifications (each user's own), automation rules and the WhatsApp gateway, mounted at
 * /api. All need a signed-in, active user.
 */
export function createOpsRouter({ pool, store, engine = new AutomationEngine(pool) }: { pool: Pool; store: AuthStore; engine?: AutomationEngine }) {
  const router = express.Router();
  let rulesReady: Promise<void> | undefined;
  const ready = () => (rulesReady ??= ensureRules(pool).catch((err) => { rulesReady = undefined; throw err; }));
  // A provider webhook has no user session; it would authenticate by the provider's signature.
  // No provider is connected, so it is refused.
  router.post('/whatsapp/webhook', (_req, res) =>
    res.status(501).json({ error: 'not_configured', message: 'No WhatsApp provider is connected. Inbound webhooks are disabled.' })
  );
  router.use(['/notifications', '/automation', '/whatsapp'], csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  // ---------------- notifications: only ever the signed-in user's own ----------------
  // Groups: action required, approval, warning, escalation, information.
  const GROUP_SQL = `CASE
      WHEN type IN ('escalation') THEN 'escalation'
      WHEN type IN ('approval') THEN 'approval'
      WHEN type IN ('warning', 'delivery') THEN 'warning'
      WHEN type IN ('action', 'task', 'issue') THEN 'action'
      ELSE 'information' END`;
  router.get(
    '/notifications',
    wrap(async (req, res) => {
      const group = typeof req.query.group === 'string' ? req.query.group : null;
      const unread = req.query.unread === 'true';
      const rows = (
        await pool.query(
          `SELECT id, title, message, type, ${GROUP_SQL} AS "group", priority, project_id, link_tab, entity_type, entity_id, source,
                  requires_ack, acknowledged_at, is_read, read_at, created_at
           FROM notifications WHERE user_id = $1 AND ($2::text IS NULL OR ${GROUP_SQL} = $2) AND (NOT $3 OR NOT is_read)
           ORDER BY (requires_ack AND acknowledged_at IS NULL) DESC, created_at DESC LIMIT 200`,
          [req.auth!.user.id, group, unread]
        )
      ).rows;
      res.json(rows);
    })
  );
  router.get(
    '/notifications/summary',
    wrap(async (req, res) => {
      const rows = (
        await pool.query(
          `SELECT ${GROUP_SQL} AS "group", count(*) FILTER (WHERE NOT is_read)::int AS unread, count(*)::int AS total,
                  count(*) FILTER (WHERE requires_ack AND acknowledged_at IS NULL)::int AS to_acknowledge
           FROM notifications WHERE user_id = $1 GROUP BY 1`,
          [req.auth!.user.id]
        )
      ).rows;
      res.json(rows);
    })
  );
  router.post(
    '/notifications/read-all',
    wrap(async (req, res) => {
      const r = await pool.query('UPDATE notifications SET is_read = true, read_at = now() WHERE user_id = $1 AND NOT is_read', [req.auth!.user.id]);
      res.json({ updated: r.rowCount });
    })
  );
  router.post(
    '/notifications/:id/read',
    wrap(async (req, res) => {
      const r = await pool.query('UPDATE notifications SET is_read = true, read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING id', [req.params.id, req.auth!.user.id]);
      if (!r.rowCount) return res.status(404).json({ error: 'not_found', message: 'Notification not found' });
      res.json({ id: req.params.id, is_read: true });
    })
  );
  router.post(
    '/notifications/:id/acknowledge',
    wrap(async (req, res) => {
      const r = await pool.query(
        `UPDATE notifications SET is_read = true, read_at = coalesce(read_at, now()), acknowledged_at = coalesce(acknowledged_at, now())
         WHERE id = $1 AND user_id = $2 RETURNING id, acknowledged_at, entity_type, entity_id, rule_key`,
        [req.params.id, req.auth!.user.id]
      );
      if (!r.rowCount) return res.status(404).json({ error: 'not_found', message: 'Notification not found' });
      // Acknowledging an escalation notice acknowledges the escalation it announces.
      const n = r.rows[0];
      const esc = await pool.query(
        `UPDATE escalations SET status = 'Acknowledged', acknowledged_by = $1, acknowledged_at = now(), updated_at = now(),
           data = data || jsonb_build_object('status', 'Acknowledged', 'acknowledged_by', $2::text, 'acknowledged_at', now())
         WHERE status = 'Open' AND source_record_id = $3 AND data->>'rule_key' = split_part($4, ':', 1)
           AND level = nullif(substring($4 from ':L([0-9]+)$'), '')::int RETURNING id`,
        [req.auth!.user.id, req.auth!.user.name, n.entity_id, n.rule_key ?? '']
      );
      for (const e of esc.rows) await writeAudit(pool, actorOf(req), { action: 'escalation.acknowledge', entityType: 'escalations', entityId: e.id });
      res.json({ id: req.params.id, acknowledged_at: n.acknowledged_at, escalations_acknowledged: esc.rowCount });
    })
  );

  // ---------------- automation ----------------
  const needView = (req: Request) => {
    if (!req.access!.can('automation.view')) throw new ForbiddenError('Missing permission: automation.view');
  };
  const needManageRules = (req: Request, what: string) => {
    if (!req.access!.can('automation.manage_rules')) throw new ForbiddenError(`Missing permission: automation.manage_rules (${what})`);
  };
  router.get(
    '/automation/rules',
    wrap(async (req, res) => {
      needView(req);
      await ready();
      const stats = (
        await pool.query(
          `SELECT r.key, r.enabled, r.interval_minutes, r.config, r.last_run_at, r.next_run_at, r.consecutive_failures,
                  count(x.id)::int AS run_count, count(x.id) FILTER (WHERE x.status = 'failed')::int AS failed_runs,
                  (SELECT status FROM automation_runs WHERE rule_key = r.key ORDER BY id DESC LIMIT 1) AS last_status,
                  (SELECT error FROM automation_runs WHERE rule_key = r.key AND status = 'failed' ORDER BY id DESC LIMIT 1) AS last_error,
                  (SELECT count(*)::int FROM automation_actions a WHERE a.rule_key = r.key) AS actions_total
           FROM automation_rules r LEFT JOIN automation_runs x ON x.rule_key = r.key GROUP BY r.key`
        )
      ).rows as Record<string, any>[];
      const rules = RULES.map((r) => {
        const st = stats.find((x) => x.key === r.key) ?? {};
        return {
          key: r.key, name: r.name, trigger: r.description, action: r.actions, human_in_loop: r.human_in_loop, watches: r.watches,
          defaults: r.defaults, enabled: st.enabled ?? true, interval_minutes: st.interval_minutes ?? r.interval_minutes,
          config: { ...r.defaults, ...(st.config ?? {}) }, last_run_at: st.last_run_at ?? null, next_run_at: st.next_run_at ?? null,
          consecutive_failures: st.consecutive_failures ?? 0, run_count: st.run_count ?? 0, failed_runs: st.failed_runs ?? 0,
          last_status: st.last_status ?? null, last_error: st.last_error ?? null, actions_total: st.actions_total ?? 0,
        };
      });
      const latest = (await pool.query(`SELECT max(finished_at) AS ran_at FROM automation_runs WHERE status = 'succeeded'`)).rows[0];
      const last24 = (await pool.query(`SELECT kind, count(*)::int AS n FROM automation_actions WHERE created_at > now() - interval '24 hours' GROUP BY kind`)).rows as { kind: string; n: number }[];
      const n = (k: string) => last24.find((r) => r.kind === k)?.n ?? 0;
      res.json({
        rules,
        ai_forbidden_actions: AI_FORBIDDEN_ACTIONS,
        scheduler: { running: engine.isRunning(), tick_seconds: engine.tickSeconds() },
        last_run: latest.ran_at ? { ran_at: latest.ran_at, notifications: n('notification'), tasks: n('task'), escalations: n('escalation') } : null,
      });
    })
  );
  router.patch(
    '/automation/rules/:key',
    wrap(async (req, res) => {
      needManageRules(req, 'change automation rules');
      await ready();
      const rule = RULE_BY_KEY.get(req.params.key);
      if (!rule) return res.status(404).json({ error: 'not_found', message: 'No such automation rule' });
      const body = req.body ?? {};
      const before = (await pool.query('SELECT enabled, interval_minutes, config FROM automation_rules WHERE key = $1', [rule.key])).rows[0];
      const next = { enabled: before.enabled as boolean, interval_minutes: before.interval_minutes as number, config: { ...rule.defaults, ...(before.config ?? {}) } as Record<string, unknown> };
      if ('enabled' in body) {
        if (typeof body.enabled !== 'boolean') throw new ValidationError('enabled must be true or false');
        next.enabled = body.enabled;
      }
      if ('interval_minutes' in body) {
        const m = Number(body.interval_minutes);
        if (!Number.isInteger(m) || m < 1 || m > 10080) throw new ValidationError('interval_minutes must be a whole number from 1 to 10080');
        next.interval_minutes = m;
      }
      if (body.config && typeof body.config === 'object') {
        for (const [k, v] of Object.entries(body.config as Record<string, unknown>)) {
          if (!(k in rule.defaults)) throw new ValidationError(`${k} is not a setting of ${rule.name}`);
          const d = rule.defaults[k];
          const ok = typeof d === 'number' ? typeof v === 'number' && Number.isFinite(v) && v >= 0 : typeof d === 'boolean' ? typeof v === 'boolean' : Array.isArray(d) ? Array.isArray(v) && v.every((x) => typeof x === 'string') : typeof v === typeof d;
          if (!ok) throw new ValidationError(`${k} must be ${Array.isArray(d) ? 'a list' : typeof d}`);
          next.config[k] = v;
        }
      }
      await pool.query('UPDATE automation_rules SET enabled = $2, interval_minutes = $3, config = $4, updated_at = now(), updated_by = $5 WHERE key = $1', [rule.key, next.enabled, next.interval_minutes, JSON.stringify(next.config), req.auth!.user.id]);
      await writeAudit(pool, actorOf(req), { action: 'automation.rule.update', entityType: 'automation_rule', entityId: rule.key, before, after: next });
      res.json({ key: rule.key, ...next });
    })
  );
  router.get(
    '/automation/runs',
    wrap(async (req, res) => {
      needView(req);
      const rule = typeof req.query.rule === 'string' ? req.query.rule : null;
      const status = typeof req.query.status === 'string' ? req.query.status : null;
      res.json(
        (
          await pool.query(
            `SELECT id::int AS id, rule_key, trigger, event, status, started_at, finished_at, actions_taken, actions, error, retry_count FROM automation_runs
             WHERE ($1::text IS NULL OR rule_key = $1) AND ($2::text IS NULL OR status = $2) ORDER BY id DESC LIMIT 100`,
            [rule, status]
          )
        ).rows
      );
    })
  );
  router.post(
    '/automation/run',
    wrap(async (req, res) => {
      needManageRules(req, 'run automation now');
      await ready();
      const key = typeof req.body?.rule === 'string' ? req.body.rule : null;
      if (key && !RULE_BY_KEY.has(key)) return res.status(404).json({ error: 'not_found', message: 'No such automation rule' });
      const results = key ? [await engine.runRule(key, 'manual', { by: req.auth!.user.id })] : await engine.runAll('manual');
      const summary = { runs: results, actions_taken: results.reduce((s, r) => s + r.actions_taken, 0), failed: results.filter((r) => r.status === 'failed').length };
      await writeAudit(pool, actorOf(req), { action: 'automation.run', entityType: 'automation', entityId: key ?? 'all', after: summary });
      res.json(summary);
    })
  );
  router.post(
    '/automation/runs/:id/retry',
    wrap(async (req, res) => {
      needManageRules(req, 'retry an automation run');
      const run = (await pool.query('SELECT rule_key, status FROM automation_runs WHERE id = $1', [req.params.id])).rows[0];
      if (!run) return res.status(404).json({ error: 'not_found', message: 'No such run' });
      if (run.status !== 'failed') throw new ValidationError('Only a failed run can be retried');
      const result = await engine.runRule(run.rule_key, 'retry', { retry_of: Number(req.params.id), by: req.auth!.user.id });
      await writeAudit(pool, actorOf(req), { action: 'automation.retry', entityType: 'automation_run', entityId: String(req.params.id), after: result });
      res.json(result);
    })
  );

  // ---------------- WhatsApp gateway (architecture; no provider connected) ----------------
  const needManage = (req: Request) => {
    if (!req.access!.can('users.manage')) throw new ForbiddenError('Missing permission: users.manage (manage WhatsApp contacts)');
  };
  router.get(
    '/whatsapp/contacts',
    wrap(async (req, res) => {
      needManage(req);
      res.json(
        (
          await pool.query(
            `SELECT c.phone, c.user_id, c.verified, c.created_at, u.name, u.role, u.is_active FROM whatsapp_contacts c JOIN users u ON u.id = c.user_id ORDER BY u.name`
          )
        ).rows
      );
    })
  );
  router.post(
    '/whatsapp/contacts',
    wrap(async (req, res) => {
      needManage(req);
      const phone = normalizePhone(req.body?.phone);
      if (!phone) throw new ValidationError('Enter the phone number with country code, e.g. +60123456789');
      const user = (await pool.query('SELECT id FROM users WHERE id = $1', [req.body?.user_id])).rows[0];
      if (!user) throw new ValidationError('Choose an existing user');
      await pool.query(
        `INSERT INTO whatsapp_contacts (phone, user_id, verified, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (phone) DO UPDATE SET user_id = EXCLUDED.user_id, verified = EXCLUDED.verified`,
        [phone, user.id, Boolean(req.body?.verified), req.auth!.user.id]
      );
      await writeAudit(pool, actorOf(req), { action: 'whatsapp.contact.register', entityType: 'whatsapp_contact', entityId: phone, after: { user_id: user.id } });
      res.status(201).json({ phone, user_id: user.id });
    })
  );
  router.delete(
    '/whatsapp/contacts/:phone',
    wrap(async (req, res) => {
      needManage(req);
      const phone = normalizePhone(req.params.phone);
      const r = await pool.query('DELETE FROM whatsapp_contacts WHERE phone = $1', [phone]);
      if (!r.rowCount) return res.status(404).json({ error: 'not_found', message: 'Contact not registered' });
      await writeAudit(pool, actorOf(req), { action: 'whatsapp.contact.remove', entityType: 'whatsapp_contact', entityId: String(phone) });
      res.status(204).end();
    })
  );
  // Test harness for administrators: runs an inbound message through the real pipeline
  // (identity from the registry only). A provider webhook would call handleInbound the same way.
  router.post(
    '/whatsapp/simulate-inbound',
    wrap(async (req, res) => {
      needManage(req);
      res.json(await handleInbound(pool, req.body?.from, req.body?.text, NullProvider));
    })
  );
  router.get(
    '/whatsapp/messages',
    wrap(async (req, res) => {
      needManage(req);
      res.json((await pool.query('SELECT id, direction, phone, user_id, body, outcome, created_at FROM whatsapp_messages ORDER BY id DESC LIMIT 100')).rows);
    })
  );

  router.use(apiErrorHandler);
  return router;
}
