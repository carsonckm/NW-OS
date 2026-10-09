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
    // Role separation applies to this database once its schema belongs to the owner role (the
    // bootstrap has run here), when the connection is the runtime role itself, or when the
    // migrator credential is used (it always migrates as the owner role, never as itself). Roles are
    // server-wide, so their mere existence says nothing about this database.
    const rolesExist = (await roleExists(pool, roles.owner)) && (await roleExists(pool, roles.app));
    const here = rolesExist
      ? (await pool.query(`SELECT pg_get_userbyid(n.nspowner) = $1 AS owned, (pg_has_role(current_user, $2, 'MEMBER') AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS is_app, pg_has_role(current_user, $1, 'MEMBER') AS can_own FROM pg_namespace n WHERE n.nspname = current_schema()`, [roles.owner, roles.app])).rows[0]
      : undefined;
    const separated = Boolean(here?.owned || here?.is_app || (here?.can_own && migrationUrl));
    if (separated && !migrationUrl) {
      throw new Error(`Role separation is set up (${roles.owner} / ${roles.app}): set DATABASE_MIGRATION_URL to the ${roles.migrator} credential. The runtime credential never runs migrations.`);
    }
    if (!separated) console.warn(`[db:migrate] This database is not role-separated (${roles.owner} does not own its schema): migrating as the connected user (single-credential mode, NOT hardened). See docs/database-privileges.md.`);
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
