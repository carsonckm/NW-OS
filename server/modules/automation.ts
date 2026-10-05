/**
 * Automation foundation (human in the loop). Each rule looks at PostgreSQL and does one of
 * two things only: notify the people who can act, or raise a task for a person. A rule
 * never approves, rejects, changes a drawing, dimension, material, price, date or payment,
 * and never makes a safety decision; those stay with an authorised person, and the
 * server's permission and business-rule checks apply to that person as always.
 *
 * Every occurrence has a rule key, so running the sweep again never repeats a
 * notification or a task.
 */
import { randomUUID } from 'crypto';
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import type { PermissionKey } from '../../src/types';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { DataService } from './service';

export interface AutomationRule {
  key: string;
  name: string;
  trigger: string;
  action: string;
  human_in_loop: string;
}

export const AUTOMATION_RULES: AutomationRule[] = [
  { key: 'drawing_review', name: 'Drawing sent for review', trigger: 'A client drawing revision is in Internal Review', action: 'Notify drawing approvers on the project', human_in_loop: 'An approver reviews and approves or rejects; automation never approves a drawing' },
  { key: 'production_blocked', name: 'Production blocked', trigger: 'A production order is Blocked or built from an invalid drawing', action: 'Notify the project manager and production managers', human_in_loop: 'People decide how to unblock; no drawing or order is changed' },
  { key: 'site_qc_failed', name: 'Site QC failed', trigger: 'The latest site QC on an item failed', action: 'Raise a rectification task on the rectification issue for the site supervisor, and notify the project manager', human_in_loop: 'The site team rectifies; only a passing re-inspection by an inspector clears it' },
  { key: 'task_overdue', name: 'Task overdue', trigger: 'An open task is past its due date', action: 'Notify the assignee (and the project manager when more than 2 days late)', human_in_loop: 'No task is reassigned or closed automatically' },
  { key: 'variation_internal', name: 'Variation awaiting internal approval', trigger: 'A variation is in Internal Approval', action: 'Notify variation approvers other than its author', human_in_loop: 'An approver decides; automation never approves a variation or changes the contract value' },
  { key: 'delivery_issue', name: 'Delivery problem', trigger: 'Goods received short, damaged or wrong', action: 'Notify the project manager, site supervisor and purchasing', human_in_loop: 'Purchasing arranges replacement or credit; no PO or invoice is changed' },
];

/** What automation and AI may never do, whatever a rule or prompt says. */
export const AI_FORBIDDEN_ACTIONS = [
  'Approve or reject drawings',
  'Approve variations or change contract value',
  'Change dimensions or technical specifications',
  'Substitute materials',
  'Approve major purchases',
  'Promise delivery or completion dates to clients',
  'Approve compensation, claims or payments',
  'Make safety decisions',
];

const SYSTEM_USER: AuthUser = {
  id: 'system-automation', name: 'NW OS Automation', email: 'automation@nwos.local', role: 'Owner / CEO', is_active: true, is_dev_seed: false,
  client_id: null, contractor_id: null, phone: null, department: null, title: null, created_at: '', updated_at: '', last_login: null,
};
const SYSTEM_ACTOR: AuditActor = { id: null, name: 'NW OS Automation', role: 'system' };

interface Note {
  title: string;
  message: string;
  type: string;
  priority: 'normal' | 'high' | 'urgent';
  project_id: string | null;
  link_tab: string;
  entity_type: string;
  entity_id: string;
  rule_key: string;
}

export async function notify(pool: Pool, userIds: Iterable<string>, note: Note): Promise<number> {
  let n = 0;
  for (const userId of new Set(userIds)) {
    if (!userId) continue;
    const res = await pool.query(
      `INSERT INTO notifications (id, user_id, title, message, type, priority, project_id, link_tab, entity_type, entity_id, rule_key)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2 AND is_active)
       ON CONFLICT (user_id, rule_key) DO NOTHING`,
      [`ntf-${randomUUID()}`, userId, note.title, note.message, note.type, note.priority, note.project_id, note.link_tab, note.entity_type, note.entity_id, note.rule_key]
    );
    n += res.rowCount ?? 0;
  }
  return n;
}

/** Active users and their access, loaded once per sweep. */
class Recipients {
  private contexts = new Map<string, AccessContext>();
  private constructor(private pool: Pool, private users: AuthUser[], private projects: Map<string, { pm: string; site: string }>) {}

