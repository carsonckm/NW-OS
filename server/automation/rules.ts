/**
 * The automation rules. Each rule reads the current state of PostgreSQL and plans actions:
 * notify, raise a task for a person, escalate, or close a task it raised once the source is
 * resolved. Rules never approve, reject, change dimensions, materials, prices, dates or
 * payments, and never make safety decisions. Thresholds come from the rule's stored
 * configuration (automation_rules.config), not from code.
 */
import type { PlannedAction, RuleContext, RuleDef } from './types';

type Row = Record<string, any>;

const HOUR = 3600_000;
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
const hoursSince = (now: Date, ts: unknown) => {
  const t = typeof ts === 'string' || ts instanceof Date ? new Date(ts as string).getTime() : NaN;
  return Number.isFinite(t) ? (now.getTime() - t) / HOUR : 0;
};
/** Hours past the end of a due date (YYYY-MM-DD). */
const hoursPastDue = (now: Date, due: unknown) => {
  if (typeof due !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(due)) return -Infinity;
  return (now.getTime() - new Date(`${due.slice(0, 10)}T23:59:59Z`).getTime()) / HOUR;
};
const addDays = (today: string, days: number) => new Date(Date.parse(`${today}T00:00:00Z`) + days * 86400_000).toISOString().slice(0, 10);

/**
 * The configured escalation ladder: level 1 (manager) after `manager_after_hours`,
 * level 2 (owner) after `owner_after_hours`. Returns the levels reached.
 */
function ladder(ageHours: number, config: Row, defaults = { manager: 24, owner: 72 }) {
  const out: number[] = [];
  if (ageHours >= num(config.manager_after_hours, defaults.manager)) out.push(1);
  if (config.owner_escalation !== false && ageHours >= num(config.owner_after_hours, defaults.owner)) out.push(2);
  return out;
}

async function taskFor(rc: RuleContext, id: string, assigneeId: string | undefined, fields: Row): Promise<Row | undefined> {
  const user = rc.people.user(assigneeId);
  if (!user) return undefined;
  return {
    id,
    task_number: id.toUpperCase().replace(/^TSK-AUTO-/, 'AUTO-').slice(0, 40),
    description: '',
    project_name: rc.people.projectName(fields.project_id),
    source_event: fields.source_event,
    source_module: 'System Automation',
    assigned_user_id: user.id,
    assigned_user_name: user.name,
    assigned_role: user.role,
    priority: 'High',
    status: 'Open',
    escalation_level: 'None',
    comments: [],
    attachments: [],
    created_date: rc.now.toISOString(),
    ...fields,
  };
}

const openTask = async (rc: RuleContext, id: string) =>
  (await rc.pool.query(`SELECT 1 FROM tasks WHERE id = $1 AND status NOT IN ('Completed', 'Cancelled')`, [id])).rowCount! > 0;

