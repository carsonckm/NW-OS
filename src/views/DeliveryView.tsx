import React, { useState } from 'react';
import {
  Truck,
  LayoutDashboard,
  Calendar,
  PackageCheck,
  Package,
  ArrowDownToLine,
  Hammer,
  ShieldCheck,
  Award,
  FileCheck2,
  AlertTriangle,
  Plus,
  Layers,
  ArrowRight,
} from 'lucide-react';
import { useNW } from '../context/NWContext';
import { hasPermission } from '../utils/permissions';
import { DeliveryCommandCenter } from './delivery/DeliveryCommandCenter';
import { ReadyForDeliveryTab } from './delivery/ReadyForDeliveryTab';
import { DeliveryScheduleTab } from './delivery/DeliveryScheduleTab';
import { LoadingAndScanTab } from './delivery/LoadingAndScanTab';
import { SiteReceivingTab } from './delivery/SiteReceivingTab';
import { InstallationCenterTab } from './delivery/InstallationCenterTab';
import { SiteQCTab } from './delivery/SiteQCTab';
import { CompletionHandoverTab } from './delivery/CompletionHandoverTab';
import { SiteIssuesAndChangesTab } from './delivery/SiteIssuesAndChangesTab';
import { ProductionOrder, WorkItem, DeliveryRecord } from '../types';

export type DeliverySubTab =
  | 'dashboard'
  | 'schedule'
  | 'ready'
  | 'deliveries'
  | 'site-receiving'
  | 'installation'
  | 'site-qc'
  | 'completion'
  | 'handover'
  | 'site-issues';

interface DeliveryViewProps {
  initialSubTab?: DeliverySubTab;
}

