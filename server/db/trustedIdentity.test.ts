/**
 * Phase 6 Batch 12B: trusted identity, tested with the real restricted runtime credential
 * (nwos_app). Every attack is direct SQL on that credential, the position of someone who has
 * only the application's database password. The legitimate paths go through the API.
 *
 *   1. no Owner session can be created           7. ordinary users cannot do Owner-only things
 *   2. no user can be promoted                   8. Admins cannot manage Admins (or Owners)
 *   3. no project assignment can be changed      9. background jobs cannot act as a person
 *   4. no authority record can be changed       10. identity never leaks between pooled transactions
 *   5. a forged session token is refused        11. existing passwords keep working after migration 031
 *   6. the Owner can do what the Owner may do   12. a revoked session stops authorizing at once
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccessContext } from '../auth/access';
import { legacyHashPassword } from '../auth/password';
import { AuthStore, SESSION_COOKIE } from '../auth/store';
import { SYSTEM_USER } from '../automation/engine';
import { resolveApprovalAuthority } from '../modules/authorityResolver';
import { createPool, type Pool, type PoolClient } from './pool';
import { migrate, MIGRATIONS_DIR } from './migrate';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { TEST_PASSWORD, seedUsers } from '../test/app';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('Phase 6 batch 12B: trusted identity (as the real runtime role)', () => {
  let db: TestDb;
  let app: any;
  let as: Record<string, request.Agent> = {};
  let appPool: Pool;
  let store: AuthStore;
  beforeAll(async () => {
    ({ db, app, as } = (await setupDemoWorld({ restricted: true })) as never);
    appPool = db.pool;
    store = new AuthStore(appPool);
    await seedUsers(db.owner, [{ id: 'user-admin2', role: 'Admin', email: 'admin2@test.local' }]);
  });
  afterAll(async () => {
    await db?.close();
  });

  const owner = () => as['Owner / CEO'];
  const token = async (email: string) => {
    const r = await store.login(email, TEST_PASSWORD, {});
    if (r.status !== 'ok') throw new Error(`login ${email}: ${r.status}`);
    return r.token;
  };
  /** Runs statements in one transaction on the runtime credential; returns the error, if any. */
  const tx = async (fn: (c: PoolClient) => Promise<unknown>) => {
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      await fn(c);
      await c.query('COMMIT');
      return undefined;
    } catch (err) {
      await c.query('ROLLBACK').catch(() => {});
      return err as Error & { code?: string };
    } finally {
      c.release();
    }
  };
  const refused = async (sql: string, params: unknown[] = [], as?: string) => {
    const err = await tx(async (c) => {
      if (as) await c.query('SELECT auth_assume($1)', [as]);
      await c.query(sql, params);
    });
    expect(err, sql).toBeDefined();
    return err!;
  };
  const role = async (id: string) => (await db.owner.query('SELECT role FROM users WHERE id = $1', [id])).rows[0].role;

  it('runs as the restricted runtime role, not the table owner', async () => {
    const r = (await appPool.query(`SELECT current_user AS u, pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'users'::regclass), 'MEMBER') AS owner`)).rows[0];
    expect(r.u).toBe(db.restricted!.roles.app);
    expect(r.owner).toBe(false);
  });

  // ------------------------------------------------------------------ 1
  describe('1. direct SQL cannot create an Owner session (the Batch 12 probe)', () => {
    it('sessions, credentials and the identity table are out of reach', async () => {
      const t = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
      const hash = (await appPool.query(`SELECT encode(sha256(convert_to($1, 'UTF8')), 'hex') AS h`, [t])).rows[0].h;
      for (const sql of [
        [`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, 'user-owner', now() + interval '1 day')`, [hash]],
        [`SELECT * FROM sessions`, []],
        [`UPDATE sessions SET user_id = 'user-owner'`, []],
        [`SELECT * FROM auth_credentials`, []],
        [`UPDATE auth_credentials SET verifier = $1`, ['0'.repeat(64)]],
        [`INSERT INTO auth_tx_identity (backend_pid, txid, user_id, session_hash) VALUES (pg_backend_pid(), txid_current(), 'user-owner', 'x')`, []],
        [`SELECT * FROM auth_config`, []],
        [`DELETE FROM auth_login_failures`, []],
      ] as const) {
        expect((await refused(sql[0], [...sql[1]])).message, sql[0]).toMatch(/permission denied/);
      }
      // The forged cookie gets nothing.
      const res = await request(app).get('/api/auth/session').set('Cookie', `${SESSION_COOKIE}=${t}`);
      expect(res.body.user).toBeNull();
    });

    it('only the internal functions can create a session, and only with the password-derived key', async () => {
      for (const fn of ['auth_identity()', `auth_exempt('users'::regclass)`, `auth_refuse('x')`]) {
        expect((await refused(`SELECT ${fn}`)).message, fn).toMatch(/permission denied/);
      }
      const wrong = (await appPool.query(`SELECT * FROM auth_login('owner@test.local', $1, null, null)`, ['ab'.repeat(32)])).rows[0];
      expect(wrong).toMatchObject({ status: 'invalid', token: null });
      const params = (await appPool.query(`SELECT auth_password_params('owner@test.local') AS p`)).rows[0].p;
      expect(params).toMatchObject({ scheme: 'scrypt', N: 32768 });
      expect(JSON.stringify(params)).not.toMatch(/verifier/);
      // Unknown emails get stable, plausible parameters (no enumeration).
      const a = (await appPool.query(`SELECT auth_password_params('nobody@test.local') AS p`)).rows[0].p;
      const b = (await appPool.query(`SELECT auth_password_params('nobody@test.local') AS p`)).rows[0].p;
      expect(a).toEqual(b);
      expect(Object.keys(a).sort()).toEqual(Object.keys(params).sort());
    });

    it('the database limits failed logins per account (10 in 15 minutes), even with the right password afterwards', async () => {
      await seedUsers(db.owner, [{ id: 'user-lock', role: 'Purchasing', email: 'lock@test.local' }]);
      for (let i = 0; i < 10; i++) expect((await store.login('lock@test.local', 'wrong-password-123', {})).status).toBe('invalid');
      expect((await store.login('lock@test.local', TEST_PASSWORD, {})).status).toBe('locked');
      await db.owner.query(`DELETE FROM auth_login_failures WHERE user_id = 'user-lock'`);
      expect((await store.login('lock@test.local', TEST_PASSWORD, {})).status).toBe('ok');
    });
  });

  // ------------------------------------------------------------------ 2
  describe('2. direct SQL cannot promote a user or create one', () => {
    it('without an identity, and with an ordinary user\'s own valid session', async () => {
      const pmToken = await token('pm@test.local');
      for (const t of [undefined, pmToken]) {
        await refused(`UPDATE users SET role = 'Owner / CEO' WHERE id = 'user-pm'`, [], t);
        await refused(`UPDATE users SET role = 'Admin' WHERE id = 'user-site'`, [], t);
        await refused(`UPDATE users SET is_active = false WHERE id = 'user-owner'`, [], t);
        await refused(`UPDATE users SET owner_priority = 1000, is_primary_owner = true WHERE id = 'user-pm'`, [], t);
        await refused(`INSERT INTO users (id, name, email, role) VALUES ('user-evil', 'Evil', 'evil@test.local', 'Owner / CEO')`, [], t);
        await refused(`DELETE FROM users WHERE id = 'user-owner'`, [], t);
        await refused(`SELECT auth_set_password('user-owner', '{"N":16384,"r":8,"p":1,"keylen":64}', 'c2FsdA', $1)`, ['ab'.repeat(32)], t);
      }
      expect(await role('user-pm')).toBe('Project Manager');
      expect((await db.owner.query(`SELECT count(*)::int AS n FROM users WHERE id = 'user-evil'`)).rows[0].n).toBe(0);
      // Recording a login time (what auth_login does) is the only change allowed without one.
      await appPool.query(`UPDATE users SET last_login = now() WHERE id = 'user-pm'`);
    });
  });

  // ------------------------------------------------------------------ 3
  describe('3. direct SQL cannot change project assignments', () => {
    it('insert or delete, without an identity or as an ordinary user', async () => {
      const pmToken = await token('pm@test.local');
      for (const t of [undefined, pmToken]) {
        await refused(`INSERT INTO project_assignments (user_id, project_id) VALUES ('user-pm', 'proj-x')`, [], t);
        await refused(`DELETE FROM project_assignments WHERE user_id = 'user-prod-mgr'`, [], t);
      }
      expect((await db.owner.query(`SELECT count(*)::int AS n FROM project_assignments WHERE user_id = 'user-pm' AND project_id = 'proj-x'`)).rows[0].n).toBe(0);
    });
  });

  // ------------------------------------------------------------------ 4
  describe('4. direct SQL cannot change authority records without the verified Owner', () => {
    it('rules, absences, sensitivity, WhatsApp identities, decision types, legacy reviews', async () => {
      const pmToken = await token('pm@test.local');
      const rule = (await db.owner.query(`SELECT id FROM delegated_authorities WHERE NOT locked AND kind = 'system' AND active LIMIT 1`)).rows[0].id;
      const off = (await db.owner.query(`SELECT id FROM delegated_authorities WHERE NOT locked AND NOT active LIMIT 1`)).rows[0]?.id;
      for (const t of [undefined, pmToken]) {
        await refused(`INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, target_user_id, priority) VALUES ('da-evil', 'DA-EVIL', 'x', 'x', 'owner', 'allow', 'purchase', 'user-pm', 999)`, [], t);
        await refused(`UPDATE delegated_authorities SET max_value = NULL, target_role = 'Project Manager' WHERE id = $1`, [rule], t);
        if (off) await refused(`UPDATE delegated_authorities SET active = true WHERE id = $1`, [off], t);
        await refused(`DELETE FROM delegated_authorities WHERE id = $1`, [rule], t);
        await refused(`INSERT INTO owner_absences (id, owner_id, backup_user_id, start_at, end_at, decision_types, reason, status, created_by) VALUES ('abs-evil', 'user-owner', 'user-pm', now(), now() + interval '30 days', '{purchase}', 'x', 'active', 'user-owner')`, [], t);
        await refused(`UPDATE projects SET sensitivity = 'Strategic' WHERE id = 'proj-1'`, [], t);
        await refused(`INSERT INTO whatsapp_contacts (phone, user_id, verified) VALUES ('+60111111111', 'user-owner', true)`, [], t);
        await refused(`UPDATE authority_decision_types SET active = false`, [], t);
      }
      await db.owner.query(`UPDATE projects SET sensitivity = 'Strategic' WHERE id = 'proj-2'`);
      await refused(`UPDATE projects SET sensitivity = 'Normal' WHERE id = 'proj-2'`);
      await db.owner.query(`UPDATE projects SET sensitivity = 'Normal' WHERE id = 'proj-2'`);
      // Switching authority off without an identity is the background watch's one permitted change.
      const err = await tx((c) => c.query(`UPDATE delegated_authorities SET active = false, deactivation_reason = 'x' WHERE id = $1`, [rule]));
      expect(err).toBeUndefined();
      await db.owner.query(`UPDATE delegated_authorities SET active = true, deactivation_reason = NULL WHERE id = $1`, [rule]);
    });
  });

  // ------------------------------------------------------------------ 5
  describe('5. a forged session token is refused', () => {
    it('by the API and by auth_assume', async () => {
      for (const forged of ['x', randomUUID(), 'ab'.repeat(32)]) {
        expect((await request(app).get('/api/users').set('Cookie', `${SESSION_COOKIE}=${forged}`)).status).toBe(401);
        const err = await refused(`SELECT 1`, [], forged);
        expect(err.message).toMatch(/session is not valid/);
      }
    });
  });

  // ------------------------------------------------------------------ 6
  describe('6. the legitimate Owner can do what the Owner may do (API, verified identity)', () => {
    it('create a user, change a role, assign projects, create a rule, change sensitivity', async () => {
      const u = (await owner().post('/api/users').send({ name: 'New PM', email: 'newpm@test.local', role: 'Project Manager', password: 'a-long-password-123' }).expect(201)).body;
      await owner().patch(`/api/users/${u.id}`).send({ role: 'Site Supervisor' }).expect(200);
      await owner().put(`/api/users/${u.id}/projects`).send({ project_ids: ['proj-1'] }).expect(200);
      const r = (await owner().post('/api/authority/rules').send({ name: 'B12B', description: 'x', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: 'proj-1', max_value: 1000, priority: 120 }).expect(201)).body;
      await owner().post(`/api/authority/rules/${r.id}/deactivate`).send({ reason: 'test' }).expect(200);
      await owner().put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Sensitive', reason: 'B12B test' }).expect(200);
      await owner().put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Normal', reason: 'B12B test done' }).expect(200);
      expect(await role(u.id)).toBe('Site Supervisor');
      // The audit records of these changes are attributed to the database-verified identity.
      const audit = (await db.owner.query(`SELECT action, actor_id, actor_verified FROM audit_logs WHERE action IN ('user.create', 'user.role_change', 'user.assignments') AND entity_id = $1 ORDER BY id`, [u.id])).rows;
      expect(audit.map((a) => [a.action, a.actor_id, a.actor_verified])).toEqual([['user.create', 'user-owner', true], ['user.role_change', 'user-owner', true], ['user.assignments', 'user-owner', true]]);
      // A forged attribution in the audit trail is marked unverified.
      await appPool.query(`INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type) VALUES ('user-owner', 'Owner', 'Owner / CEO', 'forged.action', 'user')`);
      expect((await db.owner.query(`SELECT actor_verified FROM audit_logs WHERE action = 'forged.action'`)).rows[0].actor_verified).toBe(false);
    });
  });

  // ------------------------------------------------------------------ 7
  describe('7. an ordinary user cannot perform Owner-only actions', () => {
    it('through the API, or through the database with their own valid session', async () => {
      const pm = as['Project Manager'];
      expect((await pm.post('/api/authority/rules').send({ name: 'x', description: 'x', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager' })).status).toBe(403);
      expect((await pm.patch('/api/users/user-pm').send({ role: 'Owner / CEO' })).status).toBe(403);
      expect((await pm.put('/api/projects/proj-1/sensitivity').send({ sensitivity: 'Normal', reason: 'x' })).status).toBe(403);
      expect((await pm.post('/api/legacy-reviews/invoice/inv-x/decision').send({ decision: 'released', reason: 'x' })).status).toBe(403);
      const pmToken = await token('pm@test.local');
      const item = (await db.owner.query(`SELECT id FROM legacy_review_items LIMIT 1`)).rows[0];
      if (item) await refused(`INSERT INTO legacy_review_decisions (item_id, decision, reason, reviewed_by_id, reviewed_by_role) VALUES ($1, 'released', 'x', 'user-owner', 'Owner / CEO')`, [item.id], pmToken);
    });
  });

  // ------------------------------------------------------------------ 8
  describe('8. Admins cannot manage other Admins (or Owners)', () => {
    it('API and database', async () => {
      const admin = as['Admin'];
      expect((await admin.patch('/api/users/user-admin2').send({ name: 'Renamed' })).status).toBe(403);
      expect((await admin.patch('/api/users/user-admin2').send({ password: 'another-password-123' })).status).toBe(403);
      expect((await admin.patch('/api/users/user-owner').send({ name: 'x' })).status).toBe(403);
      expect((await admin.post('/api/users').send({ name: 'A3', email: 'a3@test.local', role: 'Admin', password: 'a-long-password-123' })).status).toBe(403);
      expect((await admin.patch('/api/users/user-site').send({ role: 'Admin' })).status).toBe(403);
      expect((await admin.put('/api/users/user-admin2/projects').send({ project_ids: ['proj-1'] })).status).toBe(403);
      const adminToken = await token('admin@test.local');
      await refused(`UPDATE users SET name = 'x' WHERE id = 'user-admin2'`, [], adminToken);
      await refused(`UPDATE users SET role = 'Admin' WHERE id = 'user-site'`, [], adminToken);
      await refused(`UPDATE users SET is_active = false WHERE id = 'user-owner'`, [], adminToken);
      await refused(`INSERT INTO project_assignments (user_id, project_id) VALUES ('user-admin2', 'proj-1')`, [], adminToken);
      await refused(`SELECT auth_set_password('user-admin2', '{"N":16384,"r":8,"p":1,"keylen":64}', 'c2FsdA', $1)`, ['ab'.repeat(32)], adminToken);
      // An Admin still manages ordinary accounts.
      await admin.patch('/api/users/user-site').send({ title: 'Senior Supervisor' }).expect(200);
      await admin.put('/api/users/user-site/projects').send({ project_ids: ['proj-1'] }).expect(200);
    });
  });

  // ------------------------------------------------------------------ 9
  describe('9. background jobs cannot act as a person', () => {
    it('no approval authority for the automation, lifecycle or messaging contexts; no database identity', async () => {
      const apr = (await db.owner.query(`SELECT id FROM approvals LIMIT 1`)).rows[0].id;
      const sys = await AccessContext.load(appPool, SYSTEM_USER, { background: true });
      expect(await resolveApprovalAuthority(appPool, sys, { resource: { kind: 'approval', id: apr } })).toMatchObject({ allowed: false, reasonCode: 'INVALID_AUTHORITY_CONTEXT' });
      // Even a context for the real Owner, marked background (the lifecycle rule's view), decides nothing.
      const ownerRow = (await db.owner.query(`SELECT * FROM users WHERE id = 'user-owner'`)).rows[0];
      const view = await AccessContext.load(appPool, ownerRow, { background: true });
      expect((await resolveApprovalAuthority(appPool, view, { resource: { kind: 'approval', id: apr } })).allowed).toBe(false);
      // A synthetic Owner that is not an account decides nothing either.
      const fake = await AccessContext.load(appPool, { ...ownerRow, id: 'user-not-a-person' });
      expect((await resolveApprovalAuthority(appPool, fake, { resource: { kind: 'approval', id: apr } })).allowed).toBe(false);
      // In the database a background transaction has no identity: only switching authority off.
      await refused(`INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, target_role, priority) VALUES ('da-bg', 'DA-BG', 'x', 'x', 'owner', 'allow', 'variation', 'Project Manager', 100)`);
      // Owner absences: only what the dates decided (a future start is not started early).
      await db.owner.query(`INSERT INTO owner_absences (id, owner_id, backup_user_id, start_at, end_at, decision_types, reason, status, created_by) VALUES ('abs-b12b', 'user-owner', 'user-accountant', now() + interval '2 days', now() + interval '9 days', '{purchase}', 'x', 'scheduled', 'user-owner')`);
      await refused(`UPDATE owner_absences SET status = 'active', activated_at = now() WHERE id = 'abs-b12b'`);
      await db.owner.query(`UPDATE owner_absences SET start_at = now() - interval '1 minute' WHERE id = 'abs-b12b'`);
      expect(await tx((c) => c.query(`UPDATE owner_absences SET status = 'active', activated_at = now() WHERE id = 'abs-b12b'`))).toBeUndefined();
      await refused(`UPDATE owner_absences SET end_at = now() + interval '90 days' WHERE id = 'abs-b12b'`);
    });
  });

  // ------------------------------------------------------------------ 10
  describe('10. identity never leaks between pooled transactions', () => {
    it('a later transaction on the same connection has no identity', async () => {
      const pool = createPool({ connectionString: db.restricted!.appUrl, max: 1, options: `-c search_path=${db.schema}` });
      try {
        const ownerToken = await token('owner@test.local');
        const c = await pool.connect();
        const pid1 = (await c.query('SELECT pg_backend_pid() AS p')).rows[0].p;
        await c.query('BEGIN');
        await c.query('SELECT auth_assume($1)', [ownerToken]);
        await c.query(`UPDATE users SET title = 'Assumed' WHERE id = 'user-site'`);
        await c.query('COMMIT');
        // Same connection, next statement (autocommit) and next transaction: nothing carried over.
        await expect(c.query(`UPDATE users SET title = 'Leaked' WHERE id = 'user-site'`)).rejects.toThrow(/needs a signed-in Owner or Admin/);
        await c.query('BEGIN');
        await expect(c.query(`UPDATE users SET title = 'Leaked' WHERE id = 'user-site'`)).rejects.toThrow(/needs a signed-in Owner or Admin/);
        await c.query('ROLLBACK');
        c.release();
        const c2 = await pool.connect();
        expect((await c2.query('SELECT pg_backend_pid() AS p')).rows[0].p).toBe(pid1);
        await expect(c2.query(`UPDATE users SET role = 'Owner / CEO' WHERE id = 'user-site'`)).rejects.toThrow(/needs a signed-in Owner or Admin/);
        c2.release();
        expect((await db.owner.query(`SELECT title FROM users WHERE id = 'user-site'`)).rows[0].title).toBe('Assumed');
        // Concurrent transactions: each has only its own identity.
        const adminToken = await token('admin@test.local');
        const p2 = createPool({ connectionString: db.restricted!.appUrl, max: 2, options: `-c search_path=${db.schema}` });
        const [a, b] = [await p2.connect(), await p2.connect()];
        await a.query('BEGIN');
        await b.query('BEGIN');
        await a.query('SELECT auth_assume($1)', [ownerToken]);
        await b.query('SELECT auth_assume($1)', [adminToken]);
        await expect(b.query(`UPDATE users SET name = 'x' WHERE id = 'user-admin2'`)).rejects.toThrow(/Admin cannot/);
        await a.query(`UPDATE users SET title = 'Owner did it' WHERE id = 'user-admin2'`);
        // One identity per transaction.
        await expect(a.query('SELECT auth_assume($1)', [adminToken])).rejects.toThrow(/another user/);
        await a.query('ROLLBACK');
        await b.query('ROLLBACK');
        a.release();
        b.release();
        await p2.end();
      } finally {
        await pool.end();
      }
    });
  });

  // ------------------------------------------------------------------ 11
  describe('11. existing users log in after the password migration (no reset needed)', () => {
    it('a pre-031 scrypt hash converts, and the same password signs in through the database', async () => {
      const schema = `test_mig_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
      const admin = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
      await admin.query(`CREATE SCHEMA ${schema}`);
      await admin.end();
      const pool = createPool({ connectionString: TEST_DATABASE_URL, max: 2, options: `-c search_path=${schema}` });
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwos-mig-'));
      try {
        for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '031')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
        await migrate(pool, dir);
        const legacy = await legacyHashPassword('an-existing-password-1');
        await pool.query(`INSERT INTO users (id, name, email, password_hash, role) VALUES ('user-legacy', 'Legacy', 'legacy@test.local', $1, 'Accountant')`, [legacy]);
        await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('old', 'user-legacy', now() + interval '1 day')`);
        await migrate(pool);
        // Cut-over: existing sessions ended; the hash converted.
        expect((await pool.query(`SELECT count(*)::int AS n FROM sessions`)).rows[0].n).toBe(0);
        const s = new AuthStore(pool);
        expect((await s.login('legacy@test.local', 'an-existing-password-1', {})).status).toBe('ok');
        expect((await s.login('legacy@test.local', 'a-wrong-password-1', {})).status).toBe('invalid');
      } finally {
        await pool.end();
        fs.rmSync(dir, { recursive: true, force: true });
        const cleanup = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
        await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);
        await cleanup.end();
      }
    });
  });

  // ------------------------------------------------------------------ 12
  describe('12. a revoked session stops authorizing protected actions at once', () => {
    it('logout, deactivation and role change end sessions; even inside an open transaction', async () => {
      const ownerToken = await token('owner@test.local');
      const c = await appPool.connect();
      try {
        await c.query('BEGIN');
        await c.query('SELECT auth_assume($1)', [ownerToken]);
        await c.query(`UPDATE users SET title = 'Before' WHERE id = 'user-site'`);
        await appPool.query('SELECT auth_logout($1)', [ownerToken]);
        await expect(c.query(`UPDATE users SET title = 'After revoke' WHERE id = 'user-site'`)).rejects.toThrow(/needs a signed-in Owner or Admin/);
        await c.query('ROLLBACK');
      } finally {
        c.release();
      }
      // Deactivation (by the Owner) ends the user's sessions in the database.
      const siteToken = await token('site@test.local');
      expect((await appPool.query('SELECT * FROM auth_session($1)', [siteToken])).rows).toHaveLength(1);
      await owner().patch('/api/users/user-site').send({ is_active: false }).expect(200);
      expect((await appPool.query('SELECT * FROM auth_session($1)', [siteToken])).rows).toHaveLength(0);
      await owner().patch('/api/users/user-site').send({ is_active: true }).expect(200);
      // The API refuses the ended session.
      const agent = request.agent(app);
      await agent.post('/api/auth/login').send({ email: 'site@test.local', password: TEST_PASSWORD }).expect(200);
      await agent.get('/api/auth/session').expect(200).expect((r) => expect(r.body.user?.id).toBe('user-site'));
      await owner().patch('/api/users/user-site').send({ role: 'Purchasing' }).expect(200);
      expect((await agent.get('/api/auth/session')).body.user).toBeNull();
      await owner().patch('/api/users/user-site').send({ role: 'Site Supervisor' }).expect(200);
    });
  });
});
