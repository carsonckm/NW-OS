/**
 * Approval SLAs and Owner routing (Phase 6 Batch 4), in Delegated Authority settings. Everyone
 * with authority.view can read them; only the Owner changes them (the server enforces it and
 * audits every change). SLAs set when an approval is due and escalated; they never change who
 * may approve.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { Button, Input, Pill, Section, Select } from './ui/forms';

type Row = Record<string, any>;
const DAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const PolicyRow: React.FC<{ p: Row; canManage: boolean; onSaved: () => void }> = ({ p, canManage, onSaved }) => {
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<Row>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = () => {
    setForm({ sla_business_days: String(p.sla_business_days), reminder_pct: String(p.reminder_pct), due_soon_pct: String(p.due_soon_pct), escalate_pct: String(p.escalate_pct), escalate_to: p.escalate_to, reason: '' });
    setEdit(true);
  };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.put(`/authority/sla/${p.decision_type}`, {
        sla_business_days: Number(form.sla_business_days),
        reminder_pct: Number(form.reminder_pct),
        due_soon_pct: Number(form.due_soon_pct),
        escalate_pct: Number(form.escalate_pct),
        escalate_to: form.escalate_to,
        reason: form.reason,
      });
      setEdit(false);
      onSaved();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <tr className="border-t border-slate-100 align-top" data-testid={`sla-${p.decision_type}`}>
      <td className="py-1.5 pr-2 font-bold text-slate-900">{p.label}</td>
      {edit ? (
        <>
          <td className="pr-2"><Input type="number" step="0.5" min="0.5" value={form.sla_business_days} onChange={f('sla_business_days')} className="w-20" /></td>
          <td className="pr-2">
            <div className="flex gap-1">
              <Input type="number" value={form.reminder_pct} onChange={f('reminder_pct')} className="w-16" title="Reminder %" />
              <Input type="number" value={form.due_soon_pct} onChange={f('due_soon_pct')} className="w-16" title="Due soon %" />
              <Input type="number" value={form.escalate_pct} onChange={f('escalate_pct')} className="w-16" title="Escalation %" />
            </div>
          </td>
          <td className="pr-2">
            <Select value={form.escalate_to} onChange={f('escalate_to')}>
              <option value="owner">Owner</option>
              <option value="next_eligible">Next eligible delegate (else Owner)</option>
            </Select>
          </td>
          <td>
            <div className="flex flex-col gap-1">
              <Input placeholder="Reason (required)" value={form.reason} onChange={f('reason')} />
              <div className="flex gap-1">
                <Button tone="primary" busy={busy} disabled={!form.reason?.trim()} onClick={() => void save()}>Save</Button>
                <Button onClick={() => setEdit(false)}>Cancel</Button>
              </div>
              {error && <span className="text-[11px] font-bold text-rose-700">{error}</span>}
            </div>
          </td>
        </>
      ) : (
        <>
          <td className="pr-2">{p.sla_business_days} working day(s)</td>
          <td className="pr-2">
            {p.reminder_pct}% / {p.due_soon_pct}% / 100% / {p.escalate_pct}%
          </td>
          <td className="pr-2">{p.escalate_to === 'owner' ? 'Owner' : 'Next eligible delegate, else Owner'}</td>
          <td>{canManage && <Button onClick={start}>Change</Button>}</td>
        </>
      )}
    </tr>
  );
};

export const ApprovalSlaSettings: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const [sla, setSla] = useState<Row | null>(null);
  const [owners, setOwners] = useState<Row | null>(null);
  const [draft, setDraft] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [s, o] = await Promise.all([api.get<Row>('/authority/sla'), api.get<Row>('/authority/owner-routing')]);
      setSla(s);
      setOwners(o);
      setDraft(o.owners.map((x: Row) => ({ id: x.id, owner_priority: x.owner_priority, is_primary_owner: x.is_primary_owner })));
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const saveOwners = async () => {
    setError(null);
    try {
      const r = await api.put<Row>('/authority/owner-routing', { owners: draft });
      setSaved(`Saved. ${r.receives_fallbacks?.name ?? 'Nobody'} now receives Owner approvals (${r.routing_changes.rerouted} re-routed).`);
      await load();
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  };
  return (
    <div className="space-y-4" data-testid="approval-sla-settings">
      {error && <p className="text-xs font-bold text-rose-700" role="alert">{error}</p>}
      <Section title="Approval SLAs" subtitle={sla?.note}>
        {sla && (
          <>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500">
                  <th>Decision</th>
                  <th>SLA</th>
                  <th>Reminder / due soon / overdue / escalate</th>
                  <th>Escalates to</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sla.policies.map((p: Row) => (
                  <PolicyRow key={p.decision_type} p={p} canManage={canManage} onSaved={() => void load()} />
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500">
              Working days: {(sla.calendar.working_days as number[]).map((d) => DAYS[d]).join(', ')} (UTC{sla.calendar.utc_offset_minutes >= 0 ? '+' : ''}
              {sla.calendar.utc_offset_minutes / 60}); {sla.calendar.holidays.length} public holidays. Pending approvals keep the due date they were given.
            </p>
          </>
        )}
      </Section>
      <Section title="Owner routing" subtitle={owners?.order}>
        {owners && (
          <div className="space-y-2">
            <p className="text-xs text-slate-700">
              Owner approvals go to: <span className="font-black">{owners.receives_fallbacks?.name ?? 'nobody (no active Owner)'}</span>
            </p>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500">
                  <th>Owner</th>
                  <th>Active</th>
                  <th>Priority</th>
                  <th>Primary</th>
                </tr>
              </thead>
              <tbody>
                {owners.owners.map((o: Row, i: number) => (
                  <tr key={o.id} className="border-t border-slate-100">
                    <td className="py-1.5 font-bold">{o.name}</td>
                    <td>{o.is_active ? <Pill tone="good">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</td>
                    <td>
                      <Input type="number" min="0" max="1000" disabled={!canManage} value={draft[i]?.owner_priority ?? 0} onChange={(e) => setDraft(draft.map((d, j) => (j === i ? { ...d, owner_priority: Number(e.target.value) } : d)))} className="w-20" />
                    </td>
                    <td>
                      <input type="radio" name="primary-owner" disabled={!canManage} checked={Boolean(draft[i]?.is_primary_owner)} onChange={() => setDraft(draft.map((d, j) => ({ ...d, is_primary_owner: j === i })))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canManage && (
              <div className="flex gap-1">
                <Button tone="primary" onClick={() => void saveOwners()}>Save Owner routing</Button>
                <Button onClick={() => setDraft(draft.map((d) => ({ ...d, is_primary_owner: false })))}>No primary Owner</Button>
              </div>
            )}
            {saved && <p className="text-[11px] font-semibold text-emerald-800">{saved}</p>}
          </div>
        )}
      </Section>
    </div>
  );
};
