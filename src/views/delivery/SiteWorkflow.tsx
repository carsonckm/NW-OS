/**
 * Site QC inspection and handover forms. In database mode both go straight to the server:
 * a failed inspection gets a rectification issue there and blocks completing the
 * installation until a later inspection passes; a handover is created as a draft and signed
 * afterwards, and signing never completes the project.
 */
import React, { useMemo, useState } from 'react';
import { useNW } from '../../context/NWContext';
import { HandoverRecord, SiteQCInspection } from '../../types';
import { useRecords } from '../../services/records';
import { navigateTo } from '../../services/navigation';
import { FormError } from '../../components/ui/FormError';
import { Button, Field, Input, Modal, Pill, Select, TextArea, addDays, newId, today } from '../../components/ui/forms';

const FAIL = 'Fail / Rectification Required';
const CHECKS = [
  ['level_and_alignment_pass', 'Level & alignment'],
  ['hardware_and_mechanism_pass', 'Hardware & mechanisms'],
  ['finish_and_surfaces_pass', 'Finish & surfaces'],
  ['safety_and_fixing_pass', 'Safety & fixing'],
  ['cleanliness_and_protection_pass', 'Cleanliness & protection'],
] as const;
type CheckKey = (typeof CHECKS)[number][0];

/** Latest inspection per work item (by date, then newest record). */
export function latestSiteQc(list: SiteQCInspection[], workItemId: string) {
  return list
    .filter((i) => i.work_item_id === workItemId)
    .sort((a, b) => (b.inspection_date || '').localeCompare(a.inspection_date || '') || b.id.localeCompare(a.id))[0];
}

