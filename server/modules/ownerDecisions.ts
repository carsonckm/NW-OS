/**
 * Owner Center decision sections (Phase 6 Batch 9), built from the current approval routing:
 *
 * - Requires my decision: open routes assigned to the Owner (with the resolver's reason), routes
 *   whose assigned delegate may no longer decide them (the Owner is the authoritative fallback
 *   until the monitor re-routes them), and pending decisions not routed yet.
 * - High-risk decisions: pending decisions carrying the server's high-risk factors (sensitivity,
 *   safety, blocked production / site / payment, project risk), whoever they are with.
 * - Recently delegated: decisions routed away from the Owner — pending with a delegate now, or
 *   decided by a delegate in the last 7 days — with the delegation's status today.
 *
 * Everything comes from approval_routes and the existing classification (classifyOpenRoutes):
 * there is no second resolver, and nothing the browser sent or the request captured when it was
 * created (such as an approval request's assigned_approver_role) decides who must act.
 */
import type { AccessContext } from '../auth/access';
import type { Pool } from '../db/pool';
import { classifyOpenRoutes, HIGH_RISK_FACTORS, type ClassifiedRoute } from './approvalOps';
import { unroutedDecisions, type RoutedKind } from './approvalRouting';

type Row = Record<string, any>;
const OWNER = 'Owner / CEO';
export const RECENTLY_DELEGATED_DAYS = 7;

export const TAB: Record<RoutedKind, string> = { approval: 'approvals', variation: 'variations', drawing_revision: 'drawings', purchase_order: 'purchasing', invoice: 'commercial' };
const KIND_LABEL: Record<RoutedKind, string> = { approval: 'Approval request', variation: 'Variation', drawing_revision: 'Drawing revision', purchase_order: 'Purchase order', invoice: 'Supplier invoice' };
const money = (n: number | null) => (n == null ? null : `RM ${Math.round(n).toLocaleString('en-US')}`);

export interface DecisionItem {
  id: string;
  kind: RoutedKind;
  resource_id: string;
  title: string;
  project_id: string | null;
  project_name: string | null;
  decision_type: string | null;
  value: number | null;
  assignee: { id: string; name: string | null; role: string | null } | null;
  routing_basis: string | null;
  rule_code: string | null;
  status: string;
  due_at: string | null;
  waiting_hours: number | null;
  /** Plain-language reason this item is in the section. */
  why: string;
  reasons: string[];
  tab: string;
  /** critical: nobody valid has it, it is not routed, or it was escalated; otherwise high. */
  severity: 'critical' | 'high';
}

function base(c: ClassifiedRoute): Omit<DecisionItem, 'why' | 'reasons'> {
  const severity: DecisionItem['severity'] = !c.valid.ok || c.life.state === 'escalated' ? 'critical' : 'high';
  const r = c.r;
  return {
    id: `${r.resource_kind}:${r.resource_id}`,
    kind: r.resource_kind,
    resource_id: r.resource_id,
    title: c.title,
    project_id: r.project_id ?? null,
    project_name: r.project_name ?? null,
    decision_type: r.decision_type ?? null,
    value: c.value,
    assignee: { id: r.assigned_user_id, name: r.assignee_name ?? null, role: r.assignee_role ?? null },
    routing_basis: r.routing_basis,
    rule_code: r.authority_rule_code ?? null,
    status: c.life.status,
    due_at: c.life.due_at,
    waiting_hours: Math.round(c.life.age_hours),
    tab: TAB[r.resource_kind as RoutedKind],
    severity,
  };
}

/** Why the Owner holds it, in the resolver's words. */
function ownerWhy(c: ClassifiedRoute) {
  const r = c.r;
  const v = money(c.value);
  const lead = `${KIND_LABEL[r.resource_kind as RoutedKind]}${v ? ` ${v}` : ''}`;
  if (!c.valid.ok && !c.toOwner) return `${lead} — assigned to ${r.assignee_name}, who may no longer decide it (${c.valid.code}). NW OS re-routes it; until then it falls to you.`;
  if (!c.valid.ok) return `${lead} — no valid approver: ${c.valid.reason}.`;
  if (r.route_reason === 'escalated_overdue') return `${lead} — escalated to you: it was overdue with the previous approver.`;
  if (r.owner_reason_code === 'OWNER_ASSIGNED') return `${lead} — you took this approval.`;
  return `${lead} — Owner required: ${r.data?.owner_reason ?? r.owner_reason_code ?? 'no delegated authority applies'}.`;
}

