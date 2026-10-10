-- Phase 6 Batch 11 (part 2): once critical, never dismissible; integrity findings.
--
-- A. A permanent, database-maintained lock. An exception is locked ("non-dismissible") as soon
--    as its stored severity is critical, or any of its history events records it as critical.
--    The lock is set by the database itself (triggers owned by nwos_owner), never cleared: an
--    attempt to clear it is refused. A locked exception cannot be dismissed or snoozed; it can
--    still be acknowledged, put on waiting, resolved and reopened. Lowering the stored severity
--    later (legitimately, or with a forged "changed" event) does not lift the lock.
--
--    Not closed by the database: an exception that has never been recorded can be recorded first
--    with a false, low severity by a holder of the runtime credential, and dismissed or snoozed
--    before NW OS records its real severity. That case is detected (B), not prevented.
--
-- B. owner_exception_integrity_findings: what the hourly lifecycle rule detects (a dismissed or
--    snoozed exception that is live-critical; a stored severity lowered while live-critical; a
--    locked exception that is dismissed or snoozed). One open finding per exception and kind;
--    never deleted. Detection writes evidence, it does not repair.

ALTER TABLE owner_exception_states
  ADD COLUMN critical_locked    boolean NOT NULL DEFAULT false,
  ADD COLUMN critical_locked_at timestamptz;

-- Existing exceptions that are, or ever were recorded as, critical.
UPDATE owner_exception_states s
   SET critical_locked = true,
       critical_locked_at = coalesce((SELECT min(e.occurred_at) FROM owner_exception_events e WHERE e.exception_key = s.exception_key AND e.severity = 'critical'), now())
 WHERE s.severity = 'critical'
    OR EXISTS (SELECT 1 FROM owner_exception_events e WHERE e.exception_key = s.exception_key AND e.severity = 'critical');

CREATE FUNCTION owner_exception_critical_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.critical_locked THEN
    IF NOT NEW.critical_locked THEN
      RAISE EXCEPTION 'owner exception %: an exception that has been critical cannot become dismissible again', OLD.exception_key USING ERRCODE = 'NWX01';
    END IF;
    NEW.critical_locked_at := OLD.critical_locked_at;
  END IF;
  IF NEW.severity = 'critical' THEN NEW.critical_locked := true; END IF;
  IF NEW.critical_locked THEN
    NEW.critical_locked_at := coalesce(NEW.critical_locked_at, now());
  ELSE
    NEW.critical_locked_at := NULL;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER owner_exception_states_critical_lock
  BEFORE INSERT OR UPDATE ON owner_exception_states
  FOR EACH ROW EXECUTE FUNCTION owner_exception_critical_lock();

-- Any history event that records the exception as critical locks it (history is append-only, so
-- this cannot be undone by a later event).
CREATE FUNCTION owner_exception_event_critical_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.severity = 'critical' THEN
    UPDATE owner_exception_states SET critical_locked = true WHERE exception_key = NEW.exception_key AND NOT critical_locked;
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER owner_exception_events_critical_lock
  AFTER INSERT ON owner_exception_events
  FOR EACH ROW EXECUTE FUNCTION owner_exception_event_critical_lock();

-- The lifecycle checks of migration 026, with the lock added to dismissal and snooze.
CREATE OR REPLACE FUNCTION owner_exception_state_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx bigint := txid_current();
  stored text;
  locked boolean;
