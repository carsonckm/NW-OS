/**
 * Phase 6 Batch 12B: no carry-over of pre-031 credentials, and the activation / reset codes that
 * replace them. The attacker holds the restricted runtime credential (the real app role) AND
 * password hashes copied from users.password_hash before the upgrade (that column held the scrypt
 * key itself, readable by the runtime role). A real 030 database with separated roles is
 * upgraded to 031 by the migrator, exactly as a deployment would.
 *
 *   1-3. a stolen pre-031 Owner / Admin / ordinary hash does not authenticate
 *   4.   a stolen hash plus the runtime credential creates no Owner session
 *   5.   direct session insertion and role promotion stay blocked
 *   6.   a code cannot be reused, or used after it expires
 *   7.   an ordinary user cannot reset another account
 *   8.   an Admin cannot reset an Owner or another Admin
 *   9.   the Owner recovers through the operator's procedure (migrator credential only)
 *   10.  a newly activated account signs in with its new password
 *   11.  sessions from before the cut-over stay invalid
 *   12.  business records, roles and assignments are intact
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { legacyHashPassword } from '../auth/password';
import { AuthStore } from '../auth/store';
import { createPool, type Pool, type PoolClient } from './pool';
import { migrate, MIGRATIONS_DIR } from './migrate';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, createRestrictedRoles, dropRestricted, type RestrictedRoles } from '../test/db';
import { buildApp } from '../test/app';

type Row = Record<string, any>;
const OLD_PASSWORD = 'pre-upgrade-password-1';
const NEW_PASSWORD = 'chosen-after-upgrade-1';
const ROOT = path.resolve(__dirname, '../..');

/** The pre-031 stored format: scrypt$N$r$p$salt$key (base64url). */
const keyHexOf = (stored: string) => Buffer.from(stored.split('$')[5], 'base64url').toString('hex');

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('Phase 6 batch 12B: pre-031 credentials are not carried over (real runtime role, 030 → 031)', () => {
  const schema = `test_cred_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
  let r: RestrictedRoles;
  let migrator: Pool;
  let appPool: Pool;
  let app: any;
  const stolen: Record<string, string> = {};
  let before: Row;

  const counts = async () =>
    (await migrator.query(`SELECT (SELECT count(*) FROM projects)::int AS projects, (SELECT count(*) FROM clients)::int AS clients,
            (SELECT count(*) FROM approvals)::int AS approvals, (SELECT count(*) FROM audit_logs WHERE action = 'legacy.history')::int AS history,
            (SELECT string_agg(user_id || ':' || project_id, ',' ORDER BY user_id, project_id) FROM project_assignments) AS assignments,
            (SELECT string_agg(id || ':' || role || ':' || is_active, ',' ORDER BY id) FROM users) AS users`)).rows[0];

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
      return err as Error;
    } finally {
      c.release();
    }
  };
  const login = (email: string, password: string) => request(app).post('/api/auth/login').send({ email, password });
  const activate = (email: string, code: string, password = NEW_PASSWORD) => request(app).post('/api/auth/activate').send({ email, code, password });
  const agentFor = async (email: string, password = NEW_PASSWORD) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return agent;
  };
  /** The real recovery script, as an operator runs it. */
  const recoverOwner = (url: string, email: string) =>
    execFileSync(path.join(ROOT, 'node_modules/.bin/tsx'), ['scripts/auth-recover-owner.ts', '--email', email, '--reason', 'Cut-over to 031 (test)'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_MIGRATION_URL: url, DATABASE_URL: '', PGOPTIONS: `-c search_path=${schema}`, DOTENV_CONFIG_QUIET: 'true' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

  beforeAll(async () => {
    r = await createRestrictedRoles(schema);
    migrator = createPool({ connectionString: r.migratorUrl, max: 2, options: `-c search_path=${schema}` });
    appPool = createPool({ connectionString: r.appUrl, max: 5, options: `-c search_path=${schema}` });
    // The database as it is before the upgrade: migrations up to 030, accounts with scrypt hashes,
    // open sessions, business records and assignments.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nwos-030-'));
    try {
      for (const f of fs.readdirSync(MIGRATIONS_DIR).filter((f) => f < '031')) fs.copyFileSync(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
      await migrate(migrator, { dir, roles: r.roles });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // The runtime grants as they were at 030: the migrator just applied today's rules, which already
    // deny the runtime role the sessions table; before 031 it could read and write it.
    await migrator.query(`SET ROLE ${r.roles.owner}`);
    await migrator.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO ${r.roles.app}`);
    await migrator.query('RESET ROLE');
    const people = [
      ['user-owner', 'Owner / CEO', 'owner@legacy.test'],
      ['user-admin', 'Admin', 'admin@legacy.test'],
      ['user-admin2', 'Admin', 'admin2@legacy.test'],
      ['user-acct', 'Accountant', 'acct@legacy.test'],
      ['user-pm', 'Project Manager', 'pm@legacy.test'],
    ];
    for (const [id, role, email] of people) {
      await migrator.query(`INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)`, [id, role, email, await legacyHashPassword(OLD_PASSWORD), role]);
    }
    await migrator.query(`INSERT INTO clients (id, client_type, company_name, contact_person, phone) VALUES ('client-l', 'Company', 'Legacy client', 'C', '1')`);
    await migrator.query(`INSERT INTO projects (id, project_number, project_name, client_id, site_address, contract_value, project_status) VALUES ('proj-l', 'P-L', 'Legacy project', 'client-l', 'x', 1000, 'Active')`);
    await migrator.query(`INSERT INTO approvals (id, project_id, approval_type, decision, data) VALUES ('apr-l', 'proj-l', 'Variation', 'Approved', '{}')`);
    await migrator.query(`INSERT INTO project_assignments (user_id, project_id) VALUES ('user-pm', 'proj-l')`);
    await migrator.query(`INSERT INTO audit_logs (actor_id, action, entity_type) VALUES ('user-owner', 'legacy.history', 'project')`);
    await migrator.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (encode(sha256('old-owner-token'), 'hex'), 'user-owner', now() + interval '1 day')`);

    // Baseline (030): the runtime credential reads every password hash, and can forge an Owner session.
    for (const row of (await appPool.query(`SELECT id, password_hash FROM users`)).rows) stolen[row.id] = row.password_hash;
    expect(Object.keys(stolen)).toHaveLength(5);
    expect(await tx((c) => c.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ('forged-at-030', 'user-owner', now() + interval '1 day')`))).toBeUndefined();
    await migrator.query(`DELETE FROM sessions WHERE token_hash = 'forged-at-030'`);
    before = await counts();

    // The upgrade, by the migrator (grants re-applied).
    await migrate(migrator, { roles: r.roles });
    app = buildApp(appPool);
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await migrator?.end();
    if (r) await dropRestricted(schema, r.roles);
  });

  it('runs as the restricted runtime role', async () => {
    const me = (await appPool.query(`SELECT current_user AS u, pg_has_role(current_user, (SELECT relowner FROM pg_class WHERE oid = 'users'::regclass), 'MEMBER') AS owner`)).rows[0];
    expect(me).toEqual({ u: r.roles.app, owner: false });
  });

  describe('1-3. a stolen pre-031 hash authenticates nobody (Owner, Admin, ordinary user)', () => {
    for (const [label, id, email] of [['Owner', 'user-owner', 'owner@legacy.test'], ['Admin', 'user-admin', 'admin@legacy.test'], ['ordinary user', 'user-acct', 'acct@legacy.test']]) {
      it(`${label}: as a login proof, a password, a code or a session token`, async () => {
        const hash = stolen[id];
        const keyHex = keyHexOf(hash);
        // Directly at the database's login function, as the runtime role.
        for (const proof of [keyHex, hash, keyHex.toUpperCase()]) {
          const res = (await appPool.query(`SELECT * FROM auth_login($1, $2, 'attacker', '0.0.0.0')`, [email, proof])).rows[0];
          expect(res, proof.slice(0, 12)).toMatchObject({ status: 'invalid', token: null });
        }
        // Through the API, as a password; and the old password itself no longer works either.
        for (const pw of [hash, keyHex, OLD_PASSWORD]) expect((await login(email, pw)).status).toBe(401);
        // As an activation / reset code.
        for (const code of [hash, keyHex]) expect((await activate(email, code)).status).toBe(400);
        // As a session token.
        expect(await tx((c) => c.query('SELECT auth_assume($1)', [keyHex]))).toBeDefined();
        // Nothing of it was converted: no credential exists.
        expect((await migrator.query(`SELECT count(*)::int AS n FROM auth_credentials WHERE user_id = $1`, [id])).rows[0].n).toBe(0);
      });
    }
  });

  describe('4-5. stolen hash + runtime credential: no Owner session, no promotion', () => {
    it('every route to a session or a role is refused', async () => {
      const keyHex = keyHexOf(stolen['user-owner']);
      const attempts: [string, unknown[]][] = [
        [`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (encode(sha256($1::bytea), 'hex'), 'user-owner', now() + interval '1 day')`, [keyHex]],
        [`SELECT auth_set_password('user-owner', '{"N":32768,"r":8,"p":1,"keylen":64}', 'AAAAAAAAAAAAAAAAAAAAAA', $1)`, [keyHex]],
        [`SELECT * FROM auth_issue_reset('user-owner', 'owner_recovery', 60)`, []],
        [`SELECT * FROM auth_issue_reset('user-owner', 'reset', 60)`, []],
        [`INSERT INTO auth_credentials (user_id, scheme, params, salt, verifier) VALUES ('user-owner', 'scrypt', '{}', 'x', encode(sha256(decode($1, 'hex')), 'hex'))`, [keyHex]],
        [`INSERT INTO auth_reset_tokens (token_hash, user_id, purpose, issued_by, expires_at) VALUES ('x', 'user-owner', 'reset', 'x', now() + interval '1 day')`, []],
        [`SELECT * FROM auth_reset_tokens`, []],
        [`UPDATE users SET role = 'Owner / CEO' WHERE id = 'user-acct'`, []],
        [`INSERT INTO users (id, name, email, role) VALUES ('user-evil', 'Evil', 'evil@legacy.test', 'Owner / CEO')`, []],
      ];
      for (const [sql, params] of attempts) expect(await tx((c) => c.query(sql, params)), sql).toBeDefined();
      expect((await migrator.query(`SELECT count(*)::int AS n FROM sessions`)).rows[0].n).toBe(0);
      expect((await migrator.query(`SELECT role FROM users WHERE id = 'user-acct'`)).rows[0].role).toBe('Accountant');
      expect((await appPool.query(`SELECT * FROM auth_account_status() WHERE has_password`)).rows).toHaveLength(0);
    });
  });

  describe('11-12. the cut-over', () => {
    it('ends every earlier session; keeps identities, roles, assignments and records; leaves no hash anywhere', async () => {
      expect((await appPool.query(`SELECT * FROM auth_session('old-owner-token')`)).rows).toHaveLength(0);
      expect((await migrator.query(`SELECT count(*)::int AS n FROM sessions`)).rows[0].n).toBe(0);
      expect(await counts()).toEqual(before);
      expect((await migrator.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'users' AND column_name = 'password_hash'`, [schema])).rows[0].n).toBe(0);
      // Every account needs a new password.
      const status = (await appPool.query(`SELECT * FROM auth_account_status() ORDER BY user_id`)).rows;
      expect(status).toHaveLength(5);
      expect(status.every((s) => !s.has_password)).toBe(true);
      // No stored key or hash survives in any table the database keeps.
      const dump = JSON.stringify((await migrator.query(`SELECT to_jsonb(t) AS j FROM audit_logs t`)).rows) + JSON.stringify((await migrator.query(`SELECT to_jsonb(t) AS j FROM users t`)).rows);
      for (const h of Object.values(stolen)) {
        expect(dump).not.toContain(h.split('$')[5]);
        expect(dump).not.toContain(keyHexOf(h));
      }
    });
  });

  describe('9-10. Owner recovery, then activation', () => {
    it('only the migrator credential can run the recovery procedure', async () => {
      let refused = '';
      try {
        recoverOwner(r.appUrl, 'owner@legacy.test');
      } catch (err) {
        refused = String((err as { stderr?: string }).stderr ?? err);
      }
      expect(refused).toMatch(/does not own NW OS's tables/);
      // The application has no route that issues a recovery code.
      expect((await request(app).post('/api/users/user-owner/reset-code').send({})).status).toBe(401);
    });

    it('the operator issues a single-use code; the Owner sets a new password and signs in', async () => {
      const out = recoverOwner(r.migratorUrl, 'owner@legacy.test');
      const code = out.match(/^\s+([0-9a-f]{64})$/m)?.[1];
      expect(code).toBeDefined();
      // The code is stored only as a hash; the audit trail records the event, never the code.
      const audit = (await migrator.query(`SELECT action, actor_name, details, to_jsonb(a)::text AS j FROM audit_logs a WHERE entity_id = 'user-owner' AND action IN ('security.owner_recovery', 'auth.code_issued') ORDER BY id`)).rows;
      expect(audit.map((a) => a.action)).toEqual(['auth.code_issued', 'security.owner_recovery']);
      expect(audit[1].details).toBe('Cut-over to 031 (test)');
      expect(audit[1].actor_name).toContain(r.roles.migrator);
      for (const a of audit) expect(a.j).not.toContain(code!);
      expect((await migrator.query(`SELECT count(*)::int AS n FROM auth_reset_tokens WHERE token_hash = $1`, [code])).rows[0].n).toBe(0);
      // A weak password is refused; the code survives that.
      expect((await activate('owner@legacy.test', code!, 'short')).status).toBe(400);
      // Another account's email with this code: refused.
      expect((await activate('acct@legacy.test', code!)).status).toBe(400);
      await activate('owner@legacy.test', code!).expect(200);
      await login('owner@legacy.test', NEW_PASSWORD).expect(200);
      expect((await login('owner@legacy.test', OLD_PASSWORD)).status).toBe(401);
      // 6 (reuse): the code is spent.
      expect((await activate('owner@legacy.test', code!, 'yet-another-password-1')).status).toBe(400);
      await login('owner@legacy.test', NEW_PASSWORD).expect(200);
      expect((await migrator.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'auth.password_set' AND entity_id = 'user-owner'`)).rows[0].n).toBe(1);
    });
  });

  describe('6-8. staff codes: issued by the verified Owner (Admins for ordinary staff only)', () => {
    it('the Owner activates staff; codes are single use and expire; ordinary users and Admins are limited', async () => {
      const owner = await agentFor('owner@legacy.test');
      const authority = async () => (await migrator.query(`SELECT count(*)::int AS n FROM delegated_authorities`)).rows[0].n;
      const rulesBefore = await authority();
      const codeFor = async (agent: request.Agent, id: string) => (await agent.post(`/api/users/${id}/reset-code`).send({}).expect(200)).body.code as string;

      // The Owner issues codes for an Admin and an ordinary user; each sets their own password.
      await activate('admin@legacy.test', await codeFor(owner, 'user-admin')).expect(200);
      await activate('acct@legacy.test', await codeFor(owner, 'user-acct')).expect(200);
      const admin = await agentFor('admin@legacy.test');
      const acct = await agentFor('acct@legacy.test');

      // 6. Expired: refused even though unused.
      const late = await codeFor(owner, 'user-pm');
      await migrator.query(`UPDATE auth_reset_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL AND user_id = 'user-pm'`);
      expect((await activate('pm@legacy.test', late)).body.error).toBe('code_expired');
      // A newer code withdraws the older one.
      const first = await codeFor(owner, 'user-pm');
      const second = await codeFor(owner, 'user-pm');
      expect((await activate('pm@legacy.test', first)).status).toBe(400);
      await activate('pm@legacy.test', second).expect(200);

      // 7. An ordinary user cannot reset another account (API, and SQL with their own session).
      for (const target of ['user-pm', 'user-admin', 'user-owner']) expect((await acct.post(`/api/users/${target}/reset-code`).send({})).status).toBe(403);
      const acctToken = (await new AuthStore(appPool).login('acct@legacy.test', NEW_PASSWORD, {}));
      if (acctToken.status !== 'ok') throw new Error('acct login');
      expect(await tx(async (c) => { await c.query('SELECT auth_assume($1)', [acctToken.token]); await c.query(`SELECT * FROM auth_issue_reset('user-pm', 'reset', 60)`); })).toBeDefined();

      // 8. An Admin cannot reset an Owner or another Admin (API and SQL), nor itself; it can reset ordinary staff.
      for (const target of ['user-owner', 'user-admin2', 'user-admin']) expect((await admin.post(`/api/users/${target}/reset-code`).send({})).status).toBe(403);
      const adminToken = await new AuthStore(appPool).login('admin@legacy.test', NEW_PASSWORD, {});
      if (adminToken.status !== 'ok') throw new Error('admin login');
      for (const target of ['user-owner', 'user-admin2']) {
        const err = await tx(async (c) => { await c.query('SELECT auth_assume($1)', [adminToken.token]); await c.query(`SELECT * FROM auth_issue_reset($1, 'reset', 60)`, [target]); });
        expect(err?.message, target).toMatch(/Admin cannot reset an Owner or Admin/);
      }
      // Even the verified Owner cannot issue the operator's recovery code, or reset itself.
      const ownerToken = await new AuthStore(appPool).login('owner@legacy.test', NEW_PASSWORD, {});
      if (ownerToken.status !== 'ok') throw new Error('owner login');
      expect((await tx(async (c) => { await c.query('SELECT auth_assume($1)', [ownerToken.token]); await c.query(`SELECT * FROM auth_issue_reset('user-acct', 'owner_recovery', 60)`); }))?.message).toMatch(/operator/);
      expect((await owner.post('/api/users/user-owner/reset-code').send({})).status).toBe(403);

      // An Admin resets ordinary staff: password and sessions end at once; role and authority unchanged.
      const code = await codeFor(admin, 'user-acct');
      expect((await acct.get('/api/users')).status).toBe(401);
      expect((await login('acct@legacy.test', NEW_PASSWORD)).status).toBe(401);
      await activate('acct@legacy.test', code, 'a-second-chosen-password').expect(200);
      await login('acct@legacy.test', 'a-second-chosen-password').expect(200);
      expect((await migrator.query(`SELECT role FROM users WHERE id = 'user-acct'`)).rows[0].role).toBe('Accountant');
      expect(await authority()).toBe(rulesBefore);

      // Admins and the Owner never set passwords themselves.
      expect((await owner.patch('/api/users/user-acct').send({ password: 'owner-chosen-password' })).status).toBe(400);
      expect((await owner.post('/api/users').send({ name: 'N', email: 'n@legacy.test', role: 'Purchasing', password: 'owner-chosen-password' })).status).toBe(400);
      // A new account: created without a password, with its own activation code.
      const created = (await owner.post('/api/users').send({ name: 'New', email: 'new@legacy.test', role: 'Purchasing' }).expect(201)).body;
      expect(created.credential.has_credential).toBe(false);
      expect(created.activation.code).toMatch(/^[0-9a-f]{64}$/);
      expect((await login('new@legacy.test', NEW_PASSWORD)).status).toBe(401);
      await activate('new@legacy.test', created.activation.code).expect(200);
      await login('new@legacy.test', NEW_PASSWORD).expect(200);

      // Every issue and use is in the audit trail, with no code in it.
      const events = (await migrator.query(`SELECT action, count(*)::int AS n FROM audit_logs WHERE action IN ('auth.code_issued', 'auth.password_set') GROUP BY action ORDER BY action`)).rows;
      expect(events.find((e) => e.action === 'auth.code_issued')!.n).toBeGreaterThanOrEqual(8);
      expect(events.find((e) => e.action === 'auth.password_set')!.n).toBeGreaterThanOrEqual(6);
      expect((await migrator.query(`SELECT count(*)::int AS n FROM audit_logs WHERE to_jsonb(audit_logs)::text LIKE '%' || $1 || '%'`, [code])).rows[0].n).toBe(0);
    });
  });
});
