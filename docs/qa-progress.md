# NW OS QA remediation progress

Updated 3 November 2026. Baseline: bfe3806 (PR #35).

## Scope

Implement and regression-test the saved QA backlog, merge only after complete CI passes, then verify the deployed commit and read-only health. Existing production business records, data deletion and sensitive production settings are excluded. All automated write tests use disposable test databases or browser mocks. A merged fix does not certify untested live workflows.

## Reconciled work

- PR #23: atomic production/delivery saves, dependency retries, validation and truthful commit feedback.
- PR #24: server site-QC checklist consistency and signed handover locking.
- PR #25: duplicate goods receipt lines.
- PR #26: cumulative supplier invoice matching.
- PRs #27–30: partial receipts, claim settlement validation, stable claim allocation and reconciled-payment immutability.
- PRs #31–35: direct and inferred delivery production links require the latest passed factory QC; dispatch-stage regressions.
- Baseline Render deployment dep-dbl001u7bikc739hthsg is live at bfe3806. GET /api/health reports database ok, scheduler off and AI unconfigured.

## Planned remaining batches

| Batch | Scope | State |
|---|---|---|
| Integrity follow-up | Completion QC gate, serial aggregate invoice validation, shared task assignment scope, settlement amount/evidence guards | Merged in PR #36; complete CI passed; Render dep-dbl06ijbc2fs738f1au0 live at 490a0d9 |
| Truthful operational UI | Uploaded document viewer, real client documents, real milestones/dates, neutral form defaults, exact revision navigation, scoped dashboards, honest CNC/automation display; enquiry becomes Quoted only on submission | Implemented; regression/CI validation in progress |
| Security/dependency review | Current dependency advisories, private API/service-worker handling and remaining trust boundaries | Pending |
| Acceptance and deployment | Complete CI, isolated core-chain/workflow/role coverage, production read-only health and deployed-commit verification | Pending |

## Recovery

No production repairs are authorized in this session. The earlier two-record repair has a separate approval history and must not be repeated automatically. Do not repeat the November 1 live synthetic creation tests merely to recover context. Check current main/open PRs before resuming to avoid duplicating merged changes.

## Remaining integration limits

CNC is a manual job/reference register. Machine telemetry, program byte upload/verification and machine dispatch require a separately specified machine/provider integration; newly created references cannot be approved. Real WhatsApp and AI provider tests require configured providers; production currently reports no AI and no scheduler. Browser acceptance with existing signed-in roles remains separate from CI's disposable-database role tests. No production data repair has been attempted.
