import { ForbiddenError, type AccessContext } from '../auth/access';
import { canSeeProjectFinancials } from '../auth/permissions';
import { NotFoundError } from '../core/repository';
import type { Pool, PoolClient } from '../db/pool';
import type { ModuleHooks, Row } from './types';

type Db = Pool | PoolClient;

const money = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

/** PO states whose value is committed cost (ordered from a supplier, not cancelled). */
export const COMMITTED_PO_STATES = ['Issued', 'Partially Received', 'Goods Received', 'Completed'];
/** Ledger states that are actual (incurred) cost. */
export const ACTUAL_LEDGER_STATES = ['Incurred', 'Reconciled'];

function checkFinancialAccess(ctx: AccessContext, projectId: string) {
  if (!ctx.canSeeProject(projectId)) throw new NotFoundError('projects', projectId);
  if (!canSeeProjectFinancials(ctx.user.role)) throw new ForbiddenError('Project financials are not available to your role');
}

/**
 * Original contract value (the project's signed value), approved variations (Approved,
 * Implemented, Closed) and the resulting current contract value, kept separate. Proposed
 * variations are reported but never added to the contract value.
 */
export async function contractSummary(pool: Pool, ctx: AccessContext, projectId: string) {
  checkFinancialAccess(ctx, projectId);
  return computeContract(pool, projectId);
}

async function computeContract(pool: Db, projectId: string) {
  const project = (await pool.query('SELECT contract_value FROM projects WHERE id = $1', [projectId])).rows[0];
  if (!project) throw new NotFoundError('projects', projectId);
  const v = (
    await pool.query(
      `SELECT
         coalesce(sum(client_amount) FILTER (WHERE status IN ('Approved', 'Implemented', 'Closed')), 0) AS approved,
         coalesce(sum(client_amount) FILTER (WHERE status IN ('Identified', 'Costing', 'Internal Approval', 'Client Approval')), 0) AS pending,
         count(*) FILTER (WHERE status IN ('Approved', 'Implemented', 'Closed'))::int AS approved_count,
         count(*) FILTER (WHERE status IN ('Identified', 'Costing', 'Internal Approval', 'Client Approval'))::int AS pending_count
       FROM variations WHERE project_id = $1`,
      [projectId]
    )
  ).rows[0];
  const original = money(project.contract_value);
  const approved = money(v.approved);
  return {
    project_id: projectId,
    original_contract_value: original,
    approved_variations_total: approved,
    approved_variations_count: v.approved_count,
    current_contract_value: money(original + approved),
    pending_variations_total: money(v.pending),
    pending_variations_count: v.pending_count,
  };
}

/**
 * Project profitability from server records:
 *  selling price          = current contract value (original + approved variations)
 *  estimated direct cost  = commercial baseline budget (else the accepted quotation's cost)
 *  committed cost         = issued purchase orders + ledger commitments not raised as POs
 *  actual cost            = ledger entries Incurred / Reconciled
 *  forecast final cost    = actual + still-open commitments, never below the estimate
 *  project gross profit   = selling price - forecast final cost   (gross, not net: no overheads)
 */
export async function profitability(pool: Pool, ctx: AccessContext, projectId: string) {
  checkFinancialAccess(ctx, projectId);
  return computeProfitability(pool, projectId);
}

