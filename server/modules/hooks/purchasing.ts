import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { PoolClient } from '../../db/pool';
import type { ModuleHooks, Row } from '../types';
import { authorityAudit, requireAuthority, type AuthorityResolution } from '../authorityResolver';

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const qty = (n: unknown) => Math.max(0, Number(n) || 0);

/**
 * POs at or above this value need an approved Major Purchase approval (or the Owner) to issue.
 * Enforced by the authority resolver through System Policy SYS-PURCHASE-MAJOR, whose threshold
 * a test keeps equal to this constant.
 */
export const MAJOR_PURCHASE_THRESHOLD = 20000;
/** PO statuses only goods-received records set. */
const RECEIVED_STATES = new Set(['Partially Received', 'Goods Received']);

function poLines(po: Row): Row[] {
  return (Array.isArray(po.items) ? po.items : []) as Row[];
}

/** Quantity received so far per PO line, across every goods-received record for the PO. */
export async function receivedByLine(db: PoolClient, poId: string, excludeGrnId?: string): Promise<Map<string, number>> {
  const res = await db.query(`SELECT id, data FROM goods_received WHERE po_id = $1`, [poId]);
  const out = new Map<string, number>();
  for (const r of res.rows) {
    if (r.id === excludeGrnId) continue;
    for (const line of (r.data.items ?? []) as Row[]) {
      const key = String(line.po_item_id);
      out.set(key, (out.get(key) ?? 0) + qty(line.received_qty));
    }
  }
  return out;
}

export const purchaseOrderHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    // The PO value is always the sum of its lines.
    const items = poLines(incoming).map((it) => ({ ...it, total_price: money(qty(it.quantity) * (Number(it.unit_price) || 0)) }));
    const total = money(items.reduce((s, it) => s + (it.total_price as number), 0));
    const next: Row = { ...incoming, items, total_amount: items.length ? total : money(incoming.total_amount) };
    const from = existing ? String(existing.status) : undefined;
    const to = String(next.status ?? 'Draft');
    if (from !== to) {
      if (RECEIVED_STATES.has(to)) {
        throw new ForbiddenError('A PO is marked received by recording goods received against it');
      }
      // Issuing a PO is a purchase decision: the authority resolver decides (System Policy:
      // below the threshold Purchasing issues; at or above it a Major Purchase approval or the Owner).
      let authority: AuthorityResolution | undefined;
      if (to === 'Issued') {
        authority = await requireAuthority(
          h.db,
          h.ctx,
          { resource: { kind: 'purchase_order', id: String(next.id) }, pending: { projectId: String(next.project_id), value: Number(next.total_amount) } },
          (r) =>
            Number(next.total_amount) >= MAJOR_PURCHASE_THRESHOLD && (r.reasonCode === 'OWNER_REQUIRED' || r.reasonCode === 'NO_MATCHING_AUTHORITY' || r.reasonCode === 'VALUE_LIMIT_EXCEEDED')
              ? `A purchase order of RM ${MAJOR_PURCHASE_THRESHOLD.toLocaleString()} or more needs an approved Major Purchase approval (or the Owner) before it is issued`
              : `This purchase order cannot be issued: ${r.reason}`
        );
      }
      if (existing && ['Goods Received', 'Completed', 'Cancelled'].includes(from!) && to !== 'Completed') {
        throw new ForbiddenError(`A ${from} purchase order cannot move back to ${to}`);
      }
      if (to === 'Issued' && !next.issued_date) next.issued_date = new Date().toISOString();
      await writeAudit(h.db, h.actor, {
        action: `purchase_order.${to.toLowerCase().replace(/\s+/g, '_')}`,
        entityType: 'purchaseOrders',
        entityId: String(next.id),
        projectId: (next.project_id as string) ?? null,
        before: from ? { status: from } : undefined,
        after: { status: to, total_amount: next.total_amount, ...(authority ? { authority: authorityAudit(authority) } : {}) },
      });
    }
    return next;
  },
};

/**
 * Goods received against a PO: per line ordered / received / short / damaged / wrong item.
 * The receiver is the signed-in user. A record is never edited afterwards (a correction is a
 * new record). The only other state it changes is its own PO's received status.
 */
