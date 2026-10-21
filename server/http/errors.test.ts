/**
 * Database refusals reach the client as stable errors, whatever the PostgreSQL version reports:
 * a record that others still depend on is a 409 foreign_key_violation on PostgreSQL 16 (23503)
 * and on PostgreSQL 18 (23001, restrict_violation).
 */
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { sendError } from './errors';

const appFailingWith = (err: unknown) => {
  const app = express();
  app.get('/', (_req, res) => {
    sendError(res, err);
  });
  return app;
};

describe('sendError: database refusals', () => {
  it.each([
    ['23503', 'PostgreSQL 16: foreign_key_violation'],
    ['23001', 'PostgreSQL 18: restrict_violation'],
  ])('a dependent-record refusal (%s, %s) is a 409 foreign_key_violation', async (code) => {
    const err = Object.assign(new Error('update or delete on table "clients" violates foreign key constraint "projects_client_id_fkey" on table "projects"'), {
      code,
      constraint: 'projects_client_id_fkey',
    });
    const res = await request(appFailingWith(err)).get('/').expect(409);
    expect(res.body).toMatchObject({ error: 'foreign_key_violation', constraint: 'projects_client_id_fkey' });
  });

  it('an unrecognised database error stays a generic 500 without the database message', async () => {
    const err = Object.assign(new Error('something internal'), { code: 'XX000' });
    const res = await request(appFailingWith(err)).get('/').expect(500);
    expect(res.body).toEqual({ error: 'internal_error', message: 'Unexpected error' });
  });
});
