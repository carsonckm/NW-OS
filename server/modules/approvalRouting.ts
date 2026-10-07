/**
 * Approval routing (docs/phase6-routing.md): who should receive each pending decision, and why.
 *
 * Routing is not authorization. It never decides who may approve; it asks the authority
 * resolver, for each candidate, the same question the approval action asks, and only people
 * the resolver allows can be routed to. When the approval is taken the resolver checks again.
 *
 *   pending decision -> its record, project, decision type (resolver facts)
 *     -> candidates (active internal users who can see the project and hold the baseline
 *        permission: discovery only, never a grant)
 *     -> resolveApprovalAuthority for each candidate -> only the allowed remain
 *     -> routing precedence (below) -> one assignee
 *     -> nobody allowed -> the Owner (OWNER_FALLBACK, with the reason delegation failed)
 *
 * Routing precedence (deterministic, never storage order):
 *   1 explicit user rule  2 project role rule  3 project permission rule  4 client rule
 *   5 global Owner rule   6 System Policy (incl. the request's assigned approver)  7 Owner
 *   then the matched rule's priority (higher first), then user id.
 *
 * Every pending decision has exactly one open route (unique index) with a non-null assignee.
 * If not even an Owner can be found the routing throws, so the write that created the decision
 * fails instead of leaving an orphan.
 *
 * Dependency direction: approval hooks / routes -> this module -> authorityResolver. This module
 * never calls a hook.
 */
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { ValidationError } from '../core/repository';
import { insertNotifications } from '../automation/notify';
import type { Pool, PoolClient } from '../db/pool';
import type { PermissionKey } from '../../src/types';
import { REASON_PRECEDENCE, resolveApprovalAuthority, type AuthorityResolution, type ResourceKind } from './authorityResolver';

type Db = Pool | PoolClient;
type Row = Record<string, any>;

export type RoutedKind = 'drawing_revision' | 'variation' | 'purchase_order' | 'invoice' | 'approval';
export const ROUTED_KINDS: RoutedKind[] = ['drawing_revision', 'variation', 'purchase_order', 'invoice', 'approval'];
export type RoutingBasis =
  | 'USER_RULE'
  | 'PROJECT_ROLE_RULE'
  | 'PROJECT_PERMISSION_RULE'
  | 'CLIENT_RULE'
  | 'GLOBAL_RULE'
  | 'SYSTEM_POLICY'
  | 'PRIOR_OWNER_APPROVAL'
  | 'CLIENT_CONSENT'
  | 'OWNER_FALLBACK';
/** Routing precedence, best first. */
export const ROUTING_PRECEDENCE: RoutingBasis[] = ['USER_RULE', 'PROJECT_ROLE_RULE', 'PROJECT_PERMISSION_RULE', 'CLIENT_RULE', 'GLOBAL_RULE', 'SYSTEM_POLICY', 'PRIOR_OWNER_APPROVAL', 'OWNER_FALLBACK'];
type Completion = 'approved' | 'rejected' | 'changes_requested' | 'withdrawn';

const OWNER_ROLE = 'Owner / CEO';
const EXTERNAL = new Set(['Client', 'Contractor']);
const REVIEW_STATES = new Set(['Internal Review', 'Pending Review', 'Review']);

/** The record's state as far as routing is concerned. */
interface DecisionState {
  pending: boolean;
  completion?: Completion;
  title: string;
  projectId: string | null;
  priority: 'Low' | 'Normal' | 'High' | 'Critical';
  link: { tab: string; focus?: { type: string; id: string } };
  approvalType?: string;
  assignedApproverRole?: string | null;
}

const PRIORITY: Record<string, DecisionState['priority']> = { Low: 'Low', Medium: 'Normal', Normal: 'Normal', High: 'High', Urgent: 'Critical', Critical: 'Critical' };

