# Phase 6 — Proactive approval management (Batch 4)

Batches 1–3 decide **who may approve** (the authority resolver) and **who should receive** each
pending decision (routing). Batch 4 makes sure a pending decision never sits unattended, never
becomes orphaned and never stays with someone who may no longer decide it:

```text
Decision ─► Authority resolver ─► Route ─► Monitor ─► Reminder ─► Escalate / Re-route
                                                                      │
                     Audit ◄─ Resolver verifies again ◄─ Human decision ◄─ Owner Exception Center
```

Nothing in Batch 4 approves, rejects or cancels anything. Every decision is still taken by a
person on the record's own endpoint, where the authority resolver checks again.

## Architecture

```text
                    ┌──────────────────── Phase 5 automation engine (one scheduler) ─────────────────────┐
                    │  tick ─► claim lease on rule row ─► rule.evaluate() ─► planned actions            │
                    │                                         │                 │ (each in its own tx,   │
                    │                                         │                 │  ledger row first:     │
                    │                                         │                 │  automation_actions)   │
                    │                    approval_monitor ────┘                 ▼                        │
                    │                    (server/modules/approvalMonitor.ts)   notifications / escalations│
                    └──────────────────────────────┬─────────────────────────────────────────────────────┘
                                                   │ per open route: short tx, row locked (SKIP LOCKED)
                                                   ▼
   approval hooks ─► syncRoute ─► computeRouting ─► resolveApprovalAuthority (per candidate)
   (on every write)      │              │
                         │              └─► Owner fallback: Owner routing policy
                         ▼
                 approval_routes (one open route per decision; clock, SLA, lifecycle, counters)
                         │
                         ├─► GET /api/approval-routing/inbox      (approver: lifecycle, history)
                         └─► GET /api/owner/exceptions            (Owner: severity, priority, reasons, actions)
```

- Server code: `server/modules/approvalMonitor.ts` (the monitor rule),
  `server/modules/approvalRouting.ts` (routing, re-routing, Owner policy),
  `server/modules/approvalOps.ts` (lifecycle view, history, Owner Exception Center, Owner tools),
  `server/modules/businessCalendar.ts` (working-time arithmetic).
- Migration: `db/migrations/020_phase6_approval_monitoring.sql`.

## Approval lifecycle

The record's own status fields (approval `decision`, variation `status`, revision
`approval_status`, PO / invoice `status`) stay the source of truth for whether a decision is
pending and how it ended. The route adds the lifecycle of the *waiting*:

| Status shown | Stored as | Meaning |
|---|---|---|
| Assigned | `lifecycle_state = assigned` | Routed to someone who may decide it, within its SLA |
| Owner Required | `assigned` + `routing_basis = OWNER_FALLBACK` | No delegate may decide it; the Owner has it (with `owner_reason_code`) |
| Due Soon | `due_soon` | Past the due-soon threshold (default 80% of the SLA) |
| Overdue | `overdue` | Past the due date (100%) |
| Escalated | `escalated` | Past the escalation threshold (default 150%); escalated once |
| Owner Review | `owner_reason_code = PROJECT_CLOSED` | Still pending on a closed project |
| Approved / Rejected / Changes Requested / Cancelled | route `status` + `completion_result` | The decision ended |

A reminder state (`reminded`, 50%) sits between Assigned and Due Soon; it is shown as Assigned.
"Re-routing" is not a stored state: a re-route closes the old route (`rerouted`) and opens a new
one in the same transaction. "Expired" is not used: approvals do not expire on their own; an
approval that outlives its project goes to the Owner for review instead (below).

States only move forward and are written by the monitor; the screens also compute the stage
reached since the last run (`lifecycleOf`), so a screen is never behind the clock.

Each route also carries: `requested_at` (when the decision started waiting — carried across
re-routes, never reset), `routed_at`, `due_at`, `sla_business_days`, `reminded_at`,
`due_soon_at`, `overdue_at`, `escalated_at`, `reroute_count`, `escalation_count`,
`route_reason` and `last_checked_at`. The inbox shows age, working days waiting, time to / past
due, re-routes and escalations (all server-calculated).

