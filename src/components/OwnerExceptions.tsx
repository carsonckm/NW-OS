/**
 * Owner Exceptions (Phase 6 Batch 4): "What requires my attention right now?" Everything
 * shown comes from /api/owner/exceptions: severity, priority score and its reasons are
 * decided on the server. Actions call the normal endpoints, where the authority resolver
 * checks again; nothing here changes a record directly.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { BellOff, ShieldAlert } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { navigateTo } from '../services/navigation';
import { actionErrorOf } from '../services/records';
import { ApprovalHistory } from './ApprovalHistory';
import { Button, Input, Pill, Select } from './ui/forms';

type Row = Record<string, any>;
type Severity = 'critical' | 'urgent' | 'attention' | 'info';
const SEV: Record<Severity, { label: string; tone: 'bad' | 'warn' | 'info' | 'good'; dot: string }> = {
  critical: { label: 'Critical', tone: 'bad', dot: '🔴' },
  urgent: { label: 'Urgent', tone: 'warn', dot: '🟠' },
  attention: { label: 'Attention', tone: 'info', dot: '🟡' },
  info: { label: 'Informational', tone: 'good', dot: '🟢' },
};
const age = (h: number | null) => (h == null ? null : h >= 48 ? `${Math.floor(h / 24)} days` : `${h}h`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : null);

const Card: React.FC<{ e: Row; onDone: () => void }> = ({ e, onDone }) => {
  const [panel, setPanel] = useState<'none' | 'history' | 'assign' | 'snooze'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eligible, setEligible] = useState<Row[]>([]);
  const [assignee, setAssignee] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('24');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPanel('none');
      onDone();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const openAssign = async () => {
    setPanel('assign');
    try {
      const x = await api.get<Row>(`/approval-routing/explain?kind=${e.resource.kind}&id=${encodeURIComponent(e.resource.id)}`);
      setEligible(x.current_route?.eligible ?? []);
    } catch {
      setEligible([]);
    }
  };
  const decide = (decision: string) => act(() => api.post(`/approvals/${encodeURIComponent(e.resource.id)}/decision`, { decision }));
  const facts = [
    e.project_name && `Project: ${e.project_name}`,
    e.client_name && `Client: ${e.client_name}`,
    e.decision && `Decision: ${String(e.decision).replace('_', ' ')}`,
    e.value != null && `Value: RM ${Number(e.value).toLocaleString('en-US')}`,
    e.risk && `Risk: ${e.risk}`,
    e.due_at && `Due: ${day(e.due_at)}`,
    e.age_hours != null && `Age: ${age(e.age_hours)}`,
  ].filter(Boolean);
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid={`owner-exception-${e.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Pill tone={SEV[e.severity as Severity].tone}>
          {SEV[e.severity as Severity].dot} {String(e.type).replace(/_/g, ' ')}
        </Pill>
        <span className="text-xs font-black text-slate-900">{e.title}</span>
        {e.status && <Pill tone="neutral">{e.status}</Pill>}
        <span className="ml-auto text-[10px] font-bold text-slate-500" title="Priority score: the sum of the reasons below">
          Priority {e.priority_score}
        </span>
      </div>
      <p className="text-[11px] text-slate-600">{facts.join(' · ')}</p>
      <p className="text-[11px] text-slate-700">
        <span className="font-bold">Current approver:</span> {e.current_approver ? `${e.current_approver.name} (${e.current_approver.role})` : e.resource ? 'None' : '—'}
      </p>
      <p className="text-[11px] text-slate-700">
        <span className="font-bold">Why you see it:</span> {e.why_owner}
      </p>
      {e.reasons?.length > 0 && (
        <ul className="flex flex-wrap gap-1" data-testid="exception-reasons">
          {e.reasons.map((r: Row, i: number) => (
            <li key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700" title={r.code}>
              {r.label}
              {r.points ? ` +${r.points}` : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] font-bold text-amber-800">Recommended: {e.recommended}</p>
      {error && <p className="text-[11px] font-bold text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-1">
        {e.actions.includes('open') && e.link && (
          <Button tone="primary" onClick={() => navigateTo(e.link.tab, e.project_id ?? undefined, e.link.focus)}>
            Open record
          </Button>
        )}
        {e.actions.includes('approve') && (
          <>
            <Button tone="success" busy={busy} onClick={() => void decide('Approved')}>
              Approve
            </Button>
            <Button tone="danger" busy={busy} onClick={() => void decide('Rejected')}>
              Reject
            </Button>
            <Button busy={busy} onClick={() => void decide('Changes Requested')}>
              Request changes
            </Button>
          </>
        )}
        {e.actions.includes('reroute') && e.resource && (
          <Button busy={busy} onClick={() => void act(() => api.post('/approval-routing/route', e.resource))} title="Route it again against current authority">
            Re-route
          </Button>
        )}
        {e.actions.includes('assign') && <Button onClick={() => void openAssign()}>Assign</Button>}
        {(e.actions.includes('history') || e.resource) && <Button onClick={() => setPanel(panel === 'history' ? 'none' : 'history')}>{panel === 'history' ? 'Hide history' : 'History & authority'}</Button>}
        {e.severity !== 'critical' && !e.snoozed_until && (
          <Button onClick={() => setPanel('snooze')}>
            <BellOff className="h-3 w-3" /> Snooze
          </Button>
        )}
        {e.snoozed_until && (
          <Button onClick={() => void act(() => api.delete(`/owner/exceptions/snooze/${encodeURIComponent(e.id)}`))}>Un-snooze (was until {day(e.snoozed_until)})</Button>
        )}
      </div>
      {panel === 'history' && e.resource && <ApprovalHistory kind={e.resource.kind} id={e.resource.id} />}
      {panel === 'assign' && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          <Select value={assignee} onChange={(ev) => setAssignee(ev.target.value)} className="max-w-xs">
            <option value="">Choose who decides it…</option>
            {eligible.map((c) => (
              <option key={c.user_id} value={c.user_id}>
                {c.name} ({c.role}) · {c.rule_code ?? c.basis}
              </option>
            ))}
          </Select>
          <Input placeholder="Reason (required)" value={reason} onChange={(ev) => setReason(ev.target.value)} className="max-w-xs" />
          <Button tone="primary" busy={busy} disabled={!assignee || !reason.trim()} onClick={() => void act(() => api.post('/approval-routing/assign', { ...e.resource, user_id: assignee, reason }))}>
            Assign
          </Button>
          <span className="text-[10px] text-slate-500">Only people the authority policy allows are listed; the server checks again.</span>
        </div>
      )}
      {panel === 'snooze' && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          <Select value={hours} onChange={(ev) => setHours(ev.target.value)} className="max-w-[10rem]">
            {['4', '24', '72', '168'].map((h) => (
              <option key={h} value={h}>
                {Number(h) < 24 ? `${h} hours` : `${Number(h) / 24} day(s)`}
              </option>
            ))}
          </Select>
          <Input placeholder="Reason (required)" value={reason} onChange={(ev) => setReason(ev.target.value)} className="max-w-xs" />
          <Button tone="primary" busy={busy} disabled={!reason.trim()} onClick={() => void act(() => api.post('/owner/exceptions/snooze', { id: e.id, hours: Number(hours), reason }))}>
            Snooze
          </Button>
          <span className="text-[10px] text-slate-500">It comes back when the snooze ends, or at once if it becomes critical.</span>
        </div>
      )}
    </li>
  );
};

export const OwnerExceptions: React.FC = () => {
  const { coreDataSync } = useNW();
  const [data, setData] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const load = useCallback(async () => {
    try {
      setData(await api.get<Row>('/owner/exceptions'));
      setError(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    if (coreDataSync.mode === 'database') void load();
  }, [coreDataSync.mode, coreDataSync.lastSyncedAt, load]);
  if (coreDataSync.mode !== 'database') return null;
  const s = data?.summary;
  const groups: Severity[] = ['critical', 'urgent', 'attention'];
  return (
    <div className="space-y-3 rounded-2xl border border-rose-200 bg-white p-4 shadow-sm" data-testid="owner-exceptions">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-rose-600" />
          <div>
            <h3 className="text-sm font-black text-slate-900">Owner Exceptions</h3>
            <p className="text-[11px] text-slate-500">What requires your attention right now. Severity and priority are set by the server, with the reasons shown.</p>
          </div>
        </div>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>
      {error && <p className="text-xs font-bold text-rose-700" role="alert">{error}</p>}
      {s && (
        <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-4" data-testid="owner-exceptions-summary">
          <div className="rounded-xl bg-slate-50 p-2 font-bold text-slate-800">
            <div>🔴 Critical {s.critical}</div>
            <div>🟠 Urgent {s.urgent}</div>
            <div>🟡 Attention {s.attention}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 text-slate-700">
            <div className="font-black text-slate-900">Approvals</div>
            <div>{s.approvals.overdue} overdue · {s.approvals.escalated} escalated</div>
            <div>{s.approvals.blocked} blocked · {s.approvals.due_today} due today</div>
            <div>{s.approvals.waiting_for_owner} waiting for you</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 text-slate-700">
            <div className="font-black text-slate-900">Projects</div>
            <div>{s.projects.critical} critical</div>
            <div>{s.projects.at_risk} at risk</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 text-slate-700">
            <div className="font-black text-slate-900">Delegation</div>
            <div>{s.delegation.rules_expiring} rule(s) expiring in 7 days</div>
            <div>{s.delegation.approvals_with_no_delegate} approval(s) with no delegate</div>
          </div>
        </div>
      )}
      {data &&
        groups.map((g) => {
          const items = (data.exceptions as Row[]).filter((e) => e.severity === g);
          if (!items.length) return null;
          return (
            <div key={g} className="space-y-2" data-testid={`owner-exceptions-${g}`}>
              <h4 className="text-xs font-black text-slate-800">
                {SEV[g].dot} {SEV[g].label} ({items.length})
              </h4>
              <ul className="space-y-2">
                {items.map((e) => (
                  <Card key={e.id} e={e} onDone={() => void load()} />
                ))}
              </ul>
            </div>
          );
        })}
      {data && (data.exceptions as Row[]).length === 0 && <p className="text-xs text-emerald-700">Nothing needs you right now.</p>}
      {data && (data.informational.length > 0 || data.snoozed.length > 0) && (
        <div className="space-y-2">
          <Button onClick={() => setShowInfo(!showInfo)}>
            {showInfo ? 'Hide' : 'Show'} informational ({data.informational.length}) and snoozed ({data.snoozed.length})
          </Button>
          {showInfo && (
            <ul className="space-y-2">
              {[...data.snoozed, ...data.informational].map((e: Row) => (
                <Card key={e.id} e={e} onDone={() => void load()} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};
