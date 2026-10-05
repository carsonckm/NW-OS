import React, { useState } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Download,
  FileText,
  UserCheck,
  AlertTriangle,
  Calendar,
  DollarSign,
  PenTool,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { HandoverRecord, ProjectCompletionChecklist } from '../../types';
import { useRecords } from '../../services/records';
import { FormError } from '../../components/ui/FormError';
import { HandoverForm } from './SiteWorkflow';

export const CompletionHandoverTab: React.FC = () => {
  const {
    handoverRecords,
    updateHandoverRecord,
    workItems,
    siteQCInspections,
    currentUser,
  } = useNW();

  const [selectedRecordId, setSelectedRecordId] = useState<string>(
    handoverRecords[0]?.id || ''
  );
  const records = useRecords();
  const [clientSignoffName, setClientSignoffName] = useState(records.live ? '' : 'Mr. Julian Tan (Retail Operations Director)');
  const [signatureStamp, setSignatureStamp] = useState(records.live ? '' : 'APPROVED & SIGNED — CPC-NW-2026-PAV-01');
  const [showCreate, setShowCreate] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);
  const [signing, setSigning] = useState(false);
  const canManage = ['Owner / CEO', 'Project Manager'].includes(currentUser.role);

  const activeRecord =
    handoverRecords.find((h) => h.id === selectedRecordId) ||
    handoverRecords[0];

  const completionChecklist: ProjectCompletionChecklist = activeRecord?.completion_checklist || {
    all_work_items_completed: true,
    site_qc_completed: true,
    outstanding_issues_reviewed: true,
    variations_recorded: true,
    client_requests_resolved: true,
    required_documents_complete: true,
    final_photos_uploaded: true,
    defects_rectification_closed: true,
    handover_documents_ready: true,
    final_claim_status_reviewed: true,
  };

  const handleToggleCompletionCheck = (key: keyof ProjectCompletionChecklist) => {
    if (!activeRecord) return;
    const currentVal = !!completionChecklist[key];
    const updatedChecklist = {
      ...completionChecklist,
      [key]: !currentVal,
    };
    updateHandoverRecord(activeRecord.id, {
      completion_checklist: updatedChecklist,
    });
  };

  const handleClientSignoff = async () => {
    if (!activeRecord) return;
    const patch: Partial<HandoverRecord> = {
      client_signoff_name: clientSignoffName.trim(),
      client_signoff_date: new Date().toISOString().split('T')[0],
      client_signoff_signature: signatureStamp.trim(),
      status: 'Formal CPC Handover Signed',
      retention_sum_status: '50% Released at CPC',
    };
    if (!records.live) return updateHandoverRecord(activeRecord.id, patch);
    // The server records who signed for NW and leaves the project status unchanged.
    setSigning(true);
    setSignError(null);
    try {
      await records.update<HandoverRecord>('handoverRecords', activeRecord.id, patch, activeRecord);
    } catch (err) {
      setSignError((err as Error).message);
    } finally {
      setSigning(false);
    }
  };

  return (
    <div className="space-y-6">
      {showCreate && <HandoverForm onClose={() => setShowCreate(false)} onCreated={setSelectedRecordId} />}
      {activeRecord && (
        <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-[11px] text-sky-900">
          Signing the handover starts the defects liability period. It does not complete the project: the Owner marks the project Completed separately, and only once a handover is signed and no site QC failure is open.
        </div>
      )}
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-sky-100 text-sky-900 rounded-lg">
              <FileCheck2 className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Project Completion & Client CPC Handover Station
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Section 29, 30 & 31: Enforces Malaysian PAM / CIDB standard Practical Completion, DLP countdown, and 5% retention sum milestones.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {canManage && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="px-3 py-1.5 rounded-lg bg-sky-600 text-xs font-bold text-white hover:bg-sky-700"
            >
              Prepare handover
            </button>
          )}
          <select
            value={selectedRecordId}
            onChange={(e) => setSelectedRecordId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {handoverRecords.map((h) => (
              <option key={h.id} value={h.id}>
                {h.cpc_certificate_number} — {h.project_name.slice(0, 24)} ({h.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeRecord && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Project Completion Checklist (Section 30) (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  10-Step Completion Checklist (Section 30)
                </h4>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                  Governance
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Rule: Project completion requires satisfying every condition before issuance of Certificate of Practical Completion (CPC).
              </p>

              <div className="space-y-2 text-xs">
                {[
                  { key: 'all_work_items_completed', label: '1. All Work Items 100% Installed' },
                  { key: 'site_qc_completed', label: '2. Site QC Passed with Zero Critical Snags' },
                  { key: 'outstanding_issues_reviewed', label: '3. Outstanding Site Issues Reviewed & Closed' },
                  { key: 'variations_recorded', label: '4. Commercial Variations Formally Reconciled' },
                  { key: 'client_requests_resolved', label: '5. Client Change Requests Addressed' },
                  { key: 'required_documents_complete', label: '6. Operation & Maintenance Manuals (OMM) Ready' },
                  { key: 'final_photos_uploaded', label: '7. High-Res As-Built Photos Uploaded' },
                  { key: 'defects_rectification_closed', label: '8. Rectification Punch-List Endorsed' },
                  { key: 'handover_documents_ready', label: '9. CPC & Warranty Certificates Prepared' },
                  { key: 'final_claim_status_reviewed', label: '10. Interim Payment Claim & Retention Verified' },
                ].map((item) => {
                  const isChecked = !!(completionChecklist as any)[item.key];
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleToggleCompletionCheck(item.key as any)}
                      className={`w-full text-left p-2.5 rounded-lg border flex items-center justify-between transition-colors ${
                        isChecked
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span>{item.label}</span>
                      <span className="text-[10px] font-black uppercase text-emerald-700">
                        {isChecked ? 'PASS' : 'PENDING'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Handover Certificate & DLP Retention (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Certificate of Practical Completion (CPC) Box */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Official Handover Certificate
                  </span>
                  <h4 className="text-base font-black text-slate-900">
                    {activeRecord.cpc_certificate_number}
                  </h4>
                  <p className="text-xs text-slate-500 font-medium">
                    {activeRecord.project_name} • Client: {activeRecord.client_name}
                  </p>
                </div>

                <span
                  className={`px-3 py-1 text-xs font-black rounded-lg border ${
                    activeRecord.status === 'Formal CPC Handover Signed'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border-amber-300'
                  }`}
                >
                  {activeRecord.status}
                </span>
              </div>

              {/* Handover Details */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3.5 rounded-lg border border-slate-100">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Target Handover Date
                  </span>
                  <span className="font-black text-slate-800 flex items-center space-x-1">
                    <Calendar className="w-3.5 h-3.5 text-slate-400" />
                    <span>{activeRecord.handover_date}</span>
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Client Representative
                  </span>
                  <span className="font-bold text-slate-800 truncate block">
                    {activeRecord.client_representative}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    NW Lead Project Manager
                  </span>
                  <span className="font-bold text-slate-800 truncate block">
                    {activeRecord.nw_pm_signoff_name}
                  </span>
                </div>
              </div>

              {/* Defects Liability Period (DLP) & Retention Tracker */}
              <div className="p-4 bg-amber-50/60 border border-amber-200 rounded-xl space-y-3 text-xs text-amber-950">
                <div className="flex items-center justify-between">
                  <span className="font-black text-amber-900 uppercase text-[11px] tracking-wide">
                    Defects Liability Period (DLP) & Retention Sum Release
                  </span>
                  <span className="px-2 py-0.5 bg-amber-200 text-amber-900 rounded font-black text-[10px]">
                    {activeRecord.dlp_duration_months} Months Standard
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <div className="p-2.5 bg-white/80 rounded-lg border border-amber-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Total 5% Retention Sum
                    </span>
                    <span className="text-sm font-black text-slate-900">
                      RM {activeRecord.retention_sum_amount_rm.toLocaleString()}
                    </span>
                  </div>

                  <div className="p-2.5 bg-white/80 rounded-lg border border-amber-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Release Milestone 1 (50%)
                    </span>
                    <span className="text-xs font-bold text-emerald-800">
                      RM {(activeRecord.retention_sum_amount_rm * 0.5).toLocaleString()} @ CPC
                    </span>
                  </div>

                  <div className="p-2.5 bg-white/80 rounded-lg border border-amber-200">
                    <span className="text-[10px] uppercase font-bold text-slate-400 block">
                      Release Milestone 2 (50%)
                    </span>
                    <span className="text-xs font-bold text-slate-700">
                      RM {(activeRecord.retention_sum_amount_rm * 0.5).toLocaleString()} @ CMGD
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-amber-900">
                  <span className="font-bold">DLP Validity:</span> {activeRecord.dlp_start_date} to {activeRecord.dlp_end_date}. Certificate of Making Good Defects (CMGD) targeted for {activeRecord.cmgd_target_date}.
                </div>
              </div>

              {/* Handover Documents List */}
              <div className="space-y-2 text-xs">
                <span className="font-bold text-slate-700 block">Handover Documents:</span>
                <div className="space-y-1.5">
                  {activeRecord.documents?.map((doc, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-2.5 bg-slate-50 border border-slate-200 rounded-lg"
                    >
                      <div className="flex items-center space-x-2">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <span className="font-semibold text-slate-800">{doc.name}</span>
                        <span className="text-[10px] text-slate-400 font-mono">({doc.type})</span>
                      </div>
                      <span className="text-[11px] text-sky-700 font-bold hover:underline cursor-pointer">
                        Download
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Client Sign-off Box */}
              <div className="pt-3 border-t border-slate-100 space-y-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-black text-slate-900">Formal Client Endorsement</span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Status: {activeRecord.client_signoff_date ? 'Signed' : 'Awaiting Sign-off'}
                  </span>
                </div>

                {activeRecord.client_signoff_signature ? (
                  <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl space-y-1 text-xs text-emerald-950">
                    <div className="flex items-center space-x-2 font-black text-emerald-900">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Formally Signed & Endorsed by Client</span>
                    </div>
                    <div className="text-[11px]">
                      Signatory: <span className="font-bold">{activeRecord.client_signoff_name}</span> on {activeRecord.client_signoff_date}
                    </div>
                    <div className="font-mono text-[10px] text-emerald-700">
                      Signature Stamp: {activeRecord.client_signoff_signature}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 bg-slate-50 p-4 rounded-xl border border-slate-200">
                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                        Client Signatory Name
                      </label>
                      <input
                        type="text"
                        value={clientSignoffName}
                        onChange={(e) => setClientSignoffName(e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-bold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                        Digital Signature / Stamp
                      </label>
                      <input
                        type="text"
                        value={signatureStamp}
                        onChange={(e) => setSignatureStamp(e.target.value)}
                        className="w-full p-2 bg-white border border-slate-200 rounded-lg text-xs font-mono font-bold"
                      />
                    </div>

                    <FormError error={signError} onDismiss={() => setSignError(null)} />
                    <button
                      onClick={handleClientSignoff}
                      disabled={signing || !canManage || !clientSignoffName.trim() || !signatureStamp.trim()}
                      className="w-full mt-2 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-black shadow-sm transition-all disabled:opacity-50 flex items-center justify-center space-x-1.5"
                    >
                      <PenTool className="w-4 h-4" />
                      <span>Endorse Certificate of Practical Completion (CPC)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