## SLA model

`approval_sla_policies`, one row per decision type (defaults, editable by the Owner):

| Decision type | SLA (working days) |
|---|---|
| drawing | 1 |
| purchase (incl. Major Purchase / Major Cost requests) | 1 |
| approval request (technical, safety-critical, … Owner decisions) | 1 |
| AI proposal | 1 |
| invoice | 2 |
| variation | 2 |

Thresholds per policy: reminder 50%, due soon 80%, overdue 100%, escalation 150%, and
`escalate_to` = `owner` (default) or `next_eligible`. There is no separate "production approval"
decision type: production is gated by drawing approval, which has its own SLA. There are no
project-specific SLA overrides (projects have no such setting today).

- `due_at` is set when a decision is first routed: `requested_at` + SLA in working time.
- A change to a policy applies to approvals requested afterwards; pending ones keep their due date.
- Routes created before Batch 4 get their SLA and due date on the monitor's first check,
  counted from when they were first routed.
- **An SLA never changes who may approve.** It only decides when an approval is reminded and
  escalated; every assignment is still checked by the resolver.

API: `GET /api/authority/sla` (authority.view), `PUT /api/authority/sla/:decision_type`
(Owner; thresholds validated, a reason required, audited `approval.sla.update`).

## Business calendar

The Phase 5 calendar existed only as browser demo data, so its defaults moved to the server:
`business_calendar` (one row: working days, UTC offset) and `business_holidays`. Seeded with
Monday–Saturday, UTC+8 and the 2026 Malaysian public holidays. SLA time runs only on working
days (whole days; there are no working hours). There is no per-project or per-client calendar
and no HR calendar.

## Monitoring

`approval_monitor` is an automation rule on the Phase 5 engine (interval 15 minutes, config
`batch_size` 200). It uses the engine's lease, run log, retry with backoff and action ledger;
there is no second scheduler and no background loop. Each run:

1. Routes every pending decision that has no route (the no-orphan invariant).
2. Takes up to `batch_size` open routes, least recently checked first, and checks each one in
   its own short transaction with the route row locked (`FOR UPDATE SKIP LOCKED`, so a route
   being written by someone is skipped this time):
   - decided / withdrawn meanwhile → the route is closed;
   - project Completed / Closed / Cancelled → Owner review (below);
   - the assignee may no longer decide it → **re-routed** (below);
   - otherwise its lifecycle moves forward from the SLA, and past the escalation threshold it is
     **escalated** (below).
3. Plans notifications (one per stage per person) and escalation records for the engine to
   perform exactly once each.

It identifies: due soon, overdue, approver inactive, authority expired / deactivated /
not yet active, project sensitivity raised, required permission removed (role change), no valid
assignee, past the escalation threshold. A rule whose `end_at` passes is now noticed without
anyone saving anything (Batch 3 needed "Re-run routing" for that).

Per-route failures do not stop the run: the route's transaction rolls back (it keeps its
current route) and the run is recorded as **failed** with the reasons, so it is retried with
backoff and shows in the Automation run log and the Owner Exception Center.

## Reminders

| Stage | Who | Notification key (idempotency) |
|---|---|---|
| Reminder (50%) | the assignee | `approval_monitor:<kind>:<id>:reminded:<user>` |
| Due soon (80%) | the assignee | `…:due_soon:<user>` |
| Overdue (100%) | the assignee | `…:overdue:<user>` |

Only the latest stage reached is notified (a run after a long outage does not send three
messages). Notifications go through the Phase 5 notification engine (`notifications`, unique per
user and key); the ledger (`automation_actions`) records each one, so a second run, a second
server or a retry sends nothing twice.

## Escalation rules

At the escalation threshold (default 150% of the SLA), once per decision:

1. The current assignee's authority was just re-checked (an invalid one is re-routed instead).
2. `escalate_to = next_eligible`: the next person the routing engine finds eligible (resolver
   allowed, routing precedence), if any.
