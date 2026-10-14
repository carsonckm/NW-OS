/**
 * /api/files: private project files (server/files/files.ts). Behind sign-in and the active-user
 * check; every file is authorized against the record it belongs to.
 *
 *   POST /api/files?purpose=&project_id=&record_collection=&record_id=
 *        body: the file's bytes (Content-Type application/octet-stream)
 *        headers: X-NWOS-Upload: 1, X-File-Name: <URI-encoded name>
 *   GET  /api/files?record_collection=&record_id=   the record's files (metadata)
 *   GET  /api/files/:id                              the file (sandboxed; private, not cached)
 *
 * Uploads are not JSON, so the JSON-only CSRF rule is replaced here by a required custom header
 * (a cross-site page cannot send it without a CORS preflight, which is never granted) and the
 * same Origin check.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { listFiles, maxFileBytes, readFile, uploadFile } from './files';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

/** CSRF for non-JSON uploads: the custom header, a matching Origin, octet-stream only. */
function uploadGuard(req: Request, res: Response, next: NextFunction) {
  const origin = req.headers.origin;
  if (origin) {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      host = undefined;
    }
    if (host !== (req.headers['x-forwarded-host'] ?? req.headers.host)) return res.status(403).json({ error: 'bad_origin', message: 'Cross-origin request refused' });
  }
  if (req.headers['x-nwos-upload'] !== '1') return res.status(403).json({ error: 'forbidden', message: 'Uploads must come from NW OS' });
  if (!req.is('application/octet-stream')) return res.status(415).json({ error: 'unsupported_media_type', message: 'Send the file as application/octet-stream' });
  next();
}

const header = (v: unknown) => {
  if (typeof v !== 'string') return undefined;
  try {
    return decodeURIComponent(v);
  } catch {
    return undefined;
  }
};

export function createFilesRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use('/files', attachUser(store), requireUser, loadAccess(pool));

  router.post(
    '/files',
    uploadGuard,
    express.raw({ type: 'application/octet-stream', limit: maxFileBytes() }),
    wrap(async (req, res) => {
      const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const q = req.query;
      const out = await uploadFile(pool, req.access!, actorOf(req), {
        purpose: q.purpose,
        project_id: q.project_id,
        record_collection: q.record_collection,
        record_id: q.record_id,
        file_name: header(req.headers['x-file-name']),
        bytes,
      });
      res.status(201).json(out);
    })
  );

  router.get(
    '/files',
    wrap(async (req, res) => {
      res.set('Cache-Control', 'no-store').json(await listFiles(pool, req.access!, req.query.record_collection, req.query.record_id));
    })
  );

  router.get(
    '/files/:id',
    wrap(async (req, res) => {
      const { file, bytes, inline } = await readFile(pool, req.access!, String(req.params.id));
      res.set({
        'Content-Type': file.content_type,
        'Content-Length': String(bytes.length),
        'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.file_name)}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        'Cache-Control': 'private, no-store',
        ETag: `"${file.sha256}"`,
      });
      res.end(bytes);
    })
  );

  // An upload over the size limit is refused before it reaches the handler.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if ((err as { type?: string })?.type === 'entity.too.large') {
      return res.status(413).json({ error: 'too_large', message: `The file is larger than ${Math.round(maxFileBytes() / 1024 / 1024)} MB` });
    }
    next(err);
  });
  router.use(apiErrorHandler);
  return router;
}
