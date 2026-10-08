/**
 * Phase 6 Batch 6 acceptance in the browser: delegation coverage, temporary authority, expiry
 * and Owner absence, against the running dev server as the real dev accounts. Temporary
 * authority and the absence are created, extended and ended on the Delegated Authority screen
 * (preview → confirm); the expiry case uses a rule that really ends a few seconds later and the
 * server's own delegation watch (POST /api/automation/run). The recorded run is on a freshly
 * seeded dev database (migrate, auth:seed-dev, db:import-demo), where variations have no
 * delegate, so the variation coverage gap is real.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-coverage.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
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
const local = (ms) => {
  const d = new Date(Date.now() + ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const DAY = 86400000;
const route = (id) => q(`select u.role || ' ' || coalesce(ar.authority_rule_id, '-') from approval_routes ar join users u on u.id = ar.assigned_user_id where resource_kind = 'variation' and resource_id = '${id}' and status = 'open'`);
const authorityTab = async (page, tab) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
  await L.nav(page, 'Delegated Authority');
  await page.getByTestId('authority-settings').waitFor({ timeout: 15000 });
  await page.getByTestId('authority-settings').getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(1500);
};

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const admin = await as('admin');
    const accountant = await as('accountant');
    const purchasing = await as('purchasing');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    const project = async (suffix, sensitivity) => {
      const id = `proj-p6c-${RUN}-${suffix}`;
      await call(owner, 'POST', '/api/projects', { id, project_number: `NW-P6C-${RUN}-${suffix}`, project_name: `P6 Coverage ${RUN} ${suffix}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);
      if (sensitivity) await call(owner, 'PUT', `/api/projects/${id}/sensitivity`, { sensitivity, reason: 'acceptance' }, 200);
      return id;
    };
    let vn = 0;
    const variation = async (proj, amount) => {
      const id = `vo-p6c-${RUN}-${++vn}`;
      await call(owner, 'POST', '/api/variations', { id, variation_number: id.toUpperCase(), project_id: proj, project_name: 'P6C', title: `Panel ${vn}`, description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }, 201);
      return id;
    };
    const P = await project('a');
    const P2 = await project('b');
    const P3 = await project('c');

    // 1. Coverage matrix on the screen, from the server's rules.
    const vo1 = await variation(P, 4000);
    await authorityTab(owner, 'Coverage');
    const cov = (await call(owner, 'GET', '/api/authority/coverage', null, 200)).body;
    const cell = cov.cells.find((c) => c.decision_type === 'variation' && c.scope.startsWith('Normal'));
    const row = owner.getByTestId('coverage-matrix').locator('tr', { hasText: cell.label }).filter({ hasText: cell.value_label }).first();
    const rowText = (await row.innerText()).replace(/\s+/g, ' ');
    const health = (await owner.getByTestId('coverage-health').innerText()).replace(/\s+/g, ' ');
    await owner.screenshot({ path: L.SHOTS + 'p6c-01-coverage.png', fullPage: false });
    record(1, 'Coverage matrix (server-derived)', `${cov.cells.length} cells; variation row "${rowText}"; health "${health}"; definition "${cov.health.definition.slice(0, 90)}…"`, cell.status === 'Uncovered' && rowText.includes('Uncovered') && cov.cells.some((c) => c.status === 'Blocked by Sensitivity') && cov.cells.some((c) => c.status === 'Covered'));

    // 2. The gap: listed with a recommended action, and an Owner exception that links to Authority.
    const gap = cov.gaps.find((g) => g.decision_type === 'variation');
    const gapText = (await owner.getByTestId('coverage-gaps').innerText()).replace(/\s+/g, ' ');
    const ex = (await call(owner, 'GET', '/api/owner/exceptions', null, 200)).body.exceptions.find((e) => e.type === 'COVERAGE_GAP' && e.decision === 'variation');
    record(2, 'Coverage gap + Owner exception', `gap "${gap.reason}", pending ${gap.pending_affected}, recommended "${gap.recommended_action}"; exception ${ex?.severity} "${ex?.title}" → ${JSON.stringify(ex?.link)}; VO ${vo1} → ${route(vo1)}`, gapText.includes(gap.recommended_action) && gap.pending_affected >= 1 && ex?.severity === 'urgent' && ex.link.tab === 'authority' && route(vo1) === 'Owner / CEO -');

    // 3. Temporary authority on the screen: PM, variations on project A, up to RM 10,000, 3 days.
    await authorityTab(owner, 'Temporary');
    const before = q(`select count(*) from delegated_authorities`);
    await owner.getByLabel('Temporary target').selectOption(pmId);
    await owner.getByLabel('Temporary project').fill(P);
    await owner.getByLabel('Temporary value limit').fill('10000');
    await owner.getByLabel('Temporary end').fill(local(3 * DAY));
    await owner.getByLabel('Temporary reason').fill('Owner at the trade fair');
    await owner.getByRole('button', { name: 'Preview', exact: true }).click();
    await owner.getByTestId('temporary-preview').waitFor({ timeout: 10000 });
    const prev = (await owner.getByTestId('temporary-preview').innerText()).replace(/\s+/g, ' ');
    const during = q(`select count(*) from delegated_authorities`);
    await owner.screenshot({ path: L.SHOTS + 'p6c-03-temporary-preview.png', fullPage: false });
    await owner.getByRole('button', { name: 'Confirm and create' }).click();
    await owner.waitForTimeout(2500);
    const temp = q(`select id || ' ' || code || ' ' || authority_type || ' ' || priority || ' ' || max_value from delegated_authorities where authority_type = 'temporary' and project_id = '${P}' and active order by created_at desc limit 1`);
    const tempId = temp.split(' ')[0];
    const tAudit = q(`select string_agg(action, ', ' order by id) from audit_logs where entity_id = '${tempId}'`);
    record(3, 'Temporary authority: preview → confirm, same resolver', `preview "${prev.slice(0, 200)}"; rules during preview ${during} (before ${before}); rule ${temp}; audit ${tAudit}; pending VO ${vo1} re-routed → ${route(vo1)}`, during === before && / temporary 150 10000\.00$/.test(temp) && /authority\.temporary\.create/.test(tAudit) && route(vo1) === `Project Manager ${tempId}`);

    // 4. Coverage reflects it (project-scoped: partially covered) and the list shows it.
    const cov2 = (await call(owner, 'GET', '/api/authority/coverage', null, 200)).body;
    const cell2 = cov2.cells.find((c) => c.decision_type === 'variation' && c.scope.startsWith('Normal'));
    const listed = (await owner.getByTestId(`temporary-${temp.split(' ')[1]}`).innerText()).replace(/\s+/g, ' ');
    record(4, 'Coverage and Active list update', `variation now ${cell2.status} (${cell2.reasons.join('; ')}); listed "${listed.slice(0, 200)}"`, cell2.status === 'Partially Covered' && listed.includes('active') && listed.includes('Owner at the trade fair'));

    // 5. Extend on the screen: new end, reason, preview, confirm → a new rule; the old one off.
    const item = owner.getByTestId(`temporary-${temp.split(' ')[1]}`);
    await item.getByRole('button', { name: 'Extend…' }).click();
    await item.getByLabel('Extension end').fill(local(10 * DAY));
    await item.getByLabel('Extension reason').fill('Fair extended by a week');
    await item.getByRole('button', { name: 'Preview extension' }).click();
    await item.getByTestId('temporary-preview').waitFor({ timeout: 10000 });
    await item.getByRole('button', { name: 'Confirm extension' }).click();
    await owner.waitForTimeout(2500);
    const ext = q(`select id || ' ' || coalesce(extended_from, '-') || ' ' || (end_at > now() + interval '9 days') from delegated_authorities where extended_from = '${tempId}'`);
    const extId = ext.split(' ')[0];
    const old = q(`select active || ' ' || coalesce(deactivation_reason, '-') from delegated_authorities where id = '${tempId}'`);
    record(5, 'Extension', `new rule ${ext}; old rule ${old}; audit ${q(`select string_agg(action, ', ') from audit_logs where entity_id = '${extId}'`)}; VO ${vo1} → ${route(vo1)}`, ext.endsWith(`${tempId} true`) && old.startsWith('false Replaced') && route(vo1) === `Project Manager ${extId}`);

    // 6. Rejections: Sensitive project, missing permission, Client role, exceeding a System Owner requirement.
    const S = await project('s', 'Sensitive');
    const end = new Date(Date.now() + 2 * DAY).toISOString();
    const r6 = [];
    for (const [label, body] of [
      ['Sensitive', { decision_type: 'variation', target_user_id: pmId, project_id: S, max_value: 5000, end_at: end, reason: 'x' }],
      ['no permission (Site Supervisor)', { decision_type: 'variation', target_user_id: siteId, max_value: 5000, end_at: end, reason: 'x' }],
      ['Client', { decision_type: 'variation', target_role: 'Client', max_value: 5000, end_at: end, reason: 'x' }],
      ['above SYS-PURCHASE-MAJOR', { decision_type: 'purchase', target_role: 'Purchasing', max_value: 50000, end_at: end, reason: 'x' }],
      ['no end', { decision_type: 'variation', target_user_id: pmId, max_value: 5000, reason: 'x' }],
    ]) {
      const r = await L.api(owner, 'POST', '/api/authority/temporary/preview', body);
      r6.push(`${label} ${r.status} "${String(r.body?.message ?? r.body?.error ?? '').slice(0, 90)}"`);
    }
    record(6, 'Unsafe temporary authority rejected', r6.join('; '), r6.every((x) => / 400 /.test(x)));

    // 7. Expiry: a rule that ends in a few seconds; the delegation watch switches it off and re-routes.
    const shortEnd = new Date(Date.now() + 5000).toISOString();
    const sb = { decision_type: 'variation', target_user_id: pmId, project_id: P2, max_value: 10000, end_at: shortEnd, reason: 'Short cover' };
    const sp = (await call(owner, 'POST', '/api/authority/temporary/preview', sb, 200)).body;
    const short = (await call(owner, 'POST', '/api/authority/temporary', { ...sb, confirmation: sp.confirmation }, 201)).body;
    const vo2 = await variation(P2, 3000);
    const beforeExpiry = route(vo2);
    await owner.waitForTimeout(6500);
    const blocked = await L.api(pm, 'POST', `/api/variations/${vo2}/transition`, { status: 'Client Approval' });
    await call(owner, 'POST', '/api/automation/run', { rule: 'delegation_watch' }, 200);
    const expired = q(`select active || ' ' || deactivation_reason || ' ' || (expiry_processed_at is not null) from delegated_authorities where id = '${short.id}'`);
    const info = (await call(owner, 'GET', '/api/owner/exceptions', null, 200)).body.informational.find((e) => e.id === `temporary-expired:${short.id}`);
    record(7, 'Expiry: off, cannot approve, re-routed', `before ${beforeExpiry}; PM approval after end ${blocked.status} ${blocked.body?.reason_code ?? ''}; rule ${expired}; audit ${q(`select string_agg(action, ', ') from audit_logs where entity_id = '${short.id}' and action like '%expire%'`)}; VO → ${route(vo2)}; Owner informational "${info?.title}"`, beforeExpiry === `Project Manager ${short.id}` && blocked.status === 403 && expired === 'false Expired true' && route(vo2) === 'Owner / CEO -' && !!info);

    // 8. Owner absence on the screen: backup PM, variations up to RM 10,000, 2 days.
    const vo3 = await variation(P3, 6000);
    const vo4 = await variation(P3, 20000);
    await authorityTab(owner, 'Absence');
    await owner.getByLabel('Absence backup').selectOption(pmId);
    await owner.getByLabel('Absence end').fill(local(2 * DAY));
    await owner.getByLabel('Absence value limit').fill('10000');
    await owner.getByLabel('Absence reason').fill('Annual leave');
    await owner.getByRole('button', { name: 'Preview absence' }).click();
    await owner.getByTestId('absence-preview').waitFor({ timeout: 10000 });
    const ap = (await owner.getByTestId('absence-preview').innerText()).replace(/\s+/g, ' ');
    const absBefore = q(`select count(*) from owner_absences`);
    await owner.screenshot({ path: L.SHOTS + 'p6c-08-absence-preview.png', fullPage: false });
    await owner.getByRole('button', { name: 'Confirm absence' }).click();
    await owner.waitForTimeout(2500);
    const abs = q(`select id || ' ' || status from owner_absences order by created_at desc limit 1`);
    const absId = abs.split(' ')[0];
    const absRule = q(`select id from delegated_authorities where absence_id = '${absId}'`);
    record(8, 'Absence: preview → confirm → backup routing within limits', `preview "${ap.slice(0, 260)}"; absences during preview ${absBefore}; ${abs}; rule ${absRule}; RM 6,000 → ${route(vo3)}; RM 20,000 → ${route(vo4)}; audit ${q(`select string_agg(action, ', ') from audit_logs where entity_id = '${absId}'`)}`, /Not delegated/.test(ap) && /Strategic|Sensitive/.test(ap) && abs.endsWith(' active') && route(vo3) === `Project Manager ${absRule}` && route(vo4) === 'Owner / CEO -');

    // 9. The backup cannot change the absence or create authority.
    const b1 = await L.api(pm, 'POST', `/api/authority/absence/${absId}/end`, { reason: 'x' });
    const b2 = await L.api(pm, 'POST', '/api/authority/temporary/preview', { decision_type: 'variation', target_user_id: pmId, max_value: 99999, end_at: end, reason: 'x' });
    const b3 = await L.api(pm, 'POST', '/api/authority/absence/preview', { backup_user_id: pmId, end_at: end, decision_types: ['variation'], max_value: 99999, reason: 'x' });
    record(9, 'Backup cannot modify, extend or activate', `end ${b1.status}, temporary ${b2.status}, absence ${b3.status}`, [b1, b2, b3].every((r) => r.status === 403));

    // 10. End the absence on the screen: rules off, approvals back to the Owner.
    await authorityTab(owner, 'Absence');
    owner.once('dialog', (d) => d.accept('Back early'));
    await owner.getByTestId('absence-list').locator('li', { hasText: absId }).getByRole('button', { name: 'End absence now' }).click();
    await owner.waitForTimeout(2500);
    record(10, 'Absence end', `absence ${q(`select status || ' ' || end_reason from owner_absences where id = '${absId}'`)}; rule active ${q(`select active from delegated_authorities where id = '${absRule}'`)}; RM 6,000 → ${route(vo3)}`, q(`select status from owner_absences where id = '${absId}'`) === 'ended' && q(`select active from delegated_authorities where id = '${absRule}'`) === 'f' && route(vo3) === 'Owner / CEO -');

    // 11. Only the Owner: Admin, PM, Accountant, Purchasing.
    const denied = [];
    for (const [who, page] of [['Admin', admin], ['PM', pm], ['Accountant', accountant], ['Purchasing', purchasing]]) {
      denied.push(`${who} ${(await L.api(page, 'POST', '/api/authority/temporary/preview', { decision_type: 'variation', target_role: 'Project Manager', max_value: 1, end_at: end, reason: 'x' })).status}/${(await L.api(page, 'POST', `/api/authority/temporary/${extId}/extend/preview`, { end_at: end, reason: 'x' })).status}/${(await L.api(page, 'POST', '/api/authority/absence/preview', { backup_user_id: pmId, end_at: end, decision_types: ['variation'], reason: 'x' })).status}`);
    }
    record(11, 'Owner only (403)', denied.join(', '), denied.every((d) => d.endsWith('403/403/403')));

    // 12. Notifications: running the watch again creates nothing new.
    const n1 = q(`select count(*) from notifications where rule_key like 'delegation_watch:%'`);
    await call(owner, 'POST', '/api/automation/run', { rule: 'delegation_watch' }, 200);
    await call(owner, 'POST', '/api/automation/run', { rule: 'delegation_watch' }, 200);
    const n2 = q(`select count(*) from notifications where rule_key like 'delegation_watch:%'`);
    record(12, 'Notifications are not repeated', `delegation notifications ${n1} → ${n2}; kinds ${q(`select string_agg(distinct split_part(rule_key, ':', 2), ', ') from notifications where rule_key like 'delegation_watch:%'`)}`, n1 === n2);

    // 13. No orphan: every open route's rule is active and in force.
    const orphans = q(`select count(*) from approval_routes ar join delegated_authorities da on da.id = ar.authority_rule_id where ar.status = 'open' and (not da.active or (da.end_at is not null and da.end_at <= now()))`);
    record(13, 'No approval left with ended authority', `open routes on inactive/ended rules: ${orphans}`, orphans === '0');

    // Clean-up: end the extended temporary rule with a reason (never deleted).
    await call(owner, 'POST', `/api/authority/temporary/${extId}/end`, { reason: 'Batch 6 acceptance run finished' }, 200);

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[03]$/.test(e))]));
    console.log('Page errors (expected 400/403 refusals filtered):', JSON.stringify(errors));
  } catch (err) {
    console.error('FAILED:', err.message);
    failures++;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-coverage-log.json', JSON.stringify(out, null, 2));
    await browser.close();
    console.log(`${out.length - failures}/${out.length} passed`);
    process.exitCode = failures ? 1 : 0;
  }
})();
