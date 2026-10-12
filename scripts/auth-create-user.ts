// Creates a real (non-development) user. Use this for the first Owner account.
// Runs on the migrator credential (DATABASE_MIGRATION_URL): the runtime credential cannot create
// accounts without a signed-in Owner or Admin (docs/trusted-identity.md).
//
//   npm run auth:create-user -- --email you@company.com --name "Your Name" --role "Owner / CEO"
//   Optional: --client-id <id> (Client role), --contractor-id <id> (Contractor role)
//
// The account starts without a password. An activation code (single use, valid 3 days) is printed
// once for the operator to hand to the account holder, who sets their own password with it on the
// sign-in screen. The code is not stored (only its hash) and not logged.
import dotenv from 'dotenv';
import { isRole } from '../server/auth/permissions';
import { AuthStore } from '../server/auth/store';
import { readAccountAdminSettings } from '../server/db/config';
import { createPool } from '../server/db/pool';

dotenv.config();

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email');
  const name = arg('name');
  const role = arg('role');
  if (!email || !name || !role) throw new Error('Usage: --email <email> --name <name> --role <role>');
  if (!isRole(role)) throw new Error(`Unknown role "${role}"`);

  const settings = readAccountAdminSettings();
  if (!settings.pool) throw new Error('DATABASE_MIGRATION_URL (or, for development, DATABASE_URL) is not set');
  const pool = createPool(settings.pool);
  try {
    const store = new AuthStore(pool);
    const { user, code } = await store.withIdentity(undefined, async (db) => {
      const user = await store.createUser(db, {
        name,
        email,
        role,
        client_id: arg('client-id') ?? null,
        contractor_id: arg('contractor-id') ?? null,
      });
      return { user, code: await store.issueCode(db, user.id, 'activation') };
    });
    console.log(`Created ${user.role} ${user.email} (${user.id}).`);
    console.log(`Activation code (single use, expires ${code.expires_at}):`);
    console.log(`  ${code.code}`);
    console.log('Hand it to the account holder over a trusted channel; they set their password with it on the sign-in screen. It is not shown again.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