/** Reads whether a decision is pending (and how it ended), from the database. Undefined if the record is gone. */
export async function decisionState(db: Db, kind: RoutedKind, id: string): Promise<DecisionState | undefined> {
  switch (kind) {
    case 'approval': {
      const r = (await db.query('SELECT decision, approval_type, project_id, data FROM approvals WHERE id = $1', [id])).rows[0];
      if (!r) return undefined;
      const completion: Record<string, Completion> = { Approved: 'approved', Rejected: 'rejected', 'Changes Requested': 'changes_requested' };
      return {
        pending: r.decision === 'Pending',
        completion: completion[r.decision] ?? 'withdrawn',
        title: `${r.data.approval_number ?? id}: ${r.data.title ?? r.approval_type}`,
        projectId: r.project_id,
        priority: PRIORITY[String(r.data.priority ?? r.data.urgency ?? 'Normal')] ?? 'Normal',
        link: { tab: 'approvals', focus: { type: 'approval', id } },
        approvalType: r.approval_type,
        assignedApproverRole: r.data.assigned_approver_role ?? null,
      };
    }
    case 'drawing_revision': {
      const r = (await db.query(`SELECT r.kind, r.approval_status, r.approved_for_production, r.revision, r.drawing_id, d.project_id, d.data->>'drawing_number' AS number FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE r.id = $1`, [id])).rows[0];
      if (!r) return undefined;
      const client = r.kind === 'client';
      const approved = client ? r.approval_status === 'Approved' : r.approved_for_production || ['Approved', 'Approved for Production'].includes(r.approval_status);
      const pending = client ? REVIEW_STATES.has(r.approval_status) : !approved && !['Superseded', 'Rejected'].includes(r.approval_status);
      return {
        pending,
        completion: approved ? 'approved' : r.approval_status === 'Rejected' ? 'rejected' : 'withdrawn',
        title: `${client ? 'Drawing' : 'NW production drawing'} ${r.number ?? r.drawing_id} ${r.revision}`,
        projectId: r.project_id,
        priority: 'Normal',
        link: { tab: 'drawings', focus: { type: 'drawing', id: r.drawing_id } },
      };
    }
    case 'variation': {
      const r = (await db.query('SELECT status, project_id, data FROM variations WHERE id = $1', [id])).rows[0];
      if (!r) return undefined;
      return {
        pending: r.status === 'Internal Approval',
        completion: r.status === 'Rejected' ? 'rejected' : ['Client Approval', 'Approved', 'Implemented', 'Closed'].includes(r.status) ? 'approved' : 'withdrawn',
        title: `Variation ${r.data.variation_number ?? id}: ${r.data.title ?? ''}`.trim(),
        projectId: r.project_id,
        priority: 'Normal',
        link: { tab: 'variations', focus: { type: 'variation', id } },
      };
    }
    case 'purchase_order': {
      const r = (await db.query('SELECT status, project_id, data FROM purchase_orders WHERE id = $1', [id])).rows[0];
      if (!r) return undefined;
      return {
        pending: r.status === 'Pending Approval',
        completion: ['Issued', 'Partially Received', 'Goods Received', 'Completed'].includes(r.status) ? 'approved' : r.status === 'Cancelled' ? 'rejected' : 'withdrawn',
        title: `Purchase order ${r.data.po_number ?? id} (${r.data.supplier_name ?? 'supplier'})`,
        projectId: r.project_id,
        priority: Number(r.data.total_amount) >= 20000 ? 'High' : 'Normal',
        link: { tab: 'purchasing', focus: { type: 'purchase_order', id } },
      };
    }
    case 'invoice': {
      const r = (await db.query('SELECT status, project_id, data FROM commercial_invoices WHERE id = $1', [id])).rows[0];
      if (!r) return undefined;
      return {
        pending: r.status === 'Pending Approval',
        completion: ['Approved', 'Partially Paid', 'Paid'].includes(r.status) ? 'approved' : r.status === 'Rejected' ? 'rejected' : 'withdrawn',
        title: `Invoice ${r.data.invoice_number ?? id} (${r.data.party_name ?? ''})`,
        projectId: r.project_id,
        priority: r.data.match_status && r.data.match_status !== 'Matched' ? 'High' : 'Normal',
        link: { tab: 'commercial', focus: { type: 'invoice', id } },
      };
    }
  }
}

export interface Candidate {
  user_id: string;
  name: string;
  role: string;
  allowed: boolean;
  reason_code: string;
  basis?: RoutingBasis;
  rule_id?: string | null;
  rule_code?: string | null;
  rule_priority?: number;
}

