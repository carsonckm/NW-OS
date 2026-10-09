# Browser acceptance runs

Playwright scripts that drive the real UI against a PostgreSQL-backed dev server and check
each step in the database. They are not part of `npm test` (they need a running server, a
seeded database and a Chromium); the same 34 steps run in CI through the API in
`server/modules/e2e.test.ts`.

Prerequisites: `DATABASE_URL=… npm run db:migrate`, `npm run auth:seed-dev` (dev users,
password `dev-password-123`), `DATABASE_URL=… CORE_DATA_SOURCE=database npm run dev`, and
Playwright available (`PLAYWRIGHT_MODULE=/path/to/playwright` if it is installed globally).

- `node scripts/acceptance/run.cjs` — the 34-step project from client enquiry to closure,
  one role per step, through the UI. `node scripts/acceptance/run.cjs 20 26` reruns a range
  (ids are kept in `out/state.json`). Each step's evidence is written to `out/log.jsonl`.
- `node scripts/acceptance/phase5.cjs` — the Phase 5 18-step acceptance: a healthy project
  hits a production blocker, an overdue high-priority task and a failed site QC; the running
  server's automation (events and its own scheduler) raises tasks, notifications and
  escalations; the Owner sees the exceptions, asks the assistant why, approves one proposed
  action that the system executes; the people fix the problems and the project returns to
  On Track. Recorded in `docs/phase5-acceptance-run.txt`.
- `node scripts/acceptance/phase6.cjs` — Phase 6 Batch 2: a PM with a delegated drawing rule
  approves on a Normal project, is refused on Sensitive and Strategic (the Owner approves), and
  approves again once the Owner lowers the sensitivity; purchases, invoices and every audit
  record go through the authority resolver. Recorded in `docs/phase6-acceptance-run.txt`.
- `node scripts/acceptance/phase6-ui.cjs` — Phase 6 Batch 2 review: the approval screens show
  what the server's authority resolver decides (delegated PM sees Approve on Normal, "Owner
  approval required" on Sensitive / Strategic, nothing with the baseline permission only,
  OUT_OF_SCOPE for another project's authority; Client and Major Purchase hardening; Issue PO),
  each checked against the API and the database. Recorded in `docs/phase6-ui-acceptance-run.txt`.
- `node scripts/acceptance/phase6-routing.cjs` — Phase 6 Batch 3: the Owner creates delegated
  authority on the settings screen (server preview first), approvals are routed by the server to
  the delegated PM and shown in their inbox, Sensitive / Strategic / expiry / deactivation route
  them to the Owner, and no pending approval is left without a route. Recorded in
  `docs/phase6-routing-acceptance-run.txt`.
- `node scripts/acceptance/phase6-monitoring.cjs` — Phase 6 Batch 4: a Major Purchase request
  goes through reminder, overdue (inbox and Owner Exceptions), escalation to the Owner and the
  Owner's approval from the exception card; an expired delegation is re-routed by the approval
  monitor; a safety-critical request is a critical exception that cannot be snoozed; Owner-only
  checks; SLA / Owner routing settings; the no-orphan invariant on the whole database. Time is
  simulated by moving the test approval's `requested_at` back. Recorded in
  `docs/phase6-monitoring-acceptance-run.txt`.
- `node scripts/acceptance/phase6-delegation.cjs` — Phase 6 Batch 5: the Owner takes 14
  decisions (moved back over 40 days), sees Owner Dependency on the dashboard, refreshes
  recommendations, reviews the evidence, modifies one to RM 5,000 (authority preview, confirm,
  rule created by the authority API and used by the resolver), rejects another, checks
  idempotency and Owner-only access, and switches the rule off at the end. Run it on a freshly
  seeded database (a rejection holds that opportunity back for 90 days). Recorded in
  `docs/phase6-delegation-acceptance-run.txt`.
- `node scripts/acceptance/phase6-coverage.cjs` — Phase 6 Batch 6: the coverage matrix and
  the variation coverage gap (with its Owner exception), temporary authority created and
  extended on the Delegated Authority screen (preview → confirm, re-routing through the
  resolver), unsafe temporary authority rejected, real expiry processed by the delegation watch,
  an Owner absence previewed, confirmed and ended on the screen, Owner-only access, notification
  idempotency and no approval left on ended authority. Run it on a freshly seeded database.
  Recorded in `docs/phase6-coverage-acceptance-run.txt`.
- `node scripts/acceptance/phase6-ai.cjs` — Phase 6 Batch 7: the AI Operating Assistant with the
  server on `AI_PROVIDER=mock` (deterministic, offline): daily briefing, a project question with
  evidence, project risk from the risk engine, a problem analysis with a suggested action
  (proposal → Review → AI Proposal approval → Approve & run → task created by the existing
  workflow), a refused protected action, contractor and client boundaries, a prompt-injection
  attempt, an LLM outage with the record-based fallback, the audit trail, the legacy screens' AI routes
  going through the gateway, and no provider code or key in the browser. Recorded in
  `docs/phase6-ai-acceptance-run.txt`.
- `node scripts/acceptance/phase6-trace.cjs` — Phase 6 Batch 8: "Why can this person approve
  this?" on screen for the Owner, the approver and the requester; internal roles without a part in
  the decision, the client and the contractor are refused (the same 404 as a missing record); the
  requester gets one rejection notice and a replay adds none; the explanation stays as recorded
  after the rule is edited, switched off, or a temporary authority expires. Recorded in
  `docs/phase6-trace-acceptance-run.txt`.
- `node scripts/acceptance/phase6-owner-center.cjs` — Phase 6 Batch 9: the Owner Center follows
  the current routing (a variation routed to a delegated PM and a Major Purchase routed to the
  Accountant are not in "Requires my decision"; the Owner's own decisions are, with the reason),
  High-risk decisions and Recently delegated (pending → decided → the delegation revoked); the
  exception lifecycle on screen (acknowledge, waiting with a reason, dismiss with a reason, the
  closed list, history), critical exceptions never dismissed or snoozed (also through the API),
  stale after 14 days and the state filter, Owner-only actions, and the screen at 1700 and 1280 px.
  Recorded in `docs/phase6-owner-center-acceptance-run.txt`.
- `node scripts/acceptance/roles.cjs` — signs in as each of the 10 roles and opens every tab,
  reporting page errors and failed API calls.

`PGDATABASE` selects the database the checks read (default `nwos_dev`). The last full run is
recorded in `docs/phase4-acceptance-run.txt`.
