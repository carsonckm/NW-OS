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
cannot stop a direct write from changing them. Migration `025_phase6_exception_integrity.sql`
adds deferred constraint triggers, checked at COMMIT. They make every change follow the lifecycle
and leave a permanent record. They cannot judge whether the recorded facts are true (§7):

- **No silent state changes:** every state change must follow the lifecycle state machine
  (Batch 9) and be recorded in the same transaction by a history event with the same from / to
  states.
  - Events carry the writing transaction's id: a new `txid` column, which defaults to
    `txid_current()`.
  - So an event from an earlier transaction cannot cover a later change.
- **Reasons:** dismissing needs a reason. Reopening needs a `reopen` event with a reason.
- **Critical exceptions:** a dismissal or snooze is refused when its event records the severity
  as critical, or records none. Migration 026 (Batch 11, below) tightened this to the stored
  severity.
- **Severity:** a severity change needs a `changed` event.
- **New exceptions:** a new exception starts `active` with its `observed` event.
- **Snoozes:** a snooze needs a recorded exception and its `snooze` event.

The application already wrote state and event together in one transaction, so no application
code changed for this. The full suite passes in both modes.

### Migration 026 (Batch 11): critical exceptions, by the stored severity

Migration 025 checked the severity written on the dismissal or snooze event, and the writer
chooses that value. Migration `026_phase6_critical_exception_integrity.sql` replaces the two
check functions (the triggers are kept) so that the **stored severity**
(`owner_exception_states.severity`) decides:

- **Stored severity decides:** a dismissal or snooze is refused while the exception's stored
  severity is critical. A dismissal is also refused if the row was critical just before the
  change. The severity on the event is never accepted as proof.
- **Event must match:** the dismissal or snooze event must record exactly the stored severity.
  It must be its own `dismiss` / `snooze` event, written in the same transaction. An event of
  another exception, another action or an earlier transaction does not count.
- **No same-transaction lowering:** a critical exception cannot be lowered and dismissed or
  snoozed in one transaction, in any order of statements (including in the same statement).
- **Error code:** lifecycle refusals use their own SQLSTATE, `NWX01`. The API answers it with a
  generic `409 conflict` ("reload and try again"). The database's message stays in the server
  log.

The application keeps the stored severity authoritative and current:
- **Where severity comes from:** the server computes an exception's severity from live data
  (the most severe of its reasons). It is stored when the exception is first recorded, and kept
  current by the hourly lifecycle rule, which writes a `changed` event.
- **Before an action:** before a dismissal or snooze, the server first brings that exception's
  stored record up to date with what it sees now, in its own transaction. This is exactly what
  the lifecycle rule would do: a stale or drifted stored severity is corrected and recorded with
  a `changed` event.
- **Under the row lock:** the action then checks, with the row locked, that the stored severity
  is not critical and matches what the server sees. A mismatch means the exception changed in
  the meantime: `409 conflict`.
- **No other change:** acknowledge, wait, resolve and reopen are unchanged, including for
  critical exceptions.

## 3. Startup checks (no silent fallback)

On start, before the API and its automation scheduler are mounted, the server
(`setupServer()` in `server.ts` → `enforceRuntimePrivileges()` in `server/db/roles.ts`, with
`process.env`) checks its own login.

### What the checker looks at (`runtimePrivilegeReport`)
It checks **effective** privileges, never the login's name. Everything goes through every role
the login can act as (`pg_has_role(…, 'MEMBER')`: direct, inherited or reachable by `SET ROLE`),
and privileges inherited from roles or granted to PUBLIC (`has_*_privilege`). It flags:
- superuser, CREATEROLE, CREATEDB, BYPASSRLS or REPLICATION;
- membership of **any** other role, including predefined roles such as `pg_database_owner` or
  `pg_write_all_data` (that is what "role switching" would use);
- owning, directly or through a role, any table, sequence, index or function in the schema,
  the schema itself or the database;