export interface RoutingDecision {
  assignee: { id: string; name: string; role: string };
  basis: RoutingBasis;
  ruleId: string | null;
  ruleCode: string | null;
  ownerReasonCode: string | null;
  ownerReason: string | null;
  decisionType: string;
  projectId: string | null;
  clientId: string | null;
  sensitivity: string | null;
  value: number | null;
  /** The eligible candidates in routing order (the first one won), and how many were checked. */
  eligible: Candidate[];
  checked: number;
}

/** AccessContext per user, loaded once per routing pass. */
export type ContextCache = Map<string, AccessContext>;

async function contextFor(db: Db, user: AuthUser, cache: ContextCache) {
  let ctx = cache.get(user.id);
  if (!ctx) {
    ctx = await AccessContext.load(db, user);
    cache.set(user.id, ctx);
  }
  return ctx;
}

async function ownerUser(db: Db) {
  const owner = (await db.query(`SELECT id, name, role FROM users WHERE role = $1 AND is_active ORDER BY id LIMIT 1`, [OWNER_ROLE])).rows[0];
  if (!owner) throw new ValidationError('No active Owner to route this approval to; it cannot be created without an accountable person');
  return owner as { id: string; name: string; role: string };
}

function basisOf(r: AuthorityResolution, rule: Row | undefined): RoutingBasis {
  if (r.basis === 'prior_owner_approval') return 'PRIOR_OWNER_APPROVAL';
  if (!rule || rule.kind === 'system') return 'SYSTEM_POLICY';
  if (rule.target_user_id) return 'USER_RULE';
  if (rule.project_id) return rule.target_role ? 'PROJECT_ROLE_RULE' : 'PROJECT_PERMISSION_RULE';
  if (rule.client_id) return 'CLIENT_RULE';
  return 'GLOBAL_RULE';
}

const rankOfBasis = (b: RoutingBasis) => ROUTING_PRECEDENCE.indexOf(b);
const rankOfReason = (c: string) => {
  const i = REASON_PRECEDENCE.indexOf(c as never);
  return i < 0 ? REASON_PRECEDENCE.length : i;
};

/**
 * Who should receive this pending decision (no writes). Every candidate is checked with the
 * authority resolver; only allowed ones can win.
 */
