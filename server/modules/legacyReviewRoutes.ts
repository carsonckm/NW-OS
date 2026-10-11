/**
 * Owner review of legacy records (Phase 6 Batch 12A, server/modules/legacyReview.ts). Owner only;
 * behind sign-in, the active-user check and CSRF.
 *
 *   GET  /api/legacy-reviews                          identified records and their decisions
 *   POST /api/legacy-reviews/:kind/:id/decision       { decision, reason }
 *        kind invoice:            released | acknowledged (Paid only) | declined
 *        kind purchase_approval:  reauthorized | declined
 *
 * The browser sends only the decision and the reason: the record, its facts, the reviewer and the
 * time come from the server.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { decideLegacyReview, listLegacyReviews } from './legacyReview';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

export function createLegacyReviewRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use('/legacy-reviews', csrfGuard, attachUser(store), requireUser, loadAccess(pool));
  router.get('/legacy-reviews', wrap(async (req, res) => res.json(await listLegacyReviews(pool, req.access!))));
  router.post('/legacy-reviews/:kind/:id/decision', wrap(async (req, res) => res.status(201).json(await decideLegacyReview(pool, req.access!, actorOf(req), String(req.params.kind), String(req.params.id), req.body))));
  router.use(apiErrorHandler);
  return router;
}
