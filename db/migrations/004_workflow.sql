-- Phase 3, part 2: issues, tasks, escalations, approvals, variations, client change
-- requests, work item QC records and site measurements. Same hybrid pattern as 003:
-- relationship and rule columns with constraints, plus the full validated record in `data`.

CREATE TABLE issues (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id text REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status       text NOT NULL CHECK (status IN (
                 'Reported', 'Assigned', 'Investigating', 'Waiting for Info', 'Decision Required',
                 'Action in Progress', 'Resolved', 'Closed')),
  priority     text,
  assigned_to_id text,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  updated_by   text
);
CREATE INDEX issues_project_idx ON issues (project_id);
CREATE INDEX issues_work_item_idx ON issues (work_item_id);

CREATE TABLE tasks (
  id               text PRIMARY KEY,
  project_id       text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_package_id  text REFERENCES work_packages (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id     text REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status           text NOT NULL CHECK (status IN ('Open', 'In Progress', 'Waiting', 'Completed', 'Cancelled', 'Escalated', 'Blocked')),
  priority         text,
  assigned_user_id text,
  due_date         text,
  data             jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_by       text
);
CREATE INDEX tasks_project_idx ON tasks (project_id);
CREATE INDEX tasks_assignee_idx ON tasks (assigned_user_id);

CREATE TABLE escalations (
  id         text PRIMARY KEY,
  project_id text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);
CREATE INDEX escalations_project_idx ON escalations (project_id);

-- Approvals: the decision is a status; who may decide is checked on the server.
CREATE TABLE approvals (
  id                 text PRIMARY KEY,
  project_id         text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  approval_type      text NOT NULL,
  related_entity_type text,
  related_entity_id  text,
  requested_by_id    text,
  decision           text NOT NULL CHECK (decision IN ('Pending', 'Approved', 'Rejected', 'Changes Requested')),
  decision_by_id     text,
  decision_at        timestamptz,
  data               jsonb NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         text,
  updated_by         text
);
CREATE INDEX approvals_project_idx ON approvals (project_id);
CREATE INDEX approvals_entity_idx ON approvals (related_entity_type, related_entity_id);

-- Variations: amounts are columns so the contract summary is computed in SQL from
-- approved variations only; a proposed variation never changes the contract value.
CREATE TABLE variations (
  id               text PRIMARY KEY,
  project_id       text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  variation_number text NOT NULL,
  status           text NOT NULL CHECK (status IN (
                     'Identified', 'Costing', 'Internal Approval', 'Client Approval', 'Approved',
                     'Rejected', 'Implemented', 'Closed')),
  estimated_cost   numeric(14, 2) NOT NULL DEFAULT 0,
  client_amount    numeric(14, 2) NOT NULL DEFAULT 0,
  approved_at      timestamptz,
  data             jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       text,
  updated_by       text
);
CREATE INDEX variations_project_idx ON variations (project_id);

CREATE TABLE client_change_requests (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id text REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  linked_variation_id text REFERENCES variations (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status       text,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  updated_by   text
);
CREATE INDEX client_change_requests_project_idx ON client_change_requests (project_id);

-- Work item QC records (QCRecord) and site measurements (SiteMeasurementRecord).
CREATE TABLE qc_records (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id text NOT NULL REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  result       text,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  updated_by   text
);
CREATE INDEX qc_records_work_item_idx ON qc_records (work_item_id);

CREATE TABLE site_measurements (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id text REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  updated_by   text
);
CREATE INDEX site_measurements_project_idx ON site_measurements (project_id);