export async function computeRouting(db: Db, kind: RoutedKind, id: string, cache: ContextCache = new Map(), now = new Date()): Promise<RoutingDecision> {
  const state = await decisionState(db, kind, id);
  if (!state) throw new ValidationError(`${kind} ${id} was not found`);
  const project = state.projectId ? (await db.query('SELECT client_id, sensitivity FROM projects WHERE id = $1', [state.projectId])).rows[0] : undefined;
  const base = { projectId: state.projectId, clientId: project?.client_id ?? null, sensitivity: project?.sensitivity ?? null };
  const owner = await ownerUser(db);

  // Client consent (a client-facing request put to the client) goes to the client, never to staff.
  if (kind === 'approval' && (state.approvalType === 'Variation' || state.approvalType === 'Client Scope Change') && state.assignedApproverRole === 'Client' && base.clientId) {
    const client = (await db.query(`SELECT id, name, role FROM users WHERE role = 'Client' AND client_id = $1 AND is_active ORDER BY id LIMIT 1`, [base.clientId])).rows[0];
    if (client) {
      return { ...base, assignee: client, basis: 'CLIENT_CONSENT', ruleId: null, ruleCode: null, ownerReasonCode: null, ownerReason: null, decisionType: 'approval_request', value: null, eligible: [], checked: 1 };
    }
  }

  const owners = (await db.query(`SELECT * FROM users WHERE role = $1 AND is_active ORDER BY id LIMIT 1`, [OWNER_ROLE])).rows[0] as AuthUser;
  const ownerView = await resolveApprovalAuthority(db, await contextFor(db, owners, cache), { resource: { kind: kind as ResourceKind, id }, now });
  const decisionType = ownerView.decisionType;
  const type = (await db.query('SELECT baseline_permission FROM authority_decision_types WHERE key = $1', [decisionType])).rows[0];
  const rules = new Map<string, Row>((await db.query('SELECT id, kind, target_user_id, target_role, project_id, client_id, priority FROM delegated_authorities')).rows.map((r) => [r.id, r]));

  // Candidate discovery: active internal users who can see the project and hold the baseline
  // permission. This only narrows who is asked; the resolver decides.
  const users = (await db.query(`SELECT * FROM users WHERE is_active AND role <> ALL($1::text[]) ORDER BY id`, [[OWNER_ROLE, ...EXTERNAL]])).rows as AuthUser[];
  const candidates: Candidate[] = [];
  const results: AuthorityResolution[] = [];
  for (const u of users) {
    const ctx = await contextFor(db, u, cache);
    if (base.projectId && !ctx.canSeeProject(base.projectId)) continue;
    if (type && !ctx.can(type.baseline_permission as PermissionKey)) continue;
    const r = await resolveApprovalAuthority(db, ctx, { resource: { kind: kind as ResourceKind, id }, now });
    results.push(r);
    // The candidate's routing basis is the most specific rule that grants them this decision
    // (any applicable allow rule that outranks every applicable Owner requirement), not only the
    // highest-priority one the resolver names.
    let best: { basis: RoutingBasis; rule_id: string | null; rule_code: string | null; rule_priority: number } | undefined;
    if (r.allowed) {
      const ownerReq = Math.max(-Infinity, ...r.rules.filter((o) => o.applies && o.effect === 'require_owner').map((o) => o.priority));
      const granting = r.rules.filter((o) => o.applies && o.effect === 'allow' && o.priority > ownerReq);
      best = granting
        .map((o) => ({ basis: basisOf(r, rules.get(o.rule_id)), rule_id: o.rule_id, rule_code: o.rule_code, rule_priority: o.priority }))
        .sort((a, b) => rankOfBasis(a.basis) - rankOfBasis(b.basis) || b.rule_priority - a.rule_priority || a.rule_code!.localeCompare(b.rule_code!))[0];
      best ??= { basis: basisOf(r, r.matchedRuleId ? rules.get(r.matchedRuleId) : undefined), rule_id: r.matchedRuleId, rule_code: r.matchedRuleCode, rule_priority: 0 };
    }
    candidates.push({ user_id: u.id, name: u.name, role: u.role, allowed: r.allowed, reason_code: r.reasonCode, ...(best ?? { rule_code: r.matchedRuleCode }) });
  }
  const eligible = candidates
    .filter((c) => c.allowed)
    .sort((a, b) => rankOfBasis(a.basis!) - rankOfBasis(b.basis!) || (b.rule_priority ?? 0) - (a.rule_priority ?? 0) || a.user_id.localeCompare(b.user_id));
  const value = ownerView.resourceValue;
  if (eligible.length) {
    const w = eligible[0];
    return { ...base, assignee: { id: w.user_id, name: w.name, role: w.role }, basis: w.basis!, ruleId: w.rule_id ?? null, ruleCode: w.rule_code ?? null, ownerReasonCode: null, ownerReason: null, decisionType, value, eligible, checked: candidates.length };
  }

  // Nobody may: the Owner, with the reason delegation was not available.
  let code: string;
  let reason: string;
  const sensitive = results.find((r) => r.reasonCode === 'SENSITIVITY_BLOCKED');
  const invalid = ownerView.reasonCode === 'INVALID_AUTHORITY_CONTEXT' ? ownerView : results.find((r) => r.reasonCode === 'INVALID_AUTHORITY_CONTEXT');
  const required = results.find((r) => r.reasonCode === 'OWNER_REQUIRED');
  if (invalid) [code, reason] = ['INVALID_AUTHORITY_CONTEXT', invalid.reason];
  else if (sensitive || (base.sensitivity && base.sensitivity !== 'Normal' && !results.length)) [code, reason] = ['SENSITIVITY_BLOCKED', sensitive?.reason ?? `${base.sensitivity} project: the Owner decides`];
  else if (required) [code, reason] = ['OWNER_REQUIRED', required.reason];
  else {
    // The most telling refusal among people who take part (a rule that did not cover it).
    const told = results.filter((r) => r.matchedRuleId).sort((a, b) => rankOfReason(a.reasonCode) - rankOfReason(b.reasonCode) || a.userId.localeCompare(b.userId))[0];
    if (told) [code, reason] = [told.reasonCode, `${told.userRole} ${told.userId}: ${told.reason}`];
    else [code, reason] = ['NO_MATCHING_AUTHORITY', results.length ? 'Nobody holds delegated authority for this decision' : 'Nobody else takes part in this decision'];
  }
  return { ...base, assignee: owner, basis: 'OWNER_FALLBACK', ruleId: null, ruleCode: null, ownerReasonCode: code, ownerReason: reason, decisionType, value, eligible: [], checked: candidates.length };
}