/** Today's status of the rules behind delegated routes (current information, never rewriting history). */
async function ruleStatus(pool: Pool, ids: string[], now: Date) {
  if (!ids.length) return new Map<string, Row>();
  const rows = (await pool.query('SELECT id, code, active, start_at, end_at, deactivation_reason, updated_at FROM delegated_authorities WHERE id = ANY($1)', [ids])).rows;
  return new Map(
    rows.map((r) => {
      const inForce = r.active && (!r.start_at || new Date(r.start_at) <= now) && (!r.end_at || new Date(r.end_at) > now);
      return [r.id as string, { ...r, in_force: inForce }];
    })
  );
}
const ruleNote = (s: Row | undefined, decidedAt?: Date) => {
  if (!s) return null;
  if (!s.in_force) return { state: s.deactivation_reason === 'Expired' || (s.end_at && new Date(s.end_at) <= new Date()) ? 'expired' : 'revoked', text: `${s.code} is no longer in force${s.deactivation_reason ? ` (${s.deactivation_reason})` : ''}` };
  if (decidedAt && new Date(s.updated_at) > decidedAt) return { state: 'changed', text: `${s.code} has been changed since` };
  return { state: 'in_force', text: `${s.code} is still in force` };
};

export async function ownerDecisionSections(pool: Pool, ctx: AccessContext, now = new Date()) {
  const { classified } = await classifyOpenRoutes(pool, ctx, now);

  // ---------------- requires my decision
  const requires: DecisionItem[] = [];
  for (const c of classified) {
    if (!c.toOwner && c.valid.ok) continue; // with a delegate who may decide it: not the Owner's
    requires.push({ ...base(c), why: ownerWhy(c), reasons: c.f.map((x) => x.label) });
  }
  for (const o of await unroutedDecisions(pool)) {
    if (o.project_id && !ctx.canSeeProject(o.project_id)) continue;
    requires.push({ id: `${o.kind}:${o.id}`, kind: o.kind, resource_id: o.id, title: `${KIND_LABEL[o.kind]} ${o.id}`, project_id: o.project_id, project_name: null, decision_type: null, value: null, assignee: null, routing_basis: null, rule_code: null, status: 'Pending', due_at: null, waiting_hours: null, why: `${KIND_LABEL[o.kind]} — not routed yet: it stays with you until NW OS routes it.`, reasons: ['Pending with nobody assigned'], tab: TAB[o.kind], severity: 'critical' });
  }

  // ---------------- high-risk decisions (the server's own risk factors only)
  const highRisk: DecisionItem[] = [];
  for (const c of classified) {
    const risky = c.f.filter((x) => HIGH_RISK_FACTORS.includes(x.code));
    if (!risky.length) continue;
    const withWhom = c.toOwner ? 'with you' : `with ${c.r.assignee_name} (${c.r.assignee_role})`;
    highRisk.push({ ...base(c), why: `High risk: ${risky.map((x) => x.label).join('; ')} — ${withWhom}.`, reasons: risky.map((x) => x.code) });
  }

  // ---------------- recently delegated (current, then decided in the last 7 days; one entry per decision)
  const delegatedNow = classified.filter((c) => !c.toOwner);
  const decided = (
    await pool.query(
      `SELECT DISTINCT ON (ar.resource_kind, ar.resource_id) ar.*, p.project_name, u.name AS decided_by_name, u.role AS decided_by_role, a.name AS assignee_name, a.role AS assignee_role
       FROM approval_routes ar
       LEFT JOIN projects p ON p.id = ar.project_id
       LEFT JOIN users u ON u.id = ar.completed_by
       LEFT JOIN users a ON a.id = ar.assigned_user_id
       WHERE ar.status = 'completed' AND ar.completed_at > $1::timestamptz - make_interval(days => $2)
         AND ar.routing_basis NOT IN ('OWNER_FALLBACK', 'CLIENT_CONSENT') AND coalesce(u.role, '') <> $3
       ORDER BY ar.resource_kind, ar.resource_id, ar.completed_at DESC`,
      [now, RECENTLY_DELEGATED_DAYS, OWNER]
    )
  ).rows.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
  const status = await ruleStatus(pool, [...new Set([...delegatedNow.map((c) => c.r.authority_rule_id), ...decided.map((r) => r.authority_rule_id)].filter(Boolean))] as string[], now);
  const pendingKeys = new Set(classified.map((c) => `${c.r.resource_kind}:${c.r.resource_id}`));
  const recentlyDelegated: (DecisionItem & { delegation: 'active' | 'pending_reroute' | 'decided'; rule_status: Row | null; decided_at: string | null; outcome: string | null })[] = [];
  for (const c of delegatedNow) {
    const rs = ruleNote(status.get(c.r.authority_rule_id));
    const live = c.valid.ok;
    recentlyDelegated.push({
      ...base(c),
      delegation: live ? 'active' : 'pending_reroute',
      rule_status: rs,
      decided_at: null,
      outcome: null,
      why: live ? `Delegated to ${c.r.assignee_name} (${c.r.assignee_role})${c.r.authority_rule_code ? ` under ${c.r.authority_rule_code}` : ` by ${c.r.routing_basis}`}; waiting for their decision.` : `Was delegated to ${c.r.assignee_name}, who may no longer decide it (${c.valid.code}); it is being routed again.`,
      reasons: [],
    });
  }
  for (const r of decided) {
    const key = `${r.resource_kind}:${r.resource_id}`;
    if (pendingKeys.has(key)) continue; // pending again (e.g. changes requested): shown once, as current
    const decidedAt = new Date(r.completed_at);
    const rs = ruleNote(status.get(r.authority_rule_id), decidedAt);
    recentlyDelegated.push({
      id: key,
      kind: r.resource_kind,
      resource_id: r.resource_id,
      title: r.data?.title ?? `${KIND_LABEL[r.resource_kind as RoutedKind]} ${r.resource_id}`,
      project_id: r.project_id ?? null,
      project_name: r.project_name ?? null,
      decision_type: r.decision_type,
      value: r.value == null ? null : Number(r.value),
      assignee: { id: r.completed_by, name: r.decided_by_name, role: r.decided_by_role },
      routing_basis: r.routing_basis,
      rule_code: r.authority_rule_code ?? null,
      status: r.completion_result,
      due_at: null,
      waiting_hours: null,
      tab: TAB[r.resource_kind as RoutedKind],
      severity: 'high',
      delegation: 'decided',
      rule_status: rs,
      decided_at: decidedAt.toISOString(),
      outcome: r.completion_result,
      why: `Decided (${r.completion_result}) by ${r.decided_by_name} (${r.decided_by_role})${r.authority_rule_code ? ` under ${r.authority_rule_code}` : ` by ${r.routing_basis}`} on ${decidedAt.toISOString().slice(0, 10)}${rs && rs.state !== 'in_force' ? `; today ${rs.text} (the decision was valid under the terms at the time)` : ''}.`,
      reasons: [],
    });
  }
  recentlyDelegated.sort((a, b) => (a.delegation === 'decided' ? 1 : 0) - (b.delegation === 'decided' ? 1 : 0) || String(b.decided_at ?? '').localeCompare(String(a.decided_at ?? '')) || a.id.localeCompare(b.id));
  const byAge = (a: DecisionItem, b: DecisionItem) => (b.waiting_hours ?? 0) - (a.waiting_hours ?? 0) || a.id.localeCompare(b.id);
  return { requires: requires.sort(byAge), high_risk: highRisk.sort(byAge), recently_delegated: recentlyDelegated, window_days: RECENTLY_DELEGATED_DAYS, computed_at: now.toISOString() };
}
