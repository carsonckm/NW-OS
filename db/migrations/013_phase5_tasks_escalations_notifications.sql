-- Phase 5: tasks as the company-wide work engine, escalations as first-class records, and a
-- notification center. Existing tables are extended (no new parallel status systems):
-- task statuses stay Open / In Progress / Waiting / Blocked / Escalated / Completed / Cancelled.

-- What a task is about (each optional; validated against the task's project on write).
ALTER TABLE tasks
  ADD COLUMN variation_id        text REFERENCES variations (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  ADD COLUMN drawing_id          text REFERENCES drawings (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  ADD COLUMN purchase_order_id   text REFERENCES purchase_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  ADD COLUMN delivery_id         text REFERENCES deliveries (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  ADD COLUMN installation_job_id text REFERENCES installation_jobs (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  ADD COLUMN production_order_id text REFERENCES production_orders (id) ON UPDATE CASCADE ON DELETE RESTRICT DEFERRABLE INITIALLY IMMEDIATE,
  -- The manager who reviews the work and is notified first when it is late.
  ADD COLUMN reviewer_id         text,
  -- Automation rule that raised it ('' / NULL = raised by a person).
  ADD COLUMN source_rule         text;
CREATE INDEX tasks_variation_idx ON tasks (variation_id);
CREATE INDEX tasks_drawing_idx ON tasks (drawing_id);
CREATE INDEX tasks_delivery_idx ON tasks (delivery_id);
CREATE INDEX tasks_production_order_idx ON tasks (production_order_id);
CREATE INDEX tasks_status_due_idx ON tasks (status, due_date);

-- Escalations: queryable level, source and acknowledgement.
ALTER TABLE escalations
  ADD COLUMN level              integer,
  ADD COLUMN source_record_type text,
  ADD COLUMN source_record_id   text,
  ADD COLUMN status             text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Acknowledged', 'Resolved')),
  ADD COLUMN acknowledged_by    text,
  ADD COLUMN acknowledged_at    timestamptz;
CREATE INDEX escalations_source_idx ON escalations (source_record_type, source_record_id);
CREATE INDEX escalations_open_idx ON escalations (status) WHERE status <> 'Resolved';

-- Notification center: where it came from, and acknowledgement for the ones that need it.
ALTER TABLE notifications
  ADD COLUMN source          text,
  ADD COLUMN requires_ack    boolean NOT NULL DEFAULT false,
  ADD COLUMN acknowledged_at timestamptz;