export const goodsReceivedHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    if (existing) throw new ForbiddenError('A goods-received record cannot be changed; record a new one to correct it');
    const po = (await h.db.query('SELECT id, project_id, supplier_id, status, data FROM purchase_orders WHERE id = $1 FOR UPDATE', [incoming.po_id])).rows[0];
    if (!po) throw new ValidationError(`Purchase order ${String(incoming.po_id)} does not exist`);
    if (!['Issued', 'Partially Received'].includes(po.status)) throw new ForbiddenError(`Goods can only be received against an Issued PO (this one is ${po.status})`);
    const previous = await receivedByLine(h.db, po.id);
    const lines = poLines(po.data);
    const byId = new Map(lines.map((l) => [String(l.id), l]));
    const items = ((incoming.items ?? []) as Row[]).map((line) => {
      const poLine = byId.get(String(line.po_item_id));
      if (!poLine) throw new ValidationError(`PO ${String(po.data.po_number)} has no line ${String(line.po_item_id)}`);
      const ordered = qty(poLine.quantity);
      const before = previous.get(String(poLine.id)) ?? 0;
      const received = qty(line.received_qty);
      if (before + received > ordered * 1.1) throw new ValidationError(`${String(poLine.item_description)}: receiving ${received} would exceed the ${ordered} ordered`);
      return {
        po_item_id: poLine.id,
        description: poLine.item_description,
        unit: poLine.unit,
        ordered_qty: ordered,
        previously_received: before,
        received_qty: received,
        short_qty: Math.max(0, ordered - before - received),
        damaged_qty: qty(line.damaged_qty),
        wrong_item: Boolean(line.wrong_item),
        notes: line.notes ?? '',
      };
    });
    if (!items.length || items.every((i) => i.received_qty === 0 && i.damaged_qty === 0 && !i.wrong_item)) {
      throw new ValidationError('Record at least one received, damaged or wrong line');
    }
    const condition = items.some((i) => i.damaged_qty > 0 || i.wrong_item)
      ? 'Damaged / Rejected'
      : items.some((i) => i.short_qty > 0)
        ? 'Partial with Shortage'
        : 'Good';
    return {
      ...incoming,
      project_id: po.project_id,
      supplier_id: po.supplier_id,
      po_number: po.data.po_number,
      supplier_name: po.data.supplier_name,
      project_name: po.data.project_name,
      items,
      condition,
      quantity_received: items.reduce((s, i) => s + i.received_qty, 0),
      material_description: incoming.material_description || items.map((i) => i.description).join(', '),
      received_by: h.ctx.user.name,
      received_by_id: h.ctx.user.id,
      date_received: incoming.date_received || new Date().toISOString().slice(0, 10),
    };
  },

  async afterWrite(h, _existing, stored) {
    if (h.mode === 'import') return;
    const poId = String(stored.po_id);
    const po = (await h.db.query('SELECT id, status, data FROM purchase_orders WHERE id = $1', [poId])).rows[0];
    const received = await receivedByLine(h.db, poId);
    const complete = poLines(po.data).every((l) => (received.get(String(l.id)) ?? 0) >= qty(l.quantity));
    const status = complete ? 'Goods Received' : 'Partially Received';
    if (po.status !== status) {
      await h.db.query(
        `UPDATE purchase_orders SET status = $2, updated_at = now(),
           data = jsonb_set(jsonb_set(data, '{status}', to_jsonb($2::text)), '{actual_delivery_date}', to_jsonb($3::text))
         WHERE id = $1`,
        [poId, status, String(stored.date_received)]
      );
    }
    await writeAudit(h.db, h.actor, {
      action: 'goods_received.create',
      entityType: 'goodsReceived',
      entityId: String(stored.id),
      projectId: (stored.project_id as string) ?? null,
      after: { po: stored.po_number, condition: stored.condition, po_status: status, lines: stored.items },
    });
  },
};

/** Value of goods received so far against a PO (received quantity x PO unit price). */
async function receivedValue(db: PoolClient, poId: string) {
  const po = (await db.query('SELECT data FROM purchase_orders WHERE id = $1', [poId])).rows[0];
  if (!po) return { poTotal: 0, received: 0 };
  const received = await receivedByLine(db, poId);
  const value = poLines(po.data).reduce((s, l) => s + (received.get(String(l.id)) ?? 0) * (Number(l.unit_price) || 0), 0);
  return { poTotal: money(po.data.total_amount), received: money(value) };
}

/**
 * Supplier invoices: matched against the PO and the goods received (3-way match), approved by
 * finance (not by whoever recorded it), and on approval posted once to actual cost (an
 * Incurred cost-ledger entry) in the same transaction.
 */