// ------------------------------------------------------------------------------- rules
const drawingReview: RuleDef = {
  key: 'drawing_review',
  name: 'Drawing awaiting review',
  description: 'A client drawing revision is sent for internal review.',
  watches: ['drawings'],
  interval_minutes: 15,
  defaults: { review_hours: 24, manager_after_hours: 24, owner_after_hours: 72 },
  actions: 'Raise a review task for an authorised approver and notify approvers; remind the PM, then the Owner, if it is not reviewed in time; close the task when the revision is decided.',
  human_in_loop: 'Only an approver approves or rejects. Automation never approves a drawing.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (
      await rc.pool.query(
        `SELECT r.id, r.revision, r.approval_status, r.data, d.id AS drawing_id, d.project_id, d.data->>'drawing_number' AS number
         FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE r.kind = 'client'`
      )
    ).rows as Row[];
    for (const r of rows) {
      const taskId = `tsk-auto-drw-${r.id}`;
      const inReview = ['Internal Review', 'Pending Review', 'Review'].includes(r.approval_status);
      if (!inReview) {
        if (await openTask(rc, taskId)) out.push({ kind: 'close_task', key: taskId, task_id: taskId, note: `Revision ${r.approval_status.toLowerCase()}` });
        continue;
      }
      if (!rc.people.projectOpen(r.project_id)) continue;
      const approvers = await rc.people.withPermission('drawings.approve', r.project_id);
      const label = `${r.number ?? r.drawing_id} ${r.revision}`;
      const task = await taskFor(rc, taskId, approvers[0], {
        title: `Review drawing ${label}`,
        description: 'Approve or reject this revision. Production keeps using the current approved revision until then.',
        project_id: r.project_id,
        drawing_id: r.drawing_id,
        drawing_revision_id: r.id,
        source_event: 'drawing.approval_requested',
        due_date: addDays(rc.today, Math.ceil(num(rc.config.review_hours, 24) / 24)),
      });
      if (task) out.push({ kind: 'task', key: `drawing_review:${r.id}:task`, task });
      out.push({
        kind: 'notification',
        key: `drawing_review:${r.id}`,
        users: approvers,
        note: { title: `Drawing ${label} needs review`, message: `${rc.people.projectName(r.project_id)}: approve or reject it.`, type: 'approval', priority: 'high', project_id: r.project_id, link_tab: 'drawings', entity_type: 'drawing_revision', entity_id: r.id },
      });
      const age = hoursSince(rc.now, r.data?.review_requested_at ?? r.data?.uploaded_date);
      for (const level of ladder(age, rc.config)) {
        const users = level === 1 ? rc.people.pm(r.project_id) : rc.people.owners();
        out.push({
          kind: 'escalation',
          key: `drawing_review:${r.id}:L${level}`,
          level,
          users,
          record: { source_record_type: 'Approval', source_record_id: r.id, project_id: r.project_id, title: `Drawing ${label} still not reviewed`, reason: `Waiting ${Math.floor(age)}h for review`, previous_level: level === 1 ? 'None' : 'PM', current_level: level === 1 ? 'PM' : 'Owner', assigned_role: level === 1 ? 'Project Manager' : 'Owner / CEO', is_critical: level === 2 },
          note: { title: `Escalation: drawing ${label} not reviewed`, message: `Waiting ${Math.floor(age)} hours for review on ${rc.people.projectName(r.project_id)}.`, type: 'escalation', priority: level === 2 ? 'urgent' : 'high', project_id: r.project_id, link_tab: 'drawings', entity_type: 'drawing_revision', entity_id: r.id },
        });
      }
    }
    return out;
  },
};

