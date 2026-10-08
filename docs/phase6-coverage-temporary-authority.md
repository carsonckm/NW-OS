# Phase 6 Batch 6 — Delegation coverage, temporary authority and Owner absence

Batch 6 answers four Owner questions:

1. Is every kind of routine decision covered by someone other than me?
2. Can I hand over a decision for a limited time, safely?
3. What happens to approvals while I am away, and when I come back?
4. Is my delegation actually reducing my workload?

**Temporary authority is still subject to the same Authority Resolver and sensitivity ceilings
as permanent authority.** Batch 6 adds no second authority system. Temporary and absence
authority are ordinary Owner allow rules in `delegated_authorities`, marked with
`authority_type` and always given an end time. The resolver, the sensitivity ceiling, the
baseline-permission check, the self-approval check and routing are the ones from Batches 1–4,
unchanged.

Code: `server/modules/delegationCoverage.ts` (coverage, temporary authority, absence,
effectiveness, the delegation watch). Routes: `server/modules/authorityRoutes.ts`. Screen:
Delegated Authority → **Coverage**, **Temporary**, **Absence**
(`src/components/authority/CoverageAbsencePanels.tsx`). Migration
`022_phase6_coverage_temporary_absence.sql`. Tests: `server/modules/delegationCoverage.test.ts`
and the browser run `scripts/acceptance/phase6-coverage.cjs`.

## Data model

| Change | Purpose |
| --- | --- |
| `delegated_authorities.authority_type` | `permanent` (default), `temporary` or `absence`. A CHECK makes temporary and absence rules Owner `allow` rules with a start and an end. |
| `delegated_authorities.extended_from` | An extension is a new rule pointing at the one it replaces. The old rule is switched off with "Replaced by its extension". |
| `delegated_authorities.expiry_processed_at` | Set once the server has processed the end of a rule (audited, approvals re-routed). The rule is processed once. |
| `delegated_authorities.absence_id` | The absence that created the rule. A CHECK ties `authority_type = 'absence'` to this column. |
| `owner_absences` | The Owner's absence: backup, period, decision types, value and risk limits, scope, reason, and status (`scheduled → active → ended`, or `cancelled`). It grants nothing by itself. |
| `delegation_coverage_state` | The last known status of each coverage cell, so a change (for example to Uncovered) is noticed and notified once. |

Temporary and absence rules cannot be edited or reactivated (`updateRule` and `setRuleActive`
refuse them). The Owner extends them (a new rule, previewed) or ends them.

## Coverage

`GET /api/authority/coverage` → `{ cells, health, gaps, conflicts }`. The matrix is computed
from the rules in force now. Nothing about it is hard-coded for display.

For each decision type and sensitivity (Normal, Sensitive, Strategic), the value axis is split
into bands at the limits of the in-force rules (limits within one cent are merged). For each
band:

* **Owner requirements** are in-force `require_owner` rules (System and Owner) whose only
  conditions reserve the decision (`unless_prior_approval`). Conditions that only apply to some
  approvals (status, direct-only, no self-approval) do not reserve a band.
* **Covering rules** are in-force allow rules for the band that rank above the strongest
  Owner requirement. System rules that target a permission are skipped when no active non-Owner
  user holds that permission (`SYS-VARIATION` only names the Owner, so it covers nothing).
* **Eligible approvers** are active internal users who match the rule target and hold the
  decision type's baseline permission (variation → `variations.review`, drawing →
  `drawings.review`, purchase → `purchasing.view`, invoice → `finance.view`, other approvals →
  `approvals.view`).

| Status | Meaning |
| --- | --- |
| Covered | A rule with no project, client or risk limit covers the band, and an eligible approver exists. |
| Expiring Soon | Covered, but every covering rule ends within 7 days. |
| Partially Covered | Only rules limited to a project, a client, a risk level or a condition cover it. The reasons say which. |
| Owner Only | An Owner requirement (System or Owner rule) keeps the band with the Owner on purpose. |
| Uncovered | No rule lets anyone but the Owner decide it. |
| No Active Approver | Rules exist, but nobody they name is active. |
| Blocked by Permission | Rules exist, but no one they name holds the baseline permission. |
| Blocked by Sensitivity | Sensitive and Strategic projects: the ceiling keeps the decision with the Owner. |

