/**
 * The AI context engine: what a model may be told, built only from what the asking user may see.
 *
 *   User (session) → existing authorization → allowed records → context pack → model
 *
 * Every read goes through the existing permission-checked paths: DataService.list/get (module
 * RBAC, project scope, contractor isolation, hidden fields), CoreService (core chain redaction),
 * projectRiskFor / portfolioRisk / dailyBriefing / profitability (their own role checks) and the
 * authority resolver. Nothing here queries a table a person could not read through the API, and
 * there is no "fetch anything" tool for the model: it receives a fixed, bounded pack of facts.
 *
 * Facts carry the Phase 5 confidence labels (Confirmed / Probable / Unknown) and the NW OS record
 * they come from. Figures are computed here, on the server; the model only explains them.
 * Text written by people (issue descriptions, notes) is untrusted data and is passed as such.
 */
import type { AccessContext } from '../auth/access';
import { canSeeProjectFinancials } from '../auth/permissions';
import type { Pool } from '../db/pool';
import type { DataService } from '../modules/service';
import { dailyBriefing } from '../modules/briefing';
import { portfolioRisk, projectRiskFor } from '../modules/risk';
import { profitability } from '../modules/reports';
import { decisionState } from '../modules/approvalRouting';
import { resolveApprovalAuthority } from '../modules/authorityResolver';
import { decisionTrace } from '../modules/decisionTrace';
import { computeCoverage, coverageGaps, listAbsences, listTemporary } from '../modules/delegationCoverage';
import { validateProposal, PROPOSAL_ACTIONS, type ProposalAction } from '../modules/assistantActions';
import type { Confidence, Source } from '../modules/assistant';

type Row = Record<string, any>;

export interface CtxFact {
  ref: string;
  text: string;
  confidence: Confidence;
  section: string;
  source?: Source;
  basis?: string;
}
/** An action the server has already validated as this user (the model may only pick one by ref). */
export interface CtxAction {
  ref: string;
  action: ProposalAction;
  label: string;
  summary: string;
  params: Row;
}
/** A protected decision: shown as "Decision Required", decided only in the existing workflow. */
export interface CtxDecision {
  ref: string;
  title: string;
  why: string;
  source?: Source;
}
export interface ContextPack {
  project: { id: string; name: string } | null;
  facts: CtxFact[];
  actions: CtxAction[];
  decisions: CtxDecision[];
  /** Deterministic answer shown when no model is available (or it fails). */
  fallback: string;
  /** Free text from people that the model must treat as data (quoted, never obeyed). */
  untrusted: { label: string; text: string }[];
}

const rm = (n: unknown) => `RM ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const STAFF = (ctx: AccessContext) => !['Client', 'Contractor'].includes(ctx.user.role);

export class PackBuilder {
  readonly pack: ContextPack;
  private seen = new Set<string>();
  constructor(project: ContextPack['project'] = null) {
    this.pack = { project, facts: [], actions: [], decisions: [], fallback: '', untrusted: [] };
  }
  fact(section: string, text: string, confidence: Confidence, source?: Source, basis?: string) {
    const key = `${section}|${text}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.pack.facts.push({ ref: `F${this.pack.facts.length + 1}`, section, text: text.slice(0, 400), confidence, ...(source ? { source } : {}), ...(basis ? { basis } : {}) });
  }
  decision(title: string, why: string, source?: Source) {
    if (this.pack.decisions.some((d) => d.title === title)) return;
    this.pack.decisions.push({ ref: `D${this.pack.decisions.length + 1}`, title, why, ...(source ? { source } : {}) });
  }
  /** Adds an action only if the server accepts it for this user right now (same check as proposing it). */
  async action(pool: Pool, ctx: AccessContext, action: ProposalAction, params: Row) {
    if (!ctx.can('ai.assistant') || !ctx.can('approvals.request')) return;
    try {
      const checked = await validateProposal(pool, ctx, action, params);
      if (this.pack.actions.some((a) => a.summary === checked.summary)) return;
      this.pack.actions.push({ ref: `A${this.pack.actions.length + 1}`, action, label: PROPOSAL_ACTIONS[action], summary: checked.summary, params: checked.params });
    } catch {
      // Not valid for this user: never offered.
    }
  }
  untrusted(label: string, text: unknown) {
    if (typeof text === 'string' && text.trim()) this.pack.untrusted.push({ label, text: text.trim().slice(0, 1500) });
  }
}

/** Lists a module through the permission-checked service; [] when the role cannot read it. */
async function safeList(service: DataService, ctx: AccessContext, key: string, filter: Record<string, string | undefined> = {}) {
  const def = service.module(key);
  const view = def.perms.view;
  if (!(Array.isArray(view) ? view.some((p) => ctx.can(p)) : view && ctx.can(view))) return [] as Row[];
  return (await service.list(ctx, def, filter)) as Row[];
}
async function safeGet(service: DataService, ctx: AccessContext, key: string, id: string) {
  try {
    return (await service.get(ctx, service.module(key), id)) as Row;
  } catch {
    return undefined; // missing and out of scope look the same
  }
}
async function workItem(service: DataService, ctx: AccessContext, id: unknown) {
  if (typeof id !== 'string' || !id || !ctx.can('work_items.view')) return undefined;
  try {
    return (await service.core.get(ctx, 'workItems', id)) as Row;
  } catch {
    return undefined;
  }
}
/** The project if this user may see it (same answer for missing and out of scope). */
export async function visibleProject(pool: Pool, ctx: AccessContext, id: unknown) {
  if (typeof id !== 'string' || !id || !ctx.canSeeProject(id)) return null;
  const p = (await pool.query('SELECT id, project_name FROM projects WHERE id = $1', [id])).rows[0];
  return p ? { id: p.id as string, name: p.project_name as string } : null;
}

// ------------------------------------------------------------------ operational overview

