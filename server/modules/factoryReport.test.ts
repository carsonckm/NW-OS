import { afterAll, beforeAll, expect, it } from 'vitest';
import { setupDemoWorld, type DemoWorld } from '../test/demoWorld';
import { TEST_DATABASE_URL } from '../test/db';

let world: DemoWorld;
beforeAll(async () => { if (TEST_DATABASE_URL) world = await setupDemoWorld(); });
afterAll(async () => { await world?.db.close(); });

it.skipIf(!TEST_DATABASE_URL)('accepts a factory report once without granting the submitter issue read access', async () => {
  const staff = world.as['Production Staff'];
  const path = '/api/issues/factory-report';
  const item = (await world.db.pool.query("SELECT id FROM work_items WHERE project_id = 'proj-1' LIMIT 1")).rows[0];
  const payload = { id: 'issue-factory-regression', work_item_id: item.id, title: 'QA factory issue', description: 'Synthetic inspection note' };
  const responses = await Promise.all([staff.post(path).send(payload).expect(200), staff.post(path).send(payload).expect(200)]);
  expect(responses.map(r => r.body)).toEqual([{ id: payload.id }, { id: payload.id }]);
  await staff.get('/api/issues/' + payload.id).expect(403);
  await staff.post(path).send({ ...payload, title: 'Changed details' }).expect(403);
  await world.as['Owner / CEO'].post(path).send(payload).expect(403);
  await staff.post(path).send({ ...payload, id: 'issue-wrong-project', work_item_id: 'item-x' }).expect(403);
  const stored = await world.db.pool.query('SELECT created_by, work_item_id FROM issues WHERE id = $1', [payload.id]);
  expect(stored.rows).toEqual([{ created_by: 'user-prod-staff', work_item_id: item.id }]);
  const audit = await world.db.pool.query("SELECT action FROM audit_logs WHERE entity_id = $1 AND entity_type = 'issues'", [payload.id]);
  expect(audit.rows).toEqual([{ action: 'create' }]);
});
