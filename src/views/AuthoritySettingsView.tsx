/**
 * Settings → Delegated Authority (Phase 6 Batch 3). The Owner sees and manages who may approve
 * what; the Admin may look. Everything shown comes from the server (rule summaries, warnings,
 * impact, validation); this screen holds no authority logic. Saving goes through the server's
 * validation and is audited; approvals are still decided by the authority resolver.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { hasPermission, ROLE_DEFINITIONS } from '../utils/permissions';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { FormError } from '../components/ui/FormError';
import { ApprovalSlaSettings } from '../components/ApprovalSlaSettings';
import { AbsencePanel, CoveragePanel, TemporaryAuthorityPanel } from '../components/authority/CoverageAbsencePanels';
import { Button, Field, Input, Modal, Pill, Section, Select, TextArea } from '../components/ui/forms';

type Row = Record<string, any>;
const RISKS = ['On Track', 'Attention', 'At Risk', 'Critical'];
const DELEGATE_ROLES = Object.keys(ROLE_DEFINITIONS).filter((r) => !['Owner / CEO', 'Client', 'Contractor'].includes(r));
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '—');
const money = (v: unknown) => (v == null ? null : `RM ${Number(v).toLocaleString('en-US')}`);
const range = (r: Row) => (r.min_value == null && r.max_value == null ? 'Any' : `${money(r.min_value) ?? 'RM 0'} – ${money(r.max_value) ?? 'any'}`);
const target = (r: Row) => (r.target_user_id ? `${r.target_user_name ?? r.target_user_id}${r.target_role ? ` (${r.target_role})` : ''}` : r.target_role ? r.target_role : r.target_permission ? `Holders of ${r.target_permission}` : r.effect === 'require_owner' ? 'Owner required' : '—');
const status = (r: Row, now = Date.now()) => (!r.active ? 'Inactive' : r.start_at && Date.parse(r.start_at) > now ? 'Not started' : r.end_at && Date.parse(r.end_at) <= now ? 'Ended' : 'Active');
const SENS_TONE: Record<string, 'neutral' | 'warn' | 'bad'> = { Normal: 'neutral', Sensitive: 'warn', Strategic: 'bad' };

export const AuthoritySettingsView: React.FC = () => {
  const { currentUser, coreDataSync, projects, clients } = useNW();
  const canManage = hasPermission(currentUser, 'authority.manage');
  const [tab, setTab] = useState<'overview' | 'rules' | 'projects' | 'sla' | 'coverage' | 'temporary' | 'absence'>('overview');
  const [overview, setOverview] = useState<Row | null>(null);
  const [rules, setRules] = useState<Row[]>([]);
  const [types, setTypes] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [editing, setEditing] = useState<Row | 'new' | null>(null);
  const [sensitivityFor, setSensitivityFor] = useState<Row | null>(null);
  const [rerun, setRerun] = useState<{ busy: boolean; result?: Row }>({ busy: false });
  const rerunRouting = async () => {
    setRerun({ busy: true });
    try {
      const result = await api.post<Row>('/approval-routing/reevaluate', {});
      setRerun({ busy: false, result });
      await reload();
    } catch (err) {
      setRerun({ busy: false });
      setError(actionErrorOf(err).message);
    }
  };

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [o, r, t] = await Promise.all([api.get<Row>('/authority/overview'), api.get<Row[]>('/authority/rules'), api.get<Row[]>('/authority/decision-types')]);
      setOverview(o);
      setRules(r);
      setTypes(t);
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    if (coreDataSync.mode === 'database') void reload();
  }, [coreDataSync.mode, reload]);

  if (coreDataSync.mode !== 'database') {
    return <Section title="Delegated Authority">Delegated authority is managed on the live system (sign in with the database). Demo mode has nothing to manage.</Section>;
  }

  return (
    <div className="space-y-4" data-testid="authority-settings">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-amber-600" />
          <div>
            <h2 className="text-lg font-black text-slate-900">Delegated Authority</h2>
            <p className="text-xs text-slate-500">Who may approve what, and where approvals are routed. {canManage ? 'Every change needs a reason and is audited.' : 'View only — the Owner makes changes.'}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button busy={rerun.busy} onClick={() => void rerunRouting()} data-testid="rerun-routing" title="Route every pending approval again against current authority (for example after a rule expired)">
            Re-run routing
          </Button>
          {(['overview', 'rules', 'coverage', 'temporary', 'absence', 'projects', 'sla'] as const).map((t) => (
            <Button key={t} tone={tab === t ? 'primary' : 'secondary'} onClick={() => setTab(t)}>
              {t === 'overview' ? 'Overview' : t === 'rules' ? `Rules (${rules.length})` : t === 'coverage' ? 'Coverage' : t === 'temporary' ? 'Temporary' : t === 'absence' ? 'Absence' : t === 'projects' ? 'Project sensitivity' : 'SLAs & Owner routing'}
            </Button>
          ))}
        </div>
      </div>
      <FormError error={error} onDismiss={() => setError(null)} />
      {rerun.result && (
        <p className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900" data-testid="rerun-result">
          Routing re-run: {rerun.result.checked} pending approvals checked, {rerun.result.rerouted} re-routed, {rerun.result.created} newly routed, {rerun.result.closed} closed.
        </p>
      )}
      {tab === 'overview' && overview && <Overview o={overview} onOpenRule={(code) => setSelected(rules.find((r) => r.code === code) ?? null)} />}
      {tab === 'rules' && <RulesTable rules={rules} types={types} overview={overview} canManage={canManage} onOpen={setSelected} onNew={() => setEditing('new')} />}
      {tab === 'sla' && <ApprovalSlaSettings canManage={canManage} />}
      {tab === 'coverage' && <CoveragePanel />}
      {tab === 'temporary' && <TemporaryAuthorityPanel canManage={canManage && currentUser.role === 'Owner / CEO'} />}
      {tab === 'absence' && <AbsencePanel canManage={canManage && currentUser.role === 'Owner / CEO'} />}
      {tab === 'projects' && overview && <ProjectsTable projects={overview.projects} canManage={canManage} onChange={setSensitivityFor} />}
      {selected && (
        <RuleDetail
          rule={selected}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onEdit={() => {
            setEditing(selected);
            setSelected(null);
          }}
          onChanged={async () => {
            await reload();
            setSelected(null);
          }}
        />
      )}
      {editing && (
        <RuleForm
          rule={editing === 'new' ? null : editing}
          types={types}
          projects={projects as unknown as Row[]}
          clients={clients as unknown as Row[]}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
      {sensitivityFor && (
        <SensitivityModal
          project={sensitivityFor}
          onClose={() => setSensitivityFor(null)}
          onSaved={async () => {
            setSensitivityFor(null);
            await reload();
          }}
        />
      )}
    </div>
  );
};

const Card: React.FC<{ label: string; value: React.ReactNode; tone?: string; testId?: string }> = ({ label, value, tone = 'text-slate-900', testId }) => (
  <div className="rounded-2xl border border-slate-200 bg-white p-4" data-testid={testId}>
    <div className="text-[10px] font-extrabold uppercase text-slate-400">{label}</div>
    <div className={`text-xl font-black ${tone}`}>{value}</div>
  </div>
);

const Overview: React.FC<{ o: Row; onOpenRule: (code: string) => void }> = ({ o, onOpenRule }) => {
  const c = o.counts;
  const pct = c.pending_approvals ? Math.round((c.pending_delegated / c.pending_approvals) * 100) : 0;
  return (
    <div className="space-y-4" data-testid="authority-overview">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Card label="Active delegated rules" value={c.owner_rules_active} testId="ov-active-rules" />
        <Card label="Owner rules (all)" value={c.owner_rules} />
        <Card label="System Policies (active)" value={`${c.system_policies_active} / ${c.system_policies}`} />
        <Card label="Inactive rules" value={c.inactive} />
        <Card label={`Expiring in ${o.expiring_window_days} days`} value={c.expiring_soon} tone={c.expiring_soon ? 'text-amber-700' : undefined} />
        <Card label="Overridden by sensitivity" value={c.overridden_by_sensitivity} tone={c.overridden_by_sensitivity ? 'text-amber-700' : undefined} />
        <Card label="Sensitive / Strategic projects" value={`${c.sensitive_projects} / ${c.strategic_projects}`} />
        <Card label="Pending approvals" value={c.pending_approvals} />
        <Card label="Waiting for the Owner" value={c.pending_to_owner} tone="text-rose-700" testId="ov-owner-queue" />
        <Card label="Routed to delegates" value={`${c.pending_delegated} (${pct}%)`} tone="text-emerald-700" testId="ov-delegated" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Why approvals wait for the Owner" subtitle="Open approvals routed to the Owner, by the reason delegation was not available">
          {o.owner_queue_by_reason.length ? (
            <ul className="space-y-1 text-xs">
              {o.owner_queue_by_reason.map((r: Row) => (
                <li key={r.key} className="flex justify-between">
                  <span className="font-mono">{r.key}</span>
                  <span className="font-bold">{r.count}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">Nothing is waiting for the Owner.</p>
          )}
        </Section>
        <Section title="Delegated coverage" subtitle="Open approvals by how they were routed">
          <ul className="space-y-1 text-xs">
            {o.coverage_by_basis.map((r: Row) => (
              <li key={r.key} className="flex justify-between">
                <span className="font-mono">{r.key}</span>
                <span className="font-bold">{r.count}</span>
              </li>
            ))}
          </ul>
        </Section>
        <Section title="Only the Owner can approve these today" subtitle="Decision types no rule delegates to anyone else">
          {o.owner_only_types.length ? <div className="flex flex-wrap gap-1">{o.owner_only_types.map((t: Row) => <Pill key={t.key} tone="warn">{t.label}</Pill>)}</div> : <p className="text-xs text-slate-500">Every decision type is delegated to someone.</p>}
        </Section>
        <Section title="Rules overridden by project sensitivity" subtitle="Allow rules that do not apply on Sensitive / Strategic projects">
          {o.overridden_by_sensitivity.length ? (
            <ul className="space-y-1 text-xs">
              {o.overridden_by_sensitivity.map((r: Row) => (
                <li key={r.code}>
                  <button type="button" className="font-bold text-amber-800 underline" onClick={() => onOpenRule(r.code)}>
                    {r.code}
                  </button>{' '}
                  {r.name}: {r.projects.join(', ')}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">None.</p>
          )}
        </Section>
        <Section title="Expiring soon">
          {o.expiring_soon.length ? (
            <ul className="space-y-1 text-xs">
              {o.expiring_soon.map((r: Row) => (
                <li key={r.id}>
                  <button type="button" className="font-bold underline" onClick={() => onOpenRule(r.code)}>
                    {r.code}
                  </button>{' '}
                  ends {day(r.end_at)} — {r.summary}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">No rule ends in the next {o.expiring_window_days} days.</p>
          )}
        </Section>
        <Section title="Inactive rules">
          {o.inactive.length ? (
            <ul className="space-y-1 text-xs">
              {o.inactive.map((r: Row) => (
                <li key={r.id}>
                  <button type="button" className="font-bold underline" onClick={() => onOpenRule(r.code)}>
                    {r.code}
                  </button>{' '}
                  {r.name}
                  {r.deactivation_reason ? ` — ${r.deactivation_reason}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500">None.</p>
          )}
        </Section>
      </div>
    </div>
  );
};

const RulesTable: React.FC<{ rules: Row[]; types: Row[]; overview: Row | null; canManage: boolean; onOpen: (r: Row) => void; onNew: () => void }> = ({ rules, types, overview, canManage, onOpen, onNew }) => {
  const [f, setF] = useState({ q: '', type: '', status: '', kind: '', effect: '', role: '', user: '', project: '', client: '', expiring: false, overridden: false });
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const overriddenCodes = new Set((overview?.overridden_by_sensitivity ?? []).map((r: Row) => r.code));
  const expiringCodes = new Set((overview?.expiring_soon ?? []).map((r: Row) => r.code));
  const opts = (key: string, label: (r: Row) => string | null) => [...new Map(rules.filter((r) => r[key]).map((r) => [r[key], label(r)])).entries()];
  const shown = useMemo(
    () =>
      rules.filter((r) => {
        const q = f.q.toLowerCase();
        if (q && !`${r.name} ${r.code} ${r.summary} ${r.description}`.toLowerCase().includes(q)) return false;
        if (f.type && r.decision_type !== f.type) return false;
        if (f.status && status(r) !== f.status) return false;
        if (f.kind && r.kind !== f.kind) return false;
        if (f.effect && r.effect !== f.effect) return false;
        if (f.role && r.target_role !== f.role) return false;
        if (f.user && r.target_user_id !== f.user) return false;
        if (f.project && r.project_id !== f.project) return false;
        if (f.client && r.client_id !== f.client) return false;
        if (f.expiring && !expiringCodes.has(r.code)) return false;
        if (f.overridden && !overriddenCodes.has(r.code)) return false;
        return true;
      }),
    [rules, f] // eslint-disable-line react-hooks/exhaustive-deps
  );
  return (
    <Section
      title="Authority rules"
      subtitle="System Policy records today's built-in rules; Owner rules delegate decisions. Click a rule for details."
      actions={canManage && (
        <Button tone="primary" onClick={onNew}>
          New delegated authority
        </Button>
      )}
    >
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Input placeholder="Search rules…" aria-label="Search rules" value={f.q} onChange={(e) => set('q', e.target.value)} />
        <Select aria-label="Filter decision type" value={f.type} onChange={(e) => set('type', e.target.value)}>
          <option value="">All decision types</option>
          {types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </Select>
        <Select aria-label="Filter status" value={f.status} onChange={(e) => set('status', e.target.value)}>
          <option value="">Any status</option>
          {['Active', 'Inactive', 'Not started', 'Ended'].map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select aria-label="Filter kind" value={f.kind} onChange={(e) => set('kind', e.target.value)}>
          <option value="">System Policy and Owner</option>
          <option value="system">System Policy</option>
          <option value="owner">Owner rules</option>
        </Select>
        <Select aria-label="Filter effect" value={f.effect} onChange={(e) => set('effect', e.target.value)}>
          <option value="">Any effect</option>
          <option value="allow">Allows approval</option>
          <option value="require_owner">Requires the Owner</option>
        </Select>
        <Select aria-label="Filter role" value={f.role} onChange={(e) => set('role', e.target.value)}>
          <option value="">Any role</option>
          {opts('target_role', (r) => r.target_role).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Filter user" value={f.user} onChange={(e) => set('user', e.target.value)}>
          <option value="">Any user</option>
          {opts('target_user_id', (r) => r.target_user_name ?? r.target_user_id).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Filter project" value={f.project} onChange={(e) => set('project', e.target.value)}>
          <option value="">Any project</option>
          {opts('project_id', (r) => r.project_name ?? r.project_id).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select aria-label="Filter client" value={f.client} onChange={(e) => set('client', e.target.value)}>
          <option value="">Any client</option>
          {opts('client_id', (r) => r.client_name ?? r.client_id).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.expiring} onChange={(e) => set('expiring', e.target.checked)} /> Expiring soon</label>
        <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={f.overridden} onChange={(e) => set('overridden', e.target.checked)} /> Overridden by sensitivity</label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] text-left text-xs" data-testid="authority-rules">
          <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
            <tr>
              {['Rule', 'Code', 'Decision', 'Target', 'Project', 'Client', 'Value', 'Max risk', 'Start', 'End', 'Priority', 'Effect', 'Kind', 'Status', 'Created by', 'Last changed', 'Reason'].map((h) => (
                <th key={h} className="px-2 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {shown.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-amber-50" onClick={() => onOpen(r)} data-testid={`rule-${r.code}`}>
                <td className="px-2 py-2 font-bold text-slate-900">{r.name}</td>
                <td className="px-2 py-2 font-mono">{r.code}</td>
                <td className="px-2 py-2">{r.decision_type_label}</td>
                <td className="px-2 py-2">{target(r)}</td>
                <td className="px-2 py-2">{r.project_name ?? '—'}</td>
                <td className="px-2 py-2">{r.client_name ?? '—'}</td>
                <td className="px-2 py-2">{range(r)}</td>
                <td className="px-2 py-2">{r.max_risk ?? '—'}</td>
                <td className="px-2 py-2">{day(r.start_at)}</td>
                <td className="px-2 py-2">{day(r.end_at)}</td>
                <td className="px-2 py-2">{r.priority}</td>
                <td className="px-2 py-2">{r.effect === 'allow' ? 'Allows' : 'Requires Owner'}</td>
                <td className="px-2 py-2">{r.kind === 'system' ? <Pill tone="info">SYSTEM POLICY</Pill> : <Pill>Owner</Pill>}{r.locked && <span className="ml-1"><Pill tone="bad">LOCKED</Pill></span>}</td>
                <td className="px-2 py-2"><Pill tone={status(r) === 'Active' ? 'good' : 'neutral'}>{status(r)}</Pill>{overriddenCodes.has(r.code) && <span className="ml-1"><Pill tone="warn">overridden</Pill></span>}</td>
                <td className="px-2 py-2">{r.kind === 'system' ? 'System' : r.created_by_name ?? r.created_by}</td>
                <td className="px-2 py-2">{day(r.updated_at)}{r.updated_by_name ? ` · ${r.updated_by_name}` : ''}</td>
                <td className="max-w-xs truncate px-2 py-2" title={r.description}>{r.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="p-4 text-center text-xs text-slate-500">No rule matches these filters.</p>}
      </div>
    </Section>
  );
};

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-[10px] font-extrabold uppercase text-slate-400">{label}</div>
    <div className="text-xs text-slate-800">{children}</div>
  </div>
);

const RuleDetail: React.FC<{ rule: Row; canManage: boolean; onClose: () => void; onEdit: () => void; onChanged: () => Promise<void> }> = ({ rule, canManage, onClose, onEdit, onChanged }) => {
  const [history, setHistory] = useState<Row[]>([]);
  const [impact, setImpact] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Row | null>(null);
  useEffect(() => {
    void api.get<Row[]>(`/authority/rules/${encodeURIComponent(rule.id)}/history`).then(setHistory).catch(() => setHistory([]));
  }, [rule.id]);
  const action = rule.active ? 'deactivate' : 'reactivate';
  const ask = async () => {
    setError(null);
    try {
      setImpact(await api.get<Row>(`/authority/rules/${encodeURIComponent(rule.id)}/impact?action=${action}`));
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  };
  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.post<Row>(`/authority/rules/${encodeURIComponent(rule.id)}/${action}`, { reason }));
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const c = rule.conditions ?? {};
  return (
    <Modal
      title={`${rule.code} · ${rule.name}`}
      subtitle={rule.kind === 'system' ? 'SYSTEM POLICY' : rule.source}
      onClose={done ? () => void onChanged() : onClose}
      wide
      footer={
        canManage && !done && (
          <>
            {rule.kind === 'owner' && rule.active && <Button onClick={onEdit}>Edit</Button>}
            {!rule.locked && !impact && (
              <Button tone={rule.active ? 'danger' : 'primary'} onClick={() => void ask()}>
                {rule.active ? 'Deactivate…' : 'Reactivate…'}
              </Button>
            )}
          </>
        )
      }
    >
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-950" data-testid="rule-summary">{rule.summary}</div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Detail label="Decision type">{rule.decision_type_label}</Detail>
        <Detail label="Kind">{rule.kind === 'system' ? 'System Policy' : 'Owner rule'}{rule.locked ? ' (locked)' : ''}</Detail>
        <Detail label="Effect">{rule.effect === 'allow' ? 'Allows approval' : 'Requires the Owner'}</Detail>
        <Detail label="Status">{status(rule)}</Detail>
        <Detail label="User">{rule.target_user_name ?? rule.target_user_id ?? '—'}</Detail>
        <Detail label="Role">{rule.target_role ?? '—'}</Detail>
        <Detail label="Permission target">{rule.target_permission ?? '—'}</Detail>
        <Detail label="Baseline permission">{rule.baseline_permission}</Detail>
        <Detail label="Project">{rule.project_name ?? 'Any'}</Detail>
        <Detail label="Client">{rule.client_name ?? 'Any'}</Detail>
        <Detail label="Value range">{range(rule)}</Detail>
        <Detail label="Max project risk">{rule.max_risk ?? 'Any'}</Detail>
        <Detail label="Start">{day(rule.start_at)}</Detail>
        <Detail label="End">{day(rule.end_at)}</Detail>
        <Detail label="Priority">{rule.priority}</Detail>
        <Detail label="Other conditions">{Object.keys(c).length ? Object.entries(c).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('; ') : '—'}</Detail>
        <Detail label="Created">{rule.kind === 'system' ? 'System Policy (migration)' : `${rule.created_by_name ?? rule.created_by} · ${day(rule.created_at)}`}</Detail>
        <Detail label="Last changed">{`${rule.updated_by_name ?? rule.updated_by ?? '—'} · ${day(rule.updated_at)}`}</Detail>
        <Detail label="Reason">{rule.description}</Detail>
        {!rule.active && <Detail label="Deactivated">{`${rule.deactivated_by_name ?? rule.deactivated_by ?? ''} · ${day(rule.deactivated_at)} — ${rule.deactivation_reason ?? ''}`}</Detail>}
      </div>
      {rule.locked && <p className="text-xs font-bold text-rose-700">Locked: the project sensitivity ceiling. Change the project's sensitivity instead.</p>}
      {impact && !done && (
        <div className="space-y-2 rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs" data-testid="rule-impact">
          <div className="font-black">Before you {action}</div>
          <div>{impact.message}</div>
          <div>Users it covers: {impact.users.length ? impact.users.map((u: Row) => `${u.name} (${u.role})`).join(', ') : 'none'} · Projects: {impact.projects} · Pending approvals routed by it: {impact.pending_routed_by_this_rule}</div>
          {impact.pending_examples.length > 0 && <div className="text-slate-500">For example: {impact.pending_examples.join('; ')}</div>}
          <Field label={`Reason to ${action}`}>
            <Input aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button tone={action === 'deactivate' ? 'danger' : 'primary'} busy={busy} disabled={!reason.trim()} onClick={() => void confirm()}>
            Confirm {action}
          </Button>
        </div>
      )}
      {done && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900" data-testid="rule-done">
          {done.code} is now {done.active ? 'active' : 'inactive'}. Routing: {done.routing_changes?.rerouted ?? 0} re-routed, {done.routing_changes?.created ?? 0} routed.
        </div>
      )}
      <FormError error={error} onDismiss={() => setError(null)} />
      <div>
        <div className="mb-1 text-[10px] font-extrabold uppercase text-slate-400">History</div>
        <ul className="space-y-1 text-xs">
          {history.map((h) => (
            <li key={h.id}>
              <span className="font-mono">{day(h.occurred_at)}</span> {h.action.replace('authority.rule.', '')} by {h.actor_name ?? h.actor_id}
              {h.details ? ` — ${h.details}` : ''}
            </li>
          ))}
          {!history.length && <li className="text-slate-500">{rule.kind === 'system' ? 'Unchanged since it was set up.' : 'No history.'}</li>}
        </ul>
      </div>
    </Modal>
  );
};

/** Create or edit an Owner rule: fill in, preview on the server, then save. */
const RuleForm: React.FC<{ rule: Row | null; types: Row[]; projects: Row[]; clients: Row[]; onClose: () => void; onSaved: () => Promise<void> }> = ({ rule, types, projects, clients, onClose, onSaved }) => {
  const [users, setUsers] = useState<Row[]>([]);
  useEffect(() => {
    void api.get<Row[]>('/users').then((u) => setUsers(u.filter((x) => x.is_active && !['Owner / CEO', 'Client', 'Contractor'].includes(x.role)))).catch(() => setUsers([]));
  }, []);
  const [v, setV] = useState<Row>(() => ({
    name: rule?.name ?? '',
    description: rule?.description ?? '',
    effect: rule?.effect ?? 'allow',
    decision_type: rule?.decision_type ?? types[0]?.key ?? 'variation',
    target_type: rule?.target_user_id ? 'user' : 'role',
    target_role: rule?.target_role ?? 'Project Manager',
    target_user_id: rule?.target_user_id ?? '',
    project_id: rule?.project_id ?? '',
    client_id: rule?.client_id ?? '',
    min_value: rule?.min_value ?? '',
    max_value: rule?.max_value ?? '',
    max_risk: rule?.max_risk ?? '',
    start_at: rule?.start_at ? day(rule.start_at) : '',
    end_at: rule?.end_at ? day(rule.end_at) : '',
    priority: rule?.priority ?? 200,
    change_reason: '',
  }));
  const [preview, setPreview] = useState<Row | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: string, val: unknown) => setV((x) => ({ ...x, [k]: val }));
  const hasValue = types.find((t) => t.key === v.decision_type)?.has_value;
  const body = () => {
    const b: Row = {
      name: v.name,
      description: v.description,
      decision_type: v.decision_type,
      effect: v.effect,
      target_role: v.effect === 'allow' && v.target_type === 'role' ? v.target_role : v.effect === 'allow' && v.target_type === 'user' ? users.find((u) => u.id === v.target_user_id)?.role : undefined,
      target_user_id: v.effect === 'allow' && v.target_type === 'user' ? v.target_user_id || undefined : undefined,
      project_id: v.project_id || undefined,
      client_id: v.client_id || undefined,
      min_value: hasValue && v.min_value !== '' ? Number(v.min_value) : undefined,
      max_value: hasValue && v.max_value !== '' ? Number(v.max_value) : undefined,
      max_risk: v.max_risk || undefined,
      start_at: v.start_at ? new Date(`${v.start_at}T00:00:00`).toISOString() : undefined,
      end_at: v.end_at ? new Date(`${v.end_at}T23:59:59`).toISOString() : undefined,
      priority: Number(v.priority),
    };
    if (rule) {
      delete b.decision_type;
      delete b.effect;
      // An edit clears what was removed on the form.
      for (const k of ['target_user_id', 'project_id', 'client_id', 'min_value', 'max_value', 'max_risk', 'start_at', 'end_at']) if (b[k] === undefined) b[k] = null;
    }
    return b;
  };
  const key = JSON.stringify(body());
  const runPreview = async () => {
    setBusy('preview');
    setError(null);
    try {
      setPreview(await api.post<Row>(rule ? `/authority/rules/${encodeURIComponent(rule.id)}/preview` : '/authority/rules/preview', body()));
      setPreviewKey(key);
    } catch (err) {
      setPreview(null);
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    setBusy('save');
    setError(null);
    try {
      if (rule) await api.patch(`/authority/rules/${encodeURIComponent(rule.id)}`, { ...body(), change_reason: v.change_reason });
      else await api.post('/authority/rules', body());
      await onSaved();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(null);
    }
  };
  const fresh = preview && previewKey === key;
  return (
    <Modal
      title={rule ? `Edit ${rule.code}` : 'New delegated authority'}
      subtitle="Preview shows exactly what the server will store, and what it would affect"
      onClose={onClose}
      wide
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button busy={busy === 'preview'} onClick={() => void runPreview()} data-testid="rule-preview-button">
            Preview
          </Button>
          <Button tone="primary" busy={busy === 'save'} disabled={!fresh || (rule != null && !v.change_reason.trim())} onClick={() => void save()} data-testid="rule-save-button">
            {rule ? 'Save change' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Name"><Input aria-label="Rule name" value={v.name} onChange={(e) => set('name', e.target.value)} /></Field>
        <Field label="Decision type">
          <Select aria-label="Decision type" value={v.decision_type} disabled={!!rule} onChange={(e) => set('decision_type', e.target.value)}>
            {types.filter((t) => t.active).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="Effect">
          <Select aria-label="Effect" value={v.effect} disabled={!!rule} onChange={(e) => set('effect', e.target.value)}>
            <option value="allow">Allow approval</option>
            <option value="require_owner">Require the Owner</option>
          </Select>
        </Field>
        {v.effect === 'allow' && (
          <>
            <Field label="Target type" hint="Permission targets are System Policy only">
              <Select aria-label="Target type" value={v.target_type} onChange={(e) => set('target_type', e.target.value)}>
                <option value="role">Role</option>
                <option value="user">User</option>
                <option value="permission" disabled>Permission (System Policy only)</option>
              </Select>
            </Field>
            {v.target_type === 'role' ? (
              <Field label="Role">
                <Select aria-label="Target role" value={v.target_role} onChange={(e) => set('target_role', e.target.value)}>
                  {DELEGATE_ROLES.map((r) => <option key={r}>{r}</option>)}
                </Select>
              </Field>
            ) : (
              <Field label="User">
                <Select aria-label="Target user" value={v.target_user_id} onChange={(e) => set('target_user_id', e.target.value)}>
                  <option value="">Choose…</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
                </Select>
              </Field>
            )}
          </>
        )}
        <Field label="Project">
          <Select aria-label="Rule project" value={v.project_id} onChange={(e) => set('project_id', e.target.value)}>
            <option value="">Any project</option>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.project_number} · {p.project_name}</option>)}
          </Select>
        </Field>
        <Field label="Client">
          <Select aria-label="Rule client" value={v.client_id} onChange={(e) => set('client_id', e.target.value)}>
            <option value="">Any client</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name ?? c.name ?? c.id}</option>)}
          </Select>
        </Field>
        {hasValue && (
          <>
            <Field label="Minimum value (RM)"><Input type="number" aria-label="Minimum value" value={v.min_value} onChange={(e) => set('min_value', e.target.value)} /></Field>
            <Field label="Maximum value (RM)"><Input type="number" aria-label="Maximum value" value={v.max_value} onChange={(e) => set('max_value', e.target.value)} /></Field>
          </>
        )}
        <Field label="Maximum project risk">
          <Select aria-label="Maximum project risk" value={v.max_risk} onChange={(e) => set('max_risk', e.target.value)}>
            <option value="">Any</option>
            {RISKS.map((r) => <option key={r}>{r}</option>)}
          </Select>
        </Field>
        <Field label="Start date"><Input type="date" aria-label="Start date" value={v.start_at} onChange={(e) => set('start_at', e.target.value)} /></Field>
        <Field label="End date"><Input type="date" aria-label="End date" value={v.end_at} onChange={(e) => set('end_at', e.target.value)} /></Field>
        <Field label="Priority" hint="1–899; higher wins"><Input type="number" aria-label="Priority" value={v.priority} onChange={(e) => set('priority', e.target.value)} /></Field>
      </div>
      <Field label="Reason (why this authority is given)"><TextArea aria-label="Rule reason" value={v.description} onChange={(e) => set('description', e.target.value)} /></Field>
      {rule && <Field label="Reason for this change"><Input aria-label="Change reason" value={v.change_reason} onChange={(e) => set('change_reason', e.target.value)} /></Field>}
      <FormError error={error} onDismiss={() => setError(null)} />
      {preview && (
        <div className={`space-y-2 rounded-xl border p-3 text-xs ${fresh ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50 opacity-60'}`} data-testid="rule-preview">
          {!fresh && <div className="font-bold text-slate-600">The form changed — preview again before saving.</div>}
          <div className="font-black text-slate-900">This rule will {preview.effect === 'allow' ? 'allow' : 'require'}:</div>
          <div className="text-sm font-semibold text-amber-950">{preview.summary}</div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Detail label="Decision type">{preview.decision_type.label} (baseline {preview.decision_type.baseline_permission})</Detail>
            <Detail label="Who">{preview.target ? (preview.target.type === 'user' ? `${preview.target.name} (${preview.target.role})` : preview.target.role) : 'Owner required'}</Detail>
            <Detail label="Projects">{preview.scope.project ? `${preview.scope.project.name} (${preview.scope.project.sensitivity})` : `${preview.impact.projects} open project(s)`}{preview.scope.client ? ` · client ${preview.scope.client.name}` : ''}</Detail>
            <Detail label="Value / risk">{preview.value_range.min ?? 0} – {preview.value_range.max ?? 'any'} · risk up to {preview.max_risk ?? 'any'}</Detail>
            <Detail label="Dates">{day(preview.dates.start_at)} → {day(preview.dates.end_at)}</Detail>
            <Detail label="Users it covers">{preview.impact.users.length ? preview.impact.users.map((u: Row) => u.name).join(', ') : 'none'}</Detail>
            <Detail label="Pending approvals in scope">{preview.impact.pending_approvals_in_scope}</Detail>
            <Detail label="Immediately usable">{preview.immediately_usable ? 'Yes' : `No — ${preview.not_usable_because.join('; ')}`}</Detail>
          </div>
          {preview.higher_priority_rules.length > 0 && <div>Higher-priority rules: {preview.higher_priority_rules.map((r: Row) => `${r.code} (${r.effect}, ${r.priority})`).join(', ')}</div>}
          {preview.warnings.length > 0 && (
            <ul className="space-y-1" data-testid="rule-warnings">
              {preview.warnings.map((w: Row, i: number) => (
                <li key={i} className="rounded-lg bg-amber-100 px-2 py-1 font-semibold text-amber-950" data-code={w.code}>
                  ⚠ {w.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
};

const ProjectsTable: React.FC<{ projects: Row[]; canManage: boolean; onChange: (p: Row) => void }> = ({ projects, canManage, onChange }) => (
  <Section title="Project sensitivity" subtitle="The hard ceiling: Sensitive reserves the protected decisions for the Owner, Strategic reserves every decision. Only the Owner changes it, with a reason.">
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs" data-testid="authority-projects">
        <thead className="border-b border-slate-200 bg-slate-50 text-[10px] font-extrabold uppercase text-slate-500">
          <tr>
            <th className="px-2 py-2">Project</th>
            <th className="px-2 py-2">Client</th>
            <th className="px-2 py-2">Status</th>
            <th className="px-2 py-2">Risk</th>
            <th className="px-2 py-2">Sensitivity</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {projects.map((p) => (
            <tr key={p.id} data-testid={`sensitivity-${p.id}`}>
              <td className="px-2 py-2 font-bold">{p.project_number} · {p.project_name}</td>
              <td className="px-2 py-2">{p.client_name ?? p.client_id}</td>
              <td className="px-2 py-2">{p.project_status}</td>
              <td className="px-2 py-2">{p.risk_status ?? '—'}</td>
              <td className="px-2 py-2"><Pill tone={SENS_TONE[p.sensitivity]}>{p.sensitivity}</Pill></td>
              <td className="px-2 py-2 text-right">{canManage && <Button onClick={() => onChange(p)}>Change…</Button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </Section>
);

const SensitivityModal: React.FC<{ project: Row; onClose: () => void; onSaved: () => Promise<void> }> = ({ project, onClose, onSaved }) => {
  const [level, setLevel] = useState(project.sensitivity);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Row | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      setDone(await api.put<Row>(`/projects/${encodeURIComponent(project.id)}/sensitivity`, { sensitivity: level, reason }));
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Sensitivity · ${project.project_name}`}
      subtitle={`Now ${project.sensitivity}`}
      onClose={done ? () => void onSaved() : onClose}
      footer={!done && (
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" busy={busy} disabled={!reason.trim() || level === project.sensitivity} onClick={() => void save()}>
            Change sensitivity
          </Button>
        </>
      )}
    >
      {!done ? (
        <>
          <Field label="Sensitivity">
            <Select aria-label="Sensitivity level" value={level} onChange={(e) => setLevel(e.target.value)}>
              {['Normal', 'Sensitive', 'Strategic'].map((s) => <option key={s}>{s}</option>)}
            </Select>
          </Field>
          <p className="text-xs text-slate-600">
            {level === 'Normal' ? 'Delegated authority may apply.' : level === 'Sensitive' ? 'Only the Owner approves the protected decision types on this project.' : 'Only the Owner approves every decision on this project.'} Pending approvals are routed again at once.
          </p>
          <Field label="Reason"><Input aria-label="Sensitivity reason" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </>
      ) : (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900" data-testid="sensitivity-done">
          {done.project_name} is now {done.sensitivity}. Pending approvals: {done.routing_changes?.rerouted ?? 0} re-routed.
          {done.rules_above_ceiling?.length ? ` Rules now overridden: ${done.rules_above_ceiling.join(', ')}.` : ''}
        </div>
      )}
      <FormError error={error} onDismiss={() => setError(null)} />
    </Modal>
  );
};
