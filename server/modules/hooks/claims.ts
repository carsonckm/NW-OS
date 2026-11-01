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
      if (!existing || existing.status !== 'Certified') throw new ValidationError('Claim must be Certified');
      const due = Number(existing.certified_amount ?? existing.net_claim_amount);
      const claim = String(existing.claim_number ?? '');
      const receipts = await h.db.query(
        "SELECT data FROM payments WHERE project_id = $1 AND status = 'Reconciled' AND data->>'type' = 'Client Inflow'",
        [String(existing.project_id)],
      );
      const paid = receipts.rows.reduce((sum: number, r: { data: Record<string, unknown> }) => {
        const note = String(r.data.notes ?? '');
        return sum + (note === claim || note === 'For claim ' + claim ? Number(r.data.amount) || 0 : 0);
      }, 0);
      if (!Number.isFinite(due) || due <= 0 || !claim || Math.round(paid * 100) < Math.round(due * 100)) {
        throw new ValidationError('Insufficient reconciled client receipts linked to claim');
      }
    }
    return incoming;
  },
};
