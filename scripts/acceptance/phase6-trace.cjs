/**
 * Phase 6 Batch 8 acceptance in the browser: approval traceability ("Why can this person approve
 * this?") and rejection notices, against the running dev server as the real dev accounts.
 * Decisions are taken through the API as the deciding user; the panel is read on screen. The
 * rules used are switched off at the end (never deleted).
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-trace.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p6t-${RUN}`;
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
const fresh = async (page) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
  await page.getByLabel('Active Project').selectOption(P).catch(() => {});
  await page.waitForTimeout(400);
};
/** Opens the variation and its "Why can this person approve this?" panel; returns the panel text ('' if none offered). */
const variationPanel = async (page, number) => {
  await fresh(page);
  if (!(await page.locator('header div.overflow-x-auto button', { hasText: 'Variations' }).count())) return { offered: false, text: '' };
  await tab(page, 'Variations & Claims');
  await page.getByLabel('Variations project').selectOption(P).catch(() => {});
  const item = L.vis(page.getByTestId(`variation-${number}`));
  if (!(await item.count())) return { offered: false, text: '' };
  await item.click();
  await page.waitForTimeout(400);
  const toggle = page.getByTestId('decision-trace-toggle');
  if (!(await toggle.count())) return { offered: false, text: '' };
  await toggle.first().click();
  await page.waitForTimeout(1500);
  const panel = page.getByTestId('decision-trace').or(page.getByTestId('decision-trace-unavailable')).first();
  return { offered: true, text: (await panel.innerText()).replace(/\s+/g, ' ') };
};
const approvalPanel = async (page, number) => {
  await fresh(page);
  await tab(page, 'Approvals & Governance');
  await page.getByPlaceholder('Search approvals...').fill(number);
  await page.waitForTimeout(1200);
  const card = page.locator('div.bg-white.rounded-2xl.p-5').filter({ hasText: number }).first();
  const toggle = card.getByTestId('decision-trace-toggle');
  if (!(await toggle.count())) return { offered: false, text: '' };
  await toggle.click();
  await page.waitForTimeout(1500);
  return { offered: true, text: (await card.getByTestId('decision-trace').or(card.getByTestId('decision-trace-unavailable')).first().innerText()).replace(/\s+/g, ' ') };
};
const traceStatus = async (page, kind, id) => (await L.api(page, 'GET', `/api/approval-routing/trace?kind=${kind}&id=${encodeURIComponent(id)}`)).status;

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const site = await as('site-supervisor');
    const prodMgr = await as('production-manager');
    const accountant = await as('accountant');
    const admin = await as('admin');
    const client = await as('client');
    const contractor = await as('contractor');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    const clientId = q(`select client_id from users where email='client@dev.nwos.local'`);
    await call(owner, 'POST', '/api/projects', { id: P, project_number: `NW-P6T-${RUN}`, project_name: `P6 Trace ${RUN}`, client_id: clientId, site_address: 'KL', contract_value: 900000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);

    // The PM may approve variations on this project up to RM 20,000 (permanent rule).
    const rule = (await call(owner, 'POST', '/api/authority/rules', { name: `PM variations ${RUN}`, description: 'Routine variations on the trace project', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: P, max_value: 20000, priority: 200 }, 201)).body;
    const voNumber = `VO-P6T-${RUN}`;
    const vo = `vo-p6t-${RUN}`;
    await call(owner, 'POST', '/api/variations', { id: vo, variation_number: voNumber, project_id: P, project_name: 'P6T', title: 'Extra shelving', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 9000, client_amount: 15000, status: 'Internal Approval', created_at: '' }, 201);
    await call(pm, 'POST', `/api/variations/${vo}/transition`, { status: 'Client Approval', note: 'Within my limit' }, 200);

    // 1. The Owner inspects the decision on screen.
    const o1 = await variationPanel(owner, voNumber);
    record(1, 'Owner inspects a decision (Variations screen)', o1.text.slice(0, 260), o1.offered && /permanent delegated authority/.test(o1.text) && o1.text.includes(rule.code) && /RM 15,000/.test(o1.text) && /limit RM 20,000/.test(o1.text) && /Requested by/.test(o1.text));
    await owner.screenshot({ path: L.SHOTS + 'phase6-trace-owner.png', fullPage: false });

    // 2. The approver sees why they could approve it.
    const p2 = await variationPanel(pm, voNumber);
    record(2, 'Approver inspects their own decision', p2.text.slice(0, 160), p2.offered && p2.text.includes(rule.code));

    // 3. The requester of an approval request sees their own decision; rejection notifies them once.
    const aprNumber = `APR-P6T-${RUN}`;
    const apr = `apr-p6t-${RUN}`;
    await call(site, 'POST', '/api/approvals', { id: apr, approval_number: aprNumber, approval_type: 'Safety-Critical Decision', title: 'Temporary scaffold', description: 'Scaffold for level 3 ceiling', project_id: P, project_name: 'P6T', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-09', decision: 'Pending', created_at: '', updated_at: '' }, 201);
    const notesBefore = q(`select count(*) from notifications where user_id='${siteId}'`);
    await call(owner, 'POST', `/api/approvals/${apr}/decision`, { decision: 'Rejected', comments: 'Use the certified system scaffold' }, 200);
    const rej = q(`select count(*) || ' | ' || coalesce(max(message),'') from notifications where rule_key='rejection:approval:${apr}'`);
    const r3 = await approvalPanel(site, aprNumber);
    record(3, 'Requester sees their own decision; rejection notice', `notice: ${rej}; panel: ${r3.text.slice(0, 160)}`, rej.startsWith('1 | ') && rej.includes('Use the certified system scaffold') && !/DA-|SYS-/.test(rej) && r3.offered && /rejected this/.test(r3.text) && /the Owner/.test(r3.text));
    await site.screenshot({ path: L.SHOTS + 'phase6-trace-requester.png', fullPage: false });

    // 4. The requester sees the notice in the bell / notification centre.
    const bell = (await call(site, 'GET', '/api/notifications', undefined, 200)).body;
    const list = Array.isArray(bell) ? bell : bell.notifications ?? bell.items ?? [];
    const mine = list.filter((n) => n.title && n.title.includes(aprNumber));
    record(4, 'Requester has exactly one rejection notice', `${mine.length} notice(s): ${mine.map((n) => n.title).join('; ')}; site notifications ${notesBefore} → ${q(`select count(*) from notifications where user_id='${siteId}'`)}`, mine.length === 1);

    // 5. Reprocessing does not add another notice.
    await L.api(owner, 'POST', `/api/approvals/${apr}/decision`, { decision: 'Rejected', comments: 'Use the certified system scaffold' });
    const again = q(`select count(*) from notifications where rule_key='rejection:approval:${apr}'`);
    record(5, 'Reprocessing the rejection: no duplicate', `rejection notices for ${aprNumber}: ${again}`, again === '1');

    // 6. Internal roles see only what is permitted.
    const roles = [];
    for (const [who, page] of [['Admin', admin], ['Production Manager', prodMgr], ['Accountant', accountant], ['Site Supervisor', site]]) roles.push(`${who} ${await traceStatus(page, 'variation', vo)}`);
    const pmApr = await traceStatus(pm, 'approval', apr);
    const prodUi = await variationPanel(prodMgr, voNumber);
    record(6, 'Internal roles: only what is permitted', `${roles.join(', ')}; PM on the approval (no part in it) ${pmApr}; Production Manager panel: ${prodUi.offered ? prodUi.text.slice(0, 60) : 'not offered'}`, roles.join(',') === 'Admin 200,Production Manager 404,Accountant 404,Site Supervisor 404' && pmApr === 404 && (!prodUi.offered || /not available to you/i.test(prodUi.text)));

    // 7. Client and Contractor are denied, identically to a record that does not exist.
    const missing = await L.api(client, 'GET', '/api/approval-routing/trace?kind=variation&id=vo-nope');
    const ext = [];
    for (const [who, page] of [['Client', client], ['Contractor', contractor]]) {
      const r = await L.api(page, 'GET', `/api/approval-routing/trace?kind=variation&id=${vo}`);
      ext.push({ who, status: r.status, same: r.body?.error === missing.body?.error && r.body?.message.replace(vo, 'X') === missing.body?.message.replace('vo-nope', 'X') });
    }
    const clientUi = await variationPanel(client, voNumber);
    record(7, 'Client and Contractor denied (same as nonexistent)', `${ext.map((e) => `${e.who} ${e.status}${e.same ? ' identical' : ' DIFFERENT'}`).join(', ')}; client panel offered: ${clientUi.offered}`, ext.every((e) => e.status === 404 && e.same) && !clientUi.offered);

    // 8. The rule changes, then is switched off: history stays as it was.
    await call(owner, 'PATCH', `/api/authority/rules/${rule.id}`, { max_value: 5000, change_reason: 'Tighter limit' }, 200);
    await call(owner, 'POST', `/api/authority/rules/${rule.id}/deactivate`, { reason: 'Trace acceptance finished' }, 200);
    const o8 = await variationPanel(owner, voNumber);
    record(8, 'History after the rule changed and was switched off', o8.text.slice(0, 400), /limit RM 20,000/.test(o8.text) && !/limit RM 5,000/.test(o8.text) && /no longer in force/.test(o8.text) && /terms have changed since the decision/.test(o8.text) && /valid under the terms in force at the time/.test(o8.text));
    await owner.screenshot({ path: L.SHOTS + 'phase6-trace-after-change.png', fullPage: false });

    // 9. A temporary authority that has expired.
    const tb = { decision_type: 'variation', target_user_id: pmId, project_id: P, max_value: 9000, end_at: new Date(Date.now() + 20000).toISOString(), reason: 'Owner at the factory' };
    const pr = (await call(owner, 'POST', '/api/authority/temporary/preview', tb, 200)).body;
    const temp = (await call(owner, 'POST', '/api/authority/temporary', { ...tb, confirmation: pr.confirmation }, 201)).body;
    const vo2 = `${vo}-2`;
    await call(owner, 'POST', '/api/variations', { id: vo2, variation_number: `${voNumber}-2`, project_id: P, project_name: 'P6T', title: 'Extra hooks', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 900, client_amount: 2000, status: 'Internal Approval', created_at: '' }, 201);
    await call(pm, 'POST', `/api/variations/${vo2}/transition`, { status: 'Client Approval' }, 200);
    await owner.waitForTimeout(20000);
    const o9 = await variationPanel(owner, `${voNumber}-2`);
    record(9, 'History after a temporary authority expired', `${temp.code}: ${o9.text.slice(0, 300)}`, /temporary delegated authority/.test(o9.text) && o9.text.includes(temp.code) && /no longer in force/.test(o9.text) && !/unauthori[sz]ed/i.test(o9.text));

    // 10. Forged decision records (security review): a fake authority snapshot sent with a PO and
    // with a drawing revision upload is stored in their ordinary audit rows, but is never a decision.
    const purchasing = await as('purchasing');
    const fake = (who) => ({ actor_id: who, result: 'allowed', reason_code: 'ALLOWED', matched_rule_code: 'DA-FAKE', trace: { version: 1, authority_type: 'Owner', approver: { id: who, name: 'Forged', role: 'Owner / CEO' }, rule: null } });
    const purId = q(`select id from users where email='purchasing@dev.nwos.local'`);
    const poId = `po-p6t-${RUN}`;
    await call(purchasing, 'POST', '/api/purchase-orders', { id: poId, po_number: `PO-P6T-${RUN}`, project_id: P, supplier_id: 'sup-1', supplier_name: 'S', status: 'Draft', items: [{ description: 'x', quantity: 1, unit_price: 10 }], authority: fake(purId), consent: 'client' }, 201);
    await call(purchasing, 'PATCH', `/api/purchase-orders/${poId}`, { authority: { ...fake(purId), matched_rule_code: 'DA-FAKE2' } }, 200);
    const revId = `rev-p6t-${RUN}`;
    await call(pm, 'POST', '/api/drawings/dwg-1/revisions', { id: revId, revision: `Rev ${RUN}`, title: 'x', file_url: `/p6t-${RUN}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing', authority: fake(pmId) }, 201);
    const stored = q(`select count(*) from audit_logs where entity_id in ('${poId}','${revId}') and after ? 'authority'`);
    const poTrace = (await call(owner, 'GET', `/api/approval-routing/trace?kind=purchase_order&id=${poId}`, undefined, 200)).body;
    const revTrace = (await call(owner, 'GET', `/api/approval-routing/trace?kind=drawing_revision&id=${revId}`, undefined, 200)).body;
    record(10, 'Forged authority snapshots are not decisions', `forged audit rows stored: ${stored}; PO trace decisions ${poTrace.decisions.length}; revision trace decisions ${revTrace.decisions.length}; DA-FAKE shown: ${/DA-FAKE/.test(JSON.stringify([poTrace, revTrace]))}`, Number(stored) === 3 && poTrace.decisions.length === 0 && revTrace.decisions.length === 0 && !/DA-FAKE/.test(JSON.stringify([poTrace, revTrace])));

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[34]$/.test(e))]));
    const clean = Object.values(errors).every((e) => e.length === 0);
    record(11, 'No page or API errors', `unexpected errors: ${JSON.stringify(errors)} (expected 403/404 refusals filtered)`, clean);
  } catch (err) {
    console.error('FAILED:', err.message);
    failures++;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-trace-log.json', JSON.stringify(out, null, 2));
    await browser.close();
    console.log(`${out.length - failures}/${out.length} passed`);
    process.exitCode = failures ? 1 : 0;
  }
})();
