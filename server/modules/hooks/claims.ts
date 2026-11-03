import { ForbiddenError } from '../../auth/access';
import { ValidationError } from '../../core/repository';
import type { ModuleHooks } from '../types';

/**
 * Do not accept an unverified Paid state from any client, REST or sync.
 * Full settlement requires server-verified allocation of reconciled receipts.
 */
export const financialClaimHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    if (existing?.status === 'Paid') {
      for (const field of ['status', 'project_id', 'claim_number', 'cumulative_claimed', 'retention_amount', 'net_claim_amount', 'certified_amount']) {
        if (JSON.stringify(existing[field] ?? null) !== JSON.stringify(incoming[field] ?? null)) {
          throw new ForbiddenError(`A paid claim's ${field} cannot change; record a correction separately`);
        }
      }
    }
    if (incoming.status === 'Paid' && existing?.status === 'Certified') {
      for (const field of ['project_id', 'claim_number', 'net_claim_amount', 'certified_amount']) {
        if (JSON.stringify(existing[field] ?? null) !== JSON.stringify(incoming[field] ?? null)) {
          throw new ValidationError(`Settle the certified claim without changing ${field}`);
        }
      }
    }
    if (incoming.status === 'Paid' && existing?.status !== 'Paid') {
      if (!existing || existing.status !== 'Certified') throw new ValidationError('Claim must be Certified');
      const due = Number(existing.certified_amount ?? existing.net_claim_amount);
      const claim = String(existing.claim_number ?? '');
      const duplicateClaims = await h.db.query(
        "SELECT id FROM financial_claims WHERE project_id = $1 AND data->>'claim_number' = $2 AND id <> $3",
        [String(existing.project_id), claim, String(existing.id)],
      );
      if (duplicateClaims.rows.length) throw new ValidationError('Claim number is ambiguous; payment allocation requires a unique claim ID');
      const receipts = await h.db.query(
        "SELECT data FROM payments WHERE project_id = $1 AND status = 'Reconciled' AND data->>'type' = 'Client Inflow'",
        [String(existing.project_id)],
      );
      const paid = receipts.rows.reduce((sum: number, r: { data: Record<string, unknown> }) => {
        const note = String(r.data.notes ?? '');
        const allocatedId = String(r.data.claim_id ?? '');
        const linked = allocatedId ? allocatedId === String(existing.id) : (note === claim || note === 'For claim ' + claim);
        return sum + (linked ? Number(r.data.amount) || 0 : 0);
      }, 0);
      if (!Number.isFinite(due) || due <= 0 || !claim || Math.round(paid * 100) < Math.round(due * 100)) {
        throw new ValidationError('Insufficient reconciled client receipts linked to claim');
      }
    }
    return incoming;
  },
};
