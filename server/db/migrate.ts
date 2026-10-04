import fs from 'fs';
import path from 'path';
import type { Pool } from './pool';

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

async function ensureTable(pool: Pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

export async function appliedMigrations(pool: Pool): Promise<string[]> {
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

/** Applies pending migrations in order, each in its own transaction. Returns the names applied. */
export async function migrate(pool: Pool, dir?: string): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await ensureTable(pool);
    const done = new Set(await appliedMigrations(pool));
    for (const m of loadMigrations(dir)) {
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
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}
