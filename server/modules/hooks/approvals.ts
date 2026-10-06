import type { ApprovalItem, UserProfile } from '../../../src/types';
import { canEvaluateApproval } from '../../../src/utils/permissions';
import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { AI_PROPOSAL_TYPE, executeProposal } from '../assistantActions';
import type { HookContext, ModuleHooks, Row } from '../types';

const FINAL = new Set(['Approved', 'Rejected']);
// Fields only the requester (or an Owner) may change once a request exists.
const REQUEST_FIELDS = ['assigned_approver_role', 'assigned_approver_id', 'approval_type', 'related_entity_type', 'related_entity_id', 'project_id'];
const DECISION_FIELDS = ['decision', 'decision_date', 'decision_by_id', 'decision_by_name', 'decision_by_role', 'is_owner_override'];

function profile(h: HookContext): UserProfile {
  const u = h.ctx.user;
  return { id: u.id, name: u.name, email: u.email, role: u.role, client_id: u.client_id ?? undefined, contractor_id: u.contractor_id ?? undefined };
}

/**
 * Who may decide, evaluated on the server against the stored request (never the browser's
 * copy): the existing canEvaluateApproval rules (owner override, client variations, no
 * self-approval, assignee/role match) plus a permission gate, so an open "Designated
 * Authorized Manager" request still needs approvals.decide.
 */
export function evaluateDecision(h: HookContext, stored: Row, decision: string) {
  const approval = stored as unknown as ApprovalItem;
  const verdict = canEvaluateApproval(profile(h), approval);
  const u = h.ctx.user;
  const clientVariation =
    u.role === 'Client' && (approval.approval_type === 'Variation' || approval.approval_type === 'Client Scope Change') && h.ctx.can('variations.client_approve');
  const gated =
    u.role === 'Owner / CEO' ||
    h.ctx.can('approvals.decide') ||
    clientVariation ||
    approval.assigned_approver_id === u.id ||
    approval.assigned_approver_role === u.role;
  const allowed =
    decision === 'Approved' ? verdict.canApprove : decision === 'Rejected' ? verdict.canReject : verdict.canRequestChanges;
  if (!gated || !allowed) {
    throw new ForbiddenError(verdict.blockedReason ?? `You may not ${decision === 'Approved' ? 'approve' : 'decide'} this request`);
  }
  return verdict;
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
  const verdict = evaluateDecision(h, existing, decision);
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
    after: { decision, comments: values.comments, override: verdict.isOverride },
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
