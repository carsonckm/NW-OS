-- Pilot readiness: the subcontractor register and private file storage.
--
--  1. contractors: the shared subcontractor register (before this it lived in each browser).
--     contractor_project_assignments: which projects a subcontractor is assigned to. A
--     subcontractor is also on every project where its id appears on a work package, work item,
--     installation job or production order (derived, nothing to keep in step). Who may see which
--     subcontractor is decided in the server (server/modules/scope.ts): staff with access to all
--     projects see the register, project-scoped staff only subcontractors on their projects, a
--     Contractor account only its own company. Subcontractors are deactivated, never deleted.
--  2. files / file_contents: the bytes of drawings, drawing revisions, site photographs and
--     project attachments, kept in the database (private by construction, covered by the
--     database's backups, no public URL). The server authorizes every upload and download
--     against the record the file belongs to (server/files). A file is immutable: its bytes,
--     size, hash, project and uploader never change; it is linked to its record once; nothing is
--     deleted. The database checks the bytes against the recorded size and SHA-256.

-- ---------------------------------------------------------------- subcontractor register
CREATE TABLE contractors (
  id           text PRIMARY KEY,
  company_name text NOT NULL CHECK (btrim(company_name) <> ''),
  trade        text,
  is_active    boolean NOT NULL DEFAULT true,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  updated_by   text
);

CREATE TABLE contractor_project_assignments (
  contractor_id text NOT NULL REFERENCES contractors (id) ON UPDATE CASCADE ON DELETE CASCADE,
  project_id    text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE CASCADE,
  assigned_by   text,
  assigned_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contractor_id, project_id)
);
CREATE INDEX contractor_project_assignments_project_idx ON contractor_project_assignments (project_id);

-- Subcontractor ids already in use (accounts, packages, items, jobs, orders) get a register entry
-- to complete, so nothing refers to an unknown subcontractor.
INSERT INTO contractors (id, company_name, data)
SELECT ids.id, 'Unregistered subcontractor ' || ids.id,
       jsonb_build_object('id', ids.id, 'company_name', 'Unregistered subcontractor ' || ids.id, 'contact_person', '', 'phone', '',
                          'trade', '', 'is_active', true, 'needs_details', true)
  FROM (SELECT contractor_id AS id FROM users
        UNION SELECT contractor_id FROM work_packages
        UNION SELECT contractor_id FROM work_items
        UNION SELECT contractor_id FROM installation_jobs
        UNION SELECT contractor_id FROM production_orders) ids
 WHERE coalesce(btrim(ids.id), '') <> ''
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------- private files
CREATE TABLE files (
  id                text PRIMARY KEY,
  project_id        text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  purpose           text NOT NULL CHECK (purpose IN ('drawing', 'site_photo', 'attachment')),
  -- The record the file belongs to (a module collection key and id), and for a drawing the
  -- revision. Set at upload, or once when the record that uses the file is created.
  record_collection text,
  record_id         text,
  revision_id       text,
  file_name         text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  content_type      text NOT NULL,
  size_bytes        integer NOT NULL CHECK (size_bytes > 0),
  sha256            text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by_id    text NOT NULL,
  uploaded_by_name  text,
  -- Whether the uploader is the transaction's database-verified identity (migration 031).
  uploaded_by_verified boolean,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  linked_at         timestamptz,
  CHECK ((record_collection IS NULL) = (record_id IS NULL))
);
CREATE INDEX files_record_idx ON files (record_collection, record_id);
CREATE INDEX files_project_idx ON files (project_id);

CREATE TABLE file_contents (
  file_id text PRIMARY KEY REFERENCES files (id) ON DELETE RESTRICT,
  bytes   bytea NOT NULL
);

-- A file never changes: only its link to a record is set, once.
CREATE FUNCTION files_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Files are kept: % cannot be deleted', OLD.id USING ERRCODE = 'NWF01'; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.uploaded_by_verified := coalesce(NEW.uploaded_by_id = (SELECT user_id FROM auth_identity()), false);
    NEW.linked_at := CASE WHEN NEW.record_id IS NOT NULL THEN now() END;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - ARRAY['record_collection', 'record_id', 'revision_id', 'linked_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['record_collection', 'record_id', 'revision_id', 'linked_at']) THEN
    RAISE EXCEPTION 'File % is immutable', OLD.id USING ERRCODE = 'NWF01';
  END IF;
  IF OLD.record_id IS NOT NULL AND (NEW.record_collection, NEW.record_id, NEW.revision_id) IS DISTINCT FROM (OLD.record_collection, OLD.record_id, OLD.revision_id) THEN
    RAISE EXCEPTION 'File % already belongs to %', OLD.id, OLD.record_id USING ERRCODE = 'NWF01';
  END IF;
  IF OLD.record_id IS NULL AND NEW.record_id IS NOT NULL THEN NEW.linked_at := now(); ELSE NEW.linked_at := OLD.linked_at; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER files_immutable BEFORE INSERT OR UPDATE OR DELETE ON files FOR EACH ROW EXECUTE FUNCTION files_immutable();

-- The bytes are written once and must match the recorded size and hash.
CREATE FUNCTION file_contents_check() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE f files%ROWTYPE;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'File contents are immutable' USING ERRCODE = 'NWF01'; END IF;
  SELECT * INTO f FROM files WHERE id = NEW.file_id;
  IF NOT FOUND OR length(NEW.bytes) <> f.size_bytes OR encode(sha256(NEW.bytes), 'hex') <> f.sha256 THEN
    RAISE EXCEPTION 'File contents do not match the recorded size and hash' USING ERRCODE = 'NWF01';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER file_contents_check BEFORE INSERT OR UPDATE OR DELETE ON file_contents FOR EACH ROW EXECUTE FUNCTION file_contents_check();

-- Definer functions resolve names in this schema only (as in migration 031).
DO $$
BEGIN
  EXECUTE format('ALTER FUNCTION files_immutable() SET search_path = %I, pg_temp', current_schema());
  EXECUTE format('ALTER FUNCTION file_contents_check() SET search_path = %I, pg_temp', current_schema());
END $$;
