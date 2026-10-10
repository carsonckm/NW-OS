-- Phase 6 Batch 11 (final review fixes).
--
-- 1. Exception keys cannot be changed. A snooze row could be moved to another exception with
--    UPDATE ... SET exception_key, and the snooze check (migration 027) let an "unchanged" snooze
--    through by comparing snoozed_until only: an active snooze on a non-critical exception could
--    be moved onto a locked one. The key of a state row or a snooze row is now fixed, and the
--    snooze check compares the key as well.
-- 2. Integrity findings are evidence. The runtime role must update them (when they were last
--    seen, cleared, alerted), but it can no longer rewrite what was found, reset or move dates
--    backwards, un-clear or re-clear a finding, or mark it alerted without the Owner notification
--    existing.

CREATE FUNCTION owner_exception_key_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.exception_key IS DISTINCT FROM OLD.exception_key THEN
    RAISE EXCEPTION 'owner exception %: the exception key of a % row cannot be changed', OLD.exception_key, TG_TABLE_NAME USING ERRCODE = 'NWX01';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER owner_exception_states_key_fixed BEFORE UPDATE OF exception_key ON owner_exception_states
  FOR EACH ROW EXECUTE FUNCTION owner_exception_key_fixed();
CREATE TRIGGER owner_exception_snoozes_key_fixed BEFORE UPDATE OF exception_key ON owner_exception_snoozes
  FOR EACH ROW EXECUTE FUNCTION owner_exception_key_fixed();

-- The snooze check of migration 027, with the key compared in the "unchanged snooze" shortcut.
CREATE OR REPLACE FUNCTION owner_exception_snooze_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tx bigint := txid_current();
  cur owner_exception_snoozes%ROWTYPE;
  stored text;
  locked boolean;
BEGIN
  SELECT * INTO cur FROM owner_exception_snoozes WHERE exception_key = NEW.exception_key;
  IF NOT FOUND OR cur.snoozed_until <= now() THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.exception_key = NEW.exception_key
     AND OLD.snoozed_until IS NOT DISTINCT FROM NEW.snoozed_until AND OLD.snoozed_until > now() THEN
    RETURN NULL;  -- the same exception's existing snooze, extended or shortened by nothing
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

CREATE FUNCTION owner_exception_integrity_findings_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.exception_key IS DISTINCT FROM OLD.exception_key OR NEW.finding IS DISTINCT FROM OLD.finding
     OR NEW.first_detected_at IS DISTINCT FROM OLD.first_detected_at OR NEW.details IS DISTINCT FROM OLD.details THEN
    RAISE EXCEPTION 'integrity finding %: what was found cannot be changed', OLD.id USING ERRCODE = 'NWX01';
  END IF;
  IF NEW.last_detected_at < OLD.last_detected_at THEN
    RAISE EXCEPTION 'integrity finding %: last_detected_at cannot go backwards', OLD.id USING ERRCODE = 'NWX01';
  END IF;
  IF OLD.cleared_at IS NOT NULL AND NEW.cleared_at IS DISTINCT FROM OLD.cleared_at THEN
    RAISE EXCEPTION 'integrity finding %: a cleared finding stays cleared (a recurrence is a new finding)', OLD.id USING ERRCODE = 'NWX01';
  END IF;
  IF NEW.alert_attempts < OLD.alert_attempts THEN
    RAISE EXCEPTION 'integrity finding %: alert attempts cannot decrease', OLD.id USING ERRCODE = 'NWX01';
  END IF;
  IF OLD.alerted_at IS NOT NULL AND NEW.alerted_at IS DISTINCT FROM OLD.alerted_at THEN
    RAISE EXCEPTION 'integrity finding %: a delivered alert cannot be changed', OLD.id USING ERRCODE = 'NWX01';
  END IF;
  IF OLD.alerted_at IS NULL AND NEW.alerted_at IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id
     WHERE n.rule_key = 'exception-integrity:' || OLD.id AND u.role = 'Owner / CEO' AND u.is_active
  ) THEN
    RAISE EXCEPTION 'integrity finding %: it can be marked alerted only once the Owner notification exists', OLD.id USING ERRCODE = 'NWX01';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER owner_exception_integrity_findings_guard BEFORE UPDATE ON owner_exception_integrity_findings
  FOR EACH ROW EXECUTE FUNCTION owner_exception_integrity_findings_guard();
