/**
 * Phase 4 sales workflow: Enquiry -> Tender -> Quotation (versions, internal costing,
 * internal approval, client quotation) -> Award -> Convert to Project.
 *
 * Every write goes to the server (useRecords): it prices quotations, enforces the status
 * flow and who may approve, and builds the client quotation without internal figures.
 */
import React, { useMemo, useState } from 'react';
import { Briefcase, FileText, Plus, Printer, Send } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import type { ClientEnquiry, CommercialQuotation, CommercialTender, QuotationItem, QuotationItemUnit } from '../../types';
import { hasPermission } from '../../utils/permissions';
import { api } from '../../services/coreApi';
import { navigateTo } from '../../services/navigation';
import { actionErrorOf, NEEDS_DATABASE, useRecords } from '../../services/records';
import { FormError } from '../../components/ui/FormError';
import { addDays, Button, Field, Input, Modal, newId, Pill, rm, Section, Select, TextArea, today } from '../../components/ui/forms';

const ENQUIRY_STATUSES: ClientEnquiry['status'][] = ['New', 'Reviewing', 'Tender Invited', 'Quoted', 'Won', 'Lost', 'Cancelled'];
const TENDER_STATUSES: CommercialTender['status'][] = ['In Preparation', 'Submitted', 'Shortlisted', 'Awarded', 'Regretted', 'Lost'];
const SOURCES = ['Referral', 'Repeat client', 'Website', 'Walk-in', 'Tender portal', 'Architect / ID', 'Other'];
const UNITS: QuotationItemUnit[] = ['pcs', 'set', 'unit', 'lot', 'm', 'mm', 'ft', 'sqft', 'sqm', 'kg'];
const CATEGORIES = ['Joinery', 'Carpentry', 'Glass', 'Metal', 'Upholstery', 'Finishes', 'Hardware', 'Add-on', 'Preliminaries'];
const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

const statusTone = (s: string) =>
  ['Won', 'Awarded', 'Accepted', 'Approved'].includes(s)
    ? 'good'
    : ['Lost', 'Rejected', 'Regretted', 'Cancelled', 'Expired'].includes(s)
      ? 'bad'
      : ['Submitted', 'Quoted', 'Tender Invited', 'Shortlisted'].includes(s)
        ? 'info'
        : ['Internal Review', 'Negotiation', 'Reviewing'].includes(s)
          ? 'warn'
          : 'neutral';

function useSales() {
  const nw = useNW();
  const records = useRecords();
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(nw.currentUser, p);
  const people = nw.availableUsers.filter((u) => u.status !== 'inactive');
  return { ...nw, records, can, people };
}

