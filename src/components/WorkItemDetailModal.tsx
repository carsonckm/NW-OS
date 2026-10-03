/**
 * NW OS — Work Item Detail Modal & Operations Hub
 * Comprehensive deliverable management with tabs for:
 * 1. Overview (specs, dimensions, materials, finish, contractor, status, progress)
 * 2. Drawing (specific linked drawing revision, revision history, drawing notes)
 * 3. Production (Production Order, Parts, CNC readiness, production stages)
 * 4. QC (QC status, inspection history, QC photos, comments)
 * 5. Delivery (scheduled date/time, delivery confirmation, status)
 * 6. Installation (site installation status, dates, installation QC)
 * 7. Issues (linked issues and "+ Report Problem" action)
 * 8. Activity (chronological audit history)
 * 9. Photos (photo upload with uploaded_by, date/time, description)
 * Enforces role-based permissions for Contractors vs Project Managers/Owners.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import {
  WorkItem,
  WorkItemStatus,
  ProductionStatus,
  DeliveryStatus,
  InstallationStatus,
  WorkItemPhotoRecord,
} from '../types';
import {
  X,
  Package,
  Layers,
  MapPin,
  Calendar,
  Ruler,
  FileText,
  User,
  Percent,
  CheckCircle2,
  Clock,
  Truck,
  Wrench,
  AlertTriangle,
  History,
  Camera,
  Upload,
  Eye,
  ShieldCheck,
  ChevronRight,
  Plus,
  AlertCircle,
  Cpu,
  Boxes,
  Lock,
} from 'lucide-react';

interface WorkItemDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  workItemId: string | null;
  onOpenQCModal?: (item: WorkItem) => void;
  onOpenDeliveryModal?: (item: WorkItem) => void;
  onOpenIssueModal?: (itemId: string) => void;
  onNavigateToDrawing?: (drawingId: string) => void;
}

type TabKey =
  | 'overview'
  | 'drawing'
  | 'production'
  | 'qc'
  | 'delivery'
  | 'installation'
  | 'issues'
  | 'activity'
  | 'photos';

const ALL_WORK_ITEM_STATUSES: WorkItemStatus[] = [
  'Draft',
  'Assigned',
  'Contractor Confirmed',
  'In Progress',
  'Ready for QC',
  'QC Failed',
  'QC Passed',
  'Ready for Delivery',
  'Delivered',
  'Installation In Progress',
  'Installation QC',
  'Completed',
  'On Hold',
  'Blocked',
  'Cancelled',
];

export const WorkItemDetailModal: React.FC<WorkItemDetailModalProps> = ({
  isOpen,
  onClose,
  workItemId,
  onOpenQCModal,
  onOpenDeliveryModal,
  onOpenIssueModal,
  onNavigateToDrawing,
}) => {
  const {
    workItems,
    workPackages,
    projects,
    contractors,
    drawings,
    qcRecords,
    issues,
    auditLogs,
    currentUser,
    updateWorkItem,
    addWorkItemPhoto,
  } = useNW();

  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  // Quick edit states
  const [editingStatus, setEditingStatus] = useState<WorkItemStatus | ''>('');
  const [editingProgress, setEditingProgress] = useState<number | ''>('');
  const [editingDimensions, setEditingDimensions] = useState('');
  const [editingMaterial, setEditingMaterial] = useState('');
  const [editingFinish, setEditingFinish] = useState('');
  const [isEditingSpecs, setIsEditingSpecs] = useState(false);

  // Delivery form state (for contractor/PM)
  const [deliveryDate, setDeliveryDate] = useState('');
  const [deliveryTime, setDeliveryTime] = useState('');
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>('Scheduled');

  // Photo upload form state
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoDescription, setPhotoDescription] = useState('');
  const [photoAuthor, setPhotoAuthor] = useState('');
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState<string | null>(null);

  if (!isOpen || !workItemId) return null;

  const currentItem = workItems.find((w) => w.id === workItemId);
  if (!currentItem) return null;

  const project = projects.find((p) => p.id === currentItem.project_id);
  const workPackage = workPackages.find((wp) => wp.id === currentItem.work_package_id);
  const contractor = contractors.find((c) => c.id === currentItem.contractor_id);
  const drawing = drawings.find((d) => d.id === currentItem.drawing_id);
  const itemQCRecords = qcRecords.filter((qc) => qc.work_item_id === currentItem.id);
  const itemIssues = issues.filter((i) => i.work_item_id === currentItem.id);
  const itemLogs = auditLogs.filter(
    (log) =>
      log.object_id === currentItem.id ||
      log.object_id?.includes(currentItem.item_code) ||
      log.entity_id === currentItem.id ||
      (log.details != null && (log.details.includes(currentItem.item_code) || log.details.includes(currentItem.description))) ||
      (log.new_value != null && (log.new_value.includes(currentItem.item_code) || log.new_value.includes(currentItem.description))) ||
      (log.old_value != null && (log.old_value.includes(currentItem.item_code) || log.old_value.includes(currentItem.description)))
  );

  // Contractor permission logic per requirements:
  // "Contractors can view and update only Work Items assigned to them.
  // They can: View approved information, Update progress, Upload photos,
  // Mark work complete, Report problems, Enter delivery information.
  // They cannot: Change approved dimensions, Change drawings, Change project contract value,
  // See internal costs, Approve variations."
  const isContractor = currentUser.role === 'Contractor';
  const canEditDimensions = !isContractor;
  const canChangeDrawing = !isContractor;

  // Handle Progress update
  const handleProgressChange = (newProgress: number) => {
    updateWorkItem(currentItem.id, {
      progress_percent: newProgress,
      // Auto-advance status when complete
      status:
        newProgress === 100 && currentItem.status === 'In Progress'
          ? 'Ready for QC'
          : currentItem.status,
    });
  };

  // Handle Status update
  const handleStatusChange = (newStatus: WorkItemStatus) => {
    updateWorkItem(currentItem.id, {
      status: newStatus,
      progress_percent:
        newStatus === 'Completed' ? 100 : currentItem.progress_percent,
    });
  };

  // Handle Delivery Info Save (accessible to Contractors & PMs)
  const handleSaveDeliveryInfo = (e: React.FormEvent) => {
    e.preventDefault();
    updateWorkItem(currentItem.id, {
      scheduled_delivery_date: deliveryDate || currentItem.scheduled_delivery_date,
      scheduled_delivery_time: deliveryTime || currentItem.scheduled_delivery_time,
      delivery_status: deliveryStatus,
    });
    setUploadSuccessMsg('Delivery information saved.');
    setTimeout(() => setUploadSuccessMsg(null), 3000);
  };

  // Handle Photo Upload
  const handlePhotoUpload = (e: React.FormEvent) => {
    e.preventDefault();
    if (!photoUrl.trim()) return;

    addWorkItemPhoto(currentItem.id, {
      url: photoUrl.trim(),
      description: photoDescription.trim() || undefined,
      uploaded_by: photoAuthor.trim() || `${currentUser.name} (${currentUser.role})`,
    });

    setPhotoUrl('');
    setPhotoDescription('');
    setIsUploadingPhoto(false);
    setUploadSuccessMsg('Photo uploaded and recorded successfully.');
    setTimeout(() => setUploadSuccessMsg(null), 3500);
  };

  // Handle Specs update (for PMs/Owners only)
  const handleSaveSpecs = () => {
    if (!canEditDimensions) return;
    updateWorkItem(currentItem.id, {
      dimensions: editingDimensions || currentItem.dimensions,
      material: editingMaterial || currentItem.material,
      finish: editingFinish || currentItem.finish,
    });
    setIsEditingSpecs(false);
    setUploadSuccessMsg('Specifications updated successfully.');
    setTimeout(() => setUploadSuccessMsg(null), 3000);
  };

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
      case 'Delivered':
        return 'bg-cyan-50 text-cyan-800 border-cyan-300';
      case 'Installation In Progress':
        return 'bg-indigo-50 text-indigo-800 border-indigo-200';
      case 'Installation QC':
        return 'bg-violet-50 text-violet-800 border-violet-200';
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
      <div
        className="bg-white border border-slate-200 rounded-3xl max-w-4xl w-full text-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-6 max-h-[92vh] flex flex-col"
        id="work-item-detail-modal"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white px-6 py-5 flex items-start justify-between shrink-0">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-bold text-amber-400 bg-amber-500/20 border border-amber-400/30 px-2.5 py-0.5 rounded-lg">
                {currentItem.item_code}
              </span>
              <span
                className={`text-[10px] font-bold px-2.5 py-0.5 rounded-md border uppercase ${getStatusBadge(
                  currentItem.status
                )}`}
              >
                {currentItem.status}
              </span>
              {project && (
                <span className="text-xs text-slate-400 font-medium">
                  {project.project_name.split('—')[0]}
                </span>
              )}
            </div>

            <h2 className="text-lg sm:text-xl font-black text-white tracking-tight">
              {currentItem.description}
            </h2>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 pt-0.5">
              <span>Package: <strong className="text-amber-300">{workPackage?.name}</strong></span>
              <span>•</span>
              <span>Contractor: <strong className="text-slate-100">{contractor?.company_name || 'Unassigned'}</strong></span>
              <span>•</span>
              <span>Qty: <strong className="text-white font-mono">{currentItem.quantity} {currentItem.unit}</strong></span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700/50 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Action Banner & Alerts */}
        {uploadSuccessMsg && (
          <div className="bg-emerald-600 text-white px-6 py-2 text-xs font-bold flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-200" />
            <span>{uploadSuccessMsg}</span>
          </div>
        )}

        {/* Quick Progress & Status Bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center space-x-3">
            <span className="text-xs font-bold text-slate-600">Progress:</span>
            <div className="flex items-center space-x-2">
              <input
                type="range"
                min="0"
                max="100"
                step="5"
                value={currentItem.progress_percent}
                onChange={(e) => handleProgressChange(parseInt(e.target.value))}
                className="w-32 accent-amber-500 cursor-pointer"
                id="quick-progress-slider"
              />
              <span className="font-mono text-xs font-black text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded-md">
                {currentItem.progress_percent}%
              </span>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-600">Status:</span>
            <select
              value={currentItem.status}
              onChange={(e) => handleStatusChange(e.target.value as WorkItemStatus)}
              className="bg-white border border-slate-300 rounded-xl px-2.5 py-1 text-xs font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
              id="quick-status-select"
            >
              {ALL_WORK_ITEM_STATUSES.map((st) => (
                <option key={st} value={st}>
                  {st}
                </option>
              ))}
            </select>

            {/* Quick action button for contractor or PM */}
            {currentItem.status === 'In Progress' && (
              <button
                onClick={() => handleStatusChange('Ready for QC')}
                className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                Mark Ready for QC
              </button>
            )}

            {currentItem.status === 'Ready for QC' && onOpenQCModal && (
              <button
                onClick={() => onOpenQCModal(currentItem)}
                className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center space-x-1"
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Perform QC</span>
              </button>
            )}
          </div>
        </div>

        {/* Navigation Tabs (8 detailed sections) */}
        <div className="bg-white border-b border-slate-200 px-6 flex items-center space-x-1 overflow-x-auto shrink-0 scrollbar-none">
          {[
            { id: 'overview', label: 'Overview', icon: Package },
            { id: 'drawing', label: 'Drawing & Rev', icon: FileText },
            { id: 'production', label: 'Production', icon: Cpu },
            { id: 'qc', label: `QC (${itemQCRecords.length})`, icon: ShieldCheck },
            { id: 'delivery', label: 'Delivery', icon: Truck },
            { id: 'installation', label: 'Installation', icon: Wrench },
            { id: 'issues', label: `Issues (${itemIssues.length})`, icon: AlertTriangle },
            { id: 'activity', label: 'Activity', icon: History },
            {
              id: 'photos',
              label: `Photos (${(currentItem.item_photos?.length || 0) + (currentItem.photos?.length || 0)})`,
              icon: Camera,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabKey)}
                className={`py-3 px-3 text-xs font-bold border-b-2 flex items-center space-x-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? 'border-amber-500 text-amber-800 bg-amber-50/40'
                    : 'border-transparent text-slate-500 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-amber-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Body Contents */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Dimensions & Specifications */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Ruler className="w-4 h-4 text-amber-600" />
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider">
                      Technical Specifications & Dimensions
                    </h3>
                  </div>

                  {canEditDimensions && !isEditingSpecs ? (
                    <button
                      onClick={() => {
                        setEditingDimensions(currentItem.dimensions);
                        setEditingMaterial(currentItem.material);
                        setEditingFinish(currentItem.finish);
                        setIsEditingSpecs(true);
                      }}
                      className="text-xs font-bold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                    >
                      Edit Specs
                    </button>
                  ) : isContractor ? (
                    <span className="text-[10px] text-slate-500 flex items-center space-x-1">
                      <Lock className="w-3 h-3 text-slate-400" />
                      <span>Approved Specs (Read Only for Contractor)</span>
                    </span>
                  ) : null}
                </div>

                {isEditingSpecs ? (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block">
                        Dimensions
                      </label>
                      <input
                        type="text"
                        value={editingDimensions}
                        onChange={(e) => setEditingDimensions(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs font-mono"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block">
                        Material
                      </label>
                      <input
                        type="text"
                        value={editingMaterial}
                        onChange={(e) => setEditingMaterial(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block">
                        Finish
                      </label>
                      <input
                        type="text"
                        value={editingFinish}
                        onChange={(e) => setEditingFinish(e.target.value)}
                        className="w-full bg-white border border-slate-300 rounded-xl px-3 py-1.5 text-xs"
                      />
                    </div>
                    <div className="sm:col-span-3 flex justify-end space-x-2 pt-2">
                      <button
                        onClick={() => setIsEditingSpecs(false)}
                        className="px-3 py-1 text-xs text-slate-600 hover:bg-slate-200 rounded-lg"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveSpecs}
                        className="px-4 py-1 text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg"
                      >
                        Save Specifications
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Dimensions
                      </span>
                      <span className="font-mono font-bold text-slate-900 text-sm block">
                        {currentItem.dimensions || 'Per site measurement'}
                      </span>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Core Material
                      </span>
                      <span className="font-bold text-slate-900 text-sm block">
                        {currentItem.material || 'Specified in BOQ'}
                      </span>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl border border-slate-200 space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Surface Finish
                      </span>
                      <span className="font-bold text-slate-900 text-sm block">
                        {currentItem.finish || 'Factory Standard'}
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Progress & Milestone Overview */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Execution Progress Breakdown
                  </span>

                  <div className="space-y-3 text-xs">
                    <div>
                      <div className="flex justify-between font-bold mb-1">
                        <span className="text-slate-600">Production Stage</span>
                        <span className="font-mono text-amber-800">
                          {currentItem.progress_percent}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all"
                          style={{ width: `${currentItem.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex justify-between font-bold mb-1">
                        <span className="text-slate-600">Overall Deliverable</span>
                        <span className="font-mono text-emerald-800">
                          {currentItem.status === 'Completed'
                            ? '100%'
                            : `${currentItem.progress_percent}%`}
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-emerald-500 h-full rounded-full transition-all"
                          style={{
                            width: `${
                              currentItem.status === 'Completed'
                                ? 100
                                : currentItem.progress_percent
                            }%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 text-xs">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Schedule & Location
                  </span>

                  <div className="space-y-2 pt-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Site Location:</span>
                      <strong className="text-slate-900">{currentItem.location}</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Required Date:</span>
                      <strong className="text-slate-900 font-mono">
                        {currentItem.required_date || 'TBD'}
                      </strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Assigned Trade:</span>
                      <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-900 font-bold text-[10px]">
                        {workPackage?.category || 'Carpentry'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Notes */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-1 text-xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Technical Notes & Scope Details
                </span>
                <p className="text-slate-700 leading-relaxed pt-1">
                  {currentItem.notes || 'No specific technical notes provided for this work item.'}
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: DRAWING & EXACT REVISION */}
          {activeTab === 'drawing' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="flex items-center space-x-2">
                    <FileText className="w-5 h-5 text-amber-600" />
                    <div>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                        Linked Construction Drawing & Revision
                      </h3>
                      <p className="text-xs text-slate-500">
                        Work Items are pinned to an exact drawing revision to prevent fabrication errors.
                      </p>
                    </div>
                  </div>

                  {drawing && onNavigateToDrawing && (
                    <button
                      onClick={() => {
                        onClose();
                        onNavigateToDrawing(drawing.id);
                      }}
                      className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 cursor-pointer"
                    >
                      <span>Open in Drawing Viewer</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                {drawing ? (
                  <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-mono font-bold bg-amber-50 text-amber-800 border border-amber-300 px-2 py-0.5 rounded">
                            {drawing.drawing_number}
                          </span>
                          <span className="text-xs font-bold text-slate-900">{drawing.title}</span>
                        </div>
                        <span className="text-[11px] text-slate-500 mt-0.5 block">
                          Category: {drawing.category}
                        </span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <span className="text-[11px] text-slate-500">Bound Revision:</span>
                        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-300 font-mono font-bold text-xs">
                          {currentItem.drawing_revision || 'Rev 1'}
                        </span>
                      </div>
                    </div>

                    {/* Revision History for this drawing */}
                    <div className="space-y-2">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        Drawing Revision History ({drawing.revisions.length} Revisions)
                      </span>
                      <div className="space-y-1.5">
                        {drawing.revisions.map((rev) => {
                          const isBound = rev.revision_code === currentItem.drawing_revision;
                          return (
                            <div
                              key={rev.id}
                              className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                                isBound
                                  ? 'bg-amber-50/50 border-amber-400 font-medium'
                                  : 'bg-slate-50 border-slate-200'
                              }`}
                            >
                              <div className="flex items-center space-x-2">
                                <span className="font-mono font-bold">{rev.revision_code}</span>
                                <span
                                  className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${
                                    rev.approved_status === 'Approved'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : 'bg-slate-200 text-slate-700'
                                  }`}
                                >
                                  {rev.approved_status}
                                </span>
                                {isBound && (
                                  <span className="text-[10px] text-amber-800 font-bold bg-amber-200 px-1.5 py-0.5 rounded">
                                    USED FOR THIS ITEM
                                  </span>
                                )}
                              </div>

                              <span className="text-slate-500 text-[11px]">{rev.notes}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="p-6 text-center bg-white rounded-2xl border border-dashed border-slate-300">
                    <p className="text-xs text-slate-500">No specific drawing assigned yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: PRODUCTION & CNC READINESS */}
          {activeTab === 'production' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center space-x-3">
                  <Cpu className="w-5 h-5 text-amber-600" />
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      Production & Manufacturing Order
                    </h3>
                    <p className="text-xs text-slate-500">
                      Standardized manufacturing stage tracking connecting CAD drawings to workshop CNC tooling.
                    </p>
                  </div>
                </div>

                {/* Production Stage Pipeline */}
                <div className="space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    Manufacturing Stages
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      'Material Required',
                      'Material Ready',
                      'Cutting',
                      'CNC',
                      'Edge Banding',
                      'Assembly',
                      'Finishing',
                      'Ready for Delivery',
                    ].map((stage, idx) => {
                      const isReached =
                        currentItem.progress_percent >= (idx + 1) * 12.5 ||
                        currentItem.production_status === stage;
                      return (
                        <div
                          key={stage}
                          className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-between ${
                            isReached
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-900'
                              : 'bg-white border-slate-200 text-slate-400'
                          }`}
                        >
                          <span>{stage}</span>
                          {isReached ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-slate-300" />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Parts Breakdown Preview */}
                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 flex items-center space-x-1.5">
                      <Boxes className="w-4 h-4 text-amber-600" />
                      <span>Component Parts (NW Production Method Preview)</span>
                    </span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      PO: {currentItem.production_order_id || 'PO-AUTO-409'}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 divide-y divide-slate-100">
                    <div className="py-2 flex justify-between">
                      <span>1. Top Countertop (Laminated Plywood)</span>
                      <span className="font-mono text-slate-800">1 pc • 2400 × 900 mm</span>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>2. Front Fascia Panel with LED Recess</span>
                      <span className="font-mono text-slate-800">1 pc • 2400 × 1050 mm</span>
                    </div>
                    <div className="py-2 flex justify-between">
                      <span>3. Internal Cashier Drawers (Soft-Close)</span>
                      <span className="font-mono text-slate-800">3 sets • 450 × 400 mm</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: QUALITY CONTROL (QC) */}
          {activeTab === 'qc' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <ShieldCheck className="w-5 h-5 text-emerald-600" />
                    <div>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                        Quality Control Inspections
                      </h3>
                      <p className="text-xs text-slate-500">
                        Factory and site QC gates before delivery and handover.
                      </p>
                    </div>
                  </div>

                  {onOpenQCModal && (
                    <button
                      onClick={() => onOpenQCModal(currentItem)}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ New QC Inspection</span>
                    </button>
                  )}
                </div>

                {itemQCRecords.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-300 space-y-2">
                    <ShieldCheck className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs text-slate-600 font-bold">No QC inspection logged yet</p>
                    <p className="text-xs text-slate-400">
                      When fabrication reaches &quot;Ready for QC&quot;, an inspector will record dimensional tolerances and finish checks.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {itemQCRecords.map((qc) => (
                      <div
                        key={qc.id}
                        className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`px-2.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                qc.result === 'Passed'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {qc.result}
                            </span>
                            <span className="text-xs font-bold text-slate-900">
                              Inspector: {qc.inspector_name} ({qc.inspector_role})
                            </span>
                          </div>
                          <span className="text-xs font-mono text-slate-500">
                            {qc.inspection_date}
                          </span>
                        </div>

                        <p className="text-xs text-slate-700">{qc.comments}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 5: DELIVERY */}
          {activeTab === 'delivery' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center space-x-3">
                  <Truck className="w-5 h-5 text-sky-600" />
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      Logistics & Site Delivery
                    </h3>
                    <p className="text-xs text-slate-500">
                      Coordinate transport from carpentry workshop to site.
                    </p>
                  </div>
                </div>

                {/* Delivery Form for Contractor / PM */}
                <form onSubmit={handleSaveDeliveryInfo} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-4">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Enter / Update Delivery Schedule
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                        Delivery Date
                      </label>
                      <input
                        type="date"
                        defaultValue={currentItem.scheduled_delivery_date || ''}
                        onChange={(e) => setDeliveryDate(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                        Delivery Time
                      </label>
                      <input
                        type="time"
                        defaultValue={currentItem.scheduled_delivery_time || '10:00'}
                        onChange={(e) => setDeliveryTime(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                        Delivery Status
                      </label>
                      <select
                        defaultValue={currentItem.delivery_status || 'Scheduled'}
                        onChange={(e) => setDeliveryStatus(e.target.value as DeliveryStatus)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs cursor-pointer"
                      >
                        <option value="Not Scheduled">Not Scheduled</option>
                        <option value="Scheduled">Scheduled</option>
                        <option value="Loading">Loading at Workshop</option>
                        <option value="In Transit">In Transit</option>
                        <option value="Delivered">Delivered to Site</option>
                        <option value="Received / Confirmed">Received / Confirmed</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold cursor-pointer transition-all"
                    >
                      Save Delivery Information
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 6: INSTALLATION */}
          {activeTab === 'installation' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center space-x-3">
                  <Wrench className="w-5 h-5 text-amber-600" />
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      On-Site Installation
                    </h3>
                    <p className="text-xs text-slate-500">
                      Carpentry mounting, MEP coordination, and site installation sign-off.
                    </p>
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">Installation Status:</span>
                    <span className="font-bold text-slate-900 bg-slate-100 px-2.5 py-1 rounded-lg">
                      {currentItem.installation_status || 'Not Started'}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-600">Site Location:</span>
                    <strong className="text-slate-900">{currentItem.location}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: ISSUES */}
          {activeTab === 'issues' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600" />
                    <div>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                        Reported Site & Manufacturing Issues
                      </h3>
                      <p className="text-xs text-slate-500">
                        Discrepancies, site obstructions, or material defects linked to this item.
                      </p>
                    </div>
                  </div>

                  {onOpenIssueModal && (
                    <button
                      onClick={() => onOpenIssueModal(currentItem.id)}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Report Problem</span>
                    </button>
                  )}
                </div>

                {itemIssues.length === 0 ? (
                  <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-300 space-y-2">
                    <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                    <p className="text-xs text-slate-700 font-bold">Zero active issues detected</p>
                    <p className="text-xs text-slate-400">
                      Work item is proceeding according to approved drawing specifications and schedule.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {itemIssues.map((issue) => (
                      <div
                        key={issue.id}
                        className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900">{issue.title}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900">
                            {issue.priority} Priority
                          </span>
                        </div>
                        <p className="text-slate-600">{issue.description}</p>
                        <div className="text-[11px] text-slate-400">
                          Reported by: {issue.reported_by} • Escalation: {issue.escalation_level}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 8: ACTIVITY LOGS */}
          {activeTab === 'activity' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex items-center space-x-3">
                  <History className="w-5 h-5 text-amber-600" />
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      Chronological Activity Log
                    </h3>
                    <p className="text-xs text-slate-500">
                      Immutable audit history of creation, revisions, and status updates.
                    </p>
                  </div>
                </div>

                {itemLogs.length === 0 ? (
                  <div className="p-6 text-center bg-white rounded-2xl border border-dashed border-slate-300 text-xs text-slate-500">
                    No explicit audit records logged yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {itemLogs.map((log) => (
                      <div
                        key={log.id}
                        className="p-3 bg-white border border-slate-200 rounded-xl text-xs flex items-center justify-between"
                      >
                        <div>
                          <span className="font-bold text-slate-900 block">{log.action}</span>
                          <span className="text-[11px] text-slate-500">
                            {log.details || log.new_value || (log.old_value ? `Changed from: ${log.old_value}` : `${log.object_type} ${log.object_id}`)}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-slate-400">
                          {log.timestamp ? new Date(log.timestamp).toLocaleDateString() : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 9: PHOTOS (Mandated Upload with uploaded_by, date/time, description) */}
          {activeTab === 'photos' && (
            <div className="space-y-6">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center space-x-3">
                    <Camera className="w-5 h-5 text-amber-600" />
                    <div>
                      <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                        Fabrication & Site Photos
                      </h3>
                      <p className="text-xs text-slate-500">
                        Upload production progress photos, joinery mock-ups, and site delivery records.
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setIsUploadingPhoto(!isUploadingPhoto)}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer"
                    id="btn-add-photo"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>{isUploadingPhoto ? 'Close Upload' : '+ Upload Photo'}</span>
                  </button>
                </div>

                {/* Upload Photo Form */}
                {isUploadingPhoto && (
                  <form
                    onSubmit={handlePhotoUpload}
                    className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3 text-xs"
                    id="photo-upload-form"
                  >
                    <h4 className="font-bold text-slate-900 uppercase text-[11px]">
                      Upload New Photo Record
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                          Photo Image URL <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="url"
                          required
                          value={photoUrl}
                          onChange={(e) => setPhotoUrl(e.target.value)}
                          placeholder="https://images.unsplash.com/..."
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                        />
                      </div>

                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                          Uploaded By
                        </label>
                        <input
                          type="text"
                          value={photoAuthor}
                          onChange={(e) => setPhotoAuthor(e.target.value)}
                          placeholder={`${currentUser.name} (${currentUser.role})`}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase block mb-1">
                        Description (Optional)
                      </label>
                      <input
                        type="text"
                        value={photoDescription}
                        onChange={(e) => setPhotoDescription(e.target.value)}
                        placeholder="e.g. Workshop dry-fit completed with laminate edge-banding verified."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                      />
                    </div>

                    <div className="flex justify-end space-x-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setIsUploadingPhoto(false)}
                        className="px-3 py-1.5 rounded-lg border text-slate-600 text-xs"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-lg text-xs"
                      >
                        Save Photo Record
                      </button>
                    </div>
                  </form>
                )}

                {/* Photo Gallery with metadata */}
                {(!currentItem.item_photos || currentItem.item_photos.length === 0) &&
                (!currentItem.photos || currentItem.photos.length === 0) ? (
                  <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-300 space-y-2">
                    <Camera className="w-8 h-8 text-slate-400 mx-auto" />
                    <p className="text-xs text-slate-600 font-bold">No photos recorded yet</p>
                    <p className="text-xs text-slate-400">
                      Contractors and site supervisors can take photos of joinery, dimensions, or packaging.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {/* Render detailed photo records first */}
                    {currentItem.item_photos?.map((photo) => (
                      <div
                        key={photo.id}
                        className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs space-y-2"
                      >
                        <div className="h-44 bg-slate-100 relative group overflow-hidden">
                          <img
                            src={photo.url}
                            alt={photo.description || 'Work item photo'}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <div className="p-3 space-y-1 text-xs">
                          {photo.description && (
                            <p className="font-bold text-slate-900 line-clamp-2">
                              {photo.description}
                            </p>
                          )}
                          <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                            <span className="font-medium text-amber-800">
                              By: {photo.uploaded_by}
                            </span>
                            <span className="font-mono">
                              {new Date(photo.date_time).toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Backward-compatible photos array if any */}
                    {currentItem.photos?.map((url, idx) => (
                      <div
                        key={idx}
                        className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs space-y-2"
                      >
                        <div className="h-44 bg-slate-100 relative group overflow-hidden">
                          <img
                            src={url}
                            alt={`Photo ${idx + 1}`}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                        </div>
                        <div className="p-3 text-[10px] text-slate-500">
                          Workshop Record #{idx + 1}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
