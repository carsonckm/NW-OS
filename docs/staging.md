# Staging environment (pilot readiness)

**Status: nothing here has been created.** This repository's session had no access to any Google
Cloud or Supabase account, so whether a Cloud Run service, an AI Studio deployment or a Supabase
project already exists — and whether it holds data — is unknown. Step 0 below finds out, read-only.
No step creates a paid resource without the owner's confirmation.

Preferred region: **Singapore** (Cloud Run `asia-southeast1`, Supabase "Southeast Asia (Singapore)").

## 1. Architecture

| Part | Choice | Why |
|---|---|---|
| Application host | Cloud Run service `nwos-staging`, 1 vCPU / 1 GiB, **minimum 1 instance, CPU always allocated** (instance-based billing), maximum 2 | The automation scheduler (SLA escalation, delegation expiry, Owner exception lifecycle) runs inside the server; with request-based billing the CPU is throttled between requests and the scheduler stalls. Rule runs are leased in the database, so a second instance is safe. |
| Release step | Cloud Run job `nwos-staging-migrate` (same image, `node dist/tools/db-migrate.cjs`) | Migrations run with the migrator credential, which the service never has. |
| Database | Supabase PostgreSQL (Singapore), Data API **disabled** | Managed backups; NW OS uses only a direct PostgreSQL connection. |
| Database roles | `nwos_owner` (owns everything, no login), `nwos_migrator` (migrations), `nwos_app` (the server; restricted) | docs/database-privileges.md, docs/trusted-identity.md |
| Files | In PostgreSQL (`files`, `file_contents`; migration 032) | Private by construction (no public URL), covered by the database backups, authorized per record by the server. 25 MB per file. |
| Secrets | Secret Manager: `nwos-staging-database-url-app` (service), `nwos-staging-database-url-migrator` (job only) | The service refuses to start with the migrator or administrator URL. |
| HTTPS | Cloud Run's managed TLS (`*.run.app`) | Session cookie is `HttpOnly; Secure; SameSite=Lax` with `NODE_ENV=production` (the image's default). |
| Client addresses | `TRUST_PROXY=1` (verified in step 9) | Sessions and the audit trail record the address Cloud Run's front end saw, never one the client wrote. |
| Health | `/api/health/live` (probes), `/api/health` (uptime check: database within 2 s, scheduler ticking; 503 otherwise) | Nothing sensitive in either answer. |

Files in this repository: `Dockerfile`, `deploy/cloudrun/staging-service.yaml`,
`deploy/cloudrun/staging-migrate-job.yaml`.

### Platform capabilities this relies on (checked against vendor documentation, October 2026)

