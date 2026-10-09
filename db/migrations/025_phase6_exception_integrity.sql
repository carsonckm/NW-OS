-- Phase 6 Batch 10: database-enforced integrity for the Owner exception lifecycle.
--
-- With role separation (docs/database-privileges.md) the runtime role can no longer disable or
-- replace these protections. It still legitimately writes exception states, snoozes and history,
-- so these checks make sure a direct write cannot do what the API refuses:
--
--  * every state change follows the lifecycle state machine and is recorded, in the same
--    transaction, by a history event with the same from / to state (no silent state changes);
--  * a critical exception is never dismissed, and never snoozed (by the severity the server
--    recomputed for the action and recorded on its event);
--  * a dismissal or reopen event carries a reason;
--  * a severity change is recorded by a "changed" event in the same transaction;
--  * a new state row starts "active" with its "observed" event.
--
-- The checks are deferred constraint triggers: they run at COMMIT, after the server has written
-- both the state and its event, so the order of the two writes does not matter.

-- Which transaction wrote each history event (to tie a state change to its own event).
ALTER TABLE owner_exception_events ADD COLUMN txid bigint NOT NULL DEFAULT txid_current();
CREATE INDEX owner_exception_events_tx_idx ON owner_exception_events (exception_key, txid);

CREATE FUNCTION owner_exception_state_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx bigint := txid_current();
BEGIN
  -- Deferred: check the row as it is at commit.
  IF NOT EXISTS (SELECT 1 FROM owner_exception_states WHERE exception_key = NEW.exception_key) THEN RETURN NULL; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM owner_exception_events e WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'observed') THEN
      RAISE EXCEPTION 'owner exception %: a new exception must be recorded by its "observed" event', NEW.exception_key USING ERRCODE = 'P0001';
    END IF;
    IF NEW.state <> 'active' THEN
      RAISE EXCEPTION 'owner exception %: a new exception starts active', NEW.exception_key USING ERRCODE = 'P0001';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.severity IS DISTINCT FROM NEW.severity
     AND NOT EXISTS (SELECT 1 FROM owner_exception_events e WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action IN ('changed', 'observed')) THEN
    RAISE EXCEPTION 'owner exception %: a severity change must be recorded by a "changed" event', NEW.exception_key USING ERRCODE = 'P0001';
  END IF;
  IF OLD.state IS NOT DISTINCT FROM NEW.state THEN RETURN NULL; END IF;
  IF NOT (
    (OLD.state = 'active'       AND NEW.state IN ('acknowledged', 'waiting', 'resolved', 'dismissed', 'stale')) OR
    (OLD.state = 'acknowledged' AND NEW.state IN ('waiting', 'resolved', 'dismissed', 'stale')) OR
    (OLD.state = 'waiting'      AND NEW.state IN ('acknowledged', 'resolved', 'dismissed', 'stale')) OR
    (OLD.state = 'stale'        AND NEW.state IN ('acknowledged', 'waiting', 'resolved', 'dismissed')) OR
    (OLD.state IN ('resolved', 'dismissed') AND NEW.state = 'active')
  ) THEN
    RAISE EXCEPTION 'owner exception %: % -> % is not a valid transition', NEW.exception_key, OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM owner_exception_events e
     WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.from_state = OLD.state AND e.to_state = NEW.state
       AND (NEW.state NOT IN ('dismissed') OR coalesce(btrim(e.reason), '') <> '')
       AND (NOT (OLD.state IN ('resolved', 'dismissed') AND NEW.state = 'active') OR (e.action = 'reopen' AND coalesce(btrim(e.reason), '') <> ''))
  ) THEN
    RAISE EXCEPTION 'owner exception %: the change % -> % must be recorded by its history event (with a reason where one is required)', NEW.exception_key, OLD.state, NEW.state USING ERRCODE = 'P0001';
  END IF;
  -- Severity is the server's own, recomputed at the moment of the action and recorded on the event.
  IF NEW.state = 'dismissed' AND NOT EXISTS (
    SELECT 1 FROM owner_exception_events e
     WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'dismiss' AND e.severity IS NOT NULL AND e.severity <> 'critical'
  ) THEN
    RAISE EXCEPTION 'owner exception %: a critical exception cannot be dismissed', NEW.exception_key USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER owner_exception_states_integrity
  AFTER INSERT OR UPDATE ON owner_exception_states
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION owner_exception_state_check();

-- Snoozing hides an exception, so it must be a recorded, non-critical one with its "snooze" event.
-- Ending a snooze (which only makes the exception visible again) needs no check.
CREATE FUNCTION owner_exception_snooze_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx bigint := txid_current();
  cur owner_exception_snoozes%ROWTYPE;
BEGIN
  SELECT * INTO cur FROM owner_exception_snoozes WHERE exception_key = NEW.exception_key;
  IF NOT FOUND OR cur.snoozed_until <= now() THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.snoozed_until IS NOT DISTINCT FROM NEW.snoozed_until AND OLD.snoozed_until > now() THEN
    RETURN NULL;  -- an existing snooze, extended or shortened by nothing
  END IF;
  IF NOT EXISTS (SELECT 1 FROM owner_exception_states s WHERE s.exception_key = NEW.exception_key) THEN
    RAISE EXCEPTION 'owner exception %: only a recorded exception can be snoozed', NEW.exception_key USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM owner_exception_events e
     WHERE e.exception_key = NEW.exception_key AND e.txid = tx AND e.action = 'snooze' AND e.severity IS NOT NULL AND e.severity <> 'critical'
  ) THEN
    RAISE EXCEPTION 'owner exception %: a snooze must be recorded by its "snooze" event, and a critical exception cannot be snoozed', NEW.exception_key USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER owner_exception_snoozes_integrity
  AFTER INSERT OR UPDATE ON owner_exception_snoozes
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION owner_exception_snooze_check();
