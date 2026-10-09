import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { readDatabaseSettings } from './server/db/config';
import { createPool } from './server/db/pool';
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
mountSecureApi(app, {
  pool: dbSettings.pool ? createPool(dbSettings.pool) : undefined,
  dataSource: dbSettings.dataSource,
});

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
