-- Phase 6 Batch 12A: approval integrity.
--
-- 1. The requester no longer chooses who approves a purchase decision. System Policy
--    SYS-REQUEST-ASSIGNEE-PURCHASE let the approver named on a Major Purchase / Major Cost request
--    (a person or role chosen by the requester) decide it at any value. It is retired: inactive
--    and locked, so it cannot be switched back on through any path. Major Purchase / Major Cost
--    requests are decided under the remaining rules (SYS-PURCHASE-ACCOUNTANT, the Owner's own
--    delegated rules, the Owner), all through the authority resolver. The other request types
--    (SYS-REQUEST-ASSIGNEE-APPROVAL-REQUEST) are unchanged.
--
-- 2. A Major Purchase approval counts only for what it approved. From now on the server records,
--    when the approval is decided, the purchase order, project, supplier and total it approved
--    (approvals.data.approved_facts). The resolver accepts the approval for issuing a PO only if
--    the PO, project and supplier are the same and the PO total is not higher.
--
--    Existing approved Major Purchase approvals are bound here from their own decision-time audit
--    record (the append-only approval.approve row, which carries the amount the server knew when
--    it was decided). An approval with no such record, or whose PO is now on another project,
--    stays unbound: it no longer counts, and the PO needs a new Major Purchase approval (or the
--    Owner) to be issued. Legacy bindings carry no supplier (it was not recorded at the time).

UPDATE delegated_authorities
   SET active = false,
       locked = true,
       deactivated_at = now(),
       deactivated_by = NULL,
       deactivation_reason = 'Retired (Batch 12A): the requester does not choose who approves a purchase decision',
       description = 'Retired built-in policy (locked): the approver named on a Major Purchase / Major Cost request no longer decides it. Purchase decisions follow SYS-PURCHASE-ACCOUNTANT, the Owner''s rules and the Owner.',
       updated_at = now()
 WHERE system_key = 'request.assignee.purchase';

UPDATE approvals a
   SET data = a.data || jsonb_build_object('approved_facts', jsonb_build_object(
         'po_id', b.po_id,
         'project_id', b.project_id,
         'total_amount', b.amount,
         'recorded_at', b.occurred_at,
         'source', 'decision audit ' || b.audit_id))
  FROM (
    SELECT DISTINCT ON (ap.id) ap.id, ap.related_entity_id AS po_id, ap.project_id, l.id AS audit_id, l.occurred_at,
           (l.after->'authority'->'trace'->'value'->>'amount')::numeric AS amount
      FROM approvals ap
      JOIN purchase_orders po ON po.id = ap.related_entity_id AND po.project_id = ap.project_id
      JOIN audit_logs l ON l.action = 'approval.approve' AND l.entity_type = 'approval' AND l.entity_id = ap.id
     WHERE ap.approval_type = 'Major Purchase' AND ap.decision = 'Approved' AND ap.related_entity_type = 'purchase'
       AND NOT (ap.data ? 'approved_facts')
       AND jsonb_typeof(l.after->'authority'->'trace'->'value'->'amount') = 'number'
     ORDER BY ap.id, l.occurred_at DESC, l.id DESC
  ) b
 WHERE a.id = b.id AND b.amount IS NOT NULL;
