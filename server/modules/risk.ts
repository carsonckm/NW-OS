/**
 * Project risk and health: a rule-based, explainable operational indicator computed from
 * PostgreSQL. Every signal says what it is, where it comes from and how serious it is; the
 * project's level is the worst signal (three or more At Risk signals make it Critical).
 * It is an operational indicator only — never the basis of a financial or contractual
 * decision. Commercial signals are only included for roles that may see project financials.
 */
import type { Pool, PoolClient } from '../db/pool';
import { canSeeProjectFinancials } from '../auth/permissions';
import type { AccessContext } from '../auth/access';
import { NotFoundError } from '../core/repository';
import { computeProfitability } from './reports';

type Db = Pool | PoolClient;
export type RiskLevel = 'On Track' | 'Attention' | 'At Risk' | 'Critical';
export type Dimension = 'Schedule' | 'Production' | 'Materials' | 'Site' | 'Quality' | 'Commercial' | 'Client' | 'Issues';
export const DIMENSIONS: Dimension[] = ['Schedule', 'Production', 'Materials', 'Site', 'Quality', 'Commercial', 'Client', 'Issues'];
const RANK: Record<RiskLevel, number> = { 'On Track': 0, Attention: 1, 'At Risk': 2, Critical: 3 };

export interface RiskSignal {
  dimension: Dimension;
  level: Exclude<RiskLevel, 'On Track'>;
  signal: string;
  detail: string;
  /** Where to act on it. */
  tab: string;
  entity_type?: string;
  entity_id?: string;
}

export interface ProjectRisk {
  project_id: string;
  project_name: string;
  project_status: string;
  level: RiskLevel;
  reasons: RiskSignal[];
  dimensions: { dimension: Dimension; level: RiskLevel; reasons: string[] }[];
  computed_at: string;
  basis: string;
}

const worst = (levels: RiskLevel[]): RiskLevel => levels.reduce<RiskLevel>((a, b) => (RANK[b] > RANK[a] ? b : a), 'On Track');
const days = (ms: number) => Math.floor(ms / 86400_000);

