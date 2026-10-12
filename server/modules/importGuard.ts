/**
 * Business rules for /api/data/import (Phase 6 Batch 12A). Import creates records only (an
 * existing id is skipped, never overwritten) and the module hooks do not run in import mode, so
 * the rules that protect purchase orders, approval requests and invoices are applied here, to
 * every imported record, before it is written. Legacy history can be imported; evidence cannot:
 *
 *  - purchase orders: the total is computed from the lines; a PO imported as issued (Issued,
 *    Partially Received, Goods Received, Completed) needs the importer's own authority to issue
 *    it, from the authority resolver, exactly as issuing it through the API would;
 *  - approval requests: AI proposals are never imported (they are raised by the assistant only);
 *    approved facts are never imported (an imported approved Major Purchase does not count until
 *    the Owner re-authorizes it in the legacy review); a requester-chosen approver is not kept as
 *    the approver (it is kept, for the record, as imported_assigned_approver);
 *  - invoices: approval evidence (approved_at, approved_by_*, approval_authority, ledger_cost_id)
 *    is never imported, the recorder is the importer, the status must be a known one, and the
 *    paid amount must agree with it. An imported invoice in Approved / Partially Paid / Overdue /
 *    Paid has no recorded approval: it is listed for the Owner's legacy review and cannot be paid
 *    until released (Paid: listed for review; nothing further can happen to it).
 *
 * After the import, identifyLegacyRecords lists the imported records that need review.
 */
import { ForbiddenError } from '../auth/access';
import { ValidationError } from '../core/repository';
import { AI_PROPOSAL_APPROVAL_TYPE, requireAuthority } from './authorityResolver';
import { INVOICE_NEXT, isIssuedState, withComputedTotal } from './hooks/purchasing';
import type { HookContext, Row } from './types';

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;
const OWNER_ROLE = 'Owner / CEO';
const CLIENT_FACING = new Set(['Variation', 'Client Scope Change']);
const INVOICE_EVIDENCE = ['approved_at', 'approved_by_id', 'approved_by_name', 'approval_authority', 'ledger_cost_id'];

export async function guardImportedRecord(h: HookContext, collection: string, record: Row): Promise<Row> {
  const label = `${collection} ${String(record.id ?? '')}`;
  switch (collection) {
    case 'purchaseOrders': {
      const po = withComputedTotal(record);
      // A server-side administrative import (the demo seed, run with database credentials) has
      // no person behind it: it is recorded as such, and grants nothing. Imports through the API
      // carry the signed-in importer, whose authority decides.
      if (isIssuedState(po.status) && !h.ctx.background) {
        await requireAuthority(
          h.db,
          h.ctx,
          { resource: { kind: 'purchase_order', id: String(po.id) }, pending: { projectId: String(po.project_id), value: Number(po.total_amount), supplierId: (po.supplier_id as string) ?? null } },
          (r) => `Import: ${label} is ${String(po.status)}, and you may not issue it (${r.reason})`
        );
      }
      return po;
    }
    case 'approvals': {
      if (record.approval_type === AI_PROPOSAL_APPROVAL_TYPE) throw new ForbiddenError(`Import: ${label} is an AI proposal; AI proposals are raised by the assistant only`);
      const out: Row = { ...record };
      delete out.approved_facts;
      const role = out.assigned_approver_role;
      const keepRole = role === undefined || role === null || role === '' || role === OWNER_ROLE || (role === 'Client' && CLIENT_FACING.has(String(out.approval_type)));
      if (out.assigned_approver_id || !keepRole) {
        out.imported_assigned_approver = { id: out.assigned_approver_id ?? null, name: out.assigned_approver_name ?? null, role: role ?? null };
        delete out.assigned_approver_id;
        delete out.assigned_approver_name;
        if (!keepRole) delete out.assigned_approver_role;
      }
      return out;
    }
    case 'commercialInvoices': {
      const out: Row = { ...record };
      for (const f of INVOICE_EVIDENCE) delete out[f];
      out.recorded_by_id = h.ctx.user.id;
      out.recorded_by_name = h.ctx.user.name;
      const status = String(out.status ?? 'Draft');
      if (!(status in INVOICE_NEXT)) throw new ValidationError(`Import: ${label} has an unknown status ${status}`);
      const total = money(Number(out.amount_before_tax) + Number(out.tax_amount || 0));
      const paid = money(out.paid_amount);
      const consistent =
        status === 'Paid' ? paid === total : status === 'Partially Paid' ? paid > 0 && paid < total : status === 'Overdue' ? paid >= 0 && paid < total : paid === 0;
      if (!consistent) throw new ValidationError(`Import: ${label} is ${status} with RM ${paid} paid of RM ${total}`);
      return out;
    }
    default:
      return record;
  }
}
