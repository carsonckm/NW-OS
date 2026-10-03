import React, { useState } from 'react';
import {
  QrCode,
  Barcode,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Camera,
  Truck,
  Layers,
  MapPin,
  CheckSquare,
  Square,
  FileCheck2,
  ShieldCheck,
  Package,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { DeliveryRecord } from '../../types';

interface LoadingAndScanTabProps {
  selectedDeliveryId?: string;
  onSelectDeliveryId: (id: string) => void;
}

export const LoadingAndScanTab: React.FC<LoadingAndScanTabProps> = ({
  selectedDeliveryId,
  onSelectDeliveryId,
}) => {
  const {
    deliveryRecords,
    updateLoadingChecklist,
    scanPackageForLoading,
    packingPackages,
  } = useNW();

  const [inputScanCode, setInputScanCode] = useState('');
  const [scanFeedback, setScanFeedback] = useState<{
    type: 'success' | 'error' | 'warning' | null;
    message: string;
  }>({ type: null, message: '' });

  // Get active delivery or default to first scheduled/loading one
  const activeDelivery =
    deliveryRecords.find((d) => d.id === selectedDeliveryId) ||
    deliveryRecords.find((d) => d.status === 'Loading' || d.status === 'Scheduled') ||
    deliveryRecords[0];

  const checklist = activeDelivery?.loading_checklist || {
    correct_project: true,
    correct_work_items: true,
    correct_quantity: true,
    correct_package_count: true,
    correct_destination: true,
    protection_applied: true,
    hardware_accessories_included: true,
    delivery_documents_included: true,
    photos: [],
  };

  const scannedCount = activeDelivery?.scanned_packages?.length || 0;
  const totalCount = activeDelivery?.package_count || 1;
  const isAllScanned = scannedCount >= totalCount;

  // Toggle checklist item
  const handleToggleCheck = (field: keyof typeof checklist) => {
    if (!activeDelivery) return;
    const currentVal = !!checklist[field];
    updateLoadingChecklist(activeDelivery.id, { [field]: !currentVal });
  };

  const handleSimulateScan = (codeToScan: string) => {
    if (!activeDelivery) return;
    const result = scanPackageForLoading(activeDelivery.id, codeToScan);
    if (result.success) {
      setScanFeedback({
        type: result.readyToLoad ? 'success' : 'warning',
        message: result.message,
      });
    } else {
      setScanFeedback({
        type: 'error',
        message: result.message,
      });
    }
    setInputScanCode('');
  };

  const handleConfirmLoaded = () => {
    if (!activeDelivery) return;
    updateLoadingChecklist(activeDelivery.id, {}, true);
    setScanFeedback({
      type: 'success',
      message: `Confirmed Loaded! Lorry ${activeDelivery.vehicle_plate} status changed to "In Transit".`,
    });
  };

  // Packages associated with this delivery
  const packages = packingPackages.filter((p) =>
    activeDelivery?.package_ids?.includes(p.id) ||
    activeDelivery?.production_order_ids?.includes(p.production_order_id)
  );

  return (
    <div className="space-y-6">
      {/* Header & Delivery Selector */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-amber-100 text-amber-900 rounded-lg">
              <QrCode className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Factory Dispatch Loading & QR Scan Station
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Enforces strict pre-departure verification: 100% package scan matching + 8-point physical checklist before lorry leaves workshop.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full md:w-auto">
          <label className="text-xs font-bold text-slate-500 shrink-0">Active Delivery:</label>
          <select
            value={activeDelivery?.id}
            onChange={(e) => onSelectDeliveryId(e.target.value)}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {deliveryRecords.map((d) => (
              <option key={d.id} value={d.id}>
                {d.delivery_number} — {d.project_name.slice(0, 25)} ({d.vehicle_plate})
              </option>
            ))}
          </select>
        </div>
      </div>

      {activeDelivery && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: QR Scanner & Scanned Packages (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            {/* Delivery Info Card */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Dispatch Trip Order
                  </div>
                  <h4 className="text-base font-black text-slate-900">
                    {activeDelivery.delivery_number} — {activeDelivery.project_name}
                  </h4>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-1 text-xs font-mono font-bold bg-slate-100 text-slate-800 rounded-lg border border-slate-200">
                    {activeDelivery.vehicle_plate} ({activeDelivery.vehicle_type})
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Destination
                  </span>
                  <span className="font-semibold text-slate-800 truncate block">
                    {activeDelivery.destination_site}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Driver
                  </span>
                  <span className="font-semibold text-slate-800 block">
                    {activeDelivery.driver_name} ({activeDelivery.driver_contact})
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Departure Slot
                  </span>
                  <span className="font-bold text-amber-800 block">
                    {activeDelivery.delivery_date} @ {activeDelivery.delivery_time}
                  </span>
                </div>
              </div>
            </div>

            {/* QR / Barcode Scan Input Box */}
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <Barcode className="w-5 h-5 text-slate-800" />
                  <h4 className="text-sm font-black text-slate-900">
                    Package Barcode / QR Scanner
                  </h4>
                </div>
                <div className="text-xs font-bold text-slate-600">
                  Progress:{' '}
                  <span className={`font-black ${isAllScanned ? 'text-emerald-600' : 'text-amber-600'}`}>
                    {scannedCount} / {totalCount} Scanned
                  </span>
                </div>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-slate-100 h-3 rounded-full overflow-hidden border border-slate-200">
                <div
                  className={`h-full transition-all duration-300 ${
                    isAllScanned ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${Math.min(100, Math.round((scannedCount / totalCount) * 100))}%` }}
                />
              </div>

              {/* Manual & Sim Scan Bar */}
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="text"
                  placeholder="Scan QR sticker or type package code (e.g. PKG-001-1/4, CAR-003-P01)..."
                  value={inputScanCode}
                  onChange={(e) => setInputScanCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && inputScanCode.trim()) {
                      handleSimulateScan(inputScanCode);
                    }
                  }}
                  className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-amber-500"
                />
                <button
                  onClick={() => {
                    if (inputScanCode.trim()) handleSimulateScan(inputScanCode);
                  }}
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-colors shadow-sm"
                >
                  Verify Scan
                </button>
              </div>

              {/* Quick Scan Simulator Buttons for Demo */}
              <div className="pt-2 border-t border-slate-100">
                <span className="text-[10px] font-bold uppercase text-slate-400 block mb-2">
                  Quick Scan Demo Packages for this Delivery:
                </span>
                <div className="flex flex-wrap gap-2">
                  {['PKG-001-1/4', 'PKG-001-2/4', 'PKG-003-1/2', 'PKG-003-2/2', 'PKG-004-1/1'].map((code) => {
                    const alreadyScanned = activeDelivery.scanned_packages?.includes(code);
                    return (
                      <button
                        key={code}
                        onClick={() => handleSimulateScan(code)}
                        className={`px-2.5 py-1 text-xs font-mono rounded-lg border transition-all ${
                          alreadyScanned
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold'
                            : 'bg-slate-100 hover:bg-amber-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {code} {alreadyScanned && '✓'}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Feedback Alert */}
              {scanFeedback.message && (
                <div
                  className={`p-3 rounded-lg text-xs font-medium flex items-center space-x-2 ${
                    scanFeedback.type === 'success'
                      ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
                      : scanFeedback.type === 'error'
                      ? 'bg-rose-50 text-rose-900 border border-rose-200'
                      : 'bg-amber-50 text-amber-900 border border-amber-200'
                  }`}
                >
                  {scanFeedback.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  )}
                  <span>{scanFeedback.message}</span>
                </div>
              )}

              {/* Scanned List Display */}
              <div className="pt-2">
                <span className="text-xs font-bold text-slate-700 block mb-2">
                  Scanned Cargo manifest ({scannedCount} of {totalCount}):
                </span>
                {activeDelivery.scanned_packages && activeDelivery.scanned_packages.length > 0 ? (
                  <div className="space-y-1.5">
                    {activeDelivery.scanned_packages.map((pkgCode, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 bg-emerald-50/50 border border-emerald-200 rounded-lg text-xs"
                      >
                        <div className="flex items-center space-x-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span className="font-mono font-bold text-slate-800">{pkgCode}</span>
                          <span className="text-[11px] text-slate-500">
                            • Tagged to {activeDelivery.work_item_codes?.join(', ')}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-700 uppercase bg-emerald-100 px-2 py-0.5 rounded">
                          Verified Loaded
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No packages scanned yet for this trip.</p>
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Physical Loading Checklist (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <ShieldCheck className="w-5 h-5 text-slate-800" />
                  <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    Loading Checklist
                  </h4>
                </div>
                <span className="text-[10px] font-bold bg-slate-100 text-slate-700 px-2 py-0.5 rounded">
                  Section 8 Standard
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Check off each condition prior to lorry dispatch. Photo upload supported for protection & loading proof.
              </p>

              {/* 8 Checks */}
              <div className="space-y-2 text-xs">
                {[
                  { key: 'correct_project', label: 'Correct Project Verified' },
                  { key: 'correct_work_items', label: 'Correct Work Items & Codes' },
                  { key: 'correct_quantity', label: 'Correct Quantity Counted' },
                  { key: 'correct_package_count', label: 'Correct Package Count Verified' },
                  { key: 'correct_destination', label: 'Correct Site Destination & Loading Bay' },
                  { key: 'protection_applied', label: 'Protection Applied (Crates / Heavy Wrap)' },
                  { key: 'hardware_accessories_included', label: 'Hardware / Screws / Accessories Included' },
                  { key: 'delivery_documents_included', label: 'Delivery Documents / DO Signed & Included' },
                ].map((item) => {
                  const isChecked = !!(checklist as any)[item.key];
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleToggleCheck(item.key as any)}
                      className={`w-full text-left p-2.5 rounded-lg border flex items-center justify-between transition-colors ${
                        isChecked
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-950 font-bold'
                          : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center space-x-2.5">
                        {isChecked ? (
                          <CheckSquare className="w-4 h-4 text-emerald-600 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span>{item.label}</span>
                      </div>
                      <span className="text-[10px] uppercase font-bold text-slate-400">
                        {isChecked ? 'PASS' : 'PENDING'}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Loading Confirmation Details */}
              {checklist.loaded_confirmed_by && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900 space-y-0.5">
                  <div className="font-bold">Loaded Confirmed</div>
                  <div>Confirmed by: {checklist.loaded_confirmed_by}</div>
                  <div className="text-[11px] text-emerald-700">
                    At: {new Date(checklist.loaded_at || '').toLocaleString()}
                  </div>
                </div>
              )}

              {/* Action Button: Loaded */}
              <div className="pt-3 border-t border-slate-100">
                <button
                  disabled={!isAllScanned}
                  onClick={handleConfirmLoaded}
                  className={`w-full py-3 rounded-xl text-xs font-black tracking-wide uppercase transition-all shadow-sm flex items-center justify-center space-x-2 ${
                    isAllScanned
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer'
                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <Truck className="w-4 h-4" />
                  <span>
                    {isAllScanned ? 'Confirm Loaded & Dispatch Lorry' : `Scan Remaining Packages (${scannedCount}/${totalCount})`}
                  </span>
                </button>
                {!isAllScanned && (
                  <p className="text-[11px] text-amber-700 text-center mt-2 font-medium">
                    ⚠️ All {totalCount} packages must be scanned to unlock final "Loaded" confirmation.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
