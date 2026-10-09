/**
 * NW OS AI features on top of the gateway: the assistant, the daily briefing, project summaries,
 * issue, drawing and commercial analysis, and acting on suggested actions.
 *
 * Each feature (1) checks the caller's permissions, (2) builds its context pack from the caller's
 * own scope (context.ts), (3) runs one versioned task through the gateway. Suggested actions are
 * proposed through the existing AI Proposal approval (assistantActions.raiseProposal): a person
 * approves it and the server executes it with that person's permissions. The AI never approves.
 */
import { ForbiddenError, type AccessContext } from '../auth/access';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import type { Pool } from '../db/pool';
import { Assistant, forbiddenRequest } from '../modules/assistant';
import { raiseProposal, validateProposal, type ProposalAction } from '../modules/assistantActions';
import { AI_FORBIDDEN_ACTIONS } from '../modules/automation';
import { DataService } from '../modules/service';
import { authorityContext, commercialContext, drawingContext, issueContext, overviewContext, PackBuilder, portfolioContext, projectContext, visibleProject } from './context';
import { AIGateway, type AIResponse } from './gateway';

type Row = Record<string, any>;
/** 404 with a plain message (missing and out of scope look the same). */
const notFound = (what: string) => {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
};

/** Requests about authority the assistant must refuse (on top of the Phase 5 list). */
const AUTHORITY_FORBIDDEN: { re: RegExp; what: string; where: string }[] = [
  { re: /\b(grant|give|create|add|set ?up|extend|delegate|assign)\b.*\b(authority|delegation|approval (rights?|limit)|temporary authority|absence)\b|\b(delegate|hand over)\b.*\b(approv\w*)\b/i, what: 'Grant or change approval authority', where: 'Delegated Authority (the Owner previews and confirms every rule)' },
  { re: /\b(reject|decline|turn down|refuse)\b.*\b(drawing|revision|variation|vo\b|purchase|po\b|invoice|approval|request)\b/i, what: 'Reject approvals', where: 'The approval itself, by a person with authority' },
  { re: /\b(approve|sign off)\b.*\b(technical change|safety|scope change|date change|request)\b/i, what: 'Approve technical, safety, scope or date decisions', where: 'Approvals, by a person with authority' },
  { re: /\b(tell|promise|commit|confirm|send|email|whatsapp|message)\b.*\b(supplier|contractor|vendor)\b.*\b(order|price|date|payment|commit)/i, what: 'Make commitments to suppliers or contractors', where: 'Purchasing / the Project Manager' },
];
/** A question about who may decide ("Who can approve this variation?") asks for information, not an action. */
const ASKS_ABOUT_AUTHORITY = /^\s*(who|whom|which|what|why|how|when|is|are|does|do|show|list|explain|tell me|(can|could|may)\s+(i|we|anyone|someone|my|the|he|she|they)\b).*\b(can|may|should|could|will|allowed to|approves?|decides?|authority|eligible)\b/i;
const ASKS_AI_TO_ACT = /\b(you|the ai|assistant|nw os)\s+(please\s+)?(approve|reject|grant|delegate|sign)\b|^\s*(please\s+)?(approve|reject|grant|delegate)\b/i;
function refusal(question: string) {
  // Information about authority is answered from the resolver; a request for the AI to act is refused.
  if (ASKS_ABOUT_AUTHORITY.test(question) && !ASKS_AI_TO_ACT.test(question)) return undefined;
  return AUTHORITY_FORBIDDEN.find((f) => f.re.test(question)) ?? forbiddenRequest(question);
}

