/**
 * Owner Authority Settings (Phase 6 Batch 3): the read-only views the Owner's authority screen
 * needs — the dashboard, a preview of a rule before it is saved, and the impact of switching a
 * rule on or off. Nothing here grants or changes authority: saving still goes through
 * createRule / updateRule / setRuleActive (authority.ts), validated on the server, and every
 * approval is still decided by the authority resolver.
 */
import type { AccessContext } from '../auth/access';
import { permissionsFor, ROLES } from '../auth/permissions';
import { ForbiddenError } from '../auth/access';
import { NotFoundError, ValidationError } from '../core/repository';
import type { Pool } from '../db/pool';
import type { PermissionKey, UserRole } from '../../src/types';
import { describeRule, listRules, refuseUnknown, requireManage, RULE_FIELDS_FOR_PREVIEW, validateOwnerRule } from './authority';
import { ruleExceedsCeiling } from './authorityCeiling';

type Row = Record<string, any>;
const OWNER = 'Owner / CEO';
const DAY = 86_400_000;
const EXPIRING_DAYS = 30;

function needView(ctx: AccessContext) {
  if (!ctx.can('authority.view')) throw new ForbiddenError('Missing permission: authority.view (see delegated authority)');
}

/** Roles (other than the Owner) a rule can cover: by role, by user's role, or by permission. */
function rolesCovered(rule: Row, userRole?: string): UserRole[] {
  if (rule.target_user_id) return userRole ? [userRole as UserRole] : [];
  if (rule.target_role) return [rule.target_role];
  if (rule.target_permission) return ROLES.filter((r) => r !== OWNER && permissionsFor(r).has(rule.target_permission as PermissionKey));
  return [];
}

const overlaps = (aMin: number | null, aMax: number | null, bMin: number | null, bMax: number | null) => (aMax ?? Infinity) >= (bMin ?? 0) && (bMax ?? Infinity) >= (aMin ?? 0);
const scopeOverlaps = (a: Row, b: Row) => (!a.project_id || !b.project_id || a.project_id === b.project_id) && (!a.client_id || !b.client_id || a.client_id === b.client_id);
const datesOverlap = (a: Row, b: Row) => {
  const aStart = a.start_at ? Date.parse(a.start_at) : -Infinity;
  const aEnd = a.end_at ? Date.parse(a.end_at) : Infinity;
  const bStart = b.start_at ? Date.parse(b.start_at) : -Infinity;
  const bEnd = b.end_at ? Date.parse(b.end_at) : Infinity;
  return aStart < bEnd && bStart < aEnd;
};
const inForce = (r: Row, now: number) => r.active && (!r.start_at || Date.parse(r.start_at) <= now) && (!r.end_at || Date.parse(r.end_at) > now);

