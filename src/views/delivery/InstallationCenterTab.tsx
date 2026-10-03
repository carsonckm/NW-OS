import React, { useState } from 'react';
import {
  Hammer,
  Play,
  Pause,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Ruler,
  Clock,
  ShieldCheck,
  MapPin,
  User,
  Users,
  Calendar,
  Layers,
  FileText,
  Sliders,
  CheckSquare,
  Square,
  HelpCircle,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { InstallationJob, InstallationJobStatus, SiteReadinessCheck } from '../../types';

interface InstallationCenterTabProps {
  onOpenMeasurementModal?: (job: InstallationJob) => void;
  onOpenProblemModal?: (job: InstallationJob) => void;
  onOpenPhotoModal?: (job: InstallationJob) => void;
  onOpenQCModal?: (job: InstallationJob) => void;
}

export const InstallationCenterTab: React.FC<InstallationCenterTabProps> = ({
  onOpenMeasurementModal,
  onOpenProblemModal,
  onOpenPhotoModal,
  onOpenQCModal,
}) => {
  const {
    installationJobs,
    updateInstallationStatus,
    updateInstallationChecklist,
    updateSiteReadiness,
    currentUser,
  } = useNW();

  const [activeStageFilter, setActiveStageFilter] = useState<string>('all');
  const [selectedJobId, setSelectedJobId] = useState<string>(installationJobs[0]?.id || '');
  const [showReadinessModal, setShowReadinessModal] = useState(false);

  const selectedJob = installationJobs.find((j) => j.id === selectedJobId) || installationJobs[0];

  const stages: { label: string; value: string; count: number; color: string }[] = [
    { label: 'All Jobs', value: 'all', count: installationJobs.length, color: 'text-slate-800' },
    { label: 'In Progress', value: 'In Progress', count: installationJobs.filter((j) => j.status === 'In Progress').length, color: 'text-orange-600' },
    { label: 'Scheduled', value: 'Scheduled', count: installationJobs.filter((j) => j.status === 'Scheduled').length, color: 'text-blue-600' },
    { label: 'Site Ready', value: 'Site Ready', count: installationJobs.filter((j) => j.status === 'Site Ready').length, color: 'text-emerald-600' },
    { label: 'Awaiting Inspection / QC', value: 'Awaiting Inspection', count: installationJobs.filter((j) => j.status === 'Awaiting Inspection' || j.status === 'QC').length, color: 'text-purple-600' },
    { label: 'Rectification', value: 'Rectification', count: installationJobs.filter((j) => j.status === 'Rectification').length, color: 'text-rose-600' },
    { label: 'Blocked / Delayed', value: 'Blocked', count: installationJobs.filter((j) => j.status === 'Blocked' || j.status === 'Delayed').length, color: 'text-red-600' },
    { label: 'Completed', value: 'Completed', count: installationJobs.filter((j) => j.status === 'Completed').length, color: 'text-teal-600' },
  ];

  const filteredJobs = installationJobs.filter((j) => {
    if (activeStageFilter === 'all') return true;
    if (activeStageFilter === 'Awaiting Inspection') return j.status === 'Awaiting Inspection' || j.status === 'QC';
    if (activeStageFilter === 'Blocked') return j.status === 'Blocked' || j.status === 'Delayed';
    return j.status === activeStageFilter;
  });

  const getStatusBadge = (status: InstallationJobStatus) => {
    switch (status) {
      case 'In Progress':
        return 'bg-orange-100 text-orange-900 border-orange-200';
      case 'Scheduled':
        return 'bg-blue-100 text-blue-900 border-blue-200';
      case 'Site Ready':
        return 'bg-emerald-100 text-emerald-900 border-emerald-200';
      case 'Awaiting Inspection':
      case 'QC':
        return 'bg-purple-100 text-purple-900 border-purple-200';
      case 'Rectification':
        return 'bg-rose-100 text-rose-900 border-rose-200 animate-pulse';
      case 'Completed':
        return 'bg-teal-100 text-teal-900 border-teal-200';
      case 'Blocked':
      case 'Delayed':
        return 'bg-red-100 text-red-900 border-red-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const handleProgressButtonClick = (percent: number) => {
    if (!selectedJob) return;
    updateInstallationChecklist(selectedJob.id, {}, percent);
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-orange-100 text-orange-900 rounded-lg">
              <Hammer className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              INSTALLATION COMMAND CENTER
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Site-level carpentry & joinery mounting, digital level checks, parts assembly progress, and supervisor sign-offs.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={() => setShowReadinessModal(true)}
            className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center space-x-1.5"
          >
            <ShieldCheck className="w-4 h-4" />
            <span>Site Readiness Check</span>
          </button>
        </div>
      </div>

      {/* Stage Selector Pills */}
      <div className="flex flex-wrap gap-2 pb-1">
        {stages.map((st) => (
          <button
            key={st.value}
            onClick={() => setActiveStageFilter(st.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all border ${
              activeStageFilter === st.value
                ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                : 'bg-white hover:bg-slate-50 text-slate-600 border-slate-200'
            }`}
          >
            <span>{st.label}</span>
            <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-white/20">
              {st.count}
            </span>
          </button>
        ))}
      </div>

      {/* Main Grid: Job Cards List (5 cols) & Active Job Mobile Screen (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Job Cards List */}
        <div className="lg:col-span-5 space-y-3">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
            Installation Jobs ({filteredJobs.length})
          </div>

          <div className="space-y-3 max-h-[780px] overflow-y-auto pr-1">
            {filteredJobs.map((job) => {
              const isSelected = job.id === selectedJob?.id;
              return (
                <div
                  key={job.id}
                  onClick={() => setSelectedJobId(job.id)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all duration-150 ${
                    isSelected
                      ? 'bg-amber-50/60 border-amber-400 shadow-md ring-1 ring-amber-400'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-black text-slate-800">
                      {job.job_number}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${getStatusBadge(job.status)}`}>
                      {job.status}
                    </span>
                  </div>

                  <h4 className="text-sm font-black text-slate-900 mt-1">
                    {job.work_item_code} — {job.work_item_description}
                  </h4>
                  <p className="text-xs text-slate-500 font-medium truncate mt-0.5">
                    {job.project_name}
                  </p>

                  <div className="flex items-center space-x-2 mt-2 text-xs text-slate-600">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{job.location}</span>
                  </div>

                  {/* Progress Bar & Parts Count */}
                  <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div className="flex-1 mr-4">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="font-bold text-slate-700">{job.progress_percent}% installed</span>
                        <span className="text-slate-400">
                          {job.installed_parts_count || Math.round((job.progress_percent / 100) * (job.total_parts_count || 8))} / {job.total_parts_count || 8} parts
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-amber-500 h-full rounded-full transition-all"
                          style={{ width: `${job.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Lead</span>
                      <span className="font-bold text-slate-800 text-[11px] truncate">{job.lead_installer?.split(' ')[0]}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Mobile-First Supervisor Action Screen (Section 19) */}
        {selectedJob && (
          <div className="lg:col-span-7 space-y-5">
            {/* Active Job Header Details */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-100">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-black text-slate-700">
                      {selectedJob.job_number}
                    </span>
                    <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${getStatusBadge(selectedJob.status)}`}>
                      {selectedJob.status}
                    </span>
                  </div>
                  <h3 className="text-lg font-black text-slate-900 mt-1">
                    {selectedJob.work_item_code}: {selectedJob.work_item_description}
                  </h3>
                  <p className="text-xs text-slate-500 font-medium">
                    {selectedJob.project_name} • {selectedJob.location}
                  </p>
                </div>

                <div className="flex items-center space-x-2 text-xs">
                  <span className="px-2.5 py-1 bg-slate-100 text-slate-800 rounded-lg font-bold border border-slate-200 flex items-center space-x-1">
                    <Users className="w-3.5 h-3.5 text-slate-500" />
                    <span>{selectedJob.team_headcount} Joiners</span>
                  </span>
                </div>
              </div>

              {/* SECTION 19: Large Mobile-First Action Buttons */}
              <div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
                  Site Supervisor Quick Actions (Section 19 Mobile-First Screen)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <button
                    onClick={() => onOpenPhotoModal && onOpenPhotoModal(selectedJob)}
                    className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-xl font-bold text-xs flex flex-col items-center justify-center space-y-1 transition-all shadow-2xs"
                  >
                    <Camera className="w-5 h-5 text-indigo-600" />
                    <span>📸 Progress Photo</span>
                  </button>

                  <button
                    onClick={() => onOpenMeasurementModal && onOpenMeasurementModal(selectedJob)}
                    className="p-3 bg-slate-100 hover:bg-slate-200 text-slate-900 rounded-xl font-bold text-xs flex flex-col items-center justify-center space-y-1 transition-all shadow-2xs"
                  >
                    <Ruler className="w-5 h-5 text-amber-600" />
                    <span>📏 Measurement</span>
                  </button>

                  <button
                    onClick={() => onOpenProblemModal && onOpenProblemModal(selectedJob)}
                    className="p-3 bg-rose-50 hover:bg-rose-100 text-rose-900 rounded-xl font-bold text-xs flex flex-col items-center justify-center space-y-1 transition-all border border-rose-200"
                  >
                    <AlertTriangle className="w-5 h-5 text-rose-600" />
                    <span>⚠️ Problem</span>
                  </button>

                  <button
                    onClick={() => onOpenQCModal && onOpenQCModal(selectedJob)}
                    className="p-3 bg-purple-50 hover:bg-purple-100 text-purple-900 rounded-xl font-bold text-xs flex flex-col items-center justify-center space-y-1 transition-all border border-purple-200"
                  >
                    <ShieldCheck className="w-5 h-5 text-purple-600" />
                    <span>🔍 QC Sign-off</span>
                  </button>
                </div>

                {/* Workflow Status Controls: Start, Pause, Complete */}
                <div className="grid grid-cols-3 gap-2 mt-2.5">
                  <button
                    disabled={selectedJob.status === 'In Progress'}
                    onClick={() => updateInstallationStatus(selectedJob.id, 'In Progress', 'Lead craftsman initiated site mounting')}
                    className={`p-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all ${
                      selectedJob.status === 'In Progress'
                        ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                    }`}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>▶ Start</span>
                  </button>

                  <button
                    disabled={selectedJob.status !== 'In Progress'}
                    onClick={() => updateInstallationStatus(selectedJob.id, 'Blocked', 'Paused pending site trade clearing')}
                    className="p-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all"
                  >
                    <Pause className="w-4 h-4" />
                    <span>⏸ Pause</span>
                  </button>

                  <button
                    disabled={selectedJob.status === 'Completed'}
                    onClick={() => updateInstallationStatus(selectedJob.id, 'Completed', 'Carpentry installed. Submitted for supervisor QC')}
                    className="p-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all shadow-xs"
                  >
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span>✅ Complete</span>
                  </button>
                </div>
              </div>

              {/* Section 20: Progress Steps (0%, 25%, 50%, 75%, 100%) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700">Installation Progress (Section 20):</span>
                  <span className="font-black text-amber-900 text-sm">
                    {selectedJob.progress_percent}% ({selectedJob.installed_parts_count || 0} / {selectedJob.total_parts_count || 8} parts)
                  </span>
                </div>

                <div className="grid grid-cols-5 gap-1.5">
                  {[0, 25, 50, 75, 100].map((step) => (
                    <button
                      key={step}
                      onClick={() => handleProgressButtonClick(step)}
                      className={`py-2 rounded-lg text-xs font-black transition-all ${
                        selectedJob.progress_percent === step
                          ? 'bg-amber-500 text-slate-950 shadow-xs'
                          : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                      }`}
                    >
                      {step}%
                    </button>
                  ))}
                </div>
              </div>

              {/* 8-Point Site Installation Checklist (Section 16) */}
              <div className="pt-3 border-t border-slate-100 space-y-2">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-black text-slate-800 uppercase tracking-tight">
                    Site Technical Checklist (Section 16)
                  </span>
                  <span className="text-[10px] font-bold text-slate-400">
                    Live Field Validation
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  {[
                    { key: 'level_plumb', label: 'Level & Plumb Verified (Spirit Level)' },
                    { key: 'secure_fixing', label: 'Secure Fixing (Cleats & Anchors)' },
                    { key: 'alignment_adjacent', label: 'Alignment with Adjacent Joinery' },
                    { key: 'hardware_operation', label: 'Hardware Operation (Hinges & Slides)' },
                    { key: 'surface_condition', label: 'Surface Condition (Zero Scratches)' },
                    { key: 'joint_sealant_tolerances', label: 'Joint Sealant & Gap Tolerances' },
                    { key: 'services_integration', label: 'Services Integration (Power / Data cutouts)' },
                    { key: 'cleanliness_protection', label: 'Cleanliness & Protective Film Intact' },
                  ].map((chk) => {
                    const isPassed = !!(selectedJob.checklist as any)[chk.key];
                    return (
                      <button
                        key={chk.key}
                        onClick={() =>
                          updateInstallationChecklist(selectedJob.id, {
                            [chk.key]: !isPassed,
                          })
                        }
                        className={`p-2.5 rounded-lg border text-left flex items-center justify-between transition-colors ${
                          isPassed
                            ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-bold'
                            : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          {isPassed ? (
                            <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <Square className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                          <span className="truncate">{chk.label}</span>
                        </div>
                        <span className="text-[10px] font-bold uppercase ml-1 shrink-0 text-slate-400">
                          {isPassed ? 'OK' : '-'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Site Readiness Modal (Section 18) */}
      {showReadinessModal && selectedJob && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-black text-slate-900">
                  Site Readiness Inspection (Section 18)
                </h3>
              </div>
              <button
                onClick={() => setShowReadinessModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-slate-500 mt-2 mb-4">
              Validate site conditions before joinery crews start mounting for{' '}
              <span className="font-bold text-slate-800">{selectedJob.work_item_code}</span>. If conditions fail, a site issue will be generated automatically.
            </p>

            <div className="space-y-2 text-xs">
              {[
                { key: 'site_accessible', label: 'Site Accessible & Hoist Working' },
                { key: 'area_clear', label: 'Installation Area Clear of Debris' },
                { key: 'other_trades_completed', label: 'Drywall & Pre-wiring Completed' },
                { key: 'power_available', label: 'Temporary Power 240V Available' },
                { key: 'lighting_available', label: 'Site Working Lighting Adequate' },
                { key: 'flooring_wall_acceptable', label: 'Flooring / Screed Level & Dry' },
                { key: 'measurements_confirmed', label: 'Site Measurements Confirmed' },
                { key: 'approved_drawings_available', label: 'Approved NW Production Drawings On Site' },
                { key: 'materials_received', label: 'Carpentry Modules Received in Good Order' },
                { key: 'tools_equipment_available', label: 'Required Joinery Tools Available' },
                { key: 'safety_requirements_satisfied', label: 'PPE & Safety Inductions Completed' },
              ].map((c) => {
                const readiness = selectedJob.site_readiness;
                const isChecked = !!(readiness as any)?.[c.key];
                return (
                  <button
                    key={c.key}
                    onClick={() =>
                      updateSiteReadiness(selectedJob.id, {
                        [c.key]: !isChecked,
                      })
                    }
                    className={`w-full p-2.5 rounded-lg border text-left flex items-center justify-between transition-colors ${
                      isChecked
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-bold'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <div className="flex items-center space-x-2">
                      {isChecked ? (
                        <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <Square className="w-4 h-4 text-slate-400 shrink-0" />
                      )}
                      <span>{c.label}</span>
                    </div>
                    <span className="text-[10px] uppercase font-bold text-slate-400">
                      {isChecked ? 'READY' : 'NOT READY'}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">
                Evaluation Result:{' '}
                <span className="text-emerald-700 uppercase font-black">
                  {selectedJob.site_readiness?.result || 'READY'}
                </span>
              </span>

              <button
                onClick={() => setShowReadinessModal(false)}
                className="px-4 py-2 bg-slate-900 text-white rounded-lg text-xs font-bold shadow-sm"
              >
                Save & Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
