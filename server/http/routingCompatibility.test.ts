import express from 'express';
import request from 'supertest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mountSecureApi } from '../app';
import { mountProductionWeb } from './static';

describe('production routing with Express 5', () => {
  let dist: string;
  let app: express.Express;
  beforeAll(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'nwos-routing-'));
    await mkdir(path.join(dist, 'assets'));
    await writeFile(path.join(dist, 'index.html'), '<html><body>Synthetic QA app</body></html>');
    await writeFile(path.join(dist, 'assets', 'qa.js'), 'console.log("synthetic");');
    app = express();
    mountSecureApi(app, { dataSource: 'local' });
    mountProductionWeb(app, dist);
  });
  afterAll(async () => { if (dist) await rm(dist, { recursive: true, force: true }); });

  it.each(['/', '/projects/qa/details'])('serves the app at %s without an invalid wildcard route', async (url) => {
    const response = await request(app).get(url).expect(200).expect('Content-Type', /text\/html/);
    expect(response.text).toContain('Synthetic QA app');
  });
  it('serves real static assets before the app fallback', async () => {
    const response = await request(app).get('/assets/qa.js').expect(200).expect('Content-Type', /javascript/);
    expect(response.text).toContain('synthetic');
    expect(response.text).not.toContain('<html>');
  });
  it.each(['/api', '/api/unknown', '/api/files/missing'])('keeps unknown API %s out of the app fallback', async (url) => {
    const response = await request(app).get(url).expect(404).expect('Content-Type', /json/);
    expect(response.body.error).toBe('not_found');
  });
  it.each(['/api/clients', '/api/clients/qa', '/api/work-items/qa', '/api/core/snapshot'])('preserves unconfigured core refusal at %s', async (url) => {
    const response = await request(app).get(url).expect(503).expect('Content-Type', /json/);
    expect(response.body.error).toBe('database_not_configured');
  });
  it('keeps health reachable outside the core wildcard guards', async () => {
    const response = await request(app).get('/api/health/live').expect(200);
    expect(response.body.status).toBe('ok');
  });
});
