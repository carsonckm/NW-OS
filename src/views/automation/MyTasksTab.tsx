import React, { useEffect, useState } from 'react';
import { useFocus } from '../../services/navigation';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Play,
  RotateCcw,
  MessageSquare,
  Paperclip,
  ArrowUpRight,
  User,
  Building2,
  Layers,
  Sparkles,
  Calendar,
  CheckSquare,
  Square,
  Filter,
  Plus,
  ArrowRight,
  ShieldAlert,
  Send,
  Lock,
  Eye,
  X,
  FileText,
  Camera,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { TaskOriginIssue } from '../../components/IssueTasks';
import { TaskWorkPanel } from '../../components/TaskWorkPanel';
import { NWTask, TaskPriority, TaskStatus, TaskEscalationLevel, UserRole } from '../../types';

export const MyTasksTab: React.FC = () => {
  const {
    tasks,
    currentUser,
    projects,
    workPackages,
    updateTaskStatus,
    updateTask,
    escalateTask,
    acknowledgeTask,
    executeTaskNextBestAction,
    addTaskComment,
    createTask,
  } = useNW();

  // Active filter sub-view (Section 8)
  const [activeFilterView, setActiveFilterView] = useState<
    'ALL' | 'TODAY' | 'OVERDUE' | 'WAITING' | 'HIGH_PRIORITY' | 'ESCALATED' | 'COMPLETED'
  >('TODAY');

  const [projectFilter, setProjectFilter] = useState<string>('all');
  const [roleFilter, setRoleFilter] = useState<string>('my-tasks');
  const [searchQuery, setSearchQuery] = useState('');

  // Selected task drawer/modal
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(tasks[0]?.id || null);
  const focus = useFocus(['task']);
  useEffect(() => {
    if (focus) setSelectedTaskId(focus.id);
  }, [focus]);
  const [newCommentText, setNewCommentText] = useState('');
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false);
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [escalateReason, setEscalateReason] = useState('Breached SLA deadline without progress update');
  const [escalateTargetLevel, setEscalateTargetLevel] = useState<TaskEscalationLevel>('PM');

  // New task form state
  const [newTaskData, setNewTaskData] = useState({
    title: '',
    description: '',
    project_id: projects[0]?.id || '',
    assigned_role: 'Site Supervisor' as UserRole,
    priority: 'Normal' as TaskPriority,
    due_date: new Date().toISOString().split('T')[0],
    due_time: '05:00 PM',
  });

  const todayStr = new Date().toISOString().split('T')[0];

  // Filter tasks based on selected view & criteria
  const filteredTasks = tasks.filter((task) => {
    // Role filter
    if (roleFilter === 'my-tasks') {
      const isMine =
        task.assigned_user_id === currentUser.id ||
        task.assigned_role === currentUser.role ||
        currentUser.role === 'Owner / CEO' ||
        currentUser.role === 'Admin';
      if (!isMine) return false;
    } else if (roleFilter !== 'all' && task.assigned_role !== roleFilter) {
      return false;
    }

    // Project filter
    if (projectFilter !== 'all' && task.project_id !== projectFilter) {
      return false;
    }

    // Search query
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        task.task_number.toLowerCase().includes(q) ||
        task.title.toLowerCase().includes(q) ||
        task.description.toLowerCase().includes(q) ||
        (task.work_item_code && task.work_item_code.toLowerCase().includes(q));
      if (!match) return false;
    }

    // Dashboard View Filter (Section 8)
    switch (activeFilterView) {
      case 'TODAY':
        return task.status !== 'Completed' && task.status !== 'Cancelled' && task.due_date === todayStr;
      case 'OVERDUE':
        return (
          task.status !== 'Completed' &&
          task.status !== 'Cancelled' &&
          task.due_date < todayStr
        );
      case 'WAITING':
        return task.status === 'Waiting';
      case 'HIGH_PRIORITY':
        return (
          task.status !== 'Completed' &&
          task.status !== 'Cancelled' &&
          (task.priority === 'High' || task.priority === 'Urgent' || task.priority === 'Critical')
        );
      case 'ESCALATED':
        return task.status === 'Escalated' || task.escalation_level !== 'None';
      case 'COMPLETED':
        return task.status === 'Completed';
      case 'ALL':
      default:
        return true;
    }
  });

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) || filteredTasks[0] || tasks[0];

  // Helper counters for tabs
  const countToday = tasks.filter((t) => t.status !== 'Completed' && t.due_date === todayStr).length;
  const countOverdue = tasks.filter((t) => t.status !== 'Completed' && t.due_date < todayStr).length;
  const countWaiting = tasks.filter((t) => t.status === 'Waiting').length;
  const countHighPriority = tasks.filter(
    (t) => t.status !== 'Completed' && (t.priority === 'High' || t.priority === 'Urgent' || t.priority === 'Critical')
  ).length;
  const countEscalated = tasks.filter((t) => t.status === 'Escalated' || t.escalation_level !== 'None').length;
  const countCompleted = tasks.filter((t) => t.status === 'Completed').length;

  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCommentText.trim() || !selectedTask) return;
    addTaskComment(selectedTask.id, newCommentText.trim());
    setNewCommentText('');
  };

  const handleCreateTaskSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const proj = projects.find((p) => p.id === newTaskData.project_id) || projects[0];

    createTask({
      title: newTaskData.title,
      description: newTaskData.description,
      project_id: proj.id,
      project_name: proj.project_name,
      source_event: 'task.manual_created',
      source_module: 'PM',
      source_reason: `Created manually by ${currentUser.name} (${currentUser.role})`,
      assigned_user_id: 'u-3',
      assigned_user_name: newTaskData.assigned_role,
      assigned_role: newTaskData.assigned_role,
      priority: newTaskData.priority,
      due_date: newTaskData.due_date,
      due_time: newTaskData.due_time,
      status: 'Open',
      escalation_level: 'None',
      is_critical: newTaskData.priority === 'Critical',
      requires_acknowledgement: newTaskData.priority === 'Critical',
    });

    setShowCreateTaskModal(false);
    setNewTaskData({
      title: '',
      description: '',
      project_id: projects[0]?.id || '',
      assigned_role: 'Site Supervisor',
      priority: 'Normal',
      due_date: new Date().toISOString().split('T')[0],
      due_time: '05:00 PM',
    });
  };

  const handleEscalateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTask) return;
    escalateTask(selectedTask.id, escalateTargetLevel, escalateReason);
    setShowEscalateModal(false);
  };

  const getPriorityBadge = (priority: TaskPriority) => {
    switch (priority) {
      case 'Critical':
        return 'bg-rose-100 text-rose-900 border-rose-300 font-black animate-pulse';
      case 'Urgent':
        return 'bg-orange-100 text-orange-900 border-orange-300 font-bold';
      case 'High':
        return 'bg-amber-100 text-amber-900 border-amber-300 font-bold';
      case 'Normal':
        return 'bg-blue-50 text-blue-800 border-blue-200';
      case 'Low':
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  const getStatusBadge = (status: TaskStatus) => {
    switch (status) {
      case 'Completed':
        return 'bg-emerald-100 text-emerald-900 border-emerald-300';
      case 'In Progress':
        return 'bg-blue-100 text-blue-900 border-blue-300';
      case 'Waiting':
        return 'bg-amber-100 text-amber-900 border-amber-300';
      case 'Escalated':
        return 'bg-purple-100 text-purple-900 border-purple-300 font-bold';
      case 'Blocked':
        return 'bg-red-100 text-red-900 border-red-300';
      case 'Open':
      default:
        return 'bg-slate-100 text-slate-800 border-slate-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* View Tabs & Quick Filters (Section 8) */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Sub-view Filter Pills */}
          <div className="flex items-center space-x-1 overflow-x-auto pb-1">
            {[
              { id: 'TODAY', label: 'Today', count: countToday, color: 'text-blue-700' },
              { id: 'OVERDUE', label: 'Overdue', count: countOverdue, color: 'text-amber-700' },
              { id: 'WAITING', label: 'Waiting', count: countWaiting, color: 'text-purple-700' },
              { id: 'HIGH_PRIORITY', label: 'High Priority', count: countHighPriority, color: 'text-rose-700' },
              { id: 'ESCALATED', label: 'Escalated', count: countEscalated, color: 'text-purple-900' },
              { id: 'COMPLETED', label: 'Completed', count: countCompleted, color: 'text-emerald-700' },
              { id: 'ALL', label: 'All Tasks', count: tasks.length, color: 'text-slate-700' },
            ].map((tab) => {
              const isActive = activeFilterView === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveFilterView(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
                      isActive ? 'bg-amber-400 text-slate-950' : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            <button
              onClick={() => setShowCreateTaskModal(true)}
              className="inline-flex items-center space-x-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Create Task</span>
            </button>
          </div>
        </div>

        {/* Filter bar: Project & Role */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 text-xs">
          <div>
            <input
              type="text"
              placeholder="Search tasks, codes, work items..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
            />
          </div>

          <div>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500 focus:outline-none"
            >
              <option value="all">All Projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.project_number} • {p.project_name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-amber-500 focus:outline-none"
            >
              <option value="my-tasks">My Assigned Tasks ({currentUser.name})</option>
              <option value="all">All Roles</option>
              <option value="Site Supervisor">Site Supervisor</option>
              <option value="Project Manager">Project Manager</option>
              <option value="Production Manager">Production Manager</option>
              <option value="Contractor">Contractor</option>
              <option value="Purchasing">Purchasing</option>
              <option value="Accountant">Accountant</option>
              <option value="Owner / CEO">Owner / CEO</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main 2-Column Layout: Task List (5 cols) + Task Detail Workspace (7 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Task List (5 cols) */}
        <div className="lg:col-span-5 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-bold">
            <span>Tasks ({filteredTasks.length})</span>
            <span>Sorted by Due Date</span>
          </div>

          {filteredTasks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
              <h4 className="text-sm font-bold text-slate-800">No Tasks in this Filter</h4>
              <p className="text-xs text-slate-500">You are all caught up for this view.</p>
            </div>
          ) : (
            filteredTasks.map((task) => {
              const isSelected = selectedTask?.id === task.id;
              const isOverdue = task.status !== 'Completed' && task.due_date < todayStr;
              const isToday = task.due_date === todayStr;

              return (
                <div
                  key={task.id}
                  onClick={() => setSelectedTaskId(task.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer space-y-2.5 relative ${
                    isSelected
                      ? 'bg-amber-50/60 border-amber-400 shadow-sm ring-1 ring-amber-400'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  {/* Task Header: ID, Badges */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-1.5 flex-wrap">
                      <span className="text-xs font-mono font-black text-slate-900">
                        {task.task_number}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${getPriorityBadge(
                          task.priority
                        )}`}
                      >
                        {task.priority}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${getStatusBadge(
                          task.status
                        )}`}
                      >
                        {task.status}
                      </span>
                    </div>

                    {/* Deadline Badge */}
                    <div
                      className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center space-x-1 shrink-0 ${
                        isOverdue
                          ? 'bg-rose-100 text-rose-900 border border-rose-300'
                          : isToday
                          ? 'bg-blue-100 text-blue-900'
                          : 'text-slate-500 bg-slate-100'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      <span>{task.due_date}</span>
                    </div>
                  </div>

                  {/* Title & Description preview */}
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 line-clamp-1">{task.title}</h4>
                    <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{task.description}</p>
                  </div>

                  {/* Source & Assigned Meta (Section 7) */}
                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500">
                    <div className="flex items-center space-x-1 truncate max-w-[200px]">
                      <span className="font-bold text-slate-700">Source:</span>
                      <span className="truncate">{task.source_module}</span>
                    </div>
                    <div className="flex items-center space-x-1">
                      <User className="w-3 h-3 text-slate-400" />
                      <span className="font-semibold text-slate-800">{task.assigned_role}</span>
                    </div>
                  </div>

                  {/* Dependency locked badge */}
                  {task.status === 'Blocked' && (
                    <div className="bg-red-50 border border-red-200 p-1.5 rounded-lg flex items-center space-x-1 text-[10px] text-red-900 font-bold">
                      <Lock className="w-3 h-3 text-red-600 shrink-0" />
                      <span>Dependency locked (Rule 10)</span>
                    </div>
                  )}

                  {/* Waiting reason badge */}
                  {task.status === 'Waiting' && task.waiting_for_party && (
                    <div className="bg-amber-50 border border-amber-200 p-1.5 rounded-lg text-[10px] text-amber-900 font-bold">
                      ⏳ {task.waiting_for_party}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Task Detail Workspace (7 cols) */}
        <div className="lg:col-span-7">
          {selectedTask ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-6">
              {/* Header */}
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2 flex-wrap mb-1">
                    <span className="text-sm font-mono font-black text-slate-900">
                      {selectedTask.task_number}
                    </span>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full border ${getPriorityBadge(
                        selectedTask.priority
                      )}`}
                    >
                      {selectedTask.priority}
                    </span>
                    <span
                      className={`text-[10px] px-2.5 py-0.5 rounded-full border ${getStatusBadge(
                        selectedTask.status
                      )}`}
                    >
                      {selectedTask.status}
                    </span>
                    {selectedTask.escalation_level !== 'None' && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-purple-100 text-purple-900 border border-purple-300 font-black">
                        Escalated to {selectedTask.escalation_level}
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-black text-slate-900">{selectedTask.title}</h2>
                  <TaskOriginIssue task={selectedTask} />
                  <TaskWorkPanel task={selectedTask} />
                  <div className="text-xs text-slate-500 mt-1 flex items-center space-x-2">
                    <Building2 className="w-3.5 h-3.5 text-slate-400" />
                    <span>{selectedTask.project_name}</span>
                    {selectedTask.work_item_code && (
                      <>
                        <span>•</span>
                        <span className="font-mono font-bold text-amber-700">{selectedTask.work_item_code}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Due Date & SLA */}
                <div className="text-right shrink-0 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">SLA Deadline</span>
                  <span className="text-xs font-black text-slate-900">
                    {selectedTask.due_date} {selectedTask.due_time || ''}
                  </span>
                  <span className="text-[10px] text-slate-500 block mt-0.5">
                    Created {new Date(selectedTask.created_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>

              {/* Critical Alert & Acknowledgement Banner (Section 15 & 16) */}
              {selectedTask.priority === 'Critical' && (
                <div className="p-4 bg-rose-50 border border-rose-300 rounded-xl space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2 text-rose-900 font-black text-xs uppercase tracking-wide">
                      <ShieldAlert className="w-4 h-4 text-rose-600" />
                      <span>🔴 CRITICAL ISSUE — MANDATORY ACKNOWLEDGEMENT</span>
                    </div>
                    {selectedTask.acknowledged_at ? (
                      <span className="text-[10px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                        ✓ Acknowledged by {selectedTask.acknowledged_by}
                      </span>
                    ) : (
                      <button
                        onClick={() => acknowledgeTask(selectedTask.id)}
                        className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                      >
                        Acknowledge Now
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-rose-800">
                    Critical issues require formal human acknowledgement. If not acknowledged within the configured SLA,
                    it automatically escalates up the hierarchy.
                  </p>
                </div>
              )}

              {/* Description */}
              <div>
                <span className="text-xs font-bold text-slate-700 block mb-1 uppercase tracking-wide text-[10px]">
                  Description & Scope
                </span>
                <p className="text-xs text-slate-700 leading-relaxed bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  {selectedTask.description}
                </p>
              </div>

              {/* Source & Reason (Section 7) */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Origin Module</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">{selectedTask.source_module}</span>
                  <span className="text-[10px] text-slate-500 block truncate">{selectedTask.source_event}</span>
                </div>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Assigned Role</span>
                  <span className="font-bold text-slate-900 mt-0.5 block">
                    {selectedTask.assigned_role} ({selectedTask.assigned_user_name})
                  </span>
                  <span className="text-[10px] text-slate-500 block truncate">
                    {selectedTask.source_reason || 'Automated rule allocation'}
                  </span>
                </div>
              </div>

              {/* Section 31 & 32: AI Next Best Action Recommendation */}
              {selectedTask.next_best_action && (
                <div className="p-4 bg-gradient-to-r from-amber-50 to-orange-50/40 border border-amber-300 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <Sparkles className="w-4 h-4 text-amber-600" />
                      <span className="text-xs font-black text-amber-950 uppercase tracking-wide">
                        AI Next Best Action (Section 31)
                      </span>
                    </div>
                    <span
                      className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                        selectedTask.next_best_action.confidence === 'CONFIRMED'
                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                          : selectedTask.next_best_action.confidence === 'PROBABLE'
                          ? 'bg-amber-100 text-amber-900 border border-amber-300'
                          : 'bg-slate-200 text-slate-800'
                      }`}
                    >
                      {selectedTask.next_best_action.confidence}
                    </span>
                  </div>

                  <p className="text-xs text-slate-800 italic">
                    "{selectedTask.next_best_action.recommendation}"
                  </p>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] font-bold text-slate-700">
                      Suggested Action:{' '}
                      <span className="font-black text-amber-950">
                        {selectedTask.next_best_action.suggested_action}
                      </span>
                    </span>

                    <button
                      onClick={() => executeTaskNextBestAction(selectedTask.id)}
                      className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center space-x-1 cursor-pointer"
                    >
                      <Play className="w-3.5 h-3.5 text-amber-400" />
                      <span>Execute Action</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Task Actions Bar (Section 9) */}
              <div className="pt-2 border-t border-slate-100 space-y-2">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Task Actions (Section 9)
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  {selectedTask.status !== 'In Progress' && selectedTask.status !== 'Completed' && (
                    <button
                      onClick={() => updateTaskStatus(selectedTask.id, 'In Progress')}
                      disabled={selectedTask.status === 'Blocked'}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <Play className="w-3.5 h-3.5" />
                      <span>Start Task</span>
                    </button>
                  )}

                  {selectedTask.status !== 'Completed' && (
                    <button
                      onClick={() => updateTaskStatus(selectedTask.id, 'Completed')}
                      disabled={selectedTask.status === 'Blocked'}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Complete Task</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      const party = prompt('Waiting for who? (e.g. Contractor measurement, Client sign-off, Supplier delivery):');
                      if (party) {
                        updateTask(selectedTask.id, {
                          status: 'Waiting',
                          waiting_for_party: `Waiting for ${party}`,
                        });
                      }
                    }}
                    className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                  >
                    Set Waiting
                  </button>

                  <button
                    onClick={() => setShowEscalateModal(true)}
                    className="px-3 py-1.5 bg-white border border-purple-300 hover:bg-purple-50 text-purple-900 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center space-x-1"
                  >
                    <ArrowUpRight className="w-3.5 h-3.5 text-purple-600" />
                    <span>Escalate</span>
                  </button>
                </div>
              </div>

              {/* Attachments */}
              {selectedTask.attachments && selectedTask.attachments.length > 0 && (
                <div className="space-y-2">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">
                    Attached Files & Photos
                  </span>
                  <div className="grid grid-cols-2 gap-2">
                    {selectedTask.attachments.map((att, i) => (
                      <div
                        key={i}
                        className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center space-x-2 text-xs"
                      >
                        {att.type === 'photo' ? (
                          <Camera className="w-4 h-4 text-slate-500" />
                        ) : (
                          <FileText className="w-4 h-4 text-slate-500" />
                        )}
                        <span className="font-semibold text-slate-800 truncate">{att.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Comments Thread & Add Comment */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <span className="text-[10px] font-bold uppercase text-slate-400 block">
                  Action History & Comments ({selectedTask.comments?.length || 0})
                </span>

                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {selectedTask.comments && selectedTask.comments.length > 0 ? (
                    selectedTask.comments.map((c) => (
                      <div key={c.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1">
                        <div className="flex items-center justify-between text-[10px] text-slate-500 font-bold">
                          <span>
                            {c.user_name} ({c.role})
                          </span>
                          <span>{new Date(c.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-slate-800">{c.text}</p>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400 italic">No comments yet.</div>
                  )}
                </div>

                <form onSubmit={handleAddComment} className="flex gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="Add comment, update progress, or log inspection note..."
                    value={newCommentText}
                    onChange={(e) => setNewCommentText(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer shrink-0"
                  >
                    Post
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center text-slate-500">
              Select a task from the list to view full details.
            </div>
          )}
        </div>
      </div>

      {/* Create Task Modal */}
      {showCreateTaskModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white">Create New Workflow Task</h3>
              <button
                onClick={() => setShowCreateTaskModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTaskSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Task Title</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Inspect Scribe Gap on Cashier Counter B"
                  value={newTaskData.title}
                  onChange={(e) => setNewTaskData({ ...newTaskData, title: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description & Scope</label>
                <textarea
                  rows={3}
                  required
                  placeholder="Provide explicit instructions or verification criteria..."
                  value={newTaskData.description}
                  onChange={(e) => setNewTaskData({ ...newTaskData, description: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Project</label>
                  <select
                    value={newTaskData.project_id}
                    onChange={(e) => setNewTaskData({ ...newTaskData, project_id: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.project_number} • {p.project_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assign Responsible Role</label>
                  <select
                    value={newTaskData.assigned_role}
                    onChange={(e) => setNewTaskData({ ...newTaskData, assigned_role: e.target.value as UserRole })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="Site Supervisor">Site Supervisor</option>
                    <option value="Project Manager">Project Manager</option>
                    <option value="Production Manager">Production Manager</option>
                    <option value="Contractor">Contractor</option>
                    <option value="Purchasing">Purchasing</option>
                    <option value="Accountant">Accountant</option>
                    <option value="Owner / CEO">Owner / CEO</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                  <select
                    value={newTaskData.priority}
                    onChange={(e) => setNewTaskData({ ...newTaskData, priority: e.target.value as TaskPriority })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="Low">Low</option>
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Critical">Critical 🔴</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    required
                    value={newTaskData.due_date}
                    onChange={(e) => setNewTaskData({ ...newTaskData, due_date: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateTaskModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  Create & Route Task
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Escalate Modal */}
      {showEscalateModal && selectedTask && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-purple-900 text-white p-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4" />
                Escalate Task {selectedTask.task_number}
              </h3>
              <button
                onClick={() => setShowEscalateModal(false)}
                className="text-purple-300 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleEscalateSubmit} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Target Escalation Level</label>
                <select
                  value={escalateTargetLevel}
                  onChange={(e) => setEscalateTargetLevel(e.target.value as TaskEscalationLevel)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                >
                  <option value="Site Supervisor">Site Supervisor (Field Inspection)</option>
                  <option value="PM">Project Manager (Operational Intervene)</option>
                  <option value="Owner">Owner / CEO (Executive Decision / High Risk)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Reason for Escalation</label>
                <textarea
                  rows={3}
                  required
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="p-3 bg-purple-50 border border-purple-200 rounded-xl text-xs text-purple-900">
                ⚠️ <strong>Rule 14:</strong> The system escalates responsibility to ensure unblocking. It does
                <strong> not</strong> automatically make the decision.
              </div>

              <div className="flex justify-end space-x-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowEscalateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-purple-900 hover:bg-purple-800 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  Confirm Escalation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
