# Phase 6 Batch 12A: approval integrity and workflow enforcement

Four ways an ordinary signed-in user could get around an approval, found by the Batch 12
assessment, and how they are closed. Everything is enforced on the server, on every write path
(REST create / update, `/api/approvals/:id/decision`, `/api/data/sync`); the browser is never
trusted. `resolveApprovalAuthority` remains the only authority source: nothing here adds a rule
or a second resolver.

Regression tests: `server/modules/approvalIntegrity.test.ts` (each attack by an ordinary user,
next to the legitimate workflow), run as the app role and as the restricted `nwos_app` role.

## 1. Issued purchase orders (`hooks/purchasing.ts`)

| Before | Now |
|---|---|
| Authority ran only when the status changed, so the lines, total, supplier and project of an Issued PO could be edited freely (e.g. issue at RM 15,000, then raise to RM 90,000). | Once a PO is Issued (or received / completed / cancelled) its lines (item, spec, unit, quantity, unit price), total, supplier and project are fixed. To change them the PO returns to **Draft** (only from Issued, and only while nothing has been received) and is issued again, which runs the authority resolver again. |
| A PO could be created as, or moved from Cancelled to, Completed without ever being issued. | A PO is completed only after it was issued. Unknown statuses are refused. |

Non-material fields (delivery date, notes) can still change on an Issued PO. The total is always
computed by the server from the lines.

## 2. Major Purchase approvals stay bound to what they approved

- **Request fields are final after a decision** (`hooks/approvals.ts`). Once Approved or
  Rejected, nobody (the Owner included) can change `approval_type`, `related_entity_type`,
  `related_entity_id`, `project_id` or the named approver. A new decision needs a new request.
  Before a decision the requester may still correct them, but never in the same write that
  decides the request (the decision is taken on the request as stored).
- **Approved facts recorded by the server.** When a Major Purchase request is approved, the
  server records `approved_facts` from the purchase order in the same transaction: PO id,
  project, supplier and total. The browser cannot set or change them.
- **The resolver's prior-approval lookup** (`authorityResolver.ts`, purchase_order facts) counts
  an approval only if it is for this PO, on the PO's project, with the same supplier, and the PO
  total is not higher than the approved total. A higher total or a different supplier needs a new
  approval; an unchanged or cheaper PO does not.
- **Existing approvals** (migration 029) are bound from their own append-only decision audit
  record (the amount the server knew when it was decided). One with no such record, or whose PO
  is on another project, stays unbound and no longer counts: the PO needs a new Major Purchase
  approval or the Owner. Legacy bindings have no supplier (it was not recorded then).

## 3. Invoice lifecycle (`hooks/purchasing.ts`)

```
new                        -> Draft, Pending Approval   (nothing paid)
Draft / Pending Approval   -> Draft, Pending Approval, Approved (authority resolver, as before)
Approved                   -> Partially Paid, Paid, Overdue
Partially Paid / Overdue   -> Partially Paid, Paid, Overdue
Paid                       -> final
```

- Paid, Partially Paid and Overdue are reachable only from an approved invoice; an invoice
  in a payment state with no recorded approval (legacy data) cannot be marked paid.
- Recording a payment (a payment status or `paid_amount`) needs `finance.record_payments`. The
  paid amount never decreases, never exceeds the total, equals the total for Paid and is part of
  it for Partially Paid.
- An approved invoice never returns to Draft or Pending Approval, and its amounts, PO, project
  and type stay fixed while Overdue as well.
- No new payment process was added: there is still no link from an invoice to a bank payment
  record (`payments`). That evidence link is an open item (see below).

## 4. The requester does not choose a purchase approver

- A Major Purchase / Major Cost request cannot name its approver: a named person
  (`assigned_approver_id`) or any role other than the Owner is refused when the request is raised,
  edited, or turned into a purchase request from another type. Naming the Owner is accepted; it
  grants nothing the Owner does not already have.
- System Policy `SYS-REQUEST-ASSIGNEE-PURCHASE` is retired (migration 029): inactive and locked,
  so it cannot be switched back on. A legacy request that names someone gives them nothing.
- Who decides and who receives the request come from the resolver and routing, unchanged:
  `SYS-PURCHASE-ACCOUNTANT` (never the requester), the Owner's delegated rules, temporary
  authority, Owner absence cover, escalation, the Sensitive / Strategic ceilings, and the Owner.
- The approval form no longer offers an approver for these two types.

## Not changed / open

- Other request types (Technical Change, Safety-Critical, Date Change, ...) still name their
  approver (`SYS-REQUEST-ASSIGNEE-APPROVAL-REQUEST`): open for the Owner's review.
- Invoice payments are not linked to payment records; `invoice_type` (which decides whether the
  3-way match applies) is fixed only after approval.
- `/api/data/import` (settings.manage only) still writes without the business hooks, as before.
- Everything a stolen `nwos_app` credential can do (Batch 12 assessment) is unchanged: that is
  Batch 12B.
