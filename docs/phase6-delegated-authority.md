# Phase 6 — Delegated authority: design decisions

Decided with the Owner before Batch 1 (2026-10-06). These are binding for every later batch.

## 1. Permission vs delegated authority (Option A)

- **Permission** (the existing fixed role table in `src/utils/permissions.ts`) answers *may this role
  take part in this kind of workflow?* It is unchanged.
- **Delegated authority** (the `delegated_authorities` table) answers *may this person approve this
  particular decision under these conditions?*

A delegated approval requires all of: an authenticated active user; the decision type's **baseline
permission**; a matching active authority rule; project / client / resource scope; every existing
business rule; no self-approval where prohibited; audit logging.

Nobody is given the final approval permissions (`drawings.approve`, `variations.approve`) to make
delegation work. Where no existing permission meant "take part in / review", a narrow one was added:

| Decision type | Baseline permission | Notes |
|---|---|---|
| `drawing` | `drawings.review` (new) | granted to Project Manager, Production Manager |
| `variation` | `variations.review` (new) | granted to Project Manager |
| `purchase` | `purchasing.view` | existing |
| `invoice` | `finance.view` | existing |
| `ai_proposal` | `approvals.request` | existing |

**A baseline permission is not approval authority.** `drawings.review`, `variations.review`,
`purchasing.view`, `finance.view` and `approvals.request` let a person take part in the workflow;
on their own they approve nothing. A delegated approval needs, all together: the baseline
permission, a matching active System Policy or Owner rule, scope, every condition, and the
sensitivity ceiling (section 3). The ceiling gate (`server/modules/authorityCeiling.ts`) encodes
this: for anyone but the Owner its best outcome is `rule_required`, never "allowed". Tests prove,
for each decision type, that the baseline permission alone cannot approve.

Decision types live in the `authority_decision_types` table, so new types are added with data,
not schema changes.

## 2. Existing hard-coded approval rules = "System Policy"

Today's behaviour is recorded as **System Policy** rows (`kind = 'system'`) in the same table, never as
if the Owner created them:

- drawings: approved by holders of `drawings.approve` (today: Owner);
- variations (internal approval): holders of `variations.approve`, never the person who raised it;
- purchases: below RM 20,000 Purchasing issues the PO; at or above, a Major Purchase approval (or the
  Owner) is required — the threshold mirrors `MAJOR_PURCHASE_THRESHOLD`;
- Major Purchase / Major Cost approvals may be decided by the Accountant (`canEvaluateApproval`);
- technical changes / NW production drawing approvals may be decided by the Production Manager;
- invoices: `finance.edit`, never the recorder; an invoice whose match status is anything other
  than `Matched` needs the Owner;
- AI proposals: the person who asked, or the Owner;
- project sensitivity: Sensitive / Strategic require the Owner (see 3).

System Policy definitions cannot be edited through the API. The Owner may deactivate / reactivate
them (explicit, validated, audited, reversible, with a reason), except the Sensitive and Strategic
rows, which are locked (API refusal plus a database trigger).
To change a policy the Owner creates an Owner rule with a higher priority.

Since Batch 2 the authority resolver (section 4) enforces these rows on every approval path.
Migration 018 made them describe today's behaviour exactly, using server-only conditions (see 4).

## 3. Project sensitivity (project level)

`projects.sensitivity`: `Normal` (default for every existing and new project), `Sensitive`,
`Strategic`. Only the Owner sets it, through `PUT /api/projects/:id/sensitivity`; the general project
APIs and the browser sync keep the stored value.

**Sensitivity is a hard authority ceiling.** Delegated authority may reduce Owner involvement only
below it; nothing can reach above it.

- Normal: delegated authority may apply.
- Sensitive: only the Owner approves the protected decision types
  (`authority_decision_types.sensitive_protected`, all five today; not editable through any API, and
  a type added later is protected by default). `SYS-SENSITIVE-<TYPE>` rows are locked.
- Strategic: only the Owner approves every decision type, including types added later.
  `SYS-STRATEGIC-<TYPE>` rows are locked.

To change the authority model of a project, the Owner changes its sensitivity (Owner-only, reason
required, audited before / after, including which rules the new ceiling overrides). Delegated
authority management cannot switch the protection off.

Enforcement, all server-side:

- `authorityCeiling()` (first gate of every delegated decision; the Batch 2 resolver must call it
  first) reads the project from the stored record (`projectOf`) and its sensitivity from the
  database, never from the request. Unknown type, missing project or unknown sensitivity → Owner.
