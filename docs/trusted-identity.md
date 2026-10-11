# Trusted identity in the database (Phase 6 Batch 12B)

Before this batch, anyone holding the runtime database password (`nwos_app`) could become the
Owner. They could insert a session row for the Owner, or change any user's role, and the
application would believe it. All of NW OS's authorization rules (RBAC, project scope, the
authority resolver) lived in the application, which trusted whatever was in those tables.

Now the database itself decides who is acting. It uses evidence the runtime credential alone
cannot produce: a user's password-derived key, or a valid session token.

Migration: `db/migrations/031_phase6_trusted_identity.sql`. Server: `server/auth/store.ts`,
`server/auth/identity.ts`. Tests: `server/db/trustedIdentity.test.ts`, run as the real
restricted role.

## 1. Who is who, as the database sees it

| Caller | What it holds | What the database lets it do |
|---|---|---|
| **A signed-in Owner** | A session token, created by `auth_login` after the database verified the Owner's password-derived key | Its transactions call `auth_assume(token)`. The protected records then accept the Owner's changes. |
| **A signed-in ordinary user** | Their own session token | `auth_assume` gives them their own identity. The guards refuse every Owner-only or Admin-only change, as they would through the API. |
| **A background job** (automation engine, delegation watch, exception lifecycle, WhatsApp channel) | No session | No identity. It may only make changes the database can check itself: switch authority off, start an Owner absence whose start has passed, end one whose end has passed. In the application its context is marked background, and the authority resolver refuses it. |
| **An attacker with only the `nwos_app` password** | The same credential as the server, but no user's password and no session token | No session can be created, no credentials can be read, and no identity can be assumed. Every protected change is refused (§3). The attacker has the background jobs' narrow rights at most. |
| **Migrator / administrator credential** (`DATABASE_MIGRATION_URL`, `DATABASE_ADMIN_URL`) | Membership of the role that owns the tables | Not checked by the guards, because it could disable them anyway. It is never in the server's environment, and production refuses to start if it is (Batch 10). |

Nothing the application says about a user id, a role or a project is trusted by these checks.
The identity comes only from a session the database created and still considers valid.

## 2. Mechanism

- **Owner-only tables.** `sessions`, `auth_credentials`, `auth_config`, `auth_login_failures` and
  `auth_tx_identity` grant `nwos_app` no privilege at all. The privilege report flags any it
  regains.
- **The authentication API.** `nwos_app` may call nine `SECURITY DEFINER` functions, and no
  other function:
  - `auth_password_params(email)`: salt and scrypt parameters. Unknown emails get stable, made-up
    ones.
  - `auth_login(email, key, user_agent, ip)`: compares `sha256(key)` with the stored verifier and
    limits failures to 10 per account per 15 minutes. It generates the token inside the database
    (two `gen_random_uuid()`, 244 random bits), stores only its SHA-256, and records `last_login`.
  - `auth_session(token)`: the session's user, with a sliding 12-hour expiry and a 7-day absolute
    limit.
  - `auth_logout(token)`.
  - `auth_purge_expired()`.
  - `auth_assume(token)`: records, for this transaction only, the session's user in
    `auth_tx_identity`, keyed by (backend pid, transaction id). It refuses an invalid session or a
    second, different identity.
  - `auth_issue_reset(user, purpose, minutes)`: an individual, single-use code (244 random bits,
    only its SHA-256 stored), valid 5 minutes to 3 days. The verified Owner for any other account;
    a verified Admin for accounts that are neither Owner nor Admin; the migrator for Owner
    recovery. Never one's own account. The account's password and sessions end at once, any
    earlier unused code is withdrawn, and the database writes an `auth.code_issued` audit record
    (never the code). It changes no role or authority.
  - `auth_activate(email, code, params, salt, key)`: sets the account's new password with a code
    that belongs to this email, is unused, unexpired, and whose account is active. Single use
    (row-locked); ends sessions; audited as `auth.password_set`.
  - `auth_account_status()`: which accounts have a password and which wait for a code (no
    secrets).

  `auth_set_password` (a password set directly) is **not** callable by `nwos_app`: only the
  migrator uses it, for the development seed and test fixtures.

  Every one pins `search_path = <schema>, pg_temp`, so a caller cannot shadow a table with a
  temporary one. The privilege report checks both the allowlist and the pinning.
