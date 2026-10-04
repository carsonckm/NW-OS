-- Phase 3, part 1: append-only audit log, drawings with immutable revisions, documents.
--
-- Module tables follow one pattern ("hybrid"): real columns for keys, relationships and
-- rule-critical fields (with foreign keys and checks), plus `data`, the full record in the
-- shape of its TypeScript type, validated by the server before it is written.

-- ---------------------------------------------------------------------------
-- Audit log: written by the server inside the same transaction as each change.
-- No foreign keys, so entries survive the deletion of what they describe.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id    text,
  actor_name  text,
  actor_role  text,
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  project_id  text,
  before      jsonb,
  after       jsonb,
  details     text,
  ip          text
);

CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id);
CREATE INDEX audit_logs_project_idx ON audit_logs (project_id, occurred_at DESC);
CREATE INDEX audit_logs_occurred_idx ON audit_logs (occurred_at DESC);

CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'P0001';
END $$;

CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

-- ---------------------------------------------------------------------------
-- Drawings (type Drawing). Revisions are stored separately and never inside `data`.
-- ---------------------------------------------------------------------------
CREATE TABLE drawings (
  id                  text PRIMARY KEY,
  project_id          text NOT NULL REFERENCES projects (id)
                        ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  drawing_number      text NOT NULL,
  status              text CHECK (status IN ('Draft', 'Submitted', 'Pending Review', 'Review', 'Approved', 'Superseded', 'Rejected')),
  current_revision_id text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);

CREATE INDEX drawings_project_idx ON drawings (project_id);

-- Client drawing revisions (DrawingRevision) and NW production drawings (NWProductionDrawing).
-- A revision is never overwritten or deleted: a new revision is a new row, and the previous
-- current revision is marked superseded.
CREATE TABLE drawing_revisions (
  id                        text PRIMARY KEY,
  drawing_id                text NOT NULL REFERENCES drawings (id)
                              ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  kind                      text NOT NULL CHECK (kind IN ('client', 'nw_production')),
  revision                  text NOT NULL,
  approval_status           text NOT NULL,
  is_current                boolean NOT NULL DEFAULT false,
  approved_for_production   boolean NOT NULL DEFAULT false,
  -- NW production drawing: the client revision it was produced from.
  linked_client_revision_id text REFERENCES drawing_revisions (id) DEFERRABLE INITIALLY IMMEDIATE,
  file_url                  text,
  -- SHA-256 of the revision's immutable content (file, title, dimensions, instructions...).
  content_hash              text NOT NULL,
  superseded_at             timestamptz,
  data                      jsonb NOT NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  created_by                text,
  updated_at                timestamptz NOT NULL DEFAULT now(),
  UNIQUE (drawing_id, kind, revision)
);

CREATE INDEX drawing_revisions_drawing_idx ON drawing_revisions (drawing_id);

CREATE FUNCTION drawing_revisions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'drawing revisions cannot be deleted (revision %)', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF NEW.drawing_id IS DISTINCT FROM OLD.drawing_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.file_url IS DISTINCT FROM OLD.file_url
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.linked_client_revision_id IS DISTINCT FROM OLD.linked_client_revision_id THEN
    RAISE EXCEPTION 'drawing revision % is immutable; upload a new revision instead', OLD.id USING ERRCODE = 'P0001';
  END IF;
  IF OLD.approval_status = 'Superseded' AND NEW.approval_status <> 'Superseded' THEN
    RAISE EXCEPTION 'superseded revision % cannot be reinstated', OLD.id USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER drawing_revisions_immutable BEFORE UPDATE OR DELETE ON drawing_revisions
  FOR EACH ROW EXECUTE FUNCTION drawing_revisions_guard();

-- A work item records the exact client drawing revision it was created from (set once).
ALTER TABLE work_items
  ADD COLUMN source_drawing_revision_id text REFERENCES drawing_revisions (id)
    ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE;

-- ---------------------------------------------------------------------------
-- Project documents (ProjectDocument).
-- ---------------------------------------------------------------------------
CREATE TABLE documents (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id)
               ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE INDEX documents_project_idx ON documents (project_id);
