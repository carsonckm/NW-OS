import { createHash } from 'crypto';
import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { Pool, PoolClient } from '../../db/pool';
import type { HookContext, ModuleHooks, Row } from '../types';

type Db = Pool | PoolClient;

// What makes a revision what it is. These never change after upload; status, markups and
// review notes may.
const CLIENT_IMMUTABLE = ['revision', 'title', 'file_url', 'uploaded_date', 'uploaded_by', 'drawing_type', 'notes', 'supersedes_revision'];
const NW_IMMUTABLE = [
  'drawing_number', 'revision', 'title', 'linked_client_drawing_id', 'linked_client_revision', 'revised_dimensions',
  'construction_details', 'material_details', 'hardware_details', 'joining_method', 'assembly_instructions',
  'installation_instructions', 'production_notes', 'file_url', 'uploaded_by', 'uploaded_date',
];

const blank = (v: unknown) => (v === undefined || v === null ? '' : v);

export function contentHash(fields: string[], rev: Row) {
  const json = JSON.stringify(fields.map((f) => [f, blank(rev[f])]));
  return createHash('sha256').update(json).digest('hex');
}

interface RevisionRow {
  id: string;
  drawing_id: string;
  kind: 'client' | 'nw_production';
  revision: string;
  approval_status: string;
  is_current: boolean;
  approved_for_production: boolean;
  linked_client_revision_id: string | null;
  content_hash: string;
  superseded_at: string | null;
  data: Row;
  created_at: string;
}

export async function revisionsFor(db: Db, drawingIds: string[]): Promise<RevisionRow[]> {
  if (!drawingIds.length) return [];
  const res = await db.query(
    `SELECT id, drawing_id, kind, revision, approval_status, is_current, approved_for_production, linked_client_revision_id,
            content_hash, superseded_at, data, created_at
     FROM drawing_revisions WHERE drawing_id = ANY($1) ORDER BY created_at, id`,
    [drawingIds]
  );
  return res.rows;
}

/** Client revision for a drawing by label ("Rev 3" or "A-103 Rev 3"). */
export async function findClientRevision(db: Db, drawingId: unknown, label: unknown): Promise<RevisionRow | undefined> {
  if (typeof drawingId !== 'string' || typeof label !== 'string' || !label.trim()) return undefined;
  const res = await db.query(
    `SELECT * FROM drawing_revisions
     WHERE drawing_id = $1 AND kind = 'client' AND ($2 = revision OR $2 LIKE '% ' || revision)
     ORDER BY created_at DESC LIMIT 1`,
    [drawingId, label.trim()]
  );
  return res.rows[0];
}

export async function findRevisionById(db: Db, id: unknown): Promise<RevisionRow | undefined> {
  if (typeof id !== 'string' || !id) return undefined;
  return (await db.query('SELECT * FROM drawing_revisions WHERE id = $1', [id])).rows[0];
}

function statusOfClient(rev: Row) {
  return String(rev.approved_status ?? 'Pending Review');
}
function statusOfNw(rev: Row) {
  return String(rev.status ?? 'Draft');
}

/**
 * A client revision's "Approved" status records the issue the client/designer released, so
 * whoever may upload client drawings may record it. Approving an NW production drawing
 * (what releases work to production) needs drawings.approve.
 */
const approvePermission = (isClient: boolean) => (isClient ? 'drawings.upload' : 'drawings.approve');
const canApprove = (h: HookContext, isClient: boolean) =>
  h.ctx.can('drawings.approve') || (isClient && h.ctx.can('drawings.upload'));

