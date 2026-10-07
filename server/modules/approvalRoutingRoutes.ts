/**
 * Approval routing API (Phase 6 Batch 3). All behind sign-in, the active-user check and CSRF.
 *
 *   GET  /api/approval-routing/inbox              my routed approvals (re-checked with the resolver now)
 *   GET  /api/approval-routing/owner              everything routed to the Owner, and why (Owner only)
 *   GET  /api/approval-routing/explain?kind=&id=  why a decision went to whom (assignee, or authority.view)
 *   GET  /api/approval-routing/orphans            pending decisions without a route (authority.view; should be empty)
 *   POST /api/approval-routing/reevaluate         { project_id? } route again against current authority (authority.view)
 *   POST /api/approval-routing/route              { kind, id } route one decision again (authority.view)
 *
 * Nothing here accepts an assignee, a rule, a basis or a user from the browser: routing is
 * computed on the server, and approving still goes through the authority resolver.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError, type AccessContext } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { reevaluateRoutes, ROUTED_KINDS, syncRoute, unroutedDecisions, decisionState, type RoutedKind } from './approvalRouting';
import { clientConsentAllowed, resolveApprovalAuthority, type ResourceKind } from './authorityResolver';

type Row = Record<string, any>;
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });
const OWNER = 'Owner / CEO';
const PRIORITY_RANK: Record<string, number> = { Critical: 0, High: 1, Normal: 2, Low: 3 };

function notFound(what: string) {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
}
function needView(ctx: AccessContext) {
  if (!ctx.can('authority.view')) throw new ForbiddenError('Missing permission: authority.view (see approval routing)');
}
function kindOf(v: unknown): RoutedKind {
  if (typeof v !== 'string' || !ROUTED_KINDS.includes(v as RoutedKind)) throw new ValidationError(`kind must be one of ${ROUTED_KINDS.join(', ')}`);
  return v as RoutedKind;
}

const ROUTE_SQL = `SELECT ar.*, p.project_name, p.risk_status AS project_risk, a.name AS rule_name, u.name AS assignee_name, u.role AS assignee_role
  FROM approval_routes ar
  LEFT JOIN projects p ON p.id = ar.project_id
  LEFT JOIN delegated_authorities a ON a.id = ar.authority_rule_id
  LEFT JOIN users u ON u.id = ar.assigned_user_id`;

/** One routed approval as a person sees it, with the resolver's answer for them right now. */
async function present(pool: Pool, ctx: AccessContext, r: Row, opts: { detail?: boolean } = {}) {
  let current: { allowed: boolean; reason_code: string; reason: string };
  if (r.routing_basis === 'CLIENT_CONSENT') {
    const row = (await pool.query('SELECT approval_type, project_id FROM approvals WHERE id = $1', [r.resource_id])).rows[0];
    const ok = Boolean(row && clientConsentAllowed(ctx, row));
    current = { allowed: ok, reason_code: ok ? 'ALLOWED' : 'INSUFFICIENT_PERMISSION', reason: ok ? "The client's consent on their own project" : 'Not a consent this user can give' };
  } else {
    const res = await resolveApprovalAuthority(pool, ctx, { resource: { kind: r.resource_kind as ResourceKind, id: r.resource_id } });
    current = { allowed: res.allowed, reason_code: res.reasonCode, reason: res.reason };
  }
  return {
    route_id: Number(r.id),
    resource_kind: r.resource_kind,
    resource_id: r.resource_id,
    title: r.data?.title ?? `${r.resource_kind} ${r.resource_id}`,
    link: r.data?.link ?? null,
    decision_type: r.decision_type,
    project_id: r.project_id,
    project_name: r.project_name ?? null,
    project_risk: r.project_risk ?? null,
    project_sensitivity: r.project_sensitivity,
    value: r.value == null ? null : Number(r.value),
    priority: r.priority,
    due_at: r.due_at,
    routed_at: r.routed_at,
    routing_basis: r.routing_basis,
    authority_rule_code: r.authority_rule_code,
    authority_rule_name: r.rule_name ?? null,
    owner_reason_code: r.owner_reason_code,
    owner_reason: r.data?.owner_reason ?? null,
    assignee: { id: r.assigned_user_id, name: r.assignee_name ?? r.data?.assignee_name, role: r.assignee_role ?? r.data?.assignee_role },
    status: r.status,
    // The resolver's answer for the person looking, now (routing is not authorization).
    current,
    ...(opts.detail ? { eligible: r.data?.eligible ?? [], candidates_checked: r.data?.candidates_checked ?? null, replaces_route_id: r.replaces_route_id, completion_result: r.completion_result, completed_at: r.completed_at, why: r.data?.why ?? null } : {}),
  };
}

