/**
 * The role bootstrap run by a managed host's administrator: not a superuser, only CREATEROLE and
 * CREATEDB, owning its own database (as on hosted PostgreSQL services). On a dedicated database:
 * the three roles are created and kept within their boundaries, the database and every object
 * end up owned by the owner role, all migrations apply as the migrator, the runtime role stays
 * restricted and cannot migrate, a second run changes nothing, and an attribute the
 * administrator may not change makes the bootstrap fail with a clear message and change nothing.
 */
import { randomBytes } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations, migrate } from './migrate';
import { createPool, type Pool } from './pool';
import { bootstrapRoles, ident, runtimePrivilegeReport, type RoleNames } from './roles';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, withCredentials } from '../test/db';

const onDatabase = (url: string, db: string) => {
  const u = new URL(url);
  u.pathname = `/${db}`;
  return u.toString();
};

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('role bootstrap by a non-superuser managed administrator', () => {
  const tag = randomBytes(4).toString('hex');
  const database = `nwos_mgd_${tag}`;
  const adminRole = `m${tag}_admin`;
  const weakRole = `m${tag}_weak`;
  const roles: RoleNames = { owner: `m${tag}_owner`, migrator: `m${tag}_migrator`, app: `m${tag}_app` };
  const pw = { admin: randomBytes(16).toString('hex'), weak: randomBytes(16).toString('hex'), migrator: randomBytes(16).toString('hex'), app: randomBytes(16).toString('hex') };
  const pools: Pool[] = [];
  const pool = (url: string) => {
    const p = createPool({ connectionString: url, max: 2 });
    pools.push(p);
    return p;
  };
  const superuser = () => pool(onDatabase(TEST_DATABASE_ADMIN_URL!, database));
  const asAdmin = () => pool(onDatabase(withCredentials(TEST_DATABASE_URL!, adminRole, pw.admin), database));
  const asMigrator = () => pool(onDatabase(withCredentials(TEST_DATABASE_URL!, roles.migrator, pw.migrator), database));
  const asApp = () => pool(onDatabase(withCredentials(TEST_DATABASE_URL!, roles.app, pw.app), database));

  const bootstrapAs = async (p: Pool, opts: { transferDatabase?: boolean; passwords?: boolean } = {}) => {
    const client = await p.connect();
    try {
      return await bootstrapRoles(client, {
        schema: 'public',
        roles,
        transferDatabase: opts.transferDatabase,
        ...(opts.passwords ? { migratorPassword: pw.migrator, appPassword: pw.app } : {}),
      });
    } finally {
      client.release();
    }
  };
  const attributes = async (role: string) =>
    (await superuser().query(
      `SELECT rolcanlogin AS login, rolsuper AS super, rolcreatedb AS createdb, rolcreaterole AS createrole, rolreplication AS replication, rolbypassrls AS bypassrls, rolinherit AS inherit FROM pg_roles WHERE rolname = $1`,
      [role]
    )).rows[0];

  beforeAll(async () => {
    const root = createPool({ connectionString: TEST_DATABASE_ADMIN_URL!, max: 1 });
    try {
      await root.query(`CREATE ROLE ${ident(adminRole)} LOGIN NOSUPERUSER CREATEROLE CREATEDB PASSWORD '${pw.admin}'`);
      await root.query(`CREATE ROLE ${ident(weakRole)} LOGIN NOSUPERUSER PASSWORD '${pw.weak}'`);
      await root.query(`CREATE DATABASE ${ident(database)} OWNER ${ident(adminRole)}`);
    } finally {
      await root.end();
    }
  }, 60_000);

  afterAll(async () => {
    await Promise.all(pools.map((p) => p.end().catch(() => {})));
    const root = createPool({ connectionString: TEST_DATABASE_ADMIN_URL!, max: 1 });
    try {
      await root.query(`DROP DATABASE IF EXISTS ${ident(database)} WITH (FORCE)`);
      const client = await root.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(7334202)');
        for (const r of [roles.app, roles.migrator, roles.owner, weakRole, adminRole]) {
          if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r])).rowCount) await client.query(`DROP OWNED BY ${ident(r)}`);
          await client.query(`DROP ROLE IF EXISTS ${ident(r)}`);
        }
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    } finally {
      await root.end();
    }
  }, 60_000);

  it('an administrator without CREATEROLE is refused and creates nothing', async () => {
    const weak = pool(onDatabase(withCredentials(TEST_DATABASE_URL!, weakRole, pw.weak), database));
    await expect(bootstrapAs(weak, { passwords: true })).rejects.toThrow(/permission denied/i);
    expect((await superuser().query('SELECT count(*)::int AS n FROM pg_roles WHERE rolname = ANY($1)', [Object.values(roles)])).rows[0].n).toBe(0);
  });

  it('creates the three roles with exactly their attributes and hands the database to the owner role', async () => {
    const admin = asAdmin();
    expect((await admin.query('SELECT rolsuper FROM pg_roles WHERE rolname = current_user')).rows[0].rolsuper).toBe(false);
    const done = await bootstrapAs(admin, { transferDatabase: true, passwords: true });
    expect(done).toEqual(expect.arrayContaining([`created role ${roles.owner}`, `created role ${roles.migrator}`, `created role ${roles.app}`, `database ${database} owned by ${roles.owner}`]));
    const none = { super: false, createdb: false, createrole: false, replication: false, bypassrls: false };
    expect(await attributes(roles.owner)).toEqual({ login: false, inherit: true, ...none });
    expect(await attributes(roles.migrator)).toEqual({ login: true, inherit: true, ...none });
    expect(await attributes(roles.app)).toEqual({ login: true, inherit: false, ...none });
    const s = superuser();
    expect((await s.query(`SELECT pg_get_userbyid(datdba) AS o FROM pg_database WHERE datname = $1`, [database])).rows[0].o).toBe(roles.owner);
    expect((await s.query(`SELECT pg_get_userbyid(nspowner) AS o FROM pg_namespace WHERE nspname = 'public'`)).rows[0].o).toBe(roles.owner);
    // The runtime role can act as nobody; the migrator acts as the owner, never the other way round.
    expect((await s.query(`SELECT pg_has_role($1, $2, 'MEMBER') AS m`, [roles.app, roles.owner])).rows[0].m).toBe(false);
    expect((await s.query(`SELECT pg_has_role($1, $2, 'MEMBER') AS m`, [roles.migrator, roles.owner])).rows[0].m).toBe(true);
    expect((await s.query(`SELECT pg_has_role($1, $2, 'MEMBER') AS m`, [roles.owner, roles.app])).rows[0].m).toBe(false);
  });

  it('applies every migration as the migrator; everything is owned by the owner role', async () => {
    const applied = await migrate(asMigrator(), { roles });
    expect(applied).toEqual(loadMigrations().map((m) => m.name));
    const s = superuser();
    const strays = (await s.query(
      `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [roles.owner]
    )).rows[0].n;
    const fnStrays = (await s.query(
      `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = $1)`,
      [roles.owner]
    )).rows[0].n;
    expect({ strays, fnStrays }).toEqual({ strays: 0, fnStrays: 0 });
  });

  it('the runtime role is restricted and cannot migrate or create objects', async () => {
    const app = asApp();
    expect((await runtimePrivilegeReport(app, 'public')).issues).toEqual([]);
    // The migration runner refuses the runtime role, and so does the database underneath it.
    await expect(migrate(app, { roles })).rejects.toThrow(/Refusing to migrate as the runtime role/);
    await expect(app.query(`SET ROLE ${ident(roles.owner)}`)).rejects.toThrow(/permission denied/);
    await expect(app.query('INSERT INTO schema_migrations (name) VALUES ($1)', ['999_app.sql'])).rejects.toThrow(/permission denied/);
    await expect(app.query('CREATE TABLE app_made (x int)')).rejects.toThrow(/permission denied/);
    // Protected auth tables stay out of reach.
    await expect(app.query('SELECT * FROM auth_credentials')).rejects.toThrow(/permission denied/);
  });

  it('is idempotent: a second run by the same administrator changes nothing', async () => {
    const done = await bootstrapAs(asAdmin(), { transferDatabase: true });
    expect(done).toEqual([`database ${database} owned by ${roles.owner}`]);
    expect((await runtimePrivilegeReport(asApp(), 'public')).issues).toEqual([]);
  });

  it('repairs an attribute the administrator may change', async () => {
    await superuser().query(`ALTER ROLE ${ident(roles.app)} CREATEDB INHERIT`);
    const done = await bootstrapAs(asAdmin());
    expect(done).toContain(`set NOCREATEDB NOINHERIT on ${roles.app}`);
    expect(await attributes(roles.app)).toMatchObject({ createdb: false, inherit: false });
  });

  it('fails loudly, changing nothing, when an attribute needs more than the administrator has', async () => {
    await superuser().query(`ALTER ROLE ${ident(roles.app)} BYPASSRLS CREATEDB`);
    const run = bootstrapAs(asAdmin());
    await expect(run).rejects.toThrow(new RegExp(`Cannot set NOCREATEDB NOBYPASSRLS on role ${roles.app}`));
    // The whole bootstrap rolled back, and the privilege check still reports the problem.
    expect(await attributes(roles.app)).toMatchObject({ createdb: true, bypassrls: true });
    expect((await runtimePrivilegeReport(asApp(), 'public')).issues.join('\n')).toMatch(/BYPASSRLS/);
    // A superuser's run repairs it.
    expect(await bootstrapAs(superuser())).toContain(`set NOCREATEDB NOBYPASSRLS on ${roles.app}`);
    expect((await runtimePrivilegeReport(asApp(), 'public')).issues).toEqual([]);
  });
});
