-- Phase 3, part 5: commercial. Amount columns carry the figures the server uses to compute
-- contract value, committed cost (purchase orders), actual cost (incurred ledger entries) and
-- project gross profit, so those figures never come from the browser.

CREATE TABLE client_enquiries (
  id         text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE commercial_tenders (
  id         text PRIMARY KEY,
  client_id  text NOT NULL REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  enquiry_id text REFERENCES client_enquiries (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

-- Quotations (and their versions/items inside `data`); project_id is set once awarded.
CREATE TABLE commercial_quotations (
  id                   text PRIMARY KEY,
  client_id            text NOT NULL REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  project_id           text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status               text NOT NULL CHECK (status IN (
                         'Draft', 'Internal Review', 'Submitted', 'Negotiation', 'Accepted', 'Rejected', 'Expired', 'Superseded')),
  total_selling_price  numeric(14, 2) NOT NULL DEFAULT 0,
  total_estimated_cost numeric(14, 2) NOT NULL DEFAULT 0,
  data                 jsonb NOT NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           text,
  updated_by           text
);
CREATE INDEX commercial_quotations_project_idx ON commercial_quotations (project_id);

CREATE TABLE price_database (
  id         text PRIMARY KEY,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

-- One commercial baseline per project (keyed by project, as in the app).
CREATE TABLE commercial_baselines (
  id                         text PRIMARY KEY,
  project_id                 text NOT NULL UNIQUE REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  original_contract_value    numeric(14, 2) NOT NULL DEFAULT 0,
  original_budget_direct_cost numeric(14, 2) NOT NULL DEFAULT 0,
  data                       jsonb NOT NULL,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  created_by                 text,
  updated_by                 text
);

CREATE TABLE suppliers (
  id         text PRIMARY KEY,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

-- Purchase orders: an issued PO's value is committed cost.
CREATE TABLE purchase_orders (
  id           text PRIMARY KEY,
  project_id   text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  supplier_id  text REFERENCES suppliers (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status       text NOT NULL CHECK (status IN (
                 'Draft', 'Pending Approval', 'Issued', 'Partially Received', 'Goods Received', 'Completed', 'Cancelled')),
  total_amount numeric(14, 2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  data         jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  created_by   text,
  updated_by   text
);
CREATE INDEX purchase_orders_project_idx ON purchase_orders (project_id);

CREATE TABLE goods_received (
  id          text PRIMARY KEY,
  project_id  text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  po_id       text REFERENCES purchase_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  supplier_id text REFERENCES suppliers (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data        jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  text,
  updated_by  text
);

CREATE TABLE material_requests (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

-- Project cost ledger (ProjectCostLedgerItem, keyed by cost_id in the app).
-- 'Incurred' and 'Reconciled' entries are actual cost; 'Committed' entries are not.
CREATE TABLE project_cost_ledger (
  id              text PRIMARY KEY,
  project_id      text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_package_id text REFERENCES work_packages (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  work_item_id    text REFERENCES work_items (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status          text NOT NULL CHECK (status IN ('Committed', 'Incurred', 'Reconciled', 'Disputed')),
  amount          numeric(14, 2) NOT NULL DEFAULT 0,
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      text,
  updated_by      text
);
CREATE INDEX project_cost_ledger_project_idx ON project_cost_ledger (project_id);

CREATE TABLE commercial_invoices (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE cost_leak_alerts (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE cashflow_entries (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE financial_claims (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);

CREATE TABLE payments (
  id         text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  status     text,
  data       jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  updated_by text
);
