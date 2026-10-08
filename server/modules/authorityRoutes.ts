/**
 * Delegated authority API (Phase 6). Reading needs authority.view (Owner, Admin); every change
 * needs authority.manage (Owner). All behind sign-in, the active-user check and CSRF protection.
 *
 *   GET  /api/authority/decision-types
 *   GET  /api/authority/rules?decision_type=&active=&kind=&project_id=
 *   GET  /api/authority/rules/:id
 *   GET  /api/authority/rules/:id/history
 *   POST /api/authority/rules                     (Owner rule)
 *   PATCH /api/authority/rules/:id                (Owner rule; System Policy is not editable)
 *   POST /api/authority/rules/:id/deactivate      { reason }
 *   POST /api/authority/rules/:id/reactivate      { reason }
 *   PUT  /api/projects/:id/sensitivity            { sensitivity, reason }
 *
 * There is no delete: rules are deactivated so their history stays readable.
 *
 *   GET  /api/authority/overview                  (dashboard; authority.view)
 *   POST /api/authority/rules/preview             (what a new rule would do; Owner)
 *   POST /api/authority/rules/:id/preview         (what an edit would do; Owner)
 *   GET  /api/authority/rules/:id/impact?action=deactivate|reactivate   (authority.view)
 *
 *   GET  /api/authority/resolve?items=kind:id[:action],...   (any signed-in user)
 *
 *   GET  /api/authority/owner-routing             who receives Owner fallbacks (authority.view)
 *   PUT  /api/authority/owner-routing             { owners: [{ id, owner_priority, is_primary_owner }] } (Owner)
 *   GET  /api/authority/sla                       SLA per decision type + business calendar (authority.view)
 *   PUT  /api/authority/sla/:decision_type        { sla_business_days?, reminder_pct?, due_soon_pct?, escalate_pct?, escalate_to?, reason } (Owner)
 *
 * Batch 6 (reading: authority.view; every change: the Owner, previewed then confirmed):
 *   GET  /api/authority/coverage                  coverage matrix, health, gaps, overlapping rules
 *   GET  /api/authority/effectiveness             what happened to the decisions each delegation covers
 *   GET  /api/authority/temporary                 temporary and absence authority (active, scheduled, expiring, ended)
 *   POST /api/authority/temporary/preview         { decision_type, target_user_id | target_role, project_id?, client_id?, min_value?, max_value, max_risk?, start_at?, end_at, reason }
 *   POST /api/authority/temporary                 the same + confirmation
 *   POST /api/authority/temporary/:id/extend/preview   { end_at, reason }
 *   POST /api/authority/temporary/:id/extend      { end_at, reason, confirmation }
 *   POST /api/authority/temporary/:id/end         { reason }
 *   GET  /api/authority/absence                   Owner absences
 *   POST /api/authority/absence/preview           { start_at?, end_at, backup_user_id, decision_types, max_value?, max_risk?, project_id?, client_id?, reason }
 *   POST /api/authority/absence                   the same + confirmation
 *   POST /api/authority/absence/:id/end           { reason }
 *
 * The approval screens ask the server, for the signed-in user, what the authority resolver
 * decides for each record they show (approve / reject / request changes), and show the action,
 * "Owner approval required" or the reason accordingly. Informational only: every approval is
 * resolved again on the server when it is made.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { ForbiddenError, type AccessContext } from '../auth/access';
import { attachUser, csrfGuard, loadAccess, requireUser } from '../auth/middleware';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import { createRule, decisionTypes, getRule, listRules, ruleHistory, setProjectSensitivity, setRuleActive, updateRule } from './authority';
import { authorityOverview, previewRule, ruleImpact } from './authoritySettings';
import { authorityForScreen, clientConsentAllowed, resolveApprovalAuthority, type DecisionAction, type ResourceKind } from './authorityResolver';
import { ValidationError } from '../core/repository';
import { ownerRoutingPolicy, setOwnerRoutingPolicy, setSlaPolicy, slaSettings } from './approvalOps';
import {
  activateAbsence,
  authorityConflicts,
  computeCoverage,
  coverageGaps,
  createTemporary,
  delegationEffectiveness,
  endAbsence,
  extendTemporary,
  listAbsences,
  listTemporary,
  previewAbsence,
  previewExtension,
  previewTemporary,
  requireOwnerManage,
} from './delegationCoverage';

const KINDS: ResourceKind[] = ['drawing_revision', 'drawing', 'variation', 'purchase_order', 'invoice', 'approval'];
const ACTIONS: DecisionAction[] = ['approve', 'reject', 'request_changes'];

const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });
const needView = (ctx: AccessContext) => {
  if (!ctx.can('authority.view')) throw new ForbiddenError('Missing permission: authority.view (see delegated authority)');
};
const q = (v: unknown) => (typeof v === 'string' && v ? v : undefined);

export function createAuthorityRouter({ pool, store }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  router.use(['/authority', '/projects/:id/sensitivity'], csrfGuard, attachUser(store), requireUser, loadAccess(pool));

  router.get(
    '/authority/owner-routing',
    wrap(async (req, res) => {
      needView(req.access!);
      res.json(await ownerRoutingPolicy(pool));
    })
  );
  router.put(
    '/authority/owner-routing',
    wrap(async (req, res) => res.json(await setOwnerRoutingPolicy(pool, req.access!, actorOf(req), req.body)))
  );
  router.get(
    '/authority/sla',
    wrap(async (req, res) => {
      needView(req.access!);
      res.json(await slaSettings(pool));
    })
  );
  router.put(
    '/authority/sla/:decisionType',
    wrap(async (req, res) => res.json(await setSlaPolicy(pool, req.access!, actorOf(req), String(req.params.decisionType), req.body)))
  );

  router.get(
    '/authority/coverage',
    wrap(async (req, res) => {
      needView(req.access!);
      const coverage = await computeCoverage(pool);
      res.json({ ...coverage, gaps: await coverageGaps(pool, new Date(), coverage), conflicts: await authorityConflicts(pool) });
    })
  );
  router.get(
    '/authority/effectiveness',
    wrap(async (req, res) => {
      needView(req.access!);
      res.json(await delegationEffectiveness(pool));
    })
  );
  router.get('/authority/temporary', wrap(async (req, res) => res.json(await listTemporary(pool, req.access!))));
  router.post('/authority/temporary/preview', wrap(async (req, res) => res.json(await previewTemporary(pool, req.access!, req.body))));
  router.post('/authority/temporary', wrap(async (req, res) => res.status(201).json(await createTemporary(pool, req.access!, actorOf(req), req.body))));
  router.post('/authority/temporary/:id/extend/preview', wrap(async (req, res) => res.json(await previewExtension(pool, req.access!, String(req.params.id), req.body))));
  router.post('/authority/temporary/:id/extend', wrap(async (req, res) => res.status(201).json(await extendTemporary(pool, req.access!, actorOf(req), String(req.params.id), req.body))));
  router.post(
    '/authority/temporary/:id/end',
    wrap(async (req, res) => {
      requireOwnerManage(req.access!, 'temporary authority');
      const rule = (await pool.query('SELECT authority_type FROM delegated_authorities WHERE id = $1', [String(req.params.id)])).rows[0];
      if (rule?.authority_type !== 'temporary') throw new ValidationError('Not temporary authority (absence authority ends with its absence)');
      res.json(await setRuleActive(pool, req.access!, actorOf(req), String(req.params.id), false, req.body));
    })
  );
  router.get('/authority/absence', wrap(async (req, res) => res.json(await listAbsences(pool, req.access!))));
  router.post('/authority/absence/preview', wrap(async (req, res) => res.json(await previewAbsence(pool, req.access!, req.body))));
  router.post('/authority/absence', wrap(async (req, res) => res.status(201).json(await activateAbsence(pool, req.access!, actorOf(req), req.body))));
  router.post('/authority/absence/:id/end', wrap(async (req, res) => res.json(await endAbsence(pool, req.access!, actorOf(req), String(req.params.id), req.body))));

  router.get(
    '/authority/resolve',
    wrap(async (req, res) => {
      const raw = q(req.query.items);
      if (!raw) throw new ValidationError('items is required (kind:id[:action], comma-separated)');
      const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
      if (items.length > 100) throw new ValidationError('At most 100 items at a time');
      const out = [];
      for (const item of items) {
        const [kind, id, action = 'approve'] = item.split(':');
        if (!KINDS.includes(kind as ResourceKind) || !id || !ACTIONS.includes(action as DecisionAction)) throw new ValidationError(`Unknown item ${item}`);
        if (kind === 'approval') {
          const row = (await pool.query('SELECT approval_type, project_id FROM approvals WHERE id = $1', [id])).rows[0];
          if (row && clientConsentAllowed(req.access!, row)) {
            out.push({ item, allowed: true, reason_code: 'ALLOWED', reason: "The client's consent on their own project", requires_owner: false, basis: 'client_consent', decision_type: 'client_consent', project_sensitivity: null, matched_rule_code: null });
            continue;
          }
        }
        const r = await resolveApprovalAuthority(pool, req.access!, { resource: { kind: kind as ResourceKind, id }, action: action as DecisionAction });
        out.push({ item, ...authorityForScreen(r) });
      }
      res.json(out);
    })
  );
  // Owner Authority Settings (Batch 3): dashboard, preview before saving, impact before switching.
  router.get('/authority/overview', wrap(async (req, res) => res.json(await authorityOverview(pool, req.access!))));
  router.post('/authority/rules/preview', wrap(async (req, res) => res.json(await previewRule(pool, req.access!, req.body))));
  router.post('/authority/rules/:id/preview', wrap(async (req, res) => res.json(await previewRule(pool, req.access!, req.body, req.params.id))));
  router.get(
    '/authority/rules/:id/impact',
    wrap(async (req, res) => {
      const action = req.query.action === 'reactivate' ? 'reactivate' : 'deactivate';
      res.json(await ruleImpact(pool, req.access!, req.params.id, action));
    })
  );
  router.get('/authority/decision-types', wrap(async (req, res) => { needView(req.access!); res.json(await decisionTypes(pool)); }));
  router.get(
    '/authority/rules',
    wrap(async (req, res) => {
      needView(req.access!);
      res.json(await listRules(pool, { decision_type: q(req.query.decision_type), active: q(req.query.active), kind: q(req.query.kind), project_id: q(req.query.project_id) }));
    })
  );
  router.get('/authority/rules/:id', wrap(async (req, res) => { needView(req.access!); res.json(await getRule(pool, req.params.id)); }));
  router.get('/authority/rules/:id/history', wrap(async (req, res) => { needView(req.access!); res.json(await ruleHistory(pool, req.params.id)); }));
  router.post('/authority/rules', wrap(async (req, res) => res.status(201).json(await createRule(pool, req.access!, actorOf(req), req.body))));
  router.patch('/authority/rules/:id', wrap(async (req, res) => res.json(await updateRule(pool, req.access!, actorOf(req), req.params.id, req.body))));
  router.post('/authority/rules/:id/deactivate', wrap(async (req, res) => res.json(await setRuleActive(pool, req.access!, actorOf(req), req.params.id, false, req.body))));
  router.post('/authority/rules/:id/reactivate', wrap(async (req, res) => res.json(await setRuleActive(pool, req.access!, actorOf(req), req.params.id, true, req.body))));
  router.put('/projects/:id/sensitivity', wrap(async (req, res) => res.json(await setProjectSensitivity(pool, req.access!, actorOf(req), req.params.id, req.body))));

  router.use(apiErrorHandler);
  return router;
}
