/**
 * Private project files (migration 032): drawings and drawing revisions, site photographs and
 * project attachments. The bytes are kept in PostgreSQL (file_contents), never at a public URL;
 * every upload and download is authorized here, against the record the file belongs to.
 *
 * Upload
 *   - purpose drawing:    drawings.upload and access to the project; the file is uploaded first
 *                         and linked when the drawing revision that uses it (file_url
 *                         /api/files/<id>) is created (link.ts, linkDrawingRevisionFile).
 *   - purpose site_photo / attachment: the record (installation job, site QC inspection, issue,
 *                         handover, document, variation, …) must exist, be readable by the user,
 *                         and the user must hold that module's create or edit permission.
 *   - type and size: an allowlist per purpose, checked against the file's own bytes (magic
 *     numbers), not its name or the browser's Content-Type; at most FILE_MAX_BYTES (25 MiB).
 * Download
 *   - the project must be visible to the user, and the record the file belongs to readable
 *     through the module's own rules (DataService.get: permission, project scope, a
 *     Contractor's own work only);
 *   - Clients and Contractors get drawing files only of approved revisions, and never a file not
 *     yet linked to a record;
 *   - anything else answers 404 (no hint that the file exists).
 */
import { createHash, randomUUID } from 'crypto';
import type { AccessContext } from '../auth/access';
import { ForbiddenError } from '../auth/access';
import { withUserTransaction } from '../auth/identity';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import type { Pool, PoolClient } from '../db/pool';
import { DataService } from '../modules/service';
import { MODULE_BY_KEY } from '../modules/registry';
import { hasAny, loadOrderInfo, projectOf } from '../modules/scope';
import type { ModuleDef } from '../modules/types';

type Row = Record<string, any>;
type Db = Pool | PoolClient;

export type FilePurpose = 'drawing' | 'site_photo' | 'attachment';
type Kind = 'pdf' | 'png' | 'jpeg' | 'webp' | 'heic' | 'dwg' | 'dxf' | 'xlsx' | 'docx';

const EXTENSIONS: Record<string, Kind> = {
  pdf: 'pdf', png: 'png', jpg: 'jpeg', jpeg: 'jpeg', webp: 'webp', heic: 'heic', heif: 'heic', dwg: 'dwg', dxf: 'dxf', xlsx: 'xlsx', docx: 'docx',
};
const CONTENT_TYPES: Record<Kind, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  dwg: 'application/octet-stream',
  dxf: 'application/octet-stream',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
/** Shown in the browser (sandboxed); everything else is downloaded. */
const INLINE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']);

interface PurposeRule {
  kinds: Kind[];
  /** Module collections a file of this purpose may belong to. */
  collections: string[];
  /** The record must exist at upload (false: linked later, drawings only). */
  recordAtUpload: boolean;
}
export const PURPOSES: Record<FilePurpose, PurposeRule> = {
  drawing: { kinds: ['pdf', 'png', 'jpeg', 'dwg', 'dxf'], collections: ['drawings'], recordAtUpload: false },
  site_photo: { kinds: ['jpeg', 'png', 'webp', 'heic'], collections: ['installationJobs', 'siteQCInspections', 'issues', 'handoverRecords', 'deliveryRecords', 'siteMeasurements'], recordAtUpload: true },
  attachment: { kinds: ['pdf', 'png', 'jpeg', 'webp', 'heic', 'xlsx', 'docx', 'dwg', 'dxf'], collections: ['documents', 'issues', 'variations', 'handoverRecords', 'installationJobs', 'siteQCInspections', 'purchaseOrders', 'commercialInvoices'], recordAtUpload: true },
};

const MB = 1024 * 1024;
/** FILE_MAX_BYTES (default 25 MiB, at most 50 MiB). */
export function maxFileBytes(env: NodeJS.ProcessEnv = process.env) {
  const n = Number(env.FILE_MAX_BYTES);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 50 * MB) : 25 * MB;
}

const EXTERNAL = new Set(['Client', 'Contractor']);
const APPROVED_REVISION = new Set(['Approved', 'Approved for Production']);

