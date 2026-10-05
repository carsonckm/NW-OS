/**
 * Exceptions and project overview, computed from PostgreSQL on every request. An exception
 * is something a person has to act on (an approval waiting, a blocked order, a failed site
 * QC, a cost overrun...). Each category is only reported to roles allowed to see it, and only
 * for projects in the user's scope. Clients and contractors use their own portals instead.
 */
import { ForbiddenError } from '../auth/access';
import type { AccessContext } from '../auth/access';
import { canSeeProjectFinancials } from '../auth/permissions';
import { NotFoundError } from '../core/repository';
import type { Pool } from '../db/pool';
import { profitability } from './reports';
import { hasOpenFailedSiteQc } from './hooks/site';

export type Severity = 'critical' | 'high' | 'medium';

export interface ExceptionItem {
  id: string;
  kind: string;
  severity: Severity;
  project_id: string;
  project_name: string;
  title: string;
  detail: string;
  /** App tab where it is handled. */
  tab: string;
  entity_id: string;
  /** Needs the Owner personally (approval or decision only the Owner can give). */
  owner_action: boolean;
}

const OPEN_ISSUE = `status NOT IN ('Resolved', 'Closed')`;
const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2 };

function checkPortalRole(ctx: AccessContext) {
  if (['Client', 'Contractor'].includes(ctx.user.role)) throw new ForbiddenError('The exceptions view is for NW staff');
}

async function projectsInScope(pool: Pool, ctx: AccessContext, projectId?: string) {
  const rows = (
    await pool.query(
      `SELECT id, project_name, project_status FROM projects
       WHERE ($1::text IS NULL OR id = $1) AND project_status NOT IN ('Closed', 'Cancelled') ORDER BY id`,
      [projectId ?? null]
    )
  ).rows as { id: string; project_name: string; project_status: string }[];
  return rows.filter((p) => ctx.canSeeProject(p.id));
}

