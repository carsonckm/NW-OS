/**
 * Delegation coverage, temporary authority and Owner absence (Phase 6 Batch 6,
 * docs/phase6-coverage-temporary-authority.md).
 *
 *   Coverage       an operational measurement (not permission): for each decision type, scope and
 *                  value band, is there an eligible non-Owner approver right now?
 *   Temporary      an Owner rule with authority_type = 'temporary': same table, same resolver,
 *                  same validation (validateOwnerRule) and ceilings; it always ends.
 *   Absence        the Owner's absence configuration; it creates one temporary rule per chosen
 *                  decision type for the backup (authority_type = 'absence'). The backup never
 *                  becomes an Owner.
 *   Effectiveness  what actually happened to decisions a delegation covers (operational data,
 *                  not people scoring).
 *
 * Nothing here approves anything. Every rule goes through validateOwnerRule and insertOwnerRule
 * (audit, re-routing); the resolver decides every approval.
 */
import { createHash } from 'crypto';
import { AccessContext, ForbiddenError } from '../auth/access';
import { permissionsFor } from '../auth/permissions';
import type { AuthUser } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import type { PermissionKey } from '../../src/types';
import type { PlannedAction, RuleDef } from '../automation/types';
import { insertNotifications } from '../automation/notify';
import { insertOwnerRule, validateOwnerRule } from './authority';
import { previewRule } from './authoritySettings';
import { reevaluateRoutes } from './approvalRouting';
import { decisionLedger, ownerReason, type Decision } from './delegationIntelligence';
import { computeProjectRisk } from './risk';

type Db = Pool | PoolClient;
type Row = Record<string, any>;
const OWNER = 'Owner / CEO';
const DAY = 86400_000;
const HOUR = 3600_000;
const EXTERNAL = new Set(['Client', 'Contractor', OWNER]);
const RISK_RANK: Record<string, number> = { 'On Track': 0, Attention: 1, 'At Risk': 2, Critical: 3 };
/** Conditions that are part of how a decision type normally works (the coverage is still full). */
const ROUTINE_CONDITIONS = new Set(['no_self_approval', 'match_status', 'match_status_not', 'direct_only']);
/** Temporary and absence authority outrank permanent Owner rules (default 100–200), never System sensitivity rows (900+). */
export const TEMPORARY_PRIORITY = 300;
export const MAX_TEMPORARY_DAYS = 90;
export const MAX_ABSENCE_DAYS = 60;
export const ABSENCE_TYPES = ['drawing', 'variation', 'purchase', 'invoice'];
export const EXPIRING_DAYS = 7;

