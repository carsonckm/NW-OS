-- Phase 5: a rule run is claimed with a lease on its row instead of a session advisory lock.
-- The advisory lock held a pooled connection for the whole run while the run borrowed more
-- from the same pool, which could starve the pool under concurrent runs. A lease is claimed
-- and released with single statements, still prevents two servers running a rule at once,
-- and expires on its own if a server dies mid-run.
ALTER TABLE automation_rules
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN lease_token text;
