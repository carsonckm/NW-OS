-- Phase 3, part 3: production. Production orders reference the exact client drawing
-- revision and NW production drawing revision they are built from; the server only accepts
-- approved, non-superseded revisions for new orders and for advancing an order.

CREATE TABLE production_orders (
  id                         text PRIMARY KEY,
  project_id                 text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_package_id            text NOT NULL REFERENCES work_packages (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id               text NOT NULL REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  contractor_id              text,
  status                     text NOT NULL CHECK (status IN (
                               'Not Started', 'Material Required', 'Material Ready', 'Cutting', 'CNC', 'Edge Banding',
                               'Assembly', 'Finishing', 'QC', 'Packing', 'Ready for Delivery', 'Completed', 'Blocked', 'Cancelled')),
  client_drawing_revision_id text REFERENCES drawing_revisions (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  nw_drawing_revision_id     text REFERENCES drawing_revisions (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  -- 'valid': both revisions approved and current when checked. 'invalid': imported legacy
  -- order whose references are missing or superseded; it can only be blocked or held until
  -- it is re-pointed at a valid revision.
  drawing_check              text NOT NULL DEFAULT 'valid' CHECK (drawing_check IN ('valid', 'invalid')),
  drawing_check_reason       text,
  production_method          text,
  data                       jsonb NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 text,
  updated_by                 text,
  -- The order's project must be its work item's project.
  FOREIGN KEY (work_package_id, project_id) REFERENCES work_packages (id, project_id) DEFERRABLE INITIALLY IMMEDIATE,
  CONSTRAINT production_orders_valid_needs_revisions CHECK (
    drawing_check = 'invalid' OR (client_drawing_revision_id IS NOT NULL AND nw_drawing_revision_id IS NOT NULL))
);
CREATE INDEX production_orders_project_idx ON production_orders (project_id);
CREATE INDEX production_orders_work_item_idx ON production_orders (work_item_id);

-- Order-level children: one table per type, each tied to its production order.
CREATE TABLE production_parts (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id        text REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  part_code           text,
  status              text,
  barcode             text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);
CREATE INDEX production_parts_order_idx ON production_parts (production_order_id);

CREATE TABLE cnc_jobs (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status              text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);
CREATE INDEX cnc_jobs_order_idx ON cnc_jobs (production_order_id);

CREATE TABLE assembly_jobs (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status              text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);

CREATE TABLE finishing_jobs (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status              text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);

CREATE TABLE factory_qc_inspections (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  result              text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);
CREATE INDEX factory_qc_order_idx ON factory_qc_inspections (production_order_id);

CREATE TABLE packing_packages (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status              text,
  barcode             text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);
CREATE INDEX packing_packages_order_idx ON packing_packages (production_order_id);

CREATE TABLE production_issues (
  id                  text PRIMARY KEY,
  production_order_id text NOT NULL REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status              text,
  data                jsonb NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          text,
  updated_by          text
);

-- Company-level catalogues: CNC program/file versions and the materials list.
CREATE TABLE cnc_file_versions (
  id         text PRIMARY KEY,
  part_code  text,
  revision   text,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE production_materials (
  id         text PRIMARY KEY,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);
