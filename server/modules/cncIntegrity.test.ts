import { describe, expect, it } from 'vitest';
import { cncFileVersionHooks } from './hooks/cnc';
import type { HookContext } from './types';

const h = { mode: 'rest' } as HookContext;
describe('CNC references never fabricate manufacturing approval', () => {
  it('refuses a new approved reference and strips invented metrics from a draft', async () => {
    const input = { id: 'synthetic', file_name: 'reference.nc', revision: 'A', part_code: 'PART-TEST', status: 'Approved', approved_by: 'Invented', toolpath_count: 8, estimated_run_time_min: 40 };
    await expect(cncFileVersionHooks.beforeWrite!(h, undefined, input)).rejects.toThrow(/start as Draft/);
    await expect(cncFileVersionHooks.beforeWrite!(h, undefined, { ...input, status: 'Draft' })).resolves.toMatchObject({ status: 'Draft', approved_by: '', toolpath_count: 0, estimated_run_time_min: 0 });
  });
  it('preserves old evidence instead of rewriting an approved version', async () => {
    const old = { id: 'synthetic', file_name: 'old.nc', status: 'Approved', approved_by: 'Recorded reviewer' };
    await expect(cncFileVersionHooks.beforeWrite!(h, old, { ...old, approved_by: 'New reviewer' })).rejects.toThrow(/immutable/);
    await expect(cncFileVersionHooks.beforeWrite!(h, old, { ...old, status: 'Superseded' })).resolves.toMatchObject({ approved_by: 'Recorded reviewer' });
  });
});
