import fs from 'fs';
import path from 'path';
import type { Pool, PoolClient } from './pool';
import { applyRuntimeGrants, ident, roleExists, type RoleNames } from './roles';

export const MIGRATIONS_DIR = path.resolve(process.cwd(), 'db', 'migrations');

// Arbitrary constant so concurrent migrators (two server instances, CI jobs) serialise.
const MIGRATION_LOCK_ID = 7_334_201;

export interface Migration {
  name: string;
  sql: string;
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }));
}

async function ensureTable(pool: Pool | PoolClient) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function appliedMigrations(pool: Pool | PoolClient): Promise<string[]> {
  const exists = await pool.query(`SELECT to_regclass('schema_migrations') IS NOT NULL AS ok`);
  if (!exists.rows[0].ok) return [];
  const res = await pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  return res.rows.map((r) => r.name);
}

export async function pendingMigrations(pool: Pool, dir?: string): Promise<string[]> {
  const applied = new Set(await appliedMigrations(pool));
  return loadMigrations(dir)
    .map((m) => m.name)
    .filter((n) => !applied.has(n));
}

export interface MigrateOptions {
  dir?: string;
  /**
   * Role separation (docs/database-privileges.md). When given, the connected user must be able
   * to act as `roles.owner` (the migrator is a member): every migration runs as the owner, so
   * the owner — never the runtime role — owns what it creates, and the runtime grants are
   * re-applied after every run. Without it, migrations run as the connected user (the
   * single-credential setup used by tests and older installs).
   */
  roles?: RoleNames;
}

/** Applies pending migrations in order, each in its own transaction. Returns the names applied. */
export async function migrate(pool: Pool, dirOrOptions?: string | MigrateOptions): Promise<string[]> {
  const opts: MigrateOptions = typeof dirOrOptions === 'string' ? { dir: dirOrOptions } : (dirOrOptions ?? {});
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    if (opts.roles) {
      const { owner, app } = opts.roles;
      if (!(await roleExists(client, owner)) || !(await roleExists(client, app))) throw new Error(`Database roles ${owner} / ${app} do not exist: run the role bootstrap first (npm run db:bootstrap-roles)`);
      const me = (await client.query(`SELECT current_user AS u, pg_has_role(current_user, $1, 'MEMBER') AS can_own, (pg_has_role(current_user, $2, 'MEMBER') AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS is_app`, [owner, app])).rows[0];
      if (me.is_app) throw new Error(`Refusing to migrate as the runtime role ${app}: use the migrator credential (DATABASE_MIGRATION_URL)`);
      if (!me.can_own) throw new Error(`The migration user ${me.u} cannot act as ${owner}: migrate with the migrator credential (DATABASE_MIGRATION_URL)`);
      // Session-wide for this connection: everything below is created and owned by the owner role.
      await client.query(`SET ROLE ${ident(owner)}`);
    }
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureTable(client);
    const done = new Set(await appliedMigrations(client));
    for (const m of loadMigrations(opts.dir)) {
      if (done.has(m.name)) continue;
      try {
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
        await client.query('COMMIT');
        applied.push(m.name);
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`Migration ${m.name} failed: ${(err as Error).message}`);
      }
    }
    if (opts.roles) {
      const schema = (await client.query('SELECT current_schema() AS s')).rows[0].s as string;
      await client.query('BEGIN');
      await applyRuntimeGrants(client, schema, opts.roles);
      await client.query('COMMIT');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    await client.query('RESET ROLE').catch(() => {});
    client.release();
  }
  return applied;
}