- CREATE on the schema or the database;
- owning or CREATE on any **other** schema on its `search_path` (which could shadow NW OS's
  tables or functions);
- any grant option on the schema, its tables or its sequences, however it was obtained;
- TRUNCATE, TRIGGER or REFERENCES on any table;
- UPDATE or DELETE on the append-only tables, DELETE on the never-deleted ones, any write to
  `schema_migrations`;
- being able to call a `SECURITY DEFINER` function in the schema that runs as another role (NW OS
  defines none; functions of an installed extension are not counted).

Tests show this does not depend on the name:
- a test login named like the runtime role, owning nothing directly, is flagged for privileges
  reached through an inherited role, a grant option, CREATE on another `search_path` schema and
  a callable `SECURITY DEFINER` function;
- the real runtime role is flagged as soon as it gains a membership or attribute (drift);
- the test runtime roles have generated names (not `nwos_app`) and pass when restricted.

### What happens on start

| `NODE_ENV` | Login | Result |
|---|---|---|
| `production` | restricted | Starts. |
| `production` | privileged | **Refuses to start**: logs what it found and exits 1. |
| `production`, `NWOS_ALLOW_PRIVILEGED_DATABASE` **exactly** `true` | privileged | Starts. Logs an error saying the database is NOT hardened, and writes `security.privileged_database_override` to the audit trail. This repeats on every start. |
| `production`, `NWOS_ALLOW_PRIVILEGED_DATABASE` any other value (`TRUE`, `1`, `yes`, ` true`, …) | privileged | **Refuses to start**, warning that the value is ignored. |
| `production`, `NWOS_ALLOW_PRIVILEGED_DATABASE=true` | restricted | Starts, warning that the flag is not needed and should be removed. |
| `production` | the check cannot run (database unreachable) | **Refuses to start** rather than run unchecked. |
| `production` | `DATABASE_MIGRATION_URL` or `DATABASE_ADMIN_URL` set in the server's environment | **Refuses to start**. The override does not cover this. Only the variable names are logged, never their values. |
| anything else (unset, `development`, `test`, `staging`, …) | any | Starts. A privileged login, an unreachable database or a non-runtime credential is a warning. The override has no effect. |

### The override, `NWOS_ALLOW_PRIVILEGED_DATABASE`
- **Where it is read:** in one place only (`enforceRuntimePrivileges`), directly from the
  process environment. There is no default, it is never set by the code, `.env.example` leaves
  it commented out and empty, and `.env*` files are not committed.
- **When it applies:** only in production, only as the exact string `true`, and only to the
  privileged-login check. It cannot let the server start with the migration or administrator
  credential, or start with an unreachable database.
- **What it records:** it is logged as an error and audited on every start. The audit row is
  written with the privileged login itself, so it is not tamper-proof. Writing it is attempted
  and a failure is logged.
- **Risks while it is on:**
  - the database is **not hardened**: whoever holds that credential can disable the triggers
    and rewrite or delete history, including the override's own audit rows;
  - the flag stays in force until someone removes it.

  Use it only as a time-boxed emergency measure, keep it out of templates and shared
  environment files, and remove it once the server runs as `nwos_app`.
- **Production depends on `NODE_ENV`:** production mode is `NODE_ENV=production`, which
  `npm start` sets. A deployment that starts the server another way without it runs in
  development mode, where these checks only warn. (Development mode also serves the app through
  Vite, which a production image normally does not have.) Always start production with
  `npm start`.

`npm run db:privileges` prints the same report for `DATABASE_URL` and exits 1 if the login is not
restricted. Neither it nor the server ever prints a connection string or password.

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

- **Each process gets only its own credential:**
  - the running server gets only `DATABASE_URL` (`nwos_app`);
  - the release step gets only `DATABASE_MIGRATION_URL`;
  - the administrator uses `DATABASE_ADMIN_URL` once, for setup, and then removes it.
