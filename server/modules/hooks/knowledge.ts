import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import type { ModuleHooks, Row } from '../types';

const PROPOSAL_STATES = new Set(['Draft', 'Review']);

/**
 * Knowledge base articles. Anyone who may propose (knowledge.edit or
 * production.propose_methods) writes Drafts and sends them for Review; only knowledge.edit
 * publishes (Approved) or archives, and not an article they wrote themselves unless they are
 * the Owner. AI-suggested content is always created as a Draft. Published articles can only
 * be archived, not rewritten.
 */
export const knowledgeHooks: ModuleHooks = {
  async beforeWrite(h, existing, incoming) {
    if (h.mode === 'import') return incoming;
    const to = String(incoming.status ?? 'Draft');
    const editor = h.ctx.can('knowledge.edit');
    const values: Row = { ...incoming, status: to };
    if (!existing) {
      if (!PROPOSAL_STATES.has(to)) throw new ForbiddenError('A knowledge article is written as a Draft or sent for Review; it is approved afterwards');
      values.created_by = h.ctx.user.name;
      values.created_by_id = h.ctx.user.id;
      values.approved_by = undefined;
      return values;
    }
    const from = String(existing.status);
    if (from === 'Archived' && to !== 'Archived') throw new ForbiddenError('An archived article cannot be reinstated; write a new one');
    // Who wrote it and who approved it are the server's record.
    values.created_by = existing.created_by;
    values.created_by_id = existing.created_by_id;
    values.approved_by = existing.approved_by;
    values.approved_by_id = existing.approved_by_id;
    values.approved_at = existing.approved_at;
    if (from === 'Approved') {
      const changed = Object.keys(values).filter((k) => !['status', 'updated_at'].includes(k) && JSON.stringify(values[k]) !== JSON.stringify(existing[k]));
      if (changed.length) throw new ForbiddenError('A published article cannot be rewritten; archive it and write a new one');
    }
    if ((to === 'Approved' || to === 'Archived') && from !== to) {
      if (!editor) throw new ForbiddenError('Missing permission: knowledge.edit (publish or archive knowledge)');
      if (to === 'Approved') {
        const author = existing.created_by_id;
        if (author && author === h.ctx.user.id && h.ctx.user.role !== 'Owner / CEO') {
          throw new ForbiddenError('You cannot approve an article you wrote; another approver must');
        }
        values.approved_by = h.ctx.user.name;
        values.approved_by_id = h.ctx.user.id;
        values.approved_at = new Date().toISOString();
      }
    } else if (!editor && existing.created_by_id && existing.created_by_id !== h.ctx.user.id) {
      throw new ForbiddenError('Only the author or a knowledge editor can change this article');
    }
    return values;
  },
  async afterWrite(h, existing, stored) {
    if (h.mode === 'import' || existing?.status === stored.status) return;
    await writeAudit(h.db, h.actor, {
      action: `knowledge.${String(stored.status).toLowerCase()}`,
      entityType: 'knowledge',
      entityId: String(stored.id),
      before: existing ? { status: existing.status } : null,
      after: { status: stored.status, approved_by: stored.approved_by ?? null },
    });
  },
};
