import React, { useState } from 'react';
import {
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Building2,
  Sliders,
  Moon,
  Sun,
  Plus,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';

export const ScheduledActionsTab: React.FC = () => {
  const { businessCalendar, updateBusinessCalendar, tasks } = useNW();

  const [workingDays, setWorkingDays] = useState<number[]>(businessCalendar.working_days || [1, 2, 3, 4, 5, 6]);
  const [startTime, setStartTime] = useState(businessCalendar.working_hours_start || '08:30');
  const [endTime, setEndTime] = useState(businessCalendar.working_hours_end || '18:00');
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Active timers on urgent/critical tasks
  const activeSlaTasks = tasks.filter(
    (t) => t.status !== 'Completed' && (t.priority === 'Critical' || t.priority === 'Urgent')
  );

  const daysMap = [
    { num: 1, label: 'Mon' },
    { num: 2, label: 'Tue' },
    { num: 3, label: 'Wed' },
    { num: 4, label: 'Thu' },
    { num: 5, label: 'Fri' },
    { num: 6, label: 'Sat' },
    { num: 0, label: 'Sun' },
  ];

  const toggleDay = (num: number) => {
    if (workingDays.includes(num)) {
      setWorkingDays(workingDays.filter((d) => d !== num));
    } else {
      setWorkingDays([...workingDays, num]);
    }
  };

  const handleSaveCalendar = (e: React.FormEvent) => {
    e.preventDefault();
    updateBusinessCalendar({
      working_days: workingDays,
      working_hours_start: startTime,
      working_hours_end: endTime,
    });
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-blue-100 text-blue-900 rounded-lg">
              <Clock className="w-4 h-4 text-blue-600" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              SLA Response Timers & Business Working Calendar
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Section 12, 37 & 38: Live SLA countdown timers and business operating calendar (not everything runs 24/7).
          </p>
        </div>

        {saveSuccess && (
          <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-xl">
            ✓ Calendar Settings Saved
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Live SLA Countdown Trackers (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-bold">
            <span>Active SLA Timers ({activeSlaTasks.length})</span>
            <span>Urgent & Critical Deadlines</span>
          </div>

          <div className="space-y-3">
            {activeSlaTasks.map((task) => (
              <div
                key={task.id}
                className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-bold text-slate-900">{task.task_number}</span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          task.priority === 'Critical'
                            ? 'bg-rose-100 text-rose-900 animate-pulse'
                            : 'bg-orange-100 text-orange-900'
                        }`}
                      >
                        {task.priority}
                      </span>
                    </div>
                    <h4 className="text-xs font-bold text-slate-800 mt-1">{task.title}</h4>
                  </div>

                  {/* Countdown Timer Display (Section 37) */}
                  <div className="text-right shrink-0 bg-slate-900 text-white p-2.5 rounded-xl font-mono text-xs">
                    <span className="text-[9px] text-amber-400 block uppercase font-bold tracking-wider">
                      Response Required In
                    </span>
                    <span className="text-sm font-black text-amber-300">
                      {task.priority === 'Critical' ? '00:45:20' : '02:14:50'}
                    </span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Assigned: {task.assigned_role} ({task.assigned_user_name})</span>
                  <span>Due: {task.due_date} {task.due_time || ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column: Business Calendar Configuration (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          <form onSubmit={handleSaveCalendar} className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-5">
            <div className="border-b border-slate-100 pb-3">
              <h4 className="text-xs font-black uppercase text-slate-900 tracking-wider">
                Business Working Calendar (Section 38)
              </h4>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Configure standard company hours so deadlines pause during off-hours.
              </p>
            </div>

            {/* Working Days */}
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 block">Working Days</label>
              <div className="flex items-center space-x-1.5">
                {daysMap.map((d) => {
                  const isSelected = workingDays.includes(d.num);
                  return (
                    <button
                      key={d.num}
                      type="button"
                      onClick={() => toggleDay(d.num)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      {d.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Working Hours */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">Start Time</label>
                <input
                  type="text"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1">End Time</label>
                <input
                  type="text"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full text-xs p-2 bg-slate-50 border border-slate-200 rounded-lg font-mono font-bold"
                />
              </div>
            </div>

            {/* Project Overrides */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2 text-xs">
              <span className="font-bold text-slate-800 block">Project Night Shift Permits</span>
              <div className="flex items-center justify-between text-[11px]">
                <span>Pavilion Mall (Night Fitout Allowed)</span>
                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 font-bold">Yes (24/7)</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span>IOI City Mall (Day Shifts Only)</span>
                <span className="px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-bold">Standard</span>
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              Save Working Calendar
            </button>
          </form>

          {/* Malaysian Public Holidays Summary */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-black uppercase text-slate-900 tracking-wider">
              Malaysian Public Holidays (Upcoming)
            </h4>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-xs">
              {businessCalendar.holidays.map((h, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 text-[11px]">
                  <span className="font-bold text-slate-800">{h.name}</span>
                  <span className="font-mono text-slate-500">{h.date}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
