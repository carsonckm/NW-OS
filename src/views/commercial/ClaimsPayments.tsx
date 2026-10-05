/**
 * Progress claims (IPC) and client payments: create and move through their states against
 * the server (/api/claims, /api/payments; finance.manage_claims / finance.record_payments).
 */
import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import { FinancialClaim, PaymentRecord } from '../../types';
import { useRecords } from '../../services/records';
import { hasPermission } from '../../utils/permissions';
import { FormError } from '../../components/ui/FormError';
import { Button, Field, Input, Modal, Select, newId, rm, today } from '../../components/ui/forms';

const NEXT: Record<string, FinancialClaim['status'] | undefined> = { Draft: 'Submitted', Submitted: 'Certified', Certified: 'Paid' };

export const ClaimForm: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { projects } = useNW();
  const records = useRecords();
  const [pid, setPid] = useState(projectId || projects[0]?.id || '');
  const [f, setF] = useState({ number: '', period: today(), cumulative: 0, retentionPct: 5, invoice: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const retention = Math.round(Number(f.cumulative) * (Number(f.retentionPct) / 100) * 100) / 100;
  const save = async () => {
    const project = projects.find((p) => p.id === pid);
    if (!project || !f.number.trim() || !(Number(f.cumulative) > 0)) return setError('Choose the project, and enter the claim number and amount claimed.');
    setBusy(true);
    setError(null);
    try {
      await records.create<FinancialClaim>('financialClaims', {
        id: newId('clm'), claim_number: f.number.trim(), project_id: project.id, project_name: project.project_name, period_ending: f.period,
        cumulative_claimed: Number(f.cumulative), retention_amount: retention, net_claim_amount: Math.round((Number(f.cumulative) - retention) * 100) / 100,
        status: 'Draft', invoice_number: f.invoice || undefined,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="New progress claim (IPC)" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button tone="primary" busy={busy} onClick={save}>Save claim</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project">
          <Select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Claim project">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number} — {p.project_name}</option>)}
          </Select>
        </Field>
        <Field label="Claim number"><Input value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} aria-label="Claim number" placeholder="IPC-01" /></Field>
        <Field label="Period ending"><Input type="date" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })} /></Field>
        <Field label="Cumulative work claimed (RM)"><Input type="number" min={0} value={f.cumulative} onChange={(e) => setF({ ...f, cumulative: Number(e.target.value) })} aria-label="Amount claimed" /></Field>
        <Field label="Retention (%)"><Input type="number" min={0} max={20} value={f.retentionPct} onChange={(e) => setF({ ...f, retentionPct: Number(e.target.value) })} /></Field>
        <Field label="Client invoice number"><Input value={f.invoice} onChange={(e) => setF({ ...f, invoice: e.target.value })} aria-label="Claim invoice number" /></Field>
      </div>
      <p className="text-xs text-slate-600">Retention {rm(retention)} · net claim {rm(Number(f.cumulative) - retention)}</p>
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};

/** Moves a claim to its next state (Submitted, Certified with the certified amount, Paid). */
export const ClaimActions: React.FC<{ claim: FinancialClaim }> = ({ claim }) => {
  const { currentUser } = useNW();
  const records = useRecords();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT[claim.status];
  if (!next || !hasPermission(currentUser, 'finance.manage_claims')) return null;
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      const patch: Partial<FinancialClaim> = { status: next };
      if (next === 'Certified') patch.certified_amount = claim.certified_amount ?? claim.net_claim_amount;
      if (next === 'Paid') patch.payment_received_date = today();
      await records.update<FinancialClaim>('financialClaims', claim.id, patch, claim);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <Button busy={busy} onClick={go} aria-label={`Mark ${claim.claim_number} ${next}`}>Mark {next}</Button>
      <FormError error={error} />
    </div>
  );
};

export const PaymentForm: React.FC<{ projectId: string; onClose: () => void }> = ({ projectId, onClose }) => {
  const { projects, clients, financialClaims } = useNW();
  const records = useRecords();
  const [pid, setPid] = useState(projectId || projects[0]?.id || '');
  const project = projects.find((p) => p.id === pid);
  const [f, setF] = useState({ type: 'Client Inflow' as PaymentRecord['type'], reference: '', party: '', amount: 0, method: 'Online Giro' as PaymentRecord['payment_method'], date: today(), claim: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openClaims = financialClaims.filter((c) => c.project_id === pid && c.status !== 'Paid');
  const save = async () => {
    if (!project || !f.reference.trim() || !(Number(f.amount) > 0)) return setError('Choose the project, and enter the bank reference and amount.');
    setBusy(true);
    setError(null);
    try {
      const party = f.party.trim() || (f.type === 'Client Inflow' ? clients.find((c) => c.id === project.client_id)?.company_name ?? '' : '');
      await records.create<PaymentRecord>('payments', {
        id: newId('pay'), reference_no: f.reference.trim(), project_id: project.id, type: f.type, party_name: party, amount: Number(f.amount),
        payment_method: f.method, date: f.date, status: 'Reconciled', notes: f.claim ? `For claim ${f.claim}` : undefined,
      });
      const claim = openClaims.find((c) => c.claim_number === f.claim);
      if (claim && claim.status === 'Certified') await records.update<FinancialClaim>('financialClaims', claim.id, { status: 'Paid', payment_received_date: f.date }, claim);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Record payment" onClose={onClose} footer={<><Button onClick={onClose}>Cancel</Button><Button tone="primary" busy={busy} onClick={save}>Record payment</Button></>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Project">
          <Select value={pid} onChange={(e) => setPid(e.target.value)} aria-label="Payment project">
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number} — {p.project_name}</option>)}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as PaymentRecord['type'] })}>
            <option>Client Inflow</option><option>Contractor Outflow</option><option>Supplier PO Payment</option>
          </Select>
        </Field>
        <Field label="Bank reference"><Input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} aria-label="Bank reference" /></Field>
        <Field label="Amount (RM)"><Input type="number" min={0} value={f.amount} onChange={(e) => setF({ ...f, amount: Number(e.target.value) })} aria-label="Payment amount" /></Field>
        <Field label="Paid by / to" hint="Defaults to the project's client for client payments."><Input value={f.party} onChange={(e) => setF({ ...f, party: e.target.value })} /></Field>
        <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        {f.type === 'Client Inflow' && (
          <Field label="Settles claim">
            <Select value={f.claim} onChange={(e) => setF({ ...f, claim: e.target.value })} aria-label="Settles claim">
              <option value="">None</option>
              {openClaims.map((c) => <option key={c.id} value={c.claim_number}>{c.claim_number} ({c.status}, {rm(c.net_claim_amount)})</option>)}
            </Select>
          </Field>
        )}
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};
