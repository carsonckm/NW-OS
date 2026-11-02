import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import { syncWorkItem } from '../workItemStatus';
import type { HookContext, ModuleHooks, Row } from '../types';

/**
 * Deliveries record what was arranged (by the contractor unless stated otherwise); NW OS
 * never books transport. A site receipt becomes its own append-only record. Nothing here
 * touches installation: receiving goods never starts an installation job.
 */
export const deliveryHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    const values: Row = {
      ...incoming,
      arranged_by: incoming.arranged_by ?? existing?.arranged_by ?? 'Contractor',
    };

    // What the delivery refers to is checked when it is added or changed: a new delivery, a
    // changed project (everything again), or items, orders or a package added since. References
    // already stored and left as they are (legacy records) do not block unrelated edits or a
    // site receipt; nothing here repairs them. An import checks everything, as before.
    const list = (v: unknown) => (Array.isArray(v) ? (v as unknown[]).map(String) : []);
    const recheckAll = !existing || h.mode === 'import' || existing.project_id !== incoming.project_id;
    const added = (field: string) => {
      const before = new Set(recheckAll ? [] : list(existing?.[field]));
      return list(incoming[field]).filter((id) => !before.has(id));
    };

    const newItems = added('work_item_ids');
    if (newItems.length) {
      const res = await h.db.query('SELECT id, project_id FROM work_items WHERE id = ANY($1)', [newItems]);
      const found = new Map(res.rows.map((r) => [r.id, r.project_id]));
      for (const id of newItems) {
        if (!found.has(id)) throw new ValidationError(`Delivery work item ${id} does not exist`);
        if (found.get(id) !== incoming.project_id) throw new ValidationError(`Delivery work item ${id} is on another project`);
        // A contractor may only put its own work on a delivery: items it or its package is
        // assigned to. Other roles keep their permission and project scope.
        if (h.mode !== 'import' && h.ctx.user.role === 'Contractor' && !h.ctx.contractorOwnsWorkItem(id)) {
          throw new ForbiddenError(`Work item ${id} is not one of your work items`);
        }
      }
    }

    const newOrders = added('production_order_ids');
    if (newOrders.length && h.mode !== 'import') {
      const res = await h.db.query('SELECT id, project_id FROM production_orders WHERE id = ANY($1)', [newOrders]);
      const found = new Map(res.rows.map((r) => [r.id, r.project_id]));
      for (const id of newOrders) {
        if (!found.has(id)) throw new ValidationError(`Delivery production order ${id} does not exist`);
        if (found.get(id) !== incoming.project_id) throw new ValidationError(`Delivery production order ${id} is on another project`);
      }
    }

    // Scheduling is permitted before QC, but loading and dispatch must not bypass
    // the production order's latest passed factory inspection.
    const dispatchStatuses = new Set(['Loading', 'In Transit', 'Arrived at Site', 'Delivered', 'Received / Confirmed']);
    if (h.mode !== 'import' && dispatchStatuses.has(String(incoming.status))) {
      for (const orderId of list(incoming.production_order_ids)) {
        const qc = (await h.db.query(
          `SELECT result, data FROM factory_qc_inspections WHERE production_order_id = $1
           ORDER BY created_at DESC, id DESC LIMIT 1`,
          [orderId],
        )).rows[0];
        const checks = ['dimensional_tolerance_pass', 'visual_inspection_pass',
          'hardware_smoothness_pass', 'edge_banding_integrity_pass', 'grain_match_pass'];
        if (!qc || qc.result !== 'Passed' || checks.some((key) => qc.data?.[key] !== true)) {
          throw new ValidationError(`Production order ${orderId} requires passed Factory QC before delivery loading or dispatch`);
        }
      }
    }

    const packageChanged = incoming.work_package_id && (recheckAll || existing?.work_package_id !== incoming.work_package_id);
    if (packageChanged && h.mode !== 'import') {
      const wp = (await h.db.query('SELECT project_id FROM work_packages WHERE id = $1', [incoming.work_package_id])).rows[0];
      if (!wp) throw new ValidationError(`Delivery work package ${String(incoming.work_package_id)} does not exist`);
      if (wp.project_id !== incoming.project_id) throw new ValidationError('The delivery work package is on another project');
    }

    const receipt = incoming.site_receipt as Row | undefined;
    const previous = existing?.site_receipt as Row | undefined;
    if (receipt && previous && previous.id === receipt.id && JSON.stringify(previous) !== JSON.stringify(receipt) && h.mode !== 'import') {
      throw new ForbiddenError('A recorded site receipt cannot be changed; record a new receipt');
    }
    if (receipt && (!previous || previous.id !== receipt.id) && h.mode !== 'import') {
      if (!h.ctx.can('delivery.receive')) throw new ForbiddenError('Missing permission: delivery.receive');
      // The receiver is whoever is signed in.
      values.site_receipt = {
        ...receipt,
        receiving_user_id: h.ctx.user.id,
        receiving_user_name: h.ctx.user.name,
        receiving_role: h.ctx.user.role,
      };
    }
    return values;
  },

  async afterWrite(h, existing, stored) {
    const id = stored.id as string;
    // Items on the delivery mirror work_item_ids / production_order_ids.
    await h.db.query('DELETE FROM delivery_items WHERE delivery_id = $1', [id]);
    const itemIds = Array.isArray(stored.work_item_ids) ? (stored.work_item_ids as string[]) : [];
    const orderIds = Array.isArray(stored.production_order_ids) ? (stored.production_order_ids as string[]) : [];
    const orders = orderIds.length ? (await h.db.query('SELECT id, work_item_id FROM production_orders WHERE id = ANY($1)', [orderIds])).rows : [];
    for (const itemId of new Set(itemIds)) {
      const order = orders.find((o) => o.work_item_id === itemId);
      await h.db.query('INSERT INTO delivery_items (delivery_id, work_item_id, production_order_id) VALUES ($1, $2, $3)', [id, itemId, order?.id ?? null]);
    }

    const receipt = stored.site_receipt as Row | undefined;
    const previous = existing?.site_receipt as Row | undefined;
    const fresh =
      !!receipt && !(previous && previous.id === receipt.id) && !(await h.db.query('SELECT 1 FROM delivery_receipts WHERE id = $1', [receipt.id])).rowCount;
    if (receipt && fresh) await recordReceipt(h, id, stored, receipt);
    // The items' delivery (and overall) status follows the delivery and its receipt.
    if (h.mode !== 'import') {
      const affected = new Set([...itemIds, ...((existing?.work_item_ids as string[] | undefined) ?? [])]);
      for (const itemId of affected) await syncWorkItem(h.db, itemId);
    }
  },
};

