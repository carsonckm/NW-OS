/**
 * Phase 6 Batch 10: database privilege separation, tested as the real restricted runtime role.
 *
 * Every refusal below is attempted on a connection logged in as the runtime role (its own
 * password, the same grants the production bootstrap gives) — never with a privileged stand-in.
 * Whatever the setting of TEST_DB_ROLE_MODE, this file always runs role-separated.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool, type Pool } from './pool';
import { migrate } from './migrate';
import { bootstrapRoles, enforceRuntimePrivileges, ident, runtimePrivilegeReport } from './roles';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('Phase 6 batch 10: database privilege separation (as the real runtime role)', () => {
  let db: TestDb;
  let app: Parameters<typeof request>[0];
  let as: Record<string, request.Agent>;
  let appPool: Pool;
  let roles: { owner: string; migrator: string; app: string };
  const pools: Pool[] = [];
  const quietLog = { warn: () => {}, error: () => {} };

  beforeAll(async () => {
    ({ db, app, as } = (await setupDemoWorld({ restricted: true })) as never);
    appPool = db.pool;
    roles = db.restricted!.roles;
  }, 90000);
  afterAll(async () => {
    for (const p of pools) await p.end().catch(() => {});
    await db?.close();
  });

  /** A statement the database must refuse; the refusal is checked by its SQLSTATE / message. */
  async function refused(sql: string, expected: RegExp = /permission denied|must be owner|must be superuser|must have admin option|not allowed|only roles with/) {
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      let error: Error | undefined;
      try {
        await c.query(sql);
        await c.query('COMMIT');
      } catch (e) {
        error = e as Error;
      }
      expect(error, `the runtime role must not be able to run: ${sql}`).toBeDefined();
      expect(error!.message).toMatch(expected);
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      c.release();
    }
  }
  /** Runs statements in one transaction as the runtime role; resolves to the error at COMMIT, if any. */
  async function inTx(statements: [string, unknown[]?][]) {
    const c = await appPool.connect();
    try {
      await c.query('BEGIN');
      for (const [q, p] of statements) await c.query(q, p ?? []);
      await c.query('COMMIT');
      return undefined;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      return e as Error;
    } finally {
      c.release();
    }
  }
  const current = async () => (await appPool.query('SELECT current_user AS u')).rows[0].u as string;

  describe('who the server is', () => {
    it('the test connection is the runtime role itself, and the privilege report finds nothing to flag', async () => {
      expect(await current()).toBe(roles.app);
      const report = await runtimePrivilegeReport(appPool);
      expect(report.user).toBe(roles.app);
      expect(report.issues).toEqual([]);
      // Effective privileges, not names: not a member of any role, directly or through others.
      const memberOf = (await appPool.query(`SELECT r.rolname FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER')`)).rows;
      expect(memberOf).toEqual([]);
      const attrs = (await appPool.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication, rolinherit FROM pg_roles WHERE rolname = current_user`)).rows[0];
      expect(attrs).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false, rolreplication: false, rolinherit: false });
      const owned = (await appPool.query(`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`, [db.schema])).rows[0].n;
      expect(owned).toBe(0);
    });

    it('a privileged connection is flagged: production refuses to start, development warns, an override is audited', async () => {
      // The migrator (a member of the owner role) is exactly what the server must never run as.
      const report = await runtimePrivilegeReport(db.owner);
      expect(report.issues.join('\n')).toMatch(/can act as other roles/);
      expect(report.issues.join('\n')).toMatch(/owns \d+ table/);
      const logged: string[] = [];
      const log = { warn: (m: string) => logged.push(`warn:${m}`), error: (m: string) => logged.push(`error:${m}`) };
      await expect(enforceRuntimePrivileges(db.owner, { NODE_ENV: 'production' }, log)).rejects.toThrow(/Refusing to start in production/);
      await enforceRuntimePrivileges(db.owner, { NODE_ENV: 'development' }, log);
      expect(logged.some((m) => m.startsWith('warn:') && /not a restricted runtime role/.test(m))).toBe(true);
      await enforceRuntimePrivileges(db.owner, { NODE_ENV: 'production', NWOS_ALLOW_PRIVILEGED_DATABASE: 'true' }, log);
      expect(logged.some((m) => m.startsWith('error:') && /NOT hardened/.test(m))).toBe(true);
      const audit = (await appPool.query(`SELECT * FROM audit_logs WHERE action = 'security.privileged_database_override' ORDER BY id DESC LIMIT 1`)).rows[0];
      expect(audit).toBeDefined();
      expect(audit.details).toContain(roles.migrator);
      // No password or connection string ever reaches the log or the audit row.
      const everything = [...logged, JSON.stringify(audit)].join('\n');
      expect(everything).not.toMatch(/postgres(ql)?:\/\//);
      expect(everything).not.toMatch(/password/i);
      // The real runtime role starts cleanly in production.
      await expect(enforceRuntimePrivileges(appPool, { NODE_ENV: 'production' }, quietLog)).resolves.toMatchObject({ issues: [] });
    });
  });

  describe('1-2. protected tables, triggers and functions cannot be altered, dropped, disabled or replaced', () => {
    it.each([
      'ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update',
      'ALTER TABLE audit_logs DISABLE TRIGGER ALL',
      'ALTER TABLE owner_exception_events DISABLE TRIGGER USER',
      'DROP TRIGGER audit_logs_no_update ON audit_logs',
      'DROP TRIGGER owner_exception_states_integrity ON owner_exception_states',
      'DROP TRIGGER delegated_authorities_locked_guard ON delegated_authorities',
      `CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
      `CREATE OR REPLACE FUNCTION owner_exception_state_check() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NULL; END $$`,
      'DROP FUNCTION owner_exception_events_append_only() CASCADE',
      'ALTER FUNCTION delegated_authorities_locked_guard() RENAME TO gone',
      'DROP TABLE audit_logs',
      'ALTER TABLE audit_logs ADD COLUMN x int',
      'ALTER TABLE owner_exception_events ALTER COLUMN txid DROP DEFAULT',
      'ALTER TABLE audit_logs RENAME TO audit_logs_old',
      'ALTER TABLE delivery_receipts OWNER TO CURRENT_USER',
      'CREATE TABLE sneaky (id int)',
      'CREATE SCHEMA sneaky',
      'CREATE INDEX sneaky ON audit_logs (id)',
      `CREATE RULE r AS ON DELETE TO audit_logs DO INSTEAD NOTHING`,
      'ALTER TABLE owner_exception_states ENABLE ROW LEVEL SECURITY',
      'COMMENT ON TABLE audit_logs IS $$x$$',
    ])('refuses: %s', async (sql) => {
      await refused(sql);
    });

    it('cannot switch triggers off for its session (session_replication_role)', async () => {
      await refused(`SET session_replication_role = replica`);
    });

    it('the protections are all still in place afterwards', async () => {
      const triggers = (await appPool.query(`SELECT tgname, tgenabled FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND NOT tgisinternal ORDER BY 1`, [db.schema])).rows;
      for (const name of ['audit_logs_no_update', 'audit_logs_no_truncate', 'owner_exception_events_no_change', 'owner_exception_states_keep', 'owner_exception_states_integrity', 'owner_exception_snoozes_integrity', 'delegated_authorities_locked_guard', 'delivery_receipts_immutable', 'drawing_revisions_immutable']) {
        expect(triggers.find((t) => t.tgname === name), name).toMatchObject({ tgenabled: 'O' });
      }
    });
  });

  describe('3. immutable history cannot be edited or deleted', () => {
    it.each([
      'UPDATE audit_logs SET details = $$rewritten$$',
      'DELETE FROM audit_logs',
      'TRUNCATE audit_logs',
      'UPDATE owner_exception_events SET reason = $$rewritten$$',
      'DELETE FROM owner_exception_events',
      'TRUNCATE owner_exception_events',
      'UPDATE delivery_receipts SET receiver_name = $$x$$',
      'DELETE FROM delivery_receipts',
      'DELETE FROM owner_exception_states',
      'DELETE FROM owner_exception_snoozes',
      'DELETE FROM drawing_revisions',
      'TRUNCATE drawing_revisions',
      `INSERT INTO schema_migrations (name) VALUES ('999_fake.sql')`,
      `UPDATE schema_migrations SET applied_at = now()`,
      `DELETE FROM schema_migrations`,
    ])('refuses: %s', async (sql) => {
      await refused(sql);
    });

    it('the audit trail is still appendable (the server writes it on every change)', async () => {
      await appPool.query(`INSERT INTO audit_logs (action, entity_type, details) VALUES ('test.append', 'test', 'append still works')`);
      expect((await appPool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'test.append'`)).rows[0].n).toBe(1);
    });
  });

  describe('4. no self-granted privilege, no admin role', () => {
    it.each([
      'CREATE ROLE sneaky LOGIN SUPERUSER',
      'ALTER ROLE CURRENT_USER SUPERUSER',
      'ALTER ROLE CURRENT_USER CREATEROLE',
      'ALTER ROLE CURRENT_USER INHERIT',
      'ALTER ROLE CURRENT_USER BYPASSRLS',
    ])('refuses: %s', async (sql) => {
      await refused(sql);
    });

    /** Every table's privileges and the owner's default privileges, as the catalog has them. */
    const acl = async (c: { query: Pool['query'] }) =>
      JSON.stringify([
        (await c.query(`SELECT c.relname, c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 ORDER BY 1`, [db.schema])).rows,
        (await c.query(`SELECT defaclrole::regrole::text, defaclobjtype, defaclacl::text FROM pg_default_acl ORDER BY 1, 2`)).rows,
      ]);
    // PostgreSQL answers a GRANT by a role holding no grant option with a warning ("no privileges
    // were granted"), not an error, so what is checked is the effect: nothing changes.
    it.each([
      'GRANT ALL ON audit_logs TO PUBLIC',
      'GRANT UPDATE, DELETE ON audit_logs TO CURRENT_USER',
      'GRANT TRUNCATE ON owner_exception_events TO PUBLIC',
      'REVOKE INSERT ON audit_logs FROM PUBLIC',
      'GRANT ALL ON ALL TABLES IN SCHEMA public TO CURRENT_USER',
    ])('has no effect: %s', async (sql) => {
      const c = await appPool.connect();
      try {
        const before = await acl(c);
        await c.query('BEGIN');
        await c.query('SAVEPOINT attempt');
        await c.query(sql.replace('public', ident(db.schema))).catch(() => c.query('ROLLBACK TO SAVEPOINT attempt'));
        expect(await acl(c)).toBe(before);
        expect((await c.query(`SELECT has_table_privilege(current_user, 'audit_logs', 'UPDATE') AS u, has_table_privilege(current_user, 'audit_logs', 'DELETE') AS d, has_table_privilege(current_user, 'owner_exception_events', 'TRUNCATE') AS t`)).rows[0]).toEqual({ u: false, d: false, t: false });
      } finally {
        await c.query('ROLLBACK').catch(() => {});
        c.release();
      }
    });

    it('its own default privileges cannot reach the owner role\'s objects', async () => {
      // Allowed by PostgreSQL (it only concerns objects the runtime role creates, and it can
      // create none), and it changes nothing for the owner role's future tables.
      await refused(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(roles.owner)} GRANT ALL ON TABLES TO PUBLIC`);
    });

    it('cannot join, or SET ROLE to, the owner or migrator role', async () => {
      await refused(`GRANT ${ident(roles.owner)} TO CURRENT_USER`);
      await refused(`GRANT ${ident(roles.migrator)} TO CURRENT_USER`);
      await refused(`SET ROLE ${ident(roles.owner)}`);
      await refused(`SET ROLE ${ident(roles.migrator)}`);
      await refused(`SET SESSION AUTHORIZATION ${ident(roles.owner)}`);
      await refused(`ALTER ROLE ${ident(roles.owner)} LOGIN`);
      await refused(`ALTER ROLE ${ident(roles.migrator)} PASSWORD 'x'`);
    });
  });

  describe('5-6. exception state can only change the way the lifecycle allows, even by direct SQL', () => {
    let n = 0;
    /** An exception recorded the legitimate way: the state row with its "observed" event. */
    async function exception(severity: string) {
      const key = `test:b10:${severity}:${++n}`;
      const err = await inTx([
        [`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint) VALUES ($1, 'test', 'Test', $2, 'fp')`, [key, severity]],
        [`INSERT INTO owner_exception_events (exception_key, action, to_state, severity) VALUES ($1, 'observed', 'active', $2)`, [key, severity]],
      ]);
      expect(err).toBeUndefined();
      return key;
    }
    const state = async (key: string) => (await appPool.query('SELECT state, severity FROM owner_exception_states WHERE exception_key = $1', [key])).rows[0] as Row;
    const events = async (key: string) => (await appPool.query('SELECT action FROM owner_exception_events WHERE exception_key = $1 ORDER BY id', [key])).rows.map((r) => r.action);

    it('a state row cannot appear without its "observed" event, or start closed', async () => {
      expect((await inTx([[`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint) VALUES ('test:b10:silent', 'test', 'T', 'info', 'fp')`]]))?.message).toMatch(/"observed" event/);
      expect(
        (await inTx([
          [`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint, state) VALUES ('test:b10:closed', 'test', 'T', 'info', 'fp', 'dismissed')`],
          [`INSERT INTO owner_exception_events (exception_key, action, to_state) VALUES ('test:b10:closed', 'observed', 'active')`],
        ]))?.message
      ).toMatch(/starts active/);
    });

    it('a silent state change (no history event) is refused', async () => {
      const key = await exception('urgent');
      expect((await inTx([[`UPDATE owner_exception_states SET state = 'resolved' WHERE exception_key = $1`, [key]]]))?.message).toMatch(/must be recorded by its history event/);
      expect((await state(key)).state).toBe('active');
    });

    it('a transition outside the state machine is refused, even with a matching event', async () => {
      const key = await exception('urgent');
      const err = await inTx([
        [`UPDATE owner_exception_states SET state = 'stale' WHERE exception_key = $1`, [key]],
        [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'stale', 'active', 'stale', 'urgent')`, [key]],
      ]);
      expect(err).toBeUndefined(); // active -> stale is valid
      expect(
        (await inTx([
          [`UPDATE owner_exception_states SET state = 'active' WHERE exception_key = $1`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, reason) VALUES ($1, 'reopen', 'stale', 'active', 'x')`, [key]],
        ]))?.message
      ).toMatch(/stale -> active is not a valid transition/);
      expect((await state(key)).state).toBe('stale');
    });

    it('an event from another transaction does not cover a later state change', async () => {
      const key = await exception('urgent');
      await appPool.query(`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'resolve', 'active', 'resolved', 'urgent')`, [key]);
      expect((await inTx([[`UPDATE owner_exception_states SET state = 'resolved' WHERE exception_key = $1`, [key]]]))?.message).toMatch(/must be recorded by its history event/);
    });

    it('dismissing needs a reason; reopening needs a reopen event with a reason', async () => {
      const key = await exception('attention');
      expect(
        (await inTx([
          [`UPDATE owner_exception_states SET state = 'dismissed' WHERE exception_key = $1`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'dismiss', 'active', 'dismissed', 'attention')`, [key]],
        ]))?.message
      ).toMatch(/with a reason where one is required/);
      expect(
        await inTx([
          [`UPDATE owner_exception_states SET state = 'dismissed' WHERE exception_key = $1`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'dismiss', 'active', 'dismissed', 'attention', 'Duplicate')`, [key]],
        ])
      ).toBeUndefined();
      expect(
        (await inTx([
          [`UPDATE owner_exception_states SET state = 'active' WHERE exception_key = $1`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state) VALUES ($1, 'reopen', 'dismissed', 'active')`, [key]],
        ]))?.message
      ).toMatch(/with a reason where one is required/);
    });

    it('a critical exception can never be dismissed or snoozed by direct SQL', async () => {
      const key = await exception('critical');
      expect(
        (await inTx([
          [`UPDATE owner_exception_states SET state = 'dismissed' WHERE exception_key = $1`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'dismiss', 'active', 'dismissed', 'critical', 'Go away')`, [key]],
        ]))?.message
      ).toMatch(/critical exception cannot be dismissed/);
      expect(
        (await inTx([
          [`INSERT INTO owner_exception_snoozes (exception_key, snoozed_until, reason, snoozed_by) VALUES ($1, now() + interval '1 day', 'later', 'user-owner')`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'snooze', 'active', 'active', 'critical', 'later')`, [key]],
        ]))?.message
      ).toMatch(/critical exception cannot be snoozed/);
      expect((await state(key)).state).toBe('active');
      expect((await appPool.query('SELECT count(*)::int AS n FROM owner_exception_snoozes WHERE exception_key = $1', [key])).rows[0].n).toBe(0);
      // Acknowledge, wait and resolve stay allowed for critical exceptions (Batch 9).
      expect(
        await inTx([
          [`UPDATE owner_exception_states SET state = 'acknowledged' WHERE exception_key = $1`, [key]],
          [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'acknowledge', 'active', 'acknowledged', 'critical')`, [key]],
        ])
      ).toBeUndefined();
      expect(await events(key)).toEqual(['observed', 'acknowledge']);
    });

    it('a snooze needs its event; a severity change needs its "changed" event', async () => {
      const key = await exception('attention');
      expect((await inTx([[`INSERT INTO owner_exception_snoozes (exception_key, snoozed_until, reason, snoozed_by) VALUES ($1, now() + interval '1 day', 'later', 'user-owner')`, [key]]]))?.message).toMatch(/"snooze" event/);
      expect((await inTx([[`INSERT INTO owner_exception_snoozes (exception_key, snoozed_until, reason, snoozed_by) VALUES ('test:b10:unknown', now() + interval '1 day', 'later', 'user-owner')`]]))?.message).toMatch(/only a recorded exception/);
      expect((await inTx([[`UPDATE owner_exception_states SET severity = 'info' WHERE exception_key = $1`, [key]]]))?.message).toMatch(/"changed" event/);
      expect((await state(key)).severity).toBe('attention');
    });
  });

  describe('5-7. the API rules hold as the runtime role (no bypass of scope, permission, authority or critical restrictions)', () => {
    it('the Owner works the exception lifecycle through the API; critical restrictions hold', async () => {
      const list = (await as['Owner / CEO'].get('/api/owner/exceptions').expect(200)).body as Row;
      const all: Row[] = [...list.exceptions, ...(list.informational ?? [])];
      const normal = all.find((e) => e.severity !== 'critical' && !String(e.id).startsWith('approval:'));
      const critical = all.find((e) => e.severity === 'critical');
      expect(normal, 'the demo world has a non-critical exception').toBeDefined();
      await as['Owner / CEO'].post('/api/owner/exceptions/acknowledge').send({ id: normal!.id }).expect(200);
      await as['Owner / CEO'].post('/api/owner/exceptions/wait').send({ id: normal!.id, reason: 'Supplier quote' }).expect(200);
      await as['Owner / CEO'].post('/api/owner/exceptions/dismiss').send({ id: normal!.id, reason: 'Handled offline' }).expect(200);
      const h = (await as['Owner / CEO'].get(`/api/owner/exceptions/history?id=${encodeURIComponent(normal!.id)}`).expect(200)).body as Row;
      expect(h.events.map((e: Row) => e.action)).toEqual(['observed', 'acknowledge', 'wait', 'dismiss']);
      if (critical) {
        await as['Owner / CEO'].post('/api/owner/exceptions/dismiss').send({ id: critical.id, reason: 'x' }).expect(400);
        await as['Owner / CEO'].post('/api/owner/exceptions/snooze').send({ id: critical.id, hours: 2, reason: 'x' }).expect(400);
      }
      // Only the Owner.
      await as['Project Manager'].post('/api/owner/exceptions/acknowledge').send({ id: normal!.id }).expect(403);
    });

    it('scope and permissions are enforced the same way (cross-project, client, contractor)', async () => {
      await as['Client'].get('/api/owner/center').expect(403);
      await as['Contractor'].get('/api/projects/proj-x').expect((r) => expect([403, 404]).toContain(r.status));
      await as['Production Staff'].post('/api/approvals').send({ id: 'apr-b10-x', approval_number: 'X', approval_type: 'General', title: 'x', description: 'x', project_id: 'proj-x', project_name: 'x', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-05', decision: 'Pending', created_at: '', updated_at: '' }).expect((r) => expect([403, 404]).toContain(r.status));
    });

    it('a locked System Policy (the Sensitive ceiling) cannot be weakened by direct SQL', async () => {
      const locked = (await appPool.query(`SELECT id, code FROM delegated_authorities WHERE locked LIMIT 1`)).rows[0];
      expect(locked).toBeDefined();
      await refused(`UPDATE delegated_authorities SET active = false WHERE id = '${locked.id}'`, /is locked/);
      await refused(`DELETE FROM delegated_authorities WHERE id = '${locked.id}'`, /is locked/);
      await refused(`ALTER TABLE delegated_authorities DISABLE TRIGGER delegated_authorities_locked_guard`);
    });
  });

  describe('9. schema changes and migrations', () => {
    it('the runtime credential cannot run migrations', async () => {
      await expect(migrate(appPool, { roles })).rejects.toThrow(/Refusing to migrate as the runtime role/);
      await expect(migrate(appPool)).rejects.toThrow(/permission denied/);
    });

    it('the migrator re-runs migrations safely; everything stays owned by the owner role and the runtime role stays restricted', async () => {
      expect(await db.migrate()).toEqual([]);
      const owners = (await db.owner.query(`SELECT DISTINCT pg_get_userbyid(c.relowner) AS o FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1`, [db.schema])).rows.map((r) => r.o);
      expect(owners).toEqual([roles.owner]);
      const fnOwners = (await db.owner.query(`SELECT DISTINCT pg_get_userbyid(p.proowner) AS o FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = $1`, [db.schema])).rows.map((r) => r.o);
      expect(fnOwners).toEqual([roles.owner]);
      expect((await runtimePrivilegeReport(appPool)).issues).toEqual([]);
    });

    it('a migration that creates a table gives the runtime role row access only (default privileges)', async () => {
      const c = await db.owner.connect();
      try {
        await c.query(`SET ROLE ${ident(roles.owner)}`);
        await c.query('CREATE TABLE b10_new_table (id int PRIMARY KEY)');
      } finally {
        await c.query('RESET ROLE');
        c.release();
      }
      await appPool.query('INSERT INTO b10_new_table VALUES (1)');
      await refused('DROP TABLE b10_new_table');
      await refused('TRUNCATE b10_new_table');
      expect((await runtimePrivilegeReport(appPool)).issues).toEqual([]);
    });

    it('the role bootstrap is repeatable and repairs drift (a hand-granted membership or attribute)', async () => {
      const admin = createPool({ connectionString: TEST_DATABASE_ADMIN_URL!, max: 1 });
      pools.push(admin);
      await admin.query(`GRANT ${ident(roles.owner)} TO ${ident(roles.app)}`);
      await admin.query(`ALTER ROLE ${ident(roles.app)} CREATEDB`);
      const fresh = db.connect();
      pools.push(fresh);
      const drifted = (await runtimePrivilegeReport(fresh, db.schema)).issues.join('\n');
      expect(drifted).toMatch(/can act as other roles/);
      expect(drifted).toMatch(/CREATEDB/);
      const client = await admin.connect();
      let actions: string[];
      try {
        actions = await bootstrapRoles(client, { schema: db.schema, roles });
      } finally {
        client.release();
      }
      expect(actions.some((a) => /created role/.test(a))).toBe(false);
      expect((await runtimePrivilegeReport(fresh, db.schema)).issues).toEqual([]);
    });
  });

  describe('security monitoring', () => {
    it('a request the database refuses for lack of privilege is audited (no request body), and the grants are restored by the migrator', async () => {
      // Simulate a deployment whose grants are wrong: the owner revokes a table the API reads.
      await db.owner.query(`REVOKE SELECT ON projects FROM ${ident(roles.app)}`);
      const res = await as['Owner / CEO'].get('/api/core/snapshot');
      expect(res.status).toBe(500);
      expect(JSON.stringify(res.body)).not.toMatch(/permission denied|projects/);
      let row: Row | undefined;
      for (let i = 0; i < 40 && !row; i++) {
        row = (await appPool.query(`SELECT * FROM audit_logs WHERE action = 'security.database_privilege_denied' ORDER BY id DESC LIMIT 1`)).rows[0];
        if (!row) await new Promise((r) => setTimeout(r, 50));
      }
      expect(row).toBeDefined();
      expect(row!.details).toMatch(/^GET \/api\/core\/snapshot: permission denied for table projects/);
      expect(row!.actor_role).toBe('Owner / CEO');
      expect(row!.after).toEqual({ sqlstate: '42501' });
      // The migrator's next run re-applies the runtime grants.
      await db.migrate();
      await as['Owner / CEO'].get('/api/core/snapshot').expect(200);
    });
  });
});
