import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { AI_PROPOSAL_TYPE, executeProposal } from '../assistantActions';
import { authorityAudit, clientConsentAllowed, requireAuthority, type AuthorityResolution } from '../authorityResolver';
import type { HookContext, ModuleHooks, Row } from '../types';

const FINAL = new Set(['Approved', 'Rejected']);
// Fields only the requester (or an Owner) may change once a request exists.
const REQUEST_FIELDS = ['assigned_approver_role', 'assigned_approver_id', 'approval_type', 'related_entity_type', 'related_entity_id', 'project_id'];
const DECISION_FIELDS = ['decision', 'decision_date', 'decision_by_id', 'decision_by_name', 'decision_by_role', 'is_owner_override'];

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
    return { ...values, decision_date: undefined, decision_by_id: undefined, decision_by_name: undefined, decision_by_role: undefined };
  }
  const verdict = await evaluateDecision(h, existing, decision, values.project_id ? String(values.project_id) : undefined);
  const decided = {
    ...values,
    decision,
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
    after: { decision, comments: values.comments, override: verdict.isOverride, ...(verdict.authority ? { authority: authorityAudit(verdict.authority) } : { consent: 'client' }) },
  });
  return decided;
}

export const approvalHooks: ModuleHooks = {
  // AI proposal approved → the system executes it, as the approver, in this transaction.
  async afterWrite(h, existing, stored) {
    if (h.mode === 'import' || stored.approval_type !== AI_PROPOSAL_TYPE) return;
    if (stored.decision === 'Approved' && existing?.decision !== 'Approved') await executeProposal(h, stored);
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
    if (!existing) {
      // The requester is whoever is signed in; a new request is always pending.
      return {
        ...incoming,
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
      if (JSON.stringify(incoming[f]) !== JSON.stringify(existing[f]) && !isRequester) {
        throw new ForbiddenError(`Only the requester can change ${f}`);
      }
    }
    // Who was asked and who decided can never come from the browser.
    const values: Row = { ...incoming, requested_by_id: existing.requested_by_id, requested_by_name: existing.requested_by_name, requested_by_role: existing.requested_by_role };
    if (incoming.decision !== existing.decision) return applyDecision(h, existing, values);
    for (const f of DECISION_FIELDS) values[f] = existing[f];
    return values;
  },
};
