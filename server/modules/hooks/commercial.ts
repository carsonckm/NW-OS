import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { PermissionKey } from '../../../src/types';
import type { HookContext, ModuleHooks, Row } from '../types';

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 10000) / 100 : 0);

/**
 * Quotation workflow (one record per version):
 *   Draft -> Internal Review -> (internal approval) -> Submitted -> Negotiation
 *        -> Accepted (award) | Rejected (lost) | Expired | Cancelled
 *   A new version supersedes the previous one (Superseded).
 * Items and prices can only change while Draft; after that a change is a new version.
 * Totals are always computed here from the items; totals sent by a browser are ignored.
 */
const FLOW: Record<string, string[]> = {
  Draft: ['Internal Review', 'Cancelled', 'Superseded'],
  'Internal Review': ['Draft', 'Submitted', 'Cancelled', 'Superseded'],
  Submitted: ['Negotiation', 'Accepted', 'Rejected', 'Expired', 'Cancelled', 'Superseded'],
  Negotiation: ['Accepted', 'Rejected', 'Expired', 'Cancelled', 'Submitted', 'Superseded'],
  Accepted: [],
  Rejected: [],
  Expired: [],
  Cancelled: [],
  Superseded: [],
};
const PRICED_FIELDS = ['items', 'tax_applicable', 'tax_rate', 'validity_days', 'client_id', 'terms'];

function need(h: HookContext, perm: PermissionKey, what: string) {
  if (!h.ctx.can(perm)) throw new ForbiddenError(`Missing permission: ${perm} (${what})`);
}

/** Item and quotation totals from quantities, unit prices and internal costs. */
export function priceQuotation(q: Row): Row {
  const items = (Array.isArray(q.items) ? q.items : []).map((raw) => {
    const it = raw as Row;
    const qty = Number(it.quantity) || 0;
    const sell = money(qty * (Number(it.unit_selling_price) || 0));
    const breakdown = (it.estimated_cost_breakdown ?? {}) as Record<string, unknown>;
    const breakdownTotal = Object.values(breakdown).reduce<number>((s, v) => s + (Number(v) || 0), 0);
    const cost = money(breakdownTotal > 0 ? breakdownTotal : Number(it.total_estimated_cost) || 0);
    return { ...it, total_selling_price: sell, total_estimated_cost: cost, gross_profit: money(sell - cost), gross_margin_percent: pct(sell - cost, sell) };
  });
  const subtotal = money(items.reduce((s, it) => s + (it.total_selling_price as number), 0));
  const cost = money(items.reduce((s, it) => s + (it.total_estimated_cost as number), 0));
  const tax = q.tax_applicable ? money(subtotal * ((Number(q.tax_rate) || 0) / 100)) : 0;
  const profit = money(subtotal - cost);
  return {
    ...q,
    items,
    subtotal_selling_price: subtotal,
    tax_amount: tax,
    total_selling_price: money(subtotal + tax),
    total_estimated_cost: cost,
    estimated_gross_profit: profit,
    estimated_gross_margin_percent: pct(profit, subtotal),
    low_margin_warning: subtotal > 0 && pct(profit, subtotal) < 15,
  };
}

