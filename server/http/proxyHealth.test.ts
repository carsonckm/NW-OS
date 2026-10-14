/**
 * Pilot: client addresses from an explicitly trusted proxy only (TRUST_PROXY), and health checks
 * that test the database without revealing anything sensitive.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AutomationEngine } from '../automation/engine';
import { createPool } from '../db/pool';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { buildApp, TEST_PASSWORD } from '../test/app';
import { ProxyConfigError, trustProxySetting } from './proxy';

describe('TRUST_PROXY parsing', () => {
  it('trusts nothing by default and accepts only explicit hops or addresses', () => {
    expect(trustProxySetting({})).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: 'false' })).toBe(false);
    expect(trustProxySetting({ TRUST_PROXY: '1' })).toBe(1);
    expect(trustProxySetting({ TRUST_PROXY: 'loopback, 10.0.0.0/8, 2001:db8::/32' })).toEqual(['loopback', '10.0.0.0/8', '2001:db8::/32']);
    for (const bad of ['true', 'TRUE', '0', '6', '10', 'abc', '10.0.0.0/99', '10.0.0.1/8/2', 'example.com']) {
      expect(() => trustProxySetting({ TRUST_PROXY: bad }), bad).toThrow(ProxyConfigError);
    }
  });
});

describe('scheduler state for the health check', () => {
  it('is off until started, then running while it ticks, stale when it stops ticking', () => {
    const engine = new AutomationEngine(undefined as never) as any;
    expect(engine.schedulerState()).toBe('off');
    engine.timer = {};
    engine.intervalMs = 30_000;
    engine.startedAt = 1_000_000;
    expect(engine.schedulerState(1_000_000 + 10_000)).toBe('starting');
    expect(engine.schedulerState(1_000_000 + 100_000)).toBe('stale');
    engine.lastTickAt = 2_000_000;
    expect(engine.schedulerState(2_000_000 + 60_000)).toBe('running');
    expect(engine.schedulerState(2_000_000 + 91_000)).toBe('stale');
  });
});

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('client address and health (real runtime role)', () => {
  let db: TestDb;
  beforeAll(async () => {
    ({ db } = (await setupDemoWorld({ restricted: true })) as never);
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  /** Signs in with the given forwarding header and returns the address the audit trail recorded. */
  async function recordedIp(trustProxy: string | undefined, forwardedFor: string) {
    const before = process.env.TRUST_PROXY;
    if (trustProxy === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = trustProxy;
    try {
      const app = buildApp(db.pool);
      const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', forwardedFor).send({ email: 'site@test.local', password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const row = (await db.owner.query(`SELECT ip FROM audit_logs WHERE action = 'login' AND actor_id = 'user-site' ORDER BY id DESC LIMIT 1`)).rows[0];
      const session = (await db.owner.query(`SELECT ip FROM sessions WHERE user_id = 'user-site' ORDER BY created_at DESC LIMIT 1`)).rows[0];
      expect(session.ip).toBe(row.ip);
      return row.ip as string;
    } finally {
      if (before === undefined) delete process.env.TRUST_PROXY;
      else process.env.TRUST_PROXY = before;
    }
  }

  it('ignores X-Forwarded-For unless a proxy is explicitly trusted', async () => {
    const ip = await recordedIp(undefined, '203.0.113.9');
    expect(ip).not.toContain('203.0.113.9');
    expect(ip).toMatch(/127\.0\.0\.1|::1/);
  });

  it('with a trusted proxy, records the address that proxy saw, never one the client wrote', async () => {
    // The client claims 203.0.113.9; the trusted proxy appended the real peer 198.51.100.7.
    expect(await recordedIp('1', '203.0.113.9, 198.51.100.7')).toBe('198.51.100.7');
    expect(await recordedIp('loopback', '203.0.113.9, 198.51.100.7')).toBe('198.51.100.7');
    // Trusting a proxy at another address: the local peer is not it, so nothing is believed.
    expect(await recordedIp('10.9.9.9', '203.0.113.9')).toMatch(/127\.0\.0\.1|::1/);
  });

  it('reports the database and scheduler without anything sensitive', async () => {
    const app = buildApp(db.pool);
    const res = await request(app).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'ok', scheduler: 'off' });
    expect(Object.keys(res.body).sort()).toEqual(['ai_configured', 'database', 'scheduler', 'status', 'system', 'timestamp']);
    expect(res.headers['cache-control']).toBe('no-store');
    await request(app).get('/api/health/live').expect(200, { status: 'ok' });
  });

  it('answers 503 when the database is unreachable, without the error', async () => {
    const dead = createPool({ connectionString: 'postgres://nobody:secret-password@127.0.0.1:1/none', max: 1, connectionTimeoutMillis: 500 });
    try {
      const app = buildApp(dead);
      const res = await request(app).get('/api/health').expect(503);
      expect(res.body).toMatchObject({ status: 'degraded', database: 'unavailable' });
      expect(JSON.stringify(res.body)).not.toMatch(/secret|ECONNREFUSED|127\.0\.0\.1|nobody/);
      await request(app).get('/api/health/live').expect(200);
    } finally {
      await dead.end().catch(() => {});
    }
  });

  it('demo mode (no database) is healthy and says so', async () => {
    const res = await request(buildApp()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ database: 'not_configured', scheduler: 'not_configured' });
  });
});