const productionBlocked: RuleDef = {
  key: 'production_blocked',
  name: 'Production blocked',
  description: 'A production order is Blocked or built from a drawing that is not the approved current revision.',
  watches: ['productionOrders', 'drawings'],
  interval_minutes: 15,
  defaults: { manager_after_hours: 0, owner_after_hours: 48 },
  actions: 'Notify the PM and production managers, raise an unblock task for a production manager, escalate to the Owner if still blocked; close the task when production resumes.',
  human_in_loop: 'People decide how to unblock. No order or drawing is changed by automation.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (await rc.pool.query(`SELECT id, project_id, status, drawing_check, drawing_check_reason, updated_at, data->>'order_number' AS number FROM production_orders`)).rows as Row[];
    for (const o of rows) {
      const taskId = `tsk-auto-prod-${o.id}`;
      const blocked = !['Completed', 'Cancelled'].includes(o.status) && (o.status === 'Blocked' || o.drawing_check === 'invalid');
      if (!blocked) {
        if (await openTask(rc, taskId)) out.push({ kind: 'close_task', key: taskId, task_id: taskId, note: `Production is ${o.status}` });
        continue;
      }
      if (!rc.people.projectOpen(o.project_id)) continue;
      const managers = await rc.people.withPermission('production.create_orders', o.project_id);
      const why = o.drawing_check === 'invalid' ? `drawing problem: ${o.drawing_check_reason ?? 'revision not approved/current'}` : 'order is Blocked';
      const occurrence = `${o.id}:${o.status}:${o.drawing_check}`;
      out.push({
        kind: 'notification',
        key: `production_blocked:${occurrence}`,
        users: [...rc.people.pm(o.project_id), ...managers],
        note: { title: `Production ${o.number ?? o.id} is blocked`, message: `${rc.people.projectName(o.project_id)}: ${why}.`, type: 'warning', priority: 'urgent', project_id: o.project_id, link_tab: 'production', entity_type: 'production_order', entity_id: o.id },
      });
      const task = await taskFor(rc, taskId, managers.find((m) => rc.people.user(m)?.role === 'Production Manager') ?? managers[0], {
        title: `Unblock production ${o.number ?? o.id}`,
        description: `Find the cause and agree the fix (${why}).`,
        project_id: o.project_id,
        production_order_id: o.id,
        source_event: 'production.blocked',
        priority: 'Urgent',
        due_date: addDays(rc.today, 1),
      });
      if (task) out.push({ kind: 'task', key: `production_blocked:${o.id}:task`, task });
      const age = hoursSince(rc.now, o.updated_at);
      for (const level of ladder(age, rc.config, { manager: 0, owner: 48 }).filter((l) => l === 2)) {
        out.push({
          kind: 'escalation',
          key: `production_blocked:${occurrence}:L${level}`,
          level,
          users: rc.people.owners(),
          record: { source_record_type: 'WorkItem', source_record_id: o.id, project_id: o.project_id, title: `Production ${o.number ?? o.id} blocked for ${Math.floor(age)}h`, reason: why, previous_level: 'PM', current_level: 'Owner', assigned_role: 'Owner / CEO', is_critical: true },
          note: { title: `Escalation: production ${o.number ?? o.id} still blocked`, message: `${rc.people.projectName(o.project_id)}: ${why}, for ${Math.floor(age)} hours.`, type: 'escalation', priority: 'urgent', project_id: o.project_id, link_tab: 'production', entity_type: 'production_order', entity_id: o.id },
        });
      }
    }
    return out;
  },
};

const materialRequest: RuleDef = {
  key: 'material_request',
  name: 'Material request unresolved',
  description: 'A material request has not been turned into a purchase order.',
  watches: ['materialRequests', 'purchaseOrders'],
  interval_minutes: 60,
  defaults: { warn_days_before_needed: 3 },
  actions: 'Notify purchasing; notify the PM as the needed-by date approaches; escalate to the PM and Owner once it has passed (the project risk engine also flags it).',
  human_in_loop: 'Purchasing chooses the supplier and raises the PO. No PO is created automatically.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (await rc.pool.query(`SELECT id, project_id, status, data FROM material_requests WHERE coalesce(status, data->>'status', 'Pending') IN ('Pending', 'Requested')`)).rows as Row[];
    for (const m of rows) {
      if (!rc.people.projectOpen(m.project_id)) continue;
      const label = `${m.data.request_number ?? m.id} ${m.data.material_name ?? ''}`.trim();
      const buyers = await rc.people.withPermission('purchasing.manage_pos', m.project_id);
      const note = (title: string, message: string, type: 'action' | 'warning' | 'escalation', priority: 'normal' | 'high' | 'urgent') => ({ title, message, type, priority, project_id: m.project_id, link_tab: 'purchasing', entity_type: 'material_request', entity_id: m.id });
      out.push({ kind: 'notification', key: `material_request:${m.id}`, users: buyers, note: note(`Material request ${label}`, `${rc.people.projectName(m.project_id)}: needed by ${m.data.needed_by_date ?? 'unspecified'}. Raise the PO.`, 'action', 'normal') });
      const needed = m.data.needed_by_date as string | undefined;
      if (!needed) continue;
      const hoursLeft = -hoursPastDue(rc.now, needed);
      if (hoursLeft <= num(rc.config.warn_days_before_needed, 3) * 24 && hoursLeft > 0) {
        out.push({ kind: 'notification', key: `material_request:${m.id}:near`, users: rc.people.pm(m.project_id), note: note(`Material needed soon: ${label}`, `Needed by ${needed}; no purchase order yet.`, 'warning', 'high') });
      }
      if (hoursLeft <= 0) {
        out.push({
          kind: 'escalation',
          key: `material_request:${m.id}:late`,
          level: 1,
          users: [...rc.people.pm(m.project_id), ...buyers],
          record: { source_record_type: 'WorkItem', source_record_id: m.id, project_id: m.project_id, title: `Material late: ${label}`, reason: `Needed by ${needed}, still no PO`, previous_level: 'None', current_level: 'PM', assigned_role: 'Project Manager', is_critical: true },
          note: note(`Material late: ${label}`, `Needed by ${needed} and still not ordered. The project is flagged at risk.`, 'escalation', 'urgent'),
        });
      }
    }
    return out;
  },
};

