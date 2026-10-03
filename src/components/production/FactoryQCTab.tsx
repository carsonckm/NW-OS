/**
 * NW OS — Factory QC Inspection & Rework Protection Module
 * Dimensional, visual, and hardware operational sign-off before packing release
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  RotateCcw,
  Camera,
  ShieldCheck,
  User,
  Clock,
  Layers,
  X,
} from 'lucide-react';
import { FactoryQCInspection, ProductionOrderStatus } from '../../types';

export const FactoryQCTab: React.FC = () => {
  const {
    factoryQCInspections,
    productionOrders,
    recordFactoryQC,
    currentUser,
  } = useNW();

  const [showNewQCModal, setShowNewQCModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(productionOrders[0]?.id || '');
  const [dimensionalPass, setDimensionalPass] = useState(true);
  const [visualPass, setVisualPass] = useState(true);
  const [hardwarePass, setHardwarePass] = useState(true);
  const [edgeBandingPass, setEdgeBandingPass] = useState(true);
  const [grainMatchPass, setGrainMatchPass] = useState(true);
  const [qcResult, setQcResult] = useState<'Passed' | 'Failed' | 'Rework Required'>('Passed');
  const [reworkStage, setReworkStage] = useState<ProductionOrderStatus>('Edge Banding');
  const [reworkReason, setReworkReason] = useState('');
  const [comments, setComments] = useState('');

  const handleRecordQC = () => {
    const order = productionOrders.find((o) => o.id === selectedOrderId);
    if (!order) return;

    recordFactoryQC({
      production_order_id: order.id,
      production_order_number: order.order_number,
      work_item_code: order.work_item_code,
      description: `${order.work_item_code} ${order.material.split('/')[0]}`,
      inspector_name: currentUser.name,
      inspector_role: currentUser.role,
      dimensional_tolerance_pass: dimensionalPass,
      visual_inspection_pass: visualPass,
      hardware_smoothness_pass: hardwarePass,
      edge_banding_integrity_pass: edgeBandingPass,
      grain_match_pass: grainMatchPass,
      result: qcResult,
      rework_target_stage: qcResult === 'Rework Required' ? reworkStage : undefined,
      rework_reason: qcResult === 'Rework Required' ? reworkReason : undefined,
      photos: order.photos || [],
      comments: comments || 'Factory QC signoff completed.',
    });

    setShowNewQCModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-purple-600" />
            <h3 className="font-bold text-slate-900 text-sm">Factory Quality Control (QC) Station</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Strict Gatekeeper Policy: Items cannot proceed to Packing or Delivery without passing dimensional and visual QC sign-off.
          </p>
        </div>

        <button
          onClick={() => setShowNewQCModal(true)}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>Conduct Factory QC Inspection</span>
        </button>
      </div>

      {/* QC Inspections List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {factoryQCInspections.map((qc) => (
          <div
            key={qc.id}
            className={`bg-white border rounded-xl p-5 shadow-xs space-y-4 ${
              qc.result === 'Passed'
                ? 'border-emerald-200 hover:border-emerald-400'
                : 'border-rose-300 bg-rose-50/20 hover:border-rose-400'
            } transition-colors`}
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="font-mono font-bold text-slate-900 text-xs">{qc.production_order_number}</span>
                <span className="text-amber-700 font-bold text-xs ml-1.5">({qc.work_item_code})</span>
                <div className="text-xs font-semibold text-slate-700 mt-0.5">{qc.description}</div>
              </div>
              <span
                className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase flex items-center space-x-1 ${
                  qc.result === 'Passed'
                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {qc.result === 'Passed' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                <span>{qc.result}</span>
              </span>
            </div>

            {/* Checklist items status */}
            <div className="grid grid-cols-2 gap-1.5 text-[11px]">
              <div className="flex items-center space-x-1.5">
                {qc.dimensional_tolerance_pass ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                )}
                <span>Dimensions (+/-1mm)</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {qc.visual_inspection_pass ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                )}
                <span>Visual Surface</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {qc.edge_banding_integrity_pass ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                )}
                <span>Edge Banding</span>
              </div>
              <div className="flex items-center space-x-1.5">
                {qc.hardware_smoothness_pass ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <XCircle className="w-3.5 h-3.5 text-rose-600" />
                )}
                <span>Hardware Action</span>
              </div>
            </div>

            {/* Rework Reason if any */}
            {qc.rework_reason && (
              <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-900 text-xs space-y-1">
                <span className="font-bold flex items-center space-x-1">
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Rework Triggered → Returned to {qc.rework_target_stage}</span>
                </span>
                <p className="text-[11px] text-rose-800">{qc.rework_reason}</p>
              </div>
            )}

            <div className="p-2.5 bg-slate-50 rounded-lg text-slate-600 text-xs">
              <span className="font-semibold text-slate-700 block mb-0.5">Inspector Comments:</span>
              <p className="line-clamp-2">{qc.comments}</p>
            </div>

            <div className="flex items-center justify-between text-[10px] text-slate-400 pt-2 border-t border-slate-100">
              <span>Inspector: {qc.inspector_name}</span>
              <span>{new Date(qc.inspection_date).toLocaleDateString()}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Conduct QC Modal */}
      {showNewQCModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-2">
                <ShieldCheck className="w-4 h-4 text-purple-600" />
                <span>New Factory QC Inspection Record</span>
              </h3>
              <button onClick={() => setShowNewQCModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Select Production Order
              </label>
              <select
                aria-label="Select Production Order"
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-bold"
              >
                {productionOrders.map((ord) => (
                  <option key={ord.id} value={ord.id}>
                    {ord.order_number} — {ord.work_item_code} (Stage: {ord.current_stage})
                  </option>
                ))}
              </select>
            </div>

            {/* Checkbox inspections */}
            <div className="space-y-2 bg-slate-50 p-3 rounded-xl text-xs">
              <span className="font-bold text-slate-700 uppercase tracking-wider text-[10px] block">
                Verification Checklist (Section 15)
              </span>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={dimensionalPass}
                  onChange={(e) => setDimensionalPass(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>Dimensional accuracy vs Approved NW Production Drawing (+/-1.0mm)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={visualPass}
                  onChange={(e) => setVisualPass(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>Visual inspection (Zero scratches, chipping, or glue squeeze-out)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={edgeBandingPass}
                  onChange={(e) => setEdgeBandingPass(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>Edge banding integrity & flush trimming</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hardwarePass}
                  onChange={(e) => setHardwarePass(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>Hardware operation (Smooth soft-close glide & hinge alignment)</span>
              </label>

              <label className="flex items-center space-x-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={grainMatchPass}
                  onChange={(e) => setGrainMatchPass(e.target.checked)}
                  className="rounded text-purple-600"
                />
                <span>Woodgrain match & veneer continuity</span>
              </label>
            </div>

            {/* Verdict */}
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Inspection Verdict
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setQcResult('Passed')}
                  className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                    qcResult === 'Passed'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  Pass → Release
                </button>
                <button
                  type="button"
                  onClick={() => setQcResult('Rework Required')}
                  className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                    qcResult === 'Rework Required'
                      ? 'bg-rose-600 text-white border-rose-600'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  Rework Required
                </button>
                <button
                  type="button"
                  onClick={() => setQcResult('Failed')}
                  className={`py-2 rounded-lg text-xs font-bold border transition-colors ${
                    qcResult === 'Failed'
                      ? 'bg-red-900 text-white border-red-900'
                      : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}
                >
                  Scrap / Reject
                </button>
              </div>
            </div>

            {/* If Rework Required */}
            {qcResult === 'Rework Required' && (
              <div className="space-y-3 p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-rose-900 mb-1">
                    Return to Stage for Rework
                  </label>
                  <select
                    aria-label="Return to Stage for Rework"
                    value={reworkStage}
                    onChange={(e) => setReworkStage(e.target.value as ProductionOrderStatus)}
                    className="w-full p-2 bg-white border border-rose-300 rounded-lg text-xs font-bold text-rose-950"
                  >
                    <option value="Cutting">Cutting (Re-cut component blanks)</option>
                    <option value="CNC">CNC (Re-route joint pockets)</option>
                    <option value="Edge Banding">Edge Banding (Re-apply edge tape)</option>
                    <option value="Assembly">Assembly (Re-align / square carcase)</option>
                    <option value="Finishing">Finishing (Re-sand & re-spray coat)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase text-rose-900 mb-1">
                    Rework Instructions
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Specific defect and instructions for craftsmen..."
                    value={reworkReason}
                    onChange={(e) => setReworkReason(e.target.value)}
                    className="w-full p-2 bg-white border border-rose-300 rounded-lg text-xs"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                QC Comments
              </label>
              <textarea
                rows={2}
                placeholder="Dimensional measurements, visual observations..."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                onClick={() => setShowNewQCModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleRecordQC}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                Submit Factory QC Signoff
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
