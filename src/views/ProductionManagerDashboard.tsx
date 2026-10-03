/**
 * NW OS — Production Manager Dashboard (Section 8)
 * Command center for Factory & Joinery Workshop Operations.
 */

import React from 'react';
import { useNW } from '../context/NWContext';
import {
  Layers,
  Wrench,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
  Building2,
  Box,
} from 'lucide-react';

interface ProductionManagerDashboardProps {
  onNavigate?: (tab: string) => void;
}

export const ProductionManagerDashboard: React.FC<ProductionManagerDashboardProps> = ({ onNavigate }) => {
  const {
    currentUser,
    workItems,
    drawings,
    approvals,
    qcRecords,
    projects,
  } = useNW();

  const cuttingCount = workItems.filter((i) => i.production_status === 'Cutting').length;
  const assemblyCount = workItems.filter((i) => i.production_status === 'Assembly').length;
  const qcCount = workItems.filter((i) => i.production_status === 'QC').length;
  const readyCount = workItems.filter((i) => i.production_status === 'Ready for Delivery').length;

  const approvedDrawings = drawings.filter((d) => d.status === 'Approved');
  const pendingApprovals = approvals.filter(
    (a) =>
      a.decision === 'Pending' &&
      ['NW Production Drawing Approval', 'Technical Change'].includes(a.approval_type)
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-rose-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-rose-500/20 text-rose-300 border border-rose-500/30">
              Factory & Joinery Operations
            </span>
          </div>
          <h1 className="text-xl font-black mt-1">Welcome back, {currentUser.name}</h1>
          <p className="text-xs text-slate-300 mt-0.5">
            Workshop production floor, CNC nesting queue, joinery method proposals, and factory quality control
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('production')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-colors shadow-xs"
            >
              <span>Production Command Center</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Workshop Stage Pipeline */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Cutting & CNC</span>
            <Layers className="w-4 h-4 text-blue-600" />
          </span>
          <div className="text-2xl font-black text-slate-900">{cuttingCount} Items</div>
          <span className="text-[11px] text-slate-500">Board sizing & nesting</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Assembly & Joinery</span>
            <Wrench className="w-4 h-4 text-indigo-600" />
          </span>
          <div className="text-2xl font-black text-indigo-700">{assemblyCount} Items</div>
          <span className="text-[11px] text-slate-500">Carcass & hardware fitting</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Factory QA / QC</span>
            <CheckCircle2 className="w-4 h-4 text-amber-600" />
          </span>
          <div className="text-2xl font-black text-amber-700">{qcCount} Items</div>
          <span className="text-[11px] text-slate-500">Pre-delivery inspection</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Ready for Delivery</span>
            <Box className="w-4 h-4 text-emerald-600" />
          </span>
          <div className="text-2xl font-black text-emerald-700">{readyCount} Items</div>
          <span className="text-[11px] text-slate-500">Packed with protective foam</span>
        </div>
      </div>

      {/* Production Details */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Approved Production Drawings */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
              <FileText className="w-4 h-4 text-rose-600" />
              <span>Approved Production Drawings</span>
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('drawings')}
                className="text-xs font-bold text-rose-700 hover:text-rose-800"
              >
                All Drawings
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {drawings.slice(0, 4).map((dwg) => (
              <div key={dwg.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-slate-800">{dwg.drawing_number}</span>
                    <span className="text-xs font-bold text-slate-900">{dwg.title}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-800 border border-purple-200">
                    {dwg.drawing_type.split(' ')[0]}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>Category: {dwg.category}</span>
                  <span>Revision: <strong className="text-slate-800 font-bold">{dwg.current_revision}</strong></span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Technical Changes Requiring Review */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-rose-600" />
              <span>Technical Changes & Approval Pipeline</span>
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('approvals')}
                className="text-xs font-bold text-rose-700 hover:text-rose-800"
              >
                Approvals Center
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {pendingApprovals.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-400">No pending technical changes</p>
            ) : (
              pendingApprovals.map((appr) => (
                <div key={appr.id} className="p-3 bg-rose-50/50 border border-rose-200 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold text-slate-800">{appr.approval_number}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                      {appr.approval_type}
                    </span>
                  </div>
                  <h4 className="text-xs font-bold text-slate-900">{appr.title}</h4>
                  <p className="text-[11px] text-slate-600 line-clamp-1">{appr.description}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
