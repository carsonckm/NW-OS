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
import { clientConsentAllowed, REASON_PRECEDENCE, resolveApprovalAuthority, type AuthorityResolution, type ResourceKind } from './authorityResolver';
import { addBusinessDays, loadCalendar } from './businessCalendar';

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
export interface DecisionState {
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

/**
 * The Owner routing policy (Batch 4): the active primary Owner, then the active Owner with the
 * highest owner_priority, then user id. With a single Owner this is that Owner, as before.
 */
export const OWNER_POLICY_ORDER = 'is_primary_owner DESC, owner_priority DESC, id';

export async function ownerUser(db: Db): Promise<AuthUser> {
  const owner = (await db.query(`SELECT * FROM users WHERE role = $1 AND is_active ORDER BY ${OWNER_POLICY_ORDER} LIMIT 1`, [OWNER_ROLE])).rows[0];
  if (!owner) throw new ValidationError('No active Owner to route this approval to; it cannot be created without an accountable person');
  return owner as AuthUser;
}

const CLOSED_PROJECT = new Set(['Completed', 'Closed', 'Cancelled']);

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
  const project = state.projectId ? (await db.query('SELECT client_id, sensitivity, project_status FROM projects WHERE id = $1', [state.projectId])).rows[0] : undefined;
  const base = { projectId: state.projectId, clientId: project?.client_id ?? null, sensitivity: project?.sensitivity ?? null };
  const ownerRow = await ownerUser(db);

  // A pending decision on a closed project is not delegated: the Owner reviews it (decides,
  // or withdraws it). It is never deleted.
  if (project && CLOSED_PROJECT.has(project.project_status)) {
    const view = await resolveApprovalAuthority(db, await contextFor(db, ownerRow, cache), { resource: { kind: kind as ResourceKind, id }, now });
    return { ...base, assignee: await fallbackOwner(db, kind, id, cache, now), basis: 'OWNER_FALLBACK', ruleId: null, ruleCode: null, ownerReasonCode: 'PROJECT_CLOSED', ownerReason: `The project is ${project.project_status}: the Owner reviews what is still pending`, decisionType: view.decisionType, value: view.resourceValue, eligible: [], checked: 0 };
  }

  // Client consent (a client-facing request put to the client) goes to the client, never to staff.
  if (kind === 'approval' && (state.approvalType === 'Variation' || state.approvalType === 'Client Scope Change') && state.assignedApproverRole === 'Client' && base.clientId) {
    const client = (await db.query(`SELECT id, name, role FROM users WHERE role = 'Client' AND client_id = $1 AND is_active ORDER BY id LIMIT 1`, [base.clientId])).rows[0];
    if (client) {
      return { ...base, assignee: client, basis: 'CLIENT_CONSENT', ruleId: null, ruleCode: null, ownerReasonCode: null, ownerReason: null, decisionType: 'approval_request', value: null, eligible: [], checked: 1 };
    }
  }

  const ownerView = await resolveApprovalAuthority(db, await contextFor(db, ownerRow, cache), { resource: { kind: kind as ResourceKind, id }, now });
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
  return { ...base, assignee: await fallbackOwner(db, kind, id, cache, now), basis: 'OWNER_FALLBACK', ruleId: null, ruleCode: null, ownerReasonCode: code, ownerReason: reason, decisionType, value, eligible: [], checked: candidates.length };
}

/**
 * The Owner who receives a fallback: in Owner routing policy order, the first active Owner the
 * resolver allows (e.g. not the Owner who raised the variation); the first Owner if none is.
 */
export async function fallbackOwner(db: Db, kind: RoutedKind, id: string, cache: ContextCache = new Map(), now = new Date()) {
  const owners = (await db.query(`SELECT * FROM users WHERE role = $1 AND is_active ORDER BY ${OWNER_POLICY_ORDER}`, [OWNER_ROLE])).rows as AuthUser[];
  if (!owners.length) throw new ValidationError('No active Owner to route this approval to; it cannot be created without an accountable person');
  for (const o of owners) {
    if (owners.length === 1) break;
    const r = await resolveApprovalAuthority(db, await contextFor(db, o, cache), { resource: { kind: kind as ResourceKind, id }, now });
    if (r.allowed) return { id: o.id, name: o.name, role: o.role };
  }
  return { id: owners[0].id, name: owners[0].name, role: owners[0].role };
}

export interface RouteRow {
  id: number;
  resource_kind: RoutedKind;
  resource_id: string;
  assigned_user_id: string;
  routing_basis: RoutingBasis;
  authority_rule_id: string | null;
  status: string;
  route_reason: RouteReason;
  requested_at: Date;
  due_at: Date | null;
  lifecycle_state: LifecycleState;
  reroute_count: number;
  escalation_count: number;
  [k: string]: unknown;
}

