import express, { type NextFunction, type Request, type Response } from 'express';
import type { CoreDataSource } from '../db/config';
import { pendingMigrations } from '../db/migrate';
import type { Pool } from '../db/pool';
import { CoreRepository, NotFoundError, ValidationError } from './repository';
import type { CoreCollection } from './schema';

interface CoreRouterOptions {
  pool?: Pool;
  dataSource: CoreDataSource;
}

// Postgres error codes -> HTTP status + stable error name.
const PG_ERRORS: Record<string, [number, string]> = {
  '23503': [409, 'foreign_key_violation'],
  '23505': [409, 'unique_violation'],
  '23502': [400, 'not_null_violation'],
  '23514': [400, 'check_violation'],
  '22P02': [400, 'invalid_input'],
  '22007': [400, 'invalid_datetime'],
  '22008': [400, 'invalid_datetime'],
  '22003': [400, 'numeric_out_of_range'],
};

function sendError(res: Response, err: unknown) {
  if (err instanceof NotFoundError) return res.status(404).json({ error: 'not_found', message: err.message });
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: 'validation_error', message: err.message, details: err.details });
  }
  const pgErr = err as { code?: string; message?: string; detail?: string; constraint?: string };
  const mapped = pgErr.code && PG_ERRORS[pgErr.code];
  if (mapped) {
    return res.status(mapped[0]).json({
      error: mapped[1],
      message: pgErr.message,
      detail: pgErr.detail,
      constraint: pgErr.constraint,
    });
  }
  console.error('[core api]', err);
  return res.status(500).json({ error: 'internal_error', message: pgErr.message || 'Unexpected error' });
}

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, _next: NextFunction) =>
    fn(req, res).catch((err) => sendError(res, err));

const RESOURCES: { path: string; collection: CoreCollection; filters: string[] }[] = [
  { path: 'clients', collection: 'clients', filters: [] },
  { path: 'projects', collection: 'projects', filters: ['client_id'] },
  { path: 'work-packages', collection: 'workPackages', filters: ['project_id'] },
  { path: 'work-items', collection: 'workItems', filters: ['project_id', 'work_package_id'] },
];

/**
 * Core-chain API, mounted at /api. Without a database every route except
 * GET /core/status answers 503, and the app keeps using localStorage.
 */
export function createCoreRouter({ pool, dataSource }: CoreRouterOptions) {
  const router = express.Router();
  const repo = pool ? new CoreRepository(pool) : undefined;

  router.get(
    '/core/status',
    wrap(async (_req, res) => {
      if (!pool || !repo) {
        return res.json({ configured: false, connected: false, dataSource: 'local', pendingMigrations: [] });
      }
      try {
        const pending = await pendingMigrations(pool);
        const counts = pending.length ? undefined : await repo.counts();
        const ready = pending.length === 0;
        res.json({
          configured: true,
          connected: true,
          // The browser only switches to the database once the schema is current.
          dataSource: ready ? dataSource : 'local',
          pendingMigrations: pending,
          counts,
        });
      } catch (err) {
        // Connection details (user, host) stay in the server log, not the browser.
        console.error('[core api] database unreachable:', (err as Error).message);
        res.json({
          configured: true,
          connected: false,
          dataSource: 'local',
          pendingMigrations: [],
          error: 'database_unreachable',
        });
      }
    })
  );

  if (!repo) {
    // Only the core paths answer 503; other /api routes (AI, gateway, health) pass through.
    const corePaths = ['/core/*', ...RESOURCES.flatMap(({ path }) => [`/${path}`, `/${path}/*`])];
    router.all(corePaths, (_req, res) =>
      res.status(503).json({ error: 'database_not_configured', message: 'Set DATABASE_URL to enable' })
    );
    return router;
  }

  router.get('/core/snapshot', wrap(async (_req, res) => res.json(await repo.snapshot())));

  router.post(
    '/core/sync',
    wrap(async (req, res) => {
      const { upserts, deletes } = req.body ?? {};
      res.json(await repo.applyChanges({ upserts, deletes }));
    })
  );

  router.post(
    '/core/import',
    wrap(async (req, res) => {
      const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
      const result = await repo.importData(req.body ?? {}, { dryRun });
      res.status(result.ok ? 200 : 422).json(result);
    })
  );

  router.get('/clients/:id/tree', wrap(async (req, res) => res.json(await repo.clientTree(req.params.id))));

  for (const { path, collection, filters } of RESOURCES) {
    router.get(
      `/${path}`,
      wrap(async (req, res) => {
        const filter = Object.fromEntries(filters.map((f) => [f, req.query[f] as string | undefined]));
        res.json(await repo.list(collection, filter));
      })
    );
    router.post(`/${path}`, wrap(async (req, res) => res.status(201).json(await repo.create(collection, req.body ?? {}))));
    router.get(`/${path}/:id`, wrap(async (req, res) => res.json(await repo.get(collection, req.params.id))));
    router.patch(`/${path}/:id`, wrap(async (req, res) => res.json(await repo.update(collection, req.params.id, req.body ?? {}))));
    router.delete(
      `/${path}/:id`,
      wrap(async (req, res) => {
        await repo.remove(collection, req.params.id);
        res.status(204).end();
      })
    );
  }

  return router;
}
