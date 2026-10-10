import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { readDatabaseSettings } from './server/db/config';
import { createPool } from './server/db/pool';
import { enforceRuntimePrivileges, PrivilegedDatabaseError } from './server/db/roles';
import { mountSecureApi } from './server/app';
import { aiStatus } from './server/ai/gateway';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '20mb' }));

// Database, authentication and the core-chain API; also puts /api/ai and /api/gateway
// behind sign-in. Without DATABASE_URL the app runs in demo mode (no sign-in, localStorage).
// Every AI route (the AI layer and the legacy screens' routes) is mounted there: this file never
// talks to a model provider (only server/ai/provider.ts does, behind the AI gateway).
const dbSettings = readDatabaseSettings();
const pool = dbSettings.pool ? createPool(dbSettings.pool) : undefined;
// Mounted in setupServer(), after the database privilege check: the API (and its automation
// scheduler) never starts with a database user the server refuses.

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'NW OS — Company Operating System',
    version: '1.0.0-phase1',
    // Whether an AI model is configured on the server (never the key or its value).
    ai_configured: aiStatus().available,
    timestamp: new Date().toISOString(),
  });
});

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
  mountSecureApi(app, {
    pool,
    dataSource: dbSettings.dataSource,
  });
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
