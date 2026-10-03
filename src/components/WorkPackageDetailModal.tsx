/**
 * NW OS — Work Package Detail Modal / View
 * Displays complete Work Package specifications: Trade, Contractor, PM, Schedule,
 * Progress, Status, Scope / Notes, and linked Work Items with "+ New Work Item" action.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkPackage, WorkPackageStatus, WorkItem } from '../types';
import { NewWorkItemModal } from './NewWorkItemModal';
import { WorkItemDetailModal } from './WorkItemDetailModal';
import {
  X,
  Layers,
  Wrench,
  User,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Plus,
  Building2,
  Phone,
  Mail,
  ChevronRight,
  ShieldCheck,
  Truck,
  Edit2,
  Trash2,
  Percent,
} from 'lucide-react';

interface WorkPackageDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  workPackageId: string | null;
  onSelectWorkItem?: (item: WorkItem) => void;
  onNavigateToContractor?: (contractorId: string) => void;
}

const ALL_STATUSES: WorkPackageStatus[] = [
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

export const WorkPackageDetailModal: React.FC<WorkPackageDetailModalProps> = ({
  isOpen,
  onClose,
  workPackageId,
  onSelectWorkItem,
  onNavigateToContractor,
}) => {
  const {
    workPackages,
    projects,
    contractors,
    workItems,
    availableUsers,
    updateWorkPackage,
    deleteWorkPackage,
  } = useNW();

  const [showNewWorkItemModal, setShowNewWorkItemModal] = useState(false);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [isEditingScope, setIsEditingScope] = useState(false);
  const [scopeText, setScopeText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  if (!isOpen || !workPackageId) return null;

  const currentWp = workPackages.find((wp) => wp.id === workPackageId);
  if (!currentWp) return null;

  const project = projects.find((p) => p.id === currentWp.project_id);
  const contractor = contractors.find((c) => c.id === currentWp.contractor_id);
  const pmUser = availableUsers.find(
    (u) => u.id === currentWp.project_manager_id || u.role === 'Project Manager'
  );

  // Filter work items belonging to this package
  const packageItems = workItems.filter((item) => item.work_package_id === currentWp.id);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleStatusChange = (newStatus: WorkPackageStatus) => {
    updateWorkPackage(currentWp.id, { status: newStatus });
    showToast(`Work package status updated to "${newStatus}".`);
  };

  const handleProgressChange = (newProgress: number) => {
    updateWorkPackage(currentWp.id, { progress_percent: newProgress });
    showToast(`Progress updated to ${newProgress}%.`);
  };

  const handleSaveScope = () => {
    updateWorkPackage(currentWp.id, {
      scope: scopeText,
      notes: scopeText,
    });
    setIsEditingScope(false);
    showToast('Scope and notes saved.');
  };

  const handleDelete = () => {
    deleteWorkPackage(currentWp.id);
    onClose();
  };

  // Status badge styling helper
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Draft':
        return 'bg-slate-100 text-slate-700 border-slate-300';
      case 'Assigned':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Contractor Confirmed':
        return 'bg-sky-50 text-sky-800 border-sky-300';
      case 'In Progress':
        return 'bg-amber-50 text-amber-800 border-amber-300';
      case 'Ready for QC':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'QC Failed':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'QC Passed':
        return 'bg-emerald-50 text-emerald-800 border-emerald-300';
      case 'Ready for Delivery':
        return 'bg-teal-50 text-teal-800 border-teal-300';
      case 'Completed':
        return 'bg-emerald-100 text-emerald-900 border-emerald-400 font-bold';
      case 'On Hold':
        return 'bg-orange-50 text-orange-800 border-orange-200';
      case 'Blocked':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'Cancelled':
        return 'bg-slate-200 text-slate-800 border-slate-300';
      default:
        return 'bg-amber-50 text-amber-800 border-amber-300';
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-60 animate-in slide-in-from-top duration-200">
          <div className="bg-emerald-600 text-white px-4 py-2.5 rounded-2xl shadow-xl flex items-center space-x-2 text-xs font-bold">
            <CheckCircle2 className="w-4 h-4 text-emerald-200 shrink-0" />
            <span>{toastMessage}</span>
          </div>
        </div>
      )}

      <div
        className="bg-white border border-slate-200 rounded-3xl max-w-4xl w-full text-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-6 flex flex-col max-h-[92vh]"
        id="work-package-detail-modal"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white px-6 py-5 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start space-x-3.5">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold uppercase tracking-wider">
                    {currentWp.category} Trade
                  </span>
                  {project && (
                    <span className="text-xs text-slate-300 font-medium flex items-center space-x-1">
                      <Building2 className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {project.project_name.split('—')[0]} ({project.project_number})
                      </span>
                    </span>
                  )}
                </div>
                <h1 className="text-lg sm:text-xl font-black text-white mt-1 uppercase tracking-tight">
                  {currentWp.name}
                </h1>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="p-2 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                title="Delete Work Package"
              >
                <Trash2 className="w-4 h-4" />
              </button>
              <button
                onClick={onClose}
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-800">
          {/* Key Attributes Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Contractor */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Contractor
                </span>
                <Wrench className="w-3.5 h-3.5 text-slate-400" />
              </div>
              {contractor ? (
                <div>
                  <h4 className="text-xs font-black text-slate-900 line-clamp-1">
                    {contractor.company_name}
                  </h4>
                  <p className="text-[11px] text-slate-600 font-medium mt-0.5">
                    {contractor.contact_person}
                  </p>
                  <div className="flex items-center space-x-1 text-[10px] text-slate-500 mt-1">
                    <Phone className="w-3 h-3 text-slate-400" />
                    <span>{contractor.phone}</span>
                  </div>
                  {onNavigateToContractor && (
                    <button
                      onClick={() => {
                        onClose();
                        onNavigateToContractor(contractor.id);
                      }}
                      className="mt-2 text-[10px] text-amber-700 hover:text-amber-800 font-bold underline flex items-center space-x-0.5 cursor-pointer"
                    >
                      <span>View Contractor Profile</span>
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>
              ) : (
                <span className="text-xs text-slate-500 italic">Unassigned</span>
              )}
            </div>

            {/* Project Manager */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Project Manager
                </span>
                <User className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div>
                <h4 className="text-xs font-black text-slate-900">
                  {pmUser ? pmUser.name : 'Marcus Lee'}
                </h4>
                <p className="text-[11px] text-slate-600 font-medium mt-0.5">
                  Project Manager (NW In-House)
                </p>
                <div className="flex items-center space-x-1 text-[10px] text-slate-500 mt-1">
                  <Mail className="w-3 h-3 text-slate-400" />
                  <span>{pmUser?.email || 'pm@nwbuilders.my'}</span>
                </div>
              </div>
            </div>

            {/* Schedule */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Schedule
                </span>
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-500">Start:</span>
                  <span className="font-semibold text-slate-900">{currentWp.start_date}</span>
                </div>
                <div className="flex justify-between text-xs font-mono">
                  <span className="text-slate-500">End:</span>
                  <span className="font-semibold text-slate-900">{currentWp.end_date}</span>
                </div>
                <div className="text-[10px] text-slate-400 pt-1 border-t border-slate-200">
                  Target completion within project window
                </div>
              </div>
            </div>

            {/* Progress & Status */}
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  Progress & Status
                </span>
                <Percent className="w-3.5 h-3.5 text-slate-400" />
              </div>
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-600">Completion</span>
                  <span className="font-mono font-bold text-slate-900">
                    {currentWp.progress_percent}%
                  </span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full rounded-full transition-all duration-300"
                    style={{ width: `${currentWp.progress_percent}%` }}
                  />
                </div>
                <div className="mt-2.5">
                  <span
                    className={`inline-block px-2.5 py-1 rounded-lg text-[10px] font-bold border ${getStatusBadge(
                      currentWp.status
                    )}`}
                  >
                    {currentWp.status}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Status & Progress Quick Adjuster */}
          <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Update Package Status & Progress
                </h4>
                <p className="text-[11px] text-slate-500">
                  Real-time status synchronizes across PM dashboard, Contractor portal, and client tracker.
                </p>
              </div>

              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-1.5">
                  <label className="text-[11px] font-bold text-slate-600">Status:</label>
                  <select
                    value={currentWp.status}
                    onChange={(e) => handleStatusChange(e.target.value as WorkPackageStatus)}
                    className="bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                  >
                    {ALL_STATUSES.map((st) => (
                      <option key={st} value={st}>
                        {st}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-1.5">
                  <label className="text-[11px] font-bold text-slate-600">Progress:</label>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={currentWp.progress_percent}
                    onChange={(e) => handleProgressChange(parseInt(e.target.value))}
                    className="w-24 accent-amber-500 cursor-pointer"
                  />
                  <span className="text-xs font-mono font-bold text-slate-900 w-9 text-right">
                    {currentWp.progress_percent}%
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Scope / Notes Section */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-slate-500" />
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Scope of Work & Technical Notes
                </h3>
              </div>
              {!isEditingScope && (
                <button
                  onClick={() => {
                    setScopeText(currentWp.scope || currentWp.notes || '');
                    setIsEditingScope(true);
                  }}
                  className="text-xs text-amber-700 hover:text-amber-800 font-semibold flex items-center space-x-1 cursor-pointer"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  <span>Edit Scope</span>
                </button>
              )}
            </div>

            {isEditingScope ? (
              <div className="space-y-2 pt-1">
                <textarea
                  rows={3}
                  value={scopeText}
                  onChange={(e) => setScopeText(e.target.value)}
                  placeholder="Detail the scope of work, technical specifications, and site limitations..."
                  className="w-full bg-white border border-slate-300 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
                <div className="flex justify-end space-x-2">
                  <button
                    onClick={() => setIsEditingScope(false)}
                    className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveScope}
                    className="px-4 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg shadow-xs"
                  >
                    Save Notes
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-700 leading-relaxed">
                {currentWp.scope || currentWp.notes || (
                  <span className="text-slate-400 italic">
                    No explicit scope or technical notes specified for this trade package yet. Click
                    &quot;Edit Scope&quot; to add specifications.
                  </span>
                )}
              </p>
            )}
          </div>

          {/* WORK ITEMS SECTION (Critical Requirement) */}
          <div className="space-y-4 pt-2">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-3">
              <div>
                <div className="flex items-center space-x-2">
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">
                    Work Items
                  </h3>
                  <span className="px-2 py-0.5 bg-slate-200 text-slate-800 text-xs font-bold rounded-full">
                    {packageItems.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Granular fabricated components and site joinery modules belonging to this work package.
                </p>
              </div>

              {/* + New Work Item Button (Critical Requirement) */}
              <button
                onClick={() => setShowNewWorkItemModal(true)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer transition-all self-start sm:self-auto hover:scale-[1.02] active:scale-[0.98]"
                id="btn-add-new-work-item"
              >
                <Plus className="w-4 h-4 text-slate-950" />
                <span>+ New Work Item</span>
              </button>
            </div>

            {/* Work Items Table / Cards */}
            {packageItems.length === 0 ? (
              <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-3">
                <Layers className="w-8 h-8 text-slate-400 mx-auto" />
                <div>
                  <h4 className="text-xs font-bold text-slate-800">
                    No work items added to this package yet
                  </h4>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-md mx-auto">
                    Start adding specific fabrication items, joinery pieces, or site installation items.
                  </p>
                </div>
                <button
                  onClick={() => setShowNewWorkItemModal(true)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs inline-flex items-center space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-950" />
                  <span>+ New Work Item</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3">
                {packageItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => {
                      setSelectedWorkItemId(item.id);
                      if (onSelectWorkItem) onSelectWorkItem(item);
                    }}
                    className="p-4 bg-white hover:bg-amber-50/20 border border-slate-200 hover:border-amber-300 rounded-2xl transition-all shadow-xs space-y-3 cursor-pointer"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2.5">
                        <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-lg">
                          {item.item_code}
                        </span>
                        <h4 className="text-xs font-bold text-slate-900">{item.description}</h4>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border uppercase ${
                            item.status === 'Completed'
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : item.status === 'Ready for QC'
                              ? 'bg-purple-50 text-purple-700 border-purple-200'
                              : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          {item.status}
                        </span>
                        <span className="text-[10px] text-slate-500 font-mono font-bold">
                          {item.progress_percent}%
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-600 pt-1">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">
                          Location
                        </span>
                        <span className="font-medium text-slate-800 truncate block">
                          {item.location}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">
                          Qty & Unit
                        </span>
                        <span className="font-medium text-slate-800">
                          {item.quantity} {item.unit}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">
                          Dimensions
                        </span>
                        <span className="font-mono text-slate-800 text-[10px] truncate block">
                          {item.dimensions || 'Per site measure'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">
                          Target Date
                        </span>
                        <span className="font-mono text-slate-800">{item.required_date}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-500">
            Package ID: <span className="font-mono text-slate-700">{currentWp.id}</span>
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* New Work Item Modal */}
      <NewWorkItemModal
        isOpen={showNewWorkItemModal}
        onClose={() => setShowNewWorkItemModal(false)}
        workPackage={currentWp}
        onSuccess={(_item, msg) => showToast(msg)}
      />

      {/* Work Item Detail Modal */}
      <WorkItemDetailModal
        isOpen={!!selectedWorkItemId}
        onClose={() => setSelectedWorkItemId(null)}
        workItemId={selectedWorkItemId}
      />

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 z-70">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-sm w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900">Delete Work Package?</h3>
            <p className="text-xs text-slate-600">
              Are you sure you want to delete{' '}
              <strong className="text-slate-900">{currentWp.name}</strong>? This action cannot be
              undone.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
