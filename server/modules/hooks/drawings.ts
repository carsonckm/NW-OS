import { createHash } from 'crypto';
import { ForbiddenError } from '../../auth/access';
import { writeAudit } from '../../audit';
import { ValidationError } from '../../core/repository';
import type { Pool, PoolClient } from '../../db/pool';
import type { PermissionKey } from '../../../src/types';
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

// Who moved a revision through review, and when. Set by the server only; anything the
// browser sends for these is ignored and the stored values are kept.
const REVIEW_STAMPS = [
  'uploaded_by_id', 'review_requested_by', 'review_requested_at', 'approved_by', 'approved_by_id', 'approved_at',
  'rejected_by', 'rejected_by_id', 'rejected_at', 'superseded_at',
];

function stampsFrom(data: Row | undefined) {
  const out: Row = {};
  for (const k of REVIEW_STAMPS) if (data?.[k] !== undefined) out[k] = data[k];
  return out;
}

function withoutStamps(rev: Row) {
  const out: Row = { ...rev };
  for (const k of REVIEW_STAMPS) delete out[k];
  return out;
}

function reviewStamp(h: HookContext, from: string, to: string): Row {
  if (from === to || h.mode === 'import') return {};
  const at = new Date().toISOString();
  const who = h.ctx.user.name;
  if (to === 'Approved') return { approved_by: who, approved_by_id: h.ctx.user.id, approved_at: at };
  if (to === 'Rejected') return { rejected_by: who, rejected_by_id: h.ctx.user.id, rejected_at: at };
  if (isReview(to) && !isReview(from)) return { review_requested_by: who, review_requested_at: at };
  return {};
}

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
  return String(rev.approved_status ?? 'Draft');
}
function statusOfNw(rev: Row) {
  return String(rev.status ?? 'Draft');
}

/**
 * Client revision workflow: Draft -> Internal Review -> Approved -> Superseded (or Rejected).
 * Uploading never approves. Only drawings.approve approves or rejects, and only a revision
 * under review. The approved revision becomes current and the previously approved one is
 * superseded by the server; a browser can't supersede or reinstate a revision itself.
 * 'Pending Review' and 'Review' are older names for Internal Review.
 */
const REVIEW_STATES = new Set(['Internal Review', 'Pending Review', 'Review']);
const UPLOAD_STATES = new Set(['Draft', ...REVIEW_STATES]);
const TERMINAL_STATES = new Set(['Superseded', 'Rejected']);
const isReview = (s: string) => REVIEW_STATES.has(s);

/** Checks a client revision status change; returns the status to store. */
function checkClientTransition(h: HookContext, revId: string, from: string, to: string): string {
  if (from === to) return from;
  // Superseding is the server's job (see settleCurrent); an approved revision stays approved.
  if (from === 'Approved' && to === 'Superseded') return from;
  if (TERMINAL_STATES.has(from)) throw new ForbiddenError(`Revision ${revId} is ${from} and cannot change status`);
  if (from === 'Approved') throw new ForbiddenError(`Revision ${revId} is approved; upload a new revision instead`);
  const need = (perm: PermissionKey) => {
    if (!h.ctx.can(perm)) throw new ForbiddenError(`Missing permission: ${perm}`);
  };
  if (to === 'Approved') {
    if (!isReview(from)) throw new ForbiddenError(`Revision ${revId} must go through Internal Review before it is approved`);
    need('drawings.approve');
  } else if (to === 'Rejected') {
    need('drawings.approve');
  } else if (isReview(to) && from === 'Draft') {
    need('drawings.upload');
  } else if (to === 'Draft' && isReview(from)) {
    if (!h.ctx.can('drawings.upload') && !h.ctx.can('drawings.approve')) need('drawings.upload');
  } else if (!(isReview(from) && isReview(to))) {
    throw new ForbiddenError(`Revision ${revId} cannot move from ${from} to ${to}`);
  }
  return to;
}

