// Imports the built-in demo clients, projects, work packages and work items into
// DATABASE_URL. Existing rows are never overwritten. Use --dry-run to only validate.
import dotenv from 'dotenv';
import { readDatabaseSettings } from '../server/db/config';
import { pendingMigrations } from '../server/db/migrate';
import { createPool } from '../server/db/pool';
import { CoreRepository } from '../server/core/repository';
import { INITIAL_CLIENTS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../src/data/initialData';

dotenv.config();

async function main() {
  const settings = readDatabaseSettings();
  if (!settings.pool) throw new Error('DATABASE_URL is not set');
  const pool = createPool(settings.pool);
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length) throw new Error(`Run npm run db:migrate first (pending: ${pending.join(', ')})`);
    const result = await new CoreRepository(pool).importData(
      {
        clients: INITIAL_CLIENTS,
        projects: INITIAL_PROJECTS,
        workPackages: INITIAL_WORK_PACKAGES,
        workItems: INITIAL_WORK_ITEMS,
      },
      { dryRun: process.argv.includes('--dry-run') }
    );
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
