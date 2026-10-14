import express, { type NextFunction, type Request, type Response } from 'express';
import type { UserRole } from '../../src/types';
import { withTransaction, type Pool } from '../db/pool';
import { reevaluateRoutes } from '../modules/approvalRouting';
import { passwordProblem } from './password';
import { isRole, permissionsFor } from './permissions';
import {
  AttemptLimiter,
  attachUser,
  csrfGuard,
  isProduction,
  requireUser,
  sessionCookieOptions,
} from './middleware';
import { CODE_VALID_MINUTES, SESSION_COOKIE, type AuthStore, type AuthUser } from './store';
import { apiErrorHandler } from '../http/errors';
import { writeAudit, type AuditActor } from '../audit';

const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

const GENERIC_LOGIN_ERROR = { error: 'invalid_credentials', message: 'Email or password is incorrect' };

async function sessionPayload(store: AuthStore, user: AuthUser) {
  const pub = await store.toPublic(user);
  return { ...pub, permissions: [...permissionsFor(user.role)] };
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/** /api/auth: login, logout, current session. */
export function createAuthRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  const limiter = new AttemptLimiter();
  router.use(csrfGuard, attachUser(store));

  router.get(
    '/session',
    wrap(async (req, res) => {
      res.json({ authEnabled: true, user: req.auth ? await sessionPayload(store, req.auth.user) : null });
    })
  );

  router.post(
    '/login',
    wrap(async (req, res) => {
      const { email, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
        return res.status(400).json({ error: 'validation_error', message: 'Email and password are required' });
      }
      const key = `${req.ip}|${email.trim().toLowerCase()}`;
      if (limiter.blocked(key)) {
        return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Try again later.' });
      }

      // The database verifies the password-derived key and creates the session (migration 031).
      const result = await store.login(email, password, { userAgent: req.headers['user-agent'], ip: req.ip });
      if (result.status === 'locked') {
        limiter.fail(key);
        await writeAudit(pool, { ip: req.ip }, { action: 'login.locked', entityType: 'user', details: email.trim().toLowerCase() });
        return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Try again later.' });
      }
      if (result.status === 'invalid') {
        limiter.fail(key);
        await writeAudit(pool, { ip: req.ip }, { action: 'login.failed', entityType: 'user', details: email.trim().toLowerCase() });
        return res.status(401).json(GENERIC_LOGIN_ERROR);
      }
      if (result.status === 'inactive') {
        limiter.fail(key);
        await writeAudit(pool, { ip: req.ip }, { action: 'login.refused_inactive', entityType: 'user', entityId: result.userId });
        return res.status(403).json({ error: 'account_disabled', message: 'This account has been deactivated' });
      }
      const user = result.user;
      if (user.is_dev_seed && isProduction()) {
        await store.revokeSession(result.token);
        console.warn(`[auth] refused development seed account ${user.email} in production`);
        return res.status(403).json({ error: 'dev_account_disabled', message: 'Development accounts cannot sign in here' });
      }

      limiter.reset(key);
      res.cookie(SESSION_COOKIE, result.token, sessionCookieOptions(result.expiresAt));
      await writeAudit(pool, { id: user.id, name: user.name, role: user.role, ip: req.ip }, { action: 'login', entityType: 'user', entityId: user.id });
      res.json({ authEnabled: true, user: await sessionPayload(store, user) });
    })
  );

  // Sets a new password with an activation / reset code (Batch 12B). No session needed: the code
  // is the evidence, checked in the database (this email's, unused, unexpired, single use). The
  // holder then signs in with the new password.
  router.post(
    '/activate',
    wrap(async (req, res) => {
      const { email, code, password } = req.body ?? {};
      if (typeof email !== 'string' || typeof code !== 'string' || !email.trim() || !code.trim()) {
        return res.status(400).json({ error: 'validation_error', message: 'Email and code are required' });
      }
      const problem = passwordProblem(password);
      if (problem) return res.status(400).json({ error: 'validation_error', message: problem });
      const key = `activate|${req.ip}|${email.trim().toLowerCase()}`;
      if (limiter.blocked(key)) return res.status(429).json({ error: 'too_many_attempts', message: 'Too many attempts. Try again later.' });
      const status = await store.activate(email, code.trim(), password);
      if (status === 'ok') {
        limiter.reset(key);
        return res.json({ ok: true });
      }
      limiter.fail(key);
      await writeAudit(pool, { ip: req.ip }, { action: `auth.activation_${status}`, entityType: 'user', details: email.trim().toLowerCase() });
      if (status === 'expired') return res.status(400).json({ error: 'code_expired', message: 'This code has expired. Ask for a new one.' });
      if (status === 'inactive') return res.status(403).json({ error: 'account_disabled', message: 'This account has been deactivated' });
      return res.status(400).json({ error: 'invalid_code', message: 'The email and code do not match a valid, unused code' });
    })
  );

  router.post(
    '/logout',
    wrap(async (req, res) => {
      if (req.auth) {
        await store.revokeSession(req.auth.token);
        const u = req.auth.user;
        await writeAudit(pool, { id: u.id, name: u.name, role: u.role, ip: req.ip }, { action: 'logout', entityType: 'user', entityId: u.id });
      }
      res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
      res.status(204).end();
    })
  );

  router.use(apiErrorHandler);
  return router;
}

