/**
 * NW OS — General Approvals & Governance Center (Section 15)
 * Handles Drawing Approvals, Technical Changes, Variations, Major Purchases,
 * Project Dates, Safety-Critical Decisions, and Owner Executive Overrides.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import {
  ApprovalItem,
  ApprovalType,
  ApprovalDecision,
  UserRole,
} from '../types';
import {
  canEvaluateApproval,
  ROLE_DEFINITIONS,
} from '../utils/permissions';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ShieldAlert,
  FileText,
  DollarSign,
  Calendar,
  Layers,
  Sparkles,
  ChevronRight,
  Filter,
  Search,
  Plus,
  ArrowRight,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Check,
  X,
  History,
} from 'lucide-react';

export const ApprovalsView: React.FC = () => {
  const {
    currentUser,
    approvals,
    decideApproval,
    createApproval,
    userProjects,
    projects,
  } = useNW();

  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'technical' | 'variations' | 'purchases' | 'completed'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedApproval, setSelectedApproval] = useState<ApprovalItem | null>(null);

  // Decision Modal State
  const [decisionModalOpen, setDecisionModalOpen] = useState(false);
  const [pendingDecision, setPendingDecision] = useState<ApprovalDecision>('Approved');
  const [decisionComments, setDecisionComments] = useState('');
  const [isOverrideMode, setIsOverrideMode] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // New Request Modal State
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newType, setNewType] = useState<ApprovalType>('Technical Change');
  const [newProjectId, setNewProjectId] = useState(userProjects[0]?.id || 'proj-1');
  const [newDescription, setNewDescription] = useState('');
  const [newCostImpact, setNewCostImpact] = useState<number>(0);
  const [newScheduleImpact, setNewScheduleImpact] = useState<number>(0);
  const [newRisk, setNewRisk] = useState<'Low' | 'Medium' | 'High' | 'Critical'>('Medium');
  const [newApproverRole, setNewApproverRole] = useState<UserRole>('Owner / CEO');

  // Filtered approvals
  const filteredApprovals = approvals.filter((item) => {
    // Tab filter
    if (activeFilter === 'pending' && item.decision !== 'Pending') return false;
    if (
      activeFilter === 'technical' &&
      !['Technical Change', 'Drawing Approval', 'NW Production Drawing Approval'].includes(item.approval_type)
    )
      return false;
    if (activeFilter === 'variations' && !['Variation', 'Client Scope Change'].includes(item.approval_type)) return false;
    if (activeFilter === 'purchases' && !['Major Purchase', 'Major Cost'].includes(item.approval_type)) return false;
    if (activeFilter === 'completed' && item.decision === 'Pending') return false;

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesTitle = item.title.toLowerCase().includes(q);
      const matchesNo = item.approval_number.toLowerCase().includes(q);
      const matchesReq = item.requested_by_name.toLowerCase().includes(q);
      const matchesProj = item.project_name.toLowerCase().includes(q);
      if (!matchesTitle && !matchesNo && !matchesReq && !matchesProj) return false;
    }

    return true;
  });

  const pendingCount = approvals.filter((a) => a.decision === 'Pending').length;

  const handleOpenDecision = (item: ApprovalItem, decision: ApprovalDecision, override: boolean = false) => {
    setSelectedApproval(item);
    setPendingDecision(decision);
    setIsOverrideMode(override);
    setDecisionComments('');
    setOverrideReason('');
    setDecisionModalOpen(true);
  };

  const handleConfirmDecision = () => {
    if (!selectedApproval) return;

    decideApproval(
      selectedApproval.id,
      pendingDecision,
      decisionComments,
      isOverrideMode,
      overrideReason
    );

    setDecisionModalOpen(false);
    setSelectedApproval(null);
  };

  const handleCreateRequest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    const proj = projects.find((p) => p.id === newProjectId) || projects[0];

    createApproval({
      approval_type: newType,
      title: newTitle,
      description: newDescription,
      project_id: proj.id,
      project_name: proj.project_name,
      requested_by_id: currentUser.id,
      requested_by_name: currentUser.name,
      requested_by_role: currentUser.role,
      assigned_approver_role: newApproverRole,
      date_requested: new Date().toISOString(),
      decision: 'Pending',
      impact_summary: {
        cost_impact_myr: newCostImpact,
        schedule_impact_days: newScheduleImpact,
        technical_risk: newRisk,
      },
    });

    setShowNewModal(false);
    setNewTitle('');
    setNewDescription('');
    setNewCostImpact(0);
    setNewScheduleImpact(0);
  };

  const getTypeBadge = (type: ApprovalType) => {
    switch (type) {
      case 'NW Production Drawing Approval':
      case 'Drawing Approval':
        return 'bg-purple-100 text-purple-800 border-purple-300';
      case 'Technical Change':
        return 'bg-blue-100 text-blue-800 border-blue-300';
      case 'Variation':
      case 'Client Scope Change':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'Major Purchase':
      case 'Major Cost':
        return 'bg-emerald-100 text-emerald-800 border-emerald-300';
      case 'Safety-Critical Decision':
        return 'bg-rose-100 text-rose-800 border-rose-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  const getDecisionBadge = (decision: ApprovalDecision) => {
    switch (decision) {
      case 'Approved':
        return {
          bg: 'bg-emerald-50 text-emerald-700 border-emerald-300',
          icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
        };
      case 'Rejected':
        return {
          bg: 'bg-rose-50 text-rose-700 border-rose-300',
          icon: <XCircle className="w-4 h-4 text-rose-600" />,
        };
      case 'Changes Requested':
        return {
          bg: 'bg-amber-50 text-amber-800 border-amber-300',
          icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
        };
      default:
        return {
          bg: 'bg-indigo-50 text-indigo-700 border-indigo-300',
          icon: <Clock className="w-4 h-4 text-indigo-600 animate-pulse" />,
        };
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner & Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-700 border border-amber-300">
              <ShieldCheck className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
                <span>Approvals & Governance Center</span>
                {pendingCount > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-bold bg-rose-600 text-white shadow-2xs">
                    {pendingCount} Pending Action
                  </span>
                )}
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Role-based authorization engine with conflict-of-interest prevention and immutable Owner overrides
              </p>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>New Approval Request</span>
          </button>
        </div>
      </div>

      {/* Role Authority Indicator Bar */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center space-x-2.5">
          <span className="font-bold text-slate-700">Operating As:</span>
          <span className="font-extrabold text-slate-900">{currentUser.name}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
            {currentUser.role}
          </span>
          {currentUser.role === 'Owner / CEO' && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 text-purple-900 border border-purple-300 flex items-center space-x-1">
              <ShieldAlert className="w-3 h-3 text-purple-700" />
              <span>Full Executive Override Enabled</span>
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-500">
          Governance Policy: <span className="font-semibold text-slate-700">Creators cannot approve their own technical changes</span> unless overridden by Owner.
        </div>
      </div>

      {/* Filter Tabs and Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {[
            { id: 'all', label: 'All Requests' },
            { id: 'pending', label: `Pending (${pendingCount})` },
            { id: 'technical', label: 'Technical & Drawings' },
            { id: 'variations', label: 'Variations' },
            { id: 'purchases', label: 'Major Purchases' },
            { id: 'completed', label: 'Decided History' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveFilter(tab.id as any)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                activeFilter === tab.id
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Search approvals..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
          />
        </div>
      </div>

      {/* Approvals List */}
      <div className="space-y-4">
        {filteredApprovals.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-3" />
            <h3 className="text-sm font-bold text-slate-900">No Approvals Found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              There are no pending requests matching your current filters. All project items are up to date.
            </p>
          </div>
        ) : (
          filteredApprovals.map((item) => {
            const auth = canEvaluateApproval(currentUser, item);
            const statusInfo = getDecisionBadge(item.decision);

            return (
              <div
                key={item.id}
                className={`bg-white border rounded-2xl p-5 shadow-xs transition-all ${
                  item.decision === 'Pending' ? 'border-amber-200 hover:border-amber-400' : 'border-slate-200'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  {/* Left Column: Metadata & Details */}
                  <div className="space-y-2.5 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {item.approval_number}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getTypeBadge(item.approval_type)}`}>
                        {item.approval_type}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border flex items-center space-x-1 ${statusInfo.bg}`}>
                        {statusInfo.icon}
                        <span>{item.decision}</span>
                      </span>
                      {item.is_owner_override && (
                        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300 flex items-center space-x-1">
                          <ShieldAlert className="w-3 h-3 text-purple-700" />
                          <span>Owner Override</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                      {item.title}
                    </h3>

                    <p className="text-xs text-slate-600 leading-relaxed max-w-3xl">
                      {item.description}
                    </p>

                    {/* Metadata Grid */}
                    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-xs text-slate-500 border-t border-slate-100">
                      <div>
                        <span className="text-slate-400">Project: </span>
                        <strong className="text-slate-800 font-semibold">{item.project_name.split('—')[0]}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Requested By: </span>
                        <strong className="text-slate-800 font-semibold">
                          {item.requested_by_name} ({item.requested_by_role})
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Designated Approver: </span>
                        <strong className="text-slate-800 font-semibold">{item.assigned_approver_role}</strong>
                      </div>
                      <div>
                        <span className="text-slate-400">Date: </span>
                        <span className="text-slate-700">{new Date(item.date_requested).toLocaleDateString()}</span>
                      </div>
                    </div>

                    {/* Impact Summary & Supporting Docs */}
                    <div className="flex flex-wrap items-center gap-4 pt-2">
                      {item.impact_summary && (
                        <div className="flex items-center space-x-3 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
                          {item.impact_summary.cost_impact_myr !== undefined && (
                            <span className="flex items-center space-x-1">
                              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
                              <span>RM {item.impact_summary.cost_impact_myr.toLocaleString()}</span>
                            </span>
                          )}
                          {item.impact_summary.schedule_impact_days !== undefined && (
                            <span className="flex items-center space-x-1 border-l border-slate-200 pl-3">
                              <Calendar className="w-3.5 h-3.5 text-indigo-600" />
                              <span>
                                {item.impact_summary.schedule_impact_days > 0
                                  ? `+${item.impact_summary.schedule_impact_days} Days`
                                  : item.impact_summary.schedule_impact_days < 0
                                  ? `${item.impact_summary.schedule_impact_days} Days`
                                  : 'No Schedule Delay'}
                              </span>
                            </span>
                          )}
                          {item.impact_summary.technical_risk && (
                            <span className="border-l border-slate-200 pl-3 font-semibold">
                              Risk: <strong className={item.impact_summary.technical_risk === 'Critical' ? 'text-red-600 font-black' : 'text-slate-700'}>{item.impact_summary.technical_risk}</strong>
                            </span>
                          )}
                        </div>
                      )}

                      {item.supporting_documents && item.supporting_documents.length > 0 && (
                        <div className="flex items-center space-x-2">
                          {item.supporting_documents.map((doc, idx) => (
                            <span
                              key={idx}
                              className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 text-[11px] font-semibold"
                            >
                              <FileText className="w-3 h-3 text-indigo-600" />
                              <span>{doc.name}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Decision Comments / Override Notes if decided */}
                    {item.decision !== 'Pending' && item.comments && (
                      <div className="bg-amber-50/60 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 mt-2">
                        <div className="font-bold flex items-center space-x-1.5 text-amber-950">
                          <span>Decision by {item.decision_by_name} ({item.decision_by_role}):</span>
                          {item.decision_date && (
                            <span className="text-[10px] text-amber-700 font-normal">
                              {new Date(item.decision_date).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="mt-1 leading-relaxed">{item.comments}</p>
                        {item.override_reason && (
                          <div className="mt-1.5 pt-1.5 border-t border-amber-200/80 font-medium text-purple-900">
                            <strong>Owner Override Justification:</strong> {item.override_reason}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Right Column: Decision Actions */}
                  <div className="flex flex-col sm:flex-row lg:flex-col items-end justify-between gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                    {item.decision === 'Pending' ? (
                      <div className="w-full lg:w-48 space-y-2">
                        {auth.canApprove ? (
                          <>
                            <button
                              onClick={() => handleOpenDecision(item, 'Approved', false)}
                              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" />
                              <span>Approve Request</span>
                            </button>

                            <button
                              onClick={() => handleOpenDecision(item, 'Changes Requested', false)}
                              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold transition-colors"
                            >
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                              <span>Request Changes</span>
                            </button>

                            <button
                              onClick={() => handleOpenDecision(item, 'Rejected', false)}
                              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 border border-rose-300 text-xs font-semibold transition-colors"
                            >
                              <X className="w-3.5 h-3.5 text-rose-600" />
                              <span>Reject Request</span>
                            </button>
                          </>
                        ) : currentUser.role === 'Owner / CEO' ? (
                          // Owner Override Option
                          <div className="space-y-1.5">
                            <div className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200">
                              Requires Owner Override
                            </div>
                            <button
                              onClick={() => handleOpenDecision(item, 'Approved', true)}
                              className="w-full flex items-center justify-center space-x-1.5 px-3 py-2 rounded-xl bg-purple-700 hover:bg-purple-800 text-white text-xs font-bold shadow-xs transition-colors"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" />
                              <span>Owner Override & Approve</span>
                            </button>
                          </div>
                        ) : (
                          // Blocked with reason
                          <div className="bg-slate-100 text-slate-500 border border-slate-200 p-2.5 rounded-xl text-center">
                            <AlertCircle className="w-4 h-4 text-slate-400 mx-auto mb-1" />
                            <p className="text-[10px] leading-tight">
                              {auth.blockedReason || 'You are not designated to decide this approval.'}
                            </p>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-right">
                        <span className="text-[11px] text-slate-400 block">Status Closed</span>
                        <span className="text-xs font-bold text-slate-700">No Action Required</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Decision Modal */}
      {decisionModalOpen && selectedApproval && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">Confirm Governance Decision</span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">
                  {pendingDecision}: {selectedApproval.approval_number}
                </h3>
              </div>
              <button
                onClick={() => setDecisionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {isOverrideMode && (
              <div className="bg-purple-50 border border-purple-300 rounded-xl p-3.5 text-xs text-purple-900 space-y-1">
                <div className="font-extrabold flex items-center space-x-1.5 text-purple-950">
                  <ShieldAlert className="w-4 h-4 text-purple-700" />
                  <span>Owner Executive Override Protocol</span>
                </div>
                <p>
                  You are approving this item as Owner / CEO. Company policy mandates an explicit justification for this override, which will be permanently logged in the audit trail.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isOverrideMode ? 'Mandatory Override Justification *' : 'Decision Comments / Directives (Optional)'}
              </label>
              <textarea
                rows={3}
                required={isOverrideMode}
                placeholder={
                  isOverrideMode
                    ? 'State technical justification, client endorsement reference, or emergency commercial rationale...'
                    : 'Add notes for site supervisor, production manager, or contractor...'
                }
                value={isOverrideMode ? overrideReason : decisionComments}
                onChange={(e) =>
                  isOverrideMode ? setOverrideReason(e.target.value) : setDecisionComments(e.target.value)
                }
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setDecisionModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDecision}
                disabled={isOverrideMode && !overrideReason.trim()}
                className={`px-4 py-2 text-xs font-bold text-white rounded-xl shadow-xs ${
                  pendingDecision === 'Approved'
                    ? isOverrideMode
                      ? 'bg-purple-700 hover:bg-purple-800 disabled:opacity-50'
                      : 'bg-emerald-600 hover:bg-emerald-700'
                    : pendingDecision === 'Rejected'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                Confirm {pendingDecision}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Approval Request Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">Governance Submission</span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">Submit Formal Approval Request</h3>
              </div>
              <button onClick={() => setShowNewModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Approval Type *</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as ApprovalType)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                >
                  <option value="Drawing Approval">Drawing Approval</option>
                  <option value="NW Production Drawing Approval">NW Production Drawing Approval</option>
                  <option value="Technical Change">Technical Change</option>
                  <option value="Variation">Variation</option>
                  <option value="Major Purchase">Major Purchase</option>
                  <option value="Major Cost">Major Cost</option>
                  <option value="Client Scope Change">Client Scope Change</option>
                  <option value="Project Date Change">Project Date Change</option>
                  <option value="Safety-Critical Decision">Safety-Critical Decision</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Project *</label>
                <select
                  value={newProjectId}
                  onChange={(e) => setNewProjectId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                >
                  {userProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_name} ({p.project_number})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Request Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Joinery detail revision for CAR-003 front apron"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Detailed Description & Reason *</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Explain why this change or approval is required, what options were considered..."
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Cost Impact (MYR)</label>
                  <input
                    type="number"
                    value={newCostImpact}
                    onChange={(e) => setNewCostImpact(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Schedule Impact (Days)</label>
                  <input
                    type="number"
                    value={newScheduleImpact}
                    onChange={(e) => setNewScheduleImpact(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Technical Risk</label>
                  <select
                    value={newRisk}
                    onChange={(e) => setNewRisk(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    <option value="Low">Low</option>
                    <option value="Medium">Medium</option>
                    <option value="High">High</option>
                    <option value="Critical">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Assigned Approver</label>
                  <select
                    value={newApproverRole}
                    onChange={(e) => setNewApproverRole(e.target.value as UserRole)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    <option value="Owner / CEO">Owner / CEO</option>
                    <option value="Project Manager">Project Manager</option>
                    <option value="Production Manager">Production Manager</option>
                    <option value="Accountant">Accountant</option>
                    <option value="Client">Client</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl shadow-xs"
                >
                  Submit for Approval
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