- Cloud Run instance-based billing ("CPU always allocated") keeps CPU for the whole instance
  lifecycle and is the documented setting for background work; with minimum instances it keeps
  one instance running. Idle instances may still be replaced at any time (the scheduler's database
  lease covers that). [Cloud Run billing settings](https://docs.cloud.google.com/run/docs/configuring/cpu-allocation)
- Supabase's Data API exposes `public` by default; it can be disabled entirely, recommended when
  only direct PostgreSQL connections are used. The switch is in the dashboard (Integrations → Data
  API); it is not in the Management API or Terraform. Supabase will stop exposing new `public`
  tables by default on 30 October 2026. [Hardening the Data API](https://supabase.com/docs/guides/api/hardening-data-api)
- Defence in depth: every migration revokes the Data API roles (`anon`, `authenticated`,
  `service_role`) from NW OS's tables, sequences and functions, and `npm run db:privileges` fails
  while any of them can read or write a table (tested: server/db/platformRoles.test.ts).
- Supabase Pro: daily backups kept 7 days; point-in-time recovery is a paid add-on. (Third-party
  summaries; confirm on [supabase.com/pricing](https://supabase.com/pricing) before purchase.)
- **Not verified:** how Cloud Run builds `X-Forwarded-For` (no first-party documentation found);
  whether Supabase's `postgres` role may run the role bootstrap (docs/database-privileges.md §6).
  Both are checked in the setup below.

## 2. Estimated monthly cost (staging)

List prices as found in October 2026, converted at RM 4.2–4.5 per USD. **Confirm on the vendors'
pages before approving**; Cloud Run's Singapore (tier 2) rates come from a third-party table.

| Item | Always on | Only during test windows |
|---|---|---|
| Cloud Run, 1 vCPU / 1 GiB, 1 instance, CPU always allocated (~USD 0.0000216 per vCPU-second, ~USD 0.0000024 per GiB-second) | ~USD 62 → **RM 260–280** | scale to 0 between windows: **RM 0–40** |
| Supabase Pro organisation (includes one Micro project, 7-day daily backups) | USD 25 → **RM 105–115** | same |
| Secret Manager, Artifact Registry, Cloud Logging | < USD 3 → **≤ RM 15** | same |
| Gemini (optional; staging can run without AI) | RM 0–20 | RM 0–10 |
| **Total** | **≈ RM 380–430 / month** | **≈ RM 120–180 / month** |

File storage and backups (in addition to the above; prices from Supabase's and Google's pricing
pages as found in October 2026, **confirm before approving**):

| Item | Estimate |
|---|---|
| Database disk: Pro includes 8 GB per project, then ~USD 0.125 per GB-month | the pilot (a few hundred drawings and photos, ≤ 2 GB) stays inside the 8 GB: **RM 0**. Every further 10 GB of files ≈ RM 5–6 / month |
| Supabase daily backups (7 days, Pro) | included |
| Weekly `pg_dump` copy in Cloud Storage, Singapore, 4–5 copies kept (~USD 0.02–0.03 per GB-month) | 2 GB database → 10 GB stored: **≤ RM 1.5 / month** |

Production later adds a second Supabase project (~USD 10 compute on the same Pro organisation,
about RM 45) and its own Cloud Run service (about RM 260–280); point-in-time recovery, if wanted,
about RM 420–450 more.

## 3. Setup (operator, with approval)

**0. Find what exists (read-only).** In the Google Cloud console and the Supabase dashboard:
list projects, Cloud Run services / jobs, Artifact Registry repositories and Supabase projects.
For any that exist, record their region, owner and whether they hold real data. Change nothing.

**1. Create (approval: paid resources).**
- Google Cloud project `nwos-staging` (billing account, budget alert at RM 500/month);
  enable Cloud Run, Artifact Registry, Secret Manager, Cloud Build.
- Artifact Registry repository `nwos` in `asia-southeast1`.
- Service accounts: `nwos-staging-runtime` (Secret Manager accessor on the app secret only) and
  `nwos-staging-release` (accessor on the migrator secret only).
- Supabase project `nwos-staging` in Singapore on the Pro plan; a strong database password.

**2. Disable the Supabase Data API** (dashboard → Integrations → Data API → disable, or remove
`public` from the exposed schemas). Record a screenshot.

**3. Roles.** From an operator machine, with the Supabase **direct or session** connection
(port 5432) as `postgres`:
```
DATABASE_ADMIN_URL='postgres://postgres:…@…:5432/postgres' \
NWOS_MIGRATOR_PASSWORD='…' NWOS_APP_PASSWORD='…' npm run db:bootstrap-roles
```
Expect "Roles ready". On any error nothing changed (one transaction): stop and investigate.
The administrator may be a non-superuser with CREATEROLE that owns the database (CREATEDB as well
for `--transfer-database`); see docs/database-privileges.md §6. Check it first:
`SELECT rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user;`
Passwords: generated, at least 32 characters, stored only in Secret Manager / the operator's vault.

**4. Secrets.** `nwos-staging-database-url-app` = the `nwos_app` URL as the service will use it
(Supabase transaction pooler, port 6543, or session pooler); `nwos-staging-database-url-migrator`
= the `nwos_migrator` URL on port 5432 (session mode). `DATABASE_SSL=require`.

**5. Build and push.** `gcloud builds submit --tag asia-southeast1-docker.pkg.dev/PROJECT_ID/nwos/nwos:<git-sha>`
(or `docker build` + `docker push`). The image runs `npm ci`, `npm run build`, keeps production
dependencies only, and runs as the unprivileged `node` user.

**6. Migrate.** Replace `PROJECT_ID`/`IMAGE_TAG` in `deploy/cloudrun/staging-migrate-job.yaml`,
`gcloud run jobs replace …`, then `gcloud run jobs execute nwos-staging-migrate --wait`.
Then, from the operator machine, `DATABASE_URL=<app URL> npm run db:privileges` must print `OK`
(this also fails if a Data API role can reach a table), and the ownership query in
docs/database-privileges.md §6 step 4 returns no rows.

**7. Deploy.** Replace the placeholders in `deploy/cloudrun/staging-service.yaml`,
`gcloud run services replace …`. Allow unauthenticated access to the service (NW OS has its own
sign-in) only after step 8 passes on the internal URL, or keep it behind IAP for the pilot.

**8. First accounts.** On the operator machine with the migrator URL:
`npm run auth:create-user -- --email owner@<pilot domain> --name "<Owner>" --role "Owner / CEO"`
prints a one-time activation code; the Owner sets a password on the sign-in screen
("Set a new password with a code"). The Owner then creates pilot staff in Users, each with their own
code. Synthetic pilot accounts only (docs/pilot/segar-mart-outlet-12.md).

**9. Verify** (record each result):
- `GET /api/health` → 200, `database: ok`, `scheduler: running` (within a minute of start).
- Sign in from a known public address; `SELECT ip FROM audit_logs WHERE action = 'login' ORDER BY id DESC LIMIT 1`
  (as the migrator) shows that address. If it shows a Google address instead, change `TRUST_PROXY`
  (e.g. to 2) and redeploy; if it shows the address only when the client also sends a forged
  `X-Forwarded-For`, lower it. Never set it to `true`.
- Upload a drawing PDF and a site photo; download them as the Owner; confirm a Client account gets
  404 for a draft revision's file. `SELECT pg_size_pretty(sum(size_bytes)) FROM files`.
- An Admin cannot reset the Owner; a Project Manager sees only their projects' subcontractors.
- With the migrator: `SELECT has_table_privilege('anon', 'users', 'SELECT')` → false.
- The pilot script (docs/pilot) end to end; the browser acceptance scripts can also be pointed at
  staging with synthetic data.

**10. Backups and restore drill.**
- Supabase daily backups: confirm one exists after 24 hours (dashboard → Database → Backups).
- Weekly logical backup for an independent copy: `pg_dump -Fc` with the migrator URL to a private
  Cloud Storage bucket (uniform access, no public access, 30-day retention).
- Restore drill before the pilot: restore the latest dump into a scratch Supabase project (or a
  local PostgreSQL), run `db:privileges` against it, start the image against it, sign in, open a
  stored drawing file. Record the time it took.

**11. Monitoring.**
- Cloud Monitoring uptime check on `https://<service>/api/health` every 5 minutes, alert by email
  after 2 failures (a 503 means the database is unreachable or the scheduler stopped).
- Log-based alerts: `[db]`, `[security]`, `[config]`, `[api]` errors; Cloud Run instance restarts.
- Weekly audit review (migrator): `login.failed`, `login.locked`, `auth.code_issued`,
  `auth.password_set`, `security.owner_recovery`, `security.database_privilege_denied`,
  `file.upload` volume, rows with `actor_verified = false` for people.

## 4. File storage: capacity, backups and restore

Files live in the database (`file_contents.bytes`, at most 25 MB each), so they share its disk,
its backups and its restores. What that means in practice:

- **Capacity.** Uploads count against the Supabase project's disk (8 GB included on Pro; the
  disk grows automatically and is billed per GB beyond that). Each file is stored once; a new
  drawing revision is a new file, and files are never deleted (`files` and `file_contents` are
  append-only for the runtime role), so the size only grows. Check monthly:
  `SELECT pg_size_pretty(sum(size_bytes)) AS files, count(*) FROM files;` and
  `SELECT pg_size_pretty(pg_database_size(current_database()));`. Plan a move to object storage
  if files pass about 20 GB or single uploads routinely approach the 25 MB limit.
- **Backups.** Supabase's daily backups include the files automatically. The weekly `pg_dump`
  grows with them (compressed images and PDFs barely compress further): budget the bucket for
  roughly the database size × copies kept, and use `pg_dump -Fc` (one file, restorable per table).
- **Restore time.** A restore copies every file's bytes, so it takes longer as files accumulate:
  measure it in the restore drill (§3 step 10) and record database size and duration together;
  repeat the drill whenever the database has doubled. Restoring is all-or-nothing for the
  database: there is no restore of a single file (an earlier revision's file is still there,
  files are never overwritten).
- **Integrity.** Every stored file has its SHA-256 (checked by the database on insert). After a
  restore, as the migrator:
  `SELECT count(*) FROM files f JOIN file_contents c ON c.file_id = f.id WHERE encode(sha256(c.bytes), 'hex') <> f.sha256;`
  must return 0, and `SELECT count(*) FROM files f LEFT JOIN file_contents c ON c.file_id = f.id WHERE c.file_id IS NULL;` must return 0.
- **Failed uploads** leave nothing behind: the metadata, the bytes and the audit row are written in
  one transaction. A drawing file uploaded but not yet attached to a revision is visible only to
  its uploader and staff who may upload drawings.

## 5. Subcontractor accounts

- A Contractor account works only while its subcontractor is **active**: deactivating a
  subcontractor immediately hides every record from its accounts, whatever project assignments or
  work packages still name it. Reactivating restores access. (Deactivate the person's account in
  Users as well when they leave.)
- Upgrading an existing database creates **placeholder** subcontractors for ids that work records
  referenced but that were never registered (company name "Unregistered subcontractor …",
  shown with an "Unverified placeholder" badge). They are not verified companies: no Contractor
  account can be linked to one until its contact person and a phone or email are recorded, which
  clears the flag. Existing accounts already linked to such an id keep working; review them first.

## 6. Rollback and recovery

- Application: redeploy the previous image tag (`gcloud run services update-traffic … --to-revisions`),
  only if its migrations are the same.
- Database: restore the last backup into a new project and repoint the secrets. Writes after the
  backup are lost unless recovered from another source (docs/trusted-identity.md §7).
- Lost Owner access: `npm run auth:recover-owner` with the migrator credential (§5 there).
