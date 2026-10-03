import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Truck,
  AlertTriangle,
  MapPin,
  User,
  Phone,
  Filter,
  CheckCircle2,
  CalendarCheck,
  ChevronRight,
  List,
  Layers,
  ArrowUpDown,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { DeliveryRecord, DeliveryStatus } from '../../types';

interface DeliveryScheduleTabProps {
  onSelectDelivery: (delivery: DeliveryRecord) => void;
  onNewDeliveryClick: () => void;
}

export const DeliveryScheduleTab: React.FC<DeliveryScheduleTabProps> = ({
  onSelectDelivery,
  onNewDeliveryClick,
}) => {
  const {
    deliveryRecords,
    projects,
    contractors,
    resolveDeliveryConflict,
  } = useNW();

  const [viewMode, setViewMode] = useState<'list' | 'timeline'>('list');
  const [filterProject, setFilterProject] = useState('all');
  const [filterContractor, setFilterContractor] = useState('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterDate, setFilterDate] = useState<string>('');
  const [rescheduleModalDelivery, setRescheduleModalDelivery] = useState<DeliveryRecord | null>(null);
  const [newRescheduledTime, setNewRescheduledTime] = useState('11:30 AM');
  const [rescheduleNotes, setRescheduleNotes] = useState('Staggered arrival to clear Loading Bay 2 queue');

  const filteredDeliveries = deliveryRecords.filter((d) => {
    if (filterProject !== 'all' && d.project_id !== filterProject) return false;
    if (filterContractor !== 'all' && d.contractor_id !== filterContractor) return false;
    if (filterStatus !== 'all' && d.status !== filterStatus) return false;
    if (filterDate && d.delivery_date !== filterDate) return false;
    return true;
  });

  // Sort by delivery date & time ascending
  const sortedDeliveries = [...filteredDeliveries].sort((a, b) => {
    return `${a.delivery_date} ${a.delivery_time}`.localeCompare(`${b.delivery_date} ${b.delivery_time}`);
  });

  const getStatusBadge = (status: DeliveryStatus) => {
    switch (status) {
      case 'Scheduled':
        return 'bg-blue-100 text-blue-900 border-blue-200';
      case 'Loading':
        return 'bg-amber-100 text-amber-900 border-amber-200';
      case 'In Transit':
        return 'bg-indigo-100 text-indigo-900 border-indigo-200';
      case 'Arrived at Site':
        return 'bg-teal-100 text-teal-900 border-teal-200';
      case 'Delivered':
      case 'Received / Confirmed':
        return 'bg-emerald-100 text-emerald-900 border-emerald-200';
      case 'Delivery Issue':
        return 'bg-rose-100 text-rose-900 border-rose-200';
      case 'Rescheduled':
        return 'bg-purple-100 text-purple-900 border-purple-200';
      case 'Cancelled':
        return 'bg-slate-100 text-slate-700 border-slate-200';
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  const handleConfirmReschedule = () => {
    if (!rescheduleModalDelivery) return;
    resolveDeliveryConflict(rescheduleModalDelivery.id, newRescheduledTime, rescheduleNotes);
    setRescheduleModalDelivery(null);
  };

  return (
    <div className="space-y-5">
      {/* Header and Filter Toolbar */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center space-x-2">
              <CalendarCheck className="w-5 h-5 text-amber-600" />
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Lorry Delivery Logistics Schedule
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Notice: The Contractor remains responsible for arranging delivery. The system records transport arrangements and enforces loading bay conflict detection.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-xs">
              <button
                onClick={() => setViewMode('list')}
                className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                  viewMode === 'list'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center space-x-1">
                  <List className="w-3.5 h-3.5" />
                  <span>List View</span>
                </span>
              </button>
              <button
                onClick={() => setViewMode('timeline')}
                className={`px-3 py-1.5 rounded-md font-bold transition-all ${
                  viewMode === 'timeline'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center space-x-1">
                  <Clock className="w-3.5 h-3.5" />
                  <span>Timeline</span>
                </span>
              </button>
            </div>

            <button
              onClick={onNewDeliveryClick}
              className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center space-x-1.5"
            >
              <Truck className="w-4 h-4 text-amber-400" />
              <span>Record Delivery</span>
            </button>
          </div>
        </div>

        {/* Multi-Criteria Filter Bar */}
        <div className="pt-3 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Project
            </label>
            <select
              value={filterProject}
              onChange={(e) => setFilterProject(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} — {p.project_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Contractor
            </label>
            <select
              value={filterContractor}
              onChange={(e) => setFilterContractor(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">All Contractors</option>
              {contractors.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
              <option value="all">All Statuses</option>
              <option value="Scheduled">Scheduled</option>
              <option value="Loading">Loading</option>
              <option value="In Transit">In Transit</option>
              <option value="Arrived at Site">Arrived at Site</option>
              <option value="Delivered">Delivered</option>
              <option value="Delivery Issue">Delivery Issue</option>
              <option value="Rescheduled">Rescheduled</option>
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase text-slate-400 mb-1">
              Date Filter
            </label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-700 font-semibold focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>
        </div>
      </div>

      {/* Main Delivery Schedule List */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 bg-slate-50/70 border-b border-slate-200 flex items-center justify-between text-xs font-bold text-slate-600">
          <span>Scheduled Lorry Deliveries ({sortedDeliveries.length})</span>
          <span className="text-[11px] text-slate-400">Time-sorted order</span>
        </div>

        {sortedDeliveries.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs font-medium">
            No deliveries match your active filter criteria.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {sortedDeliveries.map((del) => {
              const hasConflict = !!del.schedule_conflict;
              return (
                <div
                  key={del.id}
                  className={`p-4 sm:p-5 hover:bg-slate-50/80 transition-colors ${
                    hasConflict ? 'bg-amber-50/30' : ''
                  }`}
                >
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Timing & Project */}
                    <div className="flex items-start space-x-4 min-w-[280px]">
                      <div className="p-3 bg-slate-100 rounded-xl text-center shrink-0 border border-slate-200">
                        <span className="block text-[10px] uppercase font-black text-slate-500">
                          {new Date(del.delivery_date).toLocaleDateString('en-US', { weekday: 'short' })}
                        </span>
                        <span className="block text-base font-black text-slate-900 leading-tight">
                          {new Date(del.delivery_date).getDate()}
                        </span>
                        <span className="block text-[10px] font-bold text-slate-500">
                          {new Date(del.delivery_date).toLocaleDateString('en-US', { month: 'short' })}
                        </span>
                      </div>

                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-mono font-black text-slate-900">
                            {del.delivery_number}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${getStatusBadge(del.status)}`}>
                            {del.status}
                          </span>
                          {hasConflict && (
                            <span className="px-2 py-0.5 text-[10px] font-black bg-amber-200 text-amber-900 rounded-md flex items-center space-x-1 animate-pulse">
                              <AlertTriangle className="w-3 h-3" />
                              <span>⚠️ CONFLICT</span>
                            </span>
                          )}
                        </div>

                        <h4 className="text-sm font-black text-slate-900 mt-1">
                          {del.project_name}
                        </h4>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
                          <span className="flex items-center space-x-1 font-bold text-slate-700">
                            <Clock className="w-3.5 h-3.5 text-amber-600" />
                            <span>{del.delivery_time}</span>
                            <span className="text-slate-400 font-normal">(ETA {del.estimated_arrival})</span>
                          </span>
                          <span>•</span>
                          <span className="flex items-center space-x-1">
                            <MapPin className="w-3.5 h-3.5 text-slate-400" />
                            <span className="truncate max-w-[220px]">{del.destination_site}</span>
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Middle: Work Items, Packages, Vehicle */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-3 rounded-lg border border-slate-100 flex-1 max-w-2xl">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Work Items
                        </span>
                        <span className="font-bold text-slate-800">
                          {del.work_item_codes?.join(', ') || 'CAR-001'}
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Packages
                        </span>
                        <span className="font-bold text-slate-800 flex items-center space-x-1">
                          <Layers className="w-3 h-3 text-slate-400" />
                          <span>{del.package_count} Packages</span>
                        </span>
                      </div>

                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">
                          Vehicle & Driver
                        </span>
                        <div className="font-semibold text-slate-800 truncate">
                          <span className="font-bold">{del.vehicle_plate}</span> ({del.driver_name})
                        </div>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center space-x-2 shrink-0">
                      {hasConflict && (
                        <button
                          onClick={() => setRescheduleModalDelivery(del)}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-lg shadow-sm transition-colors"
                        >
                          Reschedule
                        </button>
                      )}

                      <button
                        onClick={() => onSelectDelivery(del)}
                        className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-sm flex items-center space-x-1"
                      >
                        <span>Inspect</span>
                        <ChevronRight className="w-3.5 h-3.5 text-amber-400" />
                      </button>
                    </div>
                  </div>

                  {/* Conflict Notice Inline banner */}
                  {hasConflict && (
                    <div className="mt-3 p-3 bg-amber-100/70 border border-amber-300 rounded-lg text-xs text-amber-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <div className="flex items-center space-x-2">
                        <AlertTriangle className="w-4 h-4 text-amber-800 shrink-0" />
                        <div>
                          <span className="font-black">Schedule Conflict:</span>{' '}
                          {del.schedule_conflict?.conflict_reason} with delivery{' '}
                          <span className="font-mono font-bold">
                            {del.schedule_conflict?.conflict_with_delivery_number}
                          </span>
                          .
                        </div>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          onClick={() => setRescheduleModalDelivery(del)}
                          className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-bold rounded shadow-2xs"
                        >
                          Change Slot
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reschedule Modal */}
      {rescheduleModalDelivery && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-200 animate-in fade-in zoom-in-95">
            <div className="flex items-center space-x-2 text-amber-700 mb-2">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="text-base font-black text-slate-900">
                Resolve Schedule Conflict
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-4">
              Reassign delivery arrival window for{' '}
              <span className="font-mono font-bold text-slate-800">
                {rescheduleModalDelivery.delivery_number}
              </span>{' '}
              to avoid simultaneous Loading Bay congestion.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  New Delivery Time Slot
                </label>
                <select
                  value={newRescheduledTime}
                  onChange={(e) => setNewRescheduledTime(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-800"
                >
                  <option value="11:30 AM">11:30 AM (Post-Peak Clearance)</option>
                  <option value="02:00 PM">02:00 PM (Afternoon Mall Bay Window)</option>
                  <option value="04:30 PM">04:30 PM (Late Afternoon Slot)</option>
                  <option value="08:00 PM">08:00 PM (Night Hoist Access)</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Coordination Note to Contractor & Driver
                </label>
                <textarea
                  rows={2}
                  value={rescheduleNotes}
                  onChange={(e) => setRescheduleNotes(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-lg text-xs"
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end space-x-2 pt-3 border-t border-slate-100">
              <button
                onClick={() => setRescheduleModalDelivery(null)}
                className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmReschedule}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-lg text-xs font-bold shadow-sm"
              >
                Confirm Reschedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
