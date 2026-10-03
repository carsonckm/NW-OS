/**
 * NW OS — New Work Package Modal
 * Allocates trade packages (Carpentry, Electrical, Glass, Metal, etc.) to contractors
 * within a commercial fit-out project.
 */

import React, { useState, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import { WorkPackage, WorkPackageTrade, WorkPackageStatus } from '../types';
import {
  X,
  Layers,
  Building2,
  User,
  Wrench,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Percent,
  FileText,
} from 'lucide-react';

interface NewWorkPackageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (wp: WorkPackage, message: string) => void;
  defaultContractorId?: string;
  defaultProjectId?: string;
}

const TRADES: WorkPackageTrade[] = [
  'Carpentry',
  'Electrical',
  'Glass',
  'Metal',
  'Painting',
  'Ceiling',
  'Flooring',
  'Plumbing',
  'Other',
];

const STATUS_OPTIONS: WorkPackageStatus[] = [
  'Draft',
  'Assigned',
  'Contractor Confirmed',
  'In Progress',
  'Ready for QC',
  'QC Failed',
  'QC Passed',
  'Ready for Delivery',
  'Completed',
  'On Hold',
  'Blocked',
  'Cancelled',
];

export const NewWorkPackageModal: React.FC<NewWorkPackageModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultContractorId,
  defaultProjectId,
}) => {
  const { projects, contractors, addWorkPackage, selectedProjectId, availableUsers } = useNW();

  const [projectId, setProjectId] = useState(defaultProjectId || selectedProjectId || (projects[0]?.id ?? ''));
  const [contractorId, setContractorId] = useState(defaultContractorId || (contractors[0]?.id ?? ''));
  const [name, setName] = useState('');
  const [category, setCategory] = useState<WorkPackageTrade>('Carpentry');
  const [projectManagerId, setProjectManagerId] = useState('user-pm');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(
    new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [status, setStatus] = useState<WorkPackageStatus>('Assigned');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (defaultProjectId) {
      setProjectId(defaultProjectId);
    } else if (!projectId && projects.length > 0) {
      setProjectId(selectedProjectId || projects[0].id);
    }

    if (defaultContractorId) {
      setContractorId(defaultContractorId);
      const con = contractors.find((c) => c.id === defaultContractorId);
      if (con) {
        if (TRADES.includes(con.trade as WorkPackageTrade)) {
          setCategory(con.trade as WorkPackageTrade);
        }
        if (!name) {
          setName(`${con.trade.toUpperCase()} PACKAGE — ${con.company_name.split(' ')[0]}`);
        }
      }
    } else if (!contractorId && contractors.length > 0) {
      setContractorId(contractors[0].id);
    }
  }, [defaultContractorId, defaultProjectId, isOpen]);

  // When contractor changes, auto-suggest trade category
  const handleContractorChange = (cId: string) => {
    setContractorId(cId);
    const con = contractors.find((c) => c.id === cId);
    if (con) {
      if (TRADES.includes(con.trade as WorkPackageTrade)) {
        setCategory(con.trade as WorkPackageTrade);
      }
      if (!name) {
        setName(`${con.trade.toUpperCase()} WORK PACKAGE`);
      }
    }
  };

  if (!isOpen) return null;

  // Validation rules strictly per user instructions:
  // Required: Work Package Name, Trade / Category, Contractor
  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};
    if (!name.trim()) errs.name = 'Work Package Name is required.';
    if (!category) errs.category = 'Trade / Category is required.';
    if (!contractorId) errs.contractorId = 'Contractor is required.';
    if (!projectId) errs.projectId = 'Target Project is required.';

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const newWp = addWorkPackage({
        project_id: projectId,
        contractor_id: contractorId,
        name: name.trim().toUpperCase(),
        category,
        trade: category,
        project_manager_id: projectManagerId || 'user-pm',
        start_date: startDate,
        end_date: endDate,
        status,
        progress_percent: Math.min(100, Math.max(0, Number(progressPercent) || 0)),
        scope: notes.trim() || undefined,
        notes: notes.trim() || undefined,
      });

      // User requirement: Show "Work Package created successfully."
      onSuccess(newWp, 'Work Package created successfully.');
      onClose();
    } catch (err) {
      console.error('Failed to create work package:', err);
      setErrors({ form: 'Failed to create work package. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div
        className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full text-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8"
        id="new-work-package-modal"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">+ New Work Package</h2>
              <p className="text-xs text-slate-300">
                Define trade scope and assign qualified contractor to project.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[82vh] overflow-y-auto">
          {errors.form && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center space-x-2 text-xs text-rose-700 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errors.form}</span>
            </div>
          )}

          {/* Target Project */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Project <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
              <select
                value={projectId}
                onChange={(e) => setProjectId(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer font-medium"
                id="select-project-for-wp"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.project_number} — {p.project_name.split('—')[0]}
                  </option>
                ))}
              </select>
            </div>
            {errors.projectId && (
              <p className="text-[11px] text-rose-600 font-medium">{errors.projectId}</p>
            )}
          </div>

          {/* Work Package Name (Required) */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Work Package Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. BESPOKE CARPENTRY & WALL PANELLING"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all uppercase font-medium"
              id="wp-name-input"
            />
            {errors.name && (
              <p className="text-[11px] text-rose-600 font-medium">{errors.name}</p>
            )}
          </div>

          {/* Trade / Category (Required) & Contractor (Required) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Trade / Category */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Trade / Category <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Wrench className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as WorkPackageTrade)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer font-medium"
                  id="select-trade-category"
                >
                  {TRADES.map((trade) => (
                    <option key={trade} value={trade}>
                      {trade}
                    </option>
                  ))}
                </select>
              </div>
              {errors.category && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.category}</p>
              )}
            </div>

            {/* Contractor (from Contractor Management) */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Contractor <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
                <select
                  value={contractorId}
                  onChange={(e) => handleContractorChange(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer font-medium"
                  id="select-contractor-for-wp"
                >
                  {contractors.length === 0 ? (
                    <option value="">No contractors available</option>
                  ) : (
                    contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name} ({c.trade}) {c.is_active === false ? '[Inactive]' : ''}
                      </option>
                    ))
                  )}
                </select>
              </div>
              {errors.contractorId && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.contractorId}</p>
              )}
            </div>
          </div>

          {/* Project Manager & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Project Manager
              </label>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
                <select
                  value={projectManagerId}
                  onChange={(e) => setProjectManagerId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer"
                  id="select-pm-for-wp"
                >
                  <option value="user-pm">Marcus Lee (Project Manager)</option>
                  {availableUsers
                    .filter((u) => u.id !== 'user-pm')
                    .map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.role})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkPackageStatus)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer"
                id="select-wp-status"
              >
                {STATUS_OPTIONS.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Schedule: Start Date & End Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Start Date
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all font-mono"
                  id="wp-start-date"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                End Date
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all font-mono"
                  id="wp-end-date"
                />
              </div>
            </div>
          </div>

          {/* Progress % */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Progress %
              </label>
              <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                {progressPercent}%
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={progressPercent}
                onChange={(e) => setProgressPercent(parseInt(e.target.value))}
                className="w-full accent-amber-500 cursor-pointer"
                id="wp-progress-slider"
              />
              <input
                type="number"
                min="0"
                max="100"
                value={progressPercent}
                onChange={(e) =>
                  setProgressPercent(Math.min(100, Math.max(0, parseInt(e.target.value) || 0)))
                }
                className="w-16 bg-slate-50 border border-slate-200 rounded-xl px-2 py-1.5 text-xs font-mono font-bold text-center text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
          </div>

          {/* Scope / Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Scope / Notes
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Specify scope boundary, material requirements, drawings reference, and site coordination requirements..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
              id="wp-notes-textarea"
            />
          </div>

          {/* Action Buttons: Cancel and Save */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer"
              id="cancel-new-wp-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
              id="save-work-package-btn"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>{isSubmitting ? 'Saving...' : 'Save Work Package'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
