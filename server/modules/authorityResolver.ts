/**
 * The authority resolver: the one place that decides whether the signed-in user may take an
 * approval decision (docs/phase6-delegated-authority.md, section 4).
 *
 * Every approval path (drawing revisions, NW production drawings, variation internal approval,
 * purchase orders, supplier invoices, approval requests and AI proposals) calls
 * resolveApprovalAuthority / requireAuthority. Nothing else grants approval authority.
 *
 * Order, always:
 *   1. the authenticated, active user (from the session, never the browser);
 *   2. the record being decided, loaded here from the database;
 *   3. its project (and client), from that record;
 *   4. the project's sensitivity, from the database;
 *   5. the sensitivity ceiling (authorityCeiling) and 6. the baseline permission;
 *   7. System Policy and Owner rules: targeting, scope, value, risk, dates, active state,
 *      conditions and priority;
 *   8. the structured result, with a stable reason code.
 *
 * Dependency direction: approval hooks -> this module -> authorityCeiling / risk / database.
 * This module never calls a hook or an approval helper, so there is no loop.
 *
 * The Owner needs no rule: the Owner may decide anything in scope (business rules on the
 * approval path, such as "you cannot internally approve a variation you raised", still apply).
 */
import type { AccessContext } from '../auth/access';
import { ForbiddenError } from '../auth/access';
import type { Pool, PoolClient } from '../db/pool';
import type { PermissionKey } from '../../src/types';
import { authorityCeiling } from './authorityCeiling';
import { computeProjectRisk } from './risk';

type Db = Pool | PoolClient;
type Row = Record<string, any>;

