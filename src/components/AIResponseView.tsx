/**
 * One result from the NW OS AI layer (/api/ai/ops/*): the answer and who wrote it (the AI, checked
 * against records, or NW OS itself), every fact with its confidence and record, AI inferences
 * (Probable), recommendations, Decision Required items (decided only in their own screens) and
 * suggested actions. A suggested action does nothing until the person presses Review (an AI
 * Proposal approval is created) and then approves it; the server runs it with their permissions.
 */
import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Gavel, ShieldAlert, Sparkles } from 'lucide-react';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { authorityItem, useAuthority } from '../services/authority';
import { AuthorityNote } from './AuthorityNote';
import { Pill } from './ui/forms';

type Confidence = 'Confirmed' | 'Probable' | 'Unknown';
interface Src {
  type: string;
  id: string;
  tab: string;
  project_id?: string | null;
}
export interface AIResult {
  id: string;
  task: string;
  prompt_version: string;
  question: string | null;
  project: { id: string; name: string } | null;
  answer: string;
  answer_source: 'ai' | 'nw_os';
  confidence: Confidence;
  facts: { ref: string; text: string; confidence: Confidence; section: string; source?: Src; basis?: string; highlighted?: boolean; why?: string }[];
  inferences: { text: string; basis_refs: string[] }[];
  evidence: (Src & { ref: string; highlighted: boolean })[];
  recommendations: { text: string; origin: 'ai' | 'nw_os'; confidence?: 'High' | 'Medium' | 'Low'; evidence_refs: string[] }[];
  suggested_actions: { index: number; ref: string; action: string; label: string; summary: string; why?: string; state: string; approval_id?: string }[];
  decisions_required: { ref: string; title: string; why: string; source?: Src }[];
  unknowns: string[];
  warnings: string[];
  requires_human_decision: boolean;
  refused?: string;
  ai: { status: 'ok' | 'fallback' | 'refused' | 'rate_limited' | 'error'; provider: string | null; model: string | null; latency_ms: number | null; fallback_reason?: string };
  principle: string;
}

const TONE: Record<Confidence, 'good' | 'warn' | 'neutral'> = { Confirmed: 'good', Probable: 'warn', Unknown: 'neutral' };
const open = (s?: Src) => s && navigateTo(s.tab, s.project_id ?? undefined, { type: s.type, id: s.id });

const Suggested: React.FC<{ conversation: string; s: AIResult['suggested_actions'][number] }> = ({ conversation, s }) => {
  const [state, setState] = useState<{ approval?: string; title?: string; done?: string; dismissed?: boolean; busy?: boolean; error?: string }>({ approval: s.approval_id, dismissed: s.state === 'dismissed' });
  const authority = useAuthority(state.approval && !state.done ? [authorityItem('approval', state.approval)] : []);
  const decision = state.approval ? authority.get(authorityItem('approval', state.approval)) : undefined;
  const run = async (fn: () => Promise<void>) => {
    setState((x) => ({ ...x, busy: true, error: undefined }));
    try {
      await fn();
    } catch (err) {
      setState((x) => ({ ...x, error: actionErrorOf(err).message }));
    } finally {
      setState((x) => ({ ...x, busy: false }));
    }
  };
  if (state.dismissed) return <li className="text-[11px] text-slate-400 line-through">{s.summary}</li>;
  return (
    <li className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px]" data-testid={`ai-suggestion-${s.index}`}>
      <div className="flex flex-wrap items-center gap-1">
        <Pill tone="warn">Proposal — not done</Pill>
        <span className="font-bold text-amber-950">{s.summary}</span>
      </div>
      {s.why && <div className="text-amber-900">Why: {s.why}</div>}
      {state.done ? (
        <p className="flex items-center gap-1 font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {state.done}</p>
      ) : !state.approval ? (
        <div className="flex gap-1">
          <button type="button" disabled={state.busy} onClick={() => void run(async () => { const r = await api.post<{ approval: { id: string; title: string } }>(`/ai/ops/conversations/${conversation}/actions/${s.index}/propose`, {}); setState((x) => ({ ...x, approval: r.approval.id, title: r.approval.title })); })} className="rounded border border-amber-500 bg-white px-2 py-0.5 font-bold text-amber-900 disabled:opacity-50">
            Review
          </button>
          <button type="button" disabled={state.busy} onClick={() => void run(async () => { await api.post(`/ai/ops/conversations/${conversation}/actions/${s.index}/dismiss`, {}); setState((x) => ({ ...x, dismissed: true })); })} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-bold text-slate-600 disabled:opacity-50">
            Dismiss
          </button>
        </div>
      ) : (
        <div className="space-y-1" data-testid="ai-proposal-pending">
          <p className="text-amber-900">AI Proposal {state.approval} created. Nothing has been done yet — a person with authority approves it in the normal approval flow.</p>
          {decision?.allowed ? (
            <div className="flex gap-1">
              <button type="button" disabled={state.busy} onClick={() => void run(async () => { await api.post(`/approvals/${encodeURIComponent(state.approval!)}/decision`, { decision: 'Approved' }); setState((x) => ({ ...x, done: 'Approved — the server executed it with your permissions' })); })} className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white disabled:opacity-50">
                Approve &amp; run
              </button>
              <button type="button" disabled={state.busy} onClick={() => void run(async () => { await api.post(`/approvals/${encodeURIComponent(state.approval!)}/decision`, { decision: 'Rejected' }); setState((x) => ({ ...x, done: 'Rejected — nothing was done' })); })} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-bold text-slate-700 disabled:opacity-50">
                Reject
              </button>
            </div>
          ) : (
            <AuthorityNote always authority={decision} />
          )}
        </div>
      )}
      {state.error && <p className="font-bold text-rose-700" role="alert">{state.error}</p>}
    </li>
  );
};

