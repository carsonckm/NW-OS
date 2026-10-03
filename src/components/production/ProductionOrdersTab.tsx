/**
 * NW OS — Production Orders Table, Drawing Control & Revision Protection
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  Layers,
  Search,
  Filter,
  Plus,
  ArrowRight,
  ArrowLeft,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Printer,
  X,
  ExternalLink,
  ShieldAlert,
  Building2,
  Calendar,
} from 'lucide-react';
import { ProductionOrder, ProductionOrderStatus } from '../../types';

interface ProductionOrdersTabProps {
  onOpenCreateOrder: () => void;
  selectedOrderId?: string | null;
  onClearSelectedOrder?: () => void;
}

export const ProductionOrdersTab: React.FC<ProductionOrdersTabProps> = ({
  onOpenCreateOrder,
  selectedOrderId,
  onClearSelectedOrder,
}) => {
  const {
    productionOrders,
    updateProductionOrderStatus,
    currentUser,
  } = useNW();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState<string>('ALL');
  const [filterPriority, setFilterPriority] = useState<string>('ALL');
  const [activeDetailOrder, setActiveDetailOrder] = useState<ProductionOrder | null>(() => {
    if (selectedOrderId) {
      return productionOrders.find((o) => o.id === selectedOrderId) || null;
    }
    return null;
  });

  const [showStatusModal, setShowStatusModal] = useState(false);
  const [targetStage, setTargetStage] = useState<ProductionOrderStatus>('Cutting');
  const [statusNotes, setStatusNotes] = useState('');

  const allStages: ProductionOrderStatus[] = [
    'Not Started',
    'Material Required',
    'Material Ready',
    'Cutting',
    'CNC',
    'Edge Banding',
    'Assembly',
    'Finishing',
    'QC',
    'Packing',
    'Ready for Delivery',
    'Completed',
    'Blocked',
    'Cancelled',
  ];

  const filteredOrders = productionOrders.filter((order) => {
    const matchSearch =
      order.order_number.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.work_item_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.project_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.material.toLowerCase().includes(searchQuery.toLowerCase()) ||
      order.contractor_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchStage = filterStage === 'ALL' || order.current_stage === filterStage;
    const matchPriority = filterPriority === 'ALL' || order.priority === filterPriority;
    return matchSearch && matchStage && matchPriority;
  });

  const handleOpenStatusChange = (order: ProductionOrder) => {
    setActiveDetailOrder(order);
    setTargetStage(order.current_stage);
    setStatusNotes('');
    setShowStatusModal(true);
  };

  const handleConfirmStatusChange = () => {
    if (!activeDetailOrder) return;
    updateProductionOrderStatus(activeDetailOrder.id, targetStage, statusNotes);
    setShowStatusModal(false);
    // Refresh active detail
    const refreshed = productionOrders.find((o) => o.id === activeDetailOrder.id);
    if (refreshed) {
      setActiveDetailOrder({ ...refreshed, current_stage: targetStage, status: targetStage });
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Filter and Search Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Order ID, Item Code, Project, Contractor..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 font-medium"
            />
          </div>

          <div className="flex items-center space-x-2">
            <Filter className="w-3.5 h-3.5 text-slate-400" />
            <select
              aria-label="Filter by Stage"
              value={filterStage}
              onChange={(e) => setFilterStage(e.target.value)}
              className="bg-slate-50 text-xs text-slate-800 rounded-lg border border-slate-200 px-2.5 py-2 font-medium"
            >
              <option value="ALL">All Stages ({productionOrders.length})</option>
              {allStages.map((stg) => (
                <option key={stg} value={stg}>
                  {stg} ({productionOrders.filter((o) => o.current_stage === stg).length})
                </option>
              ))}
            </select>

            <select
              aria-label="Filter by Priority"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
              className="bg-slate-50 text-xs text-slate-800 rounded-lg border border-slate-200 px-2.5 py-2 font-medium"
            >
              <option value="ALL">All Priorities</option>
              <option value="Urgent">Urgent</option>
              <option value="High">High</option>
              <option value="Normal">Normal</option>
            </select>
          </div>
        </div>

        <button
          onClick={onOpenCreateOrder}
          className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>New Production Order</span>
        </button>
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-[11px] uppercase font-bold text-slate-500 border-b border-slate-200 tracking-wider">
              <tr>
                <th className="py-3 px-4">Order ID & Work Item</th>
                <th className="py-3 px-4">Project & Location</th>
                <th className="py-3 px-4">Drawing Revisions (Client & NW)</th>
                <th className="py-3 px-4">Dimensions & Material</th>
                <th className="py-3 px-4">Current Stage</th>
                <th className="py-3 px-4">Contractor</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    No production orders found matching criteria.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((order) => (
                  <tr
                    key={order.id}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      order.status === 'Blocked' ? 'bg-rose-50/30' : ''
                    }`}
                  >
                    {/* Order ID & Work Item */}
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-900 font-mono text-xs flex items-center space-x-1.5">
                        <span>{order.order_number}</span>
                        {order.priority === 'Urgent' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-red-600 text-white">
                            Urgent
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-amber-700 font-bold mt-0.5">
                        {order.work_item_code}
                      </div>

                      {/* Revision Warning Indicator */}
                      {order.revision_alert && !order.revision_alert.resolved && (
                        <div className="mt-1 flex items-center space-x-1 text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5 max-w-[200px] truncate">
                          <AlertTriangle className="w-3 h-3 shrink-0" />
                          <span className="truncate">{order.revision_alert.level}</span>
                        </div>
                      )}
                    </td>

                    {/* Project & Location */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 truncate max-w-[180px]">
                        {order.project_name.split('—')[0]}
                      </div>
                      <div className="text-[11px] text-slate-400 truncate max-w-[180px]">
                        {order.location}
                      </div>
                    </td>

                    {/* Explicit Drawing Control */}
                    <td className="py-3 px-4 space-y-1">
                      <div className="flex items-center space-x-1 text-[11px]">
                        <span className="text-slate-400 text-[10px]">Client:</span>
                        <span className="font-mono font-bold text-blue-700 bg-blue-50 px-1 rounded border border-blue-200">
                          {order.approved_client_drawing_revision}
                        </span>
                      </div>
                      <div className="flex items-center space-x-1 text-[11px]">
                        <span className="text-slate-400 text-[10px]">NW Prod:</span>
                        <span className="font-mono font-bold text-emerald-700 bg-emerald-50 px-1 rounded border border-emerald-200">
                          {order.approved_nw_production_drawing_revision}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-500 truncate max-w-[180px]" title={order.production_method}>
                        {order.production_method}
                      </div>
                    </td>

                    {/* Dimensions & Material */}
                    <td className="py-3 px-4">
                      <div className="font-mono text-slate-900 font-bold text-[11px]">
                        {order.dimensions}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[180px]" title={order.material}>
                        {order.material}
                      </div>
                    </td>

                    {/* Current Stage */}
                    <td className="py-3 px-4">
                      <span
                        className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold uppercase ${
                          order.current_stage === 'Blocked'
                            ? 'bg-rose-600 text-white animate-pulse'
                            : order.current_stage === 'Ready for Delivery'
                            ? 'bg-emerald-600 text-white font-black'
                            : order.current_stage === 'QC'
                            ? 'bg-purple-600 text-white'
                            : order.current_stage === 'Assembly'
                            ? 'bg-indigo-600 text-white'
                            : order.current_stage === 'CNC'
                            ? 'bg-cyan-700 text-white'
                            : order.current_stage === 'Packing'
                            ? 'bg-orange-600 text-white'
                            : 'bg-slate-100 text-slate-800'
                        }`}
                      >
                        {order.current_stage}
                      </span>
                      <span className="block text-[10px] text-slate-400 mt-0.5">
                        Due: {order.required_date}
                      </span>
                    </td>

                    {/* Contractor */}
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{order.contractor_name}</div>
                      <div className="text-[10px] text-slate-400">Qty: {order.quantity} Set</div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-4 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => setActiveDetailOrder(order)}
                        className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors"
                      >
                        Details
                      </button>
                      <button
                        onClick={() => handleOpenStatusChange(order)}
                        className="px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 font-bold text-xs transition-colors"
                      >
                        Update Stage
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Details Drawer / Modal */}
      {activeDetailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 font-mono font-bold">
                  PO
                </div>
                <div>
                  <h3 className="text-base font-bold text-white font-mono flex items-center space-x-2">
                    <span>{activeDetailOrder.order_number}</span>
                    <span className="text-amber-400 text-sm">({activeDetailOrder.work_item_code})</span>
                  </h3>
                  <p className="text-xs text-slate-400">{activeDetailOrder.project_name}</p>
                </div>
              </div>
              <button
                onClick={() => setActiveDetailOrder(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-6 text-xs text-slate-700">
              {/* Revision Alert Banner */}
              {activeDetailOrder.revision_alert && !activeDetailOrder.revision_alert.resolved && (
                <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl text-rose-950 space-y-1">
                  <div className="flex items-center space-x-2 font-black text-rose-700 uppercase tracking-wider text-xs">
                    <ShieldAlert className="w-4 h-4" />
                    <span>{activeDetailOrder.revision_alert.level}</span>
                  </div>
                  <p className="text-xs text-rose-900">{activeDetailOrder.revision_alert.message}</p>
                  <p className="text-[11px] text-rose-700 font-semibold pt-1 border-t border-rose-200">
                    Rule Enforced: Dimensions are NOT automatically changed. An Issue or Review Request must be signed off by Project Manager and Owner.
                  </p>
                </div>
              )}

              {/* Exact Drawing Controls Section (Requirement 5) */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <FileText className="w-4 h-4 text-amber-600" />
                  <span>Controlled Engineering References</span>
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 bg-white border border-slate-200 rounded-lg">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Client Drawing</span>
                    <span className="text-sm font-bold font-mono text-blue-700 block mt-0.5">
                      {activeDetailOrder.approved_client_drawing_revision}
                    </span>
                    <span className="text-[10px] text-slate-500">Contractual Baseline</span>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-lg">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">NW Production Drawing</span>
                    <span className="text-sm font-bold font-mono text-emerald-700 block mt-0.5">
                      {activeDetailOrder.approved_nw_production_drawing_revision}
                    </span>
                    <span className="text-[10px] text-slate-500">Approved Joinery Standard</span>
                  </div>
                  <div className="p-3 bg-white border border-slate-200 rounded-lg">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">Production Method</span>
                    <span className="text-xs font-bold text-slate-900 block mt-0.5">
                      {activeDetailOrder.production_method}
                    </span>
                    <span className="text-[10px] text-slate-500">Shopfloor Standard SOP</span>
                  </div>
                </div>
              </div>

              {/* Specifications Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Dimensions</span>
                  <span className="font-bold text-slate-900 font-mono text-sm">{activeDetailOrder.dimensions}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Quantity</span>
                  <span className="font-bold text-slate-900">{activeDetailOrder.quantity} Set</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Target Due Date</span>
                  <span className="font-bold text-slate-900">{activeDetailOrder.required_date}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Approved Materials</span>
                  <span className="font-semibold text-slate-800">{activeDetailOrder.material}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-bold block">Finishing</span>
                  <span className="font-semibold text-slate-800">{activeDetailOrder.finish}</span>
                </div>
              </div>

              {/* Stage Transition History Audit (Requirement 4) */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
                  <Clock className="w-4 h-4 text-indigo-600" />
                  <span>Production Stage Audit Trail ({activeDetailOrder.stage_history.length} Transitions)</span>
                </h4>
                <div className="space-y-2">
                  {activeDetailOrder.stage_history.map((hist, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-slate-50 border border-slate-100 rounded-lg flex items-center justify-between text-xs"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center space-x-2">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-200 text-slate-800">
                            {hist.stage}
                          </span>
                          <span className="text-slate-500 font-medium">{hist.notes || 'Stage checked'}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Updated by {hist.updated_by} ({hist.role})
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {new Date(hist.timestamp).toLocaleDateString()} {new Date(hist.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200 px-6 py-3 flex items-center justify-between">
              <div className="flex items-center space-x-2 font-mono text-xs text-slate-500">
                <span>Barcode: {activeDetailOrder.barcode}</span>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleOpenStatusChange(activeDetailOrder)}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-bold transition-colors"
                >
                  Move Stage
                </button>
                <button
                  onClick={() => setActiveDetailOrder(null)}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stage Movement Modal with Mandatory Reason/Notes */}
      {showStatusModal && activeDetailOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-2">
              <Layers className="w-4 h-4 text-amber-600" />
              <span>Update Stage: {activeDetailOrder.order_number}</span>
            </h3>

            <p className="text-xs text-slate-500">
              Authorized users may transition stages forward or backward. Every movement is recorded in the permanent audit trail.
            </p>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                New Production Stage
              </label>
              <select
                aria-label="New Production Stage"
                value={targetStage}
                onChange={(e) => setTargetStage(e.target.value as ProductionOrderStatus)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-bold"
              >
                {allStages.map((stg) => (
                  <option key={stg} value={stg}>
                    {stg} {stg === activeDetailOrder.current_stage ? '(Current)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Movement Reason & Technical Notes (Mandatory)
              </label>
              <textarea
                rows={3}
                placeholder="e.g. Cut completed on panel saw; moving to CNC routing. OR Returned to Assembly for scribe plinth rework..."
                value={statusNotes}
                onChange={(e) => setStatusNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t border-slate-100">
              <button
                onClick={() => setShowStatusModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmStatusChange}
                disabled={!statusNotes.trim()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 rounded-lg text-xs font-bold shadow-xs transition-colors"
              >
                Confirm Stage Transition
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
