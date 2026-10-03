/**
 * NW OS Architectural Framework & Live Audit Log View
 * Demonstrates the structural evolution, modular database schema, and live immutable event stream.
 */

import React from 'react';
import { useNW } from '../context/NWContext';
import {
  ShieldCheck,
  Cpu,
  Database,
  ArrowRight,
  GitBranch,
  Layers,
  Sparkles,
  CheckCircle2,
  Clock,
} from 'lucide-react';

export const AuditArchitectureView: React.FC = () => {
  const { auditLogs, notifications } = useNW();

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-bold uppercase tracking-widest">
              Core Architecture
            </span>
            <span className="text-xs text-slate-400">Single Central Database</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            System Operating Model & Audit Trail
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Structural shift from bottleneck communication to autonomous, exception-governed execution.
          </p>
        </div>
      </div>

      {/* Operational Shift Diagram */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-6">
        <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
          <GitBranch className="w-4 h-4 text-amber-400" />
          <span>Operational Model Paradigm Shift</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Legacy Model */}
          <div className="p-4 rounded-xl bg-red-950/20 border border-red-900/40 space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">
              Legacy Model (Owner Bottleneck)
            </span>
            <div className="p-3 bg-slate-950 rounded-lg text-xs font-mono text-slate-400 space-y-2">
              <div className="text-red-400">Client → Owner → Contractor</div>
              <div className="text-red-400">Contractor → Owner → Site</div>
              <div className="text-red-400">Site → Owner → Client</div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              Owner constantly coordinates micromanagement details, WhatsApp messages, dimensions, and routine delivery timings. Results in 14-hour owner workdays and lost information.
            </p>
          </div>

          {/* NW OS Model */}
          <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-900/40 space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
              NW OS Operating System (Manage By Exception)
            </span>
            <div className="p-3 bg-slate-950 rounded-lg text-xs font-mono text-emerald-400 space-y-1">
              <div>Client / Site / Contractor ➔ <strong>NW OS Central Brain</strong></div>
              <div>NW OS ➔ Auto-dispatches to PM & Site Supervisor</div>
              <div className="text-amber-400 font-bold">➔ Owner only alerted when Exception Thresholds are breached</div>
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">
              System moves information automatically. Routine work flows freely; only financial risks, scope variations, and critical discrepancies require human Owner sign-off.
            </p>
          </div>
        </div>
      </div>

      {/* Modular Architecture & Future Module Readiness */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
          <Database className="w-4 h-4 text-sky-400" />
          <span>Single Central Database Modular Blueprint</span>
        </h3>
        <p className="text-xs text-slate-400">
          The central schema stores items, drawings, issues, and variations with decoupled foreign keys so future modules plug in seamlessly without database redesign:
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="p-3 rounded-xl bg-slate-950 border border-emerald-500/40">
            <span className="font-bold text-emerald-400">Phase 1 (Live)</span>
            <ul className="text-slate-300 mt-1 space-y-0.5 text-[11px]">
              <li>✓ Projects & WorkPackages</li>
              <li>✓ WorkItems & QC Gate</li>
              <li>✓ Deliveries & Site Installs</li>
              <li>✓ Immutable Drawings</li>
              <li>✓ Issues & VO Register</li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="font-bold text-slate-300">Phase 2: Commercial</span>
            <ul className="text-slate-400 mt-1 space-y-0.5 text-[11px]">
              <li>• Tender & BQ Importer</li>
              <li>• Auto-Costing Engine</li>
              <li>• Client Progress Claims</li>
              <li>• Official Tax Invoices</li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="font-bold text-slate-300">Phase 3: Smart Factory</span>
            <ul className="text-slate-400 mt-1 space-y-0.5 text-[11px]">
              <li>• CNC Nesting Output</li>
              <li>• QR / Barcode Tracking</li>
              <li>• Raw Material Purchasing</li>
              <li>• Scrap & Offcut Recovery</li>
            </ul>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <span className="font-bold text-slate-300">Phase 4: Integrations</span>
            <ul className="text-slate-400 mt-1 space-y-0.5 text-[11px]">
              <li>• WhatsApp Cloud Webhook</li>
              <li>• AutoCAD DWG / DXF Parser</li>
              <li>• Site 3D LiDAR Scanner</li>
              <li>• Biometric Site Access</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Live Immutable Audit Log */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-amber-400" />
            <span>Immutable Event Stream ({auditLogs.length} Records)</span>
          </h3>
          <span className="text-[10px] text-slate-400">Cryptographically Ordered</span>
        </div>

        <div className="space-y-2">
          {auditLogs.map((log) => (
            <div
              key={log.id}
              className="p-3 rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2"
            >
              <div className="flex items-center space-x-2.5">
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-slate-800 text-amber-400 border border-slate-700">
                  {log.action}
                </span>
                <span className="text-slate-200">
                  {log.details || log.new_value || `${log.object_type} ${log.object_id}`}
                </span>
              </div>

              <div className="flex items-center space-x-3 text-[11px] text-slate-500 shrink-0">
                <span>By: <strong className="text-slate-400">{log.user_name}</strong> ({log.user_role || log.role || 'User'})</span>
                <span className="font-mono">{new Date(log.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
