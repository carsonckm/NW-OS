/**
 * Recurring problems detected by the server from live records you may see (last 180 days).
 * Each one is a suggestion: a person drafts a lessons-learned article, records an action,
 * or dismisses it with a reason. Nothing changes automatically.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Repeat } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { hasPermission } from '../utils/permissions';
import { FormError } from './ui/FormError';
import { Pill } from './ui/forms';

interface Pattern {
  key: string;
  title: string;
  occurrences: number;
  projects: string[];
  examples: { type: string; id: string; project_id: string; tab: string; label: string; at: string }[];
  first_seen: string;
  last_seen: string;
  knowledge_category: string;
  suggestion: string;
  knowledge: { id: string; title: string; revision: number }[];
  review: null | { decision: string; note: string | null; decided_at: string; occurrences: number };
  open: boolean;
}

export const RecurringProblems: React.FC = () => {
  const { currentUser, coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';
  const staff = !['Client', 'Contractor'].includes(currentUser.role);
  const [rows, setRows] = useState<Pattern[] | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canDraft = hasPermission(currentUser, 'knowledge.edit') || hasPermission(currentUser, 'production.propose_methods');
  const canReview = hasPermission(currentUser, 'knowledge.edit') || hasPermission(currentUser, 'automation.manage_tasks');

  const load = useCallback(async () => {
    if (!live || !staff) return;
    try {
      setRows(await api.get<Pattern[]>('/recurring-problems'));
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, [live, staff]);
  useEffect(() => {
    void load();
  }, [load, coreDataSync.lastSyncedAt]);
  if (!live || !staff) return null;

  const act = async (p: Pattern, what: 'draft' | 'Action taken' | 'Dismissed') => {
    let note: string | null = null;
    if (what !== 'draft') {
      note = window.prompt(what === 'Dismissed' ? 'Why is this not a real recurring problem?' : 'What was done about it?');
      if (note === null) return;
    }
    setBusy(p.key);
    setError(null);
    try {
      if (what === 'draft') {
        await api.post('/recurring-problems/draft-knowledge', { pattern_key: p.key });
        await coreDataSync.reloadFromDatabase();
      } else await api.post('/recurring-problems/review', { pattern_key: p.key, decision: what, note });
      await load();
    } catch (err) {
      setError(`${p.title}: ${actionErrorOf(err).message}`);
    } finally {
      setBusy(null);
    }
  };

  const shown = (rows ?? []).filter((p) => showAll || p.open);
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-sm" data-testid="recurring-problems">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Repeat className="h-4 w-4 text-rose-600" />
          <h3 className="text-sm font-black text-slate-900">Recurring problems</h3>
          <span className="text-[11px] text-slate-500">from your records, last 180 days · suggestions only, you decide</span>
        </div>
        <label className="flex items-center gap-1 text-[11px] text-slate-600">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show reviewed
        </label>
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
      {rows && !shown.length && <p className="text-xs text-slate-500">No open recurring problems.</p>}
      <ul className="divide-y divide-slate-100">
        {shown.map((p) => (
          <li key={p.key} className="space-y-1 py-2.5" data-testid={`recurring-${p.key}`}>
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={p.open ? 'bad' : 'neutral'}>{p.occurrences}×</Pill>
              <span className="text-xs font-bold text-slate-900">{p.title}</span>
              <span className="text-[10px] text-slate-500">
                {p.projects.length} project(s) · {p.first_seen.slice(0, 10)} → {p.last_seen.slice(0, 10)}
              </span>
              {p.review && <Pill tone="info">{p.review.decision} ({p.review.occurrences}× at review)</Pill>}
            </div>
            <p className="text-[11px] text-slate-600">{p.suggestion}</p>
            <p className="text-[10px] text-slate-500">
              {p.knowledge.length ? `Approved ${p.knowledge_category} knowledge exists: ${p.knowledge.map((k) => k.title).join('; ')}` : `No approved ${p.knowledge_category} article covers this yet.`}
            </p>
            <div className="flex flex-wrap gap-1">
              {p.examples.map((e) => (
                <button key={`${e.type}-${e.id}`} type="button" onClick={() => navigateTo(e.tab, e.project_id)} className="inline-flex items-center gap-0.5 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 hover:bg-slate-50">
                  {e.label} <ArrowRight className="h-2.5 w-2.5" />
                </button>
              ))}
            </div>
            {p.open && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {canDraft && (
                  <button type="button" disabled={busy === p.key} onClick={() => void act(p, 'draft')} className="rounded-lg bg-amber-500 px-2 py-1 text-[11px] font-bold text-slate-950 disabled:opacity-50">
                    Draft lessons-learned article
                  </button>
                )}
                {canReview && (
                  <>
                    <button type="button" disabled={busy === p.key} onClick={() => void act(p, 'Action taken')} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700 disabled:opacity-50">
                      Record action taken
                    </button>
                    <button type="button" disabled={busy === p.key} onClick={() => void act(p, 'Dismissed')} className="rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-500 disabled:opacity-50">
                      Dismiss
                    </button>
                  </>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};