/** Stable reason codes (documented in docs/phase6-delegated-authority.md). */
export const REASON_CODES = [
  'ALLOWED',
  'OWNER_REQUIRED',
  'SENSITIVITY_BLOCKED',
  'NO_MATCHING_AUTHORITY',
  'INSUFFICIENT_PERMISSION',
  'OUT_OF_SCOPE',
  'VALUE_LIMIT_EXCEEDED',
  'RISK_LIMIT_EXCEEDED',
  'AUTHORITY_NOT_YET_ACTIVE',
  'AUTHORITY_EXPIRED',
  'AUTHORITY_DEACTIVATED',
  'CONDITION_NOT_MET',
  'SELF_APPROVAL_BLOCKED',
  'INVALID_AUTHORITY_CONTEXT',
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

/** The AI proposal approval type (mirrors assistantActions.AI_PROPOSAL_TYPE; a test keeps them equal). */
export const AI_PROPOSAL_APPROVAL_TYPE = 'AI Proposal';

/**
 * Which decision type an approval request belongs to (by its stored approval_type). Major
 * Purchase / Major Cost requests are the purchase decision itself and AI proposals have their
 * own type; every other request (technical change, drawing, variation, date change,
 * safety-critical, ...) is an "other approval request" decided by its assigned approver.
 * Drawing revisions and variations themselves are decided on their own records.
 */
export function decisionTypeForApprovalType(approvalType: string): string {
  if (approvalType === 'Major Purchase' || approvalType === 'Major Cost') return 'purchase';
  if (approvalType === AI_PROPOSAL_APPROVAL_TYPE) return 'ai_proposal';
  return 'approval_request';
}

export type ResourceKind = 'drawing_revision' | 'drawing' | 'variation' | 'purchase_order' | 'invoice' | 'approval';
export type DecisionAction = 'approve' | 'reject' | 'request_changes';

export interface ResolveInput {
  resource: { kind: ResourceKind; id: string };
  action?: DecisionAction;
  /**
   * Facts of the write being made, computed by the server from the validated record (a PO's
   * total from its lines, an invoice's amount and 3-way match). Never browser-asserted
   * authority: role, user, project sensitivity and rule ids always come from the database.
   * projectId: a record being created or moved; the ceiling is checked for it as well.
   */
  pending?: { projectId?: string | null; value?: number | null; matchStatus?: string | null };
  now?: Date;
}

interface Facts {
  decisionType: string;
  resourceKind: ResourceKind;
  resourceId: string;
  projectId: string | null;
  clientId: string | null;
  value: number | null;
  valueSource: string;
  approvalType: string | null;
  raisedById: string | null;
  raisedLabel: string;
  matchStatus: string | null;
  assignedApproverId: string | null;
  assignedApproverRole: string | null;
  priorApproval: { type: string; decidedByRole: string | null } | null;
}

export interface Evaluated<T> {
  required: T;
  actual: unknown;
  passed: boolean;
}

export interface RuleOutcome {
  rule_id: string;
  rule_code: string;
  kind: 'system' | 'owner';
  effect: 'allow' | 'require_owner';
  priority: number;
  applies: boolean;
  reason_code?: ReasonCode | 'NOT_APPLICABLE';
  reason?: string;
}

export interface AuthorityResolution {
  allowed: boolean;
  reasonCode: ReasonCode;
  reason: string;
  basis: 'owner' | 'rule' | 'prior_owner_approval' | 'none';
  action: DecisionAction;
  decisionType: string;
  userId: string;
  userRole: string;
  resourceType: ResourceKind;
  resourceId: string;
  projectId: string | null;
  clientId: string | null;
  projectSensitivity: string | null;
  /** The amount of the decision as the server knows it (from the record), if it has one. */
  resourceValue: number | null;
  baselinePermission: string | null;
  matchedRuleId: string | null;
  matchedRuleCode: string | null;
  requiresOwner: boolean;
  evaluatedConditions: Record<string, Evaluated<unknown>>;
  evaluatedScope: { project: Evaluated<string | null>; client: Evaluated<string | null> } | null;
  evaluatedValue: { value: number | null; source: string; min: number | null; max: number | null; passed: boolean } | null;
  evaluatedRisk: { max: string | null; actual: string | null; passed: boolean } | null;
  evaluatedDates: { start_at: string | null; end_at: string | null; now: string; passed: boolean } | null;
  /** Every rule considered for this decision type and what happened to it (for explanations). */
  rules: RuleOutcome[];
  /**
   * The terms of the rule that allowed the decision, exactly as the resolver read them in this
   * transaction (Batch 8 decision traceability). Null unless basis = 'rule'.
   */
  matchedRule: RuleTerms | null;
  /** Who raised / recorded the record, when the server knows it from the record. */
  raisedById: string | null;
  resolvedAt: string;
}

/** A rule's terms as they were when a decision used it (never re-read later). */
export interface RuleTerms {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  kind: 'system' | 'owner';
  effect: string;
  authority_type: string | null;
  target_role: string | null;
  target_user_id: string | null;
  target_permission: string | null;
  project_id: string | null;
  client_id: string | null;
  min_value: number | null;
  max_value: number | null;
  max_risk: string | null;
  conditions: Record<string, unknown>;
  start_at: string | null;
  end_at: string | null;
  priority: number;
  active: boolean;
  locked: boolean;
  granted_by: string | null;
  absence_id: string | null;
  extended_from: string | null;
  updated_at: string | null;
}
const ruleTerms = (r: Row): RuleTerms => ({
  id: r.id,
  code: r.code,
  name: r.name ?? null,
  description: r.description ?? null,
  kind: r.kind,
  effect: r.effect,
  authority_type: r.authority_type ?? null,
  target_role: r.target_role ?? null,
  target_user_id: r.target_user_id ?? null,
  target_permission: r.target_permission ?? null,
  project_id: r.project_id ?? null,
  client_id: r.client_id ?? null,
  min_value: r.min_value === null || r.min_value === undefined ? null : Number(r.min_value),
  max_value: r.max_value === null || r.max_value === undefined ? null : Number(r.max_value),
  max_risk: r.max_risk ?? null,
  conditions: r.conditions ?? {},
  start_at: r.start_at ? new Date(r.start_at).toISOString() : null,
  end_at: r.end_at ? new Date(r.end_at).toISOString() : null,
  priority: Number(r.priority),
  active: Boolean(r.active),
  locked: Boolean(r.locked),
  granted_by: r.granted_by ?? null,
  absence_id: r.absence_id ?? null,
  extended_from: r.extended_from ?? null,
  updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
});

const OWNER_ROLE = 'Owner / CEO';
const RISK_RANK: Record<string, number> = { 'On Track': 0, Attention: 1, 'At Risk': 2, Critical: 3 };
const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

class ContextError extends Error {}

/**
 * Reason precedence (docs/phase6-delegated-authority.md, "Reason precedence"): when several
 * things block a decision, the earliest code in this list is the one reported. The gates
 * (context, sensitivity, self-approval, baseline) are checked in this order before any rule;
 * rule failures follow the same order, then OWNER_REQUIRED / NO_MATCHING_AUTHORITY.
 */
export const REASON_PRECEDENCE: ReasonCode[] = [
  'INVALID_AUTHORITY_CONTEXT',
  'SENSITIVITY_BLOCKED',
  'SELF_APPROVAL_BLOCKED',
  'INSUFFICIENT_PERMISSION',
  'OUT_OF_SCOPE',
  'AUTHORITY_NOT_YET_ACTIVE',
  'AUTHORITY_EXPIRED',
  'AUTHORITY_DEACTIVATED',
  'VALUE_LIMIT_EXCEEDED',
  'RISK_LIMIT_EXCEEDED',
  'CONDITION_NOT_MET',
  'NO_MATCHING_AUTHORITY',
  'OWNER_REQUIRED',
  'ALLOWED',
];
const rank = (code: string) => {
  const i = REASON_PRECEDENCE.indexOf(code as ReasonCode);
  return i < 0 ? REASON_PRECEDENCE.length : i;
};

/** Loads the record being decided and derives every fact from the database. */
async function loadFacts(db: Db, input: ResolveInput): Promise<Facts> {
  const { kind, id } = input.resource;
  const base = { resourceKind: kind, resourceId: id, value: null, valueSource: 'none', approvalType: null, raisedById: null, raisedLabel: '', matchStatus: null, assignedApproverId: null, assignedApproverRole: null, priorApproval: null } as Omit<Facts, 'decisionType' | 'projectId' | 'clientId'>;
  const one = async (sql: string) => {
    const row = (await db.query(sql, [id])).rows[0];
    if (!row && !input.pending?.projectId) throw new ContextError(`${kind} ${id} was not found`);
    return row as Row | undefined;
  };
  let f: Omit<Facts, 'clientId'>;
  switch (kind) {
    case 'drawing_revision': {
      const r = await one('SELECT d.project_id FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id WHERE r.id = $1');
      f = { ...base, decisionType: 'drawing', projectId: r?.project_id ?? null };
      break;
    }
    case 'drawing': {
      const r = await one('SELECT project_id FROM drawings WHERE id = $1');
      f = { ...base, decisionType: 'drawing', projectId: r?.project_id ?? null };
      break;
    }
    case 'variation': {
      const r = await one('SELECT project_id, data FROM variations WHERE id = $1');
      f = { ...base, decisionType: 'variation', projectId: r?.project_id ?? null, value: num(r?.data?.client_amount), valueSource: 'variation client amount', raisedById: r?.data?.created_by_id ?? null, raisedLabel: 'raised this variation' };
      break;
    }
    case 'purchase_order': {
      const r = await one('SELECT project_id, data FROM purchase_orders WHERE id = $1');
      const prior = r
        ? (await db.query(`SELECT data->>'decision_by_role' AS role FROM approvals WHERE related_entity_id = $1 AND approval_type = 'Major Purchase' AND decision = 'Approved' ORDER BY (data->>'decision_by_role' = $2) DESC LIMIT 1`, [id, OWNER_ROLE])).rows[0]
        : undefined;
      f = { ...base, decisionType: 'purchase', projectId: r?.project_id ?? null, value: num(r?.data?.total_amount), valueSource: 'PO total', priorApproval: prior ? { type: 'Major Purchase', decidedByRole: prior.role ?? null } : null };
      break;
    }
    case 'invoice': {
      const r = await one('SELECT project_id, data FROM commercial_invoices WHERE id = $1');
      f = { ...base, decisionType: 'invoice', projectId: r?.project_id ?? null, value: num(r?.data?.amount_before_tax), valueSource: 'invoice amount before tax', raisedById: r?.data?.recorded_by_id ?? null, raisedLabel: 'recorded this invoice', matchStatus: r?.data?.match_status ?? 'Not applicable' };
      break;
    }
    case 'approval': {
      const r = await one('SELECT project_id, approval_type, related_entity_type, related_entity_id, requested_by_id, data FROM approvals WHERE id = $1');
      if (!r) throw new ContextError(`approval ${id} was not found`);
      // A value only when the server can read it from the related record (never the requester's estimate).
      let value: number | null = null;
      let valueSource = 'none (no related record with an amount)';
      if (r.related_entity_type === 'purchase' && r.related_entity_id) {
        const po = (await db.query('SELECT project_id, data FROM purchase_orders WHERE id = $1', [r.related_entity_id])).rows[0];
        if (po && po.project_id === r.project_id) [value, valueSource] = [num(po.data.total_amount), `PO ${po.data.po_number ?? r.related_entity_id} total`];
      } else if (r.related_entity_type === 'variation' && r.related_entity_id) {
        const vo = (await db.query('SELECT project_id, data FROM variations WHERE id = $1', [r.related_entity_id])).rows[0];
        if (vo && vo.project_id === r.project_id) [value, valueSource] = [num(vo.data.client_amount), `variation ${vo.data.variation_number ?? r.related_entity_id} client amount`];
      }
      f = {
        ...base,
        decisionType: decisionTypeForApprovalType(String(r.approval_type)),
        projectId: r.project_id,
        value,
        valueSource,
        approvalType: String(r.approval_type),
        raisedById: r.requested_by_id ?? r.data?.requested_by_id ?? null,
        raisedLabel: 'created this request',
        assignedApproverId: r.data?.assigned_approver_id ?? null,
        assignedApproverRole: r.data?.assigned_approver_role ?? null,
      };
      break;
    }
    default:
      throw new ContextError(`Unknown resource kind ${String(kind)}`);
  }
  const p = input.pending;
  if (p?.value !== undefined && p.value !== null) f.value = num(p.value);
  if (p?.matchStatus !== undefined) f.matchStatus = p.matchStatus ?? 'Not applicable';
  if (!f.projectId && p?.projectId) f.projectId = p.projectId;
  const client = f.projectId ? (await db.query('SELECT client_id FROM projects WHERE id = $1', [f.projectId])).rows[0] : undefined;
  return { ...f, clientId: client?.client_id ?? null };
}

function result(ctx: AccessContext, facts: Partial<Facts> & { decisionType: string; resourceKind: ResourceKind; resourceId: string }, action: DecisionAction, now: Date, over: Partial<AuthorityResolution>): AuthorityResolution {
  return {
    allowed: false,
    reasonCode: 'INVALID_AUTHORITY_CONTEXT',
    reason: '',
    basis: 'none',
    action,
    decisionType: facts.decisionType,
    userId: ctx.user.id,
    userRole: ctx.user.role,
    resourceType: facts.resourceKind,
    resourceId: facts.resourceId,
    projectId: facts.projectId ?? null,
    clientId: facts.clientId ?? null,
    projectSensitivity: null,
    resourceValue: facts.value ?? null,
    baselinePermission: null,
    matchedRuleId: null,
    matchedRuleCode: null,
    matchedRule: null,
    raisedById: facts.raisedById ?? null,
    requiresOwner: false,
    evaluatedConditions: {},
    evaluatedScope: null,
    evaluatedValue: null,
    evaluatedRisk: null,
    evaluatedDates: null,
    rules: [],
    resolvedAt: now.toISOString(),
    ...over,
  };
}

interface RuleCheck {
  outcome: RuleOutcome;
  conditions: Record<string, Evaluated<unknown>>;
  scope: AuthorityResolution['evaluatedScope'];
  value: AuthorityResolution['evaluatedValue'];
  risk: AuthorityResolution['evaluatedRisk'];
  dates: AuthorityResolution['evaluatedDates'];
}

/** Evaluates one rule against the facts. Allow rules must also target the user. */
async function checkRule(rule: Row, ctx: AccessContext, facts: Facts, sensitivity: string | null, now: Date, risk: () => Promise<string>): Promise<RuleCheck> {
  const outcome: RuleOutcome = { rule_id: rule.id, rule_code: rule.code, kind: rule.kind, effect: rule.effect, priority: rule.priority, applies: false };
  const check: RuleCheck = { outcome, conditions: {}, scope: null, value: null, risk: null, dates: null };
  const fail = (code: RuleOutcome['reason_code'], reason: string) => {
    outcome.reason_code = code;
    outcome.reason = reason;
    return check;
  };
  const u = ctx.user;

  if (rule.effect === 'allow') {
    if (rule.target_user_id && rule.target_user_id !== u.id) return fail('NOT_APPLICABLE', 'for another user');
    if (rule.target_role && rule.target_role !== u.role) return fail('NOT_APPLICABLE', `for ${rule.target_role}`);
    if (rule.target_permission && !ctx.can(rule.target_permission as PermissionKey)) return fail('NOT_APPLICABLE', `for holders of ${rule.target_permission}`);
  }
  const c = (rule.conditions ?? {}) as Row;
  const isRequest = facts.resourceKind === 'approval';
  // What the rule is about.
  if (c.direct_only && isRequest) return fail('NOT_APPLICABLE', 'applies to the record itself, not to approval requests');
  if (c.requests_only && !isRequest) return fail('NOT_APPLICABLE', 'applies to approval requests only');
  if (c.approval_types !== undefined) {
    const ok = Array.isArray(c.approval_types) && facts.approvalType !== null && c.approval_types.includes(facts.approvalType);
    check.conditions.approval_types = { required: c.approval_types, actual: facts.approvalType, passed: ok };
    if (!ok) return fail('NOT_APPLICABLE', `only for ${Array.isArray(c.approval_types) ? c.approval_types.join(' / ') : '?'} requests`);
  }

  const projectOk = !rule.project_id || rule.project_id === facts.projectId;
  const clientOk = !rule.client_id || rule.client_id === facts.clientId;
  check.scope = { project: { required: rule.project_id ?? null, actual: facts.projectId, passed: projectOk }, client: { required: rule.client_id ?? null, actual: facts.clientId, passed: clientOk } };
  if (!projectOk) return fail('OUT_OF_SCOPE', `${rule.code} covers project ${rule.project_id} only`);
  if (!clientOk) return fail('OUT_OF_SCOPE', `${rule.code} covers client ${rule.client_id} only`);

  const start = iso(rule.start_at);
  const end = iso(rule.end_at);
  check.dates = { start_at: start, end_at: end, now: now.toISOString(), passed: true };
  if (start && Date.parse(start) > now.getTime()) {
    check.dates.passed = false;
    return fail('AUTHORITY_NOT_YET_ACTIVE', `${rule.code} starts on ${start.slice(0, 10)}`);
  }
  if (end && Date.parse(end) <= now.getTime()) {
    check.dates.passed = false;
    return fail('AUTHORITY_EXPIRED', `${rule.code} ended on ${end.slice(0, 10)}`);
  }
  if (!rule.active) return fail('AUTHORITY_DEACTIVATED', `${rule.code} is deactivated${rule.deactivation_reason ? ` (${rule.deactivation_reason})` : ''}`);

  const min = num(rule.min_value);
  const max = num(rule.max_value);
  if (min !== null || max !== null) {
    const v = facts.value;
    const inRange = v !== null && (min === null || v >= min) && (max === null || v <= max);
    check.value = { value: v, source: facts.valueSource, min, max, passed: inRange };
    // An allow rule never applies to an unknown amount; a require_owner rule does (fail closed).
    if (v === null && rule.effect === 'require_owner') {
      check.value.passed = true;
    } else if (!inRange) {
      return fail(rule.effect === 'allow' ? 'VALUE_LIMIT_EXCEEDED' : 'NOT_APPLICABLE', v === null ? 'the amount is not known to the server' : `RM ${v} is outside ${min ?? 0} to ${max ?? 'any'}`);
    }
  }

  if (rule.max_risk) {
    const actual = await risk();
    const ok = RISK_RANK[actual] !== undefined && RISK_RANK[actual] <= (RISK_RANK[rule.max_risk] ?? -1);
    check.risk = { max: rule.max_risk, actual, passed: ok };
    if (!ok) return fail(rule.effect === 'allow' ? 'RISK_LIMIT_EXCEEDED' : 'NOT_APPLICABLE', `project risk is ${actual}, above ${rule.max_risk}`);
  }

  for (const [key, required] of Object.entries(c)) {
    if (['direct_only', 'requests_only', 'approval_types'].includes(key)) continue;
    let actual: unknown;
    let passed: boolean;
    switch (key) {
      case 'sensitivity':
        actual = sensitivity;
        passed = Array.isArray(required) && required.includes(sensitivity);
        break;
      case 'match_status':
        actual = facts.matchStatus;
        passed = Array.isArray(required) && required.includes(facts.matchStatus);
        break;
      case 'match_status_not':
        actual = facts.matchStatus;
        passed = Array.isArray(required) && facts.matchStatus !== null && !required.includes(facts.matchStatus);
        break;
      case 'no_self_approval':
        actual = facts.raisedById === u.id ? 'raised by this user' : 'raised by someone else';
        passed = !required || facts.raisedById !== u.id;
        break;
      case 'assigned_approver':
        actual = { id: facts.assignedApproverId, role: facts.assignedApproverRole };
        passed =
          !required ||
          (facts.assignedApproverId !== null && facts.assignedApproverId === u.id) ||
          (facts.assignedApproverRole !== null && facts.assignedApproverRole === u.role) ||
          (facts.assignedApproverRole === 'Designated Authorized Manager' && ctx.can('approvals.decide'));
        break;
      case 'requires_permission':
        actual = ctx.can(required as PermissionKey);
        passed = actual === true;
        break;
      case 'prior_approval':
        actual = facts.priorApproval?.type ?? null;
        passed = facts.priorApproval?.type === required;
        break;
      case 'unless_prior_approval':
        actual = facts.priorApproval?.type ?? null;
        passed = facts.priorApproval?.type !== required;
        break;
      default:
        // Unknown condition: an allow rule does not apply; a require_owner rule does (fail closed).
        actual = 'unknown condition';
        passed = rule.effect === 'require_owner';
    }
    check.conditions[key] = { required, actual, passed };
    if (!passed) {
      if (key === 'no_self_approval') return fail('SELF_APPROVAL_BLOCKED', `${rule.code}: never by the person who ${facts.raisedLabel || 'raised it'}`);
      return fail(rule.effect === 'allow' ? 'CONDITION_NOT_MET' : 'NOT_APPLICABLE', `${rule.code}: condition ${key} not met`);
    }
  }
  outcome.applies = true;
  return check;
}

async function resolveOne(db: Db, ctx: AccessContext, facts: Facts, action: DecisionAction, now: Date): Promise<AuthorityResolution> {
  const u = ctx.user;
  const out = (over: Partial<AuthorityResolution>) => result(ctx, facts, action, now, over);
  const sensRow = facts.projectId ? (await db.query('SELECT sensitivity FROM projects WHERE id = $1', [facts.projectId])).rows[0] : undefined;
  const sensitivity: string | null = sensRow?.sensitivity ?? null;

  // Access comes first: a record outside the user's projects is OUT_OF_SCOPE, and nothing about
  // that project (not even its sensitivity) is disclosed.
  if (facts.projectId && !ctx.canSeeProject(facts.projectId)) {
    return out({ reasonCode: 'OUT_OF_SCOPE', reason: 'This record is outside your projects' });
  }
  // Nobody, the Owner included, internally approves a variation they raised.
  if (facts.resourceKind === 'variation' && action === 'approve' && facts.raisedById === u.id) {
    return out({ reasonCode: 'SELF_APPROVAL_BLOCKED', reason: 'You cannot internally approve a variation you raised', projectSensitivity: sensitivity });
  }
  if (u.role === OWNER_ROLE) {
    const type = (await db.query('SELECT baseline_permission FROM authority_decision_types WHERE key = $1', [facts.decisionType])).rows[0];
    return out({ allowed: true, reasonCode: 'ALLOWED', basis: 'owner', reason: 'The Owner may decide', projectSensitivity: sensitivity, baselinePermission: type?.baseline_permission ?? null });
  }

  // 5-6. Sensitivity ceiling, then the baseline permission.
  const ceiling = await authorityCeiling(db, ctx, facts.decisionType, facts.projectId);
  const common = { projectSensitivity: sensitivity, baselinePermission: ceiling.baseline_permission ?? null };
  if (ceiling.outcome === 'owner_required') {
    const blockedBySensitivity = sensitivity === 'Sensitive' || sensitivity === 'Strategic';
    // A purchase order whose Major Purchase approval the Owner gave carries out the Owner's decision.
    const ownerApproved = facts.resourceKind === 'purchase_order' && facts.priorApproval?.decidedByRole === OWNER_ROLE;
    if (!(blockedBySensitivity && ownerApproved && ctx.can(ceiling.baseline_permission as PermissionKey) && ctx.can('purchasing.create'))) {
      return out({ ...common, requiresOwner: true, reasonCode: blockedBySensitivity ? 'SENSITIVITY_BLOCKED' : 'INVALID_AUTHORITY_CONTEXT', reason: ceiling.reason });
    }
    return out({ ...common, allowed: true, reasonCode: 'ALLOWED', basis: 'prior_owner_approval', reason: `The Owner approved the Major Purchase approval for this purchase order (${sensitivity} project)` });
  }

  // Business rule: nobody decides what they raised themselves (variations: internal approval only).
  if (facts.raisedById && facts.raisedById === u.id && !(facts.resourceKind === 'variation' && action !== 'approve')) {
    const reason =
      facts.resourceKind === 'invoice'
        ? 'You cannot approve an invoice you recorded'
        : facts.resourceKind === 'variation'
          ? 'You cannot internally approve a variation you raised'
          : 'Conflict of Interest: you created this request. Company policy requires independent approval.';
    return out({ ...common, reasonCode: 'SELF_APPROVAL_BLOCKED', reason });
  }
  if (ceiling.outcome === 'denied') return out({ ...common, reasonCode: 'INSUFFICIENT_PERMISSION', reason: ceiling.reason });

  // 7. Rules for this decision type (inactive ones too, to explain a near miss).
  const rules = (await db.query('SELECT * FROM delegated_authorities WHERE decision_type = $1 ORDER BY priority DESC, kind DESC, code', [facts.decisionType])).rows;
  let riskLevel: string | undefined;
  const risk = async () => (riskLevel ??= facts.projectId ? (await computeProjectRisk(db, facts.projectId, now, true)).level : 'Unknown');
  const checks: RuleCheck[] = [];
  for (const rule of rules) checks.push(await checkRule(rule, ctx, facts, sensitivity, now, risk));
  const outcomes = checks.map((c) => c.outcome);
  const detail = (c: RuleCheck | undefined) => (c ? { evaluatedConditions: c.conditions, evaluatedScope: c.scope, evaluatedValue: c.value, evaluatedRisk: c.risk, evaluatedDates: c.dates } : {});
  // Highest priority first; equal priorities in code order, so the result never depends on storage order.
  const byPriority = (a: RuleCheck, b: RuleCheck) => b.outcome.priority - a.outcome.priority || a.outcome.rule_code.localeCompare(b.outcome.rule_code);
  const allow = checks.filter((c) => c.outcome.applies && c.outcome.effect === 'allow').sort(byPriority)[0];
  const requireOwner = checks.filter((c) => c.outcome.applies && c.outcome.effect === 'require_owner').sort(byPriority)[0];

  // Priority decides; on a tie the Owner requirement wins (never downgrade authority on ambiguity).
  if (allow && (!requireOwner || allow.outcome.priority > requireOwner.outcome.priority)) {
    return out({ ...common, ...detail(allow), rules: outcomes, allowed: true, reasonCode: 'ALLOWED', basis: 'rule', matchedRuleId: allow.outcome.rule_id, matchedRuleCode: allow.outcome.rule_code, matchedRule: ruleTerms(rules.find((x) => x.id === allow.outcome.rule_id)!), reason: `Allowed by ${allow.outcome.rule_code}` });
  }
  // Not allowed. Only rules that would have decided it count: rules written for this person,
  // about this kind of decision, that would outrank every applicable require_owner rule had
  // they passed. Rules for other people or other kinds of decision never count. A rule for
  // another project / client counts only when no rule for this person covers this record.
  const decisive = checks.filter(
    (c) => c.outcome.effect === 'allow' && c.outcome.reason_code && c.outcome.reason_code !== 'NOT_APPLICABLE' && (!requireOwner || c.outcome.priority > requireOwner.outcome.priority)
  );
  // A rule for another project / client says something true about this record only while it
  // is in force (active and in date) and nothing covers this record.
  const inForce = (c: RuleCheck) => {
    const r = rules.find((x) => x.id === c.outcome.rule_id)!;
    return r.active && (!r.start_at || new Date(r.start_at).getTime() <= now.getTime()) && (!r.end_at || new Date(r.end_at).getTime() > now.getTime());
  };
  const inScope = decisive.filter((c) => c.outcome.reason_code !== 'OUT_OF_SCOPE');
  const elsewhere = decisive.filter((c) => c.outcome.reason_code === 'OUT_OF_SCOPE' && inForce(c));
  const blocker = (inScope.length ? inScope : elsewhere).sort((a, b) => rank(a.outcome.reason_code!) - rank(b.outcome.reason_code!) || byPriority(a, b))[0];
  const ownerRule = requireOwner ? rules.find((x) => x.id === requireOwner.outcome.rule_id)! : undefined;
  if (blocker) {
    return out({
      ...common,
      ...detail(blocker),
      rules: outcomes,
      requiresOwner: Boolean(ownerRule),
      reasonCode: blocker.outcome.reason_code as ReasonCode,
      matchedRuleId: blocker.outcome.rule_id,
      matchedRuleCode: blocker.outcome.rule_code,
      reason: `${blocker.outcome.reason}; the Owner (or someone with authority) must decide`,
    });
  }
  if (ownerRule) {
    return out({ ...common, ...detail(requireOwner), rules: outcomes, requiresOwner: true, reasonCode: 'OWNER_REQUIRED', matchedRuleId: ownerRule.id, matchedRuleCode: ownerRule.code, reason: `${ownerRule.code}: ${ownerRule.description}` });
  }
  return out({ ...common, rules: outcomes, reasonCode: 'NO_MATCHING_AUTHORITY', reason: `No authority rule lets ${u.role} decide this ${facts.decisionType.replace('_', ' ')}; ${ceiling.baseline_permission} alone approves nothing` });
}

/**
 * Resolves whether the signed-in user may take this approval decision. Never throws for an
 * authority problem: a context the server cannot establish fails closed (Owner required).
 */
export async function resolveApprovalAuthority(db: Db, ctx: AccessContext, input: ResolveInput): Promise<AuthorityResolution> {
  const now = input.now ?? new Date();
  const action = input.action ?? 'approve';
  const stub = { decisionType: 'unknown', resourceKind: input.resource.kind, resourceId: input.resource.id };
  if (!ctx.user.is_active) return result(ctx, stub, action, now, { reasonCode: 'INVALID_AUTHORITY_CONTEXT', reason: 'Your account is deactivated' });
  let facts: Facts;
  try {
    facts = await loadFacts(db, input);
  } catch (e) {
    if (!(e instanceof ContextError)) throw e;
    return result(ctx, stub, action, now, { reasonCode: 'INVALID_AUTHORITY_CONTEXT', requiresOwner: true, reason: `${e.message}; escalated to the Owner` });
  }
  const first = await resolveOne(db, ctx, facts, action, now);
  // A record being moved to another project must be decidable in both.
  const moved = input.pending?.projectId;
  if (!first.allowed || !moved || moved === facts.projectId) return first;
  const client = (await db.query('SELECT client_id FROM projects WHERE id = $1', [moved])).rows[0];
  const second = await resolveOne(db, ctx, { ...facts, projectId: moved, clientId: client?.client_id ?? null }, action, now);
  return second.allowed ? first : second;
}

/** Resolves and throws 403 with the explanation unless the decision is allowed. */
export async function requireAuthority(db: Db, ctx: AccessContext, input: ResolveInput, message?: (r: AuthorityResolution) => string | undefined): Promise<AuthorityResolution> {
  const r = await resolveApprovalAuthority(db, ctx, input);
  if (!r.allowed) throw new AuthorityError(r, message?.(r) ?? r.reason);
  return r;
}

/** A refused approval: 403, carrying the structured resolution for the caller. */
export class AuthorityError extends ForbiddenError {
  constructor(
    readonly resolution: AuthorityResolution,
    message: string
  ) {
    super(message);
  }
}

/**
 * A client deciding a client-facing request (Variation / Client Scope Change) on their own
 * project gives the client's consent. That is not internal approval authority and does not go
 * through the rules; this is the one place the server decides it (approval hook and the
 * screens' /api/authority/resolve both use it).
 */
export function clientConsentAllowed(ctx: AccessContext, approval: { approval_type?: unknown; project_id?: unknown }) {
  const clientFacing = approval.approval_type === 'Variation' || approval.approval_type === 'Client Scope Change';
  return ctx.user.role === 'Client' && clientFacing && ctx.can('variations.client_approve') && ctx.canSeeProject(String(approval.project_id));
}

/** What a screen needs to show for one decision (never the rule list or other people's rules). */
export function authorityForScreen(r: AuthorityResolution) {
  return {
    allowed: r.allowed,
    reason_code: r.reasonCode,
    reason: r.reason,
    requires_owner: r.requiresOwner,
    basis: r.basis,
    decision_type: r.decisionType,
    project_sensitivity: r.projectSensitivity,
    matched_rule_code: r.matchedRuleCode,
  };
}

/** What an approval audit record carries about the authority used (compact, explainable later). */
export function authorityAudit(r: AuthorityResolution) {
  return {
    decision_type: r.decisionType,
    action: r.action,
    actor_id: r.userId,
    actor_role: r.userRole,
    resource: `${r.resourceType}:${r.resourceId}`,
    project_id: r.projectId,
    sensitivity: r.projectSensitivity,
    basis: r.basis,
    matched_rule_id: r.matchedRuleId,
    matched_rule_code: r.matchedRuleCode,
    reason_code: r.reasonCode,
    result: r.allowed ? 'allowed' : 'refused',
  };
}
