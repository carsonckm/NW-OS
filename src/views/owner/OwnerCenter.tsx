/**
 * Owner Exception Center: "What needs me today?" Decisions, critical / financial / client
 * exceptions and company health from /api/owner/center, and how much still depends on the
 * Owner from /api/owner/dependency. Every item opens the record to act on. For the Owner,
 * Owner Exceptions (Phase 6 Batch 4) comes first: approvals, authority and project exceptions
 * ranked by the server.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AlertOctagon, Gavel, HeartPulse, RefreshCw, TrendingDown, Users } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { api } from '../../services/coreApi';
import { actionErrorOf } from '../../services/records';
import { navigateTo } from '../../services/navigation';
import { FormError } from '../../components/ui/FormError';
import { Pill, rm } from '../../components/ui/forms';
import { RISK_TONE, type RiskLevel } from '../../components/ProjectHealth';
import { OwnerExceptions } from '../../components/OwnerExceptions';
import { OwnerDependency } from '../../components/OwnerDependency';

interface Item {
  id: string;
  title: string;
  detail: string;
  severity: 'critical' | 'high' | 'medium';
  project_id: string | null;
  project_name: string;
  tab: string;
  entity_type?: string;
  entity_id?: string;
  waiting_hours?: number;
}
interface Center {
  decisions: Item[];
  critical: Item[];
  financial: Item[];
  client: Item[];
  health: Record<string, number>;
  risk: { project_id: string; project_name: string; level: RiskLevel; reasons: string[] }[];
  computed_at: string;
}
interface Dependency {
  today: Record<string, number>;
  week: { owner_actions: number; repeatable_operational_decisions: number; by_category: { category: string; count: number; routine: number }[] };
  waiting: {
    tasks_assigned_to_owner: number;
    tasks_waiting_for_owner: number;
    approvals_waiting_for_owner: number;
    escalations_to_owner: number;
    projects_blocked_by_owner: { project_id: string; project_name: string }[];
  };
  average_response_hours: number | null;
  recommendations: { category: string; observed: string; suggestion: string }[];
  note: string;
}
const SEV = { critical: 'bad', high: 'warn', medium: 'info' } as const;
const open = (i: Item) => navigateTo(i.tab, i.project_id ?? undefined, i.entity_type && i.entity_id ? { type: i.entity_type, id: i.entity_id } : undefined);
const waited = (h?: number) => (h === undefined ? '' : h >= 48 ? ` · waiting ${Math.floor(h / 24)} days` : h >= 1 ? ` · waiting ${h}h` : '');

const List: React.FC<{ title: string; icon: React.ReactNode; items: Item[]; empty: string; testId: string }> = ({ title, icon, items, empty, testId }) => {
  const [all, setAll] = useState(false);
  return (
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={testId}>
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="text-sm font-black text-slate-900">{title}</h3>
        <span className="rounded-full bg-slate-100 px-2 text-[11px] font-bold text-slate-600">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-emerald-700">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {(all ? items : items.slice(0, 12)).map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => open(i)} className="w-full py-1.5 text-left hover:bg-slate-50">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Pill tone={SEV[i.severity]}>{i.severity}</Pill>
                  <span className="text-xs font-bold text-slate-900">{i.title}</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  {i.project_name ? `${i.project_name} · ` : ''}
                  {i.detail}
                  {waited(i.waiting_hours)}
                </p>
              </button>
            </li>
          ))}
          {items.length > 12 && (
            <li className="py-1">
              <button type="button" onClick={() => setAll(!all)} className="text-[11px] font-bold text-slate-600 hover:text-slate-900">
                {all ? 'Show fewer' : `Show all ${items.length}`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
};

export const OwnerCenter: React.FC = () => {
  const { coreDataSync, currentUser } = useNW();
  const [c, setC] = useState<Center | null>(null);
  const [d, setD] = useState<Dependency | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [center, dep] = await Promise.all([api.get<Center>('/owner/center'), api.get<Dependency>('/owner/dependency')]);
      setC(center);
      setD(dep);
      setError(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, coreDataSync.lastSyncedAt]);

  const h = c?.health;
  return (
    <div className="space-y-4" data-testid="owner-center">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-xl font-black text-slate-900">What needs you today</h2>
          <p className="text-xs text-slate-500">Only decisions and exceptions. Routine work is handled and escalated by the team and NW OS.</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 hover:text-slate-800">
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>
      <FormError error={error} />
      {/* Phase 6 Batch 4: approvals and authority exceptions that need the Owner (Owner only). */}
      {currentUser.role === 'Owner / CEO' && <OwnerExceptions />}
      {/* Phase 6 Batch 5: how much still depends on the Owner, and delegation opportunities (Owner only). */}
      {currentUser.role === 'Owner / CEO' && <OwnerDependency />}
      {c && h && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" data-testid="owner-health">
            {[
              ['Decisions for you', h.outstanding_approvals],
              ['Projects at risk', h.at_risk],
              ['Projects critical', h.critical],
              ['Overdue tasks', h.overdue_tasks],
              ['Active projects', h.active_projects],
              ['Client payments overdue', rm(h.outstanding_payments)],
              ['Committed cost', rm(h.committed_cost)],
              ['Actual cost', rm(h.actual_cost)],
              ['Forecast exposure', rm(h.forecast_exposure)],
              ['Open projects', h.open_projects],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
                <div className="font-mono text-lg font-black text-slate-900">{value}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <List
              title="Decisions required"
              icon={<Gavel className="h-4 w-4 text-amber-600" />}
              items={c.decisions}
              empty="No decisions waiting for you."
              testId="owner-decisions"
            />
            <List
              title="Critical exceptions"
              icon={<AlertOctagon className="h-4 w-4 text-rose-600" />}
              items={c.critical}
              empty="Nothing critical."
              testId="owner-critical"
            />
            <List
              title="Financial exceptions"
              icon={<TrendingDown className="h-4 w-4 text-rose-600" />}
              items={c.financial}
              empty="No financial exceptions."
              testId="owner-financial"
            />
            <List
              title="Client exceptions"
              icon={<Users className="h-4 w-4 text-sky-600" />}
              items={c.client}
              empty="No client exceptions."
              testId="owner-client"
            />
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-2 flex items-center gap-2">
              <HeartPulse className="h-4 w-4 text-slate-600" />
              <h3 className="text-sm font-black text-slate-900">Project health</h3>
            </div>
            <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {c.risk.map((r) => (
                <li key={r.project_id}>
                  <button type="button" onClick={() => navigateTo('projects', r.project_id)} className="text-left text-xs hover:underline">
                    <Pill tone={RISK_TONE[r.level]}>{r.level}</Pill> <strong>{r.project_name}</strong>
                    {r.reasons.length > 0 && <span className="block text-[11px] text-slate-500">{r.reasons.join('; ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {d && (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/40 p-4" data-testid="owner-dependency">
          <h3 className="text-sm font-black text-slate-900">How much still depends on you</h3>
          <div className="flex flex-wrap gap-2 text-xs">
            <Pill tone="warn">Today: {d.today.decisions} decisions</Pill>
            <Pill tone="warn">{d.today.approvals} approvals</Pill>
            <Pill tone="bad">{d.today.escalations} escalations</Pill>
            <Pill tone="info">{d.today.client_issues} client issues</Pill>
            <Pill tone="neutral">This week: {d.week.owner_actions} owner actions</Pill>
            <Pill tone="neutral">{d.week.repeatable_operational_decisions} repeatable operational decisions</Pill>
            <Pill tone="neutral">Average response: {d.average_response_hours === null ? '—' : `${d.average_response_hours}h`}</Pill>
          </div>
          {d.waiting.projects_blocked_by_owner.length > 0 && (
            <p className="text-xs text-rose-800">
              Projects waiting on you for more than 2 days: <strong>{d.waiting.projects_blocked_by_owner.map((p) => p.project_name).join(', ')}</strong>
            </p>
          )}
          {d.week.by_category.length > 0 && (
            <p className="text-[11px] text-slate-600">This week by type: {d.week.by_category.map((x) => `${x.category} ${x.count}`).join(' · ')}</p>
          )}
          {d.recommendations.map((r) => (
            <div key={r.category} className="rounded-xl border border-amber-300 bg-white p-2 text-xs">
              <p className="font-bold text-slate-900">{r.observed}</p>
              <p className="text-slate-700">{r.suggestion}</p>
            </div>
          ))}
          <p className="text-[10px] text-slate-500">{d.note}</p>
        </div>
      )}
    </div>
  );
};