- **Guards** (`BEFORE` triggers, `SECURITY DEFINER`, not callable directly). Each change must come
  from a role that owns the tables, or carry the verified identity from `auth_identity()`. That
  function also checks the user is still active and the session still valid, so a revoked session
  stops authorizing at once, even inside an open transaction.

  | Record | Rule |
  |---|---|
  | `users` | Owner: anything. Admin: never an Owner or Admin account or role, never the Owner routing or dev-seed flags. Nobody changes their own role or deactivates themselves; the last active Owner cannot be removed; users are never deleted. Without an identity: `last_login` only. A changed role, active flag or client/contractor link ends the user's sessions. |
  | `project_assignments`, `whatsapp_contacts` | Owner; Admin except for Owner/Admin accounts. |
  | `delegated_authorities` | Owner. Without an identity: switching off only (`active` true → false, expiry processed), nothing else. The locked-System-Policy guard still applies. |
  | `owner_absences` | Owner. Without an identity: start when `start_at ≤ now()`, end when `end_at ≤ now()`, by the database's clock. |
  | `projects.sensitivity` | Owner (a new project may start Normal). |
  | `legacy_review_decisions` | The verified Owner, recording their own id and role. |
  | `authority_decision_types` | Read-only for `nwos_app`. |
  | `audit_logs` | `actor_verified` is true when the row's actor is this transaction's verified identity. A forged attribution reads false. |
- **Passwords.** The server derives a key with scrypt (N=2¹⁵, r=8, p=1, 64 bytes,
  memory-hard). The database stores only `sha256(key)`, the salt and the parameters, in
  `auth_credentials`, and refuses weaker parameters. The password never reaches the database.
  - Nothing the database stores can be presented to `auth_login`: it takes the key, and only
    `sha256(key)` is kept. An attacker with `nwos_app` can read neither.
  - An attacker who could read the table (a backup) would still face scrypt for every guess.
  - Online guessing through `auth_login` costs a scrypt per guess and is cut off after 10 failures.
  - **Pre-031 hashes are not carried over.** Before 031 `users.password_hash` held the scrypt key
    itself, readable by `nwos_app`, and the key is exactly what `auth_login` accepts: a converted
    hash would let anyone who had copied it sign in as that user (this was the defect found in
    review; `server/db/legacyCredentials.test.ts` reproduces it against the earlier version of
    this migration). 031 drops the column and creates no credential: every account sets a new
    password with a code (§4).
  - `pgcrypto` is not used. An extension is installed once per database, outside NW OS's schema;
    it would complicate Supabase's `extensions` schema and the per-schema test databases, and it
    adds nothing here.
- **Server.** `AuthStore.login` derives the key and calls `auth_login`; every request resolves
  its cookie through `auth_session`. Writes to protected records run in a transaction that first
  calls `auth_assume` with the request's token:
  - `withIdentity` / `withUserTransaction`;
  - the generic `DataService` transactions;
  - user administration, assignments and authority rules;
  - temporary authority and absences;
  - the Owner routing policy, sensitivity, WhatsApp contacts and legacy reviews.
- **Other rules in this batch.**
  - An Admin cannot create, change, reset or assign an Owner or Admin account (API and database).
  - A Production Manager sees only explicitly assigned projects; with none, nothing.
  - `is_active` must be a boolean.
  - The authority resolver refuses background contexts and any user who is not, now, an active
    account with that role. `resolveApprovalAuthority` remains the single authority source.
  - Requesters still cannot name approvers (Batch 12A).

## 3. Attack paths and results (all as the real `nwos_app`)

