/**
 * Pilot: private file storage (migration 032, server/files), on the real restricted runtime role.
 * Real bytes in, the same bytes out; every upload and download authorized against the record the
 * file belongs to; unsafe types, disguised content and oversized files refused; the stored file
 * immutable even for direct SQL on the runtime credential.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { sniff } from './files';

type Row = Record<string, any>;

const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('1 0 obj << /Type /Catalog >> endobj\n'), Buffer.alloc(2048, 0x20), Buffer.from('%%EOF\n')]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF site photo bytes'), Buffer.alloc(512, 7), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), Buffer.alloc(256, 3)]);
const HTML = Buffer.from('<html><script>alert(document.cookie)</script></html>');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('pilot: private project files (real runtime role)', () => {
  let db: TestDb;
  let app: any;
  let as: Record<string, request.Agent> = {};

  beforeAll(async () => {
    ({ db, app, as } = (await setupDemoWorld({ restricted: true })) as never);
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  const upload = (agent: request.Agent | request.SuperTest<request.Test>, query: Record<string, string>, name: string, bytes: Buffer, headers: Record<string, string> = {}) =>
    agent
      .post(`/api/files?${new URLSearchParams(query)}`)
      .set({ 'Content-Type': 'application/octet-stream', 'X-NWOS-Upload': '1', 'X-File-Name': encodeURIComponent(name), ...headers })
      .send(bytes);
  const download = (agent: request.Agent, url: string) => agent.get(url).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

  /** A drawing revision on proj-1 made from an uploaded PDF, approved or not. */
  async function drawingWithFile(id: string, status: 'Draft' | 'Approved') {
    const up = await upload(as['Project Manager'], { purpose: 'drawing', project_id: 'proj-1' }, `${id}.pdf`, PDF).expect(201);
    const rev = { id: `${id}-r1`, drawing_id: id, revision: 'Rev 1', title: 'Outlet 12 gondola layout', file_url: up.body.url, uploaded_date: '2026-10-12', uploaded_by: 'PM', approved_status: 'Draft', notes: '', is_current: false, drawing_type: 'Client / Designer Drawing', markups: [] };
    await as['Project Manager'].post('/api/drawings').send({ id, project_id: 'proj-1', drawing_number: id.toUpperCase(), title: 'Gondola layout', category: 'Joinery', current_revision_id: rev.id, created_at: '2026-10-12', revisions: [rev] }).expect(201);
    if (status === 'Approved') await db.owner.query(`UPDATE drawing_revisions SET approval_status = 'Approved' WHERE id = $1`, [rev.id]);
    return { url: up.body.url as string, fileId: up.body.id as string, revId: rev.id };
  }

  it('stores the real bytes and returns them unchanged, privately and sandboxed', async () => {
    const { url, fileId, revId } = await drawingWithFile('dwg-f1', 'Draft');
    const file = (await db.owner.query('SELECT * FROM files WHERE id = $1', [fileId])).rows[0];
    expect(file).toMatchObject({ project_id: 'proj-1', purpose: 'drawing', record_collection: 'drawings', record_id: 'dwg-f1', revision_id: revId, size_bytes: PDF.length, uploaded_by_id: 'user-pm', uploaded_by_verified: true });
    const res = await download(as['Owner / CEO'], url).expect(200);
    expect(Buffer.compare(res.body, PDF)).toBe(0);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toMatch(/sandbox/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['content-disposition']).toMatch(/^inline; filename\*=UTF-8''dwg-f1\.pdf$/);
    // Listed on its record; audited without the bytes.
    const listed = (await as['Project Manager'].get('/api/files?record_collection=drawings&record_id=dwg-f1').expect(200)).body;
    expect(listed.map((f: Row) => f.id)).toEqual([fileId]);
    const audit = (await db.owner.query(`SELECT after FROM audit_logs WHERE action = 'file.upload' AND entity_id = $1`, [fileId])).rows[0].after;
    expect(audit).toMatchObject({ purpose: 'drawing', size_bytes: PDF.length });
    // Unauthenticated: nothing.
    expect((await request(app).get(url)).status).toBe(401);
  });

  it('gives clients and contractors drawing files only of approved revisions', async () => {
    const draft = await drawingWithFile('dwg-f2', 'Draft');
    const approved = await drawingWithFile('dwg-f3', 'Approved');
    for (const role of ['Client', 'Contractor']) {
      expect((await as[role].get(draft.url)).status, role).toBe(404);
      const ok = await download(as[role], approved.url).expect(200);
      expect(Buffer.compare(ok.body, PDF)).toBe(0);
      const list = (await as[role].get('/api/files?record_collection=drawings&record_id=dwg-f2').expect(200)).body;
      expect(list).toEqual([]);
    }
    // Staff see both.
    await as['Site Supervisor'].get(draft.url).expect(200);
  });

  it('keeps every file inside its project: other projects get 404', async () => {
    const up = await upload(as['Owner / CEO'], { purpose: 'drawing', project_id: 'proj-x' }, 'x.pdf', PDF).expect(201);
    for (const role of ['Project Manager', 'Client', 'Contractor', 'Production Staff']) {
      expect((await as[role].get(up.body.url)).status, role).toBe(404);
    }
    // Nor can anyone outside proj-x upload into it.
    expect((await upload(as['Project Manager'], { purpose: 'drawing', project_id: 'proj-x' }, 'y.pdf', PDF)).status).toBe(404);
    // A revision cannot take another project's file.
    const rev = { id: 'dwg-f4-r1', drawing_id: 'dwg-f4', revision: 'Rev 1', title: 'x', file_url: up.body.url, uploaded_date: '2026-10-12', uploaded_by: 'Owner', approved_status: 'Draft', notes: '', is_current: false, drawing_type: 'Client / Designer Drawing', markups: [] };
    const res = await as['Owner / CEO'].post('/api/drawings').send({ id: 'dwg-f4', project_id: 'proj-1', drawing_number: 'F4', title: 'x', category: 'Joinery', current_revision_id: rev.id, created_at: '2026-10-12', revisions: [rev] });
    expect(res.status).toBe(400);
  });

  it('links a drawing file to one revision only, and hides unlinked files from outsiders', async () => {
    const { url } = await drawingWithFile('dwg-f5', 'Draft');
    const rev = { id: 'dwg-f6-r1', drawing_id: 'dwg-f6', revision: 'Rev 1', title: 'x', file_url: url, uploaded_date: '2026-10-12', uploaded_by: 'PM', approved_status: 'Draft', notes: '', is_current: false, drawing_type: 'Client / Designer Drawing', markups: [] };
    expect((await as['Project Manager'].post('/api/drawings').send({ id: 'dwg-f6', project_id: 'proj-1', drawing_number: 'F6', title: 'x', category: 'Joinery', current_revision_id: rev.id, created_at: '2026-10-12', revisions: [rev] })).status).toBe(400);
    // Uploaded, not yet used: the uploader and drawing staff only.
    const pending = await upload(as['Project Manager'], { purpose: 'drawing', project_id: 'proj-1' }, 'pending.pdf', PDF).expect(201);
    await as['Project Manager'].get(pending.body.url).expect(200);
    for (const role of ['Client', 'Contractor', 'Production Staff']) expect((await as[role].get(pending.body.url)).status, role).toBe(404);
  });

  it('site photos: a contractor adds and sees photos of its own jobs only', async () => {
    const own = await upload(as['Contractor'], { purpose: 'site_photo', record_collection: 'installationJobs', record_id: 'inst-1' }, 'IMG_0001.jpg', JPEG).expect(201);
    expect(own.body).toMatchObject({ project_id: 'proj-1', record_id: 'inst-1', content_type: 'image/jpeg' });
    const back = await download(as['Contractor'], own.body.url).expect(200);
    expect(Buffer.compare(back.body, JPEG)).toBe(0);
    // Another subcontractor's job (inst-6, con-2): neither upload nor download.
    expect((await upload(as['Contractor'], { purpose: 'site_photo', record_collection: 'installationJobs', record_id: 'inst-6' }, 'x.jpg', JPEG)).status).toBe(404);
    const theirs = await upload(as['Site Supervisor'], { purpose: 'site_photo', record_collection: 'installationJobs', record_id: 'inst-6' }, 'IMG_0002.jpg', JPEG).expect(201);
    expect((await as['Contractor'].get(theirs.body.url)).status).toBe(404);
    // A client has no upload rights.
    expect((await upload(as['Client'], { purpose: 'site_photo', record_collection: 'installationJobs', record_id: 'inst-1' }, 'c.jpg', JPEG)).status).toBe(403);
    // A photo needs its record.
    expect((await upload(as['Site Supervisor'], { purpose: 'site_photo', project_id: 'proj-1' }, 'loose.jpg', JPEG)).status).toBe(400);
  });

  it('refuses unsafe types, disguised content, empty and oversized files', async () => {
    const pm = as['Project Manager'];
    const q = { purpose: 'drawing', project_id: 'proj-1' };
    for (const [name, bytes] of [['page.html', HTML], ['logo.svg', SVG], ['run.exe', Buffer.from('MZ\x90\x00', 'latin1')], ['fake.pdf', HTML], ['fake.jpg', PDF], ['photo.png', JPEG]] as const) {
      expect((await upload(pm, q, name, bytes)).status, name).toBe(400);
    }
    expect((await upload(pm, q, 'empty.pdf', Buffer.alloc(0))).status).toBe(400);
    // A photo purpose does not take PDFs.
    expect((await upload(pm, { purpose: 'site_photo', record_collection: 'installationJobs', record_id: 'inst-1' }, 'a.pdf', PDF)).status).toBe(400);
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(25 * 1024 * 1024 + 10)]);
    expect((await upload(pm, q, 'big.pdf', big)).status).toBe(413);
    // Sniffing recognises what it allows.
    expect([sniff(PDF), sniff(JPEG), sniff(PNG), sniff(HTML), sniff(SVG)]).toEqual(['pdf', 'jpeg', 'png', null, null]);
  });

  it('requires the upload header, a matching origin and octet-stream (CSRF)', async () => {
    const pm = as['Project Manager'];
    const q = { purpose: 'drawing', project_id: 'proj-1' };
    expect((await upload(pm, q, 'a.pdf', PDF, { 'X-NWOS-Upload': '' })).status).toBe(403);
    expect((await upload(pm, q, 'a.pdf', PDF, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await upload(pm, q, 'a.pdf', PDF, { 'Content-Type': 'multipart/form-data; boundary=x' })).status).toBe(415);
  });

  it('keeps stored files immutable, even for direct SQL on the runtime credential', async () => {
    const { fileId } = await drawingWithFile('dwg-f7', 'Draft');
    for (const sql of [
      `UPDATE files SET file_name = 'renamed.pdf' WHERE id = $1`,
      `UPDATE files SET project_id = 'proj-x' WHERE id = $1`,
      `UPDATE files SET record_id = 'dwg-other' WHERE id = $1`,
      `DELETE FROM files WHERE id = $1`,
      `UPDATE file_contents SET bytes = '\\x00' WHERE file_id = $1`,
      `DELETE FROM file_contents WHERE file_id = $1`,
    ]) {
      await expect(db.pool.query(sql, [fileId]), sql).rejects.toThrow();
    }
    // Contents must match the recorded size and hash.
    await db.pool.query(`INSERT INTO files (id, project_id, purpose, file_name, content_type, size_bytes, sha256, uploaded_by_id) VALUES ('file-forged', 'proj-1', 'drawing', 'f.pdf', 'application/pdf', 3, repeat('a', 64), 'user-pm')`);
    await expect(db.pool.query(`INSERT INTO file_contents (file_id, bytes) VALUES ('file-forged', '\\x010203')`)).rejects.toThrow(/do not match/);
    // A file inserted directly (no verified identity) is marked as such.
    expect((await db.owner.query(`SELECT uploaded_by_verified FROM files WHERE id = 'file-forged'`)).rows[0].uploaded_by_verified).toBe(false);
  });
});
