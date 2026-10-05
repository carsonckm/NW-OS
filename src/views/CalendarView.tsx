/**
 * Schedule & deadlines (database mode): every recorded date the signed-in user may see —
 * task due dates, deliveries, installation windows, production required dates, material
 * needed-by dates, invoice due dates (financial roles) and planned completions — grouped by
 * day, with filters. The server applies the same scope as every other screen. It shows
 * dates; it never moves or promises them.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { FormError } from '../components/ui/FormError';
import { Pill, Select } from '../components/ui/forms';

interface CalEvent {
  id: string;
  date: string;
  type: string;
  title: string;
  status: string;
  project_id: string | null;
  project_name: string;
  person_id: string | null;
  person_name: string | null;
  role: string | null;
  tab: string;
  overdue: boolean;
}

const TYPES: Record<string, string> = {
  task: 'Task',
  delivery: 'Delivery',
  installation_start: 'Install start',
  installation_due: 'Install due',
  production: 'Production',
  material: 'Material',
  invoice: 'Invoice',
  handover: 'Completion',
};
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const CalendarView: React.FC = () => {
  const { projects, coreDataSync } = useNW();
  const [range, setRange] = useState(() => ({ from: iso(new Date(Date.now() - 7 * 86400_000)), to: iso(new Date(Date.now() + 30 * 86400_000)) }));
  const [f, setF] = useState({ project_id: '', person_id: '', role: '', status: 'open', type: '' });
  const [events, setEvents] = useState<CalEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(Object.entries({ ...range, ...f }).filter(([, v]) => v) as [string, string][]);
    api
      .get<CalEvent[]>(`/calendar?${q.toString()}`)
      .then((e) => {
        setEvents(e);
        setError(null);
      })
      .catch((err) => setError(actionErrorOf(err).message));
  }, [range, f, coreDataSync.lastSyncedAt]);

  // People and roles to filter by come from the events themselves (only what you can see).
  const people = useMemo(() => [...new Map((events ?? []).filter((e) => e.person_id).map((e) => [e.person_id!, e.person_name ?? e.person_id!])).entries()], [events]);
  const roles = useMemo(() => [...new Set((events ?? []).map((e) => e.role).filter(Boolean) as string[])].sort(), [events]);
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>();
    for (const e of events ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return [...m.entries()];
  }, [events]);
  const today = iso(new Date());

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-6 sm:px-6 lg:px-8" data-testid="calendar-view">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <CalendarDays className="h-5 w-5 text-amber-600" />
          <h2 className="text-lg font-black text-slate-900">Schedule &amp; deadlines</h2>
          <span className="text-[11px] text-slate-500">recorded dates you can see · {events ? `${events.length} item(s), ${events.filter((e) => e.overdue).length} overdue` : 'loading…'}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <input type="date" aria-label="From" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
          <input type="date" aria-label="To" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
          <Select aria-label="Project" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.project_name}</option>
            ))}
          </Select>
          <Select aria-label="Person" value={f.person_id} onChange={(e) => setF({ ...f, person_id: e.target.value })}>
            <option value="">Everyone</option>
            {people.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </Select>
          <Select aria-label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            <option value="">All roles</option>
            {roles.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
          <Select aria-label="Status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="open">Open</option>
            <option value="overdue">Overdue</option>
            <option value="">Any status</option>
          </Select>
          <Select aria-label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            <option value="">All types</option>
            {Object.entries(TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </Select>
        </div>
        <FormError error={error} onDismiss={() => setError(null)} />
      </div>

      {events && !events.length && <p className="text-center text-xs text-slate-500">Nothing scheduled for these filters.</p>}
      {byDay.map(([d, list]) => (
        <div key={d} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid={`cal-day-${d}`}>
          <p className={`mb-2 text-xs font-black ${d < today ? 'text-rose-700' : d === today ? 'text-amber-700' : 'text-slate-700'}`}>
            {new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
            {d === today ? ' · today' : ''}
          </p>
          <ul className="divide-y divide-slate-100">
            {list.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-xs">
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  <Pill tone={e.overdue ? 'bad' : 'info'}>{TYPES[e.type] ?? e.type}</Pill>
                  <span className="font-bold text-slate-900">{e.title}</span>
                  <span className="text-[11px] text-slate-500">
                    {e.project_name}
                    {e.person_name ? ` · ${e.person_name}` : e.role ? ` · ${e.role}` : ''} · {e.status}
                    {e.overdue ? ' · overdue' : ''}
                  </span>
                </span>
                <button type="button" onClick={() => navigateTo(e.tab, e.project_id ?? undefined)} className="text-slate-400 hover:text-slate-700" title="Open">
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};
