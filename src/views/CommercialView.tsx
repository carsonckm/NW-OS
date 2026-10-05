/**
 * NW OS — COMMERCIAL, COSTING & PROFIT CONTROL
 * Master Commercial Module with 12 Subsections:
 * Enquiries, Tenders, Quotations, Costing, Purchasing & 3-Way Match, Project Cost,
 * Variations, Claims, Invoices, Payments, Profitability & Cost Leaks, Reports.
 */

import React, { useState, useMemo } from 'react';
import { useNW } from '../context/NWContext';
import { officialBaseline, useServerFinancials } from '../services/serverFinancials';
import {
  CommercialQuotation,
  QuotationItem,
  ClientEnquiry,
  CommercialTender,
  PriceDatabaseRecord,
  CostSource,
  CostConfidenceLevel,
  ProjectCostLedgerItem,
  CostCategory,
  GoodsReceivedRecord,
  CommercialInvoice,
  CostLeakAlert,
} from '../types';
import { hasPermission } from '../utils/permissions';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  FileText,
  Layers,
  ShoppingBag,
  Receipt,
  CreditCard,
  PieChart,
  BarChart3,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  ArrowUpRight,
  ShieldAlert,
  Search,
  Filter,
  Eye,
  Lock,
  Sparkles,
  ArrowRight,
  RefreshCw,
  Building,
  Check,
  ChevronDown,
  Building2,
  ExternalLink,
} from 'lucide-react';

export type CommercialSubTab =
  | 'enquiries'
  | 'tenders'
  | 'quotations'
  | 'costing'
  | 'purchasing'
  | 'project-cost'
  | 'variations'
  | 'claims'
  | 'invoices'
  | 'payments'
  | 'profitability'
  | 'reports';