  static async load(pool: Pool) {
    const users = (await pool.query('SELECT * FROM users WHERE is_active')).rows as AuthUser[];
    const projects = new Map(
      (await pool.query('SELECT id, project_manager_id, site_supervisor_id FROM projects')).rows.map((p) => [p.id as string, { pm: p.project_manager_id as string, site: p.site_supervisor_id as string }])
    );
    return new Recipients(pool, users, projects);
  }

  private async ctx(user: AuthUser) {
    let c = this.contexts.get(user.id);
    if (!c) this.contexts.set(user.id, (c = await AccessContext.load(this.pool, user)));
    return c;
  }

  /** Active users who hold `permission` and can see the project. */
  async withPermission(permission: PermissionKey, projectId: string, except: (string | null | undefined)[] = []) {
    const out: string[] = [];
    for (const u of this.users) {
      if (except.includes(u.id)) continue;
      const c = await this.ctx(u);
      if (c.can(permission) && c.canSeeProject(projectId)) out.push(u.id);
    }
    return out;
  }

  isActive(id: string | null | undefined) {
    return !!id && this.users.some((u) => u.id === id);
  }

  pm(projectId: string) {
    const id = this.projects.get(projectId)?.pm;
    return this.isActive(id) ? [id!] : [];
  }

  site(projectId: string) {
    const id = this.projects.get(projectId)?.site;
    return this.isActive(id) ? [id!] : [];
  }
}

export interface AutomationResult {
  notifications: number;
  tasks: number;
  ran_at: string;
}

