/**
 * Approval decision traceability (Phase 6 Batch 8): "Why was this person allowed to decide this?"
 *
 * 1. At decision time, every approval path writes its decision audit row (append-only, protected by
 *    a database trigger) with `authority: decisionAudit(...)`: the authority resolver's own result
 *    for this decision, plus a snapshot of the facts it used. That snapshot includes the matched
 *    rule's terms exactly as the resolver read them in the decision's transaction, the requester,
 *    the value, risk, scope and date checks, and the project's sensitivity. Nothing is re-derived
 *    later.
 * 2. `decisionTrace()` reads those rows back for one decision, for people allowed to see it. A
 *    decision recorded before Batch 8 has no snapshot and is shown as "terms not recorded"; it is
 *    never explained from today's rules. Today's rule status is shown separately, labelled as
 *    current, never as the reason for the past decision.
 * 3. `notifyRejection()` tells the original requester, once, that their request was rejected.
 *
 * The resolver stays the only authority. This module neither decides nor re-checks anything.
 */
import type { AccessContext } from '../auth/access';
import { AccessContext as Access } from '../auth/access';
import type { AuthUser } from '../auth/store';
import { insertNotifications } from '../automation/notify';
import type { Pool, PoolClient } from '../db/pool';
import { decisionState, type RoutedKind } from './approvalRouting';
import { approvalTimeline } from './approvalOps';
import { authorityAudit, type AuthorityResolution } from './authorityResolver';

type Db = Pool | PoolClient;
type Row = Record<string, any>;

export const TRACE_VERSION = 1;

/** The kinds of authority a decision can rest on, in plain words. */
export function authorityTypeOf(r: AuthorityResolution): 'Owner' | 'System Policy' | 'Permanent' | 'Temporary' | 'Absence' | 'Prior Owner approval' | 'None' {
  if (r.basis === 'owner') return 'Owner';
  if (r.basis === 'prior_owner_approval') return 'Prior Owner approval';
  if (r.basis !== 'rule' || !r.matchedRule) return 'None';
  if (r.matchedRule.kind === 'system') return 'System Policy';
  return r.matchedRule.authority_type === 'temporary' ? 'Temporary' : r.matchedRule.authority_type === 'absence' ? 'Absence' : 'Permanent';
}

/** Who raised / recorded the record being decided (from the record itself, at decision time). */
async function requesterOf(db: Db, kind: string, id: string, raisedById: string | null): Promise<string | null> {
  if (raisedById) return raisedById;
  if (kind === 'drawing_revision') {
    const r = (await db.query(`SELECT coalesce(data->>'uploaded_by_id', created_by) AS u FROM drawing_revisions WHERE id = $1`, [id])).rows[0];
    return r?.u ?? null;
  }
  if (kind === 'purchase_order') {
    const r = (await db.query(`SELECT coalesce(data->>'requested_by_id', created_by) AS u FROM purchase_orders WHERE id = $1`, [id])).rows[0];
    return r?.u ?? null;
  }
  return null;
}

async function person(db: Db, id: string | null) {
  if (!id) return null;
  const u = (await db.query('SELECT id, name, role FROM users WHERE id = $1', [id])).rows[0];
  return u ? { id: u.id as string, name: u.name as string, role: u.role as string } : { id, name: null, role: null };
}

/**
 * The decision audit's `authority` payload: the existing compact summary (authorityAudit) plus
 * the decision-time snapshot. Call it in the decision's transaction, right after the resolver.
 */
export async function decisionAudit(db: Db, r: AuthorityResolution) {
  const requesterId = await requesterOf(db, r.resourceType, r.resourceId, r.raisedById);
  const names = r.projectId ? (await db.query('SELECT p.project_name, c.company_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id WHERE p.id = $1', [r.projectId])).rows[0] : undefined;
  const rule = r.matchedRule;
  const ruleNames = rule
    ? (
        await db.query(
          `SELECT (SELECT name FROM users WHERE id = $1) AS target_user, (SELECT project_name FROM projects WHERE id = $2) AS project, (SELECT company_name FROM clients WHERE id = $3) AS client, (SELECT name FROM users WHERE id = $4) AS granted_by`,
          [rule.target_user_id, rule.project_id, rule.client_id, rule.granted_by]
        )
      ).rows[0]
    : undefined;
  return {
    ...authorityAudit(r),
    trace: {
      version: TRACE_VERSION,
      decided_at: r.resolvedAt,
      approver: await person(db, r.userId),
      requester: await person(db, requesterId),
      permission: r.baselinePermission,
      basis: r.basis,
      authority_type: authorityTypeOf(r),
      reason: r.reason,
      decision: { project_id: r.projectId, project_name: names?.project_name ?? null, client_id: r.clientId, client_name: names?.company_name ?? null, sensitivity: r.projectSensitivity },
      // Known vs missing: null means the server had no amount for this record.
      value: r.resourceValue === null ? null : { amount: r.resourceValue, source: r.evaluatedValue?.source ?? null },
      rule: rule ? { ...rule, target_user_name: ruleNames?.target_user ?? null, project_name: ruleNames?.project ?? null, client_name: ruleNames?.client ?? null, granted_by_name: ruleNames?.granted_by ?? null } : null,
      checks: {
        scope: r.evaluatedScope,
        value: r.evaluatedValue,
        risk: r.evaluatedRisk,
        dates: r.evaluatedDates,
        conditions: r.evaluatedConditions,
      },
    },
  };
}