/** Today's operational picture for the user (staff: briefing + risk; contractor: their work). */
export async function overviewContext(pool: Pool, service: DataService, ctx: AccessContext, b: PackBuilder, now: Date, project: ContextPack['project']) {
  if (!STAFF(ctx)) return contractorContext(pool, service, ctx, b, now);
  const br = await dailyBriefing(pool, ctx, now);
  const add = (section: string, items: Row[], prefix: string) => {
    for (const i of items.slice(0, 12)) {
      if (project && i.project_id && i.project_id !== project.id) continue;
      b.fact(section, `${prefix}: ${i.label} — ${i.detail}`, 'Confirmed', i.entity_id ? { type: i.entity_type ?? 'record', id: i.entity_id, tab: i.tab, project_id: i.project_id } : undefined);
    }
  };
  add('Owner decisions', br.decisions as Row[], 'Decision waiting');
  for (const d of (br.decisions as Row[]).slice(0, 12)) {
    if (project && d.project_id && d.project_id !== project.id) continue;
    b.decision(d.label, 'Waiting for your decision in its own screen. The AI cannot approve, reject or decide it.', d.entity_id ? { type: d.entity_type ?? 'record', id: d.entity_id, tab: d.tab, project_id: d.project_id } : undefined);
  }
  add('Attention', br.today.tasks_overdue as Row[], 'Overdue task');
  add('Attention', br.today.tasks_due as Row[], 'Due today');
  add('Production', br.today.production_blocked as Row[], 'Production blocked');
  add('Production', br.today.material_shortages as Row[], 'Material shortage');
  const t = br.today as Row;
  add('Site', (t.deliveries ?? []) as Row[], 'Delivery soon');
  add('Site', (t.inspections ?? t.site_qc ?? []) as Row[], 'Site QC');
  add('Attention', (t.drawings ?? []) as Row[], 'Drawing review');
  for (const r of br.risks.slice(0, 8)) {
    if (project && r.project_id !== project.id) continue;
    b.fact(r.level === 'Critical' ? 'Critical' : 'Attention', `${r.project_name} is ${r.level}: ${r.reasons.slice(0, 3).join('; ')}`, 'Confirmed', { type: 'project', id: r.project_id, tab: 'projects', project_id: r.project_id });
  }
  // Open critical / high issues and failed QC in scope.
  const issues = (await safeList(service, ctx, 'issues')).filter((i) => !['Resolved', 'Closed'].includes(i.status) && ['Critical', 'High'].includes(i.priority) && (!project || i.project_id === project.id));
  for (const i of issues.slice(0, 10)) b.fact(i.priority === 'Critical' ? 'Critical' : 'Attention', `Open ${i.priority} issue "${i.title}" (${i.status})${i.category ? `, ${i.category}` : ''}`, 'Confirmed', { type: 'issue', id: i.id, tab: 'issues', project_id: i.project_id });
  const qc = (await safeList(service, ctx, 'siteQCInspections')).filter((q) => /fail/i.test(String(q.result)) && (!project || q.project_id === project.id));
  for (const q of qc.slice(0, 6)) b.fact('Site', `Site QC failed${q.work_item_code ? ` on ${q.work_item_code}` : ''}${q.inspected_at ? ` (${String(q.inspected_at).slice(0, 10)})` : ''}`, 'Confirmed', { type: 'site_qc', id: q.id, tab: 'delivery', project_id: q.project_id });
  const factoryQc = (await safeList(service, ctx, 'qcRecords')).filter((q) => /fail/i.test(String(q.result)) && (!project || q.project_id === project.id));
  for (const q of factoryQc.slice(0, 6)) b.fact('Production', `QC record failed${q.work_item_code ? ` on ${q.work_item_code}` : ''}`, 'Confirmed', { type: 'qc_record', id: q.id, tab: 'work-items', project_id: q.project_id });
  // Commercial attention (only for commercial roles; the module checks hold the rest back).
  if (canSeeProjectFinancials(ctx.user.role) && ctx.can('commercial.view')) {
    const vos = (await safeList(service, ctx, 'variations')).filter((v) => /pending|internal approval|client approval|submitted/i.test(String(v.status)) && (!project || v.project_id === project.id));
    for (const v of vos.slice(0, 8)) b.fact('Commercial', `Variation ${v.variation_number ?? v.id} "${v.title ?? ''}" is ${v.status} (client amount ${rm(v.client_amount)})`, 'Confirmed', { type: 'variation', id: v.id, tab: 'variations', project_id: v.project_id });
    const leaks = (await safeList(service, ctx, 'costLeakAlerts')).filter((l) => !/resolved|closed/i.test(String(l.status)) && (!project || l.project_id === project.id));
    for (const l of leaks.slice(0, 6)) b.fact('Commercial', `Potential issue (recorded alert): ${l.title} — ${l.status}`, 'Confirmed', { type: 'cost_leak_alert', id: l.id, tab: 'commercial', project_id: l.project_id });
  }
  await decisionsForMe(pool, ctx, b, project);
}

/** Contractors: their own tasks, jobs, approved drawings and issues; nothing internal. */
async function contractorContext(pool: Pool, service: DataService, ctx: AccessContext, b: PackBuilder, now: Date) {
  const today = now.toISOString().slice(0, 10);
  const tasks = (await pool.query(`SELECT id, project_id, due_date, status, priority, data->>'title' AS title FROM tasks WHERE assigned_user_id = $1 AND status NOT IN ('Completed', 'Cancelled') ORDER BY due_date NULLS LAST LIMIT 20`, [ctx.user.id])).rows.filter((t) => !t.project_id || ctx.canSeeProject(t.project_id));
  for (const t of tasks) b.fact('My work', `Task "${t.title}" — ${t.status}${t.due_date ? `, due ${t.due_date}${t.due_date < today ? ' (overdue)' : ''}` : ''}`, 'Confirmed', { type: 'task', id: t.id, tab: 'automation', project_id: t.project_id });
  for (const j of (await safeList(service, ctx, 'installationJobs')).slice(0, 15)) b.fact('My work', `Installation ${j.work_item_code ?? j.job_number ?? j.id}: ${j.status}${j.progress_percent != null ? `, ${j.progress_percent}%` : ''}${j.planned_start_date ? `, planned start ${j.planned_start_date}` : ''}`, 'Confirmed', { type: 'installation', id: j.id, tab: 'delivery', project_id: j.project_id });
  for (const d of (await safeList(service, ctx, 'deliveryRecords')).slice(0, 10)) b.fact('My work', `Delivery ${d.delivery_number ?? d.id}: ${d.status}${d.delivery_date ? ` on ${d.delivery_date}` : ''}`, 'Confirmed', { type: 'delivery', id: d.id, tab: 'delivery', project_id: d.project_id });
  for (const i of (await safeList(service, ctx, 'issues')).filter((x) => !['Resolved', 'Closed'].includes(x.status)).slice(0, 10)) b.fact('Problems', `Open issue "${i.title}" (${i.status})`, 'Confirmed', { type: 'issue', id: i.id, tab: 'issues', project_id: i.project_id });
}

