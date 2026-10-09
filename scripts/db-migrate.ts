// Applies pending SQL migrations from db/migrations.
//
// With role separation (docs/database-privileges.md) migrations run with the migrator
// credential, DATABASE_MIGRATION_URL, as the owner role — never with the runtime credential.
// Without the roles (an older single-credential install) it falls back to DATABASE_URL, with a
// warning that the database is not hardened.
import dotenv from 'dotenv';
import { readDatabaseSettings } from '../server/db/config';
import { migrate, pendingMigrations } from '../server/db/migrate';
import { createPool } from '../server/db/pool';
import { roleExists, roleNamesFromEnv } from '../server/db/roles';

dotenv.config();

async function main() {
  const migrationUrl = process.env.DATABASE_MIGRATION_URL?.trim();
  const settings = readDatabaseSettings(migrationUrl ? { ...process.env, DATABASE_URL: migrationUrl } : process.env);
  if (!settings.pool) throw new Error('DATABASE_MIGRATION_URL (or, without role separation, DATABASE_URL) is not set');
  const pool = createPool({ ...settings.pool, max: 2 });
  try {
    if (process.argv.includes('--status')) {
      const pending = await pendingMigrations(pool);
      console.log(pending.length ? `Pending: ${pending.join(', ')}` : 'Database schema is up to date.');
      return;
    }
    const roles = roleNamesFromEnv();
    const separated = (await roleExists(pool, roles.owner)) && (await roleExists(pool, roles.app));
    if (separated && !migrationUrl) {
      throw new Error(`Role separation is set up (${roles.owner} / ${roles.app}): set DATABASE_MIGRATION_URL to the ${roles.migrator} credential. The runtime credential never runs migrations.`);
    }
    if (!separated) console.warn(`[db:migrate] No ${roles.owner} / ${roles.app} roles: migrating as the connected user (single-credential mode, NOT hardened). See docs/database-privileges.md.`);
    const applied = await migrate(pool, separated ? { roles } : {});
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply; schema is up to date.');
    if (separated) console.log(`Runtime grants for ${roles.app} re-applied.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
