/**
 * Compatibility layer over the Phase 5 automation engine (server/automation): the rule
 * catalogue shown in the app, the actions AI and automation may never take, and a one-off
 * "run every rule now" used by tests and the manual run.
 */
import type { Pool } from '../db/pool';
import { AutomationEngine, ensureRules } from '../automation/engine';
import { RULES } from '../automation/rules';

export interface AutomationRuleSummary {
  key: string;
  name: string;
  trigger: string;
  action: string;
  human_in_loop: string;
}

export const AUTOMATION_RULES: AutomationRuleSummary[] = RULES.map((r) => ({ key: r.key, name: r.name, trigger: r.description, action: r.actions, human_in_loop: r.human_in_loop }));

/** What automation and AI may never do, whatever a rule or prompt says. */
export const AI_FORBIDDEN_ACTIONS = [
  'Approve or reject drawings',
  'Approve variations or change contract value',
  'Change dimensions or technical specifications',
  'Substitute materials',
  'Approve major purchases',
  'Promise delivery or completion dates to clients',
  'Approve compensation, claims or payments',
  'Make safety decisions',
  'Override permissions',
];

export interface AutomationResult {
  notifications: number;
  tasks: number;
  escalations: number;
  failed: number;
  ran_at: string;
}

/** Runs every rule once, as of `today` (YYYY-MM-DD) when given. */
export async function runAutomation(pool: Pool, today?: string): Promise<AutomationResult> {
  await ensureRules(pool);
  const engine = new AutomationEngine(pool, today ? () => new Date(`${today}T12:00:00Z`) : undefined);
  const results = await engine.runAll('manual');
  const ids = results.map((r) => r.run_id).filter((id): id is number => id !== null);
  const kinds = ids.length ? (await pool.query(`SELECT kind, count(*)::int AS n FROM automation_actions WHERE run_id = ANY($1) GROUP BY kind`, [ids])).rows : [];
  const count = (k: string) => kinds.find((r) => r.kind === k)?.n ?? 0;
  return { notifications: count('notification'), tasks: count('task'), escalations: count('escalation'), failed: results.filter((r) => r.status === 'failed').length, ran_at: new Date().toISOString() };
}
