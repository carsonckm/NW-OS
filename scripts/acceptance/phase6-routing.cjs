/**
 * Phase 6 Batch 3 acceptance in the browser: Owner Authority Settings and approval routing,
 * signed in as the real dev accounts against the running dev server. The Owner creates and
 * manages delegated authority on the settings screen; approvals are routed by the server;
 * the PM and the Owner see them in their approval inbox. Each step is checked against the API
 * and what PostgreSQL holds.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-routing.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p6r-${RUN}`;
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
const settings = async (page, tab) => {
  await fresh(page);
  await L.nav(page, 'Delegated Authority');
  await page.getByTestId('authority-settings').waitFor({ timeout: 15000 });
  if (tab) await page.getByRole('button', { name: new RegExp(`^${tab}`) }).first().click();
  await page.waitForTimeout(800);
};
const inbox = async (page) => {
  await fresh(page);
  await L.nav(page, 'Approvals');
  await page.getByTestId('approval-inbox').waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  return page.getByTestId('approval-inbox');
};
const route = (kind, id) => q(`select assigned_user_id || ' ' || routing_basis || ' ' || coalesce(authority_rule_code, '-') || ' ' || coalesce(owner_reason_code, '-') from approval_routes where resource_kind = '${kind}' and resource_id = '${id}' and status = 'open'`);

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const admin = await as('admin');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const ownerId = q(`select id from users where email='owner-ceo@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    await call(owner, 'POST', '/api/projects', { id: P, project_number: `NW-P6R-${RUN}`, project_name: `P6 Routing ${RUN}`, client_id: 'client-2', site_address: 'KL', contract_value: 90000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);
    let v = 0;
    const variation = async (amount) => {
      const id = `vo-p6r-${RUN}-${++v}`;
      await call(owner, 'POST', '/api/variations', { id, variation_number: id.toUpperCase(), project_id: P, project_name: 'P6 Routing', title: `Panel ${v}`, description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }, 201);
      return id;
    };

    // 1. Settings screen: the Owner creates a delegated rule with a server preview first.
    await settings(owner, 'Rules');
    await owner.getByRole('button', { name: 'New delegated authority' }).click();
    const dlg = owner.getByRole('dialog');
    await dlg.getByLabel('Rule name').fill(`PM variations ${RUN}`);
    await dlg.getByLabel('Decision type').selectOption('variation');
    await dlg.getByLabel('Target role').selectOption('Project Manager');
    await dlg.getByLabel('Rule project').selectOption(P);
    await dlg.getByLabel('Maximum value').fill('20000');
    await dlg.getByLabel('Rule reason').fill('Routine variations on the routing project');
    const saveDisabledBefore = await dlg.getByTestId('rule-save-button').isDisabled();
    await dlg.getByTestId('rule-preview-button').click();
    await dlg.getByTestId('rule-preview').waitFor({ timeout: 10000 });
    const preview = await dlg.getByTestId('rule-preview').innerText();
    const warnings = await dlg.locator('[data-code]').evaluateAll((els) => els.map((e) => e.getAttribute('data-code')));
    await dlg.getByTestId('rule-save-button').click();
    await owner.waitForTimeout(1500);
    const rule = JSON.parse(q(`select row_to_json(r) from (select id, code, created_by, description from delegated_authorities where name = 'PM variations ${RUN}') r`));
    record(1, 'Owner creates a rule on the settings screen (preview first)', `save disabled before preview: ${saveDisabledBefore}; preview "${preview.split('\n').find((l) => /may approve/.test(l))}"; warnings ${JSON.stringify(warnings)}; stored ${rule.code} by ${rule.created_by}`, saveDisabledBefore && /Project Manager may approve variation/.test(preview) && warnings.includes('BROADENS_SYSTEM_POLICY') && rule.created_by === ownerId);

    // 2. Routed to the PM; the PM's inbox explains why; the PM approves; the route closes.
    const v1 = await variation(5000);
    const pmBox = await inbox(pm);
    const item = pmBox.getByTestId(`inbox-variation-${v1}`);
    const why = (await item.count()) ? await item.getByTestId('inbox-why').innerText() : '';
    await call(pm, 'POST', `/api/variations/${v1}/transition`, { status: 'Client Approval' }, 200);
    const closed = q(`select status || ' ' || completion_result || ' by ' || completed_by from approval_routes where resource_id = '${v1}' order by id desc limit 1`);
    record(2, 'Normal: routed to the PM, in the inbox, approved', `route at creation → PM; inbox: "${why}"; after approval: ${closed}`, /Delegated to your role on this project/.test(why) && why.includes(rule.code) && closed === `completed approved by ${pmId}`);

    // 3. Settings screen: Sensitive (Owner, reason) re-routes pending approvals to the Owner.
    const v2 = await variation(6000);
    const before3 = route('variation', v2);
    await settings(owner, 'Project sensitivity');
    await owner.getByTestId(`sensitivity-${P}`).getByRole('button', { name: 'Change…' }).click();
    await owner.getByRole('dialog').getByLabel('Sensitivity level').selectOption('Sensitive');
    await owner.getByRole('dialog').getByLabel('Sensitivity reason').fill('Acceptance: client asked for Owner sign-off');
    await owner.getByRole('dialog').getByRole('button', { name: 'Change sensitivity' }).click();
    const done3 = await owner.getByTestId('sensitivity-done').innerText();
    const ownerBox = await inbox(owner);
    const ownerWhy = await ownerBox.getByTestId(`inbox-variation-${v2}`).getByTestId('inbox-why').innerText();
    const pmBox3 = await inbox(pm);
    const pmSees = await pmBox3.getByTestId(`inbox-variation-${v2}`).count();
    const refused3 = await call(pm, 'POST', `/api/variations/${v2}/transition`, { status: 'Client Approval' });
    record(3, 'Sensitive: pending approval re-routed to the Owner', `before ${before3}; "${done3}"; now ${route('variation', v2)}; Owner inbox "${ownerWhy}"; PM inbox has it: ${pmSees > 0}; PM API ${refused3.status} ${refused3.body.reason_code}`, before3.startsWith(pmId) && route('variation', v2).startsWith(`${ownerId} OWNER_FALLBACK`) && /SENSITIVITY_BLOCKED/.test(ownerWhy) && pmSees === 0 && refused3.body.reason_code === 'SENSITIVITY_BLOCKED');

    // 4. Strategic (API), then back to Normal on the screen: the PM receives it again.
    await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Strategic', reason: 'Acceptance: strategic' }, 200);
    const v4 = await variation(1000);
    const strategic = route('variation', v4);
    const pmLower = await call(pm, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Normal', reason: 'x' });
    await settings(owner, 'Project sensitivity');
    await owner.getByTestId(`sensitivity-${P}`).getByRole('button', { name: 'Change…' }).click();
    await owner.getByRole('dialog').getByLabel('Sensitivity level').selectOption('Normal');
    await owner.getByRole('dialog').getByLabel('Sensitivity reason').fill('Acceptance: board review finished');
    await owner.getByRole('dialog').getByRole('button', { name: 'Change sensitivity' }).click();
    await owner.getByTestId('sensitivity-done').waitFor();
    record(4, 'Strategic → Normal', `Strategic: ${strategic}; PM lowering ${pmLower.status}; after Normal (Owner, reason): ${route('variation', v4)}; audit ${q(`select string_agg(before->>'sensitivity' || '->' || (after->>'sensitivity'), ', ' order by id) from audit_logs where action='project.sensitivity.change' and entity_id='${P}'`)}`, strategic.startsWith(`${ownerId} OWNER_FALLBACK`) && pmLower.status === 403 && route('variation', v4).startsWith(pmId));

    // 5. The authority expires while pending: the inbox says so; re-running routing hands it to the Owner.
    q(`update delegated_authorities set start_at = now() - interval '9 days', end_at = now() - interval '1 minute' where id = '${rule.id}'`);
    const pmBox5 = await inbox(pm);
    const stale = await pmBox5.getByTestId(`inbox-variation-${v4}`).getByTestId('inbox-stale').innerText().catch(() => '');
    const refused5 = await call(pm, 'POST', `/api/variations/${v4}/transition`, { status: 'Client Approval' });
    await settings(owner);
    await owner.getByTestId('rerun-routing').click();
    const rerun = await owner.getByTestId('rerun-result').innerText();
    record(5, 'Authority expires while pending', `PM inbox: "${stale}"; PM API ${refused5.status} ${refused5.body.reason_code}; "${rerun}"; now ${route('variation', v4)}`, /AUTHORITY_EXPIRED/.test(stale) && refused5.body.reason_code === 'AUTHORITY_EXPIRED' && route('variation', v4) === `${ownerId} OWNER_FALLBACK - AUTHORITY_EXPIRED`);

    // 6. A fresh rule; the Owner deactivates it on the screen (impact first): routed to the Owner.
    q(`update delegated_authorities set end_at = now() + interval '30 days' where id = '${rule.id}'`);
    await call(owner, 'POST', '/api/approval-routing/reevaluate', { project_id: P }, 200);
    const v6 = await variation(2000);
    const before6 = route('variation', v6);
    await settings(owner, 'Rules');
    await owner.getByTestId(`rule-${rule.code}`).click();
    await owner.getByRole('button', { name: 'Deactivate…' }).click();
    const impact = await owner.getByTestId('rule-impact').innerText();
    await owner.getByRole('dialog').getByLabel('Reason').fill('Acceptance: PM on leave');
    await owner.getByRole('button', { name: 'Confirm deactivate' }).click();
    const done6 = await owner.getByTestId('rule-done').innerText();
    record(6, 'Owner deactivates the rule (impact preview)', `before ${before6}; impact "${impact.split('\n')[1]}"; "${done6}"; now ${route('variation', v6)}`, before6.startsWith(pmId) && /re-routed|routed again/.test(impact) && route('variation', v6).startsWith(`${ownerId} OWNER_FALLBACK`));

    // 7. Dashboard reflects it; Admin can look but not change; the PM has no settings screen.
    await settings(owner, 'Overview');
    const ownerQueue = await owner.getByTestId('ov-owner-queue').innerText();
    await settings(admin, 'Rules');
    const adminNew = await admin.getByRole('button', { name: 'New delegated authority' }).count();
    await fresh(pm);
    const pmNav = await pm.locator('header div.overflow-x-auto button', { hasText: 'Delegated Authority' }).count();
    const pmApi = await call(pm, 'POST', '/api/authority/rules', { name: 'Self', description: 'x', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager' });
    record(7, 'Dashboard; Admin read-only; PM has no access', `Owner card "${ownerQueue.replace(/\n/g, ' ')}"; Admin "New" button: ${adminNew}; PM nav entry: ${pmNav}; PM create rule API ${pmApi.status}`, adminNew === 0 && pmNav === 0 && pmApi.status === 403);

    // 8. No orphan: every pending decision has an open route.
    const orphans = (await call(owner, 'GET', '/api/approval-routing/orphans', undefined, 200)).body;
    record(8, 'No pending approval without a route', `orphans: ${orphans.length}; open routes ${q(`select count(*) from approval_routes where status='open'`)}; routing audit ${q(`select count(*) from audit_logs where action in ('approval.route.assign','approval.route.reroute') and after->>'resource' like 'variation:vo-p6r-${RUN}%'`)}`, orphans.length === 0);

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[13]$/.test(e))]));
    console.log('Page errors / unexpected API failures (deliberate 401/403 checks excluded):', JSON.stringify(errors));
    console.log(`${out.filter((o) => o.pass).length}/${out.length} steps passed`);
    if (failures || Object.values(errors).some((e) => e.length)) process.exitCode = 1;
  } catch (err) {
    console.error('FAILED:', err.message);
    for (const [k, p] of Object.entries(pages)) await p.screenshot({ path: L.SHOTS + `p6r-fail-${k}.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-routing-log.json', JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