export const AIResponseView: React.FC<{ result: AIResult }> = ({ result: r }) => {
  const [allFacts, setAllFacts] = useState(false);
  const facts = allFacts ? r.facts : r.facts.filter((f) => f.highlighted || f.confidence !== 'Confirmed').concat(r.facts.filter((f) => !f.highlighted && f.confidence === 'Confirmed')).slice(0, 8);
  const statusText =
    r.ai.status === 'ok'
      ? `AI summary (${r.ai.model}) — checked against NW OS records`
      : r.ai.status === 'refused'
        ? 'Refused — not something the AI may do'
        : r.ai.status === 'rate_limited'
          ? 'AI usage limit reached — NW OS record-based answer'
          : 'NW OS record-based answer (AI not used)';
  return (
    <div className="space-y-2" data-testid="ai-response">
      <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
        <Pill tone={r.ai.status === 'ok' ? 'info' : r.ai.status === 'refused' ? 'bad' : 'neutral'}>{statusText}</Pill>
        <Pill tone={TONE[r.confidence]} title={r.answer_source === 'ai' ? 'Written by the AI from the facts below; check the facts' : 'Read from NW OS records'}>
          {r.answer_source === 'ai' ? 'AI-written · Probable' : r.confidence}
        </Pill>
        <span className="text-slate-400">{r.prompt_version}</span>
      </div>
      {r.refused && (
        <p className="flex items-start gap-1 rounded-lg bg-rose-50 p-2 text-[11px] font-bold text-rose-800">
          <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" /> Not allowed for the AI: {r.refused}
        </p>
      )}
      <p className="whitespace-pre-line text-sm font-medium text-slate-900" data-testid="ai-answer">{r.answer}</p>
      {r.warnings.length > 0 && (
        <ul className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[10px] text-amber-900" data-testid="ai-warnings">
          {r.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {w}</li>
          ))}
        </ul>
      )}
      {r.decisions_required.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-2" data-testid="ai-decisions">
          <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-rose-800"><Gavel className="h-3 w-3" /> Decision required — by a person, in its own screen</p>
          <ul className="mt-1 space-y-1 text-[11px]">
            {r.decisions_required.map((d) => (
              <li key={d.ref} className="flex items-start justify-between gap-2">
                <span><strong>{d.title}</strong> <span className="text-rose-900">— {d.why}</span></span>
                {d.source && <button type="button" onClick={() => open(d.source)} className="shrink-0 font-bold text-rose-800 underline">Open</button>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {facts.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Facts and evidence</p>
          <ul className="mt-1 space-y-1" data-testid="ai-facts">
            {facts.map((f) => (
              <li key={f.ref} className={`flex items-start gap-1.5 text-[11px] ${f.highlighted ? 'font-semibold' : ''}`}>
                <Pill tone={TONE[f.confidence]} title={f.basis ?? (f.confidence === 'Confirmed' ? 'Read from an NW OS record' : undefined)}>{f.confidence}</Pill>
                <span className="flex-1">
                  <span className="text-slate-400">{f.section} · </span>
                  {f.text}
                  {f.basis && f.confidence !== 'Confirmed' && <span className="block text-[10px] text-slate-500">Basis: {f.basis}</span>}
                  {f.why && <span className="block text-[10px] text-indigo-700">AI: {f.why}</span>}
                </span>
                {f.source && (
                  <button type="button" title={`Open ${f.source.type} ${f.source.id}`} onClick={() => open(f.source)} className="text-slate-400 hover:text-slate-700" data-testid="ai-evidence-link">
                    <ArrowRight className="h-3 w-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {r.facts.length > facts.length || allFacts ? (
            <button type="button" onClick={() => setAllFacts(!allFacts)} className="mt-1 text-[10px] font-bold text-slate-500 underline">
              {allFacts ? 'Show fewer' : `Show all ${r.facts.length} facts`}
            </button>
          ) : null}
        </div>
      )}
      {r.inferences.length > 0 && (
        <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 p-2 text-[11px]" data-testid="ai-inferences">
          <p className="flex items-center gap-1 text-[10px] font-black uppercase tracking-wider text-indigo-800"><Sparkles className="h-3 w-3" /> AI inference — Probable, not confirmed</p>
          {r.inferences.map((i) => (
            <p key={i.text}>{i.text} <span className="text-[10px] text-slate-500">(based on {i.basis_refs.join(', ')})</span></p>
          ))}
        </div>
      )}
      {r.recommendations.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Recommendations — you decide</p>
          <ul className="mt-1 space-y-1 text-[11px]">
            {r.recommendations.map((x) => (
              <li key={x.text}>
                {x.origin === 'ai' ? <Pill tone="info">AI{x.confidence ? ` · ${x.confidence}` : ''}</Pill> : <Pill tone="neutral">NW OS rule</Pill>} {x.text}
                {x.evidence_refs.length > 0 && <span className="text-[10px] text-slate-500"> ({x.evidence_refs.join(', ')})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {r.suggested_actions.length > 0 && (
        <div>
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Suggested actions — nothing happens until you review and approve</p>
          <ul className="mt-1 space-y-1">
            {r.suggested_actions.map((s) => (
              <Suggested key={s.index} conversation={r.id} s={s} />
            ))}
          </ul>
        </div>
      )}
      {r.unknowns.length > 0 && (
        <p className="text-[10px] text-slate-500"><strong>Unknown / missing:</strong> {r.unknowns.slice(0, 5).join(' · ')}</p>
      )}
      <p className="text-[10px] text-slate-400">{r.principle}</p>
    </div>
  );
};
