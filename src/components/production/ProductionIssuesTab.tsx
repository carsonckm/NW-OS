/**
 * NW OS — Production Issues & Factory Bottlenecks Module
 * Defect escalations, machine breakdowns, site drawing clashes, and blocker tracking
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  ShieldAlert,
  AlertTriangle,
  Plus,
  CheckCircle2,
  Clock,
  User,
  ArrowUpRight,
  RotateCcw,
  Wrench,
  FileQuestion,
  X,
} from 'lucide-react';
import { ProductionIssueRecord } from '../../types';

export const ProductionIssuesTab: React.FC = () => {
  const {
    productionIssues,
    productionOrders,
    reportProductionIssue,
    resolveProductionIssue,
    currentUser,
  } = useNW();

  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(productionOrders[0]?.id || '');
  const [issueTitle, setIssueTitle] = useState('');
  const [category, setCategory] = useState<ProductionIssueRecord['category']>('Drawing discrepancy');
  const [severity, setSeverity] = useState<ProductionIssueRecord['severity']>('Critical Blocker');
  const [escalation, setEscalation] = useState<ProductionIssueRecord['escalation_level']>('Owner');
  const [description, setDescription] = useState('');
  const [actionPlan, setActionPlan] = useState('');

  const [activeResolveIssue, setActiveResolveIssue] = useState<ProductionIssueRecord | null>(null);
  const [resolveNotes, setResolveNotes] = useState('');

  const handleReport = () => {
    const order = productionOrders.find((o) => o.id === selectedOrderId);
    if (!order || !issueTitle.trim()) return;

    reportProductionIssue({
      production_order_id: order.id,
      production_order_number: order.order_number,
      work_item_code: order.work_item_code,
      title: issueTitle,
      category,
      stage_at_occurrence: order.current_stage,
      severity,
      status: 'Decision Required',
      reported_by: currentUser.name,
      assigned_to: escalation === 'Owner' ? 'Dato’ Nicholas Wong (Owner)' : 'Marcus Lee (PM)',
      escalation_level: escalation,
      description,
      action_plan: actionPlan,
      photos: order.photos || [],
    });

    setShowReportModal(false);
    setIssueTitle('');
    setDescription('');
    setActionPlan('');
  };

  const handleConfirmResolve = () => {
    if (!activeResolveIssue || !resolveNotes.trim()) return;
    resolveProductionIssue(activeResolveIssue.id, resolveNotes);
    setActiveResolveIssue(null);
    setResolveNotes('');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldAlert className="w-5 h-5 text-rose-600" />
            <h3 className="font-bold text-slate-900 text-sm">Factory Bottlenecks & Escalations</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Identify machine outages, material defects, and drawing clashes. Critical blockers immediately flag production orders.
          </p>
        </div>

        <button
          onClick={() => setShowReportModal(true)}
          className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Report Production Blocker</span>
        </button>
      </div>

      {/* Issues List */}
      <div className="space-y-4">
        {productionIssues.map((issue) => (
          <div
            key={issue.id}
            className={`bg-white border rounded-xl p-5 shadow-xs space-y-4 ${
              issue.severity === 'Critical Blocker'
                ? 'border-rose-300 bg-rose-50/20'
                : 'border-slate-200'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <span className="font-mono font-bold text-slate-900 text-xs px-2 py-0.5 rounded bg-slate-100 border border-slate-200">
                  {issue.issue_code}
                </span>
                <span className="text-xs font-bold text-slate-900">{issue.title}</span>
              </div>

              <div className="flex items-center space-x-2">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    issue.severity === 'Critical Blocker'
                      ? 'bg-rose-600 text-white animate-pulse'
                      : issue.severity === 'High'
                      ? 'bg-amber-100 text-amber-900'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  {issue.severity}
                </span>

                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    issue.status === 'Resolved'
                      ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                      : 'bg-amber-100 text-amber-900'
                  }`}
                >
                  {issue.status}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs text-slate-700 bg-slate-50 p-3 rounded-lg">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Category</span>
                <span className="font-semibold text-slate-900">{issue.category}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Affected Order</span>
                <span className="font-mono font-bold text-slate-900">
                  {issue.production_order_number} ({issue.work_item_code})
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Stage At Occurrence</span>
                <span className="font-semibold text-slate-900">{issue.stage_at_occurrence}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-bold">Escalation Tier</span>
                <span className="font-bold text-rose-700">{issue.escalation_level}</span>
              </div>
            </div>

            <div className="space-y-1 text-xs text-slate-700">
              <span className="font-bold text-slate-900 block">Description:</span>
              <p className="text-slate-600">{issue.description}</p>
            </div>

            <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-lg text-xs space-y-1">
              <span className="font-bold text-amber-900 block">Technical Action Plan:</span>
              <p className="text-amber-800">{issue.action_plan}</p>
            </div>

            {issue.resolution_notes && (
              <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs space-y-1">
                <span className="font-bold text-emerald-900 flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Resolution Notes:</span>
                </span>
                <p className="text-emerald-800">{issue.resolution_notes}</p>
              </div>
            )}

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100 text-xs">
              <span className="text-[11px] text-slate-400">
                Reported by {issue.reported_by} on {new Date(issue.reported_at).toLocaleDateString()}
              </span>

              {issue.status !== 'Resolved' && (
                <button
                  onClick={() => setActiveResolveIssue(issue)}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors shadow-xs"
                >
                  Mark Issue Resolved
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-2">
                <ShieldAlert className="w-4 h-4 text-rose-600" />
                <span>Report Production Problem / Blocker</span>
              </h3>
              <button onClick={() => setShowReportModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Affected Production Order
              </label>
              <select
                aria-label="Affected Production Order"
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-bold text-slate-900"
              >
                {productionOrders.map((ord) => (
                  <option key={ord.id} value={ord.id}>
                    {ord.order_number} — {ord.work_item_code} (Stage: {ord.current_stage})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Issue Title
              </label>
              <input
                type="text"
                placeholder="e.g. Edge Bander Spindle Bearing Failure, Site Opening Dimension Clash..."
                value={issueTitle}
                onChange={(e) => setIssueTitle(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Category
                </label>
                <select
                  aria-label="Issue Category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value as any)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                >
                  <option value="Drawing discrepancy">Drawing discrepancy</option>
                  <option value="Material defect">Material defect</option>
                  <option value="Machine breakdown">Machine breakdown</option>
                  <option value="Missing part">Missing part</option>
                  <option value="Dimension error">Dimension error</option>
                  <option value="Quality rejection">Quality rejection</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Severity
                </label>
                <select
                  aria-label="Issue Severity"
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as any)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                >
                  <option value="Critical Blocker">Critical Blocker (Halts Stage)</option>
                  <option value="High">High</option>
                  <option value="Medium">Medium</option>
                  <option value="Low">Low</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Escalation Level
              </label>
              <select
                aria-label="Escalation Level"
                value={escalation}
                onChange={(e) => setEscalation(e.target.value as any)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              >
                <option value="Owner">Owner / CEO (Immediate strategic hold)</option>
                <option value="PM">Project Manager</option>
                <option value="Production Manager">Production Manager</option>
                <option value="Factory Foreman">Factory Foreman</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Description of Defect / Root Cause
              </label>
              <textarea
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Proposed Action Plan
              </label>
              <textarea
                rows={2}
                value={actionPlan}
                onChange={(e) => setActionPlan(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                onClick={() => setShowReportModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleReport}
                disabled={!issueTitle.trim()}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                Submit & Escalate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve Modal */}
      {activeResolveIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Resolve Blocker: {activeResolveIssue.issue_code}</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Resolution & Corrective Actions (Mandatory)
              </label>
              <textarea
                rows={3}
                placeholder="Explain what was fixed, parts replaced, or drawing instruction adopted..."
                value={resolveNotes}
                onChange={(e) => setResolveNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                onClick={() => setActiveResolveIssue(null)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmResolve}
                disabled={!resolveNotes.trim()}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
