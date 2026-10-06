/**
 * Working a task against the server: what it is about (links open the record), who reviews
 * it, why it exists (automation rule), status changes with the reason / evidence the server
 * requires, and the server-kept history.
 */
import React, { useState } from 'react';
import { useNW } from '../context/NWContext';
import { NWTask } from '../types';
import { useRecords } from '../services/records';
import { navigateTo } from '../services/navigation';
import { FormError } from './ui/FormError';
import { Button, Input, Pill } from './ui/forms';

type ServerTask = NWTask & {
  variation_id?: string;
  drawing_id?: string;
  drawing_revision_id?: string;
  purchase_order_id?: string;
  delivery_id?: string;
  installation_job_id?: string;
  production_order_id?: string;
  reviewer_id?: string;
  source_rule?: string;
  requires_evidence?: boolean;
  completion_evidence?: string;
  blocked_reason?: string;
  completed_by_name?: string;
  history?: { at: string; by: string; field: string; from: unknown; to: unknown }[];
};

const LINKS: { field: keyof ServerTask; label: string; tab: string; type: string }[] = [
  { field: 'issue_id', label: 'Issue', tab: 'issues', type: 'issue' },
  { field: 'variation_id', label: 'Variation', tab: 'variations', type: 'variation' },
  { field: 'drawing_revision_id', label: 'Drawing revision', tab: 'drawings', type: 'drawing_revision' },
  { field: 'drawing_id', label: 'Drawing', tab: 'drawings', type: 'drawing' },
  { field: 'production_order_id', label: 'Production order', tab: 'production', type: 'production_order' },
  { field: 'purchase_order_id', label: 'Purchase order', tab: 'purchasing', type: 'purchase_order' },
  { field: 'delivery_id', label: 'Delivery', tab: 'delivery', type: 'delivery' },
  { field: 'installation_job_id', label: 'Installation', tab: 'delivery', type: 'installation' },
];

export const TaskWorkPanel: React.FC<{ task: NWTask }> = ({ task: base }) => {
  const task = base as ServerTask;
  const { availableUsers } = useNW();
  const records = useRecords();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'block' | 'complete' | null>(null);
  const [text, setText] = useState('');
  if (!records.live) return null;
  const done = task.status === 'Completed' || task.status === 'Cancelled';
  const reviewer = availableUsers.find((u) => u.id === task.reviewer_id);
  const links = LINKS.filter((l) => task[l.field]);

  const move = async (status: NWTask['status'], extra: Partial<ServerTask> = {}) => {
    setBusy(status);
    setError(null);
    try {
      await records.update<ServerTask>('tasks', task.id, { status, ...extra }, task);
      setMode(null);
      setText('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs" data-testid="task-work-panel">
      <div className="flex flex-wrap items-center gap-2">
        {task.source_rule && <Pill tone="info">Raised by automation: {task.source_rule.replace(/_/g, ' ')}</Pill>}
        {task.requires_evidence && <Pill tone="warn">Completion evidence required</Pill>}
        {reviewer && <span className="text-slate-600">Reviewer: <strong>{reviewer.name}</strong></span>}
        {task.blocked_reason && task.status === 'Blocked' && <Pill tone="bad">Blocked: {task.blocked_reason}</Pill>}
        {task.completion_evidence && <span className="text-slate-600">Evidence: {task.completion_evidence}</span>}
      </div>
      {links.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {links.map((l) => (
            <button
              key={l.field}
              type="button"
              onClick={() => navigateTo(l.tab, task.project_id, { type: l.type, id: String(task[l.field]) })}
              className="rounded-lg border border-slate-300 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 hover:bg-slate-100"
            >
              {l.label} →
            </button>
          ))}
        </div>
      )}
      {!done && (
        <div className="flex flex-wrap items-center gap-1.5">
          {task.status !== 'In Progress' && (
            <Button busy={busy === 'In Progress'} onClick={() => move('In Progress')}>
              Start
            </Button>
          )}
          {task.status !== 'Waiting' && (
            <Button busy={busy === 'Waiting'} onClick={() => move('Waiting')}>
              Waiting
            </Button>
          )}
          <Button tone="danger" onClick={() => setMode(mode === 'block' ? null : 'block')}>
            Blocked…
          </Button>
          <Button tone="success" onClick={() => (task.requires_evidence ? setMode(mode === 'complete' ? null : 'complete') : void move('Completed'))} busy={busy === 'Completed'}>
            Complete{task.requires_evidence ? '…' : ''}
          </Button>
        </div>
      )}
      {mode && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={mode === 'block' ? 'What is blocking it?' : 'What was done (note or photo reference)'}
            aria-label={mode === 'block' ? 'Blocked reason' : 'Completion evidence'}
            className="max-w-md"
          />
          <Button
            tone="primary"
            busy={!!busy}
            onClick={() => (mode === 'block' ? move('Blocked', { blocked_reason: text }) : move('Completed', { completion_evidence: text }))}
          >
            {mode === 'block' ? 'Mark blocked' : 'Mark complete'}
          </Button>
        </div>
      )}
      <FormError error={error} onDismiss={() => setError(null)} />
      {task.history && task.history.length > 0 && (
        <details>
          <summary className="cursor-pointer text-[11px] font-bold text-slate-600">History ({task.history.length})</summary>
          <ul className="mt-1 space-y-0.5 text-[11px] text-slate-600">
            {task.history.map((h, i) => (
              <li key={i}>
                {new Date(h.at).toLocaleString()} — {h.by}: {h.field.replace(/_/g, ' ')} {String(h.from ?? '—')} → {String(h.to ?? '—')}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
};