export const invoiceHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    const next: Row = {
      ...incoming,
      amount_before_tax: money(incoming.amount_before_tax),
      tax_amount: money(incoming.tax_amount),
      total_amount: money(Number(incoming.amount_before_tax) + Number(incoming.tax_amount || 0)),
    };
    for (const f of ['recorded_by_id', 'approved_by_id', 'approved_by_name', 'approved_at', 'ledger_cost_id', 'approval_authority']) next[f] = existing?.[f];
    if (!existing) {
      next.recorded_by_id = h.ctx.user.id;
      next.recorded_by_name = h.ctx.user.name;
      if (next.status === 'Approved' || next.status === 'Paid') throw new ForbiddenError('A new invoice is recorded as Draft or Pending Approval');
    } else if (['Approved', 'Partially Paid', 'Paid'].includes(String(existing.status))) {
      for (const f of ['amount_before_tax', 'tax_amount', 'po_id', 'po_reference', 'project_id', 'invoice_type']) {
        if (JSON.stringify(existing[f]) !== JSON.stringify(next[f])) throw new ForbiddenError(`An approved invoice's ${f} cannot change`);
      }
    }
    if (next.invoice_type === 'Supplier Invoice') {
      if (!next.po_id) throw new ValidationError('A supplier invoice must reference its purchase order');
      const po = (await h.db.query('SELECT project_id, data FROM purchase_orders WHERE id = $1', [next.po_id])).rows[0];
      if (!po) throw new ValidationError(`Purchase order ${String(next.po_id)} does not exist`);
      if (po.project_id !== next.project_id) throw new ValidationError('The invoice project must be the purchase order project');
      next.po_reference = po.data.po_number;
      const { poTotal, received } = await receivedValue(h.db, String(next.po_id));
      const amount = Number(next.amount_before_tax);
      next.match = { po_total: poTotal, received_value: received, invoiced: amount };
      next.match_status = amount > poTotal + 0.5 ? 'Exceeds PO' : amount > received + 0.5 ? 'Exceeds goods received' : 'Matched';
    }
    const approving = next.status === 'Approved' && existing?.status !== 'Approved' && !['Partially Paid', 'Paid'].includes(String(existing?.status));
    if (approving) {
      // An invoice approval is an invoice decision: the authority resolver decides (System Policy:
      // finance.edit, never the recorder; anything that does not match its PO needs the Owner).
      const matchStatus = next.match_status ? String(next.match_status) : 'Not applicable';
      const authority = await requireAuthority(
        h.db,
        h.ctx,
        { resource: { kind: 'invoice', id: String(existing!.id) }, pending: { projectId: String(next.project_id), value: Number(next.amount_before_tax), matchStatus } },
        (r) =>
          r.reasonCode === 'OWNER_REQUIRED' && matchStatus !== 'Matched' && matchStatus !== 'Not applicable'
            ? `This invoice does not match (${matchStatus}); only the Owner can approve it`
            : r.reasonCode === 'NO_MATCHING_AUTHORITY' || r.reasonCode === 'INSUFFICIENT_PERMISSION'
              ? `Missing permission: finance.edit (approve an invoice). ${r.reason}`
              : r.reason
      );
      next.approval_authority = authorityAudit(authority);
      next.approved_by_id = h.ctx.user.id;
      next.approved_by_name = h.ctx.user.name;
      next.approved_at = new Date().toISOString();
    }
    return next;
  },

  async afterWrite(h, existing, stored) {
    if (h.mode === 'import') return;
    const approvedNow = stored.status === 'Approved' && existing?.status !== 'Approved' && !stored.ledger_cost_id;
    if (!approvedNow || stored.invoice_type === 'Client Billing Invoice') return;
    // Post the actual cost once (amount before recoverable tax).
    const costId = `cst-inv-${String(stored.id)}`;
    await h.insertSystemRecord('projectCostLedger', {
      cost_id: costId,
      project_id: stored.project_id,
      project_name: stored.project_name,
      cost_category: stored.invoice_type === 'Subcontractor Claim Invoice' ? 'Subcontractor' : 'Material',
      party_name: stored.party_name,
      po_reference: stored.po_reference,
      invoice_reference: stored.invoice_number,
      description: `${String(stored.invoice_type)} ${String(stored.invoice_number)}`,
      amount: stored.amount_before_tax,
      date: stored.invoice_date,
      status: 'Incurred',
      cost_source: String(stored.invoice_number),
      created_by: h.ctx.user.name,
      approved_by: h.ctx.user.name,
    }, `actual cost from approved invoice ${String(stored.invoice_number)}`);
    await h.db.query(`UPDATE commercial_invoices SET data = jsonb_set(data, '{ledger_cost_id}', to_jsonb($2::text)) WHERE id = $1`, [stored.id, costId]);
    await writeAudit(h.db, h.actor, {
      action: 'invoice.approve',
      entityType: 'commercialInvoices',
      entityId: String(stored.id),
      projectId: (stored.project_id as string) ?? null,
      after: { amount: stored.amount_before_tax, match_status: stored.match_status, ledger_cost_id: costId, authority: stored.approval_authority },
    });
  },
};