- **Enforced, not just documented:**
  - the server's code never reads `DATABASE_MIGRATION_URL` or `DATABASE_ADMIN_URL`;
  - in production the server refuses to start if either is present in its environment (§3);
  - if `DATABASE_URL` were set to the migrator's login, the privilege check refuses it (it is a
    member of the owner role).
- **Runtime credential:** never reused for migrations.
  - `db:migrate` treats a database as role-separated when its schema is owned by
    `nwos_owner`, when the login is the runtime role, or when a migrator login is used.
  - On such a database it refuses to run without `DATABASE_MIGRATION_URL`, and always migrates
    as `nwos_owner`.
  - Another database on the same PostgreSQL server that has not been bootstrapped keeps
    migrating in single-credential mode, with a warning.
  - `migrate()` refuses a migration login that is, or can act as, the runtime role (a superuser
    is not treated as the runtime role).
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
   - moves the schema and every table, view, sequence, function and type in it to `nwos_owner`,
     except objects that belong to an installed extension (pgcrypto, citext, …): those keep
     their owner and their privileges, and the app can still use them (tested);
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
and kept every row. Until the bootstrap has run on a database, `db:migrate` still works there
with `DATABASE_URL` alone, with a "single-credential mode, NOT hardened" warning, so nothing
breaks before an operator has run it.

### Rollback

- The roles change nothing in the data.
- **Undo the bootstrap:** `ALTER ... OWNER TO <old login>` (or `REASSIGN OWNED BY nwos_owner TO
  <old login>` as an administrator), then point `DATABASE_URL` back.
- **Migration 025:**
  - `DROP TRIGGER owner_exception_states_integrity` and `owner_exception_snoozes_integrity`;
  - drop the two functions;
  - drop the `txid` column of `owner_exception_events` (by the owner).

## 6. Production compatibility: NOT tested

**Status:** none of this has been run against the production hosting (AI Studio / Cloud Run,
optionally Supabase).

**What was tested:**
- PostgreSQL 16.14, as a plain self-managed server, in the development environment: fresh
  database, development upgrade, the full suite twice (normal and restricted), browser
  acceptance with the server connected as `nwos_app`, and the built server started in
  production mode;
- the GitHub Actions `postgres:16` service (CI): the deployment order and both test runs.

Everything below is either **untested** or **known to need care**. Do not treat the hardening as
production-ready until the rollout checklist has passed on the real hosting.

### Known limitations and open questions

- **Administrator rights (untested on Supabase).** The bootstrap needs a superuser, or a role
  with CREATEROLE that can act as the current owners of the objects.
  - On Supabase the `postgres` role is documented as not being a superuser. Whether it may
    create these roles and take over every object in `public` has **not been verified**.
  - The bootstrap grants `nwos_owner` to a non-superuser administrator so that it can hand
    objects over. That administrator can then act as the owner: it is an administrator
    credential, so keep it out of the application.
  - `--transfer-database` (making `nwos_owner` the database owner) may not be permitted there.
    It is optional.
  - If any step fails, the bootstrap runs in one transaction and changes nothing.
- **Objects owned by someone else.** Extension objects are skipped (§5). Any other object in the
  schema that the administrator cannot take over (e.g. created by a platform role) makes the
  bootstrap fail as a whole. That is safe, but it needs investigation before rollout.
- **Connection poolers:**
  - **Migrations and the bootstrap** use session state: `SET ROLE` for the whole run, and a
    session advisory lock in `migrate()`. They **must** use a direct or session-mode connection
    (Supabase: port 5432, not the transaction pooler on 6543). Through a transaction pooler,
    `SET ROLE` would not persist: migrations would fail, or run as the migrator itself and
    leave objects it owns. The latter is detectable with `db:privileges` and the ownership
    query in the checklist.
  - **The running server**, by code review, uses only transaction-scoped features (transaction
    advisory locks, `SET CONSTRAINTS`, deferred triggers using `txid_current()`), no session
    `SET`, `LISTEN` or named prepared statements. It is therefore *expected* to work through a
    transaction pooler, but **this has not been tested**.
  - The startup privilege check reads only the catalog, so it gives the same answer on any
    pooled connection that uses the same login.
