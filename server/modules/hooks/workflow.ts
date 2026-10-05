import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { ModuleHooks, Row } from '../types';

const OPEN_TASK = "status NOT IN ('Completed', 'Cancelled')";
const RESOLVED = new Set(['Resolved', 'Closed']);

// What a task can be about: column -> table. Each must exist and sit on the task's project.
const TASK_LINKS: [string, string, string][] = [
  ['variation_id', 'variations', 'variation'],
  ['drawing_id', 'drawings', 'drawing'],
  ['purchase_order_id', 'purchase_orders', 'purchase order'],
  ['delivery_id', 'deliveries', 'delivery'],
  ['installation_job_id', 'installation_jobs', 'installation'],
  ['production_order_id', 'production_orders', 'production order'],
];
// What the person doing the task (not a task manager) may change on it.
const WORKER_FIELDS = new Set([
  'status', 'comments', 'attachments', 'completion_evidence', 'completed_date', 'blocked_reason', 'waiting_for_party',
  'acknowledged_at', 'acknowledged_by', 'updated_at', 'history', 'completed_by_id', 'completed_by_name',
]);
const SERVER_FIELDS = ['history', 'completed_by_id', 'completed_by_name', 'source_rule', 'requires_evidence'];
const DONE = new Set(['Completed', 'Cancelled']);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * Tasks are the company's work engine. The server checks what a task is linked to (issue,
 * variation, drawing, PO, delivery, installation, production order: all on the task's
 * project), who may change it (task managers anything; the assignee or reviewer only its
 * progress), dependencies, a reason for Blocked and evidence where completion needs it, and
 * keeps the history itself.
 */
