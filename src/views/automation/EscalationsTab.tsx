import React, { useState } from 'react';
import {
  ArrowUpRight,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
  Clock,
  UserCheck,
  Building2,
  ArrowRight,
  User,
  ShieldCheck,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { EscalationRecord } from '../../types';

export const EscalationsTab: React.FC = () => {
  const { escalations, acknowledgeEscalation, currentUser } = useNW();

  const [activeTab, setActiveTab] = useState<'active' | 'matrix'>('active');

  const activeEscalations = escalations.filter((e) => !e.resolved_at);

  return (
    <div className="space-y-6">
      {/* Top Banner & Toggle */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-purple-100 text-purple-900 rounded-lg">
              <ArrowUpRight className="w-4 h-4 text-purple-700" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Company Escalation Engine & Responsibility Matrix
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Rule 14: System escalates responsibility when matters stall. It does NOT automatically make decisions.
          </p>
        </div>

        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('active')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'active'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Active Escalations ({activeEscalations.length})
          </button>
          <button
            onClick={() => setActiveTab('matrix')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
              activeTab === 'matrix'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Escalation Matrix (Section 13)
          </button>
        </div>
      </div>

      {activeTab === 'active' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {activeEscalations.map((esc) => {
              const isAcknowledged = !!esc.acknowledged_at;
              return (
                <div
                  key={esc.id}
                  className={`p-5 rounded-2xl border space-y-3.5 shadow-xs transition-all relative ${
                    esc.is_critical
                      ? 'bg-rose-50/70 border-rose-300 ring-1 ring-rose-300'
                      : 'bg-white border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-black text-purple-900">
                        {esc.escalation_number}
                      </span>
                      {esc.is_critical && (
                        <span className="px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 text-[10px] font-black animate-pulse">
                          🔴 CRITICAL
                        </span>
                      )}
                    </div>
                    <span className="text-[10px] font-bold text-slate-500">
                      {new Date(esc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-sm font-bold text-slate-900">{esc.title}</h4>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">{esc.reason}</p>
                  </div>

                  <div className="p-3 bg-white/80 rounded-xl border border-slate-200 text-xs space-y-1">
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Escalated From:</span>
                      <span className="font-semibold text-slate-700">{esc.previous_level}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Current Level:</span>
                      <span className="font-black text-purple-900">{esc.current_level}</span>
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-slate-500">Responsible:</span>
                      <span className="font-bold text-slate-900">{esc.assigned_user_name}</span>
                    </div>
                  </div>

                  {/* Acknowledge Button for Critical Matters */}
                  <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">{esc.project_name}</span>
                    {esc.requires_acknowledgement && (
                      <div>
                        {isAcknowledged ? (
                          <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2.5 py-1 rounded-full flex items-center space-x-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            <span>Ack by {esc.acknowledged_by}</span>
                          </span>
                        ) : (
                          <button
                            onClick={() => acknowledgeEscalation(esc.id)}
                            className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-black shadow-xs transition-colors cursor-pointer"
                          >
                            Acknowledge
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'matrix' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Company Department Escalation Matrix (Section 13)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Clear accountability tiers prevent stalled decisions. Critical safety or financial risks skip levels.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Stream 1: Site & Field Carpentry */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-900 uppercase">1. Site & Joinery Trade</h4>
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                  Site Operations
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-700">
                <span className="p-2 bg-white rounded-lg border border-slate-200">Contractor</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">Site Supervisor</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">PM</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-purple-100 text-purple-900 rounded-lg border border-purple-300">Owner</span>
              </div>
              <p className="text-[11px] text-slate-500">
                SLA: Contractor has 2-4 hours. Unanswered questions trigger supervisor dispatch. Technical/commercial
                disputes route to PM then Owner.
              </p>
            </div>

            {/* Stream 2: Production & Factory */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-900 uppercase">2. Workshop & CNC Factory</h4>
                <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                  Manufacturing
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-700">
                <span className="p-2 bg-white rounded-lg border border-slate-200">Craftsman / CNC</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">Production Mgr</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">PM</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-purple-100 text-purple-900 rounded-lg border border-purple-300">Owner</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Assembly hold or toolpath error escalates to Farhan (Factory Mgr) within 2h. Major drawing change escalates
                to PM and Owner signoff.
              </p>
            </div>

            {/* Stream 3: Purchasing & Material Supply */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-900 uppercase">3. Purchasing & Supply</h4>
                <span className="text-[10px] font-bold text-teal-700 bg-teal-100 px-2 py-0.5 rounded">
                  Procurement
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-700">
                <span className="p-2 bg-white rounded-lg border border-slate-200">Requester</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">Purchasing</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">PM / Acct</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-purple-100 text-purple-900 rounded-lg border border-purple-300">Owner</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Purchases under MYR 5,000 approved by PM. Out-of-budget or &gt;MYR 10,000 orders escalate to Owner.
              </p>
            </div>

            {/* Stream 4: Commercial & Client Contracts */}
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-slate-900 uppercase">4. Commercial & Variations</h4>
                <span className="text-[10px] font-bold text-cyan-700 bg-cyan-100 px-2 py-0.5 rounded">
                  Commercial Control
                </span>
              </div>
              <div className="flex items-center space-x-2 text-xs font-bold text-slate-700">
                <span className="p-2 bg-white rounded-lg border border-slate-200">Estimator / PM</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-white rounded-lg border border-slate-200">Accountant</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400" />
                <span className="p-2 bg-purple-100 text-purple-900 rounded-lg border border-purple-300">Owner / CEO</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Variations &gt; MYR 10,000 or overdue IPC claims &gt; 14 days escalate directly to Owner Carson.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
