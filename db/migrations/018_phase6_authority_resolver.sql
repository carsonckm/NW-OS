-- Phase 6 Batch 2: the authority resolver reads the rules (docs/phase6-delegated-authority.md).
--
-- Batch 1 stored today's behaviour as System Policy; now that the resolver enforces the rows,
-- this migration makes them describe today's behaviour exactly (nothing broader), using
-- server-only condition keys the resolver understands:
--
--   direct_only            the rule is about the record itself (issuing a PO, approving an
--                          invoice / drawing revision / variation), not an approval request
--   requests_only          the rule is about an approval request (the approvals table)
--   assigned_approver      the person is the request's assigned approver (by user, by role, or a
--                          "Designated Authorized Manager" request and the person holds approvals.decide)
--   requires_permission    the person must also hold this permission
--   prior_approval         an approved approval request of this type exists for the record
--   unless_prior_approval  the rule does not apply when such an approval exists

-- Approval requests other than Major Purchase / Major Cost and AI proposals (technical change,
-- drawing, variation, date change, safety-critical, ...): decided today by their assigned approver. Protected on Sensitive projects
-- like every other type (fail closed).
INSERT INTO authority_decision_types (key, label, baseline_permission, has_value, sensitive_protected)
VALUES ('approval_request', 'Other approval request', 'approvals.view', false, true);
INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, conditions, priority, system_key, locked) VALUES
  ('sys-sensitive-approval_request', 'SYS-SENSITIVE-APPROVAL-REQUEST', 'Sensitive projects: other approval request needs the Owner',
   'Built-in policy (locked): on a project marked Sensitive, other approval request always needs the Owner.',
   'system', 'require_owner', 'approval_request', '{"sensitivity": ["Sensitive"]}', 900, 'sensitivity.sensitive.approval_request', true),
  ('sys-strategic-approval_request', 'SYS-STRATEGIC-APPROVAL-REQUEST', 'Strategic projects: other approval request needs the Owner',
   'Built-in policy (locked): on a project marked Strategic, every approval decision needs the Owner.',
   'system', 'require_owner', 'approval_request', '{"sensitivity": ["Strategic"]}', 1000, 'sensitivity.strategic.approval_request', true);

-- Final approval permissions apply to the record itself; approval requests follow their own rules.
UPDATE delegated_authorities SET conditions = '{"direct_only": true}' WHERE system_key = 'drawing.approvers';
UPDATE delegated_authorities SET conditions = '{"direct_only": true, "no_self_approval": true}' WHERE system_key = 'variation.approvers';

-- Purchases: below the threshold Purchasing issues the PO; at or above it the PO needs the Owner
-- unless a Major Purchase approval was approved, in which case Purchasing issues it.
UPDATE delegated_authorities SET conditions = '{"direct_only": true}' WHERE system_key = 'purchase.standard';
UPDATE delegated_authorities SET conditions = '{"direct_only": true, "unless_prior_approval": "Major Purchase"}',
       description = 'Built-in policy: a purchase order of RM 20,000 or more needs the Owner to issue it, unless a Major Purchase approval for it was approved.'
 WHERE system_key = 'purchase.major';
INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, target_permission, conditions, priority, system_key, locked) VALUES
  ('sys-purchase-approved', 'SYS-PURCHASE-APPROVED', 'Purchasing issues a PO whose Major Purchase approval was approved',
   'Built-in policy: once a Major Purchase approval for a purchase order is approved, Purchasing (purchasing.create) issues it.',
   'system', 'allow', 'purchase', 'purchasing.create', '{"direct_only": true, "prior_approval": "Major Purchase"}', 100, 'purchase.approved', false);

-- The Accountant / Production Manager rules pass the same gate as before (approvals.decide).
-- Today only the Accountant holds it, so the Production Manager decides technical requests only
-- when they are the assigned approver (SYS-REQUEST-ASSIGNEE-APPROVAL-REQUEST), exactly as before.
-- Technical change / NW production drawing requests are approval requests (decision type
-- approval_request); drawing revisions themselves are the drawing decision.
UPDATE delegated_authorities SET conditions = '{"approval_types": ["Major Purchase", "Major Cost"], "no_self_approval": true, "requires_permission": "approvals.decide"}'
 WHERE system_key = 'purchase.accountant';
UPDATE delegated_authorities SET decision_type = 'approval_request',
       conditions = '{"approval_types": ["Technical Change", "NW Production Drawing Approval"], "no_self_approval": true, "requires_permission": "approvals.decide"}'
 WHERE system_key = 'drawing.technical_prodmgr';

-- Invoices: an invoice with no PO match (client billing, claims) is "Not applicable", as before.
UPDATE delegated_authorities SET conditions = '{"direct_only": true, "match_status": ["Matched", "Not applicable"], "no_self_approval": true}'
 WHERE system_key = 'invoice.finance';
UPDATE delegated_authorities SET conditions = '{"direct_only": true, "match_status_not": ["Matched", "Not applicable"]}'
 WHERE system_key = 'invoice.mismatch';

-- AI proposals: decided by the person they were put to (the asker, or whom the assistant named).
UPDATE delegated_authorities SET conditions = '{"assigned_approver": true}',
       description = 'Built-in policy: an AI proposal is decided by the person it was put to (normally the person who asked the assistant), or the Owner, and then runs with the approver''s own permissions.'
 WHERE system_key = 'ai_proposal.asker';

-- Approval requests: decided by their assigned approver (user or role), never by the requester.
INSERT INTO delegated_authorities (id, code, name, description, kind, effect, decision_type, target_permission, conditions, priority, system_key, locked)
SELECT 'sys-request-assignee-' || t.key, 'SYS-REQUEST-ASSIGNEE-' || upper(replace(t.key, '_', '-')),
       'Assigned approver decides ' || lower(t.label) || ' requests',
       'Built-in policy: an approval request (' || lower(t.label) || ') is decided by its assigned approver (the named user or role), never by the person who raised it.',
       'system', 'allow', t.key, 'approvals.view', '{"requests_only": true, "assigned_approver": true, "no_self_approval": true}', 100, 'request.assignee.' || t.key, false
FROM authority_decision_types t WHERE t.key IN ('purchase', 'approval_request');
