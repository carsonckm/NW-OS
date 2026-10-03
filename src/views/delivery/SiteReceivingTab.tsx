import React, { useState } from 'react';
import {
  PackageCheck,
  CheckCircle2,
  AlertTriangle,
  Camera,
  FileText,
  MapPin,
  Clock,
  Layers,
  Truck,
  User,
  ShieldAlert,
  ArrowRight,
  Info,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { DeliveryRecord, DeliveryReceipt } from '../../types';

interface SiteReceivingTabProps {
  onSelectDeliveryId?: (id: string) => void;
  onNavigateToInstallation?: () => void;
}

export const SiteReceivingTab: React.FC<SiteReceivingTabProps> = ({
  onNavigateToInstallation,
}) => {
  const {
    deliveryRecords,
    currentUser,
    recordDeliveryReceipt,
  } = useNW();

  // Find deliveries that are In Transit, Arrived, or recently Delivered
  const candidateDeliveries = deliveryRecords.filter(
    (d) => d.status === 'In Transit' || d.status === 'Arrived at Site' || d.status === 'Scheduled' || d.status === 'Delivered'
  );

  const [activeDeliveryId, setActiveDeliveryId] = useState<string>(
    candidateDeliveries[0]?.id || deliveryRecords[0]?.id || ''
  );

  const currentDelivery = deliveryRecords.find((d) => d.id === activeDeliveryId) || deliveryRecords[0];

  // Receiving Form State
  const [conditionStatus, setConditionStatus] = useState<DeliveryReceipt['condition_status']>('All In Order');
  const [packagesReceived, setPackagesReceived] = useState<number>(currentDelivery?.package_count || 1);
  const [damagedQuantity, setDamagedQuantity] = useState<number>(0);
  const [missingQuantity, setMissingQuantity] = useState<number>(0);
  const [damageDescription, setDamageDescription] = useState('');
  const [missingDescription, setMissingDescription] = useState('');
  const [notes, setNotes] = useState('All cartons inspected. Crate foam intact, zero external scratches.');
  const [receiverSignature, setReceiverSignature] = useState(`${currentUser.name} (Clerk of Works)`);
  const [receiptSuccessMsg, setReceiptSuccessMsg] = useState('');

  const handleQuickConditionClick = (condition: DeliveryReceipt['condition_status']) => {
    setConditionStatus(condition);
    if (condition === 'All In Order') {
      setDamagedQuantity(0);
      setMissingQuantity(0);
      setPackagesReceived(currentDelivery?.package_count || 1);
    } else if (condition === 'Short Quantity') {
      setMissingQuantity(1);
      setPackagesReceived(Math.max(0, (currentDelivery?.package_count || 1) - 1));
      setMissingDescription('1 crate missing from lorry manifest upon unloading.');
    } else if (condition === 'Damaged') {
      setDamagedQuantity(1);
      setDamageDescription('Carton crushed on corner with visible edge chipping on joinery.');
    } else if (condition === 'Wrong Item') {
      setNotes('Delivered item does not match work item code on approved drawing.');
    }
  };

  const handleConfirmReceiving = () => {
    if (!currentDelivery) return;

    recordDeliveryReceipt({
      delivery_id: currentDelivery.id,
      delivery_number: currentDelivery.delivery_number,
      project_id: currentDelivery.project_id,
      project_name: currentDelivery.project_name,
      receiving_user_id: currentUser.id,
      receiving_user_name: currentUser.name,
      receiving_role: currentUser.role,
      condition_status: conditionStatus,
      packages_expected: currentDelivery.package_count,
      packages_received: packagesReceived,
      damaged_quantity: damagedQuantity,
      missing_quantity: missingQuantity,
      damage_description: damageDescription,
      missing_description: missingDescription,
      receiver_signature: receiverSignature,
      notes: notes,
      photos: [
        'https://images.unsplash.com/photo-1504917599217-d4dc5ebe6122?auto=format&fit=crop&w=600&q=80',
      ],
    });

    setReceiptSuccessMsg(
      `Delivery ${currentDelivery.delivery_number} successfully received. Enforced Rule: DELIVERED — INSTALLATION NOT STARTED.`
    );
  };

  return (
    <div className="space-y-6">
      {/* Top Banner: Section 13 Rule Reminder */}
      <div className="bg-slate-900 text-white rounded-xl p-4 sm:p-5 shadow-sm border border-slate-800">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start space-x-3">
            <span className="p-2 bg-amber-400 text-slate-950 rounded-lg shrink-0">
              <Info className="w-5 h-5" />
            </span>
            <div>
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-400">
                Rule 13: Delivery Does NOT Start Installation
              </span>
              <h3 className="text-sm sm:text-base font-black text-white mt-0.5">
                DELIVERED — INSTALLATION NOT STARTED
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                When site receiving is verified, the goods are securely staged on-site. Installation remains a separate phase scheduled by the trade team.
              </p>
            </div>
          </div>

          <div className="shrink-0">
            <span className="px-3 py-1.5 bg-amber-400/20 text-amber-300 border border-amber-400/40 rounded-lg text-xs font-bold">
              Separate Workflow Stages
            </span>
          </div>
        </div>
      </div>

      {/* Select Arrival & Details */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-base font-black text-slate-900 tracking-tight">
            Site Receiving Inspection Station
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Site Supervisor gate intake verification. Confirm package counts, inspect for transit damages, and sign delivery receipt.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <label className="text-xs font-bold text-slate-500 shrink-0">Select Delivery:</label>
          <select
            value={activeDeliveryId}
            onChange={(e) => {
              setActiveDeliveryId(e.target.value);
              setReceiptSuccessMsg('');
            }}
            className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            {deliveryRecords.map((d) => (
              <option key={d.id} value={d.id}>
                {d.delivery_number} — {d.project_name.slice(0, 22)} ({d.status})
              </option>
            ))}
          </select>
        </div>
      </div>

      {currentDelivery && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Delivery Summary Card (5 cols) */}
          <div className="lg:col-span-5 space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Incoming Transport Order
                  </div>
                  <h4 className="text-lg font-black text-slate-900">
                    {currentDelivery.delivery_number}
                  </h4>
                </div>
                <span className="px-2.5 py-1 text-xs font-mono font-bold bg-amber-100 text-amber-900 rounded-lg border border-amber-200">
                  {currentDelivery.status}
                </span>
              </div>

              <div className="space-y-2.5 text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Project
                  </span>
                  <span className="font-bold text-slate-900 block">
                    {currentDelivery.project_name}
                  </span>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Work Items
                  </span>
                  <span className="font-bold text-slate-900 block">
                    {currentDelivery.work_item_codes?.join(', ') || 'CAR-003'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase">
                      Packages Count
                    </span>
                    <span className="font-black text-slate-900 text-sm">
                      {currentDelivery.package_count} Packages
                    </span>
                  </div>

                  <div>
                    <span className="text-slate-400 block text-[10px] font-bold uppercase">
                      Vehicle Plate
                    </span>
                    <span className="font-bold text-slate-800">
                      {currentDelivery.vehicle_plate}
                    </span>
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 block text-[10px] font-bold uppercase">
                    Destination Site Bay
                  </span>
                  <span className="font-semibold text-slate-800 flex items-center space-x-1">
                    <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span>{currentDelivery.destination_site}</span>
                  </span>
                </div>

                {currentDelivery.special_instructions && (
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600">
                    <span className="font-bold block text-slate-700">Special Instructions:</span>
                    {currentDelivery.special_instructions}
                  </div>
                )}
              </div>

              {/* Already Received Receipt Box */}
              {currentDelivery.site_receipt && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1 text-xs">
                  <div className="flex items-center space-x-1.5 text-emerald-900 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Site Receipt Already On File</span>
                  </div>
                  <div className="text-[11px] text-emerald-800">
                    Received by: <span className="font-bold">{currentDelivery.site_receipt.receiving_user_name}</span> (
                    {currentDelivery.site_receipt.condition_status})
                  </div>
                  <div className="text-[10px] text-emerald-700 font-mono">
                    Stamp: {currentDelivery.site_receipt.receiver_signature}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Interactive Receiving Station (7 cols) */}
          <div className="lg:col-span-7 space-y-5">
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                  Intake Inspection & Condition Buttons (Section 10)
                </h4>
                <span className="text-[10px] font-bold text-slate-400 uppercase">
                  Supervisor Intake
                </span>
              </div>

              {/* 4 Quick Action Condition Buttons */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'All In Order', label: '✅ Received', sub: 'No defects', color: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border-emerald-300' },
                  { id: 'Short Quantity', label: '⚠️ Short Quantity', sub: 'Missing cartons', color: 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300' },
                  { id: 'Damaged', label: '⚠️ Damaged', sub: 'Transit marks', color: 'bg-rose-50 hover:bg-rose-100 text-rose-900 border-rose-300' },
                  { id: 'Wrong Item', label: '⚠️ Wrong Item', sub: 'Code mismatch', color: 'bg-red-50 hover:bg-red-100 text-red-900 border-red-300' },
                ].map((btn) => (
                  <button
                    key={btn.id}
                    onClick={() => handleQuickConditionClick(btn.id as any)}
                    className={`p-3 rounded-xl border text-center transition-all ${btn.color} ${
                      conditionStatus === btn.id ? 'ring-2 ring-slate-900 font-black shadow-xs' : 'font-semibold'
                    }`}
                  >
                    <div className="text-xs">{btn.label}</div>
                    <div className="text-[10px] opacity-70 mt-0.5">{btn.sub}</div>
                  </button>
                ))}
              </div>

              {/* Quantities Form */}
              <div className="grid grid-cols-3 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Packages Expected
                  </label>
                  <input
                    type="number"
                    disabled
                    value={currentDelivery.package_count}
                    className="w-full bg-slate-200 border border-slate-300 rounded-lg p-2 font-black text-slate-800 text-center"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-slate-500 mb-1">
                    Packages Received
                  </label>
                  <input
                    type="number"
                    value={packagesReceived}
                    onChange={(e) => setPackagesReceived(parseInt(e.target.value) || 0)}
                    className="w-full bg-white border border-slate-300 rounded-lg p-2 font-black text-slate-900 text-center focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase text-rose-600 mb-1">
                    Damaged / Missing
                  </label>
                  <div className="flex space-x-1">
                    <input
                      type="number"
                      placeholder="Damaged"
                      value={damagedQuantity}
                      onChange={(e) => setDamagedQuantity(parseInt(e.target.value) || 0)}
                      className="w-1/2 bg-white border border-rose-300 rounded-lg p-2 font-bold text-rose-700 text-center text-xs"
                    />
                    <input
                      type="number"
                      placeholder="Missing"
                      value={missingQuantity}
                      onChange={(e) => setMissingQuantity(parseInt(e.target.value) || 0)}
                      className="w-1/2 bg-white border border-rose-300 rounded-lg p-2 font-bold text-rose-700 text-center text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Discrepancy details if damaged or short */}
              {(conditionStatus !== 'All In Order' || damagedQuantity > 0 || missingQuantity > 0) && (
                <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl space-y-3 text-xs text-rose-950">
                  <div className="flex items-center space-x-2 font-black">
                    <AlertTriangle className="w-4 h-4 text-rose-600" />
                    <span>Discrepancy Reporting (Automatic Issue Creation)</span>
                  </div>

                  {damagedQuantity > 0 && (
                    <div>
                      <label className="block font-bold text-[11px] mb-1">
                        Damage Description:
                      </label>
                      <input
                        type="text"
                        value={damageDescription}
                        onChange={(e) => setDamageDescription(e.target.value)}
                        placeholder="Detail damage location, chipped corner, scratch..."
                        className="w-full p-2 bg-white border border-rose-200 rounded-lg text-xs"
                      />
                    </div>
                  )}

                  {missingQuantity > 0 && (
                    <div>
                      <label className="block font-bold text-[11px] mb-1">
                        Missing Items Description:
                      </label>
                      <input
                        type="text"
                        value={missingDescription}
                        onChange={(e) => setMissingDescription(e.target.value)}
                        placeholder="Detail missing crate numbers or hardware box..."
                        className="w-full p-2 bg-white border border-rose-200 rounded-lg text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Supervisor Notes & Digital Stamp */}
              <div className="space-y-3 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Site Supervisor Inspection Notes
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-500"
                  />
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Receiving Seal / Digital Signature
                  </label>
                  <input
                    type="text"
                    value={receiverSignature}
                    onChange={(e) => setReceiverSignature(e.target.value)}
                    className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-mono font-bold text-slate-800"
                  />
                </div>
              </div>

              {/* Success Message Banner */}
              {receiptSuccessMsg && (
                <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{receiptSuccessMsg}</span>
                  </div>
                  {onNavigateToInstallation && (
                    <button
                      onClick={onNavigateToInstallation}
                      className="px-3 py-1 bg-emerald-700 text-white rounded text-[11px] font-bold hover:bg-emerald-800 shrink-0"
                    >
                      Go to Installation →
                    </button>
                  )}
                </div>
              )}

              {/* Confirm Receipt Action Button */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <div className="text-[11px] text-slate-500">
                  Logged by: <span className="font-bold text-slate-700">{currentUser.name}</span>
                </div>

                <button
                  onClick={handleConfirmReceiving}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow-md transition-all flex items-center space-x-2"
                >
                  <PackageCheck className="w-4 h-4" />
                  <span>Confirm Site Receiving</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
