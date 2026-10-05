/**
 * The Owner Exception Center: "what needs me today?" Only exceptions and decisions, grouped
 * as decisions required, critical exceptions, financial exceptions and client exceptions,
 * plus company health. Normal operational events are not listed. Everything comes from
 * PostgreSQL; money comes from the server's profitability calculation.
 *
 * Owner dependency analysis: how much still waits for or is decided by the Owner, how fast,
 * and which recurring decision types could be delegated. Recommendations only: nothing is
 * delegated automatically.
 */
import { ForbiddenError, type AccessContext } from '../auth/access';
import type { Pool } from '../db/pool';
import { computeProfitability } from './reports';
import { portfolioRisk } from './risk';

type Row = Record<string, any>;
export interface CenterItem {
  id: string;
  title: string;
  detail: string;
  severity: 'critical' | 'high' | 'medium';
  project_id: string | null;
  project_name: string;
  tab: string;
  entity_type?: string;
  entity_id?: string;
  waiting_hours?: number;
}

const RANK = { critical: 0, high: 1, medium: 2 } as const;
const sortItems = (items: CenterItem[]) => items.sort((a, b) => RANK[a.severity] - RANK[b.severity] || (b.waiting_hours ?? 0) - (a.waiting_hours ?? 0));
const hoursSince = (now: Date, t: unknown) => (t ? Math.max(0, Math.round((now.getTime() - new Date(t as string).getTime()) / 3600_000)) : undefined);
const money = (n: number) => `RM ${Math.round(n).toLocaleString('en-US')}`;

function checkOwner(ctx: AccessContext) {
  if (!ctx.can('management.view')) throw new ForbiddenError('Missing permission: management.view (owner exception center)');
}

