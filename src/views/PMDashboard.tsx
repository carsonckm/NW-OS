/**
 * NW OS Project Manager Dashboard
 * Operational coordination engine: Work Packages, QC queues, drawing confirmations, and site issues.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Truck,
  FileText,
  Plus,
  ChevronRight,
  ShieldCheck,
  Building2,
  Ruler,
  LayoutDashboard,
} from 'lucide-react';
import { QCModal } from '../components/QCModal';
import { DeliveryModal } from '../components/DeliveryModal';
import { IssueModal } from '../components/IssueModal';
import { ProjectCommandCenter } from '../components/ProjectCommandCenter';

interface PMDashboardProps {
  onNavigate: (tab: string) => void;
}

export const PMDashboard: React.FC<PMDashboardProps> = ({ onNavigate }) => {
  const {
    selectedProject,
    workPackages,
    workItems,
    drawings,
    issues,
    contractors,
  } = useNW();

  const [activeView, setActiveView] = useState<'command_center' | 'quick_queues'>('command_center');
  const [selectedQCItem, setSelectedQCItem] = useState<WorkItem | null>(null);
  const [selectedDeliveryItem, setSelectedDeliveryItem] = useState<WorkItem | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);

  // Items waiting for PM or Site QC
  const pendingQC = workItems.filter(
    (w) => w.status === 'Ready for QC' || w.production_status === 'QC'
  );

  // Items passed QC ready for delivery scheduling
  const readyForDelivery = workItems.filter(
    (w) => w.status === 'QC Passed' && w.delivery_status === 'Not Scheduled'
  );

  // Active site issues
  const projectIssues = issues.filter(
    (i) => i.project_id === selectedProject?.id && i.status !== 'Resolved'
  );

  if (activeView === 'command_center' && selectedProject) {
    return (
      <div className="space-y-4">
        {/* PM Mode Switcher Bar */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-2xs self-start">
            <button
              onClick={() => setActiveView('command_center')}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-white text-slate-900 shadow-2xs flex items-center space-x-1.5"
            >
              <LayoutDashboard className="w-3.5 h-3.5 text-amber-600" />
              <span>Project Command Center</span>
            </button>
            <button
              onClick={() => setActiveView('quick_queues')}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all text-slate-600 hover:text-slate-900 flex items-center space-x-1.5 cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
              <span>Operations Queue ({pendingQC.length} QC / {readyForDelivery.length} Del)</span>
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <span className="text-xs text-slate-400 font-medium">Managing:</span>
            <span className="text-xs font-mono font-bold bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 rounded">
              {selectedProject.project_number}
            </span>
          </div>
        </div>

        <ProjectCommandCenter
          projectId={selectedProject.id}
          onNavigateToTab={onNavigate}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* View Switcher Top Bar */}
      <div className="flex items-center space-x-2 bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-2xs self-start w-fit">
        <button
          onClick={() => setActiveView('command_center')}
          className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all text-slate-600 hover:text-slate-900 flex items-center space-x-1.5 cursor-pointer"
        >
          <LayoutDashboard className="w-3.5 h-3.5 text-slate-400" />
          <span>Project Command Center</span>
        </button>
        <button
          onClick={() => setActiveView('quick_queues')}
          className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all bg-white text-slate-900 shadow-2xs flex items-center space-x-1.5"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
          <span>Operations Queue ({pendingQC.length} QC / {readyForDelivery.length} Del)</span>
        </button>
      </div>
      {/* PM Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold uppercase tracking-widest">
              Project Manager Operations Hub
            </span>
            <span className="text-xs text-slate-500 font-medium">Marcus Lee</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
            {selectedProject?.project_name}
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Site: {selectedProject?.site_address} • Target Handover:{' '}
            <strong className="text-amber-600 font-mono">{selectedProject?.end_date}</strong>
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={() => setShowIssueModal(true)}
            className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            <span>Report Site Issue</span>
          </button>
          <button
            onClick={() => onNavigate('drawings')}
            className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-xl shadow-xs flex items-center space-x-1.5 transition-colors cursor-pointer"
          >
            <Ruler className="w-3.5 h-3.5" />
            <span>Manage Drawings</span>
          </button>
        </div>
      </div>

      {/* Priority Queues: QC Inspections & Delivery Schedules */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* QC Inspection Queue */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-amber-600" />
              <h3 className="text-sm font-bold text-slate-900">
                Pending QC Inspections ({pendingQC.length})
              </h3>
            </div>
            <span className="text-[10px] text-slate-500 font-medium">Factory / Site Gate</span>
          </div>

          {pendingQC.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No items currently awaiting QC.</p>
          ) : (
            <div className="space-y-2.5">
              {pendingQC.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono font-bold text-amber-700">{item.item_code}</span>
                      <span className="text-xs font-bold text-slate-800">{item.description}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Location: {item.location} • Drawing: {item.drawing_revision}
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedQCItem(item)}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg shadow-2xs shrink-0 cursor-pointer"
                  >
                    Inspect & QC
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Ready for Delivery Scheduling */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Truck className="w-4 h-4 text-sky-600" />
              <h3 className="text-sm font-bold text-slate-900">
                QC Passed — Ready for Delivery ({readyForDelivery.length})
              </h3>
            </div>
            <span className="text-[10px] text-slate-500 font-medium">Logistics Dispatch</span>
          </div>

          {readyForDelivery.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No items waiting for delivery.</p>
          ) : (
            <div className="space-y-2.5">
              {readyForDelivery.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono font-bold text-sky-700">{item.item_code}</span>
                      <span className="text-xs font-bold text-slate-800">{item.description}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Passed factory QC • Awaiting contractor lorry booking
                    </p>
                  </div>
                  <button
                    onClick={() => setSelectedDeliveryItem(item)}
                    className="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-lg shadow-2xs shrink-0 cursor-pointer"
                  >
                    Schedule Lorry
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Work Packages Overview */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <Layers className="w-4 h-4 text-amber-600" />
            <span>Work Packages & Contractors</span>
          </h3>
          <button
            onClick={() => onNavigate('work-items')}
            className="text-xs text-amber-600 font-bold hover:underline flex items-center space-x-1 cursor-pointer"
          >
            <span>View all work items</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {workPackages
            .filter((wp) => wp.project_id === selectedProject?.id)
            .map((wp) => {
              const assignedCon = contractors.find((c) => c.id === wp.contractor_id);
              return (
                <div key={wp.id} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-amber-800 tracking-wider">
                        {wp.category}
                      </span>
                      <h4 className="text-xs font-bold text-slate-900 mt-0.5">{wp.name}</h4>
                    </div>
                    <span className="text-xs font-mono font-bold text-slate-800">
                      {wp.progress_percent}%
                    </span>
                  </div>

                  <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                    <div
                      className="bg-amber-500 h-full rounded-full"
                      style={{ width: `${wp.progress_percent}%` }}
                    />
                  </div>

                  <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500 flex justify-between">
                    <span>Sub-Contractor:</span>
                    <span className="text-slate-800 font-bold">{assignedCon?.company_name.split(' ')[0]}</span>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Active Site Issues Hub */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <AlertTriangle className="w-4 h-4 text-rose-600" />
            <span>Active Issues for {selectedProject?.project_name} ({projectIssues.length})</span>
          </h3>
          <button
            onClick={() => onNavigate('issues')}
            className="text-xs text-amber-600 font-bold hover:underline flex items-center space-x-1 cursor-pointer"
          >
            <span>Issues Console</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="space-y-2.5">
          {projectIssues.map((iss) => (
            <div
              key={iss.id}
              className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center space-x-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                      iss.priority === 'Critical'
                        ? 'bg-rose-50 text-rose-700 border-rose-200'
                        : 'bg-amber-50 text-amber-800 border-amber-200'
                    }`}
                  >
                    {iss.priority}
                  </span>
                  <span className="text-xs font-bold text-slate-900">{iss.title}</span>
                </div>
                <p className="text-[11px] text-slate-600 mt-1 line-clamp-1">{iss.description}</p>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <span className="text-[11px] text-amber-700 font-mono font-bold">
                  Escalated: {iss.escalation_level}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

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
      {showIssueModal && (
        <IssueModal
          isOpen={showIssueModal}
          onClose={() => setShowIssueModal(false)}
        />
      )}
    </div>
  );
};