- Rule validation refuses to create, change or reactivate an allow rule scoped to a project whose
  sensitivity reserves that decision type for the Owner.
- An allow rule that pre-dates a sensitivity rise (or is scoped by client / globally) stays stored
  but is ignored by the ceiling gate; lowering the sensitivity brings it back into force.

## 4. The authority resolver (Batch 2)

`server/modules/authorityResolver.ts` — `resolveApprovalAuthority(db, ctx, { resource, action,
pending })` and `requireAuthority(...)` (throws 403 carrying the result). It is the only code that
grants approval authority. Dependency direction: approval hook → resolver → ceiling / risk /
database. The resolver never calls a hook or an approval helper. `canEvaluateApproval` in
`src/utils/permissions.ts` is now used by the browser only (to show buttons), never by the server.

Order, always:

1. the authenticated, active user (session, never the browser);
2. the record being decided, loaded from the database (`drawing_revision`, `drawing`,
   `variation`, `purchase_order`, `invoice`, `approval`);
3. its project and client, from that record; the user must be able to see the project;
4. the project's sensitivity, from the database;
5. the sensitivity ceiling (`authorityCeiling`), 6. the baseline permission;
7. self-approval (nobody decides what they raised / recorded / requested);
8. every System Policy and Owner rule of the decision type: targeting (user / role /
   permission), project / client scope, active, start / end, value range, project risk (live,
   from the risk engine), conditions; then priority;
9. the structured result.

