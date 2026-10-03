/**
 * NW OS — CNC Center & Version Controlled Toolpath Management
 * Real-time 5-axis routing, nesting, machine allocation & outdated drawing protection
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  Cpu,
  Play,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Clock,
  Layers,
  FileCode,
  ShieldAlert,
  Plus,
  Terminal,
  Server,
  User,
  X,
} from 'lucide-react';
import { CNCJob, CNCJobStatus } from '../../types';

export const CNCCenterTab: React.FC = () => {
  const {
    cncJobs,
    cncFileVersions,
    updateCNCJobStatus,
    uploadCNCFileVersion,
  } = useNW();

  const [activeJobDetail, setActiveJobDetail] = useState<CNCJob | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [newRevision, setNewRevision] = useState('Rev 1');
  const [newMachine, setNewMachine] = useState('Biesse Rover B FT 2231 (bSolid v4)');
  const [newPartCode, setNewPartCode] = useState('CAR-003-P01');

  const handleStartJob = (jobId: string) => {
    updateCNCJobStatus(jobId, 'Running', 'Started cycle by operator');
  };

  const handleCompleteJob = (jobId: string) => {
    updateCNCJobStatus(jobId, 'Completed', 'Cycle finished successfully');
  };

  const handleUploadVersion = () => {
    if (!newFileName.trim()) return;
    uploadCNCFileVersion({
      file_name: newFileName,
      revision: newRevision,
      part_code: newPartCode,
      machine_compatibility: newMachine,
      gcode_summary: 'Toolpaths regenerated to match drawing specifications',
      toolpath_count: 8,
      estimated_run_time_min: 40,
      approved_by: 'Tan Kok Leong (Production Manager)',
      status: 'Approved',
      associated_drawing_revision: 'A-103-NW Rev 1',
    });
    setShowUploadModal(false);
    setNewFileName('');
  };

  return (
    <div className="space-y-6">
      {/* CNC Machine Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Machine 1: Biesse Rover B */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="font-bold text-slate-900 text-sm">CNC Router #1 — Biesse Rover B FT 2231</h3>
            </div>
            <p className="text-xs text-slate-500">5-Axis Heavy Nested Flat-Table Routing (2200 × 3100mm)</p>
            <div className="flex items-center space-x-3 text-[11px] text-slate-400 mt-2 font-mono">
              <span>Spindle: 18,000 RPM</span>
              <span>•</span>
              <span>Vacuum: 880 mbar</span>
              <span>•</span>
              <span>Operator: Mohd Hafiz</span>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 font-bold text-xs">
            ONLINE / ACTIVE
          </span>
        </div>

        {/* Machine 2: Homag Centateq */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <h3 className="font-bold text-slate-900 text-sm">CNC Center #2 — Homag Centateq P-110</h3>
            </div>
            <p className="text-xs text-slate-500">Deep Mortise, Pod & Rail Heavy Lockcase & Hinge Center</p>
            <div className="flex items-center space-x-3 text-[11px] text-slate-400 mt-2 font-mono">
              <span>Spindle: 16,000 RPM</span>
              <span>•</span>
              <span>woodWOP 7</span>
              <span>•</span>
              <span>Operator: Chong Wei Lun</span>
            </div>
          </div>
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 font-bold text-xs">
            ONLINE / ACTIVE
          </span>
        </div>
      </div>

      {/* CNC File Version Control Section (Section 12 Requirement) */}
      <div className="bg-slate-900 text-white rounded-xl p-5 shadow-lg border border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
          <div>
            <div className="flex items-center space-x-2">
              <FileCode className="w-4 h-4 text-amber-400" />
              <h3 className="font-bold text-white text-sm">CNC Program Version Control</h3>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Strict Versioning Policy: CNC files are never overwritten. Drawing revisions flag toolpaths as OUTDATED.
            </p>
          </div>
          <button
            onClick={() => setShowUploadModal(true)}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors self-start sm:self-auto"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Upload New CNC Version</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {cncFileVersions.map((file) => (
            <div
              key={file.id}
              className={`p-3.5 rounded-lg border text-xs space-y-2 ${
                file.status === 'OUTDATED / REQUIRES RE-GENERATION'
                  ? 'bg-rose-950/40 border-rose-600/60'
                  : 'bg-slate-800/80 border-slate-700'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-amber-300">{file.file_name}</span>
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                    file.status === 'OUTDATED / REQUIRES RE-GENERATION'
                      ? 'bg-rose-600 text-white animate-pulse'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  }`}
                >
                  {file.status === 'OUTDATED / REQUIRES RE-GENERATION' ? 'OUTDATED' : file.revision}
                </span>
              </div>

              <div className="text-[11px] text-slate-300 line-clamp-2">{file.gcode_summary}</div>

              <div className="text-[10px] text-slate-400 pt-1.5 border-t border-slate-700/80 flex justify-between">
                <span>Machine: {file.machine_compatibility.split('(')[0]}</span>
                <span>Run: {file.estimated_run_time_min} mins</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CNC Work Queue Table (Section 11 Requirement) */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs space-y-3">
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-cyan-600" />
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              CNC Live Execution Queue ({cncJobs.length} Jobs)
            </h3>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-200 tracking-wider">
              <tr>
                <th className="py-3 px-4">Job ID & Part</th>
                <th className="py-3 px-4">Dimensions & Material</th>
                <th className="py-3 px-4">CNC File & Machine</th>
                <th className="py-3 px-4">Operator</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {cncJobs.map((job) => (
                <tr key={job.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-4">
                    <span className="font-mono font-bold text-slate-900 block">{job.job_id_code}</span>
                    <span className="text-[11px] text-amber-700 font-bold">{job.part_code} — {job.part_name}</span>
                    <span className="block text-[10px] text-slate-400 mt-0.5">PO: {job.production_order_number}</span>
                  </td>

                  <td className="py-3 px-4">
                    <span className="font-mono font-bold text-slate-900 block">{job.dimensions}</span>
                    <span className="text-[11px] text-slate-500">{job.material} ({job.thickness_mm}mm)</span>
                  </td>

                  <td className="py-3 px-4">
                    <span className="font-mono font-bold text-blue-700 block">{job.cnc_file_name}</span>
                    <span className="text-[11px] text-slate-500">{job.machine}</span>
                  </td>

                  <td className="py-3 px-4">
                    <div className="flex items-center space-x-1.5 text-slate-800">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span>{job.operator}</span>
                    </div>
                    <span className="text-[10px] text-slate-400 block mt-0.5">
                      {job.start_time ? `Started: ${job.start_time}` : 'Pending'}
                    </span>
                  </td>

                  <td className="py-3 px-4">
                    <span
                      className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                        job.status === 'Running'
                          ? 'bg-emerald-500 text-white animate-pulse'
                          : job.status === 'Completed'
                          ? 'bg-slate-200 text-slate-800'
                          : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {job.status}
                    </span>
                  </td>

                  <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                    {job.status === 'Queued' && (
                      <button
                        onClick={() => handleStartJob(job.id)}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1 inline-flex transition-colors"
                      >
                        <Play className="w-3 h-3" />
                        <span>Start Cycle</span>
                      </button>
                    )}
                    {job.status === 'Running' && (
                      <button
                        onClick={() => handleCompleteJob(job.id)}
                        className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1 inline-flex transition-colors"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        <span>Finish Cycle</span>
                      </button>
                    )}
                    <button
                      onClick={() => setActiveJobDetail(job)}
                      className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium"
                    >
                      G-Code
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* G-Code & Tooling Inspect Modal */}
      {activeJobDetail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-slate-900 border border-slate-800 text-white rounded-2xl shadow-2xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="font-bold text-white text-sm font-mono flex items-center space-x-2">
                  <Terminal className="w-4 h-4 text-emerald-400" />
                  <span>{activeJobDetail.job_id_code} — G-Code Program</span>
                </h3>
                <p className="text-xs text-slate-400">{activeJobDetail.cnc_file_name}</p>
              </div>
              <button
                onClick={() => setActiveJobDetail(null)}
                className="text-slate-400 hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2 text-xs">
              <span className="text-[10px] text-slate-400 uppercase font-bold">Tooling Configuration</span>
              <p className="p-2.5 bg-slate-800 rounded-lg text-slate-200 font-mono text-[11px]">
                {activeJobDetail.tooling_notes}
              </p>
            </div>

            <div className="space-y-2 text-xs">
              <span className="text-[10px] text-slate-400 uppercase font-bold">G-Code Header Preview</span>
              <pre className="p-3 bg-black/60 border border-slate-800 rounded-lg text-emerald-400 font-mono text-[11px] overflow-x-auto">
                {activeJobDetail.gcode_snippet || 'G00 X0 Y0 Z50\nM03 S18000\nG01 Z-18 F4000\nM05'}
              </pre>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActiveJobDetail(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload New Version Modal */}
      {showUploadModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-2">
              <Plus className="w-4 h-4 text-amber-600" />
              <span>Register New CNC Program Revision</span>
            </h3>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                File Name
              </label>
              <input
                type="text"
                placeholder="e.g. CNC-CAR003-P01-Rev2.bpp"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Revision Tag
              </label>
              <input
                type="text"
                value={newRevision}
                onChange={(e) => setNewRevision(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Target Machine
              </label>
              <select
                aria-label="Target Machine"
                value={newMachine}
                onChange={(e) => setNewMachine(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-medium"
              >
                <option value="Biesse Rover B FT 2231 (bSolid v4)">Biesse Rover B FT 2231 (bSolid v4)</option>
                <option value="Homag Centateq P-110 (woodWOP 7)">Homag Centateq P-110 (woodWOP 7)</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowUploadModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadVersion}
                disabled={!newFileName.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 rounded-lg text-xs font-bold shadow-xs"
              >
                Upload Revision
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
