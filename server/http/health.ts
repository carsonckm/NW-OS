/**
 * Health checks for the host and for monitoring. No authentication; nothing sensitive in the
 * answer (no error messages, versions of dependencies, hostnames or credentials).
 *
 *   GET /api/health/live   the process answers (a liveness probe: restart only if this fails)
 *   GET /api/health        readiness: the database answers a query within 2 seconds, and the
 *                          automation scheduler has ticked recently. 200 when healthy, 503 when
 *                          the database is unavailable or the scheduler is stale.
 */
import express from 'express';
import type { Pool } from '../db/pool';
import { aiStatus } from '../ai/gateway';

export type SchedulerState = 'off' | 'starting' | 'running' | 'stale' | 'not_configured';

const DB_TIMEOUT_MS = 2000;

async function databaseState(pool: Pool | undefined): Promise<'ok' | 'unavailable' | 'not_configured'> {
  if (!pool) return 'not_configured';
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), DB_TIMEOUT_MS);
    });
    await Promise.race([pool.query('SELECT 1'), timeout]);
    return 'ok';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

export function createHealthRouter({ pool, scheduler }: { pool?: Pool; scheduler: () => SchedulerState }) {
  const router = express.Router();
  router.get('/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });
  router.get('/health', async (_req, res) => {
    const database = await databaseState(pool);
    const sched = scheduler();
    const healthy = database !== 'unavailable' && sched !== 'stale';
    res
      .status(healthy ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({
        status: healthy ? 'ok' : 'degraded',
        system: 'NW OS — Company Operating System',
        database,
        scheduler: sched,
        // Whether an AI model is configured on the server (never the key or its value).
        ai_configured: aiStatus().available,
        timestamp: new Date().toISOString(),
      });
  });
  return router;
}
