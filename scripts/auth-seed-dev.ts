// DEVELOPMENT ONLY. Creates one sign-in account per role, mirroring the demo users
// (same ids, so existing project_manager_id / site_supervisor_id links work).
//
//   DEV_SEED_PASSWORD='at-least-12-chars' npm run auth:seed-dev [-- --with-demo-data]
//
// Safeguards: refuses to run with NODE_ENV=production; there is no built-in password;
// accounts use @dev.nwos.local emails and are flagged is_dev_seed, and the server refuses
// to sign those accounts in when NODE_ENV=production.
import dotenv from 'dotenv';
import { DEMO_USERS } from '../src/data/initialData';
import { AccessContext } from '../server/auth/access';
import { demoData } from '../server/modules/demo';
import { DataService } from '../server/modules/service';
import { passwordProblem } from '../server/auth/password';
import { AuthStore } from '../server/auth/store';
import { readDatabaseSettings } from '../server/db/config';
import { pendingMigrations } from '../server/db/migrate';
import { createPool } from '../server/db/pool';

dotenv.config();

// The demo import runs as a system Owner inside this CLI only.
const DEMO_SYSTEM_USER = {
  id: 'system-import', name: 'System import', email: 'system@nwos.local', role: 'Owner / CEO' as const, is_active: true,
  is_dev_seed: false, client_id: null, contractor_id: null, phone: null, department: null, title: null, last_login: null,
};

const slug = (role: string) => role.toLowerCase().replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '');

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed development accounts with NODE_ENV=production');
  const password = process.env.DEV_SEED_PASSWORD;
  const problem = passwordProblem(password);
  if (problem) throw new Error(`DEV_SEED_PASSWORD: ${problem}`);

  const settings = readDatabaseSettings();
  if (!settings.pool) throw new Error('DATABASE_URL is not set');
  const pool = createPool(settings.pool);
  try {
    const pending = await pendingMigrations(pool);
    if (pending.length) throw new Error(`Run npm run db:migrate first (pending: ${pending.join(', ')})`);

    if (process.argv.includes('--with-demo-data')) {
      const system = { ...DEMO_SYSTEM_USER, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      const result = await new DataService(pool).importData(await AccessContext.load(pool, system), demoData(), {}, {
        id: system.id, name: system.name, role: system.role,
      });
      if (!result.ok) throw new Error(`Demo data import failed: ${result.problems.join('; ')}`);
    }

    const store = new AuthStore(pool);
    const projects = new Set((await pool.query('SELECT id FROM projects')).rows.map((r) => r.id));
    const clients = new Set((await pool.query('SELECT id FROM clients')).rows.map((r) => r.id));
    for (const demo of DEMO_USERS) {
      if (demo.role === 'Client' && !clients.has(demo.client_id!)) {
        throw new Error(`Client ${demo.client_id} is missing; run with --with-demo-data or npm run db:import-demo`);
      }
      const email = `${slug(demo.role)}@dev.nwos.local`;
      const existing = await store.getUser(demo.id);
      if (existing && !existing.is_dev_seed) throw new Error(`User ${demo.id} exists and is not a dev seed account; not touching it`);
      const fields = {
        name: demo.name,
        email,
        role: demo.role,
        client_id: demo.client_id ?? null,
        contractor_id: demo.contractor_id ?? null,
        department: demo.department ?? null,
        title: demo.title ?? null,
        is_active: true,
        password,
      };
      if (existing) await store.updateUser(demo.id, fields);
      else await store.createUser({ id: demo.id, ...fields, is_dev_seed: true });
      // Explicit assignments only for roles scoped by them (PM / supervisor / contractor
      // scope also comes from the project and work package records themselves).
      const assigned = (demo.assigned_project_ids ?? []).filter((p) => projects.has(p));
      const scopedByAssignment = ['Production Staff', 'Production Manager', 'Project Manager', 'Site Supervisor'].includes(demo.role);
      await store.setAssignments(demo.id, scopedByAssignment ? assigned : []);
      console.log(`${demo.role.padEnd(20)} ${email}`);
    }
    console.log('\nDevelopment accounts ready (password from DEV_SEED_PASSWORD). Never run this against production.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
