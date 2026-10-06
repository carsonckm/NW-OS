/**
 * The daily operational briefing for the signed-in user, built from PostgreSQL only: their
 * tasks today, what is overdue, what is blocked or arriving on their projects, which projects
 * are at risk and why, and the decisions waiting for them. Every number links to records the
 * user may see; nothing is generated or estimated.
 */
import type { AccessContext } from '../auth/access';
import { ForbiddenError } from '../auth/access';
import type { Pool } from '../db/pool';
import { portfolioRisk } from './risk';

export interface BriefingItem {
  label: string;
  detail: string;
  tab: string;
  project_id: string | null;
  entity_type?: string;
  entity_id?: string;
}

export async function dailyBriefing(pool: Pool, ctx: AccessContext, now = new Date()) {
  if (['Client', 'Contractor'].includes(ctx.user.role)) throw new ForbiddenError('The daily briefing is for NW staff');
  const me = ctx.user;
  const today = now.toISOString().slice(0, 10);
  const in2 = new Date(now.getTime() + 2 * 86400_000).toISOString().slice(0, 10);
  const all = (await pool.query(`SELECT id, project_name, project_manager_id, site_supervisor_id FROM projects WHERE project_status NOT IN ('Completed', 'Closed')`)).rows as Record<string, string>[];
  const assigned = new Set((await pool.query('SELECT project_id FROM project_assignments WHERE user_id = $1', [me.id])).rows.map((r) => r.project_id as string));
  // "My projects": the ones I manage, supervise or am assigned to; company-wide roles see all in scope.
  const mine = all.filter((p) => ctx.canSeeProject(p.id) && (ctx.companyWide || p.project_manager_id === me.id || p.site_supervisor_id === me.id || assigned.has(p.id)));
  const ids = mine.map((p) => p.id);
  const name = new Map(mine.map((p) => [p.id, p.project_name]));
  const pn = (id: string | null) => (id ? name.get(id) ?? '' : '');

  const myTasks = (
    await pool.query(
      `SELECT id, project_id, due_date, status, priority, data->>'title' AS title FROM tasks
       WHERE assigned_user_id = $1 AND status NOT IN ('Completed', 'Cancelled') AND coalesce(due_date, '') <> '' AND due_date <= $2 ORDER BY due_date`,
      [me.id, today]
    )
  ).rows;
  const due: BriefingItem[] = myTasks.filter((t) => t.due_date === today).map((t) => ({ label: t.title, detail: `Due today · ${t.priority}`, tab: 'automation', project_id: t.project_id, entity_type: 'task', entity_id: t.id }));
  const overdue: BriefingItem[] = myTasks.filter((t) => t.due_date < today).map((t) => ({ label: t.title, detail: `Due ${t.due_date} · ${t.status}`, tab: 'automation', project_id: t.project_id, entity_type: 'task', entity_id: t.id }));
  const teamOverdue = ids.length && ctx.can('automation.manage_tasks')
    ? (await pool.query(`SELECT count(*)::int AS n FROM tasks WHERE project_id = ANY($1) AND assigned_user_id <> $2 AND status NOT IN ('Completed', 'Cancelled') AND coalesce(due_date, '') <> '' AND due_date < $3`, [ids, me.id, today])).rows[0].n
    : 0;

  const blocked: BriefingItem[] = ctx.can('production.view') && ids.length
    ? (await pool.query(`SELECT id, project_id, status, drawing_check, data->>'order_number' AS number FROM production_orders WHERE project_id = ANY($1) AND status NOT IN ('Completed', 'Cancelled') AND (status = 'Blocked' OR drawing_check = 'invalid')`, [ids])).rows.map((o) => ({ label: `Production ${o.number ?? o.id} blocked`, detail: pn(o.project_id), tab: 'production', project_id: o.project_id, entity_type: 'production_order', entity_id: o.id }))
    : [];
  const deliveries: BriefingItem[] = ctx.can('delivery.view') && ids.length
    ? (await pool.query(`SELECT id, project_id, status, delivery_date, data->>'delivery_number' AS number FROM deliveries WHERE project_id = ANY($1) AND status NOT IN ('Delivered', 'Received / Confirmed', 'Cancelled') AND delivery_date BETWEEN $2 AND $3 ORDER BY delivery_date`, [ids, today, in2])).rows.map((d) => ({ label: `Delivery ${d.number ?? d.id}`, detail: `${d.delivery_date === today ? 'Today' : d.delivery_date} · ${pn(d.project_id)}`, tab: 'delivery', project_id: d.project_id, entity_type: 'delivery', entity_id: d.id }))
    : [];
  const inspections: BriefingItem[] = ctx.can('installation.view') && ids.length
    ? (await pool.query(`SELECT id, project_id, status, data->>'job_number' AS number, data->>'work_item_code' AS code FROM installation_jobs WHERE project_id = ANY($1) AND (status IN ('Awaiting Inspection', 'QC', 'Rectification') OR (status NOT IN ('Completed', 'Cancelled') AND data->>'planned_completion_date' = $2))`, [ids, today])).rows.map((j) => ({ label: `Site QC: ${j.code ?? j.number}`, detail: `${j.status} · ${pn(j.project_id)}`, tab: 'delivery', project_id: j.project_id, entity_type: 'installation', entity_id: j.id }))
    : [];
  const drawings: BriefingItem[] = ctx.can('drawings.view') && ids.length
    ? (await pool.query(`SELECT r.id, d.project_id, r.revision, d.data->>'drawing_number' AS number FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE r.kind = 'client' AND r.approval_status IN ('Internal Review', 'Pending Review', 'Review') AND d.project_id = ANY($1)`, [ids])).rows.map((r) => ({ label: `Drawing ${r.number} ${r.revision} awaiting review`, detail: pn(r.project_id), tab: 'drawings', project_id: r.project_id, entity_type: 'drawing_revision', entity_id: r.id }))
    : [];
  const shortages: BriefingItem[] = ids.length && (ctx.can('purchasing.view') || ctx.can('production.view') || ctx.can('work_items.edit'))
    ? (await pool.query(`SELECT id, project_id, data FROM material_requests WHERE project_id = ANY($1) AND coalesce(status, data->>'status', 'Pending') IN ('Pending', 'Requested') AND coalesce(data->>'needed_by_date', '') <> '' AND data->>'needed_by_date' <= $2`, [ids, in2])).rows.map((m) => ({ label: `Material: ${m.data.material_name}`, detail: `Needed ${m.data.needed_by_date}, not ordered · ${pn(m.project_id)}`, tab: 'purchasing', project_id: m.project_id, entity_type: 'material_request', entity_id: m.id }))
    : [];

  // Decisions waiting for me.
  const decisions: BriefingItem[] = [];
  if (ctx.can('variations.approve') && ids.length) {
    for (const v of (await pool.query(`SELECT id, project_id, data->>'variation_number' AS number, data->>'title' AS title, data->>'created_by_id' AS author FROM variations WHERE status = 'Internal Approval' AND project_id = ANY($1)`, [ids])).rows) {
      if (v.author !== me.id) decisions.push({ label: `Variation ${v.number} needs your approval`, detail: `${v.title ?? ''} · ${pn(v.project_id)}`, tab: 'variations', project_id: v.project_id, entity_type: 'variation', entity_id: v.id });
    }
  }
  if (ctx.can('drawings.approve')) for (const d of drawings) decisions.push({ ...d, label: d.label.replace('awaiting review', 'needs your review') });
  if (ctx.can('approvals.view') && ids.length) {
    for (const a of (await pool.query(`SELECT id, project_id, data->>'title' AS title, data->>'approval_type' AS type, data->>'assigned_approver_role' AS role FROM approvals WHERE decision = 'Pending' AND project_id = ANY($1)`, [ids])).rows) {
      if (a.role === me.role) decisions.push({ label: `${a.type ?? 'Approval'}: ${a.title ?? a.id}`, detail: pn(a.project_id), tab: 'approvals', project_id: a.project_id, entity_type: 'approval', entity_id: a.id });
    }
  }

  const risk = (await portfolioRisk(pool, ctx, now)).filter((r) => ids.includes(r.project_id) && (r.level === 'At Risk' || r.level === 'Critical'));
  return {
    for: { id: me.id, name: me.name, role: me.role },
    date: today,
    projects: mine.map((p) => ({ id: p.id, name: p.project_name })),
    today: {
      tasks_due: due,
      tasks_overdue: overdue,
      team_overdue_tasks: teamOverdue,
      production_blocked: blocked,
      deliveries_next_2_days: deliveries,
      site_qc: inspections,
      drawings_awaiting_review: drawings,
      material_shortages: shortages,
    },
    risks: risk.map((r) => ({ project_id: r.project_id, project_name: r.project_name, level: r.level, reasons: r.reasons.slice(0, 4).map((x) => x.signal) })),
    decisions,
    generated_at: now.toISOString(),
    source: 'Live NW OS records (tasks, production, deliveries, installations, drawings, material requests, variations, approvals, risk engine).',
  };
}