const siteQcFailed: RuleDef = {
  key: 'site_qc_failed',
  name: 'Site QC failed',
  description: 'The latest site QC on a work item failed.',
  watches: ['siteQCInspections', 'issues'],
  interval_minutes: 15,
  defaults: { rectify_days: 3 },
  actions: 'Raise a rectification task on the rectification issue for the site supervisor with a recommended re-inspection date, and notify the site supervisor and PM.',
  human_in_loop: 'The site team rectifies. Only a passing re-inspection by an inspector clears it; automation never marks QC passed.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (
      await rc.pool.query(
        `SELECT DISTINCT ON (q.work_item_id) q.id, q.work_item_id, q.project_id, q.result, q.rectification_issue_id, w.item_code
         FROM site_qc_inspections q JOIN work_items w ON w.id = q.work_item_id
         ORDER BY q.work_item_id, coalesce(q.inspected_at, '') DESC, q.created_at DESC, q.id DESC`
      )
    ).rows as Row[];
    for (const q of rows) {
      if (q.result !== 'Fail / Rectification Required' || !q.rectification_issue_id || !rc.people.projectOpen(q.project_id)) continue;
      const assignee = rc.people.site(q.project_id)[0] ?? rc.people.pm(q.project_id)[0];
      const reinspect = addDays(rc.today, num(rc.config.rectify_days, 3));
      const exists = (await rc.pool.query('SELECT 1 FROM tasks WHERE issue_id = $1 LIMIT 1', [q.rectification_issue_id])).rowCount;
      if (!exists) {
        const task = await taskFor(rc, `tsk-auto-${q.id}`, assignee, {
          issue_id: q.rectification_issue_id,
          title: `Rectify ${q.item_code} and request re-inspection`,
          description: `Site QC failed. Fix the defects, then ask the inspector to re-inspect (recommended by ${reinspect}).`,
          project_id: q.project_id,
          work_item_id: q.work_item_id,
          work_item_code: q.item_code,
          installation_qc_id: q.id,
          source_event: 'installation.site_qc_failed',
          source_reason: `Site QC ${q.id} failed`,
          due_date: reinspect,
        });
        if (task) out.push({ kind: 'task', key: `site_qc_failed:${q.id}:task`, task });
      }
      out.push({
        kind: 'notification',
        key: `site_qc_failed:${q.id}`,
        users: [...rc.people.site(q.project_id), ...rc.people.pm(q.project_id)],
        note: { title: `Site QC failed: ${q.item_code}`, message: `${rc.people.projectName(q.project_id)}: rectify, then re-inspect (recommended by ${reinspect}). Completion is blocked until a re-inspection passes.`, type: 'action', priority: 'high', project_id: q.project_id, link_tab: 'delivery', entity_type: 'site_qc', entity_id: q.id },
      });
    }
    return out;
  },
};

