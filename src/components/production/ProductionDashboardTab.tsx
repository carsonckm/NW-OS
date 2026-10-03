/**
 * NW OS — Production Command Center Dashboard
 * Real-time factory floor workload, stage distributions, and blocker telemetry
 */

import React from 'react';
import { useNW } from '../../context/NWContext';
import {
  Layers,
  Clock,
  Package,
  Scissors,
  Cpu,
  Boxes,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  ShieldAlert,
  Truck,
  RotateCcw,
  Plus,
  QrCode,
  FileText,
} from 'lucide-react';
import { ProductionOrderStatus } from '../../types';

interface ProductionDashboardTabProps {
  onNavigateSubtab: (subtab: string) => void;
  onOpenCreateOrder: () => void;
  onOpenScanner: () => void;
}

export const ProductionDashboardTab: React.FC<ProductionDashboardTabProps> = ({
  onNavigateSubtab,
  onOpenCreateOrder,
  onOpenScanner,
}) => {
  const {
    productionOrders,
    productionParts,
    cncJobs,
    factoryQCInspections,
    productionIssues,
  } = useNW();

  // Calculate counts for all 13 required stage cards
  const totalOrders = productionOrders.length;
  const countByStage = (stage: ProductionOrderStatus) =>
    productionOrders.filter((o) => o.current_stage === stage).length;

  const stageCards: {
    id: string;
    label: string;
    stage?: ProductionOrderStatus;
    count: number;
    color: string;
    icon: React.ReactNode;
    targetTab: string;
  }[] = [
    {
      id: 'total',
      label: 'Production Orders',
      count: totalOrders,
      color: 'bg-slate-900 text-white border-slate-800',
      icon: <Layers className="w-4 h-4 text-amber-400" />,
      targetTab: 'orders',
    },
    {
      id: 'not-started',
      label: 'Not Started',
      stage: 'Not Started',
      count: countByStage('Not Started'),
      color: 'bg-slate-50 text-slate-700 border-slate-200',
      icon: <Clock className="w-4 h-4 text-slate-500" />,
      targetTab: 'orders',
    },
    {
      id: 'material-req',
      label: 'Material Required',
      stage: 'Material Required',
      count: countByStage('Material Required'),
      color: 'bg-amber-50 text-amber-900 border-amber-200',
      icon: <Package className="w-4 h-4 text-amber-600" />,
      targetTab: 'orders',
    },
    {
      id: 'material-ready',
      label: 'Material Ready',
      stage: 'Material Ready',
      count: countByStage('Material Ready'),
      color: 'bg-emerald-50 text-emerald-900 border-emerald-200',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
      targetTab: 'orders',
    },
    {
      id: 'cutting',
      label: 'Cutting',
      stage: 'Cutting',
      count: countByStage('Cutting'),
      color: 'bg-blue-50 text-blue-900 border-blue-200',
      icon: <Scissors className="w-4 h-4 text-blue-600" />,
      targetTab: 'queue',
    },
    {
      id: 'cnc',
      label: 'CNC',
      stage: 'CNC',
      count: countByStage('CNC'),
      color: 'bg-cyan-50 text-cyan-900 border-cyan-200',
      icon: <Cpu className="w-4 h-4 text-cyan-600" />,
      targetTab: 'cnc',
    },
    {
      id: 'edge-banding',
      label: 'Edge Banding',
      stage: 'Edge Banding',
      count: countByStage('Edge Banding'),
      color: 'bg-teal-50 text-teal-900 border-teal-200',
      icon: <Layers className="w-4 h-4 text-teal-600" />,
      targetTab: 'queue',
    },
    {
      id: 'assembly',
      label: 'Assembly',
      stage: 'Assembly',
      count: countByStage('Assembly'),
      color: 'bg-indigo-50 text-indigo-900 border-indigo-200',
      icon: <Boxes className="w-4 h-4 text-indigo-600" />,
      targetTab: 'assembly',
    },
    {
      id: 'finishing',
      label: 'Finishing',
      stage: 'Finishing',
      count: countByStage('Finishing'),
      color: 'bg-violet-50 text-violet-900 border-violet-200',
      icon: <Sparkles className="w-4 h-4 text-violet-600" />,
      targetTab: 'finishing',
    },
    {
      id: 'qc',
      label: 'Factory QC',
      stage: 'QC',
      count: countByStage('QC'),
      color: 'bg-purple-50 text-purple-900 border-purple-200',
      icon: <CheckCircle2 className="w-4 h-4 text-purple-600" />,
      targetTab: 'qc',
    },
    {
      id: 'packing',
      label: 'Packing',
      stage: 'Packing',
      count: countByStage('Packing'),
      color: 'bg-orange-50 text-orange-900 border-orange-200',
      icon: <Package className="w-4 h-4 text-orange-600" />,
      targetTab: 'packing',
    },
    {
      id: 'ready-delivery',
      label: 'Ready for Delivery',
      stage: 'Ready for Delivery',
      count: countByStage('Ready for Delivery'),
      color: 'bg-emerald-100 text-emerald-950 border-emerald-300 font-bold',
      icon: <Truck className="w-4 h-4 text-emerald-700" />,
      targetTab: 'ready-delivery',
    },
    {
      id: 'blocked',
      label: 'Blocked',
      stage: 'Blocked',
      count: countByStage('Blocked'),
      color: 'bg-rose-50 text-rose-900 border-rose-300 font-bold',
      icon: <ShieldAlert className="w-4 h-4 text-rose-600 animate-pulse" />,
      targetTab: 'issues',
    },
  ];

  // Active blockers and revision warnings
  const blockedOrders = productionOrders.filter((o) => o.status === 'Blocked');
  const revisionAlertOrders = productionOrders.filter((o) => o.revision_alert && !o.revision_alert.resolved);

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Controls */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-400 text-slate-950">
              Module 13
            </span>
            <span className="text-xs text-slate-400">Joinery & CNC Workshop Command Center</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight mt-1">
            Production & Factory Operations
          </h1>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Controlled manufacturing pipeline connecting Approved Drawings, NW Production Methods, CNC routers, assembly checklists, and QR code tracking.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onOpenScanner}
            className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700 rounded-xl text-xs font-bold flex items-center space-x-2 transition-all hover:scale-105 shadow-xs"
          >
            <QrCode className="w-4 h-4 text-amber-400" />
            <span>Scan QR / Barcode</span>
          </button>
          <button
            onClick={onOpenCreateOrder}
            className="px-4 py-2.5 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 rounded-xl text-xs font-black flex items-center space-x-2 transition-all hover:scale-105 shadow-md"
          >
            <Plus className="w-4 h-4" />
            <span>New Production Order</span>
          </button>
        </div>
      </div>

      {/* 13 Stage Cards Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center space-x-2">
            <span>Workload by Production Stage</span>
            <span className="text-[11px] text-slate-500 font-normal">({totalOrders} total active orders)</span>
          </h2>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
          {stageCards.map((card) => (
            <button
              key={card.id}
              onClick={() => onNavigateSubtab(card.targetTab)}
              className={`p-3 rounded-xl border text-left transition-all hover:shadow-md hover:-translate-y-0.5 ${card.color}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] uppercase font-bold tracking-wider opacity-80 truncate">
                  {card.label}
                </span>
                {card.icon}
              </div>
              <div className="text-xl font-black">{card.count}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Critical Alerts Row: Revision Warnings & Blocked Stages */}
      {(revisionAlertOrders.length > 0 || blockedOrders.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Drawing Revision Alerts */}
          {revisionAlertOrders.length > 0 && (
            <div className="bg-amber-50/70 border border-amber-300 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2 text-amber-900 font-bold text-xs uppercase tracking-wider">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  <span>Drawing Revision Impact Detected ({revisionAlertOrders.length})</span>
                </div>
                <button
                  onClick={() => onNavigateSubtab('orders')}
                  className="text-[11px] text-amber-800 hover:text-amber-950 font-bold flex items-center space-x-1"
                >
                  <span>Review Orders</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="space-y-2 mt-2">
                {revisionAlertOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 bg-white border border-amber-200 rounded-lg text-xs text-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 font-mono">{ord.order_number} ({ord.work_item_code})</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-amber-100 text-amber-900 border border-amber-300">
                        {ord.revision_alert?.level}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{ord.revision_alert?.message}</p>
                    <div className="flex items-center space-x-3 text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                      <span>Drawing: {ord.approved_client_drawing_revision}</span>
                      <span>•</span>
                      <span>Detected: {ord.revision_alert?.detected_revision}</span>
                      <span>•</span>
                      <span>Stage: {ord.current_stage}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Blocked Orders */}
          {blockedOrders.length > 0 && (
            <div className="bg-rose-50/70 border border-rose-300 rounded-xl p-4 shadow-2xs">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2 text-rose-900 font-bold text-xs uppercase tracking-wider">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Blocked Production Orders ({blockedOrders.length})</span>
                </div>
                <button
                  onClick={() => onNavigateSubtab('issues')}
                  className="text-[11px] text-rose-800 hover:text-rose-950 font-bold flex items-center space-x-1"
                >
                  <span>Production Issues</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              <div className="space-y-2 mt-2">
                {blockedOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="p-3 bg-white border border-rose-200 rounded-lg text-xs text-slate-800 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 font-mono">{ord.order_number} ({ord.work_item_code})</span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase bg-rose-600 text-white">
                        BLOCKED
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">{ord.notes}</p>
                    <div className="flex items-center space-x-3 text-[10px] text-slate-500 pt-1 border-t border-slate-100">
                      <span>Contractor: {ord.contractor_name}</span>
                      <span>•</span>
                      <span>Location: {ord.location}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Factory Telemetry Columns: Active CNC Jobs + Factory QC Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active CNC Jobs */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <Cpu className="w-4 h-4 text-cyan-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                CNC Machine Center Telemetry
              </h3>
            </div>
            <button
              onClick={() => onNavigateSubtab('cnc')}
              className="text-xs text-amber-700 hover:text-amber-800 font-bold flex items-center space-x-1"
            >
              <span>View CNC Center</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {cncJobs.slice(0, 4).map((job) => (
              <div
                key={job.id}
                className="p-3 rounded-lg border border-slate-100 hover:border-slate-300 bg-slate-50/50 flex items-center justify-between text-xs transition-colors"
              >
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-slate-900 font-mono">{job.job_id_code}</span>
                    <span className="text-slate-400">•</span>
                    <span className="font-semibold text-slate-700">{job.part_name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {job.machine} • {job.material} ({job.thickness_mm}mm)
                  </div>
                </div>

                <div className="text-right">
                  <span
                    className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      job.status === 'Running'
                        ? 'bg-emerald-500 text-white animate-pulse'
                        : job.status === 'Completed'
                        ? 'bg-slate-200 text-slate-800'
                        : 'bg-amber-100 text-amber-900'
                    }`}
                  >
                    {job.status}
                  </span>
                  <span className="block text-[10px] text-slate-400 mt-0.5">
                    {job.start_time || 'In Queue'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Factory QC Inspection Log */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-purple-600" />
              <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                Recent Factory QC Inspections
              </h3>
            </div>
            <button
              onClick={() => onNavigateSubtab('qc')}
              className="text-xs text-amber-700 hover:text-amber-800 font-bold flex items-center space-x-1"
            >
              <span>View QC Log</span>
              <ArrowRight className="w-3 h-3" />
            </button>
          </div>

          <div className="space-y-3">
            {factoryQCInspections.slice(0, 3).map((qc) => (
              <div
                key={qc.id}
                className="p-3 rounded-lg border border-slate-100 hover:border-slate-300 bg-slate-50/50 text-xs space-y-1 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{qc.work_item_code} — {qc.description}</span>
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                      qc.result === 'Passed'
                        ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                        : 'bg-rose-100 text-rose-900 border border-rose-300'
                    }`}
                  >
                    {qc.result}
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 line-clamp-1">{qc.comments}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-slate-100">
                  <span>Inspector: {qc.inspector_name}</span>
                  <span>{new Date(qc.inspection_date).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
