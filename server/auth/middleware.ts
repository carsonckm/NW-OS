import type { NextFunction, Request, Response } from 'express';
import type { Pool } from '../db/pool';
import { AccessContext } from './access';
import { SESSION_COOKIE, type AuthStore, type AuthUser } from './store';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set only from a valid server-side session; never from request data. */
      auth?: { user: AuthUser; token: string };
      access?: AccessContext;
    }
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return undefined;
}

export const isProduction = () => process.env.NODE_ENV === 'production';

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isProduction() || process.env.COOKIE_SECURE === 'true',
    path: '/',
    ...(expires ? { expires } : {}),
  };
}

/** Resolves the session cookie to a user. Anything the browser claims about itself is ignored. */
export function attachUser(store: AuthStore) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    req.auth = undefined;
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      try {
        const user = await store.resolveSession(token);
        if (user) req.auth = { user, token };
      } catch (err) {
        return next(err);
      }
    }
    next();
  };
}

export function requireUser(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) return res.status(401).json({ error: 'unauthenticated', message: 'Sign in required' });
  next();
}

/** Loads the user's project scope once per request (after requireUser). */
export function loadAccess(pool: Pool) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      req.access = await AccessContext.load(pool, req.auth!.user);
      next();
    } catch (err) {
      next(err);
    }
  };
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence for cookie-authenticated writes, alongside SameSite=Lax:
 * a cross-site page can't send a JSON body without a CORS preflight (which is never
 * granted), and a present Origin header must match this host.
 */
export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (!UNSAFE.has(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    let host: string | undefined;
    try {
      host = new URL(origin).host;
    } catch {
      host = undefined;
    }
    const expected = req.headers['x-forwarded-host'] ?? req.headers.host;
    if (host !== expected) return res.status(403).json({ error: 'bad_origin', message: 'Cross-origin request refused' });
  }
  const hasBody = Number(req.headers['content-length'] || 0) > 0 || req.headers['transfer-encoding'];
  if (hasBody && !req.is('application/json')) {
    return res.status(415).json({ error: 'unsupported_media_type', message: 'Send JSON' });
  }
  next();
}

/** Small in-memory limiter for login attempts (per process). */
export class AttemptLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 15 * 60 * 1000) {}

  blocked(key: string) {
    return this.recent(key).length >= this.max;
  }
  fail(key: string) {
    this.hits.set(key, [...this.recent(key), Date.now()]);
  }
  reset(key: string) {
    this.hits.delete(key);
  }
  private recent(key: string) {
    const cutoff = Date.now() - this.windowMs;
    return (this.hits.get(key) ?? []).filter((t) => t > cutoff);
  }
}
