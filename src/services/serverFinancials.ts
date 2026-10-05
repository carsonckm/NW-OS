/**
 * Official project financials. In database mode the server computes contract value,
 * approved variations, committed / actual / forecast cost and project gross profit from its
 * own records; screens show those figures. The browser's own arithmetic (in NWContext) is
 * only a preview: it is shown in demo mode, or until the server's figures arrive.
 */
import { useEffect, useState } from 'react';
import type { Project, ProjectCommercialBaseline } from '../types';
import { dataApi, type ServerFinancials } from './coreApi';

/**
 * Fetches the server's figures for a project, again after every successful sync (so a new
 * PO, cost or variation shows its effect). Undefined in local/demo mode, while loading, or
 * when the server refuses (the role may not see financials).
 */
export function useServerFinancials(projectId: string | undefined, sync: { mode: string; lastSyncedAt?: string }) {
  const [figures, setFigures] = useState<ServerFinancials | undefined>(undefined);
  useEffect(() => {
    if (sync.mode !== 'database' || !projectId) {
      setFigures(undefined);
      return;
    }
    let cancelled = false;
    dataApi
      .profitability(projectId)
      .then((f) => !cancelled && setFigures(f))
      .catch(() => !cancelled && setFigures(undefined));
    return () => {
      cancelled = true;
    };
  }, [projectId, sync.mode, sync.lastSyncedAt]);
  // Never show another project's figures while a new project's are loading.
  return figures?.project_id === projectId ? figures : undefined;
}

/**
 * A project's commercial baseline with every derived total taken from the server. Inputs the
 * server doesn't own (budget breakdown, cash billed / collected) come from the stored
 * baseline when there is one.
 */
export function officialBaseline(
  own: ProjectCommercialBaseline | undefined,
  f: ServerFinancials,
  project?: Pick<Project, 'project_number' | 'project_name'>
): ProjectCommercialBaseline {
  return {
    project_number: project?.project_number ?? '',
    project_name: project?.project_name ?? '',
    variance_drivers: { material: 0, subcontractor: 0, rework: 0, logistics: 0, other: 0 },
    cash_billed: 0,
    cash_collected: 0,
    cash_outstanding: 0,
    ...own,
    project_id: f.project_id,
    original_contract_value: f.original_contract_value,
    approved_variations_total: f.approved_variations_total,
    current_contract_value: f.current_contract_value,
    unapproved_potential_variations_total: f.pending_variations_total,
    estimated_final_revenue: f.estimated_final_revenue,
    original_budget_direct_cost: f.estimated_direct_cost,
    committed_cost: f.committed_cost,
    actual_cost: f.actual_cost,
    forecast_final_cost: f.forecast_final_cost,
    cost_variance: f.cost_variance,
    cost_variance_status: f.cost_variance_status,
    current_gross_profit: f.current_gross_profit,
    forecast_gross_profit: f.project_gross_profit,
    forecast_gross_margin_percent: f.project_gross_margin_percent,
  };
}

/** The server's figures for several projects (Finance overview), keyed by project id. */
export function usePortfolioFinancials(projectIds: string[], sync: { mode: string; lastSyncedAt?: string }) {
  const [figures, setFigures] = useState<Record<string, ServerFinancials>>({});
  const key = projectIds.join(',');
  useEffect(() => {
    if (sync.mode !== 'database' || !key) {
      setFigures({});
      return;
    }
    let cancelled = false;
    Promise.all(key.split(',').map((id) => dataApi.profitability(id).catch(() => undefined))).then((all) => {
      if (cancelled) return;
      setFigures(Object.fromEntries(all.filter((f): f is ServerFinancials => Boolean(f)).map((f) => [f.project_id, f])));
    });
    return () => {
      cancelled = true;
    };
  }, [key, sync.mode, sync.lastSyncedAt]);
  return figures;
}