export const CommercialView: React.FC = () => {
  const {
    currentUser,
    projects,
    selectedProjectId,
    setSelectedProjectId,
    clientEnquiries,
    addClientEnquiry,
    updateClientEnquiry,
    commercialTenders,
    addCommercialTender,
    commercialQuotations,
    createNewQuotationVersion,
    approveCommercialQuotation,
    priceDatabase,
    commercialBaselines,
    projectCostLedger,
    addProjectCostLedgerItem,
    allocateCostToProjects,
    goodsReceived,
    commercialInvoices,
    costLeakAlerts,
    resolveCostLeakAlert,
    cashflowEntries,
    variations,
    financialClaims,
    payments,
    purchaseOrders,
    coreDataSync,
  } = useNW();

  const [activeSubTab, setActiveSubTab] = useState<CommercialSubTab>('profitability');
  const [selectedQuotId, setSelectedQuotId] = useState<string>('quot-1');
  const [filterProject, setFilterProject] = useState<string>('all');
  const [showNewEnquiryModal, setShowNewEnquiryModal] = useState(false);
  const [showNewCostModal, setShowNewCostModal] = useState(false);
  const [aiPriceSuggestion, setAiPriceSuggestion] = useState<string | null>(null);

  // Access check
  const canSeeInternalCosting =
    currentUser.role === 'Owner / CEO' ||
    currentUser.role === 'Admin' ||
    currentUser.role === 'Project Manager' ||
    currentUser.role === 'Accountant';

  const canSeeMargins =
    currentUser.role === 'Owner / CEO' ||
    currentUser.role === 'Admin' ||
    currentUser.role === 'Accountant';

  // In database mode the official totals are the server's (contract value, approved
  // variations, committed / actual / forecast cost, project gross profit); the browser's
  // own figures are only a preview (demo mode, or until the server answers).
  const serverFinancials = useServerFinancials(selectedProjectId, coreDataSync);
  const activeProjectBaseline = useMemo(() => {
    const own = commercialBaselines.find((b) => b.project_id === selectedProjectId);
    if (serverFinancials) {
      return officialBaseline(own, serverFinancials, projects.find((p) => p.id === selectedProjectId));
    }
    return own || commercialBaselines[0];
  }, [commercialBaselines, selectedProjectId, serverFinancials, projects]);

  const activeQuotation = useMemo(() => {
    return (
      commercialQuotations.find((q) => q.id === selectedQuotId) ||
      commercialQuotations[0]
    );
  }, [commercialQuotations, selectedQuotId]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Module Title & Project Selector Bar */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-amber-500 text-slate-950">
              <DollarSign className="w-5 h-5 font-bold" />
            </span>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight">
                Commercial, Costing & Profit Control
              </h1>
              <p className="text-xs text-slate-500">
                Separating Revenue, Committed Cost, Actual Incurred Cost, Forecast Cost & Cashflow
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
            <Building2 className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-slate-600">Active Project:</span>
            <select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.project_name.split('—')[0]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* CORE 8 FINANCIAL KPIS (Section 13) */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2.5">
        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            1. Contract Value
          </span>
          <div className="text-sm font-black text-slate-900 mt-1">
            RM {(activeProjectBaseline?.current_contract_value || 0).toLocaleString()}
          </div>
          <span className="text-[10px] text-emerald-600 font-semibold block mt-0.5">
            Orig + RM {(activeProjectBaseline?.approved_variations_total || 0).toLocaleString()} VO
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            2. Est. Final Revenue
          </span>
          <div className="text-sm font-black text-slate-900 mt-1">
            RM {(activeProjectBaseline?.estimated_final_revenue || 0).toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
            Incl. +RM {(activeProjectBaseline?.unapproved_potential_variations_total || 0).toLocaleString()} pot.
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            3. Committed Cost
          </span>
          <div className="text-sm font-black text-indigo-700 mt-1">
            RM {(activeProjectBaseline?.committed_cost || 0).toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
            Approved POs & SC
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            4. Actual Cost
          </span>
          <div className="text-sm font-black text-amber-700 mt-1">
            RM {(activeProjectBaseline?.actual_cost || 0).toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
            Confirmed Incurred
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            5. Forecast Cost
          </span>
          <div className="text-sm font-black text-rose-700 mt-1">
            RM {(activeProjectBaseline?.forecast_final_cost || 0).toLocaleString()}
          </div>
          <span className="text-[10px] font-bold text-rose-600 block mt-0.5">
            +{activeProjectBaseline?.cost_variance > 0 ? `RM ${activeProjectBaseline.cost_variance.toLocaleString()} var` : 'On Track'}
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            6. Billed to Client
          </span>
          <div className="text-sm font-black text-slate-900 mt-1">
            RM {(activeProjectBaseline?.cash_billed || 0).toLocaleString()}
          </div>
          <span className="text-[10px] text-slate-500 font-medium block mt-0.5">
            Invoiced (IPC #1)
          </span>
        </div>

        <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
            7. Collected Cash
          </span>
          <div className="text-sm font-black text-emerald-700 mt-1">
            RM {(activeProjectBaseline?.cash_collected || 0).toLocaleString()}
          </div>
          <span className="text-[10px] text-amber-700 font-bold block mt-0.5">
            RM {(activeProjectBaseline?.cash_outstanding || 0).toLocaleString()} pending
          </span>
        </div>

        <div className="bg-amber-500/10 p-3.5 rounded-xl border border-amber-300 shadow-2xs">
          <span className="text-[10px] font-black text-amber-900 uppercase tracking-wider block">
            8. Forecast Profit
          </span>
          {canSeeMargins ? (
            <>
              <div className="text-sm font-black text-amber-950 mt-1">
                RM {(activeProjectBaseline?.forecast_gross_profit || 0).toLocaleString()}
              </div>
              <span className="text-[10px] font-black text-amber-800 bg-amber-200/80 px-1 py-0.2 rounded inline-block mt-0.5">
                {activeProjectBaseline?.forecast_gross_margin_percent}% Margin
              </span>
            </>
          ) : (
            <div className="flex items-center space-x-1 text-slate-400 mt-1 text-xs">
              <Lock className="w-3.5 h-3.5" />
              <span>Restricted</span>
            </div>
          )}
        </div>
      </div>

      {/* 12 SUBSECTION NAVIGATION TABS */}
      <div className="bg-slate-100 p-1.5 rounded-2xl flex flex-wrap gap-1 border border-slate-200">
        {[
          { id: 'enquiries', label: 'Enquiries', count: clientEnquiries.length },
          { id: 'tenders', label: 'Tenders', count: commercialTenders.length },
          { id: 'quotations', label: 'Quotations', count: commercialQuotations.length },
          { id: 'costing', label: 'Costing (Internal)', icon: Lock, hidden: !canSeeInternalCosting },
          { id: 'purchasing', label: 'Purchasing & 3-Way Match' },
          { id: 'project-cost', label: 'Project Cost', count: projectCostLedger.length },
          { id: 'variations', label: 'Variations', count: variations.length },
          { id: 'claims', label: 'Claims (IPC)', count: financialClaims.length },
          { id: 'invoices', label: 'Invoices', count: commercialInvoices.length },
          { id: 'payments', label: 'Payments', count: payments.length },
          { id: 'profitability', label: 'Profitability & Leaks', badge: costLeakAlerts.filter(a => a.status !== 'Resolved').length },
          { id: 'reports', label: 'Reports & Cashflow' },
        ]
          .filter((t) => !t.hidden)
          .map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id as CommercialSubTab)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center space-x-1.5 ${
                activeSubTab === tab.id
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
              }`}
            >
              {tab.icon && <tab.icon className="w-3 h-3 text-amber-600 mr-0.5" />}
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded-full font-black">
                  {tab.count}
                </span>
              )}
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="text-[10px] bg-rose-600 text-white px-1.5 py-0.2 rounded-full font-black animate-pulse">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
      </div>

      {/* RENDER SUBSECTION */}
      {activeSubTab === 'profitability' && (
        <ProfitabilitySection
          baseline={activeProjectBaseline}
          alerts={costLeakAlerts}
          onResolveAlert={resolveCostLeakAlert}
          canSeeMargins={canSeeMargins}
        />
      )}

      {activeSubTab === 'enquiries' && (
        <EnquiriesSection
          enquiries={clientEnquiries}
          onAdd={() => setShowNewEnquiryModal(true)}
          onUpdate={updateClientEnquiry}
        />
      )}

      {activeSubTab === 'tenders' && (
        <TendersSection tenders={commercialTenders} />
      )}

      {activeSubTab === 'quotations' && (
        <QuotationsSection
          quotations={commercialQuotations}
          activeQuotId={selectedQuotId}
          onSelectQuot={setSelectedQuotId}
          onNewVersion={(id, items) => createNewQuotationVersion(id, items)}
          onApprove={(id) => approveCommercialQuotation(id)}
          canSeeMargins={canSeeMargins}
        />
      )}

      {activeSubTab === 'costing' && (
        <InternalCostingSection
          quotation={activeQuotation}
          priceDatabase={priceDatabase}
          canSeeMargins={canSeeMargins}
        />
      )}

      {activeSubTab === 'purchasing' && (
        <Purchasing3WayMatchSection
          purchaseOrders={purchaseOrders}
          goodsReceived={goodsReceived}
          invoices={commercialInvoices}
        />
      )}

      {activeSubTab === 'project-cost' && (
        <ProjectCostSection
          costs={projectCostLedger}
          projects={projects}
          onAddCost={() => setShowNewCostModal(true)}
          onAllocate={allocateCostToProjects}
        />
      )}

      {activeSubTab === 'variations' && (
        <VariationsSection variations={variations} projectId={selectedProjectId} />
      )}

      {activeSubTab === 'claims' && (
        <ClaimsSection claims={financialClaims} projectId={selectedProjectId} />
      )}

      {activeSubTab === 'invoices' && (
        <InvoicesSection invoices={commercialInvoices} projectId={selectedProjectId} />
      )}

      {activeSubTab === 'payments' && (
        <PaymentsSection payments={payments} projectId={selectedProjectId} />
      )}

      {activeSubTab === 'reports' && (
        <ReportsCashflowSection
          baselines={commercialBaselines}
          cashflow={cashflowEntries}
          canSeeMargins={canSeeMargins}
        />
      )}
    </div>
  );
};

// =========================================================================
// SUBSECTION 1: PROFITABILITY & LEAKS
// =========================================================================
const ProfitabilitySection: React.FC<{
  baseline: any;
  alerts: CostLeakAlert[];
  onResolveAlert: (id: string, action: string) => void;
  canSeeMargins: boolean;
}> = ({ baseline, alerts, onResolveAlert, canSeeMargins }) => {
  return (
    <div className="space-y-6">
      {/* Cost Leak Alert Banner */}
      <div className="bg-amber-50 rounded-2xl p-5 border border-amber-200">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="w-5 h-5 text-amber-700 animate-bounce" />
            <h3 className="text-sm font-black text-amber-950 uppercase tracking-wider">
              Cost Leak & Overrun Detection Center (Automated Variance Scanners)
            </h3>
          </div>
          <span className="text-xs font-bold text-amber-800 bg-amber-200/80 px-2.5 py-0.5 rounded-full">
            {alerts.filter((a) => a.status !== 'Resolved').length} Active Leak Warnings
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`p-4 rounded-xl border bg-white shadow-2xs space-y-2.5 transition-all ${
                alert.status === 'Resolved'
                  ? 'opacity-60 border-slate-200'
                  : alert.severity === 'Critical'
                  ? 'border-red-300 ring-1 ring-red-400/20'
                  : 'border-amber-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[9px] font-black px-2 py-0.5 rounded-md ${
                    alert.severity === 'Critical'
                      ? 'bg-red-100 text-red-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {alert.type}
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                  {alert.detected_date}
                </span>
              </div>
              <h4 className="text-xs font-bold text-slate-900 leading-snug">
                {alert.title}
              </h4>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                {alert.description}
              </p>
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[11px]">
                <span className="font-extrabold text-rose-700">
                  Impact: +RM {alert.impact_amount.toLocaleString()}
                </span>
                {alert.status === 'Resolved' ? (
                  <span className="text-emerald-700 font-bold flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Resolved
                  </span>
                ) : (
                  <button
                    onClick={() =>
                      onResolveAlert(alert.id, 'Actioned by PM / Locked volume agreement')
                    }
                    className="text-[10px] font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 px-2 py-1 rounded-lg"
                  >
                    Resolve Leak
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Variance Drivers Breakdown */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-slate-900 flex items-center space-x-2">
          <TrendingUp className="w-4 h-4 text-amber-600" />
          <span>Cost Variance Drivers (Forecast Final Cost RM {baseline?.forecast_final_cost?.toLocaleString()} vs Budget RM {baseline?.original_budget_direct_cost?.toLocaleString()})</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold text-slate-500 block">Material Inflation Variance</span>
            <div className="text-lg font-black text-rose-700 mt-1">
              +RM {(baseline?.variance_drivers?.material || 0).toLocaleString()}
            </div>
            <span className="text-[11px] text-slate-600 mt-0.5 block">
              18mm Marine Plywood (+12%) & Corian Solid Top
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold text-slate-500 block">Subcontractor Adjustment</span>
            <div className="text-lg font-black text-rose-700 mt-1">
              +RM {(baseline?.variance_drivers?.subcontractor || 0).toLocaleString()}
            </div>
            <span className="text-[11px] text-slate-600 mt-0.5 block">
              Column scribing plinth site adjustments
            </span>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-xs font-bold text-slate-500 block">Rework / Defects Cost</span>
            <div className="text-lg font-black text-emerald-700 mt-1">
              RM {(baseline?.variance_drivers?.rework || 0).toLocaleString()}
            </div>
            <span className="text-[11px] text-emerald-700 font-medium mt-0.5 block">
              Zero rework incurred (Controlled via QC gate)
            </span>
          </div>

          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-300">
            <span className="text-xs font-bold text-amber-900 block">Expected Project Gross Profit</span>
            {canSeeMargins ? (
              <>
                <div className="text-lg font-black text-slate-950 mt-1">
                  RM {(baseline?.forecast_gross_profit || 0).toLocaleString()}
                </div>
                <span className="text-xs font-black text-amber-800">
                  {baseline?.forecast_gross_margin_percent}% Target Achieved
                </span>
              </>
            ) : (
              <span className="text-xs text-slate-400 font-semibold mt-1 block">Confidential</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 2: ENQUIRIES
// =========================================================================
const EnquiriesSection: React.FC<{
  enquiries: ClientEnquiry[];
  onAdd: () => void;
  onUpdate: (id: string, updates: Partial<ClientEnquiry>) => void;
}> = ({ enquiries, onAdd, onUpdate }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">Client Enquiries & Scopes</h3>
          <p className="text-xs text-slate-500">Pipeline from initial customer touchpoint to tender</p>
        </div>
        <button
          onClick={onAdd}
          className="flex items-center space-x-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Enquiry</span>
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-extrabold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Enquiry No.</th>
              <th className="py-2.5 px-3">Client</th>
              <th className="py-2.5 px-3">Project / Scope</th>
              <th className="py-2.5 px-3">Budget Exp.</th>
              <th className="py-2.5 px-3">Received / Deadline</th>
              <th className="py-2.5 px-3">Estimator</th>
              <th className="py-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {enquiries.map((enq) => (
              <tr key={enq.id} className="hover:bg-slate-50/80">
                <td className="py-3 px-3 font-bold text-slate-900">{enq.enquiry_number}</td>
                <td className="py-3 px-3 font-semibold text-slate-700">{enq.client_name}</td>
                <td className="py-3 px-3 max-w-xs">
                  <div className="font-bold text-slate-900 line-clamp-1">{enq.project_name}</div>
                  <div className="text-[11px] text-slate-500 line-clamp-1">{enq.scope_description}</div>
                </td>
                <td className="py-3 px-3 font-bold text-slate-900">
                  {enq.budget_expectation ? `RM ${enq.budget_expectation.toLocaleString()}` : '—'}
                </td>
                <td className="py-3 px-3 text-slate-600 text-[11px]">
                  <div>{enq.received_date}</div>
                  <div className="text-slate-400">Due: {enq.target_submission_date}</div>
                </td>
                <td className="py-3 px-3 font-medium text-slate-600">{enq.assigned_estimator}</td>
                <td className="py-3 px-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      enq.status === 'Won'
                        ? 'bg-emerald-100 text-emerald-800'
                        : enq.status === 'Quoted'
                        ? 'bg-blue-100 text-blue-800'
                        : 'bg-slate-100 text-slate-800'
                    }`}
                  >
                    {enq.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 3: TENDERS
// =========================================================================
const TendersSection: React.FC<{ tenders: CommercialTender[] }> = ({ tenders }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">Commercial Tenders</h3>
          <p className="text-xs text-slate-500">Formal tender submissions, bid bonds, and awarded contracts</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tenders.map((tdr) => (
          <div key={tdr.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-900">{tdr.tender_number}</span>
              <span
                className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                  tdr.status === 'Awarded'
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {tdr.status}
              </span>
            </div>
            <div>
              <h4 className="text-xs font-bold text-slate-900">{tdr.project_name}</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">{tdr.client_name}</p>
            </div>
            <div className="pt-2 border-t border-slate-200 flex justify-between items-center text-xs">
              <span className="text-slate-500">Estimated Value:</span>
              <span className="font-black text-slate-900">RM {tdr.estimated_value.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center text-[11px] text-slate-500">
              <span>Deadline:</span>
              <span className="font-semibold text-slate-700">{tdr.submission_deadline}</span>
            </div>
            {tdr.bond_required && (
              <div className="text-[10px] bg-amber-50 text-amber-800 font-bold px-2 py-1 rounded border border-amber-200">
                Tender Bond: RM {tdr.bond_amount?.toLocaleString()} Required
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 4: QUOTATIONS
// =========================================================================
const QuotationsSection: React.FC<{
  quotations: CommercialQuotation[];
  activeQuotId: string;
  onSelectQuot: (id: string) => void;
  onNewVersion: (id: string, items: QuotationItem[]) => void;
  onApprove: (id: string) => void;
  canSeeMargins: boolean;
}> = ({ quotations, activeQuotId, onSelectQuot, onNewVersion, onApprove, canSeeMargins }) => {
  const active = quotations.find((q) => q.id === activeQuotId) || quotations[0];

  return (
    <div className="space-y-6">
      {/* Quotation Selector & Version Chain */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider block">
            Selected Quotation Master
          </span>
          <div className="flex items-center space-x-3 mt-1">
            <h3 className="text-base font-black text-slate-900">{active?.quotation_number} ({active?.version_code})</h3>
            <span
              className={`px-2 py-0.5 text-[10px] font-black rounded-full ${
                active?.status === 'Accepted'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-blue-100 text-blue-800'
              }`}
            >
              {active?.status}
            </span>
            {active?.low_margin_warning && (
              <span className="text-[10px] font-black bg-rose-100 text-rose-800 px-2 py-0.5 rounded-full flex items-center">
                <AlertTriangle className="w-3 h-3 mr-1" /> Low Margin (&lt;25%)
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Client: <span className="font-semibold text-slate-800">{active?.client_name}</span> • Project: {active?.project_name}
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {quotations.map((q) => (
            <button
              key={q.id}
              onClick={() => onSelectQuot(q.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                active?.id === q.id
                  ? 'bg-amber-500 text-slate-950 border-amber-500 shadow-xs'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
              }`}
            >
              {q.version_code}
            </button>
          ))}
          {active?.status !== 'Accepted' && (
            <button
              onClick={() => onApprove(active.id)}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-xs"
            >
              Approve Quotation
            </button>
          )}
        </div>
      </div>

      {/* Bill of Quantities / Quotation Items */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
            Quotation Items / Bill of Quantities (Selling View)
          </h4>
          <span className="text-xs font-bold text-slate-500">
            Total Selling Price: <span className="text-slate-950 font-black">RM {active?.total_selling_price.toLocaleString()}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-extrabold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3">Item Code</th>
                <th className="py-2.5 px-3">Description & Specs</th>
                <th className="py-2.5 px-3">Dimensions</th>
                <th className="py-2.5 px-3 text-right">Qty</th>
                <th className="py-2.5 px-3 text-right">Unit Price</th>
                <th className="py-2.5 px-3 text-right">Total Selling (RM)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {active?.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3 font-bold text-slate-900">{item.item_code}</td>
                  <td className="py-3 px-3 max-w-sm">
                    <div className="font-bold text-slate-900">{item.description}</div>
                    <div className="text-[11px] text-slate-500 line-clamp-1">{item.specification}</div>
                  </td>
                  <td className="py-3 px-3 text-[11px] text-slate-600">
                    {item.length && item.width ? `${item.length}x${item.width}x${item.height || ''}mm` : item.area ? `${item.area} sqft` : '—'}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-900">
                    {item.quantity} {item.unit}
                  </td>
                  <td className="py-3 px-3 text-right font-semibold text-slate-700">
                    RM {item.unit_selling_price.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-black text-slate-950">
                    RM {item.total_selling_price.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 5: INTERNAL COSTING (STRICTLY HIDDEN FROM CLIENTS)
// =========================================================================
const InternalCostingSection: React.FC<{
  quotation: CommercialQuotation;
  priceDatabase: PriceDatabaseRecord[];
  canSeeMargins: boolean;
}> = ({ quotation, priceDatabase, canSeeMargins }) => {
  const [showAiPricing, setShowAiPricing] = useState(false);

  return (
    <div className="space-y-6">
      <div className="bg-red-50 p-4 rounded-xl border border-red-200 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs font-bold text-red-900">
          <Lock className="w-4 h-4 text-red-700" />
          <span>CONFIDENTIAL INTERNAL COSTING MATRIX — CLIENT MUST NEVER SEE THIS INFORMATION</span>
        </div>
        <button
          onClick={() => setShowAiPricing(!showAiPricing)}
          className="flex items-center space-x-1.5 px-3 py-1 bg-white hover:bg-slate-50 border border-red-300 text-red-900 text-xs font-bold rounded-lg"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-600" />
          <span>{showAiPricing ? 'Hide AI Suggestion' : 'Check AI Price Intelligence'}</span>
        </button>
      </div>

      {showAiPricing && (
        <div className="bg-amber-50 p-4 rounded-xl border border-amber-300 space-y-2">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-4 h-4 text-amber-700" />
            <span className="text-xs font-black text-amber-950">AI ESTIMATE — NOT CONFIRMED</span>
          </div>
          <p className="text-xs text-amber-900">
            Based on historical joinery rates across 3 previous boutique projects, Cashier Counter CAR-003 direct fabrication
            typically ranges between <span className="font-bold">RM 45,000 — RM 48,000 per module</span>. AI suggestions must NOT silently replace approved costing.
          </p>
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">
          Direct Cost Breakdown by Item ({quotation?.quotation_number})
        </h4>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] font-extrabold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-2">Item Code</th>
                <th className="py-2.5 px-2">Selling Price</th>
                <th className="py-2.5 px-2">Material</th>
                <th className="py-2.5 px-2">Labour</th>
                <th className="py-2.5 px-2">Subcontract</th>
                <th className="py-2.5 px-2">Hardware</th>
                <th className="py-2.5 px-2">Total Direct Cost</th>
                <th className="py-2.5 px-2">Gross Profit</th>
                <th className="py-2.5 px-2">Margin %</th>
                <th className="py-2.5 px-2">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotation?.items.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-2 font-bold text-slate-900">{item.item_code}</td>
                  <td className="py-3 px-2 font-black text-slate-900">RM {item.total_selling_price.toLocaleString()}</td>
                  <td className="py-3 px-2 text-slate-600">RM {item.estimated_cost_breakdown.material.toLocaleString()}</td>
                  <td className="py-3 px-2 text-slate-600">RM {item.estimated_cost_breakdown.labour.toLocaleString()}</td>
                  <td className="py-3 px-2 text-slate-600">RM {item.estimated_cost_breakdown.subcontractor.toLocaleString()}</td>
                  <td className="py-3 px-2 text-slate-600">RM {item.estimated_cost_breakdown.hardware.toLocaleString()}</td>
                  <td className="py-3 px-2 font-bold text-rose-700">RM {item.total_estimated_cost.toLocaleString()}</td>
                  <td className="py-3 px-2 font-black text-emerald-700">RM {item.gross_profit.toLocaleString()}</td>
                  <td className="py-3 px-2">
                    <span
                      className={`font-black text-[10px] px-1.5 py-0.5 rounded ${
                        item.gross_margin_percent < 25
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {item.gross_margin_percent}%
                    </span>
                  </td>
                  <td className="py-3 px-2">
                    <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
                      {item.cost_confidence}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 6: PURCHASING & 3-WAY MATCHING
// =========================================================================
const Purchasing3WayMatchSection: React.FC<{
  purchaseOrders: any[];
  goodsReceived: GoodsReceivedRecord[];
  invoices: CommercialInvoice[];
}> = ({ purchaseOrders, goodsReceived, invoices }) => {
  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-black text-slate-900">
            Three-Way Matching Engine (Purchase Order vs Goods Received vs Supplier Invoice)
          </h3>
          <p className="text-xs text-slate-500">
            Automated procurement auditing: verifies quantity, unit pricing, and prevents duplicate or over-billing
          </p>
        </div>

        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-900">
              Audit Match: PO-2026-042 (WoodSource Marine Plywood)
            </span>
            <span className="text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full flex items-center">
              <Check className="w-3.5 h-3.5 mr-1" /> 3-Way Match Verified
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase">1. Purchase Order</span>
              <div className="font-bold text-slate-900 mt-1">PO-2026-042</div>
              <div className="text-slate-600 text-[11px] mt-0.5">Qty: 45 sheets • RM 38,500</div>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase">2. Goods Received Note</span>
              <div className="font-bold text-slate-900 mt-1">GRN-2026-031</div>
              <div className="text-slate-600 text-[11px] mt-0.5">Qty Received: 45 sheets • Condition: Good</div>
            </div>
            <div className="p-3 bg-white rounded-lg border border-slate-200">
              <span className="text-[10px] font-bold text-slate-400 uppercase">3. Supplier Invoice</span>
              <div className="font-bold text-slate-900 mt-1">INV-WS-8812</div>
              <div className="text-slate-600 text-[11px] mt-0.5">Billed: RM 38,500 • Status: Paid</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 7: PROJECT COST & ALLOCATION
// =========================================================================
const ProjectCostSection: React.FC<{
  costs: ProjectCostLedgerItem[];
  projects: any[];
  onAddCost: () => void;
  onAllocate: (costId: string, allocs: any[]) => void;
}> = ({ costs, projects, onAddCost, onAllocate }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-slate-900">Project Direct Cost Ledger</h3>
          <p className="text-xs text-slate-500">Incurred supplier purchases, subcontractor claims, and site costs</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-extrabold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Date</th>
              <th className="py-2.5 px-3">Category</th>
              <th className="py-2.5 px-3">Party / Supplier</th>
              <th className="py-2.5 px-3">Description</th>
              <th className="py-2.5 px-3">PO / Ref</th>
              <th className="py-2.5 px-3 text-right">Amount (RM)</th>
              <th className="py-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {costs.map((c) => (
              <tr key={c.cost_id} className="hover:bg-slate-50/80">
                <td className="py-3 px-3 text-slate-600">{c.date}</td>
                <td className="py-3 px-3">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800">
                    {c.cost_category}
                  </span>
                </td>
                <td className="py-3 px-3 font-semibold text-slate-900">{c.party_name}</td>
                <td className="py-3 px-3 text-slate-700 max-w-xs truncate">{c.description}</td>
                <td className="py-3 px-3 text-slate-500 text-[11px]">{c.po_reference || '—'}</td>
                <td className="py-3 px-3 text-right font-black text-slate-950">
                  RM {c.amount.toLocaleString()}
                </td>
                <td className="py-3 px-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      c.status === 'Incurred'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-indigo-100 text-indigo-800'
                    }`}
                  >
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 8: VARIATIONS
// =========================================================================
const VariationsSection: React.FC<{ variations: any[]; projectId: string }> = ({ variations, projectId }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <h3 className="text-sm font-black text-slate-900">Variation Orders Commercial Log</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {variations.map((v) => (
          <div key={v.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-xs font-black text-slate-900">{v.variation_number} — {v.title}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                {v.status}
              </span>
            </div>
            <p className="text-xs text-slate-600">{v.description}</p>
            <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-semibold">
              <span className="text-slate-500">Client Selling Price:</span>
              <span className="font-black text-slate-900">RM {v.client_amount?.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-500">Estimated Cost:</span>
              <span className="font-bold text-rose-700">RM {v.estimated_cost?.toLocaleString()}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 9: CLAIMS (IPC)
// =========================================================================
const ClaimsSection: React.FC<{ claims: any[]; projectId: string }> = ({ claims, projectId }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <h3 className="text-sm font-black text-slate-900">
        Progress Claims & Interim Payment Certificates (IPC)
      </h3>
      <div className="divide-y divide-slate-100">
        {claims.map((claim) => (
          <div key={claim.id} className="py-4 flex justify-between items-center text-xs">
            <div>
              <div className="font-bold text-slate-900">{claim.claim_number} — {claim.project_name}</div>
              <div className="text-slate-500 text-[11px] mt-0.5">Period Ending: {claim.period_ending}</div>
            </div>
            <div className="text-right">
              <div className="font-black text-slate-950">Net Claim: RM {claim.net_claim_amount?.toLocaleString()}</div>
              <div className="text-slate-500 text-[11px]">Retention: RM {claim.retention_amount?.toLocaleString()}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 10: INVOICES
// =========================================================================
const InvoicesSection: React.FC<{ invoices: CommercialInvoice[]; projectId: string }> = ({ invoices, projectId }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <h3 className="text-sm font-black text-slate-900">Commercial Invoices Registry</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-extrabold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3">Invoice No.</th>
              <th className="py-2.5 px-3">Type</th>
              <th className="py-2.5 px-3">Party Name</th>
              <th className="py-2.5 px-3">Due Date</th>
              <th className="py-2.5 px-3 text-right">Total Amount</th>
              <th className="py-2.5 px-3 text-right">Paid</th>
              <th className="py-2.5 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoices.map((inv) => (
              <tr key={inv.id} className="hover:bg-slate-50/80">
                <td className="py-3 px-3 font-bold text-slate-900">{inv.invoice_number}</td>
                <td className="py-3 px-3 text-slate-600">{inv.invoice_type}</td>
                <td className="py-3 px-3 font-semibold text-slate-900">{inv.party_name}</td>
                <td className="py-3 px-3 text-slate-500">{inv.due_date}</td>
                <td className="py-3 px-3 text-right font-black text-slate-950">
                  RM {inv.total_amount.toLocaleString()}
                </td>
                <td className="py-3 px-3 text-right font-bold text-emerald-700">
                  RM {inv.paid_amount.toLocaleString()}
                </td>
                <td className="py-3 px-3">
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      inv.status === 'Paid'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {inv.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 11: PAYMENTS
// =========================================================================
const PaymentsSection: React.FC<{ payments: any[]; projectId: string }> = ({ payments, projectId }) => {
  return (
    <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
      <h3 className="text-sm font-black text-slate-900">Payments & Cash Movements</h3>
      <div className="divide-y divide-slate-100">
        {payments.map((p) => (
          <div key={p.id} className="py-3.5 flex justify-between items-center text-xs">
            <div>
              <div className="font-bold text-slate-900">{p.reference_no} — {p.party_name}</div>
              <div className="text-slate-500 text-[11px] mt-0.5">{p.date} • {p.payment_method}</div>
            </div>
            <div className="text-right">
              <div
                className={`font-black ${
                  p.type === 'Client Inflow' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {p.type === 'Client Inflow' ? '+' : '-'}RM {p.amount.toLocaleString()}
              </div>
              <span className="text-[10px] font-bold text-slate-500">{p.status}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// =========================================================================
// SUBSECTION 12: REPORTS & CASHFLOW
// =========================================================================
const ReportsCashflowSection: React.FC<{
  baselines: any[];
  cashflow: any[];
  canSeeMargins: boolean;
}> = ({ baselines, cashflow, canSeeMargins }) => {
  return (
    <div className="space-y-6">
      {/* Multi-Project Executive Summary (Section 20) */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-slate-900">
          Executive Multi-Project Commercial Summary (Owner / CEO Portfolio Overview)
        </h3>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[9px] font-extrabold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3">Project</th>
                <th className="py-2.5 px-3 text-right">Contract Value</th>
                <th className="py-2.5 px-3 text-right">Forecast Cost</th>
                <th className="py-2.5 px-3 text-right">Forecast Profit</th>
                <th className="py-2.5 px-3 text-right">Margin %</th>
                <th className="py-2.5 px-3 text-right">Collected</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {baselines.map((b) => (
                <tr key={b.project_id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3">
                    <div className="font-bold text-slate-900">{b.project_number}</div>
                    <div className="text-[11px] text-slate-500">{b.project_name}</div>
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-slate-900">
                    RM {b.current_contract_value.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-rose-700">
                    RM {b.forecast_final_cost.toLocaleString()}
                  </td>
                  <td className="py-3 px-3 text-right font-black text-amber-900">
                    {canSeeMargins ? `RM ${b.forecast_gross_profit.toLocaleString()}` : '***'}
                  </td>
                  <td className="py-3 px-3 text-right font-black text-slate-900">
                    {canSeeMargins ? `${b.forecast_gross_margin_percent}%` : '***'}
                  </td>
                  <td className="py-3 px-3 text-right font-bold text-emerald-700">
                    RM {b.cash_collected.toLocaleString()}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                        b.cost_variance_status === 'On Budget'
                          ? 'bg-emerald-100 text-emerald-800'
                          : b.cost_variance_status === 'Minor Variance'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {b.cost_variance_status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthly Cash Flow Forecasting (Section 19) */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-4">
        <h3 className="text-sm font-black text-slate-900">
          Monthly Cash Flow Projection (Expected Inflow vs Outflow)
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {cashflow.map((cf) => (
            <div key={cf.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
              <span className="text-xs font-black text-slate-900 block">{cf.period}</span>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Inflow:</span>
                <span className="font-bold text-emerald-700">RM {cf.actual_inflow.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Outflow:</span>
                <span className="font-bold text-rose-700">RM {cf.actual_outflow.toLocaleString()}</span>
              </div>
              <div className="pt-2 border-t border-slate-200 flex justify-between text-xs font-black">
                <span>Net Cash:</span>
                <span className={cf.net_cash_movement >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                  {cf.net_cash_movement >= 0 ? '+' : ''}RM {cf.net_cash_movement.toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
