/**
 * NW OS — Procurement & Material Purchasing Module (Section 6)
 * Manages material requisitions, purchase orders (PO), suppliers,
 * and goods received status.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { PurchaseOrder, MaterialRequest, Supplier, POStatus } from '../types';
import { hasPermission } from '../utils/permissions';
import {
  ShoppingBag,
  Plus,
  Truck,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Building2,
  DollarSign,
  PackageCheck,
  Star,
  Phone,
  Mail,
  Search,
  Filter,
  Layers,
  ArrowRight,
  ShieldAlert,
  X,
  FileText,
} from 'lucide-react';

export const PurchasingView: React.FC = () => {
  const {
    currentUser,
    purchaseOrders,
    materialRequests,
    suppliers,
    createPurchaseOrder,
    updatePOStatus,
    createMaterialRequest,
    userProjects,
    projects,
  } = useNW();

  const [activeTab, setActiveTab] = useState<'pos' | 'requisitions' | 'suppliers'>('pos');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // New PO Modal
  const [showNewPOModal, setShowNewPOModal] = useState(false);
  const [poProjectId, setPoProjectId] = useState(userProjects[0]?.id || 'proj-1');
  const [poSupplierId, setPoSupplierId] = useState(suppliers[0]?.id || 'sup-1');
  const [poExpectedDate, setPoExpectedDate] = useState('2026-09-20');
  const [poNotes, setPoNotes] = useState('');
  const [poItems, setPoItems] = useState<
    { item_description: string; specification: string; quantity: number; unit: string; unit_price: number }[]
  >([
    {
      item_description: 'E1 Moisture Resistant Plywood 18mm',
      specification: 'BB/BB grade, phenolic glue',
      quantity: 30,
      unit: 'sheets',
      unit_price: 185,
    },
  ]);

  // New Material Request Modal
  const [showNewMRModal, setShowNewMRModal] = useState(false);
  const [mrProjectId, setMrProjectId] = useState(userProjects[0]?.id || 'proj-1');
  const [mrMaterialName, setMrMaterialName] = useState('');
  const [mrQuantity, setMrQuantity] = useState(10);
  const [mrUnit, setMrUnit] = useState('pcs');
  const [mrNeededDate, setMrNeededDate] = useState('2026-09-18');
  const [mrPurpose, setMrPurpose] = useState('');

  // Goods Received Modal
  const [receivingPO, setReceivingPO] = useState<PurchaseOrder | null>(null);

  const canCreatePO = hasPermission(currentUser, 'purchasing.create');

  const filteredPOs = purchaseOrders.filter((po) => {
    if (statusFilter !== 'all' && po.status !== statusFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchesNo = po.po_number.toLowerCase().includes(q);
      const matchesSup = po.supplier_name.toLowerCase().includes(q);
      const matchesProj = po.project_name.toLowerCase().includes(q);
      if (!matchesNo && !matchesSup && !matchesProj) return false;
    }
    return true;
  });

  const handleAddItemRow = () => {
    setPoItems([
      ...poItems,
      {
        item_description: '',
        specification: '',
        quantity: 1,
        unit: 'pcs',
        unit_price: 0,
      },
    ]);
  };

  const handleRemoveItemRow = (idx: number) => {
    setPoItems(poItems.filter((_, i) => i !== idx));
  };

  const handleUpdateItemRow = (idx: number, field: string, value: any) => {
    setPoItems(
      poItems.map((item, i) => (i === idx ? { ...item, [field]: value } : item))
    );
  };

  const handleCreatePO = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === poProjectId) || projects[0];
    const sup = suppliers.find((s) => s.id === poSupplierId) || suppliers[0];

    const formattedItems = poItems.map((it, idx) => ({
      id: 'poi-' + Date.now() + '-' + idx,
      item_description: it.item_description,
      specification: it.specification,
      quantity: Number(it.quantity),
      unit: it.unit,
      unit_price: Number(it.unit_price),
      total_price: Number(it.quantity) * Number(it.unit_price),
    }));

    const total = formattedItems.reduce((sum, item) => sum + item.total_price, 0);

    createPurchaseOrder({
      project_id: proj.id,
      project_name: proj.project_name,
      supplier_id: sup.id,
      supplier_name: sup.name,
      items: formattedItems,
      total_amount: total,
      status: total >= 20000 ? 'Pending Approval' : 'Issued',
      requested_by: currentUser.name,
      issued_date: total < 20000 ? new Date().toISOString() : undefined,
      expected_delivery_date: poExpectedDate,
      notes: poNotes,
    });

    setShowNewPOModal(false);
  };

  const handleCreateMR = (e: React.FormEvent) => {
    e.preventDefault();
    if (!mrMaterialName.trim()) return;

    const proj = projects.find((p) => p.id === mrProjectId) || projects[0];

    createMaterialRequest({
      project_id: proj.id,
      project_name: proj.project_name,
      material_name: mrMaterialName,
      required_quantity: mrQuantity,
      unit: mrUnit,
      needed_by_date: mrNeededDate,
      requested_by: currentUser.name,
      purpose: mrPurpose,
      status: 'Pending',
    });

    setShowNewMRModal(false);
    setMrMaterialName('');
    setMrPurpose('');
  };

  const getStatusBadge = (status: POStatus) => {
    switch (status) {
      case 'Issued':
        return 'bg-blue-50 text-blue-700 border-blue-200';
      case 'Goods Received':
      case 'Completed':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'Pending Approval':
        return 'bg-amber-50 text-amber-800 border-amber-300';
      case 'Partially Received':
        return 'bg-purple-50 text-purple-700 border-purple-200';
      case 'Cancelled':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-slate-50 text-slate-700 border-slate-200';
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Header Banner */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-teal-500/10 text-teal-700 border border-teal-200">
              <ShoppingBag className="w-6 h-6" />
            </span>
            <div>
              <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center space-x-2">
                <span>Purchasing & Materials Procurement</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-teal-50 text-teal-800 border border-teal-200">
                  Supply Chain Module
                </span>
              </h1>
              <p className="text-xs text-slate-500 mt-0.5">
                Material requisitions from factory, purchase order tracking, supplier directory, and goods intake
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {canCreatePO && (
            <button
              onClick={() => setShowNewPOModal(true)}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Purchase Order</span>
            </button>
          )}

          <button
            onClick={() => setShowNewMRModal(true)}
            className="flex items-center space-x-2 px-3.5 py-2.5 rounded-xl bg-teal-50 hover:bg-teal-100 text-teal-900 border border-teal-300 text-xs font-bold transition-colors"
          >
            <Plus className="w-4 h-4 text-teal-700" />
            <span>Material Request</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center space-x-1 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('pos')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === 'pos' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>Purchase Orders ({purchaseOrders.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('requisitions')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === 'requisitions' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <PackageCheck className="w-4 h-4" />
          <span>Factory Material Requests ({materialRequests.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('suppliers')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-2 ${
            activeTab === 'suppliers' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Suppliers Directory ({suppliers.length})</span>
        </button>
      </div>

      {/* TAB 1: PURCHASE ORDERS */}
      {activeTab === 'pos' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-500">Filter Status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-white border border-slate-200 text-xs font-semibold text-slate-800 rounded-xl px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              >
                <option value="all">All PO Statuses</option>
                <option value="Issued">Issued</option>
                <option value="Pending Approval">Pending Approval</option>
                <option value="Goods Received">Goods Received</option>
                <option value="Completed">Completed</option>
              </select>
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Search PO number or supplier..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
              />
            </div>
          </div>

          <div className="space-y-3">
            {filteredPOs.map((po) => (
              <div key={po.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-black text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {po.po_number}
                      </span>
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${getStatusBadge(po.status)}`}>
                        {po.status}
                      </span>
                      {po.total_amount >= 20000 && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                          Major Purchase ({'>'} RM 20k)
                        </span>
                      )}
                    </div>

                    <h3 className="text-sm font-extrabold text-slate-900 flex items-center space-x-2">
                      <span>{po.supplier_name}</span>
                      <span className="text-slate-400 font-normal">•</span>
                      <span className="text-slate-600 font-medium text-xs">{po.project_name.split('—')[0]}</span>
                    </h3>

                    <div className="text-xs text-slate-500 flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
                      <span>Expected Delivery: <strong className="text-slate-700">{po.expected_delivery_date}</strong></span>
                      {po.actual_delivery_date && (
                        <span>Received On: <strong className="text-emerald-700">{po.actual_delivery_date}</strong></span>
                      )}
                      <span>Issued By: <strong className="text-slate-700">{po.requested_by}</strong></span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end justify-between space-y-2">
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block uppercase font-bold">Total Amount</span>
                      <span className="text-base font-black text-slate-900">
                        RM {po.total_amount.toLocaleString()}
                      </span>
                    </div>

                    {po.status === 'Issued' && (
                      <button
                        onClick={() => {
                          updatePOStatus(po.id, 'Goods Received', new Date().toISOString().split('T')[0]);
                        }}
                        className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors shadow-2xs"
                      >
                        <PackageCheck className="w-3.5 h-3.5" />
                        <span>Confirm Goods Received</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Items preview table */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl overflow-hidden mt-2">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-slate-100/80 text-slate-600 font-bold border-b border-slate-200">
                        <th className="py-2 px-3">Item Description</th>
                        <th className="py-2 px-3">Specification</th>
                        <th className="py-2 px-3 text-right">Quantity</th>
                        <th className="py-2 px-3 text-right">Unit Price (RM)</th>
                        <th className="py-2 px-3 text-right">Total (RM)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {po.items.map((it) => (
                        <tr key={it.id}>
                          <td className="py-2 px-3 font-semibold text-slate-800">{it.item_description}</td>
                          <td className="py-2 px-3 text-slate-500 text-[11px]">{it.specification}</td>
                          <td className="py-2 px-3 text-right font-medium">{it.quantity} {it.unit}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-600">{it.unit_price.toFixed(2)}</td>
                          <td className="py-2 px-3 text-right font-bold text-slate-900">{it.total_price.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: MATERIAL REQUISITIONS */}
      {activeTab === 'requisitions' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {materialRequests.map((mr) => (
              <div key={mr.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-black text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                    {mr.request_number}
                  </span>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 text-amber-800 border-amber-300">
                    {mr.status}
                  </span>
                </div>

                <h3 className="text-sm font-extrabold text-slate-900">{mr.material_name}</h3>
                <p className="text-xs text-slate-600 leading-relaxed">{mr.purpose}</p>

                <div className="pt-2 border-t border-slate-100 text-xs text-slate-500 space-y-1">
                  <div className="flex justify-between">
                    <span>Quantity Required:</span>
                    <strong className="text-slate-800 font-bold">{mr.required_quantity} {mr.unit}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Needed by Date:</span>
                    <strong className="text-rose-700 font-bold">{mr.needed_by_date}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span>Requested by:</span>
                    <span className="text-slate-700">{mr.requested_by}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: SUPPLIERS DIRECTORY */}
      {activeTab === 'suppliers' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {suppliers.map((sup) => (
            <div key={sup.id} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center space-x-2">
                    <h3 className="text-sm font-extrabold text-slate-900">{sup.name}</h3>
                    {sup.is_preferred && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300">
                        Preferred Vendor
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-semibold text-slate-500">{sup.category}</span>
                </div>

                <div className="flex items-center space-x-1 text-amber-500 text-xs font-bold">
                  <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
                  <span>{sup.rating.toFixed(1)}</span>
                </div>
              </div>

              <div className="space-y-1.5 text-xs text-slate-600 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Contact:</span>
                  <span className="font-semibold text-slate-800">{sup.contact_person}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Phone:</span>
                  <span className="font-mono text-slate-700">{sup.phone}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Payment Terms:</span>
                  <span className="font-semibold text-slate-800">{sup.payment_terms}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Purchase Order Modal */}
      {showNewPOModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 text-slate-900 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">Procurement Request</span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">Generate Purchase Order (PO)</h3>
              </div>
              <button onClick={() => setShowNewPOModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreatePO} className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Project *</label>
                  <select
                    value={poProjectId}
                    onChange={(e) => setPoProjectId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    {userProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_name.split('—')[0]} ({p.project_number})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Supplier *</label>
                  <select
                    value={poSupplierId}
                    onChange={(e) => setPoSupplierId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  >
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.category})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Expected Delivery Date *</label>
                <input
                  type="date"
                  required
                  value={poExpectedDate}
                  onChange={(e) => setPoExpectedDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              {/* Line items table */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-bold text-slate-700">Line Items & Specifications *</label>
                  <button
                    type="button"
                    onClick={handleAddItemRow}
                    className="text-xs font-bold text-amber-700 hover:text-amber-800"
                  >
                    + Add Item
                  </button>
                </div>

                <div className="space-y-2">
                  {poItems.map((item, idx) => (
                    <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                      <div className="grid grid-cols-3 gap-2">
                        <input
                          type="text"
                          required
                          placeholder="Item Description (e.g. 18mm Birch Plywood)"
                          value={item.item_description}
                          onChange={(e) => handleUpdateItemRow(idx, 'item_description', e.target.value)}
                          className="col-span-2 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900"
                        />
                        <button
                          type="button"
                          onClick={() => handleRemoveItemRow(idx)}
                          disabled={poItems.length === 1}
                          className="text-rose-600 hover:text-rose-700 text-right text-xs font-bold"
                        >
                          Remove
                        </button>
                      </div>

                      <div className="grid grid-cols-4 gap-2">
                        <input
                          type="text"
                          placeholder="Spec / Grade"
                          value={item.specification}
                          onChange={(e) => handleUpdateItemRow(idx, 'specification', e.target.value)}
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900"
                        />
                        <input
                          type="number"
                          placeholder="Qty"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => handleUpdateItemRow(idx, 'quantity', e.target.value)}
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900"
                        />
                        <input
                          type="text"
                          placeholder="Unit (sheets)"
                          value={item.unit}
                          onChange={(e) => handleUpdateItemRow(idx, 'unit', e.target.value)}
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900"
                        />
                        <input
                          type="number"
                          placeholder="Price (MYR)"
                          value={item.unit_price}
                          onChange={(e) => handleUpdateItemRow(idx, 'unit_price', e.target.value)}
                          className="bg-white border border-slate-300 rounded-lg px-2 py-1 text-xs text-slate-900"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Delivery Instructions / Notes</label>
                <textarea
                  rows={2}
                  placeholder="e.g. Deliver to Factory Workshop Gate 3..."
                  value={poNotes}
                  onChange={(e) => setPoNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewPOModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl shadow-xs"
                >
                  Issue Purchase Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* New Material Request Modal */}
      {showNewMRModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-slate-900 shadow-2xl space-y-4">
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <span className="text-[11px] font-bold text-slate-500 uppercase">Shop Floor Requisition</span>
                <h3 className="text-base font-extrabold text-slate-900 mt-0.5">Submit Material Request</h3>
              </div>
              <button onClick={() => setShowNewMRModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateMR} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">Project *</label>
                <select
                  value={mrProjectId}
                  onChange={(e) => setMrProjectId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                >
                  {userProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.project_name.split('—')[0]}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Material Name & Spec *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Blum Soft-Close Hinges 110 deg"
                  value={mrMaterialName}
                  onChange={(e) => setMrMaterialName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Quantity *</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={mrQuantity}
                    onChange={(e) => setMrQuantity(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Unit</label>
                  <input
                    type="text"
                    required
                    placeholder="pcs / sets / meters"
                    value={mrUnit}
                    onChange={(e) => setMrUnit(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Needed by Date *</label>
                <input
                  type="date"
                  required
                  value={mrNeededDate}
                  onChange={(e) => setMrNeededDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">Work Item Purpose *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Countertop internal drawer cabinets (CAR-003)"
                  value={mrPurpose}
                  onChange={(e) => setMrPurpose(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowNewMRModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-bold bg-teal-600 hover:bg-teal-700 text-white rounded-xl shadow-xs"
                >
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
