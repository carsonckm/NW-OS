import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import { ValidationError } from '../core/repository';
import { pendingMigrations } from '../db/migrate';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { addClientRevision, setClientRevisionStatus } from './hooks/drawings';
import { checkTransition } from './hooks/variations';
import { assertConvertible, clientQuotation, nextVersionCode } from './hooks/commercial';
import { writeAudit } from '../audit';
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
  // New client drawing revision: never overwrites, starts as Draft and is never approved on upload.
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
          approved_status: 'Draft',
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

  // Review step for a client revision: Internal Review, Approved, Rejected or back to Draft.
  // Approving supersedes the previously approved revision.
  router.post(
    '/drawings/:id/revisions/:revId/status',
    wrap(async (req, res) => {
      const def = service.module('drawings');
      const status = (req.body ?? {}).status;
      if (typeof status !== 'string' || !status) throw new ValidationError('status is required');
      const result = await service.transact(req.access!, actorOf(req), async (h) => {
        const drawing = await findRecord(h.db, def, req.params.id, true);
        if (!drawing || !h.ctx.canSeeProject(drawing.project_id)) throw new ForbiddenError('Drawing not found or not accessible');
        await setClientRevisionStatus(h, req.params.id, req.params.revId, status);
        return findRecord(h.db, def, req.params.id);
      });
      res.json(result);
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

  // ---------------- sales: quotation versions, client view, award -> project ----------------
  // Client-facing quotation: no internal cost, supplier/contractor cost, margin or notes.
  router.get(
    '/quotations/:id/client-view',
    wrap(async (req, res) => res.json(clientQuotation(await service.get(req.access!, service.module('commercialQuotations'), req.params.id))))
  );

  // Negotiation: a new Draft version copies the items; the previous version is superseded.
  router.post(
    '/quotations/:id/versions',
    wrap(async (req, res) => {
      const def = service.module('commercialQuotations');
      await service.get(req.access!, def, req.params.id); // view permission + scope
      const result = await service.transact(req.access!, actorOf(req), async (h) => {
        const q = (await findRecord(h.db, def, req.params.id, true))!;
        if (!['Draft', 'Internal Review', 'Submitted', 'Negotiation'].includes(String(q.status))) {
          throw new ForbiddenError(`A ${String(q.status)} quotation cannot get a new version`);
        }
        const latest = (
          await h.db.query(`SELECT max((data->>'version')::int) AS v FROM commercial_quotations WHERE data->>'quotation_number' = $1`, [q.quotation_number])
        ).rows[0].v as number;
        const version = (latest || Number(q.version) || 1) + 1;
        const id = `${String(q.quotation_number)}-v${version}`.toLowerCase();
        const { submitted_at: _s, ...rest } = q;
        await service.writeInTransaction(h, def, undefined, {
          ...rest,
          ...(req.body?.items ? { items: req.body.items } : {}),
          id,
          version,
          version_code: nextVersionCode(q, version),
          previous_version_id: q.id,
          status: 'Draft',
          approval_status: 'Pending',
          date: new Date().toISOString().slice(0, 10),
          created_at: undefined,
        });
        await service.writeInTransaction(h, def, q, { ...q, status: 'Superseded', superseded_by_id: id });
        return findRecord(h.db, def, id);
      });
      res.status(201).json(result);
    })
  );

  // Award -> project: carries the client, scope, contract value and budget forward in one
  // transaction. No drawings, packages or production records are created.
  router.post(
    '/quotations/:id/convert',
    wrap(async (req, res) => {
      const def = service.module('commercialQuotations');
      const ctx = req.access!;
      ctx.require('projects.create');
      await service.get(ctx, def, req.params.id);
      const body = req.body ?? {};
      for (const f of ['project_number', 'start_date', 'end_date']) {
        if (typeof body[f] !== 'string' || !body[f]) throw new ValidationError(`${f} is required`);
      }
      const result = await service.transact(ctx, actorOf(req), async (h) => {
        const q = (await findRecord(h.db, def, req.params.id, true))!;
        assertConvertible(q);
        const enquiry = q.enquiry_id ? await findRecord(h.db, service.module('clientEnquiries'), String(q.enquiry_id), true) : undefined;
        const tender = q.tender_id ? await findRecord(h.db, service.module('commercialTenders'), String(q.tender_id), true) : undefined;
        const contractValue = Number(q.subtotal_selling_price) || Number(q.total_selling_price) || 0;
        const project = await service.createCoreInTransaction(h, 'projects', {
          project_number: body.project_number,
          project_name: body.project_name || q.project_name,
          client_id: q.client_id,
          site_address: body.site_address || q.site_address || enquiry?.site_address || '',
          contract_value: contractValue,
          project_status: 'Awarded',
          start_date: body.start_date,
          end_date: body.end_date,
          signed_date: body.signed_date || new Date().toISOString().slice(0, 10),
          project_manager_id: body.project_manager_id || '',
          site_supervisor_id: body.site_supervisor_id || '',
          progress_percent: 0,
          description: [q.scope_summary, enquiry?.scope_description].filter(Boolean).join('\n') || `Awarded from ${String(q.version_code)}`,
        });
        const projectId = String(project.id);
        await service.writeInTransaction(h, service.module('commercialBaselines'), undefined, {
          project_id: projectId,
          project_number: project.project_number,
          project_name: project.project_name,
          original_contract_value: contractValue,
          original_budget_direct_cost: Number(q.total_estimated_cost) || 0,
          variance_drivers: { material: 0, subcontractor: 0, rework: 0, logistics: 0, other: 0 },
          cash_billed: 0,
          cash_collected: 0,
          cash_outstanding: 0,
          source_quotation_id: q.id,
        });
        // The quotation's project link is set only here (not editable through the API).
        await h.db.query(
          `UPDATE commercial_quotations SET project_id = $2,
             data = jsonb_set(jsonb_set(data, '{project_id}', to_jsonb($2::text)), '{converted_project_id}', to_jsonb($2::text)),
             updated_at = now() WHERE id = $1`,
          [q.id, projectId]
        );
        if (enquiry) await service.writeInTransaction(h, service.module('clientEnquiries'), enquiry, { ...enquiry, status: 'Won', project_id: projectId });
        if (tender) await service.writeInTransaction(h, service.module('commercialTenders'), tender, { ...tender, status: 'Awarded', project_id: projectId });
        await writeAudit(h.db, h.actor, {
          action: 'quotation.convert',
          entityType: 'commercialQuotations',
          entityId: String(q.id),
          projectId,
          after: { project_id: projectId, contract_value: contractValue, budget: q.total_estimated_cost, quotation: q.version_code },
        });
        return { project, quotation: await findRecord(h.db, def, String(q.id)) };
      });
      res.status(201).json(result);
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
