import express, { type Express } from 'express';
import path from 'path';

/** Mount after the API so unknown API URLs cannot masquerade as successful web pages. */
export function mountProductionWeb(app: Express, distPath: string) {
  app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found', message: 'Unknown API endpoint' }));
  app.use(express.static(distPath));
  // Express 5 requires named wildcards; braces include the application root as well.
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));
}
