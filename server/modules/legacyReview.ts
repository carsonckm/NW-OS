/**
 * Owner review of legacy records (Phase 6 Batch 12A). Records that are in a protected state
 * without the evidence NW OS now requires are identified once (migration 030 for data already
 * present; /api/data/import for imported data) and listed for the Owner:
 *
 *   invoice            Approved / Partially Paid / Overdue with no recorded approval: cannot be paid
 *                      until the Owner releases it (Paid: listed so the Owner acknowledges or
 *                      declines it; nothing further can happen to it);
 *   purchase_approval  an approved Major Purchase approval with no approved facts (no decision-time
 *                      audit record): does not count for issuing its PO until the Owner re-authorizes
 *                      it against the PO as it is now.
 *
 * The Owner's decision (released / reauthorized / declined, with a reason) is a new, append-only
 * record: who, when, why, and for a re-authorization the current PO facts and the authority
 * resolution it was checked with. Nothing is marked approved or paid, and no historical approval
 * or audit record is created or changed: a release is an administrative decision, not evidence that
 * an approval happened. Payments after a release still need finance.record_payments and pass the
 * normal payment checks. Only identified records can be reviewed, once each, so this is not a path
 * for new invoices or approvals.
 */
import type { AccessContext } from '../auth/access';
import { ForbiddenError } from '../auth/access';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import { authorityAudit, requireAuthority } from './authorityResolver';

type Db = Pool | PoolClient;
type Row = Record<string, any>;
const OWNER = 'Owner / CEO';

export type LegacyKind = 'invoice' | 'purchase_approval';
const DECISIONS: Record<LegacyKind, string[]> = { invoice: ['released', 'acknowledged', 'declined'], purchase_approval: ['reauthorized', 'declined'] };

/**
 * The identification statements ($1: who identified it); migration 030 runs the same conditions
 * (a test checks they agree). Existing items are never touched (ON CONFLICT DO NOTHING).
 */
export const IDENTIFY_SQL = {
  invoice: `INSERT INTO legacy_review_items (kind, record_id, project_id, reason, details, identified_by)
     SELECT 'invoice', i.id, i.project_id, 'no_recorded_approval',
            jsonb_build_object('status', i.status, 'invoice_number', i.data->>'invoice_number', 'paid_amount', i.data->'paid_amount', 'total_amount', i.data->'total_amount'),
            $1
       FROM commercial_invoices i
      WHERE i.status IN ('Approved', 'Partially Paid', 'Overdue', 'Paid') AND coalesce(i.data->>'approved_at', '') = ''
     ON CONFLICT (kind, record_id) DO NOTHING`,
  purchase_approval: `INSERT INTO legacy_review_items (kind, record_id, project_id, reason, details, identified_by)
     SELECT 'purchase_approval', a.id, a.project_id, 'no_approval_evidence',
            jsonb_build_object('po_id', a.related_entity_id, 'po_status', po.status, 'decision_by_role', a.data->>'decision_by_role'),
            $1
       FROM approvals a JOIN purchase_orders po ON po.id = a.related_entity_id AND po.project_id = a.project_id
      WHERE a.approval_type = 'Major Purchase' AND a.decision = 'Approved' AND a.related_entity_type = 'purchase'
        AND NOT (a.data ? 'approved_facts')
     ON CONFLICT (kind, record_id) DO NOTHING`,
};

export async function identifyLegacyRecords(db: PoolClient, source: string) {
  const invoices = await db.query(IDENTIFY_SQL.invoice, [source]);
  const approvals = await db.query(IDENTIFY_SQL.purchase_approval, [source]);
  return { invoices: invoices.rowCount ?? 0, purchase_approvals: approvals.rowCount ?? 0 };
}

/** True when the Owner released this legacy invoice for payment (the only substitute for approved_at). */
export async function invoiceReleased(db: Db, invoiceId: string) {
  return Boolean(
    (await db.query(`SELECT 1 FROM legacy_review_items i JOIN legacy_review_decisions d ON d.item_id = i.id WHERE i.kind = 'invoice' AND i.record_id = $1 AND d.decision = 'released'`, [invoiceId])).rowCount
  );
}

function requireOwner(ctx: AccessContext) {
  if (ctx.user.role !== OWNER || !ctx.user.is_active) throw new ForbiddenError('Only the Owner may review legacy records');
}

/** The review list (Owner only): every identified record in the Owner's scope, with its decision if any. */
export async function listLegacyReviews(db: Db, ctx: AccessContext) {
  requireOwner(ctx);
  const rows = (
    await db.query(
      `SELECT i.*, d.id AS decision_id, d.decision, d.reason AS decision_reason, d.reviewed_by_id, d.reviewed_by_name, d.reviewed_at, d.facts,
              inv.status AS invoice_status, ap.decision AS approval_decision, po.status AS po_status
         FROM legacy_review_items i
         LEFT JOIN legacy_review_decisions d ON d.item_id = i.id
         LEFT JOIN commercial_invoices inv ON i.kind = 'invoice' AND inv.id = i.record_id
         LEFT JOIN approvals ap ON i.kind = 'purchase_approval' AND ap.id = i.record_id
         LEFT JOIN purchase_orders po ON po.id = ap.related_entity_id
        ORDER BY i.id`
    )
  ).rows as Row[];
  const visible = rows.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
  return {
    pending: visible.filter((r) => !r.decision_id).length,
    items: visible.map((r) => ({
      kind: r.kind,
      record_id: r.record_id,
      project_id: r.project_id,
      reason: r.reason,
      identified: { by: r.identified_by, at: new Date(r.identified_at).toISOString(), details: r.details },
      current: r.kind === 'invoice' ? { status: r.invoice_status } : { decision: r.approval_decision, po_status: r.po_status },
      decision: r.decision_id
        ? { id: Number(r.decision_id), decision: r.decision, reason: r.decision_reason, reviewed_by: { id: r.reviewed_by_id, name: r.reviewed_by_name }, reviewed_at: new Date(r.reviewed_at).toISOString(), facts: r.facts ?? null }
        : null,
    })),
  };
}

