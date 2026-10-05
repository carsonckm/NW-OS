/**
 * NW OS — Finance & Accounting Module (Section 7)
 * Project cost tracking, Interim Payment Certificates (IPC Claims),
 * client payment inflows, contractor/supplier disbursements, and margins.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { FinancialClaim, PaymentRecord } from '../types';
import { canViewFinancialMargins, hasPermission } from '../utils/permissions';
import { usePortfolioFinancials } from '../services/serverFinancials';
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Building2,
  FileCheck2,
  AlertCircle,
  Plus,
  Search,
  Filter,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldAlert,
  Lock,
  Layers,
  Calendar,
  X,
  CheckCircle2,
} from 'lucide-react';

export const FinanceView: React.FC = () => {
  const {
    currentUser,
    projects,
    financialClaims,
    payments,
    variations,
    coreDataSync,
  } = useNW();

  const [activeTab, setActiveTab] = useState<'overview' | 'claims' | 'ledger' | 'variations'>('overview');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showClaimModal, setShowClaimModal] = useState(false);
  const [showPaymentModal, setShowPaymentModal] = useState(false);

  const canSeeMargins = canViewFinancialMargins(currentUser);

  // Official figures from the server in database mode (current contract value and project
  // gross profit per project); the local figures are only a preview in demo mode.
  const server = usePortfolioFinancials(canSeeMargins ? projects.map((p) => p.id) : [], coreDataSync);
  const official = (projectId: string) => server[projectId];
  const contractOf = (p: { id: string; contract_value: number }) => official(p.id)?.current_contract_value ?? p.contract_value;

  // Financial aggregates
  const totalContractValue = projects.reduce((sum, p) => sum + contractOf(p), 0);
  const totalClaimed = financialClaims.reduce((sum, c) => sum + c.cumulative_claimed, 0);
  const totalPaidInflow = payments
    .filter((p) => p.type === 'Client Inflow')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalOutflow = payments
    .filter((p) => p.type !== 'Client Inflow')
    .reduce((sum, p) => sum + p.amount, 0);
  const totalRetention = financialClaims.reduce((sum, c) => sum + c.retention_amount, 0);

  // Company gross margin: the sum of the server's project gross profits (forecast, before
  // company overheads). Demo mode has no server, so it keeps the illustrative 28.4%.
  const serverFigures = projects.map((p) => official(p.id)).filter((f) => f !== undefined);
  const hasServerFigures = serverFigures.length > 0;
  const serverSelling = serverFigures.reduce((sum, f) => sum + f!.selling_price, 0);
  const estimatedProfit = hasServerFigures
    ? serverFigures.reduce((sum, f) => sum + f!.project_gross_profit, 0)
    : totalContractValue * 0.284;
  // Demo mode has no server: the 28.4% is an illustration and is labelled as such. In
  // database mode only server figures are shown.
  const isDemoFigure = coreDataSync.mode !== 'database';
  const estimatedMarginPercent = hasServerFigures
    ? serverSelling > 0 ? Math.round((estimatedProfit / serverSelling) * 1000) / 10 : 0
    : 28.4;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-700 border border-cyan-200">
              <DollarSign className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
                <span>Finance & Commercial Accounts</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-cyan-50 text-cyan-800 border border-cyan-200">
                  Financial Control
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Interim payment claims (IPC), client inflows, subcontractor billing, retention sums, and profitability
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="text-right">
            <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Portfolio Value</span>
            <span className="text-lg font-black text-slate-900">
              RM {totalContractValue.toLocaleString()}
            </span>
          </div>
        </div>
      </div>

      {/* Financial KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Cumulative Claimed</span>
            <FileCheck2 className="w-4 h-4 text-cyan-600" />
          </span>
          <div className="text-xl font-black text-slate-900">RM {totalClaimed.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500 block">
            {((totalClaimed / totalContractValue) * 100).toFixed(1)}% of total contract value
          </span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Client Inflow Settled</span>
            <ArrowDownLeft className="w-4 h-4 text-emerald-600" />
          </span>
          <div className="text-xl font-black text-emerald-700">RM {totalPaidInflow.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500 block">Received into Maybank Islamic</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Subcontractor & PO Disbursed</span>
            <ArrowUpRight className="w-4 h-4 text-indigo-600" />
          </span>
          <div className="text-xl font-black text-slate-900">RM {totalOutflow.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500 block">Material & joinery payouts</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Company Margin & Profit</span>
            {canSeeMargins ? <TrendingUp className="w-4 h-4 text-amber-600" /> : <Lock className="w-4 h-4 text-slate-400" />}
          </span>
          {canSeeMargins ? (
            <>
              <div className="text-xl font-black text-amber-700">
                {isDemoFigure || hasServerFigures ? (
                  <>
                    {estimatedMarginPercent}% <span className="text-xs font-semibold text-slate-500">(RM {Math.round(estimatedProfit).toLocaleString()})</span>
                  </>
                ) : (
                  '—'
                )}
              </div>
              {isDemoFigure ? (
                <span className="text-[11px] text-amber-700 font-semibold block" data-testid="demo-figure">Demo figure (illustrative, not project data)</span>
              ) : (
                <span className="text-[11px] text-emerald-600 font-semibold block">Server-calculated project gross profit</span>
              )}
            </>
          ) : (
            <>
              <div className="text-sm font-bold text-slate-400 py-1">Confidential Margin</div>
              <span className="text-[10px] text-slate-400 block">Restricted to Owner & Accountant</span>
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-1 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'overview' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Project Cost Summary
        </button>

        <button
          onClick={() => setActiveTab('claims')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'claims' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Interim Payment Claims (IPC) ({financialClaims.length})
        </button>

        <button
          onClick={() => setActiveTab('ledger')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
            activeTab === 'ledger' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Transactions & Disbursements ({payments.length})
        </button>
      </div>

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
            <h3 className="text-sm font-extrabold text-slate-900">Active Projects Commercial Status</h3>
            <span className="text-xs text-slate-500">Currency in Malaysian Ringgit (MYR)</span>
          </div>

          <div className="overflow-x-auto scrollbar-none">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Contract Value</th>
                  <th className="py-3 px-4">Progress Status</th>
                  <th className="py-3 px-4">Billed Amount</th>
                  <th className="py-3 px-4">Retention Held (5%)</th>
                  {canSeeMargins && <th className="py-3 px-4 text-right">Target Margin</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projects.map((proj) => {
                  const projClaims = financialClaims.filter((c) => c.project_id === proj.id);
                  const billed = projClaims.reduce((s, c) => s + c.cumulative_claimed, 0);
                  const retention = projClaims.reduce((s, c) => s + c.retention_amount, 0);

                  return (
                    <tr key={proj.id} className="hover:bg-slate-50/50">
                      <td className="py-3.5 px-4">
                        <div className="font-extrabold text-slate-900">{proj.project_name}</div>
                        <span className="text-[11px] text-slate-500">{proj.project_number}</span>
                      </td>
                      <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                        RM {contractOf(proj).toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="flex items-center space-x-2">
                          <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className="bg-amber-500 h-1.5 rounded-full"
                              style={{ width: `${proj.progress_percent}%` }}
                            />
                          </div>
                          <span className="font-bold text-[11px] text-slate-700">{proj.progress_percent}%</span>
                        </div>
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-slate-800">
                        RM {billed.toLocaleString()}
                      </td>
                      <td className="py-3.5 px-4 text-slate-600">
                        RM {retention.toLocaleString()}
                      </td>
                      {canSeeMargins && (
                        <td className="py-3.5 px-4 text-right font-black text-amber-700">
                          {official(proj.id)?.project_gross_margin_percent ?? (isDemoFigure ? estimatedMarginPercent : '—')}
                          {official(proj.id) || isDemoFigure ? '%' : ''}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: CLAIMS */}
      {activeTab === 'claims' && (
        <div className="space-y-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                  <th className="py-3 px-4">Certificate No</th>
                  <th className="py-3 px-4">Project</th>
                  <th className="py-3 px-4">Period Ending</th>
                  <th className="py-3 px-4 text-right">Cumulative Claimed</th>
                  <th className="py-3 px-4 text-right">Retention (5%)</th>
                  <th className="py-3 px-4 text-right">Net Payable</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4">Invoice Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {financialClaims.map((claim) => (
                  <tr key={claim.id} className="hover:bg-slate-50/50">
                    <td className="py-3 px-4 font-mono font-black text-slate-900">{claim.claim_number}</td>
                    <td className="py-3 px-4 font-semibold text-slate-800">{claim.project_name.split('—')[0]}</td>
                    <td className="py-3 px-4 text-slate-600">{claim.period_ending}</td>
                    <td className="py-3 px-4 text-right font-mono">RM {claim.cumulative_claimed.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-mono text-slate-500">RM {claim.retention_amount.toLocaleString()}</td>
                    <td className="py-3 px-4 text-right font-mono font-extrabold text-slate-900">
                      RM {claim.net_claim_amount.toLocaleString()}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          claim.status === 'Paid'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : claim.status === 'Certified'
                            ? 'bg-blue-50 text-blue-700 border-blue-300'
                            : 'bg-amber-50 text-amber-800 border-amber-300'
                        }`}
                      >
                        {claim.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-600">{claim.invoice_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: LEDGER */}
      {activeTab === 'ledger' && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-100/80 text-slate-700 font-bold border-b border-slate-200">
                <th className="py-3 px-4">Ref No</th>
                <th className="py-3 px-4">Transaction Type</th>
                <th className="py-3 px-4">Beneficiary / Payer</th>
                <th className="py-3 px-4">Method</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4 text-right">Amount (MYR)</th>
                <th className="py-3 px-4 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {payments.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50/50">
                  <td className="py-3 px-4 font-mono text-slate-800">{p.reference_no}</td>
                  <td className="py-3 px-4">
                    <span
                      className={`inline-flex items-center space-x-1 font-bold text-[11px] ${
                        p.type === 'Client Inflow' ? 'text-emerald-700' : 'text-slate-800'
                      }`}
                    >
                      {p.type === 'Client Inflow' ? <ArrowDownLeft className="w-3.5 h-3.5" /> : <ArrowUpRight className="w-3.5 h-3.5 text-indigo-600" />}
                      <span>{p.type}</span>
                    </span>
                  </td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{p.party_name}</td>
                  <td className="py-3 px-4 text-slate-600">{p.payment_method}</td>
                  <td className="py-3 px-4 text-slate-500">{p.date}</td>
                  <td className={`py-3 px-4 text-right font-black font-mono ${p.type === 'Client Inflow' ? 'text-emerald-700' : 'text-slate-900'}`}>
                    {p.type === 'Client Inflow' ? '+' : '-'}RM {p.amount.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-center">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {p.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
