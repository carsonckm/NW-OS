-- Phase 6 Batch 11: a critical exception cannot be dismissed or snoozed, by the stored severity.
--
-- Migration 025 refused a dismissal or snooze whose history event recorded the exception as
-- critical. The event's severity is written by the caller, so a direct write could record a
-- false, non-critical severity. These checks now use the exception's authoritative stored
-- severity (owner_exception_states.severity, kept current by NW OS from live data):
--
--  * a dismissal or snooze is refused while the stored severity is critical;
--  * its event must record the stored severity (not a different one);
--  * the stored severity cannot be lowered from critical in the same transaction as a dismissal
--    or snooze of that exception (whatever the order of the statements);
--  * an event of another exception, another transaction or another action never counts.
--
-- Everything else from migration 025 is unchanged. Lifecycle refusals now use their own SQLSTATE,
-- NWX01, so the API can answer with a generic conflict instead of an internal error.
-- The checks stay deferred constraint triggers (run at COMMIT); the triggers themselves are kept.

CREATE OR REPLACE FUNCTION owner_exception_state_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx bigint := txid_current();
  stored text;
BEGIN
  -- Deferred: check the row as it is at commit.
  SELECT severity INTO stored FROM owner_exception_states WHERE exception_key = NEW.exception_key;
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
    -- Lowering a critical exception and dismissing or snoozing it cannot share a transaction.
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
    -- The authoritative severity is the stored one, before and after this change.
    IF stored = 'critical' OR OLD.severity = 'critical' THEN
      RAISE EXCEPTION 'owner exception %: a critical exception cannot be dismissed', NEW.exception_key USING ERRCODE = 'NWX01';
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
BEGIN
  SELECT * INTO cur FROM owner_exception_snoozes WHERE exception_key = NEW.exception_key;
  IF NOT FOUND OR cur.snoozed_until <= now() THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.snoozed_until IS NOT DISTINCT FROM NEW.snoozed_until AND OLD.snoozed_until > now() THEN
    RETURN NULL;  -- an existing snooze, extended or shortened by nothing
  END IF;
  SELECT severity INTO stored FROM owner_exception_states WHERE exception_key = NEW.exception_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner exception %: only a recorded exception can be snoozed', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  -- The authoritative severity is the stored one (a lowering in this transaction is refused by
  -- owner_exception_state_check).
  IF stored = 'critical' THEN
    RAISE EXCEPTION 'owner exception %: a critical exception cannot be snoozed', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM owner_exception_events e
     WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'snooze' AND e.severity = stored
  ) THEN
    RAISE EXCEPTION 'owner exception %: a snooze must be recorded by its "snooze" event, with the exception''s stored severity', NEW.exception_key USING ERRCODE = 'NWX01';
  END IF;
  RETURN NULL;
END $$;