export const taskHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    let values: Row = { ...incoming };
    for (const f of SERVER_FIELDS) values[f] = existing ? existing[f] : f === 'source_rule' ? undefined : f === 'requires_evidence' ? Boolean(incoming.requires_evidence) : undefined;
    if (!existing) values.history = [];
    const me = h.ctx.user;

    // Issue link (Phase 4): fixed once set; the task takes the issue's project.
    if (existing?.issue_id && existing.issue_id !== incoming.issue_id) throw new ForbiddenError('A task stays linked to the issue it was raised from');
    if (incoming.issue_id) {
      const issue = (await h.db.query('SELECT project_id, work_item_id, data FROM issues WHERE id = $1', [incoming.issue_id])).rows[0];
      if (!issue) throw new ValidationError(`Issue ${String(incoming.issue_id)} does not exist`);
      if (incoming.project_id && incoming.project_id !== issue.project_id) throw new ValidationError("A task raised from an issue belongs to the issue's project");
      values = {
        ...values,
        project_id: issue.project_id,
        work_item_id: incoming.work_item_id ?? issue.work_item_id ?? undefined,
        source_event: incoming.source_event ?? `issue:${String(issue.data.title ?? incoming.issue_id)}`,
      };
    }
    for (const [col, table, label] of TASK_LINKS) {
      const id = values[col];
      if (!id || (existing && existing[col] === id)) continue;
      const row = (await h.db.query(`SELECT project_id FROM ${table} WHERE id = $1`, [id])).rows[0];
      if (!row) throw new ValidationError(`The linked ${label} ${String(id)} does not exist`);
      if (values.project_id && row.project_id !== values.project_id) throw new ValidationError(`The linked ${label} is on another project`);
      values.project_id ??= row.project_id;
    }

    if (existing) {
      const manager = h.ctx.can('automation.manage_tasks');
      const mine = existing.assigned_user_id === me.id || existing.reviewer_id === me.id;
      if (!manager) {
        if (!mine) throw new ForbiddenError('Only the person assigned (or its reviewer) can update this task');
        const changed = Object.keys({ ...existing, ...values }).filter((k) => !WORKER_FIELDS.has(k) && !SERVER_FIELDS.includes(k) && !same(existing[k], values[k]));
        if (changed.length) throw new ForbiddenError(`Only a task manager can change ${changed.join(', ')}`);
      }
    }

    // Assignment: an active user who can see the task's project.
    if (values.assigned_user_id && values.assigned_user_id !== existing?.assigned_user_id) {
      const u = (await h.db.query('SELECT id, name, role, is_active FROM users WHERE id = $1', [values.assigned_user_id])).rows[0];
      if (!u || !u.is_active) throw new ValidationError('Assign the task to an active user');
      if (values.project_id) {
        const scoped = (await h.db.query(
          `SELECT 1 FROM projects p WHERE p.id = $2 AND (
             $3 IN ('Owner / CEO', 'Admin', 'Purchasing', 'Accountant')
             OR p.project_manager_id = $1 OR p.site_supervisor_id = $1
             OR EXISTS (SELECT 1 FROM project_assignments a WHERE a.user_id = $1 AND a.project_id = p.id)
             OR ($3 = 'Production Manager' AND NOT EXISTS (SELECT 1 FROM project_assignments a WHERE a.user_id = $1))
             OR ($3 = 'Contractor' AND EXISTS (SELECT 1 FROM users c JOIN work_packages w ON w.contractor_id = c.contractor_id WHERE c.id = $1 AND w.project_id = p.id)))`,
          [u.id, values.project_id, u.role]
        )).rowCount;
        if (!scoped) throw new ValidationError(`${u.name} does not work on this project`);
      }
      values.assigned_user_name = u.name;
      values.assigned_role = u.role;
    }

    const from = String(existing?.status ?? '');
    const to = String(values.status ?? 'Open');
    if (to !== from) {
      if (existing && DONE.has(from) && !h.ctx.can('automation.manage_tasks')) throw new ForbiddenError(`A ${from.toLowerCase()} task can only be reopened by a task manager`);
      if (to === 'Blocked' && !String(values.blocked_reason ?? '').trim()) throw new ValidationError('Say what is blocking the task');
      if (['In Progress', 'Completed'].includes(to)) {
        const deps = Array.isArray(values.dependency_task_ids) ? (values.dependency_task_ids as string[]) : [];
        if (deps.length) {
          const open = (await h.db.query(`SELECT data->>'title' AS title FROM tasks WHERE id = ANY($1) AND ${OPEN_TASK}`, [deps])).rows;
          if (open.length) throw new ForbiddenError(`Waiting for: ${open.map((t) => t.title).join(', ')}`);
        }
      }
      if (to === 'Completed') {
        const evidence = String(values.completion_evidence ?? '').trim();
        const files = Array.isArray(values.attachments) ? values.attachments.length : 0;
        if ((values.requires_evidence || existing?.requires_evidence) && !evidence && files <= (Array.isArray(existing?.attachments) ? existing!.attachments.length : 0)) {
          throw new ValidationError('This task needs completion evidence: a note or a photo of the finished work');
        }
        values.completed_date = values.completed_date ?? new Date().toISOString();
        values.completed_by_id = me.id;
        values.completed_by_name = me.name;
      }
    }
    // History of status, assignee and due-date changes, recorded by the server.
    if (existing) {
      const entries = [];
      for (const f of ['status', 'assigned_user_id', 'due_date', 'priority']) {
        if (!same(existing[f], values[f])) entries.push({ at: new Date().toISOString(), by: me.name, by_id: me.id, field: f, from: existing[f] ?? null, to: values[f] ?? null });
      }
      values.history = [...(Array.isArray(existing.history) ? existing.history : []), ...entries];
    }
    return values;
  },
  async afterWrite(h, existing, stored) {
    if (h.mode === 'import' || !existing) return;
    if (existing.status !== stored.status && stored.status === 'Completed') {
      await writeAudit(h.db, h.actor, { action: 'task.complete', entityType: 'tasks', entityId: String(stored.id), projectId: (stored.project_id as string) ?? null, after: { evidence: stored.completion_evidence ?? null } });
    }
    if (existing.assigned_user_id !== stored.assigned_user_id) {
      await writeAudit(h.db, h.actor, { action: 'task.reassign', entityType: 'tasks', entityId: String(stored.id), projectId: (stored.project_id as string) ?? null, before: { assigned_user_id: existing.assigned_user_id }, after: { assigned_user_id: stored.assigned_user_id } });
    }
  },
};

