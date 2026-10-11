import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { AI_PROPOSAL_TYPE, executeProposal } from '../assistantActions';
import { clientConsentAllowed, requireAuthority, type AuthorityResolution } from '../authorityResolver';
import { decisionAudit, notifyRejection } from '../decisionTrace';
import { syncRoute } from '../approvalRouting';
import type { HookContext, ModuleHooks, Row } from '../types';

const FINAL = new Set(['Approved', 'Rejected']);
// Fields only the requester (or an Owner) may change, and only while the request is undecided.
const REQUEST_FIELDS = ['assigned_approver_role', 'assigned_approver_id', 'approval_type', 'related_entity_type', 'related_entity_id', 'project_id'];
const DECISION_FIELDS = ['decision', 'decision_date', 'decision_by_id', 'decision_by_name', 'decision_by_role', 'is_owner_override', 'approved_facts'];
/** Purchase decisions (decision type "purchase"): who decides comes from the authority rules only. */
const PURCHASE_TYPES = new Set(['Major Purchase', 'Major Cost']);
const OWNER_ROLE = 'Owner / CEO';
const changed = (a: unknown, b: unknown) => JSON.stringify(a ?? null) !== JSON.stringify(b ?? null);

/**
 * A Major Purchase / Major Cost request is decided by whoever the authority resolver allows
 * (System Policy, the Owner's rules, the Owner), and routed by it. The requester cannot name the
 * approver: a named person or role would be a requester-chosen approver. Naming the Owner is
 * accepted (it grants nothing the Owner does not already have). A request's existing value is
 * left as it is (legacy requests); it is only refused when it is set or changed.
 */
function checkApproverChoice(existing: Row | undefined, values: Row) {
  if (!PURCHASE_TYPES.has(String(values.approval_type))) return;
  const typeChanged = existing && changed(existing.approval_type, values.approval_type);
  for (const f of ['assigned_approver_id', 'assigned_approver_role'] as const) {
    if (existing && !typeChanged && !changed(existing[f], values[f])) continue;
    const v = values[f];
    if (v === undefined || v === null || v === '') continue;
    if (f === 'assigned_approver_role' && v === OWNER_ROLE) continue;
    throw new ForbiddenError(`The approver of a ${String(values.approval_type)} request is decided by the authority rules, not chosen by the requester`);
  }
}

/** What a Major Purchase approval approved, read by the server from the purchase order (never the browser). */
async function approvedFacts(h: HookContext, approval: Row) {
  if (approval.approval_type !== 'Major Purchase' || approval.related_entity_type !== 'purchase' || !approval.related_entity_id) return null;
  const po = (await h.db.query('SELECT id, project_id, supplier_id, data FROM purchase_orders WHERE id = $1 FOR SHARE', [approval.related_entity_id])).rows[0];
  if (!po || po.project_id !== approval.project_id) return null;
  return { po_id: po.id, project_id: po.project_id, supplier_id: po.supplier_id ?? null, total_amount: Math.round((Number(po.data.total_amount) || 0) * 100) / 100, recorded_at: new Date().toISOString() };
}

/**
 * Who may decide, evaluated on the server against the stored request (never the browser's
 * copy).
 * - A client deciding a client-facing request (Variation / Client Scope Change) on their own
 *   project gives the client's consent; that is not internal approval authority.
 * - Everything else is an approval decision for the authority resolver: Owner, System Policy
 *   (assigned approver by user or role, the Accountant's Major Purchase / Major Cost rule,
 *   "Designated Authorized Manager" requests for approvals.decide holders, never the requester)
 *   and the Owner's delegated rules, under the project's sensitivity ceiling.
 */
export async function evaluateDecision(h: HookContext, stored: Row, decision: string, pendingProjectId?: string): Promise<{ isOverride: boolean; authority?: AuthorityResolution }> {
  const u = h.ctx.user;
  if (clientConsentAllowed(h.ctx, stored)) return { isOverride: false };
  const action = decision === 'Approved' ? 'approve' : decision === 'Rejected' ? 'reject' : 'request_changes';
  const authority = await requireAuthority(h.db, h.ctx, { resource: { kind: 'approval', id: String(stored.id) }, action, pending: { projectId: pendingProjectId } });
  // The Owner deciding their own request is recorded as an Owner override, as before.
  return { isOverride: u.role === 'Owner / CEO' && stored.requested_by_id === u.id, authority };
}

