/**
 * Linking an uploaded drawing file to the revision that uses it. Kept apart from files.ts: the
 * drawing hooks call it, and files.ts depends on the module registry (which imports the hooks).
 */
import { ValidationError } from '../core/repository';
import type { PoolClient } from '../db/pool';

type Row = Record<string, any>;

const FILE_URL = /^\/api\/files\/(file-[0-9a-f-]{36})$/;

/**
 * Called when a drawing revision is created: a revision whose file_url is an uploaded file takes
 * that file, which must be a drawing file of the same project, not already another revision's.
 * Any other file_url (older demo records) is left as it is.
 */
export async function linkDrawingRevisionFile(db: PoolClient, drawingId: string, revisionId: string, fileUrl: unknown) {
  const m = typeof fileUrl === 'string' ? FILE_URL.exec(fileUrl) : null;
  if (!m) return;
  const file = (await db.query('SELECT * FROM files WHERE id = $1 FOR UPDATE', [m[1]])).rows[0] as Row | undefined;
  const drawing = (await db.query('SELECT project_id FROM drawings WHERE id = $1', [drawingId])).rows[0];
  if (!file || file.purpose !== 'drawing' || !drawing || file.project_id !== drawing.project_id) {
    throw new ValidationError('The revision refers to a file that is not a drawing file of this project');
  }
  if (file.record_id) {
    if (file.record_id === drawingId && file.revision_id === revisionId) return;
    throw new ValidationError('That file already belongs to another drawing revision');
  }
  await db.query(`UPDATE files SET record_collection = 'drawings', record_id = $2, revision_id = $3 WHERE id = $1`, [file.id, drawingId, revisionId]);
}
