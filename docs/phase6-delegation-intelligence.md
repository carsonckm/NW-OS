# Phase 6 — Owner independence and delegation intelligence (Batch 5)

Batches 1–4 let the Owner delegate approvals and keep them moving. Batch 5 measures how much
still depends on the Owner and points out where delegation could safely grow — **without ever
granting authority by itself**.

## Authority, observation, recommendation, decision

| | What it is | Where it lives | Who reads it for authority |
|---|---|---|---|
| **Authority** | What the Owner explicitly allowed | `delegated_authorities` | the authority resolver |
| **Observation** | What NW OS saw decided | completed `approval_routes` (the decision ledger) | nobody |
| **Recommendation** | What could perhaps be delegated | `delegation_recommendations` | nobody |
| **Decision** | What the Owner chose | the Owner's accept / modify / reject / snooze, audited | — |

```text
Observation ─► Recommendation ─► Owner reviews ─► Owner previews the rule ─► Owner confirms
                                                                                   │
            Audit ◄─ Routing re-evaluated ◄─ Authority rule created (createRule) ◄─┘
```

The resolver never reads `delegation_recommendations`. A recommendation becomes authority only
through the same `createRule` the Authority Settings screen uses (validation, sensitivity
ceiling, baseline permission, self-approval rules, audit `authority.rule.create`, re-routing).

Code: `server/modules/delegationIntelligence.ts`, API `server/modules/delegationRoutes.ts`,
screen `src/components/OwnerDependency.tsx` (Owner Dashboard), migration
`db/migrations/021_phase6_delegation_recommendations.sql`.

## The decision ledger

A decision is the final, completed route of an approval (`approval_routes.status = 'completed'`,
result approved / rejected / changes requested). Client consents and withdrawn requests are not
decisions. Each carries: decision type, request type, project (and its sensitivity then and
now), value, why it was routed where it was (`routing_basis`, `owner_reason_code`), who decided
it and their role, when it was requested and decided, and whether it was escalated or
re-routed. An **Owner decision** was taken by an Owner; a **delegated decision** by anyone else
on the staff. Routing started in Batch 3: earlier decisions are not in the ledger.

## Owner dependency metrics

`GET /api/owner/dependency/analytics?days=90` (Owner only), shown on **Owner Dashboard → Owner
Dependency**:

- Totals: decisions, Owner decisions, delegated decisions, % delegated, Owner-required (routed to
  the Owner because no delegation applied), escalated, re-routed, no eligible delegate, average
  decision time, average Owner decision time, approvals waiting for the Owner now.
- Per decision type: total, Owner, delegated, % delegated, average and median hours (request to
  decision), escalation rate, Owner decisions with no eligible delegate.
- Owner decisions by project (top 10), by value band, and by reason.
- **Reasons** (structured, from the routing reason; never inferred): Strategic project,
  Sensitive project, value exceeds delegation, risk exceeds delegation, no eligible delegate,
  policy requires the Owner, safety, self-approval restriction, delegation expired / switched
  off, Owner preference (the Owner took it), exception (escalated, closed project), Owner decided
  an item a delegate could decide. A "client-specific requirement" is not recorded anywhere
  today, so it is not shown.
- **Trend**: the last 6 calendar months — Owner decisions, delegated decisions, % delegated,
  average Owner decision hours.
- **Repeated Owner decisions**: the same kind of decision (and request type) taken by the Owner
  5+ times in 45 days, overall and per project.
- **Owner Dependency %** = routine decisions the Owner took ÷ all routine decisions taken
  (Owner + delegates) in the period. *Routine* = on a Normal project, not safety-related, not a
  closed-project review. The definition is shown on the screen.
- **Time saved (estimate)** = decisions taken by delegates × 20 minutes (configurable
  `owner_minutes_per_decision`). The formula is shown; no financial value is claimed.

## Recommendation algorithm

`generateDelegationRecommendations()` runs as the `delegation_recommendations` automation rule
once a day (the Phase 5 engine; no second scheduler), and when the Owner presses "Refresh
recommendations". It runs in one transaction under an advisory lock (one generator at a time,
one connection), reads only the window (default 60 days, indexed by `completed_at`), and is
deterministic.

1. **Evidence** — Owner decisions in the window that went to the Owner *because no delegation
   covered them*: `routing_basis = OWNER_FALLBACK` and `owner_reason_code` one of
   NO_MATCHING_AUTHORITY, VALUE_LIMIT_EXCEEDED, RISK_LIMIT_EXCEEDED, OWNER_REQUIRED,
   AUTHORITY_EXPIRED, AUTHORITY_DEACTIVATED, CONDITION_NOT_MET. Decisions that reached the Owner
   for sensitivity, self-approval, escalation, a closed project or the Owner's own choice are
   never evidence. AI proposals are excluded (decided by the person they are put to).
2. **Grouping** — by decision type; approval requests also by request type (the rule can be
   limited with the `approval_types` condition, so a safety request type is never swept in).
