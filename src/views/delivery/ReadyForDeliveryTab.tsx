import React, { useState } from 'react';
import {
  PackageCheck,
  Truck,
  AlertTriangle,
  Eye,
  CheckCircle2,
  Calendar,
  Layers,
  MapPin,
  ExternalLink,
  ShieldCheck,
  FileText,
  Clock,
  Plus,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { ProductionOrder, WorkItem } from '../../types';

interface ReadyForDeliveryTabProps {
  onArrangeDelivery: (order: ProductionOrder, workItem?: WorkItem) => void;
  onRaiseIssue: (order: ProductionOrder) => void;
  onViewOrderDetails: (order: ProductionOrder) => void;
}

export const ReadyForDeliveryTab: React.FC<ReadyForDeliveryTabProps> = ({
  onArrangeDelivery,
  onRaiseIssue,
  onViewOrderDetails,
}) => {
  const {
    productionOrders,
    workItems,
    packingPackages,
    factoryQCInspections,
    projects,
  } = useNW();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProjectFilter, setSelectedProjectFilter] = useState<string>('all');

  // Rule 3: Automatically show Work Items that satisfy:
  // - Production completed
  // - Production QC passed
  // - Packing completed
  // Do NOT show if production QC has failed!
  const readyOrders = productionOrders.filter((order) => {
    // Check factory QC:
    const qcs = factoryQCInspections.filter((q) => q.production_order_id === order.id);
    const hasPassedQC = qcs.some((q) => q.result === 'Passed') || order.status === 'Ready for Delivery' || order.status === 'Packing';
    const hasFailedQC = qcs.some((q) => q.result === 'Failed' || q.result === 'Rework Required') && order.status !== 'Ready for Delivery';

    if (hasFailedQC) return false;

    // Check packing status:
    const packages = packingPackages.filter((p) => p.production_order_id === order.id);
    const hasPackages = packages.length > 0 || order.status === 'Ready for Delivery';

    const isReadyStatus = order.status === 'Ready for Delivery' || (order.status === 'Packing' && hasPassedQC && hasPackages);

    if (!isReadyStatus) return false;

    // Search term filter
    if (searchTerm) {
      const matchSearch =
        order.order_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.work_item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.work_package_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        order.project_name.toLowerCase().includes(searchTerm.toLowerCase());
      if (!matchSearch) return false;
    }

    if (selectedProjectFilter !== 'all' && order.project_id !== selectedProjectFilter) {
      return false;
    }

    return true;
  });

  return (
    <div className="space-y-5">
      {/* Header and Filter bar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-emerald-100 text-emerald-800 rounded-lg">
              <PackageCheck className="w-4 h-4" />
            </span>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Ready for Delivery Dispatch Queue
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Work items with verified factory QC passes and completed crate/box packaging ready for lorry dispatch.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search item, order #, project..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-amber-500 w-52"
          />

          <select
            value={selectedProjectFilter}
            onChange={(e) => setSelectedProjectFilter(e.target.value)}
            className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-amber-500"
          >
            <option value="all">All Projects ({readyOrders.length})</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.project_number} — {p.project_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Grid of Ready for Delivery Cards */}
      {readyOrders.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
          <PackageCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <h4 className="text-sm font-bold text-slate-700">No items currently awaiting dispatch</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto mt-1">
            Work items appear here automatically once workshop fabrication is completed, Factory QC inspection has passed, and packing crates are sealed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {readyOrders.map((order) => {
            const workItem = workItems.find((w) => w.id === order.work_item_id || w.item_code === order.work_item_code);
            const packages = packingPackages.filter((p) => p.production_order_id === order.id);
            const packageCount = packages.length > 0 ? packages.length : order.parts_count > 0 ? Math.ceil(order.parts_count / 3) : 1;
            const destination = order.location || workItem?.location || 'Pavilion Square Flagship Site';

            return (
              <div
                key={order.id}
                className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Top tags */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="px-2 py-0.5 text-[10px] font-black tracking-wide uppercase bg-emerald-100 text-emerald-900 rounded-md flex items-center space-x-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      <span>QC Passed & Packed</span>
                    </span>
                    <span className="text-[11px] font-mono font-bold text-slate-500">
                      {order.order_number}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-black text-slate-900 leading-tight">
                        {order.work_item_code} — {order.work_package_name}
                      </h4>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">
                        {order.project_name}
                      </p>
                    </div>
                  </div>

                  {/* Metadata grid */}
                  <div className="grid grid-cols-2 gap-2 mt-4 text-[11px] text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <div>
                      <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                        Quantity
                      </span>
                      <span className="font-bold text-slate-800">
                        {order.quantity} {order.quantity > 1 ? 'Units' : 'Unit'} ({order.parts_count} parts)
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                        Package Count
                      </span>
                      <span className="font-bold text-slate-800 flex items-center space-x-1">
                        <Layers className="w-3 h-3 text-slate-400" />
                        <span>{packageCount} Packages</span>
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                        Drawing Revision
                      </span>
                      <span className="font-bold text-slate-800 truncate block">
                        {order.approved_nw_production_drawing_revision || order.approved_client_drawing_revision || 'Rev 1'}
                      </span>
                    </div>

                    <div>
                      <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                        Required Site Date
                      </span>
                      <span className="font-bold text-amber-900 flex items-center space-x-1">
                        <Calendar className="w-3 h-3 text-amber-600" />
                        <span>{order.required_date}</span>
                      </span>
                    </div>

                    <div className="col-span-2 pt-1 border-t border-slate-200">
                      <span className="text-slate-400 block text-[10px] font-bold uppercase tracking-wider">
                        Destination
                      </span>
                      <span className="font-semibold text-slate-800 flex items-center space-x-1 truncate">
                        <MapPin className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="truncate">{destination}</span>
                      </span>
                    </div>
                  </div>

                  {/* Packaging Details preview */}
                  {packages.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {packages.map((pkg) => (
                        <span
                          key={pkg.id}
                          className="px-2 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-mono rounded border border-slate-200"
                        >
                          {pkg.package_number} ({pkg.weight_kg}kg)
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Card Action Buttons (Section 3: View, Delivery, Issue) */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <button
                    onClick={() => onViewOrderDetails(order)}
                    className="flex items-center space-x-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-colors"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>View</span>
                  </button>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => onRaiseIssue(order)}
                      className="flex items-center space-x-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition-colors border border-rose-200"
                    >
                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                      <span>Issue</span>
                    </button>

                    <button
                      onClick={() => onArrangeDelivery(order, workItem)}
                      className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm"
                    >
                      <Truck className="w-3.5 h-3.5 text-amber-400" />
                      <span>Arrange Delivery</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