The Owner needs no rule (still subject to the approval path's business rules, such as "you
cannot internally approve a variation you raised"). For anyone else the decision needs the
baseline permission AND a matching active rule AND scope AND conditions AND a project
sensitivity that allows delegation. Between an applicable allow rule and an applicable
require_owner rule, the higher priority wins; a tie goes to the Owner.

`pending` carries facts of the write being made, computed by the server (a PO's total from its
lines, an invoice's amount and 3-way match, a project the record is moving to — the ceiling is
checked for both projects). Approval requests take a value only from their related PO or
variation in the database, never from the requester's estimate.

### Result

`allowed`, `reasonCode`, `reason`, `basis` (owner / rule / prior_owner_approval / none),
`action`, `decisionType`, `userId`, `userRole`, `resourceType`, `resourceId`, `projectId`,
`clientId`, `projectSensitivity`, `baselinePermission`, `matchedRuleId`, `matchedRuleCode`,
`requiresOwner`, `evaluatedConditions`, `evaluatedScope`, `evaluatedValue`, `evaluatedRisk`,
`evaluatedDates`, `rules` (every rule considered and what happened to it), `resolvedAt`. When
nothing allows, `reasonCode` is the actual blocker chosen by the reason precedence below, and
`matchedRuleCode` names the rule it comes from (if any), so the Owner Center can say exactly
what blocked delegation. A refused API call returns `reason_code` and `requires_owner` with
the 403.

### Reason precedence (deterministic)

When more than one thing stands in the way, the reported reason is the first in this list
(`REASON_PRECEDENCE` in the resolver):

1. `INVALID_AUTHORITY_CONTEXT` — 2. `SENSITIVITY_BLOCKED` — 3. `SELF_APPROVAL_BLOCKED` —
4. `INSUFFICIENT_PERMISSION` — 5. `OUT_OF_SCOPE` — 6. `AUTHORITY_NOT_YET_ACTIVE` —
7. `AUTHORITY_EXPIRED` — 8. `AUTHORITY_DEACTIVATED` — 9. `VALUE_LIMIT_EXCEEDED` —
10. `RISK_LIMIT_EXCEEDED` — 11. `CONDITION_NOT_MET` — 12. `NO_MATCHING_AUTHORITY` —
13. `OWNER_REQUIRED` — 14. `ALLOWED`.

How it is applied:

- Items 1-4 are gates checked in that order before any rule is looked at; the first that
  fails is the answer. A project sensitivity that reserves the decision for the Owner is
  therefore always reported as `SENSITIVITY_BLOCKED`, however many rules match or fail.
- One check comes even before them: the record must be in a project the user can see.
  Otherwise the answer is `OUT_OF_SCOPE` and nothing about that project (not even its
  sensitivity) is disclosed.
- Items 5-11 come from rules, and only from rules that would have decided the matter:
  allow rules written for this person (by user, role or permission), about this kind of
  decision, that would outrank every applicable require_owner rule had they passed. Rules for
  other people, other decision types or the other kind of path (record vs approval request)
  never count, and neither does a rule that would have lost to the Owner requirement anyway.
  A rule for another project or client counts (`OUT_OF_SCOPE`) only when it is in force
  (active and in date) and no rule for this person covers the record. Among the remaining rules the earliest code wins; equal codes go to
  the higher priority, then the rule code, so the answer never depends on storage order.
- `OWNER_REQUIRED`: a require_owner rule applies and no rule for this person could outrank it.
  `NO_MATCHING_AUTHORITY`: no rule could give this person authority and no require_owner rule
  applies. The two never apply together.
- `ALLOWED`: an applicable allow rule outranks every applicable require_owner rule (ties go to
  the Owner).

Tests prove that adding unrelated rules (other projects, deactivated or expired ones, other
people, other decision types) never changes the reported reason.

### The approval screens use the resolver

Screens never work out approval authority themselves. They ask the server, for the signed-in
user, about the records they show: `GET /api/authority/resolve?items=kind:id:action,...`
(any signed-in user; at most 100 items; returns `allowed`, `reason_code`, `reason`,
`requires_owner`, `basis`, `decision_type`, `project_sensitivity`, `matched_rule_code` — never
the rule list). Client consent is answered by the same server function the approval hook uses
(`clientConsentAllowed`). The action is shown only when `allowed`; otherwise the screen shows
"Owner approval required" (with the sensitivity when that is the reason) or the server's reason.
This is information only: the server resolves again when the action is taken, so a manipulated
screen gains nothing.

Connected screens: drawing revision Approve / Reject and NW production "Approved for
Production" (DrawingViewer); variation internal approval and rejection (VariationsView);
invoice Approve (CostControl › Invoices); approval requests Approve / Request changes /
Reject (ApprovalsView); AI proposal Approve & run / Reject (assistant answers); Issue PO
(Purchasing — a new PO is saved Pending Approval and issued from there when the server allows).
Demo mode (no database, nothing stored or enforced) has no server to ask and keeps the earlier
on-screen rules.

### Reason codes (stable)

| Code | Meaning |
|---|---|
| `ALLOWED` | The Owner, a matching rule, or (PO only) the Owner's own Major Purchase approval |
| `OWNER_REQUIRED` | A require_owner rule applies (e.g. SYS-PURCHASE-MAJOR, SYS-INVOICE-MISMATCH) |
| `SENSITIVITY_BLOCKED` | The project is Sensitive / Strategic: only the Owner |
| `NO_MATCHING_AUTHORITY` | Baseline permission but no rule for this person |
| `INSUFFICIENT_PERMISSION` | No baseline permission, or a client / contractor |
| `OUT_OF_SCOPE` | Record outside the user's projects, or the rule is for another project / client |
| `VALUE_LIMIT_EXCEEDED` | Amount outside the rule's range (or unknown to the server) |
| `RISK_LIMIT_EXCEEDED` | Project risk above the rule's maximum |
| `AUTHORITY_NOT_YET_ACTIVE` | The rule starts later |
| `AUTHORITY_EXPIRED` | The rule has ended |
| `AUTHORITY_DEACTIVATED` | The rule was switched off |
| `CONDITION_NOT_MET` | A rule condition failed (e.g. not the assigned approver) |
| `SELF_APPROVAL_BLOCKED` | The person raised / recorded / requested it |
| `INVALID_AUTHORITY_CONTEXT` | Record, project, decision type or sensitivity cannot be established, or the account is deactivated: fails closed to the Owner |

### Server-only rule conditions (System Policy)

`direct_only` (the record itself, not approval requests), `requests_only`, `approval_types`,
`assigned_approver` (named user, named role, or a "Designated Authorized Manager" request and
approvals.decide), `requires_permission`, `no_self_approval`, `match_status`,
`match_status_not` (an invoice without a PO match is "Not applicable"), `prior_approval` /
`unless_prior_approval` (an approved Major Purchase approval for the PO), `sensitivity`. An
unknown condition never lets an allow rule apply and always lets a require_owner rule apply.

### Decision types of approval requests

Major Purchase / Major Cost → `purchase`; AI Proposal → `ai_proposal`; every other request
(technical change, NW production drawing, drawing, variation, date change, safety-critical,
anything new) → `approval_request` (baseline `approvals.view`, protected on Sensitive projects).
Drawing revisions and variations themselves are the `drawing` / `variation` decisions.

### Approval paths

| Path | Where | Resolver | Notes |
|---|---|---|---|
| Client drawing revision approve / reject | `hooks/drawings.ts` upsertRevision | yes (`drawing_revision`) | was `drawings.approve` |
| NW production drawing approve / approved-for-production | `hooks/drawings.ts` | yes (`drawing_revision`) | |
| New NW production drawing uploaded as approved | `hooks/drawings.ts` | yes (`drawing`) | |
| Variation internal approval (→ Client Approval) | `hooks/variations.ts`, `/variations/:id/transition` | yes (`variation`, approve) | creator block kept (applies to the Owner too) |
| Variation internal rejection | `hooks/variations.ts` | yes (`variation`, reject) | |
| Variation client approval / client declining at the client stage | `hooks/variations.ts` | no — client consent | `variations.client_approve`; staff recording it need a reference and must not be the internal approver |
| PO issue (any value) | `hooks/purchasing.ts` | yes (`purchase_order`) | RM 20,000 policy via SYS-PURCHASE-STANDARD / -MAJOR / -APPROVED |
| Major Purchase / Major Cost request decision | `hooks/approvals.ts`, `/approvals/:id/decision` | yes (`approval` → purchase) | Accountant via SYS-PURCHASE-ACCOUNTANT |
| Supplier / client invoice approval | `hooks/purchasing.ts` | yes (`invoice`) | match / mismatch / recorder |
| AI proposal decision | `hooks/approvals.ts` | yes (`approval` → ai_proposal) | then runs with the approver's permissions |
| Technical change / NW drawing / other approval requests | `hooks/approvals.ts` | yes (`approval` → approval_request) | Production Manager via SYS-TECHNICAL-PRODMGR (needs approvals.decide, as before) or as assigned approver |
| Client deciding a Variation / Client Scope Change request | `hooks/approvals.ts` | no — client consent | own project only |
| Request resubmission (Changes Requested → Pending) | `hooks/approvals.ts` | no — not a decision | requester or Owner |
| Quotation internal approval | `hooks/commercial.ts` | no | not a delegated decision type (pre-contract, `commercial.margins`, not by the preparer); candidate for a future type |
| Knowledge article approval | `hooks/knowledge.ts` | no | company knowledge, no project; not by the author |
| Variation Implemented / Closed | `hooks/variations.ts` | no | lifecycle steps after approval |
| Who to notify / brief about pending approvals | `automation/rules.ts`, `briefing.ts`, `ownerCenter.ts`, `exceptions.ts` | no | read `drawings.approve` / `variations.approve` to pick people; routing to delegates is Batch 4 |

## 5. Intentional security hardening (Phase 6)

Two behaviours were tightened on purpose in Phase 6 Batch 2. They are not regressions and must
not be reverted. Regression tests: `server/modules/authorityResolver.test.ts`, "intentional
Phase 6 security hardening".

### 5.1 Clients cannot decide internal approval requests

- **Previous behaviour:** an approval request of any type assigned to the Client role (the
  approval form offers "Client" as an approver) could be approved, rejected or sent back by a
  Client user, because the old rule (`canEvaluateApproval`) let anyone whose role matched the
  assigned role decide.
- **New behaviour:** a Client user can decide only a client-facing request (Variation, Client
  Scope Change) on their own project — the client's consent. Any other request (Safety-Critical
  Decision, Technical Change, Major Purchase, Project Date Change, ...) assigned to Client is
  refused with `INSUFFICIENT_PERMISSION` and waits for the Owner or an internal approver.
