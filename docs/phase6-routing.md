# Phase 6 — Approval routing (Batch 3)

Authorization and routing are separate questions:

| Question | Answered by | Where |
|---|---|---|
| May this person take this decision? | the authority resolver | `server/modules/authorityResolver.ts` |
| Who should receive this decision, and why? | approval routing | `server/modules/approvalRouting.ts` |

Routing never decides who may approve. It asks the resolver, for every candidate, the same
question the approval action asks, and can only route to people the resolver allows. When the
person decides, the resolver checks again. Nothing the browser sends (assignee, rule, basis,
project, sensitivity) is used by routing.

```text
pending decision → record, project, decision type (from the database)
  → candidates: active internal users who can see the project and hold the baseline permission
    (discovery only — never a grant)
  → resolveApprovalAuthority for each candidate → only the allowed remain
  → routing precedence → one assignee
  → nobody allowed → the Owner (OWNER_FALLBACK, with the reason)
  → approval_routes row + audit (+ in-app notification to the assignee)
decision taken → the resolver checks again → the route is closed
```

## What is routed

Every pending decision on an approval path:

| Record | Pending while | Decision type |
|---|---|---|
| Approval request (incl. Major Purchase, AI proposal, technical / other requests) | decision = Pending | purchase / ai_proposal / approval_request |
| Client drawing revision | Internal Review | drawing |
| NW production drawing | not yet approved for production | drawing |
| Variation | Internal Approval | variation |
| Purchase order | Pending Approval | purchase |
| Invoice | Pending Approval | invoice |

A client-facing request (Variation / Client Scope Change) assigned to the Client role is the
client's consent: it is routed to the project's client user (`CLIENT_CONSENT`), never to staff
and never through delegated authority. An internal request assigned to the Client role is not
routed to the client.

## Routing precedence (deterministic)

Each eligible candidate is ranked by the most specific rule that grants them the decision (an
applicable allow rule that outranks every applicable Owner requirement):

1. `USER_RULE` — an Owner rule naming this user
2. `PROJECT_ROLE_RULE` — an Owner rule for the role on this project
3. `PROJECT_PERMISSION_RULE` — a project-scoped permission rule (reserved; Owner rules target users or roles)
4. `CLIENT_RULE` — an Owner rule for this client's projects
5. `GLOBAL_RULE` — an Owner rule with no project / client
6. `SYSTEM_POLICY` — System Policy, including the request's assigned approver and the Accountant's Major Purchase rule
7. `PRIOR_OWNER_APPROVAL` — issuing a PO whose Major Purchase approval the Owner gave
8. `OWNER_FALLBACK` — nobody else may

Ties: the higher rule priority, then user id. Never storage order. The route records the
eligible candidates in order, so the explanation shows why the winner won.

## Initial assignment is a preference; the Authority Policy decides

The approver a request names (`assigned_approver_role` / `assigned_approver_id`, e.g. "Owner / CEO",
the default on the request form) is a routing preference, not an Owner requirement. Routing sends
the request to whoever the Authority Policy authorizes, in the order above:

- **Major Purchase / Major Cost requests** go to the **Accountant** while System Policy
  `SYS-PURCHASE-ACCOUNTANT` authorizes them (even when the request names the Owner).
- They go to the **Owner** when the Accountant's authority does not apply: the project is
  Sensitive / Strategic; a value, risk or scope condition requires the Owner; the Accountant is
  deactivated or unavailable; the policy is deactivated (by the Owner, with a reason) or expired;
  or another explicit Owner requirement applies (e.g. an Owner `require_owner` rule of higher
  priority).
- The Owner can always decide the request directly where the business rules allow.

Only an explicit Owner requirement — the sensitivity ceiling or a `require_owner` rule — makes the
Owner's approval mandatory.

## Owner fallback and the no-orphan invariant

If no candidate is allowed, the decision goes to the Owner (chosen by the Owner routing policy —
primary Owner, then priority, then user id; Batch 4, `phase6-approval-monitoring.md`) with
`owner_reason_code` — why delegation was not available, from the resolver:
`SENSITIVITY_BLOCKED`, `OWNER_REQUIRED`, `AUTHORITY_EXPIRED`, `AUTHORITY_DEACTIVATED`,
`VALUE_LIMIT_EXCEEDED`, `RISK_LIMIT_EXCEEDED`, `NO_MATCHING_AUTHORITY`, ... (the most telling
refusal by the reason precedence, or `NO_MATCHING_AUTHORITY` when nobody holds a rule).

