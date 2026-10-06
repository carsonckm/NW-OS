/**
 * The authority ceiling: the first, mandatory gate of every delegated approval decision
 * (docs/phase6-delegated-authority.md, sections 1 and 3).
 *
 * It answers only "who could possibly decide this?", never "this person may decide":
 *
 *   owner           the Owner decides (still subject to every business rule on the approval path)
 *   owner_required  project sensitivity caps authority at the Owner: no rule can delegate it
 *   denied          the person lacks the baseline permission, or is external (client / contractor)
 *   rule_required   ceiling and baseline pass; a matching active authority rule is still needed
 *
 * There is deliberately no "allowed" outcome for anyone but the Owner: a baseline permission
 * (drawings.review, variations.review, purchasing.view, finance.view, approvals.request) is
 * never approval authority by itself. The resolver (Batch 2) must call this first and may only
 * grant on "rule_required" when a matching rule, scope and every condition also pass.
 *
 * The project is read from the stored record the decision is about (projectOf), never from
 * the request, and its sensitivity is read from the database here. Anything unknown fails
 * closed to the Owner.
 */
import type { AccessContext } from '../auth/access';
import type { Pool, PoolClient } from '../db/pool';
import type { PermissionKey } from '../../src/types';

type Db = Pool | PoolClient;

export type CeilingOutcome = 'owner' | 'owner_required' | 'denied' | 'rule_required';
export interface CeilingResult {
  outcome: CeilingOutcome;
  reason: string;
  sensitivity: 'Normal' | 'Sensitive' | 'Strategic' | null;
  decision_type: string;
  baseline_permission?: PermissionKey;
}

const OWNER_ROLE = 'Owner / CEO';
const EXTERNAL_ROLES = new Set(['Client', 'Contractor']);

/** Collections whose records carry the project a decision belongs to. */
const PROJECT_OF: Record<string, string> = {
  drawings: 'SELECT project_id FROM drawings WHERE id = $1',
  variations: 'SELECT project_id FROM variations WHERE id = $1',
  purchaseOrders: 'SELECT project_id FROM purchase_orders WHERE id = $1',
  commercialInvoices: 'SELECT project_id FROM commercial_invoices WHERE id = $1',
  approvals: 'SELECT project_id FROM approvals WHERE id = $1',
};

/**
 * The project of the stored record a decision is about. Throws for an unknown collection or a
 * missing record, so a caller can never fall back to a browser-supplied project id.
 */
export async function projectOf(db: Db, collection: string, recordId: string): Promise<string | null> {
  const sql = PROJECT_OF[collection];
  if (!sql) throw new Error(`No project lookup for ${collection}`);
  const row = (await db.query(sql, [recordId])).rows[0];
  if (!row) throw new Error(`${collection} ${recordId} does not exist`);
  return row.project_id ?? null;
}

/**
 * Sensitivity ceiling for a decision, before any rule is considered.
 * projectId must come from projectOf (the stored record), not from the request.
 */
export async function authorityCeiling(db: Db, ctx: AccessContext, decisionType: string, projectId: string | null): Promise<CeilingResult> {
  const type = (await db.query('SELECT key, baseline_permission, active, sensitive_protected FROM authority_decision_types WHERE key = $1', [decisionType])).rows[0];
  let sensitivity: CeilingResult['sensitivity'] = null;
  let projectMissing = false;
  if (projectId) {
    const p = (await db.query('SELECT sensitivity FROM projects WHERE id = $1', [projectId])).rows[0];
    if (p) sensitivity = p.sensitivity;
    else projectMissing = true;
  }
  const base = { sensitivity, decision_type: decisionType, baseline_permission: type?.baseline_permission };

  if (ctx.user.role === OWNER_ROLE) return { ...base, outcome: 'owner', reason: 'The Owner may decide' };

  // Fail closed: anything the server cannot place goes to the Owner.
  if (!type || !type.active) return { ...base, outcome: 'owner_required', reason: `Unknown or inactive decision type ${decisionType}; escalated to the Owner` };
  if (projectMissing) return { ...base, outcome: 'owner_required', reason: `Project ${projectId} not found; escalated to the Owner` };
  if (sensitivity !== null && sensitivity !== 'Normal' && sensitivity !== 'Sensitive' && sensitivity !== 'Strategic') {
    return { ...base, outcome: 'owner_required', reason: 'Unknown project sensitivity; escalated to the Owner' };
  }

  // The ceiling: no rule, role or permission can reach above it.
  if (sensitivity === 'Strategic') return { ...base, outcome: 'owner_required', reason: 'Strategic project: every approval decision needs the Owner' };
  if (sensitivity === 'Sensitive' && type.sensitive_protected) {
    return { ...base, outcome: 'owner_required', reason: `Sensitive project: ${decisionType} decisions need the Owner` };
  }

  // Below the ceiling, the baseline permission is the entry ticket, never the authority.
  if (EXTERNAL_ROLES.has(ctx.user.role)) return { ...base, outcome: 'denied', reason: `${ctx.user.role} users cannot hold internal approval authority` };
  if (!ctx.can(type.baseline_permission)) return { ...base, outcome: 'denied', reason: `Missing baseline permission ${type.baseline_permission}` };
  return { ...base, outcome: 'rule_required', reason: `Needs a matching active authority rule (${type.baseline_permission} alone approves nothing)` };
}

/** Whether an allow rule scoped to this project would sit above its sensitivity ceiling. */
export async function ruleExceedsCeiling(db: Db, decisionType: string, projectId: string): Promise<string | null> {
  const p = (await db.query('SELECT sensitivity, project_name FROM projects WHERE id = $1', [projectId])).rows[0];
  if (!p) return null;
  if (p.sensitivity === 'Strategic') return `${p.project_name} is Strategic: only the Owner may approve its decisions. Change the project's sensitivity to delegate.`;
  if (p.sensitivity === 'Sensitive') {
    const t = (await db.query('SELECT sensitive_protected FROM authority_decision_types WHERE key = $1', [decisionType])).rows[0];
    if (!t || t.sensitive_protected) return `${p.project_name} is Sensitive: only the Owner may approve its ${decisionType} decisions. Change the project's sensitivity to delegate.`;
  }
  return null;
}
