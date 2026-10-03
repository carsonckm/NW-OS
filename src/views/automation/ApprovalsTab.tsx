import React, { useState } from 'react';
import {
  FileCheck2,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Clock,
  AlertTriangle,
  ShieldAlert,
  User,
  Building2,
  DollarSign,
  Calendar,
  Layers,
  FileText,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { ApprovalItem, ApprovalDecision } from '../../types';

export const ApprovalsTab: React.FC = () => {
  const { approvals, decideApproval, currentUser } = useNW();

  const [selectedApprovalId, setSelectedApprovalId] = useState<string>(approvals[0]?.id || '');
  const [decisionNotes, setDecisionNotes] = useState('');
  const [decisionFeedback, setDecisionFeedback] = useState<string | null>(null);

  const pendingApprovals = approvals.filter((a) => a.decision === 'Pending');
  const decidedApprovals = approvals.filter((a) => a.decision !== 'Pending');

  const selectedApproval =
    approvals.find((a) => a.id === selectedApprovalId) || pendingApprovals[0] || approvals[0];

  // Section 26: Approval Security Enforcement:
  // Requester cannot approve their own request!
  const isRequesterSelf = selectedApproval?.requested_by_id === currentUser.id;
  const canDecide = !isRequesterSelf || currentUser.role === 'Owner / CEO';

  const handleDecision = (decision: ApprovalDecision) => {
    if (!selectedApproval) return;

    if (!canDecide) {
      setDecisionFeedback('❌ Security Violation (Rule 26): You cannot approve your own submission.');
      return;
    }

    decideApproval(selectedApproval.id, decision, decisionNotes || `Decision recorded by ${currentUser.name}`);
    setDecisionFeedback(`✓ Approval ${selectedApproval.approval_number} marked as "${decision}".`);
    setDecisionNotes('');
    setTimeout(() => setDecisionFeedback(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-blue-100 text-blue-900 rounded-lg">
              <FileCheck2 className="w-4 h-4 text-blue-600" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Central Governance & Multi-Tier Approval Engine
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Rule 25 & 26: Never silently approve. Anti-self-approval enforcement active.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="px-3 py-1 bg-amber-100 text-amber-900 text-xs font-bold rounded-xl border border-amber-300">
            {pendingApprovals.length} Decisions Pending
          </span>
        </div>
      </div>

      {decisionFeedback && (
        <div className="p-3 bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center justify-between">
          <span>{decisionFeedback}</span>
          <button onClick={() => setDecisionFeedback(null)} className="text-slate-400 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Main Grid: Pending List (5 cols) + Approval Review Station (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Approvals List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="text-xs font-bold text-slate-500 px-1">
            Pending Submissions ({pendingApprovals.length})
          </div>

          {pendingApprovals.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
              No pending approvals at this time.
            </div>
          ) : (
            pendingApprovals.map((app) => {
              const isSelected = selectedApproval?.id === app.id;
              return (
                <div
                  key={app.id}
                  onClick={() => setSelectedApprovalId(app.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2 ${
                    isSelected
                      ? 'bg-blue-50/60 border-blue-400 shadow-sm ring-1 ring-blue-400'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-black text-slate-900">
                      {app.approval_number}
                    </span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900">
                      {app.approval_type}
                    </span>
                  </div>

                  <h4 className="text-xs font-bold text-slate-900 line-clamp-1">{app.title}</h4>
                  <p className="text-[11px] text-slate-500 line-clamp-1">{app.description}</p>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                    <span>Requested by: {app.requested_by_name}</span>
                    <span>{app.date_requested}</span>
                  </div>
                </div>
              );
            })
          )}

          {/* Past Decided Approvals */}
          <div className="pt-4">
            <div className="text-xs font-bold text-slate-500 px-1 mb-2">
              Recently Decided ({decidedApprovals.length})
            </div>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {decidedApprovals.map((app) => (
                <div
                  key={app.id}
                  onClick={() => setSelectedApprovalId(app.id)}
                  className="p-3 bg-white rounded-xl border border-slate-200 text-xs flex items-center justify-between cursor-pointer hover:bg-slate-50"
                >
                  <div>
                    <div className="font-bold text-slate-800 line-clamp-1">{app.title}</div>
                    <div className="text-[10px] text-slate-400">{app.approval_number}</div>
                  </div>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded ${
                      app.decision === 'Approved'
                        ? 'bg-emerald-100 text-emerald-900'
                        : app.decision === 'Rejected'
                        ? 'bg-rose-100 text-rose-900'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {app.decision}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Review Station */}
        <div className="lg:col-span-7">
          {selectedApproval ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
              <div className="border-b border-slate-100 pb-4">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs font-black text-blue-800">
                    {selectedApproval.approval_number}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-900">
                    {selectedApproval.approval_type}
                  </span>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded ${
                      selectedApproval.decision === 'Approved'
                        ? 'bg-emerald-100 text-emerald-900'
                        : selectedApproval.decision === 'Pending'
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-rose-100 text-rose-900'
                    }`}
                  >
                    {selectedApproval.decision}
                  </span>
                </div>
                <h3 className="text-base font-black text-slate-900 mt-1">{selectedApproval.title}</h3>
                <p className="text-xs text-slate-500 mt-0.5">Project: {selectedApproval.project_name}</p>
              </div>

              {/* Security Banner (Rule 26) */}
              {isRequesterSelf && currentUser.role !== 'Owner / CEO' && (
                <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-xl text-xs text-rose-900 flex items-start space-x-2.5">
                  <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-black uppercase tracking-wide block text-[10px]">
                      Rule 26: Anti-Self-Approval Restriction
                    </span>
                    <span>
                      You submitted this request ({selectedApproval.requested_by_name}). System security prevents
                      self-approval. Only a designated manager or Owner may endorse this decision.
                    </span>
                  </div>
                </div>
              )}

              {/* Impact summary */}
              <div className="grid grid-cols-3 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Cost Impact</span>
                  <span className="text-sm font-black text-slate-900 mt-0.5 block">
                    MYR {(selectedApproval.impact_summary?.cost_impact_myr || 0).toLocaleString()}
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Schedule Impact</span>
                  <span className="text-sm font-black text-slate-900 mt-0.5 block">
                    {selectedApproval.impact_summary?.schedule_impact_days || 0} Days
                  </span>
                </div>

                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] text-slate-400 font-bold uppercase block">Risk Level</span>
                  <span className="text-sm font-black text-amber-700 mt-0.5 block">
                    {selectedApproval.impact_summary?.technical_risk || 'Medium'}
                  </span>
                </div>
              </div>

              {/* Description */}
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                  Scope & Justification
                </span>
                <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  {selectedApproval.description}
                </p>
              </div>

              {/* Decision Station */}
              {selectedApproval.decision === 'Pending' && (
                <div className="pt-4 border-t border-slate-100 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Record Governance Decision
                  </span>

                  <textarea
                    rows={2}
                    placeholder="Enter review notes, comments, or conditions for approval..."
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    className="w-full text-xs p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500"
                  />

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleDecision('Approved')}
                      disabled={!canDecide}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Approve</span>
                    </button>

                    <button
                      onClick={() => handleDecision('Changes Requested')}
                      disabled={!canDecide}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Request Changes</span>
                    </button>

                    <button
                      onClick={() => handleDecision('Rejected')}
                      disabled={!canDecide}
                      className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-all shadow-xs cursor-pointer"
                    >
                      <XCircle className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-400">
              Select an item to review.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
