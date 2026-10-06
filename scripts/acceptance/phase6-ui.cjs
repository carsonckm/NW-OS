/**
 * Phase 6 Batch 2 review: the approval screens show what the server's authority resolver
 * decides, in the browser, signed in as the real dev accounts. Each step checks what the
 * screen offers against what the API does and what PostgreSQL holds.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-ui.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p6u-${RUN}`;
const THIRD = `proj-p6t-${RUN}`;
const OTHER = `proj-p6o-${RUN}`;
const q = L.psql;
const out = [];
let failures = 0;
const record = (n, what, evidence, pass) => {
  out.push({ n, what, evidence, pass });
  if (!pass) failures++;
  console.log(`${n} [${what}] ${pass ? 'PASS' : 'FAIL'} — ${evidence}`);
};
const call = async (page, method, path, body, status) => {
  const r = await L.api(page, method, path, body);
  if (status && r.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
  return r;
};
const tab = async (page, name) => {
  await L.nav(page, name);
  await page.waitForTimeout(700);
};
const fresh = async (page, project = P) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
  await page.getByLabel('Active Project').selectOption(project).catch(() => {});
  await page.waitForTimeout(400);
};
/** What the drawing viewer offers this person for the drawing's revision under review. */
const drawingScreen = async (page, number, project = P) => {
  await fresh(page, project);
  await L.nav(page, 'Drawings');
  await page.waitForTimeout(600);
  await L.vis(page.getByRole('button', { name: new RegExp(number) })).click();
  await page.waitForTimeout(1500);
  const approve = await page.getByRole('button', { name: 'Approve Revision' }).count();
  const note = page.getByTestId('authority-note').first();
  const code = (await note.count()) ? await note.getAttribute('data-reason-code') : null;
  const text = code ? (await note.innerText()).split('\n')[0] : null;
  return { approve: approve > 0, code, text };
};
/** What the approvals screen offers this person for one request. */
const approvalScreen = async (page, number) => {
  await fresh(page);
  // Roles without approvals.view (the Client) have no approvals screen at all.
  if (!(await page.locator('header div.overflow-x-auto button', { hasText: 'Approvals' }).count())) return { approve: false, code: 'NO_APPROVALS_SCREEN' };
  await tab(page, 'Approvals & Governance');
  await page.getByPlaceholder('Search approvals...').fill(number);
  await page.waitForTimeout(1500);
  const card = page.locator('div.bg-white.rounded-2xl.p-5').filter({ hasText: number }).first();
  const approve = await card.getByRole('button', { name: 'Approve Request' }).count();
  const note = card.getByTestId('authority-note');
  const code = (await note.count()) ? await note.getAttribute('data-reason-code') : null;
  return { approve: approve > 0, code };
};

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const prodMgr = await as('production-manager');
    const client = await as('client');
    const site = await as('site-supervisor');
    const purchasing = await as('purchasing');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    const clientId = q(`select client_id from users where email='client@dev.nwos.local'`);
    for (const [id, name] of [[P, `P6 UI ${RUN}`], [OTHER, `P6 Other ${RUN}`], [THIRD, `P6 Third ${RUN}`]]) {
      await call(owner, 'POST', '/api/projects', { id, project_number: `NW-${id.toUpperCase()}`, project_name: name, client_id: clientId, site_address: 'KL', contract_value: 90000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);
    }
    let d = 0;
    /** A new drawing on P with one client revision under internal review. */
    const drawing = async (project = P) => {
      const n = ++d;
      const id = `dwg-${RUN}-${n}`;
      const number = `P6U-${RUN}-${n}`;
      await call(pm, 'POST', '/api/drawings', { id, project_id: project, drawing_number: number, title: `Panel ${n}`, category: 'Carpentry', created_at: '2026-10-01', revisions: [], nw_production_drawings: [] }, 201);
      await call(pm, 'POST', `/api/drawings/${id}/revisions`, { id: `${id}-r1`, revision: 'Rev 1', title: 'Rev 1', file_url: `/p6u-${n}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing' }, 201);
      await call(pm, 'POST', `/api/drawings/${id}/revisions/${id}-r1/status`, { status: 'Internal Review' }, 200);
      return { id, rev: `${id}-r1`, number };
    };
    const apiApprove = (page, dw) => call(page, 'POST', `/api/drawings/${dw.id}/revisions/${dw.rev}/status`, { status: 'Approved' });
    const status = (dw) => q(`select approval_status from drawing_revisions where id='${dw.rev}'`);

    // 1. Baseline permission only: no Approve on screen, the API agrees.
    const d1 = await drawing();
    const s1 = await drawingScreen(pm, d1.number);
    const a1 = await apiApprove(pm, d1);
    record(1, 'Baseline only (PM, drawings.review, no rule)', `screen Approve: ${s1.approve}, note ${s1.code}; API ${a1.status} ${a1.body.reason_code}`, !s1.approve && s1.code === 'NO_MATCHING_AUTHORITY' && a1.status === 403 && a1.body.reason_code === 'NO_MATCHING_AUTHORITY');
    const s1b = await drawingScreen(prodMgr, d1.number).catch(() => ({ approve: false, code: 'not visible' }));
    record('1b', 'Baseline only (Production Manager)', `screen Approve: ${s1b.approve}, note ${s1b.code}`, !s1b.approve);

    // 2. Normal + delegated PM: Approve shown, server allows, audit names the rule.
    const rule = (await call(owner, 'POST', '/api/authority/rules', { name: `PM drawings ${RUN}`, description: 'Routine drawing approvals on the UI project', effect: 'allow', decision_type: 'drawing', target_role: 'Project Manager', project_id: P, priority: 200 }, 201)).body;
    const s2 = await drawingScreen(pm, d1.number);
    if (s2.approve) {
      await pm.getByRole('button', { name: 'Approve Revision' }).click();
      await L.settle(pm);
    }
    const audit2 = q(`select coalesce(after->'authority'->>'matched_rule_code','-') || ' ' || (after->'authority'->>'reason_code') from audit_logs where action='drawing.revision.approve' and entity_id='${d1.rev}'`);
    record(2, 'Normal + delegated PM (UI)', `${rule.code}; screen Approve: ${s2.approve}; clicked -> revision ${status(d1)}; audit ${audit2}`, s2.approve && status(d1) === 'Approved' && audit2 === `${rule.code} ALLOWED`);

    // 3-4. Sensitive / Strategic: the same PM sees "Owner approval required"; API refuses; Owner approves on screen.
    let n = 3;
    for (const level of ['Sensitive', 'Strategic']) {
      await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: level, reason: `UI acceptance: ${level}` }, 200);
      const dw = await drawing();
      const s = await drawingScreen(pm, dw.number);
      const api = await apiApprove(pm, dw);
      const o = await drawingScreen(owner, dw.number);
      if (o.approve) {
        await owner.getByRole('button', { name: 'Approve Revision' }).click();
        await L.settle(owner);
      }
      record(n++, `${level} + same PM (UI)`, `PM screen Approve: ${s.approve}, note "${s.text}" ${s.code}; PM API ${api.status} ${api.body.reason_code}; Owner screen Approve: ${o.approve} -> revision ${status(dw)}`, !s.approve && s.code === 'SENSITIVITY_BLOCKED' && /Owner approval required/.test(s.text) && api.status === 403 && api.body.reason_code === 'SENSITIVITY_BLOCKED' && o.approve && status(dw) === 'Approved');
    }
    await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Normal', reason: 'UI acceptance: back to normal' }, 200);
    const d5 = await drawing();
    const s5 = await drawingScreen(pm, d5.number);
    record(5, 'Back to Normal (UI)', `PM screen Approve: ${s5.approve}`, s5.approve);

    // 6. Authority for another project only: screen and API say OUT_OF_SCOPE.
    await call(owner, 'POST', `/api/authority/rules/${rule.id}/deactivate`, { reason: 'UI acceptance: move to the other project' }, 200);
    const other = (await call(owner, 'POST', '/api/authority/rules', { name: `PM drawings other ${RUN}`, description: 'Other project only', effect: 'allow', decision_type: 'drawing', target_role: 'Project Manager', project_id: OTHER, priority: 200 }, 201)).body;
    // A project where the PM never had drawing authority; their only drawing rule is for OTHER.
    const d6 = await drawing(THIRD);
    const s6 = await drawingScreen(pm, d6.number, THIRD);
    const a6 = await apiApprove(pm, d6);
    record(6, 'Wrong project authority (UI/API)', `${other.code} on ${OTHER}; screen Approve: ${s6.approve}, note ${s6.code}; API ${a6.status} ${a6.body.reason_code}`, !s6.approve && s6.code === 'OUT_OF_SCOPE' && a6.status === 403 && a6.body.reason_code === 'OUT_OF_SCOPE');
    await call(owner, 'POST', `/api/authority/rules/${other.id}/deactivate`, { reason: 'UI acceptance finished' }, 200);

    // 7. Client: an internal request assigned to Client is not theirs; client consent unchanged.
    const req = async (type, approver, requester = pm) => {
      const id = `apr-p6u-${RUN}-${type.replace(/\W/g, '').slice(0, 8)}-${approver.replace(/\W/g, '').slice(0, 6)}`;
      await call(requester, 'POST', '/api/approvals', { id, approval_number: id.toUpperCase(), approval_type: type, title: `${type} ${RUN}`, description: 'UI acceptance', project_id: P, project_name: 'P6 UI', assigned_approver_role: approver, date_requested: '2026-10-06', decision: 'Pending', created_at: '', updated_at: '' }, 201);
      return { id, number: id.toUpperCase() };
    };
    const internal = await req('Safety-Critical Decision', 'Client');
    const c7 = await approvalScreen(client, internal.number);
    const a7 = await call(client, 'POST', `/api/approvals/${internal.id}/decision`, { decision: 'Approved' });
    record(7, 'Client, internal request assigned to Client', `screen Approve: ${c7.approve} (${c7.code}); API ${a7.status} ${a7.body.reason_code}; decision ${q(`select decision from approvals where id='${internal.id}'`)}`, !c7.approve && ['INSUFFICIENT_PERMISSION', 'NO_APPROVALS_SCREEN'].includes(c7.code) && a7.status === 403 && a7.body.reason_code === 'INSUFFICIENT_PERMISSION' && q(`select decision from approvals where id='${internal.id}'`) === 'Pending');
    const consent = await req('Client Scope Change', 'Client');
    const r7b = (await call(client, 'GET', `/api/authority/resolve?items=approval:${consent.id}:approve`, undefined, 200)).body[0];
    const a7b = await call(client, 'POST', `/api/approvals/${consent.id}/decision`, { decision: 'Approved' });
    record('7b', 'Client consent unchanged (own project)', `resolver for the client: ${r7b.allowed} (${r7b.basis}); API ${a7b.status}; decision ${q(`select decision from approvals where id='${consent.id}'`)}`, r7b.allowed && r7b.basis === 'client_consent' && a7b.status === 200);

    // 8. Major Purchase assigned to a role without purchasing.view.
    const major = await req('Major Purchase', 'Site Supervisor', purchasing);
    const s8 = await approvalScreen(site, major.number);
    const a8 = await call(site, 'POST', `/api/approvals/${major.id}/decision`, { decision: 'Approved' });
    record(8, 'Major Purchase, Site Supervisor (no purchasing.view)', `screen Approve: ${s8.approve}, note ${s8.code}; API ${a8.status} ${a8.body.reason_code}`, !s8.approve && s8.code === 'INSUFFICIENT_PERMISSION' && a8.status === 403 && a8.body.reason_code === 'INSUFFICIENT_PERMISSION');

    // 9. Purchasing: Issue PO offered only when the server allows (RM 20,000 policy).
    const po = async (total) => {
      const id = `po-p6u-${RUN}-${total}`;
      await call(purchasing, 'POST', '/api/purchase-orders', { id, po_number: id.toUpperCase(), project_id: P, project_name: 'P6 UI', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: total, total_price: 1 }], total_amount: 1, requested_by: 'Purchasing', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }, 201);
      return { id, number: id.toUpperCase() };
    };
    const small = await po(5000);
    const big = await po(25000);
    await fresh(purchasing);
    await tab(purchasing, 'Purchasing');
    // Purchasing users land on their dashboard; the PO list is under "Manage Purchasing".
    const manage = purchasing.getByRole('button', { name: /Manage Purchasing/ });
    if (await manage.count()) await manage.first().click();
    await purchasing.getByPlaceholder('Search PO number or supplier...').fill(`PO-P6U-${RUN}`.toUpperCase());
    await purchasing.waitForTimeout(1500);
    const issueSmall = await purchasing.getByTestId(`issue-po-${small.number}`).count();
    const issueBig = await purchasing.getByTestId(`issue-po-${big.number}`).count();
    const bigNote = purchasing.locator('div.bg-white.rounded-2xl.p-5').filter({ hasText: big.number }).first().getByTestId('authority-note');
    const bigCode = (await bigNote.count()) ? await bigNote.getAttribute('data-reason-code') : null;
    if (issueSmall) {
      await purchasing.getByTestId(`issue-po-${small.number}`).click();
      await purchasing.waitForTimeout(1500);
    }
    record(9, 'Purchasing: Issue PO from the resolver', `RM 5,000: Issue offered ${issueSmall > 0} -> ${q(`select status from purchase_orders where id='${small.id}'`)}; RM 25,000: Issue offered ${issueBig > 0}, note ${bigCode}`, issueSmall > 0 && q(`select status from purchase_orders where id='${small.id}'`) === 'Issued' && issueBig === 0 && bigCode === 'OWNER_REQUIRED');

    // 10. The screen is information only: the API refuses whatever the browser does.
    await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Strategic', reason: 'UI acceptance: manipulation check' }, 200);
    const d10 = await drawing();
    const forged = await call(pm, 'POST', `/api/drawings/${d10.id}/revisions/${d10.rev}/status`, { status: 'Approved', role: 'Owner / CEO', sensitivity: 'Normal', authority_id: rule.id, project_id: OTHER });
    record(10, 'Manipulated request (PM, Strategic)', `API ${forged.status} ${forged.body.reason_code}; revision ${status(d10)}`, forged.status === 403 && status(d10) === 'Internal Review');
    await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Normal', reason: 'UI acceptance finished' }, 200);

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[13]$/.test(e))]));
    console.log('Page errors / unexpected API failures (deliberate 401/403 checks excluded):', JSON.stringify(errors));
    console.log(`${out.filter((o) => o.pass).length}/${out.length} steps passed`);
    if (failures) process.exitCode = 1;
  } catch (err) {
    console.error('FAILED:', err.message);
    for (const [k, p] of Object.entries(pages)) await p.screenshot({ path: L.SHOTS + `p6ui-fail-${k}.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-ui-log.json', JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
