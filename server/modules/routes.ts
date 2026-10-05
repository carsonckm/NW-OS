import { randomUUID } from 'crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import { ValidationError } from '../core/repository';
import { pendingMigrations } from '../db/migrate';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { addClientRevision, drawingProductionUsage, setClientRevisionStatus } from './hooks/drawings';
import { checkTransition } from './hooks/variations';
import { assertConvertible, clientQuotation, nextVersionCode } from './hooks/commercial';
import { writeAudit } from '../audit';
import { MODULES } from './registry';
import { contractSummary, profitability } from './reports';
import { exceptionsFor, projectOverview } from './exceptions';
import { portfolioRisk, projectRiskFor } from './risk';
import { dailyBriefing } from './briefing';
import { ownerCenter, ownerDependency } from './ownerCenter';
import { findRecord } from './store';
import { Assistant } from './assistant';
import { recurringFor } from './recurring';
import { calendarFor } from './calendar';
import { AI_PROPOSAL_TYPE, raiseProposal, validateProposal } from './assistantActions';
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
    '/projects/:id/overview',
    '/projects/:id/risk',
    '/exceptions',
    '/risk',
    '/briefing',
    '/owner/*',
    '/assistant/*',
    '/calendar',
    '/recurring-problems',
    '/recurring-problems/*',
    '/ai/assistant',
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

  // Which production orders are built from which revision of a drawing.
  router.get(
    '/drawings/:id/production-usage',
    wrap(async (req, res) => {
      if (!req.access!.can('production.view')) throw new ForbiddenError('Missing permission: production.view (see production orders)');
      const drawing = await service.get(req.access!, service.module('drawings'), req.params.id);
      res.json(await drawingProductionUsage(pool, String(drawing.id)));
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
      const { status, note, client_approval_reference } = req.body ?? {};
      if (typeof status !== 'string') throw new ValidationError('status is required');
      const result = await service.transact(req.access!, actorOf(req), async (h) => {
        const variation = await findRecord(h.db, def, req.params.id, true);
        if (!variation || !h.ctx.canSeeProject(variation.project_id)) throw new ForbiddenError('Variation not found or not accessible');
        checkTransition(h, String(variation.status), status);
        await service.writeInTransaction(h, def, variation, {
          ...variation,
          status,
          ...(typeof note === 'string' && note ? { transition_note: note } : {}),
          ...(typeof client_approval_reference === 'string' ? { client_approval_reference } : {}),
        });
        return service.redact(h.ctx, def, await findRecord(h.db, def, req.params.id));
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
  router.get('/exceptions', wrap(async (req, res) => res.json(await exceptionsFor(pool, req.access!))));
  // Risk is NW-internal: clients and contractors don't get it.
  const staffOnly = (req: Request) => {
    if (['Client', 'Contractor'].includes(req.auth!.user.role)) throw new ForbiddenError('Project risk is for NW staff');
  };
  router.get('/risk', wrap(async (req, res) => { staffOnly(req); res.json(await portfolioRisk(pool, req.access!)); }));
  router.get('/projects/:id/risk', wrap(async (req, res) => { staffOnly(req); res.json(await projectRiskFor(pool, req.access!, req.params.id)); }));
  router.get('/briefing', wrap(async (req, res) => res.json(await dailyBriefing(pool, req.access!))));
  router.get('/owner/center', wrap(async (req, res) => res.json(await ownerCenter(pool, req.access!))));
  router.get('/owner/dependency', wrap(async (req, res) => res.json(await ownerDependency(pool, req.access!))));
  // Operational calendar: recorded dates the user may see (filters: from, to, project_id, person_id, role, status, type).
  router.get(
    '/calendar',
    wrap(async (req, res) => {
      const q = req.query as Record<string, unknown>;
      const pick = (k: string) => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);
      res.json(await calendarFor(pool, service, req.access!, { from: pick('from'), to: pick('to'), project_id: pick('project_id'), person_id: pick('person_id'), role: pick('role'), status: pick('status'), type: pick('type') }));
    })
  );

  // ---------------- knowledge usage and recurring problems ----------------
  const knowledgeDef = service.module('knowledge');
  // Record that an approved article was applied (only approved knowledge is official).
  router.post(
    '/knowledge/:id/usage',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const article = await service.get(ctx, knowledgeDef, req.params.id);
      if (article.status !== 'Approved') throw new ValidationError('Only approved (published) knowledge can be applied');
      const { project_id, entity_type, entity_id, note } = req.body ?? {};
      if (project_id !== undefined && project_id !== null && !ctx.canSeeProject(project_id)) throw new ForbiddenError('Project not found or not accessible');
      const row = (
        await pool.query(
          `INSERT INTO knowledge_usage (article_id, user_id, project_id, entity_type, entity_id, note) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::int AS id, used_at`,
          [article.id, ctx.user.id, project_id ?? null, typeof entity_type === 'string' ? entity_type : null, typeof entity_id === 'string' ? entity_id : null, typeof note === 'string' ? note.slice(0, 500) : null]
        )
      ).rows[0];
      await writeAudit(pool, actorOf(req), { action: 'knowledge.used', entityType: 'knowledge', entityId: String(article.id), projectId: project_id ?? null, after: { entity_type, entity_id } });
      res.status(201).json(row);
    })
  );
  router.get(
    '/knowledge/:id/usage',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const article = await service.get(ctx, knowledgeDef, req.params.id);
      const rows = (
        await pool.query(
          `SELECT u.id::int AS id, u.user_id, us.name AS user_name, u.project_id, u.entity_type, u.entity_id, u.note, u.used_at
           FROM knowledge_usage u LEFT JOIN users us ON us.id = u.user_id WHERE u.article_id = $1 ORDER BY u.used_at DESC LIMIT 100`,
          [article.id]
        )
      ).rows;
      // Usage on projects the reader can't see is counted but not shown.
      res.json(rows.map((r) => (r.project_id && !ctx.canSeeProject(r.project_id) ? { id: r.id, used_at: r.used_at, hidden: true } : r)));
    })
  );

  router.get('/recurring-problems', wrap(async (req, res) => res.json(await recurringFor(pool, req.access!))));
  // A person decides what to do about a pattern; the detector never acts on its own.
  const findPattern = async (req: Request) => {
    const key = req.body?.pattern_key;
    const pattern = (await recurringFor(pool, req.access!)).find((p) => p.key === key);
    if (!pattern) throw new ValidationError('That pattern is not (or no longer) detected in your records');
    return pattern;
  };
  router.post(
    '/recurring-problems/review',
    wrap(async (req, res) => {
      const ctx = req.access!;
      if (!ctx.can('knowledge.edit') && !ctx.can('automation.manage_tasks')) throw new ForbiddenError('Missing permission: knowledge.edit or automation.manage_tasks');
      const { decision, note } = req.body ?? {};
      if (!['Action taken', 'Dismissed'].includes(decision)) throw new ValidationError('decision must be Action taken or Dismissed');
      if (decision === 'Dismissed' && !(typeof note === 'string' && note.trim())) throw new ValidationError('Say why the pattern is dismissed');
      const pattern = await findPattern(req);
      await pool.query(
        `INSERT INTO recurring_problem_reviews (pattern_key, decision, note, occurrences, decided_by) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (pattern_key) DO UPDATE SET decision = $2, note = $3, occurrences = $4, decided_by = $5, decided_at = now(), article_id = NULL`,
        [pattern.key, decision, typeof note === 'string' ? note.slice(0, 1000) : null, pattern.occurrences, ctx.user.id]
      );
      await writeAudit(pool, actorOf(req), { action: 'recurring.review', entityType: 'recurring_problem', entityId: pattern.key, after: { decision, note, occurrences: pattern.occurrences } });
      res.json({ ok: true });
    })
  );
  // Starts a Lessons-Learned draft from the evidence; a person writes the solution and it is
  // official only after a knowledge editor approves it.
  router.post(
    '/recurring-problems/draft-knowledge',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const pattern = await findPattern(req);
      const article = await service.transact(ctx, actorOf(req), async (h) => {
        const id = `kb-rec-${randomUUID().slice(0, 8)}`;
        const stored = await service.writeInTransaction(h, knowledgeDef, undefined, {
          id,
          title: `Lessons learned: ${pattern.title}`,
          category: pattern.knowledge_category,
          status: 'Draft',
          problem: `${pattern.suggestion}\n\nSeen ${pattern.occurrences} times between ${pattern.first_seen.slice(0, 10)} and ${pattern.last_seen.slice(0, 10)}:\n${pattern.examples.map((e) => `- ${e.label} (${e.type} ${e.id})`).join('\n')}`,
          solution: '',
          procedure: '',
          description: '',
          tags: ['recurring', pattern.kind.replace(/_/g, '-')],
          source_pattern_key: pattern.key,
          created_at: new Date().toISOString(),
        });
        await h.db.query(
          `INSERT INTO recurring_problem_reviews (pattern_key, decision, occurrences, decided_by, article_id) VALUES ($1, 'Knowledge drafted', $2, $3, $4)
           ON CONFLICT (pattern_key) DO UPDATE SET decision = 'Knowledge drafted', note = NULL, occurrences = $2, decided_by = $3, decided_at = now(), article_id = $4`,
          [pattern.key, pattern.occurrences, ctx.user.id, id]
        );
        await writeAudit(h.db, actorOf(req), { action: 'recurring.review', entityType: 'recurring_problem', entityId: pattern.key, after: { decision: 'Knowledge drafted', article_id: id } });
        return stored;
      });
      res.status(201).json(article);
    })
  );

  // ---------------- AI operating assistant (answers from the user's own scope) ----------------
  const assistant = new Assistant(pool);
  router.post('/assistant/ask', wrap(async (req, res) => res.json(await assistant.ask(req.access!, actorOf(req), req.body ?? {}))));
  // The legacy copilot drawer posts here with its own role and "context": both are ignored.
  router.post(
    '/ai/assistant',
    wrap(async (req, res) => {
      const a = await assistant.ask(req.access!, actorOf(req), { question: req.body?.question, project_id: req.body?.project_id });
      const lines = a.facts.slice(0, 8).map((f) => `• [${f.confidence}] ${f.text}`);
      res.json({ answer: [a.answer, ...lines].join('\n'), source: 'nw-os-records', result: a });
    })
  );
  // AI proposes → a human approves (an "AI Proposal" approval for the asker) → the system executes.
  router.post(
    '/assistant/proposals',
    wrap(async (req, res) => {
      const ctx = req.access!;
      ctx.require('ai.assistant');
      ctx.require('approvals.request');
      const { action, params, rationale } = req.body ?? {};
      const checked = await validateProposal(pool, ctx, action, params);
      const u = ctx.user;
      // The person who asked decides (the Owner can decide any proposal).
      const created = await raiseProposal(service, ctx, actorOf(req), checked, { approver: { id: u.id, name: u.name, role: u.role }, rationale: typeof rationale === 'string' ? rationale : undefined, source: 'assistant' });
      res.status(201).json(created);
    })
  );
  router.get(
    '/assistant/proposals',
    wrap(async (req, res) => {
      if (!req.access!.can('approvals.view')) return void res.json([]); // e.g. contractors: no proposals
      const rows = await service.list(req.access!, service.module('approvals'), {});
      res.json(rows.filter((a) => a.approval_type === AI_PROPOSAL_TYPE && (a.assigned_approver_id === req.auth!.user.id || a.asked_by_id === req.auth!.user.id || req.auth!.user.role === 'Owner / CEO')));
    })
  );

  router.get('/projects/:id/overview', wrap(async (req, res) => res.json(await projectOverview(pool, req.access!, req.params.id))));
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
