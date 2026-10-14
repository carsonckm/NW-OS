# Pilot script: Segar Mart Sdn Bhd — Outlet 12 Retail Fit-Out (synthetic)

All names, people, companies, addresses and figures below are **fictional**. Use no real
customer or employee data until the Owner approves it. Run in **staging** (docs/staging.md).

The same flow is rehearsed automatically on every build (server/modules/pilot.segarMart.test.ts,
on the restricted database role); this script is the human version, through the screens.

## Cast (one synthetic account each; every person activates their own account with a code)

| Role | Pilot person (fictional) | Email (example domain) |
|---|---|---|
| Owner / CEO | Pilot Owner | owner@pilot.example |
| Admin | Pilot Admin | admin@pilot.example |
| Project Manager | Pilot PM | pm@pilot.example |
| Site Supervisor | Pilot Site | site@pilot.example |
| Purchasing | Pilot Buyer | buyer@pilot.example |
| Accountant | Pilot Accounts | accounts@pilot.example |
| Production Manager | Pilot Production | production@pilot.example |
| Client | Puan Aisyah (Segar Mart) | aisyah@segarmart.example |
| Contractor | Encik Hafiz (Cahaya Siling) | hafiz@cahaya.example |

Setup: the operator recovers the Owner (docs/trusted-identity.md §5). The Owner creates the other
accounts in Users; each gets a one-time activation code, handed over individually.

## Project data

- Client: **Segar Mart Sdn Bhd**, Retail.
- Project: **Outlet 12 Retail Fit-Out**, project number SM-2026-012, 1,450 m² sales floor.
- Contract: **RM 650,000** (quotation QT-SM12):
  | Item | Selling (RM) | Estimated cost (RM) |
  |---|---|---|
  | Gondola shelving (80 bays) | 220,000 | 160,000 |
  | Checkout counters and service counter | 160,000 | 110,000 |
  | Ceiling and lighting | 190,000 | 130,000 |
  | Signage | 80,000 | 55,000 |
  | **Total** | **650,000** | **455,000** (gross profit 195,000) |
- Supplier: Rak Jaya Shelving (PO RM 120,000: 80 bays × RM 1,500).
- Subcontractor: Cahaya Siling Sdn Bhd (ceiling and lighting).
- Variation VO-SM12-01: additional chiller-zone lighting, client amount RM 18,000, cost RM 12,000.

## Steps, expected results and checks

Tick each box; note the time taken and anything confusing.

1. **Quotation** (Owner → Accountant)
   - [ ] Owner: Commercial › Enquiry, Tender, then Quotation QT-SM12 with the four lines above.
   - [ ] The server prices it: RM 650,000 selling, RM 455,000 cost, RM 195,000 gross profit.
   - [ ] Internal Review; the **Accountant** approves (someone other than the person who prepared it).
   - [ ] Submitted; the client copy (PDF/view) shows **no cost, margin or internal notes**.
2. **Award and project setup** (Owner)
   - [ ] Accepted → Convert to project SM-2026-012; contract RM 650,000; status Active.
   - [ ] Assign the PM, Site Supervisor and Production Manager (Users › projects).
   - [ ] The client account sees only Outlet 12.
3. **Drawings** (PM → Owner)
   - [ ] Drawings › Upload: SM12-A-101 Gondola layout, **attach the real PDF**.
   - [ ] Open drawing file shows the PDF. The client gets "not found" while it is a draft.
   - [ ] Internal Review → the Owner approves. Now the client can open it.
   - [ ] Upload Rev 2 with a new file; Rev 1 becomes Superseded, its file still opens for staff.
4. **Purchasing** (PM, Purchasing, Owner, Site)
   - [ ] Material request for 80 gondola bays.
   - [ ] PO PUR-SM12-01, RM 120,000 (computed by the server).
   - [ ] Major Purchase approval: the PM is refused; **the Owner approves**.
   - [ ] Issue the PO; the Site Supervisor records goods received (80/80): Goods Received.
5. **Subcontractor** (Admin, PM)
   - [ ] Admin: Contractors › add **Cahaya Siling Sdn Bhd**. The PM cannot see it yet.
   - [ ] PM: work package CEILING & LIGHTING with Cahaya Siling: now the PM sees it, on Outlet 12 only.
   - [ ] Admin: Users › new Contractor account for Cahaya Siling (code handed over).
6. **Delivery and installation** (PM, Site, Contractor)
   - [ ] Delivery DEL-SM12-01 scheduled; installation job INS-SM12-01 for Cahaya Siling.
   - [ ] The subcontractor signs in, sees **only its own job**, and adds a site photo.
   - [ ] Site Supervisor: site QC Pass **with photos attached**; job Completed.
7. **Site issue and exception** (Site, PM, Owner)
   - [ ] Site: raise an issue (e.g. ceiling height clash at the chiller aisle), attach a photo.
   - [ ] PM assigns it; if left overdue, it appears in the Owner Exception Center.
8. **Variation** (PM, Owner, Client)
   - [ ] VO-SM12-01: Costing → Internal Approval; the PM cannot pass it to the client; **the Owner does**.
   - [ ] The client sees the variation **without the internal cost** and approves it.
   - [ ] Contract summary: RM 650,000 + RM 18,000 = **RM 668,000**.
9. **Invoice and payment status** (Accountant, Owner)
   - [ ] Supplier invoice RJ-SM12-01 RM 120,000 against the PO; the Owner approves; actual cost RM 120,000.
   - [ ] Progress claim IPC-SM12-01: cumulative RM 200,000, retention RM 10,000, net RM 190,000;
     Certified → payment received → Paid.
10. **Owner reporting and close-out** (Owner)
    - [ ] Profitability: selling RM 668,000, budget RM 455,000, committed and actual RM 120,000.
    - [ ] Owner Center shows only true exceptions; the decision trail shows who approved what.
    - [ ] Handover signed; then Completed → Closed (closing is refused before the signed handover).

## Success criteria

- Every step done through the screens, **no database edits**.
- Each approval decided by the right person; refusals where shown above.
- Figures reconcile exactly as above.
- Clients and the subcontractor see only what is theirs (files included).
- Every uploaded file opens for those allowed and returns "not found" for anyone else.
- No data lost across a service restart/redeploy (restart once during the pilot).
- `/api/health` stays 200 throughout; the scheduler stays `running`.
- No `security.database_privilege_denied` rows in the audit trail.

## Stop conditions (record and stop the pilot)

- An approval decided by someone without authority, or Owner routing that skips the Owner.
- A user sees another project's records or files, or a client sees internal costs.
- Lost or changed data, or a file that does not match what was uploaded.
- A step that needs manual SQL to continue.
- The scheduler not running, or the service not recovering after a restart.
- Any credential or activation code exposed in logs, screens or the audit trail.
