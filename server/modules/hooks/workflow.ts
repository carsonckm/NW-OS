import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { ModuleHooks, Row } from '../types';

const OPEN_TASK = "status NOT IN ('Completed', 'Cancelled')";
const RESOLVED = new Set(['Resolved', 'Closed']);

/** A task raised from an issue belongs to the issue's project. */
export const taskHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import' || !incoming.issue_id) return incoming;
    if (existing?.issue_id && existing.issue_id !== incoming.issue_id) throw new ForbiddenError('A task stays linked to the issue it was raised from');
    const issue = (await h.db.query('SELECT project_id, work_item_id, data FROM issues WHERE id = $1', [incoming.issue_id])).rows[0];
    if (!issue) throw new ValidationError(`Issue ${String(incoming.issue_id)} does not exist`);
    if (incoming.project_id && incoming.project_id !== issue.project_id) throw new ValidationError("A task raised from an issue belongs to the issue's project");
    return {
      ...incoming,
      project_id: issue.project_id,
      work_item_id: incoming.work_item_id ?? issue.work_item_id ?? undefined,
      source_event: incoming.source_event ?? `issue:${String(issue.data.title ?? incoming.issue_id)}`,
    };
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