export async function runAutomation(pool: Pool, today = new Date().toISOString().slice(0, 10)): Promise<AutomationResult> {
  const who = await Recipients.load(pool);
  let notifications = 0;
  let tasks = 0;
  const projectName = new Map((await pool.query('SELECT id, project_name FROM projects')).rows.map((p) => [p.id as string, p.project_name as string]));
  const pn = (id: string) => projectName.get(id) ?? id;

  // 1. Drawing revisions waiting for review.
  for (const r of (
    await pool.query(
      `SELECT r.id, r.revision, d.id AS drawing_id, d.project_id, d.data->>'drawing_number' AS number
       FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id
       WHERE r.kind = 'client' AND r.approval_status IN ('Internal Review', 'Pending Review', 'Review')`
    )
  ).rows) {
    notifications += await notify(pool, await who.withPermission('drawings.approve', r.project_id), {
      title: `Drawing ${r.number ?? r.drawing_id} ${r.revision} needs review`, message: `${pn(r.project_id)}: approve or reject it. Production keeps using the current approved revision until then.`,
      type: 'approval', priority: 'high', project_id: r.project_id, link_tab: 'drawings', entity_type: 'drawing_revision', entity_id: r.id, rule_key: `drawing_review:${r.id}`,
    });
  }

  // 2. Blocked production.
  for (const o of (
    await pool.query(
      `SELECT id, project_id, status, drawing_check, data->>'order_number' AS number FROM production_orders
       WHERE status NOT IN ('Completed', 'Cancelled') AND (status = 'Blocked' OR drawing_check = 'invalid')`
    )
  ).rows) {
    const managers = await who.withPermission('production.create_orders', o.project_id);
    notifications += await notify(pool, [...who.pm(o.project_id), ...managers], {
      title: `Production ${o.number ?? o.id} is blocked`, message: `${pn(o.project_id)}: ${o.drawing_check === 'invalid' ? 'built from a drawing revision that is not approved/current' : 'order is Blocked'}. Decide how to unblock it.`,
      type: 'escalation', priority: 'urgent', project_id: o.project_id, link_tab: 'production', entity_type: 'production_order', entity_id: o.id, rule_key: `production_blocked:${o.id}:${o.status}:${o.drawing_check}`,
    });
  }

  // 3. Failed site QC: rectification task on the rectification issue (once), and notify.
  const failed = (
    await pool.query(
      `SELECT DISTINCT ON (q.work_item_id) q.id, q.work_item_id, q.project_id, q.result, q.rectification_issue_id, w.item_code
       FROM site_qc_inspections q JOIN work_items w ON w.id = q.work_item_id
       ORDER BY q.work_item_id, coalesce(q.inspected_at, '') DESC, q.created_at DESC, q.id DESC`
    )
  ).rows.filter((q) => q.result === 'Fail / Rectification Required' && q.rectification_issue_id);
  const service = new DataService(pool);
  let systemCtx: AccessContext | undefined;
  for (const q of failed) {
    const assignee = who.site(q.project_id)[0] ?? who.pm(q.project_id)[0];
    const existing = (await pool.query(`SELECT 1 FROM tasks WHERE issue_id = $1 LIMIT 1`, [q.rectification_issue_id])).rows.length;
    if (!existing && assignee) {
      const user = (await pool.query('SELECT id, name, role FROM users WHERE id = $1', [assignee])).rows[0];
      systemCtx ??= await AccessContext.load(pool, SYSTEM_USER);
      const id = `tsk-auto-${q.id}`;
      await service.transact(systemCtx, SYSTEM_ACTOR, (h) =>
        h.insertSystemRecord(
          'tasks',
          {
            id, task_number: `TSK-AUTO-${String(q.id).slice(-6).toUpperCase()}`, issue_id: q.rectification_issue_id,
            title: `Rectify ${q.item_code} and request re-inspection`, description: 'Site QC failed. Fix the listed defects, then ask the inspector to re-inspect.',
            project_id: q.project_id, project_name: pn(q.project_id), work_item_id: q.work_item_id, work_item_code: q.item_code,
            source_event: 'site_qc.failed', source_module: 'System Automation', source_reason: `Site QC ${q.id} failed`,
            assigned_user_id: user.id, assigned_user_name: user.name, assigned_role: user.role, priority: 'High',
            due_date: new Date(Date.parse(today) + 3 * 86400000).toISOString().slice(0, 10), status: 'Open', escalation_level: 'None',
            created_date: new Date().toISOString(), comments: [], attachments: [],
          },
          'automation: rectification task for failed site QC'
        )
      );
      tasks++;
    }
    notifications += await notify(pool, [...who.site(q.project_id), ...who.pm(q.project_id)], {
      title: `Site QC failed: ${q.item_code}`, message: `${pn(q.project_id)}: rectify and re-inspect. Installation and project completion are blocked until a re-inspection passes.`,
      type: 'issue', priority: 'high', project_id: q.project_id, link_tab: 'delivery', entity_type: 'site_qc', entity_id: q.id, rule_key: `site_qc_failed:${q.id}`,
    });
  }

  // 4. Overdue tasks.
  for (const t of (
    await pool.query(
      `SELECT id, project_id, assigned_user_id, due_date, data->>'title' AS title FROM tasks
       WHERE status NOT IN ('Completed', 'Cancelled') AND coalesce(due_date, '') <> '' AND due_date < $1`,
      [today]
    )
  ).rows) {
    const late = Math.floor((Date.parse(today) - Date.parse(t.due_date)) / 86400000);
    const targets = [t.assigned_user_id, ...(late > 2 && t.project_id ? who.pm(t.project_id) : [])].filter((id) => who.isActive(id));
    notifications += await notify(pool, targets, {
      title: `Overdue: ${t.title ?? t.id}`, message: `Was due ${t.due_date}${late > 0 ? ` (${late} day${late === 1 ? '' : 's'} late)` : ''}.`,
      type: 'task', priority: late > 2 ? 'high' : 'normal', project_id: t.project_id, link_tab: 'automation', entity_type: 'task', entity_id: t.id, rule_key: `task_overdue:${t.id}:${t.due_date}`,
    });
  }

  // 5. Variations waiting for internal approval.
  for (const v of (
    await pool.query(`SELECT id, project_id, data->>'variation_number' AS number, data->>'title' AS title, data->>'created_by_id' AS author FROM variations WHERE status = 'Internal Approval'`)
  ).rows) {
    notifications += await notify(pool, await who.withPermission('variations.approve', v.project_id, [v.author]), {
      title: `Variation ${v.number ?? v.id} needs internal approval`, message: `${pn(v.project_id)}: ${v.title ?? ''}`.trim(),
      type: 'approval', priority: 'high', project_id: v.project_id, link_tab: 'variations', entity_type: 'variation', entity_id: v.id, rule_key: `variation_internal:${v.id}`,
    });
  }

  // 6. Delivery problems found at goods received.
  for (const g of (
    await pool.query(`SELECT id, project_id, data->>'grn_number' AS number, data->>'condition' AS condition FROM goods_received WHERE coalesce(data->>'condition', 'Good') <> 'Good'`)
  ).rows) {
    const buyers = await who.withPermission('purchasing.manage_pos', g.project_id);
    notifications += await notify(pool, [...who.pm(g.project_id), ...who.site(g.project_id), ...buyers], {
      title: `Delivery problem: ${g.number ?? g.id}`, message: `${pn(g.project_id)}: ${g.condition}. Arrange replacement or credit.`,
      type: 'delivery', priority: 'high', project_id: g.project_id, link_tab: 'purchasing', entity_type: 'goods_received', entity_id: g.id, rule_key: `delivery_issue:${g.id}`,
    });
  }

  return { notifications, tasks, ran_at: new Date().toISOString() };
}
