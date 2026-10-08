/**
 * Owner independence and delegation intelligence (Phase 6 Batch 5,
 * docs/phase6-delegation-intelligence.md).
 *
 *   Authority       what the Owner explicitly allowed       delegated_authorities (resolver reads it)
 *   Observation     what NW OS saw decided                  completed approval_routes (the decision ledger)
 *   Recommendation  what could perhaps be delegated         delegation_recommendations (nobody reads it for authority)
 *   Decision        what the Owner chose                    accept -> preview -> confirm -> createRule (authority API)
 *
 * Nothing here grants, approves or changes anything by itself. A recommendation becomes authority
 * only when the Owner accepts it: the server builds an ordinary Owner rule from it, the Owner
 * sees the authority preview, confirms, and the rule is created by the same createRule the
 * Authority Settings screen uses (validation, sensitivity ceiling, baseline permission, audit,
 * re-routing). Every number shown comes from PostgreSQL; nothing is browser-calculated.
 */
import { createHash } from 'crypto';
import { AccessContext, ForbiddenError } from '../auth/access';
import { permissionsFor } from '../auth/permissions';
import type { AuthUser } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import type { PermissionKey, UserRole } from '../../src/types';
import type { PlannedAction, RuleDef } from '../automation/types';
import { createRule } from './authority';
import { previewRule } from './authoritySettings';
import { computeProjectRisk } from './risk';

type Db = Pool | PoolClient;
type Row = Record<string, any>;
const OWNER = 'Owner / CEO';
const HOUR = 3600_000;
const DAY = 86400_000;

export function requireOwner(ctx: AccessContext, what = 'Owner dependency and delegation recommendations') {
  if (ctx.user.role !== OWNER) throw new ForbiddenError(`Only the Owner may use ${what}`);
}
const notFound = (what: string) => {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
};

// ------------------------------------------------------------------ configuration
/** Conservative defaults (automation_rules.config of `delegation_recommendations` can change them). */
export const RECOMMENDATION_DEFAULTS = {
  window_days: 60,
  min_evidence: 5,
  min_distinct_days: 2,
  /** Repeated rejection: suppressed at this many rejections / changes requested AND this share. */
  max_rejections: 2,
  max_rejection_rate: 0.2,
  /** Recurring escalation: suppressed at this many escalated decisions AND this share. */
  max_escalations: 2,
  max_escalation_rate: 0.25,
  /** Unstable projects: suppressed when this share of the Owner's decisions were on At Risk / Critical projects. */
  max_unstable_share: 0.3,
  /** A suggested value limit never exceeds this (RM). */
  max_value_cap: 50000,
  /** After a rejection, the same opportunity is not suggested again for this long. */
  reject_cooldown_days: 90,
  /** Suggested rule length (the Owner can change it). */
  suggested_duration_days: 180,
  /** For the time-saved estimate only. */
  owner_minutes_per_decision: 20,
};
type Config = typeof RECOMMENDATION_DEFAULTS;
const cfg = (c: Record<string, unknown> = {}): Config => {
  const out = { ...RECOMMENDATION_DEFAULTS };
  for (const k of Object.keys(out) as (keyof Config)[]) if (Number.isFinite(Number(c[k])) && c[k] !== null && c[k] !== '') out[k] = Number(c[k]);
  return out;
};

/** Who could take each decision type, in order of preference (only roles holding its baseline permission are ever suggested). */
export const ROLE_PREFERENCE: Record<string, UserRole[]> = {
  drawing: ['Project Manager', 'Production Manager'],
  variation: ['Project Manager'],
  purchase: ['Purchasing', 'Accountant', 'Project Manager'],
  invoice: ['Accountant'],
  approval_request: ['Project Manager', 'Production Manager'],
};
/** Why the Owner had a decision, when that reason says delegation simply did not exist (the only evidence a recommendation uses). */
const DELEGABLE_REASONS = new Set(['NO_MATCHING_AUTHORITY', 'VALUE_LIMIT_EXCEEDED', 'RISK_LIMIT_EXCEEDED', 'OWNER_REQUIRED', 'AUTHORITY_EXPIRED', 'AUTHORITY_DEACTIVATED', 'CONDITION_NOT_MET']);
const SAFETY = /safety/i;
const UNSTABLE_RISK = new Set(['At Risk', 'Critical']);

// ------------------------------------------------------------------ decision ledger
export interface Decision {
  route_id: number;
  resource_kind: string;
  resource_id: string;
  decision_type: string;
  approval_type: string | null;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  sensitivity: string | null;
  current_sensitivity: string | null;
  project_risk: string | null;
  value: number | null;
  routing_basis: string;
  owner_reason_code: string | null;
  result: 'approved' | 'rejected' | 'changes_requested';
  decided_by: string | null;
  decided_by_role: string | null;
  requested_at: Date;
  completed_at: Date;
  escalated: boolean;
  rerouted: boolean;
}

/**
 * Decisions taken in [from, to): the final, completed route of each approval (one row per
 * decision). Client consents and withdrawn requests are not decisions. Bounded by the window.
 */
export async function decisionLedger(db: Db, from: Date, to: Date, limit = 20000): Promise<Decision[]> {
  const rows = (
    await db.query(
      `SELECT ar.id, ar.resource_kind, ar.resource_id, ar.decision_type, ar.project_id, ar.client_id, ar.project_sensitivity, ar.value, ar.routing_basis, ar.owner_reason_code,
              ar.completion_result, ar.completed_by, ar.requested_at, ar.completed_at, ar.escalation_count, ar.reroute_count,
              u.role AS decided_by_role, p.project_name, p.sensitivity AS current_sensitivity, p.risk_status, ap.approval_type
       FROM approval_routes ar
       LEFT JOIN users u ON u.id = ar.completed_by
       LEFT JOIN projects p ON p.id = ar.project_id
       LEFT JOIN approvals ap ON ar.resource_kind = 'approval' AND ap.id = ar.resource_id
       WHERE ar.status = 'completed' AND ar.completed_at >= $1 AND ar.completed_at < $2
         AND ar.routing_basis <> 'CLIENT_CONSENT' AND ar.completion_result IN ('approved', 'rejected', 'changes_requested')
       ORDER BY ar.completed_at, ar.id LIMIT $3`,
      [from, to, limit]
    )
  ).rows;
  return rows.map((r) => ({
    route_id: Number(r.id),
    resource_kind: r.resource_kind,
    resource_id: r.resource_id,
    decision_type: r.decision_type,
    approval_type: r.approval_type ?? null,
    project_id: r.project_id,
    project_name: r.project_name ?? null,
    client_id: r.client_id,
    sensitivity: r.project_sensitivity,
    current_sensitivity: r.current_sensitivity ?? null,
    project_risk: r.risk_status ?? null,
    value: r.value == null ? null : Number(r.value),
    routing_basis: r.routing_basis,
    owner_reason_code: r.owner_reason_code,
    result: r.completion_result,
    decided_by: r.completed_by,
    decided_by_role: r.decided_by_role ?? null,
    requested_at: new Date(r.requested_at),
    completed_at: new Date(r.completed_at),
    escalated: Number(r.escalation_count) > 0,
    rerouted: Number(r.reroute_count) > 0,
  }));
}

