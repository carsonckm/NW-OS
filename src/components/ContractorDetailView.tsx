/**
 * NW OS — Contractor Detail View
 * Comprehensive contractor profile with trade qualifications, cross-project work packages,
 * granular work items, and audit trail.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { Contractor, Project, WorkPackage } from '../types';
import {
  ArrowLeft,
  Building2,
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Wrench,
  Layers,
  Clock,
  Edit,
  Plus,
  ChevronRight,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileText,
  Truck,
  Hash,
  Activity,
  Power,
} from 'lucide-react';

interface ContractorDetailViewProps {
  contractor: Contractor;
  onBack: () => void;
  onEditContractor: (contractor: Contractor) => void;
  onAssignWorkPackage: (contractorId: string) => void;
  onNavigateToWorkItems?: (projectId: string) => void;
}

export const ContractorDetailView: React.FC<ContractorDetailViewProps> = ({
  contractor,
  onBack,
  onEditContractor,
  onAssignWorkPackage,
  onNavigateToWorkItems,
}) => {
  const {
    projects,
    workPackages,
    workItems,
    auditLogs,
    deactivateContractor,
    setSelectedProjectId,
  } = useNW();

  const [activeTab, setActiveTab] = useState<'work-packages' | 'projects' | 'work-items' | 'activity'>('work-packages');
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const showNotice = (msg: string) => {
    setActionNotice(msg);
    setTimeout(() => setActionNotice(null), 4000);
  };

  // Find all work packages assigned to this contractor
  const assignedPackages = workPackages.filter((wp) => wp.contractor_id === contractor.id);

  // Find all distinct projects where this contractor has work packages
  const contractorProjectIds = new Set(assignedPackages.map((wp) => wp.project_id));
  const assignedProjects = projects.filter((p) => contractorProjectIds.has(p.id));

  // Find all work items assigned to this contractor or belonging to contractor's work packages
  const assignedPackageIds = new Set(assignedPackages.map((wp) => wp.id));
  const assignedWorkItems = workItems.filter(
    (item) => item.contractor_id === contractor.id || assignedPackageIds.has(item.work_package_id)
  );

  // Audit logs related to this contractor
  const contractorLogs = auditLogs.filter(
    (log) =>
      log.object_id === contractor.id ||
      (log.new_value && log.new_value.toLowerCase().includes(contractor.company_name.toLowerCase())) ||
      assignedPackages.some((wp) => wp.id === log.object_id)
  );

  const isActive = contractor.is_active !== false;

  const handleToggleActive = () => {
    deactivateContractor(contractor.id);
    showNotice(
      isActive
        ? `Contractor ${contractor.company_name} has been deactivated.`
        : `Contractor ${contractor.company_name} is now active.`
    );
  };

  const getTradeColor = (trade: string) => {
    switch (trade) {
      case 'Carpentry':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'Electrical':
        return 'bg-yellow-100 text-yellow-900 border-yellow-300';
      case 'Glass':
        return 'bg-sky-100 text-sky-900 border-sky-300';
      case 'Metal':
        return 'bg-slate-200 text-slate-800 border-slate-300';
      case 'Painting':
        return 'bg-purple-100 text-purple-900 border-purple-300';
      case 'Ceiling':
        return 'bg-indigo-100 text-indigo-900 border-indigo-300';
      case 'Flooring':
        return 'bg-emerald-100 text-emerald-900 border-emerald-300';
      case 'Plumbing':
        return 'bg-cyan-100 text-cyan-900 border-cyan-300';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-300';
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800 animate-in fade-in duration-200">
      {/* Action Toast Notice */}
      {actionNotice && (
        <div className="fixed top-20 right-4 sm:right-8 z-50 animate-in slide-in-from-top duration-200">
          <div className="bg-slate-900 text-white px-4 py-3 rounded-2xl shadow-xl flex items-center space-x-2.5 text-xs font-bold border border-slate-700">
            <CheckCircle2 className="w-5 h-5 text-amber-400 shrink-0" />
            <span>{actionNotice}</span>
          </div>
        </div>
      )}

      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={onBack}
          className="inline-flex items-center space-x-2 text-xs font-bold text-slate-600 hover:text-slate-950 transition-colors cursor-pointer group"
          id="back-to-contractors-btn"
        >
          <div className="p-1.5 rounded-lg bg-white border border-slate-200 group-hover:border-slate-400 shadow-2xs">
            <ArrowLeft className="w-4 h-4" />
          </div>
          <span>Back to Contractor Directory</span>
        </button>

        {/* Primary Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={() => onAssignWorkPackage(contractor.id)}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-slate-950 text-xs font-bold rounded-xl shadow-xs flex items-center space-x-2 cursor-pointer transition-all hover:scale-[1.02] active:scale-[0.98]"
            id="assign-work-package-btn"
          >
            <Plus className="w-4 h-4 text-slate-950" />
            <span>+ Assign to Work Package</span>
          </button>

          <button
            onClick={() => onEditContractor(contractor)}
            className="px-4 py-2 bg-white hover:bg-slate-50 border border-slate-300 active:bg-slate-100 text-slate-800 text-xs font-bold rounded-xl shadow-2xs flex items-center space-x-2 cursor-pointer transition-colors"
            id="edit-contractor-btn"
          >
            <Edit className="w-4 h-4 text-slate-600" />
            <span>Edit Contractor</span>
          </button>

          <button
            onClick={handleToggleActive}
            className={`px-4 py-2 text-xs font-bold rounded-xl border shadow-2xs flex items-center space-x-2 cursor-pointer transition-colors ${
              isActive
                ? 'bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700'
                : 'bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700'
            }`}
            id="deactivate-contractor-btn"
          >
            <Power className="w-4 h-4" />
            <span>{isActive ? 'Deactivate Contractor' : 'Activate Contractor'}</span>
          </button>
        </div>
      </div>

      {/* Contractor Master Profile Card */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="flex items-start space-x-4">
            <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-700 shrink-0">
              <Wrench className="w-8 h-8" />
            </div>
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border uppercase tracking-wider ${getTradeColor(contractor.trade)}`}>
                  {contractor.trade}
                </span>

                <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold uppercase tracking-wider">
                  {contractor.contractor_type || 'Company'}
                </span>

                {/* Active / Inactive Status Badge */}
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border flex items-center space-x-1.5 uppercase tracking-wider ${
                    isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      : 'bg-slate-100 text-slate-600 border-slate-300'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                    }`}
                  />
                  <span>{isActive ? 'Active Status' : 'Inactive Status'}</span>
                </span>
              </div>

              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {contractor.company_name}
              </h1>

              {contractor.registration_number && (
                <div className="text-xs font-mono text-slate-500 flex items-center space-x-1.5">
                  <Hash className="w-3.5 h-3.5 text-slate-400" />
                  <span>SSM / Reg: {contractor.registration_number}</span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-3 sm:gap-6 bg-slate-50 border border-slate-200 rounded-2xl p-4 shrink-0">
            <div className="text-center sm:text-left">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Projects
              </span>
              <span className="text-lg sm:text-xl font-mono font-bold text-slate-900">
                {assignedProjects.length}
              </span>
            </div>
            <div className="text-center sm:text-left border-x border-slate-200 px-3 sm:px-6">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Work Packages
              </span>
              <span className="text-lg sm:text-xl font-mono font-bold text-amber-600">
                {assignedPackages.length}
              </span>
            </div>
            <div className="text-center sm:text-left">
              <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                Work Items
              </span>
              <span className="text-lg sm:text-xl font-mono font-bold text-slate-900">
                {assignedWorkItems.length}
              </span>
            </div>
          </div>
        </div>

        {/* Contact Information & Workshop Details */}
        <div className="pt-6 border-t border-slate-100 grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="space-y-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span>Contact Person</span>
            </span>
            <p className="text-xs font-bold text-slate-900">{contractor.contact_person}</p>
            <div className="flex items-center space-x-2 pt-1 text-xs text-slate-600">
              <Phone className="w-3.5 h-3.5 text-amber-600" />
              <a
                href={`tel:${contractor.phone}`}
                className="font-mono hover:text-amber-700 hover:underline font-semibold"
              >
                {contractor.phone}
              </a>
            </div>
            {contractor.email && (
              <div className="flex items-center space-x-2 pt-0.5 text-xs text-slate-600">
                <Mail className="w-3.5 h-3.5 text-amber-600" />
                <a
                  href={`mailto:${contractor.email}`}
                  className="font-mono hover:text-amber-700 hover:underline truncate max-w-xs"
                >
                  {contractor.email}
                </a>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span>Workshop / Factory Address</span>
            </span>
            <p className="text-xs text-slate-700 leading-relaxed">
              {contractor.address || 'No physical address recorded on file.'}
            </p>
          </div>

          <div className="space-y-1">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center space-x-1.5">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span>Specializations & Notes</span>
            </span>
            <p className="text-xs text-slate-600 italic leading-relaxed">
              {contractor.notes || 'No trade notes or specializations entered.'}
            </p>
          </div>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-slate-200 flex space-x-6 text-xs font-bold">
        <button
          onClick={() => setActiveTab('work-packages')}
          className={`pb-3 border-b-2 flex items-center space-x-2 cursor-pointer transition-colors ${
            activeTab === 'work-packages'
              ? 'border-amber-500 text-slate-950'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="tab-contractor-packages"
        >
          <Layers className="w-4 h-4" />
          <span>Assigned Work Packages ({assignedPackages.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('projects')}
          className={`pb-3 border-b-2 flex items-center space-x-2 cursor-pointer transition-colors ${
            activeTab === 'projects'
              ? 'border-amber-500 text-slate-950'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="tab-contractor-projects"
        >
          <Building2 className="w-4 h-4" />
          <span>Assigned Projects ({assignedProjects.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('work-items')}
          className={`pb-3 border-b-2 flex items-center space-x-2 cursor-pointer transition-colors ${
            activeTab === 'work-items'
              ? 'border-amber-500 text-slate-950'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="tab-contractor-items"
        >
          <Wrench className="w-4 h-4" />
          <span>Assigned Work Items ({assignedWorkItems.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('activity')}
          className={`pb-3 border-b-2 flex items-center space-x-2 cursor-pointer transition-colors ${
            activeTab === 'activity'
              ? 'border-amber-500 text-slate-950'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
          id="tab-contractor-activity"
        >
          <Activity className="w-4 h-4" />
          <span>Activity History ({contractorLogs.length})</span>
        </button>
      </div>

      {/* Tab 1: Assigned Work Packages */}
      {activeTab === 'work-packages' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              Work packages currently or previously contracted to {contractor.company_name} across commercial projects.
            </p>
            <button
              onClick={() => onAssignWorkPackage(contractor.id)}
              className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-2xs flex items-center space-x-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Assign New Package</span>
            </button>
          </div>

          {assignedPackages.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
              <Layers className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">No Work Packages Assigned Yet</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                This contractor has no active work package allocations. Assign them to a commercial fitout project to track delivery.
              </p>
              <button
                onClick={() => onAssignWorkPackage(contractor.id)}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-xs inline-flex items-center space-x-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Assign to First Work Package</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {assignedPackages.map((wp) => {
                const proj = projects.find((p) => p.id === wp.project_id);
                const itemsInPkg = workItems.filter((i) => i.work_package_id === wp.id);

                return (
                  <div
                    key={wp.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 hover:border-amber-400 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {wp.category}
                          </span>
                          {proj && (
                            <span className="text-[10px] font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                              {proj.project_number}
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 mt-1.5">{wp.name}</h3>
                        {proj && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{proj.project_name}</p>
                        )}
                      </div>

                      <span
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase shrink-0 ${
                          wp.status === 'Completed'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : wp.status === 'In Progress'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : wp.status === 'QC'
                            ? 'bg-sky-50 text-sky-700 border-sky-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}
                      >
                        {wp.status}
                      </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-500">Execution Progress</span>
                        <span className="font-mono font-bold text-slate-800">
                          {wp.progress_percent}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${wp.progress_percent}%` }}
                        />
                      </div>
                    </div>

                    {/* Schedule & Item Counts */}
                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                      <div className="flex items-center space-x-1.5 font-mono text-[11px]">
                        <Calendar className="w-3.5 h-3.5 text-slate-400" />
                        <span>{wp.start_date} → {wp.end_date}</span>
                      </div>
                      <div className="font-bold text-slate-700">
                        {itemsInPkg.length} Work Items
                      </div>
                    </div>

                    {wp.notes && (
                      <p className="text-[11px] text-slate-500 italic bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                        {wp.notes}
                      </p>
                    )}

                    {onNavigateToWorkItems && proj && (
                      <button
                        onClick={() => {
                          setSelectedProjectId(proj.id);
                          onNavigateToWorkItems(proj.id);
                        }}
                        className="w-full py-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold rounded-xl border border-slate-200 flex items-center justify-center space-x-1.5 transition-colors cursor-pointer"
                      >
                        <span>View Items in Work Register</span>
                        <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Assigned Projects */}
      {activeTab === 'projects' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Commercial contracts where {contractor.company_name} is contracted. (A contractor can be assigned across multiple projects).
          </p>

          {assignedProjects.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
              <Building2 className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">No Active Project Engagements</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Assign this contractor to a work package within an existing project to establish contract tracking.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {assignedProjects.map((proj) => {
                const pkgsOnProj = assignedPackages.filter((wp) => wp.project_id === proj.id);

                return (
                  <div
                    key={proj.id}
                    className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4 hover:border-amber-400 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <span className="text-xs font-mono font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                            {proj.project_number}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                              proj.project_status === 'Active'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border-slate-200'
                            }`}
                          >
                            {proj.project_status}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 mt-2 line-clamp-1">
                          {proj.project_name}
                        </h3>
                        <div className="text-[11px] text-slate-500 flex items-center space-x-1 mt-1">
                          <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                          <span className="truncate">{proj.site_address}</span>
                        </div>
                      </div>
                    </div>

                    {/* Work packages summary on this project */}
                    <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 space-y-2">
                      <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
                        Contracted Packages on this Site ({pkgsOnProj.length})
                      </span>
                      <div className="space-y-1">
                        {pkgsOnProj.map((pkg) => (
                          <div
                            key={pkg.id}
                            className="flex items-center justify-between text-xs py-1 border-b border-slate-200/60 last:border-none"
                          >
                            <span className="font-semibold text-slate-800">{pkg.name}</span>
                            <span className="font-mono text-slate-600">{pkg.progress_percent}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                      <span>Target Handover: {proj.end_date}</span>
                      <span className="font-mono font-bold text-slate-800">
                        Total Project Progress: {proj.progress_percent}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Assigned Work Items */}
      {activeTab === 'work-items' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Granular joinery, manufacturing, and installation items assigned to {contractor.company_name}.
          </p>

          {assignedWorkItems.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center space-y-3">
              <Wrench className="w-10 h-10 text-slate-300 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">No Granular Work Items Allocated</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Items are generated when drawings are reviewed or packages are scheduled for production.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Item Code & Details</th>
                      <th className="py-3 px-4">Trade Category</th>
                      <th className="py-3 px-4">Drawing & Specs</th>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4">Current Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {assignedWorkItems.map((item) => (
                      <tr key={item.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-mono font-bold text-amber-800">{item.item_code}</div>
                          <div className="font-semibold text-slate-900 mt-0.5">{item.description}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200 text-[10px] font-bold">
                            {item.category}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-mono text-slate-700 font-semibold text-[11px]">
                            {item.drawing_revision}
                          </div>
                          <div className="text-[10px] text-slate-400">{item.dimensions}</div>
                        </td>
                        <td className="py-3 px-4 text-slate-600">{item.location}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded text-[10px] font-bold border ${
                              item.status === 'Completed'
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : item.status === 'QC Passed'
                                ? 'bg-sky-50 text-sky-700 border-sky-200'
                                : item.status === 'Ready for QC'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : item.status === 'Delivered'
                                ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            {item.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Activity History */}
      {activeTab === 'activity' && (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Immutable audit record of contractor actions, qualifications, status toggles, and work assignments.
          </p>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs">
            {contractorLogs.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-xs">
                No activity logs recorded for this contractor yet.
              </div>
            ) : (
              <div className="space-y-4">
                {contractorLogs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start space-x-3 text-xs pb-3 border-b border-slate-100 last:border-none"
                  >
                    <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0 font-bold text-[10px]">
                      {log.user_name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <span className="font-bold text-slate-900">{log.action}</span>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {log.timestamp || 'Just now'}
                        </span>
                      </div>
                      <p className="text-slate-600 mt-0.5">
                        <span className="font-semibold text-slate-800">{log.user_name}</span> ({log.user_role}): {log.new_value || log.object_id}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
