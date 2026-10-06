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
    return res.status(400).json({ error: 'validation_error', message: err.message, details: err.details });
  }
  const pgErr = err as { code?: string; message?: string; detail?: string; constraint?: string };
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

/** Express error middleware for API routers. */
export function apiErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  sendError(res, err);
}
