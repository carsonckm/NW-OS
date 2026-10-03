import React, { useState } from 'react';
import {
  Award,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  TrendingDown,
  Clock,
  Sparkles,
  ArrowRight,
  UserCheck,
  Building2,
  Wrench,
  Truck,
  Plus,
  Lock,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';

export const OwnerControlCenterTab: React.FC = () => {
  const {
    tasks,
    approvals,
    escalations,
    ownerOverrides,
    createOwnerOverride,
    costLeakAlerts,
    commercialInvoices,
    productionOrders,
    deliveryRecords,
    currentUser,
  } = useNW();

  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideData, setOverrideData] = useState({
    affected_record_type: 'ProductionOrder',
    affected_record_id: 'PO-2026-001',
    reason: 'Executive authorization to fast-track fabrication to meet mall grand opening date.',
    previous_rule_state: 'Blocked pending formal client color sample sign-off',
    new_decision: 'Released for immediate fabrication and packing under Owner executive waiver',
  });
  const [overrideFeedback, setOverrideFeedback] = useState<string | null>(null);

  // Categorized exceptions for Owner Control Center (Section 45)
  const criticalItems = tasks.filter((t) => t.priority === 'Critical' && t.status !== 'Completed');
  const pendingDecisions = approvals.filter((a) => a.decision === 'Pending');
  const atRiskMatters = escalations.filter((e) => !e.resolved_at);
  const commercialCostRisks = costLeakAlerts?.filter((c) => c.status !== 'Resolved') || [];
  const overdueInvoices = commercialInvoices?.filter((i) => i.status === 'Overdue') || [];
  const blockedProduction = productionOrders?.filter((p) => p.status === 'Blocked' || p.revision_alert) || [];
  const siteDeliveryIssues = deliveryRecords?.filter((d) => d.status === 'Delivery Issue') || [];

  const handleCreateOverride = (e: React.FormEvent) => {
    e.preventDefault();
    createOwnerOverride({
      affected_record_type: overrideData.affected_record_type,
      affected_record_id: overrideData.affected_record_id,
      reason: overrideData.reason,
      previous_rule_state: overrideData.previous_rule_state,
      new_decision: overrideData.new_decision,
    });

    setOverrideFeedback(
      `✓ Executive Override authorized and formally recorded in audit trail for ${overrideData.affected_record_type} (${overrideData.affected_record_id}).`
    );
    setShowOverrideModal(false);
    setTimeout(() => setOverrideFeedback(null), 5000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 shadow-xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2 text-amber-400 text-xs font-mono uppercase tracking-wider mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span>Section 45 • Executive Exception Command</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white flex items-center gap-2.5">
            <Award className="w-7 h-7 text-amber-400" />
            Owner Control Center
          </h2>
          <p className="text-xs text-slate-300 mt-1 max-w-2xl">
            Strictly displays exceptions requiring Carson's executive decision or intervention. No routine clutter.
          </p>
        </div>

        <button
          onClick={() => setShowOverrideModal(true)}
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded-xl text-xs shadow-lg transition-all cursor-pointer self-start sm:self-center"
        >
          <Lock className="w-4 h-4" />
          <span>Authorize Workflow Override (Rule 44)</span>
        </button>
      </div>

      {overrideFeedback && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{overrideFeedback}</span>
          </div>
          <button onClick={() => setOverrideFeedback(null)} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
      )}

      {/* SECTION 45 EXCEPTION CATEGORIES */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* 1. 🔴 CRITICAL */}
        <div className="bg-white rounded-2xl border border-rose-300 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-rose-100 pb-2.5">
            <div className="flex items-center space-x-2 text-rose-900 font-black text-xs uppercase">
              <ShieldAlert className="w-4 h-4 text-rose-600" />
              <span>1. 🔴 Critical Issues ({criticalItems.length})</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 font-black">
              Immediate Ack
            </span>
          </div>

          <div className="space-y-2">
            {criticalItems.length === 0 ? (
              <div className="text-xs text-slate-400 py-3 italic text-center">No critical safety/legal defects.</div>
            ) : (
              criticalItems.map((item) => (
                <div key={item.id} className="p-3 bg-rose-50/80 rounded-xl border border-rose-200 text-xs space-y-1">
                  <div className="font-bold text-rose-950">{item.title}</div>
                  <div className="text-[11px] text-rose-800 line-clamp-2">{item.description}</div>
                  <div className="text-[10px] text-rose-600 font-bold pt-1">
                    Location: {item.project_name}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 2. 🧠 NEEDS MY DECISION */}
        <div className="bg-white rounded-2xl border border-blue-300 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-blue-100 pb-2.5">
            <div className="flex items-center space-x-2 text-blue-900 font-black text-xs uppercase">
              <Sparkles className="w-4 h-4 text-blue-600" />
              <span>2. 🧠 Decisions Required ({pendingDecisions.length})</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-100 text-blue-900 font-black">
              Executive Gate
            </span>
          </div>

          <div className="space-y-2">
            {pendingDecisions.length === 0 ? (
              <div className="text-xs text-slate-400 py-3 italic text-center">All major decisions up to date.</div>
            ) : (
              pendingDecisions.map((app) => (
                <div key={app.id} className="p-3 bg-blue-50/70 rounded-xl border border-blue-200 text-xs space-y-1">
                  <div className="flex justify-between font-mono text-[10px] text-blue-800 font-bold">
                    <span>{app.approval_number}</span>
                    <span>MYR {(app.impact_summary?.cost_impact_myr || 0).toLocaleString()}</span>
                  </div>
                  <div className="font-bold text-slate-900">{app.title}</div>
                  <div className="text-[10px] text-slate-500">Requested by: {app.requested_by_name}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 3. ⚠️ AT RISK */}
        <div className="bg-white rounded-2xl border border-amber-300 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-amber-100 pb-2.5">
            <div className="flex items-center space-x-2 text-amber-900 font-black text-xs uppercase">
              <AlertTriangle className="w-4 h-4 text-amber-600" />
              <span>3. ⚠️ At Risk Matters ({atRiskMatters.length})</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-black">
              Schedule / SLA
            </span>
          </div>

          <div className="space-y-2">
            {atRiskMatters.length === 0 ? (
              <div className="text-xs text-slate-400 py-3 italic text-center">Zero escalated milestones.</div>
            ) : (
              atRiskMatters.map((esc) => (
                <div key={esc.id} className="p-3 bg-amber-50/70 rounded-xl border border-amber-200 text-xs space-y-1">
                  <div className="font-bold text-amber-950">{esc.title}</div>
                  <div className="text-[11px] text-amber-800 line-clamp-2">{esc.reason}</div>
                  <div className="text-[10px] text-amber-700 font-bold">Current: {esc.current_level}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 4. 💰 COMMERCIAL & COST RISKS */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2 text-slate-900 font-black text-xs uppercase">
              <DollarSign className="w-4 h-4 text-emerald-600" />
              <span>4. 💰 Commercial & Leak Risks</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
              {commercialCostRisks.length + overdueInvoices.length} Items
            </span>
          </div>

          <div className="space-y-2 text-xs">
            {commercialCostRisks.slice(0, 2).map((alert) => (
              <div key={alert.id} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg space-y-0.5">
                <div className="font-bold text-slate-900">{alert.title}</div>
                <div className="text-[11px] text-rose-700 font-bold">Impact: MYR {alert.impact_amount.toLocaleString()}</div>
              </div>
            ))}
            {overdueInvoices.slice(0, 1).map((inv) => (
              <div key={inv.id} className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg space-y-0.5">
                <div className="font-bold text-rose-950">Overdue Claim: {inv.invoice_number}</div>
                <div className="text-[11px] text-rose-800">MYR {inv.total_amount.toLocaleString()} overdue by 7 days</div>
              </div>
            ))}
          </div>
        </div>

        {/* 5. 🏭 PRODUCTION BLOCKS */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2 text-slate-900 font-black text-xs uppercase">
              <Wrench className="w-4 h-4 text-orange-600" />
              <span>5. 🏭 Production Blockages</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
              {blockedProduction.length} Blocked
            </span>
          </div>

          <div className="space-y-2 text-xs">
            {blockedProduction.length === 0 ? (
              <div className="text-slate-400 py-3 italic text-center">Factory lines flowing smoothly.</div>
            ) : (
              blockedProduction.map((p) => (
                <div key={p.id} className="p-2.5 bg-orange-50 border border-orange-200 rounded-lg space-y-0.5">
                  <div className="font-bold text-orange-950">{p.order_number} ({p.work_item_code})</div>
                  <div className="text-[11px] text-orange-800">{p.blocking_reason || 'Pending drawing revision check'}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 6. 🚚 SITE DELIVERY & INSTALLATION */}
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
            <div className="flex items-center space-x-2 text-slate-900 font-black text-xs uppercase">
              <Truck className="w-4 h-4 text-indigo-600" />
              <span>6. 🚚 Site Delivery Exceptions</span>
            </div>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-bold">
              {siteDeliveryIssues.length} Issues
            </span>
          </div>

          <div className="space-y-2 text-xs">
            {siteDeliveryIssues.length === 0 ? (
              <div className="text-slate-400 py-3 italic text-center">Zero site delivery incidents.</div>
            ) : (
              siteDeliveryIssues.map((d) => (
                <div key={d.id} className="p-2.5 bg-indigo-50 border border-indigo-200 rounded-lg space-y-0.5">
                  <div className="font-bold text-indigo-950">{d.delivery_number} ({d.project_name})</div>
                  <div className="text-[11px] text-indigo-800">{d.notes}</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Section 44: Executive Overrides Audit Log Table */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Executive Overrides Audit Log (Rule 44)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              The Owner may override standard holds, but the action is permanently and transparently recorded.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-slate-500">
            {ownerOverrides.length} Authorizations Logged
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                <th className="pb-3">Timestamp & Authorized By</th>
                <th className="pb-3">Affected Record</th>
                <th className="pb-3">Previous Rule Hold</th>
                <th className="pb-3">New Decision / Waiver</th>
                <th className="pb-3">Executive Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ownerOverrides.map((ovr) => (
                <tr key={ovr.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-3">
                    <div className="font-bold text-slate-900">{ovr.overridden_by}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {new Date(ovr.timestamp).toLocaleString()}
                    </div>
                  </td>

                  <td className="py-3">
                    <span className="font-mono font-bold text-purple-900 bg-purple-50 px-2 py-0.5 rounded border border-purple-200">
                      {ovr.affected_record_type} ({ovr.affected_record_id})
                    </span>
                  </td>

                  <td className="py-3 text-slate-600 italic max-w-xs truncate">
                    {ovr.previous_rule_state}
                  </td>

                  <td className="py-3 font-semibold text-slate-900 max-w-xs truncate">
                    {ovr.new_decision}
                  </td>

                  <td className="py-3 text-slate-700 max-w-xs truncate">
                    {ovr.reason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Authorize Override Modal */}
      {showOverrideModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <span>Executive Workflow Override (Rule 44)</span>
              </h3>
              <button
                onClick={() => setShowOverrideModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateOverride} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Affected Record Type</label>
                <select
                  value={overrideData.affected_record_type}
                  onChange={(e) => setOverrideData({ ...overrideData, affected_record_type: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                >
                  <option value="ProductionOrder">Production Order</option>
                  <option value="PurchaseOrder">Purchase Order</option>
                  <option value="DeliveryRecord">Delivery Record</option>
                  <option value="WorkItem">Work Item</option>
                  <option value="Drawing">Drawing Approval</option>
                  <option value="Variation">Variation Order</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Record ID / Code</label>
                <input
                  type="text"
                  required
                  value={overrideData.affected_record_id}
                  onChange={(e) => setOverrideData({ ...overrideData, affected_record_id: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Previous Rule State (Being Bypassed)</label>
                <input
                  type="text"
                  required
                  value={overrideData.previous_rule_state}
                  onChange={(e) => setOverrideData({ ...overrideData, previous_rule_state: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">New Authorized Decision</label>
                <input
                  type="text"
                  required
                  value={overrideData.new_decision}
                  onChange={(e) => setOverrideData({ ...overrideData, new_decision: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg font-semibold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Mandatory Business Justification</label>
                <textarea
                  rows={3}
                  required
                  placeholder="State commercial, schedule, or operational justification..."
                  value={overrideData.reason}
                  onChange={(e) => setOverrideData({ ...overrideData, reason: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
                ⚠️ <strong>Rule 44:</strong> Never silently bypass workflow. This override will be logged with your identity ({currentUser.name}) in the permanent audit trail.
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  Authorize & Log Override
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
