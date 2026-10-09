/**
 * The pre-Phase 6 AI screens' routes, migrated onto the AI gateway (database mode).
 *
 *   legacy screen → this route (signed-in user, AccessContext) → AIService (permission-scoped
 *   context builder) → AI gateway → configured provider (or the NW OS record-based fallback)
 *
 * Each route keeps the response shape its existing screen expects, but:
 *  - everything the browser sends about projects, work items, drawings, issues, knowledge, the
 *    user or their role is IGNORED; the server loads what this user may see itself;
 *  - the only browser inputs used are the user's own text (question / message / report, treated
 *    as untrusted text) and record IDs, which are checked against the user's scope (a record
 *    outside it looks exactly like a missing one);
 *  - no route here, or anywhere else, calls a provider: only the gateway does;
 *  - nothing is executed: protected decisions stay with the existing approval workflow, and the
 *    contractor channel never returns an action type the screen would auto-execute.
 *
 * In demo mode (no database, no sign-in) these paths are answered by the deterministic rules in
 * legacyRules.ts, which never call a model.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { loadAccess } from '../auth/middleware';
import type { AccessContext } from '../auth/access';
import type { AuthStore } from '../auth/store';
import type { AuditActor } from '../audit';
import type { Pool } from '../db/pool';
import { apiErrorHandler } from '../http/errors';
import type { AIResponse } from './gateway';
import { AIService } from './service';

type Row = Record<string, any>;
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);
const actorOf = (req: Request): AuditActor => ({ id: req.auth!.user.id, name: req.auth!.user.name, role: req.auth!.user.role, ip: req.ip });
const text = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const id = (v: unknown) => (typeof v === 'string' && /^[\w.:-]{1,120}$/.test(v) ? v : '');
/** Where an answer came from: the checked AI text, or NW OS's own record-based answer. */
const sourceOf = (r: AIResponse) => (r.ai.status === 'ok' ? `nw-os-ai-gateway:${r.ai.provider}/${r.ai.model}` : 'nw-os-records');
const factsIn = (r: AIResponse, ...sections: string[]) => r.facts.filter((f) => sections.includes(f.section)).map((f) => f.text);

export const LEGACY_AI_PATHS = ['/ai/briefing', '/ai/project-briefing', '/ai/assistant', '/ai/classify-issue', '/ai/analyze-drawing', '/ai/compare-drawings', '/ai/parse-contractor-update', '/ai/contractor-assistant'];

/** Deterministic classification of a reported problem (NW OS rules, not the model: severity stays deterministic). */
function classify(raw: string) {
  const lower = raw.toLowerCase();
  const has = (...w: string[]) => w.some((x) => lower.includes(x));
  if (has('safety', 'keselamatan', '安全', 'emergency', 'injur', 'fire', 'api ', 'wiring exposed', 'exposed wiring', 'electric shock')) return { category: 'Safety', priority: 'Critical' as const, escalation_target: 'Owner' as const, action_required: 'OWNER DECISION REQUIRED — stop work and make the area safe; the site team decides on site' };
  if (/\d{3,5}\s*mm/.test(lower) || has('dimension', 'saiz', 'ukuran', '尺寸', 'tak muat', 'cannot fit', "can't fit", 'not fit', '不够')) return { category: 'Site condition', priority: 'High' as const, escalation_target: 'PM' as const, action_required: 'PM REVIEW REQUIRED — verify the site measurement against the approved drawing before any modification' };
  if (has('delivery', 'deliver', 'hantar', '送货', 'lorry', 'lori')) return { category: 'Delivery', priority: 'Medium' as const, escalation_target: 'Site Supervisor' as const, action_required: 'Site Supervisor to confirm the delivery arrangement' };
  if (has('plywood', 'laminate', 'material', 'rosak', 'pecah', 'kaca', 'glass', 'damaged', 'defect')) return { category: 'Material', priority: 'High' as const, escalation_target: 'PM' as const, action_required: 'Inspect the material defect and notify the supplier' };
  if (has('drawing', 'lukisan', '图纸', 'revision')) return { category: 'Drawing', priority: 'High' as const, escalation_target: 'PM' as const, action_required: 'PM REVIEW REQUIRED — check against the approved drawing revision' };
  if (has('variation', 'extra', 'tambah', 'additional', 'client wants', 'client request')) return { category: 'Variation', priority: 'Medium' as const, escalation_target: 'PM' as const, action_required: 'PM to review as a potential variation (the client decides; the AI never approves)' };
  return { category: 'Site condition', priority: 'Medium' as const, escalation_target: 'PM' as const, action_required: 'PM REVIEW REQUIRED' };
}

