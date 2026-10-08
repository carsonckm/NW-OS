/**
 * Owner Dependency & Delegation Recommendations (Phase 6 Batch 5), Owner only. Every number
 * comes from the server (/api/owner/dependency/analytics, /api/delegation/recommendations).
 * A recommendation never changes authority on its own: Accept / Modify shows the authority
 * preview of the rule it would create, and only the Owner's confirmation creates it through the
 * authority API.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Lightbulb, TrendingDown } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { Button, Field, Input, Pill, Select } from './ui/forms';

type Row = Record<string, any>;
const money = (v: number | null | undefined) => (v == null ? '—' : `RM ${Math.round(v).toLocaleString('en-US')}`);
const day = (v: string | null | undefined) => (v ? String(v).slice(0, 10) : '—');
const CONF_TONE: Record<string, 'good' | 'info' | 'warn'> = { High: 'good', Medium: 'info', Low: 'warn' };

const Tile: React.FC<{ label: string; value: React.ReactNode; hint?: string }> = ({ label, value, hint }) => (
  <div className="rounded-xl bg-slate-50 p-2" title={hint}>
    <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
    <div className="text-lg font-black text-slate-900">{value}</div>
  </div>
);

const Recommendation: React.FC<{ r: Row; onDone: () => void }> = ({ r, onDone }) => {
  const [panel, setPanel] = useState<'none' | 'evidence' | 'modify' | 'reject' | 'snooze'>('none');
  const [mods, setMods] = useState<Row>({});
  const [preview, setPreview] = useState<Row | null>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('14');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
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
  const cleanMods = () => Object.fromEntries(Object.entries(mods).filter(([, v]) => v !== undefined && v !== ''));
  const askPreview = (m: Row) => run(async () => setPreview(await api.post<Row>(`/delegation/recommendations/${r.id}/preview`, { modifications: m })));
  const confirm = () =>
    run(async () => {
      await api.post(`/delegation/recommendations/${r.id}/accept`, { modifications: preview!.modified ? cleanMods() : {}, confirmation: preview!.confirmation });
      setPreview(null);
      onDone();
    });
  const ev = r.evidence;
  return (
    <li className="space-y-2 rounded-xl border border-slate-200 p-3" data-testid={`delegation-rec-${r.id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-black text-slate-900">{r.headline}</span>
        <Pill tone={CONF_TONE[r.confidence]}>{r.confidence} confidence</Pill>
        {r.project_name && <Pill tone="neutral">{r.project_name}</Pill>}
      </div>
      <p className="text-[11px] text-slate-700">
        {ev.decisions} similar decisions · {r.suggested_max_value != null ? `up to ${money(r.suggested_max_value)}` : 'no amount'} · {r.project_name ? 'one project' : r.client_name ? r.client_name : 'Normal projects'} · {day(ev.start)} – {day(ev.end)} · Owner approved {ev.approved}/{ev.decisions} · {ev.escalated} escalated
      </p>
      <p className="text-[11px] font-bold text-amber-800">{r.recommendation}</p>
      {error && <p className="text-[11px] font-bold text-rose-700" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-1">
        <Button onClick={() => setPanel(panel === 'evidence' ? 'none' : 'evidence')}>{panel === 'evidence' ? 'Hide evidence' : 'Review evidence'}</Button>
        <Button tone="primary" busy={busy} onClick={() => void askPreview({})}>
          Accept…
        </Button>
        <Button onClick={() => setPanel('modify')}>Modify…</Button>
        <Button tone="danger" onClick={() => setPanel('reject')}>Reject</Button>
        <Button onClick={() => setPanel('snooze')}>Snooze</Button>
      </div>
      {panel === 'evidence' && (
        <div className="space-y-1 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-700" data-testid="delegation-evidence">
          <div className="font-black text-slate-900">Why this was recommended</div>
          <ul className="list-disc pl-4">
            {r.reasons.map((x: string, i: number) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <div>
            {ev.decisions} decisions reviewed · {ev.approved} approved · {ev.rejected} rejected · {ev.escalated} escalated · {ev.distinct_days} different days · typical {money(ev.typical_value)} · maximum {money(ev.max_value)} · suggested limit {money(r.suggested_max_value)} · {ev.eligible_users} potential delegate(s) · required permission {r.required_permission}
          </div>
          {r.excluded && (
            <div>
              Not counted: {r.excluded.sensitive_or_strategic} on Sensitive / Strategic projects, {r.excluded.safety} safety-related, {r.excluded.unstable_project} on At Risk / Critical projects.
            </div>
          )}
          <div className="font-bold">Confidence: {r.confidence}</div>
          <ul className="list-disc pl-4">
            {r.confidence_explanation.map((x: string, i: number) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
          <details>
            <summary className="cursor-pointer font-bold">The decisions ({r.decisions.length})</summary>
            <ul>
              {r.decisions.map((d: Row) => (
                <li key={d.resource}>
                  {day(d.decided_at)} · {d.resource} · {d.project} · {money(d.value)} · {d.result}
                  {d.escalated ? ' · escalated' : ''}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
      {panel === 'modify' && (
        <div className="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-3">
          <Field label="Role">
            <Input placeholder={r.target_role} value={mods.target_role ?? ''} onChange={(e) => setMods({ ...mods, target_role: e.target.value || undefined })} />
          </Field>
          <Field label="Or one user (id)">
            <Input value={mods.target_user_id ?? ''} onChange={(e) => setMods({ ...mods, target_user_id: e.target.value || undefined })} />
          </Field>
          <Field label="Value limit (RM)">
            <Input type="number" placeholder={String(r.suggested_max_value ?? '')} value={mods.max_value ?? ''} onChange={(e) => setMods({ ...mods, max_value: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
          <Field label="Risk limit">
            <Select value={mods.max_risk ?? ''} onChange={(e) => setMods({ ...mods, max_risk: e.target.value || undefined })}>
              <option value="">{r.suggested_max_risk} (suggested)</option>
              <option value="On Track">On Track</option>
              <option value="Attention">Attention</option>
            </Select>
          </Field>
          <Field label="Project (id)">
            <Input placeholder={r.project_id ?? 'all Normal projects'} value={mods.project_id ?? ''} onChange={(e) => setMods({ ...mods, project_id: e.target.value || undefined })} />
          </Field>
          <Field label="Ends">
            <Input type="date" value={mods.end_at ?? ''} onChange={(e) => setMods({ ...mods, end_at: e.target.value || undefined })} />
          </Field>
          <div className="sm:col-span-3">
            <Button tone="primary" busy={busy} onClick={() => void askPreview(cleanMods())}>
              Preview the rule
            </Button>
          </div>
        </div>
      )}
      {(panel === 'reject' || panel === 'snooze') && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg bg-slate-50 p-2">
          {panel === 'snooze' && (
            <Select value={days} onChange={(e) => setDays(e.target.value)} className="max-w-[8rem]">
              {['7', '14', '30', '90'].map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          )}
          <Input placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-sm" />
          <Button
            tone={panel === 'reject' ? 'danger' : 'primary'}
            busy={busy}
            disabled={!reason.trim()}
            onClick={() =>
              void run(async () => {
                await api.post(`/delegation/recommendations/${r.id}/${panel}`, panel === 'reject' ? { reason } : { days: Number(days), reason });
                onDone();
              })
            }
          >
            {panel === 'reject' ? 'Reject' : 'Snooze'}
          </Button>
        </div>
      )}
      {preview && (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-2 text-[11px]" data-testid="delegation-preview">
          <div className="font-black text-slate-900">Authority preview — nothing has changed yet</div>
          <div>{preview.preview.summary}</div>
          <div>
            Covers {preview.preview.impact.users.length} user(s): {preview.preview.impact.users.map((u: Row) => u.name).join(', ') || 'none'} · {preview.preview.impact.pending_approvals_in_scope} pending approval(s) in scope · ends {day(preview.rule.end_at)}
          </div>
          {preview.preview.warnings.map((w: Row) => (
            <div key={w.code + w.message} className="font-semibold text-amber-900">
              ⚠ {w.message}
            </div>
          ))}
          {!preview.preview.immediately_usable && <div className="font-semibold text-rose-800">Not usable straight away: {preview.preview.not_usable_because.join('; ')}</div>}
          <div className="flex gap-1 pt-1">
            <Button tone="success" busy={busy} onClick={() => void confirm()}>
              Confirm and create this authority
            </Button>
            <Button onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}
    </li>
  );
};

export const OwnerDependency: React.FC = () => {
  const { coreDataSync } = useNW();
  const [a, setA] = useState<Row | null>(null);
  const [recs, setRecs] = useState<Row | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    try {
      const [x, y] = await Promise.all([api.get<Row>('/owner/dependency/analytics?days=90'), api.get<Row>('/delegation/recommendations')]);
      setA(x);
      setRecs(y);
      setError(null);
    } catch (err) {
      setError(actionErrorOf(err).message);
    }
  }, []);
  useEffect(() => {
    if (coreDataSync.mode === 'database') void load();
  }, [coreDataSync.mode, load]);
  if (coreDataSync.mode !== 'database') return null;
  const refresh = async () => {
    setBusy(true);
    try {
      await api.post('/delegation/recommendations/generate', {});
      await load();
    } catch (err) {
      setError(actionErrorOf(err).message);
    } finally {
      setBusy(false);
    }
  };
  const t = a?.totals;
  return (
    <div className="space-y-3 rounded-2xl border border-indigo-200 bg-white p-4 shadow-sm" data-testid="owner-dependency-analytics">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-indigo-600" />
          <div>
            <h3 className="text-sm font-black text-slate-900">Owner Dependency</h3>
            <p className="text-[11px] text-slate-500">{a?.question ?? 'How much of my time is still required for routine operational decisions?'} Last 90 days, from the decision records.</p>
          </div>
        </div>
        <Button onClick={() => void load()}>Refresh</Button>
      </div>
      {error && <p className="text-xs font-bold text-rose-700" role="alert">{error}</p>}
      {a && t && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="owner-dependency-summary">
            <Tile label="Owner decisions" value={t.owner_decisions} />
            <Tile label="Delegated decisions" value={t.delegated_decisions} />
            <Tile label="Delegation rate" value={t.percent_delegated == null ? '—' : `${t.percent_delegated}%`} />
            <Tile label="Estimated time saved" value={`${a.time_saved.estimated_hours} hrs`} hint={a.time_saved.formula} />
            <Tile label="Owner dependency" value={a.dependency.percent == null ? '—' : `${a.dependency.percent}%`} hint={a.dependency.definition} />
            <Tile label="Owner-required" value={t.owner_required} />
            <Tile label="No eligible delegate" value={t.no_eligible_delegate} />
            <Tile label="Avg Owner approval time" value={t.average_owner_hours == null ? '—' : `${t.average_owner_hours} h`} />
          </div>
          <p className="text-[10px] text-slate-500" data-testid="owner-dependency-definitions">
            {a.dependency.definition} Time saved (estimate): {a.time_saved.formula}. {a.time_saved.note}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" data-testid="owner-dependency-types">
              <thead>
                <tr className="text-left text-[10px] uppercase text-slate-500">
                  <th>Decision</th>
                  <th>Total</th>
                  <th>Owner</th>
                  <th>Delegated</th>
                  <th>% delegated</th>
                  <th>Avg / median h</th>
                  <th>Escalation</th>
                  <th>No delegate</th>
                </tr>
              </thead>
              <tbody>
                {a.by_decision_type.map((r: Row) => (
                  <tr key={r.decision_type} className="border-t border-slate-100">
                    <td className="py-1 font-bold">{r.label}</td>
                    <td>{r.total}</td>
                    <td>{r.owner}</td>
                    <td>{r.delegated}</td>
                    <td>{r.percent_delegated ?? '—'}%</td>
                    <td>
                      {r.average_hours ?? '—'} / {r.median_hours ?? '—'}
                    </td>
                    <td>{r.escalation_rate ?? 0}%</td>
                    <td>{r.no_eligible_delegate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="grid gap-3 text-[11px] md:grid-cols-3">
            <div>
              <div className="font-black text-slate-900">Why it stayed with you</div>
              <ul>
                {a.by_reason.map((r: Row) => (
                  <li key={r.code}>
                    {r.label}: {r.count}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-black text-slate-900">Trend (Owner / delegated / avg Owner h)</div>
              <ul data-testid="owner-dependency-trend">
                {a.trend.map((m: Row) => (
                  <li key={m.month}>
                    {m.month}: {m.owner_decisions} / {m.delegated_decisions}
                    {m.percent_delegated != null ? ` (${m.percent_delegated}% delegated)` : ''} / {m.average_owner_hours ?? '—'}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-black text-slate-900">Repeated Owner decisions (45 days)</div>
              <ul>
                {a.repeated.slice(0, 6).map((r: Row) => (
                  <li key={r.key + r.scope}>{r.text}</li>
                ))}
                {!a.repeated.length && <li className="text-slate-500">None</li>}
              </ul>
            </div>
          </div>
        </>
      )}
      <div className="space-y-2 border-t border-slate-100 pt-3" data-testid="delegation-recommendations">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-amber-500" />
            <div>
              <h4 className="text-xs font-black text-slate-900">Delegation opportunities ({recs?.active.length ?? 0})</h4>
              <p className="text-[10px] text-slate-500">{recs?.principle}</p>
            </div>
          </div>
          <Button busy={busy} onClick={() => void refresh()}>
            Refresh recommendations
          </Button>
        </div>
        <ul className="space-y-2">
          {(recs?.active ?? []).map((r: Row) => (
            <Recommendation key={r.id} r={r} onDone={() => void load()} />
          ))}
        </ul>
        {recs && !recs.active.length && <p className="text-[11px] text-slate-500">No delegation opportunity has enough evidence right now.</p>}
        {recs && recs.not_recommended.length > 0 && (
          <details className="text-[11px] text-slate-600">
            <summary className="cursor-pointer font-bold">Not recommended, and why ({recs.not_recommended.length})</summary>
            <ul>
              {recs.not_recommended.map((x: Row) => (
                <li key={x.key}>
                  {x.label}: {x.reason}
                </li>
              ))}
            </ul>
          </details>
        )}
        {recs && (recs.snoozed.length > 0 || recs.history.length > 0) && (
          <details className="text-[11px] text-slate-600">
            <summary className="cursor-pointer font-bold">Snoozed ({recs.snoozed.length}) and reviewed ({recs.history.length})</summary>
            <ul>
              {[...recs.snoozed, ...recs.history].map((r: Row) => (
                <li key={r.id}>
                  {r.headline} — {r.status}
                  {r.snoozed_until ? ` until ${day(r.snoozed_until)}` : ''}
                  {r.authority_rule_code ? ` → ${r.authority_rule_code}` : ''}
                  {r.review_reason ? ` (${r.review_reason})` : ''}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
};