/** The authority dashboard. */
export async function authorityOverview(pool: Pool, ctx: AccessContext, now = new Date()) {
  needView(ctx);
  const t = now.getTime();
  const rules = await listRules(pool);
  const projects = (await pool.query(`SELECT p.id, p.project_name, p.project_number, p.client_id, c.company_name AS client_name, p.sensitivity, p.risk_status, p.project_status FROM projects p LEFT JOIN clients c ON c.id = p.client_id ORDER BY p.project_name`)).rows;
  const types = (await pool.query('SELECT key, label, baseline_permission, sensitive_protected, active FROM authority_decision_types ORDER BY label')).rows;
  const owners = rules.filter((r) => r.kind === 'owner');
  const expiring = owners.filter((r) => inForce(r, t) && r.end_at && Date.parse(r.end_at) - t <= EXPIRING_DAYS * DAY);

  // Allow rules the project sensitivity overrides somewhere (project-scoped, or client / global over a protected project).
  const overridden: { code: string; name: string; projects: string[] }[] = [];
  for (const r of owners.filter((x) => x.effect === 'allow' && inForce(x, t))) {
    const hit: string[] = [];
    for (const p of projects.filter((p) => p.sensitivity !== 'Normal' && (!r.project_id || r.project_id === p.id) && (!r.client_id || r.client_id === p.client_id))) {
      if (await ruleExceedsCeiling(pool, r.decision_type, p.id)) hit.push(p.project_name);
    }
    if (hit.length) overridden.push({ code: r.code, name: r.name, projects: hit });
  }

  const routes = (await pool.query(`SELECT routing_basis, owner_reason_code, decision_type, count(*)::int AS n FROM approval_routes WHERE status = 'open' GROUP BY 1, 2, 3`)).rows;
  const total = routes.reduce((s, r) => s + r.n, 0);
  const toOwner = routes.filter((r) => r.routing_basis === 'OWNER_FALLBACK');
  const ownerTotal = toOwner.reduce((s, r) => s + r.n, 0);
  const sum = (rows: Row[], key: string) => Object.entries(rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r[key]]: (m[r[key]] ?? 0) + r.n }), {})).map(([k, n]) => ({ key: k, count: n }));

  // Decision types where today only the Owner can approve (no rule covers anyone else).
  const ownerOnly = types
    .filter((ty) => ty.active)
    .filter((ty) => !rules.some((r) => r.decision_type === ty.key && r.effect === 'allow' && inForce(r, t) && (r.target_user_id || rolesCovered(r).length)))
    .map((ty) => ({ key: ty.key, label: ty.label }));

  return {
    counts: {
      owner_rules: owners.length,
      owner_rules_active: owners.filter((r) => inForce(r, t)).length,
      system_policies: rules.filter((r) => r.kind === 'system').length,
      system_policies_active: rules.filter((r) => r.kind === 'system' && r.active).length,
      inactive: rules.filter((r) => !r.active).length,
      expiring_soon: expiring.length,
      overridden_by_sensitivity: overridden.length,
      sensitive_projects: projects.filter((p) => p.sensitivity === 'Sensitive').length,
      strategic_projects: projects.filter((p) => p.sensitivity === 'Strategic').length,
      pending_approvals: total,
      pending_to_owner: ownerTotal,
      pending_delegated: total - ownerTotal,
    },
    expiring_soon: expiring.map((r) => ({ id: r.id, code: r.code, name: r.name, end_at: r.end_at, summary: r.summary })),
    inactive: rules.filter((r) => !r.active).map((r) => ({ id: r.id, code: r.code, name: r.name, kind: r.kind, deactivation_reason: r.deactivation_reason })),
    overridden_by_sensitivity: overridden,
    projects,
    owner_queue_by_reason: sum(toOwner, 'owner_reason_code'),
    coverage_by_basis: sum(routes, 'routing_basis'),
    coverage_by_type: sum(routes, 'decision_type'),
    owner_only_types: ownerOnly,
    expiring_window_days: EXPIRING_DAYS,
  };
}

/**
 * What a rule would do, before it is saved (create, or an edit of rule `id`). Runs the same
 * server validation as saving; a rule the server would refuse comes back as a 400.
 */