- **Supabase Data API (PostgREST) roles (untested).** Supabase normally grants `anon`,
  `authenticated` and `service_role` access to the `public` schema and its tables, through
  default privileges of `postgres`. `service_role` also bypasses row-level security.
  - NW OS does not use the Data API, and the bootstrap does **not** revoke those grants:
    `REVOKE … FROM PUBLIC` does not touch grants made to those named roles.
  - `db:privileges` checks only the server's own login, so it will not see them.
  - If the Data API is enabled for this project, NW OS's tables (including `audit_logs` and the
    exception history) may be readable or writable through it with the project's API keys,
    outside every protection described here.
  - Before rollout: disable the Data API, or remove `public` from its exposed schemas, or revoke
    those roles' privileges on NW OS's tables, sequences and functions.
- **Temporary tables.** PostgreSQL grants TEMP on a database to PUBLIC by default. A temporary
  table exists only in the session that creates it and cannot change stored data or other
  sessions, so NW OS does not revoke it.
- **Secrets and the release step (untested).**
  - Cloud Run / AI Studio needs two secrets: the `nwos_app` URL for the service, and the
    `nwos_migrator` URL for a separate release job that runs `db:migrate` before each new
    revision.
  - The service refuses to start in production if it is given the migrator or administrator
    URL (§3).
  - The release job itself was not built or exercised here.

### Safe rollout checklist

Run these against a **staging copy** of the production database first, then production, in a
maintenance window, with a fresh backup and the rollback (§5) at hand.

1. **Back up** the database, and record who owns its objects today:
   `SELECT DISTINCT pg_get_userbyid(relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE nspname = 'public'`.
2. **Supabase only:**
   - confirm whether the Data API is enabled and which schemas it exposes;
   - disable it, or revoke its roles' access to NW OS's tables;
   - use the **direct (port 5432)** connection string for steps 3 and 4.
3. **Bootstrap** with the administrator login (`db:bootstrap-roles`, without
   `--transfer-database` if not permitted). Expect "Roles ready". On any error nothing has
   changed: stop and investigate.
4. **Migrate** with `DATABASE_MIGRATION_URL` (the `nwos_migrator` direct connection). Then
   confirm nothing in the schema is owned by anyone but `nwos_owner` (apart from extension
   objects):
   `SELECT relname, pg_get_userbyid(relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE nspname = 'public' AND pg_get_userbyid(relowner) <> 'nwos_owner'`.
   This query should return no rows other than extension objects.
5. **Verify the runtime login:** `DATABASE_URL=<nwos_app URL as the service will use it, pooler
   included> npm run db:privileges` must print `OK`.
6. **Configure the service:**
   - `DATABASE_URL` = `nwos_app`;
   - no `DATABASE_MIGRATION_URL`, `DATABASE_ADMIN_URL` or `NWOS_ALLOW_PRIVILEGED_DATABASE`;
   - start with `npm start` (`NODE_ENV=production`).
7. **Deploy and smoke-test:**
   - the server logs "listening" with no `[db]` errors;
   - sign in;
   - open the Owner Center;
   - acknowledge an exception;
   - decide a test approval.
8. **Check the audit trail** for `security.database_privilege_denied` rows after the smoke test
   (there should be none).
9. **Retire the old login:** remove it from every runtime environment and rotate its password.
10. **Add the release job** that runs step 4 before each future revision.

If step 5 or 7 fails, roll back the service to the old `DATABASE_URL`. The roles and grants
can stay in place: they do not change the data. Use `NWOS_ALLOW_PRIVILEGED_DATABASE=true` only
as a time-boxed emergency measure.