/** Decisions assigned to this user right now (the routing the resolver produced). */
async function decisionsForMe(pool: Pool, ctx: AccessContext, b: PackBuilder, project: ContextPack['project']) {
  const rows = (await pool.query(`SELECT resource_kind, resource_id, project_id, decision_type, due_at, routing_basis, authority_rule_code FROM approval_routes WHERE status = 'open' AND assigned_user_id = $1 ORDER BY due_at NULLS LAST, id LIMIT 25`, [ctx.user.id])).rows;
  for (const r of rows) {
    if (r.project_id && (!ctx.canSeeProject(r.project_id) || (project && r.project_id !== project.id))) continue;
    const st = await decisionState(pool, r.resource_kind, r.resource_id);
    if (!st?.pending) continue;
    const src: Source = { type: r.resource_kind, id: r.resource_id, tab: st.link.tab, project_id: r.project_id };
    b.fact('Owner decisions', `Waiting for your decision: ${st.title}${r.due_at ? ` (due ${new Date(r.due_at).toISOString().slice(0, 10)})` : ''} — routed by ${r.routing_basis}${r.authority_rule_code ? ` (${r.authority_rule_code})` : ''}`, 'Confirmed', src);
    b.decision(st.title, 'An approval decision: you decide it in its own screen; the assistant cannot approve or reject it.', src);
  }
}

// ------------------------------------------------------------------ authority (Batch 4–6)

/**
 * "Who can approve this?", "What can my team handle?", "Who decides while I am away?" — answered
 * from the routing the authority resolver produced and the resolver itself. Nothing is computed
 * here about authority: the AI reports the resolver's result.
 */
export async function authorityContext(pool: Pool, ctx: AccessContext, b: PackBuilder, project: ContextPack['project'], now: Date) {
  const viewer = ctx.can('authority.view');
  const rows = (
    await pool.query(
      `SELECT ar.resource_kind, ar.resource_id, ar.project_id, ar.decision_type, ar.routing_basis, ar.authority_rule_code, ar.owner_reason_code, ar.assigned_user_id, u.name, u.role
       FROM approval_routes ar JOIN users u ON u.id = ar.assigned_user_id WHERE ar.status = 'open' ORDER BY ar.due_at NULLS LAST, ar.id LIMIT 60`
    )
  ).rows.filter((r) => (!r.project_id || ctx.canSeeProject(r.project_id)) && (!project || r.project_id === project.id) && (viewer || r.assigned_user_id === ctx.user.id));
  for (const r of rows.slice(0, 15)) {
    const st = await decisionState(pool, r.resource_kind, r.resource_id);
    if (!st?.pending) continue;
    const src: Source = { type: r.resource_kind, id: r.resource_id, tab: st.link.tab, project_id: r.project_id };
    const mine = await resolveApprovalAuthority(pool, ctx, { resource: { kind: r.resource_kind, id: r.resource_id }, now });
    const routed = r.routing_basis === 'OWNER_FALLBACK' ? `the Owner (${r.name}) — no delegate available: ${r.owner_reason_code}` : `${r.name} (${r.role}) under ${r.authority_rule_code ?? r.routing_basis}`;
    b.fact('Authority', `${st.title}: routed to ${routed}. Authority resolver for you: ${mine.allowed ? 'you may decide it' : `you may not decide it (${mine.reasonCode}: ${mine.reason})`}`, 'Confirmed', src, 'Approval routing and the authority resolver (the only authority source)');
  }
  if (!rows.length) b.fact('Authority', viewer ? 'No open approval decisions in scope.' : 'No approval decisions are waiting for you.', 'Confirmed', undefined, 'Approval routing');
  if (!viewer) {
    b.fact('Authority', 'Who else holds authority is visible to the Owner and Admin only.', 'Confirmed', undefined, 'authority.view permission');
    return;
  }
  // Coverage (Batch 6): gaps and partial cover, from the server's coverage matrix.
  const coverage = await computeCoverage(pool, now);
  const gaps = await coverageGaps(pool, now, coverage);
  b.fact('Authority', `Delegation coverage: ${coverage.health.covered} covered, ${coverage.health.partial} partial, ${gaps.length} gap(s), ${coverage.health.owner_only + coverage.health.blocked_by_sensitivity} kept with the Owner (overall ${coverage.health.overall_percent ?? '—'}%: ${coverage.health.definition})`, 'Confirmed', { type: 'coverage', id: 'matrix', tab: 'authority', project_id: null });
  for (const c of coverage.cells.filter((x: Row) => x.status !== 'Blocked by Sensitivity').slice(0, 14)) {
    b.fact('Authority', `${c.label} — ${c.scope}, ${c.value_label}: ${c.status}${c.approvers.length ? `; eligible: ${c.approvers.map((a: Row) => `${a.role} (${a.users})`).join(', ')}` : ''}${c.rules.length ? ` [${c.rules.join(', ')}]` : ''}`, 'Confirmed', { type: 'coverage', id: c.key, tab: 'authority', project_id: null });
  }
  for (const g of gaps.slice(0, 6)) b.fact('Authority', `Coverage gap: ${g.label} (${g.scope}) — ${g.reason}; ${g.pending_affected} pending; recommended: ${g.recommended_action}`, 'Confirmed', { type: 'coverage', id: g.key, tab: 'authority', project_id: null });
  // Temporary authority and absences (Batch 6).
  const temp = await listTemporary(pool, ctx, now);
  for (const t of [...temp.active, ...temp.scheduled].slice(0, 8)) b.fact('Authority', `${t.authority_type === 'absence' ? 'Absence' : 'Temporary'} authority ${t.code}: ${t.target?.name ?? t.target?.role ?? ''} may decide ${t.decision_type}${t.max_value != null ? ` up to ${rm(t.max_value)}` : ''} ${t.project?.name ? `on ${t.project.name}` : 'on Normal projects'} until ${new Date(t.end_at).toISOString().slice(0, 16).replace('T', ' ')} UTC (${t.state})`, 'Confirmed', { type: 'delegated_authority', id: t.id, tab: 'authority', project_id: t.project?.id ?? null });
  const abs = (await listAbsences(pool, ctx)).filter((a: Row) => ['active', 'scheduled'].includes(a.status));
  for (const a of abs) b.fact('Authority', `Owner absence ${a.id} (${a.status}) ${new Date(a.start_at).toISOString().slice(0, 10)} → ${new Date(a.end_at).toISOString().slice(0, 10)}: backup ${a.backup_name}${a.backup_active ? '' : ' (deactivated)'} for ${a.decision_types.join(', ')}${a.max_value != null ? ` up to ${rm(a.max_value)}` : ''}; Sensitive/Strategic projects and System Owner requirements stay with the Owner`, 'Confirmed', { type: 'owner_absence', id: a.id, tab: 'authority', project_id: null });
  if (!abs.length) b.fact('Authority', 'No Owner absence is active or scheduled.', 'Confirmed', { type: 'owner_absence', id: 'none', tab: 'authority', project_id: null });
  // Batch 5 recommendations: advisory only (the Owner accepts them through preview → confirm).
  if (ctx.user.role === 'Owner / CEO') {
    // Read-only (listing them on the dashboard marks them viewed; the AI must not change anything).
    const recs = (await pool.query(`SELECT id, project_id, confidence, evidence_count, data FROM delegation_recommendations WHERE status IN ('generated', 'viewed') ORDER BY generated_at DESC LIMIT 20`)).rows.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
    for (const r of recs.slice(0, 5)) b.fact('Authority', `Delegation recommendation (advisory, not authority): ${r.data?.headline ?? r.id} — ${r.confidence} confidence, ${r.evidence_count} decisions; coverage now: ${r.data?.coverage_now ?? 'Owner only'}. It grants nothing: only the Owner's confirmed acceptance (Owner Dashboard → preview → confirm) or Delegated Authority creates a rule.`, 'Confirmed', { type: 'delegation_recommendation', id: r.id, tab: 'owner', project_id: r.project_id ?? null });
  }
}

