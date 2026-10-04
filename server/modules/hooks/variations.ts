import type { PermissionKey } from '../../../src/types';
import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { HookContext, ModuleHooks, Row } from '../types';

/**
 * Identified -> Costing -> Internal Approval -> Client Approval -> Approved -> Implemented -> Closed,
 * with Rejected possible before approval. Only Approved (and later) variations count towards
 * the approved contract value; amounts are frozen once approved.
 */
export const VARIATION_FLOW = ['Identified', 'Costing', 'Internal Approval', 'Client Approval', 'Approved', 'Implemented', 'Closed'];
export const APPROVED_STATES = new Set(['Approved', 'Implemented', 'Closed']);
const PRE_APPROVAL = new Set(['Identified', 'Costing', 'Internal Approval', 'Client Approval']);
const MONEY = ['estimated_cost', 'client_amount'];

/** Permission needed to move a variation into each state (from the state before it). */
const GATE: Record<string, PermissionKey[]> = {
  Costing: ['variations.create'],
  'Internal Approval': ['variations.create'],
  'Client Approval': ['variations.approve'], // internal approval granted
  Approved: ['variations.client_approve'], // client accepts
  Implemented: ['variations.approve', 'variations.create'],
  Closed: ['variations.approve'],
};

export function checkTransition(h: HookContext, from: string, to: string) {
  if (from === to) return;
  if (to === 'Rejected') {
    if (!PRE_APPROVAL.has(from)) throw new ForbiddenError(`A ${from} variation cannot be rejected`);
    const clientAtClientStage = from === 'Client Approval' && h.ctx.can('variations.client_approve');
    if (!h.ctx.can('variations.approve') && !clientAtClientStage) throw new ForbiddenError('Missing permission to reject this variation');
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
  if (!needed.some((p) => h.ctx.can(p))) throw new ForbiddenError(`Missing permission to move a variation to ${to}: ${needed.join(' or ')}`);
}

export const variationHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    const to = String(incoming.status);
    if (!existing) {
      if (!['Identified', 'Costing', 'Internal Approval'].includes(to)) {
        throw new ForbiddenError('A new variation starts at Identified, Costing or Internal Approval; it cannot be created approved');
      }
      return incoming;
    }
    const from = String(existing.status);
    if (APPROVED_STATES.has(from) || from === 'Rejected') {
      for (const f of MONEY) {
        if (Number(incoming[f]) !== Number(existing[f])) throw new ForbiddenError(`Amounts of a ${from} variation cannot change`);
      }
    }
    checkTransition(h, from, to);
    if (from === to) return incoming;
    const values = { ...incoming, ...(to === 'Approved' ? { approved_at: new Date().toISOString() } : {}) };
    await writeAudit(h.db, h.actor, {
      action: 'variation.transition',
      entityType: 'variation',
      entityId: existing.id as string,
      projectId: existing.project_id as string,
      before: { status: from },
      after: { status: to, client_amount: incoming.client_amount },
    });
    return values;
  },
};
