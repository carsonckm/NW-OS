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
| Drawing project integrity | Reject approved drawing revisions belonging to a different project, for every role | Merged in PR #39; 937 tests pass with both database roles; Render dep-dbl0iuss728c7399kicg live at da52fde |
| Acceptance and deployment | Complete CI, isolated core-chain/workflow/role coverage, production read-only health and deployed-commit verification | PR #40 merged after 943 tests passed with both database roles; read-only browser acceptance and Render verified |

## Recovery

No production repairs are authorized in this session. The earlier two-record repair has a separate approval history and must not be repeated automatically. Do not repeat the November 1 live synthetic creation tests merely to recover context. Check current main/open PRs before resuming to avoid duplicating merged changes.

## Remaining integration limits

CNC is a manual job/reference register. Machine telemetry, program byte upload/verification and machine dispatch require a separately specified machine/provider integration; newly created references cannot be approved. Real WhatsApp and AI provider tests require configured providers; production currently reports no AI and no scheduler. Browser acceptance with existing signed-in roles remains separate from CI's disposable-database role tests. No production data repair has been attempted.

## Security audit follow-up

The refreshed dependency audit reduced the findings from 17 (including one high and two critical) to 10 (two low, eight moderate, zero high/critical). Remaining findings are in the Workbox/PWA build toolchain; the audit recommends a plugin downgrade, whose compatibility has not been established. They remain open rather than being suppressed. CI now rejects high/critical audit findings. Vitest was updated to 5.1 and compatible Vite/dependency patches were refreshed; the existing test and build pipeline must pass before merge.

Malformed percent-encoded session cookies now produce unauthenticated requests instead of escaping the Express 4 async middleware. Cookie regressions exercise the actual HTTP middleware. Remembered project selection now waits for the server snapshot before applying access-based fallback; a delayed-snapshot regression protects that behavior.

The user completed secure sign-in. Authenticated read-only acceptance verified the stored synthetic revision B PDF, empty client document register, correct 87-day Malaysian-calendar project countdown, stored milestones, explicit disconnected CNC telemetry, server-only automation and unconfigured WhatsApp provider. No records were created, edited, approved or deleted. Provider send/run actions were not invoked.

## Production drawing project boundary

Approval/current status alone did not bind both drawings to the production order's project. The final revision check now resolves their owning drawing records and refuses cross-project pairs. Regression coverage includes both mismatched halves, a valid pair, and Owner/Production Manager API rejection with no persisted order or changed item link. No legacy production records are rewritten.

## Revision impact actions

Removed the remaining hardcoded plinth-trim directive, fake variation/clarification success buttons and invented revision impact deltas. A live revision comparison now returns a preview without rewriting work items or clearing alerts; live AI errors surface as errors instead of falling back to sample cabinet dimensions. Tests verify failed live analysis/comparison does not invent data and successful comparison leaves work items/drawings and sync requests unchanged.

## Live staff directory and deployment updates

Authenticated browser acceptance exposed two remaining problems: a signed-in tab stayed on an older asset bundle until reload, and project headers resolved stored staff IDs against cached demo users. The follow-up replaces authenticated directory data with active identities from the existing permission-checked `/api/users` endpoint, fails closed to the session identity if unavailable, and clears this cache on sign-out. Missing historical staff IDs display “Staff record unavailable”; no assignment is rewritten. Action queues no longer invent named approvers or same-day deadlines.

A replacement service worker now offers an explicit reload notice, disabled during core synchronization, without automatically discarding open forms. Six targeted regressions pass, along with type checking. Full normal/restricted PostgreSQL CI passed (943 tests each), followed by main CI and Render deployment verification at 0dc9e8f.

Historical recovery checkpoint: PRs #36–40 merged and deployed at 0dc9e8f; all PR/main CI checks passed. Do not repeat prior synthetic creation tests. Remaining external acceptance includes physical CNC integration, configured AI/WhatsApp, real multi-role browser sessions, mobile/offline conflict and load testing; these are not certified by the disposable-database suite.

## 4 November dependency continuation

Latest main at resumption: 1f6a46c27f832a6d5e724719d7eb1b6577a5e0de. PRs #41–45 and #47 are already merged: dependency maintenance, current CI actions/esbuild/motion and complete audit artifacts. Do not recreate these updates.

PR #46 upgrades Express 4 to 5 with matching types. Its CI failed on scalar route parameters widened to string-or-array. Read-only migration review also found unnamed wildcards that would throw during router registration and production startup. Named single-segment handlers now declare their parameter shape; wildcard guard routes and the production SPA fallback use named Express 5 syntax. Unknown API URLs return JSON 404 rather than an HTML app shell. Eleven HTTP regressions exercise production root/deep links/assets, API fallback boundaries, unconfigured core refusals and health. Typecheck, 17 focused routing/error/cookie tests and production build passed locally; complete normal/restricted PostgreSQL CI pending. No database schema or production record changes.

Next queue: evaluate PR #48 (icon library major upgrade) and #49 (Node type version alignment), then controlled local/mobile/offline acceptance and remaining build-chain advisories. Real staff/account/delegation choices, provider credentials, physical CNC and actual device/load acceptance retain their recorded gates.