## 7. What is guaranteed, and remaining risks

### Guaranteed against the runtime role (tested as the real `nwos_app`)
- **Existing history cannot be rewritten or deleted.** The runtime role has no UPDATE or DELETE
  on `audit_logs`, `owner_exception_events` or `delivery_receipts`. It cannot delete
  `owner_exception_states`, `owner_exception_snoozes` or `drawing_revisions`. Their triggers
  still refuse it too.
- **It cannot switch the protections off:** it cannot disable, drop or replace a trigger or
  function, change a table, skip triggers for its session, grant itself privileges or act as
  another role.
- **Exception state follows the lifecycle:** a state change must be a valid transition and come
  with a matching history event in the same transaction. A severity change, a snooze and a new
  exception must each be recorded.
- **Critical exceptions (Batch 11):**
  - an exception whose **stored** severity is critical cannot be dismissed or snoozed, whatever
    severity the request or the event claims;
  - it cannot be lowered and dismissed or snoozed in the same transaction;
  - a fabricated or unrelated event does not authorise a dismissal or snooze.
- **The locked System Policy rows** (the Sensitive / Strategic ceilings) cannot be changed,
  deactivated or deleted.

### Not guaranteed: a compromised `nwos_app` credential can still create plausible new records
The database cannot tell which person is behind a connection. Anyone holding the runtime
credential can write every row the application can write, like a server bug could:
- **History:** it can **append** plausible-looking audit rows and exception history events,
  including ones that satisfy the lifecycle checks. Examples:
  - a "dismiss" with a reason and a forged actor name;
  - a forged `changed` event lowering a critical exception's stored severity, committed on its
    own, followed by a dismissal or snooze in a **later** transaction. The database cannot
    recompute severity from the business data, and the runtime credential can also change that
    business data itself. What remains:
    - the forged `changed` event is permanent;
    - the server's live view still lists the exception as critical, whatever its stored state
      (tested);
    - the next server action or hourly rule writes the real severity back.
  - a new exception the lifecycle has not recorded yet, recorded first with a false
    non-critical severity. The live view above still applies.

  Every such record is permanent: it cannot change or remove what is already there, including
  its own forged records.
- **Current-state fields outside the lifecycle checks:**
  - exception title, presence, `waiting_for`, `last_activity_at` (making an exception look
    stale or fresh) and fingerprint;
  - the reason and author of an active snooze, and ending a snooze (which makes the exception
    visible again).
- **Ordinary business records:** projects, approvals, decisions, purchase orders, users'
  assignments, and authority rules that are not locked (it could add a rule granting someone
  authority). These are refused by the API, but not by the database.
- **Security audit rows:** it can add misleading `security.*` rows, or flood the audit trail.

So the database protects **what has already been recorded**, and the **shape** of new exception
records. It does not prove that a new record came from a real user action. Detecting forged but
well-formed records needs controls outside the database:
- keep the credential only in the service's secret store and rotate it;
- restrict network access to the database;
- keep the database's own logs (connections and statements) outside the reach of the runtime
  credential;
- review `security.*` audit rows.

### Other remaining risks
- **Administrator credentials.** Anyone holding the administrator, superuser or `nwos_owner` /
  `nwos_migrator` credentials can still change or remove anything, including the protections
  and the history. That is inherent; protect those credentials and keep them out of the
  application.
- **The override.** While `NWOS_ALLOW_PRIVILEGED_DATABASE=true` is in force on a privileged login,
  none of the guarantees above hold (§3).
- **Pre-existing startup race (not from this batch, seen on `main` too):** on a fresh database
  the server-start routing pass and the first scheduled approval-monitor run can both route the
  same approval. The unique index `approval_routes_one_open_idx` refuses the second, so that
  monitor run is recorded as failed and the next run succeeds. No duplicate route is created.
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
