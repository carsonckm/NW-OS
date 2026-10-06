/**
 * The signed-in person's daily briefing from the server (/api/briefing): today's tasks,
 * overdue work, blocked production, deliveries, site QC, drawings, material shortages, the
 * projects at risk and why, and the decisions waiting for them. Live records only.
 */
import React, { useEffect, useState } from 'react';
import { Sunrise } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { FormError } from './ui/FormError';
import { Pill } from './ui/forms';
import { RISK_TONE, type RiskLevel } from './ProjectHealth';

interface Item {
  label: string;
  detail: string;
  tab: string;
  project_id: string | null;
  entity_type?: string;
  entity_id?: string;
}
interface Briefing {
  date: string;
  today: Record<string, Item[] | number>;
  risks: { project_id: string; project_name: string; level: RiskLevel; reasons: string[] }[];
  decisions: Item[];
  generated_at: string;
}
const SECTIONS: [string, string][] = [
  ['tasks_due', 'Due today'],
  ['tasks_overdue', 'Overdue'],
  ['production_blocked', 'Production blocked'],
  ['deliveries_next_2_days', 'Deliveries (next 2 days)'],
  ['site_qc', 'Site QC'],
  ['drawings_awaiting_review', 'Drawings awaiting review'],
  ['material_shortages', 'Material shortages'],
];
const open = (i: Item) => navigateTo(i.tab, i.project_id ?? undefined, i.entity_type && i.entity_id ? { type: i.entity_type, id: i.entity_id } : undefined);

export const DailyBriefing: React.FC = () => {
  const { coreDataSync, currentUser } = useNW();
  const live = coreDataSync.mode === 'database' && !['Client', 'Contractor'].includes(currentUser.role);
  const [b, setB] = useState<Briefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!live) return;
    api.get<Briefing>('/briefing').then(setB).catch((err) => setError(actionErrorOf(err).message));
  }, [live, coreDataSync.lastSyncedAt]);
  if (!live) return null;
  const count = (k: string) => (Array.isArray(b?.today[k]) ? (b!.today[k] as Item[]).length : 0);
  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="daily-briefing">
      <div className="flex items-center gap-2">
        <Sunrise className="h-4 w-4 text-amber-600" />
        <h3 className="text-sm font-black text-slate-900">Today{b ? ` · ${b.date}` : ''}</h3>
        <span className="text-[11px] text-slate-500">from live records</span>
      </div>
      <FormError error={error} />
      {b && (
        <>
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            {SECTIONS.map(([k, label]) => (
              <Pill key={k} tone={count(k) ? (k === 'tasks_overdue' || k === 'production_blocked' || k === 'material_shortages' ? 'bad' : 'warn') : 'neutral'}>
                {count(k)} {label.toLowerCase()}
              </Pill>
            ))}
            {typeof b.today.team_overdue_tasks === 'number' && b.today.team_overdue_tasks > 0 && <Pill tone="warn">{b.today.team_overdue_tasks} overdue in your team</Pill>}
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <p className="mb-1 text-xs font-bold text-slate-700">Today</p>
              <ul className="space-y-1 text-xs">
                {SECTIONS.flatMap(([k]) => (Array.isArray(b.today[k]) ? (b.today[k] as Item[]) : []).map((i, n) => (
                  <li key={`${k}${n}`}>
                    <button type="button" onClick={() => open(i)} className="text-left hover:underline">
                      <strong>{i.label}</strong> <span className="text-slate-500">{i.detail}</span>
                    </button>
                  </li>
                )))}
                {SECTIONS.every(([k]) => !count(k)) && <li className="text-slate-500">Nothing due or blocked.</li>}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-slate-700">Risks</p>
              <ul className="space-y-1 text-xs">
                {b.risks.map((r) => (
                  <li key={r.project_id}>
                    <button type="button" onClick={() => navigateTo('projects', r.project_id)} className="text-left hover:underline">
                      <Pill tone={RISK_TONE[r.level]}>{r.level}</Pill> <strong>{r.project_name}</strong>
                    </button>
                    <span className="block text-[11px] text-slate-500">{r.reasons.join('; ')}</span>
                  </li>
                ))}
                {!b.risks.length && <li className="text-slate-500">No project at risk.</li>}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-bold text-slate-700">Decisions for you</p>
              <ul className="space-y-1 text-xs">
                {b.decisions.map((d, n) => (
                  <li key={n}>
                    <button type="button" onClick={() => open(d)} className="text-left hover:underline">
                      <strong>{d.label}</strong> <span className="text-slate-500">{d.detail}</span>
                    </button>
                  </li>
                ))}
                {!b.decisions.length && <li className="text-slate-500">No decisions waiting.</li>}
              </ul>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
