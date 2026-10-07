import type { Pool } from '../db/pool';
import type { People } from './people';

type Row = Record<string, unknown>;

export interface NoteSpec {
  title: string;
  message: string;
  /** action | approval | warning | escalation | information */
  type: 'action' | 'approval' | 'warning' | 'escalation' | 'information';
  priority: 'normal' | 'high' | 'urgent';
  project_id: string | null;
  link_tab: string;
  entity_type: string;
  entity_id: string;
}

/**
 * What a rule asks the engine to do. Every action has a key that identifies the occurrence
 * (e.g. "task_overdue:tsk-9:2026-10-01:L1"); the engine records it in the action ledger and
 * never performs the same key twice.
 */
export type PlannedAction =
  | { kind: 'notification'; key: string; users: string[]; note: NoteSpec }
  | { kind: 'task'; key: string; task: Row; note?: NoteSpec }
  | {
      kind: 'escalation';
      key: string;
      /** 1 = manager, 2 = owner (or the configured top level) */
      level: number;
      users: string[];
      record: { source_record_type: string; source_record_id: string; project_id: string | null; title: string; reason: string; current_level: string; previous_level: string; assigned_role: string; is_critical: boolean };
      note: NoteSpec;
    }
  /** Close a task automation opened once its source is resolved (no ledger: idempotent by state). */
  | { kind: 'close_task'; key: string; task_id: string; note: string };

export interface RuleContext {
  pool: Pool;
  now: Date;
  /** YYYY-MM-DD for `now` */
  today: string;
  config: Record<string, unknown>;
  people: People;
  /**
   * Problems a rule hit on individual records while it kept going (e.g. one approval it could
   * not re-route). The engine performs the planned actions, then records the run as failed with
   * these messages, so it is retried with backoff and shows in the run log.
   */
  problems: string[];
}

export interface RuleDef {
  key: string;
  name: string;
  description: string;
  /** Collections whose changes trigger this rule straight away (event-driven). */
  watches: string[];
  /** Default schedule (minutes) for overdue / escalation checks. */
  interval_minutes: number;
  /** Default configuration; stored per rule in automation_rules.config and editable by admins. */
  defaults: Record<string, unknown>;
  /** What the rule may do, and what stays with a person. */
  actions: string;
  human_in_loop: string;
  evaluate: (rc: RuleContext) => Promise<PlannedAction[]>;
}
