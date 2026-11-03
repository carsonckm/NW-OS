import { describe, expect, it, vi } from 'vitest';
import { financialClaimHooks } from './hooks/claims';
import { paymentHooks } from './hooks/payments';
import type { HookContext } from './types';

const h = () => ({ mode: 'rest', db: { query: vi.fn(async () => ({ rows: [] })) } }) as unknown as HookContext;

describe('settlement evidence integrity', () => {
  it.each([0, -1, 'NaN', 'Infinity', undefined])('refuses invalid payment amount %s', async (amount) => {
    await expect(paymentHooks.beforeWrite!(h(), undefined, { amount })).rejects.toThrow(/finite positive/);
  });

  it('does not let a settlement rewrite the certified debt in the same request', async () => {
    const claim = { id: 'synthetic-claim', project_id: 'synthetic-project', claim_number: 'IPC-TEST', status: 'Certified', certified_amount: 1000, net_claim_amount: 1000 };
    await expect(financialClaimHooks.beforeWrite!(h(), claim, { ...claim, status: 'Paid', certified_amount: 1 })).rejects.toThrow(/without changing certified_amount/);
  });

  it('locks a paid claim against reopening and amount changes, while allowing a note', async () => {
    const claim = { id: 'synthetic-claim', project_id: 'synthetic-project', status: 'Paid', certified_amount: 1000 };
    for (const patch of [{ status: 'Draft' }, { certified_amount: 1 }, { project_id: 'other' }]) {
      await expect(financialClaimHooks.beforeWrite!(h(), claim, { ...claim, ...patch })).rejects.toThrow(/paid claim/);
    }
    await expect(financialClaimHooks.beforeWrite!(h(), claim, { ...claim, notes: 'Reviewed' })).resolves.toMatchObject({ notes: 'Reviewed' });
  });
});
