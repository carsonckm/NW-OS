/**
 * Delegated authority: rules (System Policy + Owner rules) that say who may approve which
 * decisions under which conditions. See docs/phase6-delegated-authority.md.
 *
 * This module stores, validates and audits rules; the authority resolver (authorityResolver.ts)
 * enforces them on every approval path.
 *
 * Everything that decides who a rule covers is validated here, on the server: the browser can
 * never set a rule's id, code, kind, system key, lock, granting user or permission target.
 *
 * Project sensitivity is a hard ceiling (authorityCeiling.ts): an allow rule can never be
 * created, changed or reactivated onto a project whose sensitivity reserves that decision for
 * the Owner, and the Sensitive / Strategic System Policy rows are locked.
 */
import { randomUUID } from 'crypto';
import { ForbiddenError, type AccessContext } from '../auth/access';
import { isRole, permissionsFor } from '../auth/permissions';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import { ruleExceedsCeiling } from './authorityCeiling';
import type { PermissionKey, UserRole } from '../../src/types';

type Db = Pool | PoolClient;
type Row = Record<string, any>;

/** 404 with a readable message (same shape as other module records). */
function notFound(what: string) {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
}

export const RISK_LEVELS = ['On Track', 'Attention', 'At Risk', 'Critical'] as const;
export const SENSITIVITY = ['Normal', 'Sensitive', 'Strategic'] as const;
/** Roles that can never hold internal approval authority. */
const EXTERNAL_ROLES = new Set<string>(['Client', 'Contractor']);
/** Owner rules stay below the sensitivity policies (900 / 1000). */
const OWNER_PRIORITY = { min: 1, max: 899 };
const MAX_VALUE = 1_000_000_000_000;

