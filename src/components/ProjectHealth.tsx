/**
 * Project health from the server's risk engine: the overall level, each dimension, and the
 * reasons behind it (each opens the record to act on). An operational indicator only.
 */
import React, { useEffect, useState } from 'react';
import { Activity } from 'lucide-react';
import { useNW } from '../context/NWContext';
import { api } from '../services/coreApi';
import { actionErrorOf } from '../services/records';
import { navigateTo } from '../services/navigation';
import { FormError } from './ui/FormError';
import { Pill } from './ui/forms';

export type RiskLevel = 'On Track' | 'Attention' | 'At Risk' | 'Critical';
export interface ProjectRisk {
  project_id: string;
  project_name: string;
  level: RiskLevel;
  reasons: { dimension: string; level: RiskLevel; signal: string; detail: string; tab: string; entity_type?: string; entity_id?: string }[];
  dimensions: { dimension: string; level: RiskLevel; reasons: string[] }[];
  computed_at: string;
  basis: string;
}
export const RISK_TONE: Record<RiskLevel, 'good' | 'info' | 'warn' | 'bad'> = { 'On Track': 'good', Attention: 'warn', 'At Risk': 'bad', Critical: 'bad' };

export const ProjectHealth: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { coreDataSync, currentUser } = useNW();
  const [risk, setRisk] = useState<ProjectRisk | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = coreDataSync.mode === 'database' && !['Client', 'Contractor'].includes(currentUser.role);
  useEffect(() => {
    if (!live) return;
    let stale = false;
    api
      .get<ProjectRisk>(`/projects/${encodeURIComponent(projectId)}/risk`)
      .then((r) => !stale && (setRisk(r), setError(null)))
      .catch((err) => !stale && setError(actionErrorOf(err).message));
    return () => {
      stale = true;
    };
  }, [projectId, live, coreDataSync.lastSyncedAt]);
  if (!live) return null;
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3" data-testid="project-health">
      <FormError error={error} />
      {risk && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-4 w-4 text-slate-500" />
            <span className="text-xs font-black text-slate-900">Project health:</span>
            <Pill tone={RISK_TONE[risk.level]}>{risk.level}</Pill>
            <span className="text-[10px] text-slate-400">{risk.basis}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {risk.dimensions.map((d) => (
              <span key={d.dimension} title={d.reasons.join('\n') || 'No signals'} className="text-[10px]">
                <Pill tone={RISK_TONE[d.level]}>{d.dimension}: {d.level}</Pill>
              </span>
            ))}
          </div>
          {risk.reasons.length > 0 && (
            <ul className="space-y-1">
              {risk.reasons.map((r, i) => (
                <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    <Pill tone={RISK_TONE[r.level]}>{r.level}</Pill> <strong>{r.signal}</strong> <span className="text-slate-500">— {r.detail}</span>
                  </span>
                  <button type="button" className="text-[11px] font-bold text-amber-700 hover:underline" onClick={() => navigateTo(r.tab, projectId, r.entity_type && r.entity_id ? { type: r.entity_type, id: r.entity_id } : undefined)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
};
