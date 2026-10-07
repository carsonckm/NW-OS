/**
 * My approval inbox (Phase 6 Batch 3): the approvals the server routed to the signed-in user,
 * with why they were routed here and the authority resolver's answer for them right now. For
 * the Owner: what is waiting for the Owner and why delegation was not available. Opening an
 * item goes to the record, where the usual approval action (checked again by the server) is.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { navigateTo } from '../services/navigation';
import { actionErrorOf } from '../services/records';
import { Button, Pill } from './ui/forms';

type Row = Record<string, any>;
const BASIS: Record<string, string> = {
  USER_RULE: 'Your own delegated authority',
  PROJECT_ROLE_RULE: 'Delegated to your role on this project',
  PROJECT_PERMISSION_RULE: 'Delegated on this project',
  CLIENT_RULE: "Delegated for this client's projects",
  GLOBAL_RULE: 'Delegated to your role',
  SYSTEM_POLICY: 'System Policy',
  PRIOR_OWNER_APPROVAL: "Carrying out the Owner's approval",
  CLIENT_CONSENT: 'Your consent as the client',
  OWNER_FALLBACK: 'Owner',
};
const TONE: Record<string, 'bad' | 'warn' | 'neutral' | 'info'> = { Critical: 'bad', High: 'warn', Normal: 'neutral', Low: 'info' };

export const ApprovalInbox: React.FC = () => {
  const { currentUser, coreDataSync } = useNW();
  const isOwner = currentUser.role === 'Owner / CEO';
  const [items, setItems] = useState<Row[] | null>(null);
  const [unrouted, setUnrouted] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items: Row[]; unrouted: Row[] }>('/approval-routing/inbox');
      setItems(r.items);
      setUnrouted(r.unrouted);
      setError(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    if (coreDataSync.mode === 'database') void load();
  }, [coreDataSync.mode, coreDataSync.lastSyncedAt, load]);
  if (coreDataSync.mode !== 'database') return null;

  return (
    <div className="space-y-3 rounded-2xl border border-amber-200 bg-white p-5 shadow-xs" data-testid="approval-inbox">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-amber-600" />
          <div>
            <h3 className="text-sm font-black text-slate-900">{isOwner ? 'Waiting for you (Owner)' : 'My approval inbox'}</h3>
            <p className="text-[11px] text-slate-500">
              {isOwner ? 'Approvals routed to the Owner: no delegate may decide them, and why.' : 'Approvals routed to you by your delegated authority. The server checks again when you decide.'}
            </p>
          </div>
        </div>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>
      {error && <p className="text-xs font-bold text-rose-700" role="alert">{error}</p>}
      {items && items.length === 0 && unrouted.length === 0 && <p className="text-xs text-slate-500">Nothing to decide.</p>}
      <ul className="divide-y divide-slate-100">
        {(items ?? []).map((i) => (
          <li key={i.route_id} className="flex flex-col gap-2 py-3 md:flex-row md:items-start md:justify-between" data-testid={`inbox-${i.resource_kind}-${i.resource_id}`}>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-xs font-black text-slate-900">{i.title}</span>
                <Pill tone={TONE[i.priority] ?? 'neutral'}>{i.priority}</Pill>
                {i.project_sensitivity && i.project_sensitivity !== 'Normal' && <Pill tone="bad">{i.project_sensitivity}</Pill>}
              </div>
              <div className="text-[11px] text-slate-600">
                {i.project_name ?? 'No project'} · {i.decision_type.replace('_', ' ')}
                {i.value != null ? ` · RM ${Number(i.value).toLocaleString('en-US')}` : ''}
                {i.project_risk ? ` · risk ${i.project_risk}` : ''}
                {i.due_at ? ` · due ${String(i.due_at).slice(0, 10)}` : ''} · routed {String(i.routed_at).slice(0, 10)}
              </div>
              <div className="text-[11px]" data-testid="inbox-why">
                {i.routing_basis === 'OWNER_FALLBACK' ? (
                  <span className="font-semibold text-rose-800">
                    Owner required — {i.owner_reason_code}
                    {i.owner_reason ? `: ${i.owner_reason}` : ''}
                  </span>
                ) : (
                  <span className="font-semibold text-emerald-800">
                    Why you: {BASIS[i.routing_basis] ?? i.routing_basis}
                    {i.authority_rule_code ? ` (${i.authority_rule_code}${i.authority_rule_name ? ` · ${i.authority_rule_name}` : ''})` : ''}
                  </span>
                )}
              </div>
              {!i.current.allowed && (
                <div className="text-[11px] font-bold text-amber-800" data-testid="inbox-stale">
                  Your authority changed ({i.current.reason_code}): {i.current.reason}. It will be routed again.
                </div>
              )}
            </div>
            <Button tone="primary" onClick={() => i.link && navigateTo(i.link.tab, i.project_id ?? undefined, i.link.focus)}>
              Open record
            </Button>
          </li>
        ))}
      </ul>
      {isOwner && unrouted.length > 0 && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 p-3 text-xs" data-testid="inbox-unrouted">
          <div className="font-black text-rose-900">Not yet routed ({unrouted.length}) — yours until routed</div>
          <ul>
            {unrouted.map((u) => (
              <li key={`${u.kind}:${u.id}`}>
                {u.kind} {u.id}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
