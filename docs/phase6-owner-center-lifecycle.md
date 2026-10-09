# Phase 6 Batch 9 — Owner Center correctness and exception lifecycle

## 1. The bug this fixes

The Owner Center's "Decisions required" list (`ownerCenter()` in `server/modules/ownerCenter.ts`)
was built from raw record states:
- every drawing revision in review;
- every variation in Internal Approval;
- every approval request whose stored `assigned_approver_role` said Owner;
- every mismatched invoice.

It ignored approval routing, so decisions already routed to a delegate were shown to the Owner as
"Waiting for your approval": a Major Purchase routed to the Accountant, or a variation routed to a
PM. The "Decisions for you" health tile and the Owner dependency figures counted the same wrong
list.

## 2. Owner decisions from the current routing

`server/modules/ownerDecisions.ts` (`ownerDecisionSections`) builds three sections. Every route is
classified once by `classifyOpenRoutes()` in `server/modules/approvalOps.ts`. It is the same
classification the Owner Exception Center uses (it was refactored out of `ownerExceptions()`
without changing behaviour). It gives:
- the route's lifecycle;
- whether the assignee may still decide it (`assigneeMayDecide`, i.e. the authority resolver);
- the server's risk and blocking factors.

There is no second resolver.

### Requires my decision
- **Open routes assigned to the Owner.** The reason is the resolver's, for example "Variation
  RM 4,000 — Owner required: Nobody holds delegated authority for this decision", "escalated to
  you: it was overdue with the previous approver", or "you took this approval".
- **Routes whose delegate may no longer decide them** (revoked, expired, deactivated, lost a
  permission). These are shown as critical: "assigned to X, who may no longer decide it (CODE).
  NW OS re-routes it; until then it falls to you". The approval monitor and
  `reevaluateRoutes` then route them to the Owner (or the next delegate), as before.
- **Pending decisions not routed yet:** "it stays with you until NW OS routes it".
- **Not included:** anything with a delegate who may decide it.

### High-risk decisions
- These are pending decisions, with whoever they sit, carrying one of the server's existing
  risk factors: Strategic or Sensitive project, safety, blocked production / site / payment,
  project risk Critical or At Risk.
- Each item states its reasons.
- Overdue, escalated, high-value or merely delegated items are **not** high-risk on that alone.

### Recently delegated
Decisions routed away from the Owner. Each item shows today's status of its rule (still in force,
changed since, expired, revoked) as current information. One entry per decision:
- **With delegate now:** pending with a delegate.
- **Being re-routed:** the delegate may no longer decide it.
- **Decided by delegate:** decided by a delegate in the last 7 days, with the decider and rule.
  The decision's own historical snapshot (Batch 8 trace) is never changed.

### Shared rules
- The Owner Center keeps its `management.view` access (Owner and Admin). Clients, contractors
  and other roles get 403.
- Financial Exceptions, Company Health, Critical / Client Exceptions and the Phase 5
  `/api/exceptions` feed are unchanged.

### The approval request's assigned approver
- An approval request's `assigned_approver_role` is **not read** by the Owner Center.
- It is still an input to the authority resolver for generic approval requests: the Batch 2 System
  Policy `SYS-REQUEST-ASSIGNEE-*` says "the request's named approver decides". So it can affect
  routing, and the Owner Center follows routing.
- Only the requester can change the field, and changing it re-routes the request.
- A drifted or tampered stored value without re-routing changes nothing (this is tested).
- See §5 for the open question about this policy.

## 3. Exception lifecycle

Migration `024_phase6_owner_exception_lifecycle.sql` adds:
- **`owner_exception_states`:** one row per exception key. It holds the current state, the
  server's last severity, a fingerprint of severity, type, status and reason codes, whether the
  condition is present, first and last seen, the last meaningful activity and a version.
- **`owner_exception_events`:** append-only history. Database triggers refuse UPDATE, DELETE and
  TRUNCATE.
- **No deletes.** Triggers refuse deleting states and snoozes. Un-snoozing now ends the snooze
  instead of deleting its row.

`server/modules/exceptionLifecycle.ts` implements it.

### State machine

| Action (Owner) | From | To | Reason |
|---|---|---|---|
| acknowledge | active, waiting, stale | acknowledged | optional |
| wait | active, acknowledged, stale | waiting | **required** (what or whom you are waiting for) |
| resolve | active, acknowledged, waiting, stale | resolved | optional |
| dismiss | active, acknowledged, waiting, stale | dismissed | **required**; **never for a critical exception** |
| reopen | resolved, dismissed | active | **required**; only while the condition is present |

