/**
 * The AI operating layer API (Phase 6 Batch 7). Signed-in users with ai.assistant; every route
 * works from the session's user and their own scope. Nothing the browser sends about identity,
 * role, scope, figures or authority is used.
 *
 *   GET  /api/ai/ops/status                         is a model configured (no secrets), limits
 *   POST /api/ai/ops/ask                            { question, project_id? }
 *   GET  /api/ai/ops/briefing                       the daily operating briefing (NW staff)
 *   GET  /api/ai/ops/projects/:id/summary           project summary
 *   GET  /api/ai/ops/projects/:id/commercial        commercial analysis (financial roles)
 *   POST /api/ai/ops/issues/analyze                 { issue_id } | { text, work_item_id }
 *   POST /api/ai/ops/drawings/:id/analyze           { question? }
 *   GET  /api/ai/ops/conversations                  my AI history (?all=1: metadata, audit.view)
 *   POST /api/ai/ops/conversations/:id/actions/:index/propose   { params? } → an AI Proposal approval
 *   POST /api/ai/ops/conversations/:id/actions/:index/dismiss   { reason? }
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { aiStatus } from './gateway';
import { AIService } from './service';

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });

export function createAIRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  const ai = new AIService(pool);
  router.use('/ai/ops', csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  router.get(
    '/ai/ops/status',
    wrap(async (req, res) => {
      req.access!.require('ai.assistant');
      res.json(aiStatus());
    })
  );
  router.post('/ai/ops/ask', wrap(async (req, res) => res.json(await ai.ask(req.access!, actorOf(req), req.body ?? {}))));
  router.get('/ai/ops/briefing', wrap(async (req, res) => res.json(await ai.briefing(req.access!, actorOf(req)))));
  router.get('/ai/ops/projects/:id/summary', wrap(async (req, res) => res.json(await ai.projectSummary(req.access!, actorOf(req), String(req.params.id)))));
  router.get('/ai/ops/projects/:id/commercial', wrap(async (req, res) => res.json(await ai.commercial(req.access!, actorOf(req), String(req.params.id)))));
  router.post('/ai/ops/issues/analyze', wrap(async (req, res) => res.json(await ai.issueAnalysis(req.access!, actorOf(req), req.body ?? {}))));
  router.post('/ai/ops/drawings/:id/analyze', wrap(async (req, res) => res.json(await ai.drawingAnalysis(req.access!, actorOf(req), String(req.params.id), req.body ?? {}))));
  router.get('/ai/ops/conversations', wrap(async (req, res) => res.json(await ai.conversations(req.access!, req.query))));
  router.post('/ai/ops/conversations/:id/actions/:index/propose', wrap(async (req, res) => res.status(201).json(await ai.propose(req.access!, actorOf(req), String(req.params.id), req.params.index, req.body ?? {}))));
  router.post('/ai/ops/conversations/:id/actions/:index/dismiss', wrap(async (req, res) => res.json(await ai.dismiss(req.access!, actorOf(req), String(req.params.id), req.params.index, req.body ?? {}))));

  router.use('/ai/ops', apiErrorHandler);
  return router;
}
