-- Phase 6: delegated authority (see docs/phase6-delegated-authority.md).
--
-- Permissions say whether a role may take part in a kind of workflow; an authority rule says who
-- may approve a particular decision under which conditions. This migration only stores rules: no
-- approval path reads them yet, so approval behaviour is unchanged.

-- Project sensitivity: set only by the Owner. Every existing project starts Normal.
ALTER TABLE projects
  ADD COLUMN sensitivity text NOT NULL DEFAULT 'Normal' CHECK (sensitivity IN ('Normal', 'Sensitive', 'Strategic'));

-- Decision types: data, so new types need no schema change.
CREATE TABLE authority_decision_types (
  key                 text PRIMARY KEY,
  label               text NOT NULL,
  -- The permission a person must already hold to take part (it approves nothing by itself).
  baseline_permission text NOT NULL,
  -- Whether decisions of this type carry an RM value (value limits only make sense if so).
  has_value           boolean NOT NULL,
  active              boolean NOT NULL DEFAULT true
);
INSERT INTO authority_decision_types (key, label, baseline_permission, has_value) VALUES
  ('drawing', 'Drawing approval', 'drawings.review', false),
  ('variation', 'Variation (internal approval)', 'variations.review', true),
  ('purchase', 'Purchase approval', 'purchasing.view', true),
  ('invoice', 'Supplier invoice approval', 'finance.view', true),
  ('ai_proposal', 'AI proposal approval', 'approvals.request', false);

CREATE SEQUENCE delegated_authority_seq START 1;

CREATE TABLE delegated_authorities (
  id                  text PRIMARY KEY,
  -- Readable reference shown to people, e.g. DA-0007 or SYS-PURCHASE-MAJOR.
  code                text NOT NULL UNIQUE,
  name                text NOT NULL,
  description         text NOT NULL,
  -- 'system' = today's built-in policy (System Policy); 'owner' = configured by the Owner.
  kind                text NOT NULL CHECK (kind IN ('system', 'owner')),
  -- 'allow' grants approval authority; 'require_owner' forces the Owner.
  effect              text NOT NULL CHECK (effect IN ('allow', 'require_owner')),
  decision_type       text NOT NULL REFERENCES authority_decision_types (key) ON UPDATE CASCADE ON DELETE RESTRICT,
  active              boolean NOT NULL DEFAULT true,
  -- Who the rule applies to (allow rules): a role, a specific user, or holders of a permission
  -- (the last only for System Policy, which mirrors today's permission-based checks).
  target_role         text,
  target_user_id      text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  target_permission   text,
  -- Scope (NULL = any project / client).
  project_id          text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  client_id           text REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  -- Value range in RM, inclusive; NULL = no bound.
  min_value           numeric(14, 2) CHECK (min_value IS NULL OR min_value >= 0),
  max_value           numeric(14, 2) CHECK (max_value IS NULL OR max_value >= 0),
  -- The rule applies only while the project's risk is at or below this level.
  max_risk            text CHECK (max_risk IS NULL OR max_risk IN ('On Track', 'Attention', 'At Risk', 'Critical')),
  -- Further validated conditions (e.g. {"sensitivity": ["Sensitive"]}).
  conditions          jsonb NOT NULL DEFAULT '{}'::jsonb,
  start_at            timestamptz,
  end_at              timestamptz,
  -- Higher wins when several rules match.
  priority            integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 1 AND 1000),
  -- System Policy only: a stable key, and whether the Owner may deactivate it.
  system_key          text UNIQUE,
  locked              boolean NOT NULL DEFAULT false,
  granted_by          text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_by          text,
  updated_by          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deactivated_at      timestamptz,
  deactivated_by      text,
  deactivation_reason text,
  data                jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (min_value IS NULL OR max_value IS NULL OR min_value <= max_value),
  CHECK (start_at IS NULL OR end_at IS NULL OR start_at < end_at),
  CHECK (effect = 'require_owner' OR target_role IS NOT NULL OR target_user_id IS NOT NULL OR target_permission IS NOT NULL),
  CHECK (target_permission IS NULL OR kind = 'system'),
  CHECK ((kind = 'system') = (system_key IS NOT NULL)),
  CHECK (kind = 'system' OR granted_by IS NOT NULL),
  CHECK (NOT locked OR kind = 'system')
);
CREATE INDEX delegated_authorities_lookup_idx ON delegated_authorities (decision_type, active);
CREATE INDEX delegated_authorities_project_idx ON delegated_authorities (project_id);
CREATE INDEX delegated_authorities_user_idx ON delegated_authorities (target_user_id);