// ------------------------------------------------------------------ project summary

export async function projectContext(pool: Pool, service: DataService, ctx: AccessContext, b: PackBuilder, projectId: string, now: Date) {
  const p = (await service.core.get(ctx, 'projects', projectId)) as Row;
  const src = (type: string, id: string, tab: string): Source => ({ type, id, tab, project_id: projectId });
  b.fact('Project', `${p.project_name} (${p.project_number ?? p.id}) — status ${p.project_status}${p.progress_percent != null ? `, progress ${p.progress_percent}%` : ''}${p.end_date ? `, planned end ${p.end_date}` : ''}${p.sensitivity ? `, sensitivity ${p.sensitivity}` : ''}`, 'Confirmed', src('project', projectId, 'projects'));
  if (STAFF(ctx)) {
    const r = await projectRiskFor(pool, ctx, projectId, now);
    b.fact('Risk', `Risk level ${r.level} (the NW OS risk engine; the AI does not set it)`, 'Confirmed', src('project', projectId, 'projects'), r.basis);
    for (const s of r.reasons.slice(0, 10)) b.fact('Risk', `${s.dimension} (${s.level}): ${s.signal}${s.detail ? ` — ${s.detail}` : ''}`, 'Confirmed', s.entity_id ? src(s.entity_type ?? s.dimension.toLowerCase(), s.entity_id, s.tab) : src('project', projectId, 'projects'));
  }
  const items = ctx.can('work_items.view') ? ((await service.core.list(ctx, 'workItems', { project_id: projectId })) as Row[]) : [];
  if (items.length) {
    const by = (f: string) => Object.entries(items.reduce((m: Record<string, number>, w) => ((m[w[f] ?? '—'] = (m[w[f] ?? '—'] ?? 0) + 1), m), {})).map(([k, n]) => `${k} ${n}`).join(', ');
    b.fact('Progress', `${items.length} work item(s) — status: ${by('status')}; production: ${by('production_status')}; delivery: ${by('delivery_status')}; installation: ${by('installation_status')}`, 'Confirmed', src('project', projectId, 'work-items'));
    const today = now.toISOString().slice(0, 10);
    for (const w of items.filter((x) => x.required_date && x.required_date < today && !/complete|handed|installed/i.test(`${x.status} ${x.installation_status}`)).slice(0, 8)) b.fact('Deadlines', `${w.item_code} required ${w.required_date}, still ${w.status}`, 'Confirmed', src('work_item', w.id, 'work-items'));
    for (const w of items.filter((x) => x.required_date && x.required_date >= today).sort((a, c) => String(a.required_date).localeCompare(String(c.required_date))).slice(0, 5)) b.fact('Deadlines', `${w.item_code} required ${w.required_date} (${w.status})`, 'Confirmed', src('work_item', w.id, 'work-items'));
  }
  for (const o of (await safeList(service, ctx, 'productionOrders', { project_id: projectId })).filter((o) => !['Completed', 'Cancelled'].includes(o.status)).slice(0, 8)) b.fact('Production', `Production ${o.order_number ?? o.id}: ${o.status}${o.drawing_check === 'invalid' ? ` — drawing check failed: ${o.drawing_check_reason ?? ''}` : ''}`, 'Confirmed', src('production_order', o.id, 'production'));
  for (const d of (await safeList(service, ctx, 'deliveryRecords', { project_id: projectId })).filter((d) => !/delivered|confirmed|cancel/i.test(String(d.status))).slice(0, 6)) b.fact('Delivery', `Delivery ${d.delivery_number ?? d.id}: ${d.status}${d.delivery_date ? ` on ${d.delivery_date}` : ''}`, 'Confirmed', src('delivery', d.id, 'delivery'));
  for (const j of (await safeList(service, ctx, 'installationJobs', { project_id: projectId })).filter((j) => !/completed|cancel/i.test(String(j.status))).slice(0, 8)) b.fact('Installation', `Installation ${j.work_item_code ?? j.job_number ?? j.id}: ${j.status}${j.progress_percent != null ? `, ${j.progress_percent}%` : ''}`, 'Confirmed', src('installation', j.id, 'delivery'));
  for (const i of (await safeList(service, ctx, 'issues', { project_id: projectId })).filter((i) => !['Resolved', 'Closed'].includes(i.status)).slice(0, 10)) {
    b.fact('Issues', `Open ${i.priority ?? ''} issue "${i.title}" (${i.status})`, 'Confirmed', src('issue', i.id, 'issues'));
    b.untrusted(`Issue ${i.id} description`, i.description);
  }
  for (const d of (await safeList(service, ctx, 'drawings', { project_id: projectId })).slice(0, 20)) {
    const pending = (d.revisions ?? []).filter((r: Row) => ['Internal Review', 'Pending Review', 'Review'].includes(r.approved_status));
    for (const r of pending) b.fact('Approvals', `Drawing ${d.drawing_number} ${r.revision} awaiting review`, 'Confirmed', src('drawing', d.id, 'drawings'));
  }
  if (canSeeProjectFinancials(ctx.user.role) && ctx.can('commercial.view')) {
    try {
      const f = await profitability(pool, ctx, projectId);
      b.fact('Commercial', `Contract ${rm(f.current_contract_value)}; budget ${rm(f.estimated_direct_cost)}; committed ${rm(f.committed_cost)}; actual ${rm(f.actual_cost)}; forecast cost ${rm(f.forecast_final_cost)}; gross profit ${rm(f.project_gross_profit)} (${f.project_gross_margin_percent}%) — server calculation`, 'Confirmed', src('profitability', projectId, 'commercial'), f.basis.note);
    } catch {
      /* not visible to this role */
    }
  }
  // Recent changes: what the audit trail recorded this week (only for people who may read it).
  if (ctx.can('audit.view')) {
    const recent = (await pool.query(`SELECT action, entity_type, entity_id, actor_name, occurred_at FROM audit_logs WHERE project_id = $1 AND occurred_at > $2 AND action NOT LIKE 'ai.%' ORDER BY id DESC LIMIT 12`, [projectId, new Date(now.getTime() - 7 * 86400_000)])).rows;
    for (const a of recent) b.fact('Recent changes', `${new Date(a.occurred_at).toISOString().slice(0, 10)}: ${a.action} on ${a.entity_type} ${a.entity_id} by ${a.actor_name ?? 'NW OS'}`, 'Confirmed', { type: a.entity_type, id: a.entity_id, tab: 'projects', project_id: projectId });
    if (!recent.length) b.fact('Recent changes', 'No recorded changes in the last 7 days.', 'Confirmed', src('project', projectId, 'projects'));
  } else b.fact('Recent changes', 'The change history is not available to your role.', 'Unknown');
  await decisionsForMe(pool, ctx, b, { id: projectId, name: p.project_name });
}

