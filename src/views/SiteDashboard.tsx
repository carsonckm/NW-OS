/**
 * NW OS Site Supervisor Mobile Dashboard
 * Built for fast on-site execution: Delivery receipt, installation triggers, punchlists, and rapid problem reporting.
 */

import React, { useState } from 'react';
import { DailyBriefing } from '../components/DailyBriefing';
import { useNW } from '../context/NWContext';
import { WorkItem } from '../types';
import {
  Truck,
  Wrench,
  AlertTriangle,
  CheckCircle2,
  Camera,
  MapPin,
  Clock,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { DeliveryModal } from '../components/DeliveryModal';
import { IssueModal } from '../components/IssueModal';

export const SiteDashboard: React.FC = () => {
  const { selectedProject, workItems } = useNW();

  const [selectedItemForDelivery, setSelectedItemForDelivery] = useState<WorkItem | null>(null);
  const [selectedItemForInstall, setSelectedItemForInstall] = useState<WorkItem | null>(null);
  const [showIssueModal, setShowIssueModal] = useState(false);

  // Deliveries targeting site today or scheduled
  const incomingDeliveries = workItems.filter(
    (w) => w.delivery_status === 'Scheduled' || w.status === 'Delivered'
  );

  // Items currently being installed or ready for install
  const siteInstallations = workItems.filter(
    (w) =>
      w.status === 'Delivered' ||
      w.installation_status === 'In Progress' ||
      w.installation_status === 'Scheduled'
  );

  return (
    <div className="space-y-6 max-w-4xl mx-auto px-4 sm:px-6 py-6 text-slate-800">
      <DailyBriefing />
      {/* Site Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold uppercase tracking-widest">
                Site Supervisor Console
              </span>
              <span className="text-xs text-slate-500 font-medium">Suresh Kumar</span>
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900 mt-1">
              {selectedProject?.project_name.split('—')[0]}
            </h1>
            <p className="text-xs text-slate-500 mt-1 flex items-center space-x-1.5">
              <MapPin className="w-3.5 h-3.5 text-slate-400" />
              <span>{selectedProject?.site_address}</span>
            </p>
          </div>

          <button
            onClick={() => setShowIssueModal(true)}
            className="px-4 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center space-x-2 transition-colors shrink-0 cursor-pointer"
          >
            <Camera className="w-4 h-4" />
            <span>Report Site Problem / Discrepancy</span>
          </button>
        </div>
      </div>

      {/* SECTION 1: INCOMING DELIVERIES */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Truck className="w-5 h-5 text-sky-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Site Deliveries ({incomingDeliveries.length})
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Pavilion Loading Bay 3</span>
        </div>

        <div className="space-y-3">
          {incomingDeliveries.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-mono font-bold text-sky-700">{item.item_code}</span>
                    <span className="text-xs font-bold text-slate-900">{item.description}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Scheduled Arrival:{' '}
                    <strong className="text-slate-800">
                      {item.scheduled_delivery_date || 'Today'} ({item.scheduled_delivery_time || 'Morning'})
                    </strong>
                  </p>
                </div>

                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded border self-start sm:self-center ${
                    item.delivery_status === 'Received / Confirmed'
                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                      : 'bg-sky-50 text-sky-800 border-sky-200'
                  }`}
                >
                  {item.delivery_status}
                </span>
              </div>

              {item.delivery_status !== 'Received / Confirmed' ? (
                <button
                  onClick={() => setSelectedItemForDelivery(item)}
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg shadow-2xs flex items-center justify-center space-x-2 transition-colors cursor-pointer"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Inspect Lorry & Confirm Delivery Received</span>
                </button>
              ) : (
                <div className="text-[11px] text-emerald-850 bg-emerald-50 border border-emerald-200 p-2.5 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-1 font-medium">
                  <div className="flex items-center space-x-2">
                    <span className="inline-block px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-black text-[10px] uppercase tracking-wide">
                      DELIVERED — INSTALLATION NOT STARTED
                    </span>
                    <span className="text-slate-600 text-xs">Physical cargo inspected and signed on site.</span>
                  </div>
                  <span className="text-slate-500 text-[10px]">{item.received_delivery_date}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* SECTION 2: SITE INSTALLATIONS */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Wrench className="w-5 h-5 text-amber-600" />
            <h3 className="text-sm font-bold text-slate-900">
              Site Installations ({siteInstallations.length})
            </h3>
          </div>
          <span className="text-[10px] text-slate-500 font-medium">Manual Human Activation</span>
        </div>

        <div className="space-y-3">
          {siteInstallations.map((item) => (
            <div
              key={item.id}
              className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div>
                <div className="flex items-center space-x-2">
                  <span className="text-xs font-mono font-bold text-amber-700">{item.item_code}</span>
                  <span className="text-xs font-bold text-slate-900">{item.description}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Location: {item.location} • Status:{' '}
                  <strong className="text-slate-800">{item.installation_status}</strong>
                </p>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <button
                  onClick={() => setSelectedItemForInstall(item)}
                  className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-lg border border-slate-300 transition-colors cursor-pointer shadow-2xs"
                >
                  Manage Install
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delivery Modal */}
      {selectedItemForDelivery && (
        <DeliveryModal
          isOpen={Boolean(selectedItemForDelivery)}
          onClose={() => setSelectedItemForDelivery(null)}
          workItem={selectedItemForDelivery}
          mode="receive"
        />
      )}

      {/* Install Modal */}
      {selectedItemForInstall && (
        <DeliveryModal
          isOpen={Boolean(selectedItemForInstall)}
          onClose={() => setSelectedItemForInstall(null)}
          workItem={selectedItemForInstall}
          mode="install"
        />
      )}

      {/* Issue Modal */}
      {showIssueModal && (
        <IssueModal
          isOpen={showIssueModal}
          onClose={() => setShowIssueModal(false)}
        />
      )}
    </div>
  );
};
