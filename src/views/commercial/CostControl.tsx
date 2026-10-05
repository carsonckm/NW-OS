/**
 * Phase 4 cost control: goods received against a PO, supplier invoices (3-way match, finance
 * approval -> actual cost), manual cost entries and the project budget. The server computes
 * every total (committed, actual, forecast, gross profit); these screens only record facts.
 */
import React, { useMemo, useState } from 'react';
import { PackageCheck, Plus } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import type { CommercialInvoice, GoodsReceivedRecord, ProjectCostLedgerItem, PurchaseOrder } from '../../types';
import { hasPermission } from '../../utils/permissions';
import { actionErrorOf, useRecords } from '../../services/records';
import { FormError } from '../../components/ui/FormError';
import { addDays, Button, Field, Input, Modal, newId, Pill, rm, Section, Select, TextArea, today } from '../../components/ui/forms';

type GrnLine = { po_item_id: string; received_qty: number; damaged_qty: number; wrong_item: boolean; notes: string };
type Grn = GoodsReceivedRecord & {
  items?: (GrnLine & { description: string; unit: string; ordered_qty: number; previously_received: number; short_qty: number })[];
  photos?: string[];
  received_by_id?: string;
};

/** Received so far per PO line, from the goods-received records the app has. */
function receivedSoFar(grns: Grn[], poId: string) {
  const out = new Map<string, number>();
  for (const g of grns.filter((x) => x.po_id === poId)) for (const l of g.items ?? []) out.set(l.po_item_id, (out.get(l.po_item_id) ?? 0) + Number(l.received_qty || 0));
  return out;
}

// =========================================================================
// GOODS RECEIVED
// =========================================================================
export const GoodsReceivedButton: React.FC<{ po: PurchaseOrder }> = ({ po }) => {
  const { currentUser } = useNW();
  const [open, setOpen] = useState(false);
  const can = hasPermission(currentUser, 'purchasing.manage_pos') || hasPermission(currentUser, 'delivery.receive');
  if (!can || !['Issued', 'Partially Received'].includes(po.status)) return null;
  return (
    <>
      <Button tone="success" onClick={() => setOpen(true)} data-testid={`grn-${po.po_number}`}>
        <PackageCheck className="h-3.5 w-3.5" /> Record goods received
      </Button>
      {open && <GoodsReceivedForm po={po} onClose={() => setOpen(false)} />}
    </>
  );
};

