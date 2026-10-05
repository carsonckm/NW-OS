-- Phase 3, part 4: delivery, site receiving, installation, site QC, completion/handover.
-- Delivery is arranged by the contractor unless recorded otherwise; the system records the
-- arrangement and never books transport. Receiving never starts installation: installation
-- jobs carry their own status. A failed site QC links a rectification issue.

CREATE TABLE deliveries (
  id              text PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_package_id text REFERENCES work_packages (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  contractor_id   text,
  arranged_by     text NOT NULL DEFAULT 'Contractor',
  status          text NOT NULL CHECK (status IN (
                    'Not Scheduled', 'Scheduled', 'Loading', 'In Transit', 'Arrived at Site', 'Delivered',
                    'Received / Confirmed', 'Delivery Issue', 'Cancelled', 'Rescheduled')),
  delivery_date   text,
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_by      text
);
CREATE INDEX deliveries_project_idx ON deliveries (project_id);

-- Items on a delivery (work items and production orders), kept in step with the record.
CREATE TABLE delivery_items (
  delivery_id         text NOT NULL REFERENCES deliveries (id) ON UPDATE CASCADE ON DELETE CASCADE DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id        text NOT NULL REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  production_order_id text REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  PRIMARY KEY (delivery_id, work_item_id)
);

-- Every site receipt is a separate, append-only record (who, when, quantities, condition).
CREATE TABLE delivery_receipts (
  id                 text PRIMARY KEY,
  delivery_id        text NOT NULL REFERENCES deliveries (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  project_id         text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  receiver_id        text,
  receiver_name      text,
  received_at        timestamptz NOT NULL,
  condition_status   text NOT NULL,
  packages_expected  integer NOT NULL DEFAULT 0,
  packages_received  integer NOT NULL DEFAULT 0,
  damaged_quantity   integer NOT NULL DEFAULT 0,
  missing_quantity   integer NOT NULL DEFAULT 0,
  signature          text,
  linked_issue_id    text,
  data               jsonb NOT NULL,
  recorded_at        timestamptz NOT NULL DEFAULT now(),
  recorded_by        text
);
CREATE INDEX delivery_receipts_delivery_idx ON delivery_receipts (delivery_id);

CREATE FUNCTION delivery_receipts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'delivery receipts are append-only; record a new receipt instead' USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER delivery_receipts_immutable BEFORE UPDATE OR DELETE ON delivery_receipts
  FOR EACH ROW EXECUTE FUNCTION delivery_receipts_append_only();

CREATE TABLE installation_jobs (
  id               text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_package_id  text REFERENCES work_packages (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id     text NOT NULL REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  contractor_id    text,
  supervisor_id    text,
  status           text NOT NULL CHECK (status IN (
                     'Not Started', 'Scheduled', 'Site Ready', 'In Progress', 'Blocked', 'Pending Information',
                     'Awaiting Inspection', 'QC', 'Rectification', 'Delayed', 'Completed', 'Cancelled')),
  drawing_revision_id text REFERENCES drawing_revisions (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  production_order_id text REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data             jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_by       text
);
CREATE INDEX installation_jobs_project_idx ON installation_jobs (project_id);
CREATE INDEX installation_jobs_work_item_idx ON installation_jobs (work_item_id);

CREATE TABLE site_qc_inspections (
  id                     text PRIMARY KEY,
  project_id             text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id           text NOT NULL REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  installation_job_id    text REFERENCES installation_jobs (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  result                 text NOT NULL CHECK (result IN ('Pass', 'Pass with Minor Rectification', 'Fail / Rectification Required')),
  inspected_at           text,
  -- A failed inspection must link the issue tracking its rectification.
  rectification_issue_id text REFERENCES issues (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data                   jsonb NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  created_by             text,
  updated_by             text,
  CONSTRAINT site_qc_fail_needs_rectification CHECK (
    result <> 'Fail / Rectification Required' OR rectification_issue_id IS NOT NULL)
);
CREATE INDEX site_qc_work_item_idx ON site_qc_inspections (work_item_id);

CREATE TABLE handover_records (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  client_id  text REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);
CREATE INDEX handover_records_project_idx ON handover_records (project_id);
