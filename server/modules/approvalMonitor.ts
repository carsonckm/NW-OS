/**
 * The approval monitor (Phase 6 Batch 4, docs/phase6-approval-monitoring.md): an automation
 * rule on the existing Phase 5 engine (its scheduler, lease, run log and action ledger), not a
 * second scheduler. No approval may sit unattended, orphaned, or with someone who may no longer
 * decide it.
 *
 *   every open route (bounded batch, least recently checked first), each in its own short
 *   transaction with the route row locked (FOR UPDATE SKIP LOCKED):
 *     decided / withdrawn            -> route closed
 *     project closed                 -> Owner review (PROJECT_CLOSED), no reminders
 *     assignee may no longer decide  -> re-routed (route_reason authority_changed), the
 *        (inactive, rule expired or deactivated, sensitivity raised, permission removed:
 *         the authority resolver says so)
 *     SLA working time elapsed       -> reminded (50%) -> due soon (80%) -> overdue (100%)
 *                                       -> escalated (150%) to the Owner or the next eligible
 *                                          delegate (route_reason escalated_overdue)
 *   pending decisions with no route  -> routed (the no-orphan invariant)
 *
 * Idempotent: lifecycle states only move forward and are stored on the route; notifications
 * and escalation records go through the engine's action ledger, keyed by the decision, the
 * stage and the person, so a second run (or a second server) repeats nothing. A failed
 * notification leaves the route as it is and is retried on the next run.
 */
import { writeAudit, type AuditActor } from '../audit';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import type { PlannedAction, RuleDef } from '../automation/types';
import {
  assigneeMayDecide,
  computeRouting,
  decisionState,
  fallbackOwner,
  insertRoute,
  syncRoute,
  unroutedDecisions,
  type ContextCache,
  type LifecycleState,
  type RouteRow,
  type RoutedKind,
} from './approvalRouting';
import { businessElapsedMs, DAY_MS, loadCalendar, type BusinessCalendar } from './businessCalendar';

type Row = Record<string, any>;

export const MONITOR_ACTOR: AuditActor = { id: null, name: 'NW OS Approval Monitor', role: 'system' };
export const LIFECYCLE_RANK: Record<LifecycleState, number> = { assigned: 0, reminded: 1, due_soon: 2, overdue: 3, escalated: 4 };
const CLOSED_PROJECT = new Set(['Completed', 'Closed', 'Cancelled']);

export interface SlaPolicy {
  decision_type: string;
  sla_business_days: number;
  reminder_pct: number;
  due_soon_pct: number;
  escalate_pct: number;
  escalate_to: 'owner' | 'next_eligible';
}
const DEFAULT_POLICY: Omit<SlaPolicy, 'decision_type'> = { sla_business_days: 1, reminder_pct: 50, due_soon_pct: 80, escalate_pct: 150, escalate_to: 'owner' };

export async function loadPolicies(db: Pool | PoolClient): Promise<Map<string, SlaPolicy>> {
  const rows = (await db.query('SELECT * FROM approval_sla_policies')).rows;
  return new Map(rows.map((r) => [r.decision_type as string, { ...r, sla_business_days: Number(r.sla_business_days) } as SlaPolicy]));
}

/** How far through its SLA a route is, in working time (percent; 100 = due now). */
export function slaPercent(cal: BusinessCalendar, route: Pick<RouteRow, 'requested_at'> & { sla_business_days?: unknown }, now: Date) {
  const sla = Number(route.sla_business_days);
  if (!Number.isFinite(sla) || sla <= 0) return null;
  return (businessElapsedMs(cal, new Date(route.requested_at), now) / (sla * DAY_MS)) * 100;
}

/** The lifecycle state the SLA alone puts a route in (before escalation). */
export function stageFor(pct: number, p: Pick<SlaPolicy, 'reminder_pct' | 'due_soon_pct'>): LifecycleState {
  if (pct >= 100) return 'overdue';
  if (pct >= p.due_soon_pct) return 'due_soon';
  if (pct >= p.reminder_pct) return 'reminded';
  return 'assigned';
}