export interface RouteRow {
  id: number;
  resource_kind: RoutedKind;
  resource_id: string;
  assigned_user_id: string;
  routing_basis: RoutingBasis;
  authority_rule_id: string | null;
  status: string;
  [k: string]: unknown;
}

async function openRoute(db: Db, kind: RoutedKind, id: string): Promise<RouteRow | undefined> {
  return (await db.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 AND status = 'open' FOR UPDATE`, [kind, id])).rows[0];
}

/**
 * Keeps one record's route in step with its state (call after the record was written, in the
 * same transaction): pending -> an open route to the right person (re-routed if that changed);
 * no longer pending -> the open route is closed with how it ended.
 */
export async function syncRoute(db: PoolClient, actor: AuditActor, kind: RoutedKind, id: string, opts: { cache?: ContextCache; why?: string; completedBy?: string | null } = {}) {
  const state = await decisionState(db, kind, id);
  const open = await openRoute(db, kind, id);
  if (!state || !state.pending) {
    if (open) {
      await db.query(`UPDATE approval_routes SET status = $2, completion_result = $3, completed_at = now(), completed_by = $4 WHERE id = $1`, [
        open.id,
        state && state.completion !== 'withdrawn' ? 'completed' : 'cancelled',
        state?.completion ?? 'withdrawn',
        opts.completedBy ?? (actor.id && (await db.query('SELECT 1 FROM users WHERE id = $1', [actor.id])).rowCount ? actor.id : null),
      ]);
    }
    return undefined;
  }
  const d = await computeRouting(db, kind, id, opts.cache);
  if (open && open.assigned_user_id === d.assignee.id && open.routing_basis === d.basis && (open.authority_rule_id ?? null) === d.ruleId) return open;
  if (open) await db.query(`UPDATE approval_routes SET status = 'rerouted', completed_at = now() WHERE id = $1`, [open.id]);
  const row = (
    await db.query(
      `INSERT INTO approval_routes (resource_kind, resource_id, decision_type, project_id, client_id, assigned_user_id, routing_basis, authority_rule_id, authority_rule_code,
         owner_reason_code, project_sensitivity, value, priority, replaces_route_id, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        kind, id, d.decisionType, d.projectId, d.clientId, d.assignee.id, d.basis, d.ruleId, d.ruleCode, d.ownerReasonCode, d.sensitivity, d.value, state.priority, open?.id ?? null,
        JSON.stringify({
          title: state.title,
          link: state.link,
          assignee_name: d.assignee.name,
          assignee_role: d.assignee.role,
          owner_reason: d.ownerReason,
          candidates_checked: d.checked,
          eligible: d.eligible.slice(0, 5).map((c) => ({ user_id: c.user_id, name: c.name, role: c.role, basis: c.basis, rule_code: c.rule_code, rule_priority: c.rule_priority })),
          ...(open ? { previous_assignee: open.assigned_user_id, previous_basis: open.routing_basis, why: opts.why ?? 'authority changed' } : {}),
        }),
      ]
    )
  ).rows[0] as RouteRow;
  await writeAudit(db, actor, {
    action: open ? 'approval.route.reroute' : 'approval.route.assign',
    entityType: 'approval_route',
    entityId: String(row.id),
    projectId: d.projectId,
    before: open ? { assignee: open.assigned_user_id, basis: open.routing_basis, rule: open.authority_rule_code ?? null } : undefined,
    after: { resource: `${kind}:${id}`, decision_type: d.decisionType, assignee: d.assignee.id, basis: d.basis, rule: d.ruleCode, sensitivity: d.sensitivity, owner_reason: d.ownerReasonCode },
    details: open ? opts.why ?? 'authority changed' : undefined,
  });
  await insertNotifications(
    db,
    [d.assignee.id],
    {
      title: `To decide: ${state.title}`,
      message: d.basis === 'OWNER_FALLBACK' ? `Needs the Owner: ${d.ownerReason ?? d.ownerReasonCode}` : `Routed to you (${d.basis}${d.ruleCode ? `, ${d.ruleCode}` : ''}).`,
      type: 'approval',
      priority: state.priority === 'Critical' ? 'urgent' : state.priority === 'High' ? 'high' : 'normal',
      project_id: d.projectId,
      link_tab: 'approvals',
      entity_type: 'approval_route',
      entity_id: String(row.id),
    },
    `approval-route:${row.id}`,
    'approval_routing'
  );
  return row;
}

