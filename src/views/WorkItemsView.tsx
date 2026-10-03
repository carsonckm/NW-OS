/**
 * NW OS — Work Items & Production Register
 * Comprehensive register for all physical deliverables,joinery items, and trade scopes.
 * Features:
 * - Row click to open Work Item Detail modal (Overview, Drawing Revision, Production, QC, Delivery, Installation, Issues, Activity, Photos)
 * - Visual progress % tracking
 * - Contractor-specific view permissions and status updates
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import {
  Layers,
  Search,
  Filter,
  Truck,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ShieldCheck,
  Wrench,
  ChevronRight,
  Plus,
  Lock,
  User,
  Eye,
  Camera,
} from 'lucide-react';
import { QCModal } from '../components/QCModal';
import { DeliveryModal } from '../components/DeliveryModal';
import { IssueModal } from '../components/IssueModal';
import { NewWorkPackageModal } from '../components/NewWorkPackageModal';
import { WorkItemDetailModal } from '../components/WorkItemDetailModal';
import { canAccessWorkItem } from '../utils/permissions';

export const WorkItemsView: React.FC = () => {
  const {
    workItems,
    selectedProject,
    contractors,
    workPackages,
    drawings,
    currentUser,
  } = useNW();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [packageFilter, setPackageFilter] = useState<string>('All');

  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [selectedQCItem, setSelectedQCItem] = useState<WorkItem | null>(null);
  const [selectedDeliveryItem, setSelectedDeliveryItem] = useState<WorkItem | null>(null);
  const [selectedIssueItemId, setSelectedIssueItemId] = useState<string | null>(null);
  const [showWorkPackageModal, setShowWorkPackageModal] = useState(false);

  // Contractor permissions: Contractors only see their assigned work items
  const isContractor = currentUser.role === 'Contractor';
  // Match contractor by email or id
  const currentContractorRecord = contractors.find(
    (c) => c.email === currentUser.email || c.contact_person.includes(currentUser.name)
  );

  // Filter items
  const filteredItems = workItems.filter((item) => {
    // Role-based and project-aware isolation
    if (!canAccessWorkItem(currentUser, item, selectedProject)) {
      return false;
    }

    // If contractor role, restrict to their assigned items
    if (isContractor && currentContractorRecord) {
      if (item.contractor_id !== currentContractorRecord.id) {
        return false;
      }
    }

    const matchesSearch =
      item.item_code.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase()) ||
      item.location.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'All' || item.status === statusFilter;
    const matchesPackage = packageFilter === 'All' || item.work_package_id === packageFilter;
    return matchesSearch && matchesStatus && matchesPackage;
  });

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
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Contractor Portal Banner */}
      {isContractor && (
        <div className="bg-amber-50 border border-amber-300 rounded-2xl p-4 flex items-start space-x-3 text-xs text-amber-900 shadow-xs">
          <Lock className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-black uppercase tracking-wider text-amber-950">
              Contractor Portal View — {currentUser.name}
            </h4>
            <p className="text-amber-800 leading-relaxed">
              You are viewing Work Items assigned to your company. You can update progress %, upload
              manufacturing/site photos, report site problems, and schedule deliveries. Approved
              dimensions and drawing revisions are locked.
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold uppercase tracking-widest">
              Fabrication & Delivery
            </span>
            <span className="text-xs text-slate-500 font-mono">
              {filteredItems.length} Deliverables Listed
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
            Work Items & Deliverables Register
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Granular components tied to exact drawing revisions, trade contractors, and QC gates.
          </p>
        </div>

        {/* Filter Bar & Quick Actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search code, item, location..."
              className="bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 w-48 sm:w-60 shadow-xs"
              id="search-work-items-input"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 shadow-xs cursor-pointer"
            id="filter-work-item-status"
          >
            <option value="All">All Statuses</option>
            <option value="Draft">Draft</option>
            <option value="Assigned">Assigned</option>
            <option value="In Progress">In Progress</option>
            <option value="Ready for QC">Ready for QC</option>
            <option value="QC Passed">QC Passed</option>
            <option value="Ready for Delivery">Ready for Delivery</option>
            <option value="Delivered">Delivered</option>
            <option value="Completed">Completed</option>
          </select>

          <select
            value={packageFilter}
            onChange={(e) => setPackageFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-xl px-3 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 shadow-xs cursor-pointer max-w-[180px] truncate"
            id="filter-work-item-package"
          >
            <option value="All">All Work Packages</option>
            {workPackages.map((wp) => (
              <option key={wp.id} value={wp.id}>
                {wp.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" id="work-items-table">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3.5 px-4">Item Code & Deliverable</th>
                <th className="py-3.5 px-4">Work Package / Trade</th>
                <th className="py-3.5 px-4">Drawing Revision</th>
                <th className="py-3.5 px-4">Contractor</th>
                <th className="py-3.5 px-4">Progress Visual</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-400">
                    <Layers className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                    <p className="font-bold text-slate-600">No work items match current filter</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Create work items under project work packages or clear filters.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) => {
                  const con = contractors.find((c) => c.id === item.contractor_id);
                  const pkg = workPackages.find((wp) => wp.id === item.work_package_id);
                  const dwg = drawings.find((d) => d.id === item.drawing_id);

                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedWorkItemId(item.id)}
                      className="hover:bg-amber-50/30 transition-colors cursor-pointer group"
                      id={`work-item-row-${item.id}`}
                    >
                      {/* Code & Description */}
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-2">
                          <span className="font-mono font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded text-xs">
                            {item.item_code}
                          </span>
                          <span className="font-bold text-slate-900 group-hover:text-amber-900 transition-colors">
                            {item.description}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-500 mt-1 flex items-center space-x-2">
                          <span>{item.location}</span>
                          <span>•</span>
                          <span className="font-mono">
                            Qty: {item.quantity} {item.unit}
                          </span>
                        </div>
                      </td>

                      {/* Package / Trade */}
                      <td className="py-4 px-4 text-slate-700">
                        <div className="font-semibold text-xs line-clamp-1">
                          {pkg ? pkg.name : 'Direct Scope'}
                        </div>
                        <span className="text-[10px] font-bold text-amber-700 uppercase">
                          {pkg?.category || pkg?.trade || 'Carpentry'}
                        </span>
                      </td>

                      {/* Drawing Revision */}
                      <td className="py-4 px-4">
                        <div className="flex items-center space-x-1.5">
                          <span className="text-slate-900 font-mono text-[11px] font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                            {dwg ? dwg.drawing_number : 'A-101'}
                          </span>
                          <span className="text-emerald-700 font-mono font-bold text-[11px] bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                            {item.drawing_revision || 'Rev 1'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[140px]">
                          {item.dimensions}
                        </div>
                      </td>

                      {/* Contractor */}
                      <td className="py-4 px-4 text-slate-800">
                        <div className="font-bold text-xs">
                          {con?.company_name || 'Unassigned'}
                        </div>
                        <div className="text-[10px] text-slate-400">{con?.contact_person}</div>
                      </td>

                      {/* Progress Visual: Production % and Overall % */}
                      <td className="py-4 px-4 w-44">
                        <div className="space-y-1">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-500 font-medium">Production</span>
                            <span className="font-mono font-bold text-slate-900">
                              {item.progress_percent}%
                            </span>
                          </div>
                          <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                            <div
                              className="bg-amber-500 h-full rounded-full transition-all duration-300"
                              style={{ width: `${item.progress_percent}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-4 px-4">
                        <span
                          className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold border uppercase ${getStatusBadge(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>
                        {item.scheduled_delivery_date && (
                          <div className="text-[10px] text-slate-500 mt-1 flex items-center space-x-1">
                            <Truck className="w-3 h-3 text-sky-600" />
                            <span className="font-mono">{item.scheduled_delivery_date}</span>
                          </div>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-right">
                        <div
                          className="flex items-center justify-end space-x-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => setSelectedWorkItemId(item.id)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors cursor-pointer"
                            title="View Full Item Details"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          {item.status === 'Ready for QC' && (
                            <button
                              onClick={() => setSelectedQCItem(item)}
                              className="px-2 py-1 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-[11px] rounded-lg shadow-xs cursor-pointer"
                            >
                              QC
                            </button>
                          )}

                          <button
                            onClick={() => setSelectedIssueItemId(item.id)}
                            className="p-1.5 bg-slate-100 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-lg transition-colors cursor-pointer"
                            title="Report Problem on this Item"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Work Item Detail Modal */}
      <WorkItemDetailModal
        isOpen={Boolean(selectedWorkItemId)}
        onClose={() => setSelectedWorkItemId(null)}
        workItemId={selectedWorkItemId}
        onOpenQCModal={(item) => setSelectedQCItem(item)}
        onOpenDeliveryModal={(item) => setSelectedDeliveryItem(item)}
        onOpenIssueModal={(itemId) => setSelectedIssueItemId(itemId)}
      />

      {/* QC Modal */}
      {selectedQCItem && (
        <QCModal
          isOpen={Boolean(selectedQCItem)}
          onClose={() => setSelectedQCItem(null)}
          workItem={selectedQCItem}
        />
      )}

      {/* Delivery Modal */}
      {selectedDeliveryItem && (
        <DeliveryModal
          isOpen={Boolean(selectedDeliveryItem)}
          onClose={() => setSelectedDeliveryItem(null)}
          workItem={selectedDeliveryItem}
          mode="schedule"
        />
      )}

      {/* Issue Modal */}
      {selectedIssueItemId && (
        <IssueModal
          isOpen={Boolean(selectedIssueItemId)}
          onClose={() => setSelectedIssueItemId(null)}
          defaultWorkItemId={selectedIssueItemId}
        />
      )}

      {/* New Work Package Modal */}
      <NewWorkPackageModal
        isOpen={showWorkPackageModal}
        onClose={() => setShowWorkPackageModal(false)}
        onSuccess={() => {}}
        defaultProjectId={selectedProject?.id}
      />
    </div>
  );
};
