import { randomUUID } from 'crypto';
import { createPool, type Pool } from '../db/pool';
import { migrate } from '../db/migrate';
import { bootstrapRoles, ident, type RoleNames } from '../db/roles';

/**
 * Database tests need TEST_DATABASE_URL (a Postgres the tests may create schemas in).
 * Without it they are skipped locally but fail in CI, so CI can never pass silently.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL && process.env.CI) {
  throw new Error('TEST_DATABASE_URL must be set in CI so database tests run');
}

/**
 * A connection that may create roles (superuser or CREATEROLE), for the privilege tests and the
 * restricted test mode. CI sets it, so those tests can never be skipped there.
 */
export const TEST_DATABASE_ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL;
if (!TEST_DATABASE_ADMIN_URL && process.env.CI) {
  throw new Error('TEST_DATABASE_ADMIN_URL must be set in CI so the database privilege tests run');
}

/**
 * TEST_DB_ROLE_MODE=restricted runs every database test as a real restricted runtime role: per
 * test file, fresh owner / migrator / app roles are created, the migrator migrates the schema
 * (owned by the owner role) and the tests' pool connects as the app role — the same separation
 * as production (docs/database-privileges.md).
 */
export const RESTRICTED_MODE = process.env.TEST_DB_ROLE_MODE === 'restricted';

/** The same server with another user and password. */
export const withCredentials = (url: string, user: string, password: string) => {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
};

export interface RestrictedRoles {
  roles: RoleNames;
  migratorUrl: string;
  appUrl: string;
}

/** Creates unique owner / migrator / app roles and an owner-owned schema. */
export async function createRestrictedRoles(schema: string): Promise<RestrictedRoles> {
  if (!TEST_DATABASE_ADMIN_URL || !TEST_DATABASE_URL) throw new Error('TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL are required for role-separated tests');
  const tag = randomUUID().replace(/-/g, '').slice(0, 10);
  const roles: RoleNames = { owner: `t${tag}_owner`, migrator: `t${tag}_migrator`, app: `t${tag}_app` };
  const migratorPassword = randomUUID();
  const appPassword = randomUUID();
  const admin = createPool({ connectionString: TEST_DATABASE_ADMIN_URL, max: 1 });
  const client = await admin.connect();
  try {
    await bootstrapRoles(client, { schema, roles, migratorPassword, appPassword });
  } finally {
    client.release();
    await admin.end();
  }
  return { roles, migratorUrl: withCredentials(TEST_DATABASE_URL, roles.migrator, migratorPassword), appUrl: withCredentials(TEST_DATABASE_URL, roles.app, appPassword) };
}

/** Drops a role-separated test schema and its roles. */
export async function dropRestricted(schema: string, roles: RoleNames) {
  const admin = createPool({ connectionString: TEST_DATABASE_ADMIN_URL, max: 1 });
  const client = await admin.connect();
  try {
    // One transaction under the bootstrap's lock: concurrent test files dropping roles (or
    // bootstrapping) update the same shared catalog rows (the database's privileges).
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(7334202)');
    await client.query(`DROP SCHEMA IF EXISTS ${ident(schema)} CASCADE`);
    for (const r of [roles.app, roles.migrator, roles.owner]) {
      if ((await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [r])).rowCount) await client.query(`DROP OWNED BY ${ident(r)}`);
      await client.query(`DROP ROLE IF EXISTS ${ident(r)}`);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
    await admin.end();
  }
}

export interface TestDb {
  /** The pool the application under test uses (the restricted app role in restricted mode). */
  pool: Pool;
  schema: string;
  /** For test fixtures that need DDL (e.g. a failure-injecting trigger): the owner's privileges. */
  owner: Pool;
  /** A brand-new pool with the same identity as `pool` (a server restart). */
  connect: () => Pool;
  /** Re-runs the migrations the way the deployment does (the migrator in restricted mode). */
  migrate: () => Promise<string[]>;
  close: () => Promise<void>;
  /** Restricted mode only: the separated roles and their connection strings. */
  restricted?: RestrictedRoles;
}

/** Creates an isolated schema, runs the real migrations into it, and returns a pool bound to it. */
export async function createTestDb(opts: { restricted?: boolean } = {}): Promise<TestDb> {
  const schema = `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (RESTRICTED_MODE || opts.restricted) return createRestrictedTestDb(schema);
  const admin = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  // A bounded wait for a connection: a pool-starvation bug fails the test instead of hanging CI.
  const connect = () => createPool({ connectionString: TEST_DATABASE_URL, max: 5, connectionTimeoutMillis: 20_000, options: `-c search_path=${schema}` });
  const pool = connect();
  await migrate(pool);
  return {
    pool,
    schema,
    owner: pool,
    connect,
    migrate: () => migrate(pool),
    close: async () => {
      await pool.end();
      const cleanup = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
      await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);
      await cleanup.end();
    },
  };
}

/** createTestDb in restricted mode: migrated by the migrator role, used as the app role. */
async function createRestrictedTestDb(schema: string): Promise<TestDb> {
  const r = await createRestrictedRoles(schema);
  const migrator = createPool({ connectionString: r.migratorUrl, max: 2, options: `-c search_path=${schema}` });
  await migrate(migrator, { roles: r.roles });
  const connect = () => createPool({ connectionString: r.appUrl, max: 5, connectionTimeoutMillis: 20_000, options: `-c search_path=${schema}` });
  const pool = connect();
  return {
    pool,
    schema,
    owner: migrator,
    connect,
    migrate: () => migrate(migrator, { roles: r.roles }),
    restricted: r,
    close: async () => {
      await pool.end();
      await migrator.end();
      await dropRestricted(schema, r.roles);
    },
  };
}

/** Empties the core chain but keeps users (deletes, since users/assignments reference these tables). */
export async function truncateCore(pool: Pool) {
  await pool.query(
    'DELETE FROM project_assignments; DELETE FROM work_items; DELETE FROM work_packages; DELETE FROM projects; DELETE FROM clients'
  );
}
