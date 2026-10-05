/**
 * Notification center: the signed-in user's notifications from the server, grouped into
 * action required, approvals, warnings, escalations and information. Escalations ask to be
 * acknowledged. Each notification opens the record it is about.
 */
import React, { useMemo, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { useServerNotifications, type ServerNotification } from '../../services/notifications';
import { linkFor, navigateTo } from '../../services/navigation';
import { Button, Pill } from '../../components/ui/forms';

const GROUPS = [
  { key: 'all', label: 'All' },
  { key: 'action', label: 'Action required' },
  { key: 'approval', label: 'Approvals' },
  { key: 'escalation', label: 'Escalations' },
  { key: 'warning', label: 'Warnings' },
  { key: 'information', label: 'Information' },
] as const;
const TONE = { action: 'warn', approval: 'info', escalation: 'bad', warning: 'warn', information: 'neutral' } as const;

export function openNotification(n: ServerNotification) {
  navigateTo(linkFor(n.entity_type, n.link_tab), n.project_id ?? undefined, n.entity_type && n.entity_id ? { type: n.entity_type, id: n.entity_id } : undefined);
}

export const NotificationCenter: React.FC = () => {
  const { enabled, items, markRead, markAllRead, acknowledge } = useServerNotifications();
  const [group, setGroup] = useState<(typeof GROUPS)[number]['key']>('all');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const n of items) if (!n.is_read) c[n.group ?? 'information'] = (c[n.group ?? 'information'] ?? 0) + 1;
    return c;
  }, [items]);
  const shown = items.filter((n) => (group === 'all' || n.group === group) && (!unreadOnly || !n.is_read));
  if (!enabled) {
    return <div className="mx-auto max-w-4xl p-6 text-xs text-slate-500">The notification center needs the NW OS database (sign in to the live system).</div>;
  }
  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6 sm:px-6 lg:px-8" data-testid="notification-center">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
          <Bell className="h-5 w-5 text-amber-600" /> Notifications
        </h2>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Unread only
          </label>
          <Button onClick={() => void markAllRead()}>
            <CheckCheck className="h-3.5 w-3.5" /> Mark all read
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            type="button"
            onClick={() => setGroup(g.key)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold ${group === g.key ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {g.label}
            {g.key !== 'all' && counts[g.key] ? <span className="ml-1.5 rounded-full bg-rose-600 px-1.5 text-[10px] text-white">{counts[g.key]}</span> : null}
          </button>
        ))}
      </div>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
        {shown.length === 0 && <li className="p-6 text-center text-xs text-slate-500">Nothing here.</li>}
        {shown.map((n) => (
          <li key={n.id} className={`flex flex-wrap items-start justify-between gap-3 px-4 py-3 ${n.is_read ? '' : 'bg-amber-50/40'}`} data-testid={`notification-${n.id}`}>
            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => { void markRead(n.id); openNotification(n); }}>
              <div className="flex flex-wrap items-center gap-1.5">
                <Pill tone={TONE[n.group ?? 'information']}>{n.group ?? 'information'}</Pill>
                {n.priority !== 'normal' && <Pill tone={n.priority === 'urgent' ? 'bad' : 'warn'}>{n.priority}</Pill>}
                <span className="text-xs font-bold text-slate-900">{n.title}</span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-600">{n.message}</p>
              <p className="mt-0.5 text-[10px] text-slate-400">
                {new Date(n.created_at).toLocaleString()} · {n.source ? `automation: ${n.source.replace(/_/g, ' ')}` : 'system'}
              </p>
            </button>
            <div className="flex items-center gap-1.5">
              {n.requires_ack && !n.acknowledged_at && (
                <Button tone="primary" onClick={() => void acknowledge(n.id)}>
                  Acknowledge
                </Button>
              )}
              {n.requires_ack && n.acknowledged_at && <span className="text-[10px] font-bold text-emerald-700">Acknowledged</span>}
              <Button onClick={() => { void markRead(n.id); openNotification(n); }}>Open</Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};
