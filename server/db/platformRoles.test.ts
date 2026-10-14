/**
 * Supabase's Data API roles (anon, authenticated, service_role) must not reach NW OS's tables:
 * the privilege report fails while they can, and the runtime grants (re-applied by every
 * migration) revoke it. Simulated here with roles of the same names, granted the way Supabase's
 * defaults grant them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from './pool';
import { PLATFORM_API_ROLES, runtimePrivilegeReport } from './roles';
import { createTestDb, TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('Supabase Data API roles have no access to NW OS tables', () => {
  let db: TestDb;
  const admin = () => createPool({ connectionString: TEST_DATABASE_ADMIN_URL!, max: 1 });

  beforeAll(async () => {
    const a = admin();
    try {
      for (const r of PLATFORM_API_ROLES) {
        await a.query(`DO $$ BEGIN CREATE ROLE ${r} NOLOGIN; EXCEPTION WHEN duplicate_object OR unique_violation THEN NULL; END $$`);
      }
    } finally {
      await a.end();
    }
    db = await createTestDb({ restricted: true });
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  it('are reported while they can read or write, and revoked by the runtime grants', async () => {
    const a = admin();
    try {
      // What Supabase's default privileges give these roles on objects in an exposed schema.
      await a.query(`GRANT USAGE ON SCHEMA ${db.schema} TO anon, authenticated, service_role`);
      await a.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${db.schema} TO anon, authenticated, service_role`);
      const before = await runtimePrivilegeReport(db.pool, db.schema);
      for (const r of PLATFORM_API_ROLES) expect(before.issues.join('\n')).toContain(`Data API role ${r}`);

      await db.migrate(); // re-applies the runtime grants
      const after = await runtimePrivilegeReport(db.pool, db.schema);
      expect(after.issues).toEqual([]);
      const left = (await a.query(
        `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace, unnest($2::text[]) r
          WHERE n.nspname = $1 AND c.relkind = 'r' AND has_table_privilege(r, c.oid, 'SELECT, INSERT, UPDATE, DELETE')`,
        [db.schema, PLATFORM_API_ROLES]
      )).rows[0].n;
      expect(left).toBe(0);
    } finally {
      await a.end();
    }
  });
});
