import { ForbiddenError } from '../../auth/access';
import { ValidationError } from '../../core/repository';
import type { ModuleHooks } from '../types';

/** Reconciled receipts are accounting evidence, not editable allocation instructions. */
export const paymentHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    if (existing?.status === 'Reconciled') {
      const locked = ['project_id', 'type', 'amount', 'claim_id', 'status', 'reference_no', 'date', 'party_name', 'notes'];
      for (const field of locked) {
        if (JSON.stringify(existing[field] ?? null) !== JSON.stringify(incoming[field] ?? null)) {
          throw new ForbiddenError(`A reconciled payment's ${field} cannot be changed; record a correction separately`);
        }
      }
    }
    if (incoming.claim_id) {
      if (incoming.type !== 'Client Inflow') throw new ValidationError('Only client inflows may be allocated to claims');
      const claim = (await h.db.query('SELECT id, project_id FROM financial_claims WHERE id = $1', [String(incoming.claim_id)])).rows[0];
      if (!claim || String(claim.project_id) !== String(incoming.project_id)) {
        throw new ValidationError('Payment claim must exist in the same project');
      }
    }
    return incoming;
  },
};
