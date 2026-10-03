import React, { useState } from 'react';
import {
  Zap,
  Plus,
  CheckCircle2,
  AlertTriangle,
  Play,
  RotateCcw,
  Sliders,
  Layers,
  ArrowRight,
  ShieldCheck,
  Check,
  X,
  Clock,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Edit2,
  Trash2,
} from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { AutomationRule, AutomationEventType, UserRole, TaskPriority } from '../../types';

export const WorkflowRulesTab: React.FC = () => {
  const {
    automationRules,
    toggleAutomationRule,
    createAutomationRule,
    triggerAutomationEvent,
    projects,
    currentUser,
  } = useNW();

  const [selectedRuleId, setSelectedRuleId] = useState<string>(automationRules[0]?.id || '');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [testFeedback, setTestFeedback] = useState<string | null>(null);

  // New rule builder form state
  const [newRuleData, setNewRuleData] = useState<{
    name: string;
    description: string;
    trigger_event: AutomationEventType;
    condition_field: string;
    condition_operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_not_empty';
    condition_value: string;
    action_type: any;
    assign_to_role: UserRole;
    deadline_hours: number;
    escalate_to_role: UserRole;
    priority: TaskPriority;
    applies_to_projects: string;
  }>({
    name: 'Escalate Unanswered Contractor Questions',
    description: 'When technical RFI remains unanswered over 2 hours, trigger prompt inspection task.',
    trigger_event: 'issue.unresolved',
    condition_field: 'unresolved_hours',
    condition_operator: 'greater_than',
    condition_value: '2',
    action_type: 'create_task',
    assign_to_role: 'Site Supervisor',
    deadline_hours: 2,
    escalate_to_role: 'Project Manager',
    priority: 'High',
    applies_to_projects: 'all',
  });

  const selectedRule =
    automationRules.find((r) => r.id === selectedRuleId) || automationRules[0];

  const handleTestDryRun = (rule: AutomationRule) => {
    triggerAutomationEvent(
      rule.trigger_event,
      'System Automation',
      'SIM-TEST-' + Date.now().toString().slice(-4),
      projects[0]?.id || 'proj-1',
      {
        work_item_code: 'CAR-003',
        contractor_name: 'Hock Seng Carpentry',
        status: 'Completed',
        shortage_quantity: 5,
        priority: 'High',
        unresolved_hours: 3,
        delivery_status: 'Received / Confirmed',
        revision_number: 'Rev 2',
      }
    );

    setTestFeedback(
      `✓ Test event simulated for rule "${rule.name}". Action triggered and logged into Automation History.`
    );
    setTimeout(() => setTestFeedback(null), 5000);
  };

  const handleCreateRuleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAutomationRule({
      name: newRuleData.name,
      description: newRuleData.description,
      trigger_event: newRuleData.trigger_event,
      conditions: [
        {
          field: newRuleData.condition_field,
          operator: newRuleData.condition_operator,
          value: newRuleData.condition_value,
        },
      ],
      condition_logic: 'AND',
      actions: [
        {
          action_type: newRuleData.action_type,
          target_role: newRuleData.assign_to_role,
          priority: newRuleData.priority,
          deadline_hours: newRuleData.deadline_hours,
          escalate_to_role: newRuleData.escalate_to_role,
        },
      ],
      assign_to_role: newRuleData.assign_to_role,
      deadline_hours: newRuleData.deadline_hours,
      escalate_to_role: newRuleData.escalate_to_role,
      is_active: true,
      is_draft: false,
      priority: newRuleData.priority,
      applies_to_projects: newRuleData.applies_to_projects === 'all' ? ['all'] : [newRuleData.applies_to_projects],
    });

    setShowCreateModal(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1.5 bg-amber-100 text-amber-900 rounded-lg">
              <Zap className="w-4 h-4 text-amber-600" />
            </span>
            <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Company Workflow Rules & Automation Engine
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Configurable IF / THEN rules routing tasks, deadlines, and tiered escalations across company operations.
          </p>
        </div>

        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center space-x-2 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4 text-amber-400" />
          <span>Build New Rule</span>
        </button>
      </div>

      {testFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-xl text-xs text-emerald-900 font-bold flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{testFeedback}</span>
          </div>
          <button onClick={() => setTestFeedback(null)} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>
      )}

      {/* 2-Column Rules Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Rule Cards Listing (6 cols) */}
        <div className="lg:col-span-6 space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500 px-1 font-bold">
            <span>Configured Rules ({automationRules.length})</span>
            <span>Rules 1 to 10 Pre-loaded</span>
          </div>

          <div className="space-y-3">
            {automationRules.map((rule) => {
              const isSelected = selectedRule?.id === rule.id;
              return (
                <div
                  key={rule.id}
                  onClick={() => setSelectedRuleId(rule.id)}
                  className={`p-4 rounded-xl border transition-all cursor-pointer space-y-3 ${
                    isSelected
                      ? 'bg-amber-50/60 border-amber-400 shadow-sm ring-1 ring-amber-400'
                      : 'bg-white border-slate-200 hover:border-slate-300 shadow-xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono text-xs font-black px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200">
                        {rule.rule_code}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                          rule.priority === 'Critical'
                            ? 'bg-rose-100 text-rose-900'
                            : rule.priority === 'High'
                            ? 'bg-amber-100 text-amber-900'
                            : 'bg-blue-100 text-blue-900'
                        }`}
                      >
                        {rule.priority}
                      </span>
                    </div>

                    {/* Active Toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleAutomationRule(rule.id);
                      }}
                      className="cursor-pointer"
                      title={rule.is_active ? 'Click to Deactivate' : 'Click to Activate'}
                    >
                      {rule.is_active ? (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-black">
                          <Check className="w-3 h-3" />
                          <span>Active</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold">
                          <span>Paused</span>
                        </span>
                      )}
                    </button>
                  </div>

                  <div>
                    <h4 className="text-xs font-bold text-slate-900">{rule.name}</h4>
                    <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                      {rule.description}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-600">
                    <span className="font-mono text-slate-500">Trigger: {rule.trigger_event}</span>
                    <span className="font-bold text-slate-800">
                      SLA: {rule.deadline_hours}h → {rule.escalate_to_role}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Column: Rule Anatomy & Logic Inspector (6 cols) */}
        <div className="lg:col-span-6">
          {selectedRule ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 shadow-xs space-y-6">
              <div className="flex items-start justify-between border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-mono text-xs font-black text-amber-700">
                      {selectedRule.rule_code}
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        selectedRule.is_active
                          ? 'bg-emerald-100 text-emerald-900'
                          : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {selectedRule.is_active ? 'Active Engine Rule' : 'Inactive Draft'}
                    </span>
                  </div>
                  <h3 className="text-base font-black text-slate-900 mt-1">{selectedRule.name}</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedRule.description}</p>
                </div>

                <button
                  onClick={() => handleTestDryRun(selectedRule)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold flex items-center space-x-1 transition-all shadow-xs cursor-pointer shrink-0"
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Dry-Run Test</span>
                </button>
              </div>

              {/* Anatomy Flow (Section 4) */}
              <div className="space-y-4 text-xs">
                {/* 1. Trigger Event */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    1. WHEN (Trigger Event)
                  </span>
                  <div className="font-mono font-bold text-slate-900 flex items-center space-x-1.5">
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                    <span>{selectedRule.trigger_event}</span>
                  </div>
                </div>

                {/* 2. Conditions */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      2. IF (Conditions — {selectedRule.condition_logic} Logic)
                    </span>
                    <span className="text-[10px] font-bold text-slate-500">
                      {selectedRule.conditions.length} condition(s)
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    {selectedRule.conditions.map((c, i) => (
                      <div
                        key={i}
                        className="bg-white p-2 rounded-lg border border-slate-200 font-mono text-[11px] text-slate-800 flex items-center space-x-2"
                      >
                        <span className="text-amber-700 font-bold">{c.field}</span>
                        <span className="text-slate-400">{c.operator}</span>
                        <span className="text-slate-900 font-bold">
                          {c.value === null ? 'EXISTS' : String(c.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Actions */}
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                    3. THEN (Automated Actions)
                  </span>

                  <div className="space-y-1.5">
                    {selectedRule.actions.map((act, i) => (
                      <div
                        key={i}
                        className="bg-white p-2.5 rounded-lg border border-slate-200 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-slate-900 uppercase text-[10px]">
                            {act.action_type.replace('_', ' ')}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-800 font-semibold">
                            Target: {act.target_role || selectedRule.assign_to_role}
                          </span>
                        </div>
                        {act.template_title && (
                          <div className="text-[11px] font-bold text-slate-800">{act.template_title}</div>
                        )}
                        {act.template_message && (
                          <div className="text-[10px] text-slate-500">{act.template_message}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. SLA & Escalation */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      4. DEADLINE SLA
                    </span>
                    <span className="text-base font-black text-slate-900 flex items-center space-x-1">
                      <Clock className="w-4 h-4 text-slate-400" />
                      <span>{selectedRule.deadline_hours} Hours</span>
                    </span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                      5. ESCALATE TO
                    </span>
                    <span className="text-sm font-black text-purple-900">
                      {selectedRule.escalate_to_role}
                    </span>
                  </div>
                </div>

                {/* Section 30 Principle Reminder */}
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 space-y-1">
                  <span className="font-black block uppercase text-[10px] tracking-wide">
                    Section 30: Human-in-the-Loop Principle
                  </span>
                  <p className="text-[11px] text-amber-800 leading-relaxed">
                    Automation creates draft tasks, detects anomalies, and sends notifications. It will{' '}
                    <strong>never</strong> automatically approve variations, modify contracted value, or substitute
                    materials without human verification.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">
              Select a rule from the left panel.
            </div>
          )}
        </div>
      </div>

      {/* Build New Rule Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-xl overflow-hidden animate-in fade-in zoom-in duration-200">
            <div className="bg-slate-900 text-white p-4 flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-400" />
                <span>Build New Automation Rule (Section 27)</span>
              </h3>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRuleSubmit} className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Rule Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Escalate Unanswered Contractor Questions"
                  value={newRuleData.name}
                  onChange={(e) => setNewRuleData({ ...newRuleData, name: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Description</label>
                <textarea
                  rows={2}
                  value={newRuleData.description}
                  onChange={(e) => setNewRuleData({ ...newRuleData, description: e.target.value })}
                  className="w-full text-xs p-2.5 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">1. Trigger Event (WHEN)</label>
                  <select
                    value={newRuleData.trigger_event}
                    onChange={(e) => setNewRuleData({ ...newRuleData, trigger_event: e.target.value as any })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
                  >
                    <option value="issue.unresolved">issue.unresolved</option>
                    <option value="work_item.work_completed">work_item.work_completed</option>
                    <option value="qc.failed">qc.failed</option>
                    <option value="purchasing.material_shortage">purchasing.material_shortage</option>
                    <option value="drawing.revision_uploaded">drawing.revision_uploaded</option>
                    <option value="delivery.received">delivery.received</option>
                    <option value="client.request_received">client.request_received</option>
                    <option value="payment.overdue">payment.overdue</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Priority</label>
                  <select
                    value={newRuleData.priority}
                    onChange={(e) => setNewRuleData({ ...newRuleData, priority: e.target.value as TaskPriority })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="Normal">Normal</option>
                    <option value="High">High</option>
                    <option value="Urgent">Urgent</option>
                    <option value="Critical">Critical 🔴</option>
                  </select>
                </div>
              </div>

              {/* Conditions Box */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                <span className="text-[10px] font-bold uppercase text-slate-500 block">
                  2. IF Condition (Field + Operator + Value)
                </span>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="Field (e.g. status)"
                    value={newRuleData.condition_field}
                    onChange={(e) => setNewRuleData({ ...newRuleData, condition_field: e.target.value })}
                    className="text-xs p-2 bg-white border border-slate-300 rounded-lg font-mono"
                  />
                  <select
                    value={newRuleData.condition_operator}
                    onChange={(e) => setNewRuleData({ ...newRuleData, condition_operator: e.target.value as any })}
                    className="text-xs p-2 bg-white border border-slate-300 rounded-lg font-mono"
                  >
                    <option value="equals">equals</option>
                    <option value="not_equals">not_equals</option>
                    <option value="contains">contains</option>
                    <option value="greater_than">greater_than</option>
                    <option value="less_than">less_than</option>
                    <option value="is_not_empty">is_not_empty</option>
                  </select>
                  <input
                    type="text"
                    placeholder="Value (e.g. 2)"
                    value={newRuleData.condition_value}
                    onChange={(e) => setNewRuleData({ ...newRuleData, condition_value: e.target.value })}
                    className="text-xs p-2 bg-white border border-slate-300 rounded-lg font-mono"
                  />
                </div>
              </div>

              {/* Action, Assignment, Deadline, Escalation */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">3. Automated Action</label>
                  <select
                    value={newRuleData.action_type}
                    onChange={(e) => setNewRuleData({ ...newRuleData, action_type: e.target.value })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="create_task">Create Workflow Task</option>
                    <option value="create_qc_task">Create QC Task</option>
                    <option value="create_material_request">Create Material Request</option>
                    <option value="create_variation_review">Create Variation Review</option>
                    <option value="escalate">Escalate Immediately</option>
                    <option value="send_notification">Send Notification</option>
                    <option value="send_whatsapp">Send WhatsApp Notice</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">Assign Responsible Role</label>
                  <select
                    value={newRuleData.assign_to_role}
                    onChange={(e) => setNewRuleData({ ...newRuleData, assign_to_role: e.target.value as UserRole })}
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
                  <label className="block text-xs font-bold text-slate-700 mb-1">Response Deadline (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    value={newRuleData.deadline_hours}
                    onChange={(e) => setNewRuleData({ ...newRuleData, deadline_hours: parseInt(e.target.value) || 2 })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">If Unresolved, Escalate To</label>
                  <select
                    value={newRuleData.escalate_to_role}
                    onChange={(e) => setNewRuleData({ ...newRuleData, escalate_to_role: e.target.value as UserRole })}
                    className="w-full text-xs p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="Project Manager">Project Manager</option>
                    <option value="Owner / CEO">Owner / CEO</option>
                    <option value="Site Supervisor">Site Supervisor</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-bold shadow-xs"
                >
                  Save & Activate Rule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