// ------------------------------------------------------------------ reading a decision back

/** The audit entity types each routed kind is decided under. */
const ENTITY: Record<RoutedKind, string[]> = {
  approval: ['approval'],
  variation: ['variation'],
  purchase_order: ['purchaseOrders'],
  invoice: ['invoice'],
  drawing_revision: ['drawing_revision', 'nw_production_drawing'],
};
const KINDS = Object.keys(ENTITY) as RoutedKind[];
export const isTraceKind = (k: unknown): k is RoutedKind => typeof k === 'string' && (KINDS as string[]).includes(k);

/**
 * Who may read a decision's trace: the Owner and holders of authority.view (Admin) within their
 * project scope; otherwise the requester, an approver who decided it, or a current / past assignee
 * — internal staff only. Clients and contractors never see internal authority details.
 * Returns false for "not found" (the caller answers 404 either way).
 */
async function mayRead(db: Db, ctx: AccessContext, kind: RoutedKind, id: string, projectId: string | null, deciders: string[], requesters: string[]) {
  if (projectId && !ctx.canSeeProject(projectId)) return false;
  if (['Client', 'Contractor'].includes(ctx.user.role)) return false;
  if (ctx.can('authority.view')) return true;
  if (deciders.includes(ctx.user.id) || requesters.includes(ctx.user.id)) return true;
  const assigned = (await db.query('SELECT 1 FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 AND assigned_user_id = $3 LIMIT 1', [kind, id, ctx.user.id])).rowCount;
  return Boolean(assigned);
}

/** The current requester of a record (for a record never decided yet). */
async function currentRequester(db: Db, kind: RoutedKind, id: string): Promise<string | null> {
  const q: Record<RoutedKind, string> = {
    approval: `SELECT coalesce(requested_by_id, data->>'requested_by_id') AS u FROM approvals WHERE id = $1`,
    variation: `SELECT data->>'created_by_id' AS u FROM variations WHERE id = $1`,
    invoice: `SELECT data->>'recorded_by_id' AS u FROM commercial_invoices WHERE id = $1`,
    purchase_order: `SELECT coalesce(data->>'requested_by_id', created_by) AS u FROM purchase_orders WHERE id = $1`,
    drawing_revision: `SELECT coalesce(data->>'uploaded_by_id', created_by) AS u FROM drawing_revisions WHERE id = $1`,
  };
  return (await db.query(q[kind], [id])).rows[0]?.u ?? null;
}

const outcomeOf = (a: Row) => {
  const after = (a.after ?? {}) as Row;
  return after.decision ?? after.status ?? a.action.split('.').pop();
};

/**
 * One decision's record: every decision taken on it (with its decision-time authority snapshot),
 * its routing / escalation history, and today's status of the rules it used (labelled as current).
 * Undefined when the record does not exist or the user may not read it (same answer: not found).
 */
