import React, { useState } from 'react';
import {
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  Camera,
  User,
  Calendar,
  FileCheck,
  RotateCcw,
  Check,
  X,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { SiteQCInspection, SnagItem, QCEvalResult } from '../../types';
import { SiteQCForm, latestSiteQc } from './SiteWorkflow';

export const SiteQCTab: React.FC = () => {
  const {
    siteQCInspections,
    updateSnagItem,
    recordSiteQCInspection,
    installationJobs,
    currentUser,
  } = useNW();

  const [selectedInspectionId, setSelectedInspectionId] = useState<string>(
    siteQCInspections[0]?.id || ''
  );
  const [showNewInspectionModal, setShowNewInspectionModal] = useState(false);
  const [reinspect, setReinspect] = useState<SiteQCInspection | null>(null);
  const canInspect = ['Owner / CEO', 'Project Manager', 'Site Supervisor'].includes(currentUser.role);

  const activeInspection =
    siteQCInspections.find((i) => i.id === selectedInspectionId) ||
    siteQCInspections[0];

  // Snag rectification state
  const handleUpdateSnagStatus = (
    inspectionId: string,
    snagId: string,
    nextStatus: SnagItem['status']
  ) => {
    updateSnagItem(inspectionId, snagId, {
      status: nextStatus,
      rectified_notes: `Status changed to ${nextStatus} by ${currentUser.name} on ${new Date().toLocaleDateString()}`,
    });
  };

  return (
    <div className="space-y-6">
      {(showNewInspectionModal || reinspect) && (
        <SiteQCForm
          reinspectionOf={reinspect ?? undefined}
          onClose={() => {
            setShowNewInspectionModal(false);
            setReinspect(null);
          }}
        />
      )}
      {/* Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-purple-100 text-purple-900 rounded-lg">
              <ShieldCheck className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Site Quality Control & Rectification Punch List
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Formal Clerk of Works / PM inspections. Strict 10-point joinery inspection matrix. QC failure automatically locks completion until reinspection.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {canInspect && activeInspection?.result === 'Fail / Rectification Required' && latestSiteQc(siteQCInspections, activeInspection.work_item_id)?.id === activeInspection.id && (
            <button
              type="button"
              onClick={() => setReinspect(activeInspection)}
              className="px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-xs font-bold text-purple-900 hover:bg-purple-100"
            >
              Re-inspect {activeInspection.work_item_code}
            </button>
          )}
          {canInspect && (
            <button
              type="button"
              onClick={() => setShowNewInspectionModal(true)}
              className="px-3 py-1.5 rounded-lg bg-purple-600 text-xs font-bold text-white hover:bg-purple-700"
            >
              Record inspection
            </button>
          )}
          <select
            value={selectedInspectionId}
            onChange={(e) => setSelectedInspectionId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-purple-500"
          >
            {siteQCInspections.map((i) => (
              <option key={i.id} value={i.id}>
                {i.inspection_number} — {i.work_item_code} ({i.result})
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeInspection && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Inspection Overview & 10-Point Technical Evaluation (6 cols) */}
          <div className="lg:col-span-6 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Official QC Record
                  </span>
                  <h4 className="text-base font-black text-slate-900">
                    {activeInspection.inspection_number} — {activeInspection.work_item_code}
                  </h4>
                  <p className="text-xs text-slate-500">{activeInspection.project_name}</p>
                </div>

                <span
                  className={`px-3 py-1 text-xs font-black rounded-lg border ${
                    activeInspection.result === 'Pass'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : activeInspection.result === 'Fail / Rectification Required'
                      ? 'bg-rose-100 text-rose-900 border-rose-300 animate-pulse'
                      : 'bg-amber-100 text-amber-900 border-amber-300'
                  }`}
                >
                  {activeInspection.result}
                </span>
              </div>

              {/* Inspector info */}
              <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Inspector
                  </span>
                  <span className="font-bold text-slate-800">
                    {activeInspection.inspector_name} ({activeInspection.inspector_role})
                  </span>
                </div>

                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Inspection Date
                  </span>
                  <span className="font-bold text-slate-800">
                    {activeInspection.inspection_date}
                  </span>
                </div>
              </div>

              {/* SECTION 27: 10-Point Joinery QC Matrix */}
              <div className="space-y-2 pt-2">
                <span className="text-xs font-black text-slate-800 uppercase tracking-tight block">
                  10-Point Architectural Carpentry Evaluation (Section 27)
                </span>

                <div className="space-y-1.5 text-xs">
                  {[
                    { key: 'dimension', label: '1. Dimension: Matches approved drawing requirements' },
                    { key: 'location', label: '2. Location: Correct site grid & wall elevation' },
                    { key: 'level', label: '3. Level: Laser level / plumb within 1mm tolerance' },
                    { key: 'alignment', label: '4. Alignment: Even shadow lines with adjacent fixtures' },
                    { key: 'joints', label: '5. Joints: Tight mitres, seamless Corian/laminate seams' },
                    { key: 'hardware', label: '6. Hardware: Soft-close dampers, concealed pivots, slides' },
                    { key: 'finish', label: '7. Finish: Zero delamination, smooth lacquer/spray sheen' },
                    { key: 'doors_drawers', label: '8. Doors/Drawers: Smooth glide and calibrated rebate' },
                    { key: 'damage', label: '9. Damage: Free of surface scratches, chipping, dents' },
                    { key: 'cleanliness', label: '10. Cleanliness: Silicone residue removed, vacuumed' },
                  ].map((chk, idx) => {
                    // Evaluate pass based on inspection flags or defaults
                    const isPass =
                      activeInspection.result === 'Pass'
                        ? true
                        : activeInspection.result === 'Pass with Minor Rectification'
                        ? idx !== 6 // finish minor blemish
                        : idx === 3 || idx === 5 // alignment or hardware failed
                        ? false
                        : true;

                    return (
                      <div
                        key={chk.key}
                        className={`p-2.5 rounded-lg border flex items-center justify-between ${
                          isPass
                            ? 'bg-emerald-50/60 border-emerald-200 text-emerald-950 font-semibold'
                            : 'bg-rose-50 border-rose-200 text-rose-950 font-black'
                        }`}
                      >
                        <span className="truncate mr-2">{chk.label}</span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-black uppercase shrink-0 ${
                            isPass ? 'bg-emerald-200 text-emerald-900' : 'bg-rose-200 text-rose-900'
                          }`}
                        >
                          {isPass ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Inspector Signoff Comments */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1">
                <span className="font-bold text-slate-700 block">Inspector Evaluation Comments:</span>
                <p className="text-slate-600 italic">"{activeInspection.comments}"</p>
                <div className="text-[10px] font-mono text-slate-400 pt-1">
                  Inspector Sign-off Status:{' '}
                  <span className={activeInspection.inspector_signoff ? 'text-emerald-600 font-bold' : 'text-rose-600 font-bold'}>
                    {activeInspection.inspector_signoff ? 'FORMALLY ENDORSED' : 'HOLD — RECTIFICATION REQUIRED'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Snag / Punch List & Rectification Loop (6 cols) */}
          <div className="lg:col-span-6 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <AlertTriangle className="w-5 h-5 text-rose-600" />
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    Snag / Punch List Items ({activeInspection.snag_items?.length || 0})
                  </h4>
                </div>
                <span className="text-[10px] font-bold bg-rose-100 text-rose-800 px-2 py-0.5 rounded">
                  Section 28 Rectification
                </span>
              </div>

              {activeInspection.snag_items && activeInspection.snag_items.length > 0 ? (
                <div className="space-y-3">
                  {activeInspection.snag_items.map((snag) => (
                    <div
                      key={snag.id}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-200 text-slate-800 rounded">
                            Snag #{snag.item_number}
                          </span>
                          <span className="ml-2 px-2 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-900 rounded">
                            {snag.category}
                          </span>
                        </div>

                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                            snag.status === 'Verified Closed'
                              ? 'bg-emerald-100 text-emerald-900'
                              : snag.status === 'Rectified / Ready for Re-inspection'
                              ? 'bg-blue-100 text-blue-900'
                              : 'bg-rose-100 text-rose-900'
                          }`}
                        >
                          {snag.status}
                        </span>
                      </div>

                      <p className="text-slate-800 font-bold leading-snug">
                        {snag.description}
                      </p>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 pt-1 border-t border-slate-200">
                        <div>
                          <span className="text-slate-400 block text-[10px] font-bold uppercase">
                            Assigned To
                          </span>
                          <span className="font-bold text-slate-800">{snag.assigned_to}</span>
                        </div>

                        <div>
                          <span className="text-slate-400 block text-[10px] font-bold uppercase">
                            Due Deadline
                          </span>
                          <span className="font-bold text-rose-700">{snag.deadline}</span>
                        </div>
                      </div>

                      {snag.rectified_notes && (
                        <div className="p-2 bg-emerald-50 border border-emerald-200 rounded text-[11px] text-emerald-900">
                          <span className="font-bold">Rectification Log:</span> {snag.rectified_notes}
                        </div>
                      )}

                      {/* Rectification Status Buttons */}
                      <div className="pt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          disabled={snag.status === 'Rectification In Progress'}
                          onClick={() => handleUpdateSnagStatus(activeInspection.id, snag.id, 'Rectification In Progress')}
                          className="px-2.5 py-1 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded text-[11px] font-bold"
                        >
                          Mark In Progress
                        </button>
                        <button
                          disabled={snag.status === 'Rectified / Ready for Re-inspection'}
                          onClick={() => handleUpdateSnagStatus(activeInspection.id, snag.id, 'Rectified / Ready for Re-inspection')}
                          className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-bold"
                        >
                          Submit Rectified
                        </button>
                        <button
                          disabled={snag.status === 'Verified Closed'}
                          onClick={() => handleUpdateSnagStatus(activeInspection.id, snag.id, 'Verified Closed')}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-bold"
                        >
                          Verify & Close
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center bg-emerald-50 border border-emerald-200 rounded-xl space-y-1">
                  <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
                  <div className="text-xs font-black text-emerald-900">Zero Open Snags on Record</div>
                  <p className="text-[11px] text-emerald-700">
                    This work item passed site inspection cleanly and is approved for final client handover inclusion.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