/** Fields an Owner rule may carry; anything else in a request is refused. */
const RULE_FIELDS = ['name', 'description', 'effect', 'decision_type', 'target_role', 'target_user_id', 'project_id', 'client_id', 'min_value', 'max_value', 'max_risk', 'conditions', 'start_at', 'end_at', 'priority', 'active'];
const UPDATABLE = RULE_FIELDS.filter((f) => !['effect', 'decision_type', 'active'].includes(f));
/** Condition keys an Owner rule may use (System Policy may use more; it is never written through the API). */
const CONDITION_KEYS: Record<string, (v: unknown, rule: Row) => string | null> = {
  // Restrict a rule to some approval request types (e.g. ["Major Purchase"]).
  approval_types: (v) => (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string' && x.trim()) ? null : 'approval_types must be a non-empty list of approval types'),
  // A require_owner rule may add Sensitive projects; Strategic is always the Owner's already.
  sensitivity: (v, rule) =>
    rule.effect !== 'require_owner'
      ? 'sensitivity conditions are only for require_owner rules'
      : Array.isArray(v) && v.length && v.every((x) => x === 'Normal' || x === 'Sensitive')
        ? null
        : 'sensitivity must be a non-empty list of Normal / Sensitive',
};

export interface DecisionType {
  key: string;
  label: string;
  baseline_permission: PermissionKey;
  has_value: boolean;
  /** Whether a Sensitive project reserves this decision type for the Owner (not editable by API). */
  sensitive_protected: boolean;
  active: boolean;
}

export async function decisionTypes(db: Db): Promise<DecisionType[]> {
  return (await db.query('SELECT key, label, baseline_permission, has_value, sensitive_protected, active FROM authority_decision_types ORDER BY label')).rows;
}

const money = (n: unknown) => `RM ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (v: unknown) => (v ? new Date(String(v)).toISOString().slice(0, 10) : '');

/** A plain-language summary of what a rule does, written by the server (never by the browser). */
export function describeRule(r: Row, names: { type?: string; user?: string; project?: string; client?: string } = {}): string {
  const type = (names.type ?? r.decision_type).toLowerCase();
  const scope = [names.project ? `on ${names.project}` : r.project_id ? `on project ${r.project_id}` : '', names.client ? `for ${names.client}` : r.client_id ? `for client ${r.client_id}` : ''].filter(Boolean).join(' ');
  const range =
    r.min_value != null && r.max_value != null
      ? `from ${money(r.min_value)} to ${money(r.max_value)}`
      : r.min_value != null
        ? `of ${money(r.min_value)} or more`
        : r.max_value != null
          ? `up to ${money(r.max_value)}`
          : '';
  const risk = r.max_risk ? `while project risk is ${r.max_risk} or lower` : '';
  const when = r.start_at || r.end_at ? `${r.start_at ? `from ${day(r.start_at)} ` : ''}${r.end_at ? `until ${day(r.end_at)}` : ''}`.trim() : '';
  const tail = [[range, scope].filter(Boolean).join(' '), risk, when].filter(Boolean).join(', ');
  if (r.effect === 'require_owner') {
    const sens = Array.isArray(r.conditions?.sensitivity) ? ` on ${r.conditions.sensitivity.join(' / ')} projects` : '';
    return `The Owner must approve every ${type}${sens}${tail ? ` (${tail})` : ''}.`;
  }
  const who = r.target_user_id ? `${names.user ?? r.target_user_id}${r.target_role ? ` (${r.target_role})` : ''}` : r.target_role ? `${r.target_role}` : `Holders of ${r.target_permission}`;
  return `${who} may approve ${type}${tail ? ` ${tail}` : ''}.`;
}

/** Rules with the names needed to read them (granting user, target user, project, client, type). */
export async function listRules(db: Db, filter: { decision_type?: string; active?: string; kind?: string; project_id?: string; id?: string } = {}) {
  const where: string[] = [];
  const args: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace('?', `$${args.length}`));
  };
  if (filter.id) add('a.id = ?', filter.id);
  if (filter.decision_type) add('a.decision_type = ?', filter.decision_type);
  if (filter.kind) add('a.kind = ?', filter.kind);
  if (filter.project_id) add('a.project_id = ?', filter.project_id);
  if (filter.active === 'true' || filter.active === 'false') add('a.active = ?', filter.active === 'true');
  const rows = (
    await db.query(
      `SELECT a.*, t.label AS decision_type_label, t.baseline_permission, g.name AS granted_by_name, u.name AS target_user_name,
              p.project_name, c.company_name AS client_name
       FROM delegated_authorities a
       JOIN authority_decision_types t ON t.key = a.decision_type
       LEFT JOIN users g ON g.id = a.granted_by
       LEFT JOIN users u ON u.id = a.target_user_id
       LEFT JOIN projects p ON p.id = a.project_id
       LEFT JOIN clients c ON c.id = a.client_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.kind DESC, a.decision_type, a.priority DESC, a.code`,
      args
    )
  ).rows;
  return rows.map((r) => {
    const out: Row = {
      ...r,
      min_value: r.min_value == null ? null : Number(r.min_value),
      max_value: r.max_value == null ? null : Number(r.max_value),
      source: r.kind === 'system' ? 'System Policy' : `Granted by ${r.granted_by_name ?? r.granted_by}`,
    };
    out.summary = describeRule(out, { type: r.decision_type_label, user: r.target_user_name, project: r.project_name, client: r.client_name });
    return out;
  });
}

export async function getRule(db: Db, id: string) {
  const rule = (await listRules(db, { id }))[0];
  if (!rule) throw notFound(`Authority rule ${id}`);
  return rule;
}

const isObject = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

function refuseUnknown(body: Row, allowed: string[]) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ValidationError(`These fields are set by the server or not allowed: ${extra.join(', ')}`);
}

function parseTime(v: unknown, field: string): string | null {
  if (v === undefined || v === null || v === '') return null;
  const t = Date.parse(String(v));
  if (typeof v !== 'string' || Number.isNaN(t)) throw new ValidationError(`${field} must be a date/time`);
  return new Date(t).toISOString();
}

function parseValue(v: unknown, field: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > MAX_VALUE) throw new ValidationError(`${field} must be an amount between 0 and ${MAX_VALUE}`);
  return Math.round(n * 100) / 100;
}

/**
 * Validates an Owner rule (a whole rule: on update, the stored rule merged with the change).
 * Checks every reference against the database and the baseline permission of the decision type.
 */
async function validateOwnerRule(db: Db, input: Row, now: Date, { creating }: { creating: boolean }): Promise<Row> {
  const r: Row = {};
  r.name = str(input.name);
  if (r.name.length < 3 || r.name.length > 120) throw new ValidationError('name must be 3 to 120 characters');
  r.description = str(input.description);
  if (!r.description || r.description.length > 1000) throw new ValidationError('description (the reason for this authority) is required, up to 1000 characters');
  r.effect = input.effect;
  if (r.effect !== 'allow' && r.effect !== 'require_owner') throw new ValidationError('effect must be allow or require_owner');

  const type = (await db.query('SELECT key, label, baseline_permission, has_value, active FROM authority_decision_types WHERE key = $1', [input.decision_type])).rows[0] as DecisionType | undefined;
  if (!type || !type.active) throw new ValidationError(`decision_type must be one of the active decision types`);
  r.decision_type = type.key;

  r.target_role = str(input.target_role) || null;
  r.target_user_id = str(input.target_user_id) || null;
  if (r.effect === 'require_owner') {
    if (r.target_role || r.target_user_id) throw new ValidationError('A require_owner rule has no target role or user');
  } else {
    if (!r.target_role && !r.target_user_id) throw new ValidationError('An allow rule needs a target role or a target user');
    if (r.target_role) {
      if (!isRole(r.target_role)) throw new ValidationError(`Unknown role: ${r.target_role}`);
      if (EXTERNAL_ROLES.has(r.target_role)) throw new ValidationError(`${r.target_role} users cannot hold internal approval authority`);
      if (!permissionsFor(r.target_role as UserRole).has(type.baseline_permission)) {
        throw new ValidationError(`${r.target_role} does not have ${type.baseline_permission}, the baseline permission for ${type.label.toLowerCase()}`);
      }
    }
    if (r.target_user_id) {
      const u = (await db.query('SELECT id, role, is_active FROM users WHERE id = $1', [r.target_user_id])).rows[0];
      if (!u) throw new ValidationError(`User ${r.target_user_id} does not exist`);
      if (!u.is_active) throw new ValidationError(`User ${r.target_user_id} is deactivated`);
      if (EXTERNAL_ROLES.has(u.role)) throw new ValidationError(`${u.role} users cannot hold internal approval authority`);
      if (r.target_role && u.role !== r.target_role) throw new ValidationError(`User ${r.target_user_id} is not a ${r.target_role}`);
      if (!permissionsFor(u.role).has(type.baseline_permission)) {
        throw new ValidationError(`That user's role (${u.role}) does not have ${type.baseline_permission}, the baseline permission for ${type.label.toLowerCase()}`);
      }
    }
  }

  r.project_id = str(input.project_id) || null;
  r.client_id = str(input.client_id) || null;
  if (r.project_id) {
    const p = (await db.query('SELECT client_id FROM projects WHERE id = $1', [r.project_id])).rows[0];
    if (!p) throw new ValidationError(`Project ${r.project_id} does not exist`);
    if (r.client_id && p.client_id !== r.client_id) throw new ValidationError('That project does not belong to that client');
    // The sensitivity ceiling: never delegate what the project reserves for the Owner.
    if (r.effect === 'allow') {
      const over = await ruleExceedsCeiling(db, type.key, r.project_id);
      if (over) throw new ValidationError(over);
    }
  }
  if (r.client_id && !(await db.query('SELECT 1 FROM clients WHERE id = $1', [r.client_id])).rowCount) throw new ValidationError(`Client ${r.client_id} does not exist`);

  r.min_value = parseValue(input.min_value, 'min_value');
  r.max_value = parseValue(input.max_value, 'max_value');
  if ((r.min_value != null || r.max_value != null) && !type.has_value) throw new ValidationError(`${type.label} has no amount, so it cannot have a value range`);
  if (r.min_value != null && r.max_value != null && r.min_value > r.max_value) throw new ValidationError('min_value must not be more than max_value');

  r.max_risk = input.max_risk == null || input.max_risk === '' ? null : input.max_risk;
  if (r.max_risk != null && !RISK_LEVELS.includes(r.max_risk)) throw new ValidationError(`max_risk must be one of ${RISK_LEVELS.join(', ')}`);

  const conditions = input.conditions == null ? {} : input.conditions;
  if (!isObject(conditions)) throw new ValidationError('conditions must be an object');
  for (const [k, v] of Object.entries(conditions)) {
    const check = CONDITION_KEYS[k];
    if (!check) throw new ValidationError(`Unknown condition: ${k}`);
    const err = check(v, r);
    if (err) throw new ValidationError(err);
  }
  r.conditions = conditions;

  r.start_at = parseTime(input.start_at, 'start_at');
  r.end_at = parseTime(input.end_at, 'end_at');
  if (r.start_at && r.end_at && Date.parse(r.start_at) >= Date.parse(r.end_at)) throw new ValidationError('end_at must be after start_at');
  if (creating && r.end_at && Date.parse(r.end_at) <= now.getTime()) throw new ValidationError('end_at is already in the past');

  r.priority = input.priority == null || input.priority === '' ? 100 : Number(input.priority);
  if (!Number.isInteger(r.priority) || r.priority < OWNER_PRIORITY.min || r.priority > OWNER_PRIORITY.max) {
    throw new ValidationError(`priority must be a whole number from ${OWNER_PRIORITY.min} to ${OWNER_PRIORITY.max}`);
  }
  return r;
}

