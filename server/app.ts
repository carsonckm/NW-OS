import type { Express } from 'express';
import { attachUser, csrfGuard, requireUser } from './auth/middleware';
import { createAuthRouter, createUsersRouter } from './auth/routes';
import { AuthStore } from './auth/store';
import { createCoreRouter } from './core/routes';
import { createModuleRouter } from './modules/routes';
import { createOpsRouter } from './modules/opsRoutes';
import { createAuthorityRouter } from './modules/authorityRoutes';
import { AutomationEngine } from './automation/engine';
import { withTransaction } from './db/pool';
import { reevaluateRoutes } from './modules/approvalRouting';
import { createApprovalRoutingRouter } from './modules/approvalRoutingRoutes';
import { createDelegationRouter } from './modules/delegationRoutes';
import { createAIRouter } from './ai/routes';
import { createLegacyAIRouter } from './ai/legacy';
import { createLegacyRulesRouter } from './ai/legacyRules';
import type { CoreDataSource } from './db/config';
import type { Pool } from './db/pool';
import { setPrivilegeDenialMonitor } from './http/errors';
import { writeAudit } from './audit';

/**
 * Mounts authentication, user administration and the core-chain API, and puts the
 * existing AI / messaging routes behind sign-in. Must run before those routes are added.
 * Without a pool the app runs in demo mode: no sign-in, data in browser localStorage.
 */
export function mountSecureApi(app: Express, { pool, dataSource }: { pool?: Pool; dataSource: CoreDataSource }) {
  const store = pool ? new AuthStore(pool) : undefined;
  // Phase 6 Batch 10: a request the database refuses for lack of privilege is a security event.
  if (pool) {
    setPrivilegeDenialMonitor(app, async (d) => {
      console.error(`[security] database privilege denied: ${d.method} ${d.path} (${d.user?.role ?? 'no user'})`);
      await writeAudit(pool, { id: d.user?.id ?? null, name: d.user?.name ?? null, role: d.user?.role ?? null, ip: d.ip }, {
        action: 'security.database_privilege_denied',
        entityType: 'database',
        details: `${d.method} ${d.path}: ${d.message}`,
        after: { sqlstate: '42501' },
      });
    });
  }

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

  // Phase 6: delegated authority (mounted first so /projects/:id/sensitivity is its own route).
  if (pool && store) app.use('/api', createAuthorityRouter({ pool, store }));
  if (pool && store) app.use('/api', createApprovalRoutingRouter({ pool, store }));
  // Phase 6 Batch 5: Owner dependency and delegation recommendations.
  if (pool && store) app.use('/api', createDelegationRouter({ pool, store }));
  // Phase 6 Batch 7: the AI operating layer (gateway, context engine, versioned tasks).
  if (pool && store) app.use('/api', createAIRouter({ pool, store }));
  // The pre-Phase 6 AI screens' routes: in database mode answered through the AI gateway from the
  // user's own records (legacy.ts); otherwise (demo mode, the WhatsApp simulator) by deterministic
  // rules that never call a model (legacyRules.ts). Nothing else talks to a model provider.
  if (pool && store) app.use('/api', createLegacyAIRouter({ pool, store }));
  app.use(createLegacyRulesRouter());
  app.use('/api', createCoreRouter({ pool, store, dataSource }));
  // Phase 3 modules (drawings, workflow, production, delivery/site, commercial).
  if (pool && store) app.use('/api', createModuleRouter({ pool, store }));
  // Phase 4: notifications, automation, WhatsApp gateway.
  if (pool && store) {
    const engine = new AutomationEngine(pool);
    app.use('/api', createOpsRouter({ pool, store, engine }));
    // The scheduler runs on the server, whether or not anyone has the app open. Tests drive
    // the engine directly instead; AUTOMATION_SCHEDULER=off disables it (e.g. read replicas).
    if (process.env.AUTOMATION_SCHEDULER !== 'off' && !process.env.VITEST && process.env.NODE_ENV !== 'test') {
      void engine.start(Number(process.env.AUTOMATION_TICK_MS) || 30_000).catch((err) => console.error('automation scheduler failed to start:', err));
      // Phase 6: every pending approval gets its route (records imported or created before
      // routing existed), and routes follow authority changed while the server was down.
      void withTransaction(pool, (db) => reevaluateRoutes(db, { name: 'NW OS approval routing' }, {}, 'server start'))
        .then((r) => console.log(`approval routing: ${r.checked} pending, ${r.created} routed, ${r.rerouted} re-routed, ${r.closed} closed`))
        .catch((err) => console.error('approval routing pass failed:', err));
    }
  }
  return { store };
}
