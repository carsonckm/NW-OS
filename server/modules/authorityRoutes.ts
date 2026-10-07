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
