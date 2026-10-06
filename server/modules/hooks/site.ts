import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { Pool, PoolClient } from '../../db/pool';
import type { ModuleHooks, Row } from '../types';
import { syncWorkItem } from '../workItemStatus';

const FAIL = 'Fail / Rectification Required';

/** Whether the most recent site QC for a work item failed (and has not been re-inspected). */
export async function hasOpenFailedSiteQc(db: Pool | PoolClient, workItemId: string): Promise<boolean> {
  const res = await db.query(
    `SELECT result FROM site_qc_inspections WHERE work_item_id = $1
     ORDER BY coalesce(inspected_at, '') DESC, created_at DESC, id DESC LIMIT 1`,
    [workItemId]
  );
  return res.rows[0]?.result === FAIL;
}

async function checkWorkItemOnProject(db: PoolClient, workItemId: unknown, projectId: unknown) {
  const item = (await db.query('SELECT project_id, work_package_id FROM work_items WHERE id = $1', [workItemId])).rows[0];
  if (!item) throw new ValidationError(`work item ${String(workItemId)} does not exist`);
  if (item.project_id !== projectId) throw new ValidationError('The work item is on another project');
  return item as { project_id: string; work_package_id: string };
}

/**
 * Installation jobs have their own status (receiving a delivery never starts one). A job
 * cannot be completed while the item's latest site QC is a failure.
 */
export const installationHooks: ModuleHooks = {
  // The work item's installation (and overall) status follows its job.
  async afterWrite(h, existing, stored) {
    if (h.mode === 'import') return;
    for (const id of new Set([stored.work_item_id, existing?.work_item_id])) if (typeof id === 'string') await syncWorkItem(h.db, id);
  },

  async beforeWrite(h, existing, incoming) {
    const item = await checkWorkItemOnProject(h.db, incoming.work_item_id, incoming.project_id);
    const values: Row = { ...incoming, work_package_id: incoming.work_package_id ?? item.work_package_id };
    if (incoming.work_package_id && incoming.work_package_id !== item.work_package_id) {
      throw new ValidationError('Installation job package must match its work item');
    }
    // Pin the drawing revision the job installs from, when it can be identified.
    if (!values.drawing_revision_id && incoming.drawing_reference && incoming.drawing_revision) {
      const rev = (
        await h.db.query(
          `SELECT r.id FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id
           WHERE d.project_id = $1 AND d.drawing_number = $2 AND r.kind = 'client' AND r.revision = $3 LIMIT 1`,
          [incoming.project_id, incoming.drawing_reference, incoming.drawing_revision]
        )
      ).rows[0];
      if (rev) values.drawing_revision_id = rev.id;
    }
    if (h.mode !== 'import' && incoming.status === 'Completed' && existing?.status !== 'Completed') {
      h.defer(async () => {
        if (await hasOpenFailedSiteQc(h.db, String(incoming.work_item_id))) {
          throw new ForbiddenError('Installation cannot be completed: the latest site QC failed and needs rectification and re-inspection');
        }
      });
    }
    return values;
  },
};

/** A failed site QC always links a rectification issue (created here when missing). */
export const siteQcHooks: ModuleHooks = {
  // A failed inspection puts the item into rectification; a pass after it clears that.
  async afterWrite(h, _existing, stored) {
    if (h.mode !== 'import' && typeof stored.work_item_id === 'string') await syncWorkItem(h.db, stored.work_item_id);
  },

  async beforeWrite(h, existing, incoming) {
    await checkWorkItemOnProject(h.db, incoming.work_item_id, incoming.project_id);
    const values: Row = { ...incoming };
    if (h.mode !== 'import' && !existing) {
      values.inspector_name = h.ctx.user.name;
      values.inspector_role = h.ctx.user.role;
    }
    if (values.rectification_issue_id) {
      const issue = (await h.db.query('SELECT project_id FROM issues WHERE id = $1', [values.rectification_issue_id])).rows[0];
      if (!issue || issue.project_id !== incoming.project_id) throw new ValidationError('Rectification issue not found on this project');
    }
    if (values.result === FAIL && !values.rectification_issue_id) {
      const snags = Array.isArray(incoming.snag_items) ? (incoming.snag_items as Row[]) : [];
      const issue = await h.insertSystemRecord(
        'issues',
        {
          id: `issue-rect-${String(incoming.id)}`,
          project_id: incoming.project_id,
          work_item_id: incoming.work_item_id,
          title: `Rectification: ${String(incoming.work_item_code ?? incoming.work_item_id)} failed site QC`,
          category: 'Installation',
          priority: 'High',
          status: 'Reported',
          reported_by: h.ctx.user.name,
          reported_by_role: h.ctx.user.role,
          assigned_to: 'Site Supervisor',
          escalation_level: 'Site Supervisor',
          action_required: 'Rectify the defects and request re-inspection',
          description: [
            `Site QC ${String(incoming.inspection_number ?? incoming.id)} failed.`,
            ...snags.map((s) => `- ${String(s.description ?? s.title ?? '')}`),
          ].join('\n'),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        'created for failed site QC'
      );
      values.rectification_issue_id = issue.id;
    }
    if (h.mode !== 'import' && (!existing || existing.result !== values.result)) {
      await writeAudit(h.db, h.actor, {
        action: values.result === FAIL ? 'site_qc.fail' : 'site_qc.pass',
        entityType: 'site_qc_inspection',
        entityId: String(incoming.id),
        projectId: String(incoming.project_id),
        after: { result: values.result, work_item_id: incoming.work_item_id, rectification_issue_id: values.rectification_issue_id },
      });
    }
    return values;
  },
};