const notFound = (what: string) => {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
};
export function requireOwnerManage(ctx: AccessContext, what: string) {
  if (ctx.user.role !== OWNER || !ctx.can('authority.manage')) throw new ForbiddenError(`Only the Owner may manage ${what}`);
}
function needView(ctx: AccessContext) {
  if (!ctx.can('authority.view')) throw new ForbiddenError('Missing permission: authority.view');
}
const inForce = (r: Row, now: Date) => r.active && (!r.start_at || new Date(r.start_at).getTime() <= now.getTime()) && (!r.end_at || new Date(r.end_at).getTime() > now.getTime());
const num = (v: unknown) => (v == null ? null : Number(v));
const money = (v: number | null) => (v == null ? 'any amount' : `RM ${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : '—');
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

// ------------------------------------------------------------------ coverage
export type CoverageStatus = 'Covered' | 'Owner Only' | 'Partially Covered' | 'Uncovered' | 'Expiring Soon' | 'Blocked by Sensitivity' | 'Blocked by Permission' | 'No Active Approver';
/** Statuses where approvals that could be delegated have nobody else. */
export const GAP_STATUSES: CoverageStatus[] = ['Uncovered', 'No Active Approver', 'Blocked by Permission'];

export interface CoverageCell {
  key: string;
  decision_type: string;
  label: string;
  scope: 'Normal' | 'Sensitive' | 'Strategic';
  value_from: number | null;
  value_to: number | null;
  value_label: string;
  status: CoverageStatus;
  approvers: { role: string; users: number }[];
  rules: string[];
  reasons: string[];
  expires_at: string | null;
  pending_with_owner: number;
}

/** Users a rule targets who hold the decision type's baseline permission (active internal staff only). */
function eligibleUsers(rule: Row, users: AuthUser[], baseline: string) {
  return users.filter((u) => {
    if (rule.target_user_id && rule.target_user_id !== u.id) return false;
    if (rule.target_role && rule.target_role !== u.role) return false;
    if (rule.target_permission && !permissionsFor(u.role).has(rule.target_permission as PermissionKey)) return false;
    return permissionsFor(u.role).has(baseline as PermissionKey);
  });
}
const valueIn = (v: number | null, r: Row) => (r.min_value == null || (v !== null && v >= Number(r.min_value))) && (r.max_value == null || (v !== null && v <= Number(r.max_value)));
const conditionKeys = (r: Row) => Object.keys(r.conditions ?? {});
const isSensitivityRow = (r: Row) => Array.isArray(r.conditions?.sensitivity);

/**
 * The coverage matrix, from the rules in force now. Per decision type: value bands from the
 * rules' own limits; for each band, the allow rules that apply and outrank every unconditional
 * Owner requirement, and whether they have active users holding the baseline permission.
 */
export async function computeCoverage(db: Db, now = new Date()) {
  const types = (await db.query('SELECT key, label, baseline_permission, has_value, sensitive_protected FROM authority_decision_types WHERE active ORDER BY key')).rows;
  const rules = (await db.query('SELECT * FROM delegated_authorities')).rows;
  const users = (await db.query(`SELECT * FROM users WHERE is_active AND NOT (role = ANY($1)) ORDER BY id`, [[...EXTERNAL]])).rows as AuthUser[];
  const pending = (
    await db.query(`SELECT ar.decision_type, ar.value, coalesce(p.sensitivity, 'Normal') AS sensitivity FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id LEFT JOIN projects p ON p.id = ar.project_id
       WHERE ar.status = 'open' AND u.role = $1 AND ar.routing_basis <> 'CLIENT_CONSENT'`, [OWNER])
  ).rows;
  const projects = new Map((await db.query('SELECT id, project_name FROM projects')).rows.map((p) => [p.id as string, p.project_name as string]));
  const cells: CoverageCell[] = [];
  for (const t of types) {
    const allows = rules.filter((r) => r.decision_type === t.key && r.effect === 'allow' && inForce(r, now));
    const owners = rules.filter((r) => r.decision_type === t.key && r.effect === 'require_owner' && inForce(r, now) && !isSensitivityRow(r));
    // Value bands from every limit in force.
    let bands: [number | null, number | null][] = [[null, null]];
    if (t.has_value) {
      const points = [...new Set([...allows, ...owners].flatMap((r) => [num(r.min_value), num(r.max_value)]).filter((x): x is number => x !== null && x > 0))].sort((a, b) => a - b);
      bands = [];
      let lo = 0;
      for (const p of points) {
        bands.push([lo, p]);
        lo = p;
      }
      bands.push([lo, null]);
    }
    const raw: CoverageCell[] = [];
    for (const [lo, hi] of bands) {
      const probe = hi === null ? (lo ?? 0) + 1 : lo === null ? 0 : (lo + hi) / 2;
      const v = t.has_value ? probe : null;
      const req = owners.filter((r) => valueIn(v, r) && conditionKeys(r).length === 0);
      const reqTop = Math.max(-Infinity, ...req.map((r) => r.priority));
      const covering = allows.filter((r) => (t.has_value ? valueIn(v, r) : true) && r.priority > reqTop);
      const reasons: string[] = [];
      let status: CoverageStatus;
      let approvers: { role: string; users: number }[] = [];
      let expires: string | null = null;
      if (!covering.length) {
        status = req.length ? 'Owner Only' : 'Uncovered';
        reasons.push(req.length ? `${req.map((r) => r.code).join(', ')} reserves it for the Owner` : 'No authority rule lets anyone but the Owner decide it');
      } else {
        const staffed = covering.map((r) => ({ r, people: eligibleUsers(r, users, t.baseline_permission) })).filter((x) => x.people.length);
        if (!staffed.length) {
          const lacking = covering.some((r) => (r.target_role && !permissionsFor(r.target_role).has(t.baseline_permission)) || (r.target_user_id && users.some((u) => u.id === r.target_user_id && !permissionsFor(u.role).has(t.baseline_permission))));
          status = lacking ? 'Blocked by Permission' : 'No Active Approver';
          reasons.push(lacking ? `The people ${covering.map((r) => r.code).join(', ')} name do not hold ${t.baseline_permission}` : `${covering.map((r) => r.code).join(', ')}: no active user they cover holds ${t.baseline_permission}`);
        } else {
          const full = staffed.filter(({ r }) => !r.project_id && !r.client_id && (!r.max_risk || r.max_risk === 'Critical') && conditionKeys(r).every((k) => ROUTINE_CONDITIONS.has(k)));
          for (const { r } of staffed.filter((x) => !full.includes(x))) {
            if (r.project_id) reasons.push(`${r.code} only covers ${projects.get(r.project_id) ?? r.project_id}`);
            else if (r.client_id) reasons.push(`${r.code} only covers one client's projects`);
            if (r.max_risk && r.max_risk !== 'Critical') reasons.push(`${r.code} does not cover projects above ${r.max_risk} risk`);
            const odd = conditionKeys(r).filter((k) => !ROUTINE_CONDITIONS.has(k));
            if (odd.length) reasons.push(`${r.code} only applies when ${odd.join(', ').replace(/_/g, ' ')}`);
          }
          const counted = new Map<string, Set<string>>();
          for (const x of staffed) for (const u of x.people) counted.set(u.role, (counted.get(u.role) ?? new Set()).add(u.id));
          approvers = [...counted.entries()].map(([role, ids]) => ({ role, users: ids.size }));
          if (full.length) {
            const ends = full.map(({ r }) => (r.end_at ? new Date(r.end_at).getTime() : Infinity));
            const last = Math.max(...ends);
            if (last !== Infinity && last - now.getTime() <= EXPIRING_DAYS * DAY) {
              status = 'Expiring Soon';
              expires = new Date(last).toISOString();
              reasons.push(`All covering authority ends by ${day(expires)}`);
            } else status = 'Covered';
          } else status = 'Partially Covered';
        }
      }
      raw.push({
        key: `${t.key}|Normal|${lo ?? ''}-${hi ?? ''}`,
        decision_type: t.key,
        label: t.label,
        scope: 'Normal',
        value_from: t.has_value ? lo : null,
        value_to: t.has_value ? hi : null,
        value_label: '',
        status,
        approvers,
        rules: covering.length ? covering.map((r) => r.code) : req.map((r) => r.code),
        reasons,
        expires_at: expires,
        pending_with_owner: 0,
      });
    }
    // Adjacent bands with the same answer are one row.
    const merged: CoverageCell[] = [];
    for (const c of raw) {
      const prev = merged[merged.length - 1];
      if (prev && prev.status === c.status && JSON.stringify(prev.rules) === JSON.stringify(c.rules) && JSON.stringify(prev.approvers) === JSON.stringify(c.approvers)) prev.value_to = c.value_to;
      else merged.push({ ...c });
    }
    for (const c of merged) {
      c.key = `${t.key}|Normal|${c.value_from ?? ''}-${c.value_to ?? ''}`;
      c.value_label = !t.has_value ? '—' : c.value_to === null ? (c.value_from ? `above ${money(c.value_from)}` : 'any amount') : `${c.value_from ? `above ${money(c.value_from)} ` : ''}up to ${money(c.value_to)}`;
      c.pending_with_owner = pending.filter((p) => p.decision_type === t.key && p.sensitivity === 'Normal' && (!t.has_value || p.value == null || ((c.value_from == null || Number(p.value) > c.value_from) && (c.value_to == null || Number(p.value) <= c.value_to)))).length;
      cells.push(c);
    }
    for (const scope of ['Sensitive', 'Strategic'] as const) {
      const blocked = scope === 'Strategic' || t.sensitive_protected;
      cells.push({
        key: `${t.key}|${scope}`,
        decision_type: t.key,
        label: t.label,
        scope,
        value_from: null,
        value_to: null,
        value_label: '—',
        status: blocked ? 'Blocked by Sensitivity' : 'Covered',
        approvers: [],
        rules: [],
        reasons: [blocked ? `On ${scope} projects only the Owner decides ${t.label.toLowerCase()} (sensitivity ceiling)` : 'Not protected by the Sensitive ceiling: same as Normal projects'],
        expires_at: null,
        pending_with_owner: pending.filter((p) => p.decision_type === t.key && p.sensitivity === scope).length,
      });
    }
  }
  const count = (s: CoverageStatus) => cells.filter((c) => c.status === s).length;
  const delegable = cells.filter((c) => c.status !== 'Owner Only' && c.status !== 'Blocked by Sensitivity');
  const covered = delegable.filter((c) => c.status === 'Covered' || c.status === 'Expiring Soon').length;
  const health = {
    overall_percent: delegable.length ? Math.round((covered / delegable.length) * 1000) / 10 : null,
    covered: count('Covered'),
    expiring: count('Expiring Soon'),
    partial: count('Partially Covered'),
    uncovered: count('Uncovered'),
    no_active_approver: count('No Active Approver'),
    blocked_by_permission: count('Blocked by Permission'),
    owner_only: count('Owner Only'),
    blocked_by_sensitivity: count('Blocked by Sensitivity'),
    cells: cells.length,
    delegable_cells: delegable.length,
    definition:
      'Overall = coverage cells with a full, current non-Owner approver (Covered or Expiring Soon) ÷ cells that may be delegated at all. Cells the Owner keeps by policy (Owner Only) or by the sensitivity ceiling are not in the denominator, and are counted separately. A cell is one decision type × project sensitivity × value band from the rules in force.',
  };
  return { cells, health, computed_at: now.toISOString() };
}