| Attempt | Result |
|---|---|
| `INSERT INTO sessions` for the Owner (the Batch 12 probe), `SELECT`/`UPDATE sessions` | permission denied |
| Read or change `auth_credentials`, `auth_config`, `auth_tx_identity`, `auth_login_failures` | permission denied |
| Call `auth_identity`, `auth_exempt`, a guard | permission denied |
| `UPDATE users SET role = 'Owner / CEO'`, `INSERT` an Owner, deactivate the Owner, `DELETE` a user, set a password, set Owner routing flags | refused, without an identity and with an ordinary user's own valid session |
| Insert or delete project assignments | refused |
| Create, widen, re-enable or delete an authority rule; create an absence; change sensitivity; map a phone to the Owner; change decision types; insert a legacy review decision | refused |
| Forged session token (cookie or `auth_assume`) | 401 / refused |
| Admin managing an Admin or Owner (API and SQL with the Admin's session) | 403 / refused |
| Identity carried to the next statement or transaction on a pooled connection | none (refused) |
| A revoked session inside an open transaction | refused from the next statement on |
| A pre-031 password hash (copied before the upgrade), as a login key, a password, a code or a session token | refused: nothing was carried over |
| Issue, read or insert an activation / reset code; set a password directly | refused / permission denied |
| Reuse a code, use an expired one, or another email's | refused |
| An ordinary user issuing a code; an Admin for an Owner or Admin; anyone for themselves; anyone but the operator for Owner recovery | refused |

## 4. Cut-over: new passwords for everyone

- Migration 031 **ends every session** and **drops every old password hash** without converting
  it. Identities, roles, project assignments, delegations and all history are kept.
- Every account then **needs a new password**, set by its holder with an individual code:
  1. The operator recovers the Owner (§5).
  2. The Owner signs in and issues a code for each person (Users › Reset password, or
     `POST /api/users/:id/reset-code`). An Admin may issue codes for ordinary staff, never for an
     Owner or another Admin.
  3. Each person opens the sign-in screen, chooses **Set a new password with a code**, and enters
     their email, the code and their new password (at least 12 characters).
- A code is single use, expires (staff resets 24 hours, new accounts 3 days, Owner recovery 60
  minutes by default), is shown once to whoever issued it, and is stored only as a hash. A newer
  code withdraws the older one. There is no default or shared password, and nobody but the
  account holder knows the new password.
- Hand codes over individually through a channel you trust (in person, phone, an existing
  company chat with that person). Whoever holds a code can set that account's password until it
  is used or expires.
- The Users screen shows each account's state ("Needs password · code valid until …").

## 5. Recovery of Owner access

- **Owner recovery** (the cut-over, a lost password, or the only Owner deactivated) needs the
  migrator credential, held by an operator outside the application:
  `DATABASE_MIGRATION_URL=… npm run auth:recover-owner -- --email … --reason "…" [--valid-minutes 60]`.
  - It refuses to run unless its database role owns NW OS's tables (the runtime credential is
    refused), and refuses an account that is not an Owner. It never creates an Owner and never
    changes a role.
  - It reactivates the account if needed, ends its password and sessions, and prints a
    single-use recovery code once on the operator's terminal. The code is not stored (only its
    hash) and not logged.
  - Evidence: `security.owner_recovery` (operator database role, reason, expiry) and the
    database's own `auth.code_issued` / `auth.password_set` records.
  - No application API can issue a recovery code; even the signed-in Owner cannot.
- **Failed-login lock-out** (10 failures in 15 minutes) clears by itself after 15 minutes, or
  when a new password is set.
- **A new installation**: `npm run auth:create-user` on the migrator credential prints the first
  account's activation code.
- **Staff resets** are done by the Owner (any other account) or an Admin (ordinary staff only) in
  the application, as in §4.

## 6. Credentials, pooling and secrets

- **Three credentials** (Batch 10), unchanged:
  - `nwos_app` (`DATABASE_URL`, the server);
  - `nwos_migrator` (`DATABASE_MIGRATION_URL`: migrations, account scripts, Owner recovery);
  - an administrator (`DATABASE_ADMIN_URL`, the one-off role bootstrap).

  The server refuses to start in production with either of the last two in its environment.
- **Rotate the `nwos_app` password at the cut-over.** The identity checks no longer depend on it
  being secret, but business data is still writable with it (§8), and it has been in the server's
  environment while credentials were readable. `ALTER ROLE nwos_app PASSWORD …` as an
  administrator, then update `DATABASE_URL` and restart. Sessions live in the database and are
  not affected.
- **Pooling.** The verified identity is bound to (backend pid, transaction id). It is never a
  session setting, so it cannot survive the transaction on a pooled connection; tests prove it
  for the next statement, the next transaction and concurrent transactions. This holds with
  PgBouncer or Supavisor in transaction mode as well (a transaction stays on one backend). Do not
  use statement-level pooling.
- **Secrets.**
  - No new secret is needed in the server.
  - The salt-derivation secret for unknown emails is generated inside the database at migration
    time (`auth_config`, owner-only).
  - To end all sessions deliberately, an administrator runs `DELETE FROM sessions` (as the owner
    role).
  - The migrator and administrator passwords are rotated the same way as `nwos_app` and kept off
    every server.

## 7. Production deployment runbook (not done in this batch)

Nothing here has been run against production. Each step is required.

1. **Backup, verified.** Take a full backup (`pg_dump -Fc`, or the platform's point-in-time
   backup) immediately before the window. Restore it into a scratch database and confirm it has
   `schema_migrations` at 030, the expected row counts, and that the current server signs in
   against it. The same was done locally for this PR (§9). Record the PostgreSQL version (13 or
   later; no extension is needed).
2. **Maintenance window, traffic stopped.** Announce it, including that **everyone will set a new
   password with a code** afterwards. At the start, stop incoming traffic (scale the server to
   zero or close it at the proxy). The application has no maintenance mode, and the old server
   fails against 031 (`users.password_hash` is gone; it answers sign-in with HTTP 500), so no
   traffic may reach either while the two are mismatched.
3. **One coordinated change.** On the migrator credential: `npm run db:migrate` (applies 031,
   re-applies the runtime grants), then `npm run db:privileges` with `DATABASE_URL` set to the
   runtime credential (must report `nwos_app` restricted). Then deploy the 031-compatible server
   build. Do not start the old build again.
