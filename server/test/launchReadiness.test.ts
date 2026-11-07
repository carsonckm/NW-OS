import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, closeSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createPool } from '../db/pool';
import { bootstrapRoles, ident } from '../db/roles';
import { buildApp, signIn } from './app';
import { setupDemoWorld, USERS } from './demoWorld';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL } from './db';

// Opt-in only. The CI-owned loopback service is the only permitted target.
const container = process.env.NWOS_LAUNCH_CONTAINER;
const recoveryContainer = process.env.NWOS_RECOVERY_CONTAINER;
const recoveryUrl = 'postgres://recovery:recovery@localhost:5434/recovery_admin';
const fixtureUrl = 'postgres://nwos:nwos@localhost:5432/nwos_test';

it.skipIf(!container)('rehearses sustained concurrent use, disconnect recovery and a logical restore', async () => {
  expect(container).toMatch(/^[0-9a-f]{12,64}$/);
  expect(recoveryContainer).toMatch(/^[0-9a-f]{12,64}$/);
  expect(TEST_DATABASE_URL).toBe(fixtureUrl);
  expect(TEST_DATABASE_ADMIN_URL).toBe(fixtureUrl);
  const world = await setupDemoWorld({ restricted: true });
  const admin = createPool({ connectionString: fixtureUrl });
  const recoveryAdmin = createPool({ connectionString: recoveryUrl });
  let recoveryOwner: ReturnType<typeof createPool> | undefined;
  const dir = mkdtempSync(join(tmpdir(), 'nwos-rehearsal-'));
  const dump = join(dir, 'synthetic.dump');
  const target = 'restore_' + randomUUID().replaceAll('-', '');
  let restored: ReturnType<typeof createPool> | undefined;
  let restarted: ReturnType<typeof createPool> | undefined;
  let targetCreated = false;
  const postgresTool = (tool: string, args: string[]) => [
    'exec', '-i', '-e', 'PGPASSWORD=nwos', container!, tool,
    '-h', '127.0.0.1', '-U', 'nwos', ...args,
  ];
  try {
    const latencies: number[] = [];
    const started = performance.now();
    const deadline = started + 180_000;
    const writes: number[] = [];
    const reportIds: string[] = [];
    const reportItem = (await world.db.pool.query("SELECT id FROM work_items WHERE project_id = 'proj-1' LIMIT 1")).rows[0].id;
    const users = await Promise.allSettled(USERS.map(async (user) => {
      const agent = world.as[user.role];
      let iteration = 0;
      while (performance.now() < deadline) {
        const before = performance.now();
        iteration++;
        if (['Owner / CEO', 'Production Staff'].includes(user.role) && iteration % 5 === 0) {
          const id = 'issue-' + randomUUID();
          const report = { id, work_item_id: reportItem, title: 'Synthetic pilot load issue', description: 'Disposable load and recovery fixture' };
          await agent.post('/api/issues/factory-report').send(report).timeout(5000).expect(200);
          writes.push(performance.now() - before);
          reportIds.push(id);
          if (iteration % 20 === 0) await agent.post('/api/issues/factory-report').send(report).timeout(5000).expect(200);
        } else if (user.role === 'Owner / CEO' && iteration % 10 === 1) {
          await agent.get('/api/data/snapshot').timeout(5000).expect(200);
        } else {
          const response = await agent.get('/api/auth/session').timeout(5000).expect(200);
          expect(response.body.user?.id).toBe(user.id);
        }
        latencies.push(performance.now() - before);
        await pause(100);
      }
    }));
    for (const result of users) if (result.status === 'rejected') throw result.reason;
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1];
    writes.sort((a, b) => a - b);
    const writeP95 = writes[Math.ceil(writes.length * 0.95) - 1];
    expect(writes.length).toBeGreaterThan(40);
    expect(writeP95).toBeLessThan(2000);
    const reports = await world.db.pool.query('SELECT count(*)::int AS n FROM issues WHERE id = ANY($1)', [reportIds]);
    expect(reports.rows[0].n).toBe(reportIds.length);
    const audits = await world.db.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE entity_type = 'issues' AND action = 'create' AND entity_id = ANY($1)", [reportIds]);
    expect(audits.rows[0].n).toBe(reportIds.length);
    console.log(JSON.stringify({ rehearsal: 'load', writes: writes.length, writeP95Ms: Math.round(writeP95), users: USERS.length, requests: latencies.length, elapsedMs: Math.round(performance.now() - started), p95Ms: Math.round(p95) }));
    expect(latencies.length).toBeGreaterThan(300);
    expect(p95).toBeLessThan(2000);

    const original = await world.db.pool.query("SELECT project_name FROM projects WHERE id = 'proj-1'");
    expect(original.rowCount).toBe(1);
    const client = await world.db.pool.connect();
    client.on('error', () => { /* Expected when the rehearsal terminates this connection. */ });
    try {
      await client.query('BEGIN');
      await client.query("UPDATE projects SET project_name = 'UNCOMMITTED QA' WHERE id = 'proj-1'");
      const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      const interrupted = client.query('SELECT pg_sleep(20)').then(() => false, () => true);
      try {
        expect((await admin.query('SELECT pg_terminate_backend($1) AS killed', [pid])).rows[0].killed).toBe(true);
      } finally {
        expect(await interrupted).toBe(true);
      }
    } finally {
      client.release(true);
    }
    expect((await world.db.pool.query("SELECT project_name FROM projects WHERE id = 'proj-1'")).rows).toEqual(original.rows);
    await request(world.app).get('/api/health').expect(200);

    const stopped = world.db.connect();
    const unavailableApp = buildApp(stopped);
    await stopped.end();
    await request(unavailableApp).get('/api/health/live').expect(200);
    await request(unavailableApp).get('/api/health').expect(503);
    restarted = world.db.connect();
    const restartedApp = buildApp(restarted);
    await request(restartedApp).get('/api/health').expect(200);
    await signIn(restartedApp, USERS[0].email);

    const attachment = Buffer.concat([Buffer.from('%PDF-1.7\nSynthetic pilot attachment\n'), Buffer.alloc(4096, 32), Buffer.from('\n%%EOF')]);
    const issueId = reportIds[0];
    const uploaded = await world.as['Owner / CEO']
      .post('/api/files?purpose=attachment&record_collection=issues&record_id=' + encodeURIComponent(issueId))
      .set({ 'Content-Type': 'application/octet-stream', 'X-NWOS-Upload': '1', 'X-File-Name': 'synthetic-pilot.pdf' })
      .send(attachment).expect(201);
    const tableNames = (await world.db.pool.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename")).rows.map(row => String(row.tablename));
    const fingerprint = async (pool: ReturnType<typeof createPool>, table: string) => (
      await pool.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text), '')) AS digest FROM ${ident(table)} t`)
    ).rows;
    // Capture every table before the dump. No application requests mutate the source after this point.
    const expected = new Map<string, unknown>();
    for (const table of tableNames) expected.set(table, await fingerprint(world.db.owner, table));
    const restoreStart = performance.now();
    const file = openSync(dump, 'wx', 0o600);
    try {
      execFileSync('docker', postgresTool('pg_dump', ['-d', 'nwos_test', '-Fc', '-n', world.db.schema]), {
        stdio: ['ignore', file, 'pipe'], timeout: 30_000,
      });
    } finally {
      closeSync(file);
    }
    await recoveryAdmin.query(`CREATE DATABASE "${target}"`);
    targetCreated = true;
    const input = openSync(dump, 'r');
    try {
      execFileSync('docker', [
        'exec', '-i', '-e', 'PGPASSWORD=recovery', recoveryContainer!, 'pg_restore',
        '-h', '127.0.0.1', '-U', 'recovery', '-d', target,
        '--no-owner', '--no-acl', '--exit-on-error', '--single-transaction',
      ], { stdio: [input, 'ignore', 'pipe'], timeout: 30_000 });
    } finally {
      closeSync(input);
    }
    const destination = new URL(recoveryUrl);
    destination.pathname = '/' + target;
    recoveryOwner = createPool({ connectionString: destination.toString(), options: `-c search_path=${world.db.schema}` });
    const provision = await recoveryOwner.connect();
    const appPassword = randomUUID();
    const migratorPassword = randomUUID();
    try {
      await bootstrapRoles(provision, {
        schema: world.db.schema, roles: world.db.restricted!.roles,
        appPassword, migratorPassword, transferDatabase: true,
      });
    } finally {
      provision.release();
    }
    const runtime = new URL(destination);
    runtime.username = world.db.restricted!.roles.app;
    runtime.password = appPassword;
    restored = createPool({ connectionString: runtime.toString(), options: `-c search_path=${world.db.schema}` });
    for (const table of tableNames) expect(await fingerprint(recoveryOwner, table), table).toEqual(expected.get(table));
    expect((await restored.query("SELECT project_name FROM projects WHERE id = 'proj-1'")).rows).toEqual(original.rows);
    expect((await restored.query("SELECT has_table_privilege(current_user, 'audit_logs', 'DELETE') AS allowed")).rows).toEqual([{ allowed: false }]);
    expect((await restored.query('SELECT pg_has_role(current_user, $1, $2) AS member', [world.db.restricted!.roles.owner, 'MEMBER'])).rows).toEqual([{ member: false }]);
    expect((await recoveryOwner.query('SELECT sha256, bytes FROM files JOIN file_contents ON file_id = files.id WHERE files.id = $1', [uploaded.body.id])).rows).toEqual([{
      sha256: createHash('sha256').update(attachment).digest('hex'), bytes: attachment,
    }]);
    const recoveredApp = buildApp(restored);
    await request(recoveredApp).get('/api/health').expect(200);
    const recoveredOwner = await signIn(recoveredApp, USERS[0].email);
    const downloaded = await recoveredOwner.get(uploaded.body.url).buffer(true).parse((response, done) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => done(null, Buffer.concat(chunks)));
      response.on('error', done);
    }).expect(200);
    expect(downloaded.body).toEqual(attachment);
    const recoveredStaff = await signIn(recoveredApp, 'staff@test.local');
    await recoveredStaff.get(uploaded.body.url).expect(404);
    await request(recoveredApp).get(uploaded.body.url).expect(401);
    console.log(JSON.stringify({ rehearsal: 'restore', elapsedMs: Math.round(performance.now() - restoreStart), rollbackVerified: true, restrictedRoleVerified: true, separateInstance: true, tablesVerified: tableNames.length, attachmentVerified: true }));
  } finally {
    await restored?.end();
    await restarted?.end();
    await recoveryOwner?.end();
    if (targetCreated) await recoveryAdmin.query(`DROP DATABASE "${target}"`);
    await recoveryAdmin.end();
    await admin.end();
    await world.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 420_000);
