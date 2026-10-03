/**
 * NW OS — Production Barcode & QR Code Scanner Modal
 * Real-time lookup for Production Orders, Component Parts, and Dispatch Packages
 */

import React, { useState } from 'react';
import { useNW } from '../../context/NWContext';
import {
  QrCode,
  Barcode,
  Search,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Printer,
  X,
  FileText,
  Cpu,
  Layers,
  Box,
  Eye,
  Camera,
} from 'lucide-react';
import { ProductionOrderStatus, PartStatus } from '../../types';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectOrder?: (orderId: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onSelectOrder,
}) => {
  const {
    productionOrders,
    productionParts,
    packingPackages,
    scanBarcodeOrQRCode,
    updateProductionOrderStatus,
    updatePartStatus,
  } = useNW();

  const [inputCode, setInputCode] = useState('');
  const [scanResult, setScanResult] = useState<{
    type: 'order' | 'part' | 'package' | 'unknown';
    item?: any;
    message: string;
  } | null>(null);
  const [showPrintLabel, setShowPrintLabel] = useState(false);
  const [actionSuccess, setActionSuccess] = useState('');

  if (!isOpen) return null;

  const handleScan = (codeToScan?: string) => {
    const target = codeToScan || inputCode;
    if (!target.trim()) return;
    const result = scanBarcodeOrQRCode(target);
    setScanResult(result);
    setActionSuccess('');
  };

  const handleAdvanceStage = () => {
    if (!scanResult?.item) return;

    if (scanResult.type === 'order') {
      const order = scanResult.item;
      const stages: ProductionOrderStatus[] = [
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
      ];
      const currIdx = stages.indexOf(order.current_stage);
      if (currIdx >= 0 && currIdx < stages.length - 1) {
        const nextStage = stages[currIdx + 1];
        updateProductionOrderStatus(order.id, nextStage, 'Advanced via Barcode Scan Check-in');
        setActionSuccess(`Production Order ${order.order_number} moved to ${nextStage}`);
        // refresh scan item
        const updated = productionOrders.find((o) => o.id === order.id);
        if (updated) {
          setScanResult({
            ...scanResult,
            item: { ...updated, current_stage: nextStage, status: nextStage },
          });
        }
      }
    } else if (scanResult.type === 'part') {
      const part = scanResult.item;
      const partStages: PartStatus[] = [
        'Created',
        'Material Required',
        'Material Ready',
        'Cutting',
        'CNC',
        'Edge Banding',
        'Assembly',
        'Finishing',
        'QC',
        'Packed',
        'Completed',
      ];
      const currIdx = partStages.indexOf(part.current_stage);
      if (currIdx >= 0 && currIdx < partStages.length - 1) {
        const nextStage = partStages[currIdx + 1];
        updatePartStatus(part.id, nextStage, 'Part scanned and moved to next stage');
        setActionSuccess(`Part ${part.part_code} moved to ${nextStage}`);
        const updated = productionParts.find((p) => p.id === part.id);
        if (updated) {
          setScanResult({
            ...scanResult,
            item: { ...updated, current_stage: nextStage, status: nextStage },
          });
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center space-x-2">
                <span>Factory Floor Scanner</span>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Barcode / QR Code
                </span>
              </h2>
              <p className="text-xs text-slate-400">Scan stickers to view drawings, methods, and advance stages</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scanner Input & Quick Demo Buttons */}
        <div className="p-6 space-y-6">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Optical / Keyboard Barcode Input
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Scan or enter code (e.g. BC-PO-2026-003, BC-CAR003-P01, PKG-001-1/4)..."
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 font-mono"
                  autoFocus
                />
              </div>
              <button
                onClick={() => handleScan()}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg flex items-center space-x-1.5 transition-colors shadow-xs"
              >
                <Search className="w-4 h-4" />
                <span>Lookup</span>
              </button>
            </div>

            {/* Quick Test Chips */}
            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-slate-500 text-[11px] font-semibold flex items-center space-x-1">
                <Camera className="w-3.5 h-3.5 text-amber-600" />
                <span>Simulated Scans:</span>
              </span>
              <button
                onClick={() => {
                  setInputCode('BC-PO-2026-003');
                  handleScan('BC-PO-2026-003');
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-amber-50 border border-slate-300 hover:border-amber-400 text-slate-700 font-mono text-[11px] transition-colors"
              >
                PO-2026-003 (CAR-003 Counter)
              </button>
              <button
                onClick={() => {
                  setInputCode('BC-CAR003-P01');
                  handleScan('BC-CAR003-P01');
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-amber-50 border border-slate-300 hover:border-amber-400 text-slate-700 font-mono text-[11px] transition-colors"
              >
                CAR-003-P01 (Top Panel)
              </button>
              <button
                onClick={() => {
                  setInputCode('BC-PO-2026-011');
                  handleScan('BC-PO-2026-011');
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-amber-50 border border-slate-300 hover:border-amber-400 text-slate-700 font-mono text-[11px] transition-colors"
              >
                PO-2026-011 (Blocked Order)
              </button>
              <button
                onClick={() => {
                  setInputCode('PKG-001-1/4');
                  handleScan('PKG-001-1/4');
                }}
                className="px-2 py-0.5 rounded bg-white hover:bg-amber-50 border border-slate-300 hover:border-amber-400 text-slate-700 font-mono text-[11px] transition-colors"
              >
                PKG-001-1/4 (Dispatch Box)
              </button>
            </div>
          </div>

          {/* Action Success Alert */}
          {actionSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-semibold flex items-center space-x-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{actionSuccess}</span>
            </div>
          )}

          {/* Result Card */}
          {scanResult && (
            <div className="space-y-4">
              {scanResult.type === 'unknown' ? (
                <div className="p-6 text-center border-2 border-dashed border-rose-300 bg-rose-50/50 rounded-xl">
                  <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
                  <p className="text-sm font-bold text-rose-900">{scanResult.message}</p>
                  <p className="text-xs text-rose-600 mt-1">Please verify the sticker barcode or QR code syntax.</p>
                </div>
              ) : scanResult.type === 'order' ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Box className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-bold font-mono">{scanResult.item.order_number}</span>
                      <span className="text-xs text-slate-300">• {scanResult.item.work_item_code}</span>
                    </div>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-bold uppercase ${
                        scanResult.item.status === 'Blocked'
                          ? 'bg-rose-500 text-white'
                          : scanResult.item.status === 'QC'
                          ? 'bg-purple-500 text-white'
                          : scanResult.item.status === 'Assembly'
                          ? 'bg-indigo-500 text-white'
                          : 'bg-amber-400 text-slate-950'
                      }`}
                    >
                      Stage: {scanResult.item.current_stage}
                    </span>
                  </div>

                  <div className="p-4 space-y-3 text-xs text-slate-700 bg-white">
                    {/* Revision Alert Warning */}
                    {scanResult.item.revision_alert && !scanResult.item.revision_alert.resolved && (
                      <div className="p-3 bg-rose-50 border border-rose-300 rounded-lg text-rose-950 font-medium">
                        <div className="flex items-center space-x-1.5 font-bold text-rose-700">
                          <AlertTriangle className="w-4 h-4" />
                          <span>{scanResult.item.revision_alert.level}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-rose-900">{scanResult.item.revision_alert.message}</p>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Project</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.project_name}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Client Drawing</span>
                        <span className="font-semibold text-slate-900 flex items-center space-x-1">
                          <FileText className="w-3.5 h-3.5 text-blue-600" />
                          <span>{scanResult.item.approved_client_drawing_revision}</span>
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">NW Production Drawing</span>
                        <span className="font-semibold text-slate-900 flex items-center space-x-1">
                          <FileText className="w-3.5 h-3.5 text-emerald-600" />
                          <span>{scanResult.item.approved_nw_production_drawing_revision}</span>
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Production Method</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.production_method}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Dimensions</span>
                        <span className="font-semibold text-slate-900 font-mono">{scanResult.item.dimensions}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Materials</span>
                        <span className="font-semibold text-slate-900 truncate block">{scanResult.item.material}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="pt-3 border-t border-slate-200 flex flex-wrap gap-2">
                      <button
                        onClick={handleAdvanceStage}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-xs"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Advance Stage</span>
                      </button>
                      <button
                        onClick={() => setShowPrintLabel(true)}
                        className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-500" />
                        <span>Print Sticker Label</span>
                      </button>
                      {onSelectOrder && (
                        <button
                          onClick={() => {
                            onSelectOrder(scanResult.item.id);
                            onClose();
                          }}
                          className="px-3.5 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5 text-amber-700" />
                          <span>View Full Order Details</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ) : scanResult.type === 'part' ? (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Layers className="w-4 h-4 text-emerald-400" />
                      <span className="text-sm font-bold font-mono">{scanResult.item.part_code}</span>
                      <span className="text-xs text-slate-300">• {scanResult.item.part_name}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase bg-emerald-500 text-white">
                      {scanResult.item.current_stage}
                    </span>
                  </div>

                  <div className="p-4 space-y-3 text-xs text-slate-700 bg-white">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Production Order</span>
                        <span className="font-semibold text-slate-900 font-mono">{scanResult.item.production_order_number}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Cut Dimensions</span>
                        <span className="font-semibold text-slate-900 font-mono">
                          {scanResult.item.length_mm} × {scanResult.item.width_mm} × {scanResult.item.thickness_mm}mm
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Edge Banding</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.edge_banding}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Grain Direction</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.grain_direction}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Material</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.material}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">CNC File</span>
                        <span className="font-semibold text-slate-900 flex items-center space-x-1">
                          <Cpu className="w-3.5 h-3.5 text-blue-600" />
                          <span>{scanResult.item.cnc_file_name || 'Standard Cut'}</span>
                        </span>
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-200 flex flex-wrap gap-2">
                      <button
                        onClick={handleAdvanceStage}
                        className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors shadow-xs"
                      >
                        <ArrowRight className="w-3.5 h-3.5" />
                        <span>Move Part to Next Stage</span>
                      </button>
                      <button
                        onClick={() => setShowPrintLabel(true)}
                        className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-lg font-bold text-xs flex items-center space-x-1.5 transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5 text-slate-500" />
                        <span>Print Part Sticker</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                  <div className="bg-slate-900 text-white px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Box className="w-4 h-4 text-amber-400" />
                      <span className="text-sm font-bold font-mono">{scanResult.item.package_number}</span>
                      <span className="text-xs text-slate-300">• {scanResult.item.package_title}</span>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full font-bold uppercase bg-amber-400 text-slate-950">
                      {scanResult.item.status}
                    </span>
                  </div>

                  <div className="p-4 space-y-3 text-xs text-slate-700 bg-white">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Destination</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.destination_location}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Dimensions</span>
                        <span className="font-semibold text-slate-900 font-mono">{scanResult.item.dimensions_mm}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Weight</span>
                        <span className="font-semibold text-slate-900 font-mono">{scanResult.item.weight_kg} kg</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Protection Type</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.protection_type}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px] uppercase font-bold">Packed By</span>
                        <span className="font-semibold text-slate-900">{scanResult.item.packed_by}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Printable Thermal Label Preview Modal */}
          {showPrintLabel && scanResult?.item && (
            <div className="mt-4 p-4 border-2 border-slate-800 bg-white rounded-xl shadow-lg space-y-3">
              <div className="flex items-center justify-between border-b pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Thermal Label Preview (100mm × 75mm)
                </span>
                <button
                  onClick={() => setShowPrintLabel(false)}
                  className="text-xs text-slate-400 hover:text-slate-700"
                >
                  Close
                </button>
              </div>

              <div className="p-4 border border-dashed border-slate-400 rounded-lg bg-slate-50 flex items-center justify-between">
                <div className="space-y-1">
                  <div className="text-xs font-black tracking-wider text-slate-900">NW OS FACTORY LABEL</div>
                  <div className="text-base font-black font-mono text-slate-900">
                    {scanResult.item.order_number || scanResult.item.part_code || scanResult.item.package_number}
                  </div>
                  <div className="text-xs text-slate-600 font-medium">
                    {scanResult.item.description || scanResult.item.part_name || scanResult.item.package_title}
                  </div>
                  <div className="text-[11px] text-slate-500 font-mono">
                    {scanResult.item.dimensions || `${scanResult.item.length_mm}x${scanResult.item.width_mm}mm`}
                  </div>
                  <div className="text-[10px] text-slate-400">
                    DWG: {scanResult.item.approved_client_drawing_revision || scanResult.item.drawing_reference || 'A-103'}
                  </div>
                </div>
                <div className="text-center p-2 bg-white border border-slate-300 rounded-lg">
                  <QrCode className="w-16 h-16 text-slate-900 mx-auto" />
                  <span className="text-[9px] font-mono text-slate-500 mt-1 block">
                    {scanResult.item.barcode || 'NW-BARCODE'}
                  </span>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    alert('Print command sent to factory Zebra ZT411 thermal label printer.');
                    setShowPrintLabel(false);
                  }}
                  className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>Send to Factory Printer</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