/** All signals for one project (commercial ones only when `financial`). */
export async function riskSignals(db: Db, projectId: string, now: Date, financial: boolean): Promise<RiskSignal[]> {
  const today = now.toISOString().slice(0, 10);
  const out: RiskSignal[] = [];
  const project = (await db.query('SELECT id, project_status, end_date, project_name FROM projects WHERE id = $1', [projectId])).rows[0];
  if (!project) throw new NotFoundError('projects', projectId);

  // Schedule: overdue tasks, and the schedule buffer against the end date.
  const tasks = (
    await db.query(
      `SELECT id, due_date, priority, data->>'title' AS title FROM tasks
       WHERE project_id = $1 AND status NOT IN ('Completed', 'Cancelled') AND coalesce(due_date, '') <> '' AND due_date < $2 ORDER BY due_date`,
      [projectId, today]
    )
  ).rows;
  const seriousLate = tasks.filter((t) => ['High', 'Urgent', 'Critical'].includes(t.priority) && days(now.getTime() - Date.parse(t.due_date)) >= 3);
  if (tasks.length) {
    out.push({ dimension: 'Schedule', level: tasks.length >= 3 || seriousLate.length ? 'At Risk' : 'Attention', signal: `${tasks.length} overdue task${tasks.length > 1 ? 's' : ''}`, detail: tasks.slice(0, 3).map((t) => `${t.title} (due ${t.due_date})`).join('; '), tab: 'automation', entity_type: 'task', entity_id: tasks[0].id });
  }
  const items = (await db.query(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'Completed')::int AS done FROM work_items WHERE project_id = $1`, [projectId])).rows[0];
  if (project.end_date && !['Completed', 'Closed'].includes(project.project_status)) {
    const end = new Date(project.end_date).getTime();
    const left = days(end - now.getTime());
    const progress = items.total ? items.done / items.total : 1;
    if (left < 0) out.push({ dimension: 'Schedule', level: 'Critical', signal: 'Past the completion date', detail: `End date ${String(project.end_date).slice(0, 10)}; ${items.done}/${items.total} work items completed`, tab: 'projects' });
    else if (left <= 14 && progress < 0.8) out.push({ dimension: 'Schedule', level: 'At Risk', signal: 'Little schedule buffer left', detail: `${left} days to the end date with ${Math.round(progress * 100)}% of work items completed`, tab: 'projects' });
  }

  // Production: blocked or built from an unapproved drawing; late against the required date.
  const prod = (
    await db.query(
      `SELECT id, status, drawing_check, updated_at, data->>'order_number' AS number, data->>'required_date' AS required FROM production_orders
       WHERE project_id = $1 AND status NOT IN ('Completed', 'Cancelled')`,
      [projectId]
    )
  ).rows;
  for (const o of prod.filter((o) => o.status === 'Blocked' || o.drawing_check === 'invalid')) {
    const blockedDays = days(now.getTime() - new Date(o.updated_at).getTime());
    out.push({ dimension: 'Production', level: blockedDays >= 2 ? 'Critical' : 'At Risk', signal: `Production ${o.number ?? o.id} ${o.drawing_check === 'invalid' ? 'on an unapproved drawing' : 'blocked'}`, detail: blockedDays ? `for ${blockedDays} day(s)` : 'since today', tab: 'production', entity_type: 'production_order', entity_id: o.id });
  }
  const lateProd = prod.filter((o) => o.required && o.required < today && !['Ready for Delivery', 'Blocked'].includes(o.status));
  if (lateProd.length) out.push({ dimension: 'Production', level: 'At Risk', signal: `${lateProd.length} production order(s) behind the required date`, detail: lateProd.slice(0, 3).map((o) => `${o.number ?? o.id} (${o.status}, needed ${o.required})`).join('; '), tab: 'production' });

  // Materials: requests not ordered by their needed-by date; problems at goods received.
  const mrs = (await db.query(`SELECT id, data FROM material_requests WHERE project_id = $1 AND coalesce(status, data->>'status', 'Pending') IN ('Pending', 'Requested')`, [projectId])).rows;
  const lateMr = mrs.filter((m) => m.data.needed_by_date && m.data.needed_by_date < today);
  const soonMr = mrs.filter((m) => m.data.needed_by_date && m.data.needed_by_date >= today && days(Date.parse(m.data.needed_by_date) - now.getTime()) <= 3);
  if (lateMr.length) out.push({ dimension: 'Materials', level: 'At Risk', signal: `Material shortage: ${lateMr.length} request(s) past their needed-by date with no PO`, detail: lateMr.slice(0, 3).map((m) => `${m.data.material_name} (needed ${m.data.needed_by_date})`).join('; '), tab: 'purchasing', entity_type: 'material_request', entity_id: lateMr[0].id });
  if (soonMr.length) out.push({ dimension: 'Materials', level: 'Attention', signal: `${soonMr.length} material request(s) needed within 3 days, not yet ordered`, detail: soonMr.slice(0, 3).map((m) => `${m.data.material_name} (needed ${m.data.needed_by_date})`).join('; '), tab: 'purchasing' });
  const grn = (await db.query(`SELECT id, data->>'grn_number' AS number, data->>'condition' AS condition FROM goods_received WHERE project_id = $1 AND coalesce(data->>'condition', 'Good') <> 'Good' AND created_at > now() - interval '14 days'`, [projectId])).rows;
  if (grn.length) out.push({ dimension: 'Materials', level: 'Attention', signal: `${grn.length} recent delivery problem(s) at goods received`, detail: grn.map((g) => `${g.number ?? g.id}: ${g.condition}`).join('; '), tab: 'purchasing' });

  // Site: late deliveries, delivery issues, installations behind plan.
  const dels = (await db.query(`SELECT id, status, delivery_date, data->>'delivery_number' AS number FROM deliveries WHERE project_id = $1 AND status NOT IN ('Delivered', 'Received / Confirmed', 'Cancelled')`, [projectId])).rows;
  for (const d of dels) {
    if (d.status === 'Delivery Issue') out.push({ dimension: 'Site', level: 'At Risk', signal: `Delivery ${d.number ?? d.id} has an issue`, detail: 'Reported at site', tab: 'delivery', entity_type: 'delivery', entity_id: d.id });
    else if (d.delivery_date && d.delivery_date < today) out.push({ dimension: 'Site', level: 'At Risk', signal: `Delivery ${d.number ?? d.id} ${days(now.getTime() - Date.parse(d.delivery_date))} day(s) late`, detail: `Was due ${d.delivery_date}`, tab: 'delivery', entity_type: 'delivery', entity_id: d.id });
  }
  const inst = (await db.query(`SELECT id, data->>'job_number' AS number, data->>'planned_completion_date' AS planned FROM installation_jobs WHERE project_id = $1 AND status NOT IN ('Completed', 'Cancelled')`, [projectId])).rows.filter((j) => j.planned && j.planned < today);
  if (inst.length) out.push({ dimension: 'Site', level: inst.length >= 3 ? 'At Risk' : 'Attention', signal: `${inst.length} installation(s) behind schedule`, detail: inst.slice(0, 3).map((j) => `${j.number ?? j.id} (planned ${j.planned})`).join('; '), tab: 'delivery' });

  // Quality: open site QC failures, factory QC rework.
  const qc = (
    await db.query(
      `SELECT DISTINCT ON (q.work_item_id) q.id, q.result, w.item_code FROM site_qc_inspections q JOIN work_items w ON w.id = q.work_item_id
       WHERE q.project_id = $1 ORDER BY q.work_item_id, coalesce(q.inspected_at, '') DESC, q.created_at DESC, q.id DESC`,
      [projectId]
    )
  ).rows.filter((q) => q.result === 'Fail / Rectification Required');
  if (qc.length) out.push({ dimension: 'Quality', level: 'At Risk', signal: `Site QC failed on ${qc.length} work item(s)`, detail: qc.map((q) => q.item_code).join(', ') + ' — rectification and re-inspection needed', tab: 'delivery', entity_type: 'site_qc', entity_id: qc[0].id });
  const fqc = (await db.query(`SELECT count(*)::int AS n FROM factory_qc_inspections f JOIN production_orders o ON o.id = f.production_order_id WHERE o.project_id = $1 AND f.result IN ('Rework Required', 'Failed', 'Scrap / Reject') AND o.status NOT IN ('Completed', 'Ready for Delivery', 'Cancelled')`, [projectId])).rows[0].n;
  if (fqc) out.push({ dimension: 'Quality', level: 'Attention', signal: `${fqc} factory QC rework(s) open`, detail: 'Production orders returned for rework', tab: 'production' });

  // Issues: open critical / high issues, issues escalated to the owner.
  const issues = (await db.query(`SELECT id, priority, data->>'title' AS title, data->>'escalation_level' AS lvl FROM issues WHERE project_id = $1 AND status NOT IN ('Resolved', 'Closed')`, [projectId])).rows;
  const critical = issues.filter((i) => i.priority === 'Critical');
  const high = issues.filter((i) => i.priority === 'High');
  if (critical.length) out.push({ dimension: 'Issues', level: 'Critical', signal: `${critical.length} open critical issue(s)`, detail: critical.slice(0, 3).map((i) => i.title).join('; '), tab: 'issues', entity_type: 'issue', entity_id: critical[0].id });
  if (high.length) out.push({ dimension: 'Issues', level: high.length >= 3 ? 'At Risk' : 'Attention', signal: `${high.length} open high-priority issue(s)`, detail: high.slice(0, 3).map((i) => i.title).join('; '), tab: 'issues', entity_type: 'issue', entity_id: high[0].id });

  // Client: variations waiting for the client; change requests waiting.
  const vos = (await db.query(`SELECT id, status, updated_at, data->>'variation_number' AS number FROM variations WHERE project_id = $1 AND status IN ('Identified', 'Costing', 'Internal Approval', 'Client Approval')`, [projectId])).rows;
  const waitingClient = vos.filter((v) => v.status === 'Client Approval' && days(now.getTime() - new Date(v.updated_at).getTime()) >= 7);
  if (waitingClient.length) out.push({ dimension: 'Client', level: 'Attention', signal: `${waitingClient.length} variation(s) waiting over a week for client approval`, detail: waitingClient.map((v) => v.number).join(', '), tab: 'variations', entity_type: 'variation', entity_id: waitingClient[0].id });
  const ccr = (await db.query(`SELECT count(*)::int AS n FROM client_change_requests WHERE project_id = $1 AND coalesce(status, '') IN ('Submitted', 'Under Review', 'Pending', 'New')`, [projectId])).rows[0].n;
  if (ccr) out.push({ dimension: 'Client', level: 'Attention', signal: `${ccr} client change request(s) unresolved`, detail: 'Waiting for NW response', tab: 'delivery' });

  // Commercial (financial roles only): cost overrun, negative gross profit, unapproved variation work, overdue client invoices.
  if (financial) {
    try {
      const p = await computeProfitability(db, projectId);
      if (p.project_gross_profit < 0) out.push({ dimension: 'Commercial', level: 'Critical', signal: 'Forecast gross loss', detail: `Forecast gross profit RM ${p.project_gross_profit.toLocaleString('en-US')}`, tab: 'commercial' });
      else if (p.estimated_direct_cost > 0 && p.cost_variance > 0) out.push({ dimension: 'Commercial', level: p.cost_variance > 0.1 * p.estimated_direct_cost ? 'At Risk' : 'Attention', signal: 'Forecast cost over budget', detail: `RM ${p.cost_variance.toLocaleString('en-US')} over a budget of RM ${p.estimated_direct_cost.toLocaleString('en-US')}`, tab: 'commercial' });
    } catch {
      // no commercial baseline for this project
    }
    const unapproved = vos.filter((v) => ['Identified', 'Costing'].includes(v.status) && days(now.getTime() - new Date(v.updated_at).getTime()) >= 7);
    if (unapproved.length) out.push({ dimension: 'Commercial', level: 'Attention', signal: `${unapproved.length} variation(s) not yet costed or approved after a week`, detail: unapproved.map((v) => v.number).join(', ') + ' — work may be proceeding without approval', tab: 'variations' });
    const inv = (await db.query(`SELECT count(*)::int AS n, coalesce(sum((data->>'total_amount')::numeric), 0)::float AS amt FROM commercial_invoices WHERE project_id = $1 AND data->>'invoice_type' = 'Client Billing Invoice' AND coalesce(status, '') NOT IN ('Paid', 'Draft') AND coalesce(data->>'due_date', '') < $2 AND coalesce(data->>'due_date', '') <> ''`, [projectId, today])).rows[0];
    if (inv.n) out.push({ dimension: 'Commercial', level: 'Attention', signal: `${inv.n} client invoice(s) overdue`, detail: `RM ${Number(inv.amt).toLocaleString('en-US')} outstanding`, tab: 'commercial' });
  }
  return out;
}

export function levelOf(signals: RiskSignal[]): RiskLevel {
  const level = worst(signals.map((s) => s.level));
  return level === 'At Risk' && signals.filter((s) => s.level === 'At Risk').length >= 3 ? 'Critical' : level;
}

export async function computeProjectRisk(db: Db, projectId: string, now: Date, financial: boolean): Promise<ProjectRisk> {
  const project = (await db.query('SELECT id, project_name, project_status FROM projects WHERE id = $1', [projectId])).rows[0];
  if (!project) throw new NotFoundError('projects', projectId);
  const reasons = ['Completed', 'Closed'].includes(project.project_status) ? [] : await riskSignals(db, projectId, now, financial);
  reasons.sort((a, b) => RANK[b.level] - RANK[a.level]);
  return {
    project_id: projectId,
    project_name: project.project_name,
    project_status: project.project_status,
    level: levelOf(reasons),
    reasons,
    dimensions: DIMENSIONS.filter((d) => financial || d !== 'Commercial').map((d) => {
      const rs = reasons.filter((r) => r.dimension === d);
      return { dimension: d, level: worst(rs.map((r) => r.level)), reasons: rs.map((r) => r.signal) };
    }),
    computed_at: now.toISOString(),
    basis: 'Operational indicator from live records (worst signal; three At Risk signals make it Critical). Not a financial or contractual assessment.',
  };
}

/** Risk for a project the user can see (commercial signals only for financial roles). */
export async function projectRiskFor(pool: Pool, ctx: AccessContext, projectId: string, now = new Date()) {
  if (!ctx.canSeeProject(projectId)) throw new NotFoundError('projects', projectId);
  return computeProjectRisk(pool, projectId, now, canSeeProjectFinancials(ctx.user.role) && ctx.can('commercial.view'));
}

/** Every open project in the user's scope, worst first. */
export async function portfolioRisk(pool: Pool, ctx: AccessContext, now = new Date()) {
  const ids = (await pool.query(`SELECT id FROM projects WHERE project_status NOT IN ('Completed', 'Closed') ORDER BY id`)).rows.map((r) => r.id as string).filter((id) => ctx.canSeeProject(id));
  const out: ProjectRisk[] = [];
  for (const id of ids) out.push(await projectRiskFor(pool, ctx, id, now));
  return out.sort((a, b) => RANK[b.level] - RANK[a.level] || b.reasons.length - a.reasons.length);
}

/**
 * Stores the computed level on the project (risk_status / is_at_risk / risk_reason are the
 * server's, not the browser's) and audits changes. Uses all signals, including commercial.
 * Returns the projects whose level changed.
 */
export async function refreshStoredRisk(db: Db, now = new Date()) {
  const projects = (await db.query(`SELECT id, risk_status FROM projects`)).rows as { id: string; risk_status: string | null }[];
  const changed: { project_id: string; from: string | null; to: RiskLevel; reasons: string[] }[] = [];
  for (const p of projects) {
    const r = await computeProjectRisk(db, p.id, now, true);
    const reason = r.reasons.slice(0, 3).map((x) => x.signal).join('; ') || null;
    const res = await db.query(
      `UPDATE projects SET risk_status = $2, is_at_risk = $3, risk_reason = $4, updated_at = now()
       WHERE id = $1 AND (risk_status IS DISTINCT FROM $2 OR risk_reason IS DISTINCT FROM $4)`,
      [p.id, r.level, RANK[r.level] >= RANK['At Risk'], reason]
    );
    if (res.rowCount && p.risk_status !== r.level) changed.push({ project_id: p.id, from: p.risk_status, to: r.level, reasons: r.reasons.map((x) => x.signal) });
  }
  return changed;
}
