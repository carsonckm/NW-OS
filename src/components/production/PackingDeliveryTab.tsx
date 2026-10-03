/**
 * NW OS — Packing & Ready for Delivery Handover Module
 * Packaging specifications, heavy crate tagging, and warehouse dispatch staging
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  Package,
  Truck,
  QrCode,
  Printer,
  Plus,
  CheckCircle2,
  Box,
  Scale,
  Maximize2,
  Shield,
  ArrowRight,
  X,
} from 'lucide-react';
import { PackingPackage } from '../../types';

export const PackingDeliveryTab: React.FC = () => {
  const {
    packingPackages,
    productionOrders,
    createPackingPackage,
    updatePackingStatus,
    updateProductionOrderStatus,
  } = useNW();

  const [showNewPkgModal, setShowNewPkgModal] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState(productionOrders[0]?.id || '');
  const [packageTitle, setPackageTitle] = useState('');
  const [dimensions, setDimensions] = useState('1200 × 800 × 900mm');
  const [weight, setWeight] = useState(45);
  const [protectionType, setProtectionType] = useState<PackingPackage['protection_type']>(
    'Double Corrugated Box + Bubble Wrap'
  );

  const handleCreatePackage = () => {
    const order = productionOrders.find((o) => o.id === selectedOrderId);
    if (!order || !packageTitle.trim()) return;

    createPackingPackage({
      production_order_id: order.id,
      production_order_number: order.order_number,
      work_item_code: order.work_item_code,
      project_name: order.project_name,
      destination_location: order.location,
      package_title: packageTitle,
      dimensions_mm: dimensions,
      weight_kg: Number(weight),
      protection_type: protectionType,
      status: 'Packed & Labeled',
      packed_by: 'Muthu (Packing Foreman)',
    });

    setShowNewPkgModal(false);
    setPackageTitle('');
  };

  const handleMarkReadyForDelivery = (orderId: string) => {
    updateProductionOrderStatus(orderId, 'Ready for Delivery', 'All packages packed and verified in dispatch bay');
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Package className="w-5 h-5 text-orange-600" />
            <h3 className="font-bold text-slate-900 text-sm">Packing & Dispatch Logistics Staging</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Package dimensions, weight verification, and protective packaging prior to lorry loading handover.
          </p>
        </div>

        <button
          onClick={() => setShowNewPkgModal(true)}
          className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          <span>New Dispatch Package</span>
        </button>
      </div>

      {/* Packages Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {packingPackages.map((pkg) => (
          <div
            key={pkg.id}
            className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs space-y-4 hover:border-amber-400 transition-colors"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <Box className="w-4 h-4 text-orange-600" />
                <span className="font-mono font-bold text-slate-900 text-xs">{pkg.package_number}</span>
                <span className="text-amber-700 font-bold text-xs">• {pkg.work_item_code}</span>
              </div>
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                  pkg.status === 'Ready for Delivery'
                    ? 'bg-emerald-100 text-emerald-900 font-black'
                    : 'bg-amber-100 text-amber-900'
                }`}
              >
                {pkg.status}
              </span>
            </div>

            <div>
              <h4 className="font-bold text-slate-900 text-xs">{pkg.package_title}</h4>
              <p className="text-[11px] text-slate-500 mt-0.5">{pkg.project_name}</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg space-y-2 text-xs text-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center space-x-1">
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span>Dimensions:</span>
                </span>
                <span className="font-mono font-bold text-slate-900">{pkg.dimensions_mm}</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center space-x-1">
                  <Scale className="w-3.5 h-3.5" />
                  <span>Weight:</span>
                </span>
                <span className="font-mono font-bold text-slate-900">{pkg.weight_kg} kg</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-slate-400 flex items-center space-x-1">
                  <Shield className="w-3.5 h-3.5" />
                  <span>Protection:</span>
                </span>
                <span className="font-medium text-slate-800 text-right truncate max-w-[170px]" title={pkg.protection_type}>
                  {pkg.protection_type}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-[11px] text-slate-500">
                <QrCode className="w-4 h-4 text-slate-600" />
                <span className="font-mono">{pkg.barcode}</span>
              </div>

              {pkg.status !== 'Ready for Delivery' && (
                <button
                  onClick={() => updatePackingStatus(pkg.id, 'Ready for Delivery')}
                  className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-colors"
                >
                  Mark Ready
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Handover to Delivery Section (Requirement 16) */}
      <div className="p-5 bg-gradient-to-r from-emerald-900 to-slate-900 text-white rounded-xl shadow-md flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <Truck className="w-5 h-5 text-emerald-400" />
            <h4 className="font-bold text-white text-sm">NW OS Site Delivery Handover Integration</h4>
          </div>
          <p className="text-xs text-slate-300 mt-1 max-w-xl">
            Items marked "Ready for Delivery" automatically update the site work item status to enable transport booking. The system does NOT auto-schedule lorry dispatch without human site logistics confirmation.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          {productionOrders
            .filter((o) => o.current_stage === 'Packing')
            .slice(0, 2)
            .map((ord) => (
              <button
                key={ord.id}
                onClick={() => handleMarkReadyForDelivery(ord.id)}
                className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <span>Release {ord.order_number} to Delivery</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            ))}
        </div>
      </div>

      {/* New Package Modal */}
      {showNewPkgModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-slate-900 text-sm uppercase tracking-wider flex items-center space-x-2">
                <Box className="w-4 h-4 text-orange-600" />
                <span>Create Dispatch Crate / Package</span>
              </h3>
              <button onClick={() => setShowNewPkgModal(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Select Production Order
              </label>
              <select
                aria-label="Select Production Order"
                value={selectedOrderId}
                onChange={(e) => setSelectedOrderId(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs text-slate-900 font-bold"
              >
                {productionOrders.map((ord) => (
                  <option key={ord.id} value={ord.id}>
                    {ord.order_number} — {ord.work_item_code}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Package Title / Contents
              </label>
              <input
                type="text"
                placeholder="e.g. Main Carcass Module A (Cashier Left)"
                value={packageTitle}
                onChange={(e) => setPackageTitle(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Dimensions (L × W × H)
                </label>
                <input
                  type="text"
                  value={dimensions}
                  onChange={(e) => setDimensions(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                  Weight (KG)
                </label>
                <input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(Number(e.target.value))}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                Protection Type
              </label>
              <select
                aria-label="Protection Type"
                value={protectionType}
                onChange={(e) => setProtectionType(e.target.value as any)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-xs"
              >
                <option value="Double Corrugated Box + Bubble Wrap">Double Corrugated Box + Bubble Wrap</option>
                <option value="Heavy Foam + Wooden Crate">Heavy Foam + Wooden Crate</option>
                <option value="Edge Corner Protectors + Heavy Stretch Film">Edge Corner Protectors + Heavy Stretch Film</option>
              </select>
            </div>

            <div className="flex justify-end space-x-2 pt-2 border-t">
              <button
                onClick={() => setShowNewPkgModal(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-xs font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePackage}
                disabled={!packageTitle.trim()}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg text-xs font-bold shadow-xs"
              >
                Register Package & Print Label
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