// ------------------------------------------------------------------ issue / problem analysis

const MM = /(\d{3,5}(?:\.\d+)?)\s*mm\b/gi;
const numbersIn = (s: unknown) => [...String(s ?? '').matchAll(MM)].map((m) => Number(m[1]));

/**
 * A reported problem against the records it touches: the work item, its drawing revisions, the
 * production that may already have started and the site measurements. Known / conflicting /
 * missing information is determined here; the model only explains it.
 */
export async function issueContext(pool: Pool, service: DataService, ctx: AccessContext, b: PackBuilder, input: { issue_id?: unknown; text?: unknown; work_item_id?: unknown }) {
  let issue: Row | undefined;
  if (typeof input.issue_id === 'string' && input.issue_id) {
    issue = await safeGet(service, ctx, 'issues', input.issue_id);
    if (!issue) return false;
  }
  const report = String(issue?.description ?? issue?.title ?? '') + (typeof input.text === 'string' ? ` ${input.text}` : '');
  const item = await workItem(service, ctx, issue?.work_item_id ?? input.work_item_id);
  if (!issue && !item) return false;
  const projectId = (issue?.project_id ?? item?.project_id) as string;
  const src = (type: string, id: string, tab: string): Source => ({ type, id, tab, project_id: projectId });
  if (issue) b.fact('Report', `Issue "${issue.title}" — ${issue.status}, ${issue.priority ?? ''} ${issue.category ?? ''}, reported by ${issue.reported_by ?? 'unknown'}`, 'Confirmed', src('issue', issue.id, 'issues'));
  b.untrusted('Reported problem (as written by a person)', report);
  const reported = numbersIn(report);
  if (reported.length) b.fact('Report', `The report mentions ${reported.map((n) => `${n} mm`).join(', ')} (as reported, not verified)`, 'Probable', issue ? src('issue', issue.id, 'issues') : undefined, 'Text of the report');
  if (!item) {
    b.fact('Missing', 'No work item is linked, so the drawing and production status cannot be checked.', 'Unknown');
    return true;
  }
  b.fact('Work item', `${item.item_code} ${item.description ?? ''}: ${item.status}; production ${item.production_status}; installation ${item.installation_status}`, 'Confirmed', src('work_item', item.id, 'work-items'));
  // Recorded dimensions are millimetres ("2400 × 900 × 1050mm"): every 3–5 digit number counts.
  const recorded = [...String(item.dimensions ?? '').matchAll(/(?<!\d)(\d{3,5})(?!\d)/g)].map((m) => Number(m[1]));
  if (item.dimensions) b.fact('Work item', `Dimensions on the work item: ${item.dimensions} (drawing ${item.drawing_id ?? '—'} ${item.drawing_revision ?? ''})`, 'Confirmed', src('work_item', item.id, 'work-items'));
  // The drawing and its revisions (approved vs not).
  const drawing = item.drawing_id ? await safeGet(service, ctx, 'drawings', item.drawing_id) : undefined;
  if (drawing) {
    const approved = (drawing.revisions ?? []).filter((r: Row) => r.approved_status === 'Approved');
    const current = (drawing.revisions ?? []).find((r: Row) => r.is_current);
    b.fact('Drawing', `Drawing ${drawing.drawing_number}: current approved revision ${current?.revision ?? 'none'}${approved.length ? '' : ' (no approved revision)'}`, current ? 'Confirmed' : 'Unknown', src('drawing', drawing.id, 'drawings'));
    for (const r of (drawing.revisions ?? []).filter((x: Row) => x.approved_status !== 'Approved' && x.approved_status !== 'Superseded')) b.fact('Drawing', `Revision ${r.revision} is ${r.approved_status}: not an approved instruction`, 'Confirmed', src('drawing', drawing.id, 'drawings'));
    for (const n of drawing.nw_production_drawings ?? []) b.fact('Drawing', `NW production drawing ${n.revision ?? n.id}: ${n.status}${n.approved_for_production ? ', approved for production' : ', NOT approved for production'}`, 'Confirmed', src('drawing', drawing.id, 'drawings'));
  } else if (item.drawing_id) b.fact('Drawing', 'The linked drawing is not available to you.', 'Unknown');
  else b.fact('Missing', 'No drawing is linked to this work item.', 'Unknown');
  // Production already started?
  const orders = (await safeList(service, ctx, 'productionOrders', { work_item_id: item.id })).filter((o) => o.status !== 'Cancelled');
  const started = orders.filter((o) => !['Draft', 'Planned', 'Not Started', 'Pending'].includes(o.status));
  for (const o of orders) b.fact('Production', `Production ${o.order_number ?? o.id}: ${o.status}`, 'Confirmed', src('production_order', o.id, 'production'));
  if (!orders.length && ctx.can('production.view')) b.fact('Production', 'No production order for this work item.', 'Confirmed', src('work_item', item.id, 'work-items'));
  // Site measurements.
  const meas = await safeList(service, ctx, 'siteMeasurements', { work_item_id: item.id });
  for (const m of meas.slice(0, 5)) b.fact('Site', `Site measurement ${m.measured_at ?? m.date ?? ''}: ${m.measured_dimensions ?? m.dimensions ?? m.notes ?? JSON.stringify(m.measurements ?? '')}`.slice(0, 300), 'Confirmed', src('site_measurement', m.id, 'delivery'));
  if (!meas.length) b.fact('Missing', 'No verified site measurement is recorded for this work item.', 'Unknown');
  // Conflict: a reported figure that is not on the record.
  const conflict = reported.filter((n) => recorded.length && !recorded.includes(n));
  if (conflict.length) {
    b.fact('Conflict', `Potential drawing/site discrepancy: the report gives ${conflict.map((n) => `${n} mm`).join(', ')}; the work item records ${recorded.map((n) => `${n} mm`).join(', ')}`, 'Probable', src('work_item', item.id, 'work-items'), 'Reported figures compared with the recorded dimensions (not a verified measurement)');
    b.decision('Technical change review', `A dimension change needs the formal drawing / technical change review${started.length ? ' — production has already started' : ''}. The assistant never changes drawings or dimensions.`, src('work_item', item.id, 'drawings'));
  }
  if (started.length) b.fact('Impact', `Production has started (${started.map((o) => o.status).join(', ')}): a change may affect parts already made.`, 'Probable', src('production_order', started[0].id, 'production'), 'Production order status');
  const pm = (await pool.query('SELECT project_manager_id FROM projects WHERE id = $1', [projectId])).rows[0]?.project_manager_id;
  if (pm) await b.action(pool, ctx, 'create_task', { project_id: projectId, title: `Verify site measurement of ${item.item_code} against the approved drawing`, description: `Reported problem: ${report.trim().slice(0, 300)}`, assigned_user_id: pm, priority: conflict.length ? 'High' : 'Normal', due_date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10), ...(issue ? { issue_id: issue.id } : {}) });
  if (!issue && typeof input.text === 'string' && input.text.trim()) await b.action(pool, ctx, 'report_issue', { work_item_id: item.id, title: input.text.trim().slice(0, 120), description: input.text.trim(), category: conflict.length ? 'Site condition' : 'Installation', priority: conflict.length ? 'High' : 'Normal' });
  return true;
}