BEGIN
  -- Deferred: check the row as it is at commit.
  SELECT severity, critical_locked INTO stored, locked FROM owner_exception_states WHERE exception_key = NEW.exception_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM owner_exception_events e WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'observed') THEN
      RAISE EXCEPTION 'owner exception %: a new exception must be recorded by its "observed" event', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
    IF NEW.state <> 'active' THEN
      RAISE EXCEPTION 'owner exception %: a new exception starts active', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.severity IS DISTINCT FROM NEW.severity THEN
    IF NOT EXISTS (SELECT 1 FROM owner_exception_events e WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action IN ('changed', 'observed')) THEN
      RAISE EXCEPTION 'owner exception %: a severity change must be recorded by a "changed" event', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
    IF OLD.severity = 'critical' AND EXISTS (
      SELECT 1 FROM owner_exception_events e WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action IN ('dismiss', 'snooze')
    ) THEN
      RAISE EXCEPTION 'owner exception %: a critical exception cannot be lowered and dismissed or snoozed in one transaction', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
  END IF;
  IF OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NULL; END IF;
  IF NOT (
    (OLD.state = 'active'       AND NEW.state IN ('acknowledged', 'waiting', 'resolved', 'dismissed', 'stale')) OR
    (OLD.state = 'acknowledged' AND NEW.state IN ('waiting', 'resolved', 'dismissed', 'stale')) OR
    (OLD.state = 'waiting'      AND NEW.state IN ('acknowledged', 'resolved', 'dismissed', 'stale')) OR
    (OLD.state = 'stale'        AND NEW.state IN ('acknowledged', 'waiting', 'resolved', 'dismissed')) OR
    (OLD.state IN ('resolved', 'dismissed') AND NEW.state = 'active')
  ) THEN
    RAISE EXCEPTION 'owner exception %: % -> % is not a valid transition', NEW.exception_key, OLD.state, NEW.state USING ERRCODE = 'NWX01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM owner_exception_events e
     WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.from_state = OLD.state AND e.to_state = NEW.state
       AND (NEW.state NOT IN ('dismissed') OR coalesce(btrim(e.reason), '') <> '')
       AND (NOT (OLD.state IN ('resolved', 'dismissed') AND NEW.state = 'active') OR (e.action = 'reopen' AND coalesce(btrim(e.reason), '') <> ''))
  ) THEN
    RAISE EXCEPTION 'owner exception %: the change % -> % must be recorded by its history event (with a reason where one is required)', NEW.exception_key, OLD.state, NEW.state USING ERRCODE = 'NWX01';
  END IF;
  IF NEW.state = 'dismissed' THEN
    IF stored = 'critical' OR OLD.severity = 'critical' THEN
      RAISE EXCEPTION 'owner exception %: a critical exception cannot be dismissed', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
    IF locked OR OLD.critical_locked THEN
      RAISE EXCEPTION 'owner exception %: an exception that has been critical cannot be dismissed', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM owner_exception_events e
       WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'dismiss' AND e.severity = stored
    ) THEN
      RAISE EXCEPTION 'owner exception %: the dismissal must record the exception''s stored severity', NEW.exception_key USING ERRCODE = 'NWX01';
    END IF;
  END IF;
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION owner_exception_snooze_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx bigint := txid_current();
  cur owner_exception_snoozes%ROWTYPE;
  stored text;
  locked boolean;
BEGIN
  SELECT * INTO cur FROM owner_exception_snoozes WHERE exception_key = NEW.exception_key;
  IF NOT FOUND OR cur.snoozed_until <= now() THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.snoozed_until IS NOT DISTINCT FROM NEW.snoozed_until AND OLD.snoozed_until > now() THEN
    RETURN NULL;  -- an existing snooze, extended or shortened by nothing
  END IF;
  SELECT severity, critical_locked INTO stored, locked FROM owner_exception_states WHERE exception_key = NEW.exception_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner exception %: only a recorded exception can be snoozed', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  IF stored = 'critical' THEN
    RAISE EXCEPTION 'owner exception %: a critical exception cannot be snoozed', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  IF locked THEN
    RAISE EXCEPTION 'owner exception %: an exception that has been critical cannot be snoozed', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM owner_exception_events e
     WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'snooze' AND e.severity = stored
  ) THEN
    RAISE EXCEPTION 'owner exception %: a snooze must be recorded by its "snooze" event, with the exception''s stored severity', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  RETURN NULL;
END $$;

-- B. Integrity findings.
CREATE TABLE owner_exception_integrity_findings (
  id                bigserial PRIMARY KEY,
  exception_key     text NOT NULL,
  finding           text NOT NULL CHECK (finding IN ('closed_while_critical', 'severity_lowered_while_critical', 'locked_but_closed')),
  first_detected_at timestamptz NOT NULL DEFAULT now(),
  last_detected_at  timestamptz NOT NULL DEFAULT now(),
  -- The condition no longer holds (detected by a later run). A recurrence is a new finding.
  cleared_at        timestamptz,
  -- What was seen when it was detected (states, severities, event ids; no secrets, no payloads).
  details           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Owner alert delivery: retried by every run until it succeeds.
  alerted_at        timestamptz,
  alert_attempts    integer NOT NULL DEFAULT 0,
  last_alert_error  text
);
CREATE UNIQUE INDEX owner_exception_integrity_findings_open_idx
  ON owner_exception_integrity_findings (exception_key, finding) WHERE cleared_at IS NULL;

CREATE FUNCTION owner_exception_integrity_findings_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'owner exception integrity findings are never deleted' USING ERRCODE = 'NWX01';
END $$;
CREATE TRIGGER owner_exception_integrity_findings_no_delete BEFORE DELETE ON owner_exception_integrity_findings
  FOR EACH ROW EXECUTE FUNCTION owner_exception_integrity_findings_keep();
CREATE TRIGGER owner_exception_integrity_findings_no_truncate BEFORE TRUNCATE ON owner_exception_integrity_findings
  FOR EACH STATEMENT EXECUTE FUNCTION owner_exception_integrity_findings_keep();
