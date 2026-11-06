import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, closeSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createPool } from '../db/pool';
import { buildApp, signIn } from './app';
import { setupDemoWorld, USERS } from './demoWorld';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL } from './db';

// Opt-in only. The CI-owned loopback service is the only permitted target.
const container = process.env.NWOS_LAUNCH_CONTAINER;
const fixtureUrl = 'postgres://nwos:nwos@localhost:5432/nwos_test';

it.skipIf(!container)('rehearses sustained concurrent use, disconnect recovery and a logical restore', async () => {
  expect(container).toMatch(/^[0-9a-f]{12,64}$/);
  expect(TEST_DATABASE_URL).toBe(fixtureUrl);
  expect(TEST_DATABASE_ADMIN_URL).toBe(fixtureUrl);
  const world = await setupDemoWorld({ restricted: true });
  const admin = createPool({ connectionString: fixtureUrl });
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
    const deadline = started + 90_000;
    const users = await Promise.allSettled(USERS.map(async (user) => {
      const agent = world.as[user.role];
      let iteration = 0;
      while (performance.now() < deadline) {
        const before = performance.now();
        if (user.role === 'Owner / CEO' && iteration++ % 10 === 0) {
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
    console.log(JSON.stringify({ rehearsal: 'load', users: USERS.length, requests: latencies.length, elapsedMs: Math.round(performance.now() - started), p95Ms: Math.round(p95) }));
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

    const restoreStart = performance.now();
    const file = openSync(dump, 'wx', 0o600);
    try {
      execFileSync('docker', postgresTool('pg_dump', ['-d', 'nwos_test', '-Fc', '-n', world.db.schema]), {
        stdio: ['ignore', file, 'pipe'], timeout: 30_000,
      });
    } finally {
      closeSync(file);
    }
    await admin.query(`CREATE DATABASE "${target}"`);
    targetCreated = true;
    const input = openSync(dump, 'r');
    try {
      execFileSync('docker', postgresTool('pg_restore', ['-d', target, '--exit-on-error', '--single-transaction']), {
        stdio: [input, 'ignore', 'pipe'], timeout: 30_000,
      });
    } finally {
      closeSync(input);
    }
    const runtime = new URL(world.db.restricted!.appUrl);
    runtime.pathname = '/' + target;
    restored = createPool({ connectionString: runtime.toString(), options: `-c search_path=${world.db.schema}` });
    for (const table of ['projects', 'work_items', 'approvals', 'audit_logs']) {
      const sql = `SELECT count(*)::int AS n FROM ${table}`;
      expect((await restored.query(sql)).rows).toEqual((await world.db.pool.query(sql)).rows);
    }
    expect((await restored.query("SELECT project_name FROM projects WHERE id = 'proj-1'")).rows).toEqual(original.rows);
    expect((await restored.query("SELECT has_table_privilege(current_user, 'audit_logs', 'DELETE') AS allowed")).rows).toEqual([{ allowed: false }]);
    const recoveredApp = buildApp(restored);
    await request(recoveredApp).get('/api/health').expect(200);
    await signIn(recoveredApp, USERS[0].email);
    console.log(JSON.stringify({ rehearsal: 'restore', elapsedMs: Math.round(performance.now() - restoreStart), rollbackVerified: true, restrictedRoleVerified: true }));
  } finally {
    await restored?.end();
    await restarted?.end();
    if (targetCreated) await admin.query(`DROP DATABASE "${target}"`);
    await admin.end();
    await world.db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 210_000);
