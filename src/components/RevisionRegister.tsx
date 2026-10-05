/**
 * Revision register for a drawing: which revision is the approved current one, which are
 * drafts or in review, which were superseded or rejected; who uploaded, sent for review and
 * approved each and when (stamped by the server), which production orders are built from
 * which revision, and a side-by-side comparison of two revisions.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { GitCompare, History } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { Drawing, DrawingRevision } from '../types';
import { api } from '../services/coreApi';
import { hasPermission } from '../utils/permissions';
import { Pill, Select } from './ui/forms';

type Rev = DrawingRevision & Record<string, unknown>;
type Usage = Record<string, { id: string; order_number: string; status: string; work_item_id: string }[]>;

const REVIEW = new Set(['Internal Review', 'Pending Review', 'Review']);
const group = (r: Rev) =>
  r.approved_status === 'Approved' && r.is_current
    ? 'Current approved'
    : REVIEW.has(r.approved_status)
      ? 'In review'
      : r.approved_status === 'Draft'
        ? 'Draft'
        : r.approved_status === 'Rejected'
          ? 'Rejected'
          : 'Superseded';
const GROUPS = ['Current approved', 'In review', 'Draft', 'Superseded', 'Rejected'] as const;
const TONE: Record<string, 'good' | 'info' | 'warn' | 'neutral' | 'bad'> = { 'Current approved': 'good', 'In review': 'info', Draft: 'warn', Superseded: 'neutral', Rejected: 'bad' };
const day = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 10) : '');

const COMPARE_FIELDS: [keyof DrawingRevision, string][] = [
  ['title', 'Title'],
  ['file_url', 'File'],
  ['drawing_type', 'Drawing type'],
  ['notes', 'Notes'],
  ['uploaded_date', 'Uploaded'],
];

export const RevisionRegister: React.FC<{ drawing: Drawing }> = ({ drawing }) => {
  const { currentUser, coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';
  const canSeeProduction = hasPermission(currentUser, 'production.view');
  const [usage, setUsage] = useState<Usage>({});
  const revisions = (drawing.revisions ?? []) as Rev[];
  const [a, setA] = useState('');
  const [b, setB] = useState('');

  useEffect(() => {
    if (!live || !canSeeProduction) return setUsage({});
    let stale = false;
    api
      .get<Usage>(`/drawings/${encodeURIComponent(drawing.id)}/production-usage`)
      .then((u) => !stale && setUsage(u))
      .catch(() => !stale && setUsage({}));
    return () => {
      stale = true;
    };
  }, [drawing.id, live, canSeeProduction, coreDataSync.lastSyncedAt]);

  useEffect(() => {
    setB(revisions[revisions.length - 1]?.id ?? '');
    setA(revisions[Math.max(0, revisions.length - 2)]?.id ?? '');
  }, [drawing.id, revisions.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const nwOrdersByClientRev = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const nw of drawing.nw_production_drawings ?? []) {
      const rev = revisions.find((r) => r.revision === nw.linked_client_revision);
      if (rev) (out[rev.id] ??= []).push(`${nw.drawing_number} ${nw.revision}${nw.approved_for_production ? ' (approved for production)' : ''}`);
    }
    return out;
  }, [drawing, revisions]);

  const left = revisions.find((r) => r.id === a);
  const right = revisions.find((r) => r.id === b);
  const comparison = right?.comparison_with_previous;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="revision-register">
      <div className="flex items-center gap-2">
        <History className="h-4 w-4 text-slate-500" />
        <h3 className="text-sm font-black text-slate-900">Revision register — {drawing.drawing_number}</h3>
        <span className="text-[11px] text-slate-500">Production always uses the current approved revision; drafts and revisions in review are never used.</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] uppercase text-slate-500">
            <tr>
              <th className="py-1.5 pr-3">Revision</th>
              <th className="pr-3">State</th>
              <th className="pr-3">Uploaded</th>
              <th className="pr-3">Sent for review</th>
              <th className="pr-3">Approved / rejected</th>
              <th className="pr-3">Superseded</th>
              <th className="pr-3">Used by</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.flatMap((g) =>
              revisions
                .filter((r) => group(r) === g)
                .reverse()
                .map((r) => {
                  const orders = usage[r.id] ?? [];
                  const nw = nwOrdersByClientRev[r.id] ?? [];
                  const decidedBy = (r.approved_by ?? r.rejected_by) as string | undefined;
                  const decidedAt = (r.approved_at ?? r.rejected_at) as string | undefined;
                  return (
                    <tr key={r.id} className="border-t border-slate-100 align-top" data-testid={`rev-row-${r.id}`}>
                      <td className="py-1.5 pr-3 font-mono font-bold">{r.revision}</td>
                      <td className="pr-3">
                        <Pill tone={TONE[g]}>{g}</Pill>
                      </td>
                      <td className="pr-3">
                        {r.uploaded_by} <span className="text-slate-400">{day(r.uploaded_date)}</span>
                      </td>
                      <td className="pr-3">{r.review_requested_by ? `${String(r.review_requested_by)} ${day(r.review_requested_at)}` : '—'}</td>
                      <td className="pr-3">{decidedBy ? `${decidedBy} ${day(decidedAt)}` : r.approved_status === 'Approved' || g === 'Superseded' ? 'not recorded (before Phase 4)' : '—'}</td>
                      <td className="pr-3">{day(r.superseded_at) || '—'}</td>
                      <td className="pr-3">
                        {orders.map((o) => (
                          <div key={o.id}>
                            {o.order_number} <span className="text-slate-400">({o.status})</span>
                          </div>
                        ))}
                        {nw.map((n) => (
                          <div key={n} className="text-emerald-700">
                            NW drawing {n}
                          </div>
                        ))}
                        {!orders.length && !nw.length && <span className="text-slate-400">{live && canSeeProduction ? 'no production orders' : '—'}</span>}
                      </td>
                    </tr>
                  );
                })
            )}
          </tbody>
        </table>
      </div>

      {revisions.length > 1 && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-700">
            <GitCompare className="h-4 w-4" /> Compare
            <Select value={a} onChange={(e) => setA(e.target.value)} className="w-auto" aria-label="Compare from">
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.revision} ({r.approved_status})
                </option>
              ))}
            </Select>
            with
            <Select value={b} onChange={(e) => setB(e.target.value)} className="w-auto" aria-label="Compare to">
              {revisions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.revision} ({r.approved_status})
                </option>
              ))}
            </Select>
          </div>
          {left && right && (
            <table className="w-full text-xs" data-testid="revision-compare">
              <tbody>
                {COMPARE_FIELDS.map(([k, label]) => {
                  const x = String(left[k] ?? '');
                  const y = String(right[k] ?? '');
                  return (
                    <tr key={k} className={x !== y ? 'bg-amber-50' : ''}>
                      <td className="w-32 py-1 pr-2 font-bold text-slate-600">{label}</td>
                      <td className="pr-2">{x || '—'}</td>
                      <td className={x !== y ? 'font-bold text-amber-900' : ''}>{y || '—'}</td>
                    </tr>
                  );
                })}
                <tr>
                  <td className="py-1 pr-2 font-bold text-slate-600">Markups</td>
                  <td>{left.markups?.length ?? 0}</td>
                  <td>{right.markups?.length ?? 0}</td>
                </tr>
              </tbody>
            </table>
          )}
          {comparison && (
            <div className="text-[11px] text-slate-700">
              <p className="font-bold">Recorded changes into {right?.revision}:</p>
              <ul className="list-disc pl-5">
                {[...comparison.dimension_changes, ...comparison.material_changes, ...comparison.finish_changes, ...comparison.quantity_changes, ...comparison.detail_changes].map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
