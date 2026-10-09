/**
 * Phase 6 Batch 9 acceptance in the browser: the Owner Center's decision sections follow the
 * current approval routing, and the Owner Exception Center lifecycle (acknowledge, waiting,
 * resolve, dismiss, reopen, stale, history) obeys criticality and permissions. Run against a
 * freshly seeded dev database with the dev server, as the real dev accounts. Project risk levels
 * and one exception's "last activity" are set in PostgreSQL (the only shortcuts); everything else
 * goes through the API and the screens.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6-owner-center.cjs
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
const ownerScreen = async (page) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
  await L.nav(page, 'Owner Dashboard');
  await page.getByTestId('owner-center').waitFor({ timeout: 20000 });
  await page.getByTestId('owner-decisions').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
};
const text = async (loc) => ((await loc.count()) ? (await loc.first().innerText()).replace(/\s+/g, ' ') : '');
const card = (page, id) => page.getByTestId('owner-exceptions').getByTestId(`owner-exception-${id}`);

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const purchasing = await as('purchasing');
    const admin = await as('admin');
    const client = await as('client');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    const P = {};
    for (const tag of ['deleg', 'own', 'strat', 'risk', 'crit']) {
      const id = `proj-p6o-${tag}-${RUN}`;
      await call(owner, 'POST', '/api/projects', { id, project_number: `NW-P6O-${tag}-${RUN}`.toUpperCase(), project_name: `P6 Owner ${tag} ${RUN}`, client_id: 'client-2', site_address: 'KL', contract_value: 5000000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);
      P[tag] = id;
    }
    await call(owner, 'PUT', `/api/projects/${P.strat}/sensitivity`, { sensitivity: 'Strategic', reason: 'Board-level client' }, 200);
    const rule = (await call(owner, 'POST', '/api/authority/rules', { name: `PM VOs ${RUN}`, description: 'Routine variations on the delegated project', effect: 'allow', decision_type: 'variation', target_role: 'Project Manager', project_id: P.deleg, max_value: 10000, priority: 200 }, 201)).body;
    const vo = async (project, amount, raiser) => {
      const id = `vo-p6o-${RUN}-${Math.random().toString(36).slice(2, 6)}`;
      await call(raiser, 'POST', '/api/variations', { id, variation_number: id.toUpperCase(), project_id: project, project_name: 'P', title: `Joinery change ${id.slice(-4)}`, description: 'x', reason: 'Client request', requested_by: 'Client', estimated_cost: 100, client_amount: amount, status: 'Internal Approval', created_at: '' }, 201);
      return id;
    };
    const voDelegated = await vo(P.deleg, 4000, owner); // routed to the PM (rule)
    const voOwner = await vo(P.own, 4000, pm); // no delegation: the Owner's
    const voStrat = await vo(P.strat, 1500, pm); // Strategic: the Owner's, high risk
    const major = `apr-p6o-${RUN}`;
    await call(purchasing, 'POST', '/api/approvals', { id: major, approval_number: major.toUpperCase(), approval_type: 'Major Purchase', title: `Timber ${RUN}`, description: 'x', project_id: P.deleg, project_name: 'P', assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-09', decision: 'Pending', created_at: '', updated_at: '' }, 201);
    const routeRole = (id) => q(`select u.role from approval_routes ar join users u on u.id = ar.assigned_user_id where ar.resource_id = '${id}' and ar.status = 'open'`);

    // 1. Requires my decision follows routing.
    await ownerScreen(owner);
    const dec = await text(owner.getByTestId('owner-decisions'));
    record(1, 'Requires my decision = current routing', `routes: delegated VO → ${routeRole(voDelegated)}, Major Purchase → ${routeRole(major)}, own VO → ${routeRole(voOwner)}; list shows own VO: ${dec.includes(voOwner.toUpperCase().slice(-4)) || dec.includes('Joinery change ' + voOwner.slice(-4))}, delegated VO: ${dec.includes('Joinery change ' + voDelegated.slice(-4))}, Major Purchase: ${dec.includes(`Timber ${RUN}`)}`,
      routeRole(voDelegated) === 'Project Manager' && routeRole(major) === 'Accountant' && dec.includes('Joinery change ' + voOwner.slice(-4)) && !dec.includes('Joinery change ' + voDelegated.slice(-4)) && !dec.includes(`Timber ${RUN}`) && /Owner required/.test(dec));
    await owner.screenshot({ path: L.SHOTS + 'phase6-owner-center-decisions.png', fullPage: false });

    // 2. High-risk decisions: the Strategic one, with the reason; not the routine delegated one.
    const hr = await text(owner.getByTestId('owner-high-risk'));
    record(2, 'High-risk decisions', hr.slice(0, 220), hr.includes('Joinery change ' + voStrat.slice(-4)) && /High risk: Strategic project/.test(hr) && !hr.includes('Joinery change ' + voDelegated.slice(-4)));

    // 3. Recently delegated: with the delegate now.
    let rd = await text(owner.getByTestId('owner-recently-delegated'));
    record(3, 'Recently delegated (pending with delegates)', rd.slice(0, 260), rd.includes('Joinery change ' + voDelegated.slice(-4)) && /With delegate now/.test(rd) && rd.includes(rule.code) && rd.includes(`Timber ${RUN}`) && /SYS-PURCHASE-ACCOUNTANT/.test(rd));

    // 4. The PM decides it; then the rule is switched off: history vs today.
    await call(pm, 'POST', `/api/variations/${voDelegated}/transition`, { status: 'Client Approval' }, 200);
    await call(owner, 'POST', `/api/authority/rules/${rule.id}/deactivate`, { reason: 'Owner acceptance: switch off' }, 200);
    await ownerScreen(owner);
    rd = await text(owner.getByTestId('owner-recently-delegated'));
    const item = owner.getByTestId('owner-recently-delegated').getByTestId('delegated-item').filter({ hasText: 'Joinery change ' + voDelegated.slice(-4) });
    record(4, 'Recently delegated (decided; delegation since revoked)', `${await item.getAttribute('data-delegation')}: ${(await text(item)).slice(0, 220)}`, (await item.getAttribute('data-delegation')) === 'decided' && /Decided by delegate/.test(await text(item)) && /no longer in force/.test(await text(item)) && /valid under the terms at the time/.test(await text(item)));
    const stillOwner = await text(owner.getByTestId('owner-decisions'));
    record(5, 'Decided item no longer in Requires my decision', `own VO listed: ${stillOwner.includes('Joinery change ' + voOwner.slice(-4))}; decided VO listed: ${stillOwner.includes('Joinery change ' + voDelegated.slice(-4))}`, stillOwner.includes('Joinery change ' + voOwner.slice(-4)) && !stillOwner.includes('Joinery change ' + voDelegated.slice(-4)));

    // 6. Exception lifecycle in the browser: acknowledge, waiting (reason), dismiss (reason).
    q(`update projects set risk_status = 'At Risk', risk_reason = 'acceptance signal' where id = '${P.risk}'`);
    q(`update projects set risk_status = 'Critical', risk_reason = 'acceptance signal' where id = '${P.crit}'`);
    await call(owner, 'POST', '/api/automation/run', { rule: 'exception_lifecycle' }, 200);
    const riskId = `project:${P.risk}:At Risk`;
    const critId = `project:${P.crit}:Critical`;
    await ownerScreen(owner);
    const rc = card(owner, riskId);
    await rc.getByRole('button', { name: 'Acknowledge' }).click();
    await owner.waitForTimeout(1200);
    const s1 = await rc.getByTestId('exception-state').getAttribute('data-state');
    await rc.getByRole('button', { name: 'Waiting…' }).click();
    await rc.getByLabel('wait reason').fill('Waiting for the PM recovery plan');
    await rc.getByRole('button', { name: 'Mark waiting' }).click();
    await owner.waitForTimeout(1200);
    const s2 = await rc.getByTestId('exception-state').getAttribute('data-state');
    const waitingText = await text(rc);
    record(6, 'Acknowledge → Waiting on screen', `${s1} → ${s2}; "${(waitingText.match(/Waiting for: [^·]+?(?= Recommended| Priority|$)/) ?? [''])[0].slice(0, 60)}"`, s1 === 'acknowledged' && s2 === 'waiting' && /Waiting for: Waiting for the PM recovery plan/.test(waitingText));

    // 7. Critical: no Dismiss / Snooze on screen; forged API dismissal refused; ack/wait/resolve allowed.
    const cc = card(owner, critId);
    const critButtons = await cc.getByRole('button').allInnerTexts();
    const forged = await L.api(owner, 'POST', '/api/owner/exceptions/dismiss', { id: critId, reason: 'not important' });
    const forged2 = await L.api(owner, 'POST', '/api/owner/exceptions/dismiss', { id: critId, reason: 'x', severity: 'info' });
    const snooze = await L.api(owner, 'POST', '/api/owner/exceptions/snooze', { id: critId, hours: 4, reason: 'later' });
    await cc.getByRole('button', { name: 'Acknowledge' }).click();
    await owner.waitForTimeout(1000);
    await cc.getByRole('button', { name: 'Resolve' }).click();
    await owner.waitForTimeout(1200);
    const critState = await cc.getByTestId('exception-state').getAttribute('data-state');
    record(7, 'Critical exception: never dismissed or snoozed', `buttons: ${critButtons.filter((b) => /Dismiss|Snooze/.test(b)).join(',') || 'no Dismiss/Snooze'}; forged dismiss ${forged.status}, with severity field ${forged2.status}, snooze ${snooze.status}; after Acknowledge + Resolve: ${critState} (still listed)`, !critButtons.some((b) => /Dismiss|Snooze/.test(b)) && forged.status === 400 && forged2.status === 400 && snooze.status === 400 && critState === 'resolved');

    // 8. Dismiss needs a reason; the dismissed exception is kept under "Resolved and dismissed".
    const noReason = await L.api(owner, 'POST', '/api/owner/exceptions/dismiss', { id: riskId });
    await rc.getByRole('button', { name: 'Dismiss…' }).click();
    const disabled = await rc.getByRole('button', { name: 'Dismiss', exact: true }).isDisabled();
    await rc.getByLabel('dismiss reason').fill('Recovery plan agreed; tracked weekly');
    await rc.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await owner.waitForTimeout(1500);
    await owner.getByTestId('owner-exceptions-closed').getByRole('button', { name: /Show resolved and dismissed/ }).click();
    const closed = owner.getByTestId(`closed-exception-${riskId}`);
    const closedState = await closed.getByTestId('exception-state').getAttribute('data-state');
    record(8, 'Dismiss with a reason; kept, not deleted', `API without reason ${noReason.status}; button disabled until a reason: ${disabled}; closed list: ${closedState}; rows kept ${q(`select count(*) from owner_exception_states where exception_key = '${riskId}'`)}`, noReason.status === 400 && disabled && closedState === 'dismissed');

    // 9. History on screen: every transition, who and why.
    await closed.getByRole('button', { name: 'History' }).click();
    await owner.waitForTimeout(1000);
    const actions = await closed.getByTestId('exception-history').locator('li').evaluateAll((els) => els.map((e) => e.getAttribute('data-action')));
    const histText = await text(closed.getByTestId('exception-history'));
    record(9, 'History intact', `${actions.join(' → ')}`, actions.join(',') === 'observed,acknowledge,wait,dismiss' && /Recovery plan agreed/.test(histText) && /Waiting for the PM recovery plan/.test(histText));
    await owner.screenshot({ path: L.SHOTS + 'phase6-owner-center-lifecycle.png', fullPage: false });

    // 10. Reopen (reason), then stale after 14 days without activity; stale stays listed and filterable.
    await call(owner, 'POST', '/api/owner/exceptions/reopen', { id: riskId, reason: 'Plan slipped' }, 200);
    q(`update owner_exception_states set last_activity_at = now() - interval '15 days' where exception_key = '${riskId}'`);
    await call(owner, 'POST', '/api/automation/run', { rule: 'exception_lifecycle' }, 200);
    await call(owner, 'POST', '/api/automation/run', { rule: 'exception_lifecycle' }, 200);
    await ownerScreen(owner);
    await owner.getByLabel('Filter by lifecycle state').selectOption('stale');
    await owner.waitForTimeout(1500);
    const staleCards = await owner.getByTestId('owner-exceptions').getByTestId('exception-state').evaluateAll((els) => els.map((e) => e.getAttribute('data-state')));
    const staleShown = await card(owner, riskId).count();
    const staleEvents = q(`select count(*) from owner_exception_events where exception_key = '${riskId}' and action = 'stale'`);
    record(10, 'Stale: marked, still listed, filterable, not resolved', `filter "stale" shows ${staleCards.length} card(s) [${[...new Set(staleCards)].join(',')}], ours: ${staleShown}; stale events ${staleEvents}; state ${q(`select state from owner_exception_states where exception_key = '${riskId}'`)}`, staleShown === 1 && staleCards.every((s) => s === 'stale') && staleEvents === '1');
    await owner.getByLabel('Filter by lifecycle state').selectOption('');

    // 11. Permissions: only the Owner acts; Admin sees the Owner Center but not the lifecycle; client nothing.
    const denied = [];
    for (const [who, page] of [['Admin', admin], ['PM', pm], ['Purchasing', purchasing], ['Client', client]]) {
      denied.push(`${who} ${(await L.api(page, 'POST', '/api/owner/exceptions/acknowledge', { id: riskId })).status}/${(await L.api(page, 'GET', `/api/owner/exceptions/history?id=${encodeURIComponent(riskId)}`)).status}/${(await L.api(page, 'GET', '/api/owner/center')).status}`);
    }
    record(11, 'Only the Owner acts on the lifecycle', denied.join(', '), denied.join(',') === 'Admin 403/403/200,PM 403/403/403,Purchasing 403/403/403,Client 403/403/403');

    // 12. Usable at the existing desktop sizes (no dedicated mobile view is claimed).
    const sizes = [];
    for (const [w, h] of [[1700, 1000], [1280, 800]]) {
      await owner.setViewportSize({ width: w, height: h });
      await ownerScreen(owner);
      const overflow = await owner.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const visible = await Promise.all(['owner-decisions', 'owner-high-risk', 'owner-recently-delegated', 'owner-exceptions'].map((t) => owner.getByTestId(t).isVisible()));
      sizes.push({ w, h, overflow, visible: visible.every(Boolean) });
    }
    await owner.screenshot({ path: L.SHOTS + 'phase6-owner-center-1280.png', fullPage: false });
    record(12, 'Owner Center at supported desktop sizes', sizes.map((s) => `${s.w}x${s.h}: sections ${s.visible ? 'visible' : 'MISSING'}, horizontal overflow ${s.overflow}px`).join('; '), sizes.every((s) => s.visible && s.overflow <= 0));

    // Clean-up: the rule stays switched off (never deleted); project risk back to normal.
    q(`update projects set risk_status = 'On Track' where id in ('${P.risk}', '${P.crit}')`);

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors.filter((e) => !/ 40[034]$/.test(e))]));
    record(13, 'No page or API errors', `unexpected errors: ${JSON.stringify(errors)} (expected 400/403/404 refusals filtered)`, Object.values(errors).every((e) => e.length === 0));
  } catch (err) {
    console.error('FAILED:', err.message);
    failures++;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-owner-center-log.json', JSON.stringify(out, null, 2));
    await browser.close();
    console.log(`${out.length - failures}/${out.length} passed`);
    process.exitCode = failures ? 1 : 0;
  }
})();