const AUTHORITY_Q = /\b(who (can|may|should|will) (approve|decide|sign)|who approves|authority|delegat\w*|absen\w*|away|backup|my team (can )?handle|coverage|temporary|resolver|can .* approve)\b/i;
const OVERVIEW_Q = /\b(today|briefing|attention|important|blocking|blocked|overdue|deliver\w*|qc|quality|issues?|problems?|risks?|changed|this week|tomorrow|waiting|pending|decisions?|need to know|what's happening|status)\b/i;
const DRAWING_Q = /\b(drawing|revision|rev\.? ?\d+|rev [a-z0-9]+)\b/i;

export class AIService {
  readonly gateway: AIGateway;
  readonly data: DataService;
  private assistant: Assistant;
  constructor(private pool: Pool) {
    this.gateway = new AIGateway(pool);
    this.data = new DataService(pool);
    this.assistant = new Assistant(pool);
  }

  private need(ctx: AccessContext) {
    if (!ctx.can('ai.assistant')) throw new ForbiddenError('Missing permission: ai.assistant');
  }

  /** "Ask NW OS anything": the Phase 5 record-based answer, widened with the user's operating context. */
  async ask(ctx: AccessContext, actor: AuditActor, body: Row, now = new Date()): Promise<AIResponse> {
    this.need(ctx);
    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 1000) : '';
    if (!question) throw new ValidationError('Ask a question');
    const project = await visibleProject(this.pool, ctx, body.project_id);
    const b = new PackBuilder(project);
    const forbidden = refusal(question);
    if (forbidden) {
      b.pack.fallback = `I can't do that. "${forbidden.what}" is a decision for a person, not the AI. Where to do it: ${forbidden.where}.`;
      b.fact('Policy', `The AI never performs: ${[...AI_FORBIDDEN_ACTIONS, 'grant or change authority', 'reject approvals'].join('; ')}.`, 'Confirmed', undefined, 'NW OS AI policy');
      return this.gateway.run(ctx, actor, { task: 'assistant_query', question, pack: b.pack, refused: forbidden.what, now });
    }
    let base: { text: string }[] = [];
    if (AUTHORITY_Q.test(question)) {
      await authorityContext(this.pool, ctx, b, project, now);
      b.pack.fallback = 'Approval authority as NW OS records it (from the authority resolver and approval routing):';
    } else {
      // The Phase 5 assistant: intent-specific, record-based, permission-scoped.
      const a = await this.assistant.ask(ctx, actor, { question, project_id: project?.id }, now);
      const proj = a.project ?? project;
      b.pack.project = proj;
      for (const f of a.facts) b.fact(a.intent === 'knowledge' ? (f.confidence === 'Confirmed' ? 'Approved knowledge' : 'Knowledge') : 'Answer', f.text, f.confidence, f.source, f.basis);
      b.pack.fallback = a.answer;
      base = a.recommendations.map((r) => ({ text: r.text }));
      for (const r of a.recommendations) if (r.proposal) await b.action(this.pool, ctx, r.proposal.action, r.proposal.params);
      if (['unknown', 'today', 'risk', 'tasks'].includes(a.intent) || OVERVIEW_Q.test(question)) {
        if (a.intent === 'risk' && !proj) await portfolioContext(this.pool, ctx, b, now);
        if (DRAWING_Q.test(question) && proj) await this.drawingsOf(ctx, b, proj.id, question);
        await overviewContext(this.pool, this.data, ctx, b, now, proj);
        if (a.intent === 'unknown' && b.pack.facts.length > a.facts.length) b.pack.fallback = 'Here is what NW OS records show that may relate to your question:';
      }
    }
    return this.gateway.run(ctx, actor, { task: 'assistant_query', question, pack: b.pack, baseRecommendations: base, now });
  }

  /** Drawings named in a question (by number) on the project: their revision context. */
  private async drawingsOf(ctx: AccessContext, b: PackBuilder, projectId: string, question: string) {
    if (!ctx.can('drawings.view')) return;
    const drawings = (await this.data.list(ctx, this.data.module('drawings'), { project_id: projectId })) as Row[];
    const named = drawings.filter((d) => d.drawing_number && question.toLowerCase().includes(String(d.drawing_number).toLowerCase()));
    for (const d of named.slice(0, 2)) await drawingContext(this.pool, this.data, ctx, b, d.id);
  }

  async briefing(ctx: AccessContext, actor: AuditActor, now = new Date()) {
    this.need(ctx);
    if (['Client', 'Contractor'].includes(ctx.user.role)) throw new ForbiddenError('The daily briefing is for NW staff');
    const b = new PackBuilder(null);
    await overviewContext(this.pool, this.data, ctx, b, now, null);
    const n = (s: string) => b.pack.facts.filter((f) => f.section === s).length;
    b.pack.fallback = b.pack.facts.length
      ? `Today: ${n('Critical')} critical item(s), ${n('Owner decisions')} decision(s) waiting for you, ${n('Attention')} needing attention, ${n('Commercial')} commercial, ${n('Production')} production and ${n('Site')} site item(s).`
      : 'Nothing in your scope needs attention today.';
    return this.gateway.run(ctx, actor, { task: 'daily_briefing', pack: b.pack, now });
  }

  async projectSummary(ctx: AccessContext, actor: AuditActor, projectId: string, now = new Date()) {
    this.need(ctx);
    const project = await visibleProject(this.pool, ctx, projectId);
    if (!project) throw notFound(`Project ${projectId}`);
    const b = new PackBuilder(project);
    await projectContext(this.pool, this.data, ctx, b, project.id, now);
    const risk = b.pack.facts.find((f) => f.section === 'Risk');
    b.pack.fallback = `${project.name}: ${b.pack.facts[0]?.text.split(' — ')[1] ?? ''}${risk ? `. ${risk.text.split(' (')[0]}.` : ''}`;
    return this.gateway.run(ctx, actor, { task: 'project_summary', pack: b.pack, now });
  }

  async issueAnalysis(ctx: AccessContext, actor: AuditActor, body: Row, now = new Date()) {
    this.need(ctx);
    if (!body.issue_id && !(typeof body.text === 'string' && body.text.trim() && body.work_item_id)) throw new ValidationError('Give an issue_id, or a problem text and a work_item_id');
    const b = new PackBuilder(null);
    const ok = await issueContext(this.pool, this.data, ctx, b, { issue_id: body.issue_id, text: body.text, work_item_id: body.work_item_id });
    if (!ok) throw notFound(`Issue or work item ${String(body.issue_id ?? body.work_item_id)}`);
    const pid = b.pack.facts.find((f) => f.source?.project_id)?.source?.project_id;
    b.pack.project = await visibleProject(this.pool, ctx, pid);
    const conflict = b.pack.facts.find((f) => f.section === 'Conflict');
    b.pack.fallback = conflict ? `${conflict.text}. Verify the site measurement against the approved drawing before any modification; a dimension change needs the formal technical review.` : 'No conflicting figures were found in the records; see the facts below.';
    return this.gateway.run(ctx, actor, { task: 'issue_analysis', question: typeof body.text === 'string' ? body.text : null, pack: b.pack, now });
  }

  async drawingAnalysis(ctx: AccessContext, actor: AuditActor, drawingId: string, body: Row, now = new Date()) {
    this.need(ctx);
    const b = new PackBuilder(null);
    if (!(await drawingContext(this.pool, this.data, ctx, b, drawingId))) throw notFound(`Drawing ${drawingId}`);
    b.pack.project = await visibleProject(this.pool, ctx, b.pack.facts[0]?.source?.project_id);
    const impact = b.pack.facts.find((f) => f.section === 'Production impact' && f.confidence === 'Probable');
    b.pack.fallback = impact ? impact.text : 'Drawing revisions and their status as NW OS records them:';
    return this.gateway.run(ctx, actor, { task: 'drawing_analysis', question: typeof body.question === 'string' ? body.question.slice(0, 1000) : null, pack: b.pack, now });
  }

  async commercial(ctx: AccessContext, actor: AuditActor, projectId: string, now = new Date()) {
    this.need(ctx);
    const project = await visibleProject(this.pool, ctx, projectId);
    if (!project) throw notFound(`Project ${projectId}`);
    const b = new PackBuilder(project);
    await commercialContext(this.pool, this.data, ctx, b, project.id);
    b.pack.fallback = `${project.name}: ${b.pack.facts[1]?.text ?? ''}`;
    return this.gateway.run(ctx, actor, { task: 'commercial_analysis', pack: b.pack, now });
  }

  // ---------------------------------------------------------------- history and actions

  async conversations(ctx: AccessContext, query: Row) {
    this.need(ctx);
    const limit = Math.min(Number(query.limit) || 30, 100);
    if (query.all === '1') {
      // Oversight (audit.view): metadata only, never the answers themselves.
      if (!ctx.can('audit.view')) throw new ForbiddenError('Missing permission: audit.view');
      return (await this.pool.query(`SELECT id, user_id, user_role, task, prompt_version, project_id, request_id, status, fallback_reason, provider, model, usage, latency_ms, created_at FROM ai_conversations ORDER BY created_at DESC LIMIT $1`, [limit])).rows.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
    }
    return (await this.pool.query(`SELECT id, task, prompt_version, project_id, request_id, status, fallback_reason, provider, model, question, result, proposals, created_at FROM ai_conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`, [ctx.user.id, limit])).rows;
  }

  private async ownSuggestion(ctx: AccessContext, id: string, index: unknown) {
    const row = (await this.pool.query('SELECT * FROM ai_conversations WHERE id = $1', [id])).rows[0];
    // Only the person who asked can act on what the AI suggested to them.
    if (!row || row.user_id !== ctx.user.id) throw notFound(`AI conversation ${id}`);
    const i = Number(index);
    const list = row.proposals as Row[];
    const s = Number.isInteger(i) ? list.find((p) => p.index === i) : undefined;
    if (!s) throw notFound(`Suggested action ${String(index)}`);
    return { row, list, s };
  }

  /**
   * "Review" → the suggested action becomes an AI Proposal approval for the asker (nothing runs
   * yet). The parameters are the ones the server stored, optionally modified by the person (and
   * then validated again, as them).
   */
  async propose(ctx: AccessContext, actor: AuditActor, id: string, index: unknown, body: Row) {
    this.need(ctx);
    ctx.require('approvals.request');
    const { row, list, s } = await this.ownSuggestion(ctx, id, index);
    if (s.state !== 'suggested') throw new ValidationError(`This suggestion is already ${s.state}`);
    const modified = body.params && typeof body.params === 'object' ? { ...s.params, ...(body.params as Row) } : undefined;
    const checked = await validateProposal(this.pool, ctx, s.action as ProposalAction, modified ?? s.params);
    const u = ctx.user;
    const created = await raiseProposal(this.data, ctx, actor, checked, { approver: { id: u.id, name: u.name, role: u.role }, rationale: `${String(row.result?.answer ?? '').slice(0, 1200)}\n\nSuggested by the NW OS AI (${row.prompt_version}, request ${row.request_id}).`, source: 'ai_assistant', requestedBy: 'NW OS AI' });
    await this.pool.query(`UPDATE approvals SET data = data || jsonb_build_object('ai_conversation_id', $2::text, 'ai_request_id', $3::text) WHERE id = $1`, [created.id, row.id, row.request_id]);
    const next = list.map((p) => (p.index === s.index ? { ...p, state: 'proposed', approval_id: created.id, ...(modified ? { modified_params: checked.params } : {}) } : p));
    await this.pool.query('UPDATE ai_conversations SET proposals = $2 WHERE id = $1', [row.id, JSON.stringify(next)]);
    await writeAudit(this.pool, actor, { action: modified ? 'ai.suggestion.modify' : 'ai.suggestion.accept', entityType: 'ai_conversation', entityId: row.id, projectId: checked.project_id, before: modified ? { params: s.params } : undefined, after: { index: s.index, action: s.action, approval_id: created.id, params: checked.params } });
    return { approval: created, suggestion: next.find((p) => p.index === s.index) };
  }

  async dismiss(ctx: AccessContext, actor: AuditActor, id: string, index: unknown, body: Row) {
    this.need(ctx);
    const { row, list, s } = await this.ownSuggestion(ctx, id, index);
    if (s.state !== 'suggested') throw new ValidationError(`This suggestion is already ${s.state}`);
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
    const next = list.map((p) => (p.index === s.index ? { ...p, state: 'dismissed', dismissed_reason: reason || null } : p));
    await this.pool.query('UPDATE ai_conversations SET proposals = $2 WHERE id = $1', [row.id, JSON.stringify(next)]);
    await writeAudit(this.pool, actor, { action: 'ai.suggestion.dismiss', entityType: 'ai_conversation', entityId: row.id, projectId: row.project_id, after: { index: s.index, action: s.action, reason: reason || null } });
    return { suggestion: next.find((p) => p.index === s.index) };
  }
}