/** Why a route exists (Batch 4): an escalation is not a re-route, and both differ from the first routing. */
export type RouteReason = 'initial' | 'authority_changed' | 'escalated_overdue' | 'project_closed' | 'owner_assigned';
export type LifecycleState = 'assigned' | 'reminded' | 'due_soon' | 'overdue' | 'escalated';
/** Routes that stay with their assignee while that person may still decide: re-evaluation never undoes an escalation or the Owner's assignment. */
const STICKY: RouteReason[] = ['escalated_overdue', 'owner_assigned'];

export async function openRoute(db: Db, kind: RoutedKind, id: string): Promise<RouteRow | undefined> {
  return (await db.query(`SELECT * FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2 AND status = 'open' FOR UPDATE`, [kind, id])).rows[0];
}

/** Whether the person a route is assigned to may still decide it now: active, and allowed by the resolver. */
export async function assigneeMayDecide(db: Db, open: Pick<RouteRow, 'assigned_user_id' | 'routing_basis' | 'resource_kind' | 'resource_id'>, cache: ContextCache = new Map(), now = new Date()) {
  const u = (await db.query('SELECT * FROM users WHERE id = $1', [open.assigned_user_id])).rows[0] as AuthUser | undefined;
  if (!u || !u.is_active) return { ok: false, code: 'APPROVER_INACTIVE', reason: `${u?.name ?? open.assigned_user_id} is no longer active` };
  const ctx = await contextFor(db, u, cache);
  if (open.routing_basis === 'CLIENT_CONSENT') {
    const row = (await db.query('SELECT approval_type, project_id FROM approvals WHERE id = $1', [open.resource_id])).rows[0];
    const ok = Boolean(row && clientConsentAllowed(ctx, row));
    return { ok, code: ok ? 'ALLOWED' : 'INSUFFICIENT_PERMISSION', reason: ok ? "The client's consent on their own project" : 'Not a consent this user can give' };
  }
  const r = await resolveApprovalAuthority(db, ctx, { resource: { kind: open.resource_kind as ResourceKind, id: open.resource_id }, now });
  return { ok: r.allowed, code: r.reasonCode as string, reason: r.reason };
}

/**
 * Keeps one record's route in step with its state (call after the record was written, in the
 * same transaction): pending -> an open route to the right person (re-routed if that changed);
 * no longer pending -> the open route is closed with how it ended.
 */
export async function syncRoute(
  db: PoolClient,
  actor: AuditActor,
  kind: RoutedKind,
  id: string,
  opts: { cache?: ContextCache; why?: string; completedBy?: string | null; reason?: RouteReason; now?: Date } = {}
) {
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
  const cache = opts.cache ?? new Map();
  const now = opts.now ?? new Date();
  if (open && STICKY.includes(open.route_reason) && !opts.reason) {
    const closed = state.projectId ? CLOSED_PROJECT.has((await db.query('SELECT project_status FROM projects WHERE id = $1', [state.projectId])).rows[0]?.project_status) : false;
    if (!closed && (await assigneeMayDecide(db, open, cache, now)).ok) return open;
  }
  const d = await computeRouting(db, kind, id, cache, now);
  const sameClosure = (d.ownerReasonCode === 'PROJECT_CLOSED') === (open?.owner_reason_code === 'PROJECT_CLOSED');
  if (open && open.assigned_user_id === d.assignee.id && open.routing_basis === d.basis && (open.authority_rule_id ?? null) === d.ruleId && sameClosure) return open;
  const reason: RouteReason = opts.reason ?? (d.ownerReasonCode === 'PROJECT_CLOSED' ? 'project_closed' : open ? 'authority_changed' : 'initial');
  return insertRoute(db, actor, kind, id, state, d, open, { reason, why: opts.why, now });
}

/**
 * Writes a new open route (closing the previous one as re-routed), audits and notifies. The
 * decision's clock (requested_at, SLA, due_at) and lifecycle carry over from the previous
 * route: moving an approval never resets how long it has waited.
 */