4. **Rotate the `nwos_app` password** (§6) before the new server starts; set the new
   `DATABASE_URL`. Confirm the server's environment has neither `DATABASE_MIGRATION_URL` nor
   `DATABASE_ADMIN_URL`.
5. **Sessions are invalidated** by the migration; confirm `SELECT count(*) FROM sessions` is 0 (as
   the migrator) and that `auth_account_status()` shows every account without a password.
6. **Owner recovery** (§5) by the operator; hand the code to the Owner directly. The Owner sets a
   new password and signs in.
7. **Individual staff activation**: the Owner issues a code per person (Admins may help with
   ordinary staff) and hands each over individually (§4). Accounts that should not return are
   deactivated instead.
8. **Verify roles and project assignments** in Users: every role as expected; Production Managers
   and other project-scoped roles assigned to their projects (unassigned, they see nothing).
9. **Smoke tests before reopening**:
   - the Owner signs in; creates and deactivates a test account; issues and uses a reset code;
   - an Admin is refused when editing or resetting an Admin or the Owner;
   - an ordinary user is refused a reset code for anyone;
   - as `nwos_app`: `INSERT INTO sessions …` and `SELECT * FROM auth_reset_tokens` are refused;
   - a pre-upgrade password does not sign in.
   Then reopen traffic.
10. **Monitoring** from reopening onwards, in `audit_logs`:
    - failed sign-ins and lock-outs: `login.failed`, `login.locked`, `auth.activation_invalid`,
      `auth.activation_expired`;
    - credential events: `auth.code_issued`, `auth.password_set`, `security.owner_recovery`
      (every one should match a request you know about);
    - privileged activity: `user.create`, `user.role_change`, `user.deactivate`,
      `user.assignments`, authority-rule and absence changes, and any row with
      `actor_verified = false` whose actor is a person;
    - database privilege denials (`[security] database privilege denied` in the server log and
      its audit record).

**Rollback.** Restoring the step-1 backup returns the database to 030 with the old hashes and the
old server works again (tested locally, §9). **Every write made after the cut-over is lost**
(new passwords, approvals, records, audit entries) unless they are re-entered or recovered some
other way; there is no forward-compatible path back. The old credentials come back with the
backup, including the exposure this batch removes. Decide in advance how long after reopening a
rollback is still acceptable.

## 8. Remaining risks

- **A compromised application server** can act as any user who is signed in while it is
  compromised. It holds their session tokens in memory as requests arrive, and it sees passwords
  at sign-in and activation. Nothing database-side prevents that. Step-up confirmation for
  Owner-critical actions was proposed and not built.
- **Codes in transit.** Whoever holds an unused, unexpired code can set that account's password.
  Codes are individual, single use and short-lived, and the issuer sees them; hand them over
  directly. The Owner (and an Admin, for ordinary staff) can therefore take over an account by
  issuing a code and using it; that is visible (the holder's password stops working, and the
  audit trail records who issued it).
- **Business data is not protected from a stolen `nwos_app` credential**: purchase orders,
  invoices, approvals' business fields, cost records, risk inputs and the like. Such writes are
  not attributed to a verified identity. General row-level security was excluded from this batch.
  Batch 11's integrity findings detect some of it, and audit rows show forged attribution as
  unverified.
- **Background-job rights** (switching authority off, starting and ending absences by date) are
  open to the runtime credential too. They only reduce authority or apply what the Owner already
  scheduled.
- **Denial of service:** the runtime credential can lock an account for 15 minutes with failed
  logins, or switch delegations off (approvals then fall to the Owner).
- **Account lockout** if the Owner forgets the password and the migrator credential is lost: keep
  the migrator credential safe and offline.
- **Cut-over effort:** every person needs a code from the Owner (or an Admin) once.
- Production has not been deployed or verified.

## 9. Evidence (local, this PR)

- `server/db/legacyCredentials.test.ts`, on the real restricted role: a real 030 database is
  upgraded by the migrator; stolen Owner / Admin / ordinary hashes, alone or with the runtime
  credential, authenticate nobody; codes are single use and expire; ordinary users and Admins
  are limited as above; the recovery script runs only on the migrator credential; activated
  accounts sign in; earlier sessions stay invalid; records and assignments are intact. Run
  against the earlier version of migration 031, the stolen-hash checks fail (the Owner's hash
  signed in).
- `server/db/trustedIdentity.test.ts`: the database authority boundary (sessions, roles,
  assignments, authority records, forged tokens, pooling, revocation).
- Rollback: a `pg_dump -Fc` backup of a 030 database, the upgrade to 031, then `pg_restore` into a
  new database gave back 030 with all accounts; the 030 server signed in against it. The 030
  server against the 031 database fails sign-in (HTTP 500).
