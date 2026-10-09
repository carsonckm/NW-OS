# Phase 6 Batch 10 — Database privilege separation and integrity

## 1. The problem this fixes

Before this batch one database login (`DATABASE_URL`) did everything:
- it ran the server;
- it ran the migrations and seed scripts;
- it owned the database, every table (73) and every protection function (7);
- it had CREATEDB.

A table's owner can switch its triggers off, so whoever held the server's credential could do
all of this. It was shown in a rolled-back transaction during the preflight:
- disable the `audit_logs` append-only trigger and delete audit rows;
- replace a protection function with one that does nothing;
- drop a trigger;
- grant everything to PUBLIC.

Everything the earlier batches built on immutable history (audit trail, decision traces,
exception lifecycle, delivery receipts, drawing revisions, locked System Policy) depended on
that credential never leaking.

## 2. The three roles

| Role | Login | What it is | Owns | Can do |
|---|---|---|---|---|
| `nwos_owner` | **no** | The owner of the schema | schema, every table, sequence, function, trigger, type (and, with `--transfer-database`, the database) | everything to its own objects; nobody logs in as it |
| `nwos_migrator` | yes | Migrations only | nothing directly; member of `nwos_owner` | runs migrations as `nwos_owner` (`SET ROLE`), re-applies the runtime grants |
| `nwos_app` | yes, `NOINHERIT` | The running server (`DATABASE_URL`) | **nothing** | row reads and writes, table by table (below); no DDL, no grant option, no role membership |

