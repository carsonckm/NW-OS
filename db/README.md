# Database

PostgreSQL (plain Postgres or Supabase) is the source of truth for the core chain
(**Clients → Projects → Work Packages → Work Items**, Phase 1) and, since Phase 3, for every
operational module: drawings and revisions, documents, issues, tasks, escalations,
approvals, variations, client change requests, QC records, site measurements, production
(orders, parts, CNC, assembly, finishing, factory QC, packing, production issues, CNC files,
materials), delivery, site receipts, installation, site QC, handover, and commercial
(enquiries, tenders, quotations, price database, baselines, suppliers, purchase orders, goods
received, material requests, cost ledger, invoices, cost-leak alerts, cashflow, claims,
payments). The list lives in `server/modules/registry.ts` and
`src/services/syncedCollections.ts`.

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
  browser validates its data (`POST /api/data/import?dryRun=true`) and imports it. If any
  record references a missing parent, nothing is imported and the app stays in local mode
  with the reason in the footer tooltip.
- **Demo data from the code:** `npm run db:import-demo` (`-- --dry-run` to only validate).

Imports never overwrite rows that already exist. When the database already has data, it
wins: the browser's previous copy is saved to localStorage under `nw_os_core_backup_<time>`
(last 3 kept) before being replaced.

## How the browser saves

`src/services/coreSync.ts` watches every database-backed array in `NWContext`. Every change,
from any screen, is diffed against the last saved state and written via `POST /api/data/sync`
in one transaction; the server authorises each record and applies the business rules. If the database rejects a batch (for example deleting a client that still has
projects), it retries record by record, saves what it can and reports the rest in the footer.
localStorage still holds a copy of everything.

## Schema rules

- `db/migrations/*.sql` run in order, once each, tracked in `schema_migrations`.
- Ids are text so existing ids import unchanged. New API-created ids look like `proj-<uuid>`.
- Foreign keys are `ON DELETE RESTRICT`: a parent with children cannot be deleted.
- A work item's `project_id` must match its work package's project (composite key).
- Status columns only accept the values in `src/types.ts`.
- Module tables are hybrid: ids, relationships, statuses and money/rule fields are real
  columns with foreign keys and CHECKs; the full record is also kept in a `data` jsonb column
  so the existing screens get back exactly what they saved.
- `drawing_revisions` rows can never be deleted, their file, revision label and content
  hash never change, and a superseded revision can't be reinstated (trigger). Client
  revisions only use the review statuses (Draft, Internal Review, Approved, Superseded,
  Rejected), only an Approved revision can be current, and a drawing has at most one current
  revision (migration 008). A work item
  stores the exact revision it was created from (`source_drawing_revision_id`); a
  production order stores the exact client and NW revisions it was checked against.
- `audit_logs` and `delivery_receipts` are append-only (UPDATE/DELETE/TRUNCATE blocked).
- A site QC result of Fail must reference a rectification issue (CHECK).
- Production orders and work items accept the On Hold production status (migration 008).
- Commercial baselines store only their inputs; committed, actual and forecast cost, contract
  value and gross profit are computed by the server on every read.
- Every write, including the core REST endpoints, writes its audit row in the same
  transaction: if either fails, neither is kept.
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
| GET | `/data/status` | As `/core/status` plus whether the whole database is empty |
| GET | `/data/snapshot` | Every core and module collection the user may see |
| POST | `/data/sync` | Batch upserts and deletes across all collections, one transaction |
| POST | `/data/import[?dryRun=true]` | Validated import of everything, never overwrites (`settings.manage`) |
| GET, POST | `/<module>` (e.g. `/drawings`, `/production-orders`, `/deliveries`, `/site-qc`, `/variations`, `/purchase-orders`, `/cost-ledger`) | List (filter by declared columns) / create |
| GET, PATCH, DELETE | `/<module>/:id` | Read / update / delete (delete only where allowed) |
| POST | `/drawings/:id/revisions` | Add a revision as Draft; nothing is overwritten or approved |
| POST | `/drawings/:id/revisions/:revId/status` | Internal Review, Approved (supersedes the previous approved revision), Rejected or back to Draft |
| POST | `/approvals/:id/decision` | Approve / reject / request changes (server decides who may) |
| POST | `/variations/:id/transition` | Move a variation one step through its workflow |
| GET | `/projects/:id/contract-summary` | Original contract, approved / pending variations, current contract value |
| GET | `/projects/:id/profitability` | Selling price, estimated / committed / actual / forecast cost, project gross profit |
| GET | `/audit-logs` | Server audit trail (`audit.view`), read-only |

The `/core/*` endpoints from Phase 1 still work for the four core collections.

Every route except `/core/status` requires a signed-in, active user and is checked against
that user's permissions and project scope. See [docs/auth.md](../docs/auth.md).