/** What the Owner should look at: coverage gaps, with what they affect and what to do. */
export async function coverageGaps(db: Db, now = new Date(), coverage?: Awaited<ReturnType<typeof computeCoverage>>) {
  const cov = coverage ?? (await computeCoverage(db, now));
  const gaps: Row[] = [];
  const action: Record<string, string> = {
    Uncovered: 'Create a delegation for this decision type and value (or accept a delegation recommendation), or keep it with the Owner on purpose.',
    'No Active Approver': 'The rule names nobody active: re-target it, or reactivate / assign a user.',
    'Blocked by Permission': 'The named people lack the baseline permission: target a role that holds it.',
    'Expiring Soon': 'Extend the authority, or let it end on purpose (approvals then return to the Owner).',
    'Partially Covered': 'Decide whether the narrower scope is intended; widen it if routine work falls outside.',
  };
  for (const c of cov.cells) {
    if (!(c.status in action)) continue;
    gaps.push({ key: c.key, decision_type: c.decision_type, label: c.label, scope: `${c.scope} projects, ${c.value_label}`, status: c.status, reason: c.reasons.join('; '), pending_affected: c.pending_with_owner, recommended_action: action[c.status] });
  }
  const order: Record<string, number> = { Uncovered: 0, 'No Active Approver': 0, 'Blocked by Permission': 0, 'Expiring Soon': 1, 'Partially Covered': 2 };
  return gaps.sort((a, b) => order[a.status] - order[b.status] || b.pending_affected - a.pending_affected || a.key.localeCompare(b.key));
}

/** Overlapping Owner allow rules for the same people: not an error (priority decides) but worth knowing. */
export async function authorityConflicts(db: Db, now = new Date()) {
  const rules = (await db.query(`SELECT * FROM delegated_authorities WHERE kind = 'owner' AND effect = 'allow'`)).rows.filter((r) => inForce(r, now));
  const users = (await db.query('SELECT id, role FROM users')).rows;
  const roleOf = (r: Row) => r.target_role ?? users.find((u) => u.id === r.target_user_id)?.role;
  const out: Row[] = [];
  for (let i = 0; i < rules.length; i++)
    for (let j = i + 1; j < rules.length; j++) {
      const [a, b] = [rules[i], rules[j]];
      if (a.decision_type !== b.decision_type || roleOf(a) !== roleOf(b)) continue;
      if (a.target_user_id && b.target_user_id && a.target_user_id !== b.target_user_id) continue;
      if (a.project_id && b.project_id && a.project_id !== b.project_id) continue;
      if (a.client_id && b.client_id && a.client_id !== b.client_id) continue;
      const lo = Math.max(num(a.min_value) ?? 0, num(b.min_value) ?? 0);
      const hi = Math.min(num(a.max_value) ?? Infinity, num(b.max_value) ?? Infinity);
      if (lo > hi) continue;
      const [win, lose] = a.priority > b.priority || (a.priority === b.priority && a.code < b.code) ? [a, b] : [b, a];
      out.push({ rules: [a.code, b.code], decision_type: a.decision_type, target: roleOf(a), message: `Overlapping authority rules ${a.code} and ${b.code}. The highest priority rule applies where both cover a decision: ${win.code} (priority ${win.priority}) over ${lose.code} (priority ${lose.priority}); on equal priority the code decides.`, selected: win.code });
    }
  return out;
}

// ------------------------------------------------------------------ temporary authority
const TEMP_FIELDS = ['decision_type', 'target_user_id', 'target_role', 'project_id', 'client_id', 'min_value', 'max_value', 'max_risk', 'start_at', 'end_at', 'reason', 'confirmation'];
function refuse(body: Row, allowed: string[]) {
  const extra = Object.keys(body).filter((k) => !allowed.includes(k));
  if (extra.length) throw new ValidationError(`These fields are set by the server or not allowed: ${extra.join(', ')}`);
}
const asObject = (b: unknown): Row => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Row) : {});

/**
 * Temporary authority never goes beyond the permanent policy envelope: it needs a finite value
 * limit for decisions with an amount, and it may not overlap an unconditional System Policy that
 * reserves part of the range for the Owner (e.g. purchases of RM 20,000 or more).
 */
async function envelopeCheck(db: Db, r: Row, now: Date) {
  const type = (await db.query('SELECT label, has_value FROM authority_decision_types WHERE key = $1', [r.decision_type])).rows[0];
  if (type.has_value && r.max_value == null) throw new ValidationError(`Temporary authority for ${type.label.toLowerCase()} needs a value limit`);
  const reserved = (await db.query(`SELECT * FROM delegated_authorities WHERE kind = 'system' AND effect = 'require_owner' AND decision_type = $1`, [r.decision_type])).rows.filter(
    (x) => inForce(x, now) && Object.keys(x.conditions ?? {}).length === 0
  );
  for (const x of reserved) {
    const lo = Math.max(num(x.min_value) ?? 0, r.min_value ?? 0);
    const hi = Math.min(num(x.max_value) ?? Infinity, r.max_value ?? Infinity);
    if (lo <= hi) throw new ValidationError(`Exceeds permanent authority: ${x.code} reserves ${type.label.toLowerCase()} ${x.min_value != null ? `of ${money(num(x.min_value))} or more ` : ''}for the Owner. Lower the limit${x.min_value != null ? ` below ${money(num(x.min_value))}` : ''}.`);
  }
}

/** Validates a temporary rule exactly like a permanent one, plus the temporary limits. */
export async function buildTemporaryRule(db: Db, input: Row, now: Date, opts: { label?: string; absence?: boolean } = {}) {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');
  if (!input.end_at) throw new ValidationError('Temporary authority needs an end date and time');
  const start = input.start_at ? new Date(String(input.start_at)) : now;
  const end = new Date(String(input.end_at));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) throw new ValidationError('start_at and end_at must be dates and times');
  if (start.getTime() < now.getTime() - 60_000) throw new ValidationError('start_at cannot be in the past');
  if (end.getTime() <= start.getTime()) throw new ValidationError('end_at must be after start_at');
  const maxDays = opts.absence ? MAX_ABSENCE_DAYS : MAX_TEMPORARY_DAYS;
  if (end.getTime() - start.getTime() > maxDays * DAY) throw new ValidationError(`Temporary authority can last at most ${maxDays} days`);
  const type = (await db.query('SELECT label FROM authority_decision_types WHERE key = $1', [input.decision_type])).rows[0];
  const target = input.target_user_id ? ((await db.query('SELECT name FROM users WHERE id = $1', [input.target_user_id])).rows[0]?.name ?? input.target_user_id) : input.target_role;
  const rule = {
    name: `${opts.label ?? 'Temporary'}: ${type?.label ?? input.decision_type} — ${target ?? '?'}`.slice(0, 120),
    description: reason,
    effect: 'allow',
    decision_type: input.decision_type,
    target_role: input.target_role || null,
    target_user_id: input.target_user_id || null,
    project_id: input.project_id || null,
    client_id: input.client_id || null,
    min_value: input.min_value ?? null,
    max_value: input.max_value ?? null,
    max_risk: input.max_risk || null,
    conditions: {},
    start_at: start.toISOString(),
    end_at: end.toISOString(),
    priority: TEMPORARY_PRIORITY,
  };
  // The same validation as every Owner rule: target, baseline permission, inactive users,
  // Client / Contractor, the sensitivity ceiling on a project, value and risk.
  const r = await validateOwnerRule(db, rule, now, { creating: true });
  if (r.target_user_id) {
    const u = (await db.query('SELECT role FROM users WHERE id = $1', [r.target_user_id])).rows[0];
    if (u?.role === OWNER) throw new ValidationError('Temporary authority is for staff other than the Owner');
  }
  if (r.target_role === OWNER) throw new ValidationError('Temporary authority is for staff other than the Owner');
  await envelopeCheck(db, r, now);
  return { rule, r };
}

