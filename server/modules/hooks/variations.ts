import type { PermissionKey } from '../../../src/types';
import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { HookContext, ModuleHooks, Row } from '../types';
import { authorityAudit, requireAuthority, type AuthorityResolution } from '../authorityResolver';

/**
 * Identified -> Costing -> Internal Approval -> Client Approval -> Approved -> Implemented -> Closed,
 * with Rejected possible before approval. Only Approved (and later) variations count towards
 * the approved contract value; amounts are frozen once approved.
 */
export const VARIATION_FLOW = ['Identified', 'Costing', 'Internal Approval', 'Client Approval', 'Approved', 'Implemented', 'Closed'];
export const APPROVED_STATES = new Set(['Approved', 'Implemented', 'Closed']);
const PRE_APPROVAL = new Set(['Identified', 'Costing', 'Internal Approval', 'Client Approval']);
const MONEY = ['estimated_cost', 'client_amount'];

/**
 * Permission needed to move a variation into each state (from the state before it). Internal
 * approval (-> Client Approval) and an internal rejection are variation decisions: the
 * authority resolver decides who may take them (see variationDecision).
 */
const GATE: Record<string, PermissionKey[]> = {
  Costing: ['variations.create'],
  'Internal Approval': ['variations.create'],
  Approved: ['variations.client_approve'], // client accepts
  Implemented: ['variations.approve', 'variations.create'],
  Closed: ['variations.approve'],
};

export function checkTransition(h: HookContext, from: string, to: string) {
  if (from === to) return;
  if (to === 'Rejected') {
    if (!PRE_APPROVAL.has(from)) throw new ForbiddenError(`A ${from} variation cannot be rejected`);
    // The client declining at the client stage is the client's consent; otherwise the resolver decides.
    return;
  }
  const i = VARIATION_FLOW.indexOf(from);
  const j = VARIATION_FLOW.indexOf(to);
  if (i < 0 || j < 0) throw new ValidationError(`Unknown variation transition ${from} -> ${to}`);
  if (j < i) throw new ForbiddenError(`A variation cannot move back from ${from} to ${to}`);
  // Early stages may be skipped; approval stages may not.
  const skippable = new Set(['Costing']);
  for (const step of VARIATION_FLOW.slice(i + 1, j)) {
    if (!skippable.has(step)) throw new ForbiddenError(`A variation must pass ${step} before ${to}`);
  }
  const needed = GATE[to] ?? [];
  // Client Approval (internal approval) has no permission gate here: the authority resolver decides.
  if (to !== 'Client Approval' && !needed.some((p) => h.ctx.can(p))) throw new ForbiddenError(`Missing permission to move a variation to ${to}: ${needed.join(' or ')}`);
}

/** The client (or the Owner recording it) declining at the client stage: client consent, not internal authority. */
const clientDeclines = (h: HookContext, from: string, to: string) => to === 'Rejected' && from === 'Client Approval' && h.ctx.can('variations.client_approve');

/** Internal approval and internal rejection go through the authority resolver. */
async function variationDecision(h: HookContext, existing: Row, incoming: Row, from: string, to: string): Promise<AuthorityResolution | undefined> {
  if (from === to) return undefined;
  // The amount and project being approved are the ones this write stores.
  const pending = { value: Number(incoming.client_amount ?? existing.client_amount), projectId: String(incoming.project_id ?? existing.project_id) };
  if (to === 'Client Approval') return requireAuthority(h.db, h.ctx, { resource: { kind: 'variation', id: String(existing.id) }, action: 'approve', pending });
  if (to === 'Rejected' && !clientDeclines(h, from, to)) {
    return requireAuthority(h.db, h.ctx, { resource: { kind: 'variation', id: String(existing.id) }, action: 'reject', pending }, (r) => `Missing authority to reject this variation: ${r.reason}`);
  }
  return undefined;
}

type HistoryEntry = { from?: string; to: string; by_id: string; by_name: string; role: string; at: string; note?: string; reference?: string };

