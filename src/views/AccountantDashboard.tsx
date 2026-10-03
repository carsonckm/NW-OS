/**
 * NW OS — Accountant Role Dashboard (Section 7)
 * Dedicated command center for Chartered Accountant / Financial Controller.
 */

import React from 'react';
import { useNW } from '../context/NWContext';
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  FileCheck2,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  Building2,
  Calendar,
} from 'lucide-react';

interface AccountantDashboardProps {
  onNavigate?: (tab: string) => void;
}

export const AccountantDashboard: React.FC<AccountantDashboardProps> = ({ onNavigate }) => {
  const {
    currentUser,
    projects,
    financialClaims,
    payments,
    variations,
  } = useNW();

  const totalContractValue = projects.reduce((sum, p) => sum + p.contract_value, 0);
  const totalClaimed = financialClaims.reduce((sum, c) => sum + c.cumulative_claimed, 0);
  const totalInflow = payments
    .filter((p) => p.type === 'Client Inflow')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalOutflow = payments
    .filter((p) => p.type !== 'Client Inflow')
    .reduce((sum, p) => sum + p.amount, 0);

  const pendingClaims = financialClaims.filter((c) => c.status === 'Submitted');

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-cyan-950 to-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
              Financial Control & Accounts
            </span>
          </div>
          <h1 className="text-xl font-black mt-1">Welcome back, {currentUser.name}</h1>
          <p className="text-xs text-slate-300 mt-0.5">
            Interim claims certification, retention sum accounting, and contractor disbursement ledger
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('finance')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors shadow-xs"
            >
              <span>Open Commercial Accounts</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Portfolio Value</span>
            <Building2 className="w-4 h-4 text-cyan-600" />
          </span>
          <div className="text-2xl font-black text-slate-900">RM {totalContractValue.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500">Across {projects.length} awarded fitouts</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Pending Certification</span>
            <FileCheck2 className="w-4 h-4 text-amber-600" />
          </span>
          <div className="text-2xl font-black text-amber-700">{pendingClaims.length} Claims</div>
          <span className="text-[11px] text-slate-500">Awaiting client QS signoff</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Client Inflow Settled</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
          </span>
          <div className="text-2xl font-black text-emerald-700">RM {totalInflow.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500">Net received into company</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Disbursements Made</span>
            <ArrowUpRight className="w-4 h-4 text-indigo-600" />
          </span>
          <div className="text-2xl font-black text-slate-900">RM {totalOutflow.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500">Trade contractors & POs</span>
        </div>
      </div>

      {/* IPC Claims & Recent Disbursements */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
              <FileCheck2 className="w-4 h-4 text-cyan-600" />
              <span>Interim Payment Claims (IPC)</span>
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('finance')}
                className="text-xs font-bold text-cyan-700 hover:text-cyan-800"
              >
                View Ledger
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {financialClaims.map((claim) => (
              <div key={claim.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-bold text-slate-800">{claim.claim_number}</span>
                    <span className="text-xs font-semibold text-slate-700">{claim.project_name.split('—')[0]}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                    claim.status === 'Paid' ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-amber-50 text-amber-800 border-amber-300'
                  }`}>
                    {claim.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-600 pt-1">
                  <span>Period Ending: {claim.period_ending}</span>
                  <span className="font-mono font-bold text-slate-900">
                    Net: RM {claim.net_claim_amount.toLocaleString()}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
              <CreditCard className="w-4 h-4 text-cyan-600" />
              <span>Recent Cash Transactions</span>
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('finance')}
                className="text-xs font-bold text-cyan-700 hover:text-cyan-800"
              >
                All Transactions
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {payments.map((p) => (
              <div key={p.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-[11px] font-bold text-slate-700">{p.reference_no}</span>
                    <span className="text-xs font-extrabold text-slate-900">{p.party_name}</span>
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    {p.type} • {p.date} via {p.payment_method}
                  </div>
                </div>

                <div className={`font-mono text-xs font-black ${
                  p.type === 'Client Inflow' ? 'text-emerald-700' : 'text-slate-900'
                }`}>
                  {p.type === 'Client Inflow' ? '+' : '-'}RM {p.amount.toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