export async function previewTemporary(pool: Pool, ctx: AccessContext, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'temporary authority');
  const b = asObject(body);
  refuse(b, TEMP_FIELDS);
  const { rule, r } = await buildTemporaryRule(pool, b, now);
  const preview = await previewRule(pool, ctx, rule, undefined, now);
  const conflicts = (await authorityConflicts(pool, now)).filter((c) => c.decision_type === r.decision_type);
  return { rule: r, preview, overlapping: preview.warnings.filter((w: Row) => w.code === 'OVERLAPS'), conflicts, confirmation: hash({ kind: 'temporary', r }) };
}

export async function createTemporary(pool: Pool, ctx: AccessContext, actor: AuditActor, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'temporary authority');
  const b = asObject(body);
  refuse(b, TEMP_FIELDS);
  const { r } = await buildTemporaryRule(pool, b, now);
  if (b.confirmation !== hash({ kind: 'temporary', r })) throw new ValidationError('Preview this temporary authority first, then confirm it (the confirmation does not match)');
  return withTransaction(pool, async (db) => {
    const stored = await insertOwnerRule(db, ctx, actor, r, true, { authorityType: 'temporary' });
    await writeAudit(db, actor, { action: 'authority.temporary.create', entityType: 'delegated_authority', entityId: stored.id, projectId: r.project_id, after: { code: stored.code, start_at: r.start_at, end_at: r.end_at }, details: r.description });
    return stored;
  });
}

async function loadTemporary(db: Db, id: string) {
  const r = (await db.query('SELECT * FROM delegated_authorities WHERE id = $1', [id])).rows[0];
  if (!r || r.authority_type !== 'temporary') throw notFound(`Temporary authority ${id}`);
  return r;
}

/** The extension is a new rule (validated like any other) that replaces the current one; previewed first. */
async function buildExtension(db: Db, id: string, body: Row, now: Date) {
  refuse(body, ['end_at', 'reason', 'confirmation']);
  const old = await loadTemporary(db, id);
  if (!old.active || !inForce({ ...old, start_at: null }, now)) throw new ValidationError(`${old.code} has ended; create new temporary authority instead`);
  const newEnd = new Date(String(body.end_at ?? ''));
  if (Number.isNaN(newEnd.getTime()) || newEnd.getTime() <= new Date(old.end_at).getTime()) throw new ValidationError(`The new end must be after the current end (${new Date(old.end_at).toISOString()})`);
  const start = new Date(Math.max(now.getTime(), new Date(old.start_at).getTime()));
  const { rule, r } = await buildTemporaryRule(
    db,
    { decision_type: old.decision_type, target_user_id: old.target_user_id, target_role: old.target_role, project_id: old.project_id, client_id: old.client_id, min_value: num(old.min_value), max_value: num(old.max_value), max_risk: old.max_risk, start_at: start.toISOString(), end_at: newEnd.toISOString(), reason: body.reason },
    start
  );
  return { old, rule, r };
}

export async function previewExtension(pool: Pool, ctx: AccessContext, id: string, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'temporary authority');
  const { old, rule, r } = await buildExtension(pool, id, asObject(body), now);
  return { current: { code: old.code, end_at: old.end_at }, rule: r, preview: await previewRule(pool, ctx, rule, undefined, now), confirmation: hash({ kind: 'extend', id, r }) };
}

