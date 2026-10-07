/**
 * Owner dependency and delegation recommendations API (Phase 6 Batch 5). Owner only; behind
 * sign-in, the active-user check and CSRF.
 *
 *   GET  /api/owner/dependency/analytics?days=90          Owner dependency (server data only)
 *   GET  /api/delegation/recommendations                   active, snoozed, history, not recommended (and why)
 *   POST /api/delegation/recommendations/generate          refresh now (same engine as the daily rule)
 *   POST /api/delegation/recommendations/:id/preview       { modifications? } the authority preview of the rule it would create
 *   POST /api/delegation/recommendations/:id/accept        { modifications?, confirmation, reason? } creates the rule via the authority API
 *   POST /api/delegation/recommendations/:id/reject        { reason }
 *   POST /api/delegation/recommendations/:id/snooze        { days, reason }
 *
 * The browser never sends evidence, a decision type, an effect or a rule id: those come from the
 * stored recommendation and the authority API.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import {
  acceptRecommendation,
  generateDelegationRecommendations,
  listRecommendations,
  ownerDependencyAnalytics,
  previewRecommendation,
  rejectRecommendation,
  requireOwner,
  snoozeRecommendation,
} from './delegationIntelligence';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

export function createDelegationRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use(['/owner/dependency/analytics', '/delegation'], csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  router.get('/owner/dependency/analytics', wrap(async (req, res) => res.json(await ownerDependencyAnalytics(pool, req.access!, { days: Number(req.query.days) || undefined }))));
  router.get('/delegation/recommendations', wrap(async (req, res) => res.json(await listRecommendations(pool, req.access!))));
  router.post(
    '/delegation/recommendations/generate',
    wrap(async (req, res) => {
      requireOwner(req.access!);
      if (req.body && Object.keys(req.body).length) return res.status(400).json({ error: 'validation_error', message: 'Generation takes no parameters: evidence and thresholds are set on the server' });
      res.json(await generateDelegationRecommendations(pool));
    })
  );
  router.post('/delegation/recommendations/:id/preview', wrap(async (req, res) => res.json(await previewRecommendation(pool, req.access!, String(req.params.id), req.body))));
  router.post('/delegation/recommendations/:id/accept', wrap(async (req, res) => res.status(201).json(await acceptRecommendation(pool, req.access!, actorOf(req), String(req.params.id), req.body))));
  router.post('/delegation/recommendations/:id/reject', wrap(async (req, res) => res.json(await rejectRecommendation(pool, req.access!, actorOf(req), String(req.params.id), req.body))));
  router.post('/delegation/recommendations/:id/snooze', wrap(async (req, res) => res.json(await snoozeRecommendation(pool, req.access!, actorOf(req), String(req.params.id), req.body))));

  router.use(apiErrorHandler);
  return router;
}