const NO_ADMIN_PASSWORDS = { error: 'validation_error', message: 'Passwords are set by the account holder with an activation code, not by an administrator' };

const USER_FIELDS = ['name', 'email', 'role', 'is_active', 'client_id', 'contractor_id', 'phone', 'department', 'title'] as const;

/** /api/users: account administration (users.view / users.manage). */
export function createUsersRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use(csrfGuard, attachUser(store), requireUser);

  const can = (req: Request, perm: 'users.view' | 'users.manage') => permissionsFor(req.auth!.user.role).has(perm);
  const forbid = (res: Response, message: string) => res.status(403).json({ error: 'forbidden', message });

  // Only an Owner manages Owner and Admin accounts: an Admin can neither create, change, reset
  // nor assign an Owner or another Admin, nor grant either role (the database enforces the same).
  const MANAGED_BY_OWNER = new Set(['Owner / CEO', 'Admin']);
  const ownerGuard = (actor: AuthUser, target: AuthUser | undefined, role: unknown) =>
    actor.role === 'Owner / CEO' || (!MANAGED_BY_OWNER.has(String(target?.role)) && !MANAGED_BY_OWNER.has(String(role)));

  // A Contractor account belongs to a subcontractor in the shared register (migration 032).
  const contractorProblem = async (role: unknown, contractorId: unknown) => {
    if (role !== 'Contractor') return undefined;
    if (typeof contractorId !== 'string' || !contractorId.trim()) return 'A Contractor account needs a subcontractor (contractor_id)';
    const c = (await pool.query('SELECT is_active FROM contractors WHERE id = $1', [contractorId])).rows[0];
    if (!c) return `Unknown subcontractor ${contractorId}: add it to the subcontractor register first`;
    if (!c.is_active) return `Subcontractor ${contractorId} is inactive`;
    return undefined;
  };

  router.get(
    '/',
    wrap(async (req, res) => {
      if (!can(req, 'users.view')) return forbid(res, 'Missing permission: users.view');
      res.json(await store.listUsers());
    })
  );

  router.post(
    '/',
    wrap(async (req, res) => {
      if (!can(req, 'users.manage')) return forbid(res, 'Missing permission: users.manage');
      const body = req.body ?? {};
      if (!isRole(body.role)) return res.status(400).json({ error: 'validation_error', message: 'Unknown role' });
      if (typeof body.name !== 'string' || typeof body.email !== 'string' || !body.name.trim() || !body.email.includes('@')) {
        return res.status(400).json({ error: 'validation_error', message: 'Name and a valid email are required' });
      }
      if ('password' in body) return res.status(400).json(NO_ADMIN_PASSWORDS);
      if (!ownerGuard(req.auth!.user, undefined, body.role)) return forbid(res, 'Only an Owner can create Owner or Admin accounts');
      const linkProblem = await contractorProblem(body.role, body.contractor_id);
      if (linkProblem) return res.status(400).json({ error: 'validation_error', message: linkProblem });
      // The account starts without a password; its holder sets one with the activation code,
      // which is shown once to the creator here and never stored or logged.
      let activation: { code: string; expires_at: string } | undefined;
      const created = await store.withIdentity(req.auth!.token, async (db) => {
        const u = await store.createUser(db, {
        name: body.name,
        email: body.email,
        role: body.role as UserRole,
        client_id: body.client_id ?? null,
        contractor_id: body.contractor_id ?? null,
        phone: body.phone ?? null,
        department: body.department ?? null,
        title: body.title ?? null,
        });
        await writeAudit(db, actorOf(req), { action: 'user.create', entityType: 'user', entityId: u.id, after: { email: u.email, role: u.role } });
        activation = await store.issueCode(db, u.id, 'activation');
        return u;
      });
      res.status(201).json({ ...(await store.toPublic(created)), activation });
    })
  );

  router.patch(
    '/:id',
    wrap(async (req, res) => {
      if (!can(req, 'users.manage')) return forbid(res, 'Missing permission: users.manage');
      const actor = req.auth!.user;
      const target = await store.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: 'not_found', message: 'User not found' });
      const body = req.body ?? {};
      if ('role' in body && !isRole(body.role)) return res.status(400).json({ error: 'validation_error', message: 'Unknown role' });
      if (!ownerGuard(actor, target, body.role)) return forbid(res, 'Only an Owner can change Owner or Admin accounts');
      if ('is_active' in body && typeof body.is_active !== 'boolean') return res.status(400).json({ error: 'validation_error', message: 'is_active must be true or false' });
      if (target.id === actor.id && ('role' in body || body.is_active === false)) {
        return forbid(res, 'You cannot change your own role or deactivate yourself');
      }
      if ('password' in body) return res.status(400).json(NO_ADMIN_PASSWORDS);
      if ('role' in body || 'contractor_id' in body) {
        const linkProblem = await contractorProblem(body.role ?? target.role, 'contractor_id' in body ? body.contractor_id : target.contractor_id);
        if (linkProblem) return res.status(400).json({ error: 'validation_error', message: linkProblem });
      }
      const patch: Record<string, unknown> = {};
      for (const f of USER_FIELDS) if (f in body) patch[f] = body[f];
      const auditPatch = patch;
      // The change and its audit record commit together, under the verified identity.
      const updated = await store.withIdentity(req.auth!.token, async (db) => {
        const u = await store.updateUser(db, target.id, patch);
        await writeAudit(db, actorOf(req), {
        action: patch.is_active === false ? 'user.deactivate' : patch.role ? 'user.role_change' : 'user.update',
        entityType: 'user',
        entityId: target.id,
        before: Object.fromEntries(Object.keys(auditPatch).map((k) => [k, (target as unknown as Record<string, unknown>)[k]])),
          after: auditPatch,
        });
        return u;
      });
      // A user who is deactivated or changes role may no longer be the right approver: re-route.
      if ('role' in patch || 'is_active' in patch) await withTransaction(pool, (db) => reevaluateRoutes(db, actorOf(req), {}, `user ${target.id} ${patch.is_active === false ? 'deactivated' : 'changed'}`));
      res.json(await store.toPublic(updated!));
    })
  );

  // A reset code for another account (Batch 12B): its password and sessions end now, and it signs
  // in again only after its holder sets a new password with the code. The Owner for anyone else;
  // an Admin for accounts that are neither Owner nor Admin (the database enforces the same and
  // records the event). Never changes a role or authority. The code is shown once.
  router.post(
    '/:id/reset-code',
    wrap(async (req, res) => {
      if (!can(req, 'users.manage')) return forbid(res, 'Missing permission: users.manage');
      const actor = req.auth!.user;
      const target = await store.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: 'not_found', message: 'User not found' });
      if (!ownerGuard(actor, target, undefined)) return forbid(res, 'Only an Owner can reset Owner or Admin accounts');
      if (target.id === actor.id) return forbid(res, 'You cannot reset your own account');
      if (!target.is_active) return res.status(409).json({ error: 'conflict', message: 'The account is deactivated: reactivate it first' });
      const code = await store.withIdentity(req.auth!.token, (db) => store.issueCode(db, target.id, 'reset'));
      res.json({ user_id: target.id, ...code, valid_minutes: CODE_VALID_MINUTES.reset });
    })
  );

  router.put(
    '/:id/projects',
    wrap(async (req, res) => {
      if (!can(req, 'users.manage')) return forbid(res, 'Missing permission: users.manage');
      const target = await store.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: 'not_found', message: 'User not found' });
      if (!ownerGuard(req.auth!.user, target, undefined)) return forbid(res, 'Only an Owner can change Owner or Admin accounts');
      const ids = req.body?.project_ids;
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
        return res.status(400).json({ error: 'validation_error', message: 'project_ids must be a list of ids' });
      }
      const before = await store.assignedProjectIds(target.id);
      await store.withIdentity(req.auth!.token, async (db) => {
        await store.setAssignments(db, target.id, ids);
        await writeAudit(db, actorOf(req), { action: 'user.assignments', entityType: 'user', entityId: target.id, before, after: ids });
      });
      // Project scope decides who can be routed approvals: re-route.
      await withTransaction(pool, (db) => reevaluateRoutes(db, actorOf(req), {}, `user ${target.id} project assignments changed`));
      res.json(await store.toPublic(target));
    })
  );

  router.use(apiErrorHandler);
  return router;
}