const STORED = ['name', 'description', 'effect', 'decision_type', 'target_role', 'target_user_id', 'project_id', 'client_id', 'min_value', 'max_value', 'max_risk', 'conditions', 'start_at', 'end_at', 'priority', 'active'];
const snapshot = (r: Row) => Object.fromEntries(STORED.map((k) => [k, r[k] ?? null]));

function requireManage(ctx: AccessContext) {
  if (!ctx.can('authority.manage')) throw new ForbiddenError('Only the Owner manages delegated authority (authority.manage)');
}

export async function createRule(pool: Pool, ctx: AccessContext, actor: AuditActor, body: unknown, now = new Date()) {
  requireManage(ctx);
  if (!isObject(body)) throw new ValidationError('A rule is required');
  refuseUnknown(body, RULE_FIELDS);
  const r = await validateOwnerRule(pool, body, now, { creating: true });
  const active = body.active === undefined ? true : body.active;
  if (typeof active !== 'boolean') throw new ValidationError('active must be true or false');
  return withTransaction(pool, async (db) => {
    const seq = (await db.query(`SELECT nextval('delegated_authority_seq') AS n`)).rows[0].n;
    const id = `da-${randomUUID().slice(0, 8)}`;
    const code = `DA-${String(seq).padStart(4, '0')}`;
    await db.query(
      `INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, active, target_role, target_user_id, project_id, client_id,
         min_value, max_value, max_risk, conditions, start_at, end_at, priority, granted_by, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'owner', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19, $19)`,
      [id, code, r.name, r.description, r.effect, r.decision_type, active, r.target_role, r.target_user_id, r.project_id, r.client_id, r.min_value, r.max_value, r.max_risk, JSON.stringify(r.conditions), r.start_at, r.end_at, r.priority, ctx.user.id]
    );
    const stored = await getRule(db, id);
    await writeAudit(db, actor, { action: 'authority.rule.create', entityType: 'delegated_authority', entityId: id, projectId: r.project_id, after: { code, ...snapshot(stored), summary: stored.summary } });
    return stored;
  });
}

