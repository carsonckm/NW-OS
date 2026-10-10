import type { NextFunction, Request, Response } from 'express';
import { ForbiddenError } from '../auth/access';
import { NotFoundError, ValidationError } from '../core/repository';
import { explainRefusal } from './explain';

// Postgres error codes -> HTTP status + stable error name.
const PG_ERRORS: Record<string, [number, string]> = {
  '23503': [409, 'foreign_key_violation'],
  '23505': [409, 'unique_violation'],
  '23502': [400, 'not_null_violation'],
  '23514': [400, 'check_violation'],
  '22P02': [400, 'invalid_input'],
  '22007': [400, 'invalid_datetime'],
  '22008': [400, 'invalid_datetime'],
  '22003': [400, 'numeric_out_of_range'],
};

export function sendError(res: Response, err: unknown) {
  if (err instanceof NotFoundError) return res.status(404).json({ error: 'not_found', message: err.message });
  if (err instanceof ForbiddenError) {
    // A refused approval carries the authority resolver's stable reason code.
    const resolution = (err as ForbiddenError & { resolution?: { reasonCode: string; requiresOwner: boolean } }).resolution;
    return res.status(403).json({
      error: 'forbidden',
      message: explainRefusal(err.message),
      ...(resolution ? { reason_code: resolution.reasonCode, requires_owner: resolution.requiresOwner } : {}),
    });
  }
  if (err instanceof ValidationError) {
    // A ValidationError may carry 409 (the record changed since the client read it).
    const status = (err as ValidationError & { status?: number }).status === 409 ? 409 : 400;
    return res.status(status).json({ error: status === 409 ? 'conflict' : 'validation_error', message: err.message, details: err.details });
  }
  const pgErr = err as { code?: string; message?: string; detail?: string; constraint?: string };
  // A refusal by the exception-lifecycle integrity checks (migrations 025 / 026). The API checks
  // the same rules first, so this means the exception changed meanwhile (e.g. it became critical):
  // a conflict, with a generic message (the database's message stays in the server log).
  if (pgErr.code === 'NWX01') {
    console.warn('[api] exception lifecycle refused by the database:', pgErr.message);
    return res.status(409).json({ error: 'conflict', message: 'This exception changed while you were acting on it (it may have become critical). Reload and try again.' });
  }
  const mapped = pgErr.code && PG_ERRORS[pgErr.code];
  if (mapped) {
    return res.status(mapped[0]).json({
      error: mapped[1],
      message: pgErr.message,
      detail: pgErr.detail,
      constraint: pgErr.constraint,
    });
  }
  console.error('[api]', err);
  return res.status(500).json({ error: 'internal_error', message: 'Unexpected error' });
}

/**
 * A request the database refused for lack of privilege (SQLSTATE 42501). The application's
 * own requests never need a privilege the runtime role lacks (docs/database-privileges.md), so
 * every one is a security event: it is recorded through the audit trail (who, which endpoint,
 * the database's refusal message; never the request body, parameters or credentials).
 */
export interface PrivilegeDenial {
  method: string;
  path: string;
  message: string;
  user?: { id?: string; name?: string; role?: string } | null;
  ip?: string | null;
}
export type PrivilegeDenialMonitor = (denial: PrivilegeDenial) => Promise<void> | void;
/** Registers the app's monitor (kept on app.locals, so each app records to its own database). */
export function setPrivilegeDenialMonitor(app: { locals: Record<string, unknown> }, fn: PrivilegeDenialMonitor) {
  app.locals.privilegeDenialMonitor = fn;
}

/** Express error middleware for API routers. */
export function apiErrorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const privilegeMonitor = req.app?.locals?.privilegeDenialMonitor as PrivilegeDenialMonitor | undefined;
  if ((err as { code?: string })?.code === '42501' && privilegeMonitor) {
    const user = (req as Request & { auth?: { user?: PrivilegeDenial['user'] } }).auth?.user ?? null;
    const denial: PrivilegeDenial = {
      method: req.method,
      path: `${req.baseUrl}${req.path}`.slice(0, 300),
      message: String((err as Error).message ?? '').slice(0, 300),
      user: user ? { id: user.id, name: user.name, role: user.role } : null,
      ip: req.ip ?? null,
    };
    Promise.resolve()
      .then(() => privilegeMonitor(denial))
      .catch((e) => console.error('[security] could not record a database privilege denial:', (e as Error).message));
  }
  sendError(res, err);
}
