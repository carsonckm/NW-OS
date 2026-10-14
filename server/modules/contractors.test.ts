/**
 * Pilot: the shared subcontractor register (migration 032), on the real restricted runtime role.
 * Shared across authorized staff; project-scoped staff see only subcontractors on their projects
 * (explicit assignment or work on the project), with only their own projects listed; a Contractor
 * account sees only its own company; no cross-project leakage; never deleted. A deactivated
 * subcontractor's accounts see nothing; unverified placeholders cannot have accounts.
 */
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_ADMIN_URL, TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';

type Row = Record<string, any>;

describe.skipIf(!TEST_DATABASE_URL || !TEST_DATABASE_ADMIN_URL)('pilot: subcontractor register (real runtime role)', () => {
  let db: TestDb;
  let as: Record<string, request.Agent> = {};

  beforeAll(async () => {
    ({ db, as } = (await setupDemoWorld({ restricted: true })) as never);
  }, 60_000);
  afterAll(async () => {
    await db?.close();
  });

  const ids = (rows: Row[]) => rows.map((r) => r.id).sort();
  const sub = (id: string, extra: Row = {}) => ({ id, company_name: `Ceiling Works ${id}`, contact_person: 'Ahmad', phone: '+60 12-000 0000', trade: 'Ceiling & lighting', ...extra });

  it('is shared: the demo register is in PostgreSQL and the Owner sees all of it, with every project', async () => {
    const all = (await as['Owner / CEO'].get('/api/contractors').expect(200)).body as Row[];
    expect(ids(all)).toEqual(expect.arrayContaining(['con-1', 'con-2', 'con-9']));
    // con-9 has no explicit assignment, but works on the unrelated project through wp-x.
    expect(all.find((c) => c.id === 'con-9')).toMatchObject({ assigned_project_ids: [], project_ids: ['proj-x'] });
  });

  it('project-scoped staff see only subcontractors on their projects, with only their projects listed', async () => {
    const pm = (await as['Project Manager'].get('/api/contractors').expect(200)).body as Row[];
    expect(ids(pm)).not.toContain('con-9');
    expect((await as['Project Manager'].get('/api/contractors/con-9')).status).toBe(404);
    // Assigned to a visible and an invisible project: the PM sees the subcontractor, not proj-x.
    await as['Owner / CEO'].post('/api/contractors').send(sub('con-both', { assigned_project_ids: ['proj-1', 'proj-x'] })).expect(201);
    const seen = (await as['Project Manager'].get('/api/contractors/con-both').expect(200)).body;
    expect(seen.assigned_project_ids).toEqual(['proj-1']);
    expect(seen.project_ids).toEqual(['proj-1']);
    expect((await as['Owner / CEO'].get('/api/contractors/con-both').expect(200)).body.project_ids).toEqual(['proj-1', 'proj-x']);
    // Not assigned anywhere the PM works: invisible to the PM, visible to company-wide staff.
    await as['Admin'].post('/api/contractors').send(sub('con-unassigned')).expect(201);
    expect((await as['Project Manager'].get('/api/contractors/con-unassigned')).status).toBe(404);
    await as['Accountant'].get('/api/contractors/con-unassigned').expect(200);
  });

  it('external accounts do not read the register (no contractors.view), and the sync snapshot leaves it out', async () => {
    for (const role of ['Contractor', 'Client']) {
      expect((await as[role].get('/api/contractors')).status, role).toBe(403);
      expect((await as[role].get('/api/contractors/con-1')).status, role).toBe(403);
      const snap = (await as[role].get('/api/data/snapshot').expect(200)).body;
      expect(snap.contractors ?? [], role).toEqual([]);
    }
  });

  it('only the Owner and Admin create and edit; project-scoped staff and contractors cannot', async () => {
    for (const role of ['Project Manager', 'Site Supervisor', 'Contractor', 'Client']) {
      expect((await as[role].post('/api/contractors').send(sub(`con-${role.length}`))).status, role).toBe(403);
      expect((await as[role].patch('/api/contractors/con-1').send({ phone: '1' })).status, role).toBeGreaterThanOrEqual(403);
    }
    await as['Admin'].patch('/api/contractors/con-both').send({ phone: '+60 3-1234 5678' }).expect(200);
    // An edit that does not mention assignments keeps them.
    expect((await as['Owner / CEO'].get('/api/contractors/con-both').expect(200)).body.assigned_project_ids).toEqual(['proj-1', 'proj-x']);
    // Validation: a name, real projects.
    expect((await as['Admin'].post('/api/contractors').send(sub('con-noname', { company_name: '  ' }))).status).toBe(400);
    expect((await as['Admin'].post('/api/contractors').send(sub('con-badproj', { assigned_project_ids: ['proj-nope'] }))).status).toBe(400);
  });

  it('assignments are kept in their table and follow edits; subcontractors are deactivated, never deleted', async () => {
    await as['Admin'].patch('/api/contractors/con-both').send({ assigned_project_ids: ['proj-2'] }).expect(200);
    const rows = (await db.owner.query(`SELECT project_id FROM contractor_project_assignments WHERE contractor_id = 'con-both' ORDER BY project_id`)).rows.map((r) => r.project_id);
    expect(rows).toEqual(['proj-2']);
    expect((await as['Admin'].delete('/api/contractors/con-both')).status).toBeGreaterThanOrEqual(403);
    await as['Admin'].patch('/api/contractors/con-both').send({ is_active: false }).expect(200);
    expect((await db.owner.query(`SELECT is_active FROM contractors WHERE id = 'con-both'`)).rows[0].is_active).toBe(false);
    // The runtime credential cannot delete one either.
    await expect(db.pool.query(`DELETE FROM contractors WHERE id = 'con-both'`)).rejects.toThrow(/permission denied/);
  });

  it('putting a subcontractor on a work package shows it to that project\'s staff', async () => {
    await as['Admin'].post('/api/contractors').send(sub('con-wp')).expect(201);
    expect((await as['Project Manager'].get('/api/contractors/con-wp')).status).toBe(404);
    const wp = ((await as['Project Manager'].get('/api/work-packages?project_id=proj-1').expect(200)).body as Row[])[0];
    await as['Project Manager'].patch(`/api/work-packages/${wp.id}`).send({ contractor_id: 'con-wp' }).expect(200);
    expect((await as['Project Manager'].get('/api/contractors/con-wp').expect(200)).body.project_ids).toEqual(['proj-1']);
  });

  it('a Contractor account must belong to a registered, active subcontractor', async () => {
    const admin = as['Admin'];
    expect((await admin.post('/api/users').send({ name: 'Sub', email: 'sub1@test.local', role: 'Contractor', contractor_id: 'con-unknown' })).status).toBe(400);
    expect((await admin.post('/api/users').send({ name: 'Sub', email: 'sub2@test.local', role: 'Contractor', contractor_id: 'con-both' })).status).toBe(400);
    await admin.post('/api/users').send({ name: 'Sub', email: 'sub3@test.local', role: 'Contractor', contractor_id: 'con-wp' }).expect(201);
  });

  it('a placeholder subcontractor is flagged, cannot get an account, and stays flagged until its details are recorded', async () => {
    // What migration 032 creates for an id that was referenced but never registered.
    await db.owner.query(
      `INSERT INTO contractors (id, company_name, trade, is_active, data) VALUES ('con-ph', 'Unregistered subcontractor con-ph', '', true,
         jsonb_build_object('id', 'con-ph', 'company_name', 'Unregistered subcontractor con-ph', 'trade', '', 'is_active', true, 'needs_details', true))`
    );
    expect((await as['Owner / CEO'].get('/api/contractors/con-ph').expect(200)).body.needs_details).toBe(true);
    const link = () => as['Admin'].post('/api/users').send({ name: 'Ph', email: `ph${Date.now()}@test.local`, role: 'Contractor', contractor_id: 'con-ph' });
    const refused = await link();
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/unverified placeholder/);
    // The flag cannot simply be switched off, nor cleared by a partial update.
    await as['Admin'].patch('/api/contractors/con-ph').send({ needs_details: false, phone: '+60 12-111 2222' }).expect(200);
    expect((await as['Owner / CEO'].get('/api/contractors/con-ph').expect(200)).body.needs_details).toBe(true);
    expect((await link()).status).toBe(400);
    // Recording who it is clears it; then an account can be linked.
    await as['Admin'].patch('/api/contractors/con-ph').send({ company_name: 'Cahaya Siling Sdn Bhd', contact_person: 'Hafiz' }).expect(200);
    expect((await as['Owner / CEO'].get('/api/contractors/con-ph').expect(200)).body.needs_details).toBe(false);
    await link().expect(201);
    // A newly registered subcontractor is never a placeholder.
    expect((await as['Owner / CEO'].get('/api/contractors/con-wp').expect(200)).body.needs_details).toBe(false);
  });

  it('deactivating a subcontractor cuts off its accounts, whatever assignments or work still name it', async () => {
    const contractor = as['Contractor']; // linked to con-1
    const visible = async () => {
      const snap = (await contractor.get('/api/data/snapshot').expect(200)).body as Record<string, unknown>;
      return Object.values(snap).reduce<number>((n, v) => n + (Array.isArray(v) ? v.length : 0), 0);
    };
    // A stale explicit project assignment, as well as the work packages that name con-1.
    await db.owner.query(`INSERT INTO project_assignments (user_id, project_id) VALUES ('user-contractor', 'proj-1') ON CONFLICT DO NOTHING`);
    const before = await visible();
    expect(before).toBeGreaterThan(0);
    const wp = ((await contractor.get('/api/work-packages').expect(200)).body as Row[])[0];
    expect(wp).toBeDefined();

    await as['Admin'].patch('/api/contractors/con-1').send({ is_active: false }).expect(200);
    expect(await visible()).toBe(0);
    expect((await contractor.get('/api/work-packages').expect(200)).body).toEqual([]);
    expect((await contractor.get(`/api/work-packages/${wp.id}`)).status).toBe(404);
    expect((await contractor.patch(`/api/work-packages/${wp.id}`).send({ notes: 'x' })).status).toBeGreaterThanOrEqual(403);

    await as['Admin'].patch('/api/contractors/con-1').send({ is_active: true }).expect(200);
    expect(await visible()).toBe(before);
  });
});