// ------------------------------------------------------------------ drawing intelligence

export async function drawingContext(pool: Pool, service: DataService, ctx: AccessContext, b: PackBuilder, drawingId: string) {
  const d = await safeGet(service, ctx, 'drawings', drawingId);
  if (!d) return false;
  const src: Source = { type: 'drawing', id: d.id, tab: 'drawings', project_id: d.project_id };
  b.fact('Drawing', `Drawing ${d.drawing_number} "${d.title ?? ''}" — status ${d.status ?? '—'}`, 'Confirmed', src);
  const revs = (d.revisions ?? []) as Row[];
  for (const r of revs) {
    b.fact('Revisions', `Client revision ${r.revision}: ${r.approved_status}${r.is_current ? ' (current approved)' : ''}${r.approved_status !== 'Approved' && r.approved_status !== 'Superseded' ? ' — not an approved instruction' : ''}`, 'Confirmed', src);
    const cmp = r.comparison_with_previous as Row | undefined;
    if (cmp) {
      const changes = (cmp.changes ?? cmp.differences ?? []) as Row[];
      const list = changes.map((c) => (typeof c === 'string' ? c : `${c.element ?? c.field ?? c.area ?? ''}: ${c.from ?? c.previous ?? c.old ?? ''} → ${c.to ?? c.current ?? c.new ?? ''}`)).join('; ');
      // A stored comparison is an AI interpretation unless a person reviewed it: Probable.
      b.fact('Changes', `Recorded comparison ${cmp.from_revision ?? cmp.previous_revision ?? 'previous'} → ${r.revision}: ${cmp.summary ?? ''} ${list}`.trim(), 'Probable', src, 'Stored drawing comparison (AI interpretation; verify against the drawings)');
      if (cmp.impact_level) b.fact('Changes', `Recorded impact level: ${cmp.impact_level}`, 'Probable', src, 'Stored drawing comparison');
    }
    if (r.ai_analysis) b.fact('Changes', `Revision ${r.revision} has an AI drawing analysis on record — an interpretation, never an approved production instruction.`, 'Probable', src, 'AI drawing analysis');
  }
  if (!revs.some((r) => r.comparison_with_previous)) b.fact('Changes', 'No revision comparison is recorded, so what changed between revisions is not known to NW OS.', 'Unknown');
  for (const n of (d.nw_production_drawings ?? []) as Row[]) b.fact('Production drawings', `NW production drawing ${n.revision ?? n.id}: ${n.status}${n.approved_for_production ? ', approved for production' : ', NOT approved for production'}${n.linked_client_revision ? ` (from client ${n.linked_client_revision})` : ''}`, 'Confirmed', src);
  const items = ctx.can('work_items.view') ? ((await service.core.list(ctx, 'workItems', { project_id: d.project_id })) as Row[]).filter((w) => w.drawing_id === d.id) : [];
  for (const w of items) b.fact('Affected work items', `${w.item_code} uses this drawing (revision ${w.drawing_revision ?? '—'}): production ${w.production_status}, installation ${w.installation_status}`, 'Confirmed', { type: 'work_item', id: w.id, tab: 'work-items', project_id: w.project_id });
  if (!items.length) b.fact('Affected work items', 'No work item you can see is linked to this drawing.', 'Unknown');
  const orders = (await safeList(service, ctx, 'productionOrders', { project_id: d.project_id })).filter((o) => items.some((w) => w.id === o.work_item_id) && o.status !== 'Cancelled');
  for (const o of orders) b.fact('Production impact', `Production ${o.order_number ?? o.id} for ${o.work_item_code ?? o.work_item_id}: ${o.status}${o.drawing_check === 'invalid' ? ` — drawing check failed: ${o.drawing_check_reason ?? ''}` : ''}`, 'Confirmed', { type: 'production_order', id: o.id, tab: 'production', project_id: o.project_id });
  const current = revs.find((r) => r.is_current);
  const newer = revs.filter((r) => !['Approved', 'Superseded', 'Rejected'].includes(r.approved_status));
  if (newer.length && orders.some((o) => !['Draft', 'Planned', 'Not Started'].includes(o.status))) {
    b.fact('Production impact', `A newer revision (${newer.map((r) => r.revision).join(', ')}) is under review while production has started from ${current?.revision ?? 'the approved revision'}.`, 'Probable', src, 'Revision status compared with production order status');
    b.decision(`Review drawing ${d.drawing_number} ${newer.map((r) => r.revision).join(', ')}`, 'Drawing approval is decided in Drawings by someone with authority; production keeps using the approved revision until then.', src);
  }
  const pm = (await pool.query('SELECT project_manager_id FROM projects WHERE id = $1', [d.project_id])).rows[0]?.project_manager_id;
  if (pm && newer.length) await b.action(pool, ctx, 'create_task', { project_id: d.project_id, title: `Check production impact of drawing ${d.drawing_number} ${newer.map((r) => r.revision).join(', ')}`, description: 'Compare the revision under review with the work already in production before it is approved.', assigned_user_id: pm, priority: 'High', due_date: new Date(Date.now() + 86400_000).toISOString().slice(0, 10) });
  return true;
}

