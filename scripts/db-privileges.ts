// Verifies the runtime credential (DATABASE_URL) is a restricted runtime role: prints its
// effective privileges problems, through every role it can act as. Exit code 1 if it could
// bypass the database protections. Never prints the connection string.
import dotenv from 'dotenv';
import { readDatabaseSettings } from '../server/db/config';
import { createPool } from '../server/db/pool';
import { runtimePrivilegeReport } from '../server/db/roles';

dotenv.config();

async function main() {
  const settings = readDatabaseSettings();
  if (!settings.pool) throw new Error('DATABASE_URL is not set');
  const pool = createPool({ ...settings.pool, max: 1 });
  try {
    const r = await runtimePrivilegeReport(pool);
    if (!r.issues.length) {
      console.log(`OK: "${r.user}" is a restricted runtime role in schema ${r.schema} (owns nothing, no grant option, no role it can act as, no DDL).`);
      return;
    }
    console.log(`NOT HARDENED: "${r.user}" in schema ${r.schema}:\n  - ${r.issues.join('\n  - ')}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