const order = (a: Row, b: Row) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || String(a.routed_at).localeCompare(String(b.routed_at)) || Number(a.id) - Number(b.id);

export function createApprovalRoutingRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use('/approval-routing', csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  router.get(
    '/approval-routing/inbox',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const role = ctx.user.role;
      // Contractors take no part in internal approvals; clients see only consents put to them.
      if (role === 'Contractor') return res.json({ items: [], unrouted: [] });
      const rows = (await pool.query(`${ROUTE_SQL} WHERE ar.status = 'open' AND ar.assigned_user_id = $1`, [ctx.user.id])).rows
        .filter((r) => !r.project_id || ctx.canSeeProject(r.project_id))
        .filter((r) => role !== 'Client' || r.routing_basis === 'CLIENT_CONSENT')
        .sort(order);
      const items = [];
      for (const r of rows) items.push(await present(pool, ctx, r));
      // The Owner also sees anything pending without a route (the invariant says: none).
      const unrouted = role === OWNER ? await unroutedDecisions(pool) : [];
      res.json({ items, unrouted });
    })
  );

  router.get(
    '/approval-routing/owner',
    wrap(async (req, res) => {
      const ctx = req.access!;
      if (ctx.user.role !== OWNER) throw new ForbiddenError('Only the Owner sees the Owner approval queue');
      const rows = (await pool.query(`${ROUTE_SQL} WHERE ar.status = 'open' AND u.role = $1`, [OWNER])).rows.sort(order);
      const items = [];
      for (const r of rows) items.push(await present(pool, ctx, r));
      res.json({ items, unrouted: await unroutedDecisions(pool) });
    })
  );

  router.get(
    '/approval-routing/explain',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const kind = kindOf(req.query.kind);
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      const state = await decisionState(pool, kind, id);
      if (!state || (state.projectId && !ctx.canSeeProject(state.projectId))) throw notFound(`Approval ${id}`);
      const history = (await pool.query(`${ROUTE_SQL} WHERE ar.resource_kind = $1 AND ar.resource_id = $2 ORDER BY ar.id DESC`, [kind, id])).rows;
      const open = history.find((r) => r.status === 'open');
      const viewer = ctx.can('authority.view');
      if (!viewer && open?.assigned_user_id !== ctx.user.id) throw new ForbiddenError('Only the assignee, the Owner or Admin can see why this was routed');
      const out = [];
      for (const r of viewer ? history : [open]) out.push(await present(pool, ctx, r, { detail: viewer }));
      res.json({ kind, id, title: state.title, pending: state.pending, current_route: out.find((r) => r.status === 'open') ?? null, history: viewer ? out : [] });
    })
  );

  router.get(
    '/approval-routing/orphans',
    wrap(async (req, res) => {
      needView(req.access!);
      res.json(await unroutedDecisions(pool));
    })
  );

  router.post(
    '/approval-routing/reevaluate',
    wrap(async (req, res) => {
      const ctx = req.access!;
      needView(ctx);
      const projectId = typeof req.body?.project_id === 'string' && req.body.project_id ? req.body.project_id : undefined;
      if (projectId && !ctx.canSeeProject(projectId)) throw new NotFoundError('projects', projectId);
      res.json(await withTransaction(pool, (db) => reevaluateRoutes(db, actorOf(req), { projectId }, `re-run by ${ctx.user.name}`)));
    })
  );

  router.post(
    '/approval-routing/route',
    wrap(async (req, res) => {
      const ctx = req.access!;
      needView(ctx);
      const kind = kindOf(req.body?.kind);
      const id = typeof req.body?.id === 'string' ? req.body.id : '';
      const state = await decisionState(pool, kind, id);
      if (!state || (state.projectId && !ctx.canSeeProject(state.projectId))) throw notFound(`Approval ${id}`);
      await withTransaction(pool, (db) => syncRoute(db, actorOf(req), kind, id, { why: `re-run by ${ctx.user.name}` }));
      const open = (await pool.query(`${ROUTE_SQL} WHERE ar.status = 'open' AND ar.resource_kind = $1 AND ar.resource_id = $2`, [kind, id])).rows[0];
      res.json(open ? await present(pool, ctx, open, { detail: true }) : { pending: false });
    })
  );

  router.use(apiErrorHandler);
  return router;
}