-- System Policy: today's behaviour, recorded as it is (not as if the Owner created it).
INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, target_role, target_permission, min_value, max_value, conditions, priority, system_key, locked) VALUES
  ('sys-drawing', 'SYS-DRAWING', 'Drawing approval by drawing approvers',
   'Built-in policy: a client drawing revision (after internal review) or NW production drawing is approved by holders of drawings.approve (today: the Owner).',
   'system', 'allow', 'drawing', NULL, 'drawings.approve', NULL, NULL, '{}', 100, 'drawing.approvers', false),
  ('sys-variation', 'SYS-VARIATION', 'Variation internal approval by variation approvers',
   'Built-in policy: internal approval of a variation by holders of variations.approve (today: the Owner), never by the person who raised it.',
   'system', 'allow', 'variation', NULL, 'variations.approve', NULL, NULL, '{"no_self_approval": true}', 100, 'variation.approvers', false),
  ('sys-purchase-standard', 'SYS-PURCHASE-STANDARD', 'Purchases below the major purchase threshold',
   'Built-in policy: a purchase order below RM 20,000 is issued by Purchasing (purchasing.create) without a separate approval.',
   'system', 'allow', 'purchase', NULL, 'purchasing.create', NULL, 19999.99, '{}', 100, 'purchase.standard', false),
  ('sys-purchase-major', 'SYS-PURCHASE-MAJOR', 'Major purchases need a Major Purchase approval',
   'Built-in policy: a purchase order of RM 20,000 or more needs an approved Major Purchase approval, or the Owner, before it is issued.',
   'system', 'require_owner', 'purchase', NULL, NULL, 20000, NULL, '{}', 100, 'purchase.major', false),
  ('sys-purchase-accountant', 'SYS-PURCHASE-ACCOUNTANT', 'Accountant may decide Major Purchase and Major Cost approvals',
   'Built-in policy (canEvaluateApproval): the Accountant may decide Major Purchase and Major Cost approval requests, never their own.',
   'system', 'allow', 'purchase', 'Accountant', NULL, NULL, NULL, '{"approval_types": ["Major Purchase", "Major Cost"], "no_self_approval": true}', 110, 'purchase.accountant', false),
  ('sys-technical-prodmgr', 'SYS-TECHNICAL-PRODMGR', 'Production Manager may decide technical change and NW production drawing requests',
   'Built-in policy (canEvaluateApproval): the Production Manager may decide Technical Change and NW Production Drawing Approval requests, never their own.',
   'system', 'allow', 'drawing', 'Production Manager', NULL, NULL, NULL, '{"approval_types": ["Technical Change", "NW Production Drawing Approval"], "no_self_approval": true}', 110, 'drawing.technical_prodmgr', false),
  ('sys-invoice', 'SYS-INVOICE', 'Matched supplier invoices by finance',
   'Built-in policy: a matched supplier invoice is approved by holders of finance.edit (Accountant, Owner), never by the person who recorded it.',
   'system', 'allow', 'invoice', NULL, 'finance.edit', NULL, NULL, '{"match_status": ["Matched"], "no_self_approval": true}', 100, 'invoice.finance', false),
  ('sys-invoice-mismatch', 'SYS-INVOICE-MISMATCH', 'Mismatched invoices need the Owner',
   'Built-in policy: a supplier invoice that does not match its PO and goods received can only be approved by the Owner.',
   'system', 'require_owner', 'invoice', NULL, NULL, NULL, NULL, '{"match_status_not": ["Matched"]}', 200, 'invoice.mismatch', false),
  ('sys-ai-proposal', 'SYS-AI-PROPOSAL', 'AI proposals by the person who asked',
   'Built-in policy: an AI proposal is decided by the person who asked the assistant (or the Owner) and then runs with the approver''s own permissions.',
   'system', 'allow', 'ai_proposal', NULL, 'approvals.request', NULL, NULL, '{"asker_only": true}', 100, 'ai_proposal.asker', false);

-- Sensitivity, one row per decision type. Sensitive: the Owner may narrow it by deactivating a row.
-- Strategic: locked; the resolver also enforces it for every decision type, including future ones.
INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, conditions, priority, system_key, locked)
SELECT 'sys-sensitive-' || t.key, 'SYS-SENSITIVE-' || upper(replace(t.key, '_', '-')), 'Sensitive projects: ' || lower(t.label) || ' needs the Owner',
       'Built-in policy: on a project marked Sensitive, ' || lower(t.label) || ' always needs the Owner.',
       'system', 'require_owner', t.key, '{"sensitivity": ["Sensitive"]}', 900, 'sensitivity.sensitive.' || t.key, false
FROM authority_decision_types t;
INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, conditions, priority, system_key, locked)
SELECT 'sys-strategic-' || t.key, 'SYS-STRATEGIC-' || upper(replace(t.key, '_', '-')), 'Strategic projects: ' || lower(t.label) || ' needs the Owner',
       'Built-in policy (locked): on a project marked Strategic, every approval decision needs the Owner.',
       'system', 'require_owner', t.key, '{"sensitivity": ["Strategic"]}', 1000, 'sensitivity.strategic.' || t.key, true
FROM authority_decision_types t;
