import React, { useState } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';

export const FailedAutomationsTab: React.FC = () => {
  const { failedAutomations, retryFailedAutomation } = useNW();

  const [feedback, setFeedback] = useState<string | null>(null);

  const handleRetry = (failureId: string) => {
    const res = retryFailedAutomation(failureId);
    setFeedback(res.message);
    setTimeout(() => setFeedback(null), 4000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-rose-100 text-rose-900 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Failed Automation Exception Queue (Section 34 & 35)
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Rule 34: Do not silently fail. Every delivery or permission glitch is recorded with a 3-attempt retry pipeline.
          </p>
        </div>

        <div className="flex items-center space-x-2">
          <span className="text-xs font-bold text-rose-900 bg-rose-100 px-3 py-1 rounded-xl">
            {failedAutomations.filter((f) => !f.is_resolved).length} Unresolved Failures
          </span>
        </div>
      </div>

      {feedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{feedback}</span>
          </div>
          <button onClick={() => setFeedback(null)} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
      )}

      {/* Failures Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {failedAutomations.map((fail) => (
          <div
            key={fail.id}
            className={`p-5 rounded-2xl border space-y-3.5 shadow-xs transition-all ${
              fail.is_resolved
                ? 'bg-slate-50 border-slate-200 opacity-70'
                : 'bg-white border-rose-300 ring-1 ring-rose-200'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-black text-slate-900">{fail.run_id}</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-900">
                {fail.failure_category}
              </span>
            </div>

            <div>
              <h4 className="text-xs font-bold text-slate-900">{fail.rule_name}</h4>
              <p className="text-xs text-rose-800 font-mono mt-1 bg-rose-50 p-2.5 rounded-lg border border-rose-200 leading-relaxed">
                {fail.error_reason}
              </p>
            </div>

            <div className="flex items-center justify-between text-[11px] text-slate-500 pt-2 border-t border-slate-100">
              <div className="flex items-center space-x-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Retry Count: {fail.retry_attempts} / 3</span>
              </div>

              {fail.is_resolved ? (
                <span className="text-emerald-700 font-bold flex items-center space-x-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Resolved</span>
                </span>
              ) : (
                <button
                  onClick={() => handleRetry(fail.id)}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold flex items-center space-x-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                  <span>Retry Manually (Attempt {fail.retry_attempts + 1})</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
