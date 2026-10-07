-- Phase 6 (Batch 1 review): project sensitivity is a hard authority ceiling.
--
--   Strategic  -> only the Owner may approve any decision on the project.
--   Sensitive  -> only the Owner may approve the protected decision types.
--   Normal     -> delegated authority may apply.
--
-- Delegated authority management can no longer switch the Sensitive protection off: to change
-- the authority model for a project the Owner changes the project's sensitivity (reason, audit).

-- Which decision types Sensitive protects. Not editable through any API; a decision type added
-- later is protected unless a migration says otherwise (fail closed).
ALTER TABLE authority_decision_types ADD COLUMN sensitive_protected boolean NOT NULL DEFAULT true;

-- The Sensitive policy rows are locked like the Strategic ones (and re-enabled if switched off).
UPDATE delegated_authorities
   SET locked = true, active = true, deactivated_at = NULL, deactivated_by = NULL, deactivation_reason = NULL,
       description = 'Built-in policy (locked): on a project marked Sensitive, ' || lower(t.label) || ' always needs the Owner.',
       updated_at = now()
  FROM authority_decision_types t
 WHERE delegated_authorities.system_key = 'sensitivity.sensitive.' || t.key;

-- Defence in depth: a locked System Policy row cannot be deactivated, unlocked or redefined,
-- whatever path writes to the table.
CREATE FUNCTION delegated_authorities_locked_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.locked AND (
       NEW.active IS DISTINCT FROM OLD.active OR NEW.locked IS DISTINCT FROM OLD.locked OR
       NEW.effect IS DISTINCT FROM OLD.effect OR NEW.decision_type IS DISTINCT FROM OLD.decision_type OR
       NEW.conditions IS DISTINCT FROM OLD.conditions OR NEW.priority IS DISTINCT FROM OLD.priority OR
       NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.client_id IS DISTINCT FROM OLD.client_id OR
       NEW.start_at IS DISTINCT FROM OLD.start_at OR NEW.end_at IS DISTINCT FROM OLD.end_at) THEN
    RAISE EXCEPTION 'System Policy % is locked', OLD.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delegated_authorities_locked_guard BEFORE UPDATE ON delegated_authorities
  FOR EACH ROW EXECUTE FUNCTION delegated_authorities_locked_guard();

CREATE FUNCTION delegated_authorities_locked_delete_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.locked THEN
    RAISE EXCEPTION 'System Policy % is locked', OLD.code USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delegated_authorities_locked_delete_guard BEFORE DELETE ON delegated_authorities
  FOR EACH ROW EXECUTE FUNCTION delegated_authorities_locked_delete_guard();
