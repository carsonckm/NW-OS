import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import { ValidationError } from '../core/repository';
import { pendingMigrations } from '../db/migrate';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { addClientRevision } from './hooks/drawings';
import { checkTransition } from './hooks/variations';
import { MODULES } from './registry';
import { contractSummary, profitability } from './reports';
import { findRecord } from './store';
import { DataService } from './service';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const actorOf = (req: Request): AuditActor => ({
  id: req.auth!.user.id,
  name: req.auth!.user.name,
  role: req.auth!.user.role,
  ip: req.ip,
});

/**
 * Phase 3 module API, mounted at /api. Every route needs a signed-in, active user
 * (Phase 2 session), then checks permissions, project scope and the module's rules.
 */
export function createModuleRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  const service = new DataService(pool);

  let schemaReady = false;
  const requireSchema = (_req: Request, res: Response, next: NextFunction) => {
    if (schemaReady) return next();
    pendingMigrations(pool)
      .then((pending) => {
        schemaReady = pending.length === 0;
        if (schemaReady) next();
        else res.status(503).json({ error: 'migrations_pending', message: 'Run npm run db:migrate' });
      })
      .catch(next);
  };

  const paths = [
    '/data/*',
    '/audit-logs',
    '/projects/:id/contract-summary',
    '/projects/:id/profitability',
    ...MODULES.flatMap((m) => [`/${m.path}`, `/${m.path}/*`]),
  ];
  router.use(paths, requireSchema, csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  // ---------------- unified data API used by the app's sync layer ----------------
  router.get('/data/snapshot', wrap(async (req, res) => res.json(await service.snapshot(req.access!))));

  router.post(
    '/data/sync',
    wrap(async (req, res) => {
      const { upserts, deletes } = req.body ?? {};
      res.json(await service.sync(req.access!, { upserts, deletes }, actorOf(req)));
    })
  );

  router.post(
    '/data/import',
    wrap(async (req, res) => {
      const dryRun = req.query.dryRun === 'true' || req.query.dryRun === '1';
      const result = await service.importData(req.access!, req.body ?? {}, { dryRun }, actorOf(req));
      res.status(result.ok ? 200 : 422).json(result);
    })
  );

  router.get(
    '/data/status',
    wrap(async (_req, res) => res.json({ databaseEmpty: await service.isEmpty() }))
  );

  // ---------------- domain actions ----------------
  // New client drawing revision: never overwrites, supersedes the previous current one.
  router.post(
    '/drawings/:id/revisions',
    wrap(async (req, res) => {
      const def = service.module('drawings');
      const result = await service.transact(req.access!, actorOf(req), async (h) => {
        const drawing = await findRecord(h.db, def, req.params.id, true);
        if (!drawing || !h.ctx.canSeeProject(drawing.project_id)) throw new ForbiddenError('Drawing not found or not accessible');
        const rev = req.body ?? {};
        if (!rev.revision || !rev.file_url) throw new ValidationError('revision and file_url are required');
        await addClientRevision(h, req.params.id, {
          approved_status: 'Pending Review',
          ...rev,
          id: rev.id || `rev-${req.params.id}-${Date.now()}`,
          drawing_id: req.params.id,
          uploaded_by: h.ctx.user.name,
          uploaded_date: rev.uploaded_date || new Date().toISOString().slice(0, 10),
          markups: rev.markups ?? [],
        });
        return findRecord(h.db, def, req.params.id);
      });
      res.status(201).json(result);
    })
  );

  router.post(
    '/approvals/:id/decision',
    wrap(async (req, res) => {
      const def = service.module('approvals');
      const { decision, comments } = req.body ?? {};
      if (!['Approved', 'Rejected', 'Changes Requested'].includes(decision)) {
        throw new ValidationError('decision must be Approved, Rejected or Changes Requested');
      }
      const result = await service.transact(req.access!, actorOf(req), async (h) => {
        const approval = await findRecord(h.db, def, req.params.id, true);
        if (!approval || !h.ctx.canSeeProject(approval.project_id)) throw new ForbiddenError('Approval not found or not accessible');
        // The approvals hook checks who may decide (server-side) and records it.
        await service.writeInTransaction(h, def, approval, { ...approval, decision, comments: comments ?? approval.comments });
        return findRecord(h.db, def, req.params.id);
      });
      res.json(result);
    })
  );

  router.post(
    '/variations/:id/transition',
    wrap(async (req, res) => {
      const def = service.module('variations');
      const { status } = req.body ?? {};
      if (typeof status !== 'string') throw new ValidationError('status is required');
      const result = await service.transact(req.access!, actorOf(req), async (h) => {
        const variation = await findRecord(h.db, def, req.params.id, true);
        if (!variation || !h.ctx.canSeeProject(variation.project_id)) throw new ForbiddenError('Variation not found or not accessible');
        checkTransition(h, String(variation.status), status);
        await service.writeInTransaction(h, def, variation, { ...variation, status });
        return findRecord(h.db, def, req.params.id);
      });
      res.json(result);
    })
  );

  router.get('/projects/:id/contract-summary', wrap(async (req, res) => res.json(await contractSummary(pool, req.access!, req.params.id))));
  router.get('/projects/:id/profitability', wrap(async (req, res) => res.json(await profitability(pool, req.access!, req.params.id))));

  // Read-only audit history (audit.view). Non-company-wide users only see their projects.
  router.get(
    '/audit-logs',
    wrap(async (req, res) => {
      const ctx = req.access!;
      ctx.require('audit.view');
      const limit = Math.min(Number(req.query.limit) || 200, 1000);
      const values: unknown[] = [];
      const where: string[] = [];
      for (const f of ['entity_type', 'entity_id', 'project_id'] as const) {
        if (typeof req.query[f] === 'string') {
          values.push(req.query[f]);
          where.push(`${f} = $${values.length}`);
        }
      }
      values.push(limit);
      const rows = (
        await pool.query(
          `SELECT * FROM audit_logs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY occurred_at DESC, id DESC LIMIT $${values.length}`,
          values
        )
      ).rows;
      res.json(rows.filter((r) => ctx.companyWide || (r.project_id && ctx.canSeeProject(r.project_id))));
    })
  );

  // ---------------- generic REST for every module collection ----------------
  for (const def of MODULES) {
    const filterCols = new Set(def.columns.map((c) => c.col));
    router.get(
      `/${def.path}`,
      wrap(async (req, res) => {
        const filter = Object.fromEntries(
          Object.entries(req.query).filter(([k, v]) => filterCols.has(k) && typeof v === 'string')
        ) as Record<string, string>;
        res.json(await service.list(req.access!, def, filter));
      })
    );
    router.get(`/${def.path}/:id`, wrap(async (req, res) => res.json(await service.get(req.access!, def, req.params.id))));
    router.post(`/${def.path}`, wrap(async (req, res) => res.status(201).json(await service.create(req.access!, def, req.body ?? {}, actorOf(req)))));
    router.patch(
      `/${def.path}/:id`,
      wrap(async (req, res) => res.json(await service.update(req.access!, def, req.params.id, req.body ?? {}, actorOf(req))))
    );
    router.delete(
      `/${def.path}/:id`,
      wrap(async (req, res) => {
        await service.remove(req.access!, def, req.params.id, actorOf(req));
        res.status(204).end();
      })
    );
  }

  router.use(apiErrorHandler);
  return router;
}
