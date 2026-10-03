/**
 * NW OS Variations & Scope Register (VO Management)
 * Tracks internal costs, client claims, schedule adjustments, and dual-party approval signatures.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import {
  FileCheck,
  DollarSign,
  Calendar,
  CheckCircle2,
  Clock,
  Plus,
  ShieldCheck,
  Building2,
  FileText,
} from 'lucide-react';

export const VariationsView: React.FC = () => {
  const { variations, currentUser, approveVariation } = useNW();

  const totalInternalCost = variations.reduce((sum, v) => sum + v.estimated_cost, 0);
  const totalClientClaim = variations.reduce((sum, v) => sum + v.client_amount, 0);

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold uppercase tracking-widest">
              Commercial Governance
            </span>
            <span className="text-xs text-slate-400">Strict Contract Control</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Variation Orders (VO Register)
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Human approval required for any financial commitment, drawing adjustment, or scope extension.
          </p>
        </div>

        {/* Financial Badges */}
        <div className="flex items-center space-x-3">
          <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-right">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
              Internal Scope Cost
            </span>
            <span className="text-sm font-bold text-amber-400 font-mono">
              RM {totalInternalCost.toLocaleString()}
            </span>
          </div>

          <div className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-right">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider block">
              Client Billable Claim
            </span>
            <span className="text-sm font-bold text-emerald-400 font-mono">
              RM {totalClientClaim.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Variations List */}
      <div className="grid grid-cols-1 gap-4">
        {variations.map((vo) => (
          <div
            key={vo.id}
            className="p-5 sm:p-6 rounded-2xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors shadow-lg space-y-4"
          >
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex items-center space-x-2.5">
                  <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    {vo.variation_number}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                      vo.status === 'Approved'
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                        : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {vo.status}
                  </span>
                </div>

                <h3 className="text-base font-bold text-slate-100">{vo.title}</h3>
                <p className="text-xs text-slate-300 leading-relaxed max-w-3xl">
                  {vo.description}
                </p>

                <div className="pt-2 flex flex-wrap gap-4 text-xs text-slate-400">
                  <span>Requested By: <strong className="text-slate-200">{vo.requested_by}</strong></span>
                  <span>Date: <strong className="text-slate-200">{vo.date_requested}</strong></span>
                  <span>Schedule Impact: <strong className="text-amber-400 font-mono">+{vo.schedule_impact_days} Days</strong></span>
                </div>
              </div>

              {/* Financial Box */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 shrink-0 w-full md:w-56 space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Internal Cost:</span>
                  <span className="text-slate-200 font-mono font-semibold">RM {vo.estimated_cost}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Client Amount:</span>
                  <span className="text-emerald-400 font-mono font-bold">RM {vo.client_amount}</span>
                </div>
                <div className="pt-2 border-t border-slate-850 flex justify-between text-[11px]">
                  <span className="text-slate-500">Gross Margin:</span>
                  <span className="text-amber-300 font-mono">
                    RM {(vo.client_amount - vo.estimated_cost).toLocaleString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Approval Status Matrix */}
            <div className="pt-4 border-t border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4 text-xs">
                {/* Owner approval */}
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                      vo.approved_by_owner ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {vo.approved_by_owner && <CheckCircle2 className="w-3 h-3" />}
                  </div>
                  <span className={vo.approved_by_owner ? 'text-slate-200' : 'text-slate-500'}>
                    Owner Approval (Dato’ Nicholas Wong)
                  </span>
                </div>

                {/* Client approval */}
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center ${
                      vo.approved_by_client ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-400'
                    }`}
                  >
                    {vo.approved_by_client && <CheckCircle2 className="w-3 h-3" />}
                  </div>
                  <span className={vo.approved_by_client ? 'text-slate-200' : 'text-slate-500'}>
                    Client Signature (Datin Serena Tan)
                  </span>
                </div>
              </div>

              {/* Action Buttons based on logged in role */}
              <div className="flex items-center space-x-2">
                {!vo.approved_by_owner && currentUser.role === 'Owner / CEO' && (
                  <button
                    onClick={() => approveVariation(vo.id, false)}
                    className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs rounded-lg shadow-sm"
                  >
                    Owner Sign-Off
                  </button>
                )}

                {vo.approved_by_owner && !vo.approved_by_client && currentUser.role === 'Client' && (
                  <button
                    onClick={() => approveVariation(vo.id, true)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg shadow-sm"
                  >
                    Client Formal Approval
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
