/**
 * Phase 5 acceptance in the browser, against the running dev server (its own scheduler and
 * event triggers are live — nothing here calls the automation directly except the Admin's
 * "Run all now" button in step 16). Each step prints what PostgreSQL holds.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase5.cjs
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p5-${RUN}`;
const q = L.psql;
const out = [];
const record = (n, what, evidence) => {
  out.push({ n, what, evidence });
  console.log(`${n} [${what}] ${evidence}`);
};
const wait = async (page, check, ms = 90_000) => {
  for (let t = 0; t < ms; t += 1000) {
    const v = check();
    if (v) return v;
    await page.waitForTimeout(1000);
  }
  throw new Error('timed out waiting for the server');
};
const fresh = async (page) => {
  await page.reload({ waitUntil: 'networkidle' });
  await L.synced(page);
};
const ok = async (page, method, path, body, status) => {
  const r = await L.api(page, method, path, body);
  if (status && r.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

(async () => {
  const browser = await L.chromium.launch();
  const pages = {};
  const as = async (acct) => (pages[acct] ??= await L.open(acct, browser));
  try {
    const owner = await as('owner-ceo');
    const pm = await as('project-manager');
    const prod = await as('production-manager');
    const site = await as('site-supervisor');
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);
    const prodId = q(`select id from users where email='production-manager@dev.nwos.local'`);

    // A healthy project (set up through the API as the people who would do it).
    await ok(owner, 'POST', '/api/projects', { id: P, project_number: `NW-P5-${RUN}`, project_name: `P5 Gallery ${RUN}`, client_id: 'client-2', site_address: 'KL', contract_value: 80000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);
    await ok(pm, 'POST', '/api/drawings', { id: `dwg-${RUN}`, project_id: P, drawing_number: `P5-${RUN}`, title: 'Display wall', category: 'Carpentry', created_at: '2026-10-01', revisions: [], nw_production_drawings: [] }, 201);
    await ok(pm, 'POST', `/api/drawings/dwg-${RUN}/revisions`, { id: `rev-${RUN}`, revision: 'Rev 1', title: 'Rev 1', file_url: '/p5.pdf', notes: '', drawing_type: 'Client / Designer Drawing' }, 201);
    await ok(pm, 'POST', `/api/drawings/dwg-${RUN}/revisions/rev-${RUN}/status`, { status: 'Internal Review' }, 200);
    await ok(owner, 'POST', `/api/drawings/dwg-${RUN}/revisions/rev-${RUN}/status`, { status: 'Approved' }, 200);
    const drawing = await ok(owner, 'GET', `/api/drawings/dwg-${RUN}`, undefined, 200);
    const nw = { id: `nwd-${RUN}`, drawing_number: `P5-${RUN}-NW`, revision: 'Rev 1', title: 'Shop drawing', file_url: '/nw.pdf', linked_client_drawing_id: `dwg-${RUN}`, linked_client_revision: 'Rev 1', status: 'Approved', approved_for_production: true, created_by: 'x', created_at: '2026-10-01' };
    await ok(owner, 'PATCH', `/api/drawings/dwg-${RUN}`, { ...drawing, nw_production_drawings: [nw] }, 200);
    await ok(pm, 'POST', '/api/work-packages', { id: `wp-${RUN}`, project_id: P, name: 'GALLERY', category: 'Carpentry', contractor_id: 'con-1', project_manager_id: pmId, start_date: '2026-01-01', end_date: '2027-12-01', status: 'Assigned', progress_percent: 0 }, 201);
    await ok(pm, 'POST', '/api/work-items', { id: `item-${RUN}`, work_package_id: `wp-${RUN}`, item_code: `GAL-${RUN.slice(-3)}`, description: 'Display wall', location: 'L1', quantity: 1, unit: 'unit', drawing_id: `dwg-${RUN}`, drawing_revision: 'Rev 1', material: 'ply', finish: 'oak', dimensions: '3000x2400', required_date: '2027-06-01', contractor_id: 'con-1', status: 'Assigned', progress_percent: 0, photos: [], production_status: 'Not Started', delivery_status: 'Not Scheduled', installation_status: 'Not Started' }, 201);
    const order = { id: `po-${RUN}`, order_number: `PO-P5-${RUN}`, project_id: P, project_name: 'P5', work_package_id: `wp-${RUN}`, work_item_id: `item-${RUN}`, work_item_code: 'GAL', client_id: 'client-2', location: 'L1', contractor_id: 'con-1', contractor_name: 'Hock Seng', production_manager_id: prodId, required_date: '2027-05-01', current_stage: 'Cutting', priority: 'Normal', status: 'Cutting', approved_client_drawing_id: `dwg-${RUN}`, approved_client_drawing_revision: `P5-${RUN} Rev 1`, approved_nw_production_drawing_id: `nwd-${RUN}`, approved_nw_production_drawing_revision: `P5-${RUN}-NW Rev 1`, production_method: 'NW-PM-Wall Rev 1', material: 'ply', finish: 'oak', dimensions: '3000x2400', quantity: 1, notes: '', photos: [], barcode: 'B', qr_code: 'Q', stage_history: [], created_at: '2026-10-01', updated_at: '2026-10-01' };
    // The production manager works on assigned projects only: the Admin adds this one.
    const assigned = q(`select coalesce(string_agg(project_id, ','), '') from project_assignments where user_id='${prodId}'`).split(',').filter(Boolean);
    await ok(await as('admin'), 'PUT', `/api/users/${prodId}/projects`, { project_ids: [...assigned, P] }, 200);
    await prod.reload({ waitUntil: 'networkidle' });
    await L.synced(prod);
    await ok(prod, 'POST', '/api/production-orders', order, 201);
    await ok(pm, 'POST', '/api/installation-jobs', { id: `inst-${RUN}`, job_number: `INS-${RUN}`, work_item_id: `item-${RUN}`, work_item_code: 'GAL', work_item_description: 'Display wall', project_id: P, project_name: 'P5', work_package_id: `wp-${RUN}`, location: 'L1', contractor_id: 'con-1', contractor_name: 'Hock Seng', lead_installer: 'A', installer_contact: '', site_supervisor_id: siteId, site_supervisor_name: 'S', team_headcount: 2, status: 'In Progress', planned_start_date: '2026-10-01', planned_completion_date: '2027-11-30', drawing_reference: `dwg-${RUN}`, drawing_revision: 'Rev 1', checklist: {}, progress_percent: 0, photos: [] }, 201);
    const baseRisk = (await ok(owner, 'GET', `/api/projects/${P}/risk`, undefined, 200)).level;
    record(0, 'setup', `project ${P}; drawing check ${q(`select drawing_check from production_orders where id='po-${RUN}'`)}; risk ${baseRisk}`);

    // 1. event → task
    await ok(prod, 'PATCH', `/api/production-orders/po-${RUN}`, { status: 'Blocked', blocked_reason: 'Edge bander down' }, 200);
    const task1 = await wait(prod, () => q(`select assigned_user_id||' '||status||' '||source_rule from tasks where id='tsk-auto-prod-po-${RUN}'`));
    record(1, 'Production blocked (Production Manager) → server raises a task', `${task1}; trigger ${q(`select trigger from automation_runs where rule_key='production_blocked' order by id desc limit 1`)}`);

    // 2. notification, seen in the Notification center
    await L.nav(prod, 'Automation');
    await prod.waitForTimeout(800);
    const notes = await ok(prod, 'GET', '/api/notifications', undefined, 200);
    const n2 = notes.find((n) => n.project_id === P);
    record(2, 'Notification generated', n2 ? `"${n2.title}" group=${n2.group} source=${n2.source}` : 'MISSING');

    // 3. the scheduler runs on its own
    const before3 = Number(q(`select count(*) from automation_runs where trigger='schedule'`));
    q(`update automation_rules set next_run_at = now() - interval '1 second' where key in ('task_overdue','project_risk')`);
    await wait(owner, () => Number(q(`select count(*) from automation_runs where trigger='schedule'`)) >= before3 + 2);
    record(3, 'Scheduled automation runs without the browser', `${Number(q(`select count(*) from automation_runs where trigger='schedule'`)) - before3} scheduled runs; last ${q(`select rule_key||' '||status from automation_runs where trigger='schedule' order by id desc limit 1`)}`);

    // 4. overdue task → escalation
    await ok(pm, 'POST', '/api/tasks', { id: `late-${RUN}`, task_number: `LATE-${RUN}`, title: `Confirm site access (${RUN})`, description: '', project_id: P, project_name: 'P5', source_event: 'm', source_module: 'PM', assigned_user_id: pmId, assigned_user_name: 'PM', assigned_role: 'Project Manager', priority: 'High', due_date: '2026-01-05', status: 'Open', escalation_level: 'None', comments: [], attachments: [], created_date: '' }, 201);
    q(`update automation_rules set next_run_at = now() - interval '1 second' where key = 'task_overdue'`);
    const esc = await wait(owner, () => q(`select string_agg(data->>'level', ',' order by data->>'level') from escalations where source_record_id='late-${RUN}'`));
    record(4, 'Overdue high-priority task escalated', `levels ${esc}`);

    // 6. failed site QC → rectification (event)
    await ok(site, 'POST', '/api/site-qc', { id: `sqc1-${RUN}`, inspection_number: `SQC1-${RUN}`, work_item_id: `item-${RUN}`, work_item_code: 'GAL', installation_job_id: `inst-${RUN}`, project_id: P, project_name: 'P5', inspection_date: '2026-10-04', result: 'Fail / Rectification Required', snag_items: [{ id: 's1', description: 'Panel gap' }], photos: [], comments: '' }, 201);
    const rect = await wait(site, () => q(`select assigned_user_id||' evidence='||coalesce(data->>'requires_evidence','') from tasks where id='tsk-auto-sqc1-${RUN}'`));
    record(6, 'Failed QC creates the rectification workflow', `${rect}; issue ${q(`select status from issues where id='issue-rect-sqc1-${RUN}'`)}`);

    // 7. risk
    q(`update automation_rules set next_run_at = now() - interval '1 second' where key = 'project_risk'`);
    const r7 = await wait(owner, () => { const v = q(`select risk_status from projects where id='${P}'`); return ['At Risk', 'Critical'].includes(v) ? v : undefined; });
    record(7, 'Risk changes with real conditions', `${baseRisk} → ${r7}: ${q(`select risk_reason from projects where id='${P}'`).slice(0, 160)}`);

    // 5 + 8. Owner center (UI)
    await fresh(owner);
    await L.nav(owner, 'Owner Dashboard');
    await owner.getByTestId('owner-critical').waitFor({ timeout: 15000 });
    await owner.waitForTimeout(1500);
    const more = owner.getByTestId('owner-critical').getByRole('button', { name: /^Show all/ });
    if (await more.count()) await more.click();
    const crit = await owner.getByTestId('owner-critical').innerText();
    record(5, 'Blocked production is an Owner exception (UI)', `shown: ${/blocked/i.test(crit) && crit.includes(`PO-P5-${RUN}`)}`);
    record(8, 'Owner dashboard shows the exceptions (UI)', `QC failure shown: ${/Site QC failed/.test(crit)}; escalation shown: ${/Escalat|Confirm site access/.test(crit)}`);
    await owner.screenshot({ path: L.SHOTS + 'p5-owner-center.png', fullPage: true });

    // 9. PM dashboard (UI)
    await fresh(pm);
    await L.nav(pm, 'Dashboard');
    await pm.getByTestId('daily-briefing').waitFor({ timeout: 15000 });
    await pm.waitForTimeout(1500);
    record(9, 'PM dashboard shows the task (UI)', `briefing lists it: ${(await pm.getByTestId('daily-briefing').innerText()).includes(`Confirm site access (${RUN})`)}`);

    // 10-14. Owner asks the assistant, proposes, approves; the system executes (UI)
    await owner.getByLabel('Active Project').selectOption(P);
    await L.nav(owner, 'AI Assistant');
    await owner.getByTestId('operating-assistant').waitFor({ timeout: 10000 });
    await owner.getByLabel('Ask the assistant').fill('Why is this project at risk?');
    await owner.getByRole('button', { name: 'Ask', exact: true }).click();
    const ans = owner.getByTestId('assistant-answer').first();
    await ans.waitFor({ timeout: 15000 });
    const text = await ans.innerText();
    record(10, 'Owner asks the AI why the project is at risk (UI)', text.split('\n')[0]);
    const sources = JSON.parse(q(`select after->'sources' from audit_logs where action='ai.query' and actor_id='${q(`select id from users where email='owner-ceo@dev.nwos.local'`)}' order by id desc limit 1`));
    record(11, 'AI retrieves authorized data only', `${sources.length} records read; Confirmed labels: ${(text.match(/Confirmed/g) || []).length}; contractor gets: "${(await ok(await as('contractor'), 'POST', '/api/assistant/ask', { question: 'Why is this project at risk?', project_id: P }, 200)).answer.slice(0, 60)}"`);
    record(12, 'AI gives recommendations, not decisions', `recommendations shown: ${/you decide/i.test(text)}; proposal buttons: ${await owner.locator('button', { hasText: 'Propose:' }).count()}`);
    await owner.locator('button', { hasText: 'Propose: Create a follow-up task' }).first().click();
    await owner.getByTestId('assistant-proposal').waitFor({ timeout: 10000 });
    const pending = q(`select id from approvals where approval_type='AI Proposal' and project_id='${P}' and decision='Pending' order by created_at desc limit 1`);
    await owner.getByRole('button', { name: 'Approve & run' }).click();
    await owner.getByText('approved and executed').waitFor({ timeout: 15000 });
    record(13, 'Owner approves the consequential action (UI)', `${pending}: ${q(`select decision||' by '||decision_by_id from approvals where id='${pending}'`)}`);
    record(14, 'The action executes', `task ${q(`select id||' → '||assigned_user_id||' '||status from tasks where id='tsk-ai-${pending}'`)}`);
    record(15, 'Audit log records it', q(`select string_agg(action, ', ' order by id) from audit_logs where entity_id='${pending}'`));
    await owner.screenshot({ path: L.SHOTS + 'p5-ai.png', fullPage: true });

    // 16. re-running creates no duplicates (Admin presses Run all now twice)
    const ledger = () => q(`select (select count(*) from tasks where project_id='${P}')||'/'||(select count(*) from notifications where project_id='${P}')||'/'||(select count(*) from escalations where project_id='${P}')`);
    const before16 = ledger();
    const admin = await as('admin');
    await L.nav(admin, 'Automation');
    for (let i = 0; i < 2; i++) {
      await admin.getByTestId('automation-rules').getByRole('button', { name: 'Run all now' }).click();
      await admin.waitForTimeout(3000);
    }
    record(16, 'Re-running the events creates no duplicates', `tasks/notifications/escalations ${before16} → ${ledger()}`);

    // 17. people fix it → healthy
    await ok(prod, 'PATCH', `/api/production-orders/po-${RUN}`, { status: 'Assembly', current_stage: 'Assembly' }, 200);
    await ok(pm, 'PATCH', `/api/tasks/late-${RUN}`, { status: 'Completed' }, 200);
    await ok(prod, 'PATCH', `/api/tasks/tsk-ai-${pending}`, { status: 'Completed' }, 200);
    await ok(site, 'PATCH', `/api/tasks/tsk-auto-sqc1-${RUN}`, { status: 'Completed', completion_evidence: 'Gap closed' }, 200);
    await ok(pm, 'PATCH', `/api/issues/issue-rect-sqc1-${RUN}`, { status: 'Resolved', resolution_notes: 'Re-set' }, 200);
    await ok(site, 'POST', '/api/site-qc', { id: `sqc2-${RUN}`, inspection_number: `SQC2-${RUN}`, work_item_id: `item-${RUN}`, work_item_code: 'GAL', installation_job_id: `inst-${RUN}`, project_id: P, project_name: 'P5', inspection_date: '2026-10-06', result: 'Pass', snag_items: [], photos: [], comments: '' }, 201);
    q(`update automation_rules set next_run_at = now() - interval '1 second'`);
    const healthy = await wait(owner, () => (q(`select risk_status from projects where id='${P}'`) === 'On Track' && q(`select count(*) from escalations where project_id='${P}' and status <> 'Resolved'`) === '0' ? 'yes' : undefined));
    record(17, 'Project returns to healthy', `risk ${q(`select risk_status from projects where id='${P}'`)}; open escalations 0: ${healthy}; automation task ${q(`select status from tasks where id='tsk-auto-prod-po-${RUN}'`)}`);

    // 18. Owner list updates (UI)
    await fresh(owner);
    await L.nav(owner, 'Owner Dashboard');
    await owner.getByTestId('owner-critical').waitFor({ timeout: 15000 });
    await owner.waitForTimeout(1500);
    const more18 = owner.getByTestId('owner-critical').getByRole('button', { name: /^Show all/ });
    if (await more18.count()) await more18.click();
    const crit18 = await owner.getByTestId('owner-critical').innerText();
    record(18, 'Owner exception list updates (UI)', `project still listed: ${crit18.includes(`PO-P5-${RUN}`) || crit18.includes(`Confirm site access (${RUN})`)}`);

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors]));
    console.log('API refusals / page errors:', JSON.stringify(errors));
  } catch (err) {
    console.error('FAILED:', err.message);
    for (const [k, p] of Object.entries(pages)) await p.screenshot({ path: L.SHOTS + `p5-fail-${k}.png`, fullPage: true }).catch(() => {});
    process.exitCode = 1;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase5-log.json', JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