export async function insertRoute(
  db: PoolClient,
  actor: AuditActor,
  kind: RoutedKind,
  id: string,
  state: DecisionState,
  d: Pick<RoutingDecision, 'assignee' | 'basis' | 'ruleId' | 'ruleCode' | 'ownerReasonCode' | 'ownerReason' | 'decisionType' | 'projectId' | 'clientId' | 'sensitivity' | 'value'> & Partial<Pick<RoutingDecision, 'eligible' | 'checked'>>,
  open: RouteRow | undefined,
  opts: { reason: RouteReason; why?: string; now?: Date }
) {
  const now = opts.now ?? new Date();
  const requestedAt = open?.requested_at ? new Date(open.requested_at) : now;
  let sla: number | null = open?.sla_business_days == null ? null : Number(open.sla_business_days);
  let due: Date | null = open?.due_at ? new Date(open.due_at) : null;
  if (d.basis !== 'CLIENT_CONSENT' && sla === null) {
    // The SLA for this decision type (defaults in migration 020; the Owner can change them).
    sla = Number((await db.query('SELECT sla_business_days FROM approval_sla_policies WHERE decision_type = $1', [d.decisionType])).rows[0]?.sla_business_days ?? 1);
    due = addBusinessDays(await loadCalendar(db), requestedAt, sla);
  }
  const escalated = opts.reason === 'escalated_overdue';
  if (open) await db.query(`UPDATE approval_routes SET status = 'rerouted', completed_at = now() WHERE id = $1`, [open.id]);
  const why = opts.why ?? (opts.reason === 'escalated_overdue' ? 'overdue: escalated' : 'authority changed');
  const row = (
    await db.query(
      `INSERT INTO approval_routes (resource_kind, resource_id, decision_type, project_id, client_id, assigned_user_id, routing_basis, authority_rule_id, authority_rule_code,
         owner_reason_code, project_sensitivity, value, priority, replaces_route_id, data, requested_at, sla_business_days, due_at, lifecycle_state, route_reason,
         reminded_at, due_soon_at, overdue_at, escalated_at, reroute_count, escalation_count, last_checked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27) RETURNING *`,
      [
        kind, id, d.decisionType, d.projectId, d.clientId, d.assignee.id, d.basis, d.ruleId, d.ruleCode, d.ownerReasonCode, d.sensitivity, d.value, state.priority, open?.id ?? null,
        JSON.stringify({
          title: state.title,
          link: state.link,
          assignee_name: d.assignee.name,
          assignee_role: d.assignee.role,
          owner_reason: d.ownerReason,
          candidates_checked: d.checked ?? null,
          eligible: (d.eligible ?? []).slice(0, 5).map((c) => ({ user_id: c.user_id, name: c.name, role: c.role, basis: c.basis, rule_code: c.rule_code, rule_priority: c.rule_priority })),
          ...(open ? { previous_assignee: open.assigned_user_id, previous_basis: open.routing_basis, why } : {}),
        }),
        requestedAt, sla, due, escalated ? 'escalated' : open?.lifecycle_state ?? 'assigned', opts.reason,
        open?.reminded_at ?? null, open?.due_soon_at ?? null, open?.overdue_at ?? null, escalated ? now : open?.escalated_at ?? null,
        (open?.reroute_count ?? 0) + (open && !escalated ? 1 : 0), (open?.escalation_count ?? 0) + (escalated ? 1 : 0), null, // checked first on the monitor's next run
      ]
    )
  ).rows[0] as RouteRow;
  await writeAudit(db, actor, {
    action: !open ? 'approval.route.assign' : escalated ? 'approval.route.escalate' : 'approval.route.reroute',
    entityType: 'approval_route',
    entityId: String(row.id),
    projectId: d.projectId,
    before: open ? { assignee: open.assigned_user_id, basis: open.routing_basis, rule: open.authority_rule_code ?? null, lifecycle: open.lifecycle_state } : undefined,
    after: { resource: `${kind}:${id}`, decision_type: d.decisionType, assignee: d.assignee.id, basis: d.basis, rule: d.ruleCode, sensitivity: d.sensitivity, owner_reason: d.ownerReasonCode, reason: opts.reason, due_at: due?.toISOString() ?? null },
    details: open ? why : undefined,
  });
  const urgent = state.priority === 'Critical' || (d.basis === 'OWNER_FALLBACK' && d.sensitivity === 'Strategic') || escalated;
  await insertNotifications(
    db,
    [d.assignee.id],
    {
      title: `${escalated ? 'Escalated to you' : 'To decide'}: ${state.title}`,
      message: escalated
        ? `Overdue (was due ${due ? due.toISOString().slice(0, 10) : '-'}); escalated from ${open?.data && typeof open.data === 'object' ? (open.data as Row).assignee_name ?? open.assigned_user_id : 'the approver'}.`
        : d.basis === 'OWNER_FALLBACK'
          ? `Needs the Owner: ${d.ownerReason ?? d.ownerReasonCode}`
          : `Routed to you (${d.basis}${d.ruleCode ? `, ${d.ruleCode}` : ''})${due ? `; due ${due.toISOString().slice(0, 10)}` : ''}.`,
      type: escalated ? 'escalation' : 'approval',
      priority: urgent ? 'urgent' : state.priority === 'High' ? 'high' : 'normal',
      project_id: d.projectId,
      link_tab: 'approvals',
      entity_type: 'approval_route',
      entity_id: String(row.id),
    },
    `approval-route:${row.id}`,
    'approval_routing'
  );
  // The previous approver is told it moved, and why (e.g. their authority expired).
  if (open && open.assigned_user_id !== d.assignee.id) {
    await insertNotifications(
      db,
      [open.assigned_user_id],
      {
        title: `Moved: ${state.title}`,
        message: `${escalated ? 'Escalated' : 'Re-routed'} to ${d.assignee.name}: ${why}.`,
        type: 'information',
        priority: 'normal',
        project_id: d.projectId,
        link_tab: 'approvals',
        entity_type: 'approval_route',
        entity_id: String(row.id),
      },
      `approval-route:${row.id}:moved`,
      'approval_routing'
    );
  }
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