export async function extendTemporary(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'temporary authority');
  const b = asObject(body);
  const { old, r } = await buildExtension(pool, id, b, now);
  if (b.confirmation !== hash({ kind: 'extend', id, r })) throw new ValidationError('Preview the extension first, then confirm it (the confirmation does not match)');
  return withTransaction(pool, async (db) => {
    const locked = (await db.query('SELECT active FROM delegated_authorities WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!locked?.active) throw new ValidationError(`${old.code} was changed meanwhile`);
    await db.query(`UPDATE delegated_authorities SET active = false, deactivated_at = now(), deactivated_by = $2, deactivation_reason = $3, updated_at = now() WHERE id = $1`, [id, ctx.user.id, 'Replaced by its extension']);
    const stored = await insertOwnerRule(db, ctx, actor, r, true, { authorityType: 'temporary', extendedFrom: id });
    await writeAudit(db, actor, { action: 'authority.temporary.extend', entityType: 'delegated_authority', entityId: stored.id, projectId: r.project_id, before: { code: old.code, end_at: old.end_at }, after: { code: stored.code, end_at: r.end_at, extended_from: old.code }, details: r.description });
    return stored;
  });
}

export async function listTemporary(db: Db, ctx: AccessContext, now = new Date()) {
  needView(ctx);
  const rows = (
    await db.query(`SELECT a.*, u.name AS target_user_name, p.project_name, x.code AS extended_from_code FROM delegated_authorities a LEFT JOIN users u ON u.id = a.target_user_id
      LEFT JOIN projects p ON p.id = a.project_id LEFT JOIN delegated_authorities x ON x.id = a.extended_from
      WHERE a.authority_type IN ('temporary', 'absence') ORDER BY a.end_at DESC, a.code DESC LIMIT 200`)
  ).rows;
  const view = (r: Row) => {
    const left = new Date(r.end_at).getTime() - now.getTime();
    const state = inForce(r, now) ? 'active' : r.active && new Date(r.start_at) > now ? 'scheduled' : 'ended';
    return {
      id: r.id,
      code: r.code,
      authority_type: r.authority_type,
      absence_id: r.absence_id,
      decision_type: r.decision_type,
      target: r.target_user_id ? { type: 'user', id: r.target_user_id, name: r.target_user_name } : { type: 'role', role: r.target_role },
      project: r.project_id ? { id: r.project_id, name: r.project_name } : null,
      client_id: r.client_id,
      min_value: num(r.min_value),
      max_value: num(r.max_value),
      max_risk: r.max_risk,
      start_at: r.start_at,
      end_at: r.end_at,
      reason: r.description,
      state,
      ended_reason: state === 'ended' ? (r.deactivation_reason ?? (new Date(r.end_at) <= now ? 'Expired' : null)) : null,
      expires_in: state === 'active' ? (left <= DAY ? '1 day' : left <= 3 * DAY ? '3 days' : left <= 7 * DAY ? '7 days' : null) : null,
      extended_from: r.extended_from_code,
    };
  };
  const all = rows.map(view);
  return { active: all.filter((r) => r.state === 'active'), scheduled: all.filter((r) => r.state === 'scheduled'), expiring_soon: all.filter((r) => r.expires_in), ended: all.filter((r) => r.state === 'ended').slice(0, 30) };
}

// ------------------------------------------------------------------ Owner absence
const ABS_FIELDS = ['start_at', 'end_at', 'backup_user_id', 'decision_types', 'max_value', 'max_risk', 'project_id', 'client_id', 'reason', 'confirmation'];

async function buildAbsence(db: Db, ctx: AccessContext, body: Row, now: Date) {
  refuse(body, ABS_FIELDS);
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');
  const backup = (await db.query('SELECT * FROM users WHERE id = $1', [body.backup_user_id])).rows[0] as AuthUser | undefined;
  if (!backup) throw new ValidationError('backup_user_id must be an existing user');
  if (!backup.is_active) throw new ValidationError(`${backup.name} is deactivated`);
  if (backup.role === OWNER) throw new ValidationError('The backup is a staff member with limited, explicit authority, not another Owner');
  if (EXTERNAL.has(backup.role)) throw new ValidationError(`${backup.role} users cannot be a backup`);
  const types = Array.isArray(body.decision_types) ? [...new Set(body.decision_types as string[])] : [];
  if (!types.length || types.some((t) => !ABSENCE_TYPES.includes(t))) throw new ValidationError(`decision_types must be a non-empty list of ${ABSENCE_TYPES.join(', ')}`);
  const maxValue = body.max_value == null || body.max_value === '' ? null : Number(body.max_value);
  if (maxValue !== null && (!Number.isFinite(maxValue) || maxValue <= 0)) throw new ValidationError('max_value must be a positive amount');
  const maxRisk = body.max_risk || 'Attention';
  const open = (await db.query(`SELECT id FROM owner_absences WHERE status IN ('scheduled', 'active') AND start_at < $2 AND end_at > $1`, [body.start_at ?? now, body.end_at])).rows;
  if (open.length) throw new ValidationError(`Another absence (${open[0].id}) overlaps this period; end it first`);
  const rules: { type: string; rule: Row; r: Row }[] = [];
  for (const t of types) {
    const has = (await db.query('SELECT has_value FROM authority_decision_types WHERE key = $1', [t])).rows[0]?.has_value;
    if (has && maxValue === null) throw new ValidationError(`max_value is required for ${t}`);
    const built = await buildTemporaryRule(
      db,
      { decision_type: t, target_user_id: backup.id, project_id: body.project_id, client_id: body.client_id, max_value: has ? maxValue : null, max_risk: maxRisk, start_at: body.start_at, end_at: body.end_at, reason: `Owner absence: ${reason}` },
      now,
      { label: 'Absence backup', absence: true }
    );
    rules.push({ type: t, ...built });
  }
  return { backup, types, maxValue, maxRisk, reason, rules, start: rules[0].r.start_at as string, end: rules[0].r.end_at as string, project_id: body.project_id || null, client_id: body.client_id || null };
}

/** What the absence would cover and leave with the Owner (informational; the resolver decides each approval). */
export async function previewAbsence(pool: Pool, ctx: AccessContext, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'Owner absence');
  const a = await buildAbsence(pool, ctx, asObject(body), now);
  const labels = new Map((await pool.query('SELECT key, label, has_value FROM authority_decision_types')).rows.map((t) => [t.key as string, t]));
  const delegated = [];
  for (const x of a.rules) {
    const p = await previewRule(pool, ctx, x.rule, undefined, now);
    delegated.push({ decision_type: x.type, label: labels.get(x.type)?.label, max_value: x.r.max_value, max_risk: x.r.max_risk, summary: p.summary, warnings: p.warnings });
  }
  const projects = (await pool.query(`SELECT id, project_name, sensitivity FROM projects WHERE project_status NOT IN ('Completed', 'Closed', 'Cancelled')`)).rows;
  const notDelegated = [
    ...ABSENCE_TYPES.filter((t) => !a.types.includes(t)).map((t) => `${labels.get(t)?.label} (not chosen)`),
    'Other approval requests, safety decisions and AI proposals',
    `Strategic projects: ${projects.filter((p) => p.sensitivity === 'Strategic').map((p) => p.project_name).join(', ') || 'none'}`,
    `Sensitive projects: ${projects.filter((p) => p.sensitivity === 'Sensitive').map((p) => p.project_name).join(', ') || 'none'}`,
    ...(a.maxValue !== null ? [`Anything above ${money(a.maxValue)}`] : []),
    `Projects above ${a.maxRisk} risk`,
    'Anything a System Policy reserves for the Owner (e.g. major purchases of RM 20,000 or more)',
  ];
  // Pending approvals now with the Owner: which the backup could take (estimated), which stay.
  const open = (await pool.query(`SELECT ar.resource_kind, ar.resource_id, ar.decision_type, ar.value, ar.project_id, ar.client_id, coalesce(p.sensitivity, 'Normal') AS sensitivity, ar.data->>'title' AS title FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id LEFT JOIN projects p ON p.id = ar.project_id WHERE ar.status = 'open' AND u.role = $1 AND ar.routing_basis <> 'CLIENT_CONSENT'`, [OWNER])).rows;
  const risk = new Map<string, string>();
  let toBackup = 0;
  const stay: Row[] = [];
  for (const o of open) {
    let why: string | null = null;
    if (!a.types.includes(o.decision_type)) why = 'decision type not delegated';
    else if (o.sensitivity !== 'Normal') why = `${o.sensitivity} project`;
    else if (a.project_id && o.project_id !== a.project_id) why = 'outside the project scope';
    else if (a.client_id && o.client_id !== a.client_id) why = 'outside the client scope';
    else if (labels.get(o.decision_type)?.has_value && (o.value == null || Number(o.value) > (a.maxValue ?? Infinity))) why = 'above the value limit';
    else if (o.project_id) {
      if (!risk.has(o.project_id)) risk.set(o.project_id, (await computeProjectRisk(pool, o.project_id, now, true)).level);
      if (RISK_RANK[risk.get(o.project_id)!] > RISK_RANK[a.maxRisk]) why = `project risk ${risk.get(o.project_id)}`;
    }
    if (why) stay.push({ resource: `${o.resource_kind}:${o.resource_id}`, title: o.title, reason: why });
    else toBackup++;
  }
  const history = (await decisionLedger(pool, new Date(now.getTime() - 60 * DAY), now)).filter((d) => d.decided_by_role === OWNER);
  const routine = history.filter((d) => a.types.includes(d.decision_type) && (d.current_sensitivity ?? 'Normal') === 'Normal' && (!labels.get(d.decision_type)?.has_value || (d.value !== null && d.value <= (a.maxValue ?? Infinity))));
  return {
    period: { start_at: a.start, end_at: a.end },
    backup: { id: a.backup.id, name: a.backup.name, role: a.backup.role },
    delegated,
    not_delegated: notDelegated,
    impact: {
      estimated: true,
      routine_owner_decisions_last_60_days_covered: routine.length,
      decision_types_covered: a.types.length,
      pending_with_owner_now: open.length,
      pending_that_would_route_to_backup: toBackup,
      pending_that_stay_with_owner: stay.length,
      stays_with_owner: stay.slice(0, 20),
      note: 'Estimated from current pending approvals and the last 60 days. The authority resolver decides each approval when it is routed and decided.',
    },
    confirmation: hash({ kind: 'absence', a: { b: a.backup.id, t: a.types, v: a.maxValue, r: a.maxRisk, s: a.start, e: a.end, p: a.project_id, c: a.client_id, reason: a.reason } }),
  };
}