export async function previewRule(pool: Pool, ctx: AccessContext, body: unknown, id?: string, now = new Date()) {
  requireManage(ctx);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('A rule is required');
  const input = { ...(body as Row) };
  delete input.change_reason;
  let existing: Row | undefined;
  if (id) {
    existing = (await pool.query('SELECT * FROM delegated_authorities WHERE id = $1', [id])).rows[0];
    if (!existing || existing.kind !== 'owner') throw new ForbiddenError('Only Owner rules can be edited; System Policy is switched on or off');
  }
  refuseUnknown(input, RULE_FIELDS_FOR_PREVIEW);
  const merged = existing ? { ...existing, min_value: existing.min_value == null ? null : Number(existing.min_value), max_value: existing.max_value == null ? null : Number(existing.max_value), ...input } : input;
  const r = await validateOwnerRule(pool, merged, now, { creating: !existing });
  const t = now.getTime();

  const type = (await pool.query('SELECT label, baseline_permission, sensitive_protected FROM authority_decision_types WHERE key = $1', [r.decision_type])).rows[0];
  const user = r.target_user_id ? (await pool.query('SELECT id, name, role, is_active FROM users WHERE id = $1', [r.target_user_id])).rows[0] : undefined;
  const project = r.project_id ? (await pool.query('SELECT id, project_name, sensitivity, client_id FROM projects WHERE id = $1', [r.project_id])).rows[0] : undefined;
  const client = r.client_id ? (await pool.query('SELECT company_name FROM clients WHERE id = $1', [r.client_id])).rows[0] : undefined;
  const summary = describeRule(r, { type: type?.label, user: user?.name, project: project?.project_name, client: client?.company_name });

  const projects = (await pool.query(`SELECT id, project_name, client_id, sensitivity FROM projects WHERE project_status NOT IN ('Completed', 'Closed')`)).rows.filter(
    (p) => (!r.project_id || p.id === r.project_id) && (!r.client_id || p.client_id === r.client_id)
  );
  const users =
    r.effect === 'allow'
      ? (await pool.query(`SELECT id, name, role FROM users WHERE is_active AND role <> 'Owner / CEO' ORDER BY name`)).rows.filter(
          (u) => (!r.target_user_id || u.id === r.target_user_id) && (!r.target_role || u.role === r.target_role) && permissionsFor(u.role).has(type.baseline_permission)
        )
      : [];
  const others = (await listRules(pool, { decision_type: r.decision_type })).filter((x) => x.id !== id && inForce(x, t));
  const warnings: { code: string; message: string }[] = [];
  const warn = (code: string, message: string) => warnings.push({ code, message });

  const protectedProjects = [];
  for (const p of projects.filter((p) => p.sensitivity !== 'Normal')) if (r.effect === 'allow' && (await ruleExceedsCeiling(pool, r.decision_type, p.id))) protectedProjects.push(p);
  if (project && project.sensitivity !== 'Normal') warn('PROJECT_' + project.sensitivity.toUpperCase(), `${project.project_name} is ${project.sensitivity}.`);
  if (!r.project_id && protectedProjects.length) {
    warn('OVERRIDDEN_BY_SENSITIVITY', `Overridden by project sensitivity on ${protectedProjects.length} project(s): ${protectedProjects.map((p) => `${p.project_name} (${p.sensitivity})`).join(', ')}. Only the Owner decides there.`);
  }
  const overlapping = others.filter(
    (x) => x.effect === r.effect && scopeOverlaps(x, r) && overlaps(r.min_value, r.max_value, x.min_value, x.max_value) && datesOverlap(x, r) && (x.target_user_id ? x.target_user_id === r.target_user_id || x.target_role == null : !r.target_user_id ? x.target_role === r.target_role : user?.role === x.target_role)
  );
  if (overlapping.length) warn('OVERLAPS', `Overlaps ${overlapping.map((x) => `${x.code} (${x.name})`).join(', ')}.`);
  if (r.effect === 'allow') {
    const outranking = others.filter((x) => x.effect === 'require_owner' && x.priority >= r.priority && scopeOverlaps(x, r) && overlaps(r.min_value, r.max_value, x.min_value, x.max_value) && !Array.isArray(x.conditions?.sensitivity));
    if (outranking.length) {
      warn('MAY_NEVER_APPLY', `Where ${outranking.map((x) => `${x.code} (priority ${x.priority})`).join(', ')} applies, the Owner is still required: this rule (priority ${r.priority}) does not outrank it.`);
    }
    const system = others.filter((x) => x.kind === 'system' && x.effect === 'allow' && !x.conditions?.requests_only && !x.conditions?.assigned_approver);
    const coveredBySystem = system.some((x) => (x.target_permission && users.every((u) => permissionsFor(u.role).has(x.target_permission))) || (x.target_role && users.every((u) => u.role === x.target_role)));
    if (users.length && !coveredBySystem) {
      warn('BROADENS_SYSTEM_POLICY', `Gives ${r.target_user_id ? user?.name ?? r.target_user_id : r.target_role} ${type.label.toLowerCase()} authority that System Policy (${system.map((x) => x.code).join(', ') || 'none'}) does not give them today.`);
    }
    const majors = others.filter((x) => x.kind === 'system' && x.effect === 'require_owner' && x.min_value != null && !x.conditions?.sensitivity && (r.max_value == null || r.max_value >= x.min_value) && r.priority > x.priority);
    for (const m of majors) warn('BROADENS_SYSTEM_POLICY', `Allows ${type.label.toLowerCase()} of RM ${Number(m.min_value).toLocaleString('en-US')} or more, which ${m.code} otherwise reserves for the Owner.`);
  }
  if (r.end_at && Date.parse(r.end_at) - t <= 14 * DAY) warn('EXPIRES_SOON', `Ends on ${String(r.end_at).slice(0, 10)}.`);

  const higher = others.filter((x) => x.priority > r.priority && scopeOverlaps(x, r)).map((x) => ({ code: x.code, name: x.name, effect: x.effect, priority: x.priority }));
  const usable: string[] = [];
  if (r.start_at && Date.parse(r.start_at) > t) usable.push(`starts on ${String(r.start_at).slice(0, 10)}`);
  if (r.effect === 'allow' && !users.length) usable.push('no active user it covers holds the baseline permission');
  if (r.effect === 'allow' && projects.length && projects.every((p) => protectedProjects.includes(p))) usable.push('every project it covers is Sensitive / Strategic');
  if (r.active === false) usable.push('saved inactive');

  const scenarios = (
    await pool.query(
      `SELECT count(*)::int AS n FROM approval_routes WHERE status = 'open' AND decision_type = $1 AND ($2::text IS NULL OR project_id = $2) AND ($3::text IS NULL OR client_id = $3)
         AND ($4::numeric IS NULL OR value >= $4) AND ($5::numeric IS NULL OR value <= $5)`,
      [r.decision_type, r.project_id, r.client_id, r.min_value, r.max_value]
    )
  ).rows[0].n;

  return {
    summary,
    decision_type: { key: r.decision_type, label: type.label, baseline_permission: type.baseline_permission },
    effect: r.effect,
    target: r.target_user_id ? { type: 'user', id: r.target_user_id, name: user?.name, role: user?.role } : r.target_role ? { type: 'role', role: r.target_role } : null,
    scope: { project: project ? { id: project.id, name: project.project_name, sensitivity: project.sensitivity } : null, client: client ? { id: r.client_id, name: client.company_name } : null },
    value_range: { min: r.min_value, max: r.max_value },
    max_risk: r.max_risk,
    dates: { start_at: r.start_at, end_at: r.end_at },
    priority: r.priority,
    warnings,
    impact: { users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })), projects: projects.length, protected_projects: protectedProjects.length, pending_approvals_in_scope: scenarios },
    higher_priority_rules: higher,
    immediately_usable: usable.length === 0,
    not_usable_because: usable,
  };
}

