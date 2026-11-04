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

PR #46 upgrades Express 4 to 5 with matching types. Its CI failed on scalar route parameters widened to string-or-array. Read-only migration review also found unnamed wildcards that would throw during router registration and production startup. Named single-segment handlers now declare their parameter shape; wildcard guard routes and the production SPA fallback use named Express 5 syntax. Unknown API URLs return JSON 404 rather than an HTML app shell. Twelve HTTP regressions exercise production root/deep links/assets, API fallback boundaries, unconfigured core refusals and health. Typecheck, 17 focused routing/error/cookie tests and production build passed locally; complete normal/restricted PostgreSQL CI pending. No database schema or production record changes.

Next queue: evaluate PR #48 (icon library major upgrade) and #49 (Node type version alignment), then controlled local/mobile/offline acceptance and remaining build-chain advisories. Real staff/account/delegation choices, provider credentials, physical CNC and actual device/load acceptance retain their recorded gates.

The first database CI run found a further Express 4 inline-regexp path for exception lifecycle actions; no merge occurred. It is replaced with five explicit allowlisted routes. A new local regression mounts every authenticated router without a database connection, so router registration failures are caught even when PostgreSQL tests are unavailable. The twelve routing tests and type checking pass; full CI is rerunning.

## Dependency queue checkpoint after PR #46

PR #46 merged at c7e7ee6e25291f1413907e53d8b2da1eb8176928 after complete CI: 955/955 tests across 64 files in each normal/restricted PostgreSQL run, plus audit/typecheck/role bootstrap/build. Render dep-dbliogvavr4c73cu55u0 is live. Main CI passed; live root/deep links/readiness/liveness return 200, private snapshot returns 401, unknown API returns JSON 404. No error-level application logs returned in the inspected post-deployment window. The failed first CI attempt was fixed before merge; no failure was bypassed.

PR #48 merged at 29a8cf3613cc8f91f00e9831baf6932ddd5d4623 after its combined-state CI passed every step. The icon-library package/lock conflict retained both upgrades. Render verification is pending for this new commit. Dependabot now keeps @types/node major updates aligned with the Node 22 Docker/CI runtime. PR #49 was closed as deferred: Node 26 declarations would expose APIs the deployed Node 22 runtime may not implement; no runtime/production setting was changed.

A new compatible-fix audit dry-run still reports two low/eight moderate Workbox/PWA build-chain advisories, zero high/critical. The proposed forced plugin downgrade remains outside a validated compatible fix; findings are retained in the full CI audit artifact.

Next concrete QA fix: bounded authentication/API waits and truthful unconfirmed-save feedback. Local mocked-network tests cover stalled headers/body, normal cleanup, 400/401 behavior, AI processing budget, and a timed-out committed write confirmed on retry without a duplicate. No production records used.

## Stalled requests and unconfirmed save feedback

Source review and mocked network tests reproduced unbounded waits in authentication and core/module API calls. Requests now have a 60-second deadline (120 seconds for AI), including response-body parsing. The browser aborts the transport when the deadline expires; it does not retry or assert that a server-side write rolled back. Explicit commit recovery retains the same operation identity and checks the stored row before retrying. A regression simulates a timed-out committed order, then confirms it without a second write.

Successful HTTP responses with unreadable JSON now fail as unconfirmed rather than producing optimistic success. Legitimate 204, explicit 400 refusals and session-ending 401 events retain their behavior. The error banner displays the supplied outcome instead of prefixing every connection error with “Not saved.”

Local validation: 46 focused network/sync/banner regressions passed; complete suite 199 passed with 770 PostgreSQL tests skipped locally, plus typecheck/build. Full CI remains required before merge. All test data is synthetic; no production writes, account changes or provider sends.

Audit experiment: installing vite-plugin-pwa 1.1.0 in an isolated checkout retained workbox-build 7.4.1 and left nine low/moderate findings. No production downgrade was applied; the current ten findings remain documented and the high/critical CI gate remains enabled.

Recovery checkpoint: PR #46 and its main CI/deployment are verified; PR #48 is merged after complete CI; PR #49 is closed/deferred for Node runtime alignment. The next PR contains the request-deadline/save-feedback changes only, with no schema or production data changes. Merge only after its complete normal/restricted PostgreSQL CI passes.

## PR #51 verified and coordinated toolchain batch

PR #51 merged at 4207b0c349b4ff0724239f3807007dbdca6cbcaa after complete CI: 969 tests across 66 files passed in each database-role run (job 126594982391). Its tested tree already included the PR #50 artifact uploader update; the merge candidate tree matched the tested tree. PR #50 separately passed its full 955-test dual-role pipeline before merge.

Render dep-dblj1n49v7es73d7bpb0 is live at 4207b0c. Root and readiness return 200; database ok, scheduler off and AI unconfigured; unknown API returns JSON 404. Served asset index-BUnlN5hn.js contains both deadline and unconfirmed-response messages, and the deployed worker references that asset and keeps API navigations excluded.

Dependabot then queued PRs #52–56: TypeScript 7.0.2, Vite 8.3.5, dotenv 18.0.9, jsdom 30.1.3 and React plugin 6.1.2. PR #52's new strict defaults failed type checking; #56 required Vite 8. The reviewed batch combines these compatible versions, explicitly preserves the repository's existing non-strict compiler policy, adds Vite asset declarations for checked CSS imports and updates config directory access for Vite 8. Node runtime/types remain 22. A fresh npm-generated lock resolves the Babel peer graph without force/legacy-peer-deps flags.

Batch local validation: normal dependency installation, 199 tests passed / 770 database tests skipped, typecheck and production build passed; 25 focused routing/network/banner tests passed after the config updates. Current audit remains two low/eight moderate and zero high/critical. Full normal/restricted CI remains required before merge. PR #52 will contain the consolidated batch; #53–56 are superseded only after the combined batch passes and merges. No production business data, schema, accounts or sensitive settings changed.

## Final dependency inventory for the coordinated batch

The first coordinated candidate passed its full CI. A final dependency inventory also identified React plugin 6.2.1, vite-plugin-pwa 2.0.0 and @types/supertest 7.2.1. These are included in the final candidate, preserving Node types 22.20.5 for the Node 22 runtime. Fresh normal npm installation resolves the optional Babel peers; no peer/dependency protection is bypassed. Typecheck and production build pass. The generated PWA worker still references the built app and excludes private API navigations. Workbox remains 7.4.1, and the audit remains two low/eight moderate, zero high/critical. The complete database-role CI must rerun for this expanded dependency tree before merge. No production business data/settings changed.
