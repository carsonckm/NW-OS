import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { INITIAL_CLIENTS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../../src/data/initialData';
import type { Client, Project, WorkItem, WorkPackage } from '../../src/types';
import { createPool } from '../db/pool';
import { buildApp, seedUsers, signIn } from '../test/app';
import { createTestDb, TEST_DATABASE_URL, truncateCore, type TestDb } from '../test/db';
import { ENTITIES } from './schema';

// These tests cover data behaviour as an Owner; authorisation is covered in server/auth.
const OWNER = { id: 'user-owner', role: 'Owner / CEO' as const, email: 'owner@test.local' };

const clientInput = {
  client_type: 'Retail',
  company_name: 'Vitest Retail Sdn Bhd',
  registration_number: '202601000001 (1500001-A)',
  contact_person: 'Aisyah Rahman',
  email: 'aisyah@example.com',
  phone: '+60 12-345 6789',
  billing_address: 'Jalan Ujian 1, Kuala Lumpur',
};

const projectInput = (client_id: string) => ({
  project_number: 'NW-2026-901',
  project_name: 'Vitest Flagship',
  client_id,
  site_address: 'Lot 1, Pavilion KL',
  contract_value: 480000.5,
  project_status: 'Active',
  start_date: '2026-10-01',
  end_date: '2026-12-15',
  signed_date: '',
  project_manager_id: 'u-3',
  site_supervisor_id: 'u-4',
  progress_percent: 0,
  description: 'Created by the database test suite',
});

const packageInput = (project_id: string) => ({
  project_id,
  name: 'CARPENTRY & JOINERY',
  category: 'Carpentry',
  contractor_id: 'con-1',
  project_manager_id: 'u-3',
  start_date: '2026-10-05',
  end_date: '2026-11-30',
  status: 'Assigned',
  progress_percent: 0,
});

const itemInput = (work_package_id: string) => ({
  work_package_id,
  item_code: 'CAR-101',
  description: 'Cashier counter',
  location: 'Front of house',
  quantity: 1,
  unit: 'unit',
  drawing_id: 'dwg-1',
  drawing_revision: 'Rev 1',
  material: '18mm plywood',
  finish: 'Oak HPL',
  dimensions: '2400 x 900 x 1050mm',
  required_date: '2026-11-20',
  contractor_id: 'con-1',
  status: 'Assigned',
  progress_percent: 0,
  photos: [],
  production_status: 'Not Started',
  delivery_status: 'Not Scheduled',
  installation_status: 'Not Started',
});

describe('core API without a database', () => {
  it('reports local mode and answers 503 only on core routes', async () => {
    const app = buildApp();
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    const status = await request(app).get('/api/core/status');
    expect(status.body).toMatchObject({ configured: false, dataSource: 'local', authEnabled: false });
    expect((await request(app).get('/api/clients')).status).toBe(503);
    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/auth/session')).body).toEqual({ authEnabled: false, user: null });
  });
});

describe.skipIf(!TEST_DATABASE_URL)('core API with PostgreSQL', () => {
  let db: TestDb;
  let app: request.Agent;

  beforeAll(async () => {
    db = await createTestDb();
    await seedUsers(db.pool, [OWNER]);
    app = await signIn(buildApp(db.pool), OWNER.email);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await truncateCore(db.pool);
  });

  const createChain = async () => {
    const client = (await app.post('/api/clients').send(clientInput).expect(201)).body as Client;
    const project = (await app.post('/api/projects').send(projectInput(client.id)).expect(201)).body as Project;
    const wp = (await app.post('/api/work-packages').send(packageInput(project.id)).expect(201)).body as WorkPackage;
    const item = (await app.post('/api/work-items').send(itemInput(wp.id)).expect(201)).body as WorkItem;
    return { client, project, wp, item };
  };

  it('schema matches the field map in server/core/schema.ts', async () => {
    for (const def of Object.values(ENTITIES)) {
      const res = await db.pool.query(
        `SELECT column_name, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
        [db.schema, def.table]
      );
      const cols = new Map(res.rows.map((r) => [r.column_name, r.is_nullable === 'YES']));
      for (const [field, kind] of Object.entries(def.fields)) {
        expect(cols.has(field), `${def.table}.${field} exists`).toBe(true);
        const shouldBeNullable = kind.endsWith('?') || kind === 'date';
        expect(cols.get(field), `${def.table}.${field} nullability`).toBe(shouldBeNullable);
      }
      expect(cols.size, `${def.table} has no extra columns`).toBe(Object.keys(def.fields).length);
    }
  });

  it('runs the first flow: create chain, read the full tree, update the item, survive a reconnect', async () => {
    const { client, project, wp, item } = await createChain();

    expect(client.id).toMatch(/^client-/);
    expect(project.contract_value).toBe(480000.5);
    expect(project.signed_date).toBe(''); // blank date round-trips as ''
    expect(item.project_id).toBe(project.id); // derived from the work package
    expect(item.photos).toEqual([]);
    expect('notes' in item).toBe(false); // NULL optional fields are omitted

    const tree = (await app.get(`/api/clients/${client.id}/tree`).expect(200)).body;
    expect(tree.id).toBe(client.id);
    expect(tree.projects).toHaveLength(1);
    expect(tree.projects[0].id).toBe(project.id);
    expect(tree.projects[0].work_packages[0].id).toBe(wp.id);
    expect(tree.projects[0].work_packages[0].work_items.map((w: WorkItem) => w.id)).toEqual([item.id]);

    const updated = (
      await app
        .patch(`/api/work-items/${item.id}`)
        .send({ status: 'In Progress', progress_percent: 35, notes: 'Carcass assembled' })
        .expect(200)
    ).body as WorkItem;
    expect(updated.status).toBe('In Progress');
    expect(updated.updated_at > item.updated_at).toBe(true);

    // A brand-new pool (like a server restart) sees the persisted change.
    const fresh = db.connect();
    try {
      const freshApp = await signIn(buildApp(fresh), OWNER.email);
      const reread = (await freshApp.get(`/api/work-items/${item.id}`).expect(200)).body as WorkItem;
      expect(reread).toMatchObject({ status: 'In Progress', progress_percent: 35, notes: 'Carcass assembled' });
    } finally {
      await fresh.end();
    }
  });

  it('lists children filtered by parent', async () => {
    const { project, wp, item } = await createChain();
    expect((await app.get(`/api/projects?client_id=nope`)).body).toEqual([]);
    expect((await app.get(`/api/work-packages?project_id=${project.id}`)).body.map((w: WorkPackage) => w.id)).toEqual([wp.id]);
    expect((await app.get(`/api/work-items?work_package_id=${wp.id}`)).body.map((w: WorkItem) => w.id)).toEqual([item.id]);
  });

  describe('relationships', () => {
    it('rejects a project for a missing client', async () => {
      const res = await app.post('/api/projects').send(projectInput('client-missing'));
      expect(res.status).toBe(409);
      expect(res.body.error).toBe('foreign_key_violation');
    });

    it('rejects a work item whose project differs from its package', async () => {
      const { client, wp } = await createChain();
      const other = (await app.post('/api/projects').send({ ...projectInput(client.id), project_number: 'NW-2026-902' })).body;
      const res = await app.post('/api/work-items').send({ ...itemInput(wp.id), project_id: other.id });
      expect(res.status).toBe(409);
    });

    it('rejects a work item for a missing work package', async () => {
      const res = await app.post('/api/work-items').send(itemInput('wp-missing'));
      expect(res.status).toBe(400);
    });

    it('refuses to delete a parent that still has children, then deletes leaf-first', async () => {
      const { client, project, wp, item } = await createChain();
      expect((await app.delete(`/api/clients/${client.id}`)).status).toBe(409);
      expect((await app.delete(`/api/work-packages/${wp.id}`)).status).toBe(409);
      await app.delete(`/api/work-items/${item.id}`).expect(204);
      await app.delete(`/api/work-packages/${wp.id}`).expect(204);
      await app.delete(`/api/projects/${project.id}`).expect(204);
      await app.delete(`/api/clients/${client.id}`).expect(204);
      expect((await app.get(`/api/clients/${client.id}`)).status).toBe(404);
    });
  });

  describe('validation', () => {
    it('rejects statuses outside the TypeScript unions', async () => {
      const { item } = await createChain();
      const res = await app.patch(`/api/work-items/${item.id}`).send({ status: 'Teleported' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('check_violation');
    });

    it('rejects missing required fields and changing ids', async () => {
      const { client } = await createChain();
      expect((await app.post('/api/clients').send({ company_name: 'No type' })).status).toBe(400);
      expect((await app.patch(`/api/clients/${client.id}`).send({ id: 'other' })).status).toBe(400);
    });

    it('returns 404 for unknown ids', async () => {
      expect((await app.get('/api/projects/nope')).status).toBe(404);
      expect((await app.patch('/api/projects/nope').send({ project_name: 'x' })).status).toBe(404);
    });
  });

  describe('import', () => {
    const demo = {
      clients: INITIAL_CLIENTS,
      projects: INITIAL_PROJECTS,
      workPackages: INITIAL_WORK_PACKAGES,
      workItems: INITIAL_WORK_ITEMS,
    };

    it('dry-runs without writing, then imports the demo data losslessly', async () => {
      const dry = (await app.post('/api/core/import?dryRun=true').send(demo).expect(200)).body;
      expect(dry).toMatchObject({ ok: true, imported: false });
      expect((await app.get('/api/clients')).body).toHaveLength(0);

      const res = (await app.post('/api/core/import').send(demo).expect(200)).body;
      expect(res.imported).toBe(true);
      const snap = (await app.get('/api/core/snapshot')).body;
      expect(snap.workItems).toHaveLength(INITIAL_WORK_ITEMS.length);

      // Every field the app had survives the round trip (timestamps compared as instants).
      const norm = (o: Record<string, unknown>) =>
        Object.fromEntries(
          Object.entries(o).map(([k, v]) => [k, /_at$/.test(k) && typeof v === 'string' ? new Date(v).toISOString() : v])
        );
      for (const original of INITIAL_WORK_ITEMS) {
        const stored = snap.workItems.find((w: WorkItem) => w.id === original.id);
        expect(norm(stored)).toEqual(norm(original as unknown as Record<string, unknown>));
      }
      for (const original of INITIAL_PROJECTS) {
        const stored = snap.projects.find((p: Project) => p.id === original.id);
        // Sensitivity is the server's (Owner-only, Phase 6): every imported project starts Normal.
        expect(norm(stored)).toEqual(norm({ ...original, sensitivity: 'Normal' } as unknown as Record<string, unknown>));
      }
    });

    it('never overwrites rows that already exist', async () => {
      await app.post('/api/core/import').send(demo).expect(200);
      const target = INITIAL_CLIENTS[0];
      await app.patch(`/api/clients/${target.id}`).send({ company_name: 'Changed in DB' }).expect(200);

      const again = (await app.post('/api/core/import').send(demo).expect(200)).body;
      expect(again.summary.clients).toMatchObject({ new: 0, skippedExisting: INITIAL_CLIENTS.length });
      expect((await app.get(`/api/clients/${target.id}`)).body.company_name).toBe('Changed in DB');
    });

    it('rejects orphaned records and writes nothing', async () => {
      const res = await app
        .post('/api/core/import')
        .send({ ...demo, projects: [...INITIAL_PROJECTS, { ...INITIAL_PROJECTS[0], id: 'proj-orphan', client_id: 'client-ghost' }] });
      expect(res.status).toBe(422);
      // Refused by the foreign key inside the same transaction as the rest of the import.
      expect(res.body.problems).toEqual([expect.stringMatching(/client-ghost/)]);
      expect((await app.get('/api/clients')).body).toHaveLength(0);
    });
  });

  describe('batch sync', () => {
    it('applies children before parents in one batch thanks to deferred keys', async () => {
      const client = { ...INITIAL_CLIENTS[0] };
      const project = { ...INITIAL_PROJECTS.find((p) => p.client_id === client.id)! };
      const wp = { ...INITIAL_WORK_PACKAGES.find((w) => w.project_id === project.id)! };
      const res = await app
        .post('/api/core/sync')
        .send({ upserts: { workPackages: [wp], projects: [project], clients: [client] } })
        .expect(200);
      expect(res.body).toEqual({ upserted: 3, deleted: 0 });
    });

    it('rolls back the whole batch when it would leave an orphan', async () => {
      const { client, project } = await createChain();
      const res = await app
        .post('/api/core/sync')
        .send({ upserts: { projects: [{ ...project, project_name: 'Renamed' }] }, deletes: { clients: [client.id] } });
      expect(res.status).toBe(409);
      expect((await app.get(`/api/projects/${project.id}`)).body.project_name).toBe('Vitest Flagship');
    });
  });
});
