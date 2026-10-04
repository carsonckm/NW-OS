import type express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { INITIAL_CLIENTS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../../src/data/initialData';
import type { Project, WorkItem, WorkPackage } from '../../src/types';
import { CoreRepository } from '../core/repository';
import { buildApp, seedUsers, signIn, TEST_PASSWORD, type SeedUser } from '../test/app';
import { createTestDb, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { AuthStore } from './store';

/*
 * Fixtures: the demo core chain plus one "unrelated" project (proj-x) that belongs to
 * client-3, has another PM / supervisor, and only contractor con-9's work.
 *   Contractor (con-1): packages wp-1, wp-4, wp-5 on proj-1, proj-2, proj-3; nothing on proj-x.
 *   Client (client-1): proj-1 and proj-demo-1 only.
 *   Production Staff: assigned to proj-1 only.
 */
const USERS: SeedUser[] = [
  { id: 'user-owner', role: 'Owner / CEO', email: 'owner@test.local' },
  { id: 'user-admin', role: 'Admin', email: 'admin@test.local' },
  { id: 'user-pm', role: 'Project Manager', email: 'pm@test.local' },
  { id: 'user-site', role: 'Site Supervisor', email: 'site@test.local' },
  { id: 'user-purchasing', role: 'Purchasing', email: 'purchasing@test.local' },
  { id: 'user-accountant', role: 'Accountant', email: 'accountant@test.local' },
  { id: 'user-prod-mgr', role: 'Production Manager', email: 'prodmgr@test.local' },
  { id: 'user-prod-staff', role: 'Production Staff', email: 'staff@test.local', assigned: ['proj-1'] },
  { id: 'user-contractor', role: 'Contractor', email: 'contractor@test.local', contractor_id: 'con-1' },
  { id: 'user-client', role: 'Client', email: 'client@test.local', client_id: 'client-1' },
];

const projX: Project = {
  ...INITIAL_PROJECTS[0],
  id: 'proj-x',
  project_number: 'NW-2026-999',
  project_name: 'Unrelated project',
  client_id: 'client-3',
  project_manager_id: 'someone-else',
  site_supervisor_id: 'someone-else',
};
const wpX: WorkPackage = { ...INITIAL_WORK_PACKAGES[0], id: 'wp-x', project_id: 'proj-x', contractor_id: 'con-9' };
const itemX: WorkItem = { ...INITIAL_WORK_ITEMS[0], id: 'item-x', project_id: 'proj-x', work_package_id: 'wp-x', contractor_id: 'con-9' };

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

describe.skipIf(!TEST_DATABASE_URL)('authentication and server-side authorisation', () => {
  let db: TestDb;
  let app: express.Express;
  const as: Record<string, request.Agent> = {};

  beforeAll(async () => {
    db = await createTestDb();
    const imported = await new CoreRepository(db.pool).importData({
      clients: INITIAL_CLIENTS,
      projects: [...INITIAL_PROJECTS, projX],
      workPackages: [...INITIAL_WORK_PACKAGES, wpX],
      workItems: [...INITIAL_WORK_ITEMS, itemX],
    });
    expect(imported.ok).toBe(true);
    await seedUsers(db.pool, USERS);
    app = buildApp(db.pool);
    for (const u of USERS) as[u.role] = await signIn(app, u.email);
  });
  afterAll(async () => {
    await db?.close();
  });

  describe('unauthenticated requests', () => {
    it.each([
      ['GET', '/api/clients'],
      ['GET', '/api/projects/proj-1'],
      ['GET', '/api/core/snapshot'],
      ['POST', '/api/core/sync'],
      ['POST', '/api/projects'],
      ['GET', '/api/users'],
      ['POST', '/api/ai/echo'],
    ])('%s %s -> 401', async (method, path) => {
      const res = await request(app)[method.toLowerCase() as 'get' | 'post'](path).send({});
      expect(res.status).toBe(401);
    });

    it('rejects an invented session cookie', async () => {
      const res = await request(app).get('/api/clients').set('Cookie', 'nwos_session=forged-token-value');
      expect(res.status).toBe(401);
    });

    it('status is public but reveals nothing about the data', async () => {
      const res = await request(app).get('/api/core/status');
      expect(res.status).toBe(200);
      expect(res.body.authEnabled).toBe(true);
      expect(res.body).not.toHaveProperty('databaseEmpty');
    });
  });

  describe('login and sessions', () => {
    it('sets an HttpOnly, SameSite=Lax session cookie and never returns password data', async () => {
      const res = await request(app).post('/api/auth/login').send({ email: 'OWNER@test.local', password: TEST_PASSWORD });
      expect(res.status).toBe(200);
      const cookie = res.headers['set-cookie'][0];
      expect(cookie).toMatch(/^nwos_session=/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/SameSite=Lax/);
      expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt/);
      expect(res.body.user.permissions).toContain('clients.delete');
    });

    it('gives the same answer for a wrong password and an unknown email', async () => {
      const wrong = await request(app).post('/api/auth/login').send({ email: 'owner@test.local', password: 'nope-nope-nope' });
      const unknown = await request(app).post('/api/auth/login').send({ email: 'ghost@test.local', password: 'nope-nope-nope' });
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('stores passwords only as scrypt hashes', async () => {
      const res = await db.pool.query(`SELECT password_hash FROM users WHERE email = 'owner@test.local'`);
      expect(res.rows[0].password_hash).toMatch(/^scrypt\$/);
      expect(res.rows[0].password_hash).not.toContain(TEST_PASSWORD);
    });

    it('records last_login', async () => {
      const res = await db.pool.query(`SELECT last_login FROM users WHERE id = 'user-owner'`);
      expect(res.rows[0].last_login).toBeTruthy();
    });

    it('ends the session on logout', async () => {
      const agent = await signIn(app, 'admin@test.local');
      await agent.post('/api/auth/logout').expect(204);
      expect((await agent.get('/api/clients')).status).toBe(401);
    });

    it('rate-limits repeated failed logins', async () => {
      let last = 0;
      for (let i = 0; i < 11; i++) {
        last = (await request(app).post('/api/auth/login').send({ email: 'limit@test.local', password: 'wrong-password' })).status;
      }
      expect(last).toBe(429);
    });

    it('refuses development seed accounts when NODE_ENV=production', async () => {
      await new AuthStore(db.pool).createUser({
        name: 'Seed',
        email: 'seed@dev.nwos.local',
        role: 'Owner / CEO',
        password: TEST_PASSWORD,
        is_dev_seed: true,
      });
      const before = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const res = await request(app).post('/api/auth/login').send({ email: 'seed@dev.nwos.local', password: TEST_PASSWORD });
        expect(res.status).toBe(403);
        expect(res.body.error).toBe('dev_account_disabled');
      } finally {
        process.env.NODE_ENV = before;
      }
    });
  });

  describe('Owner', () => {
    it('sees everything, including contract values, and can build the core chain', async () => {
      const owner = as['Owner / CEO'];
      expect(ids((await owner.get('/api/projects')).body)).toEqual(['proj-1', 'proj-2', 'proj-3', 'proj-demo-1', 'proj-x']);
      expect((await owner.get('/api/projects/proj-1')).body.contract_value).toBeGreaterThan(0);

      const client = (await owner.post('/api/clients').send({ ...INITIAL_CLIENTS[0], id: undefined, company_name: 'Owner Co' }).expect(201)).body;
      const project = (
        await owner
          .post('/api/projects')
          .send({ ...INITIAL_PROJECTS[0], id: undefined, client_id: client.id, project_number: 'NW-OWN-1' })
          .expect(201)
      ).body;
      const wp = (await owner.post('/api/work-packages').send({ ...INITIAL_WORK_PACKAGES[0], id: undefined, project_id: project.id }).expect(201)).body;
      const item = (
        await owner
          .post('/api/work-items')
          .send({ ...INITIAL_WORK_ITEMS[0], id: undefined, project_id: undefined, work_package_id: wp.id })
          .expect(201)
      ).body;
      const tree = (await owner.get(`/api/clients/${client.id}/tree`).expect(200)).body;
      expect(tree.projects[0].work_packages[0].work_items[0].id).toBe(item.id);
    });
  });

  describe('Admin', () => {
    it('can view and create but not delete clients (no clients.delete)', async () => {
      const admin = as['Admin'];
      expect((await admin.get('/api/clients')).body.length).toBeGreaterThan(0);
      const created = await admin.post('/api/clients').send({ ...INITIAL_CLIENTS[1], id: undefined, company_name: 'Admin Co' });
      expect(created.status).toBe(201);
      expect((await admin.delete(`/api/clients/${created.body.id}`)).status).toBe(403);
    });
  });

  describe('roles without the permission are rejected on direct API calls', () => {
    it.each([
      ['Site Supervisor', 'post', '/api/clients'],
      ['Purchasing', 'post', '/api/projects'],
      ['Project Manager', 'post', '/api/projects'],
      ['Accountant', 'patch', '/api/projects/proj-1'],
      ['Accountant', 'delete', '/api/work-items/item-1'],
      ['Client', 'patch', '/api/projects/proj-1'],
      ['Contractor', 'post', '/api/work-items'],
      ['Production Staff', 'get', '/api/projects'],
      ['Contractor', 'get', '/api/projects'],
      ['Client', 'get', '/api/clients'],
    ] as const)('%s %s %s -> 403', async (role, method, path) => {
      const res = await as[role][method](path).send({ project_name: 'x', work_package_id: 'wp-1' });
      expect(res.status).toBe(403);
    });

    it('rejects a batch sync containing a change the user may not make', async () => {
      const res = await as['Accountant']
        .post('/api/core/sync')
        .send({ upserts: { projects: [{ ...INITIAL_PROJECTS[0], project_name: 'Accountant edit' }] } });
      expect(res.status).toBe(403);
      const stored = await db.pool.query(`SELECT project_name FROM projects WHERE id = 'proj-1'`);
      expect(stored.rows[0].project_name).not.toBe('Accountant edit');
    });

    it('lets only settings.manage import data', async () => {
      expect((await as['Project Manager'].post('/api/core/import?dryRun=true').send({})).status).toBe(403);
      expect((await as['Owner / CEO'].post('/api/core/import?dryRun=true').send({})).status).toBe(200);
    });
  });

  describe('Contractor scope', () => {
    const contractor = () => as['Contractor'];

    it('sees only its own work packages and work items', async () => {
      const wps = (await contractor().get('/api/work-packages')).body as WorkPackage[];
      // wp-1/4/5 from the demo data (plus any con-1 package created by earlier tests).
      expect(ids(wps)).toEqual(expect.arrayContaining(['wp-1', 'wp-4', 'wp-5']));
      expect(wps.every((w) => w.contractor_id === 'con-1')).toBe(true);
      expect(ids(wps)).not.toContain('wp-2'); // con-2's package on the same project
      expect(ids(wps)).not.toContain('wp-x');
      const items = (await contractor().get('/api/work-items')).body as WorkItem[];
      expect(items.length).toBeGreaterThan(0);
      const ownPackages = new Set(ids(wps));
      expect(items.every((i) => i.contractor_id === 'con-1' || ownPackages.has(i.work_package_id))).toBe(true);
      expect(ids(items)).not.toContain('item-x');
      expect(ids(items)).not.toContain('item-5'); // con-2's item on the same project
    });

    it('cannot reach an unrelated project by id, filter or batch', async () => {
      expect((await contractor().get('/api/work-items/item-x')).status).toBe(404);
      expect((await contractor().get('/api/work-packages/wp-x')).status).toBe(404);
      expect((await contractor().get('/api/work-items?project_id=proj-x')).body).toEqual([]);
      expect((await contractor().patch('/api/work-items/item-x').send({ status: 'Completed' })).status).toBe(404);
      const sync = await contractor().post('/api/core/sync').send({ upserts: { workItems: [{ ...itemX, status: 'Completed' }] } });
      expect(sync.status).toBe(403);
      const snap = (await contractor().get('/api/core/snapshot')).body;
      expect(snap.projects).toEqual([]);
      expect(ids(snap.workItems)).not.toContain('item-x');
    });

    it('may update progress on its own item but not its specification', async () => {
      const ok = await contractor().patch('/api/work-items/item-1').send({ status: 'In Progress', progress_percent: 70 });
      expect(ok.status).toBe(200);
      const spec = await contractor().patch('/api/work-items/item-1').send({ description: 'Changed by contractor' });
      expect(spec.status).toBe(403);
    });

    it('can sync an unchanged full record with only execution fields changed', async () => {
      const current = (await contractor().get('/api/work-items/item-2')).body;
      const res = await contractor().post('/api/core/sync').send({ upserts: { workItems: [{ ...current, progress_percent: 55 }] } });
      expect(res.status).toBe(200);
      const site = await contractor().patch('/api/work-items/item-2').send({ installation_status: 'In Progress', delivery_status: 'Received / Confirmed' });
      expect(site.status).toBe(200);
      expect((await contractor().patch('/api/work-items/item-2').send({ drawing_revision: 'Rev 9' })).status).toBe(403);
    });
  });

  describe('Client scope', () => {
    const client = () => as['Client'];

    it('sees only its own projects, without contract values', async () => {
      const projects = (await client().get('/api/projects')).body as Project[];
      expect(ids(projects)).toEqual(['proj-1', 'proj-demo-1']);
      expect(projects.every((p) => !('contract_value' in p))).toBe(true);
      const snap = (await client().get('/api/core/snapshot')).body;
      expect(snap.projects.every((p: Project) => !('contract_value' in p))).toBe(true);
      expect(snap.clients).toEqual([]); // no clients.view
    });

    it("cannot reach another client's project or its work", async () => {
      expect((await client().get('/api/projects/proj-2')).status).toBe(404);
      expect((await client().get('/api/projects?client_id=client-2')).body).toEqual([]);
      const items = (await client().get('/api/work-items')).body as WorkItem[];
      expect(items.every((i) => ['proj-1', 'proj-demo-1'].includes(i.project_id))).toBe(true);
    });
  });

  describe('project-scoped staff', () => {
    it('Production Staff sees only assigned project work', async () => {
      const items = (await as['Production Staff'].get('/api/work-items')).body as WorkItem[];
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((i) => i.project_id === 'proj-1')).toBe(true);
    });

    it('Project Manager cannot see a project they do not manage', async () => {
      expect((await as['Project Manager'].get('/api/projects/proj-x')).status).toBe(404);
      expect((await as['Project Manager'].get('/api/projects/proj-1')).status).toBe(200);
    });
  });

  describe('forged identity', () => {
    it('ignores a role claimed in the body, query or headers', async () => {
      const contractor = as['Contractor'];
      const res = await contractor
        .post('/api/clients?role=Owner%20%2F%20CEO')
        .set('X-User-Role', 'Owner / CEO')
        .send({ ...INITIAL_CLIENTS[0], id: undefined, role: 'Owner / CEO', userRole: 'Owner / CEO' });
      expect(res.status).toBe(403);
    });

    it('replaces identity fields sent to AI endpoints with the session user', async () => {
      const res = await as['Contractor']
        .post('/api/ai/echo')
        .send({ userRole: 'Owner / CEO', role: 'Owner / CEO', userName: 'Boss', user: { role: 'Owner / CEO' } });
      expect(res.body).toMatchObject({ userRole: 'Contractor', role: 'Contractor', user: { role: 'Contractor' } });
    });
  });

  describe('deactivated users', () => {
    it('lose their open session immediately and cannot sign in again', async () => {
      const victim = await signIn(app, 'purchasing@test.local');
      expect((await victim.get('/api/work-items')).status).toBe(200);
      await as['Owner / CEO'].patch('/api/users/user-purchasing').send({ is_active: false }).expect(200);
      expect((await victim.get('/api/work-items')).status).toBe(401);
      const relogin = await request(app).post('/api/auth/login').send({ email: 'purchasing@test.local', password: TEST_PASSWORD });
      expect(relogin.status).toBe(403);
    });
  });

  describe('user administration', () => {
    it('is closed to roles without users.view / users.manage', async () => {
      expect((await as['Contractor'].get('/api/users')).status).toBe(403);
      expect((await as['Project Manager'].patch('/api/users/user-client').send({ role: 'Admin' })).status).toBe(403);
    });

    it('never lists password data', async () => {
      const res = await as['Admin'].get('/api/users').expect(200);
      expect(JSON.stringify(res.body)).not.toMatch(/password|scrypt/);
    });

    it('stops an Admin from creating Owners or changing their own role', async () => {
      const admin = as['Admin'];
      const owner = await admin
        .post('/api/users')
        .send({ name: 'New Owner', email: 'newowner@test.local', role: 'Owner / CEO', password: TEST_PASSWORD });
      expect(owner.status).toBe(403);
      expect((await admin.patch('/api/users/user-admin').send({ role: 'Owner / CEO' })).status).toBe(403);
      expect((await admin.patch('/api/users/user-owner').send({ is_active: false })).status).toBe(403);
    });

    it('rejects weak passwords', async () => {
      const res = await as['Owner / CEO']
        .post('/api/users')
        .send({ name: 'Weak', email: 'weak@test.local', role: 'Admin', password: 'short' });
      expect(res.status).toBe(400);
    });
  });

  describe('cross-site request protection', () => {
    it('refuses writes from another origin and non-JSON bodies', async () => {
      const owner = as['Owner / CEO'];
      const cross = await owner.post('/api/clients').set('Origin', 'https://evil.example').send({ company_name: 'x' });
      expect(cross.status).toBe(403);
      const form = await owner.post('/api/clients').type('form').send('company_name=x');
      expect(form.status).toBe(415);
    });
  });
});
