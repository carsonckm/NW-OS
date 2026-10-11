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

## 4. The requester does not choose any approver

- On **every request type** (Drawing Approval, NW Production Drawing Approval, Technical Change,
  Variation, Major Purchase, Major Cost, Client Scope Change, Project Date Change, Safety-Critical
  Decision) the requester cannot name the approver: a person (`assigned_approver_id`) or a role is
  refused when the request is raised, edited (REST or `/api/data/sync`), or changed to another type.
  Accepted because they grant nothing: no approver, the Owner, and `Client` on a client-facing
  request (Variation / Client Scope Change), which asks for the client's consent.
- System Policy `SYS-REQUEST-ASSIGNEE-PURCHASE` (migration 029) and
  `SYS-REQUEST-ASSIGNEE-APPROVAL-REQUEST` (migration 030) are retired: inactive and locked. A
  legacy request that still names someone gives them nothing. Retired rules (locked and inactive)
  are left out of the resolver's evaluation, so they are never shown as a near miss.
- Who decides and who receives a request come from the resolver and routing:
  - Major Purchase / Major Cost: `SYS-PURCHASE-ACCOUNTANT` (never the requester), Owner rules, the Owner;
  - every other request type: the Owner's delegated rules (decision type "other approval
    request"), `SYS-TECHNICAL-PRODMGR` where it applies, and otherwise **the Owner** (routing's
    Owner fallback). This is the visible effect of the change: requests that used to go to the
    named approver now go to the Owner until the Owner delegates them.
  - Delegation, temporary authority, Owner absence cover, escalation and the Sensitive / Strategic
    ceilings are unchanged.
- **Different governance, kept and documented:**
  - **AI proposals:** the approver is set by the server (the person who asked the assistant) and
    the proposal runs with that person's own permissions. Nobody, the Owner included, can change
    it, and AI proposals cannot be raised through the approvals API or imported.
  - **Client consent:** a client deciding a client-facing request on their own project gives
    consent (not internal authority); it does not depend on the approver field.
- The approval form no longer offers an approver; a client-facing request can ask the client.

## 5. Owner review of legacy records (migration 030, `server/modules/legacyReview.ts`)

Records in a protected state without the evidence NW OS now requires are identified (migration
030 for data already present; `/api/data/import` for imported data) in `legacy_review_items`:

| Kind | Identified when | Until reviewed |
|---|---|---|
| `invoice` | Approved / Partially Paid / Overdue / Paid with no recorded approval (`approved_at`) | cannot be paid (no payment status, no paid amount change) |
| `purchase_approval` | an approved Major Purchase approval with no approved facts (no decision-time audit record), PO on the same project | does not count for issuing its PO |

The Owner reviews them (`GET /api/legacy-reviews`, `POST /api/legacy-reviews/:kind/:id/decision`
with `{ decision, reason }`):

- `invoice`: **released** (Approved / Partially Paid / Overdue only), **acknowledged** (Paid
  only), or **declined**. A release lets the invoice be paid; the payment still needs
  `finance.record_payments` and passes every payment check. The invoice itself is not changed: no
  status, no `approved_at`.
- `purchase_approval`: **reauthorized** or **declined**. A re-authorization runs the authority
  resolver for the Owner now and records the PO's current facts (PO, project, supplier, total).
  The resolver then counts the approval for those facts, exactly as for an approval decided after
  Batch 12A. The original approval record is not changed.

Every decision is a new row in `legacy_review_decisions` (who, role, when, reason, facts, the
authority resolution) plus an audit record (`legacy_review.<decision>`, `administrative: true`).
A release is an administrative decision recorded now, not evidence that a historical approval
happened; no historical approval or audit record is created or changed. Both tables are
append-only for the app role (no UPDATE / DELETE grants, and triggers refuse it), and an item has
at most one decision (a duplicate is a 409). Only identified records can be reviewed, so this is
not a path for new invoices or approvals.

Scope in the demo data (a non-production database): 3 invoices (2 Partially Paid, 1 Paid), 0
purchase approvals. Production has not been assessed (no production data was read or changed).

## 6. `/api/data/import` (`server/modules/importGuard.ts`)

Import (Owner only, `settings.manage`) creates records only: an existing id is skipped, never
overwritten, so an Issued PO or a decided request cannot be modified or re-pointed through it.
The module hooks do not run in import mode, so these rules are applied to every imported record:

- **purchase orders:** the total is computed from the lines; a PO imported as Issued / Partially
  Received / Goods Received / Completed needs the importer's own authority to issue it (the
  authority resolver, as the API would);
- **approval requests:** AI proposals are refused; `approved_facts` are dropped (an imported
  approved Major Purchase does not count until the Owner re-authorizes it); a named approver is
  not kept as the approver (kept, for the record, as `imported_assigned_approver`);
- **invoices:** approval evidence (`approved_at`, `approved_by_*`, `approval_authority`,
  `ledger_cost_id`) is dropped, the recorder is the importer, the status must be known and the
  paid amount must agree with it. An imported invoice in a protected status is listed for the
  legacy review and stays blocked until released;
- the legacy review tables are not importable.

## Not changed / open

- Invoice payments are not linked to payment records (`payments`): the paid amount is checked for
  consistency, not against a bank record. `invoice_type` (which decides whether the 3-way match
  applies) is fixed only after approval.
- An imported Paid invoice is stored as Paid (legacy history, no approval evidence) and listed for
  the Owner to acknowledge or decline; import does not refuse it.
- Everything a stolen `nwos_app` credential can do (Batch 12 assessment) is unchanged: that is
  Batch 12B.
