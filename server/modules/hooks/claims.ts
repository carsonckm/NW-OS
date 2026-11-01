import { ValidationError } from '../../core/repository';
import type { ModuleHooks } from '../types';

/**
 * Do not accept an unverified Paid state from any client, REST or sync.
 * Full settlement requires server-verified allocation of reconciled receipts.
 */
export const financialClaimHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    if (incoming.status === 'Paid' && existing?.status !== 'Paid') {
      throw new ValidationError('Claim cannot be marked Paid without verified cumulative receipt reconciliation');
    }
    return incoming;
  },
};
