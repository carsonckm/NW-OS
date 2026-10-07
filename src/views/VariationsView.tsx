/**
 * Variations: Identified -> Costing -> Internal Approval -> Client Approval -> Approved ->
 * Implemented -> Closed (or Rejected before approval).
 *
 * Every step goes through POST /api/variations/:id/transition; the server decides who may
 * take it (no self-approval; client approval separate from internal approval), keeps the
 * history, freezes approved amounts and computes the contract value. Internal cost and notes
 * are never sent to clients.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useFocus } from '../services/navigation';
import { GitPullRequest, Plus } from 'lucide-react';
import { useNW } from '../context/NWContext';
import type { Variation } from '../types';
import { hasPermission } from '../utils/permissions';
import { api } from '../services/coreApi';
import { actionErrorOf, useRecords } from '../services/records';
import { FormError } from '../components/ui/FormError';
import { AuthorityNote } from '../components/AuthorityNote';
import { authorityItem, useAuthority } from '../services/authority';
import { Button, Field, Input, Modal, newId, Pill, rm, Section, Select, TextArea } from '../components/ui/forms';

const FLOW = ['Identified', 'Costing', 'Internal Approval', 'Client Approval', 'Approved', 'Implemented', 'Closed'];
const REASONS = ['Client request', 'Site condition', 'Design change', 'Drawing revision', 'Authority requirement', 'Other'];
const tone = (s: string) => (['Approved', 'Implemented', 'Closed'].includes(s) ? 'good' : s === 'Rejected' ? 'bad' : s === 'Client Approval' || s === 'Internal Approval' ? 'warn' : 'neutral');

interface ContractSummary {
  original_contract_value: number;
  approved_variations_total: number;
  current_contract_value: number;
  pending_variations_total: number;
  approved_variations_count: number;
  pending_variations_count: number;
}

export const VariationsView: React.FC = () => {
  const { variations, projects, selectedProjectId, setSelectedProjectId, currentUser, coreDataSync } = useNW();
  const [selected, setSelected] = useState<string | null>(null);
  const focus = useFocus(['variation']);
  useEffect(() => {
    if (focus) setSelected(focus.id);
  }, [focus]);
  const [creating, setCreating] = useState(false);
  const [summary, setSummary] = useState<ContractSummary | null>(null);
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(currentUser, p);
  const rows = useMemo(
    () => variations.filter((v) => !selectedProjectId || v.project_id === selectedProjectId).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
    [variations, selectedProjectId]
  );
  const current = rows.find((v) => v.id === selected) ?? rows[0];

  // The official contract value is the server's.
  useEffect(() => {
    if (coreDataSync.mode !== 'database' || !selectedProjectId || !can('commercial.view')) return setSummary(null);
    let cancelled = false;
    api.get<ContractSummary>(`/projects/${encodeURIComponent(selectedProjectId)}/contract-summary`).then(
      (s) => !cancelled && setSummary(s),
      () => !cancelled && setSummary(null)
    );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, coreDataSync.mode, coreDataSync.lastSyncedAt, variations]);

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
            <GitPullRequest className="h-5 w-5 text-amber-600" /> Variations
          </h2>
          <p className="text-xs text-slate-500">Raise, cost, approve internally, get the client's approval, implement and close</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} aria-label="Variations project" className="w-72">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} · {p.project_name}
              </option>
            ))}
          </Select>
          {can('variations.create') && (
            <Button tone="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New variation
            </Button>
          )}
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4" data-testid="contract-summary">
          {[
            ['Original contract', rm(summary.original_contract_value), 'Never changes'],
            ['Approved variations', rm(summary.approved_variations_total), `${summary.approved_variations_count} approved`],
            ['Current contract value', rm(summary.current_contract_value), 'Original + approved'],
            ['Pending variations', rm(summary.pending_variations_total), `${summary.pending_variations_count} not yet approved`],
          ].map(([label, value, note]) => (
            <div key={label} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="text-[10px] font-bold uppercase text-slate-400">{label}</div>
              <div className="mt-1 text-sm font-black text-slate-900">{value}</div>
              <div className="text-[11px] text-slate-500">{note}</div>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Section title={`Variations (${rows.length})`}>
          <div className="space-y-1.5">
            {rows.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setSelected(v.id)}
                data-testid={`variation-${v.variation_number}`}
                className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs ${current?.id === v.id ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-slate-50'}`}
              >
                <span>
                  <span className="font-mono font-bold">{v.variation_number}</span>
                  <span className="block text-[11px] text-slate-600">{v.title}</span>
                </span>
                <span className="text-right">
                  <Pill tone={tone(v.status)}>{v.status}</Pill>
                  <span className="block text-[11px] font-bold text-slate-700">{rm(v.client_amount)}</span>
                </span>
              </button>
            ))}
            {!rows.length && <p className="text-xs text-slate-400">No variations on this project.</p>}
          </div>
        </Section>
        <div className="lg:col-span-2">{current && <VariationDetail v={current} />}</div>
      </div>
      {creating && <VariationForm projectId={selectedProjectId} onClose={() => setCreating(false)} onSaved={setSelected} />}
    </div>
  );
};

const VariationDetail: React.FC<{ v: Variation }> = ({ v }) => {
  const { currentUser } = useNW();
  const records = useRecords();
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(currentUser, p);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [reference, setReference] = useState('');
  const [editing, setEditing] = useState(false);
  const isClient = currentUser.role === 'Client';
  const costing = can('commercial.costing');

  const move = async (status: string) => {
    setError(null);
    setBusy(status);
    try {
      await records.action(`/variations/${v.id}/transition`, { status, note: note || undefined, client_approval_reference: reference || undefined }, { apply: 'variations' });
      setNote('');
      setReference('');
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };

  const stage = v.status;
  const preApproval = ['Identified', 'Costing', 'Internal Approval', 'Client Approval'].includes(stage);
  // Internal approval and internal rejection: the server's authority resolver decides (live
  // system; demo mode keeps the permission-based buttons). The client's acceptance or decline
  // at the client stage is their consent, not internal authority.
  const approveItem = authorityItem('variation', v.id);
  const rejectItem = authorityItem('variation', v.id, 'reject');
  const clientStageDecline = stage === 'Client Approval' && can('variations.client_approve');
  const authority = useAuthority([...(stage === 'Internal Approval' ? [approveItem] : []), ...(preApproval && stage !== 'Client Approval' ? [rejectItem] : [])]);
  const may = (item: string) => (authority.live ? Boolean(authority.get(item)?.allowed) : can('variations.approve'));
  const actions: { status: string; label: string; tone?: 'primary' | 'success' | 'danger'; show: boolean }[] = [
    { status: 'Costing', label: 'Start costing', show: stage === 'Identified' && can('variations.create') },
    { status: 'Internal Approval', label: 'Send for internal approval', tone: 'primary', show: ['Identified', 'Costing'].includes(stage) && can('variations.create') },
    { status: 'Client Approval', label: 'Approve internally → send to client', tone: 'success', show: stage === 'Internal Approval' && may(approveItem) },
    { status: 'Approved', label: isClient ? 'Accept variation' : "Record client's approval", tone: 'success', show: stage === 'Client Approval' && can('variations.client_approve') },
    { status: 'Implemented', label: 'Mark implemented', tone: 'primary', show: stage === 'Approved' && (can('variations.approve') || can('variations.create')) },
    { status: 'Closed', label: 'Close', show: stage === 'Implemented' && can('variations.approve') },
    { status: 'Rejected', label: isClient ? 'Decline' : 'Reject', tone: 'danger', show: preApproval && (stage === 'Client Approval' ? clientStageDecline : may(rejectItem)) },
  ];

  return (
    <Section
      title={`${v.variation_number} · ${v.title}`}
      subtitle={[v.reason, v.client_reference && `Client ref ${v.client_reference}`, v.created_by_name && `raised by ${v.created_by_name}`].filter(Boolean).join(' · ') || undefined}
      actions={<Pill tone={tone(stage)}>{stage}</Pill>}
    >
      <div className="flex flex-wrap gap-1 text-[10px]">
        {FLOW.map((s, i) => (
          <span key={s} className={`rounded-full px-2 py-0.5 font-bold ${s === stage ? 'bg-amber-500 text-slate-950' : FLOW.indexOf(stage) > i ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-500'}`}>
            {s}
          </span>
        ))}
        {stage === 'Rejected' && <span className="rounded-full bg-rose-100 px-2 py-0.5 font-bold text-rose-800">Rejected</span>}
      </div>
      <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Selling price (client)</div>
          <div className="text-sm font-black">{rm(v.client_amount)}</div>
        </div>
        {costing && (
          <div className="rounded-xl bg-rose-50 p-3">
            <div className="text-[10px] font-bold uppercase text-rose-400">Internal cost</div>
            <div className="text-sm font-black text-rose-800">{rm(v.estimated_cost)}</div>
          </div>
        )}
        <div className="rounded-xl bg-slate-50 p-3">
          <div className="text-[10px] font-bold uppercase text-slate-400">Schedule impact</div>
          <div className="text-sm font-black">{v.schedule_impact_days} days</div>
        </div>
      </div>
      <div className="space-y-2 text-xs">
        <p className="text-slate-700">{v.description}</p>
        {v.scope_change && (
          <p>
            <span className="font-bold">Scope change: </span>
            {v.scope_change}
          </p>
        )}
        {!!v.supporting_documents?.length && (
          <p>
            <span className="font-bold">Documents: </span>
            {v.supporting_documents.join(', ')}
          </p>
        )}
        {costing && v.internal_notes && <p className="rounded-lg bg-rose-50 p-2 text-rose-800">Internal: {v.internal_notes}</p>}
        {v.rejection_reason && <p className="text-rose-700">Rejected: {v.rejection_reason}</p>}
      </div>

      {stage === 'Internal Approval' && authority.live && <AuthorityNote authority={authority.get(approveItem)} />}
      {actions.some((a) => a.show) && (
        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Note for this step (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value)} aria-label="Variation step note" />
            </Field>
            {stage === 'Client Approval' && !isClient && (
              <Field label="Client approval reference" hint="Signed VO, letter or email reference — required when recording on the client's behalf">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} aria-label="Client approval reference" />
              </Field>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {actions
              .filter((a) => a.show)
              .map((a) => (
                <Button key={a.status} tone={a.tone ?? 'secondary'} busy={busy === a.status} onClick={() => move(a.status)}>
                  {a.label}
                </Button>
              ))}
            {preApproval && stage !== 'Client Approval' && can('variations.create') && <Button onClick={() => setEditing(true)}>Edit</Button>}
          </div>
          <FormError error={error} onDismiss={() => setError(null)} />
        </div>
      )}

      <div>
        <div className="mb-1 text-[10px] font-extrabold uppercase text-slate-400">History</div>
        <ol className="space-y-1 text-xs" data-testid="variation-history">
          {(v.history ?? []).map((h, i) => (
            <li key={i} className="flex flex-wrap gap-2">
              <span className="text-slate-400">{h.at.slice(0, 16).replace('T', ' ')}</span>
              <span className="font-bold">{h.from ? `${h.from} → ${h.to}` : h.to}</span>
              <span>
                by {h.by_name} ({h.role})
              </span>
              {h.note && <span className="text-slate-600">“{h.note}”</span>}
              {h.reference && <span className="text-slate-600">ref {h.reference}</span>}
            </li>
          ))}
          {!v.history?.length && <li className="text-slate-400">Recorded before history was kept.</li>}
        </ol>
      </div>
      {editing && <VariationForm projectId={v.project_id} variation={v} onClose={() => setEditing(false)} />}
    </Section>
  );
};

const VariationForm: React.FC<{ projectId: string; variation?: Variation; onClose: () => void; onSaved?: (id: string) => void }> = ({ projectId, variation, onClose, onSaved }) => {
  const { variations, projects, clientChangeRequests, currentUser } = useNW();
  const records = useRecords();
  const costing = hasPermission(currentUser, 'commercial.costing');
  const project = projects.find((p) => p.id === (variation?.project_id ?? projectId));
  const count = variations.filter((x) => x.project_id === project?.id).length;
  const [f, setF] = useState<Partial<Variation>>(
    variation ?? {
      project_id: project?.id,
      variation_number: `VO-${String(count + 1).padStart(3, '0')}`,
      title: '',
      description: '',
      reason: 'Client request',
      estimated_cost: 0,
      client_amount: 0,
      schedule_impact_days: 0,
      status: 'Identified',
      requested_by: currentUser.name,
      supporting_documents: [],
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Variation) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const save = async () => {
    setError(null);
    if (!f.title?.trim() || !f.description?.trim()) return setError('Title and description are required.');
    const record = { ...f, estimated_cost: Number(f.estimated_cost) || 0, client_amount: Number(f.client_amount) || 0, schedule_impact_days: Number(f.schedule_impact_days) || 0 };
    setBusy(true);
    try {
      if (variation) await records.update('variations', variation.id, record, variation);
      else {
        const created = await records.create('variations', { ...record, id: newId('vo'), created_at: new Date().toISOString() });
        onSaved?.(String(created.id));
      }
      onClose();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={variation ? `Edit ${variation.variation_number}` : `New variation · ${project?.project_name ?? ''}`}
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={save}>
            Save variation
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="VO number">
          <Input value={f.variation_number ?? ''} onChange={set('variation_number')} />
        </Field>
        <Field label="Reason">
          <Select value={f.reason ?? ''} onChange={set('reason')}>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </Select>
        </Field>
        <Field label="Title" className="sm:col-span-2">
          <Input value={f.title ?? ''} onChange={set('title')} aria-label="Variation title" />
        </Field>
        <Field label="Client request / reference">
          <Input value={f.client_reference ?? ''} onChange={set('client_reference')} />
        </Field>
        <Field label="Linked client change request">
          <Select value={f.client_change_request_id ?? ''} onChange={set('client_change_request_id')}>
            <option value="">—</option>
            {clientChangeRequests
              .filter((c) => c.project_id === f.project_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.request_code}
                </option>
              ))}
          </Select>
        </Field>
        {costing && (
          <Field label="Internal cost (RM)" hint="Never shown to the client">
            <Input type="number" value={f.estimated_cost ?? 0} onChange={set('estimated_cost')} aria-label="Variation internal cost" />
          </Field>
        )}
        <Field label="Selling price to client (RM)">
          <Input type="number" value={f.client_amount ?? 0} onChange={set('client_amount')} aria-label="Variation selling price" />
        </Field>
        <Field label="Schedule impact (days)">
          <Input type="number" value={f.schedule_impact_days ?? 0} onChange={set('schedule_impact_days')} />
        </Field>
      </div>
      <Field label="Description">
        <TextArea value={f.description ?? ''} onChange={set('description')} aria-label="Variation description" />
      </Field>
      <Field label="Scope change">
        <TextArea value={f.scope_change ?? ''} onChange={set('scope_change')} rows={2} />
      </Field>
      <Field label="Supporting documents" hint="One file name or link per line">
        <TextArea
          value={(f.supporting_documents ?? []).join('\n')}
          onChange={(e) => setF((p) => ({ ...p, supporting_documents: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) }))}
          rows={2}
        />
      </Field>
      {costing && (
        <Field label="Internal notes" hint="Never shown to the client">
          <TextArea value={f.internal_notes ?? ''} onChange={set('internal_notes')} rows={2} />
        </Field>
      )}
    </Modal>
  );
};