- **Why it is safer:** internal approvals commit the company (spending, technical sign-off,
  safety). An external party must never hold that authority, however a request was assigned;
  clients and contractors cannot hold internal approval authority anywhere else in Phase 6.
- **Tests:** "1. a Client user cannot decide an internal request just because it is assigned to
  the Client role" (four request types, all three decisions, record stays Pending, and the old
  rule is shown to have allowed it) and "1b. client consent is unchanged".

### 5.2 Major Purchase / Major Cost requests need the purchase baseline permission

- **Previous behaviour:** a Major Purchase or Major Cost request assigned to a role without
  `purchasing.view` (for example Site Supervisor) could be decided by that role.
- **New behaviour:** these requests are purchase decisions; deciding one requires the purchase
  baseline permission `purchasing.view` like every other purchase decision. Such a role is
  refused with `INSUFFICIENT_PERMISSION`; the Accountant (System Policy) and the Owner still
  decide the request.
- **Why it is safer:** a large spending decision should only be taken by someone who takes part
  in purchasing and can see the purchase records; the baseline permission is the Phase 6
  safeguard for that, and it applies to every decision type without exception.
- **Tests:** "2. a role without purchasing.view cannot decide a Major Purchase / Major Cost
  request, even when assigned" (both types; the old rule is shown to have allowed it; the
  Accountant and the Owner still can).

