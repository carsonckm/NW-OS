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
- **The authentication API.** `nwos_app` may call seven `SECURITY DEFINER` functions, and no
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
  - `auth_set_password(user, params, salt, key)`: needs the Owner for anyone, or an Admin for
    non-Owner, non-Admin accounts. It ends the user's sessions.

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
- **Passwords.** The server still derives a key with scrypt (N=2¹⁵, r=8, p=1, 64 bytes,
  memory-hard). The database stores only `sha256(key)`, the salt and the parameters, in
  `auth_credentials`. The password never reaches the database.
  - An attacker with `nwos_app` can read neither verifiers nor keys.
  - An attacker who could read the table would still face scrypt for every guess, exactly as before.
  - Online guessing through `auth_login` costs a scrypt per guess and is cut off after 10 failures.
  - `pgcrypto` is not used. An extension is installed once per database, outside NW OS's schema;
    it would complicate Supabase's `extensions` schema and the per-schema test databases, and it
    adds nothing here. Existing hashes convert in the migration without any password reset.
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

## 4. Cut-over and re-login

- Migration 031 **ends every session** (`DELETE FROM sessions`). Sessions created before the
  database verified passwords are not trusted. **Everyone signs in again once**, with the same
  password: existing scrypt hashes convert losslessly.
- Accounts whose stored hash is not a valid scrypt hash (none are created by NW OS) get no
  credential and cannot sign in until an Owner or Admin sets a password.
- Tell users in advance: "After the update you will be signed out; sign in again with your usual
  password."

## 5. Recovery of Owner access

- **Lost password or locked out.** An operator holding the migrator credential runs
  `NEW_OWNER_PASSWORD=… DATABASE_MIGRATION_URL=… npm run auth:recover-owner -- --email … --reason "…"`.
  - It sets a new password for an existing Owner account and reactivates it if needed.
  - It ends that account's sessions and writes a `security.owner_recovery` audit record.
  - It never creates an Owner and never changes a role.
- **Failed-login lock-out** (10 failures in 15 minutes) clears by itself after 15 minutes. It is
  also cleared when a password is set.
- **No Owner account exists** (a new installation): `npm run auth:create-user` on the migrator
  credential.
- These operations need the migrator credential by design. The runtime credential cannot change
  accounts without a signed-in Owner or Admin.

## 6. Credentials, pooling and secrets

- **Three credentials** (Batch 10), unchanged:
  - `nwos_app` (`DATABASE_URL`, the server);
  - `nwos_migrator` (`DATABASE_MIGRATION_URL`: migrations, account scripts, Owner recovery);
  - an administrator (`DATABASE_ADMIN_URL`, the one-off role bootstrap).

  The server refuses to start in production with either of the last two in its environment.
- **Pooling.** The verified identity is bound to (backend pid, transaction id). It is never a
  session setting, so it cannot survive the transaction on a pooled connection; tests prove it
  for the next statement, the next transaction and concurrent transactions. This holds with
  PgBouncer or Supavisor in transaction mode as well (a transaction stays on one backend). Do not
  use statement-level pooling.
- **Secrets.**
  - No new secret is needed in the server.
  - The salt-derivation secret for unknown emails is generated inside the database at migration
    time (`auth_config`, owner-only).
  - Rotating the `nwos_app` password (`ALTER ROLE nwos_app PASSWORD …` as an administrator, then
    update `DATABASE_URL` and restart) invalidates nothing users hold. Sessions live in the
    database and remain valid.
  - To end all sessions deliberately, an administrator runs `DELETE FROM sessions` (as the owner
    role).
  - The migrator and administrator passwords are rotated the same way and should be kept out of
    every server.

## 7. Production rollout (not done in this batch)

1. Back up the database. Check that it is PostgreSQL 13 or later (`gen_random_uuid`, `sha256`;
   Supabase is). No extension is needed.
2. Announce the one-time re-login.
3. Deploy in this order:
   1. Run migrations on the migrator credential (031 applies; grants re-applied).
   2. Run `npm run db:privileges` (it must report `nwos_app` as restricted).
   3. Deploy the new server.
   4. Restart.

   The old server cannot run against migration 031, because `users.password_hash` is gone. Deploy
   the migration and the server together.
4. **Verify:**
   - the Owner signs in;
   - the Owner creates and deactivates a test account;
   - an Admin cannot edit another Admin;
   - Production Managers have their project assignments (with none they see nothing): **assign
     them before the cut-over**;
   - as `nwos_app`, `INSERT INTO sessions …` is refused.
5. Keep the Owner recovery procedure (§5) and the migrator credential with the operator, not on
   the server.
6. **Rollback:** restore the backup taken in step 1. Migration 031 drops `users.password_hash`,
   and the old server cannot read the new credentials.

## 8. Remaining risks

- **A compromised application server** can act as any user who is signed in while it is
  compromised. It holds their session tokens in memory as requests arrive, and it sees passwords
  at login. Nothing database-side prevents that. Step-up confirmation for Owner-critical actions
  was proposed and not built.
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
- Production has not been deployed or verified.
