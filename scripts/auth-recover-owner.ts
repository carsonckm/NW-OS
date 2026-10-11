// Owner recovery (break glass): lost Owner password, or the only Owner deactivated.
//
//   NEW_OWNER_PASSWORD='...' DATABASE_MIGRATION_URL='postgres://nwos_migrator:...' \
//     npm run auth:recover-owner -- --email owner@company.com --reason "Lost password, ticket 123"
//
// Runs only on the migrator credential (DATABASE_MIGRATION_URL), never the runtime one: since
// migration 031 the runtime credential cannot change an account without a signed-in Owner, so a
// locked-out Owner is recovered by whoever holds the migration credential (an operator), with a
// reason. It sets a new password for an existing Owner account, reactivates it if needed, ends
// its sessions and writes a security audit record. It cannot create an Owner or change a role.
// The password is read from NEW_OWNER_PASSWORD so it never appears in shell history or ps.
import dotenv from 'dotenv';
import { passwordProblem } from '../server/auth/password';
import { AuthStore } from '../server/auth/store';
import { writeAudit } from '../server/audit';
import { readAccountAdminSettings } from '../server/db/config';
import { createPool } from '../server/db/pool';

dotenv.config();

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email');
  const reason = arg('reason')?.trim();
  if (!email || !reason) throw new Error('Usage: --email <owner email> --reason "<why>"');
  const password = process.env.NEW_OWNER_PASSWORD;
  const problem = passwordProblem(password);
  if (problem) throw new Error(`NEW_OWNER_PASSWORD: ${problem}`);
  const settings = readAccountAdminSettings();
  if (settings.credential !== 'DATABASE_MIGRATION_URL') throw new Error('Owner recovery runs on the migrator credential: set DATABASE_MIGRATION_URL');
  const pool = createPool(settings.pool!);
  try {
    const store = new AuthStore(pool);
    const owner = await store.withIdentity(undefined, async (db) => {
      const u = (await db.query(`SELECT id, name, role, is_active FROM users WHERE lower(email) = lower($1) FOR UPDATE`, [email])).rows[0];
      if (!u) throw new Error(`No account for ${email}`);
      if (u.role !== 'Owner / CEO') throw new Error(`${email} is not an Owner account (recovery never changes a role)`);
      if (!u.is_active) await db.query('UPDATE users SET is_active = true, updated_at = now() WHERE id = $1', [u.id]);
      await store.setPassword(db, u.id, password!);
      await writeAudit(db, { name: 'Owner recovery (migrator credential)', role: 'system' }, {
        action: 'security.owner_recovery',
        entityType: 'user',
        entityId: u.id,
        before: { is_active: u.is_active },
        after: { is_active: true, password: '(reset)', sessions: '(ended)' },
        details: reason,
      });
      return u;
    });
    console.log(`Recovered Owner ${email} (${owner.id}). Every session of this account has ended; sign in with the new password.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
