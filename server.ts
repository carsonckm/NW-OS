import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { readDatabaseSettings } from './server/db/config';
import { createPool } from './server/db/pool';
import { enforceRuntimePrivileges, PrivilegedDatabaseError } from './server/db/roles';
import { mountSecureApi } from './server/app';

dotenv.config();

const app = express();
// The host's port (Cloud Run sets PORT); 3000 for local development.
const PORT = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '20mb' }));

// Database, authentication and the core-chain API; also puts /api/ai and /api/gateway
// behind sign-in. Without DATABASE_URL the app runs in demo mode (no sign-in, localStorage).
// Every AI route (the AI layer and the legacy screens' routes) is mounted there: this file never
// talks to a model provider (only server/ai/provider.ts does, behind the AI gateway).
const dbSettings = readDatabaseSettings();
const pool = dbSettings.pool ? createPool(dbSettings.pool) : undefined;
// Mounted in setupServer(), after the database privilege check: the API (and its automation
// scheduler) never starts with a database user the server refuses.

// Health checks (/api/health, /api/health/live) are mounted with the API (server/http/health.ts).

// Vite Middleware for Development / Static serve for Production
async function setupServer() {
  // Database privilege hardening (Batch 10): in production the server refuses to start when its
  // database user could disable or rewrite the audit / history protections.
  // If the check cannot run (database unreachable), production still refuses to start rather
  // than run unchecked; development starts and reports the database as unreachable, as before.
  if (pool) {
    try {
      await enforceRuntimePrivileges(pool);
    } catch (err) {
      if (err instanceof PrivilegedDatabaseError || process.env.NODE_ENV === 'production') {
        console.error(err instanceof PrivilegedDatabaseError ? err.message : `[db] Could not verify the database user's privileges, refusing to start: ${(err as Error).message}`);
        process.exit(1);
      }
      console.warn(`[db] Could not verify the database user's privileges: ${(err as Error).message}`);
    }
  }
  try {
    mountSecureApi(app, {
      pool,
      dataSource: dbSettings.dataSource,
    });
  } catch (err) {
    // A configuration error (e.g. TRUST_PROXY) stops the server rather than running half-configured.
    console.error(`[config] ${(err as Error).message}`);
    process.exit(1);
  }
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NW OS Server is listening on http://0.0.0.0:${PORT}`);
  });
}

setupServer();
