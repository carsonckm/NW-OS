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

interface Rules {
  rules: { key: string; name: string; trigger: string; action: string; human_in_loop: string }[];
  ai_forbidden_actions: string[];
  last_run: { notifications: number; tasks: number; ran_at: string } | null;
}

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
            {data?.last_run ? `Last run ${new Date(data.last_run.ran_at).toLocaleTimeString()}: ${data.last_run.notifications} notifications, ${data.last_run.tasks} tasks` : 'Runs automatically when notifications are checked'}
          </span>
        </div>
        {canRun && (
          <Button busy={busy} onClick={run}>
            Run now
          </Button>
        )}
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
      {data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase text-slate-500">
                <tr>
                  <th className="py-1.5 pr-3">Rule</th>
                  <th className="pr-3">When</th>
                  <th className="pr-3">Does</th>
                  <th>Human in the loop</th>
                </tr>
              </thead>
              <tbody>
                {data.rules.map((r) => (
                  <tr key={r.key} className="border-t border-slate-100 align-top">
                    <td className="py-1.5 pr-3 font-bold">{r.name}</td>
                    <td className="pr-3">{r.trigger}</td>
                    <td className="pr-3">{r.action}</td>
                    <td className="text-slate-600">{r.human_in_loop}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
