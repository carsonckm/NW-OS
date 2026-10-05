import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { PoolClient } from '../../db/pool';
import { syncWorkItem } from '../workItemStatus';
import type { HookContext, ModuleHooks, Row } from '../types';
import { findClientRevision, findRevisionById } from './drawings';

/** Order states that do not consume drawings (an order may always be parked or stopped). */
const NON_PRODUCING = new Set(['Not Started', 'On Hold', 'Blocked', 'Cancelled']);
const FINISHED = new Set(['Completed', 'Cancelled']);

/**
 * On Hold pauses an order without losing its stage history. Putting an order on hold or
 * resuming it is a production management decision (production.create_orders); a finished
 * order can't be put on hold, and a held order is resumed before it can be completed.
 */
function checkOnHold(h: HookContext, existing: Row | undefined, status: string) {
  const from = existing ? String(existing.status) : undefined;
  if (from === status) return;
  const touchesHold = status === 'On Hold' || from === 'On Hold';
  if (!touchesHold) return;
  if (!h.ctx.can('production.create_orders')) throw new ForbiddenError('Missing permission: production.create_orders (put on hold / resume)');
  if (status === 'On Hold' && from && FINISHED.has(from)) throw new ValidationError(`A ${from} production order cannot be put On Hold`);
  if (from === 'On Hold' && status === 'Completed') throw new ValidationError('Resume the production order before completing it');
}

export interface RevisionCheck {
  clientRevisionId: string | null;
  nwRevisionId: string | null;
  valid: boolean;
  reason?: string;
}

/**
 * Production may only use an approved, current client revision and an approved NW
 * production drawing that is not superseded (and, when linked, was made from that same
 * client revision). Revisions are looked up by id, or by drawing + label as the app sends.
 */
export async function checkOrderRevisions(db: PoolClient, order: Row): Promise<RevisionCheck> {
  const client =
    (await findRevisionById(db, order.client_drawing_revision_id)) ??
    (await findClientRevision(db, order.approved_client_drawing_id, order.approved_client_drawing_revision));
  const nw = await findRevisionById(db, order.nw_drawing_revision_id ?? order.approved_nw_production_drawing_id);
  const result: RevisionCheck = { clientRevisionId: client?.id ?? null, nwRevisionId: nw?.kind === 'nw_production' ? nw.id : null, valid: false };

  if (!client || client.kind !== 'client') return { ...result, reason: `client drawing revision "${String(order.approved_client_drawing_revision ?? '')}" not found` };
  if (client.approval_status === 'Superseded') return { ...result, reason: `client revision ${client.revision} is superseded` };
  if (client.approval_status !== 'Approved') return { ...result, reason: `client revision ${client.revision} is not approved (${client.approval_status})` };
  if (!client.is_current) return { ...result, reason: `client revision ${client.revision} is not the current approved revision` };
  if (!nw || nw.kind !== 'nw_production') return { ...result, reason: `NW production drawing "${String(order.approved_nw_production_drawing_id ?? '')}" not found` };
  if (nw.approval_status === 'Superseded') return { ...result, reason: `NW production drawing ${nw.revision} is superseded` };
  if (nw.approval_status !== 'Approved' && !nw.approved_for_production) {
    return { ...result, reason: `NW production drawing ${nw.revision} is not approved for production` };
  }
  if (nw.linked_client_revision_id && nw.linked_client_revision_id !== client.id) {
    return { ...result, reason: `NW production drawing ${nw.revision} was made from a different client revision` };
  }
  return { ...result, valid: true };
}

export const productionOrderHooks: ModuleHooks = {
  // Keep the work item's statuses in step with its order, in the same transaction.
  async afterWrite(h, _existing, stored) {
    if (h.mode === 'import' || typeof stored.work_item_id !== 'string') return;
    if (!_existing) {
      // A new order becomes the item's current order (the link is the server's, not the browser's).
      await h.db.query('UPDATE work_items SET production_order_id = $2, updated_at = now() WHERE id = $1', [stored.work_item_id, stored.id]);
    }
    await syncWorkItem(h.db, stored.work_item_id);
  },

  async beforeWrite(h, existing, incoming) {
    // The order must sit on its work item's own project and package.
    const item = (await h.db.query('SELECT project_id, work_package_id FROM work_items WHERE id = $1', [incoming.work_item_id])).rows[0];
    if (!item) throw new ValidationError(`work item ${String(incoming.work_item_id)} does not exist`);
    if (item.project_id !== incoming.project_id || item.work_package_id !== incoming.work_package_id) {
      throw new ValidationError('Production order project/package must match its work item');
    }
    if (!existing && h.mode !== 'import' && !String(incoming.production_method ?? '').trim()) {
      throw new ValidationError('A production order needs an approved production method');
    }

    const check = await checkOrderRevisions(h.db, incoming);
    const stamp = (valid: boolean, reason?: string): Row => ({
      ...incoming,
      client_drawing_revision_id: check.clientRevisionId ?? undefined,
      nw_drawing_revision_id: check.nwRevisionId ?? undefined,
      drawing_check: valid ? 'valid' : 'invalid',
      drawing_check_reason: valid ? undefined : reason,
    });

    if (h.mode === 'import') return stamp(check.valid, check.reason);

    const status = String(incoming.status);
    checkOnHold(h, existing, status);
    const statusChanged = !existing || existing.status !== status;
    const refsChanged =
      !existing ||
      ['approved_client_drawing_id', 'approved_client_drawing_revision', 'approved_nw_production_drawing_id', 'client_drawing_revision_id', 'nw_drawing_revision_id']
        .some((f) => JSON.stringify(existing[f]) !== JSON.stringify(incoming[f]));

    if (!check.valid) {
      // Never produce from a superseded or unapproved drawing. A flagged order may only be
      // parked (Not Started / On Hold / Blocked / Cancelled) or edited without advancing.
      const advancing = statusChanged && !NON_PRODUCING.has(status);
      if (!existing || refsChanged || advancing) {
        throw new ValidationError(`Production must use an approved, current drawing revision: ${check.reason}`);
      }
      return stamp(false, check.reason);
    }
    if (existing?.drawing_check === 'invalid') {
      await writeAudit(h.db, h.actor, {
        action: 'production.revision_check.cleared',
        entityType: 'production_order',
        entityId: existing.id as string,
        projectId: existing.project_id as string,
        after: { client_drawing_revision_id: check.clientRevisionId, nw_drawing_revision_id: check.nwRevisionId },
      });
    }
    return stamp(true);
  },
};