export const DeliveryView: React.FC<DeliveryViewProps> = ({ initialSubTab = 'dashboard' }) => {
  const {
    currentUser,
    deliveryRecords,
    installationJobs,
    siteQCInspections,
    handoverRecords,
    productionOrders,
    packingPackages,
    scheduleDeliveryRecord,
    projects,
    workPackages,
    workItems,
    contractors,
  } = useNW();

  const [activeTab, setActiveTab] = useState<DeliverySubTab>(initialSubTab);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | undefined>(undefined);

  // Modal state for New Delivery Arrangement
  const [showArrangeModal, setShowArrangeModal] = useState(false);
  const [arrangeData, setArrangeData] = useState<{
    project_id: string;
    work_package_id: string;
    work_item_ids: string[];
    production_order_id?: string;
    contractor_id: string;
    driver_name: string;
    driver_phone: string;
    vehicle_plate: string;
    vehicle_type: string;
    delivery_date: string;
    delivery_time: string;
    estimated_arrival_time: string;
    destination_address: string;
    package_count: number;
    special_instructions: string;
  }>({
    project_id: projects[0]?.id || '',
    work_package_id: workPackages[0]?.id || '',
    work_item_ids: [workItems[0]?.id || ''],
    contractor_id: contractors[0]?.id || '',
    driver_name: 'Encik Rosli bin Hamzah',
    driver_phone: '+60 12-882 1993',
    vehicle_plate: 'WVR 8821',
    vehicle_type: '3-Ton Box Lorry with Tailgate',
    delivery_date: new Date().toISOString().split('T')[0],
    delivery_time: '10:00 AM',
    estimated_arrival_time: '11:15 AM',
    destination_address: projects[0]?.site_address || 'Loading Bay B2, Pavilion Mall, Jalan Bukit Bintang, KL',
    package_count: 3,
    special_instructions: 'Strict security pass required. Delivery bay slot booked for 10:00 AM.',
  });

  // Calculate badges
  const readyCount = productionOrders.filter(
    (o) => o.status === 'Ready for Delivery' || (o.status === 'Packing' && packingPackages.some((p) => p.production_order_id === o.id))
  ).length;

  const scheduledDeliveriesCount = deliveryRecords.filter(
    (d) => d.status === 'Scheduled' || d.status === 'Loading' || d.status === 'In Transit'
  ).length;

  const receivingPendingCount = deliveryRecords.filter(
    (d) => d.status === 'In Transit' || d.status === 'Arrived at Site'
  ).length;

  const activeInstallationCount = installationJobs.filter(
    (j) => j.status === 'In Progress' || j.status === 'Site Ready'
  ).length;

  const openQCInspectionsCount = siteQCInspections.filter(
    (q) => q.result === 'Fail / Rectification Required' || q.result === 'Pass with Minor Rectification'
  ).length;

  const pendingHandoverCount = handoverRecords.filter(
    (h) => h.status !== 'Formal CPC Handover Signed' && h.status !== 'In DLP Period'
  ).length;

  const deliveryIssuesCount = deliveryRecords.filter(
    (d) => d.status === 'Delivery Issue'
  ).length;

  // Handlers
  const handleSelectDeliveryFromAnywhere = (deliveryId: string) => {
    setSelectedDeliveryId(deliveryId);
    setActiveTab('deliveries');
  };

  const handleOpenArrangeFromOrder = (order: ProductionOrder, workItem?: WorkItem) => {
    const proj = projects.find((p) => p.id === order.project_id) || projects[0];
    const pkg = workPackages.find((wp) => wp.id === order.work_package_id) || workPackages[0];
    const item = workItem || workItems.find((w) => w.id === order.work_item_id);

    setArrangeData({
      project_id: proj.id,
      work_package_id: pkg?.id || '',
      work_item_ids: item ? [item.id] : [],
      production_order_id: order.id,
      contractor_id: pkg?.contractor_id || contractors[0]?.id || '',
      driver_name: 'Encik Rosli bin Hamzah',
      driver_phone: '+60 12-882 1993',
      vehicle_plate: 'WVR 8821',
      vehicle_type: '3-Ton Box Lorry with Tailgate',
      delivery_date: new Date().toISOString().split('T')[0],
      delivery_time: '10:30 AM',
      estimated_arrival_time: '11:45 AM',
      destination_address: proj.site_address || 'Loading Bay B2, Project Site',
      package_count: packingPackages.filter((p) => p.production_order_id === order.id).length || 3,
      special_instructions: `Handle with care. Fabricated items for ${order.work_item_code}. Maintain vertical loading.`,
    });
    setShowArrangeModal(true);
  };

  const handleCreateDeliverySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === arrangeData.project_id);
    const pkg = workPackages.find((wp) => wp.id === arrangeData.work_package_id);
    const cont = contractors.find((c) => c.id === arrangeData.contractor_id);
    const matchedItems = workItems.filter((w) => arrangeData.work_item_ids.includes(w.id));

    scheduleDeliveryRecord({
      project_id: arrangeData.project_id,
      project_name: proj?.project_name || 'Project Site',
      work_package_id: arrangeData.work_package_id,
      work_package_name: pkg?.name || 'Joinery & Fitout Package',
      work_item_ids: arrangeData.work_item_ids,
      work_item_codes: matchedItems.map((m) => m.item_code),
      production_order_ids: arrangeData.production_order_id ? [arrangeData.production_order_id] : [],
      contractor_id: arrangeData.contractor_id,
      contractor_name: cont?.company_name || 'Main Carpentry Subcontractor',
      driver_name: arrangeData.driver_name,
      driver_contact: arrangeData.driver_phone,
      vehicle_plate: arrangeData.vehicle_plate,
      vehicle_type: arrangeData.vehicle_type,
      delivery_date: arrangeData.delivery_date,
      delivery_time: arrangeData.delivery_time,
      estimated_arrival: arrangeData.estimated_arrival_time,
      destination_site: arrangeData.destination_address,
      package_count: arrangeData.package_count,
      special_instructions: arrangeData.special_instructions,
      status: 'Scheduled',
      scanned_packages: [],
      loading_checklist: {
        correct_project: true,
        correct_work_items: true,
        correct_quantity: true,
        correct_package_count: true,
        correct_destination: true,
        protection_applied: true,
        hardware_accessories_included: true,
        delivery_documents_included: true,
        photos: [],
      },
      notes: 'Delivery arranged by Contractor. Contractor transport coordinated.',
      photos: [],
    });

    setShowArrangeModal(false);
    setActiveTab('schedule');
  };

  const navItems: {
    id: DeliverySubTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeColor?: string;
  }[] = [
    {
      id: 'dashboard',
      label: 'Delivery Dashboard',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'schedule',
      label: 'Delivery Schedule',
      icon: <Calendar className="w-4 h-4" />,
      badge: scheduledDeliveriesCount > 0 ? scheduledDeliveriesCount : undefined,
      badgeColor: 'bg-blue-600 text-white',
    },
    {
      id: 'ready',
      label: 'Ready for Delivery',
      icon: <PackageCheck className="w-4 h-4" />,
      badge: readyCount > 0 ? readyCount : undefined,
      badgeColor: 'bg-emerald-600 text-white',
    },
    {
      id: 'deliveries',
      label: 'Deliveries & Loading',
      icon: <Truck className="w-4 h-4" />,
      badge: scheduledDeliveriesCount > 0 ? scheduledDeliveriesCount : undefined,
      badgeColor: 'bg-amber-600 text-white',
    },
    {
      id: 'site-receiving',
      label: 'Site Receiving',
      icon: <ArrowDownToLine className="w-4 h-4" />,
      badge: receivingPendingCount > 0 ? receivingPendingCount : undefined,
      badgeColor: 'bg-indigo-600 text-white',
    },
    {
      id: 'installation',
      label: 'Installation',
      icon: <Hammer className="w-4 h-4" />,
      badge: activeInstallationCount > 0 ? activeInstallationCount : undefined,
      badgeColor: 'bg-orange-600 text-white',
    },
    {
      id: 'site-qc',
      label: 'Site QC & Snagging',
      icon: <ShieldCheck className="w-4 h-4" />,
      badge: openQCInspectionsCount > 0 ? openQCInspectionsCount : undefined,
      badgeColor: 'bg-rose-600 text-white',
    },
    {
      id: 'completion',
      label: 'Completion',
      icon: <Award className="w-4 h-4" />,
    },
    {
      id: 'handover',
      label: 'Client Handover',
      icon: <FileCheck2 className="w-4 h-4" />,
      badge: pendingHandoverCount > 0 ? pendingHandoverCount : undefined,
      badgeColor: 'bg-purple-600 text-white',
    },
    {
      id: 'site-issues',
      label: 'Site Issues & Changes',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: deliveryIssuesCount > 0 ? deliveryIssuesCount : undefined,
      badgeColor: 'bg-red-600 text-white',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Module Title Header */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 font-mono text-xs tracking-wider uppercase mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>NW OS Module 14 • Commercial Joinery & Fitout Protocol</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <Truck className="w-8 h-8 text-amber-400" />
              Delivery, Site Installation & Handover
            </h1>
            <p className="mt-1 text-sm text-slate-300 max-w-3xl">
              Factory Completion → Delivery → Site Receiving → Installation → Site QC → Completion → Handover.
              Contractor-arranged transport with strict loading checks and separate installation governance.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowArrangeModal(true)}
              className="inline-flex items-center space-x-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl shadow-lg transition-all text-xs"
            >
              <Plus className="w-4 h-4" />
              <span>Arrange Delivery</span>
            </button>
            <button
              onClick={() => setActiveTab('site-receiving')}
              className="inline-flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-medium px-4 py-2.5 rounded-xl border border-slate-700 transition-all text-xs"
            >
              <ArrowDownToLine className="w-4 h-4 text-emerald-400" />
              <span>Receive on Site</span>
            </button>
          </div>
        </div>

        {/* Workflow Pipeline Breadcrumb */}
        <div className="mt-6 pt-5 border-t border-slate-800/80 overflow-x-auto">
          <div className="flex items-center space-x-2 text-[11px] font-semibold text-slate-400 whitespace-nowrap min-w-max">
            <span className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300">Production Completed</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300">QC Passed</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-slate-800 text-slate-300">Packed</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/30">Ready for Delivery</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-blue-500/20 text-blue-300 border border-blue-500/30">Delivery Arranged & Loading</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">Site Receiving</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-orange-500/20 text-orange-300 border border-orange-500/30">Installation</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-purple-500/20 text-purple-300 border border-purple-500/30">Site QC & Punch List</span>
            <ArrowRight className="w-3 h-3 text-slate-600" />
            <span className="px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold">Completion & Client Handover</span>
          </div>
        </div>
      </div>

      {/* Subsections Navigation Tabs (Section 1 requirement) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-1.5 overflow-x-auto">
        <div className="flex items-center space-x-1 min-w-max">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all relative ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span
                    className={`ml-1.5 px-1.5 py-0.5 text-[10px] font-black rounded-full ${
                      item.badgeColor || (isActive ? 'bg-amber-400 text-slate-950' : 'bg-slate-200 text-slate-700')
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Contents */}
      <div>
        {activeTab === 'dashboard' && (
          <DeliveryCommandCenter
            onNavigateTab={(tab) => setActiveTab(tab as DeliverySubTab)}
            onSelectDelivery={handleSelectDeliveryFromAnywhere}
          />
        )}

        {activeTab === 'schedule' && (
          <DeliveryScheduleTab
            onSelectDelivery={(delivery) => {
              setSelectedDeliveryId(delivery.id);
              setActiveTab('deliveries');
            }}
            onNewDeliveryClick={() => setShowArrangeModal(true)}
          />
        )}

        {activeTab === 'ready' && (
          <ReadyForDeliveryTab
            onArrangeDelivery={handleOpenArrangeFromOrder}
            onRaiseIssue={() => setActiveTab('site-issues')}
            onViewOrderDetails={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'deliveries' && (
          <LoadingAndScanTab
            selectedDeliveryId={selectedDeliveryId}
            onSelectDeliveryId={(id) => setSelectedDeliveryId(id)}
          />
        )}

        {activeTab === 'site-receiving' && (
          <SiteReceivingTab
            onNavigateToInstallation={() => setActiveTab('installation')}
          />
        )}

        {activeTab === 'installation' && (
          <InstallationCenterTab
            onOpenMeasurementModal={() => setActiveTab('site-issues')}
            onOpenProblemModal={() => setActiveTab('site-issues')}
            onOpenPhotoModal={() => {}}
            onOpenQCModal={() => setActiveTab('site-qc')}
          />
        )}

        {activeTab === 'site-qc' && <SiteQCTab />}

        {activeTab === 'completion' && <CompletionHandoverTab />}

        {activeTab === 'handover' && <CompletionHandoverTab />}

        {activeTab === 'site-issues' && <SiteIssuesAndChangesTab />}
      </div>

      {/* Arrange Delivery Modal */}
      {showArrangeModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl overflow-hidden my-8 animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white p-5 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <span className="p-2 bg-amber-500 text-slate-950 rounded-xl font-bold">
                  <Truck className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-white">Arrange Transport & Delivery Record</h3>
                  <p className="text-xs text-slate-400">
                    Contractor remains responsible for transport arrangement (Section 4 protocol)
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowArrangeModal(false)}
                className="text-slate-400 hover:text-white text-lg font-bold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateDeliverySubmit} className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Project</label>
                  <select
                    value={arrangeData.project_id}
                    onChange={(e) => {
                      const pid = e.target.value;
                      const proj = projects.find((p) => p.id === pid);
                      setArrangeData({
                        ...arrangeData,
                        project_id: pid,
                        destination_address: proj?.site_address || arrangeData.destination_address,
                      });
                    }}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_number} • {p.project_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Responsible Contractor</label>
                  <select
                    value={arrangeData.contractor_id}
                    onChange={(e) => setArrangeData({ ...arrangeData, contractor_id: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  >
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.company_name} ({c.trade})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Work Package</label>
                  <select
                    value={arrangeData.work_package_id}
                    onChange={(e) => setArrangeData({ ...arrangeData, work_package_id: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  >
                    {workPackages
                      .filter((wp) => !arrangeData.project_id || wp.project_id === arrangeData.project_id)
                      .map((wp) => (
                        <option key={wp.id} value={wp.id}>
                          {wp.name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Package Count</label>
                  <input
                    type="number"
                    min="1"
                    value={arrangeData.package_count}
                    onChange={(e) => setArrangeData({ ...arrangeData, package_count: parseInt(e.target.value) || 1 })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Driver Name</label>
                  <input
                    type="text"
                    value={arrangeData.driver_name}
                    onChange={(e) => setArrangeData({ ...arrangeData, driver_name: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Driver Contact Number</label>
                  <input
                    type="text"
                    value={arrangeData.driver_phone}
                    onChange={(e) => setArrangeData({ ...arrangeData, driver_phone: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Vehicle Plate Number</label>
                  <input
                    type="text"
                    value={arrangeData.vehicle_plate}
                    onChange={(e) => setArrangeData({ ...arrangeData, vehicle_plate: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Vehicle Type</label>
                  <input
                    type="text"
                    value={arrangeData.vehicle_type}
                    onChange={(e) => setArrangeData({ ...arrangeData, vehicle_type: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Date</label>
                  <input
                    type="date"
                    value={arrangeData.delivery_date}
                    onChange={(e) => setArrangeData({ ...arrangeData, delivery_date: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Delivery Time Slot</label>
                  <input
                    type="text"
                    value={arrangeData.delivery_time}
                    placeholder="e.g. 10:00 AM"
                    onChange={(e) => setArrangeData({ ...arrangeData, delivery_time: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Estimated Arrival at Site</label>
                  <input
                    type="text"
                    value={arrangeData.estimated_arrival_time}
                    placeholder="e.g. 11:15 AM"
                    onChange={(e) => setArrangeData({ ...arrangeData, estimated_arrival_time: e.target.value })}
                    className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Destination Address / Loading Bay</label>
                <textarea
                  rows={2}
                  value={arrangeData.destination_address}
                  onChange={(e) => setArrangeData({ ...arrangeData, destination_address: e.target.value })}
                  className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Special Site / Unloading Instructions</label>
                <textarea
                  rows={2}
                  value={arrangeData.special_instructions}
                  onChange={(e) => setArrangeData({ ...arrangeData, special_instructions: e.target.value })}
                  placeholder="e.g. Loading bay clearance height 3.2m, tail lift required, night work permit."
                  className="w-full text-xs font-medium border border-slate-300 rounded-lg p-2.5 focus:ring-2 focus:ring-amber-500 focus:outline-none"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900 flex items-start space-x-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                <span>
                  <strong>Important:</strong> The system records this delivery arrangement. It does not automatically book transport. The Contractor remains responsible for logistics fulfillment.
                </span>
              </div>

              <div className="pt-3 border-t border-slate-200 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowArrangeModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-md"
                >
                  Save & Schedule Delivery
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