3. **Hard exclusions** (never evidence, whatever their number): a project that is or was
   Sensitive / Strategic; safety-related requests; projects whose risk *as the resolver
   computes it now* is At Risk or Critical.
4. **Not recommended** (each with its reason, shown under "Not recommended, and why"):
   - only safety-related decisions;
   - unstable projects: more than 30% of the decisions on At Risk / Critical projects;
   - **not enough evidence**: fewer than 5 comparable decisions, or fewer than 2 different days;
   - **repeated rejection**: 2+ rejected / sent back and at least 20%;
   - **recurring escalation**: 2+ escalated and at least 25%;
   - an amount type where some amounts are unknown to the server;
   - **no eligible delegate**: no preferred role holds the decision type's baseline permission
     with an active user who can see the projects;
   - already delegated: an active Owner rule for that role covers it.
5. **Delegate** — the first role, in a fixed preference order, that holds the baseline
   permission and has active users who can see the work: drawings → Project Manager, Production
   Manager; variations → Project Manager; purchases → Purchasing, Accountant, Project Manager;
   invoices → Accountant; other approval requests → Project Manager, Production Manager.
6. **Value limit** — the 90th percentile of the approved amounts, rounded *up* to RM 500 (under
   10,000), RM 1,000 (under 100,000) or RM 5,000, and never above RM 50,000 (`max_value_cap`).
   Example: RM 1,000–8,000 → RM 8,000.
7. **Risk limit** — Attention (decisions on At Risk / Critical projects were excluded).
8. **Scope** — the one project if all evidence is on it; else the one client; else all
   projects. Sensitive and Strategic projects stay with the Owner in every case (the resolver's
   sensitivity ceiling).

All thresholds are in `RECOMMENDATION_DEFAULTS` and can be changed in the rule's configuration
(Automation).

## Confidence

| Confidence | When |
|---|---|
| High | 15+ comparable decisions on 5+ different days, none rejected, none escalated |
| Medium | 8+ decisions on 3+ days, at most one rejected and at most one escalated |
| Low | the minimum evidence (5 decisions on 2+ days) but not Medium |

Each recommendation carries the sentence that explains its level (and what lowered it).

## Evidence model

Relational: decision type, request type, target role, project, client, suggested min / max value,
suggested max risk, evidence start / end, number of decisions, approved, rejected, escalated,
different days, typical (median) and maximum amount, eligible users, confidence. `data` holds
only explanations: the reasons, the confidence explanation, excluded counts, the required
permission and the last 30 decisions it was built from (resource, project, amount, result, date).
Evidence is recomputed by the server; no API accepts it from the browser.

## Lifecycle

`generated` → `viewed` (the Owner opened the list) → `accepted` / `modified` (with the resulting
`authority_rule_id`) / `rejected` (reason) / `snoozed` (1–90 days, reason; back to generated when
it ends) → or, without review, `superseded` (a materially different suggestion — role, limit or
confidence — replaces it) / `expired` (the opportunity no longer qualifies). One active
recommendation per opportunity (unique index). A rejected opportunity is not suggested again for
90 days. Nothing is deleted.

## Acceptance workflow

1. **Accept…** or **Modify…** (role, one user, value limit, risk limit, project, client, start,
   end): `POST /api/delegation/recommendations/:id/preview` builds the Owner rule on the server
   from the stored recommendation (effect allow, priority 200, the request type as an
   `approval_types` condition, ending in 180 days unless changed) and returns the existing
   authority preview (summary, users and pending approvals affected, warnings such as
   "overridden by sensitivity" or "broadens System Policy") plus a confirmation code. Nothing is
   written.
2. **Confirm**: `POST …/accept` with the same modifications and the confirmation. The server
   rebuilds the rule; it must match what was previewed. Then `createRule` (the authority API)
   validates and creates it; routing is re-evaluated; the recommendation becomes `accepted`
   (or `modified` if the Owner changed it) with the rule id; audited
   `delegation.recommendation.accept` / `.modify` plus `authority.rule.create`.
3. Modifications go through the authority validator: a Sensitive / Strategic project, a role
   without the baseline permission, a client or contractor user, an unknown field — refused.

## Safety restrictions

Recommendations never approve anything, never create or change authority without the Owner's
confirmation, never bypass the resolver, the sensitivity ceiling, baseline permissions or the
audit, and never change project values, drawings, technical decisions or purchase limits. Only
the Owner sees them (`Owner / CEO`; not Admin). There is no temporary delegation, absence mode or
automatic sensitivity change.

## Notifications

At most one per ISO week to the Owners, through the existing notification engine
(`delegation_recommendations:week:<YYYY-Www>`): "N delegation opportunities identified", only
when there are open recommendations and at least one is new that week.

## Audit

`delegation.recommendations.generate` (each run: counts and what was not recommended and why),
`delegation.recommendation.accept / modify / reject / snooze`, and the authority audit
(`authority.rule.create`, routing re-evaluation) for every accepted recommendation.