// ------------------------------------------------------------------ commercial intelligence

/** Server-side figures only: profitability, cost by category, commitments, variations, alerts. */
export async function commercialContext(pool: Pool, service: DataService, ctx: AccessContext, b: PackBuilder, projectId: string) {
  const f = await profitability(pool, ctx, projectId); // throws 403 for roles without financial access
  const src = (type: string, id: string, tab = 'commercial'): Source => ({ type, id, tab, project_id: projectId });
  b.fact('Profit', `Contract ${rm(f.current_contract_value)} (pending variations ${rm(f.pending_variations_total)}); budget ${rm(f.estimated_direct_cost)}; committed ${rm(f.committed_cost)}; actual ${rm(f.actual_cost)}; forecast final cost ${rm(f.forecast_final_cost)}`, 'Confirmed', src('profitability', projectId), 'NW OS server calculation');
  b.fact('Profit', `Forecast gross profit ${rm(f.project_gross_profit)} (${f.project_gross_margin_percent}%); cost variance ${rm(f.cost_variance)} (${f.cost_variance_status})`, 'Confirmed', src('profitability', projectId), f.basis.note);
  if (f.estimated_direct_cost > 0 && f.forecast_final_cost > f.estimated_direct_cost) {
    const pct = Math.round(((f.forecast_final_cost - f.estimated_direct_cost) / f.estimated_direct_cost) * 1000) / 10;
    b.fact('Potential issues', `Potential issue: forecast cost is ${pct}% (${rm(f.forecast_final_cost - f.estimated_direct_cost)}) above budget. This is a variance to review, not a finding of error or wrongdoing.`, 'Probable', src('profitability', projectId), 'Forecast final cost compared with the budget (server figures)');
  }
  const ledger = await safeList(service, ctx, 'projectCostLedger', { project_id: projectId });
  const cats = new Map<string, number>();
  for (const l of ledger.filter((x) => ['Incurred', 'Reconciled', 'Committed'].includes(x.status))) cats.set(l.cost_category ?? 'Uncategorised', (cats.get(l.cost_category ?? 'Uncategorised') ?? 0) + Number(l.amount || 0));
  if (cats.size) b.fact('Cost by category', `Recorded cost by category (incurred + committed ledger lines): ${[...cats.entries()].sort((a, c) => c[1] - a[1]).map(([k, v]) => `${k} ${rm(v)}`).join(', ')}`, 'Confirmed', src('cost_ledger', projectId), 'Server sum of the project cost ledger');
  const pos = (await safeList(service, ctx, 'purchaseOrders', { project_id: projectId })).filter((p) => ['Issued', 'Partially Received', 'Goods Received', 'Completed'].includes(p.status)).sort((a, c) => Number(c.total_amount) - Number(a.total_amount));
  for (const p of pos.slice(0, 5)) b.fact('Commitments', `PO ${p.po_number ?? p.id} to ${p.supplier_name ?? '—'}: ${rm(p.total_amount)} (${p.status})`, 'Confirmed', src('purchase_order', p.id, 'purchasing'));
  for (const v of (await safeList(service, ctx, 'variations', { project_id: projectId })).filter((v) => !/approved|rejected|implemented|closed|cancel/i.test(String(v.status)))) b.fact('Variations', `Variation ${v.variation_number ?? v.id} "${v.title ?? ''}" awaiting ${v.status}: client amount ${rm(v.client_amount)}`, 'Confirmed', src('variation', v.id, 'variations'));
  for (const l of (await safeList(service, ctx, 'costLeakAlerts', { project_id: projectId })).filter((x) => !/resolved|closed/i.test(String(x.status)))) {
    b.fact('Potential issues', `Recorded cost alert: ${l.title} (${l.status})`, 'Confirmed', src('cost_leak_alert', l.id));
    b.untrusted(`Cost alert ${l.id}`, l.description);
  }
  return true;
}

// ------------------------------------------------------------------ portfolio risk (no project)

export async function portfolioContext(pool: Pool, ctx: AccessContext, b: PackBuilder, now: Date) {
  if (!STAFF(ctx)) return;
  const all = await portfolioRisk(pool, ctx, now);
  for (const r of all.slice(0, 15)) b.fact(r.level === 'Critical' ? 'Critical' : r.level === 'On Track' ? 'On track' : 'Attention', `${r.project_name}: ${r.level}${r.reasons.length ? ` — ${r.reasons.slice(0, 3).map((x) => x.signal).join('; ')}` : ''}`, 'Confirmed', { type: 'project', id: r.project_id, tab: 'projects', project_id: r.project_id });
}

