// Imports the built-in demo data (core chain + all Phase 3 modules) into DATABASE_URL
// through the same validated import the app uses. Existing rows are never overwritten.
// Use --dry-run to validate only (everything is executed and checked, then rolled back).
import dotenv from 'dotenv';
import { AccessContext } from '../server/auth/access';
import type { AuthUser } from '../server/auth/store';
import { readDatabaseSettings } from '../server/db/config';
import { pendingMigrations } from '../server/db/migrate';
import { createPool } from '../server/db/pool';
import { demoData } from '../server/modules/demo';
import { DataService } from '../server/modules/service';

dotenv.config();

/** The import runs as a system Owner (CLI only; never reachable over HTTP). */
const SYSTEM: AuthUser = {
  id: 'system-import', name: 'System import', email: 'system@nwos.local', role: 'Owner / CEO', is_active: true,
  is_dev_seed: false, client_id: null, contractor_id: null, phone: null, department: null, title: null,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_login: null,
};

async function main() {
  const settings = readDatabaseSettings();
  if (!settings.pool) throw new Error('DATABASE_URL is not set');
  const pool = createPool(settings.pool);
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length) throw new Error(`Run npm run db:migrate first (pending: ${pending.join(', ')})`);
    const ctx = await AccessContext.load(pool, SYSTEM);
    const result = await new DataService(pool).importData(ctx, demoData(), { dryRun: process.argv.includes('--dry-run') }, {
      id: SYSTEM.id, name: SYSTEM.name, role: SYSTEM.role,
    });
    const totals = Object.entries(result.summary).map(([k, v]) => `${k}: ${v.new} new / ${v.skippedExisting} existing`);
    console.log(`${result.ok ? 'OK' : 'FAILED'}${result.dryRun ? ' (dry run, nothing written)' : ''}\n  ${totals.join('\n  ')}`);
    if (!result.ok) {
      console.error(result.problems.join('\n'));
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