const deliveryProblem: RuleDef = {
  key: 'delivery_problem',
  name: 'Delivery late or with an issue',
  description: 'A delivery is past its date and not received, has a delivery issue, or goods arrived short, damaged or wrong.',
  watches: ['deliveryRecords', 'goodsReceived'],
  interval_minutes: 30,
  defaults: { owner_after_hours: 72, manager_after_hours: 0 },
  actions: 'Notify the PM and site supervisor (and purchasing for goods received), raise a follow-up task for the PM, escalate to the Owner if unresolved.',
  human_in_loop: 'The PM agrees a new date or replacement with the supplier/contractor. No date is promised to the client automatically.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const deliveries = (
      await rc.pool.query(
        `SELECT id, project_id, status, delivery_date, updated_at, data->>'delivery_number' AS number FROM deliveries
         WHERE status NOT IN ('Delivered', 'Received / Confirmed', 'Cancelled')`
      )
    ).rows as Row[];
    for (const d of deliveries) {
      const taskId = `tsk-auto-del-${d.id}`;
      const late = hoursPastDue(rc.now, d.delivery_date) > 0;
      const issue = d.status === 'Delivery Issue';
      if (!(late || issue) || !rc.people.projectOpen(d.project_id)) continue;
      const why = issue ? 'reported a delivery issue' : `was due ${d.delivery_date} and has not arrived`;
      const label = d.number ?? d.id;
      out.push({
        kind: 'notification',
        key: `delivery_problem:${d.id}:${issue ? 'issue' : 'late'}`,
        users: [...rc.people.pm(d.project_id), ...rc.people.site(d.project_id)],
        note: { title: `Delivery ${label} ${issue ? 'has an issue' : 'is late'}`, message: `${rc.people.projectName(d.project_id)}: delivery ${why}.`, type: 'warning', priority: 'high', project_id: d.project_id, link_tab: 'delivery', entity_type: 'delivery', entity_id: d.id },
      });
      const task = await taskFor(rc, taskId, rc.people.pm(d.project_id)[0], {
        title: `Resolve delivery ${label}`,
        description: `The delivery ${why}. Agree a new date or replacement and update the delivery.`,
        project_id: d.project_id,
        delivery_id: d.id,
        source_event: 'delivery.problem',
        due_date: addDays(rc.today, 1),
      });
      if (task) out.push({ kind: 'task', key: `delivery_problem:${d.id}:task`, task });
      const age = issue ? hoursSince(rc.now, d.updated_at) : hoursPastDue(rc.now, d.delivery_date);
      for (const level of ladder(age, rc.config, { manager: 0, owner: 72 }).filter((l) => l === 2)) {
        out.push({
          kind: 'escalation',
          key: `delivery_problem:${d.id}:L${level}`,
          level,
          users: rc.people.owners(),
          record: { source_record_type: 'WorkItem', source_record_id: d.id, project_id: d.project_id, title: `Delivery ${label} unresolved`, reason: why, previous_level: 'PM', current_level: 'Owner', assigned_role: 'Owner / CEO', is_critical: true },
          note: { title: `Escalation: delivery ${label} unresolved`, message: `${rc.people.projectName(d.project_id)}: ${why}.`, type: 'escalation', priority: 'urgent', project_id: d.project_id, link_tab: 'delivery', entity_type: 'delivery', entity_id: d.id },
        });
      }
    }
    const grns = (await rc.pool.query(`SELECT id, project_id, data->>'grn_number' AS number, data->>'condition' AS condition FROM goods_received WHERE coalesce(data->>'condition', 'Good') <> 'Good'`)).rows as Row[];
    for (const g of grns) {
      if (!rc.people.projectOpen(g.project_id)) continue;
      const buyers = await rc.people.withPermission('purchasing.manage_pos', g.project_id);
      out.push({
        kind: 'notification',
        key: `delivery_problem:grn:${g.id}`,
        users: [...rc.people.pm(g.project_id), ...rc.people.site(g.project_id), ...buyers],
        note: { title: `Goods received ${g.number ?? g.id}: ${g.condition}`, message: `${rc.people.projectName(g.project_id)}: arrange replacement or credit.`, type: 'warning', priority: 'high', project_id: g.project_id, link_tab: 'purchasing', entity_type: 'goods_received', entity_id: g.id },
      });
    }
    return out;
  },
};