export async function exceptionsFor(pool: Pool, ctx: AccessContext, projectId?: string): Promise<ExceptionItem[]> {
  checkPortalRole(ctx);
  if (projectId && !ctx.canSeeProject(projectId)) throw new NotFoundError('projects', projectId);
  const projects = await projectsInScope(pool, ctx, projectId);
  if (!projects.length) return [];
  const ids = projects.map((p) => p.id);
  const name = new Map(projects.map((p) => [p.id, p.project_name]));
  const out: ExceptionItem[] = [];
  const add = (e: Omit<ExceptionItem, 'project_name'>) => out.push({ ...e, project_name: name.get(e.project_id) ?? e.project_id });
  const isOwner = ctx.user.role === 'Owner / CEO';
  const today = new Date().toISOString().slice(0, 10);

  if (ctx.can('drawings.view')) {
    const rows = (
      await pool.query(
        `SELECT r.id, r.revision, r.approval_status, d.id AS drawing_id, d.project_id, d.data->>'drawing_number' AS number
         FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id
         WHERE r.kind = 'client' AND r.approval_status IN ('Internal Review', 'Pending Review', 'Review') AND d.project_id = ANY($1)`,
        [ids]
      )
    ).rows;
    for (const r of rows) {
      add({ id: `drw-${r.id}`, kind: 'drawing_review', severity: 'high', project_id: r.project_id, title: `Drawing ${r.number ?? r.drawing_id} ${r.revision} awaiting approval`, detail: 'Production keeps using the previous approved revision until this is approved.', tab: 'drawings', entity_id: r.drawing_id, owner_action: ctx.can('drawings.approve') && isOwner });
    }
  }

  if (ctx.can('variations.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, status, data->>'variation_number' AS number, data->>'title' AS title FROM variations
         WHERE status IN ('Internal Approval', 'Client Approval') AND project_id = ANY($1)`,
        [ids]
      )
    ).rows;
    for (const v of rows) {
      const internal = v.status === 'Internal Approval';
      add({ id: `vo-${v.id}`, kind: internal ? 'variation_internal' : 'variation_client', severity: 'high', project_id: v.project_id, title: `${v.number ?? v.id} ${v.title ?? ''} — ${internal ? 'needs internal approval' : 'waiting for client approval'}`.trim(), detail: internal ? 'Approve or reject before it goes to the client.' : 'Chase the client; not yet in the contract value.', tab: 'variations', entity_id: v.id, owner_action: internal && isOwner });
    }
  }

  if (ctx.can('approvals.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, data->>'title' AS title, data->>'approval_type' AS type, data->>'assigned_approver_role' AS approver FROM approvals
         WHERE decision = 'Pending' AND project_id = ANY($1)`,
        [ids]
      )
    ).rows;
    for (const a of rows) {
      if (!a.project_id || !name.has(a.project_id)) continue;
      add({ id: `apr-${a.id}`, kind: 'approval', severity: a.type === 'Major Purchase' ? 'high' : 'medium', project_id: a.project_id, title: `${a.type ?? 'Approval'}: ${a.title ?? a.id}`, detail: `Waiting for ${a.approver ?? 'an approver'}.`, tab: 'approvals', entity_id: a.id, owner_action: isOwner && (a.approver === 'Owner / CEO' || !a.approver) });
    }
  }

  if (ctx.can('production.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, status, drawing_check, drawing_check_reason, data->>'order_number' AS number, data->>'on_hold' AS on_hold,
                data->>'blocked_reason' AS reason
         FROM production_orders
         WHERE project_id = ANY($1) AND status NOT IN ('Completed', 'Cancelled')
           AND (status = 'Blocked' OR drawing_check = 'invalid' OR coalesce(data->>'on_hold', 'false') = 'true')`,
        [ids]
      )
    ).rows;
    for (const o of rows) {
      const invalid = o.drawing_check === 'invalid';
      add({ id: `po-prod-${o.id}`, kind: 'production_blocked', severity: invalid ? 'critical' : 'high', project_id: o.project_id, title: `Production ${o.number ?? o.id} ${invalid ? 'built from an unapproved or superseded drawing' : o.status === 'Blocked' ? 'blocked' : 'on hold'}`, detail: o.drawing_check_reason ?? o.reason ?? '', tab: 'production', entity_id: o.id, owner_action: false });
    }
  }

  if (ctx.can('installation.view')) {
    const items = (
      await pool.query(`SELECT DISTINCT q.work_item_id, q.project_id, w.item_code FROM site_qc_inspections q JOIN work_items w ON w.id = q.work_item_id
         WHERE q.project_id = ANY($1)`, [ids])
    ).rows;
    for (const it of items) {
      if (await hasOpenFailedSiteQc(pool, it.work_item_id)) {
        add({ id: `sqc-${it.work_item_id}`, kind: 'site_qc_failed', severity: 'high', project_id: it.project_id, title: `Site QC failed on ${it.item_code ?? it.work_item_id}`, detail: 'Rectify and re-inspect; installation and project completion are blocked.', tab: 'delivery', entity_id: it.work_item_id, owner_action: false });
      }
    }
  }

  if (ctx.can('issues.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, status, priority, data->>'title' AS title, data->>'escalation_level' AS level FROM issues
         WHERE ${OPEN_ISSUE} AND project_id = ANY($1)
           AND (priority IN ('Critical', 'High') OR data->>'escalation_level' = 'Owner' OR status = 'Decision Required')`,
        [ids]
      )
    ).rows;
    for (const i of rows) {
      const ownerDecision = i.level === 'Owner' || i.status === 'Decision Required';
      add({ id: `iss-${i.id}`, kind: 'issue', severity: i.priority === 'Critical' ? 'critical' : 'high', project_id: i.project_id, title: i.title ?? i.id, detail: `${i.priority} priority · ${i.status}${ownerDecision ? ' · escalated to Owner' : ''}`, tab: 'issues', entity_id: i.id, owner_action: ownerDecision && isOwner });
    }
  }

  if (ctx.can('automation.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, data->>'title' AS title, data->>'due_date' AS due, data->>'assigned_user_name' AS who FROM tasks
         WHERE project_id = ANY($1) AND status NOT IN ('Completed', 'Cancelled')
           AND coalesce(data->>'due_date', '') <> '' AND data->>'due_date' < $2`,
        [ids, today]
      )
    ).rows;
    for (const t of rows) {
      add({ id: `tsk-${t.id}`, kind: 'task_overdue', severity: 'medium', project_id: t.project_id, title: `Overdue: ${t.title ?? t.id}`, detail: `Due ${t.due}, assigned to ${t.who ?? 'someone'}.`, tab: 'automation', entity_id: t.id, owner_action: false });
    }
  }

  if (ctx.can('purchasing.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, data->>'grn_number' AS number, data->>'condition' AS condition FROM goods_received
         WHERE project_id = ANY($1) AND coalesce(data->>'condition', 'Good') <> 'Good' AND created_at > now() - interval '30 days'`,
        [ids]
      )
    ).rows;
    for (const g of rows) {
      add({ id: `grn-${g.id}`, kind: 'delivery_problem', severity: 'medium', project_id: g.project_id, title: `Goods received ${g.number ?? g.id}: ${g.condition}`, detail: 'Short, damaged or wrong items need a replacement or credit.', tab: 'purchasing', entity_id: g.id, owner_action: false });
    }
  }

  if (ctx.can('finance.view')) {
    const rows = (
      await pool.query(
        `SELECT id, project_id, data->>'invoice_number' AS number, data->>'match_status' AS match FROM commercial_invoices
         WHERE project_id = ANY($1) AND status = 'Pending Approval' AND coalesce(data->>'invoice_type', '') = 'Supplier Invoice'`,
        [ids]
      )
    ).rows;
    for (const inv of rows) {
      const mismatch = inv.match && inv.match !== 'Matched';
      add({ id: `inv-${inv.id}`, kind: mismatch ? 'invoice_mismatch' : 'invoice_pending', severity: mismatch ? 'high' : 'medium', project_id: inv.project_id, title: `Supplier invoice ${inv.number ?? inv.id} ${mismatch ? `— ${inv.match}` : 'awaiting approval'}`, detail: mismatch ? 'Only the Owner can approve an invoice that does not match the PO and goods received.' : 'Finance approval posts it to actual cost.', tab: 'commercial', entity_id: inv.id, owner_action: Boolean(mismatch) && isOwner });
    }
  }

  if (canSeeProjectFinancials(ctx.user.role) && ctx.can('commercial.view')) {
    for (const p of projects) {
      const pr = await profitability(pool, ctx, p.id).catch(() => null);
      if (!pr || pr.estimated_direct_cost <= 0) continue;
      if (pr.cost_variance > 0) {
        add({ id: `cost-${p.id}`, kind: 'cost_overrun', severity: pr.project_gross_profit < 0 ? 'critical' : 'high', project_id: p.id, title: `Forecast cost over budget by RM ${pr.cost_variance.toLocaleString('en-US')}`, detail: `Forecast gross profit RM ${pr.project_gross_profit.toLocaleString('en-US')} (${pr.project_gross_margin_percent}%).`, tab: 'commercial', entity_id: p.id, owner_action: isOwner });
      }
    }
  }

  return out.sort((a, b) => RANK[a.severity] - RANK[b.severity] || Number(b.owner_action) - Number(a.owner_action) || a.title.localeCompare(b.title));
}

