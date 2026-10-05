-- Phase 5: server-side automation engine.
--   automation_rules    per-rule configuration (on/off, schedule, thresholds) and scheduling state
--   automation_runs     one row per execution of a rule: trigger, input, result, actions, error, retries
--   automation_actions  idempotency ledger: one row per action ever taken, keyed by what it is about,
--                       so the same event processed twice never repeats a task, notification or escalation
-- Rule logic lives in server code (a controlled set of rules); only configuration is data.

CREATE TABLE automation_rules (
  key                  text PRIMARY KEY,
  enabled              boolean NOT NULL DEFAULT true,
  interval_minutes     integer NOT NULL CHECK (interval_minutes BETWEEN 1 AND 10080),
  config               jsonb NOT NULL DEFAULT '{}',
  last_run_at          timestamptz,
  next_run_at          timestamptz NOT NULL DEFAULT now(),
  consecutive_failures integer NOT NULL DEFAULT 0,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text
);

CREATE TABLE automation_runs (
  id            bigserial PRIMARY KEY,
  rule_key      text NOT NULL REFERENCES automation_rules (key) ON DELETE CASCADE,
  trigger       text NOT NULL CHECK (trigger IN ('schedule', 'event', 'manual', 'retry')),
  event         jsonb,
  status        text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  actions_taken integer NOT NULL DEFAULT 0,
  actions       jsonb NOT NULL DEFAULT '[]',
  error         text,
  retry_count   integer NOT NULL DEFAULT 0
);
CREATE INDEX automation_runs_rule_idx ON automation_runs (rule_key, started_at DESC);
CREATE INDEX automation_runs_failed_idx ON automation_runs (started_at DESC) WHERE status = 'failed';

CREATE TABLE automation_actions (
  action_key  text PRIMARY KEY,
  rule_key    text NOT NULL REFERENCES automation_rules (key) ON DELETE CASCADE,
  run_id      bigint REFERENCES automation_runs (id) ON DELETE SET NULL,
  kind        text NOT NULL CHECK (kind IN ('notification', 'task', 'escalation')),
  target_type text,
  target_id   text,
  project_id  text,
  detail      jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX automation_actions_target_idx ON automation_actions (target_type, target_id);
