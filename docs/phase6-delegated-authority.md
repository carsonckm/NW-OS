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

The baseline permission alone approves nothing; only a matching authority rule does. Decision types
live in the `authority_decision_types` table, so new types are added with data, not schema changes.

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
them (explicit, validated, audited, reversible, with a reason); the Strategic rule is locked.
To change a policy the Owner creates an Owner rule with a higher priority.

Batch 1 only stores these rules. Nothing reads them yet, so approval behaviour is unchanged; the
resolver (Batch 2) and routing (Batch 4) start using them.

## 3. Project sensitivity (project level)

`projects.sensitivity`: `Normal` (default for every existing and new project), `Sensitive`,
`Strategic`. Only the Owner sets it, through `PUT /api/projects/:id/sensitivity`; the general project
APIs and the browser sync keep the stored value.

- Normal: delegation rules apply.
- Sensitive: Owner approval stays mandatory for each decision type that has an active
  `SYS-SENSITIVE-<TYPE>` System Policy row (all five initially; the Owner may narrow it by
  deactivating a row, audited and reversible).
- Strategic: Owner approval is mandatory for every approval decision (`SYS-STRATEGIC-<TYPE>` rows,
  locked; the resolver enforces it for every type, including types added later).

Enforced server-side by the resolver (Batch 2), not by the UI.
