import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { CoreDataSource } from '../db/config';
import { pendingMigrations } from '../db/migrate';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import type { CoreCollection } from './schema';
import { CoreService } from './service';
import { DataService } from '../modules/service';
import { ValidationError } from './repository';
import { COLLECTION_ORDER } from './schema';

const CORE_COLLECTIONS = new Set<string>(COLLECTION_ORDER);

interface CoreRouterOptions {
  pool?: Pool;
  store?: AuthStore;
  dataSource: CoreDataSource;
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const RESOURCES: { path: string; collection: CoreCollection; filters: string[] }[] = [
  { path: 'clients', collection: 'clients', filters: [] },
  { path: 'projects', collection: 'projects', filters: ['client_id'] },
  { path: 'work-packages', collection: 'workPackages', filters: ['project_id'] },
  { path: 'work-items', collection: 'workItems', filters: ['project_id', 'work_package_id'] },
];

/**
 * Core-chain API, mounted at /api. With a database every route except
 * GET /core/status needs a signed-in, active user and is checked against that user's
 * permissions and project scope. Without a database every core route answers 503 and
 * the app keeps using localStorage.
 */
export function createCoreRouter({ pool, store, dataSource }: CoreRouterOptions) {
  const router = express.Router();
  const corePaths = ['/core/*', ...RESOURCES.flatMap(({ path }) => [`/${path}`, `/${path}/*`])];

  if (!pool || !store) {
    router.get('/core/status', (_req, res) =>
      res.json({ configured: false, connected: false, dataSource: 'local', authEnabled: false, pendingMigrations: [] })
    );
    // Only the core paths answer 503; other /api routes (AI, gateway, health) pass through.
    router.all(corePaths, (_req, res) =>
      res.status(503).json({ error: 'database_not_configured', message: 'Set DATABASE_URL to enable' })
    );
    return router;
  }

  const service = CoreService.forPool(pool);
  // Writes go through DataService: the change, the Phase 3 rules and the audit row run in
  // one transaction, so a rolled-back change leaves no audit entry and vice versa.
  const data = new DataService(pool);
  // The /core/* batch endpoints only ever touch the four core collections.
  const coreOnly = <T,>(batch: Record<string, T> | undefined) => {
    if (!batch) return undefined;
    const unknown = Object.keys(batch).filter((k) => !CORE_COLLECTIONS.has(k));
    if (unknown.length) throw new ValidationError(`Unknown collection: ${unknown.join(', ')}`);
    return batch;
  };
  const actor = (req: Request) => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });
  let schemaReady = false;
  const checkSchema = async () => {
    if (!schemaReady) schemaReady = (await pendingMigrations(pool)).length === 0;
    return schemaReady;
  };

  router.get(
    '/core/status',
    attachUser(store),
    wrap(async (req, res) => {
      try {
        const pending = await pendingMigrations(pool);
        const ready = pending.length === 0;
        res.json({
          configured: true,
          connected: true,
          authEnabled: true,
          // The browser only switches to the database once the schema is current.
          dataSource: ready ? dataSource : 'local',
          pendingMigrations: pending,
          // Only signed-in users learn anything about the data itself.
          ...(ready && req.auth ? { databaseEmpty: await service.isEmpty() } : {}),
        });
      } catch (err) {
        // Connection details (user, host) stay in the server log, not the browser.
        console.error('[core api] database unreachable:', (err as Error).message);
        res.json({
          configured: true,
          connected: false,
          authEnabled: true,
          dataSource: 'local',
          pendingMigrations: [],
          error: 'database_unreachable',
        });
      }
    })
  );

  // Everything else: schema current, valid session, active user, then per-route checks.
  const requireSchema = (_req: Request, res: Response, next: NextFunction) => {
    checkSchema()
      .then((ready) =>
        ready ? next() : res.status(503).json({ error: 'migrations_pending', message: 'Run npm run db:migrate' })
      )
      .catch(next);
  };
  router.use(corePaths, requireSchema, csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  router.get('/core/snapshot', wrap(async (req, res) => res.json(await service.snapshot(req.access!))));

  router.post(
    '/core/sync',
    wrap(async (req, res) => {
      const { upserts, deletes } = req.body ?? {};
      res.json(await data.sync(req.access!, { upserts: coreOnly(upserts), deletes: coreOnly(deletes) }, actor(req)));
    })
  );

  router.post(
    '/core/import',
    wrap(async (req, res) => {
      const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
      const result = await data.importData(req.access!, coreOnly(req.body) ?? {}, { dryRun }, actor(req));
      res.status(result.ok ? 200 : 422).json(result);
    })
  );

  router.get('/clients/:id/tree', wrap(async (req, res) => res.json(await service.clientTree(req.access!, req.params.id))));

  for (const { path, collection, filters } of RESOURCES) {
    router.get(
      `/${path}`,
      wrap(async (req, res) => {
        const filter = Object.fromEntries(filters.map((f) => [f, req.query[f] as string | undefined]));
        res.json(await service.list(req.access!, collection, filter));
      })
    );
    router.post(
      `/${path}`,
      wrap(async (req, res) => {
        res.status(201).json(await data.coreCreate(req.access!, collection, req.body ?? {}, actor(req)));
      })
    );
    router.get(`/${path}/:id`, wrap(async (req, res) => res.json(await service.get(req.access!, collection, req.params.id))));
    router.patch(
      `/${path}/:id`,
      wrap(async (req, res) => {
        res.json(await data.coreUpdate(req.access!, collection, req.params.id, req.body ?? {}, actor(req)));
      })
    );
    router.delete(
      `/${path}/:id`,
      wrap(async (req, res) => {
        await data.coreRemove(req.access!, collection, req.params.id, actor(req));
        res.status(204).end();
      })
    );
  }

  router.use(apiErrorHandler);
  return router;
}
