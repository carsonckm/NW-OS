-- Phase 3 review fixes.
--
-- 1. Client drawing revisions follow Draft -> Internal Review -> Approved -> Superseded
--    (or Rejected). Uploading never approves; the server checks who may move a revision.
--    The database keeps the vocabulary, allows only an approved revision to be current,
--    and allows at most one current client revision per drawing.
--    ('Pending Review' and 'Review' are older names for Internal Review, kept for old data.)
ALTER TABLE drawing_revisions
  ADD CONSTRAINT drawing_revisions_client_status CHECK (
    kind <> 'client' OR approval_status IN ('Draft', 'Internal Review', 'Pending Review', 'Review', 'Approved', 'Superseded', 'Rejected')),
  ADD CONSTRAINT drawing_revisions_current_is_approved CHECK (
    kind <> 'client' OR NOT is_current OR approval_status = 'Approved');

CREATE UNIQUE INDEX drawing_revisions_one_current ON drawing_revisions (drawing_id) WHERE kind = 'client' AND is_current;

-- 2. Production orders (and the work item's production status) can be put On Hold.
ALTER TABLE production_orders DROP CONSTRAINT production_orders_status_check;
ALTER TABLE production_orders ADD CONSTRAINT production_orders_status_check CHECK (status IN (
  'Not Started', 'Material Required', 'Material Ready', 'Cutting', 'CNC', 'Edge Banding', 'Assembly', 'Finishing',
  'QC', 'Packing', 'Ready for Delivery', 'Completed', 'On Hold', 'Blocked', 'Cancelled'));

ALTER TABLE work_items DROP CONSTRAINT work_items_production_status_check;
ALTER TABLE work_items ADD CONSTRAINT work_items_production_status_check CHECK (production_status IN (
  'Not Started', 'Material Required', 'Material Ready', 'Cutting', 'CNC', 'Edge Banding', 'Assembly', 'Finishing',
  'QC', 'Packing', 'Ready for Delivery', 'Completed', 'On Hold', 'Blocked', 'Cancelled'));