/** Checks one open route; returns the route as it now stands (undefined if no longer open). */
async function checkRoute(db: PoolClient, routeId: number, now: Date, policies: Map<string, SlaPolicy>, cal: BusinessCalendar, cache: ContextCache): Promise<RouteRow | undefined> {
  let route = (await db.query(`SELECT * FROM approval_routes WHERE id = $1 AND status = 'open' FOR UPDATE SKIP LOCKED`, [routeId])).rows[0] as RouteRow | undefined;
  if (!route) return undefined; // decided meanwhile, or being written by someone right now
  const kind = route.resource_kind as RoutedKind;
  const id = route.resource_id;
  const state = await decisionState(db, kind, id);
  if (!state || !state.pending) {
    await syncRoute(db, MONITOR_ACTOR, kind, id, { now });
    return undefined;
  }

  // 1. Is the route still valid? Closed project -> Owner review; otherwise ask the resolver.
  const project = state.projectId ? (await db.query('SELECT project_status FROM projects WHERE id = $1', [state.projectId])).rows[0] : undefined;
  if (project && CLOSED_PROJECT.has(project.project_status)) {
    if (route.owner_reason_code !== 'PROJECT_CLOSED') route = (await syncRoute(db, MONITOR_ACTOR, kind, id, { cache, now, why: `project ${project.project_status}` })) ?? route;
    await db.query('UPDATE approval_routes SET last_checked_at = $2 WHERE id = $1', [route.id, now]);
    return route;
  }
  const valid = await assigneeMayDecide(db, route, cache, now);
  if (!valid.ok) {
    route = (await syncRoute(db, MONITOR_ACTOR, kind, id, { cache, now, reason: 'authority_changed', why: `${valid.code}: ${valid.reason}` })) ?? route;
  }
  if (route.routing_basis === 'CLIENT_CONSENT' || route.sla_business_days == null) {
    await db.query('UPDATE approval_routes SET last_checked_at = $2 WHERE id = $1', [route.id, now]);
    return route;
  }

  // 2. Lifecycle from the SLA (working time since the decision was requested).
  const policy = { ...DEFAULT_POLICY, ...(policies.get(route.decision_type as string) ?? {}) };
  const pct = slaPercent(cal, route, now)!;
  if (pct >= policy.escalate_pct && route.escalation_count === 0 && route.lifecycle_state !== 'escalated') {
    return escalate(db, route, state, policy, pct, now, cache);
  }
  const target = stageFor(pct, policy);
  const rank = LIFECYCLE_RANK[target];
  if (rank > LIFECYCLE_RANK[route.lifecycle_state]) {
    route = (
      await db.query(
        `UPDATE approval_routes SET lifecycle_state = $2, last_checked_at = $4,
           reminded_at = CASE WHEN $3 >= 1 THEN coalesce(reminded_at, $4) ELSE reminded_at END,
           due_soon_at = CASE WHEN $3 >= 2 THEN coalesce(due_soon_at, $4) ELSE due_soon_at END,
           overdue_at  = CASE WHEN $3 >= 3 THEN coalesce(overdue_at, $4) ELSE overdue_at END
         WHERE id = $1 RETURNING *`,
        [route.id, target, rank, now]
      )
    ).rows[0];
    await writeAudit(db, MONITOR_ACTOR, {
      action: 'approval.route.lifecycle',
      entityType: 'approval_route',
      entityId: String(route.id),
      projectId: route.project_id as string | null,
      after: { resource: `${kind}:${id}`, lifecycle: target, sla_percent: Math.round(pct), assignee: route.assigned_user_id },
    });
  } else {
    await db.query('UPDATE approval_routes SET last_checked_at = $2 WHERE id = $1', [route.id, now]);
  }
  return route;
}

/**
 * Escalation (once per decision): re-checked authority already passed; the next eligible
 * delegate when the policy says so, otherwise (or if there is none) the Owner. If the Owner
 * already has it, it is marked escalated without moving.
 */
