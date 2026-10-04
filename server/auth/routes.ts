import express, { type NextFunction, type Request, type Response } from 'express';
import type { UserRole } from '../../src/types';
import type { Pool } from '../db/pool';
import { dummyPasswordHash, passwordProblem, verifyPassword } from './password';
import { isRole, permissionsFor } from './permissions';
import {
  AttemptLimiter,
  attachUser,
  csrfGuard,
  isProduction,
  requireUser,
  sessionCookieOptions,
} from './middleware';
import { SESSION_COOKIE, type AuthStore, type AuthUser } from './store';
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

      const user = await store.findByEmailWithHash(email);
      const ok = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
      if (!user || !ok) {
        limiter.fail(key);
        await writeAudit(pool, { ip: req.ip }, { action: 'login.failed', entityType: 'user', entityId: user?.id ?? null, details: email.trim().toLowerCase() });
        return res.status(401).json(GENERIC_LOGIN_ERROR);
      }
      if (!user.is_active) {
        limiter.fail(key);
        await writeAudit(pool, { ip: req.ip }, { action: 'login.refused_inactive', entityType: 'user', entityId: user.id });
        return res.status(403).json({ error: 'account_disabled', message: 'This account has been deactivated' });
      }
      if (user.is_dev_seed && isProduction()) {
        console.warn(`[auth] refused development seed account ${user.email} in production`);
        return res.status(403).json({ error: 'dev_account_disabled', message: 'Development accounts cannot sign in here' });
      }

      limiter.reset(key);
      const { password_hash: _ignored, ...safeUser } = user;
      const session = await store.createSession(user.id, { userAgent: req.headers['user-agent'], ip: req.ip });
      await store.recordLogin(user.id);
      res.cookie(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
      await writeAudit(pool, { id: user.id, name: user.name, role: user.role, ip: req.ip }, { action: 'login', entityType: 'user', entityId: user.id });
      res.json({ authEnabled: true, user: await sessionPayload(store, safeUser) });
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

const USER_FIELDS = ['name', 'email', 'role', 'is_active', 'client_id', 'contractor_id', 'phone', 'department', 'title'] as const;

/** /api/users: account administration (users.view / users.manage). */
export function createUsersRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use(csrfGuard, attachUser(store), requireUser);

  const can = (req: Request, perm: 'users.view' | 'users.manage') => permissionsFor(req.auth!.user.role).has(perm);
  const forbid = (res: Response, message: string) => res.status(403).json({ error: 'forbidden', message });

  // Only an Owner may create, change or grant the Owner role (no self-promotion by Admins).
  const ownerGuard = (actor: AuthUser, target: AuthUser | undefined, role: unknown) =>
    actor.role === 'Owner / CEO' || (target?.role !== 'Owner / CEO' && role !== 'Owner / CEO');

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
      const problem = passwordProblem(body.password);
      if (problem) return res.status(400).json({ error: 'validation_error', message: problem });
      if (!ownerGuard(req.auth!.user, undefined, body.role)) return forbid(res, 'Only an Owner can create Owner accounts');
      const created = await store.createUser({
        name: body.name,
        email: body.email,
        role: body.role as UserRole,
        password: body.password,
        client_id: body.client_id ?? null,
        contractor_id: body.contractor_id ?? null,
        phone: body.phone ?? null,
        department: body.department ?? null,
        title: body.title ?? null,
      });
      await writeAudit(pool, actorOf(req), { action: 'user.create', entityType: 'user', entityId: created.id, after: { email: created.email, role: created.role } });
      res.status(201).json(await store.toPublic(created));
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
      if (!ownerGuard(actor, target, body.role)) return forbid(res, 'Only an Owner can change Owner accounts');
      if (target.id === actor.id && ('role' in body || body.is_active === false)) {
        return forbid(res, 'You cannot change your own role or deactivate yourself');
      }
      if ('password' in body) {
        const problem = passwordProblem(body.password);
        if (problem) return res.status(400).json({ error: 'validation_error', message: problem });
      }
      const patch: Record<string, unknown> = {};
      for (const f of USER_FIELDS) if (f in body) patch[f] = body[f];
      if (body.password) patch.password = body.password;
      const updated = await store.updateUser(target.id, patch);
      const { password: _pw, ...auditPatch } = patch;
      await writeAudit(pool, actorOf(req), {
        action: patch.is_active === false ? 'user.deactivate' : patch.role ? 'user.role_change' : 'user.update',
        entityType: 'user',
        entityId: target.id,
        before: Object.fromEntries(Object.keys(auditPatch).map((k) => [k, (target as unknown as Record<string, unknown>)[k]])),
        after: { ...auditPatch, ...(patch.password ? { password: '(changed)' } : {}) },
      });
      res.json(await store.toPublic(updated!));
    })
  );

  router.put(
    '/:id/projects',
    wrap(async (req, res) => {
      if (!can(req, 'users.manage')) return forbid(res, 'Missing permission: users.manage');
      const target = await store.getUser(req.params.id);
      if (!target) return res.status(404).json({ error: 'not_found', message: 'User not found' });
      if (!ownerGuard(req.auth!.user, target, undefined)) return forbid(res, 'Only an Owner can change Owner accounts');
      const ids = req.body?.project_ids;
      if (!Array.isArray(ids) || !ids.every((x) => typeof x === 'string')) {
        return res.status(400).json({ error: 'validation_error', message: 'project_ids must be a list of ids' });
      }
      const before = await store.assignedProjectIds(target.id);
      await store.setAssignments(target.id, ids);
      await writeAudit(pool, actorOf(req), { action: 'user.assignments', entityType: 'user', entityId: target.id, before, after: ids });
      res.json(await store.toPublic(target));
    })
  );

  router.use(apiErrorHandler);
  return router;
}