export async function ownerCenter(pool: Pool, ctx: AccessContext, now = new Date()) {
  checkOwner(ctx);
  const today = now.toISOString().slice(0, 10);
  const projects = (await pool.query(`SELECT id, project_name, project_status, contract_value::float AS contract, end_date FROM projects ORDER BY id`)).rows.filter((p) => ctx.canSeeProject(p.id)) as Row[];
  const open = projects.filter((p) => !['Completed', 'Closed'].includes(p.project_status));
  const ids = open.map((p) => p.id as string);
  const pn = (id: string | null) => projects.find((p) => p.id === id)?.project_name ?? '';
  const ownerIds = (await pool.query(`SELECT id FROM users WHERE role = 'Owner / CEO' AND is_active`)).rows.map((r) => r.id as string);
  const decisions: CenterItem[] = [];
  const critical: CenterItem[] = [];
  const financial: CenterItem[] = [];
  const client: CenterItem[] = [];
  let overdueInv: Row[] = [];

  if (ids.length) {
    // ---------------- decisions required (only what the Owner must decide) ----------------
    for (const r of (await pool.query(`SELECT r.id, r.revision, r.data, d.project_id, d.data->>'drawing_number' AS number FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE r.kind = 'client' AND r.approval_status IN ('Internal Review', 'Pending Review', 'Review') AND d.project_id = ANY($1)`, [ids])).rows) {
      decisions.push({ id: `drw-${r.id}`, title: `Approve drawing ${r.number} ${r.revision}`, detail: `Requested by ${r.data.review_requested_by ?? 'the team'}`, severity: 'high', project_id: r.project_id, project_name: pn(r.project_id), tab: 'drawings', entity_type: 'drawing_revision', entity_id: r.id, waiting_hours: hoursSince(now, r.data.review_requested_at) });
    }
    for (const v of (await pool.query(`SELECT id, project_id, updated_at, client_amount::float AS amount, data->>'variation_number' AS number, data->>'title' AS title, data->>'created_by_id' AS author FROM variations WHERE status = 'Internal Approval' AND project_id = ANY($1)`, [ids])).rows) {
      if (ownerIds.includes(v.author)) continue; // the Owner can't approve their own variation
      decisions.push({ id: `vo-${v.id}`, title: `Variation ${v.number}: ${v.title}`, detail: `${money(v.amount)} to the client · internal approval`, severity: 'high', project_id: v.project_id, project_name: pn(v.project_id), tab: 'variations', entity_type: 'variation', entity_id: v.id, waiting_hours: hoursSince(now, v.updated_at) });
    }
    for (const a of (await pool.query(`SELECT id, project_id, created_at, data->>'title' AS title, data->>'approval_type' AS type FROM approvals WHERE decision = 'Pending' AND project_id = ANY($1) AND coalesce(data->>'assigned_approver_role', 'Owner / CEO') = 'Owner / CEO'`, [ids])).rows) {
      decisions.push({ id: `apr-${a.id}`, title: `${a.type ?? 'Approval'}: ${a.title}`, detail: 'Waiting for your approval', severity: a.type === 'Major Purchase' ? 'high' : 'medium', project_id: a.project_id, project_name: pn(a.project_id), tab: 'approvals', entity_type: 'approval', entity_id: a.id, waiting_hours: hoursSince(now, a.created_at) });
    }
    for (const i of (await pool.query(`SELECT id, project_id, priority, created_at, status, data->>'title' AS title, data->>'category' AS category FROM issues WHERE status NOT IN ('Resolved', 'Closed') AND (status = 'Decision Required' OR data->>'escalation_level' = 'Owner') AND project_id = ANY($1)`, [ids])).rows) {
      const toClient = /client/i.test(i.category ?? '');
      (toClient ? client : decisions).push({ id: `iss-${i.id}`, title: i.title, detail: `${i.category ?? 'Issue'} · ${i.priority} · escalated to you`, severity: i.priority === 'Critical' ? 'critical' : 'high', project_id: i.project_id, project_name: pn(i.project_id), tab: 'issues', entity_type: 'issue', entity_id: i.id, waiting_hours: hoursSince(now, i.created_at) });
    }
    for (const inv of (await pool.query(`SELECT id, project_id, created_at, data->>'invoice_number' AS number, data->>'match_status' AS match FROM commercial_invoices WHERE status = 'Pending Approval' AND coalesce(data->>'match_status', 'Matched') <> 'Matched' AND project_id = ANY($1)`, [ids])).rows) {
      decisions.push({ id: `inv-${inv.id}`, title: `Supplier invoice ${inv.number} — ${inv.match}`, detail: 'Only you can approve an invoice that does not match the PO and goods received', severity: 'high', project_id: inv.project_id, project_name: pn(inv.project_id), tab: 'commercial', entity_type: 'invoice', entity_id: inv.id, waiting_hours: hoursSince(now, inv.created_at) });
    }

    // ---------------- critical exceptions (from the risk engine + open owner escalations) ----------------
    const risks = await portfolioRisk(pool, ctx, now);
    const CRITICAL_DIMS: Record<string, string> = { Production: 'production', Quality: 'quality', Materials: 'materials', Site: 'site', Schedule: 'schedule', Issues: 'issues' };
    for (const r of risks) {
      for (const s of r.reasons) {
        if (!(s.dimension in CRITICAL_DIMS) || s.level === 'Attention') continue;
        critical.push({ id: `risk-${r.project_id}-${s.dimension}-${s.signal}`, title: s.signal, detail: `${s.detail}`, severity: s.level === 'Critical' ? 'critical' : 'high', project_id: r.project_id, project_name: r.project_name, tab: s.tab, entity_type: s.entity_type, entity_id: s.entity_id });
      }
      for (const s of r.reasons.filter((x) => x.dimension === 'Commercial')) {
        financial.push({ id: `fin-${r.project_id}-${s.signal}`, title: s.signal, detail: s.detail, severity: s.level === 'Critical' ? 'critical' : s.level === 'At Risk' ? 'high' : 'medium', project_id: r.project_id, project_name: r.project_name, tab: s.tab });
      }
      for (const s of r.reasons.filter((x) => x.dimension === 'Client')) {
        client.push({ id: `cli-${r.project_id}-${s.signal}`, title: s.signal, detail: s.detail, severity: 'medium', project_id: r.project_id, project_name: r.project_name, tab: s.tab, entity_type: s.entity_type, entity_id: s.entity_id });
      }
      const late = r.reasons.find((x) => x.signal === 'Past the completion date');
      if (late) client.push({ id: `cli-late-${r.project_id}`, title: 'Delay to communicate to the client', detail: late.detail, severity: 'high', project_id: r.project_id, project_name: r.project_name, tab: 'projects' });
    }
    for (const e of (await pool.query(`SELECT id, project_id, created_at, data->>'title' AS title, data->>'reason' AS reason, status FROM escalations WHERE status = 'Open' AND level = 2 AND (project_id IS NULL OR project_id = ANY($1))`, [ids])).rows) {
      critical.push({ id: `esc-${e.id}`, title: e.title, detail: `Escalated to you: ${e.reason ?? ''}`, severity: 'critical', project_id: e.project_id, project_name: pn(e.project_id), tab: 'notifications', entity_type: 'escalation', entity_id: e.id, waiting_hours: hoursSince(now, e.created_at) });
    }

    // ---------------- financial exceptions beyond the risk engine ----------------
    for (const p of open) {
      const prof = await computeProfitability(pool, p.id).catch(() => null);
      if (!prof || prof.estimated_direct_cost <= 0) continue;
      const planned = prof.original_contract_value - prof.estimated_direct_cost;
      const plannedMargin = prof.original_contract_value > 0 ? planned / prof.original_contract_value : 0;
      const nowMargin = prof.project_gross_margin_percent / 100;
      if (plannedMargin - nowMargin >= 0.05) {
        financial.push({ id: `margin-${p.id}`, title: 'Profitability deteriorating', detail: `Forecast margin ${(nowMargin * 100).toFixed(1)}% vs ${(plannedMargin * 100).toFixed(1)}% planned`, severity: nowMargin < 0 ? 'critical' : 'high', project_id: p.id, project_name: p.project_name, tab: 'commercial' });
      }
      const week = (await pool.query(`SELECT coalesce(sum(amount), 0)::float AS amt FROM project_cost_ledger WHERE project_id = $1 AND status IN ('Incurred', 'Reconciled') AND created_at > $2::timestamptz - interval '7 days'`, [p.id, now.toISOString()])).rows[0].amt;
      if (week > 0.1 * prof.estimated_direct_cost) {
        financial.push({ id: `costjump-${p.id}`, title: 'Unexpected cost increase', detail: `${money(week)} of actual cost booked in the last 7 days (${Math.round((week / prof.estimated_direct_cost) * 100)}% of budget)`, severity: 'medium', project_id: p.id, project_name: p.project_name, tab: 'commercial' });
      }
    }
    overdueInv = (await pool.query(`SELECT id, project_id, data->>'invoice_number' AS number, data->>'invoice_type' AS type, data->>'party_name' AS party, data->>'due_date' AS due, coalesce((data->>'total_amount')::numeric, 0)::float - coalesce((data->>'paid_amount')::numeric, 0)::float AS outstanding FROM commercial_invoices WHERE project_id = ANY($1) AND coalesce(status, '') NOT IN ('Paid', 'Draft') AND coalesce(data->>'due_date', '') <> '' AND data->>'due_date' < $2`, [ids, today])).rows;
    for (const inv of overdueInv) {
      const fromClient = inv.type === 'Client Billing Invoice';
      financial.push({ id: `od-${inv.id}`, title: `${fromClient ? 'Client payment overdue' : 'Supplier invoice overdue'}: ${inv.number}`, detail: `${inv.party ?? ''} · ${money(inv.outstanding)} · due ${inv.due}`, severity: fromClient ? 'high' : 'medium', project_id: inv.project_id, project_name: pn(inv.project_id), tab: 'commercial', entity_type: 'invoice', entity_id: inv.id });
    }
    for (const c of (await pool.query(`SELECT id, project_id, data->>'claim_number' AS number, coalesce((data->>'certified_amount')::numeric, (data->>'net_claim_amount')::numeric, 0)::float AS amt, updated_at FROM financial_claims WHERE project_id = ANY($1) AND status = 'Certified' AND updated_at < $2::timestamptz - interval '30 days'`, [ids, now.toISOString()])).rows) {
      financial.push({ id: `cash-${c.id}`, title: `Cash collection risk: ${c.number}`, detail: `${money(c.amt)} certified over 30 days ago, not paid`, severity: 'high', project_id: c.project_id, project_name: pn(c.project_id), tab: 'commercial' });
    }

    // ---------------- client exceptions ----------------
    for (const r of (await pool.query(`SELECT id, project_id, status, created_at, data->>'title' AS title, data->>'request_code' AS code FROM client_change_requests WHERE project_id = ANY($1) AND coalesce(status, '') NOT IN ('Approved', 'Rejected', 'Implemented', 'Closed', 'Completed')`, [ids])).rows) {
      client.push({ id: `ccr-${r.id}`, title: `Client request ${r.code ?? ''}: ${r.title ?? ''}`.trim(), detail: `${r.status ?? 'Open'}`, severity: 'medium', project_id: r.project_id, project_name: pn(r.project_id), tab: 'delivery', waiting_hours: hoursSince(now, r.created_at) });
    }
  }

  // ---------------- company health ----------------
  const risks = ids.length ? await portfolioRisk(pool, ctx, now) : [];
  let committed = 0;
  let actual = 0;
  let exposure = 0;
  for (const p of open) {
    const prof = await computeProfitability(pool, p.id).catch(() => null);
    if (!prof) continue;
    committed += prof.committed_cost;
    actual += prof.actual_cost;
    if (prof.project_gross_profit < 0) exposure += -prof.project_gross_profit;
    else if (prof.cost_variance > 0) exposure += prof.cost_variance;
  }
  const count = async (sql: string, params: unknown[]) => (ids.length ? (await pool.query(sql, params)).rows[0].n : 0);
  const health = {
    active_projects: open.filter((p) => p.project_status === 'Active').length,
    open_projects: open.length,
    at_risk: risks.filter((r) => r.level === 'At Risk').length,
    critical: risks.filter((r) => r.level === 'Critical').length,
    outstanding_approvals: decisions.length,
    overdue_tasks: await count(`SELECT count(*)::int AS n FROM tasks WHERE project_id = ANY($1) AND status NOT IN ('Completed', 'Cancelled') AND coalesce(due_date, '') <> '' AND due_date < $2`, [ids, today]),
    outstanding_payments: Math.round(overdueInv.filter((i) => i.type === 'Client Billing Invoice').reduce((s, i) => s + i.outstanding, 0)),
    committed_cost: Math.round(committed),
    actual_cost: Math.round(actual),
    forecast_exposure: Math.round(exposure),
  };

  return {
    question: 'What needs me today?',
    decisions: sortItems(decisions),
    critical: sortItems(critical),
    financial: sortItems(financial),
    client: sortItems(client),
    health,
    risk: risks.map((r) => ({ project_id: r.project_id, project_name: r.project_name, level: r.level, reasons: r.reasons.slice(0, 3).map((x) => x.signal) })),
    computed_at: now.toISOString(),
  };
}

