// Applies pending SQL migrations from db/migrations to DATABASE_URL.
import dotenv from 'dotenv';
import { readDatabaseSettings } from '../server/db/config';
import { migrate, pendingMigrations } from '../server/db/migrate';
import { createPool } from '../server/db/pool';

dotenv.config();

async function main() {
  const settings = readDatabaseSettings();
  if (!settings.pool) throw new Error('DATABASE_URL is not set');
  const pool = createPool(settings.pool);
  try {
    if (process.argv.includes('--status')) {
      const pending = await pendingMigrations(pool);
      console.log(pending.length ? `Pending: ${pending.join(', ')}` : 'Database schema is up to date.');
      return;
    }
    const applied = await migrate(pool);
    console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Nothing to apply; schema is up to date.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