/** Upserts one revision; returns its id when this write approved a client revision. */
async function upsertRevision(h: HookContext, drawingId: string, kind: 'client' | 'nw_production', sent: Row): Promise<string | undefined> {
  if (typeof sent.id !== 'string' || !sent.id) throw new ValidationError('Drawing revision needs an id');
  h.touched?.add('drawings');
  const rev = (h.mode === 'import' ? sent : withoutStamps(sent)) as Row & { id: string };
  const isClient = kind === 'client';
  const hash = contentHash(isClient ? CLIENT_IMMUTABLE : NW_IMMUTABLE, rev);
  let status = isClient ? statusOfClient(rev) : statusOfNw(rev);
  const approvedForProduction = isClient ? false : Boolean(rev.approved_for_production);
  const existing = (await h.db.query('SELECT * FROM drawing_revisions WHERE id = $1 FOR UPDATE', [rev.id])).rows[0] as RevisionRow | undefined;
  const importing = h.mode === 'import';

  if (!existing) {
    if (!importing) {
      if (isClient && !h.ctx.can('drawings.upload')) throw new ForbiddenError('Missing permission: drawings.upload');
      if (!isClient && !h.ctx.can('drawings.create_production')) throw new ForbiddenError('Missing permission: drawings.create_production');
      if (isClient && !UPLOAD_STATES.has(status)) {
        throw new ForbiddenError('A new revision is uploaded as Draft or Internal Review; only an approver can approve it');
      }
      if (!isClient && (status === 'Approved' || status === 'Approved for Production' || approvedForProduction) && !h.ctx.can('drawings.approve')) {
        throw new ForbiddenError('A new NW production drawing cannot be uploaded as approved without drawings.approve');
      }
    }
    // Client: only the server decides which approved revision is current (settleCurrent).
    const isCurrent = isClient ? false : status !== 'Superseded';
    let linked: string | null = null;
    if (!isClient) linked = (await findClientRevision(h.db, rev.linked_client_drawing_id, rev.linked_client_revision))?.id ?? null;
    // An imported approved revision keeps its "current" flag in data for settleCurrent to honour.
    const stamps = importing ? {} : { uploaded_by_id: h.actor.id ?? null, ...(isClient ? reviewStamp(h, 'Draft', status) : {}) };
    const data = isClient
      ? { ...rev, ...stamps, approved_status: status, is_current: importing && status === 'Approved' && Boolean(rev.is_current) }
      : { ...rev, ...stamps };
    await h.db.query(
      `INSERT INTO drawing_revisions (id, drawing_id, kind, revision, approval_status, is_current, approved_for_production,
         linked_client_revision_id, file_url, content_hash, superseded_at, data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        rev.id, drawingId, kind, String(rev.revision ?? ''), status, isCurrent, approvedForProduction, linked,
        (rev.file_url as string) ?? null, hash, status === 'Superseded' ? new Date().toISOString() : null,
        JSON.stringify(data), h.actor.id ?? null,
      ]
    );
    if (!importing) {
      await writeAudit(h.db, h.actor, {
        action: 'drawing.revision.create',
        entityType: kind === 'client' ? 'drawing_revision' : 'nw_production_drawing',
        entityId: rev.id,
        details: `${drawingId} ${String(rev.revision)} (${status})`,
        after: data,
      });
    }
    return undefined;
  }

  if (existing.drawing_id !== drawingId || existing.kind !== kind) {
    throw new ValidationError(`Revision ${rev.id} belongs to another drawing`);
  }
  if (existing.content_hash !== hash) {
    throw new ForbiddenError(`Drawing revision ${rev.id} is immutable; upload a new revision instead of changing it`);
  }
  let approving: boolean;
  let isCurrent: boolean;
  if (isClient) {
    if (!importing) status = checkClientTransition(h, rev.id, existing.approval_status, status);
    approving = status === 'Approved' && existing.approval_status !== 'Approved';
    // settleCurrent makes an approved revision current once the old current one is cleared.
    isCurrent = existing.is_current;
  } else {
    approving = (status === 'Approved' && existing.approval_status !== 'Approved') || (approvedForProduction && !existing.approved_for_production);
    if (approving && !importing && !h.ctx.can('drawings.approve')) throw new ForbiddenError('Missing permission: drawings.approve');
    if (existing.approval_status === 'Superseded' && status !== 'Superseded') {
      throw new ForbiddenError(`Revision ${rev.id} is superseded and cannot be reinstated`);
    }
    isCurrent = status !== 'Superseded';
  }
  const kept = { ...stampsFrom(existing.data), ...(h.mode === 'import' ? stampsFrom(sent) : {}) };
  const fromStatus = existing.approval_status;
  const stamp = isClient
    ? reviewStamp(h, fromStatus, status)
    : approving && !importing
      ? { approved_by: h.ctx.user.name, approved_by_id: h.ctx.user.id, approved_at: new Date().toISOString() }
      : {};
  const data = isClient ? { ...rev, ...kept, ...stamp, approved_status: status, is_current: isCurrent } : { ...rev, ...kept, ...stamp };
  const changed =
    existing.approval_status !== status || existing.is_current !== isCurrent || existing.approved_for_production !== approvedForProduction ||
    JSON.stringify(existing.data) !== JSON.stringify(data);
  if (!changed) return undefined;
  await h.db.query(
    `UPDATE drawing_revisions SET approval_status = $2, is_current = $3, approved_for_production = $4, data = $5,
       superseded_at = CASE WHEN $2 = 'Superseded' THEN coalesce(superseded_at, now()) ELSE NULL END, updated_at = now()
     WHERE id = $1`,
    [rev.id, status, isCurrent, approvedForProduction, JSON.stringify(data)]
  );
  if (existing.approval_status !== status || existing.approved_for_production !== approvedForProduction) {
    await writeAudit(h.db, h.actor, {
      action: approving
        ? 'drawing.revision.approve'
        : status === 'Rejected'
          ? 'drawing.revision.reject'
          : status === 'Superseded'
            ? 'drawing.revision.supersede'
            : 'drawing.revision.status',
      entityType: kind === 'client' ? 'drawing_revision' : 'nw_production_drawing',
      entityId: rev.id,
      before: { status: existing.approval_status, approved_for_production: existing.approved_for_production },
      after: { status, approved_for_production: approvedForProduction },
    });
  }
  return isClient && approving ? rev.id : undefined;
}

/**
 * Keeps exactly one current client revision per drawing: the one just approved, else the
 * existing current one, else (import) the newest approved one. Every other approved
 * revision becomes Superseded (never deleted). Drafts and revisions under review are never
 * current, so production keeps using the approved revision until a newer one is approved.
 */
async function settleCurrent(h: HookContext, drawingId: string, approvedNow?: string) {
  const revs = (await h.db.query(
    `SELECT id, approval_status, is_current, coalesce((data->>'is_current')::boolean, false) AS flagged FROM drawing_revisions
     WHERE drawing_id = $1 AND kind = 'client' ORDER BY created_at DESC, id DESC`,
    [drawingId]
  )).rows as { id: string; approval_status: string; is_current: boolean; flagged: boolean }[];
  const approved = revs.filter((r) => r.approval_status === 'Approved');
  const current =
    revs.find((r) => r.id === approvedNow) ??
    approved.find((r) => r.is_current) ??
    approved.find((r) => r.flagged) ??
    approved[0];
  // Clear the others first: the database allows one current client revision per drawing.
  for (const r of revs) {
    if (r.id === current?.id) continue;
    if (r.approval_status === 'Approved') {
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
          details: `superseded by ${current!.id}`,
        });
      }
    } else if (r.is_current) {
      await h.db.query(
        `UPDATE drawing_revisions SET is_current = false, updated_at = now(), data = jsonb_set(data, '{is_current}', 'false') WHERE id = $1`,
        [r.id]
      );
    }
  }
  if (current && !current.is_current) {
    await h.db.query(
      `UPDATE drawing_revisions SET is_current = true, updated_at = now(), data = jsonb_set(data, '{is_current}', 'true') WHERE id = $1`,
      [current.id]
    );
  }
  if (current) await h.db.query('UPDATE drawings SET current_revision_id = $2 WHERE id = $1', [drawingId, current.id]);
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
          .map((r) => ({ ...r.data, approved_status: r.approval_status, is_current: r.is_current, ...(r.superseded_at ? { superseded_at: r.superseded_at } : {}) })),
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
    let approvedNow: string | undefined;
    for (const rev of revisions) approvedNow = (await upsertRevision(h, drawingId, 'client', rev)) ?? approvedNow;
    for (const rev of nw) await upsertRevision(h, drawingId, 'nw_production', rev);
    await settleCurrent(h, drawingId, approvedNow);
  },
};

/** New client revision through the API: stored as Draft (or Internal Review), never approved. */
export async function addClientRevision(h: HookContext, drawingId: string, rev: Row) {
  if (!h.ctx.can('drawings.upload')) throw new ForbiddenError('Missing permission: drawings.upload');
  await upsertRevision(h, drawingId, 'client', { ...rev, approved_status: rev.approved_status ?? 'Draft' });
  await settleCurrent(h, drawingId);
}

/** Moves a client revision through review: Internal Review, Approved, Rejected or back to Draft. */
export async function setClientRevisionStatus(h: HookContext, drawingId: string, revId: string, status: string) {
  const existing = await findRevisionById(h.db, revId);
  if (!existing || existing.drawing_id !== drawingId || existing.kind !== 'client') throw new ValidationError(`No client revision ${revId} on ${drawingId}`);
  const approvedNow = await upsertRevision(h, drawingId, 'client', { ...existing.data, approved_status: status });
  await settleCurrent(h, drawingId, approvedNow);
}

/** Production orders built from each revision of a drawing (client and NW production). */
export async function drawingProductionUsage(db: Db, drawingId: string) {
  const res = await db.query(
    `SELECT r.id AS revision_id, r.kind, r.revision, o.id, o.status, o.work_item_id, o.data->>'order_number' AS order_number
     FROM drawing_revisions r
     JOIN production_orders o ON o.client_drawing_revision_id = r.id OR o.nw_drawing_revision_id = r.id
     WHERE r.drawing_id = $1 ORDER BY r.created_at, o.id`,
    [drawingId]
  );
  const byRevision: Record<string, { id: string; order_number: string; status: string; work_item_id: string }[]> = {};
  for (const row of res.rows) {
    (byRevision[row.revision_id] ??= []).push({ id: row.id, order_number: row.order_number ?? row.id, status: row.status, work_item_id: row.work_item_id });
  }
  return byRevision;
}
