import React, { useState } from 'react';
import {
  Zap,
  LayoutDashboard,
  CheckSquare,
  Sliders,
  ArrowUpRight,
  Bell,
  FileCheck2,
  Clock,
  History,
  AlertTriangle,
  Layers,
  Award,
  Plus,
} from 'lucide-react';
import { AutomationRulesPanel } from './automation/ServerAutomation';
import { useNW } from '../context/NWContext';
import { AutomationDashboardTab } from './automation/AutomationDashboardTab';
import { MyTasksTab } from './automation/MyTasksTab';
import { WorkflowRulesTab } from './automation/WorkflowRulesTab';
import { EscalationsTab } from './automation/EscalationsTab';
import { NotificationsTab } from './automation/NotificationsTab';
import { ApprovalsTab } from './automation/ApprovalsTab';
import { ScheduledActionsTab } from './automation/ScheduledActionsTab';
import { AutomationHistoryTab } from './automation/AutomationHistoryTab';
import { FailedAutomationsTab } from './automation/FailedAutomationsTab';
import { WorkflowTemplatesTab } from './automation/WorkflowTemplatesTab';
import { OwnerControlCenterTab } from './automation/OwnerControlCenterTab';

export type AutomationSubTab =
  | 'dashboard'
  | 'my-tasks'
  | 'workflow-rules'
  | 'escalations'
  | 'notifications'
  | 'approvals'
  | 'scheduled-actions'
  | 'automation-history'
  | 'failed-automations'
  | 'workflow-templates'
  | 'owner-control';

interface AutomationViewProps {
  initialSubTab?: AutomationSubTab;
}

