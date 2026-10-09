# Phase 6 Batch 8 — Approval traceability and rejection notices

Two questions this batch answers:

- **Why was this person allowed to approve (or reject) this decision?**
- **Does the person who asked find out when their request is rejected?**

Both are built on what already exists: the authority resolver, approval routing, the audit log
and the notification centre. There is no new authority logic and no migration (the schema stays
at 23 migrations).

## 1. What is recorded, and where

Every approval path already calls the authority resolver before a decision and writes a decision
audit row with the result. These are approval requests, variations, purchase orders, supplier
invoices, and client / NW production drawing revisions. Batch 8 adds a decision-time snapshot to
that row (`after.authority.trace`, built by `decisionAudit()` in
`server/modules/decisionTrace.ts`):

| Field | Source at decision time |
|---|---|
| requester | the record's raiser (`raised_by` / `created_by_id` / `requested_by_id` / `uploaded_by_id`) |
| approver (id, name, role) | the deciding user, as they were then |
| permission | the baseline permission the resolver checked |
| authority type | Owner, System Policy, Permanent, Temporary, Absence, or Prior Owner approval |
| rule | the matched rule's full terms as the resolver read them: code, name, kind, effect, target, project / client scope, min / max value, max risk, conditions, start / end, priority, active, granted by, absence id, updated_at |
| scope / value / risk / dates / conditions | the resolver's own evaluated checks (required vs actual, passed) |
| project, client, sensitivity | the decision's project, its client and its sensitivity then |
| value | the server-side amount the resolver used (`null` = not known) |
| reason | the resolver's reason text |

The decision itself (outcome, comments, previous state) is in the same audit row. Routing and
escalation history comes from the existing `approvalTimeline`.

**Historical integrity.** `audit_logs` is append-only: database triggers refuse UPDATE, DELETE and
TRUNCATE. The snapshot is written in the decision's own transaction, from the same rule row the
resolver evaluated, so it cannot drift from the decision. Reading a decision back never re-reads
the rule to explain it. Today's rule status (in force, switched off and why, expired, edited
since) is returned separately as `current_rule_status`. It is always labelled as current and never
as the reason for the past decision. An expired or revoked rule is shown as "no longer in force…
The decision above was valid under the terms in force at the time". It is never shown as an
unauthorised decision.

Decisions recorded before Batch 8 have no snapshot. They are shown as "terms not recorded…
the reason cannot be established from the record", with only the rule code that was logged then.

## 2. Reading it: `GET /api/approval-routing/trace?kind=&id=`

`kind` is one of `approval`, `variation`, `purchase_order`, `invoice` or `drawing_revision`; any
other value returns 400. The response contains:

- every decision on the record, each with its snapshot;
- who the request is with now, if it is still pending;
- today's rule status;
- the routing timeline.

Who may read it, checked on the server:

| Who | Access |
|---|---|
| Owner, and Admin (via `authority.view`) | any decision in their project scope |
| The requester | their own request |
| An approver who decided it, or a current / past route assignee | that decision |
| Anyone else internal | 404 |
| Client, Contractor | always 404; internal authority details are never shown to them (a client's consent on their own project is not internal authority) |

Every refusal returns the same 404 as a record that does not exist. Only `kind` and `id` are
read from the request; nothing the browser sends can change what is returned. No new permission
was added.

## 3. The screen: "Why can this person approve this?"

`src/components/DecisionTrace.tsx` explains each decision in plain words, for example:
*"Marcus Lee (Project Manager) approved this on 09 Oct 2026 under a permanent delegated authority:
DA-0001 …"*. It lists the recorded facts and marks missing values as "not recorded". Below that
is a dashed **Current status (today) — does not change past decisions** box. It appears:

- in the approval history panel (Approval Inbox and Owner Exception Center);
- on decided approval requests (Approvals & Governance);
- on variations past internal approval;
- on approved / rejected drawing revisions;
- on issued purchase orders;
- on approved supplier invoices.

It is not offered to clients or contractors, and the server refuses them in any case.

## 4. The AI: "Why was VO-… approved?"

The Operating Assistant recognises "why was … approved / rejected", "who approved …" and "on what
authority …". It loads the decision record through `decisionTrace()` under the asking user's own
access (`traceContext()` in `server/ai/context.ts`), through the same gateway path as every other
AI request. Facts come from the stored snapshot only:

- **Confirmed:** authority type, rule code and terms, permission, value and sensitivity, as
  recorded.
- **Unknown:** "terms not recorded … cannot be established" for a pre-Batch-8 decision, an unknown
  reference, or a record the user may not see. A record the user may not see looks the same as a
  missing one.
- **Current rule status:** reported as its own section, labelled as not changing the past.

The AI cannot approve, reject or alter anything. Those requests are refused before any model call,
as before.

## 5. Rejection notices

When an approval request, a variation or a drawing revision is rejected,
`notifyRejection()` tells the original requester in the same transaction. The notice reads
"Rejected: <reference>: <title>" / "<decider> rejected your request. Comment: <comment>". It links
to the record's screen and carries no rule codes or authority details.

- **Exactly once:** the notice uses the existing notification de-duplication. Its rule key is
  `rejection:<kind>:<id>`, unique per user, so a retry, a replayed request or a second rejection of
  the same record adds nothing.
- **Only the requester:** nobody is told when the decider rejected their own request. The requester
  must be an active user who can still see the project.
- **Preferences:** NW OS has no per-user notification preference settings yet. The notice goes
  through the existing notification centre and follows its rules (active users only).
- **Client declines** (a variation at the client stage, or an approval request decided by the
  client on their own project) notify the requester the same way. The client's decision is
  consent, not internal authority, so its trace shows "client consent".
- **Not covered:** purchase orders and supplier invoices have no "Rejected" state, so there is no
  rejection to notify.
- **Unchanged:** the existing notices for routing, escalation and reassignment are not affected.

## 6. Tests and acceptance

- `server/modules/decisionTrace.test.ts` (13 tests) covers:
  - permanent, temporary, absence, System Policy and Owner authority;
  - scope;
  - the value boundary (exactly at the limit is allowed; one cent over is refused with no record);
  - risk;
  - Sensitive and Strategic projects;
  - history after a rule edit, a revocation, a real expiry and a role change;
  - the access matrix, client and contractor denial, identical 404s;
  - append-only records and forged fields;
  - the AI using the stored record, saying when the reason cannot be established, and being unable to decide;
  - rejection notices (once, only the requester, replay-safe), existing routing notices intact, and drawing revisions.
- `scripts/acceptance/phase6-trace.cjs` checks the same behaviour in the browser, recorded in
  `docs/phase6-trace-acceptance-run.txt`.

## 7. Known limitations

- Decisions made before this batch have no snapshot and are reported as "cannot be established".
  They are not reconstructed from today's rules.
- The value / risk shown is what the resolver evaluated. A record type with no server-side amount
  shows "not recorded".
- NW OS has no per-user notification preferences yet (see §5).