/** The file's real type from its first bytes, or null. */
export function sniff(buf: Buffer): Kind | 'zip' | null {
  const at = (s: string, off = 0) => buf.length >= off + s.length && buf.subarray(off, off + s.length).toString('latin1') === s;
  if (at('%PDF-')) return 'pdf';
  if (at('\x89PNG\r\n\x1a\n')) return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (at('RIFF') && at('WEBP', 8)) return 'webp';
  if (at('ftyp', 4) && ['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1', 'heif'].includes(buf.subarray(8, 12).toString('latin1'))) return 'heic';
  if (/^AC10\d\d/.test(buf.subarray(0, 6).toString('latin1'))) return 'dwg';
  if (at('PK\x03\x04')) return 'zip';
  // ASCII DXF: "0" then SECTION, plain text (no NUL bytes) in the first kilobyte.
  const head = buf.subarray(0, 1024);
  if (!head.includes(0) && /^\s*0\s*\r?\n\s*SECTION\b/.test(head.toString('latin1'))) return 'dxf';
  if (at('AutoCAD Binary DXF')) return 'dxf';
  return null;
}

/** File name as shown and offered for download: no path, no control characters, at most 200. */
export function cleanFileName(raw: unknown) {
  const name = String(raw ?? '')
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f"]/g, '')
    .trim()
    .slice(-200);
  return name;
}

/** The checked kind of an upload, or a ValidationError naming what is wrong. */
export function checkContent(purpose: FilePurpose, fileName: string, bytes: Buffer, max = maxFileBytes()): Kind {
  if (!bytes.length) throw new ValidationError('The file is empty');
  if (bytes.length > max) throw Object.assign(new ValidationError(`The file is larger than ${Math.round(max / MB)} MB`), { status: 413 });
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const kind = EXTENSIONS[ext];
  const allowed = PURPOSES[purpose].kinds;
  if (!kind || !allowed.includes(kind)) throw new ValidationError(`This kind of file is not accepted here (allowed: ${[...new Set(allowed)].join(', ')})`);
  const actual = sniff(bytes);
  const matches = actual === kind || (actual === 'zip' && (kind === 'xlsx' || kind === 'docx'));
  if (!matches) throw new ValidationError(`The file's contents are not a valid .${ext} file`);
  return kind;
}

const notFound = () => Object.assign(new NotFoundError('clients', 'file'), { message: 'File not found' });
const projectNotFound = () => Object.assign(new NotFoundError('projects', 'project'), { message: 'Project not found' });

function moduleOf(collection: unknown): ModuleDef | undefined {
  return typeof collection === 'string' ? MODULE_BY_KEY.get(collection) : undefined;
}

/** The record a file belongs to, as this user may read it; undefined if not readable. */
async function readableRecord(pool: Pool, ctx: AccessContext, def: ModuleDef, id: string) {
  try {
    return await new DataService(pool).get(ctx, def, id);
  } catch {
    return undefined;
  }
}

export interface UploadInput {
  purpose: unknown;
  project_id?: unknown;
  record_collection?: unknown;
  record_id?: unknown;
  file_name: unknown;
  bytes: Buffer;
}

