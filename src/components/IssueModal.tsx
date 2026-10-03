/**
 * NW OS Issue Creation & Exception Resolution Modal
 * Integrates multilingual AI classification, hierarchical escalation, and Owner 1-click decision actions.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Issue, IssueCategory, EscalationLevel } from '../types';
import {
  AlertTriangle,
  Sparkles,
  ShieldAlert,
  Send,
  CheckCircle2,
  X,
  FileText,
  User,
  Layers,
  ArrowUpRight,
} from 'lucide-react';

interface IssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultWorkItemId?: string;
  existingIssue?: Issue;
}

export const IssueModal: React.FC<IssueModalProps> = ({
  isOpen,
  onClose,
  defaultWorkItemId,
  existingIssue,
}) => {
  const {
    currentUser,
    workItems,
    selectedProjectId,
    createIssue,
    resolveIssue,
    escalateIssue,
  } = useNW();

  const [rawText, setRawText] = useState(existingIssue?.description || '');
  const [title, setTitle] = useState(existingIssue?.title || '');
  const [category, setCategory] = useState<IssueCategory>(
    existingIssue?.category || 'Site condition'
  );
  const [priority, setPriority] = useState<'Low' | 'Medium' | 'High' | 'Critical'>(
    existingIssue?.priority || 'High'
  );
  const [escalationLevel, setEscalationLevel] = useState<EscalationLevel>(
    existingIssue?.escalation_level || 'PM'
  );
  const [actionRequired, setActionRequired] = useState(
    existingIssue?.action_required || 'Investigation & site survey'
  );
  const [selectedItemId, setSelectedItemId] = useState(
    existingIssue?.work_item_id || defaultWorkItemId || 'item-1'
  );

  const [isClassifying, setIsClassifying] = useState(false);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [isResolving, setIsResolving] = useState(false);

  if (!isOpen) return null;

  // AI Classification Trigger
  const handleAIClassify = async () => {
    if (!rawText.trim()) return;
    setIsClassifying(true);

    try {
      const res = await fetch('/api/ai/classify-issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          reportedBy: currentUser.name,
          role: currentUser.role,
          workItems: workItems.map((w) => ({ code: w.item_code, desc: w.description, id: w.id })),
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.title) setTitle(data.title);
        if (data.category) setCategory(data.category);
        if (data.priority) setPriority(data.priority);
        if (data.action_required) setActionRequired(data.action_required);
        if (data.escalation_target) setEscalationLevel(data.escalation_target as EscalationLevel);

        if (data.affected_item_code) {
          const match = workItems.find((w) => w.item_code === data.affected_item_code);
          if (match) setSelectedItemId(match.id);
        }
      }
    } catch (err) {
      console.warn('AI issue classify network error:', err);
    } finally {
      setIsClassifying(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await createIssue({
      project_id: selectedProjectId,
      work_item_id: selectedItemId,
      title: title.trim() || 'Site Issue',
      category,
      priority,
      status: escalationLevel === 'Owner' ? 'Decision Required' : 'Reported',
      reported_by: currentUser.name,
      reported_by_role: currentUser.role,
      assigned_to: escalationLevel === 'Owner' ? 'Dato’ Nicholas Wong (Owner / CEO)' : 'Marcus Lee (PM)',
      escalation_level: escalationLevel,
      action_required: actionRequired,
      description: rawText.trim(),
    });

    onClose();
  };

  const handleResolve = () => {
    if (!existingIssue || !resolutionNotes.trim()) return;
    resolveIssue(existingIssue.id, resolutionNotes.trim());
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-xl w-full p-5 sm:p-6 text-slate-800 shadow-2xl relative my-8">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 pb-3.5 mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {existingIssue ? 'Issue Details & Exception Decision' : 'Report Site / Production Issue'}
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Reported by {existingIssue ? existingIssue.reported_by : currentUser.name} ({currentUser.role})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Existing Issue View & Decision Mode */}
        {existingIssue ? (
          <div className="space-y-4">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900">{existingIssue.title}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-200">
                  {existingIssue.priority} Priority
                </span>
              </div>
              <p className="text-xs text-slate-600">{existingIssue.description}</p>
              <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 flex flex-wrap gap-3 font-medium">
                <span>Category: <strong className="text-slate-800">{existingIssue.category}</strong></span>
                <span>Escalation: <strong className="text-amber-800 font-bold">{existingIssue.escalation_level}</strong></span>
                <span>Status: <strong className="text-slate-800">{existingIssue.status}</strong></span>
              </div>
            </div>

            {/* Owner Decision Section */}
            {(currentUser.role === 'Owner / CEO' || currentUser.role === 'Project Manager') && (
              <div className="p-4 rounded-xl bg-amber-50/70 border border-amber-300 space-y-3">
                <div className="flex items-center space-x-2 text-xs font-bold text-amber-900">
                  <ShieldAlert className="w-4 h-4 text-amber-600" />
                  <span>
                    {currentUser.role === 'Owner / CEO' ? 'Owner Exception Action' : 'PM Resolution Action'}
                  </span>
                </div>

                {existingIssue.id === 'issue-1' && (
                  <div className="p-3 bg-white rounded-lg border border-amber-200 text-xs text-slate-700 space-y-2 shadow-2xs">
                    <p className="font-bold text-amber-900">
                      Recommendation for Cashier Counter CAR-003:
                    </p>
                    <p className="text-[11px] text-slate-600">
                      Approve Variation VO-002 to trim 100mm from non-functional Module B end filler plinth.
                      Preserves client Corian countertop alignment without delaying site delivery.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setResolutionNotes(
                          'Owner Approved Variation VO-002: Trim 100mm off Module B end filler plinth. Proceed with factory assembly.'
                        );
                      }}
                      className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg shadow-2xs cursor-pointer"
                    >
                      Use Recommended Decision
                    </button>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Formal Decision / Resolution Notes:
                  </label>
                  <textarea
                    value={resolutionNotes}
                    onChange={(e) => setResolutionNotes(e.target.value)}
                    rows={3}
                    placeholder="Enter official decision, approved variation number, or site instruction..."
                    className="w-full bg-white border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div className="flex justify-end space-x-2">
                  <button
                    onClick={handleResolve}
                    disabled={!resolutionNotes.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold text-xs rounded-xl flex items-center space-x-1.5 shadow-xs cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve Decision & Resolve Issue</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Create Issue Form */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Multilingual Text Input */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-700">
                  What happened on site or in factory? (Supports English, Malay, or Chinese)
                </label>
                <button
                  type="button"
                  onClick={handleAIClassify}
                  disabled={isClassifying || !rawText.trim()}
                  className="flex items-center space-x-1 text-xs text-amber-700 hover:text-amber-800 font-bold disabled:opacity-40 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 animate-pulse text-amber-600" />
                  <span>{isClassifying ? 'Analyzing with AI...' : 'AI Auto-Classify'}</span>
                </button>
              </div>

              <textarea
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                rows={3}
                placeholder="e.g. 柜台尺寸现场量出来2300，图纸写2400，装不下 / Counter 3 dimension tak muat / Glass vitrine scratched during loading..."
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
                required
              />
            </div>

            {/* Form Fields after AI extraction or manual edit */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Site Dimension Conflict on CAR-003"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Affected Work Item
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                >
                  {workItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.item_code} — {item.description.slice(0, 30)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Category</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as IssueCategory)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                >
                  {[
                    'Site condition',
                    'Drawing',
                    'Material',
                    'Production',
                    'Delivery',
                    'Installation',
                    'Contractor',
                    'Client',
                    'Variation',
                    'Cost',
                    'Safety',
                    'Schedule',
                  ].map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Escalate To
                </label>
                <select
                  value={escalationLevel}
                  onChange={(e) => setEscalationLevel(e.target.value as EscalationLevel)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
                >
                  <option value="Site Supervisor">Site Supervisor</option>
                  <option value="PM">Project Manager</option>
                  <option value="Owner">Owner (Exception)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Action Required
              </label>
              <input
                type="text"
                value={actionRequired}
                onChange={(e) => setActionRequired(e.target.value)}
                placeholder="e.g. PM review required / Site Disto survey"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Submit Issue</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
