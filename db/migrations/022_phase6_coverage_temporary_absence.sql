-- Phase 6 Batch 6: delegation coverage, temporary authority and Owner absence
-- (docs/phase6-coverage-temporary-authority.md).
--
-- Temporary and absence authority are ordinary Owner rules in delegated_authorities, marked with
-- authority_type: the same resolver, the same sensitivity ceiling, the same validation and audit.
-- There is no second authority system. An absence is a record of the Owner's configuration and
-- the temporary rules it created; it grants nothing by itself.

ALTER TABLE delegated_authorities
  ADD COLUMN authority_type text NOT NULL DEFAULT 'permanent' CHECK (authority_type IN ('permanent', 'temporary', 'absence')),
  -- The rule this one extends (an extension is a new rule; the old one is switched off).
  ADD COLUMN extended_from text REFERENCES delegated_authorities (id),
  -- Set once the server has processed the rule's end (audited, approvals re-evaluated).
  ADD COLUMN expiry_processed_at timestamptz;
-- Temporary and absence authority always has an end, is an Owner allow rule and has a start.
ALTER TABLE delegated_authorities ADD CONSTRAINT delegated_authorities_temporary_check
  CHECK (authority_type = 'permanent' OR (kind = 'owner' AND effect = 'allow' AND start_at IS NOT NULL AND end_at IS NOT NULL));
CREATE INDEX delegated_authorities_end_idx ON delegated_authorities (end_at) WHERE end_at IS NOT NULL AND expiry_processed_at IS NULL;

CREATE TABLE owner_absences (
  id              text PRIMARY KEY,
  owner_id        text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  backup_user_id  text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  start_at        timestamptz NOT NULL,
  end_at          timestamptz NOT NULL,
  decision_types  text[] NOT NULL CHECK (cardinality(decision_types) BETWEEN 1 AND 10),
  max_value       numeric(14, 2),
  max_risk        text CHECK (max_risk IS NULL OR max_risk IN ('On Track', 'Attention', 'At Risk', 'Critical')),
  project_id      text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  client_id       text REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  reason          text NOT NULL CHECK (length(trim(reason)) > 0),
  -- scheduled -> active -> ended; or cancelled / ended early by the Owner.
  status          text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'ended', 'cancelled')),
  activated_at    timestamptz,
  ended_at        timestamptz,
  ended_by        text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  end_reason      text,
  created_by      text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at      timestamptz NOT NULL DEFAULT now(),
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (start_at < end_at),
  CHECK (owner_id <> backup_user_id)
);
-- The rules an absence created.
ALTER TABLE delegated_authorities ADD COLUMN absence_id text REFERENCES owner_absences (id);
ALTER TABLE delegated_authorities ADD CONSTRAINT delegated_authorities_absence_check CHECK ((authority_type = 'absence') = (absence_id IS NOT NULL));
CREATE INDEX owner_absences_status_idx ON owner_absences (status, start_at, end_at);
CREATE SEQUENCE owner_absence_seq;

-- Last known coverage status per coverage cell, so a change (e.g. to Uncovered) is noticed and
-- notified once, not on every calculation.
CREATE TABLE delegation_coverage_state (
  cell_key    text PRIMARY KEY,
  status      text NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
