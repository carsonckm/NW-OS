/**
 * NW OS Issues & Escalation Register
 * Full audit trail and exception management for site, drawing, and manufacturing conflicts.
 */

import React, { useEffect, useState } from 'react';
import { useFocus } from '../services/navigation';
import { useNW } from '../context/NWContext';
import { Issue } from '../types';
import {
  AlertTriangle,
  Plus,
  Search,
  Filter,
  ShieldAlert,
  CheckCircle2,
  Clock,
  User,
  Layers,
} from 'lucide-react';
import { IssueModal } from '../components/IssueModal';

export const IssuesView: React.FC = () => {
  const { issues, selectedProject } = useNW();

  const [search, setSearch] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [escalationFilter, setEscalationFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const focus = useFocus(['issue']);
  useEffect(() => {
    const issue = focus && issues.find((i) => i.id === focus.id);
    if (issue) setSelectedIssue(issue);
  }, [focus, issues]);

  const filteredIssues = issues.filter((iss) => {
    const matchesSearch =
      iss.title.toLowerCase().includes(search.toLowerCase()) ||
      iss.description.toLowerCase().includes(search.toLowerCase()) ||
      iss.reported_by.toLowerCase().includes(search.toLowerCase());
    const matchesPriority = priorityFilter === 'All' || iss.priority === priorityFilter;
    const matchesEscalation = escalationFilter === 'All' || iss.escalation_level === escalationFilter;
    const matchesStatus = statusFilter === 'All' || iss.status === statusFilter;
    return matchesSearch && matchesPriority && matchesEscalation && matchesStatus;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/30 text-[10px] font-bold uppercase tracking-widest">
              Exception Management
            </span>
            <span className="text-xs text-slate-400">Total {issues.length} Issues</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 mt-1">
            Issues & Escalation Register
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Resolving site discrepancies, drawing clashes, and variation triggers.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center space-x-2 transition-colors shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>Report New Issue (AI Assisted)</span>
        </button>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-2.5 bg-slate-900 border border-slate-800 p-3 rounded-xl">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search issues, description, reporter..."
            className="w-full bg-slate-950 border border-slate-700 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
          />
        </div>

        <select
          value={escalationFilter}
          onChange={(e) => setEscalationFilter(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <option value="All">All Escalation Levels</option>
          <option value="Owner">Owner Exception</option>
          <option value="PM">Project Manager</option>
          <option value="Site Supervisor">Site Supervisor</option>
        </select>

        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <option value="All">All Priorities</option>
          <option value="Critical">Critical</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-amber-400"
        >
          <option value="All">All Statuses</option>
          <option value="Reported">Reported</option>
          <option value="Under Review">Under Review</option>
          <option value="Decision Required">Decision Required</option>
          <option value="Resolved">Resolved</option>
        </select>
      </div>

      {/* Issues Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredIssues.map((issue) => (
          <div
            key={issue.id}
            onClick={() => setSelectedIssue(issue)}
            className={`p-5 rounded-2xl border transition-all cursor-pointer shadow-md ${
              issue.priority === 'Critical'
                ? 'bg-slate-900 border-red-500/40 hover:border-red-500'
                : 'bg-slate-900 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                      issue.priority === 'Critical'
                        ? 'bg-red-500/20 text-red-400 border-red-500/30'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                    }`}
                  >
                    {issue.priority}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-400">
                    {issue.category}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-slate-100 mt-1">{issue.title}</h3>
              </div>

              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border shrink-0 ${
                  issue.status === 'Resolved'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : issue.status === 'Decision Required'
                    ? 'bg-amber-500/20 text-amber-400 border-amber-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {issue.status}
              </span>
            </div>

            <p className="text-xs text-slate-300 mt-2 line-clamp-2 leading-relaxed">
              {issue.description}
            </p>

            <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
              <span>
                Reported by: <strong className="text-slate-200">{issue.reported_by}</strong>
              </span>
              <span className="text-amber-400 font-semibold font-mono">
                Escalated to: {issue.escalation_level}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Modals */}
      {showCreateModal && (
        <IssueModal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} />
      )}

      {selectedIssue && (
        <IssueModal
          isOpen={Boolean(selectedIssue)}
          onClose={() => setSelectedIssue(null)}
          existingIssue={selectedIssue}
        />
      )}
    </div>
  );
};