export const AutomationView: React.FC<AutomationViewProps> = ({
  initialSubTab = 'dashboard',
}) => {
  const {
    tasks,
    automationRules,
    escalations,
    notifications,
    approvals,
    failedAutomations,
    currentUser,
  } = useNW();

  const [activeTab, setActiveTab] = useState<AutomationSubTab>(initialSubTab);

  // Badge calculations
  const todayStr = new Date().toISOString().split('T')[0];
  const pendingTasksCount = tasks.filter((t) => t.status !== 'Completed' && t.due_date <= todayStr).length;
  const activeEscalationsCount = escalations.filter((e) => !e.resolved_at).length;
  const unreadNotifCount = notifications.filter((n) => !n.is_read).length;
  const pendingApprovalsCount = approvals.filter((a) => a.decision === 'Pending').length;
  const unresolvedFailuresCount = failedAutomations.filter((f) => !f.is_resolved).length;
  const criticalCount = tasks.filter((t) => t.priority === 'Critical' && t.status !== 'Completed').length;

  const navItems: {
    id: AutomationSubTab;
    label: string;
    icon: React.ReactNode;
    badge?: number;
    badgeColor?: string;
  }[] = [
    {
      id: 'dashboard',
      label: 'Automation Dashboard',
      icon: <LayoutDashboard className="w-4 h-4" />,
    },
    {
      id: 'my-tasks',
      label: 'My Tasks',
      icon: <CheckSquare className="w-4 h-4" />,
      badge: pendingTasksCount > 0 ? pendingTasksCount : undefined,
      badgeColor: 'bg-blue-600 text-white',
    },
    {
      id: 'workflow-rules',
      label: 'Workflow Rules',
      icon: <Sliders className="w-4 h-4" />,
      badge: automationRules.filter((r) => r.is_active).length,
      badgeColor: 'bg-amber-500 text-slate-950 font-black',
    },
    {
      id: 'escalations',
      label: 'Escalations',
      icon: <ArrowUpRight className="w-4 h-4" />,
      badge: activeEscalationsCount > 0 ? activeEscalationsCount : undefined,
      badgeColor: criticalCount > 0 ? 'bg-rose-600 text-white animate-pulse' : 'bg-purple-600 text-white',
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: <Bell className="w-4 h-4" />,
      badge: unreadNotifCount > 0 ? unreadNotifCount : undefined,
      badgeColor: 'bg-amber-600 text-white',
    },
    {
      id: 'approvals',
      label: 'Approvals',
      icon: <FileCheck2 className="w-4 h-4" />,
      badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
      badgeColor: 'bg-indigo-600 text-white',
    },
    {
      id: 'scheduled-actions',
      label: 'Scheduled Actions',
      icon: <Clock className="w-4 h-4" />,
    },
    {
      id: 'automation-history',
      label: 'Automation History',
      icon: <History className="w-4 h-4" />,
    },
    {
      id: 'failed-automations',
      label: 'Failed Automations',
      icon: <AlertTriangle className="w-4 h-4" />,
      badge: unresolvedFailuresCount > 0 ? unresolvedFailuresCount : undefined,
      badgeColor: 'bg-red-600 text-white',
    },
    {
      id: 'workflow-templates',
      label: 'Workflow Templates',
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: 'owner-control',
      label: 'Owner Control Center',
      icon: <Award className="w-4 h-4" />,
      badge: criticalCount > 0 ? criticalCount : undefined,
      badgeColor: 'bg-rose-600 text-white font-black',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <AutomationRulesPanel />
      {/* Module Title Header */}
      <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 shadow-xl border border-slate-800 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div>
            <div className="flex items-center space-x-2 text-amber-400 font-mono text-xs tracking-wider uppercase mb-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span>NW OS Module 15 • Autonomous Workflow & Exception Engine</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-3">
              <Zap className="w-8 h-8 text-amber-400" />
              Automation, Tasks & Escalation Engine
            </h1>
            <p className="mt-1 text-sm text-slate-300 max-w-3xl leading-relaxed">
              EVENT → RULE → ACTION → RESPONSIBLE PERSON → DEADLINE → REMINDER → ESCALATION → RESOLUTION.
              Automating information flow so humans focus on critical decisions and physical craft.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setActiveTab('my-tasks')}
              className="inline-flex items-center space-x-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2.5 rounded-xl shadow-lg transition-all text-xs cursor-pointer"
            >
              <CheckSquare className="w-4 h-4" />
              <span>My Task Inbox</span>
            </button>
            <button
              onClick={() => setActiveTab('owner-control')}
              className="inline-flex items-center space-x-2 bg-slate-800 hover:bg-slate-700 text-white font-medium px-4 py-2.5 rounded-xl border border-slate-700 transition-all text-xs cursor-pointer"
            >
              <Award className="w-4 h-4 text-amber-400" />
              <span>Owner Exceptions</span>
            </button>
          </div>
        </div>

        {/* Operating Architecture Bar */}
        <div className="mt-6 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-400 font-mono">
          <div className="flex items-center space-x-4">
            <span className="text-emerald-400 font-bold">✓ Idempotency Shield Active</span>
            <span>•</span>
            <span className="text-blue-300">✓ Multi-Channel Dispatch Ready</span>
            <span>•</span>
            <span className="text-purple-300">✓ Tiered Responsibility Matrix</span>
          </div>

          <div className="text-amber-300 font-bold">
            Principle: Never make major decisions without human sign-off
          </div>
        </div>
      </div>

      {/* Subsection Navigation Tabs (Section 1 requirement) */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-1.5 overflow-x-auto">
        <div className="flex items-center space-x-1 min-w-max">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-2 px-3.5 py-2.5 rounded-lg text-xs font-bold transition-all relative cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white shadow-xs'
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
          <AutomationDashboardTab onNavigateTab={(tab) => setActiveTab(tab as AutomationSubTab)} />
        )}

        {activeTab === 'my-tasks' && <MyTasksTab />}

        {activeTab === 'workflow-rules' && <WorkflowRulesTab />}

        {activeTab === 'escalations' && <EscalationsTab />}

        {activeTab === 'notifications' && <NotificationsTab />}

        {activeTab === 'approvals' && <ApprovalsTab />}

        {activeTab === 'scheduled-actions' && <ScheduledActionsTab />}

        {activeTab === 'automation-history' && <AutomationHistoryTab />}

        {activeTab === 'failed-automations' && <FailedAutomationsTab />}

        {activeTab === 'workflow-templates' && <WorkflowTemplatesTab />}

        {activeTab === 'owner-control' && <OwnerControlCenterTab />}
      </div>
    </div>
  );
};