/** Profitability without an access check (callers check access themselves). */
export async function computeProfitability(pool: Db, projectId: string) {
  const contract = await computeContract(pool, projectId);
  const [baseline, quotation, pos, ledger] = await Promise.all([
    pool.query('SELECT original_budget_direct_cost FROM commercial_baselines WHERE project_id = $1', [projectId]),
    pool.query(
      `SELECT total_estimated_cost FROM commercial_quotations WHERE project_id = $1 AND status = 'Accepted'
       ORDER BY updated_at DESC LIMIT 1`,
      [projectId]
    ),
    pool.query(`SELECT data->>'po_number' AS po_number, total_amount, status FROM purchase_orders WHERE project_id = $1`, [projectId]),
    pool.query(`SELECT data->>'po_reference' AS po_reference, amount, status FROM project_cost_ledger WHERE project_id = $1`, [projectId]),
  ]);

  const estimated = money(baseline.rows[0]?.original_budget_direct_cost ?? quotation.rows[0]?.total_estimated_cost ?? 0);
  const committedPos = pos.rows.filter((p) => COMMITTED_PO_STATES.includes(p.status));
  const poNumbers = new Set(committedPos.map((p) => p.po_number).filter(Boolean));
  const poCommitted = committedPos.reduce((sum, p) => sum + Number(p.total_amount), 0);
  const ledgerCommitments = ledger.rows
    .filter((l) => l.status === 'Committed' && !poNumbers.has(l.po_reference))
    .reduce((sum, l) => sum + Number(l.amount), 0);
  const actualRows = ledger.rows.filter((l) => ACTUAL_LEDGER_STATES.includes(l.status));
  const actual = actualRows.reduce((sum, l) => sum + Number(l.amount), 0);

  // Commitment still to be invoiced: each PO's value less what has been incurred against it.
  const incurredAgainstPo = new Map<string, number>();
  for (const l of actualRows) {
    if (l.po_reference && poNumbers.has(l.po_reference)) incurredAgainstPo.set(l.po_reference, (incurredAgainstPo.get(l.po_reference) ?? 0) + Number(l.amount));
  }
  const openPoCommitment = committedPos.reduce((sum, p) => sum + Math.max(0, Number(p.total_amount) - (incurredAgainstPo.get(p.po_number) ?? 0)), 0);

  const committed = money(poCommitted + ledgerCommitments);
  const forecast = money(Math.max(estimated, actual + openPoCommitment + ledgerCommitments));
  const selling = contract.current_contract_value;
  const grossProfit = money(selling - forecast);
  const variance = money(forecast - estimated);
  return {
    ...contract,
    selling_price: selling,
    estimated_final_revenue: money(selling + contract.pending_variations_total),
    estimated_direct_cost: estimated,
    committed_cost: committed,
    actual_cost: money(actual),
    forecast_final_cost: forecast,
    cost_variance: variance,
    cost_variance_status: varianceStatus(variance, estimated),
    current_gross_profit: money(selling - actual),
    project_gross_profit: grossProfit,
    project_gross_margin_percent: selling > 0 ? Math.round((grossProfit / selling) * 10000) / 100 : 0,
    basis: {
      committed_po_states: COMMITTED_PO_STATES,
      actual_ledger_states: ACTUAL_LEDGER_STATES,
      note: 'Gross profit before company overheads; not net profit.',
    },
  };
}

/**
 * Fields of a commercial baseline that are derived from other records. The server computes
 * them on every read and ignores whatever a browser sends, so a stored baseline can never
 * carry its own (possibly stale or forged) totals. The inputs stay editable: original
 * contract value, budget, cash billed/collected and the variance driver breakdown.
 */
export const DERIVED_BASELINE_FIELDS = [
  'approved_variations_total',
  'current_contract_value',
  'unapproved_potential_variations_total',
  'estimated_final_revenue',
  'committed_cost',
  'actual_cost',
  'forecast_final_cost',
  'cost_variance',
  'cost_variance_status',
  'current_gross_profit',
  'forecast_gross_profit',
  'forecast_gross_margin_percent',
] as const;

function varianceStatus(variance: number, budget: number) {
  if (variance <= 0) return 'On Budget';
  const pct = budget > 0 ? variance / budget : 1;
  return pct <= 0.03 ? 'Minor Variance' : pct <= 0.1 ? 'Forecast Over Budget' : 'Critical Overrun';
}

export const baselineHooks: ModuleHooks = {
  async beforeWrite(_h, _existing, incoming) {
    const kept = { ...incoming };
    for (const f of DERIVED_BASELINE_FIELDS) delete kept[f];
    return kept;
  },

  async hydrate(db, records) {
    return Promise.all(
      records.map(async (b) => {
        const projectId = String(b.project_id);
        const exists = (await db.query('SELECT 1 FROM projects WHERE id = $1', [projectId])).rowCount;
        if (!exists) return b;
        const p = await computeProfitability(db, projectId);
        return {
          ...b,
          approved_variations_total: p.approved_variations_total,
          current_contract_value: p.current_contract_value,
          unapproved_potential_variations_total: p.pending_variations_total,
          estimated_final_revenue: p.estimated_final_revenue,
          committed_cost: p.committed_cost,
          actual_cost: p.actual_cost,
          forecast_final_cost: p.forecast_final_cost,
          cost_variance: p.cost_variance,
          cost_variance_status: p.cost_variance_status,
          current_gross_profit: p.current_gross_profit,
          forecast_gross_profit: p.project_gross_profit,
          forecast_gross_margin_percent: p.project_gross_margin_percent,
        } as Row;
      })
    );
  },
};
