// Owner recovery (break glass): lost Owner password, the only Owner deactivated, or the cut-over to
// migration 031 (every account needs a new password).
//
//   DATABASE_MIGRATION_URL='postgres://nwos_migrator:...' \
//     npm run auth:recover-owner -- --email owner@company.com --reason "Cut-over 031, ticket 123" [--valid-minutes 60]
//
// Runs only on the migrator credential (DATABASE_MIGRATION_URL), never the runtime one, and checks
// that the connection really owns the tables. For an existing Owner account it reactivates the
// account if needed and issues a single-use recovery code (valid 60 minutes by default, at most 3
// days). The account's old password and sessions end at once. It writes a security audit record
// (operator database role and reason; never the code), and the database records the code's
// issue and, later, its use. It cannot create an Owner or change a role.
//
// The code is printed once, here, for the operator to hand to the Owner over a trusted channel; it
// is not stored (only its hash) and not logged. The Owner sets a new password with it on the
// sign-in screen ("Set a new password with a code").
import dotenv from 'dotenv';
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
  if (!email || !reason) throw new Error('Usage: --email <owner email> --reason "<why>" [--valid-minutes 60]');
  const minutes = Number(arg('valid-minutes') ?? 60);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 4320) throw new Error('--valid-minutes must be 5 to 4320');
  const settings = readAccountAdminSettings();
  if (settings.credential !== 'DATABASE_MIGRATION_URL') throw new Error('Owner recovery runs on the migrator credential: set DATABASE_MIGRATION_URL');
  const pool = createPool(settings.pool!);
  try {
    const store = new AuthStore(pool);
    const result = await store.withIdentity(undefined, async (db) => {
      const op = (await db.query(`SELECT session_user AS who, pg_has_role(session_user, (SELECT relowner FROM pg_class WHERE oid = 'users'::regclass), 'MEMBER') AS owns`)).rows[0];
      if (!op.owns) throw new Error(`The database role ${op.who} does not own NW OS's tables: Owner recovery needs the migrator credential`);
      const u = (await db.query(`SELECT id, name, role, is_active FROM users WHERE lower(email) = lower($1) FOR UPDATE`, [email])).rows[0];
      if (!u) throw new Error(`No account for ${email}`);
      if (u.role !== 'Owner / CEO') throw new Error(`${email} is not an Owner account (recovery never changes a role)`);
      if (!u.is_active) await db.query('UPDATE users SET is_active = true, updated_at = now() WHERE id = $1', [u.id]);
      const code = await store.issueCode(db, u.id, 'owner_recovery', minutes);
      await writeAudit(db, { name: `Owner recovery (operator ${op.who})`, role: 'database operator' }, {
        action: 'security.owner_recovery',
        entityType: 'user',
        entityId: u.id,
        before: { is_active: u.is_active },
        after: { is_active: true, password: '(removed; a new one is set with the recovery code)', sessions: '(ended)', code_expires_at: code.expires_at },
        details: reason,
      });
      return { u, code };
    });
    console.log(`Owner ${email} (${result.u.id}): password and sessions ended; recovery code issued.`);
    console.log(`Recovery code (single use, expires ${result.code.expires_at}):`);
    console.log(`  ${result.code.code}`);
    console.log('Hand it to the Owner over a trusted channel. They choose a new password with it on the sign-in screen ("Set a new password with a code"). It is not shown again.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
