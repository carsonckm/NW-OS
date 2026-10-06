/**
 * NW OS Operating Assistant (server side).
 *
 * Answers from live NW OS records only, retrieved with the asking user's own AccessContext
 * (the same RBAC, project scope, client/contractor isolation and financial restrictions as
 * the screens). Nothing the browser sends about the user, their role or their data is used.
 *
 * Every statement carries a confidence label:
 *   Confirmed  read directly from a record (the source is linked)
 *   Probable   a rule-based inference from confirmed records (the basis is stated)
 *   Unknown    NW OS has no record that answers it — the assistant says so and stops
 * It never invents figures, dimensions or dates. It recommends; consequential actions are
 * only *proposed* (AI proposes → a human approves → the system executes), and the forbidden
 * actions are refused outright.
 */
import { randomUUID } from 'crypto';
import { ForbiddenError, type AccessContext } from '../auth/access';
import { canSeeProjectFinancials } from '../auth/permissions';
import { writeAudit, type AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { People } from '../automation/people';
import { AI_FORBIDDEN_ACTIONS } from './automation';
import { PROPOSAL_ACTIONS, type ProposalAction } from './assistantActions';
import { dailyBriefing } from './briefing';
import { computeProfitability } from './reports';
import { portfolioRisk, projectRiskFor, type ProjectRisk, type RiskSignal } from './risk';

type Row = Record<string, any>;
export type Confidence = 'Confirmed' | 'Probable' | 'Unknown';
export interface Source {
  type: string;
  id: string;
  tab: string;
  project_id?: string | null;
}
export interface Fact {
  text: string;
  confidence: Confidence;
  source?: Source;
  basis?: string;
}
export interface Proposal {
  action: ProposalAction;
  label: string;
  params: Row;
}
export interface Recommendation {
  text: string;
  /** Recommendations are suggestions: a person decides. */
  decided_by: 'human';
  proposal?: Proposal;
}
export interface AssistantAnswer {
  id: string;
  question: string;
  intent: string;
  answer: string;
  facts: Fact[];
  recommendations: Recommendation[];
  refused?: string;
  project?: { id: string; name: string } | null;
  principle: string;
  generated_at: string;
}

const PRINCIPLE = 'AI proposes → a human approves → the system executes. Answers come only from records you are allowed to see.';
const UNKNOWN = "I don't have records in NW OS that answer this, so I won't guess. Please check with the Project Manager or the relevant record.";

/** Requests the assistant must never act on (matched before anything is looked up). */
const FORBIDDEN: { re: RegExp; what: string; where: string }[] = [
  { re: /\b(approve|approval of|sign[ -]?off|lulus|批准)\b.*\b(drawing|revision|lukisan|图纸)/i, what: 'Approve drawings', where: 'Drawings → review the revision' },
  { re: /\b(approve|accept|lulus|批准)\b.*\b(variation|vo\b|change order)/i, what: 'Approve variations', where: 'Variations' },
  { re: /\b(approve|authori[sz]e|lulus|批准)\b.*\b(purchase|po\b|order|invoice|payment|spend)/i, what: 'Approve major purchases', where: 'Approvals / Commercial' },
  { re: /\b(change|update|modify|adjust|ubah|tukar|修改|改)\b.*\b(dimension|size|measurement|length|width|height|saiz|ukuran|尺寸)/i, what: 'Change technical dimensions', where: 'Raise a technical change for the drawing owner' },
  { re: /\b(change|switch|swap|substitute|replace|use .+ instead|ubah|tukar|修改)\b.*\b(material|finish|laminate|veneer|plywood|mdf|bahan|材料)|\b(material|finish|bahan)\b.*\b(change|swap|substitute|replace)/i, what: 'Change approved materials', where: 'Raise a technical change / variation' },
  { re: /^(?=.*\b(promise|commit|guarantee|confirm|tell|inform|janji|beritahu)\b)(?=.*\b(client|customer|pelanggan)\b)(?=.*\b(date|deadline|handover|completion|ready|tarikh|siap)\b)/is, what: 'Promise dates to clients', where: 'The Project Manager agrees and communicates dates' },
  { re: /\b(salary|bonus|commission|raise|pay rise|compensation|gaji|komisen|工资|奖金)\b/i, what: 'Approve compensation', where: 'Owner / HR' },
  { re: /\b(safe|safety|keselamatan|安全)\b.*\b(decide|ok|okay|approve|proceed|allow|boleh)|\b(is it safe|selamat ke)/i, what: 'Make safety-critical decisions', where: 'The Site Supervisor / safety officer decides on site' },
  { re: /\b(give|grant|add|elevate)\b.*\b(access|permission|role|admin)\b|\boverride\b.*\b(permission|access|lock)/i, what: 'Override permissions', where: 'Admin → Users (a person grants access)' },
];

const INTENTS: { intent: string; re: RegExp }[] = [
  { intent: 'finance', re: /\b(profit|margin|cost|budget|cash ?flow|invoice|payment|revenue|untung|kos|bajet|利润|成本)\b/i },
  { intent: 'risk', re: /\b(risk|at risk|critical|health|why .*(late|behind|delay|red)|behind schedule|delayed|risiko|lewat|风险)\b/i },
  { intent: 'knowledge', re: /\b(how (do|to|should|can) (we|i)|procedure|standard|best practice|lessons?|sop|knowledge|recommended way|cara|bagaimana|怎么)\b/i },
  { intent: 'work_item', re: /\b[A-Z]{2,5}-\d{2,4}\b/ },
  { intent: 'tasks', re: /\b(my tasks?|overdue|to ?do|what should i do|tugas|任务)\b/i },
  { intent: 'today', re: /\b(today|needs? me|decide|decisions?|pending|waiting for me|briefing|hari ini|今天)\b/i },
];

const RECOMMEND: Partial<Record<RiskSignal['dimension'], string>> = {
  Schedule: 'Agree a recovery plan internally before any date is given to the client.',
  Production: 'Clear the production blocker with the Production Manager (drawing, material or machine).',
  Materials: 'Ask Purchasing to raise the purchase order or confirm an alternative supply date.',
  Site: 'Confirm the revised delivery / installation sequence with the site team and contractor.',
  Quality: 'Make sure the rectification task is progressing and book the re-inspection.',
  Commercial: 'Review the cost report with the Accountant; any recovery needs a person to decide.',
  Client: 'Follow up the outstanding client decisions (the PM contacts the client).',
  Issues: 'Review the open critical / high issues and confirm each has an owner.',
};

export class Assistant {
  constructor(private pool: Pool) {}

  async ask(ctx: AccessContext, actor: AuditActor, input: { question?: unknown; project_id?: unknown }, now = new Date()): Promise<AssistantAnswer> {
    if (!ctx.can('ai.assistant')) throw new ForbiddenError('Missing permission: ai.assistant');
    const question = typeof input.question === 'string' ? input.question.trim().slice(0, 1000) : '';
    if (!question) throw new ForbiddenError('Ask a question');
    const base = { id: `ask-${randomUUID()}`, question, principle: PRINCIPLE, generated_at: now.toISOString(), facts: [] as Fact[], recommendations: [] as Recommendation[] };
    const project = await this.resolveProject(ctx, question, input.project_id);

    let out: AssistantAnswer;
    const forbidden = FORBIDDEN.find((f) => f.re.test(question));
    if (forbidden) {
      out = {
        ...base,
        intent: 'refused',
        project,
        refused: forbidden.what,
        answer: `I can't do that. "${forbidden.what}" is a decision for a person, not the assistant. Where to do it: ${forbidden.where}.`,
        facts: [{ text: `The assistant never performs: ${AI_FORBIDDEN_ACTIONS.join('; ')}.`, confidence: 'Confirmed', basis: 'NW OS automation policy' }],
      };
    } else {
      const intent = INTENTS.find((i) => i.re.test(question))?.intent ?? 'unknown';
      out = { ...base, intent, project, answer: '' };
      if (intent === 'finance') await this.finance(ctx, out, project);
      else if (intent === 'risk') await this.risk(ctx, out, project, now);
      else if (intent === 'knowledge') await this.knowledge(ctx, out, question);
      else if (intent === 'work_item') await this.workItem(ctx, out, question);
      else if (intent === 'tasks') await this.tasks(ctx, out, now);
      else if (intent === 'today') await this.today(ctx, out, now);
      else {
        out.answer = UNKNOWN;
        out.facts.push({ text: 'No NW OS record matched this question. I can answer about project risk, your tasks, what needs you today, work item status (by code) and — if your role allows — project financials.', confidence: 'Unknown' });
      }
    }
    // What the assistant read is audited (no answer text: it may contain restricted data).
    await writeAudit(this.pool, actor, {
      action: 'ai.query',
      entityType: 'assistant',
      entityId: out.id,
      projectId: out.project?.id ?? null,
      after: { question, intent: out.intent, refused: out.refused ?? null, sources: out.facts.filter((f) => f.source).map((f) => `${f.source!.type}:${f.source!.id}`) },
    });
    return out;
  }

  /** The project the question is about: the selected one, or one named in the question — only if visible. */
  private async resolveProject(ctx: AccessContext, question: string, selected: unknown) {
    const rows = (await this.pool.query('SELECT id, project_name, project_number FROM projects ORDER BY id')).rows.filter((p) => ctx.canSeeProject(p.id));
    const q = question.toLowerCase();
    const named = rows.find((p) => (p.project_number && q.includes(String(p.project_number).toLowerCase())) || (p.project_name && q.includes(String(p.project_name).toLowerCase())));
    const pick = named ?? rows.find((p) => p.id === selected);
    return pick ? { id: pick.id as string, name: pick.project_name as string } : null;
  }

  private async risk(ctx: AccessContext, out: AssistantAnswer, project: AssistantAnswer['project'], now: Date) {
    if (['Client', 'Contractor'].includes(ctx.user.role)) {
      out.answer = 'Project risk assessments are internal to NW. Please ask your NW Project Manager.';
      out.facts.push({ text: 'Risk information is not available to your role.', confidence: 'Confirmed', basis: 'Role permissions' });
      return;
    }
    if (!project) {
      const all = (await portfolioRisk(this.pool, ctx, now)).filter((r) => r.level !== 'On Track');
      out.answer = all.length ? `${all.length} of your projects need attention. Ask about one by name for the reasons.` : 'None of your open projects shows a risk signal right now.';
      for (const r of all.slice(0, 8)) out.facts.push({ text: `${r.project_name}: ${r.level} — ${r.reasons.slice(0, 2).map((x) => x.signal).join('; ')}`, confidence: 'Confirmed', source: { type: 'project', id: r.project_id, tab: 'projects', project_id: r.project_id } });
      return;
    }
    const r = await projectRiskFor(this.pool, ctx, project.id, now);
    out.answer = r.level === 'On Track' ? `${r.project_name} is On Track: no risk signal in its records.` : `${r.project_name} is ${r.level} because of ${r.reasons.length} signal(s) in its records.`;
    for (const s of r.reasons) {
      out.facts.push({ text: `${s.dimension} (${s.level}): ${s.signal} — ${s.detail}`, confidence: 'Confirmed', source: { type: s.entity_type ?? s.dimension.toLowerCase(), id: s.entity_id ?? project.id, tab: s.tab, project_id: project.id } });
    }
    if (r.level !== 'On Track') out.facts.push({ text: `The level is the worst signal; three At Risk signals make it Critical.`, confidence: 'Confirmed', basis: r.basis });
    for (const f of this.inferences(r)) out.facts.push(f);
    out.recommendations = await this.recommendations(ctx, r, now);
  }

  /** Rule-based inferences, always labelled Probable with their basis. */
  private inferences(r: ProjectRisk): Fact[] {
    const dims = new Set(r.reasons.map((s) => s.dimension));
    const out: Fact[] = [];
    if (dims.has('Production') && dims.has('Site')) out.push({ text: 'Site delays are probably downstream of the production problems.', confidence: 'Probable', basis: 'Production and site signals on the same project' });
    if (dims.has('Materials') && dims.has('Production')) out.push({ text: 'Production is probably waiting on the material shortage.', confidence: 'Probable', basis: 'Material shortage and production signals on the same project' });
    if (r.level === 'Critical' || (dims.has('Schedule') && r.reasons.some((s) => s.dimension === 'Schedule' && s.level !== 'Attention'))) {
      out.push({ text: 'The planned completion date is probably at risk.', confidence: 'Probable', basis: 'Schedule signals at At Risk or above' });
    }
    for (const s of r.reasons.filter((x) => !x.detail)) out.push({ text: `The cause of "${s.signal}" is not recorded in NW OS.`, confidence: 'Unknown' });
    return out;
  }

  private async recommendations(ctx: AccessContext, r: ProjectRisk, now: Date): Promise<Recommendation[]> {
    const out: Recommendation[] = [];
    const canPropose = ctx.can('approvals.request');
    const people = canPropose ? await People.load(this.pool) : undefined;
    const due = new Date(now.getTime() + 86400_000).toISOString().slice(0, 10);
    const seen = new Set<string>();
    for (const s of r.reasons) {
      const text = RECOMMEND[s.dimension];
      if (!text || seen.has(s.dimension)) continue;
      seen.add(s.dimension);
      const rec: Recommendation = { text, decided_by: 'human' };
      if (people && s.entity_type === 'task' && s.entity_id) {
        rec.proposal = { action: 'remind_task_assignee', label: PROPOSAL_ACTIONS.remind_task_assignee, params: { task_id: s.entity_id } };
      } else if (people && s.entity_type === 'production_order' && s.entity_id) {
        const order = (await this.pool.query(`SELECT data->>'production_manager_id' AS pm, data->>'order_number' AS number FROM production_orders WHERE id = $1`, [s.entity_id])).rows[0];
        const assignee = people.isActive(order?.pm) ? order.pm : await byRole(people, 'production.create_orders', r.project_id, 'Production Manager');
        if (assignee) rec.proposal = { action: 'create_task', label: PROPOSAL_ACTIONS.create_task, params: { project_id: r.project_id, title: `Clear blocker on production ${order?.number ?? s.entity_id}`, description: `${s.signal}: ${s.detail}`, assigned_user_id: assignee, due_date: due, priority: 'High', production_order_id: s.entity_id } };
      } else if (people && s.entity_type === 'material_request' && s.entity_id) {
        const buyer = await byRole(people, 'purchasing.create', r.project_id, 'Purchasing');
        if (buyer) rec.proposal = { action: 'create_task', label: PROPOSAL_ACTIONS.create_task, params: { project_id: r.project_id, title: 'Raise PO for the late material request', description: `${s.signal}: ${s.detail}`, assigned_user_id: buyer, due_date: due, priority: 'High' } };
      }
      out.push(rec);
    }
    return out;
  }

  /** Approved (published) articles only: drafts and archived revisions are never cited. */
  private async knowledge(ctx: AccessContext, out: AssistantAnswer, question: string) {
    if (!ctx.can('knowledge.view')) {
      out.answer = 'The knowledge base is not available to your role.';
      out.facts.push({ text: 'Knowledge base access needs knowledge.view.', confidence: 'Confirmed', basis: 'Role permissions' });
      return;
    }
    const STOP = new Set(['how', 'should', 'what', 'when', 'where', 'which', 'with', 'this', 'that', 'there', 'their', 'have', 'from', 'about', 'procedure', 'standard', 'best', 'practice', 'lesson', 'lessons', 'knowledge', 'recommended', 'way', 'the', 'for', 'and', 'can', 'our']);
    const words = [...new Set(question.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])].filter((w) => !STOP.has(w));
    const rows = (await this.pool.query(`SELECT id, category, revision, data FROM knowledge_articles WHERE status = 'Approved'`)).rows;
    const scored = rows
      .map((r) => {
        const hay = [r.data.title, r.data.problem, r.data.solution, r.data.procedure, r.data.description, r.category, ...(r.data.tags ?? [])].join(' ').toLowerCase();
        return { r, score: words.filter((w) => hay.includes(w)).length };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
    if (!scored.length) {
      out.answer = 'No approved NW knowledge covers this. Drafts are not official, so I won\'t quote them — ask the Production Manager, and consider writing it up.';
      out.facts.push({ text: 'No approved knowledge article matched.', confidence: 'Unknown' });
      return;
    }
    out.answer = `${scored.length} approved NW article(s) apply. Only approved knowledge is official.`;
    for (const { r } of scored) {
      const body = r.data.solution || r.data.description || '';
      out.facts.push({ text: `${r.data.title} (${r.category}, rev ${r.revision}): ${body}${r.data.procedure ? ` Procedure: ${r.data.procedure}` : ''}`, confidence: 'Confirmed', source: { type: 'knowledge', id: r.id, tab: 'knowledge', project_id: null } });
    }
  }

  private async finance(ctx: AccessContext, out: AssistantAnswer, project: AssistantAnswer['project']) {
    if (!canSeeProjectFinancials(ctx.user.role) || !ctx.can('commercial.view')) {
      out.answer = 'Financial information is not available to your role.';
      out.facts.push({ text: 'Project costs, margins and budgets are restricted to commercial roles.', confidence: 'Confirmed', basis: 'Role permissions' });
      return;
    }
    if (!project) {
      out.answer = 'Which project? Name it (or open it first) and ask again.';
      out.facts.push({ text: 'No project was named or selected.', confidence: 'Unknown' });
      return;
    }
    const p = await computeProfitability(this.pool, project.id);
    const rm = (n: number) => `RM ${Math.round(n).toLocaleString('en-US')}`;
    const src: Source = { type: 'profitability', id: project.id, tab: 'commercial', project_id: project.id };
    out.answer = `${project.name}: forecast gross profit ${rm(p.project_gross_profit)} (${p.project_gross_margin_percent}%) on a current contract of ${rm(p.current_contract_value)}.`;
    out.facts.push(
      { text: `Current contract value ${rm(p.current_contract_value)}`, confidence: 'Confirmed', source: src },
      { text: `Budget (estimated direct cost) ${rm(p.estimated_direct_cost)}; committed ${rm(p.committed_cost)}; actual ${rm(p.actual_cost)}`, confidence: 'Confirmed', source: src },
      { text: `Forecast final cost ${rm(p.forecast_final_cost)}; gross profit ${rm(p.project_gross_profit)} (gross, before overheads)`, confidence: 'Confirmed', source: src }
    );
  }

  private async workItem(ctx: AccessContext, out: AssistantAnswer, question: string) {
    const codes = [...new Set(question.match(/\b[A-Z]{2,5}-\d{2,4}\b/g) ?? [])];
    const rows = (await this.pool.query('SELECT * FROM work_items WHERE item_code = ANY($1) ORDER BY id', [codes])).rows.filter((w) => ctx.canView('workItems', w));
    if (!rows.length) {
      // Same answer whether the item doesn't exist or isn't visible: nothing leaks.
      out.answer = `I can't find ${codes.join(', ')} among the work items you can see.`;
      out.facts.push({ text: `No visible work item matches ${codes.join(', ')}.`, confidence: 'Unknown' });
      return;
    }
    out.answer = rows.map((w) => `${w.item_code}: ${w.status} (production ${w.production_status}, delivery ${w.delivery_status}, installation ${w.installation_status})`).join(' · ');
    for (const w of rows) {
      const src: Source = { type: 'work_item', id: w.id, tab: 'work-items', project_id: w.project_id };
      out.facts.push({ text: `${w.item_code} ${w.description}: ${w.status}; production ${w.production_status}; delivery ${w.delivery_status}; installation ${w.installation_status}`, confidence: 'Confirmed', source: src });
      if (w.dimensions) {
        out.facts.push({ text: `Dimensions as recorded on the work item: ${w.dimensions} (drawing ${w.drawing_id ?? '—'} ${w.drawing_revision ?? ''}). Build only from the approved drawing; I do not calculate or change dimensions.`, confidence: 'Confirmed', source: src });
      }
      if (w.required_date) out.facts.push({ text: `Required date on record: ${w.required_date}`, confidence: 'Confirmed', source: src });
    }
  }

  private async tasks(ctx: AccessContext, out: AssistantAnswer, now: Date) {
    const today = now.toISOString().slice(0, 10);
    const rows = (
      await this.pool.query(`SELECT id, project_id, due_date, status, priority, data->>'title' AS title FROM tasks WHERE assigned_user_id = $1 AND status NOT IN ('Completed', 'Cancelled') ORDER BY due_date NULLS LAST LIMIT 20`, [ctx.user.id])
    ).rows.filter((t) => !t.project_id || ctx.canSeeProject(t.project_id));
    const late = rows.filter((t) => t.due_date && t.due_date < today);
    out.answer = rows.length ? `You have ${rows.length} open task(s), ${late.length} overdue.` : 'You have no open tasks.';
    for (const t of rows) out.facts.push({ text: `${t.title} — ${t.status}, ${t.priority}${t.due_date ? `, due ${t.due_date}${t.due_date < today ? ' (overdue)' : ''}` : ''}`, confidence: 'Confirmed', source: { type: 'task', id: t.id, tab: 'automation', project_id: t.project_id } });
  }

  private async today(ctx: AccessContext, out: AssistantAnswer, now: Date) {
    if (['Client', 'Contractor'].includes(ctx.user.role)) return this.tasks(ctx, out, now);
    const b = await dailyBriefing(this.pool, ctx, now);
    const add = (items: { label: string; detail: string; tab: string; project_id: string | null; entity_type?: string; entity_id?: string }[], prefix: string) => {
      for (const i of items) out.facts.push({ text: `${prefix}: ${i.label} — ${i.detail}`, confidence: 'Confirmed', source: i.entity_id ? { type: i.entity_type ?? 'record', id: i.entity_id, tab: i.tab, project_id: i.project_id } : undefined });
    };
    add(b.decisions as Row[] as never, 'Decision');
    add(b.today.tasks_overdue, 'Overdue');
    add(b.today.tasks_due, 'Due today');
    add(b.today.production_blocked, 'Blocked');
    add(b.today.material_shortages, 'Material');
    const counts = [`${b.decisions.length} decision(s) waiting for you`, `${b.today.tasks_overdue.length} overdue task(s)`, `${b.today.tasks_due.length} due today`, `${b.today.production_blocked.length} production blocker(s)`];
    out.answer = `Today: ${counts.join(', ')}.`;
    for (const r of b.risks.slice(0, 5)) out.facts.push({ text: `${r.project_name} is ${r.level}: ${r.reasons.slice(0, 2).join('; ')}`, confidence: 'Confirmed', source: { type: 'project', id: r.project_id, tab: 'projects', project_id: r.project_id } });
  }
}

/** Someone in `role` who holds `permission` on the project (else anyone who does, except owners). */
async function byRole(people: People, permission: Parameters<People['withPermission']>[0], projectId: string, role: string) {
  const ids = await people.withPermission(permission, projectId, people.owners());
  return ids.find((id) => people.user(id)?.role === role) ?? ids[0];
}