export const SiteQCForm: React.FC<{ onClose: () => void; installationJobId?: string; reinspectionOf?: SiteQCInspection }> = ({ onClose, installationJobId, reinspectionOf }) => {
  const { installationJobs, recordSiteQCInspection, currentUser } = useNW();
  const records = useRecords();
  const jobs = installationJobs.filter((j) => j.status !== 'Cancelled');
  const [jobId, setJobId] = useState(installationJobId ?? reinspectionOf?.installation_job_id ?? jobs[0]?.id ?? '');
  const job = jobs.find((j) => j.id === jobId);
  const [checks, setChecks] = useState<Record<CheckKey, boolean>>({
    level_and_alignment_pass: true,
    hardware_and_mechanism_pass: true,
    finish_and_surfaces_pass: true,
    safety_and_fixing_pass: true,
    cleanliness_and_protection_pass: true,
  });
  const allPass = CHECKS.every(([k]) => checks[k]);
  const [result, setResult] = useState<SiteQCInspection['result'] | ''>('');
  const effective = result || (allPass ? 'Pass' : FAIL);
  const [defects, setDefects] = useState('');
  const [comments, setComments] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<SiteQCInspection | null>(null);

  const submit = async () => {
    if (!job) return setError('Choose the installation being inspected.');
    if (effective === 'Pass' && !allPass) return setError('An inspection with a failed check cannot pass. Untick the result override or fix the checklist.');
    if (effective !== 'Pass' && !defects.trim()) return setError('List the defects found so they can be rectified.');
    const id = newId('sqc');
    const snag_items = defects
      .split('\n')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d, i) => ({
        id: `${id}-s${i + 1}`,
        item_number: i + 1,
        description: d,
        category: 'Alignment / Gap',
        severity: effective === FAIL ? 'Moderate' : 'Minor',
        photos_before: photos,
        status: 'Open',
        assigned_to: job.contractor_name || 'Installer',
        deadline: addDays(date, 3),
      }));
    const inspection = {
      id,
      inspection_number: `SQC-${id.slice(4, 12).toUpperCase()}`,
      work_item_id: job.work_item_id,
      work_item_code: job.work_item_code,
      installation_job_id: job.id,
      project_id: job.project_id,
      project_name: job.project_name,
      inspector_name: currentUser.name,
      inspector_role: currentUser.role,
      inspection_date: date,
      result: effective,
      ...checks,
      snag_items,
      inspector_signoff: true,
      photos,
      comments: [reinspectionOf ? `Re-inspection of ${reinspectionOf.inspection_number}.` : '', comments].filter(Boolean).join(' '),
    } as unknown as SiteQCInspection;
    setBusy(true);
    setError(null);
    try {
      if (!records.live) {
        setSaved(recordSiteQCInspection(inspection));
        return;
      }
      const stored = await records.create<SiteQCInspection>('siteQCInspections', inspection);
      if (stored.result === FAIL) await records.refresh('issues');
      setSaved(stored as SiteQCInspection);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (saved) {
    const failed = saved.result === FAIL;
    return (
      <Modal title={`Inspection ${saved.inspection_number} recorded`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
        <div className={`rounded-xl border p-3 text-xs ${failed ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-emerald-300 bg-emerald-50 text-emerald-900'}`} data-testid="site-qc-result">
          <p className="font-black">{saved.result}</p>
          {failed ? (
            <p className="mt-1">
              Rectification issue {saved.rectification_issue_id ?? ''} was raised. The installation cannot be completed until the defects are rectified and a re-inspection passes.
            </p>
          ) : (
            <p className="mt-1">The installation can now be marked complete.</p>
          )}
        </div>
        {failed && (
          <Button tone="primary" onClick={() => { onClose(); navigateTo('issues', saved.project_id); }}>
            Open rectification issue
          </Button>
        )}
      </Modal>
    );
  }

  return (
    <Modal
      title={reinspectionOf ? `Re-inspect ${reinspectionOf.work_item_code}` : 'Record site QC inspection'}
      subtitle={`Inspector: ${currentUser.name} (${currentUser.role}). The server records the signed-in inspector.`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone={effective === 'Pass' ? 'success' : 'danger'} busy={busy} onClick={submit}>
            Record {effective === 'Pass' ? 'pass' : effective === FAIL ? 'failure' : 'result'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Installation">
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)} disabled={!!reinspectionOf} aria-label="Installation">
            {jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.job_number} — {j.work_item_code} ({j.project_name}) · {j.status}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Inspection date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="rounded-xl border border-slate-200 p-3">
        <p className="mb-2 text-xs font-bold text-slate-700">Checklist</p>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
          {CHECKS.map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs">
              <span>{label}</span>
              <span className="flex gap-1">
                <button type="button" aria-label={`${label} pass`} onClick={() => setChecks({ ...checks, [k]: true })} className={`rounded px-2 py-0.5 font-bold ${checks[k] ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                  Pass
                </button>
                <button type="button" aria-label={`${label} fail`} onClick={() => setChecks({ ...checks, [k]: false })} className={`rounded px-2 py-0.5 font-bold ${!checks[k] ? 'bg-rose-600 text-white' : 'bg-white text-slate-500 border border-slate-200'}`}>
                  Fail
                </button>
              </span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Result" hint={allPass ? 'All checks pass.' : 'A failed check means rectification is required.'}>
          <Select value={result} onChange={(e) => setResult(e.target.value as SiteQCInspection['result'] | '')} aria-label="Result">
            <option value="">{allPass ? 'Pass (from checklist)' : 'Fail / Rectification Required (from checklist)'}</option>
            <option>Pass</option>
            <option>Pass with Minor Rectification</option>
            <option>{FAIL}</option>
          </Select>
        </Field>
        <Field label="Photos" hint={photos.length ? photos.join(', ') : 'Attach site photos of the inspected item.'}>
          <Input type="file" multiple accept="image/*" onChange={(e) => setPhotos(Array.from(e.target.files ?? []).map((f) => f.name))} />
        </Field>
      </div>
      {effective !== 'Pass' && (
        <Field label="Defects found (one per line)">
          <TextArea value={defects} onChange={(e) => setDefects(e.target.value)} placeholder={'Counter top 4mm out of level\nDoor hinge loose on unit B'} aria-label="Defects" />
        </Field>
      )}
      <Field label="Comments">
        <TextArea rows={2} value={comments} onChange={(e) => setComments(e.target.value)} />
      </Field>
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};

/** A handover is always created as a draft; signing is a separate step with the client. */
export const HandoverForm: React.FC<{ onClose: () => void; onCreated?: (id: string) => void }> = ({ onClose, onCreated }) => {
  const { projects, clients, workItems, siteQCInspections, currentUser } = useNW();
  const records = useRecords();
  const open = projects.filter((p) => !['Completed', 'Closed', 'Cancelled'].includes(String(p.project_status)));
  const [projectId, setProjectId] = useState(open[0]?.id ?? '');
  const project = projects.find((p) => p.id === projectId);
  const client = clients.find((c) => c.id === project?.client_id);
  const items = workItems.filter((w) => w.project_id === projectId);
  const qcState = useMemo(() => {
    const latest = items.map((w) => latestSiteQc(siteQCInspections, w.id));
    return { failed: latest.filter((l) => l?.result === FAIL).length, uninspected: latest.filter((l) => !l).length };
  }, [items, siteQCInspections]);
  const [f, setF] = useState({ representative: '', cpc: '', date: addDays(today(), 7), dlp: 12, retention: 0, asBuilt: '', om: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!project) return setError('Choose the project being handed over.');
    if (!f.representative.trim() || !f.cpc.trim()) return setError("Enter the client representative and the CPC certificate number.");
    const record: HandoverRecord = {
      id: newId('ho'),
      project_id: project.id,
      project_name: project.project_name,
      client_id: project.client_id,
      client_name: client?.company_name ?? '',
      client_representative: f.representative.trim(),
      cpc_certificate_number: f.cpc.trim(),
      handover_date: f.date,
      status: 'Draft',
      work_items_included: items.map((w) => w.id),
      all_site_qc_passed: qcState.failed === 0 && qcState.uninspected === 0,
      open_snags_count: qcState.failed,
      nw_pm_signoff_name: currentUser.name,
      as_built_drawings_approved: !!f.asBuilt,
      as_built_drawing_revision: f.asBuilt,
      operation_maintenance_manual_ref: f.om,
      dlp_duration_months: Number(f.dlp) || 0,
      dlp_start_date: f.date,
      dlp_end_date: addDays(f.date, Math.round((Number(f.dlp) || 0) * 30.4)),
      retention_sum_amount_rm: Number(f.retention) || 0,
      retention_sum_status: 'Held in Retention (5%)',
      cmgd_target_date: addDays(f.date, Math.round((Number(f.dlp) || 0) * 30.4)),
      notes: f.notes,
      documents: [],
    };
    setBusy(true);
    setError(null);
    try {
      await records.create<HandoverRecord>('handoverRecords', record);
      onCreated?.(record.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Prepare handover"
      subtitle="Created as a draft. The client signs it afterwards. Signing does not complete the project."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} onClick={submit}>
            Create draft handover
          </Button>
        </>
      }
    >
      <Field label="Project">
        <Select value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          {open.map((p) => (
            <option key={p.id} value={p.id}>
              {p.project_number} — {p.project_name} ({p.project_status})
            </option>
          ))}
        </Select>
      </Field>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <Pill tone="info">{items.length} work items</Pill>
        <Pill tone={qcState.failed ? 'bad' : 'good'}>{qcState.failed} with failed site QC</Pill>
        <Pill tone={qcState.uninspected ? 'warn' : 'good'}>{qcState.uninspected} not inspected</Pill>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client representative">
          <Input value={f.representative} onChange={(e) => setF({ ...f, representative: e.target.value })} aria-label="Client representative" />
        </Field>
        <Field label="CPC certificate number">
          <Input value={f.cpc} onChange={(e) => setF({ ...f, cpc: e.target.value })} aria-label="CPC certificate number" />
        </Field>
        <Field label="Handover date">
          <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
        </Field>
        <Field label="Defects liability period (months)">
          <Input type="number" min={0} value={f.dlp} onChange={(e) => setF({ ...f, dlp: Number(e.target.value) })} />
        </Field>
        <Field label="Retention held (RM)">
          <Input type="number" min={0} value={f.retention} onChange={(e) => setF({ ...f, retention: Number(e.target.value) })} />
        </Field>
        <Field label="As-built drawing revision">
          <Input value={f.asBuilt} onChange={(e) => setF({ ...f, asBuilt: e.target.value })} placeholder="e.g. Rev C" />
        </Field>
        <Field label="O&M manual reference" className="sm:col-span-2">
          <Input value={f.om} onChange={(e) => setF({ ...f, om: e.target.value })} />
        </Field>
      </div>
      <Field label="Notes">
        <TextArea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};
