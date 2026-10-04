-- Core chain: Clients -> Projects -> Work Packages -> Work Items.
-- Mirrors the Client, Project, WorkPackage and WorkItem interfaces in src/types.ts.
-- Ids stay text so existing ids (e.g. "proj-1715...") import unchanged.
-- Foreign keys are RESTRICT: deleting a parent with children fails instead of
-- silently removing business data. They are DEFERRABLE so a batch sync can write
-- parents and children in any order inside one transaction.
-- Dates the UI may leave blank are nullable; the API maps NULL <-> ''.

CREATE TABLE clients (
  id                  text PRIMARY KEY,
  client_type         text NOT NULL CHECK (client_type IN (
                        'Company', 'Individual / Homeowner', 'Corporate', 'Retail',
                        'Commercial', 'F&B', 'Luxury Residential')),
  company_name        text NOT NULL,
  registration_number text NOT NULL DEFAULT '',
  contact_person      text NOT NULL,
  email               text NOT NULL DEFAULT '',
  phone               text NOT NULL,
  billing_address     text NOT NULL DEFAULT '',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id                 text PRIMARY KEY,
  project_number     text NOT NULL,
  project_name       text NOT NULL,
  client_id          text NOT NULL REFERENCES clients (id)
                       ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  site_address       text NOT NULL,
  contract_value     numeric(14, 2) NOT NULL CHECK (contract_value >= 0),
  project_status     text NOT NULL CHECK (project_status IN (
                       'Awarded', 'Pre-Start', 'Active', 'Practical Completion',
                       'Completed', 'Closed', 'On Hold')),
  risk_status        text CHECK (risk_status IN ('On Track', 'Attention', 'At Risk', 'Critical')),
  start_date         date,
  end_date           date,
  signed_date        date,
  project_manager_id text NOT NULL DEFAULT '',
  site_supervisor_id text NOT NULL DEFAULT '',
  progress_percent   integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  description        text NOT NULL DEFAULT '',
  is_at_risk         boolean,
  risk_reason        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX projects_client_id_idx ON projects (client_id);
CREATE INDEX projects_project_number_idx ON projects (project_number);

CREATE TABLE work_packages (
  id                 text PRIMARY KEY,
  project_id         text NOT NULL REFERENCES projects (id)
                       ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  name               text NOT NULL,
  category           text NOT NULL,
  trade              text,
  contractor_id      text NOT NULL DEFAULT '',
  project_manager_id text NOT NULL DEFAULT '',
  start_date         date,
  end_date           date,
  status             text NOT NULL,
  progress_percent   integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  notes              text,
  scope              text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Target for work_items' composite key, so an item's project must match its package's.
  UNIQUE (id, project_id)
);

CREATE INDEX work_packages_project_id_idx ON work_packages (project_id);

CREATE TABLE work_items (
  id                             text PRIMARY KEY,
  work_package_id                text NOT NULL,
  project_id                     text NOT NULL REFERENCES projects (id)
                                   ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  item_code                      text NOT NULL,
  description                    text NOT NULL,
  location                       text NOT NULL DEFAULT '',
  quantity                       numeric(12, 3) NOT NULL CHECK (quantity >= 0),
  unit                           text NOT NULL DEFAULT '',
  drawing_id                     text NOT NULL DEFAULT '',
  drawing_revision               text NOT NULL DEFAULT '',
  client_drawing_id              text,
  client_drawing_revision        text,
  nw_production_drawing_id       text,
  nw_production_drawing_revision text,
  production_instruction         jsonb,
  revision_impact_alert          jsonb,
  material                       text NOT NULL DEFAULT '',
  finish                         text NOT NULL DEFAULT '',
  dimensions                     text NOT NULL DEFAULT '',
  required_date                  date,
  contractor_id                  text NOT NULL DEFAULT '',
  status                         text NOT NULL CHECK (status IN (
                                   'Draft', 'Assigned', 'Contractor Confirmed', 'In Progress',
                                   'Ready for QC', 'QC Failed', 'QC Passed', 'Ready for Delivery',
                                   'Delivered', 'Installation In Progress', 'Installation QC',
                                   'Completed', 'On Hold', 'Blocked', 'Cancelled')),
  progress_percent               integer NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  notes                          text,
  photos                         jsonb NOT NULL DEFAULT '[]'::jsonb,
  item_photos                    jsonb,
  production_order_id            text,
  production_status              text NOT NULL CHECK (production_status IN (
                                   'Not Started', 'Material Required', 'Material Ready', 'Cutting',
                                   'CNC', 'Edge Banding', 'Assembly', 'Finishing', 'QC', 'Packing',
                                   'Ready for Delivery', 'Completed', 'Blocked', 'Cancelled')),
  delivery_status                text NOT NULL CHECK (delivery_status IN (
                                   'Not Scheduled', 'Scheduled', 'Loading', 'In Transit',
                                   'Arrived at Site', 'Delivered', 'Received / Confirmed',
                                   'Delivery Issue', 'Cancelled', 'Rescheduled')),
  installation_status            text NOT NULL CHECK (installation_status IN (
                                   'Not Started', 'Scheduled', 'In Progress', 'Pending / Blocked',
                                   'Awaiting Inspection', 'QC', 'Rectification', 'Completed', 'Delayed')),
  scheduled_delivery_date        date,
  scheduled_delivery_time        text,
  -- Free text: the app records it with toLocaleString(), e.g. "10/4/2026, 9:30:00 AM".
  received_delivery_date         text,
  created_at                     timestamptz NOT NULL DEFAULT now(),
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (work_package_id, project_id) REFERENCES work_packages (id, project_id)
    ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE
);

CREATE INDEX work_items_work_package_id_idx ON work_items (work_package_id);
CREATE INDEX work_items_project_id_idx ON work_items (project_id);
