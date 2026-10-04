/**
 * NW OS Client Executive Portal (Aurora Luxury Retail / Datin Serena Tan)
 * High-transparency, client-safe progress tracking and formal variation sign-offs.
 */

import React from 'react';
import { useNW } from '../context/NWContext';
import {
  Building2,
  CheckCircle2,
  Calendar,
  FileCheck,
  TrendingUp,
  Clock,
  Sparkles,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';

export const ClientDashboard: React.FC = () => {
  const { selectedProject, variations, approveVariation, workItems } = useNW();

  // Client variations
  const clientVOs = variations.filter(
    (v) => v.project_id === selectedProject?.id
  );

  const completedCount = workItems.filter(
    (w) => w.status === 'Completed' || w.installation_status === 'Completed'
  ).length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-800">
      {/* Client Welcome Banner */}
      <div className="bg-gradient-to-r from-sky-50 via-white to-sky-50 border border-sky-200/80 rounded-2xl p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-300 text-[10px] font-bold uppercase tracking-widest">
                Client Project Dashboard
              </span>
              <span className="text-xs text-slate-500 font-medium">Aurora Retail Sdn Bhd</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 mt-1">
              {selectedProject?.project_name}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Project Director: Dato’ Nicholas Wong • Senior PM: Marcus Lee
            </p>
          </div>

          <div className="px-5 py-3 rounded-xl bg-white border border-sky-200 text-right shrink-0 shadow-xs">
            <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider block">
              Verified Progress
            </span>
            <span className="text-2xl font-black text-emerald-600 font-mono">
              {selectedProject?.progress_percent}%
            </span>
          </div>
        </div>

        {/* Milestone Progress Bar */}
        <div className="mt-5 space-y-2">
          <div className="flex justify-between text-xs text-slate-600 font-medium">
            <span>Mobilization & Site Demo (100%)</span>
            <span>Factory Joinery (85%)</span>
            <span>Site Installation (60%)</span>
            <span>Final Handover</span>
          </div>
          <div className="w-full bg-slate-200 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${selectedProject?.progress_percent}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-slate-500">
            <span>Commenced: {selectedProject?.start_date}</span>
            <span className="text-amber-700 font-bold font-mono">
              Target Opening: {selectedProject?.end_date}
            </span>
          </div>
        </div>
      </div>

      {/* Variations Requiring Client Approval */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <FileCheck className="w-5 h-5 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Formal Variation Orders for Client Sign-Off ({clientVOs.length})
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Official Contract Addenda</span>
        </div>

        <div className="space-y-3">
          {clientVOs.map((vo) => (
            <div
              key={vo.id}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono font-bold text-amber-700">
                    {vo.variation_number}
                  </span>
                  <h4 className="text-sm font-bold text-slate-900">{vo.title}</h4>
                </div>
                <p className="text-xs text-slate-600 max-w-xl">{vo.description}</p>
                <div className="text-[11px] text-slate-500">
                  Requested by: <strong className="text-slate-800">{vo.requested_by}</strong> • Schedule Impact:{' '}
                  <strong className="text-slate-800">{vo.schedule_impact_days} days</strong>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-end md:items-center gap-3 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider block font-medium">
                    Amount Payable
                  </span>
                  <span className="text-base font-bold text-slate-900 font-mono">
                    RM {vo.client_amount.toLocaleString()}
                  </span>
                </div>

                {vo.status !== 'Approved' ? (
                  <button
                    onClick={() => approveVariation(vo.id, false)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Approve Variation Order</span>
                  </button>
                ) : (
                  <div className="px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold flex items-center space-x-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approved by Client</span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Completed Work Showcase */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>Site Milestones & Delivered Millwork</span>
          </h3>
          <span className="text-xs text-slate-500 font-medium">{completedCount} of {workItems.length} items on site</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {workItems.slice(0, 3).map((item) => (
            <div key={item.id} className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono font-bold text-amber-700">{item.item_code}</span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-white border border-slate-200 text-slate-700">
                  {item.status}
                </span>
              </div>
              <h5 className="text-xs font-bold text-slate-900">{item.description}</h5>
              <p className="text-[11px] text-slate-500">Location: {item.location}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
