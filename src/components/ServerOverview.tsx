/**
 * Server-computed oversight: the exceptions list (what needs someone's attention) and a
 * project's overview, both read from PostgreSQL through /api/exceptions and
 * /api/projects/:id/overview. Nothing here is calculated in the browser.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, ArrowRight, RefreshCw } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { FormError } from './ui/FormError';
import { Pill, rm } from './ui/forms';

export interface ExceptionItem {
  id: string;
  kind: string;
  severity: 'critical' | 'high' | 'medium';
  project_id: string;
  project_name: string;
  title: string;
  detail: string;
  tab: string;
  entity_id: string;
  owner_action: boolean;
}

export interface ProjectOverview {
  project: { id: string; project_name: string; project_status: string };
  work_items: { total: number; completed: number };
  drawings: { approved_current: number; in_review: number; drafts: number };
  issues: { open: number };
  variations: { pending: number; approved: number } | null;
  production: { active: number; blocked: number; done: number } | null;
  installation: { total: number; completed: number } | null;
  handover_status: string | null;
  tasks: { open: number };
  profitability: null | {
    original_contract_value: number;
    current_contract_value: number;
    estimated_direct_cost: number;
    committed_cost: number;
    actual_cost: number;
    forecast_final_cost: number;
    project_gross_profit: number;
    project_gross_margin_percent: number;
    cost_variance_status?: string;
  };
  exceptions: ExceptionItem[];
  computed_at: string;
}

const SEV_TONE = { critical: 'bad', high: 'warn', medium: 'info' } as const;

/** Loads a server report; reloads whenever the app re-syncs. */
function useServerReport<T>(path: string | null) {
  const { coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    if (!live || !path) return;
    setLoading(true);
    try {
      setData(await api.get<T>(path));
      setError(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setLoading(false);
    }
  }, [live, path]);
  useEffect(() => {
    void load();
  }, [load, coreDataSync.lastSyncedAt]);
  return { live, data, error, loading, reload: load };
}

export const ExceptionList: React.FC<{ items: ExceptionItem[]; showProject?: boolean; empty?: string; limit?: number }> = ({ items, showProject, empty, limit }) => {
  const shown = limit ? items.slice(0, limit) : items;
  if (!items.length) return <p className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50 p-4 text-center text-xs font-bold text-emerald-800">{empty ?? 'Nothing needs attention.'}</p>;
  return (
    <ul className="divide-y divide-slate-100" data-testid="exception-list">
      {shown.map((e) => (
        <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Pill tone={SEV_TONE[e.severity]}>{e.severity}</Pill>
              {e.owner_action && <Pill tone="bad">Your decision</Pill>}
              <span className="text-xs font-bold text-slate-900">{e.title}</span>
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {showProject && <span className="font-bold text-slate-700">{e.project_name} · </span>}
              {e.detail}
            </p>
          </div>
          <button type="button" onClick={() => navigateTo(e.tab, e.project_id)} className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
            Open <ArrowRight className="h-3 w-3" />
          </button>
        </li>
      ))}
      {limit && items.length > limit && <li className="py-2 text-[11px] text-slate-500">…and {items.length - limit} more</li>}
    </ul>
  );
};

/** Company-wide (or in-scope) exceptions, for dashboards. */
export const ExceptionsPanel: React.FC<{ title?: string; ownerFirst?: boolean; limit?: number }> = ({ title = 'Needs attention', ownerFirst, limit }) => {
  const { live, data, error, loading, reload } = useServerReport<ExceptionItem[]>('/exceptions');
  if (!live) return null;
  const items = data ?? [];
  const sorted = ownerFirst ? [...items.filter((e) => e.owner_action), ...items.filter((e) => !e.owner_action)] : items;
  const mine = items.filter((e) => e.owner_action).length;
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="exceptions-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertOctagon className="h-4 w-4 text-rose-600" />
          <h3 className="text-sm font-black text-slate-900">{title}</h3>
          <span className="text-[11px] text-slate-500">
            {items.length} open{ownerFirst ? ` · ${mine} need your decision` : ''} · from the database
          </span>
        </div>
        <button type="button" onClick={() => void reload()} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>
      <FormError error={error} />
      {data && <ExceptionList items={sorted} showProject limit={limit} />}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; sub?: string; tab?: string; projectId: string }> = ({ label, value, sub, tab, projectId }) => (
  <button
    type="button"
    disabled={!tab}
    onClick={() => tab && navigateTo(tab, projectId)}
    className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-amber-400 disabled:cursor-default disabled:hover:border-slate-200"
  >
    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
    <div className="font-mono text-lg font-black text-slate-900">{value}</div>
    {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
  </button>
);

/** One project's live state, workflow links and exceptions. */
export const ProjectServerOverview: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { live, data, error } = useServerReport<ProjectOverview>(`/projects/${encodeURIComponent(projectId)}/overview`);
  if (!live) return null;
  const p = data?.profitability;
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4" data-testid="project-server-overview">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-900">Project overview (live from the database)</h3>
        {data && <span className="text-[10px] text-slate-500">as of {new Date(data.computed_at).toLocaleTimeString()}</span>}
      </div>
      <FormError error={error} />
      {data && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            <Stat projectId={projectId} label="Status" value={data.project.project_status} sub={data.handover_status ? `Handover: ${data.handover_status}` : 'No handover yet'} tab="delivery" />
            <Stat projectId={projectId} label="Work items" value={`${data.work_items.completed}/${data.work_items.total}`} sub="completed" tab="work-items" />
            <Stat projectId={projectId} label="Drawings" value={data.drawings.approved_current} sub={`${data.drawings.in_review} in review · ${data.drawings.drafts} draft`} tab="drawings" />
            {data.production && <Stat projectId={projectId} label="Production" value={data.production.active} sub={`${data.production.blocked} blocked · ${data.production.done} ready/done`} tab="production" />}
            {data.installation && <Stat projectId={projectId} label="Installation" value={`${data.installation.completed}/${data.installation.total}`} sub="completed" tab="delivery" />}
            <Stat projectId={projectId} label="Open issues" value={data.issues.open} sub={`${data.tasks.open} open tasks`} tab="issues" />
            {data.variations && <Stat projectId={projectId} label="Variations" value={data.variations.pending} sub={`pending · ${data.variations.approved} approved`} tab="variations" />}
            {p && <Stat projectId={projectId} label="Forecast GP" value={rm(p.project_gross_profit)} sub={`${p.project_gross_margin_percent}% of ${rm(p.current_contract_value)}`} tab="commercial" />}
          </div>
          {p && (
            <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-5" data-testid="overview-money">
              <span>Contract (original): <strong>{rm(p.original_contract_value)}</strong></span>
              <span>Budget: <strong>{rm(p.estimated_direct_cost)}</strong></span>
              <span>Committed: <strong>{rm(p.committed_cost)}</strong></span>
              <span>Actual: <strong>{rm(p.actual_cost)}</strong></span>
              <span>Forecast final cost: <strong>{rm(p.forecast_final_cost)}</strong></span>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-bold text-slate-700">Exceptions on this project ({data.exceptions.length})</p>
            <ExceptionList items={data.exceptions} empty="No exceptions on this project." />
          </div>
        </>
      )}
    </div>
  );
};
