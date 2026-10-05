import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { HookContext, ModuleHooks, Row } from '../types';

const PROPOSAL_STATES = new Set(['Draft', 'Review']);
/** Phase 5 categories (older articles keep their original category). */
export const KNOWLEDGE_CATEGORIES = ['Production', 'Installation', 'Materials', 'Hardware', 'Drawings', 'QC', 'Site Problems', 'Suppliers', 'Contractors', 'Commercial', 'Lessons Learned'];
const TEXT_FIELDS = ['problem', 'solution', 'procedure', 'project_type'];

/** Cleans the structured fields: tags (lower-case, unique, max 12) and text limits. */
function normalise(values: Row) {
  if (values.tags !== undefined) {
    if (!Array.isArray(values.tags)) throw new ValidationError('tags must be a list');
    values.tags = [...new Set((values.tags as unknown[]).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 12);
  }
  for (const f of TEXT_FIELDS) if (values[f] !== undefined && typeof values[f] !== 'string') throw new ValidationError(`${f} must be text`);
  if (values.photos !== undefined && !Array.isArray(values.photos)) throw new ValidationError('photos must be a list');
}

/** A new revision of a published article: numbered by the server, one open revision at a time. */
async function checkRevision(h: HookContext, values: Row) {
  const prev = (await h.db.query('SELECT id, status, revision, category FROM knowledge_articles WHERE id = $1', [values.supersedes_id])).rows[0];
  if (!prev || prev.status !== 'Approved') throw new ValidationError('A revision must supersede a published article');
  const open = await h.db.query(`SELECT id FROM knowledge_articles WHERE supersedes_id = $1 AND status IN ('Draft', 'Review') AND id <> $2`, [prev.id, values.id]);
  if (open.rowCount) throw new ValidationError(`Revision ${String(open.rows[0].id)} of this article is already in progress`);
  values.revision = Number(prev.revision) + 1;
}

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
    // Usage figures are computed on read (knowledge_usage), never stored on the article.
    delete values.usage_count;
    delete values.last_used_at;
    normalise(values);
    if (!existing || values.category !== existing.category) {
      if (!KNOWLEDGE_CATEGORIES.includes(String(values.category))) throw new ValidationError(`category must be one of: ${KNOWLEDGE_CATEGORIES.join(', ')}`);
    }
    if (!existing) {
      if (!PROPOSAL_STATES.has(to)) throw new ForbiddenError('A knowledge article is written as a Draft or sent for Review; it is approved afterwards');
      if (to === 'Review' && !(values.problem || values.description)) throw new ValidationError('Describe the problem (or the standard) before review');
      if (values.supersedes_id) await checkRevision(h, values);
      else values.revision = 1;
      values.created_by = h.ctx.user.name;
      values.created_by_id = h.ctx.user.id;
      values.approved_by = undefined;
      return values;
    }
    const from = String(existing.status);
    if (from === 'Archived' && to !== 'Archived') throw new ForbiddenError('An archived article cannot be reinstated; write a new one');
    // Who wrote it, who approved it and its revision chain are the server's record.
    values.revision = existing.revision ?? 1;
    values.supersedes_id = existing.supersedes_id;
    values.superseded_by = existing.superseded_by;
    values.created_by = existing.created_by;
    values.created_by_id = existing.created_by_id;
    values.approved_by = existing.approved_by;
    values.approved_by_id = existing.approved_by_id;
    values.approved_at = existing.approved_at;
    if (from === 'Approved') {
      const changed = Object.keys(values).filter((k) => !['status', 'updated_at', 'usage_count', 'last_used_at'].includes(k) && JSON.stringify(values[k]) !== JSON.stringify(existing[k]));
      if (changed.length) throw new ForbiddenError('A published article cannot be rewritten; write a new revision of it');
    }
    if ((to === 'Review' || to === 'Approved') && from !== to && !(values.problem || values.description) ) {
      throw new ValidationError('Describe the problem (or the standard) before review');
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
  async hydrate(db, records) {
    if (!records.length) return records;
    const counts = new Map(
      (await db.query('SELECT article_id, count(*)::int AS n, max(used_at) AS last FROM knowledge_usage WHERE article_id = ANY($1) GROUP BY article_id', [records.map((r) => r.id)])).rows.map((r) => [r.article_id, r])
    );
    return records.map((r) => ({ ...r, usage_count: counts.get(r.id)?.n ?? 0, last_used_at: counts.get(r.id)?.last ?? undefined }));
  },
  async afterWrite(h, existing, stored) {
    if (h.mode === 'import' || existing?.status === stored.status) return;
    // Publishing a revision archives the one it supersedes.
    if (stored.status === 'Approved' && stored.supersedes_id) {
      const prev = await h.db.query(
        `UPDATE knowledge_articles SET status = 'Archived', data = data || jsonb_build_object('status', 'Archived', 'superseded_by', $2::text), updated_at = now()
         WHERE id = $1 AND status = 'Approved' RETURNING id`,
        [stored.supersedes_id, stored.id]
      );
      if (prev.rowCount) {
        await writeAudit(h.db, h.actor, { action: 'knowledge.superseded', entityType: 'knowledge', entityId: String(stored.supersedes_id), before: { status: 'Approved' }, after: { status: 'Archived', superseded_by: stored.id } });
      }
    }
    await writeAudit(h.db, h.actor, {
      action: `knowledge.${String(stored.status).toLowerCase()}`,
      entityType: 'knowledge',
      entityId: String(stored.id),
      before: existing ? { status: existing.status } : null,
      after: { status: stored.status, approved_by: stored.approved_by ?? null },
    });
  },
};