All three are `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. The names can be
changed with `NWOS_DB_OWNER_ROLE` / `NWOS_DB_MIGRATOR_ROLE` / `NWOS_DB_APP_ROLE`; they must be
three different roles.

### What `nwos_app` may do (`applyRuntimeGrants`, `server/db/roles.ts`)

| Tables | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| Every application table | ✓ | ✓ | ✓ | ✓ |
| Append-only history: `audit_logs`, `owner_exception_events`, `delivery_receipts` | ✓ | ✓ | — | — |
| Never deleted: `owner_exception_states`, `owner_exception_snoozes`, `drawing_revisions` | ✓ | ✓ | ✓ | — |
| `schema_migrations` | ✓ | — | — | — |

Other grants and revocations:
- **Sequences:** USAGE and SELECT only.
- **Never granted:** TRUNCATE, TRIGGER and REFERENCES, on any table.
- **Functions:** EXECUTE on the schema's functions is revoked from PUBLIC. Trigger functions run
  without it.
- **Schema:** USAGE only. `CREATE ON SCHEMA` is revoked from PUBLIC.
- **Database:** CONNECT only. `CREATE ON DATABASE` is revoked from PUBLIC.
- **Future tables:** default privileges give tables a later migration creates (as `nwos_owner`)
  the same row access, and nothing more.

The database triggers stay as a second layer. For the history tables the privilege check now
refuses the change before the trigger is even reached.

### What the runtime role cannot do (tested as the real role, `server/db/privileges.test.ts`)

- **Alter protected objects:** alter, drop, rename or re-own a table; create a table, schema,
  index or rule.
- **Disable protections:** disable or drop a trigger; replace, drop or rename a protection
  function; `SET session_replication_role = replica` (which would skip triggers).
- **Edit history:** UPDATE, DELETE or TRUNCATE history; DELETE never-deleted records; write
  `schema_migrations`.
- **Escalate:**
  - grant or revoke privileges (PostgreSQL turns a GRANT without a grant option into a warning,
    so the test checks the catalog did not change);
  - join, `SET ROLE` or `SET SESSION AUTHORIZATION` to the owner or migrator role;
  - create roles or alter any role's attributes or password.
- **Migrate:** run migrations (`migrate()` refuses the runtime role by name; without the role
  option the DDL itself is refused).

### Migration 025: exception integrity, enforced by the database

The runtime role must update exception states and write snoozes and history, so privileges alone
cannot stop a direct write from doing what the API refuses. Migration
`025_phase6_exception_integrity.sql` adds deferred constraint triggers, checked at COMMIT:

- **No silent state changes:** every state change must follow the lifecycle state machine
  (Batch 9) and be recorded in the same transaction by a history event with the same from / to
  states.
  - Events carry the writing transaction's id: a new `txid` column, which defaults to
    `txid_current()`.
  - So an event from an earlier transaction cannot cover a later change.
- **Reasons:** dismissing needs a reason. Reopening needs a `reopen` event with a reason.
- **Critical exceptions:** a critical exception can never be dismissed or snoozed. The
  severity checked is the one the server recomputed for the action and recorded on its event.
- **Severity:** a severity change needs a `changed` event.
- **New exceptions:** a new exception starts `active` with its `observed` event.
- **Snoozes:** a snooze needs a recorded exception and its `snooze` event.

The application already wrote state and event together in one transaction, so no application
code changed for this. The full suite passes in both modes.

## 3. Startup checks (no silent fallback)

On start the server checks the effective privileges of its own login (`runtimePrivilegeReport`).
It goes through every role the login can act as (`pg_has_role(..., 'MEMBER')`), not just the
role's name. It flags any of these:
- superuser, CREATEROLE, CREATEDB, BYPASSRLS or REPLICATION;
- membership of any role, including dangerous predefined roles;
- owning a table or function in the schema;
- owning the schema or database, or CREATE on either;
- any grant option;
- TRUNCATE, TRIGGER or REFERENCES on any table;
- UPDATE or DELETE on history.

| `NODE_ENV` | Privileged login | Result |
|---|---|---|
| `production` | yes | **Refuses to start**: logs what it found and exits 1. |
| `production` with `NWOS_ALLOW_PRIVILEGED_DATABASE=true` | yes | Starts, logs a loud error, and writes `security.privileged_database_override` to the audit trail. This is an explicit operator choice. |
| anything else | yes | Starts with a warning (development). |
| any | no | Starts. |

`npm run db:privileges` prints the same report for `DATABASE_URL` and exits 1 if the login is
not restricted. Neither ever prints a connection string or password.

### Security monitoring

A request the database refuses for lack of privilege (SQLSTATE 42501) is never part of normal
operation: the application never needs a privilege the runtime role lacks. So each one:
- is logged;
- is written to the existing audit trail as `security.database_privilege_denied` with:
  - the user (id, name, role) and IP;
  - the method and path;
  - the database's refusal message, e.g. `permission denied for table projects`;
- **never** records the request body, query parameters or credentials;
- returns `500 internal_error` to the browser, which learns nothing about the schema.

## 4. Credentials

| Variable | Used by | Login |
|---|---|---|
| `DATABASE_URL` | the server, `db:import-demo`, `auth:*`, `db:privileges` | `nwos_app` |
| `DATABASE_MIGRATION_URL` | `db:migrate` only | `nwos_migrator` |
| `DATABASE_ADMIN_URL` | `db:bootstrap-roles` only (one-off) | a database administrator |

- **Admin credential:** never give `DATABASE_ADMIN_URL` to the server. Use it once for setup,
  then remove it from the environment.
- **Runtime credential:** never reused for migrations.
  - Once the roles exist, `db:migrate` refuses to run without `DATABASE_MIGRATION_URL`.
  - `migrate()` refuses a migration login that is, or can act as, the runtime role.
  - It also refuses one that cannot act as the owner role.
- **Not exposed:** none of these variables is `VITE_`-prefixed. None reaches the browser bundle
  (checked) or any API response.

## 5. Deployment order

Do this once per database, then every release.

1. **Bootstrap the roles (administrator, once; repeatable):**
   ```
   DATABASE_ADMIN_URL=<admin connection> NWOS_MIGRATOR_PASSWORD=<new> NWOS_APP_PASSWORD=<new> \
     npm run db:bootstrap-roles -- --transfer-database
   ```
   It runs in one transaction, under an advisory lock. It:
   - creates any missing role and re-asserts every role's attributes;
   - removes every membership of the runtime role;
   - makes the migrator a member of the owner;
   - moves the schema and every table, view, sequence, function and type in it to `nwos_owner`;
   - grants CONNECT;
   - applies the runtime grants.

   Passwords are optional (omit them to keep the current ones) and are never printed.
   `--transfer-database` also makes `nwos_owner` the database owner; that needs a superuser or
   the current database owner. Running it again changes nothing, and it repairs drift: a
   membership or attribute granted by hand is removed (this is tested).
2. **Migrate (every release, before the new server starts):**
   `DATABASE_MIGRATION_URL=<nwos_migrator connection> npm run db:migrate`. Migrations run as
   `nwos_owner`, and the runtime grants are re-applied after every run.
3. **Point the server at `nwos_app`:** `DATABASE_URL=<nwos_app connection>`. The server checks
   its privileges on start (§3).
4. **Verify:** `DATABASE_URL=<nwos_app connection> npm run db:privileges` should print `OK`.
5. **Remove the old credential:** remove the old all-powerful login from the server's
   environment and rotate its password. Keep it only as a break-glass administrator credential,
   stored outside the application.

An existing single-credential install upgrades the same way. Bootstrap moves the existing
objects off the old login: in the development database it moved 76 relations and 7 functions
and kept every row. Until the roles exist, `db:migrate` still works with `DATABASE_URL` alone,
with a "single-credential mode, NOT hardened" warning, so nothing breaks before an operator has
run the bootstrap.

### Rollback

- The roles change nothing in the data.
- **Undo the bootstrap:** `ALTER ... OWNER TO <old login>` (or `REASSIGN OWNED BY nwos_owner TO
  <old login>` as an administrator), then point `DATABASE_URL` back.
- **Migration 025:**
  - `DROP TRIGGER owner_exception_states_integrity` and `owner_exception_snoozes_integrity`;
  - drop the two functions;
  - drop the `txid` column of `owner_exception_events` (by the owner).

## 6. Production specifics that could not be verified here

There is no access to the production database (AI Studio / Cloud Run, optionally Supabase). What
was verified:
- PostgreSQL 16.14 in this environment;
- the GitHub Actions `postgres:16` service, in CI.

Before production, check:
- **Administrator:** whoever runs the bootstrap must be a superuser or hold CREATEROLE. On
  Supabase, the `postgres` role is not a superuser but has CREATEROLE and owns the existing
  objects; the bootstrap grants `nwos_owner` to a non-superuser administrator so it can transfer
  ownership. `--transfer-database` may not be permitted there; it is optional.
- **Connection poolers:** migrations use `SET ROLE` for the session. Run them on a **direct /
  session-mode** connection (Supabase: port 5432, not the transaction pooler on 6543). The
  server's own connection may use the pooler.
- **Supabase API roles:** Supabase grants table privileges to `anon`, `authenticated` and
  `service_role` through default privileges of `postgres`. NW OS does not use the Supabase Data
  API. If it is enabled for this database, revoke those grants (or disable the API): they are
  outside what `db:privileges` checks, which is the server's own login.
- **Temporary tables:** PostgreSQL grants TEMP on a database to PUBLIC by default. A temporary
  table lives only in the session that creates it, so it cannot change anything for other
  sessions or the stored data; NW OS does not revoke it.
- **Secrets:** Cloud Run / AI Studio must hold two secrets, the `nwos_app` URL for the service
  and the `nwos_migrator` URL for the release step. Never put the migrator credential in the
  service's runtime environment.
- **Release step:** the release process must run `db:migrate` with the migrator credential
  before rolling out a new revision. This was not exercised against the real hosting.

## 7. Remaining risks

- **Database administrator or superuser:** anyone holding the administrator, superuser or
  `nwos_owner` / `nwos_migrator` credentials can still change or remove anything, including the
  protections. That is inherent; protect those credentials and keep them out of the
  application.
- **A stolen `nwos_app` credential** can no longer:
  - disable, drop or replace a protection;
  - rewrite or delete history;
  - grant itself anything.

  It can still write rows the application can write, like any server bug could:
  - it can append plausible-looking history events and audit rows (the database cannot
    authenticate the end user behind a connection);
  - it can change ordinary records and authority rules (except the locked System Policy rows,
    which are guarded by trigger).

  The integrity triggers make such writes leave a record and follow the lifecycle rules (no
  silent or out-of-order state change, no hidden critical exception). Detecting a forged but
  well-formed record needs controls outside the database: credential rotation, network
  restrictions, database logs.
- **No row-level security:** the per-user scope checks stay in the server (`AccessContext`,
  `resolveApprovalAuthority`), as before.

## 8. Approval policy finding: `SYS-REQUEST-ASSIGNEE-*` (reported, not changed)

**What it does.** Migration 018 (Batch 2) seeds one System Policy per decision type,
`SYS-REQUEST-ASSIGNEE-<TYPE>`:
- **Effect:** allow, priority 100.
- **Conditions:** `requests_only`, `assigned_approver`, `no_self_approval`.
- **Not locked.**

For a generic approval request it means: "the request's named approver (user or role) decides".
The requester names the approver (`assigned_approver_role`). Only the requester can change it,
and changing it re-routes the request.

**Traced behaviour** (pinned by a characterization test in `authorityResolver.test.ts`):
- A Purchasing user raises a Major Purchase request linked to a **RM 500,000** PO and names the
  Project Manager. The PM may approve it (`ALLOWED by SYS-REQUEST-ASSIGNEE-PURCHASE`), and there
  is no value limit (`min_value` / `max_value` null).
- The same holds for another Purchasing user or the Production Manager.
- That approval then counts as the prior approval for issuing the PO (`SYS-PURCHASE-APPROVED`).
- A Safety-Critical request can be decided by a named Site Supervisor.

**The limits that hold** (all tested):
- **No self-approval:** `SELF_APPROVAL_BLOCKED`.
- **Baseline permission:** for a purchase decision the approver must hold `purchasing.view`, so
  a named Site Supervisor is refused with `INSUFFICIENT_PERMISSION`.
- **Project scope:** `OUT_OF_SCOPE` for a contractor or client of another project.
- **Clients and contractors:** never hold internal approval authority.
- **Ceilings:** the Sensitive and Strategic ceilings still require the Owner
  (`SENSITIVITY_BLOCKED`).
- **Tampering:** a tampered or forged assignee field changes nothing.

**Assessment.**
- This is the documented Batch 2 policy carried over from before Phase 6, not a defect in
  authorization code.
- It is not an unauthorized path: every limit the resolver enforces applies.
- It does let the requester choose a peer approver for a decision of any value. Whether that
  is acceptable is a **business-policy decision for the Owner**, so it was not changed here.

**Options the Owner already has** (no code needed): in Authority settings, deactivate
`SYS-REQUEST-ASSIGNEE-PURCHASE` (or another type), or add an Owner rule with a higher priority,
e.g. `require_owner` above RM X for approval requests.