export const quotationHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return priceQuotation(incoming);
    const now = new Date().toISOString();
    if (!existing) {
      const status = String(incoming.status ?? 'Draft');
      if (status !== 'Draft') throw new ForbiddenError('A new quotation starts as Draft');
      return priceQuotation({
        ...incoming,
        status: 'Draft',
        approval_status: 'Pending',
        prepared_by: h.ctx.user.name,
        prepared_by_id: h.ctx.user.id,
        approved_by_id: undefined,
        approved_by_name: undefined,
        approved_at: undefined,
        created_at: incoming.created_at ?? now,
        updated_at: now,
      });
    }

    const from = String(existing.status);
    const to = String(incoming.status ?? from);
    let next: Row = { ...incoming, updated_at: now };
    // Who prepared and who approved always come from the server.
    for (const f of ['prepared_by', 'prepared_by_id', 'approved_by_id', 'approved_by_name', 'approved_at', 'awarded_at', 'awarded_by', 'converted_project_id', 'project_id', 'submitted_at']) {
      next[f] = existing[f];
    }
    const pricedChanged = PRICED_FIELDS.some((f) => JSON.stringify(existing[f]) !== JSON.stringify(incoming[f]));
    if (pricedChanged && from !== 'Draft') {
      throw new ForbiddenError(`Quotation ${String(existing.version_code ?? existing.id)} is ${from}; create a new version to change items or prices`);
    }

    // Internal approval: a different person with commercial.margins approves before submission.
    const approving = incoming.approval_status === 'Approved' && existing.approval_status !== 'Approved';
    if (approving) {
      if (from !== 'Internal Review') throw new ForbiddenError('Only a quotation in Internal Review can be approved');
      need(h, 'commercial.margins', 'approve a quotation');
      if (existing.prepared_by_id && existing.prepared_by_id === h.ctx.user.id) {
        throw new ForbiddenError('You cannot approve a quotation you prepared');
      }
      next = { ...next, approval_status: 'Approved', approved_by_id: h.ctx.user.id, approved_by_name: h.ctx.user.name, approved_at: now };
    } else {
      next.approval_status = existing.approval_status;
    }

    if (to !== from) {
      if (!FLOW[from]?.includes(to)) throw new ForbiddenError(`A ${from} quotation cannot move to ${to}`);
      need(h, 'commercial.edit', `move a quotation to ${to}`);
      if (to === 'Submitted' && next.approval_status !== 'Approved') {
        throw new ForbiddenError('The quotation needs internal approval before it is submitted to the client');
      }
      if (to === 'Draft') next.approval_status = 'Pending';
      if (to === 'Accepted') {
        next.awarded_at = now;
        next.awarded_by = h.ctx.user.name;
      }
      if (to === 'Submitted' && !existing.submitted_at) next.submitted_at = now;
      await writeAudit(h.db, h.actor, {
        action: `quotation.${to.toLowerCase().replace(/\s+/g, '_')}`,
        entityType: 'commercialQuotations',
        entityId: String(existing.id),
        projectId: (existing.project_id as string) ?? null,
        before: { status: from },
        after: { status: to, total_selling_price: existing.total_selling_price },
      });
    }
    if (approving) {
      await writeAudit(h.db, h.actor, {
        action: 'quotation.approve',
        entityType: 'commercialQuotations',
        entityId: String(existing.id),
        after: { approval_status: 'Approved', total_selling_price: existing.total_selling_price, margin: existing.estimated_gross_margin_percent },
      });
    }
    return priceQuotation(next);
  },
};

/** Client-facing quotation: everything internal (costs, margins, notes, sources) is left out. */
export function clientQuotation(q: Row) {
  const items = (Array.isArray(q.items) ? q.items : []).map((raw) => {
    const it = raw as Row;
    return {
      item_code: it.item_code,
      description: it.description,
      category: it.category,
      specification: it.specification,
      quantity: it.quantity,
      unit: it.unit,
      length: it.length,
      width: it.width,
      height: it.height,
      unit_selling_price: it.unit_selling_price,
      total_selling_price: it.total_selling_price,
    };
  });
  return {
    quotation_number: q.quotation_number,
    version_code: q.version_code,
    version: q.version,
    client_name: q.client_name,
    attention_to: q.attention_to,
    project_name: q.project_name,
    site_address: q.site_address,
    date: q.date,
    validity_days: q.validity_days,
    valid_until: q.valid_until,
    items,
    subtotal_selling_price: q.subtotal_selling_price,
    tax_applicable: q.tax_applicable,
    tax_rate: q.tax_rate,
    tax_amount: q.tax_amount,
    total_selling_price: q.total_selling_price,
    terms: q.terms,
    client_notes: q.client_notes,
    prepared_by: q.prepared_by,
    status: q.status,
  };
}

export function nextVersionCode(q: Row, version: number) {
  return `${String(q.quotation_number)}-V${version}`;
}

export function assertConvertible(q: Row) {
  if (q.status !== 'Accepted') throw new ValidationError('Only an awarded (Accepted) quotation can be converted to a project');
  if (q.converted_project_id || q.project_id) throw new ValidationError(`Quotation ${String(q.version_code)} is already linked to project ${String(q.converted_project_id ?? q.project_id)}`);
}
