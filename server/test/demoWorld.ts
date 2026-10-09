/**
 * The demo company in a fresh test schema: Phase 3 demo data (plus an unrelated project,
 * client-3 / con-9, for cross-project checks) imported through the normal import, one
 * signed-in agent per role. Shared by the module and Phase 4 workflow tests.
 */
import type express from 'express';
import request from 'supertest';
import { expect } from 'vitest';
import { INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../../src/data/initialData';
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import { demoData } from '../modules/demo';
import { DataService } from '../modules/service';
import { buildApp, seedUsers, signIn, type SeedUser } from './app';
import { createTestDb, type TestDb } from './db';

type Row = Record<string, any>;

export const USERS: SeedUser[] = [
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

const SYSTEM: AuthUser = {
  id: 'system-import', name: 'System', email: 'system@test.local', role: 'Owner / CEO', is_active: true, is_dev_seed: false,
  client_id: null, contractor_id: null, phone: null, department: null, title: null, created_at: '', updated_at: '', last_login: null,
};

/** An unrelated project (client-3, other PM, contractor con-9) for cross-project tests. */
export function unrelatedProject(): Record<string, Row[]> {
  const project = { ...INITIAL_PROJECTS[0], id: 'proj-x', project_number: 'NW-2026-999', project_name: 'Unrelated', client_id: 'client-3', project_manager_id: 'someone-else', site_supervisor_id: 'someone-else' };
  const wp = { ...INITIAL_WORK_PACKAGES[0], id: 'wp-x', project_id: 'proj-x', contractor_id: 'con-9' };
  const item = { ...INITIAL_WORK_ITEMS[0], id: 'item-x', project_id: 'proj-x', work_package_id: 'wp-x', contractor_id: 'con-9', drawing_id: 'dwg-x', drawing_revision: 'Rev 1' };
  const drawing = {
    id: 'dwg-x', project_id: 'proj-x', drawing_number: 'X-1', title: 'Unrelated drawing', category: 'Joinery', current_revision_id: 'rev-x1', created_at: '2026-01-01',
    revisions: [{ id: 'rev-x1', drawing_id: 'dwg-x', revision: 'Rev 1', title: 'X', file_url: '/x.pdf', uploaded_date: '2026-01-01', uploaded_by: 'PM', approved_status: 'Approved', notes: '', is_current: true, drawing_type: 'Client / Designer Drawing', markups: [] }],
  };
  const delivery = { id: 'del-x', delivery_number: 'DEL-X', project_id: 'proj-x', project_name: 'Unrelated', work_package_id: 'wp-x', work_package_name: 'X', work_item_ids: ['item-x'], work_item_codes: ['X'], production_order_ids: [], contractor_id: 'con-9', contractor_name: 'Other', driver_name: '', driver_contact: '', vehicle_plate: '', vehicle_type: '', delivery_date: '2026-10-10', delivery_time: '10:00', estimated_arrival: '11:00', destination_site: 'X', special_instructions: '', package_count: 1, status: 'Scheduled', status_history: [], loading_checklist: {}, scanned_packages: [], qr_code: 'X', barcode: 'X', photos: [] };
  return { projects: [project], workPackages: [wp], workItems: [item], drawings: [drawing], deliveryRecords: [delivery] };
}


export interface DemoWorld {
  db: TestDb;
  app: express.Express;
  as: Record<string, request.Agent>;
}

export async function setupDemoWorld(opts: { restricted?: boolean } = {}): Promise<DemoWorld> {
  const db = await createTestDb(opts);
  const service = new DataService(db.pool);
  const ctx = await AccessContext.load(db.pool, SYSTEM);
  const demo = demoData();
  const extra = unrelatedProject();
  for (const [k, rows] of Object.entries(extra)) demo[k] = [...(demo[k] ?? []), ...rows];
  const imported = await service.importData(ctx, demo, {}, { id: SYSTEM.id });
  expect(imported.problems).toEqual([]);
  await seedUsers(db.pool, USERS);
  const app = buildApp(db.pool);
  const as: Record<string, request.Agent> = {};
  for (const u of USERS) as[u.role] = await signIn(app, u.email);
  return { db, app, as };
}
