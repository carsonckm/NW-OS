-- Phase 6 Batch 4: proactive approval management (docs/phase6-approval-monitoring.md).
--
-- Routing (019) says who should decide each pending approval. This migration adds what the
-- approval monitor (an automation rule on the existing Phase 5 engine, no second scheduler)
-- needs to keep it moving: an SLA per decision type, a business calendar to count working
-- time, the route's lifecycle timestamps and counters, an explicit Owner routing policy, and
-- Owner exception snoozes. Everything the monitor filters, escalates or prioritises on is a
-- relational column; `data` keeps only explanations.

-- SLA per decision type: defaults only, editable by the Owner. An SLA never changes who may
-- approve: authority stays with the resolver.
CREATE TABLE approval_sla_policies (
  decision_type     text PRIMARY KEY REFERENCES authority_decision_types (key) ON UPDATE CASCADE ON DELETE RESTRICT,
  sla_business_days numeric(5, 2) NOT NULL CHECK (sla_business_days > 0 AND sla_business_days <= 60),
  -- Thresholds as a percentage of the SLA: reminder < due soon < overdue (100) < escalation.
  reminder_pct      integer NOT NULL DEFAULT 50 CHECK (reminder_pct BETWEEN 1 AND 99),
  due_soon_pct      integer NOT NULL DEFAULT 80 CHECK (due_soon_pct BETWEEN 1 AND 99),
  escalate_pct      integer NOT NULL DEFAULT 150 CHECK (escalate_pct BETWEEN 101 AND 1000),
  -- Who an overdue approval escalates to: the Owner, or the next eligible delegate (Owner if none).
  escalate_to       text NOT NULL DEFAULT 'owner' CHECK (escalate_to IN ('owner', 'next_eligible')),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        text,
  CHECK (reminder_pct < due_soon_pct)
);
INSERT INTO approval_sla_policies (decision_type, sla_business_days)
SELECT key, CASE key WHEN 'invoice' THEN 2 WHEN 'variation' THEN 2 ELSE 1 END FROM authority_decision_types
ON CONFLICT DO NOTHING;

-- The company business calendar (one row). Seeded from the Phase 5 calendar defaults
-- (Monday to Saturday, Malaysian public holidays); the monitor counts SLA time in working days.
CREATE TABLE business_calendar (
  id                     integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  -- ISO weekdays: 1 = Monday ... 7 = Sunday.
  working_days           integer[] NOT NULL DEFAULT '{1,2,3,4,5,6}',
  utc_offset_minutes     integer NOT NULL DEFAULT 480 CHECK (utc_offset_minutes BETWEEN -720 AND 840),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  updated_by             text,
  CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ '{1,2,3,4,5,6,7}')
);
INSERT INTO business_calendar (id) VALUES (1);
CREATE TABLE business_holidays (
  day  date PRIMARY KEY,
  name text NOT NULL
);
INSERT INTO business_holidays (day, name) VALUES
  ('2026-01-01', 'New Year''s Day'), ('2026-02-01', 'Federal Territory Day'), ('2026-02-17', 'Chinese New Year (Day 1)'),
  ('2026-02-18', 'Chinese New Year (Day 2)'), ('2026-03-21', 'Hari Raya Aidilfitri (Day 1)'), ('2026-03-22', 'Hari Raya Aidilfitri (Day 2)'),
  ('2026-05-01', 'Labour Day'), ('2026-05-31', 'Wesak Day'), ('2026-06-01', 'Agong''s Birthday'), ('2026-08-31', 'National Day (Merdeka)'),
  ('2026-09-16', 'Malaysia Day'), ('2026-11-08', 'Deepavali'), ('2026-12-25', 'Christmas Day');

-- Explicit Owner routing policy (replaces "lowest user id"): the active primary Owner, then the
-- active Owner with the highest priority, then user id. Only the Owner configures it.
ALTER TABLE users
  ADD COLUMN owner_priority   integer NOT NULL DEFAULT 0 CHECK (owner_priority BETWEEN 0 AND 1000),
  ADD COLUMN is_primary_owner boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX users_one_primary_owner_idx ON users ((true)) WHERE is_primary_owner;

-- The route's lifecycle. The clock (requested_at, due_at) belongs to the decision and carries
-- over when it is re-routed, so moving it never resets how long it has waited.
ALTER TABLE approval_routes
  ADD COLUMN requested_at      timestamptz,
  ADD COLUMN sla_business_days numeric(5, 2),
  ADD COLUMN lifecycle_state   text NOT NULL DEFAULT 'assigned'
    CHECK (lifecycle_state IN ('assigned', 'reminded', 'due_soon', 'overdue', 'escalated')),
  -- Why this route exists: first routing, authority changed (re-route), escalated because
  -- overdue, the project closed, or the Owner assigned it.
  ADD COLUMN route_reason      text NOT NULL DEFAULT 'initial'
    CHECK (route_reason IN ('initial', 'authority_changed', 'escalated_overdue', 'project_closed', 'owner_assigned')),
  ADD COLUMN reminded_at       timestamptz,
  ADD COLUMN due_soon_at       timestamptz,
  ADD COLUMN overdue_at        timestamptz,
  ADD COLUMN escalated_at      timestamptz,
  ADD COLUMN reroute_count     integer NOT NULL DEFAULT 0,
  ADD COLUMN escalation_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN last_checked_at   timestamptz;
UPDATE approval_routes SET requested_at = routed_at WHERE requested_at IS NULL;
ALTER TABLE approval_routes ALTER COLUMN requested_at SET NOT NULL, ALTER COLUMN requested_at SET DEFAULT now();
-- The monitor works through open routes in bounded batches, least recently checked first.
CREATE INDEX approval_routes_monitor_idx ON approval_routes (last_checked_at NULLS FIRST, id) WHERE status = 'open';
CREATE INDEX approval_routes_due_idx ON approval_routes (due_at) WHERE status = 'open';

-- Owner exception snoozes: non-critical only, bounded, with a reason (audited by the API).
CREATE TABLE owner_exception_snoozes (
  exception_key  text PRIMARY KEY,
  snoozed_until  timestamptz NOT NULL,
  reason         text NOT NULL CHECK (length(trim(reason)) > 0),
  snoozed_by     text NOT NULL REFERENCES users (id) ON UPDATE CASCADE ON DELETE RESTRICT,
  created_at     timestamptz NOT NULL DEFAULT now()
);
