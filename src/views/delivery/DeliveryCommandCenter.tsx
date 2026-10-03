import React from 'react';
import {
  Truck,
  PackageCheck,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Hammer,
  ShieldCheck,
  FileCheck2,
  Calendar,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';

interface DeliveryCommandCenterProps {
  onNavigateTab: (tabId: string) => void;
  onSelectDelivery?: (deliveryId: string) => void;
}

export const DeliveryCommandCenter: React.FC<DeliveryCommandCenterProps> = ({
  onNavigateTab,
  onSelectDelivery,
}) => {
  const {
    deliveryRecords,
    installationJobs,
    siteQCInspections,
    handoverRecords,
    productionOrders,
    packingPackages,
    resolveDeliveryConflict,
  } = useNW();

  // Compute exception metrics
  const readyForDeliveryCount = productionOrders.filter(
    (o) => o.status === 'Ready for Delivery' || (o.status === 'Packing' && packingPackages.some((p) => p.production_order_id === o.id))
  ).length;

  const scheduledCount = deliveryRecords.filter((d) => d.status === 'Scheduled').length;
  const loadingCount = deliveryRecords.filter((d) => d.status === 'Loading').length;
  const inTransitCount = deliveryRecords.filter((d) => d.status === 'In Transit').length;
  const deliveredTodayCount = deliveryRecords.filter(
    (d) => d.status === 'Delivered' || d.status === 'Received / Confirmed'
  ).length;

  const deliveryIssuesCount = deliveryRecords.filter((d) => d.status === 'Delivery Issue').length;
  const awaitingSiteConfirmationCount = deliveryRecords.filter(
    (d) => d.status === 'In Transit' || (d.status === 'Delivered' && !d.site_receipt)
  ).length;

  const installationTodayCount = installationJobs.filter(
    (j) => j.status === 'In Progress' || j.status === 'Site Ready'
  ).length;

  const installationDelayedCount = installationJobs.filter(
    (j) => j.status === 'Delayed' || j.status === 'Blocked'
  ).length;

  const siteQCPendingCount = installationJobs.filter(
    (j) => j.status === 'Awaiting Inspection' || j.status === 'QC'
  ).length;

  const completionPendingCount = handoverRecords.filter(
    (h) => h.status === 'Draft' || h.status === 'Pending Client Inspection'
  ).length;

  // Conflicts
  const conflictedDeliveries = deliveryRecords.filter((d) => d.schedule_conflict);

  const kpiCards = [
    {
      id: 'ready-for-delivery',
      title: 'Ready for Delivery',
      value: readyForDeliveryCount,
      subtext: 'Factory QC passed & packed',
      icon: PackageCheck,
      color: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      badge: 'QC Passed',
      tab: 'ready',
    },
    {
      id: 'delivery-scheduled',
      title: 'Delivery Scheduled',
      value: scheduledCount,
      subtext: 'Transport booked by trade',
      icon: Calendar,
      color: 'bg-blue-50 text-blue-700 border-blue-200',
      badge: `${scheduledCount} Lorry Trips`,
      tab: 'schedule',
    },
    {
      id: 'loading',
      title: 'Loading',
      value: loadingCount,
      subtext: 'Scanning & checklist verification',
      icon: Layers,
      color: 'bg-amber-50 text-amber-700 border-amber-200',
      badge: 'At Factory Dispatch Bay',
      tab: 'loading',
    },
    {
      id: 'in-transit',
      title: 'In Transit',
      value: inTransitCount,
      subtext: 'En route to site',
      icon: Truck,
      color: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      badge: 'On Highway / Transit',
      tab: 'deliveries',
    },
    {
      id: 'delivered-today',
      title: 'Delivered Today',
      value: deliveredTodayCount,
      subtext: 'Site receipts generated',
      icon: CheckCircle2,
      color: 'bg-teal-50 text-teal-700 border-teal-200',
      badge: 'Unloaded at Site',
      tab: 'site-receiving',
    },
    {
      id: 'delivery-issues',
      title: 'Delivery Issues',
      value: deliveryIssuesCount,
      subtext: 'Damaged or short counts',
      icon: AlertTriangle,
      color: 'bg-rose-50 text-rose-700 border-rose-200',
      badge: 'Action Required',
      tab: 'site-issues',
      highlight: deliveryIssuesCount > 0,
    },
    {
      id: 'awaiting-confirmation',
      title: 'Awaiting Site Confirmation',
      value: awaitingSiteConfirmationCount,
      subtext: 'Pending Site Supervisor seal',
      icon: Clock,
      color: 'bg-amber-50 text-amber-800 border-amber-300',
      badge: 'Gate / Bay Inspection',
      tab: 'site-receiving',
    },
    {
      id: 'installation-today',
      title: 'Installation Today',
      value: installationTodayCount,
      subtext: 'Carpenters on active sites',
      icon: Hammer,
      color: 'bg-orange-50 text-orange-700 border-orange-200',
      badge: 'In Progress',
      tab: 'installation',
    },
    {
      id: 'installation-delayed',
      title: 'Installation Delayed',
      value: installationDelayedCount,
      subtext: 'Site or trade clashes',
      icon: AlertTriangle,
      color: 'bg-red-50 text-red-700 border-red-200',
      badge: 'Blocked / Clash',
      tab: 'installation',
      highlight: installationDelayedCount > 0,
    },
    {
      id: 'site-qc',
      title: 'Site QC',
      value: siteQCPendingCount,
      subtext: 'Joinery ready for punch-list',
      icon: ShieldCheck,
      color: 'bg-purple-50 text-purple-700 border-purple-200',
      badge: 'Clerk of Works Sign-off',
      tab: 'site-qc',
    },
    {
      id: 'completion-pending',
      title: 'Completion Pending',
      value: completionPendingCount,
      subtext: 'CPC & Handover packages',
      icon: FileCheck2,
      color: 'bg-sky-50 text-sky-700 border-sky-200',
      badge: 'DLP 12/24M & Retention',
      tab: 'handover',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Banner: Exception Notice */}
      {conflictedDeliveries.length > 0 && (
        <div className="bg-amber-50 border-2 border-amber-400 rounded-xl p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-start space-x-3">
              <span className="p-2 bg-amber-200 text-amber-900 rounded-lg shrink-0">
                <AlertTriangle className="w-5 h-5 animate-pulse" />
              </span>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-black text-amber-950 uppercase tracking-wide text-xs">
                    ⚠️ SCHEDULE CONFLICT DETECTED
                  </span>
                  <span className="px-2 py-0.5 text-[10px] font-bold bg-amber-200 text-amber-900 rounded-full">
                    {conflictedDeliveries.length} Conflicts
                  </span>
                </div>
                <p className="text-xs text-amber-900 mt-1">
                  Deliveries{' '}
                  <span className="font-bold underline">
                    {conflictedDeliveries.map((c) => c.delivery_number).join(', ')}
                  </span>{' '}
                  request simultaneous access to the same loading bay/time slot. Rule: System does{' '}
                  <span className="font-bold">NOT</span> automatically reschedule. PM & Contractor review required.
                </p>
              </div>
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <button
                onClick={() => onNavigateTab('schedule')}
                className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold rounded-lg shadow-sm transition-colors"
              >
                Review & Reschedule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 text-[11px] font-black tracking-wider uppercase bg-amber-100 text-amber-900 rounded-md">
              Module 14 • Field Operations
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs font-semibold text-slate-600">Exception-Focused Control</span>
          </div>
          <h2 className="text-xl font-black text-slate-900 mt-1 tracking-tight">
            DELIVERY COMMAND CENTER
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time pipeline tracking: Factory QC Passed → Packed → Loading & QR Scan → Delivered → Site Receiving → Installation → Site QC → Handover.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onNavigateTab('loading')}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
          >
            <Truck className="w-4 h-4 text-amber-400" />
            <span>Scan & Load Lorry</span>
          </button>
          <button
            onClick={() => onNavigateTab('site-receiving')}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
          >
            <PackageCheck className="w-4 h-4" />
            <span>Receive at Site</span>
          </button>
          <button
            onClick={() => onNavigateTab('installation')}
            className="flex items-center space-x-1.5 px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
          >
            <Hammer className="w-4 h-4" />
            <span>Installation Board</span>
          </button>
        </div>
      </div>

      {/* Top 11 Exception Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3 sm:gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              onClick={() => onNavigateTab(card.tab)}
              className={`text-left p-4 rounded-xl border transition-all duration-150 hover:shadow-md hover:-translate-y-0.5 ${
                card.color
              } ${card.highlight ? 'ring-2 ring-rose-500 ring-offset-1' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="p-2 rounded-lg bg-white/70 shadow-2xs">
                  <Icon className="w-4 h-4" />
                </span>
                <span className="text-2xl font-black tracking-tight">{card.value}</span>
              </div>
              <div className="mt-3">
                <div className="text-xs font-black truncate">{card.title}</div>
                <div className="text-[11px] opacity-75 mt-0.5 truncate">{card.subtext}</div>
              </div>
              <div className="mt-2.5 pt-2 border-t border-current/10 flex items-center justify-between text-[10px] font-bold">
                <span>{card.badge}</span>
                <ArrowRight className="w-3 h-3 opacity-60" />
              </div>
            </button>
          );
        })}
      </div>

      {/* Workflow Chain Visualizer */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider mb-3">
          Controlled Operational Chain
        </h3>
        <div className="overflow-x-auto pb-2">
          <div className="flex items-center min-w-[850px] text-xs font-bold text-slate-700">
            {[
              { label: 'PRODUCTION', status: 'Completed', color: 'bg-emerald-100 text-emerald-800' },
              { label: 'QC PASSED', status: 'Passed', color: 'bg-emerald-100 text-emerald-800' },
              { label: 'PACKED', status: 'Dispatch Ready', color: 'bg-emerald-100 text-emerald-800' },
              { label: 'READY FOR DELIVERY', status: `${readyForDeliveryCount} Items`, color: 'bg-blue-100 text-blue-900' },
              { label: 'LOADING', status: 'Checklist + QR', color: 'bg-amber-100 text-amber-900' },
              { label: 'IN TRANSIT', status: `${inTransitCount} Active`, color: 'bg-indigo-100 text-indigo-900' },
              { label: 'DELIVERED', status: 'Receipt Verified', color: 'bg-teal-100 text-teal-900' },
              { label: 'INSTALLATION', status: 'Progress & Checklist', color: 'bg-orange-100 text-orange-900' },
              { label: 'SITE QC', status: 'Snag Punch-list', color: 'bg-purple-100 text-purple-900' },
              { label: 'COMPLETION / CPC', status: 'DLP & Retention', color: 'bg-slate-900 text-amber-400' },
            ].map((step, idx, arr) => (
              <React.Fragment key={step.label}>
                <div className={`px-3 py-2 rounded-lg text-center shrink-0 ${step.color} shadow-2xs`}>
                  <div className="text-[10px] uppercase font-black tracking-tight">{step.label}</div>
                  <div className="text-[9px] opacity-80 mt-0.5">{step.status}</div>
                </div>
                {idx < arr.length - 1 && (
                  <span className="mx-1 text-slate-300 shrink-0 font-black">→</span>
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