const isOwnerDecision = (d: Decision) => d.decided_by_role === OWNER;
const isDelegated = (d: Decision) => !!d.decided_by_role && d.decided_by_role !== OWNER;
const isSafety = (d: Decision) => !!d.approval_type && SAFETY.test(d.approval_type);
const protectedProject = (d: Decision) => (d.sensitivity && d.sensitivity !== 'Normal') || (d.current_sensitivity && d.current_sensitivity !== 'Normal');
/** Routine: an operational decision on a Normal project, not safety, not a closed-project review. */
export const isRoutine = (d: Decision) => !protectedProject(d) && !isSafety(d) && d.owner_reason_code !== 'PROJECT_CLOSED';

/** Why an Owner decision stayed with the Owner (structured; from the routing reason, never guessed). */
export function ownerReason(d: Decision): { code: string; label: string } {
  if (isSafety(d)) return { code: 'SAFETY', label: 'Safety' };
  switch (d.owner_reason_code) {
    case 'SENSITIVITY_BLOCKED':
      return (d.sensitivity ?? d.current_sensitivity) === 'Strategic' ? { code: 'STRATEGIC_PROJECT', label: 'Strategic project' } : { code: 'SENSITIVE_PROJECT', label: 'Sensitive project' };
    case 'VALUE_LIMIT_EXCEEDED':
      return { code: 'VALUE_EXCEEDS_DELEGATION', label: 'Value exceeds delegation' };
    case 'RISK_LIMIT_EXCEEDED':
      return { code: 'RISK_EXCEEDS_DELEGATION', label: 'Risk exceeds delegation' };
    case 'NO_MATCHING_AUTHORITY':
      return { code: 'NO_ELIGIBLE_DELEGATE', label: 'No eligible delegate' };
    case 'CONDITION_NOT_MET':
      return { code: 'NO_ELIGIBLE_DELEGATE', label: 'No eligible delegate' };
    case 'OWNER_REQUIRED':
      return { code: 'POLICY_REQUIRES_OWNER', label: 'Policy requires the Owner' };
    case 'SELF_APPROVAL_BLOCKED':
      return { code: 'SELF_APPROVAL_RESTRICTION', label: 'Self-approval restriction' };
    case 'AUTHORITY_EXPIRED':
    case 'AUTHORITY_DEACTIVATED':
    case 'AUTHORITY_NOT_YET_ACTIVE':
      return { code: 'AUTHORITY_EXPIRED', label: 'Delegation expired / switched off' };
    case 'OWNER_ASSIGNED':
      return { code: 'OWNER_PREFERENCE', label: 'Owner preference' };
    case 'ESCALATED_OVERDUE':
    case 'PROJECT_CLOSED':
    case 'INVALID_AUTHORITY_CONTEXT':
      return { code: 'EXCEPTION', label: 'Exception (escalated, closed project, …)' };
    default:
      return d.routing_basis === 'OWNER_FALLBACK' ? { code: 'EXCEPTION', label: 'Exception (escalated, closed project, …)' } : { code: 'OWNER_DECIDED_DELEGATED_ITEM', label: 'Owner decided an item a delegate could decide' };
  }
}