const SERVER_FIELDS = [
  'created_by_id', 'created_by_name', 'history', 'approved_at',
  'internal_approved_by_id', 'internal_approved_by_name', 'internal_approved_at',
  'client_approved_by_id', 'client_approved_by_name', 'client_approved_at',
];

/**
 * Who may take the two approval steps:
 * - Internal approval (Internal Approval -> Client Approval): variations.approve, and never
 *   the person who raised the variation.
 * - Client approval (Client Approval -> Approved): the client (a Client user of the project),
 *   or staff recording the client's signed approval (a reference is required) who did not
 *   give the internal approval. The two approvals are always separate people.
 */
function checkApprovers(h: HookContext, existing: Row, to: string, incoming: Row) {
  const me = h.ctx.user;
  if (to === 'Client Approval' && existing.created_by_id === me.id) {
    throw new ForbiddenError('You cannot internally approve a variation you raised');
  }
  if (to === 'Approved') {
    if (me.role !== 'Client') {
      if (!String(incoming.client_approval_reference ?? '').trim()) {
        throw new ValidationError("Record the client's approval reference (signed VO / letter) when approving on the client's behalf");
      }
      if (existing.internal_approved_by_id === me.id) {
        throw new ForbiddenError('Client approval must be recorded by someone other than the internal approver');
      }
    }
  }
}

export const variationHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    const to = String(incoming.status);
    const me = h.ctx.user;
    const now = new Date().toISOString();
    const entry = (from: string | undefined, note?: string, reference?: string): HistoryEntry => ({
      ...(from ? { from } : {}), to, by_id: me.id, by_name: me.name, role: me.role, at: now,
      ...(note ? { note } : {}), ...(reference ? { reference } : {}),
    });
    if (!existing) {
      if (!['Identified', 'Costing', 'Internal Approval'].includes(to)) {
        throw new ForbiddenError('A new variation starts at Identified, Costing or Internal Approval; it cannot be created approved');
      }
      const created: Row = { ...incoming, created_by_id: me.id, created_by_name: me.name, created_at: incoming.created_at || now };
      for (const f of SERVER_FIELDS.slice(2)) delete created[f];
      created.history = [entry(undefined, 'Raised')];
      return created;
    }
    // Server-kept fields never come from the browser.
    const values: Row = { ...incoming };
    for (const f of SERVER_FIELDS) values[f] = existing[f];
    const from = String(existing.status);
    if (APPROVED_STATES.has(from) || from === 'Rejected') {
      for (const f of MONEY) {
        if (Number(incoming[f]) !== Number(existing[f])) throw new ForbiddenError(`Amounts of a ${from} variation cannot change`);
      }
    }
    checkTransition(h, from, to);
    if (from === to) return values;
    checkApprovers(h, existing, to, incoming);
    const authority = await variationDecision(h, existing, incoming, from, to);
    const note = typeof incoming.transition_note === 'string' ? incoming.transition_note : undefined;
    const reference = typeof incoming.client_approval_reference === 'string' ? incoming.client_approval_reference : undefined;
    delete values.transition_note;
    values.history = [...((existing.history as HistoryEntry[]) ?? []), entry(from, note, to === 'Approved' ? reference : undefined)];
    if (to === 'Client Approval') Object.assign(values, { internal_approved_by_id: me.id, internal_approved_by_name: me.name, internal_approved_at: now });
    if (to === 'Approved') Object.assign(values, { approved_at: now, client_approved_by_id: me.id, client_approved_by_name: me.name, client_approved_at: now });
    if (to === 'Rejected') values.rejection_reason = note ?? incoming.rejection_reason;
    await writeAudit(h.db, h.actor, {
      action: 'variation.transition',
      entityType: 'variation',
      entityId: existing.id as string,
      projectId: existing.project_id as string,
      before: { status: from },
      after: { status: to, client_amount: incoming.client_amount, ...(note ? { note } : {}), ...(reference ? { reference } : {}), ...(authority ? { authority: authorityAudit(authority) } : {}) },
    });
    return values;
  },
};