export async function decisionTrace(db: Db, ctx: AccessContext, kind: RoutedKind, id: string) {
  const state = await decisionState(db, kind, id);
  if (!state) return undefined;
  const audits = (
    await db.query(
      `SELECT id, occurred_at, actor_id, actor_name, actor_role, action, before, after FROM audit_logs
       WHERE entity_type = ANY($1) AND entity_id = $2 AND (after ? 'authority' OR after ? 'consent') ORDER BY id`,
      [ENTITY[kind], id]
    )
  ).rows;
  const requesterNow = await currentRequester(db, kind, id);
  const deciders = audits.map((a) => a.actor_id).filter(Boolean);
  const requesters = [requesterNow, ...audits.map((a) => a.after?.authority?.trace?.requester?.id)].filter(Boolean) as string[];
  if (!(await mayRead(db, ctx, kind, id, state.projectId, deciders, requesters))) return undefined;

  const decisions = audits.map((a) => {
    const auth = (a.after?.authority ?? {}) as Row;
    const trace = auth.trace as Row | undefined;
    return {
      audit_id: String(a.id),
      at: new Date(a.occurred_at).toISOString(),
      action: a.action,
      outcome: outcomeOf(a),
      before: a.before ?? null,
      comments: a.after?.comments ?? a.after?.note ?? null,
      decided_by: { id: a.actor_id, name: a.actor_name, role: a.actor_role },
      // A client deciding on their own project acts on consent, not internal authority.
      consent: a.after?.consent ?? null,
      allowed: auth.result === 'allowed' || a.after?.consent === 'client',
      reason_code: auth.reason_code ?? null,
      matched_rule_code: auth.matched_rule_code ?? null,
      // The decision-time snapshot; absent for decisions recorded before Batch 8.
      terms_recorded: Boolean(trace),
      trace: trace ?? null,
    };
  });
  // Today's status of each rule a decision used: shown as current information only.
  const ruleIds = [...new Set(decisions.map((d) => d.trace?.rule?.id).filter(Boolean))] as string[];
  const current = ruleIds.length
    ? (await db.query('SELECT id, code, active, start_at, end_at, deactivation_reason, updated_at FROM delegated_authorities WHERE id = ANY($1)', [ruleIds])).rows.map((r) => {
        const now = Date.now();
        const inForce = r.active && (!r.start_at || new Date(r.start_at).getTime() <= now) && (!r.end_at || new Date(r.end_at).getTime() > now);
        return { id: r.id, code: r.code, in_force_now: inForce, active: r.active, end_at: r.end_at ? new Date(r.end_at).toISOString() : null, deactivation_reason: r.deactivation_reason ?? null, changed_since: decisions.some((d) => d.trace?.rule?.id === r.id && d.trace?.rule?.updated_at && new Date(r.updated_at).toISOString() !== d.trace.rule.updated_at) };
      })
    : [];
  const open = (await db.query(`SELECT ar.assigned_user_id, ar.routing_basis, ar.authority_rule_code, ar.due_at, u.name, u.role FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.resource_kind = $1 AND ar.resource_id = $2 AND ar.status = 'open'`, [kind, id])).rows[0];
  return {
    kind,
    id,
    title: state.title,
    project_id: state.projectId,
    pending: state.pending,
    requester: await person(db, requesterNow),
    decisions,
    current_route: open ? { assignee: { id: open.assigned_user_id, name: open.name, role: open.role }, routing_basis: open.routing_basis, authority_rule_code: open.authority_rule_code, due_at: open.due_at ? new Date(open.due_at).toISOString() : null } : null,
    current_rule_status: current,
    timeline: await approvalTimeline(db, kind, id),
    note: 'Each decision is explained with the authority terms recorded when it was made. Current rule status is shown separately and does not change past decisions.',
  };
}

// ------------------------------------------------------------------ rejection notices

/**
 * Tells the original requester, once, that their request was rejected. Run it in the decision's
 * transaction. Nobody else is told; the requester only if active, internal or the record's own
 * client side may see the record, and not when they rejected it themselves. The message carries
 * the decision and the decider's comment, never internal authority details.
 */
export async function notifyRejection(
  db: PoolClient,
  r: { kind: RoutedKind; id: string; requesterId: string | null | undefined; deciderId: string | null | undefined; deciderName: string; title: string; projectId: string | null; comment?: unknown; linkTab: string }
) {
  if (!r.requesterId || r.requesterId === r.deciderId) return 0;
  const row = (await db.query('SELECT id, name, email, role, is_active, is_dev_seed, client_id, contractor_id, phone, department, title, created_at, updated_at, last_login FROM users WHERE id = $1', [r.requesterId])).rows[0] as AuthUser | undefined;
  if (!row?.is_active) return 0;
  if (r.projectId) {
    const access = await Access.load(db, row);
    if (!access.canSeeProject(r.projectId)) return 0;
  }
  const comment = typeof r.comment === 'string' && r.comment.trim() ? ` Comment: ${r.comment.trim().slice(0, 500)}` : '';
  return insertNotifications(
    db,
    [r.requesterId],
    { title: `Rejected: ${r.title}`, message: `${r.deciderName} rejected your request.${comment}`, type: 'action', priority: 'high', project_id: r.projectId, link_tab: r.linkTab, entity_type: r.kind, entity_id: r.id },
    // One per rejection of this record: replays, retries and re-saves find the same key.
    `rejection:${r.kind}:${r.id}`,
    'approval_decision'
  );
}
