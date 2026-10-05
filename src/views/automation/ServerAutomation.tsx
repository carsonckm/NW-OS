/**
 * Server automation rules (human in the loop) and the WhatsApp gateway's server side:
 * contact registry, an inbound test harness running the real pipeline, and the message log.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Bot, MessageCircle, ShieldOff } from 'lucide-react';
import { useNW } from '../../context/NWContext';
import { api } from '../../services/coreApi';
import { actionErrorOf } from '../../services/records';
import { hasPermission } from '../../utils/permissions';
import { FormError } from '../../components/ui/FormError';
import { Button, Field, Input, Pill, Select } from '../../components/ui/forms';

interface RuleRow {
  key: string;
  name: string;
  trigger: string;
  action: string;
  human_in_loop: string;
  watches: string[];
  defaults: Record<string, unknown>;
  enabled: boolean;
  interval_minutes: number;
  config: Record<string, unknown>;
  last_run_at: string | null;
  next_run_at: string | null;
  consecutive_failures: number;
  run_count: number;
  failed_runs: number;
  last_status: string | null;
  last_error: string | null;
  actions_total: number;
}
interface Rules {
  rules: RuleRow[];
  ai_forbidden_actions: string[];
  scheduler: { running: boolean; tick_seconds: number };
  last_run: { notifications: number; tasks: number; escalations: number; ran_at: string } | null;
}
interface Run {
  id: number;
  rule_key: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  actions_taken: number;
  error: string | null;
  retry_count: number;
}
interface AuditRow {
  id: number;
  action: string;
  entity_id: string;
  actor_name: string | null;
  occurred_at: string;
  after: Record<string, unknown> | null;
}

const when = (v: string | null) => (v ? new Date(v).toLocaleString() : '—');
const label = (k: string) => k.replace(/_/g, ' ');

/** One rule: active flag, schedule and thresholds (validated on the server), runs, retry, audit. */
const RuleEditor: React.FC<{ rule: RuleRow; canManage: boolean; onChanged: () => void }> = ({ rule, canManage, onChanged }) => {
  const [open, setOpen] = useState(false);
  const [interval, setInterval] = useState(String(rule.interval_minutes));
  const [config, setConfig] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(rule.config).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)])));
  const [runs, setRuns] = useState<Run[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadDetail = useCallback(async () => {
    const [r, a] = await Promise.all([api.get<Run[]>(`/automation/runs?rule=${encodeURIComponent(rule.key)}`), api.get<AuditRow[]>(`/automation/audit?rule=${encodeURIComponent(rule.key)}`)]);
    setRuns(r.slice(0, 10));
    setAudit(a.slice(0, 10));
  }, [rule.key]);
  useEffect(() => {
    if (open) void loadDetail().catch((err) => setError(actionErrorOf(err).message));
  }, [open, loadDetail]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      if (open) await loadDetail();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const parsed = () =>
    Object.fromEntries(
      Object.entries(config).map(([k, v]) => {
        const d = rule.defaults[k];
        return [k, typeof d === 'number' ? Number(v) : typeof d === 'boolean' ? v === 'true' : Array.isArray(d) ? v.split(',').map((x) => x.trim()).filter(Boolean) : v];
      })
    );
  return (
    <li className="py-2.5" data-testid={`rule-${rule.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <Pill tone={rule.enabled ? 'good' : 'neutral'}>{rule.enabled ? 'Active' : 'Off'}</Pill>
            {rule.consecutive_failures > 0 && <Pill tone="bad">{rule.consecutive_failures} failing</Pill>}
            <span className="text-xs font-bold text-slate-900">{rule.name}</span>
          </div>
          <p className="text-[11px] text-slate-500">
            Every {rule.interval_minutes} min{rule.watches.length ? ' + on changes' : ''} · last {when(rule.last_run_at)} ({rule.last_status ?? 'never'}) · next {when(rule.next_run_at)} · {rule.run_count} runs, {rule.failed_runs} failed, {rule.actions_total} actions
          </p>
        </button>
        {canManage && (
          <div className="flex gap-1.5">
            <Button busy={busy} onClick={() => act(() => api.patch(`/automation/rules/${rule.key}`, { enabled: !rule.enabled }))}>
              {rule.enabled ? 'Turn off' : 'Turn on'}
            </Button>
            <Button busy={busy} onClick={() => act(() => api.post('/automation/run', { rule: rule.key }))}>
              Run now
            </Button>
          </div>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <p><strong>Trigger:</strong> {rule.trigger}</p>
            <p><strong>Actions:</strong> {rule.action}</p>
            <p><strong>Stays with a person:</strong> {rule.human_in_loop}</p>
          </div>
          {rule.watches.length > 0 && <p className="text-[11px] text-slate-500">Runs straight away when these change: {rule.watches.join(', ')}</p>}
          {rule.last_error && <p className="rounded bg-rose-50 p-2 text-[11px] text-rose-800">Last error: {rule.last_error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Field label="Schedule (minutes)">
              <Input type="number" min={1} max={10080} value={interval} disabled={!canManage} onChange={(e) => setInterval(e.target.value)} aria-label={`Interval for ${rule.name}`} />
            </Field>
            {Object.keys(config).map((k) => (
              <Field key={k} label={label(k)}>
                <Input value={config[k]} disabled={!canManage} onChange={(e) => setConfig({ ...config, [k]: e.target.value })} aria-label={`${label(k)} for ${rule.name}`} />
              </Field>
            ))}
          </div>
          {canManage && (
            <Button tone="primary" busy={busy} onClick={() => act(() => api.patch(`/automation/rules/${rule.key}`, { interval_minutes: Number(interval), config: parsed() }))}>
              Save settings
            </Button>
          )}
          <FormError error={error} onDismiss={() => setError(null)} />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div>
              <p className="mb-1 font-bold text-slate-700">Recent runs</p>
              <ul className="space-y-1">
                {runs.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <Pill tone={r.status === 'succeeded' ? 'good' : r.status === 'failed' ? 'bad' : 'info'}>{r.status}</Pill>
                    <span>#{r.id} {r.trigger}{r.retry_count ? ` (retry ${r.retry_count})` : ''} · {when(r.started_at)} · {r.actions_taken} action(s)</span>
                    {r.error && <span className="text-rose-700">{r.error}</span>}
                    {r.status === 'failed' && canManage && (
                      <button type="button" disabled={busy} onClick={() => void act(() => api.post(`/automation/runs/${r.id}/retry`, {}))} className="rounded border border-slate-300 px-1.5 text-[10px] font-bold">
                        Retry
                      </button>
                    )}
                  </li>
                ))}
                {!runs.length && <li className="text-[11px] text-slate-500">No runs yet.</li>}
              </ul>
            </div>
            <div>
              <p className="mb-1 font-bold text-slate-700">Audit</p>
              <ul className="space-y-1">
                {audit.map((a) => (
                  <li key={a.id} className="text-[11px]">
                    {when(a.occurred_at)} · {a.actor_name ?? 'system'} · {a.action.replace('automation.', '')}
                  </li>
                ))}
                {!audit.length && <li className="text-[11px] text-slate-500">No changes recorded.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </li>
  );
};

export const AutomationRulesPanel: React.FC = () => {
  const { authMode, currentUser, coreDataSync } = useNW();
  const [data, setData] = useState<Rules | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canRun = hasPermission(currentUser, 'automation.manage_rules');
  const load = useCallback(async () => {
    try {
      setData(await api.get<Rules>('/automation/rules'));
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    if (authMode && coreDataSync.mode === 'database') void load();
  }, [authMode, coreDataSync.mode, load]);
  if (!authMode || coreDataSync.mode !== 'database') return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/automation/run', {});
      await load();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="automation-rules">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-slate-600" />
          <h3 className="text-sm font-black text-slate-900">Server automation rules</h3>
          <span className="text-[11px] text-slate-500">
            {data ? `Server scheduler ${data.scheduler.running ? `running (every ${data.scheduler.tick_seconds}s)` : 'stopped'}` : ''}
            {data?.last_run ? ` · last 24h: ${data.last_run.notifications} notifications, ${data.last_run.tasks} tasks, ${data.last_run.escalations} escalations` : ''}
          </span>
        </div>
        {canRun && (
          <Button busy={busy} onClick={run}>
            Run all now
          </Button>
        )}
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
      {data && (
        <>
          <ul className="divide-y divide-slate-100">
            {data.rules.map((r) => (
              <RuleEditor key={r.key} rule={r} canManage={canRun} onChanged={() => void load()} />
            ))}
          </ul>
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900">
            <p className="flex items-center gap-1.5 font-bold">
              <ShieldOff className="h-3.5 w-3.5" /> Automation and AI never:
            </p>
            <ul className="mt-1 grid list-disc grid-cols-1 gap-x-6 pl-5 sm:grid-cols-2">
              {data.ai_forbidden_actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
};

interface Contact {
  phone: string;
  user_id: string;
  name: string;
  role: string;
  is_active: boolean;
  verified: boolean;
}
interface Message {
  id: number;
  direction: string;
  phone: string;
  user_id: string | null;
  body: string;
  outcome: string;
  created_at: string;
}
interface ServerUserLite {
  id: string;
  name: string;
  role: string;
}

export const WhatsAppServerGateway: React.FC = () => {
  const { authMode, currentUser, coreDataSync } = useNW();
  const allowed = authMode && coreDataSync.mode === 'database' && hasPermission(currentUser, 'users.manage');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [users, setUsers] = useState<ServerUserLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [text, setText] = useState('status');
  const [reply, setReply] = useState<{ recognized: boolean; reply: string } | null>(null);
  const load = useCallback(async () => {
    try {
      const [c, m, u] = await Promise.all([api.get<Contact[]>('/whatsapp/contacts'), api.get<Message[]>('/whatsapp/messages'), api.get<ServerUserLite[]>('/users')]);
      setContacts(c);
      setMessages(m);
      setUsers(u);
      setUserId((x) => x || u[0]?.id || '');
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  if (!authMode || coreDataSync.mode !== 'database') return null;
  if (!allowed) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600">
        WhatsApp identities are managed by administrators. Messages from numbers that are not registered to an active NW OS user get no project information.
      </div>
    );
  }
  const guard = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  };
  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 text-slate-800 shadow-sm" data-testid="whatsapp-server">
      <div className="flex items-center gap-2">
        <MessageCircle className="h-4 w-4 text-emerald-600" />
        <h3 className="text-sm font-black text-slate-900">WhatsApp gateway (server)</h3>
        <Pill tone="warn">No provider connected</Pill>
      </div>
      <p className="text-[11px] text-slate-500">
        A sender is identified only by a number registered here to an active user, and is answered within that user's role and projects. Unknown numbers get a fixed reply with no project information. Nothing is sent until a provider is connected.
      </p>
      <FormError error={error} onDismiss={() => setError(null)} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <p className="text-xs font-bold">Registered numbers ({contacts.length})</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Phone (with country code)">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+60123456789" aria-label="WhatsApp phone" />
            </Field>
            <Field label="User">
              <Select value={userId} onChange={(e) => setUserId(e.target.value)} aria-label="WhatsApp user">
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </Select>
            </Field>
            <Button tone="primary" onClick={() => guard(() => api.post('/whatsapp/contacts', { phone, user_id: userId }).then(() => setPhone('')))}>
              Register
            </Button>
          </div>
          <ul className="divide-y divide-slate-100 text-xs">
            {contacts.map((c) => (
              <li key={c.phone} className="flex items-center justify-between py-1.5">
                <span>
                  <span className="font-mono">{c.phone}</span> → {c.name} ({c.role}){!c.is_active && ' · deactivated'}
                </span>
                <Button tone="danger" onClick={() => guard(() => api.delete(`/whatsapp/contacts/${encodeURIComponent(c.phone)}`))}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-bold">Test an inbound message</p>
          <div className="flex flex-wrap items-end gap-2">
            <Field label="From">
              <Input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="+60111111111" aria-label="Inbound from" />
            </Field>
            <Field label="Message">
              <Input value={text} onChange={(e) => setText(e.target.value)} aria-label="Inbound text" />
            </Field>
            <Button onClick={() => guard(async () => setReply(await api.post('/whatsapp/simulate-inbound', { from, text })))}>Send test</Button>
          </div>
          {reply && (
            <pre className={`whitespace-pre-wrap rounded-lg border p-2 text-[11px] ${reply.recognized ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`} data-testid="whatsapp-reply">
              {reply.recognized ? 'Recognised. ' : 'Unknown number. '}
              {'\n'}
              {reply.reply}
            </pre>
          )}
          <p className="text-xs font-bold">Message log</p>
          <ul className="max-h-48 divide-y divide-slate-100 overflow-y-auto text-[11px]">
            {messages.map((m) => (
              <li key={m.id} className="py-1">
                <span className="font-mono">{m.direction === 'inbound' ? '←' : '→'} {m.phone}</span> <Pill tone={m.outcome === 'recognized' ? 'good' : m.outcome === 'unknown_contact' ? 'bad' : 'neutral'}>{m.outcome}</Pill> {m.body.slice(0, 80)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};
