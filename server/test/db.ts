import { randomUUID } from 'crypto';
import { createPool, type Pool } from '../db/pool';
import { migrate } from '../db/migrate';

/**
 * Database tests need TEST_DATABASE_URL (a Postgres the tests may create schemas in).
 * Without it they are skipped locally but fail in CI, so CI can never pass silently.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL && process.env.CI) {
  throw new Error('TEST_DATABASE_URL must be set in CI so database tests run');
}

export interface TestDb {
  pool: Pool;
  schema: string;
  close: () => Promise<void>;
}

/** Creates an isolated schema, runs the real migrations into it, and returns a pool bound to it. */
export async function createTestDb(): Promise<TestDb> {
  const schema = `test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
  await admin.query(`CREATE SCHEMA ${schema}`);
  await admin.end();

  const pool = createPool({ connectionString: TEST_DATABASE_URL, max: 5, options: `-c search_path=${schema}` });
  await migrate(pool);
  return {
    pool,
    schema,
    close: async () => {
      await pool.end();
      const cleanup = createPool({ connectionString: TEST_DATABASE_URL, max: 1 });
      await cleanup.query(`DROP SCHEMA ${schema} CASCADE`);
      await cleanup.end();
    },
  };
}

/** Empties the core chain but keeps users (deletes, since users/assignments reference these tables). */
export async function truncateCore(pool: Pool) {
  await pool.query(
    'DELETE FROM project_assignments; DELETE FROM work_items; DELETE FROM work_packages; DELETE FROM projects; DELETE FROM clients'
  );
}
