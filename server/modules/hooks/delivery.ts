import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { ModuleHooks, Row } from '../types';

/**
 * Deliveries record what was arranged (by the contractor unless stated otherwise); NW OS
 * never books transport. A site receipt becomes its own append-only record. Nothing here
 * touches installation: receiving goods never starts an installation job.
 */
export const deliveryHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    const values: Row = { ...incoming, arranged_by: incoming.arranged_by ?? existing?.arranged_by ?? 'Contractor' };

    const itemIds = Array.isArray(incoming.work_item_ids) ? (incoming.work_item_ids as string[]) : [];
    if (itemIds.length) {
      const res = await h.db.query('SELECT id, project_id FROM work_items WHERE id = ANY($1)', [itemIds]);
      const found = new Map(res.rows.map((r) => [r.id, r.project_id]));
      for (const id of itemIds) {
        if (!found.has(id)) throw new ValidationError(`Delivery work item ${id} does not exist`);
        if (found.get(id) !== incoming.project_id) throw new ValidationError(`Delivery work item ${id} is on another project`);
      }
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
    const orders = orderIds.length
      ? (await h.db.query('SELECT id, work_item_id FROM production_orders WHERE id = ANY($1)', [orderIds])).rows
      : [];
    for (const itemId of new Set(itemIds)) {
      const order = orders.find((o) => o.work_item_id === itemId);
      await h.db.query('INSERT INTO delivery_items (delivery_id, work_item_id, production_order_id) VALUES ($1, $2, $3)', [
        id,
        itemId,
        order?.id ?? null,
      ]);
    }

    const receipt = stored.site_receipt as Row | undefined;
    const previous = existing?.site_receipt as Row | undefined;
    if (!receipt || (previous && previous.id === receipt.id)) return;
    const exists = await h.db.query('SELECT 1 FROM delivery_receipts WHERE id = $1', [receipt.id]);
    if (exists.rowCount) return;
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
        JSON.stringify({ ...receipt, delivery_id: id, project_id: stored.project_id }),
        h.actor.id ?? null,
      ]
    );
    if (h.mode !== 'import') {
      // The items on this delivery are now on site (or arrived with a problem). Their
      // installation status is untouched: receiving never starts installation.
      const problem =
        ['Short Quantity', 'Damaged', 'Wrong Item'].includes(String(receipt.condition_status)) ||
        Number(receipt.damaged_quantity) > 0 ||
        Number(receipt.missing_quantity) > 0;
      const itemStatus = problem ? 'Delivery Issue' : 'Delivered';
      await h.db.query(
        `UPDATE work_items SET delivery_status = $2, updated_at = now()
         WHERE id IN (SELECT work_item_id FROM delivery_items WHERE delivery_id = $1) AND delivery_status IS DISTINCT FROM $2`,
        [id, itemStatus]
      );
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
  },
};
