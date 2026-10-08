/**
 * NW OS AI Operating Assistant (database mode). Questions, the daily briefing, project summaries
 * and commercial analysis go to the server's AI layer (/api/ai/ops): it builds the context from
 * what the signed-in user may see, asks the configured model (if any) to explain it, checks the
 * answer against the records, and falls back to NW OS's own record-based answer when no model is
 * available. Every statement has a confidence label and its record; suggested actions are
 * proposals a person reviews and approves before the server runs them. The AI is never an
 * authority: approvals and authority come from the authority resolver.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bot, Briefcase, CalendarCheck, Factory, Gavel, ListChecks, RefreshCw, Send, ShieldCheck, TrendingUp, TriangleAlert } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { AIResponseView, type AIResult } from '../components/AIResponseView';
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
  staff: ['What needs me today?', 'Why is this project at risk?', 'What are my overdue tasks?', 'What can my team handle?'],
  Contractor: ['What are my tasks?', 'Status of my work item (type its code, e.g. CAR-001)'],
};
const FINANCE_ROLES = ['Owner / CEO', 'Admin', 'Accountant', 'Project Manager'];
interface Status {
  available: boolean;
  provider: string | null;
  model: string | null;
  detail: string;
}

export const OperatingAssistantView: React.FC = () => {
  const { currentUser, selectedProject, coreDataSync, workItems, drawings } = useNW();
  const [analyze, setAnalyze] = useState({ work_item_id: '', text: '', drawing_id: '' });
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState<{ q: string; result: AIResult }[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    void api.get<Status>('/ai/ops/status').then(setStatus).catch(() => setStatus(null));
  }, []);
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

  const run = async (label: string, call: () => Promise<AIResult>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call();
      setHistory((h) => [{ q: label, result }, ...h].slice(0, 20));
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const ask = async (q: string) => {
    if (!q.trim()) return;
    await run(q.trim(), () => api.post<AIResult>('/ai/ops/ask', { question: q.trim(), project_id: selectedProject?.id }));
    setQuestion('');
  };
  const staff = !['Client', 'Contractor'].includes(currentUser.role);
  const quick: { label: string; icon: React.ReactNode; go: () => void; show: boolean }[] = [
    { label: 'Daily Briefing', icon: <CalendarCheck className="h-3.5 w-3.5" />, show: staff, go: () => void run('Daily briefing', () => api.get<AIResult>('/ai/ops/briefing')) },
    { label: 'Project Risks', icon: <TriangleAlert className="h-3.5 w-3.5" />, show: staff, go: () => void ask(selectedProject ? 'Why is this project at risk?' : 'Which projects are at risk?') },
    { label: 'My Tasks', icon: <ListChecks className="h-3.5 w-3.5" />, show: true, go: () => void ask('What are my tasks?') },
    { label: 'Pending Decisions', icon: <Gavel className="h-3.5 w-3.5" />, show: staff, go: () => void ask('What approvals are waiting for me and who can approve them?') },
    { label: 'Production Problems', icon: <Factory className="h-3.5 w-3.5" />, show: staff, go: () => void ask('What production problems are blocked or overdue?') },
    { label: 'Project Summary', icon: <Briefcase className="h-3.5 w-3.5" />, show: Boolean(selectedProject), go: () => selectedProject && void run(`Summary of ${selectedProject.project_name}`, () => api.get<AIResult>(`/ai/ops/projects/${encodeURIComponent(selectedProject.id)}/summary`)) },
    { label: 'Commercial Risks', icon: <TrendingUp className="h-3.5 w-3.5" />, show: Boolean(selectedProject) && FINANCE_ROLES.includes(currentUser.role), go: () => selectedProject && void run(`Commercial analysis of ${selectedProject.project_name}`, () => api.get<AIResult>(`/ai/ops/projects/${encodeURIComponent(selectedProject.id)}/commercial`)) },
  ];

  const presets = PRESETS[currentUser.role] ?? PRESETS.staff;
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8" data-testid="operating-assistant">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-amber-600" />
            <h2 className="text-lg font-black text-slate-900">AI Operating Assistant</h2>
            {selectedProject && <Pill tone="info">{selectedProject.project_name}</Pill>}
          </div>
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> Answers only from records you ({currentUser.role}) can see · it proposes, you decide
          </span>
        </div>
        {status && (
          <p className={`mt-2 rounded-lg px-2 py-1 text-[11px] ${status.available ? 'bg-blue-50 text-blue-900' : 'bg-slate-100 text-slate-700'}`} data-testid="ai-status">
            {status.available ? `AI model: ${status.provider} · ${status.model}. ` : 'AI model unavailable. '}
            {status.detail}
          </p>
        )}
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
            placeholder="Ask NW OS anything… e.g. What do I need to know today?"
            className="flex-1 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
          <button type="submit" disabled={busy || !question.trim()} className="inline-flex items-center gap-1 rounded-xl bg-amber-500 px-4 py-2 text-xs font-black text-slate-950 disabled:opacity-50">
            <Send className="h-3.5 w-3.5" /> Ask
          </button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5" data-testid="ai-quick-actions">
          {quick
            .filter((x) => x.show)
            .map((x) => (
              <button key={x.label} type="button" disabled={busy} onClick={x.go} className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50">
                {x.icon} {x.label}
              </button>
            ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p} type="button" onClick={() => (p.includes('(') ? setQuestion(p.split(' (')[0] + ' ') : void ask(p))} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
              {p}
            </button>
          ))}
        </div>
        {busy && <p className="mt-2 text-[11px] text-slate-500">Working… (reading your records first)</p>}
        <FormError error={error} />
      </div>

      <details className="rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-sm" data-testid="ai-analyze">
        <summary className="cursor-pointer text-sm font-black text-slate-900">Analyse a problem or a drawing</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-bold text-slate-700">Problem report</p>
            <select aria-label="Problem work item" value={analyze.work_item_id} onChange={(e) => setAnalyze({ ...analyze, work_item_id: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1">
              <option value="">Work item…</option>
              {workItems
                .filter((w) => !selectedProject || w.project_id === selectedProject.id)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.item_code} {w.description?.slice(0, 40)}
                  </option>
                ))}
            </select>
            <textarea aria-label="Problem text" value={analyze.text} onChange={(e) => setAnalyze({ ...analyze, text: e.target.value })} rows={2} placeholder="e.g. Cabinet cannot fit: site wall is 2350 mm" className="w-full rounded-lg border border-slate-300 px-2 py-1" />
            <button type="button" disabled={busy || !analyze.work_item_id || !analyze.text.trim()} onClick={() => void run(`Problem: ${analyze.text.trim()}`, () => api.post<AIResult>('/ai/ops/issues/analyze', { work_item_id: analyze.work_item_id, text: analyze.text.trim() }))} className="rounded-lg bg-slate-900 px-3 py-1 font-bold text-white disabled:opacity-50">
              Analyse problem
            </button>
          </div>
          <div className="space-y-1">
            <p className="font-bold text-slate-700">Drawing</p>
            <select aria-label="Drawing to analyse" value={analyze.drawing_id} onChange={(e) => setAnalyze({ ...analyze, drawing_id: e.target.value })} className="w-full rounded-lg border border-slate-300 px-2 py-1">
              <option value="">Drawing…</option>
              {drawings
                .filter((d) => !selectedProject || d.project_id === selectedProject.id)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.drawing_number} {d.title?.slice(0, 40)}
                  </option>
                ))}
            </select>
            <button type="button" disabled={busy || !analyze.drawing_id} onClick={() => void run('Drawing analysis', () => api.post<AIResult>(`/ai/ops/drawings/${encodeURIComponent(analyze.drawing_id)}/analyze`, { question: 'What changed, which work items are affected, did production start, and does this need review?' }))} className="rounded-lg bg-slate-900 px-3 py-1 font-bold text-white disabled:opacity-50">
              Analyse drawing
            </button>
          </div>
        </div>
        <p className="mt-2 text-[10px] text-slate-500">The AI never changes drawings, dimensions or records: it explains them and may suggest a follow-up you review.</p>
      </details>

      {history.map((h, i) => (
        <div key={history.length - i} className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-xs shadow-sm">
          <p className="text-[11px] font-bold text-slate-500">{h.result.task === 'assistant_query' ? `You asked: “${h.q}”` : h.q}</p>
          <AIResponseView result={h.result} />
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
