/**
 * Phase 6 Batch 5 acceptance in the browser: Owner dependency and delegation recommendations,
 * against the running dev server as the real dev accounts. The Owner takes real decisions
 * through the API; those decisions are then moved back in time in PostgreSQL to form a 60-day
 * history (the only shortcut). Recommendations are refreshed, reviewed, modified, accepted and
 * rejected on the Owner Dashboard; the authority rule is created by the authority API, and
 * switched off again at the end. A rejection holds that opportunity back for 90 days, so the
 * recorded run is on a freshly seeded dev database (migrate, auth:seed-dev, db:import-demo).
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-delegation.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p6d-${RUN}`;
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
const backdate = (kind, id, days) => q(`update approval_routes set requested_at = now() - interval '${days} days 3 hours', completed_at = now() - interval '${days} days' where resource_kind = '${kind}' and resource_id = '${id}' and status = 'completed' returning id`);
const dashboard = async (page) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
  await L.nav(page, 'Owner Dashboard');
  await page.getByTestId('owner-dependency-analytics').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  return page.getByTestId('owner-dependency-analytics');
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
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    await call(owner, 'POST', '/api/projects', { id: P, project_number: `NW-P6D-${RUN}`, project_name: `P6 Delegation ${RUN}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);

    // 1. History: the Owner decides 8 variations (raised by the PM, no delegation exists) and 6 major POs.
    const vos = [];
    for (let i = 1; i <= 8; i++) {
      const id = `vo-p6d-${RUN}-${i}`;
      await call(pm, 'POST', '/api/variations', { id, variation_number: id.toUpperCase(), project_id: P, project_name: 'P6D', title: `Extra shelf ${i}`, description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: i * 1000, status: 'Internal Approval', created_at: '' }, 201);
      await call(owner, 'POST', `/api/variations/${id}/transition`, { status: 'Client Approval' }, 200);
      backdate('variation', id, i * 3);
      vos.push(id);
    }
    for (let i = 1; i <= 6; i++) {
      const id = `po-p6d-${RUN}-${i}`;
      await call(purchasing, 'POST', '/api/purchase-orders', { id, po_number: id.toUpperCase(), project_id: P, project_name: 'P6D', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: 20000 + i * 1000, total_price: 1 }], total_amount: 1, requested_by: 'Purchasing', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }, 201);
      await call(owner, 'PATCH', `/api/purchase-orders/${id}`, { status: 'Issued' }, 200);
      backdate('purchase_order', id, i * 5);
    }
    const decided = q(`select count(*) from approval_routes where project_id = '${P}' and status = 'completed' and completed_by = (select id from users where email='owner-ceo@dev.nwos.local')`);
    record(1, 'Owner decision history (through the API)', `${decided} Owner decisions on ${P}, spread over 40 days`, decided === '14');

    // 2. Owner Dependency on the dashboard (server numbers).
    let box = await dashboard(owner);
    const summary = (await box.getByTestId('owner-dependency-summary').innerText()).replace(/\s+/g, ' ');
    const defs = (await box.getByTestId('owner-dependency-definitions').innerText()).replace(/\s+/g, ' ');
    const api = (await call(owner, 'GET', '/api/owner/dependency/analytics?days=90', null, 200)).body;
    await owner.screenshot({ path: L.SHOTS + 'p6d-02-dependency.png', fullPage: false });
    record(2, 'Owner Dependency view', `"${summary.slice(0, 200)}"; definition shown: ${/Owner Dependency = routine decisions/.test(defs)}; API owner ${api.totals.owner_decisions}, delegated ${api.totals.delegated_decisions}, dependency ${api.dependency.percent}%`, summary.toLowerCase().includes(`owner decisions ${api.totals.owner_decisions}`) && /Owner Dependency = routine decisions/.test(defs) && api.trend.length === 6);

    // 3. Refresh recommendations on the screen; the variation and purchase opportunities appear with evidence.
    await box.getByRole('button', { name: 'Refresh recommendations' }).click();
    await owner.waitForTimeout(2500);
    box = await dashboard(owner);
    const recs = (await call(owner, 'GET', '/api/delegation/recommendations', null, 200)).body;
    const vo = recs.active.find((r) => r.decision_type === 'variation' && r.project_id === P) ?? recs.active.find((r) => r.decision_type === 'variation');
    const po = recs.active.find((r) => r.decision_type === 'purchase');
    record(3, 'Recommendations generated', `active: ${recs.active.map((r) => `${r.headline} (${r.confidence}, ${r.evidence.decisions} decisions, up to ${r.suggested_max_value ?? '-'})`).join('; ')}`, !!vo && !!po && vo.target_role === 'Project Manager' && po.target_role === 'Purchasing');

    // 4. Review evidence on the card.
    const card = box.getByTestId(`delegation-rec-${vo.id}`);
    await card.getByRole('button', { name: 'Review evidence' }).click();
    const evidence = (await card.getByTestId('delegation-evidence').innerText()).replace(/\s+/g, ' ');
    await card.scrollIntoViewIfNeeded();
    await owner.screenshot({ path: L.SHOTS + 'p6d-04-evidence.png', fullPage: false });
    record(4, 'Evidence is explainable', `"${evidence.slice(0, 320)}"`, /Why this was recommended/.test(evidence) && /decisions reviewed/.test(evidence) && /required permission variations.review/.test(evidence) && /Confidence:/.test(evidence));

    // 5. Modify: limit RM 5,000 -> authority preview -> confirm -> rule created via the authority API.
    const rulesBefore = q(`select count(*) from delegated_authorities`);
    await card.getByRole('button', { name: 'Modify…' }).click();
    await card.getByPlaceholder(String(vo.suggested_max_value)).fill('5000');
    await card.getByRole('button', { name: 'Preview the rule' }).click();
    await card.getByTestId('delegation-preview').waitFor({ timeout: 10000 });
    const previewText = (await card.getByTestId('delegation-preview').innerText()).replace(/\s+/g, ' ');
    const rulesDuringPreview = q(`select count(*) from delegated_authorities`);
    await owner.screenshot({ path: L.SHOTS + 'p6d-05-preview.png', fullPage: false });
    await card.getByRole('button', { name: 'Confirm and create this authority' }).click();
    await owner.waitForTimeout(2500);
    const stored = q(`select status || ' ' || coalesce(authority_rule_id, '-') from delegation_recommendations where id = '${vo.id}'`);
    const ruleId = stored.split(' ')[1];
    const rule = q(`select kind || ' ' || effect || ' ' || decision_type || ' ' || target_role || ' ' || max_value || ' ' || coalesce(project_id, 'all') from delegated_authorities where id = '${ruleId}'`);
    const audits = q(`select string_agg(action, ', ' order by id) from audit_logs where (entity_id = '${ruleId}' and action like 'authority.rule.%') or (entity_id = '${vo.id}' and action like 'delegation.%')`);
    record(5, 'Modify → preview → confirm → authority rule', `preview: "${previewText.slice(0, 160)}"; rules during preview ${rulesDuringPreview} (before ${rulesBefore}); recommendation ${stored}; rule ${rule}; audit ${audits}`, rulesDuringPreview === rulesBefore && stored.startsWith('modified da-') && / variation Project Manager 5000\.00 /.test(` ${rule} `) && /authority\.rule\.create/.test(audits) && /delegation\.recommendation\.modify/.test(audits));

    // 6. The resolver now uses it: a RM 4,000 variation goes to the PM, RM 6,000 still to the Owner.
    const small = `vo-p6d-${RUN}-s`;
    const big = `vo-p6d-${RUN}-b`;
    for (const [id, amt] of [[small, 4000], [big, 6000]]) await call(owner, 'POST', '/api/variations', { id, variation_number: id.toUpperCase(), project_id: P, project_name: 'P6D', title: 'Panel', description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amt, status: 'Internal Approval', created_at: '' }, 201);
    const r1 = q(`select u.role || ' ' || coalesce(ar.authority_rule_id, '-') from approval_routes ar join users u on u.id = ar.assigned_user_id where resource_id = '${small}' and status = 'open'`);
    const r2 = q(`select u.role from approval_routes ar join users u on u.id = ar.assigned_user_id where resource_id = '${big}' and status = 'open'`);
    record(6, 'The new authority works through the resolver', `RM 4,000 → ${r1}; RM 6,000 → ${r2}`, r1 === `Project Manager ${ruleId}` && r2 === 'Owner / CEO');

    // 7. Reject the purchase recommendation on the screen, with a reason; no authority change.
    box = await dashboard(owner);
    const pcard = box.getByTestId(`delegation-rec-${po.id}`);
    const before7 = q(`select count(*) from delegated_authorities`);
    await pcard.getByRole('button', { name: 'Reject' }).first().click();
    await pcard.getByPlaceholder('Reason (required)').fill('Major purchases stay with me this quarter');
    await pcard.getByRole('button', { name: 'Reject' }).last().click();
    await owner.waitForTimeout(2000);
    const rej = q(`select status || ' | ' || review_reason from delegation_recommendations where id = '${po.id}'`);
    record(7, 'Reject', `${rej}; authority rules ${before7} → ${q(`select count(*) from delegated_authorities`)}`, rej.startsWith('rejected | Major purchases') && before7 === q(`select count(*) from delegated_authorities`));

    // 8. Refresh again: no duplicates, the rejected one is not suggested again.
    await call(owner, 'POST', '/api/delegation/recommendations/generate', {}, 200);
    await call(owner, 'POST', '/api/delegation/recommendations/generate', {}, 200);
    const dupes = q(`select count(*) from (select opportunity_key from delegation_recommendations where status in ('generated','viewed','snoozed') group by 1 having count(*) > 1) x`);
    const again = q(`select count(*) from delegation_recommendations where opportunity_key = (select opportunity_key from delegation_recommendations where id = '${po.id}') and status in ('generated','viewed','snoozed')`);
    record(8, 'Idempotent generation; rejection respected', `duplicate active opportunities ${dupes}; purchase suggested again: ${again}`, dupes === '0' && again === '0');

    // 9. Only the Owner.
    const denied = [];
    for (const [who, page] of [['Admin', admin], ['PM', pm], ['Accountant', accountant], ['Purchasing', purchasing]]) {
      denied.push(`${who} ${(await L.api(page, 'GET', '/api/delegation/recommendations')).status}/${(await L.api(page, 'GET', '/api/owner/dependency/analytics')).status}/${(await L.api(page, 'POST', `/api/delegation/recommendations/${vo.id}/accept`, { confirmation: 'x' })).status}`);
    }
    const forged = await L.api(owner, 'POST', `/api/delegation/recommendations/${po.id}/accept`, { evidence_count: 99, confirmation: 'x' });
    record(9, 'Owner only; evidence cannot be forged', `${denied.join(', ')}; Owner forging evidence: ${forged.status}`, denied.every((d) => d.endsWith('403/403/403')) && forged.status === 400);

    // Clean-up: the rule created in step 5 is switched off with a reason (never deleted), so the
    // dev data goes back to "no delegation" for variations.
    await call(owner, 'POST', `/api/authority/rules/${ruleId}/deactivate`, { reason: 'Batch 5 acceptance run finished' }, 200);

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[03]$/.test(e))]));
    console.log('Page errors (expected 400/403 refusals filtered):', JSON.stringify(errors));
  } catch (err) {
    console.error('FAILED:', err.message);
    failures++;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-delegation-log.json', JSON.stringify(out, null, 2));
    await browser.close();
    console.log(`${out.length - failures}/${out.length} passed`);
    process.exitCode = failures ? 1 : 0;
  }
})();