export async function updateRule(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, body: unknown, now = new Date()) {
  requireManage(ctx);
  if (!isObject(body)) throw new ValidationError('A change is required');
  refuseUnknown(body, [...UPDATABLE, 'change_reason']);
  const reason = str(body.change_reason);
  if (!reason) throw new ValidationError('change_reason is required');
  return withTransaction(pool, async (db) => {
    const existing = (await db.query('SELECT * FROM delegated_authorities WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!existing) throw notFound(`Authority rule ${id}`);
    if (existing.kind === 'system') {
      throw new ForbiddenError('System Policy cannot be edited. Deactivate it, or create an Owner rule with a higher priority.');
    }
    const { change_reason: _ignored, ...change } = body;
    const merged = { ...existing, min_value: existing.min_value == null ? null : Number(existing.min_value), max_value: existing.max_value == null ? null : Number(existing.max_value), ...change };
    const r = await validateOwnerRule(db, merged, now, { creating: false });
    await db.query(
      `UPDATE delegated_authorities SET name = $2, description = $3, target_role = $4, target_user_id = $5, project_id = $6, client_id = $7, min_value = $8, max_value = $9,
         max_risk = $10, conditions = $11, start_at = $12, end_at = $13, priority = $14, updated_by = $15, updated_at = now() WHERE id = $1`,
      [id, r.name, r.description, r.target_role, r.target_user_id, r.project_id, r.client_id, r.min_value, r.max_value, r.max_risk, JSON.stringify(r.conditions), r.start_at, r.end_at, r.priority, ctx.user.id]
    );
    const before = await snapshotOf(existing);
    const stored = await getRule(db, id);
    await writeAudit(db, actor, { action: 'authority.rule.update', entityType: 'delegated_authority', entityId: id, projectId: stored.project_id, before, after: { ...snapshot(stored), summary: stored.summary }, details: reason });
    return stored;
  });
}

async function snapshotOf(row: Row) {
  return snapshot({ ...row, min_value: row.min_value == null ? null : Number(row.min_value), max_value: row.max_value == null ? null : Number(row.max_value) });
}

/** Deactivate or reactivate a rule (System Policy included, unless locked). Always with a reason. */
export async function setRuleActive(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, active: boolean, body: unknown, now = new Date()) {
  requireManage(ctx);
  const b = isObject(body) ? body : {};
  refuseUnknown(b, ['reason']);
  const reason = str(b.reason);
  if (!reason) throw new ValidationError(`A reason is required to ${active ? 'reactivate' : 'deactivate'} a rule`);
  return withTransaction(pool, async (db) => {
    const existing = (await db.query('SELECT * FROM delegated_authorities WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!existing) throw notFound(`Authority rule ${id}`);
    if (existing.active === active) throw new ValidationError(`Rule ${existing.code} is already ${active ? 'active' : 'inactive'}`);
    if (existing.locked) {
      throw new ForbiddenError(`${existing.code} is a locked System Policy and cannot be deactivated or reactivated. Project sensitivity is changed on the project itself.`);
    }
    // Reactivating never extends an authority past its end date.
    if (active && existing.end_at && new Date(existing.end_at).getTime() <= now.getTime()) {
      throw new ValidationError(`${existing.code} ended on ${day(existing.end_at)}; create a new rule instead of reactivating it`);
    }
    // A reactivated Owner rule must still be valid today (the target may have been deactivated, etc.).
    if (active && existing.kind === 'owner') {
      await validateOwnerRule(db, { ...existing, min_value: existing.min_value == null ? null : Number(existing.min_value), max_value: existing.max_value == null ? null : Number(existing.max_value) }, now, { creating: false });
    }
    await db.query(
      active
        ? 'UPDATE delegated_authorities SET active = true, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL, updated_by = $2, updated_at = now() WHERE id = $1'
        : 'UPDATE delegated_authorities SET active = false, deactivated_at = now(), deactivated_by = $2, deactivation_reason = $3, updated_by = $2, updated_at = now() WHERE id = $1',
      active ? [id, ctx.user.id] : [id, ctx.user.id, reason]
    );
    await writeAudit(db, actor, {
      action: active ? 'authority.rule.reactivate' : 'authority.rule.deactivate',
      entityType: 'delegated_authority',
      entityId: id,
      projectId: existing.project_id,
      before: { active: existing.active },
      after: { active, kind: existing.kind, code: existing.code },
      details: reason,
    });
    return getRule(db, id);
  });
}

/** The rule's audit trail (creation, every change, deactivation and reactivation). */
export async function ruleHistory(db: Db, id: string) {
  await getRule(db, id);
  return (
    await db.query(
      `SELECT id::int AS id, occurred_at, actor_id, actor_name, actor_role, action, before, after, details FROM audit_logs
       WHERE entity_type = 'delegated_authority' AND entity_id = $1 ORDER BY id`,
      [id]
    )
  ).rows;
}

/** Project sensitivity: only the Owner, always with a reason, audited. */
export async function setProjectSensitivity(pool: Pool, ctx: AccessContext, actor: AuditActor, projectId: string, body: unknown) {
  requireManage(ctx);
  const b = isObject(body) ? body : {};
  refuseUnknown(b, ['sensitivity', 'reason']);
  if (!SENSITIVITY.includes(b.sensitivity)) throw new ValidationError(`sensitivity must be one of ${SENSITIVITY.join(', ')}`);
  const reason = str(b.reason);
  if (!reason) throw new ValidationError('A reason is required to change project sensitivity');
  if (!ctx.canSeeProject(projectId)) throw notFound(`Project ${projectId}`);
  return withTransaction(pool, async (db) => {
    const p = (await db.query('SELECT id, project_name, sensitivity FROM projects WHERE id = $1 FOR UPDATE', [projectId])).rows[0];
    if (!p) throw notFound(`Project ${projectId}`);
    if (p.sensitivity === b.sensitivity) return { project_id: p.id, project_name: p.project_name, sensitivity: p.sensitivity, changed: false, rules_above_ceiling: [] };
    await db.query('UPDATE projects SET sensitivity = $2, updated_at = now() WHERE id = $1', [projectId, b.sensitivity]);
    // Allow rules on this project that the new ceiling overrides. They stay stored (and are
    // ignored by the ceiling gate); lowering the sensitivity again brings them back into force.
    const scoped = (await db.query(`SELECT code, decision_type FROM delegated_authorities WHERE project_id = $1 AND effect = 'allow' AND active ORDER BY code`, [projectId])).rows;
    const capped: string[] = [];
    for (const r of scoped) if (await ruleExceedsCeiling(db, r.decision_type, projectId)) capped.push(r.code);
    await writeAudit(db, actor, {
      action: 'project.sensitivity.change',
      entityType: 'projects',
      entityId: projectId,
      projectId,
      before: { sensitivity: p.sensitivity },
      after: { sensitivity: b.sensitivity, rules_above_ceiling: capped },
      details: reason,
    });
    return { project_id: p.id, project_name: p.project_name, sensitivity: b.sensitivity, changed: true, rules_above_ceiling: capped };
  });
}
