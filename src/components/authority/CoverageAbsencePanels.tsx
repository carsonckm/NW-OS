/**
 * Delegated Authority → Coverage, Temporary authority and Absence (Phase 6 Batch 6). Every
 * status, number and check comes from the server. Changes are Owner-only and always previewed
 * first: the server returns a confirmation for exactly what was previewed, and creates the rule
 * through the same authority validation as every other rule.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/coreApi';
import { actionErrorOf } from '../../services/records';
import { Button, Field, Input, Pill, Section, Select } from '../ui/forms';

type Row = Record<string, any>;
const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  Covered: 'good',
  'Expiring Soon': 'warn',
  'Partially Covered': 'info',
  'Owner Only': 'neutral',
  'Blocked by Sensitivity': 'neutral',
  Uncovered: 'bad',
  'No Active Approver': 'bad',
  'Blocked by Permission': 'bad',
};
const TYPES = [
  ['drawing', 'Drawing approval'],
  ['variation', 'Variation (internal approval)'],
  ['purchase', 'Purchase approval'],
  ['invoice', 'Supplier invoice approval'],
  ['approval_request', 'Other approval request'],
];
const when = (v: string | null | undefined) => (v ? new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const iso = (local: string) => (local ? new Date(local).toISOString() : undefined);
const money = (v: number | null | undefined) => (v == null ? 'no limit' : `RM ${Number(v).toLocaleString('en-US')}`);
const useUsers = () => {
  const [users, setUsers] = useState<Row[]>([]);
  useEffect(() => {
    void api.get<Row[]>('/users').then((u) => setUsers(u.filter((x) => x.is_active && !['Owner / CEO', 'Client', 'Contractor'].includes(x.role)))).catch(() => setUsers([]));
  }, []);
  return users;
};
const Err: React.FC<{ e: string | null }> = ({ e }) => (e ? <p className="text-[11px] font-bold text-rose-700" role="alert">{e}</p> : null);

// ------------------------------------------------------------------ coverage
export const CoveragePanel: React.FC = () => {
  const [c, setC] = useState<Row | null>(null);
  const [eff, setEff] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    Promise.all([api.get<Row>('/authority/coverage'), api.get<Row>('/authority/effectiveness')])
      .then(([x, y]) => {
        setC(x);
        setEff(y);
      })
      .catch((err) => setError(actionErrorOf(err).message));
  }, []);
  if (error) return <Err e={error} />;
  if (!c) return <p className="text-xs text-slate-500">Loading coverage…</p>;
  const h = c.health;
  return (
    <div className="space-y-4" data-testid="coverage-panel">
      <Section title="Delegation coverage" subtitle="Is there an eligible non-Owner approver for each kind of decision right now? An operational measure, not permission.">
        <div className="grid grid-cols-2 gap-2 text-center sm:grid-cols-6" data-testid="coverage-health">
          {[
            ['Overall', h.overall_percent == null ? '—' : `${h.overall_percent}%`],
            ['Covered', h.covered],
            ['Expiring', h.expiring],
            ['Partial', h.partial],
            ['Uncovered', h.uncovered + h.no_active_approver + h.blocked_by_permission],
            ['Owner only', h.owner_only + h.blocked_by_sensitivity],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-slate-50 p-2">
              <div className="text-[10px] font-bold uppercase text-slate-500">{k}</div>
              <div className="text-lg font-black text-slate-900">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-slate-500">{h.definition}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]" data-testid="coverage-matrix">
            <thead>
              <tr className="text-left text-[10px] uppercase text-slate-500">
                <th>Decision</th>
                <th>Scope</th>
                <th>Value</th>
                <th>Eligible approver</th>
                <th>Coverage</th>
                <th>Waiting for Owner</th>
              </tr>
            </thead>
            <tbody>
              {c.cells.map((x: Row) => (
                <tr key={x.key} className="border-t border-slate-100 align-top" title={x.reasons.join('; ')}>
                  <td className="py-1 font-bold">{x.label}</td>
                  <td>{x.scope}</td>
                  <td>{x.value_label}</td>
                  <td>{x.approvers.length ? x.approvers.map((a: Row) => `${a.role} (${a.users})`).join(', ') : 'Owner'}{x.rules.length ? <span className="block text-slate-400">{x.rules.join(', ')}</span> : null}</td>
                  <td>
                    <Pill tone={STATUS_TONE[x.status]}>{x.status}</Pill>
                  </td>
                  <td>{x.pending_with_owner}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      <Section title={`Coverage gaps (${c.gaps.length})`}>
        <ul className="space-y-2" data-testid="coverage-gaps">
          {c.gaps.map((g: Row) => (
            <li key={g.key} className="rounded-xl border border-slate-200 p-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-1">
                <Pill tone={STATUS_TONE[g.status]}>{g.status}</Pill>
                <span className="font-black text-slate-900">{g.label}</span>
                <span className="text-slate-500">{g.scope}</span>
              </div>
              <div className="text-slate-700">{g.reason}</div>
              <div className="text-slate-700">Pending approvals affected: {g.pending_affected}</div>
              <div className="font-bold text-amber-800">Recommended: {g.recommended_action}</div>
            </li>
          ))}
          {!c.gaps.length && <li className="text-[11px] text-emerald-700">No gaps.</li>}
        </ul>
        {c.conflicts.length > 0 && (
          <div className="text-[11px]" data-testid="coverage-conflicts">
            <div className="font-black text-slate-900">Overlapping rules</div>
            <ul>
              {c.conflicts.map((x: Row) => (
                <li key={x.rules.join('-')}>{x.message}</li>
              ))}
            </ul>
          </div>
        )}
      </Section>
      {eff && (
        <Section title="Delegation effectiveness" subtitle={`${eff.note} Last ${eff.window_days} days.`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" data-testid="delegation-effectiveness">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500">
                  <th>Delegation</th>
                  <th>Approvals</th>
                  <th>Delegated</th>
                  <th>Owner fallback</th>
                  <th>Escalated</th>
                  <th>Avg h</th>
                  <th>Why it came back</th>
                </tr>
              </thead>
              <tbody>
                {eff.delegations.map((d: Row) => (
                  <tr key={d.rule_id} className="border-t border-slate-100 align-top">
                    <td className="py-1 font-bold">
                      {d.code} {d.authority_type !== 'permanent' ? <Pill tone="info">{d.authority_type}</Pill> : null}
                      <span className="block font-normal text-slate-500">{d.name}</span>
                      {d.finding && <span className="block font-semibold text-amber-800">{d.finding}</span>}
                    </td>
                    <td>{d.approvals}</td>
                    <td>
                      {d.delegated}
                      {d.percent_delegated != null ? ` (${d.percent_delegated}%)` : ''}
                    </td>
                    <td>{d.owner_fallback}</td>
                    <td>{d.escalated}</td>
                    <td>{d.average_hours ?? '—'}</td>
                    <td>{d.fallback_reasons.map((r: Row) => `${r.reason} ${r.count}`).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ temporary authority
const Preview: React.FC<{ p: Row; onConfirm: () => void; onCancel: () => void; busy: boolean; label: string }> = ({ p, onConfirm, onCancel, busy, label }) => (
  <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px]" data-testid="temporary-preview">
    <div className="font-black">Preview — nothing has changed yet</div>
    <div>{p.preview.summary}</div>
    <div>
      {when(p.rule.start_at)} → {when(p.rule.end_at)} · users it covers: {p.preview.impact.users.map((u: Row) => u.name).join(', ') || 'none'} · pending approvals in scope: {p.preview.impact.pending_approvals_in_scope}
    </div>
    {p.preview.warnings.map((w: Row) => (
      <div key={w.code + w.message} className="font-semibold text-amber-900">
        ⚠ {w.message}
      </div>
    ))}
    {(p.conflicts ?? []).map((x: Row) => (
      <div key={x.rules.join()} className="text-slate-700">
        {x.message}
      </div>
    ))}
    <div className="flex gap-1 pt-1">
      <Button tone="success" busy={busy} onClick={onConfirm}>
        {label}
      </Button>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  </div>
);

export const TemporaryAuthorityPanel: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const users = useUsers();
  const [list, setList] = useState<Row | null>(null);
  const [form, setForm] = useState<Row>({ decision_type: 'variation', target: '', project_id: '', max_value: '', max_risk: 'Attention', end_at: '', reason: '' });
  const [preview, setPreview] = useState<Row | null>(null);
  const [extend, setExtend] = useState<{ id: string; end_at: string; reason: string; preview?: Row } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void api.get<Row>('/authority/temporary').then(setList).catch((err) => setError(actionErrorOf(err).message));
  }, []);
  useEffect(load, [load]);
  const body = () => ({
    decision_type: form.decision_type,
    ...(form.target.startsWith('role:') ? { target_role: form.target.slice(5) } : { target_user_id: form.target }),
    ...(form.project_id ? { project_id: form.project_id } : {}),
    ...(form.max_value !== '' ? { max_value: Number(form.max_value) } : {}),
    max_risk: form.max_risk,
    end_at: iso(form.end_at),
    reason: form.reason,
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const Item: React.FC<{ r: Row }> = ({ r }) => (
    <li className="rounded-xl border border-slate-200 p-2 text-[11px]" data-testid={`temporary-${r.code}`}>
      <div className="flex flex-wrap items-center gap-1">
        <span className="font-black">{r.code}</span>
        <Pill tone={r.state === 'active' ? 'good' : r.state === 'scheduled' ? 'info' : 'neutral'}>{r.state}</Pill>
        {r.authority_type === 'absence' && <Pill tone="info">absence</Pill>}
        {r.expires_in && <Pill tone="warn">ends within {r.expires_in}</Pill>}
      </div>
      <div>
        {r.target.name ?? r.target.role} · {r.decision_type} · {r.project?.name ?? 'all Normal projects'} · {money(r.min_value) !== 'no limit' ? `${money(r.min_value)} – ` : ''}
        {money(r.max_value)} · risk up to {r.max_risk ?? 'any'}
      </div>
      <div>
        {when(r.start_at)} → {when(r.end_at)} · {r.reason}
        {r.extended_from ? ` · extends ${r.extended_from}` : ''}
        {r.ended_reason ? ` · ${r.ended_reason}` : ''}
      </div>
      {canManage && r.state === 'active' && r.authority_type === 'temporary' && (
        <div className="flex gap-1 pt-1">
          <Button onClick={() => setExtend({ id: r.id, end_at: '', reason: '' })}>Extend…</Button>
          <Button
            tone="danger"
            onClick={() => {
              const reason = window.prompt('Why end it now?');
              if (reason) void run(async () => { await api.post(`/authority/temporary/${r.id}/end`, { reason }); load(); });
            }}
          >
            End now
          </Button>
        </div>
      )}
      {extend?.id === r.id && (
        <div className="mt-1 space-y-1 rounded-lg bg-slate-50 p-2">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="New end">
              <Input type="datetime-local" aria-label="Extension end" value={extend.end_at} onChange={(e) => setExtend({ ...extend, end_at: e.target.value })} />
            </Field>
            <Field label="Reason">
              <Input aria-label="Extension reason" value={extend.reason} onChange={(e) => setExtend({ ...extend, reason: e.target.value })} />
            </Field>
            <Button busy={busy} onClick={() => void run(async () => setExtend({ ...extend, preview: await api.post<Row>(`/authority/temporary/${r.id}/extend/preview`, { end_at: iso(extend.end_at), reason: extend.reason }) }))}>
              Preview extension
            </Button>
          </div>
          {extend.preview && (
            <Preview
              p={extend.preview}
              busy={busy}
              label="Confirm extension"
              onCancel={() => setExtend(null)}
              onConfirm={() => void run(async () => { await api.post(`/authority/temporary/${r.id}/extend`, { end_at: iso(extend.end_at), reason: extend.reason, confirmation: extend.preview!.confirmation }); setExtend(null); load(); })}
            />
          )}
        </div>
      )}
    </li>
  );
  return (
    <div className="space-y-4" data-testid="temporary-panel">
      <Err e={error} />
      {canManage && (
        <Section title="New temporary authority" subtitle="Same rules as permanent authority (permission, sensitivity, self-approval); it always ends. Preview, then confirm.">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Decision">
              <Select value={form.decision_type} onChange={set('decision_type')}>
                {TYPES.map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Who">
              <Select value={form.target} onChange={set('target')} aria-label="Temporary target">
                <option value="">Choose…</option>
                {['Project Manager', 'Accountant', 'Purchasing', 'Production Manager'].map((r) => (
                  <option key={r} value={`role:${r}`}>
                    Any {r}
                  </option>
                ))}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Project (id, optional)">
              <Input value={form.project_id} onChange={set('project_id')} aria-label="Temporary project" />
            </Field>
            <Field label="Value limit (RM)">
              <Input type="number" value={form.max_value} onChange={set('max_value')} aria-label="Temporary value limit" />
            </Field>
            <Field label="Risk up to">
              <Select value={form.max_risk} onChange={set('max_risk')}>
                {['On Track', 'Attention', 'At Risk', 'Critical'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Ends">
              <Input type="datetime-local" value={form.end_at} onChange={set('end_at')} aria-label="Temporary end" />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              <Input value={form.reason} onChange={set('reason')} aria-label="Temporary reason" />
            </Field>
          </div>
          <Button tone="primary" busy={busy} onClick={() => void run(async () => setPreview(await api.post<Row>('/authority/temporary/preview', body())))}>
            Preview
          </Button>
          {preview && (
            <Preview
              p={preview}
              busy={busy}
              label="Confirm and create"
              onCancel={() => setPreview(null)}
              onConfirm={() => void run(async () => { await api.post('/authority/temporary', { ...body(), confirmation: preview.confirmation }); setPreview(null); load(); })}
            />
          )}
        </Section>
      )}
      {list && (
        <Section title="Temporary and absence authority">
          {list.expiring_soon.length > 0 && <p className="text-[11px] font-bold text-amber-800">Ending soon: {list.expiring_soon.map((r: Row) => `${r.code} (${r.expires_in})`).join(', ')}</p>}
          <h4 className="text-xs font-black">Active ({list.active.length})</h4>
          <ul className="space-y-1">{list.active.map((r: Row) => <Item key={r.id} r={r} />)}</ul>
          {list.scheduled.length > 0 && (
            <>
              <h4 className="text-xs font-black">Scheduled</h4>
              <ul className="space-y-1">{list.scheduled.map((r: Row) => <Item key={r.id} r={r} />)}</ul>
            </>
          )}
          <details>
            <summary className="cursor-pointer text-xs font-black">Ended ({list.ended.length})</summary>
            <ul className="space-y-1">{list.ended.map((r: Row) => <Item key={r.id} r={r} />)}</ul>
          </details>
        </Section>
      )}
    </div>
  );
};

// ------------------------------------------------------------------ Owner absence
export const AbsencePanel: React.FC<{ canManage: boolean }> = ({ canManage }) => {
  const users = useUsers();
  const [list, setList] = useState<Row[]>([]);
  const [form, setForm] = useState<Row>({ backup_user_id: '', start_at: '', end_at: '', decision_types: ['variation'], max_value: '10000', max_risk: 'Attention', project_id: '', reason: '' });
  const [preview, setPreview] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    void api.get<Row[]>('/authority/absence').then(setList).catch((err) => setError(actionErrorOf(err).message));
  }, []);
  useEffect(load, [load]);
  const body = () => ({
    backup_user_id: form.backup_user_id,
    ...(form.start_at ? { start_at: iso(form.start_at) } : {}),
    end_at: iso(form.end_at),
    decision_types: form.decision_types,
    ...(form.max_value !== '' ? { max_value: Number(form.max_value) } : {}),
    max_risk: form.max_risk,
    ...(form.project_id ? { project_id: form.project_id } : {}),
    reason: form.reason,
  });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <div className="space-y-4" data-testid="absence-panel">
      <Err e={error} />
      {canManage && (
        <Section title="Owner absence" subtitle="Route specific decisions to a backup within explicit limits while you are away. The backup does not become an Owner; Sensitive / Strategic projects, safety and System Policy stay with you.">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Backup">
              <Select value={form.backup_user_id} onChange={set('backup_user_id')} aria-label="Absence backup">
                <option value="">Choose…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="From (empty = now)">
              <Input type="datetime-local" value={form.start_at} onChange={set('start_at')} />
            </Field>
            <Field label="Until">
              <Input type="datetime-local" value={form.end_at} onChange={set('end_at')} aria-label="Absence end" />
            </Field>
            <Field label="Value limit (RM)">
              <Input type="number" value={form.max_value} onChange={set('max_value')} aria-label="Absence value limit" />
            </Field>
            <Field label="Risk up to">
              <Select value={form.max_risk} onChange={set('max_risk')}>
                {['On Track', 'Attention', 'At Risk'].map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </Field>
            <Field label="Project (id, optional)">
              <Input value={form.project_id} onChange={set('project_id')} />
            </Field>
            <Field label="Reason" className="sm:col-span-2">
              <Input value={form.reason} onChange={set('reason')} aria-label="Absence reason" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-3 text-[11px]">
            {TYPES.slice(0, 4).map(([k, l]) => (
              <label key={k} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.decision_types.includes(k)}
                  onChange={(e) => setForm({ ...form, decision_types: e.target.checked ? [...form.decision_types, k] : form.decision_types.filter((x: string) => x !== k) })}
                />
                {l}
              </label>
            ))}
          </div>
          <Button tone="primary" busy={busy} onClick={() => void run(async () => setPreview(await api.post<Row>('/authority/absence/preview', body())))}>
            Preview absence
          </Button>
          {preview && (
            <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px]" data-testid="absence-preview">
              <div className="font-black">
                Owner absence {when(preview.period.start_at)} → {when(preview.period.end_at)} · backup {preview.backup.name} ({preview.backup.role})
              </div>
              <div className="font-bold">Delegated</div>
              <ul className="list-disc pl-4">
                {preview.delegated.map((d: Row) => (
                  <li key={d.decision_type}>{d.summary}</li>
                ))}
              </ul>
              <div className="font-bold">Not delegated (stays with you)</div>
              <ul className="list-disc pl-4">
                {preview.not_delegated.map((x: string) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <div className="font-bold">Estimated impact</div>
              <div>
                {preview.impact.routine_owner_decisions_last_60_days_covered} routine decisions of the last 60 days fall within it · {preview.impact.decision_types_covered} decision type(s) · of {preview.impact.pending_with_owner_now} approvals waiting for you now, {preview.impact.pending_that_would_route_to_backup} would go to the backup and {preview.impact.pending_that_stay_with_owner} stay with you.
              </div>
              <div className="text-slate-500">{preview.impact.note}</div>
              <div className="flex gap-1 pt-1">
                <Button tone="success" busy={busy} onClick={() => void run(async () => { await api.post('/authority/absence', { ...body(), confirmation: preview.confirmation }); setPreview(null); load(); })}>
                  Confirm absence
                </Button>
                <Button onClick={() => setPreview(null)}>Cancel</Button>
              </div>
            </div>
          )}
        </Section>
      )}
      <Section title="Absences">
        <ul className="space-y-1 text-[11px]" data-testid="absence-list">
          {list.map((a) => (
            <li key={a.id} className="rounded-xl border border-slate-200 p-2">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-black">{a.id}</span>
                <Pill tone={a.status === 'active' ? 'good' : a.status === 'scheduled' ? 'info' : 'neutral'}>{a.status}</Pill>
                {!a.backup_active && <Pill tone="bad">backup deactivated</Pill>}
              </div>
              <div>
                {when(a.start_at)} → {when(a.end_at)} · backup {a.backup_name} · {a.decision_types.join(', ')} · {money(a.max_value)} · risk up to {a.max_risk} · {a.reason}
              </div>
              <div className="text-slate-500">Rules: {a.rules.map((r: Row) => `${r.code}${r.active ? '' : ' (off)'}`).join(', ')}</div>
              {canManage && ['scheduled', 'active'].includes(a.status) && (
                <Button
                  tone="danger"
                  onClick={() => {
                    const reason = window.prompt(a.status === 'active' ? 'Why end the absence now?' : 'Why cancel it?');
                    if (reason) void run(async () => { await api.post(`/authority/absence/${a.id}/end`, { reason }); load(); });
                  }}
                >
                  {a.status === 'active' ? 'End absence now' : 'Cancel'}
                </Button>
              )}
            </li>
          ))}
          {!list.length && <li className="text-slate-500">No absence configured.</li>}
        </ul>
      </Section>
    </div>
  );
};
