# NW OS QA remediation progress

Updated 4 November 2026. Baseline: bfe3806 (PR #35).

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
| Truthful operational UI | Uploaded document viewer, real client documents, real milestones/dates, neutral form defaults, exact revision navigation, scoped dashboards, honest CNC/automation display; enquiry becomes Quoted only on submission | Merged in PR #37; complete normal/restricted-role CI and build passed |
| Security/dependency review | Updated vulnerable dependencies, malformed-cookie refusal, remembered workspace hydration and high/critical CI audit gate | Merged in PR #38 after complete CI passed; no high/critical audit findings |
| Drawing project integrity | Reject approved drawing revisions belonging to a different project, for every role | Implemented; CI pending |
| Acceptance and deployment | Complete CI, isolated core-chain/workflow/role coverage, production read-only health and deployed-commit verification | Pending |

## Recovery

No production repairs are authorized in this session. The earlier two-record repair has a separate approval history and must not be repeated automatically. Do not repeat the November 1 live synthetic creation tests merely to recover context. Check current main/open PRs before resuming to avoid duplicating merged changes.

## Remaining integration limits

CNC is a manual job/reference register. Machine telemetry, program byte upload/verification and machine dispatch require a separately specified machine/provider integration; newly created references cannot be approved. Real WhatsApp and AI provider tests require configured providers; production currently reports no AI and no scheduler. Browser acceptance with existing signed-in roles remains separate from CI's disposable-database role tests. No production data repair has been attempted.

## Security audit follow-up

The refreshed dependency audit reduced the findings from 17 (including one high and two critical) to 10 (two low, eight moderate, zero high/critical). Remaining findings are in the Workbox/PWA build toolchain; the audit recommends a plugin downgrade, whose compatibility has not been established. They remain open rather than being suppressed. CI now rejects high/critical audit findings. Vitest was updated to 5.1 and compatible Vite/dependency patches were refreshed; the existing test and build pipeline must pass before merge.

Malformed percent-encoded session cookies now produce unauthenticated requests instead of escaping the Express 4 async middleware. Cookie regressions exercise the actual HTTP middleware. Remembered project selection now waits for the server snapshot before applying access-based fallback; a delayed-snapshot regression protects that behavior.

Production browser smoke testing reached the sign-in screen; authenticated live verification needs the user's secure sign-in. The agent has not requested or read credentials.

## Production drawing project boundary

Approval/current status alone did not bind both drawings to the production order's project. The final revision check now resolves their owning drawing records and refuses cross-project pairs. Regression coverage includes both mismatched halves, a valid pair, and Owner/Production Manager API rejection with no persisted order or changed item link. No legacy production records are rewritten.

## Revision impact actions

Removed the remaining hardcoded plinth-trim directive, fake variation/clarification success buttons and invented revision impact deltas. A live revision comparison now returns a preview without rewriting work items or clearing alerts; live AI errors surface as errors instead of falling back to sample cabinet dimensions. Tests verify failed live analysis/comparison does not invent data and successful comparison leaves work items/drawings and sync requests unchanged.