export const GoodsReceivedHistory: React.FC<{ po: PurchaseOrder }> = ({ po }) => {
  const { goodsReceived } = useNW();
  const rows = (goodsReceived as Grn[]).filter((g) => g.po_id === po.id);
  if (!rows.length) return null;
  return (
    <div className="mt-2 space-y-1 text-[11px] text-slate-600">
      {rows.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-2">
          <span className="font-mono font-bold">{g.grn_number}</span>
          <span>{g.date_received}</span>
          <span>by {g.received_by}</span>
          <Pill tone={g.condition === 'Good' ? 'good' : g.condition === 'Partial with Shortage' ? 'warn' : 'bad'}>{g.condition}</Pill>
          {(g.items ?? []).map((l) => (
            <span key={l.po_item_id}>
              {l.description}: {l.received_qty}/{l.ordered_qty}
              {l.short_qty ? ` (short ${l.short_qty})` : ''}
              {l.damaged_qty ? ` (damaged ${l.damaged_qty})` : ''}
              {l.wrong_item ? ' (wrong item)' : ''}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

const GoodsReceivedForm: React.FC<{ po: PurchaseOrder; onClose: () => void }> = ({ po, onClose }) => {
  const { goodsReceived, currentUser } = useNW();
  const records = useRecords();
  const before = useMemo(() => receivedSoFar(goodsReceived as Grn[], po.id), [goodsReceived, po.id]);
  const [lines, setLines] = useState<GrnLine[]>(
    po.items.map((it) => ({ po_item_id: it.id, received_qty: Math.max(0, it.quantity - (before.get(it.id) ?? 0)), damaged_qty: 0, wrong_item: false, notes: '' }))
  );
  const [meta, setMeta] = useState({ grn_number: `GRN-${po.po_number}-${(goodsReceived as Grn[]).filter((g) => g.po_id === po.id).length + 1}`, date_received: today(), delivery_note_number: '', photos: '', notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setLine = (i: number, patch: Partial<GrnLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await records.create('goodsReceived', {
        id: newId('grn'),
        grn_number: meta.grn_number,
        po_id: po.id,
        po_number: po.po_number,
        project_id: po.project_id,
        project_name: po.project_name,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
        date_received: meta.date_received,
        delivery_note_number: meta.delivery_note_number,
        received_by: currentUser.name,
        items: lines,
        photos: meta.photos.split('\n').map((s) => s.trim()).filter(Boolean),
        notes: meta.notes,
        material_description: '',
        quantity_received: 0,
        unit: '',
        condition: 'Good',
      });
      // The server moved the PO to Partially / Goods Received.
      await records.refresh('purchaseOrders');
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
      title={`Goods received — ${po.po_number}`}
      subtitle={`${po.supplier_name} · ${po.project_name}. Record what actually arrived; shortages, damage and wrong items stay on record. The receiver is you.`}
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="success" busy={busy} onClick={save}>
            Confirm goods received
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="GRN number">
          <Input value={meta.grn_number} onChange={(e) => setMeta((m) => ({ ...m, grn_number: e.target.value }))} />
        </Field>
        <Field label="Date received">
          <Input type="date" value={meta.date_received} onChange={(e) => setMeta((m) => ({ ...m, date_received: e.target.value }))} />
        </Field>
        <Field label="Supplier delivery note">
          <Input value={meta.delivery_note_number} onChange={(e) => setMeta((m) => ({ ...m, delivery_note_number: e.target.value }))} />
        </Field>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              <th className="px-2 py-2">Item</th>
              <th className="px-2 py-2 text-right">Ordered</th>
              <th className="px-2 py-2 text-right">Received before</th>
              <th className="px-2 py-2">Received now</th>
              <th className="px-2 py-2 text-right">Short</th>
              <th className="px-2 py-2">Damaged</th>
              <th className="px-2 py-2">Wrong item</th>
              <th className="px-2 py-2">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {po.items.map((it, i) => {
              const prev = before.get(it.id) ?? 0;
              const short = Math.max(0, it.quantity - prev - Number(lines[i].received_qty || 0));
              return (
                <tr key={it.id}>
                  <td className="px-2 py-1.5">
                    <div className="font-semibold">{it.item_description}</div>
                    <div className="text-[11px] text-slate-500">{it.unit}</div>
                  </td>
                  <td className="px-2 py-1.5 text-right">{it.quantity}</td>
                  <td className="px-2 py-1.5 text-right">{prev}</td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min={0} value={lines[i].received_qty} onChange={(e) => setLine(i, { received_qty: Number(e.target.value) })} className="w-20" aria-label={`Received ${it.item_description}`} />
                  </td>
                  <td className={`px-2 py-1.5 text-right ${short ? 'font-bold text-amber-700' : ''}`}>{short}</td>
                  <td className="px-2 py-1.5">
                    <Input type="number" min={0} value={lines[i].damaged_qty} onChange={(e) => setLine(i, { damaged_qty: Number(e.target.value) })} className="w-16" aria-label={`Damaged ${it.item_description}`} />
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input type="checkbox" checked={lines[i].wrong_item} onChange={(e) => setLine(i, { wrong_item: e.target.checked })} aria-label={`Wrong item ${it.item_description}`} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input value={lines[i].notes} onChange={(e) => setLine(i, { notes: e.target.value })} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Photos" hint="One file name or link per line">
          <TextArea value={meta.photos} onChange={(e) => setMeta((m) => ({ ...m, photos: e.target.value }))} rows={2} />
        </Field>
        <Field label="Notes">
          <TextArea value={meta.notes} onChange={(e) => setMeta((m) => ({ ...m, notes: e.target.value }))} rows={2} />
        </Field>
      </div>
    </Modal>
  );
};

// =========================================================================
// SUPPLIER INVOICES
// =========================================================================
type Invoice = CommercialInvoice & { po_id?: string; match_status?: string; match?: { po_total: number; received_value: number; invoiced: number }; recorded_by_name?: string; approved_by_name?: string; approved_at?: string; ledger_cost_id?: string };

export const InvoicesPanel: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { commercialInvoices, currentUser } = useNW();
  const records = useRecords();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = (commercialInvoices as Invoice[]).filter((i) => !projectId || i.project_id === projectId);
  const canRecord = hasPermission(currentUser, 'finance.edit') || hasPermission(currentUser, 'commercial.edit');
  const canApprove = hasPermission(currentUser, 'finance.edit');
  const approve = async (inv: Invoice) => {
    setError(null);
    setBusy(inv.id);
    try {
      await records.update('commercialInvoices', inv.id, { status: 'Approved' }, inv);
      await records.refresh('projectCostLedger', 'commercialBaselines');
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title="Invoices"
      subtitle="Supplier invoices are matched to the PO and goods received; approval by finance posts the actual cost"
      actions={
        canRecord && (
          <Button tone="primary" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" /> Record supplier invoice
          </Button>
        )
      }
    >
      <FormError error={error} onDismiss={() => setError(null)} />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2.5">Invoice</th>
              <th className="px-3 py-2.5">Party / PO</th>
              <th className="px-3 py-2.5 text-right">Amount (excl. tax)</th>
              <th className="px-3 py-2.5">3-way match</th>
              <th className="px-3 py-2.5">Due</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((inv) => (
              <tr key={inv.id} data-testid={`invoice-${inv.invoice_number}`}>
                <td className="px-3 py-3">
                  <div className="font-bold text-slate-900">{inv.invoice_number}</div>
                  <div className="text-[11px] text-slate-500">{inv.invoice_type}</div>
                </td>
                <td className="px-3 py-3">
                  <div className="font-semibold">{inv.party_name}</div>
                  <div className="text-[11px] text-slate-500">{inv.po_reference ?? '—'}</div>
                </td>
                <td className="px-3 py-3 text-right font-bold">{rm(inv.amount_before_tax)}</td>
                <td className="px-3 py-3">
                  {inv.match_status ? (
                    <Pill tone={inv.match_status === 'Matched' ? 'good' : 'bad'} title={inv.match ? `PO ${rm(inv.match.po_total)} · received ${rm(inv.match.received_value)}` : undefined}>
                      {inv.match_status}
                    </Pill>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-slate-600">{inv.due_date}</td>
                <td className="px-3 py-3">
                  <Pill tone={inv.status === 'Approved' || inv.status === 'Paid' ? 'good' : inv.status === 'Overdue' ? 'bad' : 'warn'}>{inv.status}</Pill>
                  {inv.approved_by_name && <div className="text-[10px] text-slate-500">by {inv.approved_by_name}</div>}
                </td>
                <td className="px-3 py-3 text-right">
                  {canApprove && ['Draft', 'Pending Approval'].includes(inv.status) && inv.invoice_type !== 'Client Billing Invoice' && (
                    <Button tone="success" busy={busy === inv.id} onClick={() => approve(inv)}>
                      Approve
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {creating && <SupplierInvoiceForm projectId={projectId} onClose={() => setCreating(false)} />}
    </Section>
  );
};

const SupplierInvoiceForm: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { purchaseOrders, projects } = useNW();
  const records = useRecords();
  const pos = purchaseOrders.filter((p) => ['Issued', 'Partially Received', 'Goods Received', 'Completed'].includes(p.status) && (!projectId || p.project_id === projectId));
  const [f, setF] = useState({ po_id: pos[0]?.id ?? '', invoice_number: '', amount_before_tax: '', tax_amount: '0', invoice_date: today(), due_date: addDays(today(), 30), notes: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const po = purchaseOrders.find((p) => p.id === f.po_id);
  const save = async () => {
    setError(null);
    if (!po || !f.invoice_number.trim() || !(Number(f.amount_before_tax) > 0)) return setError('Purchase order, invoice number and amount are required.');
    setBusy(true);
    try {
      await records.create('commercialInvoices', {
        id: newId('inv'),
        invoice_number: f.invoice_number,
        invoice_type: 'Supplier Invoice',
        party_name: po.supplier_name,
        project_id: po.project_id,
        project_name: projects.find((p) => p.id === po.project_id)?.project_name ?? po.project_name,
        po_id: po.id,
        po_reference: po.po_number,
        amount_before_tax: Number(f.amount_before_tax),
        tax_amount: Number(f.tax_amount) || 0,
        total_amount: 0,
        invoice_date: f.invoice_date,
        due_date: f.due_date,
        status: 'Pending Approval',
        paid_amount: 0,
        notes: f.notes,
      });
      onClose();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Record supplier invoice"
      subtitle="It is checked against the PO and the goods received, then approved by finance"
      onClose={onClose}
      footer={
        <>
          <FormError error={error} />
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={save}>
            Record invoice
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Purchase order">
          <Select value={f.po_id} onChange={(e) => setF((p) => ({ ...p, po_id: e.target.value }))} aria-label="Invoice purchase order">
            {pos.map((p) => (
              <option key={p.id} value={p.id}>
                {p.po_number} · {p.supplier_name} · {rm(p.total_amount)} ({p.status})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Supplier invoice number">
          <Input value={f.invoice_number} onChange={(e) => setF((p) => ({ ...p, invoice_number: e.target.value }))} />
        </Field>
        <Field label="Amount before tax (RM)">
          <Input type="number" value={f.amount_before_tax} onChange={(e) => setF((p) => ({ ...p, amount_before_tax: e.target.value }))} />
        </Field>
        <Field label="Tax (RM)">
          <Input type="number" value={f.tax_amount} onChange={(e) => setF((p) => ({ ...p, tax_amount: e.target.value }))} />
        </Field>
        <Field label="Invoice date">
          <Input type="date" value={f.invoice_date} onChange={(e) => setF((p) => ({ ...p, invoice_date: e.target.value }))} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={f.due_date} onChange={(e) => setF((p) => ({ ...p, due_date: e.target.value }))} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea value={f.notes} onChange={(e) => setF((p) => ({ ...p, notes: e.target.value }))} rows={2} />
      </Field>
    </Modal>
  );
};

// =========================================================================
// MANUAL COST ENTRY (subcontract labour, transport... not raised as a PO)
// =========================================================================
export const AddCostButton: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { currentUser, projects } = useNW();
  const records = useRecords();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ project_id: projectId, cost_category: 'Subcontractor', party_name: '', description: '', amount: '', status: 'Committed', date: today() });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!hasPermission(currentUser, 'commercial.edit') && !hasPermission(currentUser, 'finance.edit')) return null;
  const save = async () => {
    setError(null);
    if (!f.project_id || !f.description.trim() || !(Number(f.amount) > 0)) return setError('Project, description and amount are required.');
    setBusy(true);
    try {
      const project = projects.find((p) => p.id === f.project_id);
      const entry: ProjectCostLedgerItem = {
        cost_id: newId('cst'),
        project_id: f.project_id,
        project_name: project?.project_name ?? '',
        cost_category: f.cost_category as ProjectCostLedgerItem['cost_category'],
        party_name: f.party_name,
        description: f.description,
        amount: Number(f.amount),
        date: f.date,
        status: f.status as ProjectCostLedgerItem['status'],
        cost_source: 'Manual entry',
        created_by: currentUser.name,
      };
      await records.create('projectCostLedger', entry);
      await records.refresh('commercialBaselines');
      setOpen(false);
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button tone="primary" onClick={() => setOpen(true)}>
        <Plus className="h-3.5 w-3.5" /> Add cost
      </Button>
      {open && (
        <Modal
          title="Add project cost"
          subtitle="For costs not raised as a PO (subcontract labour, transport…). Committed = agreed, Incurred = actual cost."
          onClose={() => setOpen(false)}
          footer={
            <>
              <FormError error={error} />
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button tone="primary" busy={busy} onClick={save}>
                Save cost
              </Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Project">
              <Select value={f.project_id} onChange={(e) => setF((p) => ({ ...p, project_id: e.target.value }))}>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_number} · {p.project_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category">
              <Select value={f.cost_category} onChange={(e) => setF((p) => ({ ...p, cost_category: e.target.value }))}>
                {['Material', 'Subcontractor', 'Labour', 'Transport', 'Equipment', 'Rework', 'Other'].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
            <Field label="Party (supplier / contractor)">
              <Input value={f.party_name} onChange={(e) => setF((p) => ({ ...p, party_name: e.target.value }))} />
            </Field>
            <Field label="Amount (RM)">
              <Input type="number" value={f.amount} onChange={(e) => setF((p) => ({ ...p, amount: e.target.value }))} />
            </Field>
            <Field label="Status">
              <Select value={f.status} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
                <option>Committed</option>
                <option>Incurred</option>
              </Select>
            </Field>
            <Field label="Date">
              <Input type="date" value={f.date} onChange={(e) => setF((p) => ({ ...p, date: e.target.value }))} />
            </Field>
          </div>
          <Field label="Description">
            <Input value={f.description} onChange={(e) => setF((p) => ({ ...p, description: e.target.value }))} />
          </Field>
        </Modal>
      )}
    </>
  );
};

// =========================================================================
// BUDGET (the baseline's input; the server derives every total from it)
// =========================================================================
export const BudgetEditor: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { commercialBaselines, currentUser } = useNW();
  const records = useRecords();
  const baseline = commercialBaselines.find((b) => b.project_id === projectId);
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!baseline || !hasPermission(currentUser, 'commercial.edit')) return null;
  const save = async () => {
    setError(null);
    setBusy(true);
    try {
      await records.update('commercialBaselines', projectId, { original_budget_direct_cost: Number(value) }, baseline);
      setValue(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  return value === null ? (
    <Button onClick={() => setValue(String(baseline.original_budget_direct_cost ?? 0))}>Edit budget</Button>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} className="w-36" aria-label="Budget direct cost" />
      <Button tone="primary" busy={busy} onClick={save}>
        Save budget
      </Button>
      <Button onClick={() => setValue(null)}>Cancel</Button>
      <FormError error={error} />
    </div>
  );
};