// ------------------------------------------------------------------- owner dependency
const DECISION_ACTIONS = ['approval.approve', 'approval.reject', 'approval.request_changes', 'variation.transition', 'drawing.revision.approve', 'drawing.revision.reject', 'quotation.approve', 'invoice.approve', 'issue.resolve', 'knowledge.approved', 'handover.sign'];

async function categorize(pool: Pool, a: Row): Promise<{ category: string; requested_at?: string; routine: boolean }> {
  switch (a.action) {
    case 'approval.approve':
    case 'approval.reject':
    case 'approval.request_changes': {
      const ap = (await pool.query(`SELECT created_at, data->>'approval_type' AS type FROM approvals WHERE id = $1`, [a.entity_id])).rows[0];
      return { category: `${ap?.type ?? 'Other'} approval`, requested_at: ap?.created_at, routine: a.action === 'approval.approve' };
    }
    case 'variation.transition': {
      const v = (await pool.query(`SELECT data FROM variations WHERE id = $1`, [a.entity_id])).rows[0];
      const req = (v?.data?.history ?? []).find((h: Row) => h.to === 'Internal Approval');
      return { category: 'Variation approval', requested_at: req?.at, routine: a.after?.status !== 'Rejected' };
    }
    case 'drawing.revision.approve':
    case 'drawing.revision.reject': {
      const r = (await pool.query(`SELECT data FROM drawing_revisions WHERE id = $1`, [a.entity_id])).rows[0];
      return { category: 'Drawing approval', requested_at: r?.data?.review_requested_at, routine: a.action === 'drawing.revision.approve' };
    }
    case 'invoice.approve': {
      const i = (await pool.query(`SELECT created_at, data->>'match_status' AS match FROM commercial_invoices WHERE id = $1`, [a.entity_id])).rows[0];
      return { category: i?.match && i.match !== 'Matched' ? 'Mismatched invoice approval' : 'Invoice approval', requested_at: i?.created_at, routine: !i?.match || i.match === 'Matched' };
    }
    case 'quotation.approve':
      return { category: 'Quotation approval', routine: true };
    case 'knowledge.approved':
      return { category: 'Knowledge approval', routine: true };
    case 'handover.sign':
      return { category: 'Handover sign-off', routine: false };
    case 'issue.resolve': {
      const i = (await pool.query(`SELECT created_at, data->>'category' AS category FROM issues WHERE id = $1`, [a.entity_id])).rows[0];
      return { category: `Issue decision (${i?.category ?? 'other'})`, requested_at: i?.created_at, routine: false };
    }
    default:
      return { category: a.action, routine: false };
  }
}

