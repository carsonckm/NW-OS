import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, type TestDb } from '../test/db';
import { setupDemoWorld } from '../test/demoWorld';
import { reevaluateRoutes, syncRoute } from './approvalRouting';

describe.skipIf(!TEST_DATABASE_URL)('concurrent approval routing', () => {
  let db: TestDb;
  const actor = { name: 'QA routing pass' };

  beforeAll(async () => {
    ({ db } = await setupDemoWorld());
  });

  afterAll(async () => {
    await db?.close();
  });

  it('concurrent passes create one route, audit entry and notification for imported apr-1', async () => {
    const id = 'apr-1';
    expect((await db.pool.query('SELECT decision FROM approvals WHERE id = $1', [id])).rows).toEqual([{ decision: 'Pending' }]);
    expect((await db.pool.query('SELECT id FROM approval_routes WHERE resource_id = $1', [id])).rows).toEqual([]);

    const first = await db.pool.connect();
    const contender = db.connect();
    try {
      await first.query('BEGIN');
      const route = await syncRoute(first, actor, 'approval', id);
      expect(route?.assigned_user_id).toBe('user-owner');

      const second = await contender.connect();
      try {
        const pid = (await second.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await second.query('BEGIN');
        // Keep the first insert uncommitted until the other pass actually reaches a lock.
        // Without serialization it waits on the unique index and fails after the commit.
        const pass = Promise.allSettled([reevaluateRoutes(second, actor, { projectId: 'proj-1' })]);
        try {
          let blocked = false;
          const deadline = Date.now() + 5_000;
          while (!blocked && Date.now() < deadline) {
            const { rows } = await db.pool.query('SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked', [pid]);
            blocked = rows[0].blocked;
            if (!blocked) await delay(10);
          }
          expect(blocked).toBe(true);
          await first.query('COMMIT');
          const [result] = await pass;
          if (result.status === 'rejected') throw result.reason;
          await second.query('COMMIT');
        } finally {
          await first.query('ROLLBACK');
          await pass;
          await second.query('ROLLBACK');
        }
      } finally {
        second.release();
      }

      const routes = (await db.pool.query(
        'SELECT id, status FROM approval_routes WHERE resource_kind = $1 AND resource_id = $2',
        ['approval', id]
      )).rows;
      expect(routes).toEqual([{ id: route!.id, status: 'open' }]);
      const routeId = String(route!.id);
      expect((await db.pool.query(
        "SELECT action FROM audit_logs WHERE entity_type = 'approval_route' AND entity_id = $1",
        [routeId]
      )).rows).toEqual([{ action: 'approval.route.assign' }]);
      expect((await db.pool.query(
        "SELECT user_id FROM notifications WHERE entity_type = 'approval_route' AND entity_id = $1",
        [routeId]
      )).rows).toEqual([{ user_id: 'user-owner' }]);
    } finally {
      await first.query('ROLLBACK');
      first.release();
      await contender.end();
    }
  }, 15_000);
});
