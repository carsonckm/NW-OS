/**
 * NW OS — Production Staff Dashboard (Section 9)
 * Shop-floor joinery craftsman & CNC operator interface.
 * Clean, tactile, focused strictly on assigned work items, dimensions,
 * stage check-ins, and defect reporting.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem, ProductionStatus } from '../types';
import {
  Wrench,
  QrCode,
  Camera,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Search,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  ArrowRight,
  Upload,
  X,
} from 'lucide-react';

export const ProductionStaffDashboard: React.FC = () => {
  const {
    currentUser,
    workItems,
    updateWorkItemStatus,
    addWorkItemPhoto,
    createIssue,
    qcRecords,
  } = useNW();

  const [searchCode, setSearchCode] = useState('');
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);

  // Photo upload simulation
  const [showPhotoModal, setShowPhotoModal] = useState(false);
  const [photoDesc, setPhotoDesc] = useState('');

  // Report problem modal
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [issueTitle, setIssueTitle] = useState('');
  const [issueDesc, setIssueDesc] = useState('');

  // Filter items assigned to staff or current workshop queue
  const assignedItems = workItems.filter((item) => {
    if (currentUser.assigned_project_ids && currentUser.assigned_project_ids.length > 0) {
      if (!currentUser.assigned_project_ids.includes(item.project_id)) return false;
    }
    if (searchCode.trim()) {
      const q = searchCode.toLowerCase();
      return (
        item.item_code.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        (item.material || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const activeWorkItem = selectedItem || assignedItems[0] || workItems[0];
  // Latest QC result for the active item (WorkItem itself carries no QC status field)
  const activeQCResult = activeWorkItem
    ? qcRecords
        .filter((q) => q.work_item_id === activeWorkItem.id)
        .sort((a, b) => b.inspection_date.localeCompare(a.inspection_date))[0]?.result
    : undefined;

  const handleAdvanceStage = (nextStage: 'Cutting' | 'Assembly' | 'Ready for QC') => {
    if (!activeWorkItem) return;
    if (nextStage === 'Ready for QC') {
      updateWorkItemStatus(activeWorkItem.id, 'Ready for QC', 'Factory production completed. Submitted for QC.');
    } else {
      updateWorkItemStatus(
        activeWorkItem.id,
        nextStage === 'Cutting' ? 'In Progress' : 'In Progress',
        `Production stage moved to ${nextStage}`
      );
    }
  };

  const handleUploadPhoto = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkItem) return;

    addWorkItemPhoto(activeWorkItem.id, {
      url: 'https://images.unsplash.com/photo-1581092160607-ee22621dd758?w=800&auto=format&fit=crop&q=80',
      description: photoDesc || 'Factory shop floor assembly inspection photo',
      uploaded_by: currentUser.name,
    });

    setShowPhotoModal(false);
    setPhotoDesc('');
  };

  const handleReportProblem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeWorkItem || !issueTitle.trim()) return;

    await createIssue({
      project_id: activeWorkItem.project_id,
      title: issueTitle,
      description: issueDesc,
      work_item_id: activeWorkItem.id,
      category: 'Production',
      priority: 'Medium',
      status: 'Reported',
      action_required: 'Factory supervisor assistance required',
    });

    setShowIssueModal(false);
    setIssueTitle('');
    setIssueDesc('');
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Top Mobile-Friendly Header */}
      <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded bg-amber-500 text-slate-950">
            Factory Floor Terminal
          </span>
          <h1 className="text-lg font-black mt-1 flex items-center space-x-2">
            <span>{currentUser.name}</span>
            <span className="text-xs font-semibold text-slate-400">({currentUser.title || 'Senior Craftsman'})</span>
          </h1>
          <p className="text-xs text-slate-300 mt-0.5">
            CNC cutting, joinery assembly, and quality stage check-ins
          </p>
        </div>

        {/* Barcode Quick Search */}
        <div className="relative w-full sm:w-64">
          <QrCode className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            placeholder="Scan barcode / search item code..."
            value={searchCode}
            onChange={(e) => setSearchCode(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500"
          />
        </div>
      </div>

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Assigned Work Item Queue */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 px-1">
            <span>Assigned Production Queue ({assignedItems.length})</span>
            <span className="text-slate-400 font-normal">Tap to inspect</span>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
            {assignedItems.map((item) => {
              const isSelected = activeWorkItem?.id === item.id;
              return (
                <div
                  key={item.id}
                  onClick={() => setSelectedItem(item)}
                  className={`p-4 rounded-2xl border cursor-pointer transition-all ${
                    isSelected
                      ? 'bg-amber-50 border-amber-400 shadow-xs ring-1 ring-amber-400'
                      : 'bg-white border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-black text-slate-900">{item.item_code}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
                      {item.production_status}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900 mt-1 line-clamp-1">{item.description}</h4>
                  <div className="text-[11px] text-slate-500 mt-1">
                    Dimensions: <strong className="text-slate-700 font-semibold">{item.dimensions}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Active Piece Inspection & Shop-Floor Actions */}
        {activeWorkItem && (
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-5">
              {/* Item Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-sm font-black px-2.5 py-0.5 rounded bg-slate-900 text-white">
                      {activeWorkItem.item_code}
                    </span>
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                      Stage: {activeWorkItem.production_status}
                    </span>
                  </div>
                  <h2 className="text-base font-black text-slate-900 mt-2">{activeWorkItem.description}</h2>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setShowPhotoModal(true)}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold border border-slate-200 transition-colors"
                  >
                    <Camera className="w-3.5 h-3.5 text-slate-600" />
                    <span>Upload Photo</span>
                  </button>
                  <button
                    onClick={() => setShowIssueModal(true)}
                    className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-800 text-xs font-bold border border-rose-200 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                    <span>Report Problem</span>
                  </button>
                </div>
              </div>

              {/* Technical Fabrication Specifications */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs">
                <div className="space-y-2">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase">Cut Dimensions</span>
                    <strong className="text-sm font-black font-mono text-slate-900">{activeWorkItem.dimensions}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase">Material & Substrate</span>
                    <span className="font-semibold text-slate-800">{[activeWorkItem.material, activeWorkItem.finish].filter(Boolean).join(' / ')}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase">Drawing Reference</span>
                    <span className="font-mono font-bold text-slate-800">{activeWorkItem.drawing_revision || 'DWG-001 (Rev B)'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase">QC Inspection Status</span>
                    <span className={`font-bold ${activeQCResult === 'Passed' ? 'text-emerald-700' : 'text-amber-700'}`}>
                      {activeQCResult || 'Not Inspected'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Shop Floor Stage Progression Controls */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-bold text-slate-700 block">Progress Production Stage:</span>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => handleAdvanceStage('Cutting')}
                    className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold border border-slate-300 transition-colors text-center"
                  >
                    1. Cutting & Sizing
                  </button>

                  <button
                    onClick={() => handleAdvanceStage('Assembly')}
                    className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold border border-slate-300 transition-colors text-center"
                  >
                    2. Joinery Assembly
                  </button>

                  <button
                    onClick={() => handleAdvanceStage('Ready for QC')}
                    className="py-2.5 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors text-center shadow-xs flex items-center justify-center space-x-1"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>3. Submit for QC</span>
                  </button>
                </div>
              </div>

              {/* Existing Workshop Photos */}
              {activeWorkItem.item_photos && activeWorkItem.item_photos.length > 0 && (
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <span className="text-xs font-bold text-slate-700 block">Factory Inspection Photos ({activeWorkItem.item_photos.length}):</span>
                  <div className="grid grid-cols-3 gap-2">
                    {activeWorkItem.item_photos.map((p) => (
                      <div key={p.id} className="relative rounded-xl overflow-hidden border border-slate-200 group">
                        <img src={p.url} alt={p.description} className="w-full h-24 object-cover" />
                        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 to-transparent p-2 flex items-end">
                          <span className="text-[10px] text-white line-clamp-1">{p.description}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Upload Photo Modal */}
      {showPhotoModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900">Upload Shop Floor Photo</h3>
              <button onClick={() => setShowPhotoModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadPhoto} className="space-y-3 text-xs">
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50">
                <Camera className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <span className="font-bold text-slate-700 block">Snap or Select Photo</span>
                <span className="text-[11px] text-slate-400">Joinery joints, edge banding, solid surface seam</span>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Photo Description</label>
                <input
                  type="text"
                  placeholder="e.g. Mitre rebate joint dry-fit test passed"
                  value={photoDesc}
                  onChange={(e) => setPhotoDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowPhotoModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl shadow-xs"
                >
                  Submit Photo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Report Problem Modal */}
      {showIssueModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-extrabold text-slate-900 flex items-center space-x-1.5">
                <AlertTriangle className="w-4 h-4 text-rose-600" />
                <span>Report Workshop Problem</span>
              </h3>
              <button onClick={() => setShowIssueModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleReportProblem} className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Problem Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Veneer grain mismatch or board tear-out"
                  value={issueTitle}
                  onChange={(e) => setIssueTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Details & Location</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Describe what occurred, piece part number, and what needs fixing..."
                  value={issueDesc}
                  onChange={(e) => setIssueDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowIssueModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs"
                >
                  Report to Supervisor
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