3. Otherwise the Owner (Owner routing policy) — **if the Owner may decide it**. If not (the
   Owner raised the variation), it is escalated where it is and every Owner gets the escalation.
4. The new route has `route_reason = escalated_overdue` (and, for the Owner,
   `owner_reason_code = ESCALATED_OVERDUE` with how late it was); audited
   `approval.route.escalate`.
5. The new approver is notified ("Escalated to you"); the previous one is told it moved.
6. An escalation record (`escalations`, level 2, `rule_key = approval_monitor`) is raised and
   stays open until the decision is taken (the engine resolves it then).

An escalated route is not undone by re-evaluation (rule or sensitivity changes, server start)
while its assignee may still decide it.

**Escalated because overdue** (`route_reason = escalated_overdue`, audit
`approval.route.escalate`) and **re-routed because no longer authorized**
(`route_reason = authority_changed`, audit `approval.route.reroute` with the resolver reason)
are always distinguishable — in the data, the audit log, the history and the screens.

## Automatic re-routing

When the monitor (or any re-evaluation) finds the current assignee may no longer decide —
inactive, authority expired or deactivated, sensitivity raised to Sensitive / Strategic,
baseline permission removed — the routing engine runs again: the next eligible delegate, or
the Owner with the reason. The old route is closed as `rerouted`, the new one links to it
(`replaces_route_id`), `reroute_count` goes up, the audit carries the reason code, the new
assignee is notified and the old one is told it moved. An approval is never left assigned to an
invalid user longer than one monitor interval; saving a rule, a sensitivity change or a user
change still re-routes at once (Batch 3).

## Owner fallback and multiple Owners

The Owner who receives an Owner fallback (no delegate, sensitivity, escalation, closed project)
follows the **Owner routing policy** (replacing "lowest user id"):

1. the active **primary Owner** (`users.is_primary_owner`, at most one);
2. else the active Owner with the highest `owner_priority`;
3. else user id.

Among those, the first Owner the resolver allows is chosen (an Owner never receives their own
variation if another Owner exists). With a single Owner nothing changes. No load balancing or
round robin. `GET /api/authority/owner-routing` (authority.view); `PUT` (Owner only, audited
`authority.owner_routing.update`, re-routes Owner fallbacks at once).

## Closed projects

Pending approvals on a project that becomes Completed, Closed or Cancelled are not deleted and
not cancelled automatically: they are routed to the Owner (`owner_reason_code = PROJECT_CLOSED`,
`route_reason = project_closed`, audited) for an explicit review — decide it or withdraw it on
the record. They get no reminders or escalations and show as "Owner Review" in the Owner
Exception Center. Automation does not create approvals for closed projects (the Phase 5 rules
already skip them).

## Owner Exception Center

Navigation: **Owner Dashboard → Owner Exceptions** (top of the existing Owner Center; no
separate dashboard). `GET /api/owner/exceptions` — **Owner only** (not Admin). It answers "What
requires my attention right now?":

- **Summary**: Critical / Urgent / Attention counts; approvals overdue, escalated, blocked, due
  today, waiting for the Owner; projects critical / at risk; delegation rules expiring in 7 days
  and approvals with no delegate.
- **Approvals** that need the Owner: routed to an Owner, or delegated but overdue, escalated,
  assigned to someone who may no longer decide, or on a closed project. A delegated approval
  that is on time and valid is not listed.
- Pending decisions without a route; projects rated Critical / At Risk / Attention; open
  critical issues; delegation expiring within 7 days; other automation escalations to the Owner;
  failing automation; informational: approvals completed in the last 24 hours, delegation
  changes in the last 7 days.

### Severity (server rules)

| Severity | Raised by |
|---|---|
| 🔴 Critical | safety-related approval; Strategic project approval with the Owner; drawing approval while production is blocked on the project; site work waiting; supplier payment blocked (invoice overdue or past its due date); critical project risk; no valid approver (inactive assignee, nobody who may decide, no route); Critical project; safety issue |
| 🟠 Urgent | overdue approval; escalated approval; authority conflict (assignee may no longer decide); closed-project review; critical issue; at-risk project; escalations from other rules; approval monitor failing |
| 🟡 Attention | due soon; plain Owner decision (no delegate); delegation expiring; project at Attention |
| 🟢 Informational | approval completed; delegation changes; other automation warnings |

