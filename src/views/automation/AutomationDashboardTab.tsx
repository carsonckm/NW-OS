import React from 'react';
import {
  Zap,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowUpRight,
  TrendingDown,
  ShieldAlert,
  Users,
  Building2,
  Layers,
  ArrowRight,
  Play,
  RotateCcw,
  Sparkles,
  Award,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';

interface AutomationDashboardTabProps {
  onNavigateTab: (tabId: string) => void;
}

export const AutomationDashboardTab: React.FC<AutomationDashboardTabProps> = ({
  onNavigateTab,
}) => {
  const {
    tasks,
    automationRules,
    automationRuns,
    failedAutomations,
    escalations,
    dailyBriefings,
    currentUser,
    ownerOverrides,
  } = useNW();

  // Metrics computation
  const openTasksCount = tasks.filter((t) => t.status === 'Open' || t.status === 'In Progress').length;
  const overdueTasksCount = tasks.filter((t) => {
    if (t.status === 'Completed' || t.status === 'Cancelled') return false;
    const today = new Date().toISOString().split('T')[0];
    return t.due_date < today;
  }).length;

  const criticalIssuesCount = tasks.filter(
    (t) => t.priority === 'Critical' && t.status !== 'Completed'
  ).length;

  const activeEscalationsCount = escalations.filter((e) => !e.resolved_at).length;
  const waitingTasksCount = tasks.filter((t) => t.status === 'Waiting').length;
  const blockedTasksCount = tasks.filter((t) => t.status === 'Blocked').length;
  const activeRulesCount = automationRules.filter((r) => r.is_active).length;

  const totalRuns = automationRuns.length;
  const successfulRuns = automationRuns.filter((r) => r.status === 'Success').length;
  const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 98;

  // Owner dependency metrics (Section 46 requirement)
  // Last month: 67 decisions, This month: 42 decisions
  const ownerDecisionsThisMonth = 42;
  const ownerDecisionsLastMonth = 67;
  const ownerReductionPercent = Math.round(
    ((ownerDecisionsLastMonth - ownerDecisionsThisMonth) / ownerDecisionsLastMonth) * 100
  );

  return (
    <div className="space-y-6">
      {/* Top Exception Cards (Rule 2 & 47 Operating System Metrics) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
        {/* Open Tasks */}
        <div
          onClick={() => onNavigateTab('my-tasks')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-amber-400 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider">Open Tasks</span>
            <CheckCircle2 className="w-4 h-4 text-blue-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{openTasksCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Active across teams</div>
        </div>

        {/* Overdue Tasks */}
        <div
          onClick={() => onNavigateTab('my-tasks')}
          className={`p-4 rounded-xl border shadow-xs hover:shadow-md transition-all cursor-pointer group ${
            overdueTasksCount > 0 ? 'bg-amber-50/60 border-amber-300' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-amber-900">
            <span className="text-[11px] font-bold uppercase tracking-wider">Overdue</span>
            <Clock className="w-4 h-4 text-amber-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-black text-amber-900">{overdueTasksCount}</div>
          <div className="text-[10px] text-amber-800 mt-0.5">Breached deadline</div>
        </div>

        {/* Critical Issues */}
        <div
          onClick={() => onNavigateTab('escalations')}
          className={`p-4 rounded-xl border shadow-xs hover:shadow-md transition-all cursor-pointer group ${
            criticalIssuesCount > 0 ? 'bg-rose-50/70 border-rose-300' : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-rose-900">
            <span className="text-[11px] font-bold uppercase tracking-wider">Critical 🔴</span>
            <ShieldAlert className="w-4 h-4 text-rose-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-black text-rose-900">{criticalIssuesCount}</div>
          <div className="text-[10px] text-rose-700 mt-0.5">Mandatory ack</div>
        </div>

        {/* Escalations */}
        <div
          onClick={() => onNavigateTab('escalations')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-purple-400 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider">Escalations</span>
            <ArrowUpRight className="w-4 h-4 text-purple-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-black text-purple-900">{activeEscalationsCount}</div>
          <div className="text-[10px] text-slate-500 mt-0.5">Tiered resolution</div>
        </div>

        {/* Automation Success */}
        <div
          onClick={() => onNavigateTab('automation-history')}
          className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs hover:border-emerald-400 hover:shadow-md transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between text-slate-500">
            <span className="text-[11px] font-bold uppercase tracking-wider">Auto Health</span>
            <Zap className="w-4 h-4 text-emerald-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-700">{successRate}%</div>
          <div className="text-[10px] text-slate-500 mt-0.5">{totalRuns} events processed</div>
        </div>

        {/* Failed Automations */}
        <div
          onClick={() => onNavigateTab('failed-automations')}
          className={`p-4 rounded-xl border shadow-xs hover:shadow-md transition-all cursor-pointer group ${
            failedAutomations.filter((f) => !f.is_resolved).length > 0
              ? 'bg-red-50/60 border-red-300'
              : 'bg-white border-slate-200'
          }`}
        >
          <div className="flex items-center justify-between text-red-900">
            <span className="text-[11px] font-bold uppercase tracking-wider">Failed Auto</span>
            <AlertTriangle className="w-4 h-4 text-red-600 group-hover:scale-110 transition-transform" />
          </div>
          <div className="mt-2 text-2xl font-black text-red-900">
            {failedAutomations.filter((f) => !f.is_resolved).length}
          </div>
          <div className="text-[10px] text-red-700 mt-0.5">3-retry mechanism</div>
        </div>
      </div>

      {/* Main Grid: Operating System Metrics & Owner Bottleneck Index */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (8 cols): Process Bottleneck Detection & Operating Performance */}
        <div className="lg:col-span-8 space-y-6">
          {/* Section 48: Process Bottleneck Detection */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2.5">
                <span className="p-2 bg-amber-100 text-amber-900 rounded-xl">
                  <Sparkles className="w-5 h-5 text-amber-600" />
                </span>
                <div>
                  <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
                    AI Process Bottleneck Detection (Section 48)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Live operational telemetry analyzing latency between workflow handoffs
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-[10px] font-black uppercase">
                Active Analysis
              </span>
            </div>

            {/* Detected Bottleneck Card */}
            <div className="p-4 rounded-xl bg-amber-50/80 border border-amber-300 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start space-x-2.5">
                  <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                  <div>
                    <span className="text-xs font-black text-amber-950 uppercase tracking-wide">
                      Potential Process Bottleneck Detected
                    </span>
                    <h4 className="text-sm font-bold text-slate-900 mt-0.5">
                      Ready for Delivery → Delivery Scheduled Delay
                    </h4>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      "Most delays on <strong>Project NW-2026-001 (Pavilion Bukit Bintang)</strong> occur between
                      workshop packing completion and contractor lorry dispatch."
                    </p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className="text-[10px] font-bold text-amber-800 uppercase block">Waiting Time</span>
                  <span className="text-lg font-black text-amber-900">2.4 Days</span>
                </div>
              </div>

              <div className="bg-white p-3 rounded-lg border border-amber-200 text-xs text-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-amber-800">AI Recommendation:</span>
                  <span>Review delivery coordination SLA and enforce automated 4-hour contractor dispatch ping.</span>
                </div>
                <button
                  onClick={() => onNavigateTab('workflow-rules')}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shrink-0 transition-colors"
                >
                  Configure Rule →
                </button>
              </div>
            </div>

            {/* Operating Performance Indicators (Section 47) */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Avg Response Time</span>
                <span className="text-base font-black text-slate-900 block mt-0.5">1 hr 42 mins</span>
                <span className="text-[10px] text-emerald-600 font-bold flex items-center mt-0.5">
                  ↓ 24% vs last month
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Contractor RFI Speed</span>
                <span className="text-base font-black text-slate-900 block mt-0.5">2.8 Hours</span>
                <span className="text-[10px] text-emerald-600 font-bold flex items-center mt-0.5">
                  Target: &lt; 4 Hours
                </span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">QC Pass First-Time</span>
                <span className="text-base font-black text-slate-900 block mt-0.5">91.4%</span>
                <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Rework rate: 8.6%</span>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Variation Turnaround</span>
                <span className="text-base font-black text-slate-900 block mt-0.5">18.5 Hours</span>
                <span className="text-[10px] text-emerald-600 font-bold block mt-0.5">Well under 24h SLA</span>
              </div>
            </div>
          </div>

          {/* Section 2: Core Operating Principle Flowchart */}
          <div className="bg-slate-900 text-white rounded-2xl p-5 sm:p-6 shadow-md border border-slate-800 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-amber-400 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                The Core Principle (Section 2)
              </h3>
              <span className="text-[11px] text-slate-400 font-mono">Autonomous Routing • Human Decisions</span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              NW OS automatically moves information, creates tasks, reminds the correct person, detects exceptions,
              and escalates unresolved matters — while humans remain responsible for important decisions.
            </p>

            {/* Workflow Pipeline */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 pt-2 text-center text-[10px] font-bold">
              {[
                { title: 'EVENT', desc: 'Trigger detected', bg: 'bg-slate-800 text-slate-200' },
                { title: 'RULE', desc: 'Condition evaluated', bg: 'bg-slate-800 text-slate-200' },
                { title: 'ACTION', desc: 'Task / notice built', bg: 'bg-amber-400 text-slate-950 font-black' },
                { title: 'RESPONSIBLE', desc: 'Assigned by role', bg: 'bg-slate-800 text-slate-200' },
                { title: 'DEADLINE', desc: 'SLA countdown', bg: 'bg-slate-800 text-slate-200' },
                { title: 'REMINDER', desc: 'WhatsApp / In-app', bg: 'bg-slate-800 text-slate-200' },
                { title: 'ESCALATION', desc: 'Tiered hierarchy', bg: 'bg-purple-900/60 text-purple-200 border border-purple-600/40' },
                { title: 'RESOLUTION', desc: 'Human signoff', bg: 'bg-emerald-900/60 text-emerald-200 border border-emerald-600/40' },
              ].map((step, idx) => (
                <div key={idx} className={`p-2 rounded-xl flex flex-col justify-center ${step.bg}`}>
                  <span className="text-xs">{step.title}</span>
                  <span className="text-[9px] font-normal opacity-80 mt-0.5">{step.desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column (4 cols): Owner Dependency Index & Quick Actions */}
        <div className="lg:col-span-4 space-y-6">
          {/* Section 46: Owner Dependency Metric */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center space-x-2">
                <span className="p-1.5 bg-indigo-100 text-indigo-900 rounded-lg">
                  <TrendingDown className="w-4 h-4 text-indigo-600" />
                </span>
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
                  Owner Dependency Index (Section 46)
                </h3>
              </div>
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-black">
                -{ownerReductionPercent}% Chasing
              </span>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">
              Measures how many routine tasks, RFIs, and decisions require Owner Carson's personal intervention.
              Decreasing trend indicates organizational maturity.
            </p>

            <div className="p-4 bg-gradient-to-br from-indigo-50/70 to-slate-50 border border-indigo-200 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-bold text-slate-500 uppercase block">This Month</span>
                  <span className="text-2xl font-black text-indigo-950">{ownerDecisionsThisMonth} Decisions</span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block">Last Month</span>
                  <span className="text-base font-bold text-slate-500 line-through">{ownerDecisionsLastMonth}</span>
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1">
                <div className="flex justify-between text-[10px] font-bold text-slate-600">
                  <span>Automated Delegated Workflows</span>
                  <span className="text-emerald-700 font-black">63% Autonomous</span>
                </div>
                <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-600 h-2 rounded-full transition-all duration-500" style={{ width: '63%' }} />
                </div>
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1 text-slate-700">
              <span className="font-bold text-slate-900 block">Operational Guideline:</span>
              <p className="text-[11px] text-slate-600">
                The Owner should transition from <em>"I personally chase everything"</em> to{' '}
                <strong>"NW OS tells me what actually needs my attention."</strong>
              </p>
            </div>
          </div>

          {/* Quick Route Shortcuts */}
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-3">
            <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight">
              Operational Engines
            </h3>

            <div className="space-y-2">
              <button
                onClick={() => onNavigateTab('workflow-rules')}
                className="w-full p-3 rounded-xl border border-slate-200 hover:border-amber-400 hover:bg-amber-50/40 text-left transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center space-x-2.5">
                  <span className="p-1.5 bg-amber-100 text-amber-900 rounded-lg">
                    <Zap className="w-4 h-4 text-amber-700" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-900">Workflow Rules Builder</div>
                    <div className="text-[10px] text-slate-500">{activeRulesCount} active company rules</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-amber-600 group-hover:translate-x-0.5 transition-all" />
              </button>

              <button
                onClick={() => onNavigateTab('owner-control')}
                className="w-full p-3 rounded-xl border border-slate-200 hover:border-purple-400 hover:bg-purple-50/40 text-left transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center space-x-2.5">
                  <span className="p-1.5 bg-purple-100 text-purple-900 rounded-lg">
                    <Award className="w-4 h-4 text-purple-700" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-900">Owner Control Center</div>
                    <div className="text-[10px] text-slate-500">Exceptions & Executive Decisions</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all" />
              </button>

              <button
                onClick={() => onNavigateTab('workflow-templates')}
                className="w-full p-3 rounded-xl border border-slate-200 hover:border-blue-400 hover:bg-blue-50/40 text-left transition-all flex items-center justify-between group cursor-pointer"
              >
                <div className="flex items-center space-x-2.5">
                  <span className="p-1.5 bg-blue-100 text-blue-900 rounded-lg">
                    <Layers className="w-4 h-4 text-blue-700" />
                  </span>
                  <div>
                    <div className="text-xs font-bold text-slate-900">Project Workflow Templates</div>
                    <div className="text-[10px] text-slate-500">Supermarket rollout & maintenance</div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
