/**
 * NW OS — Production, CNC & QR/Barcode Factory Module (Module 13)
 * Main Container & Orchestration View
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import {
  Layers,
  LayoutDashboard,
  Boxes,
  Scissors,
  Cpu,
  Sparkles,
  CheckCircle2,
  Package,
  Truck,
  ShieldAlert,
  QrCode,
  Plus,
  X,
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { ProductionDashboardTab } from '../components/production/ProductionDashboardTab';
import { ProductionOrdersTab } from '../components/production/ProductionOrdersTab';
import { WorkQueueTab } from '../components/production/WorkQueueTab';
import { CuttingListAndPartsTab } from '../components/production/CuttingListAndPartsTab';
import { CNCCenterTab } from '../components/production/CNCCenterTab';
import { AssemblyFinishingTab } from '../components/production/AssemblyFinishingTab';
import { FactoryQCTab } from '../components/production/FactoryQCTab';
import { PackingDeliveryTab } from '../components/production/PackingDeliveryTab';
import { ProductionIssuesTab } from '../components/production/ProductionIssuesTab';
import { BarcodeScannerModal } from '../components/production/BarcodeScannerModal';
import { ProductionOrder } from '../types';

export const ProductionView: React.FC = () => {
  const {
    productionOrders,
    workItems,
    projects,
    createProductionOrder,
    currentUser,
  } = useNW();

  const [activeTab, setActiveTab] = useState<string>('dashboard');
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  // Create Order Form State
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(workItems[0]?.id || '');
  const [priority, setPriority] = useState<'Normal' | 'High' | 'Urgent'>('Normal');
  const [requiredDate, setRequiredDate] = useState('2026-10-15');
  const [customNotes, setCustomNotes] = useState('');

  const subtabs = [
    { id: 'dashboard', label: 'Production Dashboard', icon: <LayoutDashboard className="w-3.5 h-3.5" /> },
    {
      id: 'orders',
      label: 'Production Orders',
      icon: <Layers className="w-3.5 h-3.5" />,
      badge: productionOrders.filter((o) => o.status === 'Blocked' || o.revision_alert).length,
    },
    { id: 'queue', label: 'Work Queue', icon: <Boxes className="w-3.5 h-3.5" /> },
    { id: 'parts', label: 'Parts & Cutting List', icon: <Scissors className="w-3.5 h-3.5" /> },
    { id: 'cnc', label: 'CNC Center', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'assembly', label: 'Assembly', icon: <Boxes className="w-3.5 h-3.5" /> },
    { id: 'finishing', label: 'Finishing', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'qc', label: 'QC Inspection', icon: <CheckCircle2 className="w-3.5 h-3.5" /> },
    { id: 'packing', label: 'Packing', icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'ready-delivery', label: 'Ready for Delivery', icon: <Truck className="w-3.5 h-3.5" /> },
    {
      id: 'issues',
      label: 'Production Issues',
      icon: <ShieldAlert className="w-3.5 h-3.5" />,
      badge: productionOrders.filter((o) => o.status === 'Blocked').length,
    },
  ];

  const handleCreateOrder = () => {
    const item = workItems.find((w) => w.id === selectedWorkItemId);
    if (!item) return;

    const project = projects.find((p) => p.id === item.project_id);

    createProductionOrder({
      project_id: item.project_id,
      project_number: project?.project_number || 'NW-2026-001',
      project_name: project?.project_name || 'Project Aurora',
      work_package_id: item.work_package_id,
      work_package_name: 'CARPENTRY & ARCHITECTURAL JOINERY',
      work_item_id: item.id,
      work_item_code: item.item_code,
      client_id: project?.client_id || 'cli-1',
      client_name: 'Aurora Luxury Retail',
      location: item.location,
      contractor_id: item.contractor_id,
      contractor_name: 'Hock Seng Carpentry (林福成)',
      production_manager_id: 'user-prod-mgr',
      production_manager_name: 'Tan Kok Leong',
      required_date: requiredDate,
      current_stage: 'Not Started',
      priority,
      status: 'Not Started',
      approved_client_drawing_id: item.drawing_id || 'dwg-1',
      approved_client_drawing_revision: item.client_drawing_revision || item.drawing_revision || 'Rev 1',
      approved_nw_production_drawing_id: item.nw_production_drawing_id || 'nwd-1',
      approved_nw_production_drawing_revision: item.nw_production_drawing_revision || 'Rev 1',
      production_method: 'NW-PM-Standard-001 Rev 1',
      material: item.material,
      finish: item.finish,
      dimensions: item.dimensions,
      quantity: item.quantity,
      notes: customNotes || item.notes || 'Created from approved work item release',
      photos: item.photos || [],
    });

    setShowCreateModal(false);
    setActiveTab('orders');
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {/* Sub-navigation Tabs */}
      <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-xs overflow-x-auto scrollbar-none flex items-center justify-between gap-2">
        <div className="flex space-x-1">
          {subtabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id);
                setSelectedOrderId(null);
              }}
              className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-colors flex items-center space-x-1.5 ${
                activeTab === tab.id
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge !== undefined && tab.badge > 0 && (
                <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-600 text-white">
                  {tab.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center space-x-1.5 shrink-0 pl-2 border-l border-slate-200">
          <button
            onClick={() => setShowScannerModal(true)}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-400 rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors"
            title="Scan QR / Barcode on factory floor"
          >
            <QrCode className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Scanner</span>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-black flex items-center space-x-1.5 transition-colors shadow-xs"
            title="Create Production Order from Work Item"
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">New Order</span>
          </button>
        </div>
      </div>

      {/* Main Subsections View Router */}
      {activeTab === 'dashboard' && (
        <ProductionDashboardTab
          onNavigateSubtab={(sub) => setActiveTab(sub)}
          onOpenCreateOrder={() => setShowCreateModal(true)}
          onOpenScanner={() => setShowScannerModal(true)}
        />
      )}

      {activeTab === 'orders' && (
        <ProductionOrdersTab
          onOpenCreateOrder={() => setShowCreateModal(true)}
          selectedOrderId={selectedOrderId}
          onClearSelectedOrder={() => setSelectedOrderId(null)}
        />
      )}

      {activeTab === 'queue' && (
        <WorkQueueTab
          onSelectOrder={(ordId) => {
            setSelectedOrderId(ordId);
            setActiveTab('orders');
          }}
        />
      )}

      {activeTab === 'parts' && <CuttingListAndPartsTab />}

      {activeTab === 'cnc' && <CNCCenterTab />}

      {activeTab === 'assembly' && <AssemblyFinishingTab />}

      {activeTab === 'finishing' && <AssemblyFinishingTab />}

      {activeTab === 'qc' && <FactoryQCTab />}

      {activeTab === 'packing' && <PackingDeliveryTab />}

      {activeTab === 'ready-delivery' && <PackingDeliveryTab />}

      {activeTab === 'issues' && <ProductionIssuesTab />}

      {/* Barcode & QR Code Scanner Modal */}
      <BarcodeScannerModal
        isOpen={showScannerModal}
        onClose={() => setShowScannerModal(false)}
        onSelectOrder={(orderId) => {
          setSelectedOrderId(orderId);
          setActiveTab('orders');
        }}
      />

      {/* Create Production Order Modal (Section 3 Requirement) */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-2">
                  <Plus className="w-4 h-4 text-amber-600" />
                  <span>Release Work Item to Production Order</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Converts an approved project work item into a controlled factory production order.
                </p>
              </div>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Select Approved Work Item
              </label>
              <select
                aria-label="Select Approved Work Item"
                value={selectedWorkItemId}
                onChange={(e) => setSelectedWorkItemId(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-bold"
              >
                {workItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.item_code} — {item.description} ({item.dimensions})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Production Priority
                </label>
                <select
                  aria-label="Production Priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                >
                  <option value="Normal">Normal</option>
                  <option value="High">High</option>
                  <option value="Urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Factory Target Completion Date
                </label>
                <input
                  type="date"
                  value={requiredDate}
                  onChange={(e) => setRequiredDate(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Special Workshop Instructions
              </label>
              <textarea
                rows={3}
                placeholder="Specific joinery tolerances, laminate bonding instructions, or packing crate requirements..."
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                className="w-full p-2.5 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateOrder}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-bold shadow-xs"
              >
                Issue Production Order
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
