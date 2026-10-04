import express from 'express';
import request from 'supertest';
import type { UserRole } from '../../src/types';
import { mountSecureApi } from '../app';
import { AuthStore } from '../auth/store';
import type { Pool } from '../db/pool';

export const TEST_PASSWORD = 'test-password-123';

/** The real auth + core wiring, plus an echo route standing in for the AI endpoints. */
export function buildApp(pool?: Pool) {
  const app = express();
  app.use(express.json());
  mountSecureApi(app, { pool, dataSource: 'database' });
  app.post('/api/ai/echo', (req, res) => res.json(req.body));
  return app;
}

export interface SeedUser {
  id: string;
  role: UserRole;
  email: string;
  client_id?: string;
  contractor_id?: string;
  assigned?: string[];
}

export async function seedUsers(pool: Pool, users: SeedUser[]) {
  const store = new AuthStore(pool);
  for (const u of users) {
    await store.createUser({ ...u, name: u.role, password: TEST_PASSWORD });
    if (u.assigned) await store.setAssignments(u.id, u.assigned);
  }
}

/** A supertest agent holding a session cookie for the given user. */
export async function signIn(app: express.Express, email: string, password = TEST_PASSWORD) {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  return agent;
}