async function escalate(db: PoolClient, route: RouteRow, state: NonNullable<Awaited<ReturnType<typeof decisionState>>>, policy: SlaPolicy | typeof DEFAULT_POLICY, pct: number, now: Date, cache: ContextCache) {
  const kind = route.resource_kind as RoutedKind;
  const id = route.resource_id;
  const late = Math.max(0, ((pct - 100) / 100) * Number(route.sla_business_days));
  const why = `Overdue by ${late.toFixed(1)} working day(s) with ${(route.data as Row)?.assignee_name ?? route.assigned_user_id}`;
  let target: Parameters<typeof insertRoute>[5] | undefined;
  if (policy.escalate_to === 'next_eligible') {
    const d = await computeRouting(db, kind, id, cache, now);
    const next = d.eligible.find((c) => c.user_id !== route.assigned_user_id);
    if (next) target = { ...d, assignee: { id: next.user_id, name: next.name, role: next.role }, basis: next.basis!, ruleId: next.rule_id ?? null, ruleCode: next.rule_code ?? null, ownerReasonCode: null, ownerReason: null };
  }
  if (!target) {
    const owner = await fallbackOwner(db, kind, id, cache, now);
    // The Owner receives it only if the Owner may decide it (e.g. not the Owner's own variation);
    // otherwise it is escalated where it is and the Owners are told (escalation record).
    const ownerMay = owner.id === route.assigned_user_id || (await assigneeMayDecide(db, { ...route, assigned_user_id: owner.id, routing_basis: 'OWNER_FALLBACK' }, cache, now)).ok;
    if (owner.id === route.assigned_user_id || !ownerMay) {
      const row = (
        await db.query(
          `UPDATE approval_routes SET lifecycle_state = 'escalated', escalated_at = $2, escalation_count = escalation_count + 1, last_checked_at = $2,
             reminded_at = coalesce(reminded_at, $2), due_soon_at = coalesce(due_soon_at, $2), overdue_at = coalesce(overdue_at, $2)
           WHERE id = $1 RETURNING *`,
          [route.id, now]
        )
      ).rows[0] as RouteRow;
      await writeAudit(db, MONITOR_ACTOR, { action: 'approval.route.escalate', entityType: 'approval_route', entityId: String(route.id), projectId: route.project_id as string | null, after: { resource: `${kind}:${id}`, assignee: owner.id, reason: 'escalated_overdue' }, details: `${why}; ${ownerMay ? 'already with the Owner' : 'the Owner may not decide it, so it stays with the approver'}` });
      return row;
    }
    target = {
      assignee: owner,
      basis: 'OWNER_FALLBACK',
      ruleId: null,
      ruleCode: null,
      ownerReasonCode: 'ESCALATED_OVERDUE',
      ownerReason: why,
      decisionType: route.decision_type as string,
      projectId: route.project_id as string | null,
      clientId: route.client_id as string | null,
      sensitivity: route.project_sensitivity as string | null,
      value: route.value == null ? null : Number(route.value),
    };
  }
  const fresh = { ...route, reminded_at: route.reminded_at ?? now, due_soon_at: route.due_soon_at ?? now, overdue_at: route.overdue_at ?? now };
  return insertRoute(db, MONITOR_ACTOR, kind, id, state, target, fresh as RouteRow, { reason: 'escalated_overdue', why, now });
}

const STAGE_NOTE: Partial<Record<LifecycleState, { title: string; priority: 'normal' | 'high' | 'urgent'; type: 'action' | 'warning' }>> = {
  reminded: { title: 'Reminder', priority: 'normal', type: 'action' },
  due_soon: { title: 'Due soon', priority: 'high', type: 'warning' },
  overdue: { title: 'Overdue', priority: 'urgent', type: 'warning' },
};

