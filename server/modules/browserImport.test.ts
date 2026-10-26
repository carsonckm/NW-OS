/**
 * NWOS_BROWSER_IMPORT: whether the browser may bulk-import its local data into PostgreSQL.
 * Off by default in production. When off, both import endpoints refuse every role (the Owner
 * included) with a clear error, /api/data/status says so, and nothing is written; ordinary
 * record-by-record saving (/api/data/sync) keeps working.
 */
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_CLIENTS } from '../../src/data/initialData';
import { buildApp, seedUsers, signIn, type SeedUser } from '../test/app';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { browserImportAllowed } from './browserImport';

describe('browserImportAllowed', () => {
  it.each([
    [{ NODE_ENV: 'production' }, false],
    [{ NODE_ENV: 'development' }, true],
    [{}, true],
    [{ NODE_ENV: 'production', NWOS_BROWSER_IMPORT: 'on' }, true],
    [{ NODE_ENV: 'production', NWOS_BROWSER_IMPORT: ' ON ' }, true],
    [{ NODE_ENV: 'development', NWOS_BROWSER_IMPORT: 'off' }, false],
    [{ NODE_ENV: 'development', NWOS_BROWSER_IMPORT: 'yes' }, false], // anything but "on" is off
  ])('%j -> %s', (env, allowed) => {
    expect(browserImportAllowed(env as NodeJS.ProcessEnv)).toBe(allowed);
  });
});

const USERS: SeedUser[] = [
  { id: 'user-owner', role: 'Owner / CEO', email: 'owner@test.local' },
  { id: 'user-pm', role: 'Project Manager', email: 'pm@test.local' },
];

describe.skipIf(!TEST_DATABASE_URL)('browser import switch on the API (empty and non-empty database)', () => {
  let db: TestDb;
  let app: ReturnType<typeof buildApp>;
  const as: Record<string, request.Agent> = {};
  const saved = process.env.NWOS_BROWSER_IMPORT;
  const client = (id: string) => ({ ...INITIAL_CLIENTS[0], id, company_name: `Synthetic ${id}` });
  const count = async () => (await db.pool.query('SELECT count(*)::int AS n FROM clients')).rows[0].n as number;

  beforeAll(async () => {
    db = await createTestDb();
    await seedUsers(db.owner, USERS);
    app = buildApp(db.pool);
    as.owner = await signIn(app, 'owner@test.local');
    as.pm = await signIn(app, 'pm@test.local');
  }, 60_000);
  afterEach(() => {
    if (saved === undefined) delete process.env.NWOS_BROWSER_IMPORT;
    else process.env.NWOS_BROWSER_IMPORT = saved;
  });
  afterAll(async () => {
    await db?.close();
  });

  it('off, empty database: status says so; every role is refused, dry run included; nothing is written', async () => {
    process.env.NWOS_BROWSER_IMPORT = 'off';
    expect((await as.owner.get('/api/data/status').expect(200)).body).toEqual({ databaseEmpty: true, importAllowed: false });
    for (const who of ['owner', 'pm']) {
      for (const path of ['/api/data/import', '/api/data/import?dryRun=true', '/api/core/import']) {
        const res = await as[who].post(path).send({ clients: [client('c-imp')] });
        expect(res.status, `${who} ${path}`).toBe(403);
        expect(res.body.error).toBe('import_disabled');
        expect(res.body.message).toMatch(/NWOS_BROWSER_IMPORT/);
      }
    }
    expect(await count()).toBe(0);
  });

  it('off: normal saving still works, and the database is no longer empty', async () => {
    process.env.NWOS_BROWSER_IMPORT = 'off';
    await as.owner.post('/api/data/sync').send({ upserts: { clients: [client('c-sync')] }, deletes: {} }).expect(200);
    expect(await count()).toBe(1);
    expect((await as.owner.get('/api/data/status').expect(200)).body).toEqual({ databaseEmpty: false, importAllowed: false });
    // Permissions are unchanged: a Project Manager still cannot create clients.
    expect((await as.pm.post('/api/data/sync').send({ upserts: { clients: [client('c-pm')] }, deletes: {} })).status).toBe(403);
  });

  it('on: only settings.manage may import, existing records are skipped, never overwritten', async () => {
    process.env.NWOS_BROWSER_IMPORT = 'on';
    expect((await as.owner.get('/api/data/status').expect(200)).body.importAllowed).toBe(true);
    expect((await as.pm.post('/api/data/import').send({ clients: [client('c-imp')] })).status).toBe(403);
    const res = await as.owner.post('/api/data/import').send({ clients: [{ ...client('c-sync'), company_name: 'Overwrite?' }, client('c-imp')] }).expect(200);
    expect(res.body.summary.clients).toMatchObject({ new: 1, skippedExisting: 1 });
    expect((await db.pool.query(`SELECT company_name AS n FROM clients WHERE id = 'c-sync'`)).rows[0].n).toBe('Synthetic c-sync');
  });

  it('unset in production: off', async () => {
    delete process.env.NWOS_BROWSER_IMPORT;
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect((await as.owner.get('/api/data/status').expect(200)).body.importAllowed).toBe(false);
      const res = await as.owner.post('/api/data/import?dryRun=true').send({});
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('import_disabled');
    } finally {
      process.env.NODE_ENV = env;
    }
  });
});
