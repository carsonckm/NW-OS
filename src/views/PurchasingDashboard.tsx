/**
 * NW OS — Purchasing Role Dashboard (Section 6)
 * Dedicated command center for Purchasing Manager / Procurement.
 */

import React from 'react';
import { useNW } from '../context/NWContext';
import {
  ShoppingBag,
  Truck,
  PackageCheck,
  AlertCircle,
  Clock,
  ArrowRight,
  Plus,
  Building2,
  DollarSign,
  FileText,
} from 'lucide-react';

interface PurchasingDashboardProps {
  onNavigate?: (tab: string) => void;
}

export const PurchasingDashboard: React.FC<PurchasingDashboardProps> = ({ onNavigate }) => {
  const {
    currentUser,
    purchaseOrders,
    materialRequests,
    suppliers,
    updatePOStatus,
    projects,
  } = useNW();

  const pendingPOs = purchaseOrders.filter((po) => po.status === 'Pending Approval');
  const activePOs = purchaseOrders.filter((po) => po.status === 'Issued');
  const pendingRequisitions = materialRequests.filter((mr) => mr.status === 'Pending');

  const totalSpent = purchaseOrders
    .filter((po) => po.status !== 'Cancelled')
    .reduce((sum, po) => sum + po.total_amount, 0);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-teal-900 to-slate-900 rounded-2xl p-6 text-white shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-teal-500/20 text-teal-300 border border-teal-500/30">
              Procurement & Supply Chain
            </span>
          </div>
          <h1 className="text-xl font-black mt-1">Welcome back, {currentUser.name}</h1>
          <p className="text-xs text-slate-300 mt-0.5">
            You have {pendingRequisitions.length} pending material requests from the factory floor and {activePOs.length} active PO deliveries scheduled this week.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {onNavigate && (
            <button
              onClick={() => onNavigate('purchasing')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-teal-500 hover:bg-teal-400 text-slate-950 text-xs font-bold transition-colors shadow-xs"
            >
              <span>Manage Purchasing</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Pending Factory Requisitions</span>
            <AlertCircle className="w-4 h-4 text-amber-600" />
          </span>
          <div className="text-2xl font-black text-slate-900">{pendingRequisitions.length} Items</div>
          <span className="text-[11px] text-slate-500">Requires PO generation</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Active Deliveries In Transit</span>
            <Truck className="w-4 h-4 text-teal-600" />
          </span>
          <div className="text-2xl font-black text-teal-700">{activePOs.length} Orders</div>
          <span className="text-[11px] text-slate-500">Awaiting site or workshop arrival</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Approved Suppliers</span>
            <Building2 className="w-4 h-4 text-indigo-600" />
          </span>
          <div className="text-2xl font-black text-slate-900">{suppliers.length} Vendors</div>
          <span className="text-[11px] text-slate-500">{suppliers.filter(s => s.is_preferred).length} Preferred trade partners</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-1">
          <span className="text-xs font-bold text-slate-500 uppercase flex items-center justify-between">
            <span>Total PO Commitments</span>
            <DollarSign className="w-4 h-4 text-emerald-600" />
          </span>
          <div className="text-2xl font-black text-slate-900">RM {totalSpent.toLocaleString()}</div>
          <span className="text-[11px] text-slate-500">Across {purchaseOrders.length} purchase orders</span>
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pending Requisitions */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
              <PackageCheck className="w-4 h-4 text-teal-600" />
              <span>Factory Material Requests</span>
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('purchasing')}
                className="text-xs font-bold text-teal-700 hover:text-teal-800"
              >
                View All
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {materialRequests.slice(0, 4).map((mr) => (
              <div key={mr.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] font-bold text-slate-700">{mr.request_number}</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                    {mr.status}
                  </span>
                </div>
                <h4 className="text-xs font-bold text-slate-900">{mr.material_name}</h4>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Qty: <strong className="text-slate-800">{mr.required_quantity} {mr.unit}</strong></span>
                  <span>Needed: <strong className="text-rose-600">{mr.needed_by_date}</strong></span>
                  <span>By: {mr.requested_by.split(' ')[0]}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Deliveries Scheduled */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
              <Truck className="w-4 h-4 text-teal-600" />
              <span>Purchase Order Shipments</span>
            </h2>
            {onNavigate && (
              <button
                onClick={() => onNavigate('purchasing')}
                className="text-xs font-bold text-teal-700 hover:text-teal-800"
              >
                View All
              </button>
            )}
          </div>

          <div className="space-y-2.5">
            {purchaseOrders.slice(0, 4).map((po) => (
              <div key={po.id} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-[11px] font-bold text-slate-700">{po.po_number}</span>
                    <span className="text-xs font-semibold text-slate-800">{po.supplier_name.split(' ')[0]}</span>
                  </div>
                  <span className="font-mono text-xs font-black text-slate-900">
                    RM {po.total_amount.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>Delivery Date: <strong className="text-slate-700">{po.expected_delivery_date}</strong></span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    po.status === 'Issued' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  }`}>
                    {po.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
