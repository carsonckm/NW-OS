/**
 * NW OS Operating Assistant (database mode): ask about risk, today's work, tasks, work items
 * or (for commercial roles) project financials. Answers come from the server, from what the
 * signed-in user may see, with a confidence label on every statement. Consequential actions
 * are proposals that a person approves before the server runs them.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bot, RefreshCw, Send, ShieldCheck } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { AssistantAnswerView, type AssistantResult } from '../components/AssistantAnswerView';
import { FormError } from '../components/ui/FormError';
import { Pill } from '../components/ui/forms';

interface ProposalRow {
  id: string;
  title: string;
  project_name: string;
  decision: string;
  date_requested: string;
  decision_by_name?: string;
  execution?: { executed_at: string; result: Record<string, unknown> };
}

const PRESETS: Record<string, string[]> = {
  staff: ['What needs me today?', 'Why is this project at risk?', 'What are my overdue tasks?'],
  Contractor: ['What are my tasks?', 'Status of my work item (type its code, e.g. CAR-001)'],
};

export const OperatingAssistantView: React.FC = () => {
  const { currentUser, selectedProject, coreDataSync } = useNW();
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ q: string; result: AssistantResult }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [proposals, setProposals] = useState<ProposalRow[]>([]);

  const loadProposals = useCallback(async () => {
    try {
      setProposals(await api.get<ProposalRow[]>('/assistant/proposals'));
    } catch {
      setProposals([]);
    }
  }, []);
  useEffect(() => {
    void loadProposals();
  }, [loadProposals, coreDataSync.lastSyncedAt]);

  const ask = async (q: string) => {
    if (!q.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<AssistantResult>('/assistant/ask', { question: q.trim(), project_id: selectedProject?.id });
      setHistory((h) => [{ q: q.trim(), result }, ...h].slice(0, 20));
      setQuestion('');
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };

  const presets = PRESETS[currentUser.role] ?? PRESETS.staff;
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8" data-testid="operating-assistant">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-black text-slate-900">Operating Assistant</h2>
            {selectedProject && <Pill tone="info">{selectedProject.project_name}</Pill>}
          </div>
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Answers only from records you ({currentUser.role}) can see · it proposes, you decide
          </span>
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <input
            aria-label="Ask the assistant"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. Why is this project at risk?"
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button type="submit" disabled={busy || !question.trim()} className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> Ask
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => (p.includes('(') ? setQuestion(p.split(' (')[0] + ' ') : void ask(p))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
              {p}
            </button>
          ))}
        </div>
        <FormError error={error} />
      </div>

      {history.map((h, i) => (
        <div key={history.length - i} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-sm">
          <p className="text-[11px] font-bold text-slate-500">You asked: “{h.q}”</p>
          <AssistantAnswerView result={h.result} />
        </div>
      ))}

      {proposals.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="assistant-proposals">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black text-slate-900">AI proposals</h3>
            <button type="button" onClick={() => void loadProposals()} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500">
              <RefreshCw className="h-3 w-3" /> Refresh
            </button>
          </div>
          <ul className="mt-2 divide-y divide-slate-100 text-xs">
            {proposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{p.title}</strong> <span className="text-slate-500">· {p.project_name}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  <Pill tone={p.decision === 'Approved' ? 'good' : p.decision === 'Pending' ? 'warn' : 'neutral'}>{p.decision}</Pill>
                  {p.execution && <Pill tone="good">Executed {new Date(p.execution.executed_at).toLocaleString()}</Pill>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
