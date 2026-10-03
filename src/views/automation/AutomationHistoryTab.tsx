import React, { useState } from 'react';
import {
  History,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Zap,
  Filter,
  ShieldCheck,
  Building2,
  Key,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';

export const AutomationHistoryTab: React.FC = () => {
  const { automationRuns, automationEvents } = useNW();

  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filteredRuns = automationRuns.filter((r) => {
    if (statusFilter !== 'all' && r.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-emerald-100 text-emerald-900 rounded-lg">
              <History className="w-4 h-4 text-emerald-600" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Automation Execution History & Idempotency Audit
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Section 33 & 36: Full cryptographic audit trail of triggered events, rule matching, and duplicate protection.
          </p>
        </div>

        <div className="flex items-center space-x-2 text-xs">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-slate-700"
          >
            <option value="all">All Statuses</option>
            <option value="Success">Success</option>
            <option value="Failed">Failed</option>
          </select>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                <th className="py-3 px-4">Run ID & Timestamp</th>
                <th className="py-3 px-4">Rule Name</th>
                <th className="py-3 px-4">Trigger Event</th>
                <th className="py-3 px-4">Idempotency Key (Rule 36)</th>
                <th className="py-3 px-4">Result / Action</th>
                <th className="py-3 px-4 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredRuns.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-slate-400">
                    No automation runs recorded.
                  </td>
                </tr>
              ) : (
                filteredRuns.map((run) => (
                  <tr key={run.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-slate-900">{run.id}</div>
                      <div className="text-[10px] text-slate-400">
                        {new Date(run.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-bold text-slate-800">{run.rule_name}</td>

                    <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600">
                      {run.event_type}
                    </td>

                    <td className="py-3.5 px-4">
                      <div className="font-mono text-[10px] text-slate-500 bg-slate-100 px-2 py-0.5 rounded flex items-center space-x-1 max-w-[200px] truncate">
                        <Key className="w-3 h-3 shrink-0 text-slate-400" />
                        <span className="truncate">{run.idempotency_key}</span>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-slate-700">
                      <div>{run.result_description}</div>
                      {run.error && (
                        <div className="text-[10px] text-rose-600 font-mono mt-0.5">{run.error}</div>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <span
                        className={`inline-flex items-center space-x-1 px-2.5 py-0.5 rounded-full text-[10px] font-black ${
                          run.status === 'Success'
                            ? 'bg-emerald-100 text-emerald-900'
                            : 'bg-rose-100 text-rose-900'
                        }`}
                      >
                        {run.status === 'Success' ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                        <span>{run.status}</span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
