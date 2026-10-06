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
nothing allows, the matched rule is the closest miss (the rule for this person that passed the
most checks), so the Owner Center can say exactly what blocked delegation. A refused API call
returns `reason_code` and `requires_owner` with the 403.

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

### Intentional narrowings (security, Batch 2)

- Clients and contractors can no longer decide internal approval requests just because a
  request was assigned to the Client role (client consent on Variation / Client Scope Change
  requests is unchanged).
- A Major Purchase / Major Cost request assigned to a role without `purchasing.view` (e.g. Site
  Supervisor) can no longer be decided by that role; it waits for the Owner or the Accountant.
  The approval screen does not offer such an assignment.