/** The visible work item a text names by its code (only items this user may see). */
async function namedItem(ai: AIService, ctx: AccessContext, raw: string, hint?: string) {
  if (!ctx.can('work_items.view')) return undefined;
  const items = (await ai.data.core.list(ctx, 'workItems', {})) as Row[];
  if (hint) {
    const byId = items.find((w) => w.id === hint || w.item_code === hint);
    if (byId) return byId;
  }
  const upper = raw.toUpperCase();
  return items.find((w) => w.item_code && new RegExp(`\\b${String(w.item_code).replace(/[-]/g, '\\-')}\\b`).test(upper));
}

/** A drawing (with revisions) if this user may see it; undefined otherwise. */
async function visibleDrawing(ai: AIService, ctx: AccessContext, drawingId: string) {
  if (!drawingId || !ctx.can('drawings.view')) return undefined;
  try {
    return (await ai.data.get(ctx, ai.data.module('drawings'), drawingId)) as Row;
  } catch {
    return undefined;
  }
}

export function createLegacyAIRouter({ pool }: { pool: Pool; store: AuthStore }) {
  const router = express.Router();
  const ai = new AIService(pool);
  // Sign-in, CSRF and the identity override are applied to /api/ai by mountSecureApi; this adds
  // the user's AccessContext (role permissions and project scope, from the database).
  router.use(LEGACY_AI_PATHS, loadAccess(pool));

  // Owner Dashboard briefing → the daily briefing task.
  router.post(
    '/ai/briefing',
    wrap(async (req, res) => {
      const r = await ai.briefing(req.access!, actorOf(req));
      res.json({ briefing: r.answer, source: sourceOf(r), result: r });
    })
  );

  // Project command center briefing → the project summary task (project from the ID only).
  router.post(
    '/ai/project-briefing',
    wrap(async (req, res) => {
      const projectId = id(req.body?.project_id) || id(req.body?.project?.id);
      const r = await ai.projectSummary(req.access!, actorOf(req), projectId);
      res.json({
        executive_summary: r.answer,
        handover_projection: factsIn(r, 'Project', 'Deadlines').slice(0, 3).join(' · ') || 'No planned dates are recorded.',
        critical_path_bottlenecks: factsIn(r, 'Risk', 'Production', 'Issues').slice(0, 6),
        pm_action_checklist: [...r.recommendations.map((x) => x.text), ...r.suggested_actions.map((a) => `Proposal (review in the AI Assistant): ${a.summary}`)].slice(0, 6),
        owner_escalations_needed: r.decisions_required.map((d) => `${d.title} — ${d.why}`),
        source: sourceOf(r),
        result: r,
      });
    })
  );

  // The copilot drawer → the assistant task. Its role, name and "projectContext" are ignored.
  router.post(
    '/ai/assistant',
    wrap(async (req, res) => {
      const r = await ai.ask(req.access!, actorOf(req), { question: req.body?.question, project_id: id(req.body?.project_id) || undefined });
      const lines = r.facts.slice(0, 8).map((f) => `• [${f.confidence}] ${f.text}`);
      res.json({ answer: [r.answer, ...lines].join('\n'), source: sourceOf(r), result: r });
    })
  );

  // Issue modal "AI classify" → deterministic classification + the issue analysis task for a visible work item.
  router.post(
    '/ai/classify-issue',
    wrap(async (req, res) => {
      const ctx = req.access!;
      if (!ctx.can('ai.assistant')) return void res.status(403).json({ error: 'forbidden', message: 'Missing permission: ai.assistant' });
      const raw = text(req.body?.rawText);
      if (!raw) return void res.status(400).json({ error: 'validation_error', message: 'Describe the problem' });
      const c = classify(raw);
      const item = await namedItem(ai, ctx, raw, id(req.body?.work_item_id) || undefined);
      const r = item ? await ai.issueAnalysis(ctx, actorOf(req), { text: raw, work_item_id: item.id }) : undefined;
      res.json({
        ...c,
        affected_item_code: item?.item_code ?? 'General',
        title: `${c.category === 'Site condition' && /\d{3,5}\s*mm/i.test(raw) ? 'Site Dimension Discrepancy' : `${c.category} report`}${item ? ` (${item.item_code})` : ''}`,
        summary: r?.answer ?? `Reported: "${raw.slice(0, 300)}". No work item you can see is named, so no record was checked.`,
        source: r ? sourceOf(r) : 'nw-os-rules',
        result: r ?? null,
      });
    })
  );

  // Drawing viewer "AI analysis" → the drawing analysis task (the drawing from its ID, server side).
  router.post(
    '/ai/analyze-drawing',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const drawing = await visibleDrawing(ai, ctx, id(req.body?.drawingId));
      if (!drawing) return void res.status(404).json({ error: 'not_found', message: 'Drawing not found' });
      const r = await ai.drawingAnalysis(ctx, actorOf(req), drawing.id, { question: 'Explain the drawing revisions, affected work items and production impact.' });
      const rev = (drawing.revisions ?? []).find((x: Row) => x.id === id(req.body?.revisionId)) ?? (drawing.revisions ?? []).find((x: Row) => x.is_current);
      const items = ctx.can('work_items.view') ? ((await ai.data.core.list(ctx, 'workItems', { project_id: drawing.project_id })) as Row[]).filter((w) => w.drawing_id === drawing.id) : [];
      res.json({
        label: 'AI DRAFT — NOT APPROVED',
        drawing_number: drawing.drawing_number,
        revision: rev?.revision ?? '—',
        dimensions: items.filter((w) => w.dimensions).map((w) => `${w.item_code}: ${w.dimensions} (as recorded on the work item)`),
        quantities: items.map((w) => `${w.item_code}: ${w.quantity ?? 1} ${w.unit ?? 'unit'}`),
        materials: items.filter((w) => w.material).map((w) => `${w.item_code}: ${w.material}`),
        finishes: items.filter((w) => w.finish).map((w) => `${w.item_code}: ${w.finish}`),
        work_items: items.map((w) => w.item_code),
        production_concerns: [...factsIn(r, 'Production impact'), ...r.decisions_required.map((d) => `${d.title}: ${d.why}`)],
        missing_info: r.unknowns,
        conflicting_info: r.facts.filter((f) => f.section === 'Changes' && f.confidence === 'Probable').map((f) => f.text),
        nw_recommendations: [r.answer, ...r.recommendations.map((x) => x.text)],
        matched_knowledge: [],
        analyzed_at: r.generated_at,
        source: sourceOf(r),
        result: r,
      });
    })
  );

  // Revision comparison → recorded revision data + the drawing analysis task.
  router.post(
    '/ai/compare-drawings',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const drawing = await visibleDrawing(ai, ctx, id(req.body?.drawingId));
      if (!drawing) return void res.status(404).json({ error: 'not_found', message: 'Drawing not found' });
      const revs = (drawing.revisions ?? []) as Row[];
      const from = revs.find((x) => x.id === id(req.body?.fromRevisionId));
      const to = revs.find((x) => x.id === id(req.body?.toRevisionId));
      const r = await ai.drawingAnalysis(ctx, actorOf(req), drawing.id, { question: `What changed between ${from?.revision ?? 'the earlier'} and ${to?.revision ?? 'the later'} revision, which work items are affected, and did production start?` });
      const recorded = (to?.comparison_with_previous ?? {}) as Row;
      const changes = ((recorded.changes ?? []) as Row[]).map((c) => (typeof c === 'string' ? c : `${c.element ?? c.field ?? ''}: ${c.from ?? ''} → ${c.to ?? ''}`));
      const items = ctx.can('work_items.view') ? ((await ai.data.core.list(ctx, 'workItems', { project_id: drawing.project_id })) as Row[]).filter((w) => w.drawing_id === drawing.id) : [];
      const started = (s: unknown) => !['Not Started', 'Pending', 'Draft', 'Planned', undefined, null, ''].includes(s as string);
      const impact = items.some((w) => started(w.production_status));
      res.json({
        drawing_id: drawing.id,
        from_revision: from?.revision ?? '—',
        to_revision: to?.revision ?? '—',
        dimension_changes: changes,
        material_changes: [],
        finish_changes: [],
        quantity_changes: [],
        location_changes: [],
        detail_changes: [],
        added_items: [],
        removed_items: [],
        affected_work_items: items.map((w) => ({
          work_item_id: w.id,
          item_code: w.item_code,
          description: w.description,
          production_status: w.production_status,
          impact_level: started(w.production_status) ? 'PRODUCTION IMPACT POSSIBLE' : 'LOW IMPACT',
          action_suggested: started(w.production_status) ? 'Check the work already in production against the new revision before it is approved.' : 'Use the approved revision when production starts.',
        })),
        compared_at: r.generated_at,
        warning_level: impact ? 'warning' : 'normal',
        summary: r.answer,
        impact_check: { has_production_impact: impact, requires_site_action: false, severity_level: impact ? 'WARNING' : 'NORMAL', headline: impact ? 'Production may be affected' : 'No production impact recorded', detail: changes.length ? 'Changes as recorded on the revision (not verified by the AI).' : 'No revision comparison is recorded in NW OS.' },
        source: sourceOf(r),
        result: r,
      });
    })
  );

  // Contractor quick update → NW OS rules on the contractor's own text; the item must be one they can see.
  router.post(
    '/ai/parse-contractor-update',
    wrap(async (req, res) => {
      const ctx = req.access!;
      if (!ctx.can('ai.assistant')) return void res.status(403).json({ error: 'forbidden', message: 'Missing permission: ai.assistant' });
      const raw = text(req.body?.messageText, 1000);
      const lower = raw.toLowerCase();
      const item = await namedItem(ai, ctx, raw, id(req.body?.work_item_id) || undefined);
      const done = /\b(siap|complete|completed|done|finished)\b|做好/.test(lower);
      const deliver = /\b(deliver|hantar|tomorrow|besok|esok)\b|送/.test(lower);
      const problem = /\b(problem|salah|masalah|rosak|cannot|can't)\b|tak muat|不够/.test(lower);
      const pct = lower.match(/(\d{1,3})\s*%/);
      const action = problem ? 'Report Problem' : done && deliver ? 'Schedule Delivery' : done ? 'Complete Work' : 'Update Progress';
      res.json({
        item_code: item?.item_code ?? '',
        action,
        status_suggestion: action === 'Report Problem' ? 'Blocked' : action === 'Schedule Delivery' ? 'Ready for Delivery' : action === 'Complete Work' ? 'Ready for QC' : 'In Progress',
        delivery_timing: action === 'Schedule Delivery' ? (/pagi|morning|早上/.test(lower) ? 'Tomorrow morning (to be confirmed)' : 'To be confirmed') : null,
        progress_percent: action === 'Complete Work' ? 100 : pct ? Math.min(100, Number(pct[1])) : null,
        notes: raw,
        source: 'nw-os-rules',
      });
    })
  );

  // Contractor / client chat → the assistant task on the sender's own scope; nothing auto-executes.
  router.post(
    '/ai/contractor-assistant',
    wrap(async (req, res) => {
      const ctx = req.access!;
      const raw = text(req.body?.message_text, 1000);
      if (!raw) return void res.status(400).json({ error: 'validation_error', message: 'Write a message' });
      const r = await ai.ask(ctx, actorOf(req), { question: raw, project_id: id(req.body?.project_id) || undefined });
      const c = classify(raw);
      const needsPerson = r.ai.status === 'refused' || c.category === 'Safety' || /\d{3,5}\s*mm|variation|tambah|extra|problem|masalah|rosak|tak muat/i.test(raw);
      const lang = /[一-鿿]/.test(raw) ? 'zh' : /\b(siap|tak|boleh|sudah|esok|hantar|masalah)\b/i.test(raw) ? 'ms' : 'en';
      res.json({
        reply_text: r.answer,
        language: lang,
        classification: c.category === 'Safety' ? 'Urgent / Safety Issue' : needsPerson ? 'Problem / Issue' : 'Normal Question',
        confidence: r.ai.status === 'ok' ? 'PROBABLE' : r.confidence === 'Confirmed' ? 'CONFIRMED' : 'UNKNOWN',
        // Only non-executing action types: the AI answers or routes to a person; it never changes records.
        action_type: needsPerson ? (c.category === 'Safety' ? 'escalate_to_person' : 'request_pm_review') : 'answer_question',
        action_details: { target_record: r.project?.name ?? 'General Conversation', approval_required: needsPerson, routed_to: needsPerson ? (c.category === 'Safety' ? 'Owner' : 'PM') : 'AI' },
        pm_inbox_item: { needed: needsPerson, priority: c.priority, recommended_action: c.action_required },
        source: sourceOf(r),
        result: r,
      });
    })
  );

  router.use(LEGACY_AI_PATHS, apiErrorHandler);
  return router;
}