Invariant: every pending decision has exactly one open route (unique index) with a non-null
assignee (NOT NULL column). Routing runs in the same transaction as the write that created or
changed the decision; if not even an Owner can be found, the write fails (400) instead of
leaving an orphan. `GET /api/approval-routing/orphans` lists any exception (expected: none); the
Owner's inbox also shows anything unrouted.

## Sensitivity

Routing uses the same resolver, so the ceiling applies: on a Sensitive project the protected
decision types route to the Owner, on a Strategic project every decision does. The task goes to
the Owner directly; a delegate is never routed a decision their click would be refused for.

## Re-evaluation

Authority can change while a decision is pending. Two layers:

1. **At the decision** (always): the approval action calls the resolver again; if the person is
   no longer authorized the action is refused with the reason (`AUTHORITY_EXPIRED`, ...). The
   inbox also shows each item's current resolver answer, so a stale item says so.
2. **Re-routing** (`reevaluateRoutes`): every pending decision in scope gets the route it should
   have now; changed routes are closed as `rerouted` and a new route is opened (linked by
   `replaces_route_id`), audited as `approval.route.reroute` with the reason. It runs
   automatically, in the same transaction, when:
   - an authority rule is created, changed, deactivated or reactivated (that decision type / project);
   - a project's sensitivity changes (that project);
   - a user is deactivated, changes role or changes project assignments (all);
   - the server starts (all — also routes records imported before routing existed).

   It can be run on demand: `POST /api/approval-routing/reevaluate` (or "Re-run routing" on the
   settings screen).
3. **Scheduled** (Batch 4): the `approval_monitor` automation rule re-checks every open route's
   assignee with the resolver every 15 minutes and re-routes the ones who may no longer decide
   (for example once a rule's end date has passed), besides reminders and escalation. See
   `phase6-approval-monitoring.md`. Re-evaluation never undoes an escalation or an Owner
   assignment while its assignee may still decide.

## Data

`approval_routes` (migration 019): `resource_kind`, `resource_id`, `decision_type` (FK),
`project_id` / `client_id` (FK), `assigned_user_id` (FK, not null), `routing_basis`,
`authority_rule_id` (FK) / `authority_rule_code`, `owner_reason_code`, `project_sensitivity`,
`value`, `priority`, `status` (open / completed / rerouted / cancelled), `completion_result`
(approved / rejected / changes_requested / withdrawn), `routed_at`, `due_at`, `completed_at`,
`completed_by`, `replaces_route_id`; `data` only carries the explanation (title, link, eligible
candidates, owner reason text).

Why not the existing `tasks` table: a task can be edited, completed or reassigned by its
assignee and is visible to contractors on their packages; an approval task must only close
through a resolver-checked decision, and its assignee must only come from routing. The route is
the approval task; the assignee is told through the existing notifications (`approval-route:<id>`).

## API

All require sign-in, an active user and CSRF; none accepts an assignee, rule or basis.

| Endpoint | Who | What |
|---|---|---|
| `GET /api/approval-routing/inbox` | any signed-in user | my open routes (clients: only consents put to them; contractors: none), each with the resolver's answer for me now |
| `GET /api/approval-routing/owner` | the Owner | everything routed to the Owner, with why, value, risk, sensitivity |
| `GET /api/approval-routing/explain?kind=&id=` | the assignee, or authority.view | why it went to whom; route history and eligible candidates for authority.view |
| `GET /api/approval-routing/orphans` | authority.view | pending decisions without a route |
| `POST /api/approval-routing/reevaluate` | authority.view | `{ project_id? }` route again against current authority |
| `POST /api/approval-routing/route` | authority.view | `{ kind, id }` route one decision again |

## Screens

- **Approvals & Governance → My approval inbox** (everyone with approvals): what needs approval,
  project, decision type, value, priority, sensitivity, why it was routed to me (basis + rule),
  the resolver's current answer, open record. The Owner's inbox shows why the Owner is required.
- **Delegated Authority** (Owner; Admin read-only): see `phase6-delegated-authority.md`, section 6.