const hours = (d: Decision) => Math.max(0, (d.completed_at.getTime() - d.requested_at.getTime()) / HOUR);
const round1 = (n: number) => Math.round(n * 10) / 10;
const avg = (xs: number[]) => (xs.length ? round1(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return round1(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
const dayOf = (t: Date) => t.toISOString().slice(0, 10);
const LABEL: Record<string, string> = { drawing: 'Drawings', variation: 'Variations', purchase: 'Purchases', invoice: 'Invoices', ai_proposal: 'AI Proposals', approval_request: 'Other approval requests' };
const VALUE_BANDS: [string, (v: number | null) => boolean][] = [
  ['No amount', (v) => v === null],
  ['Under RM 5,000', (v) => v !== null && v < 5000],
  ['RM 5,000 – 19,999', (v) => v !== null && v >= 5000 && v < 20000],
  ['RM 20,000 – 99,999', (v) => v !== null && v >= 20000 && v < 100000],
  ['RM 100,000 and above', (v) => v !== null && v >= 100000],
];

// ------------------------------------------------------------------ Owner dependency analytics
export async function ownerDependencyAnalytics(pool: Pool, ctx: AccessContext, opts: { days?: number; now?: Date; config?: Record<string, unknown> } = {}) {
  requireOwner(ctx);
  const now = opts.now ?? new Date();
  const days = Math.min(365, Math.max(7, Number(opts.days) || 90));
  const c = cfg(opts.config ?? (await ruleConfig(pool)));
  const from = new Date(now.getTime() - days * DAY);
  const all = (await decisionLedger(pool, new Date(Math.min(from.getTime(), monthStart(now, -5).getTime())), now)).filter((d) => !d.project_id || ctx.canSeeProject(d.project_id));
  const inWindow = all.filter((d) => d.completed_at >= from);
  const owner = inWindow.filter(isOwnerDecision);
  const delegated = inWindow.filter(isDelegated);
  const routine = inWindow.filter(isRoutine).filter((d) => isOwnerDecision(d) || isDelegated(d));
  const routineOwner = routine.filter(isOwnerDecision);

  const byType = Object.keys(LABEL)
    .map((t) => {
      const ds = inWindow.filter((d) => d.decision_type === t && (isOwnerDecision(d) || isDelegated(d)));
      const o = ds.filter(isOwnerDecision);
      const h = ds.map(hours);
      return {
        decision_type: t,
        label: LABEL[t],
        total: ds.length,
        owner: o.length,
        delegated: ds.length - o.length,
        percent_delegated: pct(ds.length - o.length, ds.length),
        average_hours: avg(h),
        median_hours: median(h),
        escalation_rate: pct(ds.filter((d) => d.escalated).length, ds.length),
        no_eligible_delegate: o.filter((d) => ownerReason(d).code === 'NO_ELIGIBLE_DELEGATE').length,
      };
    })
    .filter((t) => t.total > 0)
    .sort((a, b) => b.owner - a.owner || a.decision_type.localeCompare(b.decision_type));

  const group = <K extends string>(ds: Decision[], key: (d: Decision) => K) => {
    const m = new Map<K, number>();
    for (const d of ds) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
    return m;
  };
  const byProject = [...group(owner.filter((d) => d.project_id), (d) => d.project_id!).entries()]
    .map(([id, n]) => ({ project_id: id, project_name: owner.find((d) => d.project_id === id)?.project_name ?? id, owner_decisions: n }))
    .sort((a, b) => b.owner_decisions - a.owner_decisions)
    .slice(0, 10);
  const byValue = VALUE_BANDS.map(([band, test]) => ({ band, owner_decisions: owner.filter((d) => test(d.value)).length, delegated_decisions: delegated.filter((d) => test(d.value)).length }));
  const reasons = new Map<string, { code: string; label: string; count: number }>();
  for (const d of owner) {
    const r = ownerReason(d);
    const e = reasons.get(r.code) ?? { ...r, count: 0 };
    e.count++;
    reasons.set(r.code, e);
  }

  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const start = monthStart(now, -i);
    const end = monthStart(now, -i + 1);
    const ds = all.filter((d) => d.completed_at >= start && d.completed_at < end && (isOwnerDecision(d) || isDelegated(d)));
    const o = ds.filter(isOwnerDecision);
    trend.push({ month: start.toISOString().slice(0, 7), owner_decisions: o.length, delegated_decisions: ds.length - o.length, percent_delegated: pct(ds.length - o.length, ds.length), average_owner_hours: avg(o.map(hours)) });
  }

  const saved = round1((delegated.length * c.owner_minutes_per_decision) / 60);

  // Batch 6: the estimated effect of the delegations in force now on the same history.
  const inForceRules = (await pool.query(`SELECT * FROM delegated_authorities WHERE kind = 'owner' AND effect = 'allow' AND active`)).rows.filter(
    (r) => (!r.start_at || new Date(r.start_at) <= now) && (!r.end_at || new Date(r.end_at) > now)
  );
  const coveredNow = (d: Decision) =>
    inForceRules.some(
      (r) =>
        r.decision_type === d.decision_type &&
        (!r.project_id || r.project_id === d.project_id) &&
        (!r.client_id || r.client_id === d.client_id) &&
        (r.min_value == null || (d.value !== null && d.value >= Number(r.min_value))) &&
        (r.max_value == null || (d.value !== null && d.value <= Number(r.max_value))) &&
        (!Array.isArray(r.conditions?.approval_types) || (d.approval_type !== null && r.conditions.approval_types.includes(d.approval_type)))
    );
  const routineDelegated = routine.length - routineOwner.length;
  const nowCovered = routineOwner.filter(coveredNow);
  const remaining = new Map<string, number>();
  for (const d of routineOwner.filter((x) => !coveredNow(x))) remaining.set(d.decision_type, (remaining.get(d.decision_type) ?? 0) + 1);
  const protectedOwner = owner.filter((d) => !isRoutine(d));
  const impact = {
    label: 'Estimated',
    current_dependency_percent: pct(routineOwner.length, routine.length),
    estimated_routine_coverage_percent: pct(routineDelegated + nowCovered.length, routine.length),
    owner_routine_decisions_now_covered: nowCovered.length,
    largest_remaining: [
      ...[...remaining.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => ({ label: LABEL[t] ?? t, owner_decisions: n, why: 'no delegation in force covers them' })),
      ...(protectedOwner.length ? [{ label: 'Sensitive / Strategic / safety decisions', owner_decisions: protectedOwner.length, why: 'stay with the Owner by design' }] : []),
    ].slice(0, 5),
    note: 'Estimated by replaying the period\'s routine decisions against the delegations in force now. Not a forecast: future workload and the resolver (risk, self-approval, availability) decide what is actually delegated.',
  };
  return {
    question: 'How much of my time is still required for routine operational decisions?',
    window: { days, from: from.toISOString(), to: now.toISOString() },
    totals: {
      total_decisions: owner.length + delegated.length,
      owner_decisions: owner.length,
      delegated_decisions: delegated.length,
      percent_delegated: pct(delegated.length, owner.length + delegated.length),
      owner_required: owner.filter((d) => d.routing_basis === 'OWNER_FALLBACK').length,
      escalated: inWindow.filter((d) => d.escalated).length,
      rerouted: inWindow.filter((d) => d.rerouted).length,
      no_eligible_delegate: owner.filter((d) => ownerReason(d).code === 'NO_ELIGIBLE_DELEGATE').length,
      average_hours: avg(inWindow.map(hours)),
      average_owner_hours: avg(owner.map(hours)),
      open_waiting_for_owner: Number((await pool.query(`SELECT count(*)::int AS n FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.status = 'open' AND u.role = $1`, [OWNER])).rows[0].n),
    },
    dependency: {
      percent: pct(routineOwner.length, routine.length),
      owner_routine_decisions: routineOwner.length,
      routine_decisions: routine.length,
      definition: 'Owner Dependency = routine decisions the Owner took ÷ all routine decisions taken (Owner + delegates) in the period. Routine = on a Normal project, not safety-related, not a closed-project review.',
    },
    time_saved: {
      delegated_decisions: delegated.length,
      owner_decisions_avoided: delegated.length,
      estimated_hours: saved,
      minutes_per_decision: c.owner_minutes_per_decision,
      formula: `${delegated.length} decisions taken by delegates × ${c.owner_minutes_per_decision} minutes = ${saved} hours`,
      note: 'Estimate. Assumes each decision a delegate took would otherwise have taken the Owner this long. No financial value is claimed.',
      escalations: inWindow.filter((d) => d.escalated).length,
    },
    by_decision_type: byType,
    by_project: byProject,
    by_value: byValue,
    by_reason: [...reasons.values()].sort((a, b) => b.count - a.count),
    impact,
    repeated: repeatedOwnerDecisions(all.filter((d) => d.completed_at >= new Date(now.getTime() - 45 * DAY))),
    trend,
    data_note: 'From completed approval routes (approval routing began in Phase 6 Batch 3); earlier decisions are not counted.',
    computed_at: now.toISOString(),
  };
}

function monthStart(now: Date, offset: number) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
}

/** Repeated Owner decisions: the same kind of decision (and request type) taken by the Owner 5+ times in 45 days, per project and overall. */
export function repeatedOwnerDecisions(ds: Decision[], min = 5) {
  const owner = ds.filter(isOwnerDecision);
  const out: Row[] = [];
  const add = (key: string, scope: string, list: Decision[], project: { id: string | null; name: string | null }) => {
    if (list.length < min) return;
    const values = list.map((d) => d.value).filter((v): v is number => v !== null);
    out.push({
      key,
      decision_type: list[0].decision_type,
      label: LABEL[list[0].decision_type] ?? list[0].decision_type,
      approval_type: list[0].approval_type,
      scope,
      project_id: project.id,
      project_name: project.name,
      count: list.length,
      distinct_days: new Set(list.map((d) => dayOf(d.completed_at))).size,
      approved: list.filter((d) => d.result === 'approved').length,
      value_range: values.length ? { min: Math.min(...values), max: Math.max(...values) } : null,
      text: `Owner took ${list.length} similar ${(list[0].approval_type ?? LABEL[list[0].decision_type] ?? '').toLowerCase()} decisions${project.name ? ` on ${project.name}` : ''} in 45 days.`,
    });
  };
  const byType = new Map<string, Decision[]>();
  const byProject = new Map<string, Decision[]>();
  for (const d of owner) {
    const t = `${d.decision_type}|${d.approval_type ?? '*'}`;
    byType.set(t, [...(byType.get(t) ?? []), d]);
    if (d.project_id) byProject.set(`${t}|${d.project_id}`, [...(byProject.get(`${t}|${d.project_id}`) ?? []), d]);
  }
  for (const [k, list] of byType) add(k, 'all projects', list, { id: null, name: null });
  for (const [k, list] of byProject) add(k, 'one project', list, { id: list[0].project_id, name: list[0].project_name });
  return out.sort((a, b) => b.count - a.count).slice(0, 20);
}

// ------------------------------------------------------------------ recommendation engine
interface Opportunity {
  key: string;
  decision_type: string;
  approval_type: string | null;
  target_role: UserRole;
  project_id: string | null;
  client_id: string | null;
  min: number | null;
  max: number | null;
  max_risk: string | null;
  evidence: Decision[];
  approvals: number;
  rejections: number;
  escalations: number;
  distinct_days: number;
  typical: number | null;
  max_observed: number | null;
  eligible_users: number;
  confidence: 'Low' | 'Medium' | 'High';
  data: Row;
}

/** Rounds a suggested limit up to a plain step (RM 500 under 10,000; 1,000 under 100,000; else 5,000). */
export function niceCeil(v: number) {
  const step = v < 10000 ? 500 : v < 100000 ? 1000 : 5000;
  return Math.ceil(v / step) * step;
}

/** The conservative value limit: the 90th percentile of what the Owner approved, rounded up to a plain step, capped. */
export function suggestLimit(values: number[], cap: number) {
  const s = [...values].sort((a, b) => a - b);
  const p90 = s[Math.max(0, Math.ceil(0.9 * s.length) - 1)];
  return Math.min(niceCeil(p90), cap);
}

/** The pure part of the engine: groups of Owner decisions -> opportunities, or why not. */
export async function evaluateOpportunities(db: Db, now: Date, c: Config) {
  const from = new Date(now.getTime() - c.window_days * DAY);
  const ledger = await decisionLedger(db, from, now);
  const types = new Map((await db.query('SELECT key, label, baseline_permission, has_value FROM authority_decision_types')).rows.map((t) => [t.key as string, t]));
  const users = (await db.query(`SELECT * FROM users WHERE is_active AND role NOT IN ('Owner / CEO', 'Client', 'Contractor') ORDER BY id`)).rows as AuthUser[];
  const rules = (await db.query(`SELECT * FROM delegated_authorities WHERE kind = 'owner' AND effect = 'allow' AND active AND (end_at IS NULL OR end_at > $1)`, [now])).rows;
  // Project risk exactly as the resolver sees it (computed now, not the stored indicator).
  const risks = new Map<string, string>();
  const riskOf = async (projectId: string | null) => {
    if (!projectId) return null;
    if (!risks.has(projectId)) risks.set(projectId, (await computeProjectRisk(db, projectId, now, true)).level);
    return risks.get(projectId)!;
  };
  const contexts = new Map<string, AccessContext>();
  const ctxOf = async (u: AuthUser) => contexts.get(u.id) ?? (contexts.set(u.id, await AccessContext.load(db, u)), contexts.get(u.id)!);

  // Evidence: decisions the Owner took because no delegation covered them.
  const groups = new Map<string, Decision[]>();
  for (const d of ledger) {
    if (!isOwnerDecision(d) || d.routing_basis !== 'OWNER_FALLBACK' || !DELEGABLE_REASONS.has(d.owner_reason_code ?? '')) continue;
    if (!ROLE_PREFERENCE[d.decision_type]) continue; // AI proposals: decided by the person they are put to
    const key = `${d.decision_type}|${d.decision_type === 'approval_request' ? d.approval_type ?? '*' : '*'}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }

  const opportunities: Opportunity[] = [];
  const notRecommended: Row[] = [];
  const skip = (key: string, label: string, reason: string, extra: Row = {}) => notRecommended.push({ key, label, reason, ...extra });
  for (const [key, considered] of groups) {
    const [decisionType, at] = key.split('|');
    const approvalType = at === '*' ? null : at;
    const label = approvalType ?? LABEL[decisionType] ?? decisionType;
    const type = types.get(decisionType)!;
    // Hard exclusions: these never count as evidence, whatever their number.
    const excluded = { sensitive_or_strategic: 0, safety: 0, unstable_project: 0 };
    const comparable: Decision[] = [];
    for (const d of considered) {
      if (protectedProject(d)) excluded.sensitive_or_strategic++;
      else if (isSafety(d) || (approvalType && SAFETY.test(approvalType))) excluded.safety++;
      else if (UNSTABLE_RISK.has((await riskOf(d.project_id)) ?? '')) excluded.unstable_project++;
      else comparable.push(d);
    }
    const base = { decisions_considered: considered.length, comparable: comparable.length, excluded };
    if (excluded.safety && !comparable.length) {
      skip(key, label, 'Safety-related decisions are never recommended for delegation', base);
      continue;
    }
    if (considered.length && excluded.unstable_project / considered.length > c.max_unstable_share) {
      skip(key, label, `Unstable project conditions: ${excluded.unstable_project} of ${considered.length} decisions were on At Risk / Critical projects`, base);
      continue;
    }
    const days = new Set(comparable.map((d) => dayOf(d.completed_at))).size;
    if (comparable.length < c.min_evidence || days < c.min_distinct_days) {
      skip(key, label, `Not enough evidence: ${comparable.length} comparable decision(s) on ${days} day(s); needs at least ${c.min_evidence} on ${c.min_distinct_days} or more days`, base);
      continue;
    }
    const rejections = comparable.filter((d) => d.result !== 'approved').length;
    const escalations = comparable.filter((d) => d.escalated).length;
    if (rejections >= c.max_rejections && rejections / comparable.length >= c.max_rejection_rate) {
      skip(key, label, `Repeated rejection: ${rejections} of ${comparable.length} were rejected or sent back`, base);
      continue;
    }
    if (escalations >= c.max_escalations && escalations / comparable.length >= c.max_escalation_rate) {
      skip(key, label, `Recurring escalation: ${escalations} of ${comparable.length} were escalated`, base);
      continue;
    }

    // Value: the conservative limit, never above the cap; types with an amount but no known amounts are not recommended.
    const values = comparable.map((d) => d.value).filter((v): v is number => v !== null);
    let max: number | null = null;
    if (type.has_value) {
      if (values.length < comparable.length) {
        skip(key, label, 'Some amounts are unknown to the server, so no safe value limit can be suggested', base);
        continue;
      }
      max = suggestLimit(values, c.max_value_cap);
    }
    // Scope: one project if all evidence is on one; one client if all on one client; else all (Normal) projects.
    const projects = [...new Set(comparable.map((d) => d.project_id).filter(Boolean))] as string[];
    const clients = [...new Set(comparable.map((d) => d.client_id).filter(Boolean))] as string[];
    const projectId = projects.length === 1 ? projects[0] : null;
    const clientId = !projectId && clients.length === 1 ? clients[0] : null;

    // Delegate: the first preferred role that holds the baseline permission and has active users who can see this work.
    const roleNotes: string[] = [];
    let role: UserRole | undefined;
    let eligible = 0;
    for (const r of ROLE_PREFERENCE[decisionType]) {
      if (!permissionsFor(r).has(type.baseline_permission as PermissionKey)) {
        roleNotes.push(`${r} does not hold ${type.baseline_permission}`);
        continue;
      }
      let n = 0;
      for (const u of users.filter((x) => x.role === r)) {
        const ux = await ctxOf(u);
        if (ux.can(type.baseline_permission as PermissionKey) && projects.some((p) => ux.canSeeProject(p))) n++;
      }
      if (!n) {
        roleNotes.push(`no active ${r} can see these projects`);
        continue;
      }
      role = r;
      eligible = n;
      break;
    }
    if (!role) {
      skip(key, label, `No eligible delegate (${roleNotes.join('; ')})`, base);
      continue;
    }
    // Already delegated: an active Owner rule for this role covers it.
    const covers = (x: Row) =>
        x.decision_type === decisionType &&
        (x.target_role === role || users.some((u) => u.id === x.target_user_id && u.role === role)) &&
        (!x.project_id || x.project_id === projectId) &&
        (!x.client_id || x.client_id === clientId) &&
        (x.max_value == null || max === null || Number(x.max_value) >= max) &&
        (!approvalType || !Array.isArray(x.conditions?.approval_types) || x.conditions.approval_types.includes(approvalType));
    // Batch 6: only permanent authority counts as "already delegated"; temporary or absence
    // authority ends, so the recommendation stays, saying what covers it for now.
    const covering = rules.find((x) => covers(x) && (x.authority_type ?? 'permanent') === 'permanent');
    if (covering) {
      skip(key, label, `Already delegated by ${covering.code}`, base);
      continue;
    }
    const temporaryCover = rules.filter((x) => covers(x) && x.authority_type && x.authority_type !== 'permanent');

    const why: string[] = [];
    let confidence: Opportunity['confidence'] = 'Low';
    if (comparable.length >= 15 && days >= 5 && rejections === 0 && escalations === 0) {
      confidence = 'High';
      why.push(`${comparable.length} decisions (15+) on ${days} days (5+), none rejected or escalated`);
    } else if (comparable.length >= 8 && days >= 3 && rejections <= 1 && escalations <= 1) {
      confidence = 'Medium';
      why.push(`${comparable.length} decisions (8+) on ${days} days (3+), at most one rejected and one escalated`);
    } else {
      why.push(`${comparable.length} decisions on ${days} days: the minimum evidence, but below Medium (8+ decisions on 3+ days, at most one rejection / escalation)`);
    }
    if (rejections) why.push(`${rejections} rejected or sent back, which lowers confidence`);
    if (escalations) why.push(`${escalations} escalated, which lowers confidence`);
    const sorted = [...values].sort((a, b) => a - b);
    const typical = values.length ? (median(values) as number) : null;
    const scopeName = projectId ? `on project ${comparable[0].project_name ?? projectId}` : clientId ? `for one client's projects` : 'on Normal projects';
    opportunities.push({
      key: `${decisionType}|${approvalType ?? '*'}|${role}|${projectId ?? (clientId ? `client:${clientId}` : 'all')}`,
      decision_type: decisionType,
      approval_type: approvalType,
      target_role: role,
      project_id: projectId,
      client_id: clientId,
      min: null,
      max,
      max_risk: 'Attention',
      evidence: comparable,
      approvals: comparable.length - rejections,
      rejections,
      escalations,
      distinct_days: days,
      typical,
      max_observed: sorted.length ? sorted[sorted.length - 1] : null,
      eligible_users: eligible,
      confidence,
      data: {
        label,
        headline: `${label} — ${role}`,
        recommendation: `Consider delegating ${label.toLowerCase()} to ${role}${max !== null ? ` up to RM ${max.toLocaleString('en-US')}` : ''} ${scopeName}.`,
        reasons: [
          `${comparable.length} similar decisions in the last ${c.window_days} days, all taken by the Owner because no delegation covered them`,
          `Owner approved ${comparable.length - rejections} of ${comparable.length}`,
          `${role} holds ${type.baseline_permission} (the baseline permission); ${eligible} active user(s) can see this work`,
          max !== null ? `Suggested limit RM ${max.toLocaleString('en-US')}: the 90th percentile of approved amounts, rounded up, never above RM ${c.max_value_cap.toLocaleString('en-US')}` : 'This decision type has no amount',
          'Only Normal projects: Sensitive and Strategic projects stay with the Owner (sensitivity ceiling)',
          ...temporaryCover.map((x) => `Currently covered only by ${x.authority_type} authority ${x.code} until ${new Date(x.end_at).toISOString().slice(0, 10)}; it returns to the Owner after that`),
        ],
        coverage_now: temporaryCover.length ? `temporary (${temporaryCover.map((x) => x.code).join(', ')})` : 'Owner only',
        confidence_explanation: why,
        required_permission: type.baseline_permission,
        role_notes: roleNotes,
        excluded,
        considered: considered.length,
        evidence: comparable.slice(-30).map((d) => ({ resource: `${d.resource_kind}:${d.resource_id}`, project: d.project_name ?? d.project_id, value: d.value, result: d.result, decided_at: d.completed_at.toISOString(), escalated: d.escalated })),
        suggested_end_days: c.suggested_duration_days,
      },
    });
  }
  return { opportunities, not_recommended: notRecommended, decisions_reviewed: ledger.length, window: { from: from.toISOString(), to: now.toISOString(), days: c.window_days } };
}

const SYSTEM_ACTOR: AuditActor = { id: null, name: 'NW OS Delegation Intelligence', role: 'system' };
const ACTIVE = ['generated', 'viewed', 'snoozed'];

async function ruleConfig(db: Db) {
  return ((await db.query(`SELECT config FROM automation_rules WHERE key = 'delegation_recommendations'`)).rows[0]?.config ?? {}) as Record<string, unknown>;
}

/**
 * Generates recommendations (idempotent): one active recommendation per opportunity; evidence
 * refreshed in place; a materially different suggestion supersedes the old one; opportunities
 * that no longer qualify expire; a rejected opportunity is not suggested again during the
 * cool-down. Writes only delegation_recommendations (and one audit row). Never authority.
 */
export async function generateDelegationRecommendations(pool: Pool, now = new Date(), config?: Record<string, unknown>) {
  return withTransaction(pool, async (db) => {
    // One generator at a time (the scheduler and a manual refresh), on this one connection.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('delegation_recommendations'))`);
    const c = cfg(config ?? (await ruleConfig(db)));
    await db.query(`UPDATE delegation_recommendations SET status = 'generated', snoozed_until = NULL WHERE status = 'snoozed' AND snoozed_until <= $1`, [now]);
    const { opportunities, not_recommended, decisions_reviewed, window } = await evaluateOpportunities(db, now, c);
    const counts = { created: 0, refreshed: 0, superseded: 0, expired: 0, cooling_down: 0 };
    const seen = new Set<string>();
    for (const o of opportunities) {
      seen.add(o.key);
      const active = (await db.query(`SELECT * FROM delegation_recommendations WHERE opportunity_key = $1 AND status = ANY($2)`, [o.key, ACTIVE])).rows[0];
      const evidence = [o.evidence[0].completed_at, o.evidence[o.evidence.length - 1].completed_at];
      const fields = [o.evidence.length, o.approvals, o.rejections, o.escalations, o.distinct_days, o.typical, o.max_observed, o.eligible_users, evidence[0], evidence[1], JSON.stringify(o.data)];
      if (active) {
        const material = (active.suggested_max_value == null ? null : Number(active.suggested_max_value)) !== o.max || active.confidence !== o.confidence || active.target_role !== o.target_role;
        if (!material || (active.status === 'snoozed' && new Date(active.snoozed_until) > now)) {
          await db.query(
            `UPDATE delegation_recommendations SET evidence_count = $2, approval_count = $3, rejection_count = $4, escalation_count = $5, distinct_days = $6, typical_value = $7,
               max_value_observed = $8, eligible_users = $9, evidence_start = $10, evidence_end = $11, data = $12, last_evaluated_at = $13 WHERE id = $1`,
            [active.id, ...fields, now]
          );
          counts.refreshed++;
          continue;
        }
        const id = await insertRecommendation(db, o, fields, now);
        await db.query(`UPDATE delegation_recommendations SET status = 'superseded', superseded_by = $2, last_evaluated_at = $3 WHERE id = $1`, [active.id, id, now]);
        counts.superseded++;
        counts.created++;
        continue;
      }
      const rejected = (await db.query(`SELECT 1 FROM delegation_recommendations WHERE opportunity_key = $1 AND status = 'rejected' AND reviewed_at > $2::timestamptz - make_interval(days => $3)`, [o.key, now, c.reject_cooldown_days])).rowCount;
      if (rejected) {
        counts.cooling_down++;
        continue;
      }
      await insertRecommendation(db, o, fields, now);
      counts.created++;
    }
    const stale = (await db.query(`UPDATE delegation_recommendations SET status = 'expired', last_evaluated_at = $2 WHERE status = ANY($1) AND NOT (opportunity_key = ANY($3)) RETURNING id`, [ACTIVE, now, [...seen]])).rows;
    counts.expired = stale.length;
    const result = { ...counts, opportunities: opportunities.length, not_recommended, decisions_reviewed, window, generated_at: now.toISOString() };
    await writeAudit(db, SYSTEM_ACTOR, { action: 'delegation.recommendations.generate', entityType: 'delegation_recommendation', entityId: 'all', after: result });
    return result;
  });
}

async function insertRecommendation(db: PoolClient, o: Opportunity, fields: unknown[], now: Date) {
  const id = `drec-${(await db.query(`SELECT nextval('delegation_recommendation_seq') AS n`)).rows[0].n}`;
  await db.query(
    `INSERT INTO delegation_recommendations (id, opportunity_key, decision_type, approval_type, target_role, project_id, client_id, suggested_min_value, suggested_max_value, suggested_max_risk,
       evidence_count, approval_count, rejection_count, escalation_count, distinct_days, typical_value, max_value_observed, eligible_users, evidence_start, evidence_end, data,
       confidence, generated_at, last_evaluated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $23)`,
    [id, o.key, o.decision_type, o.approval_type, o.target_role, o.project_id, o.client_id, o.min, o.max, o.max_risk, ...fields, o.confidence, now]
  );
  return id;
}

// ------------------------------------------------------------------ Owner review
const present = (r: Row) => ({
  id: r.id,
  status: r.status,
  decision_type: r.decision_type,
  approval_type: r.approval_type,
  target_role: r.target_role,
  target_user_id: r.target_user_id,
  project_id: r.project_id,
  project_name: r.project_name ?? null,
  client_id: r.client_id,
  client_name: r.client_name ?? null,
  suggested_min_value: r.suggested_min_value == null ? null : Number(r.suggested_min_value),
  suggested_max_value: r.suggested_max_value == null ? null : Number(r.suggested_max_value),
  suggested_max_risk: r.suggested_max_risk,
  evidence: {
    start: r.evidence_start,
    end: r.evidence_end,
    decisions: r.evidence_count,
    approved: r.approval_count,
    rejected: r.rejection_count,
    escalated: r.escalation_count,
    distinct_days: r.distinct_days,
    typical_value: r.typical_value == null ? null : Number(r.typical_value),
    max_value: r.max_value_observed == null ? null : Number(r.max_value_observed),
    eligible_users: r.eligible_users,
    owner_approval_rate: r.evidence_count ? Math.round((r.approval_count / r.evidence_count) * 1000) / 10 : null,
  },
  confidence: r.confidence,
  headline: r.data?.headline,
  recommendation: r.data?.recommendation,
  reasons: r.data?.reasons ?? [],
  confidence_explanation: r.data?.confidence_explanation ?? [],
  coverage_now: r.data?.coverage_now ?? null,
  required_permission: r.data?.required_permission ?? null,
  excluded: r.data?.excluded ?? null,
  decisions: r.data?.evidence ?? [],
  generated_at: r.generated_at,
  viewed_at: r.viewed_at,
  reviewed_at: r.reviewed_at,
  reviewed_by: r.reviewed_by,
  review_reason: r.review_reason,
  snoozed_until: r.snoozed_until,
  authority_rule_id: r.authority_rule_id,
  authority_rule_code: r.rule_code ?? null,
});
const LIST_SQL = `SELECT d.*, p.project_name, c.company_name AS client_name, a.code AS rule_code FROM delegation_recommendations d
  LEFT JOIN projects p ON p.id = d.project_id LEFT JOIN clients c ON c.id = d.client_id LEFT JOIN delegated_authorities a ON a.id = d.authority_rule_id`;

export async function listRecommendations(pool: Pool, ctx: AccessContext, now = new Date()) {
  requireOwner(ctx);
  const rows = (await pool.query(`${LIST_SQL} ORDER BY d.generated_at DESC, d.id DESC LIMIT 200`)).rows.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
  // Showing the list marks new recommendations as viewed (this response still says "generated").
  await pool.query(`UPDATE delegation_recommendations SET status = 'viewed', viewed_at = $1 WHERE status = 'generated'`, [now]);
  const order = { High: 0, Medium: 1, Low: 2 } as Record<string, number>;
  const active = rows.filter((r) => r.status === 'viewed' || r.status === 'generated').sort((a, b) => order[a.confidence] - order[b.confidence] || b.evidence_count - a.evidence_count);
  const last = (await pool.query(`SELECT after, occurred_at FROM audit_logs WHERE action = 'delegation.recommendations.generate' ORDER BY id DESC LIMIT 1`)).rows[0];
  return {
    principle: 'Recommendations are observations, never authority. Only your explicit acceptance (preview, then confirm) creates an authority rule.',
    active: active.map(present),
    snoozed: rows.filter((r) => r.status === 'snoozed').map(present),
    history: rows.filter((r) => !ACTIVE.includes(r.status)).slice(0, 30).map(present),
    last_generated_at: last?.occurred_at ?? null,
    not_recommended: last?.after?.not_recommended ?? [],
  };
}

async function loadRecommendation(db: Db, ctx: AccessContext, id: string) {
  const r = (await db.query(`${LIST_SQL} WHERE d.id = $1`, [id])).rows[0];
  if (!r || (r.project_id && !ctx.canSeeProject(r.project_id))) throw notFound(`Recommendation ${id}`);
  return r;
}

/** What the Owner may change when accepting; everything else (evidence, decision type, effect) comes from the server. */
const MODIFIABLE = ['target_user_id', 'target_role', 'min_value', 'max_value', 'max_risk', 'project_id', 'client_id', 'start_at', 'end_at'];

function parseModifications(body: unknown) {
  const b = (body && typeof body === 'object' ? body : {}) as Row;
  const allowedTop = ['modifications', 'confirmation', 'reason'];
  const extra = Object.keys(b).filter((k) => !allowedTop.includes(k));
  if (extra.length) throw new ValidationError(`Not allowed: ${extra.join(', ')} (evidence and authority are set by the server)`);
  const m = b.modifications ?? {};
  if (!m || typeof m !== 'object' || Array.isArray(m)) throw new ValidationError('modifications must be an object');
  const bad = Object.keys(m).filter((k) => !MODIFIABLE.includes(k));
  if (bad.length) throw new ValidationError(`Cannot modify: ${bad.join(', ')}. You may change ${MODIFIABLE.join(', ')}`);
  return m as Row;
}

/** The Owner rule a recommendation turns into (built on the server, from the stored recommendation). */
export function ruleFromRecommendation(rec: Row, mods: Row, now: Date) {
  const label = rec.data?.label ?? rec.decision_type;
  const targetUser = mods.target_user_id !== undefined ? mods.target_user_id || null : rec.target_user_id;
  const targetRole = mods.target_role !== undefined ? mods.target_role || null : targetUser ? null : rec.target_role;
  const pick = (k: string, v: unknown) => (mods[k] !== undefined ? (mods[k] === '' ? null : mods[k]) : v);
  const endDefault = new Date(now.getTime() + Number(rec.data?.suggested_end_days ?? RECOMMENDATION_DEFAULTS.suggested_duration_days) * DAY).toISOString();
  return {
    name: `${label} — ${targetUser ?? targetRole}`.slice(0, 120),
    description: `From delegation recommendation ${rec.id}: ${rec.evidence_count} similar Owner decisions (${rec.approval_count} approved, ${rec.rejection_count} rejected, ${rec.escalation_count} escalated) between ${String(new Date(rec.evidence_start).toISOString()).slice(0, 10)} and ${String(new Date(rec.evidence_end).toISOString()).slice(0, 10)}.`,
    effect: 'allow',
    decision_type: rec.decision_type,
    target_role: targetRole,
    target_user_id: targetUser,
    project_id: pick('project_id', rec.project_id),
    client_id: pick('client_id', rec.client_id),
    min_value: pick('min_value', rec.suggested_min_value == null ? null : Number(rec.suggested_min_value)),
    max_value: pick('max_value', rec.suggested_max_value == null ? null : Number(rec.suggested_max_value)),
    max_risk: pick('max_risk', rec.suggested_max_risk),
    conditions: rec.approval_type ? { approval_types: [rec.approval_type] } : {},
    start_at: pick('start_at', null),
    end_at: pick('end_at', endDefault),
    priority: 200,
  };
}

const confirmationFor = (rec: Row, rule: Row) =>
  createHash('sha256').update(JSON.stringify({ rec: rec.id, evaluated: new Date(rec.last_evaluated_at).toISOString(), rule: { ...rule, end_at: rule.end_at ? String(rule.end_at).slice(0, 10) : null } })).digest('hex').slice(0, 32);

function reviewable(rec: Row) {
  if (!['generated', 'viewed', 'snoozed'].includes(rec.status)) throw new ValidationError(`This recommendation is ${rec.status}; it can no longer be reviewed`);
}

/** Step 1 of acceptance: the authority preview of the rule this recommendation would create (no write). */
export async function previewRecommendation(pool: Pool, ctx: AccessContext, id: string, body: unknown, now = new Date()) {
  requireOwner(ctx);
  const rec = await loadRecommendation(pool, ctx, id);
  reviewable(rec);
  const mods = parseModifications(body);
  const rule = ruleFromRecommendation(rec, mods, now);
  const preview = await previewRule(pool, ctx, rule, undefined, now);
  return { recommendation: present(rec), rule, preview, modified: Object.keys(mods).length > 0, confirmation: confirmationFor(rec, rule) };
}

/**
 * Step 2: the Owner confirms. The same rule is rebuilt on the server and must match what was
 * previewed (confirmation), then created through createRule (the authority API).
 */
export async function acceptRecommendation(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, body: unknown, now = new Date()) {
  requireOwner(ctx);
  const rec = await loadRecommendation(pool, ctx, id);
  reviewable(rec);
  const mods = parseModifications(body);
  const rule = ruleFromRecommendation(rec, mods, now);
  const given = (body as Row)?.confirmation;
  if (typeof given !== 'string' || given !== confirmationFor(rec, rule)) throw new ValidationError('Preview this rule first, then confirm it (the confirmation does not match the rule previewed)');
  const created = (await createRule(pool, ctx, actor, rule, now)) as Row;
  const differs = Object.keys(mods).some((k) => {
    const suggested = ruleFromRecommendation(rec, {}, now) as Row;
    return k === 'end_at' || k === 'start_at' ? !!mods[k] : String(mods[k] ?? '') !== String(suggested[k] ?? '');
  });
  const status = differs ? 'modified' : 'accepted';
  await withTransaction(pool, async (db) => {
    const res = await db.query(
      `UPDATE delegation_recommendations SET status = $2, authority_rule_id = $3, reviewed_at = $4, reviewed_by = $5, review_reason = $6, snoozed_until = NULL
       WHERE id = $1 AND status = ANY($7)`,
      [id, status, created.id, now, ctx.user.id, typeof (body as Row)?.reason === 'string' ? (body as Row).reason : null, ACTIVE]
    );
    if (!res.rowCount) throw new ValidationError('This recommendation was reviewed meanwhile');
    await writeAudit(db, actor, { action: `delegation.recommendation.${status === 'modified' ? 'modify' : 'accept'}`, entityType: 'delegation_recommendation', entityId: id, before: { status: rec.status }, after: { status, authority_rule_id: created.id, authority_rule_code: created.code, rule, modifications: mods } });
  });
  return { recommendation: present(await loadRecommendation(pool, ctx, id)), rule: created };
}

export async function rejectRecommendation(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, body: unknown, now = new Date()) {
  requireOwner(ctx);
  const reason = typeof (body as Row)?.reason === 'string' ? (body as Row).reason.trim() : '';
  const extra = Object.keys((body as Row) ?? {}).filter((k) => k !== 'reason');
  if (extra.length) throw new ValidationError(`Not allowed: ${extra.join(', ')}`);
  if (!reason) throw new ValidationError('A reason is required');
  return withTransaction(pool, async (db) => {
    const rec = await loadRecommendation(db, ctx, id);
    reviewable(rec);
    await db.query(`UPDATE delegation_recommendations SET status = 'rejected', reviewed_at = $2, reviewed_by = $3, review_reason = $4, snoozed_until = NULL WHERE id = $1`, [id, now, ctx.user.id, reason]);
    await writeAudit(db, actor, { action: 'delegation.recommendation.reject', entityType: 'delegation_recommendation', entityId: id, before: { status: rec.status }, after: { status: 'rejected' }, details: reason });
    return present(await loadRecommendation(db, ctx, id));
  });
}

export async function snoozeRecommendation(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, body: unknown, now = new Date()) {
  requireOwner(ctx);
  const b = (body ?? {}) as Row;
  const extra = Object.keys(b).filter((k) => !['days', 'reason'].includes(k));
  if (extra.length) throw new ValidationError(`Not allowed: ${extra.join(', ')}`);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');
  if (!Number.isInteger(b.days) || b.days < 1 || b.days > 90) throw new ValidationError('days must be a whole number from 1 to 90');
  const until = new Date(now.getTime() + b.days * DAY);
  return withTransaction(pool, async (db) => {
    const rec = await loadRecommendation(db, ctx, id);
    reviewable(rec);
    await db.query(`UPDATE delegation_recommendations SET status = 'snoozed', snoozed_until = $2, reviewed_at = $3, reviewed_by = $4, review_reason = $5 WHERE id = $1`, [id, until, now, ctx.user.id, reason]);
    await writeAudit(db, actor, { action: 'delegation.recommendation.snooze', entityType: 'delegation_recommendation', entityId: id, before: { status: rec.status }, after: { status: 'snoozed', snoozed_until: until.toISOString() }, details: reason });
    return present(await loadRecommendation(db, ctx, id));
  });
}

// ------------------------------------------------------------------ scheduled generation
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
};