Each cell also gives the number of open approvals of that kind waiting for the Owner.

### Coverage health

Coverage health is not a score, and there is no single misleading percentage. The screen shows
the count of cells in each status. "Overall" is defined on the screen as follows:

> Overall = coverage cells with a full, current non-Owner approver (Covered or Expiring Soon) ÷
> cells that can be delegated (all cells except Owner Only and Blocked by Sensitivity).

Bands the Owner keeps on purpose are not counted against the Owner.

### Gaps

Uncovered, No Active Approver and Blocked by Permission cells are **gaps**. Each gap gives:

* the decision type, scope and value band;
* the reason;
* the pending approvals affected;
* a recommended action, for example "Create a delegation for this decision type and value (or
  accept a delegation recommendation), or keep it with the Owner on purpose" or "Give an
  eligible user the baseline permission".

A gap is a suggestion only. Nothing creates authority automatically.

### Conflicts (overlapping rules)

`conflicts` lists in-force Owner allow rules for the same target that overlap. The response
says "the highest priority rule applies" and names the rule the resolver selects.

## Temporary authority

| Endpoint | |
| --- | --- |
| `GET /api/authority/temporary` | Active, scheduled, expiring soon (7 days) and ended temporary and absence rules. |
| `POST /api/authority/temporary/preview` | `{ decision_type, target_user_id \| target_role, project_id?, client_id?, min_value?, max_value, max_risk?, start_at?, end_at, reason }` → preview and confirmation. |
| `POST /api/authority/temporary` | The same body plus `confirmation` → 201, the rule. |
| `POST /api/authority/temporary/:id/extend/preview` | `{ end_at, reason }` |
| `POST /api/authority/temporary/:id/extend` | `{ end_at, reason, confirmation }` → 201, the new rule. |
| `POST /api/authority/temporary/:id/end` | `{ reason }`: ends it now. |

All of these are **Owner only**: the role must be Owner / CEO and hold `authority.manage`. The
preview → confirm flow is the Batch 5 one. The confirmation is a hash of exactly what was
previewed (a start of "now" is hashed as `now`), so a changed body is refused. The rule is
created by `insertOwnerRule`, the same insert, validation, audit and re-routing used for every
Owner rule.

The rule must pass every check a permanent rule passes (`validateOwnerRule`), plus these:

* **A reason and an end are required.** The start is now or later. The end is after the start.
  The longest allowed period is 90 days.
* **Internal users only.** The target cannot be the Owner, Client or Contractor, and cannot be an
  inactive user.
* **Baseline permission.** The target must hold the baseline permission for the decision type.
* **Sensitivity.** The rule cannot cover Sensitive or Strategic projects. The ceiling applies to
  it as to any rule.
