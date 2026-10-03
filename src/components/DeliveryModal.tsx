/**
 * NW OS Delivery Scheduling & Site Reception Modal
 * Supports contractor delivery dispatch and site supervisor receipt confirmation.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import { Truck, Calendar, Clock, CheckCircle2, X, MapPin } from 'lucide-react';

interface DeliveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  workItem: WorkItem;
  mode: 'schedule' | 'receive' | 'install';
}

export const DeliveryModal: React.FC<DeliveryModalProps> = ({
  isOpen,
  onClose,
  workItem,
  mode,
}) => {
  const {
    currentUser,
    scheduleDelivery,
    confirmDeliveryReceived,
    activateInstallation,
    completeInstallation,
  } = useNW();

  const [date, setDate] = useState(
    workItem.scheduled_delivery_date || new Date().toISOString().split('T')[0]
  );
  const [time, setTime] = useState(workItem.scheduled_delivery_time || '10:00 AM');
  const [lorryDetails, setLorryDetails] = useState('3-Ton Lorry (WXY 8821) — Driver Ah Fatt');
  const [receiptNotes, setReceiptNotes] = useState('Received at Pavilion loading bay 3. No transit damages.');

  if (!isOpen) return null;

  const handleScheduleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    scheduleDelivery(workItem.id, date, time, lorryDetails);
    onClose();
  };

  const handleReceiveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Delivery Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Target Arrival Time
                </label>
                <input
                  type="text"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  placeholder="e.g. 10:00 AM"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Lorry Plate & Logistics Contact
              </label>
              <input
                type="text"
                value={lorryDetails}
                onChange={(e) => setLorryDetails(e.target.value)}
                placeholder="e.g. 1-Ton Lorry WKL 2039 (Driver Ah Meng +6012-xxx)"
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:bg-white"
                required
              />
            </div>

            <div className="p-3 rounded-xl bg-sky-50 border border-sky-200 text-[11px] text-sky-800 font-medium">
              Site Supervisor Suresh Kumar will be notified automatically to reserve loading bay access and freight hoist permits.
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
                className="px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer"
              >
                Confirm Delivery Schedule
              </button>
            </div>
          </form>
        )}

        {mode === 'receive' && (
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