export async function activateAbsence(pool: Pool, ctx: AccessContext, actor: AuditActor, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'Owner absence');
  const b = asObject(body);
  const a = await buildAbsence(pool, ctx, b, now);
  const expected = hash({ kind: 'absence', a: { b: a.backup.id, t: a.types, v: a.maxValue, r: a.maxRisk, s: a.start, e: a.end, p: a.project_id, c: a.client_id, reason: a.reason } });
  if (b.confirmation !== expected) throw new ValidationError('Preview the absence first, then confirm it (the confirmation does not match)');
  return withTransaction(pool, async (db) => {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('owner_absences'))`);
    const clash = (await db.query(`SELECT id FROM owner_absences WHERE status IN ('scheduled', 'active') AND start_at < $2 AND end_at > $1`, [a.start, a.end])).rows[0];
    if (clash) throw new ValidationError(`Another absence (${clash.id}) overlaps this period`);
    const id = `abs-${(await db.query(`SELECT nextval('owner_absence_seq') AS n`)).rows[0].n}`;
    const started = new Date(a.start).getTime() <= now.getTime();
    await db.query(
      `INSERT INTO owner_absences (id, owner_id, backup_user_id, start_at, end_at, decision_types, max_value, max_risk, project_id, client_id, reason, status, activated_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $2)`,
      [id, ctx.user.id, a.backup.id, a.start, a.end, a.types, a.maxValue, a.maxRisk, a.project_id, a.client_id, a.reason, started ? 'active' : 'scheduled', started ? now : null]
    );
    const created = [];
    for (const x of a.rules) created.push(await insertOwnerRule(db, ctx, actor, x.r, true, { authorityType: 'absence', absenceId: id }));
    await writeAudit(db, actor, { action: 'owner_absence.activate', entityType: 'owner_absence', entityId: id, after: { backup: a.backup.id, start_at: a.start, end_at: a.end, decision_types: a.types, max_value: a.maxValue, max_risk: a.maxRisk, project_id: a.project_id, client_id: a.client_id, rules: created.map((c) => c.code), status: started ? 'active' : 'scheduled' }, details: a.reason });
    if (started) await notifyAbsence(db, id, 'started', a.backup.id, `${a.backup.name} is the backup until ${day(a.end)} for ${a.types.join(', ')}${a.maxValue !== null ? ` up to ${money(a.maxValue)}` : ''}.`);
    return { id, status: started ? 'active' : 'scheduled', rules: created.map((c) => ({ id: c.id, code: c.code, decision_type: c.decision_type })) };
  });
}

async function notifyAbsence(db: PoolClient, id: string, what: 'started' | 'ended', backupId: string, message: string) {
  const owners = (await db.query(`SELECT id FROM users WHERE role = $1 AND is_active`, [OWNER])).rows.map((u) => u.id as string);
  await insertNotifications(db, [...owners, backupId], { title: `Owner absence ${what}`, message, type: 'information', priority: 'normal', project_id: null, link_tab: 'authority', entity_type: 'owner_absence', entity_id: id }, `delegation_watch:absence:${id}:${what}`, 'delegation_watch');
}

/** Ends (or cancels) an absence: its rules are switched off, approvals re-routed, audited. */
export async function endAbsence(pool: Pool, ctx: AccessContext, actor: AuditActor, id: string, body: unknown, now = new Date()) {
  requireOwnerManage(ctx, 'Owner absence');
  const b = asObject(body);
  refuse(b, ['reason']);
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  if (!reason) throw new ValidationError('A reason is required');
  return withTransaction(pool, (db) => closeAbsence(db, actor, id, now, { by: ctx.user.id, reason }));
}

async function closeAbsence(db: PoolClient, actor: AuditActor, id: string, now: Date, opts: { by: string | null; reason: string }) {
  const a = (await db.query('SELECT * FROM owner_absences WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!a) throw notFound(`Absence ${id}`);
  if (!['scheduled', 'active'].includes(a.status)) throw new ValidationError(`Absence ${id} is already ${a.status}`);
  const status = a.status === 'scheduled' && new Date(a.start_at) > now ? 'cancelled' : 'ended';
  const rules = (await db.query(`SELECT * FROM delegated_authorities WHERE absence_id = $1 AND active`, [id])).rows;
  for (const r of rules) {
    await db.query(`UPDATE delegated_authorities SET active = false, deactivated_at = $2, deactivated_by = $3, deactivation_reason = $4, expiry_processed_at = coalesce(expiry_processed_at, $2), updated_at = now() WHERE id = $1`, [r.id, now, opts.by, `Absence ${id} ${status}: ${opts.reason}`]);
    await writeAudit(db, actor, { action: 'authority.rule.deactivate', entityType: 'delegated_authority', entityId: r.id, projectId: r.project_id, before: { active: true }, after: { active: false, code: r.code, authority_type: 'absence' }, details: `Absence ${id} ${status}` });
  }
  await db.query(`UPDATE owner_absences SET status = $2, ended_at = $3, ended_by = $4, end_reason = $5 WHERE id = $1`, [id, status, now, opts.by, opts.reason]);
  await writeAudit(db, actor, { action: `owner_absence.${status === 'cancelled' ? 'cancel' : 'end'}`, entityType: 'owner_absence', entityId: id, before: { status: a.status }, after: { status, rules_ended: rules.map((r) => r.code) }, details: opts.reason });
  const routing_changes = await reevaluateRoutes(db, actor, {}, `absence ${id} ${status}`);
  if (status === 'ended') await notifyAbsence(db, id, 'ended', a.backup_user_id, `Approvals the backup held are routed again (${routing_changes.rerouted} re-routed).`);
  return { id, status, rules_ended: rules.map((r) => r.code), routing_changes };
}

export async function listAbsences(db: Db, ctx: AccessContext) {
  needView(ctx);
  const rows = (await db.query(`SELECT a.*, u.name AS backup_name, u.is_active AS backup_active FROM owner_absences a JOIN users u ON u.id = a.backup_user_id ORDER BY a.start_at DESC LIMIT 50`)).rows;
  const rules = (await db.query(`SELECT absence_id, code, decision_type, active FROM delegated_authorities WHERE absence_id IS NOT NULL`)).rows;
  return rows.map((a) => ({ ...a, max_value: num(a.max_value), rules: rules.filter((r) => r.absence_id === a.id) }));
}

// ------------------------------------------------------------------ delegation effectiveness
/** What happened to the decisions each Owner delegation covers (while it was in force). */
export async function delegationEffectiveness(db: Db, now = new Date(), days = 90) {
  const from = new Date(now.getTime() - days * DAY);
  const ledger = await decisionLedger(db, from, now);
  const rules = (await db.query(`SELECT a.*, u.name AS target_user_name FROM delegated_authorities a LEFT JOIN users u ON u.id = a.target_user_id WHERE a.kind = 'owner' AND a.effect = 'allow' AND (a.end_at IS NULL OR a.end_at > $1) ORDER BY a.code`, [from])).rows;
  const out = [];
  for (const r of rules) {
    const start = r.start_at ? new Date(r.start_at) : new Date(r.created_at);
    const end = r.end_at ? new Date(r.end_at) : now;
    const types = Array.isArray(r.conditions?.approval_types) ? r.conditions.approval_types : null;
    const scope = ledger.filter(
      (d) =>
        d.decision_type === r.decision_type &&
        (!r.project_id || d.project_id === r.project_id) &&
        (!r.client_id || d.client_id === r.client_id) &&
        valueIn(d.value, r) &&
        (!types || (d.approval_type && types.includes(d.approval_type))) &&
        d.requested_at < end &&
        d.completed_at >= start
    );
    const delegated = scope.filter((d) => d.decided_by_role && d.decided_by_role !== OWNER);
    const fallback = scope.filter((d) => d.decided_by_role === OWNER);
    const reasons = new Map<string, number>();
    for (const d of fallback) {
      const label = fallbackCategory(d);
      reasons.set(label, (reasons.get(label) ?? 0) + 1);
    }
    const hrs = delegated.map((d) => (d.completed_at.getTime() - d.requested_at.getTime()) / HOUR);
    const rate = scope.length ? Math.round((fallback.length / scope.length) * 1000) / 10 : null;
    const ineffective = scope.length >= 5 && rate !== null && rate >= 30;
    out.push({
      rule_id: r.id,
      code: r.code,
      name: r.name,
      authority_type: r.authority_type,
      decision_type: r.decision_type,
      target: r.target_user_name ?? r.target_role,
      in_force: inForce(r, now),
      approvals: scope.length,
      delegated: delegated.length,
      owner_fallback: fallback.length,
      escalated: scope.filter((d) => d.escalated).length,
      rerouted: scope.filter((d) => d.rerouted).length,
      rejected: scope.filter((d) => d.result !== 'approved').length,
      expired_fallback: fallback.filter((d) => d.owner_reason_code === 'AUTHORITY_EXPIRED').length,
      percent_delegated: scope.length ? Math.round((delegated.length / scope.length) * 1000) / 10 : null,
      owner_fallback_rate: rate,
      average_hours: hrs.length ? Math.round((hrs.reduce((s, h) => s + h, 0) / hrs.length) * 10) / 10 : null,
      fallback_reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      finding: ineffective ? `This delegation covers only part of the observed workload: ${fallback.length} of ${scope.length} decisions in its scope still returned to the Owner (${[...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}).` : null,
    });
  }
  return { window_days: days, delegations: out, note: 'Operational data about how decisions flowed, not a measure of any person.' };
}

/** The reason categories a fallback to the Owner is grouped by. */
export function fallbackCategory(d: Decision) {
  if (d.escalated) return 'escalation';
  switch (ownerReason(d).code) {
    case 'VALUE_EXCEEDS_DELEGATION':
      return 'value limit';
    case 'RISK_EXCEEDS_DELEGATION':
      return 'risk limit';
    case 'STRATEGIC_PROJECT':
    case 'SENSITIVE_PROJECT':
      return 'project sensitivity';
    case 'AUTHORITY_EXPIRED':
      return 'authority expired';
    case 'NO_ELIGIBLE_DELEGATE':
      return 'no eligible user';
    case 'SELF_APPROVAL_RESTRICTION':
      return 'self-approval';
    case 'POLICY_REQUIRES_OWNER':
      return 'Owner policy';
    case 'SAFETY':
      return 'safety';
    case 'OWNER_PREFERENCE':
    case 'OWNER_DECIDED_DELEGATED_ITEM':
      return 'Owner decided it anyway';
    default:
      return 'other';
  }
}

// ------------------------------------------------------------------ the watch (scheduled)
const WATCH_ACTOR: AuditActor = { id: null, name: 'NW OS Delegation Watch', role: 'system' };
const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dd = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dd);
  return `${t.getUTCFullYear()}-W${String(Math.ceil(((t.getTime() - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7)).padStart(2, '0')}`;
};

/**
 * Expiry, absence start / end, expiry reminders, coverage changes and ineffective delegations.
 * Idempotent: expiry and absence transitions are state changes guarded in SQL; notifications go
 * through the action ledger with keys per rule / stage / cell / week.
 */
export async function runDelegationWatch(pool: Pool, now: Date, problems: string[] = []): Promise<PlannedAction[]> {
  const out: PlannedAction[] = [];
  const owners = (await pool.query(`SELECT id FROM users WHERE role = $1 AND is_active`, [OWNER])).rows.map((u) => u.id as string);
  // 1. Authority whose end has passed: switched off (inactive), audited, approvals re-evaluated.
  const ended = (await pool.query(`SELECT id FROM delegated_authorities WHERE kind = 'owner' AND end_at <= $1 AND expiry_processed_at IS NULL ORDER BY end_at LIMIT 200`, [now])).rows;
  for (const { id } of ended) {
    try {
      await withTransaction(pool, async (db) => {
        const r = (await db.query(`SELECT * FROM delegated_authorities WHERE id = $1 AND expiry_processed_at IS NULL FOR UPDATE SKIP LOCKED`, [id])).rows[0];
        if (!r) return;
        if (!r.active) {
          // Already switched off by a person (or an absence end): nothing left to expire.
          await db.query(`UPDATE delegated_authorities SET expiry_processed_at = $2 WHERE id = $1`, [id, now]);
          return;
        }
        await db.query(`UPDATE delegated_authorities SET expiry_processed_at = $2, active = false, deactivated_at = coalesce(deactivated_at, $2), deactivation_reason = coalesce(deactivation_reason, 'Expired'), updated_at = now() WHERE id = $1`, [id, now]);
        await writeAudit(db, WATCH_ACTOR, { action: r.authority_type === 'permanent' ? 'authority.rule.expire' : 'authority.temporary.expire', entityType: 'delegated_authority', entityId: id, projectId: r.project_id, before: { active: r.active }, after: { active: false, code: r.code, authority_type: r.authority_type, end_at: r.end_at } });
        await reevaluateRoutes(db, WATCH_ACTOR, { decisionType: r.decision_type, projectId: r.project_id ?? undefined }, `rule ${r.code} expired`);
      });
    } catch (err) {
      problems.push(`expiry of ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 2. Absences that started or ended.
  const due = (await pool.query(`SELECT id, status, start_at, end_at FROM owner_absences WHERE (status = 'scheduled' AND start_at <= $1) OR (status = 'active' AND end_at <= $1)`, [now])).rows;
  for (const a of due) {
    try {
      await withTransaction(pool, async (db) => {
        const cur = (await db.query(`SELECT * FROM owner_absences WHERE id = $1 FOR UPDATE`, [a.id])).rows[0];
        if (new Date(cur.end_at) <= now && ['scheduled', 'active'].includes(cur.status)) {
          await closeAbsence(db, WATCH_ACTOR, a.id, now, { by: null, reason: 'Absence period ended' });
        } else if (cur.status === 'scheduled' && new Date(cur.start_at) <= now) {
          await db.query(`UPDATE owner_absences SET status = 'active', activated_at = $2 WHERE id = $1`, [a.id, now]);
          await writeAudit(db, WATCH_ACTOR, { action: 'owner_absence.start', entityType: 'owner_absence', entityId: a.id, before: { status: 'scheduled' }, after: { status: 'active' } });
          await reevaluateRoutes(db, WATCH_ACTOR, {}, `absence ${a.id} started`);
          await notifyAbsence(db, a.id, 'started', cur.backup_user_id, `The backup takes the configured approvals until ${day(cur.end_at)}.`);
        }
      });
    } catch (err) {
      problems.push(`absence ${a.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // 3. Reminders before authority ends (7, 3 and 1 day; one per stage).
  const ending = (await pool.query(`SELECT a.*, u.name AS target_user_name FROM delegated_authorities a LEFT JOIN users u ON u.id = a.target_user_id WHERE a.kind = 'owner' AND a.active AND a.end_at > $1 AND a.end_at <= $1::timestamptz + interval '7 days'`, [now])).rows;
  for (const r of ending) {
    const left = new Date(r.end_at).getTime() - now.getTime();
    const stage = left <= DAY ? 1 : left <= 3 * DAY ? 3 : 7;
    out.push({
      kind: 'notification',
      key: `delegation_watch:expiry:${r.id}:${new Date(r.end_at).toISOString()}:${stage}`,
      users: owners,
      note: { title: `${r.authority_type === 'permanent' ? 'Delegation' : 'Temporary authority'} ${r.code} ends within ${stage} day${stage === 1 ? '' : 's'}`, message: `${r.name} (${r.target_user_name ?? r.target_role}) ends ${new Date(r.end_at).toISOString().slice(0, 16).replace('T', ' ')} UTC. Extend it or let it end.`, type: 'action', priority: stage === 1 ? 'high' : 'normal', project_id: r.project_id, link_tab: 'authority', entity_type: 'delegated_authority', entity_id: r.id },
    });
  }
  // 4. Coverage that became Uncovered / No Active Approver / Blocked by Permission (notified once per change).
  try {
    const cov = await computeCoverage(pool, now);
    const known = new Map((await pool.query('SELECT cell_key, status, changed_at FROM delegation_coverage_state')).rows.map((r) => [r.cell_key as string, r]));
    for (const c of cov.cells) {
      const prev = known.get(c.key);
      if (prev?.status === c.status) {
        if (GAP_STATUSES.includes(c.status)) {
          out.push({ kind: 'notification', key: `delegation_watch:coverage:${c.key}:${c.status}:${new Date(prev.changed_at).toISOString()}`, users: owners, note: { title: `Coverage gap: ${c.label} (${c.value_label})`, message: `${c.status}: ${c.reasons.join('; ')}. ${c.pending_with_owner} pending approval(s) affected.`, type: 'warning', priority: 'high', project_id: null, link_tab: 'authority', entity_type: 'coverage', entity_id: c.key } });
        }
        continue;
      }
      const changed = (await pool.query(`INSERT INTO delegation_coverage_state (cell_key, status, changed_at) VALUES ($1, $2, $3) ON CONFLICT (cell_key) DO UPDATE SET status = EXCLUDED.status, changed_at = EXCLUDED.changed_at RETURNING changed_at`, [c.key, c.status, now])).rows[0];
      const meaningful = GAP_STATUSES.includes(c.status) || (prev && GAP_STATUSES.includes(prev.status));
      if (meaningful) await writeAudit(pool, WATCH_ACTOR, { action: 'delegation.coverage.change', entityType: 'coverage', entityId: c.key, before: { status: prev?.status ?? null }, after: { status: c.status, reasons: c.reasons, pending_with_owner: c.pending_with_owner } });
      if (GAP_STATUSES.includes(c.status)) {
        out.push({ kind: 'notification', key: `delegation_watch:coverage:${c.key}:${c.status}:${new Date(changed.changed_at).toISOString()}`, users: owners, note: { title: `Coverage gap: ${c.label} (${c.value_label})`, message: `${c.status}: ${c.reasons.join('; ')}. ${c.pending_with_owner} pending approval(s) affected.`, type: 'warning', priority: 'high', project_id: null, link_tab: 'authority', entity_type: 'coverage', entity_id: c.key } });
      }
    }
  } catch (err) {
    problems.push(`coverage: ${err instanceof Error ? err.message : String(err)}`);
  }
  // 5. Delegations that leave much of their workload with the Owner (weekly at most).
  try {
    for (const e of (await delegationEffectiveness(pool, now)).delegations) {
      if (!e.finding || !e.in_force) continue;
      out.push({ kind: 'notification', key: `delegation_watch:ineffective:${e.rule_id}:${isoWeek(now)}`, users: owners, note: { title: `Delegation ${e.code} leaves ${e.owner_fallback_rate}% with you`, message: e.finding, type: 'information', priority: 'normal', project_id: null, link_tab: 'authority', entity_type: 'delegated_authority', entity_id: e.rule_id } });
    }
  } catch (err) {
    problems.push(`effectiveness: ${err instanceof Error ? err.message : String(err)}`);
  }
  return out;
}

export const delegationWatchRule: RuleDef = {
  key: 'delegation_watch',
  name: 'Delegation watch',
  description: 'Ends authority whose time is up (re-routing its pending approvals), starts and ends Owner absences, reminds the Owner 7 / 3 / 1 days before authority ends, and tells the Owner when coverage opens a gap or a delegation leaves much of its work with the Owner.',
  watches: [],
  interval_minutes: 5,
  defaults: {},
  actions: 'Switch expired temporary, absence and dated authority off (audited) and re-evaluate pending approvals; start / end absences; notify the Owner (once per reminder stage, coverage change or week).',
  human_in_loop: 'Never creates, widens or extends authority, and never approves anything. Only the Owner creates, extends or ends authority and absences.',
  evaluate: (rc) => runDelegationWatch(rc.pool, rc.now, rc.problems),
};
