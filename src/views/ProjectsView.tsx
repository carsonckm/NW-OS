/**
 * NW OS Projects Portfolio & Work Package Management View
 * Features:
 * 1. Project cards with trade package counts and rapid selection.
 * 2. Dedicated WORK PACKAGES section inside each Project.
 * 3. Prominent "+ New Work Package" button.
 * 4. Interactive Work Package Detail view showing trade, contractor, PM, schedule,
 *    progress, status, scope/notes, and granular Work Items with "+ New Work Item".
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Project, WorkPackage } from '../types';
import { NewProjectModal } from '../components/NewProjectModal';
import { NewWorkPackageModal } from '../components/NewWorkPackageModal';
import { WorkPackageDetailModal } from '../components/WorkPackageDetailModal';
import { ProjectCommandCenter } from '../components/ProjectCommandCenter';
import { hasPermission, canViewProjectFinancials } from '../utils/permissions';
import {
  Building2,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  MapPin,
  ChevronRight,
  Plus,
  X,
  Layers,
  Wrench,
  User,
  Clock,
  ArrowRight,
  Percent,
  FileText,
  Search,
  Filter,
  SlidersHorizontal,
  LayoutDashboard,
} from 'lucide-react';

interface ProjectsViewProps {
  onSelectProject: (projectId: string) => void;
  onNavigateToWorkItems: () => void;
  onNavigateToContractor?: (contractorId: string) => void;
}

export const ProjectsView: React.FC<ProjectsViewProps> = ({
  onSelectProject,
  onNavigateToWorkItems,
  onNavigateToContractor,
}) => {
  const {
    currentUser,
    projects,
    userProjects,
    clients,
    contractors,
    workPackages,
    workItems,
    selectedProjectId,
    setSelectedProjectId,
  } = useNW();

  const [viewMode, setViewMode] = useState<'command_center' | 'portfolio'>('command_center');
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showWorkPackageModal, setShowWorkPackageModal] = useState(false);
  const [packageTargetProjectId, setPackageTargetProjectId] = useState<string | undefined>(undefined);
  const [selectedWorkPackageId, setSelectedWorkPackageId] = useState<string | null>(null);
  const [tradeFilter, setTradeFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Project-level access isolation
  const accessibleProjects = userProjects.length > 0 ? userProjects : projects;

  // Currently active project
  const currentProject =
    accessibleProjects.find((p) => p.id === selectedProjectId) || accessibleProjects[0] || null;

  const canCreateProject = hasPermission(currentUser, 'projects.create');
  const canSeeFinancials = canViewProjectFinancials(currentUser);

  const handleSuccess = (_proj: Project, msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  const handleWorkPackageSuccess = (_wp: WorkPackage, msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Get packages for current project
  const projectPackages = currentProject
    ? workPackages.filter((wp) => wp.project_id === currentProject.id)
    : [];

  // Filtered packages by trade and status
  const filteredPackages = projectPackages.filter((wp) => {
    const matchesTrade =
      tradeFilter === 'All' || wp.category === tradeFilter || wp.trade === tradeFilter;
    const matchesStatus = statusFilter === 'All' || wp.status === statusFilter;
    return matchesTrade && matchesStatus;
  });

  const getStatusBadgeClass = (status: string) => {
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

  const getTradeColorClass = (trade: string) => {
    switch (trade) {
      case 'Carpentry':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'Electrical':
        return 'bg-yellow-100 text-yellow-900 border-yellow-300';
      case 'Glass':
        return 'bg-cyan-100 text-cyan-900 border-cyan-300';
      case 'Metal':
        return 'bg-slate-200 text-slate-900 border-slate-400';
      case 'Painting':
        return 'bg-purple-100 text-purple-900 border-purple-300';
      case 'Ceiling':
        return 'bg-indigo-100 text-indigo-900 border-indigo-300';
      case 'Flooring':
        return 'bg-stone-100 text-stone-900 border-stone-300';
      case 'Plumbing':
        return 'bg-blue-100 text-blue-900 border-blue-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  if (viewMode === 'command_center' && currentProject) {
    return (
      <div className="space-y-4">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in slide-in-from-top duration-200">
            <div className="bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-xs font-bold border border-emerald-500">
              <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
              <span>{toastMessage}</span>
              <button
                onClick={() => setToastMessage(null)}
                className="ml-2 hover:bg-emerald-700/60 p-1 rounded-lg text-emerald-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* View Mode Switcher Header */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-2xs self-start">
            <button
              onClick={() => setViewMode('command_center')}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-white text-slate-900 shadow-2xs flex items-center space-x-1.5"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-amber-600" />
              <span>Project Command Center</span>
            </button>
            <button
              onClick={() => setViewMode('portfolio')}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all text-slate-600 hover:text-slate-900 flex items-center space-x-1.5 cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 text-slate-400" />
              <span>All Projects Portfolio ({accessibleProjects.length})</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {canCreateProject && (
              <button
                onClick={() => setShowNewProjectModal(true)}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center space-x-1.5 shadow-2xs cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-amber-400" />
                <span>+ New Project</span>
              </button>
            )}
          </div>
        </div>

        {/* Project Command Center View */}
        <ProjectCommandCenter
          projectId={currentProject.id}
          onBackToPortfolio={() => setViewMode('portfolio')}
          onNavigateToTab={(tab) => {
            if (tab === 'work-items') onNavigateToWorkItems();
            if (tab === 'contractors' && onNavigateToContractor) onNavigateToContractor('');
          }}
        />

        {showNewProjectModal && (
          <NewProjectModal
            isOpen={showNewProjectModal}
            onClose={() => setShowNewProjectModal(false)}
            onSuccess={handleSuccess}
          />
        )}
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in slide-in-from-top duration-200">
          <div className="bg-emerald-600 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-xs font-bold border border-emerald-500">
            <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
            <span>{toastMessage}</span>
            <button
              onClick={() => setToastMessage(null)}
              className="ml-2 hover:bg-emerald-700/60 p-1 rounded-lg text-emerald-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Header & View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold uppercase tracking-widest">
              Commercial Fit-Out Portfolio
            </span>
            <span className="text-xs text-slate-500 font-medium font-mono">
              {projects.length} Active Sites
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            Projects & Trade Packages
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Click any project to enter its full Project Command Center.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {currentProject && (
            <button
              onClick={() => setViewMode('command_center')}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-xl shadow-2xs flex items-center space-x-1.5 transition-colors cursor-pointer"
            >
              <LayoutDashboard className="w-4 h-4 text-slate-950" />
              <span>Command Center: {currentProject.project_number}</span>
            </button>
          )}

          {canCreateProject && (
            <button
              onClick={() => setShowNewProjectModal(true)}
              className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-xs flex items-center space-x-2 cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              id="btn-new-project"
            >
              <Plus className="w-4 h-4 text-amber-400" />
              <span>+ New Project</span>
            </button>
          )}
        </div>
      </div>

      {/* Projects Grid Selector */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Select Active Project ({accessibleProjects.length})
          </span>
          <span className="text-[11px] text-slate-500">
            Click any project to manage its Work Packages
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {accessibleProjects.map((proj) => {
            const isSelected = proj.id === currentProject?.id;
            const client = clients.find((c) => c.id === proj.client_id);
            const packageCount = workPackages.filter((wp) => wp.project_id === proj.id).length;

            return (
              <div
                key={proj.id}
                onClick={() => {
                  setSelectedProjectId(proj.id);
                  onSelectProject(proj.id);
                  setViewMode('command_center');
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer shadow-xs space-y-3 ${
                  isSelected
                    ? 'bg-white border-amber-500 ring-2 ring-amber-500/30'
                    : 'bg-white border-slate-200 hover:border-amber-300 hover:shadow-md'
                }`}
                id={`project-card-${proj.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                        {proj.project_number}
                      </span>
                      {client && (
                        <span
                          className="text-[10px] text-slate-500 font-bold truncate max-w-[130px]"
                          title={client.company_name}
                        >
                          {client.company_name}
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 mt-1 line-clamp-1">
                      {proj.project_name.split('—')[0]}
                    </h3>
                  </div>

                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase shrink-0 ${
                      proj.project_status === 'Active'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    {proj.project_status}
                  </span>
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-slate-500 font-medium">Overall Progress</span>
                    <span className="text-slate-900 font-mono font-bold">
                      {proj.progress_percent}%
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-500 ${
                        proj.is_at_risk ? 'bg-amber-500' : 'bg-emerald-500'
                      }`}
                      style={{ width: `${proj.progress_percent}%` }}
                    />
                  </div>
                </div>

                {/* Package Count badge & Quick Add */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                  <span className="text-[11px] font-semibold text-slate-600 flex items-center space-x-1">
                    <Layers className="w-3.5 h-3.5 text-amber-600" />
                    <span>
                      {packageCount} Work Package{packageCount !== 1 ? 's' : ''}
                    </span>
                  </span>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedProjectId(proj.id);
                      setPackageTargetProjectId(proj.id);
                      setShowWorkPackageModal(true);
                    }}
                    className="px-2.5 py-1 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-200 rounded-lg text-[11px] font-bold flex items-center space-x-1 cursor-pointer transition-colors"
                  >
                    <Plus className="w-3 h-3 text-amber-700" />
                    <span>+ Package</span>
                  </button>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedProjectId(proj.id);
                    onSelectProject(proj.id);
                    setViewMode('command_center');
                  }}
                  className="w-full py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center justify-center space-x-1.5 shadow-2xs transition-colors cursor-pointer"
                >
                  <LayoutDashboard className="w-3.5 h-3.5 text-amber-400" />
                  <span>Open Command Center</span>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* DEDICATED PROJECT DETAIL & WORK PACKAGES SECTION */}
      {currentProject && (
        <div
          className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6"
          id="project-detail-container"
        >
          {/* Project Header Banner */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-200">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200">
                  {currentProject.project_number}
                </span>
                <span className="text-xs text-slate-500 font-semibold">
                  Client:{' '}
                  <strong className="text-slate-900">
                    {clients.find((c) => c.id === currentProject.client_id)?.company_name ||
                      'Client Unassigned'}
                  </strong>
                </span>
                <span className="text-slate-300">•</span>
                <span className="text-xs text-slate-500 flex items-center space-x-1">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span>{currentProject.site_address}</span>
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-slate-900 mt-2">
                {currentProject.project_name}
              </h2>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 text-right">
                <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">
                  Contract Value
                </span>
                <span className="font-mono font-bold text-sm text-slate-900">
                  RM {(currentProject.contract_value / 1000).toFixed(0)}k
                </span>
              </div>
              <div className="bg-slate-50 border border-slate-200 rounded-2xl px-4 py-2 text-right">
                <span className="text-[10px] text-slate-400 block uppercase font-bold tracking-wider">
                  Target Handover
                </span>
                <span className="font-mono font-bold text-sm text-slate-900">
                  {currentProject.end_date}
                </span>
              </div>
            </div>
          </div>

          {/* WORK PACKAGES SECTION (Mandated section with clearly visible button) */}
          <div className="space-y-4" id="work-packages-section">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-700">
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight">
                    WORK PACKAGES
                  </h3>
                  <p className="text-xs text-slate-500">
                    Trade scopes, assigned contractors, and manufacturing milestones inside this project.
                  </p>
                </div>
              </div>

              {/* Clearly visible "+ New Work Package" button */}
              <button
                onClick={() => {
                  setPackageTargetProjectId(currentProject.id);
                  setShowWorkPackageModal(true);
                }}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 font-bold text-xs rounded-xl shadow-xs flex items-center space-x-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98] self-start sm:self-auto"
                id="btn-new-work-package"
              >
                <Plus className="w-4 h-4 text-slate-950" />
                <span>+ New Work Package</span>
              </button>
            </div>

            {/* Filter Tabs / Controls */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-bold text-slate-500 mr-1">Trade:</span>
              {[
                'All',
                'Carpentry',
                'Electrical',
                'Glass',
                'Metal',
                'Painting',
                'Ceiling',
                'Flooring',
                'Plumbing',
                'Other',
              ].map((trade) => (
                <button
                  key={trade}
                  onClick={() => setTradeFilter(trade)}
                  className={`px-3 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                    tradeFilter === trade
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {trade}
                </button>
              ))}
            </div>

            {/* Work Packages List / Cards */}
            {filteredPackages.length === 0 ? (
              <div className="p-10 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 space-y-3">
                <Layers className="w-10 h-10 text-slate-400 mx-auto" />
                <div>
                  <h4 className="text-sm font-bold text-slate-800">
                    No work packages found
                    {tradeFilter !== 'All' ? ` for ${tradeFilter}` : ' for this project yet'}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Assign trade packages like Carpentry, Glass, Electrical, or Metalwork to qualified
                    contractors to begin granular tracking.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setPackageTargetProjectId(currentProject.id);
                    setShowWorkPackageModal(true);
                  }}
                  className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs inline-flex items-center space-x-2 cursor-pointer"
                  id="btn-empty-new-work-package"
                >
                  <Plus className="w-4 h-4 text-slate-950" />
                  <span>+ New Work Package</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredPackages.map((wp) => {
                  const contractor = contractors.find((c) => c.id === wp.contractor_id);
                  const itemsForPackage = workItems.filter((item) => item.work_package_id === wp.id);

                  return (
                    <div
                      key={wp.id}
                      onClick={() => setSelectedWorkPackageId(wp.id)}
                      className="p-5 bg-white hover:bg-amber-50/20 border border-slate-200 hover:border-amber-400 rounded-2xl transition-all shadow-xs space-y-4 cursor-pointer relative group"
                      id={`work-package-card-${wp.id}`}
                    >
                      {/* Package Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getTradeColorClass(
                                wp.category || wp.trade || 'Carpentry'
                              )}`}
                            >
                              {wp.category || wp.trade}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${getStatusBadgeClass(
                                wp.status
                              )}`}
                            >
                              {wp.status}
                            </span>
                          </div>
                          <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight group-hover:text-amber-900 transition-colors">
                            {wp.name}
                          </h4>
                        </div>

                        <span className="p-1.5 bg-slate-100 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-500 rounded-xl transition-colors">
                          <ChevronRight className="w-4 h-4" />
                        </span>
                      </div>

                      {/* Contractor & PM info */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs bg-slate-50 p-3 rounded-xl border border-slate-100">
                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                            Contractor
                          </span>
                          <span className="font-bold text-slate-900 truncate block">
                            {contractor ? contractor.company_name : 'Unassigned'}
                          </span>
                          {contractor && (
                            <span className="text-[10px] text-slate-500 truncate block">
                              {contractor.contact_person} • {contractor.phone}
                            </span>
                          )}
                        </div>

                        <div>
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                            Schedule
                          </span>
                          <span className="font-mono text-slate-800 text-[11px] block">
                            {wp.start_date} → {wp.end_date}
                          </span>
                          <span className="text-[10px] text-slate-500">
                            PM: Marcus Lee
                          </span>
                        </div>
                      </div>

                      {/* Progress Bar & Items count */}
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-500 font-medium">Trade Completion</span>
                          <span className="font-mono font-bold text-slate-900">
                            {wp.progress_percent}%
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className="bg-amber-500 h-full rounded-full transition-all duration-300"
                            style={{ width: `${wp.progress_percent}%` }}
                          />
                        </div>
                      </div>

                      {/* Scope snippet & Work Items Count */}
                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                        <span className="text-slate-500 text-[11px] truncate max-w-[200px]">
                          {wp.scope || wp.notes || 'No scope notes specified'}
                        </span>
                        <span className="font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded text-[11px]">
                          {itemsForPackage.length} Work Item{itemsForPackage.length !== 1 ? 's' : ''}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* New Project Modal */}
      <NewProjectModal
        isOpen={showNewProjectModal}
        onClose={() => setShowNewProjectModal(false)}
        onSuccess={handleSuccess}
      />

      {/* New Work Package Modal */}
      <NewWorkPackageModal
        isOpen={showWorkPackageModal}
        onClose={() => setShowWorkPackageModal(false)}
        onSuccess={handleWorkPackageSuccess}
        defaultProjectId={packageTargetProjectId || currentProject?.id}
      />

      {/* Work Package Detail Modal */}
      <WorkPackageDetailModal
        isOpen={!!selectedWorkPackageId}
        onClose={() => setSelectedWorkPackageId(null)}
        workPackageId={selectedWorkPackageId}
        onNavigateToContractor={onNavigateToContractor}
      />
    </div>
  );
};
