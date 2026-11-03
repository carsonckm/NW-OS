import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { attachUser, requireUser } from './middleware';
import { SESSION_COOKIE, type AuthStore } from './store';

describe('malformed authentication cookies', () => {
  it.each(['%', '%E0%A4%A', '%GG'])('refuses %s without a rejected middleware promise', async (value) => {
    const resolveSession = vi.fn(async () => undefined);
    const app = express();
    app.use(attachUser({ resolveSession } as unknown as AuthStore));
    app.get('/private', requireUser, (_req, res) => res.json({ private: true }));
    const res = await request(app).get('/private').set('Cookie', `${SESSION_COOKIE}=${value}`).expect(401);
    expect(res.body.error).toBe('unauthenticated');
    expect(resolveSession).not.toHaveBeenCalled();
  });
});