// ------------------------------------------------------------------ decision traceability (Batch 8)

const rmText = (n: unknown) => `RM ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const day = (v: unknown) => (v ? String(v).slice(0, 10) : null);

/**
 * "Why was VO-002 approved?" — answered only from the decision's persisted, decision-time record
 * (the same server-side access check as the trace screen). Never from today's rules: when a
 * decision has no snapshot, the reason is stated as not established from the available record.
 */
export async function traceContext(pool: Pool, ctx: AccessContext, b: PackBuilder, question: string) {
  const refs = [...new Set(question.toUpperCase().match(/\b[A-Z]{1,6}-[A-Z0-9][A-Z0-9-]{1,30}\b/g) ?? [])].slice(0, 5);
  const found: { kind: 'approval' | 'variation' | 'purchase_order' | 'invoice' | 'drawing_revision'; id: string }[] = [];
  for (const ref of refs) {
    const hits = (
      await pool.query(
        `SELECT 'approval' AS kind, id FROM approvals WHERE upper(data->>'approval_number') = $1 OR upper(id) = $1
         UNION ALL SELECT 'variation', id FROM variations WHERE upper(data->>'variation_number') = $1 OR upper(id) = $1
         UNION ALL SELECT 'purchase_order', id FROM purchase_orders WHERE upper(data->>'po_number') = $1 OR upper(id) = $1
         UNION ALL SELECT 'invoice', id FROM commercial_invoices WHERE upper(data->>'invoice_number') = $1 OR upper(id) = $1
         UNION ALL SELECT 'drawing_revision', r.id FROM drawing_revisions r JOIN drawings d ON d.id = r.drawing_id
           WHERE upper(d.data->>'drawing_number') = $1 AND r.approval_status IN ('Approved', 'Rejected') AND (r.is_current OR r.kind = 'nw_production')
         LIMIT 5`,
        [ref]
      )
    ).rows;
    for (const h of hits) found.push(h);
  }
  let any = false;
  for (const f of found) {
    const t = await decisionTrace(pool, ctx, f.kind, f.id);
    if (!t) continue; // not visible = not found
    any = true;
    const src: Source = { type: f.kind, id: f.id, tab: f.kind === 'drawing_revision' ? 'drawings' : f.kind === 'variation' ? 'variations' : f.kind === 'approval' ? 'approvals' : 'purchasing', project_id: t.project_id };
    b.fact('Decision record', `${t.title}: requested by ${t.requester?.name ?? 'unknown (not on the record)'}; ${t.pending ? 'still pending' : 'decided'}.`, 'Confirmed', src, 'The decision record');
    if (!t.decisions.length) {
      b.fact('Decision record', t.pending ? `No decision has been taken yet${t.current_route ? `; it is with ${t.current_route.assignee.name} (${t.current_route.assignee.role})` : ''}.` : 'No recorded decision with its authority exists for this record, so why it was decided cannot be established from the available record.', t.pending ? 'Confirmed' : 'Unknown', src);
    }
    for (const d of t.decisions) {
      const who = `${d.decided_by.name ?? d.decided_by.id} (${d.decided_by.role ?? 'role not recorded'})`;
      if (d.consent === 'client') {
        b.fact('Decision record', `${d.outcome} by ${who} on ${day(d.at)} as the client's own decision (client consent${d.consent_recorded_by === 'staff' ? `, recorded by staff${d.reference ? ' with a reference' : ''}` : ''}), not an internal authority approval.`, 'Confirmed', src, 'Decision-time record (append-only audit)');
        continue;
      }
      if (!d.terms_recorded || !d.trace) {
        b.fact('Decision record', `${d.outcome} by ${who} on ${day(d.at)}${d.matched_rule_code ? ` under ${d.matched_rule_code}` : ''}. The authority terms that applied were not recorded with this decision (it predates decision traceability), so the reason cannot be established from the available record.`, 'Unknown', src);
        continue;
      }
      const tr = d.trace as Record<string, any>;
      const r = tr.rule as Record<string, any> | null;
      const terms = r
        ? [
            r.project_name ? `project ${r.project_name}` : r.client_name ? `client ${r.client_name}` : 'all projects in scope',
            r.min_value !== null || r.max_value !== null ? `value ${r.min_value !== null ? rmText(r.min_value) : 'RM 0'}–${r.max_value !== null ? rmText(r.max_value) : 'no upper limit'}` : 'no value limit',
            r.max_risk ? `risk up to ${r.max_risk}` : 'no risk limit',
            r.start_at || r.end_at ? `effective ${day(r.start_at) ?? 'from the start'} to ${day(r.end_at) ?? 'no end date'}` : 'no end date',
          ].join('; ')
        : null;
      b.fact(
        'Decision record',
        `${d.outcome} by ${who} on ${day(d.at)}. Authority: ${tr.authority_type}${r ? ` — rule ${r.code}${r.name ? ` "${r.name}"` : ''} (${terms})` : ''}. Permission: ${tr.permission ?? 'not recorded'}. Project sensitivity: ${tr.decision?.sensitivity ?? 'not recorded'}.${tr.value ? ` Decision value: ${rmText(tr.value.amount)}.` : ''} Why it was allowed (resolver): ${tr.reason}.`,
        'Confirmed',
        src,
        'Decision-time record (append-only audit), not the current rules'
      );
      if (d.comments) b.untrusted(`Comment on ${t.title}`, d.comments);
    }
    for (const c of t.current_rule_status) {
      if (!c.in_force_now || c.changed_since) b.fact('Current rule status', `Today, rule ${c.code} is ${c.in_force_now ? 'in force but has been edited since this decision' : `no longer in force${c.deactivation_reason ? ` (${c.deactivation_reason})` : ''}`}. This does not change the past decision, which was made under the terms recorded at the time.`, 'Confirmed', { type: 'delegated_authority', id: c.id, tab: 'authority', project_id: null });
    }
  }
  if (!any) b.fact('Decision record', 'No decision record you can see matches this question, so the reason cannot be established from the available record.', 'Unknown');
}
