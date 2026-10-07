/**
 * One answer from the server-side assistant (/api/assistant/ask): every statement with its
 * confidence label and a link to its record, recommendations, and — for consequential
 * actions — a proposal the person can send for approval and then approve. Nothing runs
 * until a person approves it; the server executes it with that person's permissions.
 */
import { AuthorityNote } from './AuthorityNote';
import { authorityItem, useAuthority } from '../services/authority';
import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, ShieldAlert } from 'lucide-react';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { Pill } from './ui/forms';

export type Confidence = 'Confirmed' | 'Probable' | 'Unknown';
export interface AssistantResult {
  id: string;
  intent: string;
  answer: string;
  refused?: string;
  facts: { text: string; confidence: Confidence; basis?: string; source?: { type: string; id: string; tab: string; project_id?: string | null } }[];
  recommendations: { text: string; decided_by: 'human'; proposal?: { action: string; label: string; params: Record<string, unknown> } }[];
  principle: string;
}

const TONE: Record<Confidence, 'good' | 'warn' | 'neutral'> = { Confirmed: 'good', Probable: 'warn', Unknown: 'neutral' };

const ProposalButton: React.FC<{ proposal: NonNullable<AssistantResult['recommendations'][number]['proposal']>; rationale: string }> = ({ proposal, rationale }) => {
  const [state, setState] = useState<{ id?: string; title?: string; done?: boolean; error?: string; busy?: boolean }>({});
  // Whether this person may decide the proposal: the server's authority resolver.
  const authority = useAuthority(state.id && !state.done ? [authorityItem('approval', state.id)] : []);
  const decision = state.id ? authority.get(authorityItem('approval', state.id)) : undefined;
  const propose = async () => {
    setState({ busy: true });
    try {
      const a = await api.post<{ id: string; title: string }>('/assistant/proposals', { action: proposal.action, params: proposal.params, rationale });
      setState({ id: a.id, title: a.title });
    } catch (err) {
      setState({ error: actionErrorOf(err).message });
    }
  };
  const decide = async (decision: 'Approved' | 'Rejected') => {
    setState((s) => ({ ...s, busy: true, error: undefined }));
    try {
      await api.post(`/approvals/${encodeURIComponent(state.id!)}/decision`, { decision });
      setState((s) => ({ ...s, busy: false, done: true, title: decision === 'Approved' ? `${s.title} — approved and executed` : `${s.title} — rejected` }));
    } catch (err) {
      setState((s) => ({ ...s, busy: false, error: actionErrorOf(err).message }));
    }
  };
  if (state.done) return <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> {state.title}</p>;
  return (
    <div className="mt-1 space-y-1">
      {!state.id ? (
        <button type="button" disabled={state.busy} onClick={() => void propose()} className="rounded-lg border border-amber-400 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
          Propose: {proposal.label}
        </button>
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-[10px]" data-testid="assistant-proposal">
          <p className="font-bold text-amber-900">{state.title}</p>
          <p className="text-amber-800">Waiting for a person to approve. Nothing has been done yet.</p>
          {decision?.allowed ? (
            <div className="mt-1 flex gap-1">
              <button type="button" disabled={state.busy} onClick={() => void decide('Approved')} className="rounded bg-emerald-600 px-2 py-0.5 font-bold text-white disabled:opacity-50">Approve &amp; run</button>
              <button type="button" disabled={state.busy} onClick={() => void decide('Rejected')} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-bold text-slate-700 disabled:opacity-50">Reject</button>
            </div>
          ) : (
            <AuthorityNote always className="mt-1" authority={decision} />
          )}
        </div>
      )}
      {state.error && <p className="text-[10px] font-bold text-rose-700" role="alert">{state.error}</p>}
    </div>
  );
};

export const AssistantAnswerView: React.FC<{ result: AssistantResult }> = ({ result }) => (
  <div className="space-y-2" data-testid="assistant-answer">
    {result.refused && (
      <p className="flex items-start gap-1 rounded-lg bg-rose-50 p-2 text-[11px] font-bold text-rose-800">
        <ShieldAlert className="mt-0.5 h-3 w-3 shrink-0" /> Not allowed for the assistant: {result.refused}
      </p>
    )}
    <p className="font-medium">{result.answer}</p>
    {result.facts.length > 0 && (
      <ul className="space-y-1">
        {result.facts.map((f, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[11px]">
            <Pill tone={TONE[f.confidence]} title={f.basis ?? (f.confidence === 'Confirmed' ? 'Read from an NW OS record' : undefined)}>{f.confidence}</Pill>
            <span className="flex-1">
              {f.text}
              {f.basis && f.confidence !== 'Confirmed' && <span className="block text-[10px] text-slate-500">Basis: {f.basis}</span>}
            </span>
            {f.source && (
              <button type="button" title="Open the record" onClick={() => navigateTo(f.source!.tab, f.source!.project_id ?? undefined)} className="text-slate-400 hover:text-slate-700">
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    )}
    {result.recommendations.length > 0 && (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Recommendations — you decide</p>
        <ul className="mt-1 space-y-1.5">
          {result.recommendations.map((r, i) => (
            <li key={i} className="text-[11px]">
              {r.text}
              {r.proposal && <ProposalButton proposal={r.proposal} rationale={`${result.answer} ${r.text}`} />}
            </li>
          ))}
        </ul>
      </div>
    )}
    <p className="text-[10px] text-slate-400">{result.principle}</p>
  </div>
);