### Priority score

A deterministic sum of named factors, returned with the item so the Owner sees why it is at the
top: no valid approver 100, safety 100, Strategic 80, production blocked 60, escalated 50,
authority conflict 50, overdue 40 + 5 per working day late (max +30), site blocked 40, payment
blocked 40, critical project risk 40, closed-project review 30, Sensitive 20, project At Risk 20,
Owner required 20, value ≥ RM 100,000 20 (≥ RM 20,000 10), due soon 10, age 2 per day (max 20).
Items are ordered by severity, then score, then id. There is no AI or opaque score.

### Card and actions

Each card shows type, project, client, decision, status, current approver, value, risk, due
date, age, why the Owner sees it, the reasons with their points, and the recommended next
action. Actions the server offers per item:

- **Open record**; **History & authority** (the timeline below, with routing basis and reason).
- **Approve / Reject / Request changes** (approval requests the Owner may decide): calls
  `POST /api/approvals/:id/decision` — the resolver checks again. Other kinds are decided on
  their record (Open record).
- **Re-route** (`POST /api/approval-routing/route`).
- **Assign** (`POST /api/approval-routing/assign`, Owner only): to a person the resolver allows
  — the browser sends only who and why; basis, rule and fallback are computed by the server.
  The assignment stays while that person may decide it (`route_reason = owner_assigned`).
- **Snooze** (non-critical only): 1 to 168 hours, a reason, audited (`owner_exception.snooze`);
  it reappears when the snooze ends, or at once if it becomes critical. Safety, Strategic and
  blocked items are critical and cannot be snoozed.

## Approval history

`GET /api/approval-routing/history?kind=&id=` (an assignee, or authority.view) and the
`timeline` in `/explain`: created → routed to … (basis, rule) → reminder sent → now due soon /
overdue → re-routed to … (reason code) → escalated to … → approved / rejected, each with time,
actor (person or NW OS Approval Monitor), reason and routing basis. Built from
`approval_routes`, the action ledger and `audit_logs`; there is no separate history table.

## No-orphan invariant

A pending internal approval always has exactly one open route to an active person who may
decide it, or the Owner fallback:

- the route is written in the same transaction as the record (Batch 3); without any active Owner
  the write fails;
- the monitor routes anything unrouted, and re-routes any route whose assignee is inactive or no
  longer authorized;
- a failed re-route rolls back and leaves the existing route (never none); the run fails and
  retries;
- a failed notification never touches the route; it is retried on the next run;
- running the monitor twice, or on two servers, changes nothing the second time (lease, row
  locks, forward-only states, ledger keys).

Tested in `server/modules/approvalMonitor.test.ts` (deactivation, expiry, rule disabled,
permission removed, sensitivity, closed project, routing failure, notification failure, double
scheduler).

## Scheduler and idempotency

| Concern | How |
|---|---|
| One scheduler | the Phase 5 engine; the monitor is one of its rules |
| Two servers / overlapping runs | the rule's lease (`automation_rules.lease_until`); one run at a time |
| Same route touched concurrently | `FOR UPDATE SKIP LOCKED` per route, one short transaction each |
| Pool starvation | no connection held across the run; one transaction at a time; the Phase 5 lease fix is unchanged |
| Unbounded scans | only open routes, `batch_size` per run, least recently checked first (`approval_routes_monitor_idx`) |
| Duplicate notifications / escalations | ledger keys per decision, stage and person; `notifications` unique per user and key |
| Duplicate routing | unique open route per decision; forward-only lifecycle; one escalation per decision |
| Retry-safe | a failed action rolls back with its ledger row and runs again next time |
| Audited | `approval.route.assign / reroute / escalate / lifecycle`, `approval.sla.update`, `authority.owner_routing.update`, `owner_exception.snooze` |