* **No more than permanent authority.** Value decisions need a `max_value`. A temporary rule
  cannot overlap a non-sensitivity System `require_owner` rule that ranks above it. For example,
  purchases of RM 20,000 or more stay reserved by `SYS-PURCHASE-MAJOR` ("Exceeds permanent
  authority: …").
* **Priority 150.** Temporary rules sit above ordinary Owner rules, so the cover applies, and
  below System Owner requirements (100, 200), so they cannot outrank one. System locked rules
  (900/1000) are untouched.
* **No self-approval.** The resolver's self-approval check applies to temporary rules as to any
  rule.

An **extension** is a new rule with `extended_from`. It goes through the same validation and
preview, with a new end and a new reason. The old rule is switched off. Both are audited
(`authority.temporary.extend`).

## Expiry

Time is the database server's time (`now()`), stored as `timestamptz`, so the result does not
depend on time zones. **At the exact end time a rule is expired.** At its exact start time it is
in force.

* **The resolver** refuses an ended rule at once (`AUTHORITY_EXPIRED`), even before the
  background job has run. Expired authority cannot approve.
* **The delegation watch** is the automation rule `delegation_watch`, which runs every 5
  minutes. It switches off every rule whose end has passed (`deactivation_reason = 'Expired'`,
  `expiry_processed_at`), audits `authority.temporary.expire` (or `authority.rule.expire` for a
  permanent rule with an end date), and calls `reevaluateRoutes`. Pending approvals that the
  rule covered are routed again: to another eligible delegate, or back to the Owner.
* **Reminders** go to the Owner 7, 3 and 1 days before the end. They use the notification key
  `delegation_watch:expiry:<rule>:<end>:<days>`, so each reminder is sent once. An extension has
  a new end and so gets new reminders.

No approval stays routed to ended authority. The acceptance run checks for none ("no orphan").

## Owner absence

| Endpoint | |
| --- | --- |
| `GET /api/authority/absence` | Absences with their rules. |
| `POST /api/authority/absence/preview` | `{ start_at?, end_at, backup_user_id, decision_types, max_value?, max_risk?, project_id?, client_id?, reason }` |
| `POST /api/authority/absence` | The same body plus `confirmation`. |
| `POST /api/authority/absence/:id/end` | `{ reason }`: ends an active absence, or cancels a scheduled one. |

An absence does not make the backup another Owner. When it is confirmed, it creates one
temporary rule per chosen decision type (`authority_type = 'absence'`, priority 150, the
absence's period, value limit, risk limit and scope). Each rule goes through exactly the
validation above. As a result:

* **Eligibility.** The backup must be an active internal user, not the Owner, and must hold the
  baseline permission for each type.
* **Limits.** The backup decides only within the value limit, risk limit and scope. Anything
  above goes to the Owner.
* **What stays with the Owner.** Sensitive and Strategic projects, System locked and safety
  decisions, and System Owner requirements (for example major purchases) stay with the Owner.
  The preview lists them under "Not delegated".
* **No self-approval.** The backup cannot approve what they raised.
* **Overlaps.** An absence that overlaps another scheduled or active absence is refused.
* **Length.** At most 60 days.

**The preview** shows the period, the backup, what is delegated (each rule's summary) and what
is not. It also shows an **estimated** impact: routine Owner decisions in the last 60 days that
the absence would have covered, and of the approvals waiting for the Owner now, how many would
go to the backup and how many stay with the Owner. Nothing changes until the Owner confirms.

**Lifecycle** (handled by the delegation watch and the end endpoint):

* **Activation.** The absence and its rules are written under an advisory lock and audited
  (`owner_absence.activate`). Approvals are re-evaluated and re-routed. When the absence starts
  now, the Owner is notified.
* **Scheduled start.** A future absence becomes `active` when its start passes. The rules carry
  the same start, so the resolver ignores them until then.
* **End.** At the end time, or when the Owner ends it early, the rules are switched off, the
  absence becomes `ended`, everything is audited (`owner_absence.end` / `owner_absence.cancel`
  plus each rule), approvals are re-routed back, and the Owner is notified. Nothing stays active
  past the end. The resolver already refuses at the exact end.

**Who can act.** Only the Owner can create, preview or end an absence. The backup cannot
modify, extend or activate one (403).

## Conflict handling

| Case | Result |
| --- | --- |
| Overlapping rules | Allowed. The coverage view and the preview show "highest priority rule applies" and name it. |
| Temporary rule exceeding permanent authority (a System Owner requirement) | Rejected (400, "Exceeds permanent authority"). |
| Sensitive or Strategic project | Rejected by the sensitivity ceiling (400). |
| Target without the baseline permission | Rejected (400). |
| Inactive target or backup | Rejected (400). |
| Client or Contractor target | Rejected (400). |

## Delegation effectiveness

`GET /api/authority/effectiveness` reports, for each Owner allow rule (permanent, temporary or
absence) over the last 90 days:

* the number of approvals in the rule's scope;
* delegated (decided under the rule), Owner fallback, escalated, re-routed, rejected, and fallen
  back after the rule expired;
* the delegated percentage and the average turnaround in hours;
* why approvals came back to the Owner, grouped by reason: value limit, risk limit, scope,
  sensitivity, self-approval, expired or inactive, no eligible approver, or other.

When a rule has at least 5 decisions and at least 30% fell back to the Owner, it carries a
finding, such as "This delegation covers only part of the observed workload". The finding also
appears as a `DELEGATION_INEFFECTIVE` Owner exception and as a weekly notification. The figures
describe the rule's scope, **not the performance of any person**. There is no employee scoring.

## Owner dependency impact

The Owner Dependency view (Batch 5) gains an `impact` block, labelled **Estimated**. It shows:

* the current Owner dependency;
* the routine coverage the rules in force now would have given the last period's Owner
  decisions;
* how many of those decisions the current rules would now cover;
* the largest remaining dependencies and why.

It is an estimate from history, not a forecast.

## Recommendations (Batch 5) with Batch 6

* A decision type counts as already delegated only when a **permanent** rule covers it.
  Temporary or absence cover does not stop a recommendation. The recommendation says "Currently
  covered only by temporary authority DA-… until …", and `coverage_now` shows `Owner only` or
  `temporary (…)`.
* Accepting a recommendation still goes through the authority preview → confirm flow. A
  recommendation never becomes authority by itself.

## Notifications and Owner exceptions

All notifications go to the Owner, through the existing notification table with the delegation
watch's idempotency keys. Running the watch again sends nothing new.

| Event | Notification key |
| --- | --- |
| A coverage cell becomes Uncovered, No Active Approver or Blocked by Permission | `delegation_watch:coverage:<cell>:<status>:<changed_at>`, once per change |
| Temporary or absence authority ends in 7, 3 or 1 days | `delegation_watch:expiry:…` |
| An absence starts or ends | `delegation_watch:absence:…` |
| A delegation is ineffective | at most weekly |

Meaningful coverage changes are audited as `delegation.coverage.change`. A cell that has not
changed is not audited again.

Owner Exception Center → Delegation:

| Exception | When |
| --- | --- |
| `COVERAGE_GAP` | Urgent when approvals are waiting, attention otherwise. Partial cover is shown only when approvals fall outside it. |
| `BACKUP_UNAVAILABLE` | Critical: the backup of a scheduled or active absence has been deactivated. |
| `DELEGATION_INEFFECTIVE` | Attention. |
| `TEMPORARY_EXPIRED` | Informational: temporary or absence authority expired in the last 24 hours. |

Each links to Delegated Authority.

## Audit

The following are audited:

* temporary authority: `authority.rule.create` + `authority.temporary.create`,
  `authority.temporary.extend`, `authority.temporary.expire`, and `authority.rule.deactivate`
  for an early end;
* absence: `owner_absence.activate`, `owner_absence.end`, `owner_absence.cancel`;
* meaningful coverage changes: `delegation.coverage.change`;
* routing changes: the existing route audit (re-routing, fallback, Owner override).

## Security model

* **The server derives everything.** The acting Owner comes from the session. Target user,
  role, project, client, value, risk, period and reason are validated on the server, and the
  confirmation must match the previewed body. A forged field either fails validation (400) or
  fails the confirmation (400). Fields the server sets (`created_by`, `kind`, `effect`,
  `priority`, `authority_type`) are never taken from the request.
* **Only the Owner** can create, extend or end temporary authority and absences. Admin, Project
  Manager, Accountant, Purchasing, Contractor and Client receive 403.
* **Coverage and effectiveness** can be read by holders of `authority.view`. Coverage is not
  permission: approving is decided by the resolver on each request.
* **The browser decides nothing.** The screens show what the server returns.

## Non-goals

Batch 6 does not include:

* automatic approval, automatic delegation, or AI / LLM authority;
* employee scoring;
* an HR leave system or payroll;
* a client inbox, WhatsApp or a mobile redesign;
* BI or forecasting.

## Known limitations

* Coverage bands are computed per decision type, sensitivity and value. Project- and
  client-scoped rules make a band Partially Covered, not Covered. The matrix does not list a row
  per project.
* Expiry reminders and the expiry processing run with the delegation watch (every 5 minutes).
  Between an end and the next run, the resolver already refuses the rule, but the approval is
  re-routed only at that next run, or immediately with "Route again" on the Authority screen.
* The "Estimated" impact figures are computed from the last 60–90 days of history and assume
  the workload stays similar.
