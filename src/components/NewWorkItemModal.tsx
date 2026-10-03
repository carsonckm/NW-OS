/**
 * NW OS — New Work Item Modal
 * Creates a granular physical deliverable inside a Work Package with linked Drawing Revision,
 * contractor assignment, material specs, schedule, and visual progress tracking.
 */

import React, { useState, useEffect } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem, WorkPackage, WorkItemStatus } from '../types';
import {
  X,
  Package,
  Layers,
  MapPin,
  Calendar,
  Ruler,
  CheckCircle2,
  AlertCircle,
  FileText,
  User,
  Percent,
} from 'lucide-react';

interface NewWorkItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  workPackage: WorkPackage;
  onSuccess: (item: WorkItem, msg: string) => void;
}

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

export const NewWorkItemModal: React.FC<NewWorkItemModalProps> = ({
  isOpen,
  onClose,
  workPackage,
  onSuccess,
}) => {
  const { addWorkItem, contractors, drawings, projects } = useNW();

  // Find project drawings for this work package
  const projectDrawings = drawings.filter((d) => d.project_id === workPackage.project_id);
  const defaultDrawing = projectDrawings[0] || drawings[0] || null;

  // Auto-suggest item code based on trade
  const getSuggestedCode = (trade: string) => {
    const prefix = (trade || 'CAR').substring(0, 3).toUpperCase();
    const num = Math.floor(Math.random() * 800) + 100;
    return `${prefix}-${num}`;
  };

  const [itemCode, setItemCode] = useState(() => getSuggestedCode(workPackage.category || 'CAR'));
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('Ground Floor');
  const [quantity, setQuantity] = useState(1);
  const [unit, setUnit] = useState('Unit');
  const [dimensions, setDimensions] = useState('2400 × 900 × 1050 mm');
  const [material, setMaterial] = useState('18mm plywood');
  const [finish, setFinish] = useState('Laminate');
  const [requiredDate, setRequiredDate] = useState(
    workPackage.end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  );
  const [selectedDrawingId, setSelectedDrawingId] = useState(defaultDrawing?.id || '');
  const [selectedRevisionCode, setSelectedRevisionCode] = useState(
    defaultDrawing?.revisions[0]?.revision_code || 'Rev 1'
  );
  // Contractor normally inherits from Work Package
  const [contractorId, setContractorId] = useState(workPackage.contractor_id || '');
  const [status, setStatus] = useState<WorkItemStatus>('Assigned');
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [notes, setNotes] = useState('');

  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync when work package changes
  useEffect(() => {
    if (workPackage) {
      setContractorId(workPackage.contractor_id);
      if (workPackage.end_date) {
        setRequiredDate(workPackage.end_date);
      }
    }
  }, [workPackage]);

  // When drawing selection changes, update available revisions and pick current revision
  const currentDrawing = drawings.find((d) => d.id === selectedDrawingId);

  useEffect(() => {
    if (currentDrawing && currentDrawing.revisions.length > 0) {
      const activeRev =
        currentDrawing.revisions.find((r) => r.is_current) || currentDrawing.revisions[0];
      setSelectedRevisionCode(activeRev.revision_code);
    }
  }, [selectedDrawingId]);

  if (!isOpen) return null;

  // Validation strictly per instructions:
  // Required: Description, Quantity, Contractor
  const validate = (): boolean => {
    const errs: { [key: string]: string } = {};
    if (!description.trim()) {
      errs.description = 'Description is required.';
    }
    if (!quantity || Number(quantity) <= 0) {
      errs.quantity = 'Quantity must be at least 1.';
    }
    if (!contractorId) {
      errs.contractorId = 'Contractor is required.';
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    try {
      const newItem = addWorkItem({
        work_package_id: workPackage.id,
        project_id: workPackage.project_id,
        contractor_id: contractorId,
        item_code: itemCode.trim().toUpperCase() || getSuggestedCode(workPackage.category),
        description: description.trim(),
        location: location.trim() || 'General Site Area',
        quantity: Number(quantity) || 1,
        unit: unit.trim() || 'Unit',
        dimensions: dimensions.trim() || 'Per site measurement',
        material: material.trim() || 'Specified in BOQ',
        finish: finish.trim() || 'Factory Standard',
        required_date: requiredDate,
        drawing_id: selectedDrawingId || 'dwg-1',
        drawing_revision: selectedRevisionCode || 'Rev 1',
        status,
        progress_percent: Math.min(100, Math.max(0, Number(progressPercent) || 0)),
        notes: notes.trim() || undefined,
        photos: [],
        item_photos: [],
        production_status: progressPercent > 0 ? 'Cutting' : 'Not Started',
        delivery_status: 'Not Scheduled',
        installation_status: 'Not Started',
      });

      // User instruction requirement:
      // Show: "Work Item created successfully."
      onSuccess(newItem, 'Work Item created successfully.');
      onClose();
    } catch (err) {
      console.error('Failed to create work item:', err);
      setErrors({ form: 'Failed to create work item. Please try again.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const project = projects.find((p) => p.id === workPackage.project_id);

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 z-50 overflow-y-auto">
      <div
        className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full text-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 my-8"
        id="new-work-item-modal"
      >
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-850 to-slate-900 text-white px-6 py-5 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-400/30 flex items-center justify-center text-amber-400">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold">+ New Work Item</h2>
              <p className="text-xs text-slate-300">
                Inside package:{' '}
                <span className="font-semibold text-amber-300">{workPackage.name}</span>
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

          {/* Context Banner: Inherited Project & Work Package */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div>
              <span className="text-slate-400 block text-[10px] uppercase font-bold tracking-wider">
                Inherited Scope
              </span>
              <span className="font-bold text-slate-900">{project?.project_name.split('—')[0]}</span>
              <span className="text-slate-400 mx-1.5">•</span>
              <span className="font-semibold text-slate-700">{workPackage.name}</span>
            </div>
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold uppercase">
              {workPackage.category || 'Carpentry'}
            </span>
          </div>

          {/* Item Code & Description (Required) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-1">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Item Code
              </label>
              <input
                type="text"
                value={itemCode}
                onChange={(e) => setItemCode(e.target.value)}
                placeholder="e.g. CAR-001"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono font-bold uppercase focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
                id="item-code-input"
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Description <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Checkout Counter #01"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all font-medium"
                id="item-description-input"
              />
              {errors.description && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.description}</p>
              )}
            </div>
          </div>

          {/* Location, Quantity (Required), Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 sm:col-span-1">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Location
              </label>
              <div className="relative">
                <MapPin className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. Ground Floor"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
                  id="item-location-input"
                />
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-1">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Quantity <span className="text-rose-500">*</span>
              </label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all font-mono"
                id="item-quantity-input"
              />
              {errors.quantity && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.quantity}</p>
              )}
            </div>

            <div className="space-y-1.5 sm:col-span-1">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Unit
              </label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer"
              >
                <option value="Unit">Unit</option>
                <option value="Set">Set</option>
                <option value="Nos">Nos</option>
                <option value="Lot">Lot</option>
                <option value="Metre">Metre</option>
                <option value="Sq Ft">Sq Ft</option>
              </select>
            </div>
          </div>

          {/* Dimensions, Material, Finish */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Dimensions
              </label>
              <div className="relative">
                <Ruler className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                  placeholder="e.g. 2400 × 900 × 1050 mm"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all font-mono"
                  id="item-dimensions-input"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Material
              </label>
              <input
                type="text"
                value={material}
                onChange={(e) => setMaterial(e.target.value)}
                placeholder="e.g. 18mm plywood"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
                id="item-material-input"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Finish
              </label>
              <input
                type="text"
                value={finish}
                onChange={(e) => setFinish(e.target.value)}
                placeholder="e.g. Laminate"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
                id="item-finish-input"
              />
            </div>
          </div>

          {/* DRAWING RELATIONSHIP: Specific Drawing & Specific Revision */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center space-x-2">
              <FileText className="w-4 h-4 text-amber-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Drawing Specification & Revision Control
              </h4>
            </div>
            <p className="text-[11px] text-slate-500">
              Must be tied to a specific revision (e.g. A-103 Rev 4). Do not link vaguely to
              &quot;latest&quot;.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {/* Drawing Selector */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-700 uppercase">
                  Drawing
                </label>
                <select
                  value={selectedDrawingId}
                  onChange={(e) => setSelectedDrawingId(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                  id="select-drawing"
                >
                  {drawings.map((dwg) => (
                    <option key={dwg.id} value={dwg.id}>
                      {dwg.drawing_number} — {dwg.title}
                    </option>
                  ))}
                </select>
              </div>

              {/* Drawing Revision Selector */}
              <div className="space-y-1">
                <label className="block text-[11px] font-bold text-slate-700 uppercase">
                  Drawing Revision (Exact)
                </label>
                <select
                  value={selectedRevisionCode}
                  onChange={(e) => setSelectedRevisionCode(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 cursor-pointer"
                  id="select-drawing-revision"
                >
                  {currentDrawing && currentDrawing.revisions.length > 0 ? (
                    currentDrawing.revisions.map((rev) => (
                      <option key={rev.id} value={rev.revision_code}>
                        {rev.revision_code} {rev.is_current ? '(Current Approved)' : `(${rev.approved_status})`}
                      </option>
                    ))
                  ) : (
                    <>
                      <option value="Rev 4">Rev 4 (Approved)</option>
                      <option value="Rev 3">Rev 3 (Superseded)</option>
                      <option value="Rev 2">Rev 2 (Superseded)</option>
                      <option value="Rev 1">Rev 1 (Initial)</option>
                    </>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Contractor (Required, Inherited with override) & Required Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Contractor <span className="text-rose-500">*</span>
                </label>
                <span className="text-[10px] text-slate-500 italic">Inherited from Package</span>
              </div>
              <div className="relative">
                <User className="w-3.5 h-3.5 text-slate-400 absolute left-3.5 top-3" />
                <select
                  value={contractorId}
                  onChange={(e) => setContractorId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-8 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer"
                  id="item-contractor-select"
                >
                  {contractors.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.company_name} ({c.trade})
                    </option>
                  ))}
                </select>
              </div>
              {errors.contractorId && (
                <p className="text-[11px] text-rose-600 font-medium">{errors.contractorId}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Required Date
              </label>
              <div className="relative">
                <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
                <input
                  type="date"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2.5 text-xs text-slate-900 font-mono focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
                  id="item-required-date"
                />
              </div>
            </div>
          </div>

          {/* Status & Progress % */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WorkItemStatus)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 font-medium focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all cursor-pointer"
                id="item-status-select"
              >
                {ALL_WORK_ITEM_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
                  Progress %
                </label>
                <span className="font-mono text-xs font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                  {progressPercent}%
                </span>
              </div>
              <div className="flex items-center space-x-3 pt-1">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="5"
                  value={progressPercent}
                  onChange={(e) => setProgressPercent(parseInt(e.target.value))}
                  className="w-full accent-amber-500 cursor-pointer"
                  id="item-progress-slider"
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
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider">
              Notes / Technical Specifications
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Include concealed cable channel at rear for POS terminals."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 focus:bg-white transition-all"
              id="item-notes-input"
            />
          </div>

          {/* Actions: Cancel and Save */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold transition-all cursor-pointer"
              id="cancel-new-work-item-btn"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
              id="save-work-item-btn"
            >
              <CheckCircle2 className="w-4 h-4 text-slate-950" />
              <span>{isSubmitting ? 'Saving...' : 'Save Work Item'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