NW OS itself records, through the `exception_lifecycle` automation rule (hourly):
- `observed`: a new exception.
- `changed`: a material change of severity, reason codes or status. This counts as activity.
- `auto_resolve`: the condition cleared while the exception was open.
- `cleared`: the condition cleared after a dismissal.
- `recurred`: the condition is back after being resolved or dismissed. It is recorded only; the
  exception is **never reopened implicitly**.
- `stale`: an open exception with no meaningful activity for `STALE_DAYS` = 14.

### Rules
- **Severity is the server's own**, recomputed at the moment of every action. Nothing about
  severity, state or actor is accepted from the request; any field other than
  `id`, `reason` and `expected_state` is refused.
- **Critical exceptions:** they can be acknowledged, put on waiting and resolved. They are never
  dismissed, and never snoozed (as before). A critical exception is never hidden: if resolved
  while its condition is present, it stays listed with a note.
- **Approval exceptions:** while the approval is pending they are resolved by deciding the
  approval on its record; `resolve` is refused. They auto-resolve once decided.
- **Meaningful activity:** an Owner lifecycle action or snooze, or a material change. Viewing
  and polling write nothing (this is tested).
- **Stale is not resolved:** stale exceptions stay in the main list, marked "Stale — no
  activity", and can be filtered.
- **Concurrency:** each transition locks the state row (`SELECT … FOR UPDATE`), checks the
  optional `expected_state` (409 `conflict` if it changed) and writes the state, an event and an
  audit row in one transaction. Repeating the same action (a double click or a replay) changes
  nothing and adds no event.
- **Access:** Owner only, server-side, on every endpoint (as for the existing Exception Center).

### API
- `GET /api/owner/exceptions[?state=]`: live exceptions with `lifecycle`, plus `closed` (resolved
  and dismissed) and `summary.lifecycle` counts.
- `POST /api/owner/exceptions/{acknowledge|wait|resolve|dismiss|reopen}` with
  `{ id, reason?, expected_state? }`.
- `GET /api/owner/exceptions/history?id=`.

### Screen
The Owner Exceptions panel shows:
- a state badge on each card;
- Acknowledge, Waiting…, Resolve, Dismiss… (not for critical) and Reopen… buttons, offered only
  where the server would accept them;
- Lifecycle history;
- a state filter;
- a "resolved and dismissed" list.

## 4. Tests and acceptance

- `server/modules/ownerCenterLifecycle.test.ts` (19 tests):
  - **Owner decisions:**
    - Accountant-routed Major Purchase and PM-routed variation excluded;
    - Owner-required and escalated decisions included;
    - revoked delegate (in the view at once, then re-routed) and deactivated delegate;
    - routing changes vs the historical snapshot;
    - stale or tampered assignee field (both directions);
    - high-risk;
    - access.
  - **Lifecycle:**
    - every transition;
    - invalid transitions;
    - mandatory reasons;
    - critical restrictions, including forged fields;
    - approval resolve refusal;
    - auto-resolve, recurrence without reopening, reopen rules;
    - stale at 14 days (not at 13), polling is not activity, idempotent sync;
    - material change is activity;
    - replays, concurrent updates (409 conflict, no lost history);
    - append-only and no-delete triggers;
    - Owner-only access.
- `server/modules/owner.test.ts` was updated. Its old expectation (the Accountant-routed Major
  Purchase in the Owner's list) was the bug.
- `scripts/acceptance/phase6-owner-center.cjs` (13 steps) is recorded in
  `docs/phase6-owner-center-acceptance-run.txt`.

## 5. Known limitations and open points

- **Generic approval requests:** the System Policy that lets the requester name the approver
  (`SYS-REQUEST-ASSIGNEE-*`, Batch 2) still decides who may approve. It may deserve its own review;
  changing it would change authority policy and is outside this batch.
- **Stale threshold:** 14 days, a constant in `exceptionLifecycle.ts`. There is no settings
  screen.
- **Lifecycle timing:** the lifecycle rule runs hourly. A brand-new exception is listed at once as
  "active" (untracked) and is recorded on its first action or the next rule run.
- **Exception keys:** a project exception's key includes its risk level, so Attention → At Risk is
  a new exception and the old one auto-resolves.
- **Database owner:** the application's database login owns these tables, so a holder of that
  credential could disable the triggers. This is the same residual risk as `audit_logs`.