/**
 * Resolving an issue needs issues.resolve and a resolution note, records who resolved it,
 * and waits for the tasks raised from it to be completed or cancelled.
 */
export const issueHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import' || !existing) return incoming;
    const to = String(incoming.status);
    if (!RESOLVED.has(to) || RESOLVED.has(String(existing.status))) return incoming;
    if (!h.ctx.can('issues.resolve')) throw new ForbiddenError('Missing permission: issues.resolve (resolve an issue)');
    if (!String(incoming.resolution_notes ?? '').trim()) throw new ValidationError('Record how the issue was resolved');
    const open = (await h.db.query(`SELECT data->>'title' AS title FROM tasks WHERE issue_id = $1 AND ${OPEN_TASK}`, [existing.id])).rows;
    if (open.length) {
      throw new ForbiddenError(`Finish or cancel the task(s) raised from this issue first: ${open.map((t) => t.title).join(', ')}`);
    }
    const now = new Date().toISOString();
    await writeAudit(h.db, h.actor, {
      action: 'issue.resolve',
      entityType: 'issues',
      entityId: String(existing.id),
      projectId: String(existing.project_id),
      after: { status: to, resolution_notes: incoming.resolution_notes },
    });
    return { ...incoming, resolved_by_id: h.ctx.user.id, resolved_by_name: h.ctx.user.name, resolved_at: now };
  },
};

const SIGNED = new Set(['Formal CPC Handover Signed', 'In DLP Period']);

/**
 * Handover: created as a draft for a real project; signing needs the client
 * representative's name and signature and records the NW signatory; a signed handover is
 * locked. Signing never changes the project's status (a person marks the project
 * completed separately).
 */
export const handoverHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    const project = (await h.db.query('SELECT client_id, project_name FROM projects WHERE id = $1', [incoming.project_id])).rows[0];
    if (!project) throw new ValidationError(`Project ${String(incoming.project_id)} does not exist`);
    const next: Row = { ...incoming, client_id: project.client_id };
    const to = String(next.status ?? 'Draft');
    if (!existing) {
      if (SIGNED.has(to)) throw new ForbiddenError('A handover is created as a draft and signed afterwards');
      return { ...next, prepared_by_id: h.ctx.user.id, prepared_by_name: h.ctx.user.name };
    }
    if (SIGNED.has(String(existing.status))) {
      const allowed = new Set(['status', 'dlp_start_date', 'dlp_end_date', 'retention_sum_status', 'notes', 'documents', 'updated_at']);
      for (const k of Object.keys(next)) {
        if (!allowed.has(k) && JSON.stringify(next[k]) !== JSON.stringify(existing[k])) throw new ForbiddenError(`A signed handover can't change ${k}`);
      }
      return next;
    }
    if (SIGNED.has(to)) {
      if (!String(next.client_signoff_name ?? '').trim() || !String(next.client_signoff_signature ?? '').trim()) {
        throw new ValidationError("Signing the handover needs the client representative's name and signature");
      }
      await writeAudit(h.db, h.actor, {
        action: 'handover.sign',
        entityType: 'handoverRecords',
        entityId: String(existing.id),
        projectId: String(existing.project_id),
        after: { status: to, client_signoff_name: next.client_signoff_name, nw_signatory: h.ctx.user.name },
      });
      return { ...next, nw_pm_signoff_name: h.ctx.user.name, nw_signed_by_id: h.ctx.user.id, client_signoff_date: next.client_signoff_date || new Date().toISOString().slice(0, 10) };
    }
    return next;
  },
};
