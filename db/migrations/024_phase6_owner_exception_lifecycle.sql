-- Phase 6 Batch 9: a persistent lifecycle for the Owner Exception Center.
--
-- Exceptions are still computed by the server from live data (approval routes, project risk,
-- issues, delegation coverage, ...). This adds what the Owner did about each one and what
-- happened to it: one row per exception key with its current lifecycle state, and an
-- append-only history of every transition (who, when, why). Nothing here is ever deleted.

CREATE TABLE owner_exception_states (
  exception_key     text PRIMARY KEY,
  exception_type    text NOT NULL,
  title             text NOT NULL,
  project_id        text,
  state             text NOT NULL DEFAULT 'active'
                    CHECK (state IN ('active', 'acknowledged', 'waiting', 'resolved', 'stale', 'dismissed')),
  -- The server's severity when last seen (critical / urgent / attention / info).
  severity          text NOT NULL CHECK (severity IN ('critical', 'urgent', 'attention', 'info')),
  -- What makes the exception what it is (severity, reason codes, status): a change is activity.
  fingerprint       text NOT NULL,
  -- Whether the condition that raised it is still there.
  present           boolean NOT NULL DEFAULT true,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  -- Meaningful activity only: a lifecycle action, or a material change of the exception.
  -- Page views and polling never touch it. Stale = no activity for the threshold.
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  state_changed_at  timestamptz NOT NULL DEFAULT now(),
  state_changed_by  text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- For "waiting": what or whom the Owner is waiting for.
  waiting_for       text,
  version           integer NOT NULL DEFAULT 1
);
CREATE INDEX owner_exception_states_state_idx ON owner_exception_states (state);

CREATE TABLE owner_exception_events (
  id             bigserial PRIMARY KEY,
  exception_key  text NOT NULL REFERENCES owner_exception_states (exception_key) ON UPDATE CASCADE ON DELETE RESTRICT,
  action         text NOT NULL CHECK (action IN (
                   'observed', 'changed', 'cleared', 'recurred', 'auto_resolve', 'stale',
                   'acknowledge', 'wait', 'resolve', 'dismiss', 'reopen', 'snooze', 'unsnooze')),
  from_state     text,
  to_state       text,
  -- Null actor = NW OS itself (the lifecycle rule).
  actor_id       text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  actor_name     text,
  actor_role     text,
  reason         text,
  severity       text,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  data           jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX owner_exception_events_key_idx ON owner_exception_events (exception_key, id);

-- History is append-only; exception states are never deleted.
CREATE FUNCTION owner_exception_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'owner_exception_events is append-only' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER owner_exception_events_no_change BEFORE UPDATE OR DELETE ON owner_exception_events
  FOR EACH ROW EXECUTE FUNCTION owner_exception_events_append_only();
CREATE TRIGGER owner_exception_events_no_truncate BEFORE TRUNCATE ON owner_exception_events
  FOR EACH STATEMENT EXECUTE FUNCTION owner_exception_events_append_only();

CREATE FUNCTION owner_exception_states_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'owner exception records are never deleted' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER owner_exception_states_keep BEFORE DELETE ON owner_exception_states
  FOR EACH ROW EXECUTE FUNCTION owner_exception_states_no_delete();
CREATE TRIGGER owner_exception_states_no_truncate BEFORE TRUNCATE ON owner_exception_states
  FOR EACH STATEMENT EXECUTE FUNCTION owner_exception_states_no_delete();

-- Snoozes are kept too: un-snoozing ends the snooze instead of deleting it.
CREATE TRIGGER owner_exception_snoozes_keep BEFORE DELETE ON owner_exception_snoozes
  FOR EACH ROW EXECUTE FUNCTION owner_exception_states_no_delete();