const taskOverdue: RuleDef = {
  key: 'task_overdue',
  name: 'Task overdue',
  description: 'An open task is past its due date.',
  watches: ['tasks'],
  interval_minutes: 30,
  defaults: { manager_after_hours: 24, owner_after_hours: 72, owner_priorities: ['High', 'Urgent', 'Critical'] },
  actions: 'Notify the assignee; after the manager threshold notify the PM (the site supervisor too for contractor tasks); after the owner threshold escalate high-priority tasks to the Owner.',
  human_in_loop: 'No task is reassigned, closed or re-dated automatically.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (
      await rc.pool.query(
        `SELECT id, project_id, assigned_user_id, due_date, priority, data->>'title' AS title, data->>'assigned_role' AS role FROM tasks
         WHERE status NOT IN ('Completed', 'Cancelled') AND coalesce(due_date, '') <> '' AND due_date < $1`,
        [rc.today]
      )
    ).rows as Row[];
    const ownerPriorities = Array.isArray(rc.config.owner_priorities) ? (rc.config.owner_priorities as string[]) : ['High', 'Urgent', 'Critical'];
    for (const t of rows) {
      if (t.project_id && !rc.people.projectOpen(t.project_id)) continue;
      const late = hoursPastDue(rc.now, t.due_date);
      const occ = `${t.id}:${t.due_date}`;
      const link = { project_id: t.project_id, link_tab: 'automation', entity_type: 'task', entity_id: t.id };
      if (rc.people.isActive(t.assigned_user_id)) {
        out.push({ kind: 'notification', key: `task_overdue:${occ}`, users: [t.assigned_user_id], note: { ...link, title: `Overdue: ${t.title ?? t.id}`, message: `Was due ${t.due_date}.`, type: 'action', priority: 'normal' } });
      }
      for (const level of ladder(late, rc.config)) {
        if (level === 2 && !ownerPriorities.includes(t.priority)) continue;
        const users = level === 1 ? [...(t.project_id ? rc.people.pm(t.project_id) : []), ...(t.role === 'Contractor' && t.project_id ? rc.people.site(t.project_id) : [])] : rc.people.owners();
        out.push({
          kind: 'escalation',
          key: `task_overdue:${occ}:L${level}`,
          level,
          users: users.filter((u) => u !== t.assigned_user_id),
          record: { source_record_type: 'Task', source_record_id: t.id, project_id: t.project_id, title: `Task overdue: ${t.title ?? t.id}`, reason: `${Math.floor(late / 24)} day(s) past ${t.due_date}`, previous_level: level === 1 ? 'None' : 'PM', current_level: level === 1 ? 'PM' : 'Owner', assigned_role: level === 1 ? 'Project Manager' : 'Owner / CEO', is_critical: level === 2 },
          note: { ...link, title: `Escalation: overdue task ${t.title ?? t.id}`, message: `Assigned to ${rc.people.user(t.assigned_user_id)?.name ?? 'someone'}; due ${t.due_date}.`, type: 'escalation', priority: level === 2 ? 'urgent' : 'high' },
        });
      }
    }
    return out;
  },
};

