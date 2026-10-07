/**
 * Phase 6 Batch 4 acceptance in the browser: proactive approval management against the running
 * dev server, signed in as the real dev accounts. The approval monitor is the automation rule
 * on the server's engine; the Owner runs it through the API (POST /api/automation/run) instead
 * of waiting 15 minutes. Time is simulated by moving a test approval's requested_at back in
 * PostgreSQL (the only shortcut); everything else goes through the API and the screens.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-monitoring.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p6m-${RUN}`;
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
const fresh = async (page) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
};
const route = (kind, id) => q(`select assigned_user_id || ' ' || routing_basis || ' ' || lifecycle_state || ' ' || route_reason || ' ' || coalesce(owner_reason_code, '-') from approval_routes where resource_kind = '${kind}' and resource_id = '${id}' and status = 'open'`);
/** Moves the decision's clock back by `hours` (the test's only shortcut: simulated time). */
const age = (kind, id, hours) => q(`update approval_routes set requested_at = now() - interval '${hours} hours', due_at = null, sla_business_days = null where resource_kind = '${kind}' and resource_id = '${id}' and status = 'open' returning id`);
const ownerExceptions = async (page) => {
  await fresh(page);
  await L.nav(page, 'Owner Dashboard');
  await page.getByTestId('owner-exceptions').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  return page.getByTestId('owner-exceptions');
};
const inbox = async (page) => {
  await fresh(page);
  await L.nav(page, 'Approvals');
  await page.getByTestId('approval-inbox').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  return page.getByTestId('approval-inbox');
};

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const purchasing = await as('purchasing');
    const accountant = await as('accountant');
    const admin = await as('admin');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const ownerId = q(`select id from users where email='owner-ceo@dev.nwos.local'`);
    const accId = q(`select id from users where email='accountant@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    const monitor = async () => (await call(owner, 'POST', '/api/automation/run', { rule: 'approval_monitor' }, 200)).body.runs[0];
    await call(owner, 'POST', '/api/projects', { id: P, project_number: `NW-P6M-${RUN}`, project_name: `P6 Monitor ${RUN}`, client_id: 'client-2', site_address: 'KL', contract_value: 90000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);

    // 1. A Major Purchase request: routed to the Accountant (System Policy), due in 1 working day.
    const po = `po-p6m-${RUN}`;
    await call(purchasing, 'POST', '/api/purchase-orders', { id: po, po_number: po.toUpperCase(), project_id: P, project_name: 'P6M', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 25000, total_price: 1 }], total_amount: 1, requested_by: 'Purchasing', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }, 201);
    const apr = `apr-p6m-${RUN}`;
    await call(purchasing, 'POST', '/api/approvals', { id: apr, approval_number: apr.toUpperCase(), approval_type: 'Major Purchase', title: `${po} RM 25,000`, description: 'Plywood', project_id: P, project_name: 'P6M', related_entity_type: 'purchase', related_entity_id: po, assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-07', decision: 'Pending', created_at: '', updated_at: '' }, 201);
    let box = await inbox(accountant);
    const item = box.getByTestId(`inbox-approval-${apr}`);
    const lifeText = (await item.getByTestId('inbox-lifecycle').innerText().catch(() => '')).trim();
    record(1, 'Routed with a due date', `route ${route('approval', apr)}; due ${q(`select to_char(due_at at time zone 'Asia/Kuala_Lumpur', 'YYYY-MM-DD HH24:MI') from approval_routes where resource_id='${apr}' and status='open'`)} MYT; Accountant inbox shows "${lifeText}"`, route('approval', apr).startsWith(`${accId} SYSTEM_POLICY assigned initial`) && lifeText === 'Assigned');

    // 2. Reminder at ~55% of the SLA; a second run sends nothing more.
    age('approval', apr, 13);
    await monitor();
    await monitor();
    const reminders = q(`select count(*) from notifications where rule_key = 'approval_monitor:approval:${apr}:reminded:${accId}'`);
    record(2, 'Reminder once', `route ${route('approval', apr)}; reminders to the Accountant: ${reminders} (two monitor runs)`, route('approval', apr).includes(' reminded ') && reminders === '1');

    // 3. Overdue: the Accountant's inbox says so; the Owner sees an Urgent exception.
    age('approval', apr, 27);
    await monitor();
    box = await inbox(accountant);
    const overdueText = (await box.getByTestId(`inbox-approval-${apr}`).innerText()).replace(/\s+/g, ' ');
    let ex = await ownerExceptions(owner);
    const card = ex.getByTestId(`owner-exception-approval:approval:${apr}`);
    const cardText = (await card.innerText()).replace(/\s+/g, ' ');
    await owner.screenshot({ path: L.SHOTS + 'p6m-03-overdue-exception.png', fullPage: false });
    record(3, 'Overdue', `route ${route('approval', apr)}; inbox: "${overdueText.match(/Overdue[^·]*·[^·]*overdue by [^·]+/)?.[0] ?? overdueText.slice(0, 120)}"; Owner card: "${cardText.slice(0, 160)}"`, route('approval', apr).includes(' overdue ') && /Overdue/.test(overdueText) && /OVERDUE APPROVAL/i.test(cardText) && /Recommended: Chase/.test(cardText));

    // 4. Escalation past 150%: to the Owner, once, with an escalation record; the Owner approves it on the card.
    age('approval', apr, 40);
    await monitor();
    await monitor();
    const escRoute = route('approval', apr);
    const escRecords = q(`select count(*) from escalations where source_record_id = '${apr}'`);
    const moved = q(`select count(*) from notifications n join approval_routes ar on n.rule_key = 'approval-route:' || ar.id || ':moved' where ar.resource_id = '${apr}' and n.user_id = '${accId}'`);
    ex = await ownerExceptions(owner);
    const escCard = ex.getByTestId(`owner-exception-approval:approval:${apr}`);
    const escText = (await escCard.innerText()).replace(/\s+/g, ' ');
    await escCard.getByRole('button', { name: 'History & authority' }).click();
    await escCard.getByTestId('approval-history').waitFor({ timeout: 10000 });
    const historyText = (await escCard.getByTestId('approval-history').innerText()).replace(/\s+/g, ' ');
    await owner.screenshot({ path: L.SHOTS + 'p6m-04-escalated-history.png', fullPage: false });
    record(4, 'Escalated to the Owner', `route ${escRoute}; escalation records ${escRecords}; Accountant told it moved: ${moved}; card: "${escText.slice(0, 120)}"; history: "${historyText.slice(0, 260)}"`, escRoute.startsWith(`${ownerId} OWNER_FALLBACK escalated escalated_overdue ESCALATED_OVERDUE`) && escRecords === '1' && moved === '1' && /Escalated to/.test(historyText) && /Reminder sent/.test(historyText));
    await escCard.getByRole('button', { name: 'Approve' }).click();
    await owner.waitForTimeout(2000);
    const decided = q(`select decision || ' by ' || coalesce(data->>'decision_by_role', '?') from approvals where id = '${apr}'`);
    const closed = q(`select status || ' ' || completion_result from approval_routes where resource_id = '${apr}' order by id desc limit 1`);
    const audit = q(`select after->'authority'->>'basis' || ' ' || (after->'authority'->>'reason_code') from audit_logs where action = 'approval.approve' and entity_id = '${apr}'`);
    await monitor();
    const escStatus = q(`select status from escalations where source_record_id = '${apr}'`);
    record(5, 'Owner decides from the exception card (resolver checks again)', `approval ${decided}; route ${closed}; audit authority ${audit}; escalation ${escStatus}`, decided.startsWith('Approved') && closed === 'completed approved' && audit === 'owner ALLOWED' && escStatus === 'Resolved');

    // 6. Authority expires while pending: the PM is refused; the monitor re-routes it to the Owner with the reason.
    const rule = (await call(owner, 'POST', '/api/authority/rules', { name: `PM drawings ${RUN}`, description: 'Routine drawing approvals', effect: 'allow', decision_type: 'drawing', target_role: 'Project Manager', project_id: P, priority: 200 }, 201)).body;
    await call(pm, 'POST', '/api/drawings', { id: `dwg-p6m-${RUN}`, project_id: P, drawing_number: `P6M-${RUN}`, title: 'Lobby wall', category: 'Carpentry', created_at: '2026-10-01', revisions: [], nw_production_drawings: [] }, 201);
    const rev = `rev-p6m-${RUN}`;
    await call(pm, 'POST', `/api/drawings/dwg-p6m-${RUN}/revisions`, { id: rev, revision: 'Rev 1', title: 'Rev 1', file_url: '/p6m.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }, 201);
    await call(pm, 'POST', `/api/drawings/dwg-p6m-${RUN}/revisions/${rev}/status`, { status: 'Internal Review' }, 200);
    const before = route('drawing_revision', rev);
    q(`update delegated_authorities set start_at = now() - interval '9 days', end_at = now() - interval '1 minute' where id = '${rule.id}'`);
    const refused = await L.api(pm, 'POST', `/api/drawings/dwg-p6m-${RUN}/revisions/${rev}/status`, { status: 'Approved' });
    await monitor();
    const after = route('drawing_revision', rev);
    const details = q(`select details from audit_logs where action = 'approval.route.reroute' and after->>'resource' = 'drawing_revision:${rev}' order by id desc limit 1`);
    box = await inbox(pm);
    const pmSees = await box.getByTestId(`inbox-drawing_revision-${rev}`).count();
    record(6, 'Authority expired: re-routed (not escalated)', `before ${before}; PM approve HTTP ${refused.status} ${refused.body?.reason_code}; after ${after}; audit "${details}"; in PM inbox: ${pmSees}`, before.startsWith(`${pmId} PROJECT_ROLE_RULE`) && refused.status === 403 && after.startsWith(`${ownerId} OWNER_FALLBACK assigned authority_changed AUTHORITY_EXPIRED`) && /AUTHORITY_EXPIRED/.test(details) && pmSees === 0);

    // 7. A safety-critical request with no delegate: Critical, explained, cannot be snoozed.
    const safety = `apr-p6m-safety-${RUN}`;
    await call(pm, 'POST', '/api/approvals', { id: safety, approval_number: safety.toUpperCase(), approval_type: 'Safety-Critical Decision', title: 'Temporary works sign-off', description: 'x', project_id: P, project_name: 'P6M', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-07', decision: 'Pending', created_at: '', updated_at: '' }, 201);
    ex = await ownerExceptions(owner);
    const crit = ex.getByTestId('owner-exceptions-critical').getByTestId(`owner-exception-approval:approval:${safety}`);
    const critText = (await crit.innerText()).replace(/\s+/g, ' ');
    const snoozeButtons = await crit.getByRole('button', { name: /Snooze/ }).count();
    const api = await L.api(owner, 'POST', '/api/owner/exceptions/snooze', { id: `approval:approval:${safety}`, hours: 24, reason: 'later' });
    const summary = (await ex.getByTestId('owner-exceptions-summary').innerText()).replace(/\s+/g, ' ');
    await crit.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: L.SHOTS + 'p6m-07-critical.png', fullPage: false });
    record(7, 'Critical exception', `card: "${critText.slice(0, 200)}"; snooze buttons ${snoozeButtons}; snooze API HTTP ${api.status}; summary "${summary.slice(0, 200)}"`, /Safety-related decision \+100/.test(critText) && /Why you see it/.test(critText) && snoozeButtons === 0 && api.status === 400);

    // 8. Only the Owner: Admin and the PM are refused the exception center and the routing policy change.
    const denied = [];
    for (const [who, page] of [['Admin', admin], ['PM', pm], ['Accountant', accountant]]) denied.push(`${who} ${(await L.api(page, 'GET', '/api/owner/exceptions')).status}`);
    const policy = await L.api(admin, 'PUT', '/api/authority/owner-routing', { owners: [{ id: ownerId, owner_priority: 1, is_primary_owner: true }] });
    const assignSelf = await L.api(pm, 'POST', '/api/approval-routing/assign', { kind: 'approval', id: safety, user_id: pmId, reason: 'mine' });
    record(8, 'Owner only', `exceptions: ${denied.join(', ')}; Admin changing Owner routing: ${policy.status}; PM assigning to self: ${assignSelf.status}`, denied.every((d) => d.endsWith('403')) && policy.status === 403 && assignSelf.status === 403);

    // 9. SLAs and Owner routing on the settings screen.
    await fresh(owner);
    await L.nav(owner, 'Delegated Authority');
    await owner.getByTestId('authority-settings').waitFor({ timeout: 15000 });
    await owner.getByRole('button', { name: 'SLAs & Owner routing' }).click();
    await owner.getByTestId('approval-sla-settings').waitFor({ timeout: 10000 });
    await owner.waitForTimeout(800);
    const slaText = (await owner.getByTestId('approval-sla-settings').innerText()).replace(/\s+/g, ' ');
    await owner.screenshot({ path: L.SHOTS + 'p6m-09-sla.png', fullPage: false });
    record(9, 'SLA and Owner routing settings', `"${slaText.slice(0, 260)}"`, /Invoice approvals? 2 working day/i.test(slaText) || (/2 working day/.test(slaText) && /Owner approvals go to/.test(slaText)));

    // 10. The invariant on the whole dev database.
    const orphans = (await call(owner, 'GET', '/api/approval-routing/orphans', null, 200)).body.length;
    const inactive = q(`select count(*) from approval_routes ar join users u on u.id = ar.assigned_user_id where ar.status = 'open' and not u.is_active`);
    const noDue = q(`select count(*) from approval_routes where status = 'open' and routing_basis <> 'CLIENT_CONSENT' and due_at is null`);
    const runs = q(`select string_agg(status || ':' || n, ', ') from (select status, count(*) n from automation_runs where rule_key = 'approval_monitor' group by status) x`);
    record(10, 'No orphan, no inactive assignee, every internal approval has a due date', `orphans ${orphans}; open routes to inactive users ${inactive}; open internal routes without a due date ${noDue}; monitor runs ${runs}`, orphans === 0 && inactive === '0' && noDue === '0');

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[03]$/.test(e))]));
    console.log('Page errors (expected 400/403 refusals filtered):', JSON.stringify(errors));
  } catch (err) {
    console.error('FAILED:', err.message);
    failures++;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-monitoring-log.json', JSON.stringify(out, null, 2));
    await browser.close();
    console.log(`${out.length - failures}/${out.length} passed`);
    process.exitCode = failures ? 1 : 0;
  }
})();
