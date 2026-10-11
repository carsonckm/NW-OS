-- Phase 6 Batch 12A (review follow-up): requester-chosen approvers on every request type, and an
-- Owner review of legacy records that lack approval evidence.
--
-- 1. The requester no longer chooses who approves any request type (Batch 12A retired it for
--    purchase decisions in migration 029). SYS-REQUEST-ASSIGNEE-APPROVAL-REQUEST let the approver
--    named on a Technical Change, Safety-Critical, Date Change, Drawing, Variation or Client Scope
--    Change request decide it. It is retired: inactive and locked. Those requests are decided under
--    the Owner's delegated rules and the Owner (and the other System Policy that still applies),
--    through the authority resolver. Client consent (a client deciding a client-facing request on
--    their own project) and AI proposals (decided by the person who asked the assistant, set by the
--    server) do not use this rule and are unchanged.
--
-- 2. legacy_review_items: records that are in a protected state without the evidence NW OS now
--    requires, identified once, never changed or removed:
--      invoice            an invoice in Approved / Partially Paid / Overdue / Paid with no recorded
--                         approval (approved_at); without a release it cannot be paid (a Paid one
--                         is listed so the Owner can acknowledge or decline it; nothing changes it);
--      purchase_approval  an approved Major Purchase approval with no approved facts (migration 029
--                         found no decision-time audit record), for a PO on the same project; without
--                         a review it does not count for issuing the PO.
--    Identified here for the data already present, and by /api/data/import for imported data
--    (server/modules/legacyReview.ts; a test keeps both queries identical in effect).
--
-- 3. legacy_review_decisions: the Owner's decision on an item, one per item, append-only. A release
--    is an administrative decision recorded now, by the Owner, with a reason: it is not evidence that
--    a historical approval happened, and nothing is fabricated into the historical records.

UPDATE delegated_authorities
   SET active = false,
       locked = true,
       deactivated_at = now(),
       deactivated_by = NULL,
       deactivation_reason = 'Retired (Batch 12A): the requester does not choose who approves a request',
       description = 'Retired built-in policy (locked): the approver named on an approval request no longer decides it. Requests are decided under the Owner''s rules and the Owner.',
       updated_at = now()
 WHERE system_key = 'request.assignee.approval_request';

CREATE TABLE legacy_review_items (
  id             bigserial PRIMARY KEY,
  kind           text NOT NULL CHECK (kind IN ('invoice', 'purchase_approval')),
  record_id      text NOT NULL,
  project_id     text,
  -- Why it needs review and what it looked like when identified (no payloads, no secrets).
  reason         text NOT NULL,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb,
  identified_by  text NOT NULL,
  identified_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, record_id)
);

CREATE TABLE legacy_review_decisions (
  id                bigserial PRIMARY KEY,
  item_id           bigint NOT NULL UNIQUE REFERENCES legacy_review_items (id),
  decision          text NOT NULL CHECK (decision IN ('released', 'acknowledged', 'reauthorized', 'declined')),
  reason            text NOT NULL CHECK (btrim(reason) <> ''),
  reviewed_by_id    text NOT NULL,
  reviewed_by_name  text,
  reviewed_by_role  text NOT NULL,
  reviewed_at       timestamptz NOT NULL DEFAULT now(),
  -- For a re-authorization: the current PO facts it was taken on (po_id, project_id, supplier_id, total_amount).
  facts             jsonb,
  -- The authority resolution the decision was checked with (compact).
  authority         jsonb,
  CHECK ((decision = 'reauthorized') = (facts IS NOT NULL))
);

CREATE FUNCTION legacy_review_keep() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: legacy review records are never changed or removed', TG_TABLE_NAME USING ERRCODE = 'NWX01';
END $$;
CREATE TRIGGER legacy_review_items_keep BEFORE UPDATE OR DELETE ON legacy_review_items FOR EACH ROW EXECUTE FUNCTION legacy_review_keep();
CREATE TRIGGER legacy_review_items_no_truncate BEFORE TRUNCATE ON legacy_review_items FOR EACH STATEMENT EXECUTE FUNCTION legacy_review_keep();
CREATE TRIGGER legacy_review_decisions_keep BEFORE UPDATE OR DELETE ON legacy_review_decisions FOR EACH ROW EXECUTE FUNCTION legacy_review_keep();
CREATE TRIGGER legacy_review_decisions_no_truncate BEFORE TRUNCATE ON legacy_review_decisions FOR EACH STATEMENT EXECUTE FUNCTION legacy_review_keep();

-- Data already present.
INSERT INTO legacy_review_items (kind, record_id, project_id, reason, details, identified_by)
SELECT 'invoice', i.id, i.project_id, 'no_recorded_approval',
       jsonb_build_object('status', i.status, 'invoice_number', i.data->>'invoice_number', 'paid_amount', i.data->'paid_amount', 'total_amount', i.data->'total_amount'),
       'migration 030'
  FROM commercial_invoices i
 WHERE i.status IN ('Approved', 'Partially Paid', 'Overdue', 'Paid') AND coalesce(i.data->>'approved_at', '') = ''
ON CONFLICT (kind, record_id) DO NOTHING;

INSERT INTO legacy_review_items (kind, record_id, project_id, reason, details, identified_by)
SELECT 'purchase_approval', a.id, a.project_id, 'no_approval_evidence',
       jsonb_build_object('po_id', a.related_entity_id, 'po_status', po.status, 'decision_by_role', a.data->>'decision_by_role'),
       'migration 030'
  FROM approvals a JOIN purchase_orders po ON po.id = a.related_entity_id AND po.project_id = a.project_id
 WHERE a.approval_type = 'Major Purchase' AND a.decision = 'Approved' AND a.related_entity_type = 'purchase'
   AND NOT (a.data ? 'approved_facts')
ON CONFLICT (kind, record_id) DO NOTHING;
