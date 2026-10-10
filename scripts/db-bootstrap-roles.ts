// One-time (and repeatable) database role setup, run by a database administrator.
// See docs/database-privileges.md.
//
//   DATABASE_ADMIN_URL=postgres://<admin>@host/db \
//   NWOS_MIGRATOR_PASSWORD=… NWOS_APP_PASSWORD=… npm run db:bootstrap-roles
//
// Creates or repairs nwos_owner (NOLOGIN), nwos_migrator and nwos_app, moves every object in the
// schema to nwos_owner and applies the runtime grants. Passwords are optional (omit them to keep
// the current ones) and are never printed. Add --transfer-database to also make nwos_owner the
// database owner (needs a superuser, or an administrator that owns the database).
import dotenv from 'dotenv';
import { readDatabaseSettings } from '../server/db/config';
import { createPool } from '../server/db/pool';
import { bootstrapRoles, roleNamesFromEnv } from '../server/db/roles';

dotenv.config();

async function main() {
  const url = process.env.DATABASE_ADMIN_URL?.trim();
  if (!url) throw new Error('DATABASE_ADMIN_URL is not set (an administrator connection, used only for this setup; never give it to the server)');
  const settings = readDatabaseSettings({ ...process.env, DATABASE_URL: url });
  const pool = createPool({ ...settings.pool!, max: 1 });
  const client = await pool.connect();
  try {
    const roles = roleNamesFromEnv();
    const schema = process.env.NWOS_DB_SCHEMA?.trim() || 'public';
    const done = await bootstrapRoles(client, {
      schema,
      roles,
      migratorPassword: process.env.NWOS_MIGRATOR_PASSWORD || undefined,
      appPassword: process.env.NWOS_APP_PASSWORD || undefined,
      transferDatabase: process.argv.includes('--transfer-database'),
    });
    console.log(`Roles ready: ${roles.owner} (owner, no login), ${roles.migrator} (migrations), ${roles.app} (runtime). Schema: ${schema}.`);
    for (const d of done) console.log(`  - ${d}`);
    console.log('Passwords were', process.env.NWOS_MIGRATOR_PASSWORD || process.env.NWOS_APP_PASSWORD ? 'set (not shown).' : 'not changed.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