/** Pending decisions of every routed kind (optionally one project / decision type). */
export async function pendingDecisions(db: Db, filter: { projectId?: string } = {}): Promise<{ kind: RoutedKind; id: string; project_id: string | null }[]> {
  const p = filter.projectId ?? null;
  return (
    await db.query(
      `SELECT 'approval' AS kind, id, project_id FROM approvals WHERE decision = 'Pending' AND ($1::text IS NULL OR project_id = $1)
       UNION ALL SELECT 'drawing_revision', r.id, d.project_id FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id
         WHERE ((r.kind = 'client' AND r.approval_status IN ('Internal Review', 'Pending Review', 'Review'))
            OR (r.kind = 'nw_production' AND NOT r.approved_for_production AND r.approval_status NOT IN ('Approved', 'Approved for Production', 'Superseded', 'Rejected')))
           AND ($1::text IS NULL OR d.project_id = $1)
       UNION ALL SELECT 'variation', id, project_id FROM variations WHERE status = 'Internal Approval' AND ($1::text IS NULL OR project_id = $1)
       UNION ALL SELECT 'purchase_order', id, project_id FROM purchase_orders WHERE status = 'Pending Approval' AND ($1::text IS NULL OR project_id = $1)
       UNION ALL SELECT 'invoice', id, project_id FROM commercial_invoices WHERE status = 'Pending Approval' AND ($1::text IS NULL OR project_id = $1)
       ORDER BY 1, 2`,
      [p]
    )
  ).rows;
}

/** The no-orphan check: pending decisions without an open route. Should always be empty. */
export async function unroutedDecisions(db: Db, filter: { projectId?: string } = {}) {
  const pending = await pendingDecisions(db, filter);
  const open = new Set((await db.query(`SELECT resource_kind || ':' || resource_id AS k FROM approval_routes WHERE status = 'open'`)).rows.map((r) => r.k as string));
  return pending.filter((p) => !open.has(`${p.kind}:${p.id}`));
}

/**
 * Re-evaluates routes against the current authority (rules, sensitivity, users, permissions):
 * every pending decision in scope gets the route it should have now; closed ones are closed.
 */
export async function reevaluateRoutes(db: PoolClient, actor: AuditActor, filter: { projectId?: string; decisionType?: string } = {}, why = 're-evaluated') {
  const cache: ContextCache = new Map();
  const pending = await pendingDecisions(db, { projectId: filter.projectId });
  const stale = (
    await db.query(`SELECT resource_kind, resource_id FROM approval_routes WHERE status = 'open' AND ($1::text IS NULL OR project_id = $1)`, [filter.projectId ?? null])
  ).rows.filter((r) => !pending.some((p) => p.kind === r.resource_kind && p.id === r.resource_id));
  let rerouted = 0;
  let created = 0;
  for (const p of pending) {
    const before = await openRoute(db, p.kind, p.id);
    if (filter.decisionType && before && before.decision_type !== filter.decisionType) continue;
    const after = await syncRoute(db, actor, p.kind, p.id, { cache, why });
    if (!before && after) created++;
    else if (before && after && before.id !== after.id) rerouted++;
  }
  for (const s of stale) await syncRoute(db, actor, s.resource_kind, s.resource_id, { cache, why });
  return { checked: pending.length, rerouted, created, closed: stale.length };
}