export async function uploadFile(pool: Pool, ctx: AccessContext, actor: AuditActor, input: UploadInput) {
  const purpose = input.purpose as FilePurpose;
  const rule = PURPOSES[purpose];
  if (!rule) throw new ValidationError('purpose must be drawing, site_photo or attachment');
  const fileName = cleanFileName(input.file_name);
  if (!fileName) throw new ValidationError('A file name is required');
  const kind = checkContent(purpose, fileName, input.bytes);

  let projectId = typeof input.project_id === 'string' ? input.project_id : '';
  let collection: string | null = null;
  let recordId: string | null = null;
  if (input.record_collection !== undefined || input.record_id !== undefined || rule.recordAtUpload) {
    const def = moduleOf(input.record_collection);
    if (!def || !rule.collections.includes(def.key)) throw new ValidationError(`A ${purpose} belongs to one of: ${rule.collections.join(', ')}`);
    if (typeof input.record_id !== 'string' || !input.record_id) throw new ValidationError('record_id is required');
    if (!hasAny(ctx, def.perms.create) && !hasAny(ctx, def.perms.edit)) throw new ForbiddenError(`You cannot add files to ${def.key}`);
    const record = await readableRecord(pool, ctx, def, input.record_id);
    if (!record) throw notFound();
    const recordProject = projectOf(def, record, await loadOrderInfo(pool));
    if (!recordProject) throw new ValidationError('Files belong to a project record');
    if (projectId && projectId !== recordProject) throw new ValidationError('project_id does not match the record');
    projectId = recordProject;
    collection = def.key;
    recordId = input.record_id;
  } else {
    // A drawing file uploaded ahead of its revision.
    if (!ctx.can('drawings.upload')) throw new ForbiddenError('Missing permission: drawings.upload');
    if (!projectId) throw new ValidationError('project_id is required');
  }
  if (!ctx.canSeeProject(projectId)) throw projectNotFound();

  const id = `file-${randomUUID()}`;
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  const contentType = CONTENT_TYPES[kind];
  return withUserTransaction(pool, ctx, async (db) => {
    // Company-wide roles see every project id, so check it exists before writing anything: a
    // clean 404 rather than the database's foreign key error, and no file or audit row.
    if (!(await db.query('SELECT 1 FROM projects WHERE id = $1', [projectId])).rowCount) throw projectNotFound();
    await db.query(
      `INSERT INTO files (id, project_id, purpose, record_collection, record_id, file_name, content_type, size_bytes, sha256, uploaded_by_id, uploaded_by_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [id, projectId, purpose, collection, recordId, fileName, contentType, input.bytes.length, sha256, ctx.user.id, ctx.user.name]
    );
    await db.query('INSERT INTO file_contents (file_id, bytes) VALUES ($1, $2)', [id, input.bytes]);
    await writeAudit(db, actor, {
      action: 'file.upload',
      entityType: 'file',
      entityId: id,
      projectId,
      after: { purpose, record_collection: collection, record_id: recordId, file_name: fileName, content_type: contentType, size_bytes: input.bytes.length, sha256 },
    });
    return { id, url: `/api/files/${id}`, file_name: fileName, content_type: contentType, size_bytes: input.bytes.length, sha256, project_id: projectId, purpose, record_collection: collection, record_id: recordId };
  });
}

/** Whether this user may read this file (see the header); throws 404 otherwise. */
async function authorize(pool: Pool, ctx: AccessContext, file: Row) {
  if (!ctx.canSeeProject(file.project_id)) throw notFound();
  const external = EXTERNAL.has(ctx.user.role);
  if (file.record_id) {
    const def = moduleOf(file.record_collection);
    if (!def || !(await readableRecord(pool, ctx, def, file.record_id))) throw notFound();
    if (external && file.purpose === 'drawing') {
      const rev = (await pool.query('SELECT approval_status, approved_for_production FROM drawing_revisions WHERE id = $1', [file.revision_id])).rows[0];
      if (!rev || !(APPROVED_REVISION.has(rev.approval_status) || rev.approved_for_production)) throw notFound();
    }
    return;
  }
  // Not linked yet (a drawing file waiting for its revision): its uploader, or staff who may upload drawings.
  if (external) throw notFound();
  if (file.uploaded_by_id !== ctx.user.id && !ctx.can('drawings.upload')) throw notFound();
}

export async function readFile(pool: Pool, ctx: AccessContext, id: string) {
  const file = (await pool.query('SELECT * FROM files WHERE id = $1', [id])).rows[0] as Row | undefined;
  if (!file) throw notFound();
  await authorize(pool, ctx, file);
  const bytes = (await pool.query('SELECT bytes FROM file_contents WHERE file_id = $1', [id])).rows[0]?.bytes as Buffer | undefined;
  if (!bytes) throw notFound();
  return { file, bytes, inline: INLINE.has(file.content_type) };
}

/** Files of one record this user may read (metadata only). */
export async function listFiles(pool: Pool, ctx: AccessContext, collection: unknown, recordId: unknown) {
  const def = moduleOf(collection);
  if (!def || typeof recordId !== 'string' || !(await readableRecord(pool, ctx, def, recordId))) throw notFound();
  const rows = (await pool.query('SELECT * FROM files WHERE record_collection = $1 AND record_id = $2 ORDER BY uploaded_at, id', [def.key, recordId])).rows as Row[];
  const out = [];
  for (const f of rows) {
    try {
      await authorize(pool, ctx, f);
      out.push(publicFile(f));
    } catch {
      /* not for this reader */
    }
  }
  return out;
}

export const publicFile = (f: Row) => ({
  id: f.id,
  url: `/api/files/${f.id}`,
  purpose: f.purpose,
  record_collection: f.record_collection,
  record_id: f.record_id,
  revision_id: f.revision_id,
  file_name: f.file_name,
  content_type: f.content_type,
  size_bytes: Number(f.size_bytes),
  sha256: f.sha256,
  uploaded_by_name: f.uploaded_by_name,
  uploaded_at: new Date(f.uploaded_at).toISOString(),
});