These are intentional Phase 6 changes, agreed in the Batch 2 review.

## 6. Owner Authority Settings (Batch 3)

Navigation: **Delegated Authority** (live system; the Owner manages, the Admin views — the
Batch 1 `authority.manage` / `authority.view` permissions). Nothing on the screen decides
authority: rule summaries, warnings, impact and validation all come from the server, and
approvals are still decided by the resolver.

- **Overview** (`GET /api/authority/overview`): active delegated rules, System Policies, Owner
  rules, rules expiring in 30 days, inactive rules, rules overridden by project sensitivity,
  Sensitive / Strategic projects, approvals waiting for the Owner (and why), delegated coverage
  by routing basis, and the decision types only the Owner can approve today.
- **Rules**: searchable, filterable table (decision type, status, System Policy / Owner, effect,
  role, user, project, client, expiring soon, overridden by sensitivity) with name, code, target,
  scope, value range, max risk, dates, priority, effect, kind (`SYSTEM POLICY`, `LOCKED`),
  status, created by, last changed, reason. A rule's detail shows identity, who, scope,
  conditions, governance (created / changed / deactivated, by whom, why), the server-written
  summary and the audit history.
- **New / edit rule** (Owner): guided form (decision type, target user or role — permission
  targets remain System Policy only — scope, value, risk, dates, priority, reason). **Preview**
  (`POST /api/authority/rules/preview`, `/rules/:id/preview`) runs the same server validation as
  saving and returns the summary, affected users / projects / pending approvals, whether the rule
  is immediately usable, higher-priority rules, and warnings: project Sensitive / Strategic,
  overridden by sensitivity, overlaps an existing rule, may never apply (a higher-priority Owner
  requirement), broadens System Policy, expires soon. Save is enabled only after a preview of
  the exact values; a reason is required for create and edit (Batch 1).
- **Deactivate / reactivate**: impact first (`GET /api/authority/rules/:id/impact`): users and
  projects covered, pending approvals routed by the rule, what happens next; then a reason.
  System Policy can be switched off / on where Batch 1 allows; definitions cannot be edited; the
  Sensitive / Strategic rows stay locked.
- **Project sensitivity**: Owner-only change with a reason; pending approvals are re-routed at
  once and the screen shows how many, and which rules the new ceiling overrides.
- **Re-run routing**: re-evaluates every pending approval against current authority.

Approval routing — who receives each decision — is described in `phase6-routing.md`.

## 7. Proactive approval management (Batch 4)

SLAs, the business calendar, the approval monitor (reminders, overdue, escalation, automatic
re-routing), the Owner routing policy for several Owners, closed-project review and the Owner
Exception Center are described in `phase6-approval-monitoring.md`. Batch 4 does not change the
authority model or the resolver: every assignment, escalation and Owner action is checked by it.

## 8. Owner independence and delegation intelligence (Batch 5)

Owner dependency analytics and delegation recommendations are described in
`phase6-delegation-intelligence.md`. A recommendation is an observation, never authority: only
the Owner's confirmed acceptance creates a rule, through the same authority API.

## 9. Coverage, temporary authority and Owner absence (Batch 6)

Delegation coverage, temporary authority, expiry, Owner absence and delegation effectiveness are
described in `phase6-coverage-temporary-authority.md`. Temporary and absence authority are
ordinary Owner rules (`authority_type` temporary / absence) with an end time: temporary
authority is still subject to the same Authority Resolver and sensitivity ceilings as permanent
authority.

## 10. The AI operating layer (Batch 7)

The LLM-assisted Operating Assistant is described in `phase6-ai-operating-layer.md`. The AI is
never an authority source: questions about who may approve are answered from approval routing
and the authority resolver, AI suggestions run only through the AI Proposal approval, and
requests to approve, reject or grant authority are refused before any model is called.

## 11. Decision traceability and rejection notices (Batch 8)

"Why was this person allowed to approve this?" is answered from a snapshot stored with each
decision (the resolver's own result and the rule terms it read, in the decision's transaction,
in the append-only audit log), never from today's rules. Rejections notify the original
requester once. See `phase6-decision-traceability.md`.

## 12. Owner Center correctness and exception lifecycle (Batch 9)

The Owner Center's "Requires my decision", "High-risk decisions" and "Recently delegated" come
from the current approval routing, never from record states or an approval request's
creation-time fields. The Owner Exception Center keeps a persistent, append-only lifecycle
(acknowledged, waiting, resolved, stale, dismissed). See `phase6-owner-center-lifecycle.md`.