/** The monitor pass. Returns the notifications / escalations for the engine to perform once each. */
export async function monitorPendingApprovals(pool: Pool, now: Date, config: Record<string, unknown> = {}, problems: string[] = []): Promise<PlannedAction[]> {
  const batch = Math.min(1000, Math.max(1, Number(config.batch_size) || 200));
  const policies = await loadPolicies(pool);
  const cal = await loadCalendar(pool);
  const cache: ContextCache = new Map();
  const fail = (what: string, err: unknown) => problems.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);

  // The no-orphan invariant: anything pending without a route is routed now.
  for (const o of (await unroutedDecisions(pool)).slice(0, batch)) {
    try {
      await withTransaction(pool, (db) => syncRoute(db, MONITOR_ACTOR, o.kind, o.id, { now, why: 'monitor: pending without a route' }));
    } catch (err) {
      fail(`${o.kind} ${o.id} has no route and could not be routed`, err);
    }
  }

  const ids = (await pool.query(`SELECT id FROM approval_routes WHERE status = 'open' ORDER BY last_checked_at NULLS FIRST, id LIMIT $1`, [batch])).rows.map((r) => Number(r.id));
  const checked: RouteRow[] = [];
  for (const id of ids) {
    try {
      const r = await withTransaction(pool, (db) => checkRoute(db, id, now, policies, cal, cache));
      if (r) checked.push(r);
    } catch (err) {
      // The transaction rolled back: the route stays as it was (assigned, never orphaned).
      fail(`approval route ${id} could not be checked`, err);
    }
  }

  const out: PlannedAction[] = [];
  // The approver is told once per stage (keyed by decision, stage and person).
  const notes: PlannedAction[] = [];
  for (const r of checked) {
    const stage = STAGE_NOTE[r.lifecycle_state];
    if (!stage || r.routing_basis === 'CLIENT_CONSENT') continue;
    const data = (r.data ?? {}) as Row;
    const due = r.due_at ? new Date(r.due_at).toISOString().slice(0, 10) : '-';
    notes.push({
      kind: 'notification',
      key: `approval_monitor:${r.resource_kind}:${r.resource_id}:${r.lifecycle_state}:${r.assigned_user_id}`,
      users: [r.assigned_user_id],
      note: { title: `${stage.title}: ${data.title ?? `${r.resource_kind} ${r.resource_id}`}`, message: `Due ${due}. Waiting since ${new Date(r.requested_at).toISOString().slice(0, 10)}.`, type: stage.type, priority: stage.priority, project_id: (r.project_id as string) ?? null, link_tab: 'approvals', entity_type: 'approval_route', entity_id: String(r.id) },
    });
  }
  const done = new Set(
    notes.length ? (await pool.query('SELECT action_key FROM automation_actions WHERE action_key = ANY($1)', [notes.map((n) => n.key)])).rows.map((r) => r.action_key as string) : []
  );
  out.push(...notes.filter((n) => !done.has(n.key)));

  // Escalation records for every escalated open decision (kept open while it is escalated; the
  // engine resolves them once the decision is taken).
  const escalated = (await pool.query(`SELECT ar.*, u.role AS assignee_role FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.status = 'open' AND ar.lifecycle_state = 'escalated'`)).rows as (RouteRow & Row)[];
  const owners = (await pool.query(`SELECT id FROM users WHERE role = 'Owner / CEO' AND is_active`)).rows.map((u) => u.id as string);
  for (const r of escalated) {
    const data = (r.data ?? {}) as Row;
    const title = data.title ?? `${r.resource_kind} ${r.resource_id}`;
    const toOwner = r.assignee_role === 'Owner / CEO';
    out.push({
      kind: 'escalation',
      key: `approval_monitor:${r.resource_kind}:${r.resource_id}:escalated:${r.escalation_count}`,
      level: 2,
      users: [...new Set([r.assigned_user_id, ...(toOwner ? [] : owners)])],
      record: { source_record_type: 'Approval', source_record_id: r.resource_id, project_id: r.project_id ?? null, title: `Approval overdue: ${title}`, reason: data.owner_reason ?? data.why ?? 'Overdue past the escalation threshold', previous_level: 'Approver', current_level: toOwner ? 'Owner' : 'Delegate', assigned_role: r.assignee_role, is_critical: true },
      note: { title: `Escalation: ${title}`, message: `Overdue (due ${r.due_at ? new Date(r.due_at).toISOString().slice(0, 10) : '-'}). Escalated to you.`, type: 'escalation', priority: 'urgent', project_id: r.project_id ?? null, link_tab: 'approvals', entity_type: 'approval_route', entity_id: String(r.id) },
    });
  }
  return out;
}

export const approvalMonitorRule: RuleDef = {
  key: 'approval_monitor',
  name: 'Approval monitor',
  description:
    'Checks every pending approval: re-routes it when its approver may no longer decide it, routes anything without a route, reminds the approver, marks it due soon and overdue, and escalates it past the threshold (SLA in working days per decision type).',
  watches: [],
  interval_minutes: 15,
  defaults: { batch_size: 200 },
  actions:
    'Re-route an approval whose approver may no longer decide (the authority resolver re-checks); remind the approver at 50% / 80% / 100% of the SLA; escalate at 150% to the Owner or the next eligible delegate; raise an escalation record for the Owner Exception Center.',
  human_in_loop: 'A person always decides. The monitor never approves, rejects or cancels anything, and every decision is checked by the authority resolver again when it is taken.',
  evaluate: (rc) => monitorPendingApprovals(rc.pool, rc.now, rc.config, rc.problems),
};
