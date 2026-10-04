import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { CoreDataSource } from '../db/config';
import { pendingMigrations } from '../db/migrate';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import type { CoreCollection } from './schema';
import { CoreService } from './service';

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
      res.json(await service.applyChanges(req.access!, { upserts, deletes }));
    })
  );

  router.post(
    '/core/import',
    wrap(async (req, res) => {
      const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
      const result = await service.importData(req.access!, req.body ?? {}, { dryRun });
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
      wrap(async (req, res) => res.status(201).json(await service.create(req.access!, collection, req.body ?? {})))
    );
    router.get(`/${path}/:id`, wrap(async (req, res) => res.json(await service.get(req.access!, collection, req.params.id))));
    router.patch(
      `/${path}/:id`,
      wrap(async (req, res) => res.json(await service.update(req.access!, collection, req.params.id, req.body ?? {})))
    );
    router.delete(
      `/${path}/:id`,
      wrap(async (req, res) => {
        await service.remove(req.access!, collection, req.params.id);
        res.status(204).end();
      })
    );
  }

  router.use(apiErrorHandler);
  return router;
}
