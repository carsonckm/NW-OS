/**
 * Proactive approval management (Phase 6 Batch 4, docs/phase6-approval-monitoring.md):
 *
 *   - the lifecycle a person sees for each routed approval (server-calculated: status, age,
 *     time to / past due, re-routes, escalations) and its history (from approval_routes, the
 *     automation action ledger and the audit log; no extra history table);
 *   - the Owner Exception Center: what needs the Owner now, grouped Critical / Urgent /
 *     Attention / Informational by server rules, with an explainable priority score;
 *   - the Owner's tools: assign an approval to someone the resolver allows, Owner routing
 *     policy, SLA policies and safe snoozes. Nothing here decides an approval: deciding goes
 *     through the record's own endpoint, where the authority resolver checks again.
 */
import { ForbiddenError, AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import {
  assigneeMayDecide,
  decisionState,
  insertRoute,
  openRoute,
  OWNER_POLICY_ORDER,
  reevaluateRoutes,
  ROUTED_KINDS,
  unroutedDecisions,
  type ContextCache,
  type LifecycleState,
  type RoutedKind,
  type RouteRow,
} from './approvalRouting';
import { LIFECYCLE_RANK, loadPolicies, slaPercent, stageFor, type SlaPolicy } from './approvalMonitor';
import { resolveApprovalAuthority, type ResourceKind } from './authorityResolver';
import { businessElapsedMs, DAY_MS, loadCalendar, type BusinessCalendar } from './businessCalendar';

type Db = Pool | PoolClient;
type Row = Record<string, any>;
const OWNER = 'Owner / CEO';
const HOUR = 3600_000;
const notFound = (what: string) => {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
};

export function requireOwner(ctx: AccessContext, what = 'the Owner Exception Center') {
  if (ctx.user.role !== OWNER) throw new ForbiddenError(`Only the Owner may use ${what}`);
}

// ------------------------------------------------------------------ lifecycle view
const COMPLETED: Record<string, string> = { approved: 'Approved', rejected: 'Rejected', changes_requested: 'Changes Requested', withdrawn: 'Cancelled' };

/** Server-calculated lifecycle of a route as of `now` (the stored state, or the SLA stage reached since, whichever is further). */
export function lifecycleOf(r: Row, cal: BusinessCalendar, policies: Map<string, SlaPolicy>, now: Date) {
  const requested = new Date(r.requested_at ?? r.routed_at);
  const due = r.due_at ? new Date(r.due_at) : null;
  const base = {
    requested_at: requested.toISOString(),
    due_at: due?.toISOString() ?? null,
    age_hours: Math.max(0, Math.round((now.getTime() - requested.getTime()) / HOUR)),
    waiting_working_days: Math.round((businessElapsedMs(cal, requested, now) / DAY_MS) * 10) / 10,
    due_in_hours: due && due > now ? Math.round((due.getTime() - now.getTime()) / HOUR) : null,
    overdue_hours: due && due <= now ? Math.round((now.getTime() - due.getTime()) / HOUR) : null,
    reroute_count: Number(r.reroute_count ?? 0),
    escalation_count: Number(r.escalation_count ?? 0),
    route_reason: r.route_reason ?? 'initial',
    sla_business_days: r.sla_business_days == null ? null : Number(r.sla_business_days),
  };
  if (r.status !== 'open') return { ...base, state: r.lifecycle_state as LifecycleState, status: COMPLETED[r.completion_result] ?? (r.status === 'rerouted' ? 'Re-routed' : 'Cancelled'), sla_percent: null };
  const pct = slaPercent(cal, { requested_at: requested, sla_business_days: r.sla_business_days }, now);
  const policy = policies.get(r.decision_type);
  let state = (r.lifecycle_state ?? 'assigned') as LifecycleState;
  if (pct !== null && policy && state !== 'escalated') {
    const live = stageFor(pct, policy);
    if (LIFECYCLE_RANK[live] > LIFECYCLE_RANK[state]) state = live;
  }
  let status: string;
  if (state === 'escalated') status = 'Escalated';
  else if (state === 'overdue') status = 'Overdue';
  else if (r.owner_reason_code === 'PROJECT_CLOSED') status = 'Owner Review';
  else if (state === 'due_soon') status = 'Due Soon';
  else if (r.routing_basis === 'OWNER_FALLBACK') status = 'Owner Required';
  else status = 'Assigned';
  return { ...base, state, status, sla_percent: pct === null ? null : Math.round(pct) };
}

export async function lifecycleContext(db: Db) {
  return { cal: await loadCalendar(db), policies: await loadPolicies(db) };
}

// ------------------------------------------------------------------ history
/** The decision's history: every route (assigned, re-routed, escalated, completed), reminders and the decision itself. */
export async function approvalTimeline(db: Db, kind: RoutedKind, id: string) {
  const routes = (await db.query(`SELECT ar.*, u.name AS assignee_name FROM approval_routes ar LEFT JOIN users u ON u.id = ar.assigned_user_id WHERE resource_kind = $1 AND resource_id = $2 ORDER BY ar.id`, [kind, id])).rows;
  const audits = routes.length
    ? (await db.query(`SELECT entity_id, action, actor_name, details, after, occurred_at FROM audit_logs WHERE entity_type = 'approval_route' AND entity_id = ANY($1) ORDER BY id`, [routes.map((r) => String(r.id))])).rows
    : [];
  const out: Row[] = [];
  for (const r of routes) {
    const assign = audits.find((a) => a.entity_id === String(r.id) && ['approval.route.assign', 'approval.route.reroute', 'approval.route.escalate'].includes(a.action));
    const label = r.route_reason === 'escalated_overdue' ? 'Escalated to' : r.route_reason === 'owner_assigned' ? 'Assigned by the Owner to' : r.replaces_route_id ? 'Re-routed to' : 'Routed to';
    out.push({
      at: new Date(r.routed_at).toISOString(),
      actor: assign?.actor_name ?? 'NW OS',
      action: `${label} ${r.assignee_name ?? r.assigned_user_id}`,
      reason: r.route_reason === 'initial' ? null : (r.data?.why ?? r.data?.owner_reason ?? r.route_reason),
      basis: r.routing_basis,
      rule: r.authority_rule_code,
      owner_reason_code: r.owner_reason_code,
    });
    for (const a of audits.filter((x) => x.entity_id === String(r.id) && ['approval.route.lifecycle', 'approval.route.escalate'].includes(x.action) && x !== assign)) {
      out.push({ at: new Date(a.occurred_at).toISOString(), actor: a.actor_name, action: a.action === 'approval.route.escalate' ? 'Escalated (already with the Owner)' : `Now ${String(a.after?.lifecycle ?? '').replace('_', ' ')}`, reason: a.details ?? (a.after?.sla_percent != null ? `${a.after.sla_percent}% of the SLA used` : null), basis: null, rule: null, owner_reason_code: null });
    }
    if (r.status === 'completed' || r.status === 'cancelled') {
      out.push({ at: new Date(r.completed_at).toISOString(), actor: r.completed_by ?? 'NW OS', action: COMPLETED[r.completion_result] ?? 'Closed', reason: null, basis: null, rule: null, owner_reason_code: null });
    }
  }
  const sent = (await db.query(`SELECT action_key, created_at, detail FROM automation_actions WHERE rule_key = 'approval_monitor' AND kind = 'notification' AND action_key LIKE $1 ORDER BY created_at`, [`approval_monitor:${kind}:${id}:%`])).rows;
  for (const s of sent) {
    const [, , , stage, user] = String(s.action_key).split(':');
    out.push({ at: new Date(s.created_at).toISOString(), actor: 'NW OS Approval Monitor', action: `${stage === 'reminded' ? 'Reminder' : stage === 'due_soon' ? 'Due-soon notice' : 'Overdue notice'} sent to ${user}`, reason: null, basis: null, rule: null, owner_reason_code: null });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ------------------------------------------------------------------ Owner assignment
/**
 * The Owner assigns a pending approval to a named person. The server checks, with the
 * authority resolver, that this person may decide it; the browser never chooses a basis, a
 * rule or a fallback. The route stays with them while they may decide (route_reason owner_assigned).
 */
export async function ownerAssign(pool: Pool, ctx: AccessContext, actor: AuditActor, body: unknown) {
  requireOwner(ctx, 'approval assignment');
  const b = (body && typeof body === 'object' ? body : {}) as Row;
  const extra = Object.keys(b).filter((k) => !['kind', 'id', 'user_id', 'reason'].includes(k));
  if (extra.length) throw new ValidationError(`These fields are set by the server or not allowed: ${extra.join(', ')}`);
  if (!ROUTED_KINDS.includes(b.kind)) throw new ValidationError(`kind must be one of ${ROUTED_KINDS.join(', ')}`);
  if (typeof b.id !== 'string' || !b.id || typeof b.user_id !== 'string' || !b.user_id) throw new ValidationError('id and user_id are required');
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');
  const kind = b.kind as RoutedKind;
  return withTransaction(pool, async (db) => {
    const state = await decisionState(db, kind, b.id);
    if (!state || (state.projectId && !ctx.canSeeProject(state.projectId))) throw notFound(`Approval ${b.id}`);
    if (!state.pending) throw new ValidationError('This approval is no longer pending');
    const open = await openRoute(db, kind, b.id);
    const user = (await db.query('SELECT * FROM users WHERE id = $1', [b.user_id])).rows[0] as AuthUser | undefined;
    if (!user || !user.is_active || ['Client', 'Contractor'].includes(user.role)) throw new ValidationError('Assign to an active NW staff member');
    const r = await resolveApprovalAuthority(db, await AccessContext.load(db, user), { resource: { kind: kind as ResourceKind, id: b.id } });
    if (!r.allowed) throw new ValidationError(`${user.name} may not decide this (${r.reasonCode}: ${r.reason})`);
    if (open?.assigned_user_id === user.id) return open;
    const rules = r.matchedRuleId ? (await db.query('SELECT kind, target_user_id, target_role, project_id, client_id FROM delegated_authorities WHERE id = $1', [r.matchedRuleId])).rows[0] : undefined;
    const basis = user.role === OWNER ? 'OWNER_FALLBACK' : r.basis === 'prior_owner_approval' ? 'PRIOR_OWNER_APPROVAL' : !rules || rules.kind === 'system' ? 'SYSTEM_POLICY' : rules.target_user_id ? 'USER_RULE' : rules.project_id ? (rules.target_role ? 'PROJECT_ROLE_RULE' : 'PROJECT_PERMISSION_RULE') : rules.client_id ? 'CLIENT_RULE' : 'GLOBAL_RULE';
    const project = state.projectId ? (await db.query('SELECT client_id, sensitivity FROM projects WHERE id = $1', [state.projectId])).rows[0] : undefined;
    return insertRoute(
      db,
      actor,
      kind,
      b.id,
      state,
      {
        assignee: { id: user.id, name: user.name, role: user.role },
        basis: basis as never,
        ruleId: basis === 'OWNER_FALLBACK' || basis === 'PRIOR_OWNER_APPROVAL' ? null : r.matchedRuleId,
        ruleCode: basis === 'OWNER_FALLBACK' || basis === 'PRIOR_OWNER_APPROVAL' ? null : r.matchedRuleCode,
        ownerReasonCode: basis === 'OWNER_FALLBACK' ? 'OWNER_ASSIGNED' : null,
        ownerReason: basis === 'OWNER_FALLBACK' ? `Taken by the Owner: ${reason}` : null,
        decisionType: r.decisionType,
        projectId: state.projectId,
        clientId: project?.client_id ?? null,
        sensitivity: project?.sensitivity ?? null,
        value: r.resourceValue,
      },
      open,
      { reason: 'owner_assigned', why: `Assigned by ${ctx.user.name}: ${reason}` }
    );
  });
}

// ------------------------------------------------------------------ Owner routing policy
export async function ownerRoutingPolicy(db: Db) {
  const owners = (await db.query(`SELECT id, name, email, is_active, owner_priority, is_primary_owner FROM users WHERE role = $1 ORDER BY ${OWNER_POLICY_ORDER}`, [OWNER])).rows;
  const receiving = owners.find((o) => o.is_active);
  return {
    order: 'Active primary Owner, then the active Owner with the highest priority, then user id',
    receives_fallbacks: receiving ? { id: receiving.id, name: receiving.name } : null,
    owners,
  };
}

export async function setOwnerRoutingPolicy(pool: Pool, ctx: AccessContext, actor: AuditActor, body: unknown) {
  requireOwner(ctx, 'the Owner routing policy');
  if (!ctx.can('authority.manage')) throw new ForbiddenError('Missing permission: authority.manage');
  const list = (body as Row)?.owners;
  if (!Array.isArray(list) || !list.length) throw new ValidationError('owners: [{ id, owner_priority, is_primary_owner }] is required');
  const before = await ownerRoutingPolicy(pool);
  const ids = new Set(before.owners.map((o: Row) => o.id));
  let primaries = 0;
  for (const o of list) {
    if (!o || typeof o !== 'object') throw new ValidationError('Each entry must be an object');
    const extra = Object.keys(o).filter((k) => !['id', 'owner_priority', 'is_primary_owner'].includes(k));
    if (extra.length) throw new ValidationError(`Not allowed: ${extra.join(', ')}`);
    if (!ids.has(o.id)) throw new ValidationError(`${String(o.id)} is not an Owner`);
    if (!Number.isInteger(o.owner_priority) || o.owner_priority < 0 || o.owner_priority > 1000) throw new ValidationError('owner_priority must be a whole number from 0 to 1000');
    if (typeof o.is_primary_owner !== 'boolean') throw new ValidationError('is_primary_owner must be true or false');
    if (o.is_primary_owner) primaries++;
  }
  if (primaries > 1) throw new ValidationError('At most one primary Owner');
  return withTransaction(pool, async (db) => {
    await db.query(`UPDATE users SET is_primary_owner = false WHERE role = $1 AND is_primary_owner AND NOT (id = ANY($2))`, [OWNER, list.filter((o: Row) => o.is_primary_owner).map((o: Row) => o.id)]);
    for (const o of list) await db.query('UPDATE users SET is_primary_owner = false WHERE id = $1', [o.id]);
    for (const o of list) await db.query('UPDATE users SET owner_priority = $2, is_primary_owner = $3, updated_at = now() WHERE id = $1', [o.id, o.owner_priority, o.is_primary_owner]);
    const after = await ownerRoutingPolicy(db);
    await writeAudit(db, actor, { action: 'authority.owner_routing.update', entityType: 'owner_routing_policy', entityId: 'owners', before: { owners: before.owners.map((o: Row) => ({ id: o.id, owner_priority: o.owner_priority, is_primary_owner: o.is_primary_owner })) }, after: { owners: after.owners.map((o: Row) => ({ id: o.id, owner_priority: o.owner_priority, is_primary_owner: o.is_primary_owner })), receives_fallbacks: after.receives_fallbacks?.id ?? null } });
    const routing_changes = await reevaluateRoutes(db, actor, {}, 'Owner routing policy changed');
    return { ...after, routing_changes };
  });
}

// ------------------------------------------------------------------ SLA policies
export async function slaSettings(db: Db) {
  const policies = (await db.query(`SELECT s.*, t.label FROM approval_sla_policies s JOIN authority_decision_types t ON t.key = s.decision_type ORDER BY s.decision_type`)).rows.map((r) => ({ ...r, sla_business_days: Number(r.sla_business_days) }));
  const cal = (await db.query('SELECT working_days, utc_offset_minutes FROM business_calendar WHERE id = 1')).rows[0];
  const holidays = (await db.query(`SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM business_holidays ORDER BY day`)).rows;
  return { policies, calendar: { ...cal, holidays }, note: 'SLAs set when approvals are due and when they are escalated. They never change who may approve: that is the authority policy.' };
}

const SLA_FIELDS = ['sla_business_days', 'reminder_pct', 'due_soon_pct', 'escalate_pct', 'escalate_to', 'reason'];
export async function setSlaPolicy(pool: Pool, ctx: AccessContext, actor: AuditActor, decisionType: string, body: unknown) {
  requireOwner(ctx, 'approval SLA settings');
  if (!ctx.can('authority.manage')) throw new ForbiddenError('Missing permission: authority.manage');
  const b = (body && typeof body === 'object' ? body : {}) as Row;
  const extra = Object.keys(b).filter((k) => !SLA_FIELDS.includes(k));
  if (extra.length) throw new ValidationError(`Not allowed: ${extra.join(', ')}`);
  const current = (await pool.query('SELECT * FROM approval_sla_policies WHERE decision_type = $1', [decisionType])).rows[0];
  if (!current) throw notFound(`SLA policy ${decisionType}`);
  const next = { ...current, ...Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'reason')) };
  const days = Number(next.sla_business_days);
  if (!Number.isFinite(days) || days <= 0 || days > 60) throw new ValidationError('sla_business_days must be more than 0 and at most 60');
  for (const k of ['reminder_pct', 'due_soon_pct', 'escalate_pct']) if (!Number.isInteger(next[k])) throw new ValidationError(`${k} must be a whole number`);
  if (!(next.reminder_pct >= 1 && next.reminder_pct < next.due_soon_pct && next.due_soon_pct <= 99 && next.escalate_pct > 100 && next.escalate_pct <= 1000)) throw new ValidationError('Thresholds must be reminder < due soon < 100 < escalation (at most 1000)');
  if (!['owner', 'next_eligible'].includes(next.escalate_to)) throw new ValidationError('escalate_to must be owner or next_eligible');
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');
  return withTransaction(pool, async (db) => {
    const row = (
      await db.query(
        `UPDATE approval_sla_policies SET sla_business_days = $2, reminder_pct = $3, due_soon_pct = $4, escalate_pct = $5, escalate_to = $6, updated_at = now(), updated_by = $7 WHERE decision_type = $1 RETURNING *`,
        [decisionType, days, next.reminder_pct, next.due_soon_pct, next.escalate_pct, next.escalate_to, ctx.user.id]
      )
    ).rows[0];
    await writeAudit(db, actor, { action: 'approval.sla.update', entityType: 'approval_sla_policy', entityId: decisionType, before: current, after: row, details: reason });
    return { ...row, sla_business_days: Number(row.sla_business_days), note: 'Applies to approvals requested from now on; pending approvals keep the due date they were given.' };
  });
}

// ------------------------------------------------------------------ Owner Exception Center
export type ExceptionSeverity = 'critical' | 'urgent' | 'attention' | 'info';
const SEV_RANK: Record<ExceptionSeverity, number> = { critical: 0, urgent: 1, attention: 2, info: 3 };
interface Factor {
  code: string;
  label: string;
  points: number;
  level: ExceptionSeverity | null;
}
export interface OwnerException {
  id: string;
  type: string;
  severity: ExceptionSeverity;
  priority_score: number;
  reasons: Factor[];
  title: string;
  project_id: string | null;
  project_name: string | null;
  client_name: string | null;
  decision: string | null;
  status: string | null;
  current_approver: { id: string; name: string; role: string } | null;
  value: number | null;
  risk: string | null;
  due_at: string | null;
  age_hours: number | null;
  why_owner: string;
  recommended: string;
  link: { tab: string; focus?: { type: string; id: string } } | null;
  resource: { kind: RoutedKind; id: string } | null;
  actions: string[];
  snoozed_until?: string | null;
}

const MAX_SNOOZE_HOURS = 168;

function finish(e: Omit<OwnerException, 'severity' | 'priority_score'>, floor: ExceptionSeverity = 'info'): OwnerException {
  const severity = e.reasons.reduce<ExceptionSeverity>((s, f) => (f.level && SEV_RANK[f.level] < SEV_RANK[s] ? f.level : s), floor);
  return { ...e, severity, priority_score: e.reasons.reduce((s, f) => s + f.points, 0) };
}

/** Everything that needs the Owner now. Severity and priority come from server rules, with their reasons. */
export async function ownerExceptions(pool: Pool, ctx: AccessContext, now = new Date()) {
  requireOwner(ctx);
  const { cal, policies } = await lifecycleContext(pool);
  const cache: ContextCache = new Map();
  const out: OwnerException[] = [];
  const snoozes = new Map((await pool.query('SELECT * FROM owner_exception_snoozes WHERE snoozed_until > $1', [now])).rows.map((s) => [s.exception_key as string, s]));
  const today = new Date(now.getTime() + cal.offsetMs).toISOString().slice(0, 10);
  const localDay = (d: Date) => new Date(d.getTime() + cal.offsetMs).toISOString().slice(0, 10);

  // ---------- approvals
  const routes = (
    await pool.query(
      `SELECT ar.*, p.project_name, p.risk_status, p.project_status, p.sensitivity AS live_sensitivity, c.company_name AS client_name, u.name AS assignee_name, u.role AS assignee_role, u.is_active AS assignee_active,
              ap.approval_type, ap.related_entity_type AS related_type, ci.data->>'due_date' AS invoice_due
       FROM approval_routes ar
       LEFT JOIN projects p ON p.id = ar.project_id
       LEFT JOIN clients c ON c.id = ar.client_id
       LEFT JOIN users u ON u.id = ar.assigned_user_id
       LEFT JOIN approvals ap ON ar.resource_kind = 'approval' AND ap.id = ar.resource_id
       LEFT JOIN commercial_invoices ci ON ar.resource_kind = 'invoice' AND ci.id = ar.resource_id
       WHERE ar.status = 'open' AND ar.routing_basis <> 'CLIENT_CONSENT' ORDER BY ar.id`
    )
  ).rows;
  const blockedProduction = new Set((await pool.query(`SELECT DISTINCT project_id FROM production_orders WHERE status NOT IN ('Completed', 'Cancelled') AND (status = 'Blocked' OR drawing_check = 'invalid')`)).rows.map((r) => r.project_id as string));
  for (const r of routes) {
    if (r.project_id && !ctx.canSeeProject(r.project_id)) continue;
    const life = lifecycleOf(r, cal, policies, now);
    const valid = await assigneeMayDecide(pool, r, cache, now);
    const toOwner = r.assignee_role === OWNER;
    const f: Factor[] = [];
    const title = r.data?.title ?? `${r.resource_kind} ${r.resource_id}`;
    let type = 'OWNER_DECISION';
    let why = '';
    let recommended = 'Decide it (approve, reject or request changes) on the record.';
    if (!valid.ok && (valid.code === 'APPROVER_INACTIVE' || toOwner)) {
      type = 'NO_VALID_APPROVER';
      f.push({ code: 'NO_VALID_APPROVER', label: `Nobody assigned may decide it: ${valid.reason}`, points: 100, level: 'critical' });
      why = 'No valid approver: the approval is blocked until someone who may decide it has it.';
      recommended = 'Re-route it now, or assign it to someone the authority policy allows.';
    } else if (!valid.ok) {
      type = 'AUTHORITY_CONFLICT';
      f.push({ code: 'AUTHORITY_CONFLICT', label: `${r.assignee_name} may no longer decide it (${valid.code})`, points: 50, level: 'urgent' });
      why = `Assigned to ${r.assignee_name}, whose authority no longer covers it; the monitor re-routes it on its next run.`;
      recommended = 'Re-route it now.';
    }
    if (r.owner_reason_code === 'PROJECT_CLOSED') {
      type = type === 'OWNER_DECISION' ? 'CLOSED_PROJECT_REVIEW' : type;
      f.push({ code: 'PROJECT_CLOSED', label: `Still pending on a ${r.project_status} project`, points: 30, level: 'urgent' });
      why ||= 'The project is closed: pending approvals are not delegated, the Owner decides or withdraws them.';
      recommended = 'Decide it, or withdraw / cancel it on the record (nothing is deleted).';
    }
    if (life.state === 'escalated') {
      if (type === 'OWNER_DECISION') type = 'ESCALATED_APPROVAL';
      f.push({ code: 'ESCALATED', label: `Escalated: overdue past the escalation threshold${life.escalation_count ? '' : ''}`, points: 50, level: 'urgent' });
      why ||= toOwner ? 'Escalated to you: it was overdue with the approver.' : `Escalated to ${r.assignee_name}; you are told because it is overdue.`;
      recommended = toOwner ? 'Decide it, or assign it to someone who will decide today.' : `Chase ${r.assignee_name}, or take it.`;
    } else if (life.state === 'overdue') {
      if (type === 'OWNER_DECISION') type = 'OVERDUE_APPROVAL';
      const late = Math.max(0, (life.sla_percent! - 100) / 100) * (life.sla_business_days ?? 1);
      f.push({ code: 'OVERDUE', label: `Overdue by ${late.toFixed(1)} working day(s)`, points: 40 + Math.min(30, Math.round(late * 5)), level: 'urgent' });
      why ||= toOwner ? 'Waiting for you and overdue.' : `Overdue with ${r.assignee_name}.`;
      if (!toOwner && valid.ok) recommended = `Chase ${r.assignee_name}, or re-assign it.`;
    } else if (life.state === 'due_soon') {
      f.push({ code: 'DUE_SOON', label: `Due ${life.due_at ? localDay(new Date(life.due_at)) : 'soon'}`, points: 10, level: 'attention' });
    }
    const sensitivity = r.live_sensitivity ?? r.project_sensitivity;
    if (sensitivity === 'Strategic') f.push({ code: 'STRATEGIC', label: 'Strategic project: only the Owner decides', points: 80, level: toOwner ? 'critical' : 'urgent' });
    else if (sensitivity === 'Sensitive') f.push({ code: 'SENSITIVE', label: 'Sensitive project', points: 20, level: null });
    if (r.approval_type && /safety/i.test(r.approval_type)) f.push({ code: 'SAFETY', label: 'Safety-related decision', points: 100, level: 'critical' });
    if (r.decision_type === 'drawing' && r.project_id && blockedProduction.has(r.project_id)) f.push({ code: 'PRODUCTION_BLOCKED', label: 'Production is blocked on this project', points: 60, level: 'critical' });
    if ((r.approval_type && /site|installation/i.test(r.approval_type)) || r.related_type === 'installation') f.push({ code: 'SITE_BLOCKED', label: 'Site work is waiting for it', points: 40, level: 'critical' });
    if (r.decision_type === 'invoice' && (life.state === 'overdue' || life.state === 'escalated' || (r.invoice_due && r.invoice_due.slice(0, 10) <= today))) f.push({ code: 'PAYMENT_BLOCKED', label: `Payment cannot be made until it is approved${r.invoice_due ? ` (invoice due ${r.invoice_due.slice(0, 10)})` : ''}`, points: 40, level: 'critical' });
    if (r.risk_status === 'Critical') f.push({ code: 'PROJECT_CRITICAL', label: 'Project risk: Critical', points: 40, level: 'critical' });
    else if (r.risk_status === 'At Risk') f.push({ code: 'PROJECT_AT_RISK', label: 'Project risk: At Risk', points: 20, level: null });
    const value = r.value == null ? null : Number(r.value);
    if (value !== null && value >= 100000) f.push({ code: 'HIGH_VALUE', label: `RM ${Math.round(value).toLocaleString('en-US')}`, points: 20, level: null });
    else if (value !== null && value >= 20000) f.push({ code: 'VALUE', label: `RM ${Math.round(value).toLocaleString('en-US')}`, points: 10, level: null });
    const days = Math.floor(life.age_hours / 24);
    if (days > 0) f.push({ code: 'AGE', label: `Waiting ${days} day(s)`, points: Math.min(20, days * 2), level: null });

    // Only what needs the Owner: routed to an Owner, or a delegated one that is late, escalated or invalid.
    const needsOwner = toOwner || f.some((x) => ['NO_VALID_APPROVER', 'AUTHORITY_CONFLICT', 'ESCALATED', 'OVERDUE', 'PROJECT_CLOSED'].includes(x.code));
    if (!needsOwner) continue;
    if (toOwner && type === 'OWNER_DECISION') {
      why = r.owner_reason_code === 'OWNER_ASSIGNED' ? 'You took this approval.' : `Routed to you: ${r.data?.owner_reason ?? r.owner_reason_code ?? 'no delegate may decide it'}.`;
      f.unshift({ code: 'OWNER_REQUIRED', label: r.owner_reason_code === 'NO_MATCHING_AUTHORITY' ? 'No eligible delegated authority' : `Owner required (${r.owner_reason_code ?? 'policy'})`, points: 20, level: null });
    }
    const ownerMay = toOwner ? valid : await assigneeMayDecide(pool, { ...r, assigned_user_id: ctx.user.id, routing_basis: 'OWNER_FALLBACK' }, cache, now);
    const actions = ['open', 'history', 'reroute', 'assign'];
    if (r.resource_kind === 'approval' && ownerMay.ok) actions.push('approve', 'reject', 'request_changes');
    out.push(
      finish(
        {
          id: `approval:${r.resource_kind}:${r.resource_id}`,
          type,
          reasons: f,
          title,
          project_id: r.project_id,
          project_name: r.project_name ?? null,
          client_name: r.client_name ?? null,
          decision: r.decision_type,
          status: life.status,
          current_approver: valid.ok || valid.code !== 'APPROVER_INACTIVE' ? { id: r.assigned_user_id, name: r.assignee_name, role: r.assignee_role } : null,
          value,
          risk: r.risk_status ?? null,
          due_at: life.due_at,
          age_hours: life.age_hours,
          why_owner: why,
          recommended,
          link: r.data?.link ?? null,
          resource: { kind: r.resource_kind, id: r.resource_id },
          actions,
        },
        'attention'
      )
    );
  }
  for (const o of await unroutedDecisions(pool)) {
    if (o.project_id && !ctx.canSeeProject(o.project_id)) continue;
    out.push(finish({ id: `approval:${o.kind}:${o.id}`, type: 'NO_VALID_APPROVER', reasons: [{ code: 'NO_ROUTE', label: 'Pending with nobody assigned', points: 100, level: 'critical' }], title: `${o.kind} ${o.id}`, project_id: o.project_id, project_name: null, client_name: null, decision: null, status: 'Pending', current_approver: null, value: null, risk: null, due_at: null, age_hours: null, why_owner: 'No valid approver: nobody has this approval.', recommended: 'Route it now (Re-route).', link: null, resource: { kind: o.kind, id: o.id }, actions: ['reroute', 'assign'] }));
  }

  // ---------- projects, issues, delegation, escalations from other rules
  const projects = (await pool.query(`SELECT id, project_name, risk_status, risk_reason FROM projects WHERE project_status NOT IN ('Completed', 'Closed', 'Cancelled') AND risk_status IN ('Critical', 'At Risk', 'Attention') ORDER BY id`)).rows.filter((p) => ctx.canSeeProject(p.id));
  for (const p of projects) {
    const level: ExceptionSeverity = p.risk_status === 'Critical' ? 'critical' : p.risk_status === 'At Risk' ? 'urgent' : 'attention';
    const reasons = String(p.risk_reason ?? '').split('; ').filter(Boolean);
    out.push(finish({ id: `project:${p.id}:${p.risk_status}`, type: p.risk_status === 'Critical' ? 'CRITICAL_PROJECT' : p.risk_status === 'At Risk' ? 'AT_RISK_PROJECT' : 'PROJECT_BECOMING_RISKY', reasons: [{ code: 'PROJECT_RISK', label: `Project risk: ${p.risk_status}`, points: level === 'critical' ? 60 : level === 'urgent' ? 30 : 10, level }, ...reasons.map((r: string) => ({ code: 'RISK_SIGNAL', label: r, points: 0, level: null }))], title: `${p.project_name} is ${p.risk_status}`, project_id: p.id, project_name: p.project_name, client_name: null, decision: null, status: p.risk_status, current_approver: null, value: null, risk: p.risk_status, due_at: null, age_hours: null, why_owner: `The risk engine rates this project ${p.risk_status}.`, recommended: 'Open the project and act on the top risk signals.', link: { tab: 'projects', focus: { type: 'project', id: p.id } }, resource: null, actions: ['open'] }));
  }
  const issues = (await pool.query(`SELECT i.id, i.project_id, i.created_at, i.data->>'title' AS title, i.data->>'category' AS category, p.project_name FROM issues i JOIN projects p ON p.id = i.project_id WHERE i.status NOT IN ('Resolved', 'Closed') AND i.priority = 'Critical' AND p.project_status NOT IN ('Completed', 'Closed', 'Cancelled') ORDER BY i.id`)).rows.filter((i) => ctx.canSeeProject(i.project_id));
  for (const i of issues) {
    const safety = /safety/i.test(i.category ?? '') || /safety/i.test(i.title ?? '');
    out.push(finish({ id: `issue:${i.id}`, type: 'CRITICAL_ISSUE', reasons: [{ code: safety ? 'SAFETY' : 'CRITICAL_ISSUE', label: safety ? 'Safety issue' : 'Critical issue', points: safety ? 100 : 40, level: safety ? 'critical' : 'urgent' }], title: i.title ?? i.id, project_id: i.project_id, project_name: i.project_name, client_name: null, decision: null, status: 'Open', current_approver: null, value: null, risk: null, due_at: null, age_hours: Math.round((now.getTime() - new Date(i.created_at).getTime()) / HOUR), why_owner: 'A critical issue is open.', recommended: 'Open the issue and confirm someone owns the fix.', link: { tab: 'issues', focus: { type: 'issue', id: i.id } }, resource: null, actions: ['open'] }));
  }
  const expiring = (await pool.query(`SELECT id, code, name, end_at, project_id FROM delegated_authorities WHERE kind = 'owner' AND active AND end_at > $1 AND end_at <= $1::timestamptz + interval '7 days' ORDER BY end_at`, [now])).rows;
  for (const d of expiring) {
    out.push(finish({ id: `delegation:${d.id}:expiring`, type: 'DELEGATION_EXPIRING', reasons: [{ code: 'DELEGATION_EXPIRING', label: `Ends ${localDay(new Date(d.end_at))}`, points: 10, level: 'attention' }], title: `Delegation ${d.code} (${d.name}) expires soon`, project_id: d.project_id, project_name: null, client_name: null, decision: null, status: 'Active', current_approver: null, value: null, risk: null, due_at: new Date(d.end_at).toISOString(), age_hours: null, why_owner: 'Approvals it covers will come to you once it ends.', recommended: 'Renew it, or let it end on purpose.', link: { tab: 'authority' }, resource: null, actions: ['open'] }));
  }
  const otherEsc = (await pool.query(`SELECT id, project_id, created_at, data->>'title' AS title, data->>'reason' AS reason FROM escalations WHERE status = 'Open' AND level = 2 AND coalesce(data->>'rule_key', '') <> 'approval_monitor' ORDER BY id`)).rows.filter((e) => !e.project_id || ctx.canSeeProject(e.project_id));
  for (const e of otherEsc) {
    out.push(finish({ id: `escalation:${e.id}`, type: 'ESCALATION', reasons: [{ code: 'ESCALATED', label: e.reason ?? 'Escalated to the Owner', points: 30, level: 'urgent' }], title: e.title ?? e.id, project_id: e.project_id, project_name: null, client_name: null, decision: null, status: 'Open', current_approver: null, value: null, risk: null, due_at: null, age_hours: Math.round((now.getTime() - new Date(e.created_at).getTime()) / HOUR), why_owner: 'Automation escalated this to the Owner.', recommended: 'Open it and acknowledge or act.', link: { tab: 'notifications' }, resource: null, actions: ['open'] }));
  }
  const failing = (await pool.query(`SELECT DISTINCT ON (rule_key) rule_key, status, error, started_at FROM automation_runs WHERE started_at > $1::timestamptz - interval '24 hours' ORDER BY rule_key, id DESC`, [now])).rows.filter((r) => r.status === 'failed');
  for (const r of failing) {
    const monitor = r.rule_key === 'approval_monitor';
    out.push(finish({ id: `system:${r.rule_key}`, type: 'SYSTEM_WARNING', reasons: [{ code: 'AUTOMATION_FAILED', label: String(r.error ?? 'failed').slice(0, 200), points: monitor ? 30 : 0, level: monitor ? 'urgent' : 'info' }], title: `Automation "${r.rule_key}" is failing`, project_id: null, project_name: null, client_name: null, decision: null, status: 'Failed', current_approver: null, value: null, risk: null, due_at: null, age_hours: null, why_owner: monitor ? 'The approval monitor could not check every approval.' : 'An automation rule failed; it retries on its own.', recommended: 'Open Automation to see the run log.', link: { tab: 'automation' }, resource: null, actions: ['open'] }));
  }

  // ---------- informational (last 24 hours / 7 days)
  const info: OwnerException[] = [];
  for (const r of (await pool.query(`SELECT ar.resource_kind, ar.resource_id, ar.completion_result, ar.completed_at, ar.project_id, ar.data->>'title' AS title, u.name AS by_name FROM approval_routes ar LEFT JOIN users u ON u.id = ar.completed_by WHERE ar.status = 'completed' AND ar.completed_at > $1::timestamptz - interval '24 hours' ORDER BY ar.completed_at DESC LIMIT 20`, [now])).rows) {
    if (r.project_id && !ctx.canSeeProject(r.project_id)) continue;
    info.push(finish({ id: `done:${r.resource_kind}:${r.resource_id}`, type: 'APPROVAL_COMPLETED', reasons: [], title: `${COMPLETED[r.completion_result] ?? 'Closed'}: ${r.title ?? r.resource_id}`, project_id: r.project_id, project_name: null, client_name: null, decision: null, status: COMPLETED[r.completion_result] ?? 'Closed', current_approver: null, value: null, risk: null, due_at: null, age_hours: null, why_owner: `Decided by ${r.by_name ?? 'someone'}.`, recommended: 'Nothing to do.', link: null, resource: { kind: r.resource_kind, id: r.resource_id }, actions: ['history'] }));
  }
  for (const a of (await pool.query(`SELECT action, entity_id, actor_name, occurred_at, details FROM audit_logs WHERE entity_type = 'delegated_authority' AND occurred_at > $1::timestamptz - interval '7 days' ORDER BY id DESC LIMIT 10`, [now])).rows) {
    info.push(finish({ id: `delegation-change:${a.entity_id}:${new Date(a.occurred_at).getTime()}`, type: 'DELEGATION_CHANGE', reasons: [], title: `${a.action.replace('authority.rule.', 'Rule ')} by ${a.actor_name}`, project_id: null, project_name: null, client_name: null, decision: null, status: null, current_approver: null, value: null, risk: null, due_at: null, age_hours: Math.round((now.getTime() - new Date(a.occurred_at).getTime()) / HOUR), why_owner: a.details ?? 'Delegated authority changed.', recommended: 'Nothing to do.', link: { tab: 'authority' }, resource: null, actions: ['open'] }));
  }

  // Snoozes hide non-critical items until they expire; a critical item is never hidden.
  const visible: OwnerException[] = [];
  const snoozed: OwnerException[] = [];
  for (const e of out) {
    const s = snoozes.get(e.id);
    if (s && e.severity !== 'critical') snoozed.push({ ...e, snoozed_until: new Date(s.snoozed_until).toISOString() });
    else visible.push(e);
  }
  const sort = (a: OwnerException, b: OwnerException) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || b.priority_score - a.priority_score || a.id.localeCompare(b.id);
  visible.sort(sort);
  const approvals = visible.filter((e) => e.id.startsWith('approval:'));
  const allRoutes = routes.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
  const summary = {
    critical: visible.filter((e) => e.severity === 'critical').length,
    urgent: visible.filter((e) => e.severity === 'urgent').length,
    attention: visible.filter((e) => e.severity === 'attention').length,
    approvals: {
      overdue: approvals.filter((e) => e.status === 'Overdue' || e.status === 'Escalated').length,
      blocked: approvals.filter((e) => e.type === 'NO_VALID_APPROVER' || e.type === 'AUTHORITY_CONFLICT').length,
      escalated: approvals.filter((e) => e.status === 'Escalated').length,
      due_today: allRoutes.filter((r) => r.due_at && localDay(new Date(r.due_at)) === today).length,
      waiting_for_owner: approvals.filter((e) => e.current_approver?.role === OWNER).length,
    },
    projects: { critical: projects.filter((p) => p.risk_status === 'Critical').length, at_risk: projects.filter((p) => p.risk_status === 'At Risk').length },
    delegation: { rules_expiring: expiring.length, approvals_with_no_delegate: allRoutes.filter((r) => r.routing_basis === 'OWNER_FALLBACK' && ['NO_MATCHING_AUTHORITY', 'OWNER_REQUIRED'].includes(r.owner_reason_code)).length },
  };
  return { question: 'What requires my attention right now?', summary, exceptions: visible, informational: info, snoozed: snoozed.sort(sort), computed_at: now.toISOString() };
}

export async function snoozeException(pool: Pool, ctx: AccessContext, actor: AuditActor, body: unknown, now = new Date()) {
  requireOwner(ctx, 'snooze');
  const b = (body && typeof body === 'object' ? body : {}) as Row;
  const extra = Object.keys(b).filter((k) => !['id', 'hours', 'reason'].includes(k));
  if (extra.length) throw new ValidationError(`Not allowed: ${extra.join(', ')}`);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (typeof b.id !== 'string' || !b.id) throw new ValidationError('id is required');
  if (!reason) throw new ValidationError('A reason is required');
  if (!Number.isInteger(b.hours) || b.hours < 1 || b.hours > MAX_SNOOZE_HOURS) throw new ValidationError(`hours must be a whole number from 1 to ${MAX_SNOOZE_HOURS}`);
  // The server finds the exception and its severity itself; critical ones cannot be snoozed.
  const current = await ownerExceptions(pool, ctx, now);
  const e = [...current.exceptions, ...current.snoozed].find((x) => x.id === b.id);
  if (!e) throw notFound(`Exception ${b.id}`);
  if (e.severity === 'critical') throw new ValidationError('A critical exception cannot be snoozed (safety, Strategic, blocked production / site / payment, no valid approver, critical project)');
  const until = new Date(now.getTime() + b.hours * HOUR);
  return withTransaction(pool, async (db) => {
    await db.query(
      `INSERT INTO owner_exception_snoozes (exception_key, snoozed_until, reason, snoozed_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (exception_key) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until, reason = EXCLUDED.reason, snoozed_by = EXCLUDED.snoozed_by, created_at = now()`,
      [e.id, until, reason, ctx.user.id]
    );
    await writeAudit(db, actor, { action: 'owner_exception.snooze', entityType: 'owner_exception', entityId: e.id, projectId: e.project_id, after: { severity: e.severity, snoozed_until: until.toISOString(), hours: b.hours }, details: reason });
    return { id: e.id, snoozed_until: until.toISOString(), next_reminder: until.toISOString() };
  });
}

export async function unsnoozeException(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string) {
  requireOwner(ctx, 'snooze');
  return withTransaction(pool, async (db) => {
    const gone = await db.query('DELETE FROM owner_exception_snoozes WHERE exception_key = $1', [id]);
    if (gone.rowCount) await writeAudit(db, actor, { action: 'owner_exception.unsnooze', entityType: 'owner_exception', entityId: id });
    return { id, removed: Boolean(gone.rowCount) };
  });
}
