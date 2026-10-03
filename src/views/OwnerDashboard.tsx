/**
 * NW OS Owner / CEO Executive Dashboard
 * Built strictly around the core principle: "Manage by exception, not by constantly coordinating people."
 * Focuses purely on: "What do I need to know or decide today?"
 */

import React, { useState, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import {
  ShieldAlert,
  AlertTriangle,
  Sparkles,
  CheckCircle2,
  Clock,
  Truck,
  Wrench,
  TrendingUp,
  FileCheck,
  Building2,
  ArrowRight,
  DollarSign,
  Layers,
  ChevronRight,
} from 'lucide-react';
import { IssueModal } from '../components/IssueModal';

interface OwnerDashboardProps {
  onNavigate: (tab: string, filterId?: string) => void;
}

export const OwnerDashboard: React.FC<OwnerDashboardProps> = ({ onNavigate }) => {
  const {
    projects,
    issues,
    variations,
    workItems,
    resolveIssue,
    approveVariation,
  } = useNW();

  const [aiBriefing, setAiBriefing] = useState<string>('');
  const [loadingBriefing, setLoadingBriefing] = useState(false);
  const [selectedIssueForModal, setSelectedIssueForModal] = useState<any>(null);

  // Critical items requiring Owner attention
  const ownerEscalations = issues.filter(
    (i) => (i.escalation_level === 'Owner' || i.priority === 'Critical') && i.status !== 'Resolved'
  );
  const atRiskProjects = projects.filter((p) => p.is_at_risk);
  const pendingOwnerVariations = variations.filter(
    (v) => v.status === 'Internal Approval' || !v.approved_by_owner
  );

  const todayDeliveries = workItems.filter(
    (w) => w.delivery_status === 'Scheduled' || w.scheduled_delivery_date === '2026-09-09'
  );
  const todayInstallations = workItems.filter(
    (w) => w.installation_status === 'In Progress' || w.status === 'Installation In Progress'
  );

  const totalContractValue = projects.reduce((sum, p) => sum + p.contract_value, 0);

  // Fetch AI Briefing on mount
  useEffect(() => {
    async function fetchBriefing() {
      setLoadingBriefing(true);
      try {
        const res = await fetch('/api/ai/briefing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectsSummary: projects.map((p) => ({ name: p.project_name, progress: p.progress_percent, risk: p.is_at_risk })),
            criticalIssues: ownerEscalations.map((i) => ({ title: i.title, action: i.action_required })),
            atRiskProjects: atRiskProjects.map((p) => ({ project_name: p.project_name, reason: p.risk_reason })),
            todayDeliveries: todayDeliveries.length,
            todayInstallations: todayInstallations.length,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setAiBriefing(data.briefing);
        }
      } catch (err) {
        console.warn('AI briefing fetch error:', err);
      } finally {
        setLoadingBriefing(false);
      }
    }
    fetchBriefing();
  }, [projects.length, ownerEscalations.length]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* Top Banner: Core Management Principle */}
      <div className="bg-gradient-to-r from-amber-50 via-white to-amber-50/60 border border-amber-200/80 rounded-2xl p-5 sm:p-6 shadow-xs relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold uppercase tracking-widest">
                Owner Operating Paradigm
              </span>
              <span className="text-xs text-slate-500 font-medium">Manage By Exception</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1 tracking-tight">
              Executive Morning Briefing & Decision Matrix
            </h1>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
              "What do I need to know or decide today?" Routine approvals are delegated to PMs and Site Supervisors; only critical risks, scope variations, and financial thresholds escalate here.
            </p>
          </div>

          {/* Key Stat Badges */}
          <div className="flex items-center space-x-3 shrink-0">
            <div className="px-4 py-2.5 rounded-xl bg-white border border-amber-200/80 text-right shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Active Contracts
              </span>
              <span className="text-base font-black text-amber-600 font-mono">
                RM {(totalContractValue / 1000000).toFixed(2)}M
              </span>
            </div>
            <div className="px-4 py-2.5 rounded-xl bg-white border border-rose-200 text-right shadow-xs">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                Escalations Today
              </span>
              <span className="text-base font-black text-rose-600 font-mono">
                {ownerEscalations.length} Pending
              </span>
            </div>
          </div>
        </div>

        {/* AI Briefing Bubble */}
        <div className="mt-5 p-4 rounded-xl bg-white border border-amber-200/80 shadow-xs relative z-10">
          <div className="flex items-start space-x-3">
            <div className="w-8 h-8 rounded-lg bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
              <Sparkles className="w-4 h-4 animate-pulse text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                  AI Synthesized Operational Pulse
                </span>
                <span className="text-[10px] text-slate-400">Updated just now</span>
              </div>
              {loadingBriefing ? (
                <div className="text-xs text-slate-500 animate-pulse">
                  Analyzing project logs, contractor reports, and site laser scans...
                </div>
              ) : (
                <p className="text-xs sm:text-sm text-slate-700 leading-relaxed font-medium">
                  {aiBriefing ||
                    'Active projects progressing steadily. Project Aurora (Pavilion) has 1 critical site dimension variance on Cashier Counter CAR-003 awaiting Owner exception approval. Project Horizon is monitoring walnut veneer lead times. Deliveries and installations scheduled today are running on track.'}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 1: CRITICAL DECISIONS REQUIRING OWNER ACTION (The #1 Priority) */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            <h2 className="text-base font-bold text-slate-900">
              Decisions Requiring Owner Exception Sign-Off ({ownerEscalations.length})
            </h2>
          </div>
          <span className="text-xs text-slate-500 font-medium">Rule: Automatic Escalation from PM</span>
        </div>

        {ownerEscalations.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center shadow-xs">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-bold text-slate-900">No Critical Escalations Pending</p>
            <p className="text-xs text-slate-500 mt-1">
              All active projects are operating within standard PM and Site Supervisor tolerances.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {ownerEscalations.map((issue) => (
              <div
                key={issue.id}
                className="bg-white border-2 border-rose-300 rounded-2xl p-5 sm:p-6 shadow-sm relative overflow-hidden"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center space-x-2.5">
                      <span className="px-2.5 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200 text-xs font-bold uppercase tracking-wider">
                        {issue.priority} Exception
                      </span>
                      <span className="text-xs font-mono text-slate-500">
                        Target: Cashier Counter CAR-003 (Project Aurora)
                      </span>
                    </div>

                    <h3 className="text-base sm:text-lg font-bold text-slate-900">{issue.title}</h3>
                    <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                      {issue.description}
                    </p>

                    <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 text-xs text-amber-900 flex items-start space-x-2.5">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div>
                        <strong className="text-amber-900 font-bold">PM Recommendation:</strong>{' '}
                        <span className="text-slate-800">{issue.action_required}</span>
                        <div className="text-[11px] text-slate-600 mt-0.5">
                          Variation VO-002: Trimming 100mm off non-functional end plinth allows installation without delaying grand opening. Internal cost RM 650, Client cost RM 0.
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 1-Click Action Hub */}
                  <div className="flex flex-col sm:flex-row lg:flex-col gap-2 shrink-0 lg:w-60">
                    <button
                      onClick={() => {
                        resolveIssue(
                          issue.id,
                          'Owner Approved Variation VO-002: Trim 100mm off Module B end plinth to match 2300mm site condition.'
                        );
                      }}
                      className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Approve 100mm Trim (VO-002)</span>
                    </button>

                    <button
                      onClick={() => onNavigate('drawings')}
                      className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl border border-slate-300 transition-colors flex items-center justify-center space-x-1.5 cursor-pointer"
                    >
                      <Layers className="w-3.5 h-3.5 text-slate-600" />
                      <span>Review Drawing A-103 Rev 2</span>
                    </button>

                    <button
                      onClick={() => setSelectedIssueForModal(issue)}
                      className="px-4 py-2 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium rounded-xl border border-slate-300 transition-colors text-center cursor-pointer shadow-2xs"
                    >
                      View Full Audit Trail
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* SECTION 2: PROJECTS AT RISK & HIGH LEVEL STATUS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* At Risk Projects Card */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <span>Projects Requiring Attention ({atRiskProjects.length})</span>
            </h3>
            <button
              onClick={() => onNavigate('projects')}
              className="text-xs text-amber-600 font-bold hover:underline flex items-center space-x-1 cursor-pointer"
            >
              <span>View all projects</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="space-y-3">
            {atRiskProjects.map((proj) => (
              <div
                key={proj.id}
                className="p-4 rounded-xl bg-slate-50/80 border border-slate-200 hover:border-slate-300 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono text-amber-600 font-bold">{proj.project_number}</span>
                      <h4 className="text-xs font-bold text-slate-900">{proj.project_name}</h4>
                    </div>
                    <p className="text-xs text-rose-600 font-medium mt-1 flex items-center space-x-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block" />
                      <span>{proj.risk_reason}</span>
                    </p>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-800">
                    {proj.progress_percent}%
                  </span>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-200 h-2 rounded-full mt-3 overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all"
                    style={{ width: `${proj.progress_percent}%` }}
                  />
                </div>

                <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Target Handover: {proj.end_date}</span>
                  <span className="font-mono font-semibold text-slate-700">RM {proj.contract_value.toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Variations & Claims Pending Sign-Off */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>Variations Sign-Off</span>
            </h3>
            <span className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Commercial Control</span>
          </div>

          <div className="space-y-3">
            {variations.slice(0, 3).map((vo) => (
              <div key={vo.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 font-mono">{vo.variation_number}</span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      vo.status === 'Approved'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {vo.status}
                  </span>
                </div>
                <p className="text-xs text-slate-700 font-medium line-clamp-1">{vo.title}</p>
                <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                  <span>Cost: RM {vo.estimated_cost}</span>
                  <span className="text-emerald-700 font-semibold">Client: RM {vo.client_amount}</span>
                </div>
                {vo.status !== 'Approved' && (
                  <button
                    onClick={() => approveVariation(vo.id, true)}
                    className="w-full py-1.5 text-xs bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg font-bold transition-colors shadow-2xs cursor-pointer"
                  >
                    Approve VO
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* SECTION 3: HIGH LEVEL LOGISTICS SUMMARY (No Micro-management) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-11 h-11 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center">
            <Truck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Scheduled Deliveries</span>
            <span className="text-lg font-bold text-slate-900">{todayDeliveries.length} Shipments</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 border border-indigo-200 flex items-center justify-center">
            <Wrench className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Site Installations</span>
            <span className="text-lg font-bold text-slate-900">{todayInstallations.length} Active Sites</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Factory QC Pass Rate</span>
            <span className="text-lg font-bold text-slate-900">92%</span>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-center space-x-3.5 shadow-xs">
          <div className="w-11 h-11 rounded-xl bg-amber-50 text-amber-700 border border-amber-200 flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <span className="text-[11px] text-slate-500 block font-medium">Total Work Items</span>
            <span className="text-lg font-bold text-slate-900">{workItems.length} Registered</span>
          </div>
        </div>
      </div>

      {/* Modal for viewing issue details */}
      {selectedIssueForModal && (
        <IssueModal
          isOpen={Boolean(selectedIssueForModal)}
          onClose={() => setSelectedIssueForModal(null)}
          existingIssue={selectedIssueForModal}
        />
      )}
    </div>
  );
};
