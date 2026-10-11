// Creates a real (non-development) user. Use this for the first Owner account.
// Runs on the migrator credential (DATABASE_MIGRATION_URL): the runtime credential cannot create
// accounts without a signed-in Owner or Admin (docs/trusted-identity.md).
//
//   NEW_USER_PASSWORD='...' npm run auth:create-user -- --email you@company.com --name "Your Name" --role "Owner / CEO"
//   Optional: --client-id <id> (Client role), --contractor-id <id> (Contractor role)
//
// The password is read from NEW_USER_PASSWORD so it never appears in shell history or ps.
import dotenv from 'dotenv';
import { passwordProblem } from '../server/auth/password';
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
  const password = process.env.NEW_USER_PASSWORD;
  const problem = passwordProblem(password);
  if (problem) throw new Error(`NEW_USER_PASSWORD: ${problem}`);

  const settings = readAccountAdminSettings();
  if (!settings.pool) throw new Error('DATABASE_MIGRATION_URL (or, for development, DATABASE_URL) is not set');
  const pool = createPool(settings.pool);
  try {
    const store = new AuthStore(pool);
    const user = await store.withIdentity(undefined, (db) => store.createUser(db, {
      name,
      email,
      role,
      password,
      client_id: arg('client-id') ?? null,
      contractor_id: arg('contractor-id') ?? null,
    }));
    console.log(`Created ${user.role} ${user.email} (${user.id})`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
