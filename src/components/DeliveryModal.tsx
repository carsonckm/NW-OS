/**
 * NW OS Delivery Scheduling & Site Reception Modal
 * Supports contractor delivery dispatch and site supervisor receipt confirmation.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import { navigateTo } from '../services/navigation';
import { Truck, CheckCircle2, X } from 'lucide-react';

interface DeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  workItem: WorkItem;
  mode: 'schedule' | 'receive' | 'install';
}

const inputClass =
  'w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white';

export const DeliveryModal: React.FC<DeliveryModalProps> = ({
  isOpen,
  onClose,
  workItem,
  mode,
}) => {
  const {
    currentUser,
    projects,
    contractors,
    scheduleDelivery,
    confirmDeliveryReceived,
    activateInstallation,
    completeInstallation,
    coreDataSync,
  } = useNW();
  const project = projects.find((p) => p.id === workItem.project_id);

  // Quick Schedule creates a real delivery record: everything it needs is asked for here.
  // Known facts (the item's contractor, the project's site) are offered; nothing is invented.
  const [contractorId, setContractorId] = useState(workItem.contractor_id || '');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [driverName, setDriverName] = useState('');
  const [driverContact, setDriverContact] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [destination, setDestination] = useState(project?.site_address || '');
  const [packageCount, setPackageCount] = useState('');
  const [instructions, setInstructions] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One id per delivery being arranged: submitting again after an unconfirmed attempt reuses
  // it, so the server never ends up with two deliveries.
  const [deliveryId] = useState(() => `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  if (!isOpen) return null;

  const missing = [
    !contractorId && 'contractor',
    !date && 'delivery date',
    !time.trim() && 'arrival time',
    !driverName.trim() && 'driver name',
    !driverContact.trim() && 'driver contact',
    !vehiclePlate.trim() && 'vehicle plate',
    !vehicleType.trim() && 'vehicle type',
    !destination.trim() && 'destination',
    !(Number(packageCount) > 0) && 'package count',
  ].filter(Boolean) as string[];

  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (missing.length) {
      setError(`Fill in: ${missing.join(', ')}`);
      return;
    }
    setError(null);
    setIsSubmitting(true);
    const result = await scheduleDelivery(
      workItem.id,
      {
        contractor_id: contractorId,
        delivery_date: date,
        delivery_time: time.trim(),
        driver_name: driverName.trim(),
        driver_contact: driverContact.trim(),
        vehicle_plate: vehiclePlate.trim(),
        vehicle_type: vehicleType.trim(),
        destination_site: destination.trim(),
        package_count: Number(packageCount),
        special_instructions: instructions.trim(),
      },
      { id: deliveryId }
    );
    setIsSubmitting(false);
    // Only a saved delivery closes the form; otherwise the server's reason is shown and the
    // details stay for correction.
    if (result.ok === false) setError(result.message);
    else onClose();
  };

  // With the database, a receipt is recorded on the delivery itself (Delivery › Site
  // Receiving), which sets the item's delivery status; it cannot be set on the item alone.
  const receiveOnDelivery = coreDataSync.mode === 'database';

  const handleReceiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (receiveOnDelivery) return;
    confirmDeliveryReceived(workItem.id, currentUser.name);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
      <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-5 sm:p-6 text-slate-800 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 pb-3 mb-4">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center">
              <Truck className="w-4 h-4 text-sky-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {mode === 'schedule'
                  ? 'Schedule Delivery to Site'
                  : mode === 'receive'
                  ? 'Confirm Site Delivery Receipt'
                  : 'Site Installation Control'}
              </h3>
              <p className="text-[11px] text-slate-500 font-medium">
                Item: <span className="text-amber-700 font-mono font-bold">{workItem.item_code}</span> — {workItem.description}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {mode === 'schedule' && (
          <form onSubmit={handleScheduleSubmit} className="space-y-4">
            <p className="text-[11px] text-slate-600">
              Creates a delivery record on <strong>{project?.project_name ?? workItem.project_id}</strong> for this item. The item shows as
              Scheduled once the delivery is saved.
            </p>
            <div>
              <label htmlFor="quickDeliveryContractor" className="block text-xs font-bold text-slate-700 mb-1">Responsible contractor <span className="text-red-500">*</span></label>
              <select id="quickDeliveryContractor" value={contractorId} onChange={(e) => setContractorId(e.target.value)} className={inputClass} required>
                <option value="">Select…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.company_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="quickDeliveryDate" className="block text-xs font-bold text-slate-700 mb-1">Delivery date <span className="text-red-500">*</span></label>
                <input id="quickDeliveryDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} required />
              </div>
              <div>
                <label htmlFor="quickDeliveryTime" className="block text-xs font-bold text-slate-700 mb-1">Arrival time <span className="text-red-500">*</span></label>
                <input id="quickDeliveryTime" placeholder="e.g. 10:00 AM" value={time} onChange={(e) => setTime(e.target.value)} className={inputClass} required />
              </div>
              <div>
                <label htmlFor="quickDeliveryDriver" className="block text-xs font-bold text-slate-700 mb-1">Driver name <span className="text-red-500">*</span></label>
                <input id="quickDeliveryDriver" value={driverName} onChange={(e) => setDriverName(e.target.value)} className={inputClass} required />
              </div>
              <div>
                <label htmlFor="quickDeliveryContact" className="block text-xs font-bold text-slate-700 mb-1">Driver contact <span className="text-red-500">*</span></label>
                <input id="quickDeliveryContact" value={driverContact} onChange={(e) => setDriverContact(e.target.value)} className={inputClass} required />
              </div>
              <div>
                <label htmlFor="quickDeliveryPlate" className="block text-xs font-bold text-slate-700 mb-1">Vehicle plate <span className="text-red-500">*</span></label>
                <input id="quickDeliveryPlate" value={vehiclePlate} onChange={(e) => setVehiclePlate(e.target.value)} className={inputClass} required />
              </div>
              <div>
                <label htmlFor="quickDeliveryVehicle" className="block text-xs font-bold text-slate-700 mb-1">Vehicle type <span className="text-red-500">*</span></label>
                <input id="quickDeliveryVehicle" placeholder="e.g. 3-Ton Box Lorry" value={vehicleType} onChange={(e) => setVehicleType(e.target.value)} className={inputClass} required />
              </div>
              <div>
                <label htmlFor="quickDeliveryPackages" className="block text-xs font-bold text-slate-700 mb-1">Package count <span className="text-red-500">*</span></label>
                <input id="quickDeliveryPackages" type="number" min="1" value={packageCount} onChange={(e) => setPackageCount(e.target.value)} className={inputClass} required />
              </div>
            </div>
              <div>
                <label htmlFor="quickDeliveryDestination" className="block text-xs font-bold text-slate-700 mb-1">Destination <span className="text-red-500">*</span></label>
                <input id="quickDeliveryDestination" value={destination} onChange={(e) => setDestination(e.target.value)} className={inputClass} required />
              </div>

            <div>
              <label htmlFor="quickDeliveryInstructions" className="block text-xs font-bold text-slate-700 mb-1">Special instructions</label>
              <input id="quickDeliveryInstructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} className={inputClass} />
            </div>

            {error && (
              <div role="alert" className="p-3 rounded-xl bg-red-50 border border-red-200 text-[11px] text-red-800 font-medium">
                {error}
              </div>
            )}
            {!error && missing.length > 0 && <p className="text-[11px] text-slate-500">Still needed: {missing.join(', ')}.</p>}

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting || missing.length > 0}
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? 'Saving…' : 'Create Delivery'}
              </button>
            </div>
          </form>
        )}

        {mode === 'receive' && receiveOnDelivery && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600">
              Record the site receipt on this item's delivery. The item's delivery status follows the delivery and its receipt.
            </p>
            <div className="flex justify-end space-x-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-300 cursor-pointer">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  navigateTo('delivery', workItem.project_id);
                  onClose();
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Open Delivery › Site Receiving
              </button>
            </div>
          </div>
        )}

        {mode === 'receive' && !receiveOnDelivery && (
          <form onSubmit={handleReceiveSubmit} className="space-y-4">
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-slate-500">Scheduled:</span>
                <span className="text-slate-900 font-bold">{workItem.scheduled_delivery_date} ({workItem.scheduled_delivery_time})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Location:</span>
                <span className="text-slate-900 font-bold">{workItem.location}</span>
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Site Inspection & Unloading Notes
              </label>
              <textarea
                value={receiptNotes}
                onChange={(e) => setReceiptNotes(e.target.value)}
                placeholder="e.g. Received at loading bay 3. No transit damage."
                rows={2}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl p-2.5 text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
                required
              />
            </div>

            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-medium">
              ⚠️ <strong>Important Rule:</strong> Delivery confirmation confirms physical arrival at site. It does <strong>not</strong> automatically start installation. Installation must be activated when the site area is cleared.
            </div>

            <div className="flex justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center space-x-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Confirm Delivery Received</span>
              </button>
            </div>
          </form>
        )}

        {mode === 'install' && (
          <div className="space-y-4">
            <p className="text-xs text-slate-600">
              The item has been delivered and inspected on site. Manage installation stages:
            </p>

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => {
                  activateInstallation(workItem.id);
                  onClose();
                }}
                className="p-4 rounded-xl border border-sky-300 bg-sky-50/70 hover:bg-sky-100 text-left transition-colors cursor-pointer"
              >
                <div className="text-xs font-bold text-sky-900">Start Site Installation</div>
                <div className="text-[11px] text-slate-600 mt-1">
                  Site area ready, carpenters commencing assembly & fixing.
                </div>
              </button>

              <button
                onClick={() => {
                  completeInstallation(workItem.id);
                  onClose();
                }}
                className="p-4 rounded-xl border border-emerald-300 bg-emerald-50/70 hover:bg-emerald-100 text-left transition-colors cursor-pointer"
              >
                <div className="text-xs font-bold text-emerald-900">Mark Completed (100%)</div>
                <div className="text-[11px] text-slate-600 mt-1">
                  Installed, cleaned, siliconed, ready for final handover.
                </div>
              </button>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl border border-slate-300 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
