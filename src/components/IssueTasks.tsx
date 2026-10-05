/**
 * Issue -> task link. An issue lists the tasks raised from it and can raise a new one; the
 * server validates the link (same project, immutable) and refuses to resolve the issue while
 * any of its tasks is still open.
 */
import React, { useState } from 'react';
import { ListChecks, Plus } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { Issue, NWTask, TaskPriority, UserRole } from '../types';
import { useRecords } from '../services/records';
import { navigateTo } from '../services/navigation';
import { FormError } from './ui/FormError';
import { Button, Field, Input, Pill, Select, TextArea, addDays, newId, today } from './ui/forms';

const DONE = new Set(['Completed', 'Cancelled']);
const statusTone = (s: string) => (s === 'Completed' ? 'good' : s === 'Cancelled' ? 'neutral' : s === 'Overdue' || s === 'Blocked' ? 'bad' : 'warn');

export const openTasksOf = (tasks: NWTask[], issueId: string) => tasks.filter((t) => t.issue_id === issueId && !DONE.has(t.status));

export const IssueTasksPanel: React.FC<{ issue: Issue }> = ({ issue }) => {
  const { tasks, availableUsers, projects, workItems, currentUser } = useNW();
  const records = useRecords();
  const linked = tasks.filter((t) => t.issue_id === issue.id);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const staff = availableUsers.filter((u) => u.role !== 'Client');
  const [form, setForm] = useState({
    title: '',
    description: issue.action_required ?? '',
    assignee: staff.find((u) => u.role === 'Site Supervisor')?.id ?? staff[0]?.id ?? '',
    priority: (issue.priority === 'Critical' ? 'Critical' : issue.priority === 'High' ? 'High' : 'Normal') as TaskPriority,
    due_date: addDays(today(), 3),
  });

  const create = async () => {
    const user = staff.find((u) => u.id === form.assignee);
    if (!form.title.trim() || !user) return setError('Give the task a title and an assignee.');
    const item = workItems.find((w) => w.id === issue.work_item_id);
    setBusy('create');
    setError(null);
    try {
      const id = newId('tsk');
      await records.create<NWTask>('tasks', {
        id,
        task_number: `TSK-${id.slice(4, 12).toUpperCase()}`,
        issue_id: issue.id,
        title: form.title.trim(),
        description: form.description,
        project_id: issue.project_id,
        project_name: projects.find((p) => p.id === issue.project_id)?.project_name ?? '',
        work_item_id: issue.work_item_id,
        work_item_code: item?.item_code,
        source_event: `Raised from issue: ${issue.title}`,
        source_module: 'PM',
        source_reason: issue.title,
        assigned_user_id: user.id,
        assigned_user_name: user.name,
        assigned_role: user.role as UserRole,
        priority: form.priority,
        due_date: form.due_date,
        status: 'Open',
        created_date: new Date().toISOString(),
        escalation_level: 'None',
        comments: [],
        attachments: [],
      });
      setAdding(false);
      setForm((f) => ({ ...f, title: '' }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const complete = async (t: NWTask) => {
    const needs = (t as NWTask & { requires_evidence?: boolean }).requires_evidence;
    if (needs && !evidence[t.id]?.trim()) return setError(`Add what was done for "${t.title}" (a note or photo reference) before marking it done.`);
    setBusy(t.id);
    setError(null);
    try {
      await records.update<NWTask & { completion_evidence?: string }>('tasks', t.id, { status: 'Completed', completed_date: new Date().toISOString(), ...(needs ? { completion_evidence: evidence[t.id] } : {}) }, t);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid="issue-tasks">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
          <ListChecks className="h-4 w-4 text-slate-500" /> Tasks raised from this issue ({linked.length})
        </span>
        {!adding && currentUser.role !== 'Client' && (
          <Button onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" /> Create task
          </Button>
        )}
      </div>
      {linked.length === 0 && !adding && <p className="text-[11px] text-slate-500">No tasks yet. Raise one to get the issue fixed; the issue can only be resolved once its tasks are done.</p>}
      {linked.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-2.5 py-1.5 text-xs">
          <div>
            <span className="font-bold text-slate-900">{t.title}</span>
            <span className="ml-2 text-[11px] text-slate-500">
              {t.task_number} · {t.assigned_user_name} ({t.assigned_role}) · due {t.due_date}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Pill tone={statusTone(t.status)}>{t.status}</Pill>
            {!DONE.has(t.status) && (t as NWTask & { requires_evidence?: boolean }).requires_evidence && (
              <Input
                value={evidence[t.id] ?? ''}
                onChange={(e) => setEvidence({ ...evidence, [t.id]: e.target.value })}
                placeholder="What was done"
                aria-label={`Evidence for ${t.title}`}
                className="w-48"
              />
            )}
            {!DONE.has(t.status) && (
              <Button tone="success" busy={busy === t.id} onClick={() => complete(t)}>
                Mark done
              </Button>
            )}
            <button type="button" className="text-[11px] font-bold text-amber-700 hover:underline" onClick={() => navigateTo('automation', t.project_id)}>
              Open in tasks
            </button>
          </div>
        </div>
      ))}
      {adding && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-2.5">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Task">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Re-measure counter opening" aria-label="Task title" />
            </Field>
            <Field label="Assign to">
              <Select value={form.assignee} onChange={(e) => setForm({ ...form, assignee: e.target.value })} aria-label="Assign to">
                {staff.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
                {['Low', 'Normal', 'High', 'Urgent', 'Critical'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </Select>
            </Field>
            <Field label="Due">
              <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
            </Field>
          </div>
          <Field label="What needs doing">
            <TextArea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button tone="primary" busy={busy === 'create'} onClick={create}>
              Create linked task
            </Button>
          </div>
        </div>
      )}
      <FormError error={error} onDismiss={() => setError(null)} />
    </div>
  );
};

/** On a task: the issue it was raised from. */
export const TaskOriginIssue: React.FC<{ task: NWTask }> = ({ task }) => {
  const { issues } = useNW();
  if (!task.issue_id) return null;
  const issue = issues.find((i) => i.id === task.issue_id);
  return (
    <button
      type="button"
      onClick={() => navigateTo('issues', task.project_id)}
      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800 hover:bg-rose-100"
      data-testid="task-origin-issue"
    >
      Raised from issue: {issue ? `${issue.title} (${issue.status})` : task.issue_id}
    </button>
  );
};
