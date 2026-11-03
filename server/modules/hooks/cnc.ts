import { ForbiddenError } from '../../auth/access';
import { ValidationError } from '../../core/repository';
import type { ModuleHooks } from '../types';

/** References are not uploaded machine programs or evidence of manufacturing approval. */
export const cncFileVersionHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    if (!existing) {
      if (incoming.status !== 'Draft') throw new ForbiddenError('New CNC references start as Draft; verified program approval is not available');
      if (!String(incoming.file_name ?? '').trim() || !String(incoming.part_code ?? '').trim()) throw new ValidationError('Enter the program reference and part code');
      return { ...incoming, approved_by: '', associated_drawing_revision: '', toolpath_count: 0, estimated_run_time_min: 0 };
    }
    if (incoming.status === 'Approved' && existing.status !== 'Approved') throw new ForbiddenError('Verified CNC program approval is not available');
    for (const key of ['file_name', 'revision', 'part_code', 'approved_by', 'associated_drawing_revision', 'toolpath_count', 'estimated_run_time_min']) {
      if (JSON.stringify(existing[key] ?? null) !== JSON.stringify(incoming[key] ?? null)) throw new ForbiddenError('CNC reference versions are immutable; register a new draft');
    }
    return incoming;
  },
};