/** One project's state for the command center, all from the database. */
export async function projectOverview(pool: Pool, ctx: AccessContext, projectId: string) {
  checkPortalRole(ctx);
  if (!ctx.canSeeProject(projectId)) throw new NotFoundError('projects', projectId);
  const project = (await pool.query('SELECT id, project_name, project_status FROM projects WHERE id = $1', [projectId])).rows[0];
  if (!project) throw new NotFoundError('projects', projectId);
  const count = async (sql: string) => (await pool.query(sql, [projectId])).rows[0];
  const [items, drawings, issues, variations, production, installs, handover, tasks] = await Promise.all([
    count(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'Completed')::int AS completed FROM work_items WHERE project_id = $1`),
    count(`SELECT count(*) FILTER (WHERE r.is_current)::int AS approved_current,
                  count(*) FILTER (WHERE r.approval_status IN ('Internal Review', 'Pending Review', 'Review'))::int AS in_review,
                  count(*) FILTER (WHERE r.approval_status = 'Draft')::int AS drafts
           FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE d.project_id = $1 AND r.kind = 'client'`),
    count(`SELECT count(*) FILTER (WHERE ${OPEN_ISSUE})::int AS open FROM issues WHERE project_id = $1`),
    count(`SELECT count(*) FILTER (WHERE status IN ('Identified', 'Costing', 'Internal Approval', 'Client Approval'))::int AS pending,
                  count(*) FILTER (WHERE status IN ('Approved', 'Implemented', 'Closed'))::int AS approved FROM variations WHERE project_id = $1`),
    count(`SELECT count(*) FILTER (WHERE status NOT IN ('Completed', 'Cancelled'))::int AS active,
                  count(*) FILTER (WHERE status = 'Blocked' OR drawing_check = 'invalid')::int AS blocked,
                  count(*) FILTER (WHERE status IN ('Ready for Delivery', 'Completed'))::int AS done FROM production_orders WHERE project_id = $1`),
    count(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'Completed')::int AS completed FROM installation_jobs WHERE project_id = $1`),
    count(`SELECT data->>'status' AS status FROM handover_records WHERE project_id = $1 ORDER BY updated_at DESC LIMIT 1`),
    count(`SELECT count(*) FILTER (WHERE status NOT IN ('Completed', 'Cancelled'))::int AS open FROM tasks WHERE project_id = $1`),
  ]);
  const financial = canSeeProjectFinancials(ctx.user.role) && ctx.can('commercial.view');
  return {
    project: { id: project.id, project_name: project.project_name, project_status: project.project_status },
    work_items: items,
    drawings,
    issues,
    variations: ctx.can('variations.view') ? variations : null,
    production: ctx.can('production.view') ? production : null,
    installation: ctx.can('installation.view') ? installs : null,
    handover_status: handover?.status ?? null,
    tasks,
    profitability: financial ? await profitability(pool, ctx, projectId) : null,
    exceptions: await exceptionsFor(pool, ctx, projectId),
    computed_at: new Date().toISOString(),
  };
}
