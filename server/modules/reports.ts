import { ForbiddenError, type AccessContext } from '../auth/access';
import { canSeeProjectFinancials } from '../auth/permissions';
import { NotFoundError } from '../core/repository';
import type { Pool } from '../db/pool';

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
  const contract = await contractSummary(pool, ctx, projectId);
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
  return {
    ...contract,
    selling_price: selling,
    estimated_direct_cost: estimated,
    committed_cost: committed,
    actual_cost: money(actual),
    forecast_final_cost: forecast,
    project_gross_profit: grossProfit,
    project_gross_margin_percent: selling > 0 ? Math.round((grossProfit / selling) * 10000) / 100 : 0,
    basis: {
      committed_po_states: COMMITTED_PO_STATES,
      actual_ledger_states: ACTUAL_LEDGER_STATES,
      note: 'Gross profit before company overheads; not net profit.',
    },
  };
}
