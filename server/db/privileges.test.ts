/**
 * Phase 6 Batch 10: database privilege separation, tested as the real restricted runtime role.
 *
 * Every refusal below is attempted on a connection logged in as the runtime role (its own
 * password, the same grants the production bootstrap gives) — never with a privileged stand-in.
 * Whatever the setting of TEST_DB_ROLE_MODE, this file always runs role-separated.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendError } from '../http/errors';
import { AccessContext } from '../auth/access';
import { syncExceptionLifecycle } from '../modules/exceptionLifecycle';
import { createPool, type Pool } from './pool';
import { migrate } from './migrate';
import { bootstrapRoles, enforceRuntimePrivileges, ident, runtimePrivilegeReport } from './roles';
import { randomUUID } from 'crypto';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, withCredentials, type TestDb } from '../test/db';
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

  describe('the startup override and the credentials the server may hold', () => {
    const capture = () => {
      const logged: string[] = [];
      return { logged, log: { warn: (m: string) => logged.push(`warn:${m}`), error: (m: string) => logged.push(`error:${m}`) } };
    };
    const overrides = async () => (await appPool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'security.privileged_database_override'`)).rows[0].n as number;

    it.each(['TRUE', 'True', '1', 'yes', 'on', ' true', 'true '])('NWOS_ALLOW_PRIVILEGED_DATABASE=%j is not "true": a privileged login is still refused in production, with a warning', async (value) => {
      const { logged, log } = capture();
      const before = await overrides();
      await expect(enforceRuntimePrivileges(db.owner, { NODE_ENV: 'production', NWOS_ALLOW_PRIVILEGED_DATABASE: value }, log)).rejects.toThrow(/Refusing to start in production/);
      expect(logged.some((m) => m.startsWith('warn:') && /unrecognised value and is ignored/.test(m))).toBe(true);
      expect(await overrides()).toBe(before);
    });

    it('the override has no effect outside production, and a flag left on a restricted login is reported for removal', async () => {
      const before = await overrides();
      for (const NODE_ENV of [undefined, 'development', 'test', 'staging']) {
        const { logged, log } = capture();
        await enforceRuntimePrivileges(db.owner, { NODE_ENV, NWOS_ALLOW_PRIVILEGED_DATABASE: 'true' }, log);
        expect(logged.some((m) => m.startsWith('warn:') && /Production refuses to start/.test(m))).toBe(true);
        expect(logged.some((m) => m.startsWith('error:'))).toBe(false);
      }
      expect(await overrides()).toBe(before);
      const { logged, log } = capture();
      await expect(enforceRuntimePrivileges(appPool, { NODE_ENV: 'production', NWOS_ALLOW_PRIVILEGED_DATABASE: 'true' }, log)).resolves.toMatchObject({ issues: [] });
      expect(logged.some((m) => /set but not needed/.test(m))).toBe(true);
      expect(await overrides()).toBe(before);
    });

    it('the server never holds the migration or administrator credential: production refuses to start (the override does not help), development warns; values are never echoed', async () => {
      const secret = 'postgres://someone:s3cr3t-value@db.example/nwos';
      for (const key of ['DATABASE_MIGRATION_URL', 'DATABASE_ADMIN_URL']) {
        const { logged, log } = capture();
        let message = '';
        await enforceRuntimePrivileges(appPool, { NODE_ENV: 'production', NWOS_ALLOW_PRIVILEGED_DATABASE: 'true', [key]: secret }, log).catch((e) => (message = (e as Error).message));
        expect(message).toMatch(new RegExp(`${key} is set in the server's environment[\\s\\S]*Refusing to start in production`));
        await enforceRuntimePrivileges(appPool, { NODE_ENV: 'development', [key]: secret }, log);
        expect(logged.some((m) => m.startsWith('warn:') && m.includes(key))).toBe(true);
        expect([message, ...logged].join('\n')).not.toContain('s3cr3t-value');
      }
      // Empty values are not credentials.
      await expect(enforceRuntimePrivileges(appPool, { NODE_ENV: 'production', DATABASE_MIGRATION_URL: '', DATABASE_ADMIN_URL: ' ' }, quietLog)).resolves.toMatchObject({ issues: [] });
    });
  });

  describe('the privilege checker looks at effective privileges, not names', () => {
    it('flags privileges reached through an inherited role, grant options, CREATE on another search_path schema and callable SECURITY DEFINER functions', async () => {
      // A login whose name looks like a runtime role and which owns nothing directly: every
      // problem comes through a role it inherits, a schema on its search_path or a function.
      const admin = createPool({ connectionString: TEST_DATABASE_ADMIN_URL!, max: 1 });
      pools.push(admin);
      const login = `${roles.app}_lookalike`;
      const via = `${roles.app}_via`;
      const other = `${db.schema}_other`;
      const pw = randomUUID();
      const s = ident(db.schema);
      try {
        await admin.query(`CREATE ROLE ${ident(via)} NOLOGIN`);
        await admin.query(`CREATE ROLE ${ident(login)} LOGIN INHERIT PASSWORD '${pw}'`);
        await admin.query(`GRANT ${ident(via)} TO ${ident(login)}`);
        await admin.query(`GRANT USAGE ON SCHEMA ${s} TO ${ident(via)}`);
        await admin.query(`GRANT SELECT, UPDATE ON ${s}.audit_logs TO ${ident(via)} WITH GRANT OPTION`);
        await admin.query(`CREATE SCHEMA ${ident(other)}`);
        await admin.query(`GRANT CREATE, USAGE ON SCHEMA ${ident(other)} TO ${ident(login)}`);
        await admin.query(`CREATE FUNCTION ${s}.b10_definer() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1'`);
        await admin.query(`ALTER FUNCTION ${s}.b10_definer() OWNER TO ${ident(roles.owner)}`);
        await admin.query(`GRANT EXECUTE ON FUNCTION ${s}.b10_definer() TO ${ident(login)}, ${ident(roles.app)}`);
        const lookalike = createPool({ connectionString: withCredentials(TEST_DATABASE_URL!, login, pw), max: 1, options: `-c search_path=${db.schema},${other}` });
        pools.push(lookalike);
        const issues = (await runtimePrivilegeReport(lookalike, db.schema)).issues.join('\n');
        expect(issues).toMatch(new RegExp(`can act as other roles: ${via}`));
        expect(issues).toMatch(/can UPDATE or DELETE append-only audit_logs/);
        expect(issues).toMatch(/WITH GRANT OPTION/);
        expect(issues).toMatch(new RegExp(`can create objects in schema ${other}, which is on its search_path`));
        expect(issues).toMatch(/SECURITY DEFINER function\(s\) that run as another role: b10_definer\(\)/);
        // The real runtime role is flagged for the callable SECURITY DEFINER function too.
        expect((await runtimePrivilegeReport(appPool)).issues.join('\n')).toMatch(/SECURITY DEFINER/);
        await expect(enforceRuntimePrivileges(appPool, { NODE_ENV: 'production' }, quietLog)).rejects.toThrow(/SECURITY DEFINER/);
      } finally {
        await admin.query(`DROP FUNCTION IF EXISTS ${s}.b10_definer()`);
        await admin.query(`DROP SCHEMA IF EXISTS ${ident(other)} CASCADE`);
        await admin.query(`REVOKE ALL ON ${s}.audit_logs FROM ${ident(via)} CASCADE`).catch(() => {});
        await admin.query(`REVOKE ALL ON SCHEMA ${s} FROM ${ident(via)}`).catch(() => {});
        for (const p of pools.splice(pools.indexOf(admin) + 1)) await p.end().catch(() => {});
        await admin.query(`DROP ROLE IF EXISTS ${ident(login)}`);
        await admin.query(`DROP ROLE IF EXISTS ${ident(via)}`);
      }
      expect((await runtimePrivilegeReport(appPool)).issues).toEqual([]);
    });

    it('an extension installed in the schema keeps its own objects: the bootstrap neither takes them over nor revokes their use', async () => {
      const admin = createPool({ connectionString: TEST_DATABASE_ADMIN_URL!, max: 1 });
      pools.push(admin);
      const elsewhere = (await admin.query(`SELECT 1 FROM pg_extension WHERE extname = 'citext'`)).rowCount;
      if (elsewhere) return; // installed in another schema of this database: nothing to test here
      await admin.query(`CREATE EXTENSION citext SCHEMA ${ident(db.schema)}`);
      try {
        const client = await admin.connect();
        try {
          await bootstrapRoles(client, { schema: db.schema, roles });
        } finally {
          client.release();
        }
        await db.migrate();
        const takenOver = (await admin.query(
          `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_depend d ON d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
            JOIN pg_extension e ON e.oid = d.refobjid WHERE e.extname = 'citext' AND pg_get_userbyid(p.proowner) = $1`, [roles.owner])).rows[0].n;
        expect(takenOver).toBe(0);
        expect((await appPool.query(`SELECT 'a'::citext = 'A'::citext AS eq`)).rows[0].eq).toBe(true);
        expect((await runtimePrivilegeReport(appPool)).issues).toEqual([]);
      } finally {
        await admin.query('DROP EXTENSION IF EXISTS citext');
      }
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

    it('a dismissal or snooze recorded against a critical exception is refused, even by direct SQL', async () => {
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

  describe('Batch 11: a critical exception cannot be dismissed or snoozed, by its stored severity', () => {
    const owner = () => as['Owner / CEO'];
    const CRIT = 'project:proj-1:Critical';
    let n = 0;
    const code = (e: Error | undefined) => (e as Error & { code?: string } | undefined)?.code;
    const stored = async (key: string) => (await appPool.query('SELECT state, severity FROM owner_exception_states WHERE exception_key = $1', [key])).rows[0] as Row;
    const events = async (key: string) => (await appPool.query('SELECT action, severity FROM owner_exception_events WHERE exception_key = $1 ORDER BY id', [key])).rows as Row[];
    const snoozed = async (key: string) => (await appPool.query('SELECT count(*)::int AS n FROM owner_exception_snoozes WHERE exception_key = $1 AND snoozed_until > now()', [key])).rows[0].n as number;
    /** A recorded exception (state row + "observed" event), as direct SQL as the runtime role. */
    async function recorded(severity: string) {
      const key = `test:b11:${severity}:${++n}`;
      expect(await inTx([
        [`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint) VALUES ($1, 'test', 'Test', $2, 'fp')`, [key, severity]],
        [`INSERT INTO owner_exception_events (exception_key, action, to_state, severity) VALUES ($1, 'observed', 'active', $2)`, [key, severity]],
      ])).toBeUndefined();
      return key;
    }
    const dismissSql = (key: string, severity: string | null, from = 'active'): [string, unknown[]][] => [
      [`UPDATE owner_exception_states SET state = 'dismissed' WHERE exception_key = $1`, [key]],
      [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'dismiss', $2, 'dismissed', $3, 'Go away')`, [key, from, severity]],
    ];
    const snoozeSql = (key: string, severity: string | null): [string, unknown[]][] => [
      [`INSERT INTO owner_exception_snoozes (exception_key, snoozed_until, reason, snoozed_by) VALUES ($1, now() + interval '1 day', 'later', 'user-owner') ON CONFLICT (exception_key) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until`, [key]],
      [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'snooze', 'active', 'active', $2, 'later')`, [key, severity]],
    ];
    const lowerSql = (key: string, to = 'attention'): [string, unknown[]][] => [
      [`UPDATE owner_exception_states SET severity = $2 WHERE exception_key = $1`, [key, to]],
      [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'changed', 'active', 'active', $2)`, [key, to]],
    ];

    let riskBefore: Row;
    beforeAll(async () => {
      riskBefore = (await appPool.query(`SELECT risk_status, risk_reason FROM projects WHERE id = 'proj-1'`)).rows[0];
      await appPool.query(`UPDATE projects SET risk_status = 'Critical', risk_reason = 'Batch 11 test' WHERE id = 'proj-1'`);
    });
    afterAll(async () => {
      await appPool.query(`UPDATE projects SET risk_status = $1, risk_reason = $2 WHERE id = 'proj-1'`, [riskBefore.risk_status, riskBefore.risk_reason]);
    });

    it('1-2. the API refuses to dismiss or snooze a live critical exception, whatever the request says', async () => {
      const list = (await owner().get('/api/owner/exceptions').expect(200)).body as Row;
      expect(list.exceptions.find((e: Row) => e.id === CRIT)).toMatchObject({ severity: 'critical' });
      const d = await owner().post('/api/owner/exceptions/dismiss').send({ id: CRIT, reason: 'Not now' }).expect(400);
      expect(d.body.message).toMatch(/critical exception cannot be dismissed/);
      const forged = await owner().post('/api/owner/exceptions/dismiss').send({ id: CRIT, reason: 'Not now', severity: 'info' });
      expect(forged.status).toBe(400);
      const z = await owner().post('/api/owner/exceptions/snooze').send({ id: CRIT, hours: 2, reason: 'later' }).expect(400);
      expect(z.body.message).toMatch(/critical exception cannot be snoozed/);
      expect(await owner().post('/api/owner/exceptions/snooze').send({ id: CRIT, hours: 2, reason: 'later', severity: 'info' }).then((r) => r.status)).toBe(400);
      // Nothing was written: the refused action's transaction (which would have recorded the
      // exception) rolled back as a whole.
      expect(await stored(CRIT)).toBeUndefined();
      expect(await snoozed(CRIT)).toBe(0);
      expect((await events(CRIT)).map((e) => e.action)).not.toContain('dismiss');
    });

    it('7. acknowledging, waiting and resolving a critical exception still work', async () => {
      await owner().post('/api/owner/exceptions/acknowledge').send({ id: CRIT }).expect(200);
      await owner().post('/api/owner/exceptions/wait').send({ id: CRIT, reason: 'Board decision' }).expect(200);
      await owner().post('/api/owner/exceptions/resolve').send({ id: CRIT, reason: 'Handled' }).expect(200);
      expect(await stored(CRIT)).toMatchObject({ state: 'resolved', severity: 'critical' });
      // Resolved while its condition is present: a critical exception is never hidden.
      const list = (await owner().get('/api/owner/exceptions').expect(200)).body as Row;
      expect(list.exceptions.find((e: Row) => e.id === CRIT)).toMatchObject({ severity: 'critical' });
      await owner().post('/api/owner/exceptions/reopen').send({ id: CRIT, reason: 'Back on' }).expect(200);
    });

    it('3-4. direct SQL cannot dismiss or snooze a stored-critical exception, even with a false non-critical severity on the event', async () => {
      const key = await recorded('critical');
      for (const sev of ['critical', 'attention', 'info', null]) {
        const d = await inTx(dismissSql(key, sev));
        expect(code(d), `dismiss with event severity ${sev}`).toBe('NWX01');
        expect(d!.message).toMatch(/critical exception cannot be dismissed/);
        const z = await inTx(snoozeSql(key, sev));
        expect(code(z), `snooze with event severity ${sev}`).toBe('NWX01');
        expect(z!.message).toMatch(/critical exception cannot be snoozed/);
      }
      expect(await stored(key)).toMatchObject({ state: 'active', severity: 'critical' });
      expect(await snoozed(key)).toBe(0);
      expect((await events(key)).map((e) => e.action)).toEqual(['observed']);
    });

    it('5. lowering the severity and dismissing or snoozing in one transaction is refused, in either order', async () => {
      const key = await recorded('critical');
      for (const statements of [
        [...lowerSql(key), ...dismissSql(key, 'attention')],
        [...dismissSql(key, 'attention'), ...lowerSql(key)],
        [...lowerSql(key), ...snoozeSql(key, 'attention')],
        [...snoozeSql(key, 'attention'), ...lowerSql(key)],
        // in the same statement as the dismissal
        [[`UPDATE owner_exception_states SET severity = 'info', state = 'dismissed' WHERE exception_key = $1`, [key]], [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'changed', 'active', 'active', 'info')`, [key]], [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'dismiss', 'active', 'dismissed', 'info', 'x')`, [key]]] as [string, unknown[]][],
      ]) {
        const err = await inTx(statements);
        expect(code(err)).toBe('NWX01');
        expect(err!.message).toMatch(/(critical exception cannot be (lowered and dismissed or snoozed in one transaction|dismissed|snoozed))|has been critical cannot be (dismissed|snoozed)/);
      }
      expect(await stored(key)).toMatchObject({ state: 'active', severity: 'critical' });
      expect(await snoozed(key)).toBe(0);
    });

    it('6. a fabricated or unrelated history event does not authorise a dismissal or snooze', async () => {
      const key = await recorded('attention');
      const other = await recorded('attention');
      // The event of another exception.
      expect(code(await inTx([dismissSql(key, 'attention')[0], dismissSql(other, 'attention')[1]]))).toBe('NWX01');
      // A dismissal event committed earlier, in another transaction.
      await appPool.query(`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'dismiss', 'active', 'dismissed', 'attention', 'earlier')`, [key]);
      expect(code(await inTx([dismissSql(key, 'attention')[0]]))).toBe('NWX01');
      // Another action's event, or a severity other than the stored one.
      expect(code(await inTx([dismissSql(key, 'attention')[0], [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'acknowledge', 'active', 'dismissed', 'attention', 'x')`, [key]]]))).toBe('NWX01');
      expect((await inTx(dismissSql(key, 'info')))?.message).toMatch(/stored severity/);
      expect((await inTx(snoozeSql(key, 'info')))?.message).toMatch(/stored severity/);
      expect(code(await inTx([snoozeSql(key, 'attention')[0], snoozeSql(other, 'attention')[1]]))).toBe('NWX01');
      expect(await stored(key)).toMatchObject({ state: 'active' });
      expect(await snoozed(key)).toBe(0);
      // With its own event and the stored severity, the same writes are accepted.
      expect(await inTx(dismissSql(key, 'attention'))).toBeUndefined();
      expect(await inTx(snoozeSql(other, 'attention'))).toBeUndefined();
    });

    it('8. non-critical exceptions keep their dismissal and snooze, with reasons and history recording the stored severity', async () => {
      const list = (await owner().get('/api/owner/exceptions').expect(200)).body as Row;
      const pick = list.exceptions.filter((e: Row) => e.severity !== 'critical' && e.lifecycle.state === 'active' && e.id !== CRIT);
      expect(pick.length).toBeGreaterThanOrEqual(2);
      const [a, b] = pick;
      await owner().post('/api/owner/exceptions/dismiss').send({ id: a.id }).expect(400);
      await owner().post('/api/owner/exceptions/dismiss').send({ id: a.id, reason: 'Duplicate of another item' }).expect(200);
      const ha = await events(a.id);
      expect(ha.at(-1)).toMatchObject({ action: 'dismiss', severity: a.severity });
      expect(await stored(a.id)).toMatchObject({ state: 'dismissed', severity: a.severity });
      await owner().post('/api/owner/exceptions/snooze').send({ id: b.id, hours: 2 }).expect(400);
      await owner().post('/api/owner/exceptions/snooze').send({ id: b.id, hours: 2, reason: 'After the site visit' }).expect(200);
      expect((await events(b.id)).at(-1)).toMatchObject({ action: 'snooze', severity: b.severity });
      expect(await snoozed(b.id)).toBe(1);
      await owner().delete(`/api/owner/exceptions/snooze/${encodeURIComponent(b.id)}`).expect(200);
      expect(await snoozed(b.id)).toBe(0);
    });

    it('9. repeated and concurrent requests keep their idempotency and conflict behaviour', async () => {
      const list = (await owner().get('/api/owner/exceptions').expect(200)).body as Row;
      const c = list.exceptions.find((e: Row) => e.severity !== 'critical' && e.lifecycle.state === 'active' && e.id !== CRIT)!;
      const before = (await events(c.id)).length;
      const [r1, r2] = await Promise.all([
        owner().post('/api/owner/exceptions/dismiss').send({ id: c.id, reason: 'Twice', expected_state: 'active' }),
        owner().post('/api/owner/exceptions/dismiss').send({ id: c.id, reason: 'Twice', expected_state: 'active' }),
      ]);
      expect([r1.status, r2.status].sort()).toEqual([200, 409]);
      const replay = await owner().post('/api/owner/exceptions/dismiss').send({ id: c.id, reason: 'Twice' }).expect(200);
      expect(replay.body).toMatchObject({ changed: false });
      expect((await events(c.id)).filter((e) => e.action === 'dismiss')).toHaveLength(1);
      expect((await events(c.id)).length).toBeGreaterThan(before);
    });

    it('the stored severity follows what the server sees: a drifted record is corrected before the action, never trusted', async () => {
      // A live critical exception whose stored record was lowered (by a forged "changed" event in
      // its own transaction): the API still refuses, and puts the stored severity back.
      await owner().get('/api/owner/exceptions').expect(200);
      expect(await inTx(lowerSql(CRIT, 'info'))).toBeUndefined();
      await owner().post('/api/owner/exceptions/dismiss').send({ id: CRIT, reason: 'x' }).expect(400);
      await owner().post('/api/owner/exceptions/snooze').send({ id: CRIT, hours: 1, reason: 'x' }).expect(400);
      expect(await stored(CRIT)).toMatchObject({ severity: 'critical' });
      expect((await events(CRIT)).at(-1)).toMatchObject({ action: 'changed', severity: 'critical' });
      // A live non-critical exception whose stored record says critical (stale or forged): the
      // server records the real severity first, but a record of "critical" locks the exception
      // for good (migration 027), so it fails safe: it can no longer be dismissed.
      const list = (await owner().get('/api/owner/exceptions').expect(200)).body as Row;
      const e = list.exceptions.find((x: Row) => x.severity !== 'critical' && x.lifecycle.state === 'active' && x.id !== CRIT)!;
      await owner().post('/api/owner/exceptions/acknowledge').send({ id: e.id }).expect(200);
      expect(await inTx([[`UPDATE owner_exception_states SET severity = 'critical' WHERE exception_key = $1`, [e.id]], [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'changed', 'acknowledged', 'acknowledged', 'critical')`, [e.id]]])).toBeUndefined();
      const refused = await owner().post('/api/owner/exceptions/dismiss').send({ id: e.id, reason: 'Handled' }).expect(400);
      expect(refused.body.message).toMatch(/has been critical .*can never be dismissed/);
      expect(await stored(e.id)).toMatchObject({ severity: e.severity, state: 'acknowledged' });
      expect((await events(e.id)).at(-1)).toMatchObject({ action: 'changed', severity: e.severity });
    });

    it('path 1 (prevented): a forged downgrade committed on its own does not make a once-critical exception dismissible or snoozable', async () => {
      expect(await inTx(lowerSql(CRIT, 'info'))).toBeUndefined();
      const st = (await stored(CRIT)).state as string;
      const d = await inTx(dismissSql(CRIT, 'info', st));
      expect(code(d)).toBe('NWX01');
      expect(d!.message).toMatch(/has been critical cannot be dismissed/);
      const z = await inTx(snoozeSql(CRIT, 'info'));
      expect(code(z)).toBe('NWX01');
      expect(z!.message).toMatch(/has been critical cannot be snoozed/);
      expect(await stored(CRIT)).toMatchObject({ severity: 'info', state: st });
      // The forged downgrade itself stays in the history.
      expect((await events(CRIT)).at(-1)).toMatchObject({ action: 'changed', severity: 'info' });
    });

    it('a database lifecycle refusal reaches the browser as a generic 409 conflict, without database details', async () => {
      const sent: { status?: number; body?: Row } = {};
      const res = { status(code: number) { sent.status = code; return this; }, json(b: Row) { sent.body = b; return this; } } as never;
      const warn = console.warn;
      console.warn = () => {};
      try {
        sendError(res, Object.assign(new Error('owner exception project:x: a critical exception cannot be dismissed'), { code: 'NWX01' }));
      } finally {
        console.warn = warn;
      }
      expect(sent.status).toBe(409);
      expect(sent.body).toEqual({ error: 'conflict', message: expect.stringMatching(/Reload and try again/) });
      expect(JSON.stringify(sent.body)).not.toMatch(/project:x|owner exception/);
    });
  });

  describe('Batch 11 (A + C): once critical, never dismissible; integrity findings and alerts', () => {
    const owner = () => as['Owner / CEO'];
    const code = (e: Error | undefined) => (e as Error & { code?: string } | undefined)?.code;
    const stored = async (key: string) => (await appPool.query('SELECT state, severity, critical_locked, critical_locked_at FROM owner_exception_states WHERE exception_key = $1', [key])).rows[0] as Row;
    const events = async (key: string) => (await appPool.query('SELECT id, action, severity FROM owner_exception_events WHERE exception_key = $1 ORDER BY id', [key])).rows as Row[];
    const findings = async (key: string) => (await appPool.query('SELECT * FROM owner_exception_integrity_findings WHERE exception_key = $1 ORDER BY id', [key])).rows as Row[];
    const notes = async (key: string) => (await appPool.query(`SELECT * FROM notifications WHERE entity_type = 'owner_exception' AND entity_id = $1`, [key])).rows as Row[];
    const audits = async (key: string, action: string) => (await appPool.query('SELECT * FROM audit_logs WHERE entity_id = $1 AND action = $2 ORDER BY id', [key, action])).rows as Row[];
    let ctx: AccessContext;
    const sync = () => syncExceptionLifecycle(appPool, ctx);
    const view = async (id: string) => ((await owner().get('/api/owner/exceptions').expect(200)).body.exceptions as Row[]).find((e) => e.id === id);
    const changedSql = (key: string, sev: string, st = 'active'): [string, unknown[]][] => [
      [`UPDATE owner_exception_states SET severity = $2 WHERE exception_key = $1`, [key, sev]],
      [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ($1, 'changed', $2, $2, $3)`, [key, st, sev]],
    ];
    const dismissSql = (key: string, sev: string, from = 'active'): [string, unknown[]][] => [
      [`UPDATE owner_exception_states SET state = 'dismissed' WHERE exception_key = $1`, [key]],
      [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'dismiss', $2, 'dismissed', $3, 'x')`, [key, from, sev]],
    ];
    const snoozeSql = (key: string, sev: string, st = 'active'): [string, unknown[]][] => [
      [`INSERT INTO owner_exception_snoozes (exception_key, snoozed_until, reason, snoozed_by) VALUES ($1, now() + interval '1 day', 'x', 'user-owner') ON CONFLICT (exception_key) DO UPDATE SET snoozed_until = EXCLUDED.snoozed_until`, [key]],
      [`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity, reason) VALUES ($1, 'snooze', $2, $2, $3, 'x')`, [key, st, sev]],
    ];
    const P1 = 'project:proj-2:Critical';
    const P2 = 'issue:iss-b11-p2';
    /** A new live critical exception (a safety issue) that NW OS has not recorded yet. */
    const newSafetyIssue = (id: string) => appPool.query(`INSERT INTO issues (id, project_id, status, priority, data) VALUES ($1, 'proj-1', 'Reported', 'Critical', '{"title":"Exposed wiring","category":"Safety"}')`, [id]);
    const ISS = 'issue:iss-b11';

    beforeAll(async () => {
      ctx = await AccessContext.load(appPool, (await appPool.query(`SELECT * FROM users WHERE id = 'user-owner'`)).rows[0]);
      await appPool.query(`INSERT INTO issues (id, project_id, status, priority, data) VALUES ('iss-b11', 'proj-1', 'Reported', 'Critical', '{"title":"Loose fitting","category":"Quality"}')`);
    });

    it('the lock is set by the database whenever an exception is stored or recorded as critical, and never cleared', async () => {
      await appPool.query(`UPDATE projects SET risk_status = 'Critical' WHERE id = 'proj-2'`);
      await sync();
      expect(await stored(P1)).toMatchObject({ severity: 'critical', critical_locked: true });
      const since = (await stored(P1)).critical_locked_at;
      // Clearing it, or moving its date, is refused / ignored.
      const unlock = await inTx([[`UPDATE owner_exception_states SET critical_locked = false WHERE exception_key = $1`, [P1]]]);
      expect(code(unlock)).toBe('NWX01');
      expect(unlock!.message).toMatch(/cannot become dismissible again/);
      await appPool.query(`UPDATE owner_exception_states SET critical_locked_at = now() + interval '1 day' WHERE exception_key = $1`, [P1]);
      expect((await stored(P1)).critical_locked_at).toEqual(since);
      // Inserting a new record as critical locks it; so does any history event recording critical.
      expect(await inTx([[`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint) VALUES ('test:b11:lock', 'test', 'T', 'attention', 'fp')`, []], [`INSERT INTO owner_exception_events (exception_key, action, to_state, severity) VALUES ('test:b11:lock', 'observed', 'active', 'attention')`, []]])).toBeUndefined();
      expect(await stored('test:b11:lock')).toMatchObject({ critical_locked: false });
      await appPool.query(`INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, severity) VALUES ('test:b11:lock', 'acknowledge', 'active', 'active', 'critical')`).catch(() => {});
      expect(await stored('test:b11:lock')).toMatchObject({ severity: 'attention', critical_locked: true });
    });

    it('path 1 (PREVENTED), each step committed as nwos_app: lowering the stored severity in one transaction does not allow dismissing or snoozing in a later one', async () => {
      expect(await inTx(changedSql(P1, 'info'))).toBeUndefined();
      expect(await stored(P1)).toMatchObject({ severity: 'info', critical_locked: true });
      for (const sev of ['info', 'attention']) {
        const d = await inTx(dismissSql(P1, sev));
        expect(code(d)).toBe('NWX01');
        expect(d!.message).toMatch(/has been critical cannot be dismissed/);
        const z = await inTx(snoozeSql(P1, sev));
        expect(code(z)).toBe('NWX01');
        expect(z!.message).toMatch(/has been critical cannot be snoozed/);
      }
      expect(await stored(P1)).toMatchObject({ state: 'active' });
    });

    it('C: the lowered stored severity is detected on the next run (not before), audited and alerted once; the record is corrected, the forged event kept', async () => {
      expect(await findings(P1)).toEqual([]); // detection waits for the hourly rule
      const forged = (await events(P1)).at(-1)!;
      await sync();
      const [f] = await findings(P1);
      expect(f).toMatchObject({ finding: 'severity_lowered_while_critical', cleared_at: null });
      expect(f.details).toMatchObject({ live_severity: 'critical', stored_severity: 'info', critical_locked: true, lowering_event_id: String(forged.id) });
      expect(f.alerted_at).not.toBeNull();
      expect(await audits(P1, 'security.exception_integrity_finding')).toHaveLength(1);
      expect(await notes(P1)).toHaveLength(1);
      // The run then records the real severity; the forged event stays in the history.
      expect(await stored(P1)).toMatchObject({ severity: 'critical' });
      expect((await events(P1)).some((e) => String(e.id) === String(forged.id))).toBe(true);
      // Next run: the condition no longer holds, so the finding is cleared (kept, audited).
      await sync();
      expect((await findings(P1))[0].cleared_at).not.toBeNull();
      expect(await audits(P1, 'security.exception_integrity_cleared')).toHaveLength(1);
      expect(await notes(P1)).toHaveLength(1);
    });

    it('path 2 (DETECTED, NOT PREVENTED), each step committed as nwos_app: an unrecorded critical exception recorded with a false low severity can be snoozed and dismissed; the next run detects, audits, alerts and locks it', async () => {
      await newSafetyIssue('iss-b11-p2');
      expect(await view(P2)).toMatchObject({ severity: 'critical' });
      expect(await stored(P2)).toBeUndefined();
      expect(await inTx([[`INSERT INTO owner_exception_states (exception_key, exception_type, title, project_id, severity, fingerprint) VALUES ($1, 'CRITICAL_ISSUE', 'x', 'proj-1', 'info', 'forged')`, [P2]], [`INSERT INTO owner_exception_events (exception_key, action, to_state, severity) VALUES ($1, 'observed', 'active', 'info')`, [P2]]])).toBeUndefined();
      expect(await inTx(snoozeSql(P2, 'info'))).toBeUndefined();
      expect(await inTx(dismissSql(P2, 'info'))).toBeUndefined();
      // The Owner Center still shows it as critical (live severity), whatever is stored.
      expect(await view(P2)).toMatchObject({ severity: 'critical', lifecycle: { state: 'dismissed', dismissible: false } });
      expect(await findings(P2)).toEqual([]);
      await sync();
      const f = await findings(P2);
      expect(f.map((x) => x.finding)).toEqual(['closed_while_critical']);
      expect(f[0].details).toMatchObject({ live_severity: 'critical', stored_severity: 'info', state: 'dismissed' });
      expect(await audits(P2, 'security.exception_integrity_finding')).toHaveLength(1);
      expect(await notes(P2)).toHaveLength(1);
      expect((await notes(P2))[0]).toMatchObject({ priority: 'urgent', title: expect.stringMatching(/Integrity check/) });
      // The run recorded the real severity: from now on it is locked, and nothing was repaired.
      expect(await stored(P2)).toMatchObject({ severity: 'critical', critical_locked: true, state: 'dismissed' });
      // The finding is in the Exception Center too.
      const list = (await owner().get('/api/owner/exceptions').expect(200)).body as Row;
      expect(list.exceptions.find((e: Row) => e.type === 'INTEGRITY_FINDING' && e.title.includes(P2))).toBeDefined();
      // Repeated runs: no duplicate finding, audit or alert.
      await sync();
      await sync();
      expect(await findings(P2)).toHaveLength(1);
      expect(await audits(P2, 'security.exception_integrity_finding')).toHaveLength(1);
      expect(await notes(P2)).toHaveLength(1);
      // The Owner reopens it (an audited Owner action); the finding then clears on the next run.
      await owner().post('/api/owner/exceptions/reopen').send({ id: P2, reason: 'Not closed by me' }).expect(200);
      await sync();
      // Still snoozed (by the forged snooze): the finding holds until that ends too.
      expect((await findings(P2))[0].cleared_at).toBeNull();
      await owner().delete(`/api/owner/exceptions/snooze/${encodeURIComponent(P2)}`).expect(200);
      await sync();
      expect((await findings(P2))[0].cleared_at).not.toBeNull();
      expect(await audits(P2, 'security.exception_integrity_cleared')).toHaveLength(1);
      // And it can no longer be dismissed or snoozed, through the API or SQL.
      expect((await owner().post('/api/owner/exceptions/dismiss').send({ id: P2, reason: 'x' })).status).toBe(400);
      expect(code(await inTx(dismissSql(P2, 'info')))).toBe('NWX01');
    });

    it('legitimate severity changes: an exception that becomes critical is locked for good; the lock survives every permitted transition and the screen says so', async () => {
      await sync();
      expect(await stored(ISS)).toMatchObject({ severity: 'urgent', critical_locked: false });
      expect(await view(ISS)).toMatchObject({ lifecycle: { dismissible: true, not_dismissible_reason: null } });
      // Becomes a safety issue (critical), then not again.
      await appPool.query(`UPDATE issues SET data = data || '{"category":"Safety"}' WHERE id = 'iss-b11'`);
      await sync();
      expect(await stored(ISS)).toMatchObject({ severity: 'critical', critical_locked: true });
      await appPool.query(`UPDATE issues SET data = data || '{"category":"Quality"}' WHERE id = 'iss-b11'`);
      await sync();
      expect(await stored(ISS)).toMatchObject({ severity: 'urgent', critical_locked: true });
      const item = await view(ISS);
      expect(item).toMatchObject({ severity: 'urgent', lifecycle: { dismissible: false } });
      expect(item.lifecycle.not_dismissible_reason).toMatch(/has been critical .* can never be dismissed or snoozed/);
      const d = await owner().post('/api/owner/exceptions/dismiss').send({ id: ISS, reason: 'x' }).expect(400);
      expect(d.body.message).toMatch(/has been critical .* can never be dismissed/);
      const z = await owner().post('/api/owner/exceptions/snooze').send({ id: ISS, hours: 1, reason: 'x' });
      expect(z.status).toBe(400);
      // Acknowledge, wait, resolve, reopen: all still work, and the lock stays.
      await owner().post('/api/owner/exceptions/acknowledge').send({ id: ISS }).expect(200);
      await owner().post('/api/owner/exceptions/wait').send({ id: ISS, reason: 'Contractor' }).expect(200);
      await owner().post('/api/owner/exceptions/resolve').send({ id: ISS }).expect(200);
      await owner().post('/api/owner/exceptions/reopen').send({ id: ISS, reason: 'Back' }).expect(200);
      expect(await stored(ISS)).toMatchObject({ state: 'active', critical_locked: true });
      expect(await findings(ISS)).toEqual([]);
    });

    it('C: alert delivery failure is recorded and retried until it succeeds, then never repeated', async () => {
      // Make notification delivery fail (test-only fixture, as the owner role).
      await db.owner.query(`CREATE FUNCTION b11_fail_notify() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'notification service down'; END $$`);
      await db.owner.query(`CREATE TRIGGER b11_fail_notify BEFORE INSERT ON notifications FOR EACH ROW EXECUTE FUNCTION b11_fail_notify()`);
      try {
        // An unrecorded critical exception recorded low and snoozed outside NW OS (path 2).
        const k2 = 'issue:iss-b11-f';
        await newSafetyIssue('iss-b11-f');
        expect(await inTx([[`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint) VALUES ($1, 't', 'x', 'info', 'f')`, [k2]], [`INSERT INTO owner_exception_events (exception_key, action, to_state, severity) VALUES ($1, 'observed', 'active', 'info')`, [k2]]])).toBeUndefined();
        expect(await inTx(snoozeSql(k2, 'info'))).toBeUndefined();
        await sync();
        let [f] = await findings(k2);
        expect(f).toMatchObject({ finding: 'closed_while_critical', alerted_at: null, alert_attempts: 1, last_alert_error: expect.stringMatching(/notification service down/) });
        await sync();
        [f] = await findings(k2);
        expect(f).toMatchObject({ alerted_at: null, alert_attempts: 2 });
        expect(await notes(k2)).toEqual([]);
        expect(await audits(k2, 'security.exception_integrity_finding')).toHaveLength(1);
      } finally {
        await db.owner.query('DROP TRIGGER IF EXISTS b11_fail_notify ON notifications');
        await db.owner.query('DROP FUNCTION IF EXISTS b11_fail_notify()');
      }
      await sync();
      const [f] = await findings('issue:iss-b11-f');
      expect(f).toMatchObject({ alert_attempts: 3, last_alert_error: null });
      expect(f.alerted_at).not.toBeNull();
      await sync();
      expect(await notes('issue:iss-b11-f')).toHaveLength(1);
    });

    it('C: concurrent runs record one finding and one alert', async () => {
      const key = 'issue:iss-b11-c';
      await newSafetyIssue('iss-b11-c');
      expect(await inTx([[`INSERT INTO owner_exception_states (exception_key, exception_type, title, severity, fingerprint) VALUES ($1, 't', 'x', 'info', 'f')`, [key]], [`INSERT INTO owner_exception_events (exception_key, action, to_state, severity) VALUES ($1, 'observed', 'active', 'info')`, [key]]])).toBeUndefined();
      expect(await inTx(dismissSql(key, 'info'))).toBeUndefined();
      const results = await Promise.allSettled([sync(), sync(), sync()]);
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      await sync();
      expect((await findings(key)).filter((f) => f.finding === 'closed_while_critical')).toHaveLength(1);
      expect(await audits(key, 'security.exception_integrity_finding')).toHaveLength(1);
      expect(await notes(key)).toHaveLength(1);
    });

    it('findings are evidence: the runtime role cannot delete them', async () => {
      expect((await inTx([['DELETE FROM owner_exception_integrity_findings', []]]))?.message).toMatch(/permission denied/);
      expect((await inTx([['TRUNCATE owner_exception_integrity_findings', []]]))?.message).toMatch(/permission denied|never deleted/);
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
