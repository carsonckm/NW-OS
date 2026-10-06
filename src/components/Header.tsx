/**
 * NW OS Header & Top Navigation Bar
 * Features role switching, language toggle, active project picker, notifications drawer, and PWA indicator.
 */

import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { useServerNotifications, type ServerNotification } from '../services/notifications';
import { navigateTo } from '../services/navigation';
import { openNotification } from '../views/notifications/NotificationCenter';
import { UserRole } from '../types';
import { hasPermission } from '../utils/permissions';
import {
  ShieldAlert,
  Bell,
  CheckCircle2,
  ChevronDown,
  Sparkles,
  RefreshCw,
  SlidersHorizontal,
  Building2,
  UserCheck,
  Languages,
  X,
  ArrowRight,
  Wifi,
  ClipboardCheck,
  Users,
  LogOut,
} from 'lucide-react';

interface HeaderProps {
  onOpenAssistant: () => void;
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenAssistant, activeTab, setActiveTab }) => {
  const {
    currentUser,
    authMode,
    signOut,
    switchRole,
    switchUser,
    availableUsers,
    language,
    setLanguage,
    projects,
    userProjects,
    selectedProjectId,
    setSelectedProjectId,
    notifications,
    approvals,
    pmInbox,
    aiActionRequests,
    costLeakAlerts,
    productionOrders,
    deliveryRecords,
    installationJobs,
    siteQCInspections,
    tasks,
    escalations,
    markNotificationRead,
    clearAllNotifications,
    resetToDemoData,
    coreDataSync,
  } = useNW();

  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showLangDropdown, setShowLangDropdown] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Signed in: the server's notifications for this user. Demo mode: browser alerts by role.
  const server = useServerNotifications();
  const userNotifications = server.enabled
    ? server.items.map((n) => ({ ...n, link_type: undefined as string | undefined }))
    : notifications.filter((n) => n.target_role === 'ALL' || n.target_role === currentUser.role);
  const unreadCount = userNotifications.filter((n) => !n.is_read).length;

  const pendingApprovalsCount = approvals.filter((a) => a.decision === 'Pending').length;

  const roleColors: Record<UserRole, { badge: string; border: string }> = {
    'Owner / CEO': { badge: 'bg-amber-50 text-amber-800 border-amber-300', border: 'border-amber-400' },
    'Admin': { badge: 'bg-blue-50 text-blue-800 border-blue-300', border: 'border-blue-400' },
    'Project Manager': { badge: 'bg-indigo-50 text-indigo-800 border-indigo-300', border: 'border-indigo-400' },
    'Site Supervisor': { badge: 'bg-emerald-50 text-emerald-800 border-emerald-300', border: 'border-emerald-400' },
    'Purchasing': { badge: 'bg-teal-50 text-teal-800 border-teal-300', border: 'border-teal-400' },
    'Accountant': { badge: 'bg-cyan-50 text-cyan-800 border-cyan-300', border: 'border-cyan-400' },
    'Production Manager': { badge: 'bg-rose-50 text-rose-800 border-rose-300', border: 'border-rose-400' },
    'Production Staff': { badge: 'bg-stone-100 text-stone-800 border-stone-300', border: 'border-stone-400' },
    'Contractor': { badge: 'bg-orange-50 text-orange-800 border-orange-300', border: 'border-orange-400' },
    'Client': { badge: 'bg-purple-50 text-purple-800 border-purple-300', border: 'border-purple-400' },
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200 text-slate-900 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo and Brand */}
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setActiveTab('dashboard')}
              className="flex items-center space-x-2.5 text-left focus:outline-none group"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center font-black tracking-wider text-slate-950 shadow-xs group-hover:scale-105 transition-transform">
                NW
              </div>
              <div>
                <div className="flex items-center space-x-1.5">
                  <span className="font-black text-lg text-slate-900 tracking-tight">NW OS</span>
                  <span className="text-[10px] uppercase font-bold tracking-widest px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300">
                    Phase 1
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 hidden sm:block">Company Operating System</p>
              </div>
            </button>

            {/* Project Quick Selector (Hidden for Contractor and Client who have designated project) */}
            {currentUser.role !== 'Contractor' && currentUser.role !== 'Client' && (
              <div className="hidden md:flex items-center pl-4 border-l border-slate-200">
                <Building2 className="w-4 h-4 text-slate-500 mr-2" />
                <select
                  aria-label="Active Project"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="bg-slate-50 hover:bg-slate-100 text-xs text-slate-800 rounded-lg border border-slate-300 px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 max-w-[200px] truncate font-medium transition-colors"
                >
                  {userProjects.map((proj) => (
                    <option key={proj.id} value={proj.id}>
                      {proj.project_name.split('—')[0]} ({proj.project_number})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            {/* AI Assistant Button */}
            <button
              onClick={onOpenAssistant}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 text-xs font-semibold transition-colors shadow-2xs"
              title="Open NW OS Intelligence Copilot"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-600 animate-pulse" />
              <span className="hidden sm:inline">NW AI</span>
            </button>

            {/* Language Selector */}
            <div className="relative">
              <button
                onClick={() => setShowLangDropdown(!showLangDropdown)}
                className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-xs text-slate-700 border border-slate-200 font-medium transition-colors"
                title="Switch Interface Language"
              >
                <Languages className="w-3.5 h-3.5 text-slate-500" />
                <span className="font-semibold">{language.toUpperCase()}</span>
              </button>

              {showLangDropdown && (
                <div className="absolute right-0 mt-2 w-36 bg-white border border-slate-200 rounded-xl shadow-xl py-1 z-50">
                  <button
                    onClick={() => {
                      setLanguage('en');
                      setShowLangDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between ${
                      language === 'en' ? 'text-amber-700 font-bold bg-amber-50/50' : 'text-slate-700'
                    }`}
                  >
                    <span>English</span>
                    {language === 'en' && <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />}
                  </button>
                  <button
                    onClick={() => {
                      setLanguage('ms');
                      setShowLangDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between ${
                      language === 'ms' ? 'text-amber-700 font-bold bg-amber-50/50' : 'text-slate-700'
                    }`}
                  >
                    <span>B. Malaysia</span>
                    {language === 'ms' && <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />}
                  </button>
                  <button
                    onClick={() => {
                      setLanguage('zh');
                      setShowLangDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-slate-50 flex items-center justify-between ${
                      language === 'zh' ? 'text-amber-700 font-bold bg-amber-50/50' : 'text-slate-700'
                    }`}
                  >
                    <span>中文 (Chinese)</span>
                    {language === 'zh' && <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />}
                  </button>
                </div>
              )}
            </div>

            {/* Notifications */}
            <div className="relative">
              <button
                onClick={() => setShowNotifDropdown(!showNotifDropdown)}
                className="relative p-2 rounded-lg bg-slate-100 hover:bg-slate-200/80 text-slate-700 border border-slate-200 transition-colors"
                title="Notifications & Exceptions"
              >
                <Bell className="w-4 h-4 text-slate-600" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-red-600 text-white text-[10px] font-extrabold w-4 h-4 rounded-full flex items-center justify-center shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>

              {showNotifDropdown && (
                <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-2xl py-2 z-50">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                    <div className="flex items-center space-x-2">
                      <span className="font-bold text-xs text-slate-900">Alerts & Exceptions</span>
                      {unreadCount > 0 && (
                        <span className="bg-red-50 text-red-700 text-[10px] font-bold px-1.5 py-0.5 rounded border border-red-200">
                          {unreadCount} new
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => (server.enabled ? void server.markAllRead() : clearAllNotifications())}
                      className="text-[11px] text-slate-500 hover:text-amber-600 font-medium"
                    >
                      Mark all read
                    </button>
                    {server.enabled && (
                      <button
                        onClick={() => {
                          setShowNotifDropdown(false);
                          navigateTo('notifications');
                        }}
                        className="text-[11px] text-amber-700 hover:text-amber-800 font-bold"
                      >
                        Open all
                      </button>
                    )}
                  </div>

                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-100">
                    {userNotifications.length === 0 ? (
                      <p className="text-center py-6 text-xs text-slate-400">No active alerts for your role.</p>
                    ) : (
                      userNotifications.slice(0, server.enabled ? 20 : 6).map((notif) => (
                        <div
                          key={notif.id}
                          onClick={() => {
                            if (server.enabled) {
                              void server.markRead(notif.id);
                              openNotification(notif as unknown as ServerNotification);
                            } else {
                              markNotificationRead(notif.id);
                              if (notif.link_type === 'issue') setActiveTab('issues');
                              if (notif.link_type === 'work_item') setActiveTab('work-items');
                            }
                            setShowNotifDropdown(false);
                          }}
                          className={`px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                            !notif.is_read ? 'bg-amber-50/40' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <span className="text-xs font-semibold text-slate-900 line-clamp-1">
                              {notif.title}
                            </span>
                            {notif.priority === 'urgent' && (
                              <span className="text-[9px] bg-red-100 text-red-700 font-bold px-1.5 py-0.2 rounded border border-red-200 ml-2 shrink-0">
                                URGENT
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-600 mt-1 line-clamp-2">{notif.message}</p>
                          <span className="text-[10px] text-slate-400 mt-1 block">
                            {new Date(notif.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ROLE SWITCHER DROPDOWN (Core for evaluation & multi-role operations) */}
            <div className="relative">
              <button
                onClick={() => setShowRoleDropdown(!showRoleDropdown)}
                className={`flex items-center space-x-2 pl-2 pr-2.5 py-1.5 rounded-lg border bg-slate-100 hover:bg-slate-200/80 transition-all ${
                  roleColors[currentUser.role]?.border || 'border-slate-300'
                }`}
              >
                {currentUser.avatar ? (
                  <img
                    src={currentUser.avatar}
                    alt={currentUser.name}
                    className="w-7 h-7 rounded-full object-cover border border-slate-300 shadow-2xs"
                  />
                ) : (
                  <span className="w-7 h-7 rounded-full bg-slate-800 text-amber-400 text-[11px] font-black flex items-center justify-center border border-slate-300 shadow-2xs">
                    {currentUser.name
                      .split(/\s+/)
                      .map((w) => w[0])
                      .join('')
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                )}
                <div className="text-left hidden sm:block">
                  <div className="text-xs font-bold text-slate-900 flex items-center space-x-1">
                    <span className="max-w-[110px] truncate">{currentUser.name}</span>
                  </div>
                  <div className="text-[10px] text-amber-700 font-semibold">
                    {currentUser.role}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
              </button>

              {showRoleDropdown && authMode && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl py-2 z-50">
                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Signed in as</div>
                    <div className="text-xs font-bold text-slate-900 mt-1 truncate">{currentUser.name}</div>
                    <div className="text-[11px] text-slate-500 truncate">{currentUser.email}</div>
                    <span
                      className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.2 rounded border ${
                        roleColors[currentUser.role]?.badge || 'text-slate-600'
                      }`}
                    >
                      {currentUser.role}
                    </span>
                  </div>
                  <div className="pt-1.5 px-3">
                    <button
                      onClick={() => {
                        setShowRoleDropdown(false);
                        signOut();
                      }}
                      className="w-full flex items-center justify-center space-x-1.5 py-1.5 text-xs text-slate-600 hover:text-red-600 font-bold transition-colors"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Sign out</span>
                    </button>
                  </div>
                </div>
              )}

              {showRoleDropdown && !authMode && (
                <div className="absolute right-0 mt-2 w-72 bg-white border border-slate-200 rounded-2xl shadow-2xl py-2 z-50">
                  <div className="px-3.5 py-2 border-b border-slate-100">
                    <div className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Switch Role (RBAC Simulation)
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Experience NW OS from each stakeholder’s perspective
                    </p>
                  </div>

                  <div className="py-1 max-h-80 overflow-y-auto">
                    {availableUsers.map((usr) => (
                      <button
                        key={usr.id}
                        onClick={() => {
                          switchUser(usr.id);
                          setShowRoleDropdown(false);
                        }}
                        className={`w-full text-left px-3 py-2 flex items-center space-x-3 hover:bg-slate-50 transition-colors ${
                          currentUser.id === usr.id ? 'bg-amber-50/60' : ''
                        }`}
                      >
                        <img
                          src={usr.avatar}
                          alt={usr.name}
                          className="w-8 h-8 rounded-full object-cover border border-slate-200 shadow-2xs"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 truncate">{usr.name}</span>
                            {currentUser.id === usr.id && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-amber-600 ml-1 shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center space-x-1.5 mt-0.5">
                            <span
                              className={`inline-block text-[10px] font-semibold px-1.5 py-0.2 rounded border ${
                                roleColors[usr.role]?.badge || 'text-slate-600'
                              }`}
                            >
                              {usr.role}
                            </span>
                            {usr.title && (
                              <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                                • {usr.title.split(',')[0]}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  <div className="border-t border-slate-100 pt-1.5 px-3">
                    <button
                      onClick={() => {
                        setShowResetConfirm(true);
                        setShowRoleDropdown(false);
                      }}
                      className="w-full flex items-center justify-center space-x-1.5 py-1.5 text-xs text-slate-500 hover:text-red-600 font-medium transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Reset to Demo Data</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Primary Navigation Tabs (Permission-Aware) */}
      <div className="bg-slate-100/90 border-t border-slate-200 px-4 sm:px-6 lg:px-8 overflow-x-auto scrollbar-none">
        <div className="max-w-7xl mx-auto flex space-x-1 py-2">
          {[
            {
              id: 'dashboard',
              label: currentUser.role === 'Owner / CEO' ? 'Owner Dashboard' : `${currentUser.role} Dashboard`,
              show: true,
            },
            {
              id: 'ai-assistant',
              label: 'AI Assistant',
              show: coreDataSync.mode !== 'database' || hasPermission(currentUser, 'ai.assistant'),
              badge: pmInbox.filter((i) => i.status === 'pending').length > 0,
              badgeCount: pmInbox.filter((i) => i.status === 'pending').length,
            },
            {
              id: 'whatsapp-gateway',
              label: 'WhatsApp Gateway',
              show: true,
              badge: aiActionRequests?.filter((r) => r.status === 'pending').length > 0,
              badgeCount: aiActionRequests?.filter((r) => r.status === 'pending').length,
            },
            {
              id: 'approvals',
              label: 'Approvals & Governance',
              show: hasPermission(currentUser, 'approvals.view'),
              badge: pendingApprovalsCount > 0,
              badgeCount: pendingApprovalsCount,
            },
            {
              id: 'commercial',
              label: 'Commercial',
              show: hasPermission(currentUser, 'commercial.view') || hasPermission(currentUser, 'finance.view'),
              badge: (costLeakAlerts?.filter((l) => l.status !== 'Resolved').length || 0) > 0,
              badgeCount: costLeakAlerts?.filter((l) => l.status !== 'Resolved').length,
            },
            {
              id: 'projects',
              label: 'Projects',
              show: hasPermission(currentUser, 'projects.view'),
            },
            {
              id: 'production',
              label: 'Production',
              show: hasPermission(currentUser, 'production.view'),
              badge: (productionOrders?.filter((o) => o.status === 'Blocked' || o.revision_alert).length || 0) > 0,
              badgeCount: productionOrders?.filter((o) => o.status === 'Blocked' || o.revision_alert).length,
            },
            {
              id: 'delivery',
              label: 'Delivery & Site',
              show: hasPermission(currentUser, 'delivery.view') || hasPermission(currentUser, 'work_items.view'),
              badge: (deliveryRecords?.filter((d) => d.status === 'Delivery Issue' || d.status === 'In Transit').length || 0) > 0,
              badgeCount: deliveryRecords?.filter((d) => d.status === 'Delivery Issue' || d.status === 'In Transit').length,
            },
            {
              id: 'automation',
              label: 'Automation',
              show: hasPermission(currentUser, 'automation.view') || currentUser.role === 'Owner / CEO' || currentUser.role === 'Project Manager' || currentUser.role === 'Admin',
              badge: (tasks?.filter((t) => (t.priority === 'Critical' || t.priority === 'Urgent') && t.status !== 'Completed').length || 0) > 0 || (escalations?.filter((e) => !e.resolved_at).length || 0) > 0,
              badgeCount: (tasks?.filter((t) => (t.priority === 'Critical' || t.priority === 'Urgent') && t.status !== 'Completed').length || 0) + (escalations?.filter((e) => !e.resolved_at).length || 0),
            },
            {
              id: 'work-items',
              label: currentUser.role === 'Production Staff' ? 'My Site Tasks' : 'Work Items & Site',
              show: hasPermission(currentUser, 'work_items.view'),
            },
            {
              id: 'purchasing',
              label: 'Purchasing & Materials',
              show: hasPermission(currentUser, 'purchasing.view'),
            },
            {
              id: 'finance',
              label: 'Finance & Claims',
              show: hasPermission(currentUser, 'finance.view'),
            },
            {
              id: 'drawings',
              label: 'Drawings & Revisions',
              show: hasPermission(currentUser, 'drawings.view'),
            },
            {
              id: 'issues',
              label: 'Issues & Escalations',
              show: hasPermission(currentUser, 'issues.view'),
              badge: notifications.some((n) => n.type === 'issue' && !n.is_read),
            },
            {
              id: 'variations',
              label: 'Variations & Claims',
              show: hasPermission(currentUser, 'variations.view'),
            },
            {
              id: 'clients',
              label: 'Clients',
              show: hasPermission(currentUser, 'clients.view'),
            },
            {
              id: 'contractors',
              label: 'Contractors',
              show: hasPermission(currentUser, 'contractors.view'),
            },
            {
              id: 'calendar',
              label: 'Schedule',
              show: coreDataSync.mode === 'database' && currentUser.role !== 'Client',
            },
            {
              id: 'knowledge',
              label: 'NW Knowledge Base',
              show: hasPermission(currentUser, 'knowledge.view'),
            },
            {
              id: 'users',
              label: 'User Roles & Access',
              show: hasPermission(currentUser, 'users.view'),
            },
            {
              id: 'audit-logs',
              label: 'Audit Log & Architecture',
              show: hasPermission(currentUser, 'audit.view'),
            },
          ]
            .filter((tab) => tab.show)
            .map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-all flex items-center space-x-1.5 ${
                  activeTab === tab.id
                    ? 'bg-amber-500 text-slate-950 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
                }`}
              >
                <span>{tab.label}</span>
                {tab.badgeCount !== undefined && tab.badgeCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] font-black bg-rose-600 text-white shadow-xs">
                    {tab.badgeCount}
                  </span>
                )}
                {tab.badge && tab.badgeCount === undefined && (
                  <span className="w-2 h-2 rounded-full bg-red-600 inline-block align-middle animate-ping" />
                )}
              </button>
            ))}
        </div>
      </div>

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 text-slate-900 shadow-2xl">
            <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
              <RefreshCw className="w-5 h-5 text-amber-600" />
              <span>Reset to Factory Demo Data?</span>
            </h3>
            <p className="text-xs text-slate-600 mt-2 leading-relaxed">
              This will restore all 3 projects, 15 work items, the Cashier Counter CAR-003 dimension issue, drawing revisions, and notifications to their initial state.
            </p>
            <div className="mt-5 flex justify-end space-x-2">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  resetToDemoData();
                  setShowResetConfirm(false);
                }}
                className="px-4 py-2 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-xs"
              >
                Confirm Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