const DELEGATE_TO: Record<string, string> = {
  'Invoice approval': 'the Accountant (finance already approves matched invoices)',
  'Drawing approval': 'a senior PM or design lead with drawings.approve',
  'Quotation approval': 'the Accountant or a commercial manager',
  'Variation approval': 'the PM for variations under an agreed amount',
  'Major Purchase approval': 'the PM or Purchasing for purchases under an agreed amount',
};

export async function ownerDependency(pool: Pool, ctx: AccessContext, now = new Date()) {
  checkOwner(ctx);
  const ownerIds = (await pool.query(`SELECT id FROM users WHERE role = 'Owner / CEO'`)).rows.map((r) => r.id as string);
  const center = await ownerCenter(pool, ctx, now);
  const startOfDay = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  const weekAgo = new Date(now.getTime() - 7 * 86400_000);
  const actions = (
    await pool.query(
      `SELECT id, action, entity_type, entity_id, project_id, after, occurred_at AS created_at FROM audit_logs
       WHERE actor_id = ANY($1) AND action = ANY($2) AND occurred_at >= $3 ORDER BY occurred_at`,
      [ownerIds, DECISION_ACTIONS, weekAgo.toISOString()]
    )
  ).rows as Row[];
  const decided: (Row & { category: string; response_hours?: number; routine: boolean })[] = [];
  for (const a of actions) {
    if (a.action === 'variation.transition' && !['Client Approval', 'Rejected'].includes(a.after?.status)) continue; // only the internal decision
    const c = await categorize(pool, a);
    const response = c.requested_at ? (new Date(a.created_at).getTime() - new Date(c.requested_at).getTime()) / 3600_000 : undefined;
    decided.push({ ...a, ...c, response_hours: response !== undefined && response >= 0 ? response : undefined });
  }
  const today = decided.filter((d) => new Date(d.created_at) >= startOfDay);
  const byCategory = new Map<string, { count: number; routine: number }>();
  for (const d of decided) {
    const e = byCategory.get(d.category) ?? { count: 0, routine: 0 };
    e.count++;
    if (d.routine) e.routine++;
    byCategory.set(d.category, e);
  }
  const responses = decided.map((d) => d.response_hours).filter((h): h is number => h !== undefined);
  const tasksOwner = (await pool.query(`SELECT count(*) FILTER (WHERE status NOT IN ('Completed', 'Cancelled'))::int AS open, count(*) FILTER (WHERE status = 'Waiting')::int AS waiting FROM tasks WHERE assigned_user_id = ANY($1)`, [ownerIds])).rows[0];
  const waitingOnOwner = center.decisions.length;
  const blockedProjects = [...new Set(center.decisions.filter((d) => (d.waiting_hours ?? 0) >= 48 && d.project_id).map((d) => d.project_id as string))];
  const recurring = [...byCategory.entries()].filter(([, v]) => v.count >= 3).map(([category, v]) => ({ category, count: v.count, routine: v.routine }));
  const repeatable = recurring.reduce((s, r) => s + r.routine, 0);
  return {
    today: {
      decisions: center.decisions.length,
      approvals: center.decisions.filter((d) => /approv/i.test(d.title) || d.tab === 'approvals' || d.tab === 'drawings' || d.tab === 'variations').length,
      escalations: center.critical.filter((c) => c.id.startsWith('esc-')).length,
      client_issues: center.client.filter((c) => c.id.startsWith('iss-')).length,
      decided_today: today.length,
    },
    week: {
      owner_actions: decided.length,
      repeatable_operational_decisions: repeatable,
      by_category: [...byCategory.entries()].map(([category, v]) => ({ category, count: v.count, routine: v.routine })).sort((a, b) => b.count - a.count),
    },
    waiting: {
      tasks_assigned_to_owner: tasksOwner.open,
      tasks_waiting_for_owner: tasksOwner.waiting,
      approvals_waiting_for_owner: waitingOnOwner,
      escalations_to_owner: center.critical.filter((c) => c.id.startsWith('esc-')).length,
      projects_blocked_by_owner: blockedProjects.map((id) => ({ project_id: id, project_name: center.decisions.find((d) => d.project_id === id)?.project_name ?? id })),
    },
    average_response_hours: responses.length ? Math.round((responses.reduce((s, h) => s + h, 0) / responses.length) * 10) / 10 : null,
    recommendations: recurring
      .filter((r) => r.routine >= 3)
      .map((r) => ({
        category: r.category,
        observed: `${r.routine} of ${r.count} ${r.category.toLowerCase()} decisions this week were routine approvals`,
        suggestion: `Consider delegating ${r.category.toLowerCase()} to ${DELEGATE_TO[r.category] ?? 'a manager'} with a clear threshold, keeping exceptions with you.`,
        automatic: false,
      })),
    note: 'Recommendations only. Nothing is delegated or automated without your decision.',
    computed_at: now.toISOString(),
  };
}
