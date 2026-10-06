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

Batch 1 only stores these rules. Nothing reads them yet, so approval behaviour is unchanged; the
resolver (Batch 2) and routing (Batch 4) start using them.

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