/** A site receipt becomes its own append-only record (and is audited). */
async function recordReceipt(h: HookContext, id: string, stored: Row, receipt: Row) {
  await h.db.query(
    `INSERT INTO delivery_receipts (id, delivery_id, project_id, receiver_id, receiver_name, received_at, condition_status,
       packages_expected, packages_received, damaged_quantity, missing_quantity, signature, linked_issue_id, data, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      receipt.id ?? `rcpt-${id}-${Date.now()}`,
      id,
      stored.project_id,
      receipt.receiving_user_id ?? null,
      receipt.receiving_user_name ?? null,
      new Date(String(receipt.received_at ?? new Date().toISOString())).toISOString(),
      receipt.condition_status ?? 'All In Order',
      Number(receipt.packages_expected) || 0,
      Number(receipt.packages_received) || 0,
      Number(receipt.damaged_quantity) || 0,
      Number(receipt.missing_quantity) || 0,
      receipt.receiver_signature ?? null,
      receipt.linked_issue_id ?? null,
      JSON.stringify({
        ...receipt,
        delivery_id: id,
        project_id: stored.project_id,
      }),
      h.actor.id ?? null,
    ]
  );
  if (h.mode !== 'import') {
    await writeAudit(h.db, h.actor, {
      action: 'delivery.receipt',
      entityType: 'delivery',
      entityId: id,
      projectId: stored.project_id as string,
      after: {
        receipt_id: receipt.id,
        condition: receipt.condition_status,
        received: receipt.packages_received,
        expected: receipt.packages_expected,
        damaged: receipt.damaged_quantity,
        missing: receipt.missing_quantity,
      },
    });
  }
}
