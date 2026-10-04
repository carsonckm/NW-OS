# Core-chain database

Phase 1 moves **Clients → Projects → Work Packages → Work Items** into PostgreSQL
(plain Postgres or Supabase). Every other module still lives in browser localStorage.

## Setup

1. Create a database and set `DATABASE_URL` in `.env` (see `.env.example`).
   For Supabase, use the pooler connection string; TLS is handled by `DATABASE_SSL`.
2. Apply migrations: `npm run db:migrate` (check with `npm run db:status`).
3. Create the first account: `NEW_USER_PASSWORD='…' npm run auth:create-user -- --email … --name … --role "Owner / CEO"`
   (development: `DEV_SEED_PASSWORD='…' npm run auth:seed-dev -- --with-demo-data`).
4. Set `CORE_DATA_SOURCE=database` and restart the server.

The browser asks `GET /api/core/status` on load. It only switches to the database when
the server is configured, connected, has no pending migrations and `CORE_DATA_SOURCE=database`.
Otherwise it keeps using localStorage, exactly as before.

## Moving existing data in

- **From a browser's localStorage:** sign in as a user with `settings.manage` (Owner) with
  the database empty. The
  browser validates its data (`POST /api/core/import?dryRun=true`) and imports it. If any
  record references a missing parent, nothing is imported and the app stays in local mode
  with the reason in the footer tooltip.
- **Demo data from the code:** `npm run db:import-demo` (`-- --dry-run` to only validate).

Imports never overwrite rows that already exist. When the database already has data, it
wins: the browser's previous copy is saved to localStorage under `nw_os_core_backup_<time>`
(last 3 kept) before being replaced.

## How the browser saves

`src/services/coreSync.ts` watches the four arrays in `NWContext`. Every change, from any
screen, is diffed against the last saved state and written via `POST /api/core/sync` in one
transaction. If the database rejects a batch (for example deleting a client that still has
projects), it retries record by record, saves what it can and reports the rest in the footer.
localStorage still holds a copy of everything.

## Schema rules

- `db/migrations/*.sql` run in order, once each, tracked in `schema_migrations`.
- Ids are text so existing ids import unchanged. New API-created ids look like `proj-<uuid>`.
- Foreign keys are `ON DELETE RESTRICT`: a parent with children cannot be deleted.
- A work item's `project_id` must match its work package's project (composite key).
- Status columns only accept the values in `src/types.ts`.
- `server/core/schema.ts` maps every field of the TypeScript types to a column. The compiler
  rejects a type change that isn't mapped, and a test checks the map against the database.

## API (mounted at `/api`)

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/core/status` | Configured / connected / pending migrations / data source |
| GET | `/core/snapshot` | All four collections |
| POST | `/core/sync` | Batch upserts and deletes in one transaction |
| POST | `/core/import[?dryRun=true]` | Validated import, never overwrites |
| GET | `/clients/:id/tree` | Client → projects → work packages → work items |
| GET, POST | `/clients`, `/projects`, `/work-packages`, `/work-items` | List (filter by parent id) / create |
| GET, PATCH, DELETE | `/<resource>/:id` | Read / update / delete |

Every route except `/core/status` requires a signed-in, active user and is checked against
that user's permissions and project scope. See [docs/auth.md](../docs/auth.md).