export const delegationRecommendationRule: RuleDef = {
  key: 'delegation_recommendations',
  name: 'Delegation recommendations',
  description: 'Once a day, looks at the decisions the Owner took in the last 60 days because no delegation covered them, and suggests delegations that the evidence supports (conservative, explainable rules).',
  watches: [],
  interval_minutes: 1440,
  defaults: { ...RECOMMENDATION_DEFAULTS },
  actions: 'Write or refresh recommendations (never authority); tell the Owner at most once a week how many opportunities are open.',
  human_in_loop: 'Only the Owner turns a recommendation into authority: preview, then confirm, through the Authority Settings API. Nothing is delegated, approved or changed automatically.',
  async evaluate(rc) {
    const res = await generateDelegationRecommendations(rc.pool, rc.now, rc.config);
    const open = Number((await rc.pool.query(`SELECT count(*)::int AS n FROM delegation_recommendations WHERE status IN ('generated', 'viewed')`)).rows[0].n);
    const newThisWeek = Number((await rc.pool.query(`SELECT count(*)::int AS n FROM delegation_recommendations WHERE generated_at > $1::timestamptz - interval '7 days'`, [rc.now])).rows[0].n);
    if (!open || !newThisWeek) return [];
    const action: PlannedAction = {
      kind: 'notification',
      key: `delegation_recommendations:week:${isoWeek(rc.now)}`,
      users: rc.people.owners(),
      note: { title: `${open} delegation opportunit${open === 1 ? 'y' : 'ies'} identified`, message: `NW OS found decisions you take repeatedly that could be delegated (${res.created} new). Review them on the Owner Dashboard: nothing changes unless you accept one.`, type: 'information', priority: 'normal', project_id: null, link_tab: 'dashboard', entity_type: 'delegation_recommendation', entity_id: 'weekly' },
    };
    return [action];
  },
};
