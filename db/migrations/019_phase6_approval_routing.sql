-- Phase 6 Batch 3: approval routing (docs/phase6-routing.md).
--
-- Authorization ("may this person decide?") stays with the authority resolver. Routing records
-- who should receive each pending decision, and why. One open route per pending decision; a
-- route is closed when the decision is taken, withdrawn or re-routed (the old row is kept as
-- history). Everything used for filtering, routing and auditing is a relational column; `data`
-- only carries the explanation shown to people.

CREATE TABLE approval_routes (
  id                  bigserial PRIMARY KEY,
  -- The record being decided (the same kinds the resolver loads).
  resource_kind       text NOT NULL CHECK (resource_kind IN ('drawing_revision', 'variation', 'purchase_order', 'invoice', 'approval')),
  resource_id         text NOT NULL,
  decision_type       text NOT NULL REFERENCES authority_decision_types (key),
  project_id          text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  client_id           text REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Who receives it. Never null: when no delegate is eligible it is the Owner.
  assigned_user_id    text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  routing_basis       text NOT NULL CHECK (routing_basis IN (
                        'USER_RULE', 'PROJECT_ROLE_RULE', 'PROJECT_PERMISSION_RULE', 'CLIENT_RULE', 'GLOBAL_RULE',
                        'SYSTEM_POLICY', 'PRIOR_OWNER_APPROVAL', 'CLIENT_CONSENT', 'OWNER_FALLBACK')),
  authority_rule_id   text REFERENCES delegated_authorities (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  authority_rule_code text,
  -- When the Owner receives it: why delegation was not available (a resolver reason code).
  owner_reason_code   text,
  project_sensitivity text CHECK (project_sensitivity IS NULL OR project_sensitivity IN ('Normal', 'Sensitive', 'Strategic')),
  value               numeric(14, 2),
  priority            text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('Low', 'Normal', 'High', 'Critical')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'rerouted', 'cancelled')),
  completion_result   text CHECK (completion_result IS NULL OR completion_result IN ('approved', 'rejected', 'changes_requested', 'withdrawn')),
  routed_at           timestamptz NOT NULL DEFAULT now(),
  due_at              timestamptz,
  completed_at        timestamptz,
  completed_by        text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  replaces_route_id   bigint REFERENCES approval_routes (id),
  data                jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((routing_basis = 'OWNER_FALLBACK') = (owner_reason_code IS NOT NULL)),
  CHECK (routing_basis IN ('OWNER_FALLBACK', 'CLIENT_CONSENT', 'PRIOR_OWNER_APPROVAL') OR authority_rule_id IS NOT NULL),
  CHECK ((status = 'open') = (completed_at IS NULL))
);
-- The no-orphan invariant's other half: at most one open route per decision.
CREATE UNIQUE INDEX approval_routes_one_open_idx ON approval_routes (resource_kind, resource_id) WHERE status = 'open';
CREATE INDEX approval_routes_assignee_idx ON approval_routes (assigned_user_id) WHERE status = 'open';
CREATE INDEX approval_routes_project_idx ON approval_routes (project_id);
CREATE INDEX approval_routes_rule_idx ON approval_routes (authority_rule_id);
