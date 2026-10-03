import React, { useState } from 'react';
import {
  Bell,
  MessageSquare,
  Mail,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Settings,
  Sparkles,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check,
  X,
  FileText,
  User,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { NotificationCategory, NotificationChannel, UserNotificationPreference } from '../../types';

export const NotificationsTab: React.FC = () => {
  const {
    notifications,
    markNotificationRead,
    clearAllNotifications,
    dailyBriefings,
    currentUser,
    userNotificationPreferences,
    updateNotificationPreferences,
  } = useNW();

  const [activeSubTab, setActiveSubTab] = useState<'inbox' | 'daily-briefing' | 'preferences'>('inbox');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [briefingRole, setBriefingRole] = useState<'owner' | 'pm'>('owner');

  const currentPrefs: UserNotificationPreference =
    userNotificationPreferences.find((p) => p.user_id === currentUser.id) ||
    userNotificationPreferences[0] || {
      user_id: currentUser.id,
      category_preferences: {
        Task: { in_app: true, whatsapp: true, email: false, push: true },
        Approval: { in_app: true, whatsapp: true, email: true, push: true },
        Issue: { in_app: true, whatsapp: false, email: false, push: true },
        Escalation: { in_app: true, whatsapp: true, email: true, push: true },
        Drawing: { in_app: true, whatsapp: false, email: false, push: false },
        Production: { in_app: true, whatsapp: false, email: false, push: false },
        Delivery: { in_app: true, whatsapp: false, email: false, push: false },
        Installation: { in_app: true, whatsapp: false, email: false, push: false },
        QC: { in_app: true, whatsapp: false, email: false, push: false },
        Commercial: { in_app: true, whatsapp: true, email: true, push: true },
        Client: { in_app: true, whatsapp: true, email: false, push: true },
        System: { in_app: true, whatsapp: false, email: false, push: false },
      },
      daily_briefing_channel: 'whatsapp',
      daily_briefing_time: '08:00 AM',
    };

  const categories: NotificationCategory[] = [
    'Task',
    'Approval',
    'Issue',
    'Escalation',
    'Drawing',
    'Production',
    'Delivery',
    'Installation',
    'QC',
    'Commercial',
    'Client',
    'System',
  ];

  const filteredNotifications = notifications.filter((n) => {
    if (selectedCategory !== 'all' && n.type !== selectedCategory.toLowerCase()) {
      return false;
    }
    return true;
  });

  const activeBriefing = dailyBriefings[briefingRole] || dailyBriefings.owner;

  const handleTogglePref = (category: NotificationCategory, channel: 'in_app' | 'whatsapp' | 'email' | 'push') => {
    const existing = currentPrefs.category_preferences[category] || { in_app: true, whatsapp: false, email: false, push: false };
    const updated = {
      ...currentPrefs,
      category_preferences: {
        ...currentPrefs.category_preferences,
        [category]: {
          ...existing,
          [channel]: !existing[channel],
        },
      },
    };
    updateNotificationPreferences(currentUser.id, updated);
  };

  return (
    <div className="space-y-6">
      {/* Sub navigation */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center space-x-1">
          <button
            onClick={() => setActiveSubTab('inbox')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
              activeSubTab === 'inbox' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Bell className="w-3.5 h-3.5" />
            <span>Notification Feed</span>
            <span className="ml-1 text-[10px] px-1.5 py-0.2 rounded-full bg-slate-700 text-white font-black">
              {notifications.filter((n) => !n.is_read).length}
            </span>
          </button>

          <button
            onClick={() => setActiveSubTab('daily-briefing')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
              activeSubTab === 'daily-briefing'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Daily Briefing Digest (Section 20)</span>
          </button>

          <button
            onClick={() => setActiveSubTab('preferences')}
            className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 ${
              activeSubTab === 'preferences' ? 'bg-slate-900 text-white shadow-xs' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Channel Preferences (Section 19)</span>
          </button>
        </div>

        {activeSubTab === 'inbox' && (
          <button
            onClick={clearAllNotifications}
            className="text-xs text-slate-500 hover:text-slate-800 font-bold transition-colors cursor-pointer self-end sm:self-center"
          >
            Mark all read
          </button>
        )}
      </div>

      {/* FEED SUB-TAB */}
      {activeSubTab === 'inbox' && (
        <div className="space-y-4">
          {/* Category Filter Pills */}
          <div className="flex items-center space-x-1 overflow-x-auto pb-1 text-xs">
            <button
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
              }`}
            >
              All Categories ({notifications.length})
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-3 py-1.5 rounded-xl font-bold transition-all whitespace-nowrap ${
                  selectedCategory === cat
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Notifications List */}
          <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 shadow-xs overflow-hidden">
            {filteredNotifications.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">No notifications in this category.</div>
            ) : (
              filteredNotifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => markNotificationRead(notif.id)}
                  className={`p-4 transition-colors flex items-start justify-between gap-4 cursor-pointer ${
                    !notif.is_read ? 'bg-amber-50/40 hover:bg-amber-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <span
                      className={`p-2 rounded-xl mt-0.5 ${
                        notif.priority === 'urgent'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-blue-50 text-blue-800'
                      }`}
                    >
                      <Bell className="w-4 h-4" />
                    </span>
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="text-xs font-bold text-slate-900">{notif.title}</span>
                        <span className="text-[10px] uppercase font-bold px-1.5 py-0.2 rounded bg-slate-100 text-slate-700">
                          {notif.type}
                        </span>
                        {!notif.is_read && (
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                        )}
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed">{notif.message}</p>
                      <div className="text-[10px] text-slate-400">
                        {new Date(notif.created_at).toLocaleString()}
                      </div>
                    </div>
                  </div>

                  {/* Channel dispatch icons */}
                  <div className="flex items-center space-x-1 text-slate-400 shrink-0">
                    <span title="Delivered via In-App" className="p-1 bg-slate-100 text-slate-700 rounded">
                      <Bell className="w-3 h-3" />
                    </span>
                    <span title="Dispatched via WhatsApp" className="p-1 bg-emerald-50 text-emerald-700 rounded">
                      <MessageSquare className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* DAILY BRIEFING DIGEST SUB-TAB (Sections 20, 21, 22) */}
      {activeSubTab === 'daily-briefing' && (
        <div className="space-y-6">
          {/* Briefing Switcher: Owner vs PM */}
          <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-slate-700">View Briefing Profile:</span>
              <button
                onClick={() => setBriefingRole('owner')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  briefingRole === 'owner' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Owner / CEO Executive Briefing
              </button>
              <button
                onClick={() => setBriefingRole('pm')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  briefingRole === 'pm' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'
                }`}
              >
                Senior PM Operational Briefing
              </button>
            </div>

            <span className="text-xs text-slate-400 font-mono">
              Auto-generated {activeBriefing.date} at 08:00 AM
            </span>
          </div>

          {/* AI Morning Summary Card */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white p-6 rounded-2xl shadow-xl space-y-3">
            <div className="flex items-center space-x-2 text-amber-400 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-4 h-4 text-amber-400" />
              <span>NW OS Morning Intelligence Digest</span>
            </div>
            <p className="text-sm sm:text-base text-slate-200 leading-relaxed font-medium">
              "{activeBriefing.summary}"
            </p>
          </div>

          {/* Focus Items Categorized */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
            <h4 className="text-xs font-black uppercase text-slate-900 tracking-wider">
              Exception Focus Areas (No Routine Noise)
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {activeBriefing.focus_items.map((item, idx) => (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border space-y-2 ${
                    item.urgency === 'Critical'
                      ? 'bg-rose-50/80 border-rose-300'
                      : item.urgency === 'High'
                      ? 'bg-amber-50/70 border-amber-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded bg-white border border-slate-200">
                      {item.category}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-700">{item.project_code}</span>
                  </div>

                  <h5 className="text-xs font-bold text-slate-900">{item.title}</h5>
                  <p className="text-[11px] text-slate-600 leading-relaxed">
                    <strong>Action Needed:</strong> {item.action_needed}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL PREFERENCES SUB-TAB (Section 19) */}
      {activeSubTab === 'preferences' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Multi-Channel Dispatch Preferences (Section 18 & 19)
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              The workflow engine creates notifications. The communication layer delivers via In-App, WhatsApp Simulator, Email, or Push.
            </p>
          </div>

          {/* Preferences Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 text-slate-400 font-bold uppercase text-[10px]">
                  <th className="pb-3">Notification Category</th>
                  <th className="pb-3 text-center">In-App (NW OS)</th>
                  <th className="pb-3 text-center">WhatsApp Gateway</th>
                  <th className="pb-3 text-center">Email</th>
                  <th className="pb-3 text-center">Push Notice</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {categories.map((cat) => {
                  const pref = currentPrefs.category_preferences[cat] || {
                    in_app: true,
                    whatsapp: false,
                    email: false,
                    push: false,
                  };
                  return (
                    <tr key={cat} className="hover:bg-slate-50 transition-colors">
                      <td className="py-3 font-bold text-slate-800">{cat}</td>

                      <td className="py-3 text-center">
                        <button
                          onClick={() => handleTogglePref(cat, 'in_app')}
                          className={`w-5 h-5 rounded cursor-pointer transition-colors ${
                            pref.in_app ? 'bg-slate-900 text-white' : 'bg-slate-200 text-transparent'
                          }`}
                        >
                          ✓
                        </button>
                      </td>

                      <td className="py-3 text-center">
                        <button
                          onClick={() => handleTogglePref(cat, 'whatsapp')}
                          className={`w-5 h-5 rounded cursor-pointer transition-colors ${
                            pref.whatsapp ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-transparent'
                          }`}
                        >
                          ✓
                        </button>
                      </td>

                      <td className="py-3 text-center">
                        <button
                          onClick={() => handleTogglePref(cat, 'email')}
                          className={`w-5 h-5 rounded cursor-pointer transition-colors ${
                            pref.email ? 'bg-blue-600 text-white' : 'bg-slate-200 text-transparent'
                          }`}
                        >
                          ✓
                        </button>
                      </td>

                      <td className="py-3 text-center">
                        <button
                          onClick={() => handleTogglePref(cat, 'push')}
                          className={`w-5 h-5 rounded cursor-pointer transition-colors ${
                            pref.push ? 'bg-purple-600 text-white' : 'bg-slate-200 text-transparent'
                          }`}
                        >
                          ✓
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