const variationInternal: RuleDef = {
  key: 'variation_internal',
  name: 'Variation awaiting internal approval',
  description: 'A variation is in Internal Approval.',
  watches: ['variations'],
  interval_minutes: 15,
  defaults: { approval_hours: 48, manager_after_hours: 9999, owner_after_hours: 48 },
  actions: 'Raise an approval task for an authorised approver who did not write it and notify approvers; remind again after the configured time; close the task once it is decided.',
  human_in_loop: 'An approver decides. Automation never approves a variation or changes the contract value.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (await rc.pool.query(`SELECT id, project_id, status, updated_at, data->>'variation_number' AS number, data->>'title' AS title, data->>'created_by_id' AS author FROM variations`)).rows as Row[];
    for (const v of rows) {
      const taskId = `tsk-auto-vo-${v.id}`;
      if (v.status !== 'Internal Approval') {
        if (await openTask(rc, taskId)) out.push({ kind: 'close_task', key: taskId, task_id: taskId, note: `Variation moved to ${v.status}` });
        continue;
      }
      if (!rc.people.projectOpen(v.project_id)) continue;
      const approvers = await rc.people.withPermission('variations.approve', v.project_id, [v.author]);
      const label = `${v.number ?? v.id} ${v.title ?? ''}`.trim();
      const task = await taskFor(rc, taskId, approvers[0], {
        title: `Decide variation ${label}`,
        description: 'Approve internally (it then goes to the client) or reject.',
        project_id: v.project_id,
        variation_id: v.id,
        source_event: 'variation.approval_requested',
        due_date: addDays(rc.today, Math.ceil(num(rc.config.approval_hours, 48) / 24)),
      });
      if (task) out.push({ kind: 'task', key: `variation_internal:${v.id}:task`, task });
      out.push({
        kind: 'notification',
        key: `variation_internal:${v.id}`,
        users: approvers,
        note: { title: `Variation ${label} needs internal approval`, message: rc.people.projectName(v.project_id), type: 'approval', priority: 'high', project_id: v.project_id, link_tab: 'variations', entity_type: 'variation', entity_id: v.id },
      });
    }
    return out;
  },
};

const invoiceOverdue: RuleDef = {
  key: 'invoice_overdue',
  name: 'Invoice overdue',
  description: 'An invoice is past its due date and not paid.',
  watches: ['commercialInvoices', 'payments'],
  interval_minutes: 60,
  defaults: { manager_after_hours: 9999, owner_after_hours: 168 },
  actions: 'Notify finance; escalate to the Owner once overdue beyond the configured time.',
  human_in_loop: 'Finance chases or pays. No payment is made or waived automatically.',
  async evaluate(rc) {
    const out: PlannedAction[] = [];
    const rows = (
      await rc.pool.query(
        `SELECT id, project_id, status, data->>'invoice_number' AS number, data->>'invoice_type' AS type, data->>'due_date' AS due, data->>'party_name' AS party
         FROM commercial_invoices WHERE coalesce(status, '') NOT IN ('Paid', 'Draft') AND coalesce(data->>'due_date', '') <> ''`
      )
    ).rows as Row[];
    for (const inv of rows) {
      const late = hoursPastDue(rc.now, inv.due);
      if (late <= 0 || !rc.people.projectOpen(inv.project_id)) continue;
      const finance = await rc.people.withPermission('finance.edit', inv.project_id);
      const label = `${inv.type === 'Client Billing Invoice' ? 'Client invoice' : 'Invoice'} ${inv.number ?? inv.id} (${inv.party ?? ''})`;
      const link = { project_id: inv.project_id, link_tab: 'commercial', entity_type: 'invoice', entity_id: inv.id };
      out.push({ kind: 'notification', key: `invoice_overdue:${inv.id}`, users: finance, note: { ...link, title: `${label} overdue`, message: `Due ${inv.due}.`, type: 'action', priority: 'high' } });
      for (const level of ladder(late, rc.config, { manager: 9999, owner: 168 }).filter((l) => l === 2)) {
        out.push({
          kind: 'escalation',
          key: `invoice_overdue:${inv.id}:L${level}`,
          level,
          users: rc.people.owners(),
          record: { source_record_type: 'Payment', source_record_id: inv.id, project_id: inv.project_id, title: `${label} overdue`, reason: `${Math.floor(late / 24)} days past ${inv.due}`, previous_level: 'None', current_level: 'Owner', assigned_role: 'Owner / CEO', is_critical: inv.type === 'Client Billing Invoice' },
          note: { ...link, title: `Escalation: ${label} overdue`, message: `${Math.floor(late / 24)} days past ${inv.due}.`, type: 'escalation', priority: 'urgent' },
        });
      }
    }
    return out;
  },
};

export const RULES: RuleDef[] = [drawingReview, productionBlocked, materialRequest, siteQcFailed, deliveryProblem, taskOverdue, variationInternal, invoiceOverdue];
export const RULE_BY_KEY = new Map(RULES.map((r) => [r.key, r]));