/**
 * The Owner's decision on one identified record. One decision per record (a second one is a
 * conflict). Checked again on the server against the record as it is now.
 */
export async function decideLegacyReview(pool: Pool, ctx: AccessContext, actor: AuditActor, kind: string, recordId: string, body: unknown) {
  requireOwner(ctx);
  if (kind !== 'invoice' && kind !== 'purchase_approval') throw new ValidationError('kind must be invoice or purchase_approval');
  const b = (body && typeof body === 'object' ? body : {}) as Row;
  const extra = Object.keys(b).filter((k) => !['decision', 'reason'].includes(k));
  if (extra.length) throw new ValidationError(`These fields are set by the server or not allowed: ${extra.join(', ')}`);
  if (!DECISIONS[kind].includes(b.decision)) throw new ValidationError(`decision must be one of ${DECISIONS[kind].join(', ')}`);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');

  return withTransaction(pool, async (db) => {
    const notFound = () => Object.assign(new NotFoundError('clients', recordId), { message: `Legacy review ${kind} ${recordId} not found` });
    const item = (await db.query('SELECT * FROM legacy_review_items WHERE kind = $1 AND record_id = $2', [kind, recordId])).rows[0] as Row | undefined;
    if (!item || (item.project_id && !ctx.canSeeProject(item.project_id))) throw notFound();
    const conflict = (msg: string) => Object.assign(new ValidationError(msg), { status: 409 });
    if ((await db.query('SELECT 1 FROM legacy_review_decisions WHERE item_id = $1', [item.id])).rowCount) throw conflict('This record has already been reviewed');

    let facts: Row | null = null;
    let authority: Row | null = null;
    let before: Row;
    if (kind === 'invoice') {
      const inv = (await db.query('SELECT id, project_id, status, data FROM commercial_invoices WHERE id = $1 FOR UPDATE', [recordId])).rows[0];
      if (!inv) throw notFound();
      before = { status: inv.status, approved_at: inv.data.approved_at ?? null, paid_amount: inv.data.paid_amount ?? 0 };
      if (b.decision === 'released') {
        if (inv.data.approved_at) throw conflict('This invoice has a recorded approval; it needs no release');
        if (!['Approved', 'Partially Paid', 'Overdue'].includes(inv.status)) throw conflict(`This invoice is ${inv.status}; only an Approved, Partially Paid or Overdue invoice is released for payment`);
        authority = authorityAudit(await requireAuthority(db, ctx, { resource: { kind: 'invoice', id: recordId } }));
      }
      // A legacy Paid invoice: the Owner acknowledges (or declines) it; nothing about it changes.
      if (b.decision === 'acknowledged' && inv.status !== 'Paid') throw conflict(`Only a Paid legacy invoice is acknowledged (this one is ${inv.status}; release or decline it)`);
    } else {
      const ap = (await db.query('SELECT id, project_id, approval_type, decision, related_entity_type, related_entity_id, data FROM approvals WHERE id = $1 FOR UPDATE', [recordId])).rows[0];
      if (!ap) throw notFound();
      before = { decision: ap.decision, approved_facts: ap.data.approved_facts ?? null, po_id: ap.related_entity_id };
      if (b.decision === 'reauthorized') {
        if (ap.approval_type !== 'Major Purchase' || ap.decision !== 'Approved' || ap.related_entity_type !== 'purchase') throw conflict('This is no longer an approved Major Purchase approval');
        if (ap.data.approved_facts) throw conflict('This approval already records what it approved');
        const po = (await db.query('SELECT id, project_id, supplier_id, status, data FROM purchase_orders WHERE id = $1 FOR UPDATE', [ap.related_entity_id])).rows[0];
        if (!po || po.project_id !== ap.project_id) throw conflict('Its purchase order is missing or on another project; raise a new Major Purchase request');
        // The current approval requirements, against the PO as it is now (the resolver reads its total).
        authority = authorityAudit(await requireAuthority(db, ctx, { resource: { kind: 'approval', id: recordId }, action: 'approve' }));
        facts = { po_id: po.id, project_id: po.project_id, supplier_id: po.supplier_id ?? null, total_amount: Math.round((Number(po.data.total_amount) || 0) * 100) / 100, po_status: po.status };
      }
    }
    const decision = (
      await db.query(
        `INSERT INTO legacy_review_decisions (item_id, decision, reason, reviewed_by_id, reviewed_by_name, reviewed_by_role, facts, authority)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [item.id, b.decision, reason, ctx.user.id, ctx.user.name, ctx.user.role, facts, authority]
      )
    ).rows[0];
    await writeAudit(db, actor, {
      action: `legacy_review.${b.decision}`,
      entityType: kind === 'invoice' ? 'invoice' : 'approval',
      entityId: recordId,
      projectId: item.project_id ?? null,
      before: { ...before!, identified: { by: item.identified_by, reason: item.reason } },
      after: { decision: b.decision, reason, review_id: Number(decision.id), administrative: true, facts, authority },
    });
    return { id: Number(decision.id), kind, record_id: recordId, decision: decision.decision, reason: decision.reason, reviewed_by: { id: decision.reviewed_by_id, name: decision.reviewed_by_name }, reviewed_at: new Date(decision.reviewed_at).toISOString(), facts };
  });
}
