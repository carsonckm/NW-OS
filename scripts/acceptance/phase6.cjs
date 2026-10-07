/**
 * Phase 6 Batch 2 acceptance against the running dev server: the authority resolver on real
 * approval paths, signed in as the real dev accounts (no shortcuts through the database).
 * Each step prints what PostgreSQL holds.
 *
 *   PLAYWRIGHT_MODULE=… node scripts/acceptance/phase6.cjs
 *
 * Delegated approvals are taken through the API in the signed-in browser session: the settings
 * and approval screens for delegated authority are later batches.
 */
const L = require('./lib.cjs');

const RUN = Date.now().toString(36);
const P = `proj-p6-${RUN}`;
const q = L.psql;
const out = [];
const record = (n, what, evidence) => {
  out.push({ n, what, evidence });
  console.log(`${n} [${what}] ${evidence}`);
};
const call = async (page, method, path, body, status) => {
  const r = await L.api(page, method, path, body);
  if (status && r.status !== status) throw new Error(`${method} ${path}: expected ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
  return r;
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
    const pmId = q(`select id from users where email='project-manager@dev.nwos.local'`);
    const siteId = q(`select id from users where email='site-supervisor@dev.nwos.local'`);

    await call(owner, 'POST', '/api/projects', { id: P, project_number: `NW-P6-${RUN}`, project_name: `P6 Lobby ${RUN}`, client_id: 'client-2', site_address: 'KL', contract_value: 90000, project_status: 'Active', start_date: '2026-01-01', end_date: '2027-12-31', signed_date: '', project_manager_id: pmId, site_supervisor_id: siteId, progress_percent: 0, description: '' }, 201);
    await call(pm, 'POST', '/api/drawings', { id: `dwg-${RUN}`, project_id: P, drawing_number: `P6-${RUN}`, title: 'Lobby wall', category: 'Carpentry', created_at: '2026-10-01', revisions: [], nw_production_drawings: [] }, 201);
    let r = 0;
    const revision = async () => {
      const id = `rev-${RUN}-${++r}`;
      await call(pm, 'POST', `/api/drawings/dwg-${RUN}/revisions`, { id, revision: `Rev ${r}`, title: `Rev ${r}`, file_url: `/p6-${r}.pdf`, notes: '', drawing_type: 'Client / Designer Drawing' }, 201);
      await call(pm, 'POST', `/api/drawings/dwg-${RUN}/revisions/${id}/status`, { status: 'Internal Review' }, 200);
      return id;
    };
    const approve = (page, id) => call(page, 'POST', `/api/drawings/dwg-${RUN}/revisions/${id}/status`, { status: 'Approved' });
    const status = (id) => q(`select approval_status from drawing_revisions where id='${id}'`);
    const authorityOf = (id) => q(`select after->'authority'->>'reason_code' || ' ' || coalesce(after->'authority'->>'matched_rule_code', '-') || ' (' || (after->'authority'->>'sensitivity') || ')' from audit_logs where action='drawing.revision.approve' and entity_id='${id}'`);
    record(1, 'Normal project set up', `${P} sensitivity ${q(`select sensitivity from projects where id='${P}'`)}`);

    // 2. No rule: the PM's drawings.review alone approves nothing.
    const r1 = await revision();
    const noRule = await approve(pm, r1);
    record(2, 'PM without a rule', `HTTP ${noRule.status} ${noRule.body.reason_code}; revision ${status(r1)}`);

    // 3. The Owner delegates drawing approval on this project to the PM.
    const rule = (await call(owner, 'POST', '/api/authority/rules', { name: `PM approves P6 ${RUN} drawings`, description: 'Routine drawing approvals on the lobby project', effect: 'allow', decision_type: 'drawing', target_role: 'Project Manager', project_id: P, priority: 200 }, 201)).body;
    record(3, 'Owner delegates', `${rule.code}: ${rule.summary}`);

    // 4. Normal: the PM approves.
    const ok = await approve(pm, r1);
    record(4, 'Normal: PM approves', `HTTP ${ok.status}; revision ${status(r1)}; audit ${authorityOf(r1)}`);

    // 5-6. Sensitive / Strategic: the same PM and rule need the Owner.
    let n = 5;
    for (const level of ['Sensitive', 'Strategic']) {
      await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: level, reason: `Acceptance: ${level}` }, 200);
      const rev = await revision();
      const refused = await approve(pm, rev);
      await call(owner, 'POST', `/api/drawings/dwg-${RUN}/revisions/${rev}/status`, { status: 'Approved' }, 200);
      record(n++, `${level}: PM refused, Owner approves`, `PM HTTP ${refused.status} ${refused.body.reason_code} (requires_owner ${refused.body.requires_owner}); Owner: revision ${status(rev)}, audit ${authorityOf(rev)}`);
    }

    // 7. Strategic -> Normal (Owner, reason): the rule is eligible again.
    const pmLower = await call(pm, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Normal', reason: 'try' });
    await call(owner, 'PUT', `/api/projects/${P}/sensitivity`, { sensitivity: 'Normal', reason: 'Acceptance: board review finished' }, 200);
    const r4 = await revision();
    const again = await approve(pm, r4);
    record(7, 'Back to Normal', `PM lowering: HTTP ${pmLower.status}; Owner lowered; PM approves HTTP ${again.status}, audit ${authorityOf(r4)}`);

    // 8. Every sensitivity change audited.
    record(8, 'Sensitivity audit trail', q(`select string_agg(before->>'sensitivity' || '->' || (after->>'sensitivity') || ' by ' || actor_name || ' (' || details || ')', '; ' order by id) from audit_logs where action='project.sensitivity.change' and entity_id='${P}'`));

    // 9. Purchases through the resolver: RM 20,000 policy unchanged.
    const po = async (total) => {
      const id = `po-p6-${RUN}-${total}`;
      await call(purchasing, 'POST', '/api/purchase-orders', { id, po_number: id.toUpperCase(), project_id: P, project_name: 'P6', supplier_id: null, supplier_name: 'Timber Co', items: [{ id: 'l-1', item_description: 'Plywood', specification: '', quantity: 1, unit: 'lot', unit_price: total, total_price: 1 }], total_amount: 1, requested_by: 'Purchasing', expected_delivery_date: '2026-12-20', created_at: '', status: 'Pending Approval' }, 201);
      return id;
    };
    const small = await po(5000);
    const issuedSmall = await call(purchasing, 'PATCH', `/api/purchase-orders/${small}`, { status: 'Issued' });
    const big = await po(25000);
    const refusedBig = await call(purchasing, 'PATCH', `/api/purchase-orders/${big}`, { status: 'Issued' });
    const apr = `apr-p6-${RUN}`;
    await call(purchasing, 'POST', '/api/approvals', { id: apr, approval_number: apr.toUpperCase(), approval_type: 'Major Purchase', title: `${big} RM 25,000`, description: 'Plywood', project_id: P, project_name: 'P6', related_entity_type: 'purchase', related_entity_id: big, assigned_approver_role: 'Owner / CEO', date_requested: '2026-10-06', decision: 'Pending', created_at: '', updated_at: '' }, 201);
    await call(accountant, 'POST', `/api/approvals/${apr}/decision`, { decision: 'Approved' }, 200);
    const issuedBig = await call(purchasing, 'PATCH', `/api/purchase-orders/${big}`, { status: 'Issued' });
    record(9, 'Purchases unchanged', `RM 5,000 issued: HTTP ${issuedSmall.status} (${q(`select after->'authority'->>'matched_rule_code' from audit_logs where action='purchase_order.issued' and entity_id='${small}'`)}); RM 25,000: HTTP ${refusedBig.status} ${refusedBig.body.reason_code}; Accountant approved ${apr} (${q(`select after->'authority'->>'matched_rule_code' from audit_logs where action='approval.approve' and entity_id='${apr}'`)}); then issued HTTP ${issuedBig.status} (${q(`select after->'authority'->>'matched_rule_code' from audit_logs where action='purchase_order.issued' and entity_id='${big}'`)})`);

    // 10. Invoices: the recorder cannot approve their own.
    const inv = `inv-p6-${RUN}`;
    await call(accountant, 'POST', '/api/invoices', { id: inv, invoice_number: inv.toUpperCase(), invoice_type: 'Client Billing Invoice', party_name: 'Client', project_id: P, project_name: 'P6', amount_before_tax: 1000, tax_amount: 0, total_amount: 1, invoice_date: '2026-10-22', due_date: '2026-11-21', status: 'Pending Approval', paid_amount: 0 }, 201);
    const self = await call(accountant, 'PATCH', `/api/invoices/${inv}`, { status: 'Approved' });
    record(10, 'Invoice self-approval', `HTTP ${self.status} ${self.body.reason_code}: ${self.body.message}`);

    // 11. Clean-up: the rule is switched off (with a reason), never deleted.
    await call(owner, 'POST', `/api/authority/rules/${rule.id}/deactivate`, { reason: 'Acceptance run finished' }, 200);
    record(11, 'Rule history', q(`select string_agg(action, ', ' order by id) from audit_logs where entity_type='delegated_authority' and entity_id='${rule.id}'`));

    const errors = Object.fromEntries(Object.entries(pages).map(([k, p]) => [k, p.errors]));
    console.log('API refusals / page errors (the refusals above are expected):', JSON.stringify(errors));
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    require('fs').writeFileSync(L.SHOTS + 'phase6-log.json', JSON.stringify(out, null, 2));
    await browser.close();
  }
})();
