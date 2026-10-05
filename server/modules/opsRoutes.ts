import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { ValidationError } from '../core/repository';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { AI_FORBIDDEN_ACTIONS, AUTOMATION_RULES, runAutomation, type AutomationResult } from './automation';
import { NullProvider, handleInbound, normalizePhone } from './whatsapp';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

/** Runs the automation sweep at most once per `minIntervalMs`, never twice at the same time. */
export function automationScheduler(pool: Pool, minIntervalMs = 30_000) {
  let last = 0;
  let running: Promise<AutomationResult> | null = null;
  let lastResult: AutomationResult | null = null;
  const run = (force = false) => {
    if (running) return running;
    if (!force && Date.now() - last < minIntervalMs && lastResult) return Promise.resolve(lastResult);
    running = runAutomation(pool)
      .then((r) => {
        lastResult = r;
        last = Date.now();
        return r;
      })
      .finally(() => {
        running = null;
      });
    return running;
  };
  return { run, last: () => lastResult };
}

/**
 * Notifications (each user's own), automation rules and the WhatsApp gateway, mounted at
 * /api. All need a signed-in, active user.
 */
export function createOpsRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  const scheduler = automationScheduler(pool);
  // A provider webhook has no user session; it would authenticate by the provider's signature.
  // No provider is connected, so it is refused.
  router.post('/whatsapp/webhook', (_req, res) =>
    res.status(501).json({ error: 'not_configured', message: 'No WhatsApp provider is connected. Inbound webhooks are disabled.' })
  );
  router.use(['/notifications', '/automation', '/whatsapp'], csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  // ---------------- notifications: only ever the signed-in user's own ----------------
  router.get(
    '/notifications',
    wrap(async (req, res) => {
      await scheduler.run().catch(() => undefined); // a failed sweep never hides existing notifications
      const rows = (
        await pool.query(
          `SELECT id, title, message, type, priority, project_id, link_tab, entity_type, entity_id, is_read, read_at, created_at
           FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
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

  // ---------------- automation ----------------
  router.get(
    '/automation/rules',
    wrap(async (req, res) => {
      if (!req.access!.can('automation.view')) throw new ForbiddenError('Missing permission: automation.view');
      res.json({ rules: AUTOMATION_RULES, ai_forbidden_actions: AI_FORBIDDEN_ACTIONS, last_run: scheduler.last() });
    })
  );
  router.post(
    '/automation/run',
    wrap(async (req, res) => {
      if (!req.access!.can('automation.manage_rules')) throw new ForbiddenError('Missing permission: automation.manage_rules (run automation now)');
      const result = await scheduler.run(true);
      await writeAudit(pool, actorOf(req), { action: 'automation.run', entityType: 'automation', entityId: 'sweep', after: result });
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