/** What switching a rule off (or back on) affects, before it is done. */
export async function ruleImpact(pool: Pool, ctx: AccessContext, id: string, action: 'deactivate' | 'reactivate') {
  needView(ctx);
  const rule = (await listRules(pool, { id }))[0];
  if (!rule) {
    const err = new NotFoundError('clients', id);
    err.message = `Authority rule ${id} not found`;
    throw err;
  }
  const users =
    rule.effect === 'allow'
      ? (await pool.query(`SELECT id, name, role FROM users WHERE is_active AND role <> 'Owner / CEO' ORDER BY name`)).rows.filter(
          (u) => (!rule.target_user_id || u.id === rule.target_user_id) && (!rule.target_role || u.role === rule.target_role) && (!rule.target_permission || permissionsFor(u.role).has(rule.target_permission)) && permissionsFor(u.role).has(rule.baseline_permission)
        )
      : [];
  const projects = (await pool.query(`SELECT count(*)::int AS n FROM projects WHERE project_status NOT IN ('Completed', 'Closed') AND ($1::text IS NULL OR id = $1) AND ($2::text IS NULL OR client_id = $2)`, [rule.project_id, rule.client_id])).rows[0].n;
  const routed = (await pool.query(`SELECT id, resource_kind, resource_id, assigned_user_id, data->>'title' AS title FROM approval_routes WHERE status = 'open' AND authority_rule_id = $1 ORDER BY id`, [id])).rows;
  const inScope = (
    await pool.query(
      `SELECT count(*)::int AS n FROM approval_routes WHERE status = 'open' AND decision_type = $1 AND ($2::text IS NULL OR project_id = $2) AND ($3::text IS NULL OR client_id = $3)`,
      [rule.decision_type, rule.project_id, rule.client_id]
    )
  ).rows[0].n;
  const locked = Boolean(rule.locked);
  return {
    rule: { id: rule.id, code: rule.code, name: rule.name, kind: rule.kind, effect: rule.effect, active: rule.active, locked, summary: rule.summary },
    action,
    allowed: !locked && (action === 'deactivate' ? rule.active : !rule.active),
    users: users.map((u) => ({ id: u.id, name: u.name, role: u.role })),
    projects,
    pending_routed_by_this_rule: routed.length,
    pending_examples: routed.slice(0, 5).map((r) => r.title),
    pending_in_scope: inScope,
    message:
      action === 'deactivate'
        ? rule.effect === 'allow'
          ? `${routed.length} pending approval(s) routed by ${rule.code} will be routed again now; future decisions go to another eligible person or the Owner.`
          : `Decisions ${rule.code} reserves for the Owner may then go to delegates where another rule allows.`
        : rule.effect === 'allow'
          ? `Up to ${inScope} pending approval(s) in scope will be routed again and may move to the people this rule covers.`
          : `Decisions in scope will again need the Owner; up to ${inScope} pending approval(s) will be routed again.`,
  };
}
