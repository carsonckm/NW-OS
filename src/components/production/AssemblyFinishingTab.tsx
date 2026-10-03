/**
 * NW OS — Assembly & Finishing Quality Workflow Module
 * Pre-assembly parts readiness verification, hardware checklists, and finishing cure timers
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  Boxes,
  Sparkles,
  CheckCircle2,
  Clock,
  User,
  Wrench,
  AlertTriangle,
  Layers,
  CheckSquare,
  Square,
  ShieldCheck,
} from 'lucide-react';

export const AssemblyFinishingTab: React.FC = () => {
  const {
    assemblyJobs,
    finishingJobs,
    toggleAssemblyPartCheck,
    toggleAssemblyHardwareCheck,
    updateAssemblyJob,
    updateFinishingJob,
  } = useNW();

  const [activeTab, setActiveTab] = useState<'assembly' | 'finishing'>('assembly');

  return (
    <div className="space-y-6">
      {/* Top Toggle Switch */}
      <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex items-center space-x-2">
        <button
          onClick={() => setActiveTab('assembly')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center space-x-2 transition-colors ${
            activeTab === 'assembly'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Boxes className="w-4 h-4" />
          <span>Assembly Queue & Checklist ({assemblyJobs.length})</span>
        </button>
        <button
          onClick={() => setActiveTab('finishing')}
          className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center space-x-2 transition-colors ${
            activeTab === 'finishing'
              ? 'bg-amber-500 text-slate-950 shadow-xs'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Finishing & Coating Booths ({finishingJobs.length})</span>
        </button>
      </div>

      {/* ASSEMBLY TAB CONTENT */}
      {activeTab === 'assembly' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {assemblyJobs.map((job) => {
              const allPartsReady = job.parts_checklist.every((p) => p.ready);
              const allHardwareChecked = job.hardware_checklist.every((h) => h.checked);

              return (
                <div
                  key={job.id}
                  className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 hover:border-amber-400 transition-colors"
                >
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-mono font-bold text-slate-900 text-sm">
                          {job.production_order_number}
                        </span>
                        <span className="text-amber-700 font-bold text-xs">({job.work_item_code})</span>
                      </div>
                      <h4 className="text-xs font-bold text-slate-700 mt-0.5">{job.description}</h4>
                    </div>

                    <span
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        job.status === 'In Assembly'
                          ? 'bg-indigo-100 text-indigo-900 border border-indigo-200'
                          : 'bg-emerald-100 text-emerald-900'
                      }`}
                    >
                      {job.status}
                    </span>
                  </div>

                  <div className="text-xs text-slate-600 flex items-center justify-between bg-slate-50 p-2.5 rounded-lg">
                    <span className="flex items-center space-x-1.5 font-medium">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{job.assigned_craftsman}</span>
                    </span>
                    <span className="font-semibold text-slate-700">{job.joinery_method}</span>
                  </div>

                  {/* Component Parts Readiness Checklist (Section 14 Requirement) */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] uppercase font-bold text-slate-700 tracking-wider flex items-center space-x-1.5">
                        <Layers className="w-3.5 h-3.5 text-blue-600" />
                        <span>Pre-Assembly Parts Readiness ({job.parts_checklist.filter((p) => p.ready).length}/{job.parts_checklist.length})</span>
                      </span>
                      {allPartsReady ? (
                        <span className="text-[10px] font-bold text-emerald-600 flex items-center space-x-1">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>All Parts Present</span>
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-600">Parts In Cutting/CNC</span>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {job.parts_checklist.map((part) => (
                        <button
                          key={part.part_id}
                          onClick={() => toggleAssemblyPartCheck(job.id, part.part_id)}
                          className={`w-full p-2 rounded-lg border text-left flex items-center justify-between text-xs transition-colors ${
                            part.ready
                              ? 'bg-emerald-50/50 border-emerald-200 text-slate-900'
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            {part.ready ? (
                              <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span className="font-mono font-bold text-[11px]">{part.part_code}</span>
                            <span className="truncate">{part.description}</span>
                          </div>
                          <span className="text-[10px] uppercase font-bold text-slate-400">
                            {part.ready ? 'Passed Cut/CNC' : 'Pending'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Hardware Checklist (Section 14 Requirement) */}
                  <div className="space-y-2">
                    <span className="text-[11px] uppercase font-bold text-slate-700 tracking-wider flex items-center space-x-1.5">
                      <Wrench className="w-3.5 h-3.5 text-indigo-600" />
                      <span>Hardware & Fasteners Checklist</span>
                    </span>

                    <div className="space-y-1.5">
                      {job.hardware_checklist.map((h, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleAssemblyHardwareCheck(job.id, idx)}
                          className={`w-full p-2 rounded-lg border text-left flex items-center justify-between text-xs transition-colors ${
                            h.checked
                              ? 'bg-blue-50/50 border-blue-200 text-slate-900'
                              : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}
                        >
                          <div className="flex items-center space-x-2">
                            {h.checked ? (
                              <CheckSquare className="w-4 h-4 text-blue-600 shrink-0" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <span>{h.item}</span>
                          </div>
                          <span className="font-mono font-bold text-slate-700 text-[11px]">
                            Qty: {h.quantity}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="p-2.5 bg-slate-50 rounded-lg text-slate-600 text-xs">
                    <span className="font-bold text-slate-700 block mb-0.5">Assembly Notes:</span>
                    {job.assembly_notes}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* FINISHING TAB CONTENT */}
      {activeTab === 'finishing' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {finishingJobs.map((fin) => (
            <div
              key={fin.id}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4"
            >
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <span className="font-mono font-bold text-slate-900 text-sm">
                    {fin.production_order_number}
                  </span>
                  <span className="text-amber-700 font-bold text-xs ml-2">({fin.work_item_code})</span>
                  <div className="text-xs font-semibold text-slate-700 mt-0.5">{fin.finish_type}</div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                    fin.cured_status === 'Ready for QC'
                      ? 'bg-purple-100 text-purple-900'
                      : 'bg-amber-100 text-amber-900 animate-pulse'
                  }`}
                >
                  {fin.cured_status}
                </span>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg space-y-2 text-xs text-slate-700">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Specification</span>
                  <span className="font-medium text-slate-900">{fin.specification}</span>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-200">
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Coats</span>
                    <span className="font-bold text-slate-900">
                      {fin.coats_applied} / {fin.coats_required} Applied
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Cure Cycle</span>
                    <span className="font-bold text-slate-900 flex items-center space-x-1">
                      <Clock className="w-3.5 h-3.5 text-amber-600" />
                      <span>{fin.cure_time_hours} Hours</span>
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 text-[10px] uppercase font-bold block">Specialist</span>
                    <span className="font-bold text-slate-900">{fin.assigned_finisher.split(' ')[0]}</span>
                  </div>
                </div>
              </div>

              {fin.inspection_notes && (
                <div className="text-xs text-slate-600 bg-emerald-50/50 border border-emerald-200 p-2.5 rounded-lg flex items-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>{fin.inspection_notes}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
