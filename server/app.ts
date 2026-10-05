import type { Express } from 'express';
import { attachUser, csrfGuard, requireUser } from './auth/middleware';
import { createAuthRouter, createUsersRouter } from './auth/routes';
import { AuthStore } from './auth/store';
import { createCoreRouter } from './core/routes';
import { createModuleRouter } from './modules/routes';
import { createOpsRouter } from './modules/opsRoutes';
import type { CoreDataSource } from './db/config';
import type { Pool } from './db/pool';

/**
 * Mounts authentication, user administration and the core-chain API, and puts the
 * existing AI / messaging routes behind sign-in. Must run before those routes are added.
 * Without a pool the app runs in demo mode: no sign-in, data in browser localStorage.
 */
export function mountSecureApi(app: Express, { pool, dataSource }: { pool?: Pool; dataSource: CoreDataSource }) {
  const store = pool ? new AuthStore(pool) : undefined;

  if (pool && store) {
    app.use('/api/auth', createAuthRouter({ pool, store }));
    app.use('/api/users', createUsersRouter({ pool, store }));

    // AI and messaging endpoints: signed-in users only, and any identity the browser puts
    // in the body (role, name) is replaced with the session's user.
    app.use(['/api/ai', '/api/gateway'], csrfGuard, attachUser(store), requireUser, (req, _res, next) => {
      const { id, name, role } = req.auth!.user;
      if (req.body && typeof req.body === 'object') {
        Object.assign(req.body, { userRole: role, role, userName: name, reportedBy: name });
        if (req.body.user && typeof req.body.user === 'object') req.body.user = { ...req.body.user, id, name, role };
        // The legacy gateway simulator identifies senders from a contact list; never take that
        // list from the browser. Real sender identity comes from /api/whatsapp (server registry).
        if (req.baseUrl === '/api/gateway' || req.originalUrl.startsWith('/api/gateway')) req.body.contacts = [];
      }
      next();
    });
  } else {
    app.get('/api/auth/session', (_req, res) => res.json({ authEnabled: false, user: null }));
  }

  app.use('/api', createCoreRouter({ pool, store, dataSource }));
  // Phase 3 modules (drawings, workflow, production, delivery/site, commercial).
  if (pool && store) app.use('/api', createModuleRouter({ pool, store }));
  // Phase 4: notifications, automation, WhatsApp gateway.
  if (pool && store) app.use('/api', createOpsRouter({ pool, store }));
  return { store };
}
