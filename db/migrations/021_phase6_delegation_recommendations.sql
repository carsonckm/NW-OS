-- Phase 6 Batch 5: delegation recommendations (docs/phase6-delegation-intelligence.md).
--
-- A recommendation is an observation turned into a suggestion. It is never authority: it holds
-- no grant, and the resolver never reads this table. Authority only changes when the Owner
-- accepts one, which creates an ordinary Owner rule through the authority API (its id is kept
-- here). Recommendations are never deleted: their history shows what was suggested, on what
-- evidence, and what the Owner decided.

CREATE TABLE delegation_recommendations (
  id                   text PRIMARY KEY,
  -- What the opportunity is about; one active recommendation per opportunity.
  opportunity_key      text NOT NULL,
  decision_type        text NOT NULL REFERENCES authority_decision_types (key) ON UPDATE CASCADE ON DELETE RESTRICT,
  approval_type        text,
  target_role          text NOT NULL,
  target_user_id       text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  project_id           text REFERENCES projects (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  client_id            text REFERENCES clients (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  suggested_min_value  numeric(14, 2),
  suggested_max_value  numeric(14, 2),
  suggested_max_risk   text CHECK (suggested_max_risk IS NULL OR suggested_max_risk IN ('On Track', 'Attention', 'At Risk', 'Critical')),
  -- The evidence (all from completed approval routes; recomputed, never edited by a person).
  evidence_start       timestamptz NOT NULL,
  evidence_end         timestamptz NOT NULL,
  evidence_count       integer NOT NULL CHECK (evidence_count >= 0),
  approval_count       integer NOT NULL CHECK (approval_count >= 0),
  rejection_count      integer NOT NULL CHECK (rejection_count >= 0),
  escalation_count     integer NOT NULL CHECK (escalation_count >= 0),
  distinct_days        integer NOT NULL CHECK (distinct_days >= 0),
  typical_value        numeric(14, 2),
  max_value_observed   numeric(14, 2),
  eligible_users       integer NOT NULL DEFAULT 0,
  confidence           text NOT NULL CHECK (confidence IN ('Low', 'Medium', 'High')),
  status               text NOT NULL DEFAULT 'generated'
    CHECK (status IN ('generated', 'viewed', 'accepted', 'modified', 'rejected', 'snoozed', 'expired', 'superseded')),
  generated_at         timestamptz NOT NULL DEFAULT now(),
  last_evaluated_at    timestamptz NOT NULL DEFAULT now(),
  viewed_at            timestamptz,
  reviewed_at          timestamptz,
  reviewed_by          text REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  review_reason        text,
  snoozed_until        timestamptz,
  superseded_by        text REFERENCES delegation_recommendations (id),
  -- Set only when the Owner accepted it: the Owner rule created through the authority API.
  authority_rule_id    text REFERENCES delegated_authorities (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  -- Explanations only (reasons, the evidence list, the confidence explanation).
  data                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK ((status IN ('accepted', 'modified')) = (authority_rule_id IS NOT NULL)),
  CHECK (status <> 'snoozed' OR snoozed_until IS NOT NULL),
  CHECK (suggested_min_value IS NULL OR suggested_max_value IS NULL OR suggested_min_value <= suggested_max_value)
);
CREATE UNIQUE INDEX delegation_recommendations_active_idx ON delegation_recommendations (opportunity_key) WHERE status IN ('generated', 'viewed', 'snoozed');
CREATE INDEX delegation_recommendations_status_idx ON delegation_recommendations (status, generated_at DESC);
CREATE SEQUENCE delegation_recommendation_seq;

-- The decision history is read from completed routes by decision time.
CREATE INDEX approval_routes_completed_idx ON approval_routes (completed_at) WHERE status = 'completed';
