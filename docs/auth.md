# Authentication and access control

Sign-in is on whenever the server has a database (`DATABASE_URL`). Without one the app
runs in **demo mode**: no sign-in, the header role switcher, data in browser localStorage.
Demo mode is for evaluation only and protects nothing.

## How a request is authorised

1. **Session:** `POST /api/auth/login` checks the password (scrypt hash) and sets an
   `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `NODE_ENV=production`). Only a SHA-256
   hash of the token is stored in `sessions`. Sessions end after 12h idle or 7 days, on
   sign-out, and when the user is deactivated or their role or password changes.
2. **Active user:** every request re-reads the user; a deactivated user is rejected at once.
3. **Permission:** `User → Role → Permissions`, using the role table in
   `src/utils/permissions.ts`, evaluated on the server (`server/auth/permissions.ts`).
4. **Scope:** `server/auth/access.ts` decides which projects and records the user may touch.

Nothing the browser sends about identity is trusted: role or name fields in bodies, query
strings, headers or localStorage are ignored, and on `/api/ai` and `/api/gateway` they are
overwritten with the signed-in user.

## Who sees what (core chain)

| Role | Projects in scope |
| --- | --- |
| Owner / CEO, Admin, Purchasing, Accountant | All |
| Production Manager | All, or only assigned projects if any are assigned |
| Project Manager | Projects they manage (`project_manager_id`) + assigned |
| Site Supervisor | Projects they supervise (`site_supervisor_id`) + assigned |
| Contractor | Projects with their work packages + assigned; within them, only their own packages and items |
| Client | Their own client's projects only |
| Production Staff | Assigned projects only |

Within scope, each action still needs its permission, e.g. `projects.create`,
`work_items.edit`. A user with only `work_items.complete` (site supervisor, contractor) may
change status, progress, delivery and installation status, notes and photos of work items, nothing else. Contract values are
removed from responses (and ignored on writes) for roles that may not see project
financials. Records outside a user's scope answer **404**, so their existence isn't revealed;
a missing permission answers **403**; no session answers **401**.

## Operational modules (Phase 3)

Every module route runs the same checks: session, active user, the module's permission
(`server/modules/registry.ts`), and scope. Records belong to a project (or a production
order, which belongs to a project) and are only visible inside the user's project scope.
Contractors additionally only see records tied to their own contractor id, work items or
packages (drawings and documents of their projects excepted). Clients only see their own
projects, and never purchasing, cost, production or internal costing records.
Production Staff and Site Supervisors have no access to purchase orders, cost ledger,
quotations, price database or profitability.

Rules enforced on the server, whatever the browser sends:

- **Drawings:** a revision is never overwritten; uploading needs `drawings.upload`
  (or `drawings.create_production` for NW drawings), approving needs `drawings.approve`.
- **Production:** an order must reference an approved, current client revision and an
  approved NW production drawing linked to it. Orders on a superseded or unapproved revision
  are rejected; existing ones are flagged and can be parked (Blocked / Cancelled) but not
  advanced.
- **Delivery:** defaults to contractor-arranged. Recording receipt needs `delivery.receive`,
  stores an append-only receipt with the signed-in receiver, and never starts installation.
- **Site QC:** the inspector is the signed-in user. A Fail creates (or links) a
  rectification issue, and the work item / installation can't be completed until a later
  inspection passes.
- **Approvals:** requester and decider come from the session; nobody approves their own
  request; only Owner, `approvals.decide`, the assigned user or approver role may decide;
  decisions are final.
- **Variations:** Identified → Costing → Internal Approval → Client Approval → Approved →
  Implemented → Closed, one step at a time (Costing may be skipped), each gated by
  permission; amounts freeze once approved. Only approved variations change the current
  contract value; the original contract value never changes.
- **Audit:** logins, user changes, every create/update/delete and each workflow step are
  written to `audit_logs`, which nobody can edit or delete.

## Accounts

- **First real account (production):**
  `NEW_USER_PASSWORD='…' npm run auth:create-user -- --email you@company.com --name "Your Name" --role "Owner / CEO"`
- **More accounts:** `POST /api/users` (needs `users.manage`; only an Owner can create or
  change Owner accounts; nobody can change their own role or deactivate themselves).
  Assign projects with `PUT /api/users/:id/projects`.
- **Development accounts:** `DEV_SEED_PASSWORD='…' npm run auth:seed-dev -- --with-demo-data`
  creates one `<role>@dev.nwos.local` account per role, flagged `is_dev_seed`. The script
  refuses to run with `NODE_ENV=production`, has no built-in password, and the server
  refuses to sign in dev-seed accounts when `NODE_ENV=production`.

## Known limits

- Users, notifications, automation rules and a few settings screens are still browser-side
  (see the Phase 3 report). Demo data for the server is shipped in the JavaScript bundle
  for demo mode; in database mode the server only returns what the user may see.
- The login rate limit is in memory, per server process.
- The User Management screen still edits browser-side demo users; real accounts are managed
  through the API or the CLI.