export async function applyDecision(h: HookContext, existing: Row, values: Row) {
  const decision = String(values.decision);
  if (FINAL.has(String(existing.decision))) {
    throw new ForbiddenError(`This request was already ${String(existing.decision).toLowerCase()}; decisions are final`);
  }
  const u = h.ctx.user;
  if (decision === 'Pending') {
    // Re-submitting after "Changes Requested" is the requester's step.
    if (existing.requested_by_id !== u.id && u.role !== 'Owner / CEO') throw new ForbiddenError('Only the requester can resubmit');
    return { ...values, decision_date: undefined, decision_by_id: undefined, decision_by_name: undefined, decision_by_role: undefined, approved_facts: undefined };
  }
  // The decision is taken on the request as stored: what it is about cannot change in the same write.
  for (const f of REQUEST_FIELDS) {
    if (changed(values[f], existing[f])) throw new ForbiddenError(`A request's ${f} cannot change while it is being decided`);
  }
  const verdict = await evaluateDecision(h, existing, decision);
  const decided = {
    ...values,
    decision,
    approved_facts: decision === 'Approved' ? await approvedFacts(h, existing) : undefined,
    decision_date: new Date().toISOString(),
    decision_by_id: u.id,
    decision_by_name: u.name,
    decision_by_role: u.role,
    is_owner_override: verdict.isOverride || undefined,
  };
  await writeAudit(h.db, h.actor, {
    action: decision === 'Approved' ? 'approval.approve' : decision === 'Rejected' ? 'approval.reject' : 'approval.request_changes',
    entityType: 'approval',
    entityId: existing.id as string,
    projectId: existing.project_id as string,
    before: { decision: existing.decision },
    after: { decision, comments: values.comments, override: verdict.isOverride, ...(verdict.authority ? { authority: await decisionAudit(h.db, verdict.authority) } : { consent: 'client' }) },
  });
  if (decision === 'Rejected') {
    await notifyRejection(h.db, { kind: 'approval', id: String(existing.id), requesterId: (existing.requested_by_id as string) ?? null, deciderId: u.id, deciderName: u.name, title: `${String(existing.approval_number ?? existing.id)}: ${String(existing.title ?? existing.approval_type ?? '')}`, projectId: (existing.project_id as string) ?? null, comment: values.comments, linkTab: 'approvals' });
  }
  return decided;
}

export const approvalHooks: ModuleHooks = {
  // AI proposal approved → the system executes it, as the approver, in this transaction.
  // Then the request's route follows its decision (routed while Pending, closed once decided).
  async afterWrite(h, existing, stored) {
    if (h.mode === 'import') return;
    if (stored.approval_type === AI_PROPOSAL_TYPE && stored.decision === 'Approved' && existing?.decision !== 'Approved') await executeProposal(h, stored);
    if (!existing || existing.decision !== stored.decision || existing.project_id !== stored.project_id) await syncRoute(h.db, h.actor, 'approval', String(stored.id));
  },

  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    const u = h.ctx.user;
    // AI proposals are raised by the assistant only, and what they would do is fixed.
    if ((incoming.approval_type === AI_PROPOSAL_TYPE) !== (existing ? existing.approval_type === AI_PROPOSAL_TYPE : false)) {
      throw new ForbiddenError('AI proposals are raised by the assistant only');
    }
    if (existing?.approval_type === AI_PROPOSAL_TYPE) {
      incoming = { ...incoming, proposal: existing.proposal, execution: existing.execution, title: existing.title, description: existing.description };
    }
    checkApproverChoice(existing, incoming);
    if (!existing) {
      // The requester is whoever is signed in; a new request is always pending.
      return {
        ...incoming,
        approved_facts: undefined,
        requested_by_id: u.id,
        requested_by_name: u.name,
        requested_by_role: u.role,
        decision: 'Pending',
        decision_date: undefined,
        decision_by_id: undefined,
        decision_by_name: undefined,
        decision_by_role: undefined,
      };
    }
    const isRequester = existing.requested_by_id === u.id || u.role === 'Owner / CEO';
    for (const f of REQUEST_FIELDS) {
      if (changed(incoming[f], existing[f])) {
        if (!isRequester) throw new ForbiddenError(`Only the requester can change ${f}`);
        // A decided request stays bound to what was decided (Batch 12A): a new request is a new decision.
        if (FINAL.has(String(existing.decision))) throw new ForbiddenError(`This request was already ${String(existing.decision).toLowerCase()}; its ${f} cannot change`);
      }
    }
    // Who was asked and who decided can never come from the browser.
    const values: Row = { ...incoming, requested_by_id: existing.requested_by_id, requested_by_name: existing.requested_by_name, requested_by_role: existing.requested_by_role };
    if (incoming.decision !== existing.decision) return applyDecision(h, existing, values);
    for (const f of DECISION_FIELDS) values[f] = existing[f];
    return values;
  },
};