// =========================================================================
// ENQUIRIES
// =========================================================================
export const EnquiriesPanel: React.FC = () => {
  const { clientEnquiries, can } = useSales();
  const [editing, setEditing] = useState<ClientEnquiry | 'new' | null>(null);
  const [tenderFrom, setTenderFrom] = useState<ClientEnquiry | null>(null);
  const [quoteFrom, setQuoteFrom] = useState<{ enquiry?: ClientEnquiry; tender?: CommercialTender } | null>(null);
  const editable = can('commercial.edit');
  const rows = [...clientEnquiries].sort((a, b) => String(b.received_date).localeCompare(String(a.received_date)));

  return (
    <Section
      title="Client Enquiries"
      subtitle="Every lead from first contact until it is quoted, won or lost"
      actions={
        editable && (
          <Button tone="primary" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> New Enquiry
          </Button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Enquiry</th>
              <th className="px-3 py-2.5">Client / Contact</th>
              <th className="px-3 py-2.5">Project / Site</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Received / Quote due</th>
              <th className="px-3 py-2.5">Owner / Follow-up</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-slate-50/80" data-testid={`enquiry-${e.enquiry_number}`}>
                <td className="px-3 py-3 font-bold text-slate-900">{e.enquiry_number}</td>
                <td className="px-3 py-3">
                  <div className="font-semibold text-slate-800">{e.client_name}</div>
                  <div className="text-[11px] text-slate-500">{e.contact_person ?? '—'}</div>
                </td>
                <td className="max-w-xs px-3 py-3">
                  <div className="line-clamp-1 font-bold text-slate-900">{e.project_name}</div>
                  <div className="line-clamp-1 text-[11px] text-slate-500">{e.scope_description}</div>
                </td>
                <td className="px-3 py-3 text-slate-600">{e.source ?? '—'}</td>
                <td className="px-3 py-3 text-[11px] text-slate-600">
                  <div>{e.received_date}</div>
                  <div className="text-slate-400">Due {e.target_submission_date}</div>
                </td>
                <td className="px-3 py-3 text-[11px] text-slate-600">
                  <div>{e.assigned_estimator}</div>
                  {e.follow_up_date && <div className="text-amber-700">Follow up {e.follow_up_date}</div>}
                </td>
                <td className="px-3 py-3">
                  <Pill tone={statusTone(e.status)}>{e.status}</Pill>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {editable && (
                    <div className="flex justify-end gap-1.5">
                      <Button onClick={() => setEditing(e)}>Edit</Button>
                      {!['Won', 'Lost', 'Cancelled'].includes(e.status) && (
                        <>
                          <Button onClick={() => setTenderFrom(e)}>Create Tender</Button>
                          <Button onClick={() => setQuoteFrom({ enquiry: e })}>Quote</Button>
                        </>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EnquiryForm enquiry={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {tenderFrom && <TenderForm fromEnquiry={tenderFrom} onClose={() => setTenderFrom(null)} />}
      {quoteFrom && <QuotationEditor from={quoteFrom} onClose={() => setQuoteFrom(null)} />}
    </Section>
  );
};

const EnquiryForm: React.FC<{ enquiry?: ClientEnquiry; onClose: () => void }> = ({ enquiry, onClose }) => {
  const { clients, clientEnquiries, records, people } = useSales();
  const [f, setF] = useState<Partial<ClientEnquiry>>(
    enquiry ?? {
      enquiry_number: `ENQ-${new Date().getFullYear()}-${String(clientEnquiries.length + 1).padStart(3, '0')}`,
      received_date: today(),
      target_submission_date: addDays(today(), 14),
      status: 'New',
      source: 'Referral',
      documents: [],
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ClientEnquiry) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const save = async () => {
    setError(null);
    const client = clients.find((c) => c.id === f.client_id);
    if (!client || !f.project_name?.trim() || !f.scope_description?.trim()) return setError('Client, project / site name and scope are required.');
    const assignee = people.find((p) => p.id === f.assigned_user_id);
    const record = {
      ...f,
      client_name: client.company_name,
      assigned_estimator: assignee?.name ?? f.assigned_estimator ?? '',
      budget_expectation: f.budget_expectation ? Number(f.budget_expectation) : undefined,
    };
    setBusy(true);
    try {
      if (enquiry) await records.update('clientEnquiries', enquiry.id, record, enquiry);
      else await records.create('clientEnquiries', { ...record, id: newId('enq') });
      onClose();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={enquiry ? `Edit ${enquiry.enquiry_number}` : 'New Client Enquiry'}
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={save}>
            Save Enquiry
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Enquiry number">
          <Input value={f.enquiry_number ?? ''} onChange={set('enquiry_number')} />
        </Field>
        <Field label="Client">
          <Select value={f.client_id ?? ''} onChange={set('client_id')} aria-label="Enquiry client">
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Contact person">
          <Input value={f.contact_person ?? ''} onChange={set('contact_person')} placeholder="Name, title" />
        </Field>
        <Field label="Contact phone / email">
          <Input value={f.contact_phone ?? ''} onChange={set('contact_phone')} placeholder="+60 12-…" />
        </Field>
        <Field label="Project / site name">
          <Input value={f.project_name ?? ''} onChange={set('project_name')} placeholder="e.g. Pavilion L3 boutique" />
        </Field>
        <Field label="Site address">
          <Input value={f.site_address ?? ''} onChange={set('site_address')} />
        </Field>
        <Field label="Source">
          <Select value={f.source ?? ''} onChange={set('source')}>
            {SOURCES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="Budget expectation (RM, optional)">
          <Input type="number" value={f.budget_expectation ?? ''} onChange={set('budget_expectation')} />
        </Field>
        <Field label="Enquiry date">
          <Input type="date" value={f.received_date ?? ''} onChange={set('received_date')} />
        </Field>
        <Field label="Expected tender / quotation date">
          <Input type="date" value={f.target_submission_date ?? ''} onChange={set('target_submission_date')} />
        </Field>
        <Field label="Assigned to">
          <Select value={f.assigned_user_id ?? ''} onChange={set('assigned_user_id')}>
            <option value="">—</option>
            {people
              .filter((p) => ['Owner / CEO', 'Admin', 'Project Manager', 'Accountant'].includes(p.role))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.role})
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Follow-up date">
          <Input type="date" value={f.follow_up_date ?? ''} onChange={set('follow_up_date')} />
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            {ENQUIRY_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Scope description">
        <TextArea value={f.scope_description ?? ''} onChange={set('scope_description')} />
      </Field>
      <Field label="Attachments / documents" hint="One file name or link per line">
        <TextArea value={(f.documents ?? []).join('\n')} onChange={(e) => setF((p) => ({ ...p, documents: lines(e.target.value) }))} rows={2} />
      </Field>
      <Field label="Notes">
        <TextArea value={f.notes ?? ''} onChange={set('notes')} rows={2} />
      </Field>
    </Modal>
  );
};

// =========================================================================
// TENDERS
// =========================================================================
export const TendersPanel: React.FC = () => {
  const { commercialTenders, can } = useSales();
  const [editing, setEditing] = useState<CommercialTender | 'new' | null>(null);
  const [quoteFrom, setQuoteFrom] = useState<CommercialTender | null>(null);
  const editable = can('commercial.edit');
  return (
    <Section
      title="Tenders"
      subtitle="Scope, BQ, drawings and the submission record for each tender"
      actions={
        editable && (
          <Button tone="primary" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> New Tender
          </Button>
        )
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Tender</th>
              <th className="px-3 py-2.5">Client / Project</th>
              <th className="px-3 py-2.5">Deadline</th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Est. value</th>
              <th className="px-3 py-2.5">Submitted</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {commercialTenders.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50/80" data-testid={`tender-${t.tender_number}`}>
                <td className="px-3 py-3">
                  <div className="font-bold text-slate-900">{t.tender_number}</div>
                  <div className="text-[11px] text-slate-500">{t.tender_reference ?? ''}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-semibold text-slate-800">{t.client_name}</div>
                  <div className="text-[11px] text-slate-500">{t.project_name}</div>
                </td>
                <td className="px-3 py-3 text-slate-700">{t.submission_deadline}</td>
                <td className="px-3 py-3 text-slate-700">{t.assigned_lead}</td>
                <td className="px-3 py-3 font-bold text-slate-900">{rm(t.estimated_value)}</td>
                <td className="px-3 py-3 text-[11px] text-slate-600">{t.submission_record ? `${t.submission_record.submitted_at.slice(0, 10)} · ${t.submission_record.method}` : '—'}</td>
                <td className="px-3 py-3">
                  <Pill tone={statusTone(t.status)}>{t.status}</Pill>
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-right">
                  {editable && (
                    <div className="flex justify-end gap-1.5">
                      <Button onClick={() => setEditing(t)}>Edit</Button>
                      {!['Awarded', 'Lost', 'Regretted'].includes(t.status) && <Button onClick={() => setQuoteFrom(t)}>Quote</Button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <TenderForm tender={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {quoteFrom && <QuotationEditor from={{ tender: quoteFrom }} onClose={() => setQuoteFrom(null)} />}
    </Section>
  );
};

const TenderForm: React.FC<{ tender?: CommercialTender; fromEnquiry?: ClientEnquiry; onClose: () => void }> = ({ tender, fromEnquiry, onClose }) => {
  const { clients, clientEnquiries, commercialTenders, records, people, currentUser } = useSales();
  const [f, setF] = useState<Partial<CommercialTender>>(
    tender ?? {
      tender_number: `TDR-${new Date().getFullYear()}-${String(commercialTenders.length + 1).padStart(3, '0')}`,
      enquiry_id: fromEnquiry?.id,
      client_id: fromEnquiry?.client_id,
      project_name: fromEnquiry?.project_name ?? '',
      site_address: fromEnquiry?.site_address,
      scope: fromEnquiry?.scope_description,
      submission_deadline: fromEnquiry?.target_submission_date ?? addDays(today(), 14),
      estimated_value: fromEnquiry?.budget_expectation ?? 0,
      status: 'In Preparation',
      documents: fromEnquiry?.documents ?? [],
      assigned_user_id: fromEnquiry?.assigned_user_id,
    }
  );
  const [submitted, setSubmitted] = useState({ method: tender?.submission_record?.method ?? 'Email', reference: tender?.submission_record?.reference ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof CommercialTender) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));

  const pickEnquiry = (id: string) => {
    const enq = clientEnquiries.find((e) => e.id === id);
    setF((p) => ({ ...p, enquiry_id: id || undefined, ...(enq ? { client_id: enq.client_id, project_name: enq.project_name, site_address: enq.site_address, scope: p.scope || enq.scope_description } : {}) }));
  };

  const save = async () => {
    setError(null);
    const client = clients.find((c) => c.id === f.client_id);
    if (!client || !f.project_name?.trim()) return setError('Client and project / site are required.');
    const lead = people.find((p) => p.id === f.assigned_user_id);
    const nowSubmitted = f.status === 'Submitted' && !tender?.submission_record;
    const record: Partial<CommercialTender> = {
      ...f,
      client_name: client.company_name,
      assigned_lead: lead?.name ?? f.assigned_lead ?? '',
      estimated_value: Number(f.estimated_value) || 0,
      documents: f.documents ?? [],
      submission_record: nowSubmitted
        ? { submitted_at: new Date().toISOString(), submitted_by: currentUser.name, method: submitted.method, reference: submitted.reference }
        : f.submission_record,
    };
    setBusy(true);
    try {
      if (tender) await records.update('commercialTenders', tender.id, record, tender);
      else {
        await records.create('commercialTenders', { ...record, id: newId('tdr') });
        const enq = clientEnquiries.find((e) => e.id === f.enquiry_id);
        if (enq && ['New', 'Reviewing'].includes(enq.status)) await records.update('clientEnquiries', enq.id, { status: 'Tender Invited' }, enq);
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
      title={tender ? `Edit ${tender.tender_number}` : 'New Tender'}
      subtitle={fromEnquiry ? `From enquiry ${fromEnquiry.enquiry_number}` : undefined}
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={save}>
            Save Tender
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Tender number">
          <Input value={f.tender_number ?? ''} onChange={set('tender_number')} />
        </Field>
        <Field label="Client's tender reference">
          <Input value={f.tender_reference ?? ''} onChange={set('tender_reference')} />
        </Field>
        <Field label="Linked enquiry">
          <Select value={f.enquiry_id ?? ''} onChange={(e) => pickEnquiry(e.target.value)} aria-label="Linked enquiry">
            <option value="">—</option>
            {clientEnquiries.map((e) => (
              <option key={e.id} value={e.id}>
                {e.enquiry_number} · {e.project_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Client">
          <Select value={f.client_id ?? ''} onChange={set('client_id')} aria-label="Tender client">
            <option value="">Choose a client…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project / site">
          <Input value={f.project_name ?? ''} onChange={set('project_name')} />
        </Field>
        <Field label="Site address">
          <Input value={f.site_address ?? ''} onChange={set('site_address')} />
        </Field>
        <Field label="Submission deadline">
          <Input type="date" value={f.submission_deadline ?? ''} onChange={set('submission_deadline')} />
        </Field>
        <Field label="Estimated value (RM)">
          <Input type="number" value={f.estimated_value ?? 0} onChange={set('estimated_value')} />
        </Field>
        <Field label="Estimator / PM">
          <Select value={f.assigned_user_id ?? ''} onChange={set('assigned_user_id')}>
            <option value="">—</option>
            {people
              .filter((p) => ['Owner / CEO', 'Admin', 'Project Manager', 'Accountant'].includes(p.role))
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.role})
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status} onChange={set('status')}>
            {TENDER_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </Select>
        </Field>
        <Field label="BQ reference">
          <Input value={f.bq_reference ?? ''} onChange={set('bq_reference')} />
        </Field>
        {f.status === 'Submitted' && !tender?.submission_record && (
          <Field label="Submitted by (method / reference)">
            <div className="flex gap-2">
              <Select value={submitted.method} onChange={(e) => setSubmitted((s) => ({ ...s, method: e.target.value }))}>
                {['Email', 'Tender portal', 'Hand delivery', 'Courier'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <Input value={submitted.reference} onChange={(e) => setSubmitted((s) => ({ ...s, reference: e.target.value }))} placeholder="Receipt / ref" />
            </div>
          </Field>
        )}
      </div>
      <Field label="Scope">
        <TextArea value={f.scope ?? ''} onChange={set('scope')} />
      </Field>
      <Field label="BQ notes">
        <TextArea value={f.bq_notes ?? ''} onChange={set('bq_notes')} rows={2} />
      </Field>
      <Field label="Drawings / documents" hint="One file name or link per line">
        <TextArea value={(f.documents ?? []).join('\n')} onChange={(e) => setF((p) => ({ ...p, documents: lines(e.target.value) }))} rows={2} />
      </Field>
      <Field label="Notes">
        <TextArea value={f.notes ?? ''} onChange={set('notes')} rows={2} />
      </Field>
    </Modal>
  );
};

// =========================================================================
// QUOTATIONS
// =========================================================================
type Item = QuotationItem;
const blankItem = (): Item => ({
  id: newId('qi'),
  item_code: '',
  description: '',
  category: 'Joinery',
  specification: '',
  quantity: 1,
  unit: 'unit',
  unit_selling_price: 0,
  total_selling_price: 0,
  estimated_cost_breakdown: { material: 0, labour: 0, subcontractor: 0, hardware: 0, transport: 0, installation: 0, equipment: 0, other_direct: 0 },
  total_estimated_cost: 0,
  gross_profit: 0,
  gross_margin_percent: 0,
  cost_source: 'Manual Estimate',
  cost_confidence: 'ESTIMATED',
});
const lineCost = (it: Item) => Object.values(it.estimated_cost_breakdown ?? {}).reduce((s, v) => s + (Number(v) || 0), 0);

export const QuotationsPanel: React.FC = () => {
  const { commercialQuotations, can } = useSales();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Latest version of each quotation number first; older versions are listed under it.
  const groups = useMemo(() => {
    const by = new Map<string, CommercialQuotation[]>();
    for (const q of commercialQuotations) by.set(q.quotation_number, [...(by.get(q.quotation_number) ?? []), q]);
    return [...by.values()].map((vs) => vs.sort((a, b) => b.version - a.version)).sort((a, b) => String(b[0].date).localeCompare(String(a[0].date)));
  }, [commercialQuotations]);
  const current = commercialQuotations.find((q) => q.id === selected) ?? groups[0]?.[0];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Section
        title="Quotations"
        subtitle="Latest version first"
        actions={
          can('commercial.edit') && (
            <Button tone="primary" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" /> New
            </Button>
          )
        }
      >
        <div className="space-y-2">
          {groups.map((vs) => (
            <div key={vs[0].quotation_number} className="rounded-xl border border-slate-200 p-2">
              {vs.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setSelected(q.id)}
                  data-testid={`quotation-${q.version_code}`}
                  className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-xs ${current?.id === q.id ? 'bg-amber-50 ring-1 ring-amber-300' : 'hover:bg-slate-50'}`}
                >
                  <span>
                    <span className="font-mono font-bold text-slate-900">{q.version_code}</span>
                    <span className="block text-[11px] text-slate-500">
                      {q.client_name} · {q.project_name}
                    </span>
                  </span>
                  <Pill tone={statusTone(q.status)}>{q.status}</Pill>
                </button>
              ))}
            </div>
          ))}
        </div>
      </Section>
      <div className="lg:col-span-2">{current ? <QuotationDetail q={current} onSelect={setSelected} /> : null}</div>
      {creating && <QuotationEditor from={{}} onClose={() => setCreating(false)} onSaved={(id) => setSelected(id)} />}
    </div>
  );
};

const QuotationDetail: React.FC<{ q: CommercialQuotation; onSelect: (id: string) => void }> = ({ q, onSelect }) => {
  const { records, can, currentUser } = useSales();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [converting, setConverting] = useState(false);
  const costing = can('commercial.costing');
  const margins = can('commercial.margins');
  const edit = can('commercial.edit');

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setError(null);
    setBusy(label);
    try {
      await fn();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };
  const move = (status: CommercialQuotation['status'], extra: Partial<CommercialQuotation> = {}) =>
    run(status, () => records.update('commercialQuotations', q.id, { status, ...extra }, q));
  const approve = () => run('approve', () => records.update('commercialQuotations', q.id, { approval_status: 'Approved' }, q));
  const newVersion = () =>
    run('version', async () => {
      const v = await records.action<CommercialQuotation>(`/quotations/${q.id}/versions`, {}, { apply: 'commercialQuotations', refresh: ['commercialQuotations'] });
      onSelect(v.id);
    });
  const reason = (what: string) => window.prompt(`Reason the quotation was ${what}?`) ?? undefined;
  const isPreparer = q.prepared_by_id ? q.prepared_by_id === currentUser.id : q.prepared_by === currentUser.name;

  return (
    <Section
      title={`${q.version_code} · ${q.project_name}`}
      subtitle={`${q.client_name} · dated ${q.date} · valid ${q.validity_days} days${q.valid_until ? ` (until ${q.valid_until})` : ''} · prepared by ${q.prepared_by ?? '—'}`}
      actions={
        <>
          <Pill tone={statusTone(q.status)}>{q.status}</Pill>
          <Pill tone={q.approval_status === 'Approved' ? 'good' : 'warn'} title={q.approved_by_name ? `Approved by ${q.approved_by_name} ${q.approved_at?.slice(0, 10) ?? ''}` : undefined}>
            Internal: {q.approval_status}
          </Pill>
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Item</th>
              <th className="px-2 py-2">Description / spec</th>
              <th className="px-2 py-2">Size (mm)</th>
              <th className="px-2 py-2 text-right">Qty</th>
              <th className="px-2 py-2 text-right">Unit price</th>
              <th className="px-2 py-2 text-right">Amount</th>
              {costing && <th className="px-2 py-2 text-right text-rose-700">Internal cost</th>}
              {margins && <th className="px-2 py-2 text-right text-rose-700">Margin</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {q.items.map((it) => (
              <tr key={it.id}>
                <td className="px-2 py-2 font-mono font-bold">{it.item_code}</td>
                <td className="px-2 py-2">
                  <div className="font-semibold text-slate-900">{it.description}</div>
                  <div className="text-[11px] text-slate-500">
                    {it.category}
                    {it.specification ? ` · ${it.specification}` : ''}
                  </div>
                </td>
                <td className="px-2 py-2 text-[11px] text-slate-600">{[it.length, it.width, it.height].filter(Boolean).join(' × ') || '—'}</td>
                <td className="px-2 py-2 text-right">
                  {it.quantity} {it.unit}
                </td>
                <td className="px-2 py-2 text-right">{rm(it.unit_selling_price)}</td>
                <td className="px-2 py-2 text-right font-bold">{rm(it.total_selling_price)}</td>
                {costing && <td className="px-2 py-2 text-right text-rose-700">{rm(it.total_estimated_cost)}</td>}
                {margins && <td className="px-2 py-2 text-right text-rose-700">{it.gross_margin_percent}%</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap justify-end gap-6 text-xs">
        <div>
          Subtotal <span className="font-bold">{rm(q.subtotal_selling_price)}</span>
        </div>
        {q.tax_applicable && (
          <div>
            Tax {q.tax_rate}% <span className="font-bold">{rm(q.tax_amount)}</span>
          </div>
        )}
        <div>
          Total <span className="font-black text-slate-900">{rm(q.total_selling_price)}</span>
        </div>
        {costing && (
          <div className="text-rose-700">
            Internal cost <span className="font-bold">{rm(q.total_estimated_cost)}</span>
          </div>
        )}
        {margins && (
          <div className={q.low_margin_warning ? 'font-bold text-rose-700' : 'text-emerald-700'}>
            Gross profit {rm(q.estimated_gross_profit)} ({q.estimated_gross_margin_percent}%)
          </div>
        )}
      </div>
      {(q.terms || q.internal_notes) && (
        <div className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
          {q.terms && (
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-1 font-bold text-slate-700">Terms (client)</div>
              <div className="whitespace-pre-line text-slate-600">{q.terms}</div>
            </div>
          )}
          {q.internal_notes && costing && (
            <div className="rounded-xl bg-rose-50 p-3">
              <div className="mb-1 font-bold text-rose-800">Internal notes (never on the client quotation)</div>
              <div className="whitespace-pre-line text-rose-700">{q.internal_notes}</div>
            </div>
          )}
        </div>
      )}
      <FormError error={error} onDismiss={() => setError(null)} />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => (records.live ? setPreview(true) : setError(NEEDS_DATABASE))}>
          <FileText className="h-3.5 w-3.5" /> Client quotation / PDF
        </Button>
        {edit && q.status === 'Draft' && (
          <>
            <Button onClick={() => setEditing(true)}>Edit items & prices</Button>
            <Button tone="primary" busy={busy === 'Internal Review'} onClick={() => move('Internal Review')}>
              Submit for internal review
            </Button>
          </>
        )}
        {q.status === 'Internal Review' && (
          <>
            {margins && q.approval_status !== 'Approved' && (
              <Button tone="success" busy={busy === 'approve'} onClick={approve} title={isPreparer ? 'You prepared this quotation; another approver must approve it' : undefined}>
                Approve internally
              </Button>
            )}
            {edit && (
              <>
                <Button busy={busy === 'Draft'} onClick={() => move('Draft')}>
                  Back to draft
                </Button>
                <Button tone="primary" busy={busy === 'Submitted'} onClick={() => move('Submitted')}>
                  <Send className="h-3.5 w-3.5" /> Submit to client
                </Button>
              </>
            )}
          </>
        )}
        {edit && ['Submitted', 'Negotiation'].includes(q.status) && (
          <>
            {q.status === 'Submitted' && (
              <Button busy={busy === 'Negotiation'} onClick={() => move('Negotiation')}>
                Client negotiating
              </Button>
            )}
            <Button busy={busy === 'version'} onClick={newVersion}>
              Revise (new version)
            </Button>
            <Button tone="success" busy={busy === 'Accepted'} onClick={() => move('Accepted')}>
              Award (won)
            </Button>
            <Button tone="danger" busy={busy === 'Rejected'} onClick={() => move('Rejected', { lost_reason: reason('lost') })}>
              Lost
            </Button>
          </>
        )}
        {edit && ['Draft', 'Internal Review', 'Submitted', 'Negotiation'].includes(q.status) && (
          <Button tone="danger" busy={busy === 'Cancelled'} onClick={() => move('Cancelled', { cancel_reason: reason('cancelled') })}>
            Cancel
          </Button>
        )}
        {q.status === 'Accepted' &&
          (q.converted_project_id || q.project_id ? (
            <Button tone="primary" onClick={() => navigateTo('projects', q.converted_project_id ?? q.project_id)}>
              <Briefcase className="h-3.5 w-3.5" /> Open project
            </Button>
          ) : (
            can('projects.create') && (
              <Button tone="primary" onClick={() => setConverting(true)}>
                <Briefcase className="h-3.5 w-3.5" /> Convert to project
              </Button>
            )
          ))}
      </div>
      {editing && <QuotationEditor quotation={q} from={{}} onClose={() => setEditing(false)} />}
      {preview && <ClientQuotationPreview id={q.id} onClose={() => setPreview(false)} />}
      {converting && <ConvertToProject q={q} onClose={() => setConverting(false)} />}
    </Section>
  );
};

/** Create a quotation (optionally from an enquiry / tender) or edit a Draft's items and prices. */
const QuotationEditor: React.FC<{
  quotation?: CommercialQuotation;
  from: { enquiry?: ClientEnquiry; tender?: CommercialTender };
  onClose: () => void;
  onSaved?: (id: string) => void;
}> = ({ quotation, from, onClose, onSaved }) => {
  const { clients, clientEnquiries, commercialTenders, commercialQuotations, records, can } = useSales();
  const enquiry = from.enquiry ?? clientEnquiries.find((e) => e.id === from.tender?.enquiry_id);
  const number = `QT-${new Date().getFullYear()}-${String(new Set(commercialQuotations.map((q) => q.quotation_number)).size + 1).padStart(3, '0')}`;
  const [f, setF] = useState<Partial<CommercialQuotation>>(
    quotation ?? {
      quotation_number: number,
      version: 1,
      version_code: `${number}-V1`,
      client_id: from.tender?.client_id ?? enquiry?.client_id,
      enquiry_id: enquiry?.id,
      tender_id: from.tender?.id,
      project_name: from.tender?.project_name ?? enquiry?.project_name ?? '',
      site_address: from.tender?.site_address ?? enquiry?.site_address,
      attention_to: enquiry?.contact_person,
      scope_summary: from.tender?.scope ?? enquiry?.scope_description,
      date: today(),
      validity_days: 30,
      tax_applicable: true,
      tax_rate: 8,
      status: 'Draft',
      approval_status: 'Pending',
      items: [blankItem()],
      terms: '50% deposit on award, 40% on delivery, 10% on handover.\nPrices exclude works not listed above.',
    }
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const costing = can('commercial.costing');
  const items = f.items ?? [];
  const setItem = (i: number, patch: Partial<Item>) => setF((p) => ({ ...p, items: (p.items ?? []).map((it, j) => (j === i ? { ...it, ...patch } : it)) }));
  const setCost = (i: number, key: keyof Item['estimated_cost_breakdown'], value: string) =>
    setItem(i, { estimated_cost_breakdown: { ...items[i].estimated_cost_breakdown, [key]: Number(value) || 0 } });
  const set = (k: keyof CommercialQuotation) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  // Preview only: the server recalculates every total when the quotation is saved.
  const subtotal = items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_selling_price) || 0), 0);
  const cost = items.reduce((s, it) => s + lineCost(it), 0);

  const save = async () => {
    setError(null);
    const client = clients.find((c) => c.id === f.client_id);
    if (!client || !f.project_name?.trim()) return setError('Client and project are required.');
    if (!items.length || items.some((it) => !it.description.trim() || !(Number(it.quantity) > 0))) return setError('Every item needs a description and a quantity.');
    const record = {
      ...f,
      client_name: client.company_name,
      validity_days: Number(f.validity_days) || 30,
      valid_until: addDays(f.date ?? today(), Number(f.validity_days) || 30),
      tax_rate: Number(f.tax_rate) || 0,
      items: items.map((it, i) => ({ ...it, item_code: it.item_code || `ITEM-${i + 1}`, quantity: Number(it.quantity), unit_selling_price: Number(it.unit_selling_price) })),
    };
    setBusy(true);
    try {
      if (quotation) await records.update('commercialQuotations', quotation.id, record, quotation);
      else {
        const created = await records.create('commercialQuotations', { ...record, id: newId('qt') });
        if (enquiry && ['New', 'Reviewing', 'Tender Invited'].includes(enquiry.status)) await records.update('clientEnquiries', enquiry.id, { status: 'Quoted' }, enquiry);
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
      wide
      title={quotation ? `Edit ${quotation.version_code}` : 'New Quotation'}
      subtitle={[enquiry && `Enquiry ${enquiry.enquiry_number}`, from.tender && `Tender ${from.tender.tender_number}`].filter(Boolean).join(' · ') || undefined}
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={save}>
            Save Draft
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Field label="Client">
          <Select value={f.client_id ?? ''} onChange={set('client_id')} aria-label="Quotation client">
            <option value="">Choose…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project / site">
          <Input value={f.project_name ?? ''} onChange={set('project_name')} />
        </Field>
        <Field label="Attention to">
          <Input value={f.attention_to ?? ''} onChange={set('attention_to')} />
        </Field>
        <Field label="Linked tender">
          <Select value={f.tender_id ?? ''} onChange={set('tender_id')}>
            <option value="">—</option>
            {commercialTenders.map((t) => (
              <option key={t.id} value={t.id}>
                {t.tender_number}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input type="date" value={f.date ?? ''} onChange={set('date')} />
        </Field>
        <Field label="Validity (days)">
          <Input type="number" value={f.validity_days ?? 30} onChange={set('validity_days')} />
        </Field>
        <Field label="Tax">
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={Boolean(f.tax_applicable)} onChange={(e) => setF((p) => ({ ...p, tax_applicable: e.target.checked }))} aria-label="Tax applicable" />
            <Input type="number" value={f.tax_rate ?? 0} onChange={set('tax_rate')} aria-label="Tax rate" />
            <span>%</span>
          </div>
        </Field>
        <Field label="Site address">
          <Input value={f.site_address ?? ''} onChange={set('site_address')} />
        </Field>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Code</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2">Category</th>
              <th className="px-2 py-2">Material / finish</th>
              <th className="px-2 py-2">L × W × H (mm)</th>
              <th className="px-2 py-2">Qty</th>
              <th className="px-2 py-2">Unit</th>
              <th className="px-2 py-2">Unit price</th>
              {costing && <th className="px-2 py-2 text-rose-700">Internal cost (material / labour / sub / other)</th>}
              <th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((it, i) => (
              <tr key={it.id} className="align-top">
                <td className="px-1 py-1.5">
                  <Input value={it.item_code} onChange={(e) => setItem(i, { item_code: e.target.value })} className="w-20" aria-label={`Item ${i + 1} code`} />
                </td>
                <td className="px-1 py-1.5">
                  <Input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} className="min-w-[12rem]" aria-label={`Item ${i + 1} description`} />
                </td>
                <td className="px-1 py-1.5">
                  <Select value={it.category} onChange={(e) => setItem(i, { category: e.target.value })}>
                    {CATEGORIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </td>
                <td className="px-1 py-1.5">
                  <Input value={it.specification} onChange={(e) => setItem(i, { specification: e.target.value })} aria-label={`Item ${i + 1} specification`} />
                </td>
                <td className="px-1 py-1.5">
                  <div className="flex w-36 gap-1">
                    {(['length', 'width', 'height'] as const).map((d) => (
                      <Input key={d} type="number" value={it[d] ?? ''} onChange={(e) => setItem(i, { [d]: e.target.value ? Number(e.target.value) : undefined })} aria-label={`Item ${i + 1} ${d}`} />
                    ))}
                  </div>
                </td>
                <td className="px-1 py-1.5">
                  <Input type="number" value={it.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} className="w-16" aria-label={`Item ${i + 1} quantity`} />
                </td>
                <td className="px-1 py-1.5">
                  <Select value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value as QuotationItemUnit })}>
                    {UNITS.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </Select>
                </td>
                <td className="px-1 py-1.5">
                  <Input type="number" value={it.unit_selling_price} onChange={(e) => setItem(i, { unit_selling_price: Number(e.target.value) })} className="w-24" aria-label={`Item ${i + 1} unit price`} />
                </td>
                {costing && (
                  <td className="px-1 py-1.5">
                    <div className="flex w-64 gap-1">
                      {(['material', 'labour', 'subcontractor', 'other_direct'] as const).map((k) => (
                        <Input key={k} type="number" value={it.estimated_cost_breakdown?.[k] ?? 0} onChange={(e) => setCost(i, k, e.target.value)} aria-label={`Item ${i + 1} ${k} cost`} title={k} />
                      ))}
                    </div>
                  </td>
                )}
                <td className="px-1 py-1.5">
                  <button type="button" className="text-rose-600 hover:text-rose-800" onClick={() => setF((p) => ({ ...p, items: items.filter((_, j) => j !== i) }))} aria-label={`Remove item ${i + 1}`}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-2">
          <Button onClick={() => setF((p) => ({ ...p, items: [...items, blankItem()] }))}>
            <Plus className="h-3.5 w-3.5" /> Item
          </Button>
          <Button onClick={() => setF((p) => ({ ...p, items: [...items, { ...blankItem(), category: 'Add-on', description: 'Add-on: ' }] }))}>
            <Plus className="h-3.5 w-3.5" /> Add-on
          </Button>
        </div>
        <div className="text-slate-500">
          Preview (the server recalculates on save): subtotal <span className="font-bold text-slate-900">{rm(subtotal)}</span>
          {costing && (
            <>
              {' '}
              · internal cost <span className="font-bold text-rose-700">{rm(cost)}</span>
            </>
          )}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Terms (shown to the client)">
          <TextArea value={f.terms ?? ''} onChange={set('terms')} />
        </Field>
        <Field label="Notes to the client">
          <TextArea value={f.client_notes ?? ''} onChange={set('client_notes')} />
        </Field>
        {costing && (
          <Field label="Internal notes (never shown to the client)">
            <TextArea value={f.internal_notes ?? ''} onChange={set('internal_notes')} />
          </Field>
        )}
        <Field label="Attachments" hint="One file name or link per line">
          <TextArea value={(f.attachments ?? []).join('\n')} onChange={(e) => setF((p) => ({ ...p, attachments: lines(e.target.value) }))} />
        </Field>
      </div>
    </Modal>
  );
};

/** The client quotation as the server builds it (no internal figures), printable to PDF. */
const ClientQuotationPreview: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [doc, setDoc] = useState<Record<string, any> | null>(null);
  const [error, setError] = useState<string | null>(null);
  React.useEffect(() => {
    api.get<Record<string, any>>(`/quotations/${encodeURIComponent(id)}/client-view`).then(setDoc, (err) => setError(actionErrorOf(err).message));
  }, [id]);
  return (
    <Modal
      wide
      title="Client quotation"
      subtitle="Exactly what the client receives — built by the server without internal cost, margin or notes"
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Close</Button>
          <Button tone="primary" onClick={() => window.print()} disabled={!doc}>
            <Printer className="h-3.5 w-3.5" /> Print / save as PDF
          </Button>
        </>
      }
    >
      {doc && (
        <div id="client-quotation" data-testid="client-quotation" className="space-y-4 text-xs text-slate-800">
          <div className="flex justify-between">
            <div>
              <div className="text-lg font-black">NW Interior Works</div>
              <div className="text-slate-500">Quotation {doc.version_code}</div>
            </div>
            <div className="text-right">
              <div>Date: {doc.date}</div>
              <div>Valid until: {doc.valid_until ?? `${doc.validity_days} days`}</div>
            </div>
          </div>
          <div>
            <div className="font-bold">{doc.client_name}</div>
            {doc.attention_to && <div>Attn: {doc.attention_to}</div>}
            <div>Project: {doc.project_name}</div>
            {doc.site_address && <div>Site: {doc.site_address}</div>}
          </div>
          <table className="w-full border-collapse text-left">
            <thead className="border-b border-slate-300 font-bold">
              <tr>
                <th className="py-1">Item</th>
                <th className="py-1">Description</th>
                <th className="py-1 text-right">Qty</th>
                <th className="py-1 text-right">Unit price</th>
                <th className="py-1 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(doc.items as Record<string, any>[]).map((it, i) => (
                <tr key={i} className="border-b border-slate-100 align-top">
                  <td className="py-1 font-mono">{it.item_code}</td>
                  <td className="py-1">
                    {it.description}
                    {it.specification ? <div className="text-slate-500">{it.specification}</div> : null}
                    {it.length || it.width || it.height ? <div className="text-slate-500">{[it.length, it.width, it.height].filter(Boolean).join(' × ')} mm</div> : null}
                  </td>
                  <td className="py-1 text-right">
                    {it.quantity} {it.unit}
                  </td>
                  <td className="py-1 text-right">{rm(it.unit_selling_price)}</td>
                  <td className="py-1 text-right">{rm(it.total_selling_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ml-auto w-64 space-y-1">
            <div className="flex justify-between">
              <span>Subtotal</span>
              <span>{rm(doc.subtotal_selling_price)}</span>
            </div>
            {doc.tax_applicable && (
              <div className="flex justify-between">
                <span>Tax {doc.tax_rate}%</span>
                <span>{rm(doc.tax_amount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-300 pt-1 font-black">
              <span>Total</span>
              <span>{rm(doc.total_selling_price)}</span>
            </div>
          </div>
          {doc.terms && (
            <div>
              <div className="font-bold">Terms</div>
              <div className="whitespace-pre-line">{doc.terms}</div>
            </div>
          )}
          {doc.client_notes && <div className="whitespace-pre-line">{doc.client_notes}</div>}
        </div>
      )}
    </Modal>
  );
};

/** Award -> project: the server carries client, scope, contract value and budget forward. */
const ConvertToProject: React.FC<{ q: CommercialQuotation; onClose: () => void }> = ({ q, onClose }) => {
  const { projects, people, records } = useSales();
  const year = new Date().getFullYear();
  const next = Math.max(0, ...projects.map((p) => Number(String(p.project_number).split('-').pop()) || 0)) + 1;
  const [f, setF] = useState({
    project_number: `NW-${year}-${String(next).padStart(3, '0')}`,
    project_name: q.project_name,
    site_address: q.site_address ?? '',
    start_date: addDays(today(), 7),
    end_date: addDays(today(), 97),
    project_manager_id: people.find((p) => p.role === 'Project Manager')?.id ?? '',
    site_supervisor_id: people.find((p) => p.role === 'Site Supervisor')?.id ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const convert = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await records.action<{ project: { id: string } }>(`/quotations/${q.id}/convert`, f, {
        refresh: ['projects', 'commercialQuotations', 'commercialBaselines', 'clientEnquiries', 'commercialTenders'],
      });
      onClose();
      navigateTo('projects', res.project.id);
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Convert ${q.version_code} to a project`}
      subtitle={`Client ${q.client_name}, contract value ${rm(q.subtotal_selling_price)} (before tax), scope and budget carry over. No drawings or production records are created.`}
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={convert}>
            Create project
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project number">
          <Input value={f.project_number} onChange={set('project_number')} />
        </Field>
        <Field label="Project name">
          <Input value={f.project_name} onChange={set('project_name')} />
        </Field>
        <Field label="Site address" className="sm:col-span-2">
          <Input value={f.site_address} onChange={set('site_address')} />
        </Field>
        <Field label="Expected start">
          <Input type="date" value={f.start_date} onChange={set('start_date')} />
        </Field>
        <Field label="Expected completion">
          <Input type="date" value={f.end_date} onChange={set('end_date')} />
        </Field>
        <Field label="Project manager">
          <Select value={f.project_manager_id} onChange={set('project_manager_id')}>
            {people
              .filter((p) => p.role === 'Project Manager')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
        <Field label="Site supervisor">
          <Select value={f.site_supervisor_id} onChange={set('site_supervisor_id')}>
            {people
              .filter((p) => p.role === 'Site Supervisor')
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
};