async function upsertRevision(h: HookContext, drawingId: string, kind: 'client' | 'nw_production', rev: Row) {
  if (typeof rev.id !== 'string' || !rev.id) throw new ValidationError('Drawing revision needs an id');
  const isClient = kind === 'client';
  const hash = contentHash(isClient ? CLIENT_IMMUTABLE : NW_IMMUTABLE, rev);
  const status = isClient ? statusOfClient(rev) : statusOfNw(rev);
  const approvedForProduction = isClient ? false : Boolean(rev.approved_for_production);
  const isCurrent = isClient ? Boolean(rev.is_current) : status !== 'Superseded';
  const existing = (await h.db.query('SELECT * FROM drawing_revisions WHERE id = $1 FOR UPDATE', [rev.id])).rows[0] as RevisionRow | undefined;
  const importing = h.mode === 'import';

  if (!existing) {
    if (!importing) {
      if (isClient && !h.ctx.can('drawings.upload')) throw new ForbiddenError('Missing permission: drawings.upload');
      if (!isClient && !h.ctx.can('drawings.create_production')) throw new ForbiddenError('Missing permission: drawings.create_production');
      if ((status === 'Approved' || approvedForProduction) && !canApprove(h, isClient)) {
        throw new ForbiddenError(`A new revision cannot be uploaded as approved without ${approvePermission(isClient)}`);
      }
    }
    let linked: string | null = null;
    if (!isClient) linked = (await findClientRevision(h.db, rev.linked_client_drawing_id, rev.linked_client_revision))?.id ?? null;
    await h.db.query(
      `INSERT INTO drawing_revisions (id, drawing_id, kind, revision, approval_status, is_current, approved_for_production,
         linked_client_revision_id, file_url, content_hash, superseded_at, data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        rev.id, drawingId, kind, String(rev.revision ?? ''), status, isCurrent, approvedForProduction, linked,
        (rev.file_url as string) ?? null, hash, status === 'Superseded' ? new Date().toISOString() : null,
        JSON.stringify(rev), h.actor.id ?? null,
      ]
    );
    if (!importing) {
      await writeAudit(h.db, h.actor, {
        action: 'drawing.revision.create',
        entityType: kind === 'client' ? 'drawing_revision' : 'nw_production_drawing',
        entityId: rev.id,
        details: `${drawingId} ${String(rev.revision)} (${status})`,
        after: rev,
      });
    }
    return;
  }

  if (existing.drawing_id !== drawingId || existing.kind !== kind) {
    throw new ValidationError(`Revision ${rev.id} belongs to another drawing`);
  }
  if (existing.content_hash !== hash) {
    throw new ForbiddenError(`Drawing revision ${rev.id} is immutable; upload a new revision instead of changing it`);
  }
  const approving =
    (status === 'Approved' && existing.approval_status !== 'Approved') || (approvedForProduction && !existing.approved_for_production);
  if (approving && !importing && !canApprove(h, isClient)) throw new ForbiddenError(`Missing permission: ${approvePermission(isClient)}`);
  if (existing.approval_status === 'Superseded' && status !== 'Superseded') {
    throw new ForbiddenError(`Revision ${rev.id} is superseded and cannot be reinstated`);
  }
  const changed =
    existing.approval_status !== status || existing.is_current !== isCurrent || existing.approved_for_production !== approvedForProduction ||
    JSON.stringify(existing.data) !== JSON.stringify(rev);
  if (!changed) return;
  await h.db.query(
    `UPDATE drawing_revisions SET approval_status = $2, is_current = $3, approved_for_production = $4, data = $5,
       superseded_at = CASE WHEN $2 = 'Superseded' THEN coalesce(superseded_at, now()) ELSE NULL END, updated_at = now()
     WHERE id = $1`,
    [rev.id, status, isCurrent, approvedForProduction, JSON.stringify(rev)]
  );
  if (existing.approval_status !== status || existing.approved_for_production !== approvedForProduction) {
    await writeAudit(h.db, h.actor, {
      action: approving ? 'drawing.revision.approve' : status === 'Superseded' ? 'drawing.revision.supersede' : 'drawing.revision.status',
      entityType: kind === 'client' ? 'drawing_revision' : 'nw_production_drawing',
      entityId: rev.id,
      before: { status: existing.approval_status, approved_for_production: existing.approved_for_production },
      after: { status, approved_for_production: approvedForProduction },
    });
  }
}

/**
 * Keeps one current client revision per drawing: the newest current one wins and every
 * older approved or pending revision becomes Superseded (never deleted).
 */
async function enforceSupersede(h: HookContext, drawingId: string) {
  const revs = (await h.db.query(
    `SELECT id, approval_status, is_current FROM drawing_revisions
     WHERE drawing_id = $1 AND kind = 'client' ORDER BY created_at DESC, id DESC`,
    [drawingId]
  )).rows as { id: string; approval_status: string; is_current: boolean }[];
  const current = revs.find((r) => r.is_current);
  if (!current) return;
  for (const r of revs) {
    if (r.id === current.id) continue;
    if (r.is_current || r.approval_status !== 'Superseded') {
      if (r.approval_status === 'Rejected') {
        if (r.is_current) await h.db.query('UPDATE drawing_revisions SET is_current = false, updated_at = now() WHERE id = $1', [r.id]);
        continue;
      }
      await h.db.query(
        `UPDATE drawing_revisions SET is_current = false, approval_status = 'Superseded',
           superseded_at = coalesce(superseded_at, now()), updated_at = now(),
           data = jsonb_set(jsonb_set(data, '{is_current}', 'false'), '{approved_status}', '"Superseded"')
         WHERE id = $1`,
        [r.id]
      );
      if (h.mode !== 'import') {
        await writeAudit(h.db, h.actor, {
          action: 'drawing.revision.supersede',
          entityType: 'drawing_revision',
          entityId: r.id,
          details: `superseded by ${current.id}`,
        });
      }
    }
  }
  await h.db.query('UPDATE drawings SET current_revision_id = $2 WHERE id = $1', [drawingId, current.id]);
}

export const drawingHooks: ModuleHooks = {
  serialize: (record) => {
    const { revisions: _r, nw_production_drawings: _n, ...rest } = record;
    return rest;
  },

  async hydrate(db, records) {
    const revs = await revisionsFor(db, records.map((r) => r.id as string));
    return records.map((d) => {
      const mine = revs.filter((r) => r.drawing_id === d.id);
      const current = mine.find((r) => r.kind === 'client' && r.is_current);
      return {
        ...d,
        ...(current ? { current_revision_id: current.id } : {}),
        revisions: mine
          .filter((r) => r.kind === 'client')
          .map((r) => ({ ...r.data, approved_status: r.approval_status, is_current: r.is_current })),
        nw_production_drawings: mine
          .filter((r) => r.kind === 'nw_production')
          .map((r) => ({ ...r.data, status: r.approval_status, approved_for_production: r.approved_for_production })),
      };
    });
  },

  async afterWrite(h, _existing, stored) {
    const drawingId = stored.id as string;
    const revisions = Array.isArray(stored.revisions) ? (stored.revisions as Row[]) : [];
    const nw = Array.isArray(stored.nw_production_drawings) ? (stored.nw_production_drawings as Row[]) : [];
    for (const rev of revisions) await upsertRevision(h, drawingId, 'client', rev);
    for (const rev of nw) await upsertRevision(h, drawingId, 'nw_production', rev);
    await enforceSupersede(h, drawingId);
  },
};

/** New client revision through the API: becomes current, previous current is superseded. */
export async function addClientRevision(h: HookContext, drawingId: string, rev: Row) {
  if (!h.ctx.can('drawings.upload')) throw new ForbiddenError('Missing permission: drawings.upload');
  await upsertRevision(h, drawingId, 'client', { ...rev, is_current: true });
  await enforceSupersede(h, drawingId);
}
