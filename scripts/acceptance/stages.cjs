module.exports = (H) => {
  const { L, S, dialog, field, as, fresh, commercialTab, record } = H;
  const q = (sql) => L.psql(sql);
  const stages = [];
  const stage = (n, name, run) => stages.push({ n, name, run });

  stage(1, 'Client enquiry', async () => {
    const pm = await as('project-manager');
    await commercialTab(pm, 'Enquiries');
    await pm.getByRole('button', { name: 'New Enquiry' }).click();
    await field(pm, 'Enquiry number').fill(`ENQ-E2E-${S.RUN}`);
    await dialog(pm).getByLabel('Enquiry client').selectOption('client-2');
    await field(pm, 'Contact person').fill('Ms Lim, Facilities');
    await field(pm, 'Project / site name').fill(`Sky Lounge ${S.RUN}`);
    await field(pm, 'Site address').fill('Horizon Tower L38, Jalan Ampang');
    await field(pm, 'Scope description').fill('Bar counter and wine display');
    await dialog(pm).getByRole('button', { name: 'Save Enquiry' }).click();
    await pm.waitForTimeout(800);
    S.enq = q(`select id from client_enquiries where data->>'enquiry_number'='ENQ-E2E-${S.RUN}'`);
    record(1, 'UI: Commercial › Enquiries › New Enquiry (PM)', `enquiry ${S.enq} status=${q(`select status from client_enquiries where id='${S.enq}'`)}`);
  });

  stage(2, 'Tender', async () => {
    const pm = await as('project-manager');
    await pm.getByTestId(`enquiry-ENQ-E2E-${S.RUN}`).getByRole('button', { name: 'Create Tender' }).click();
    await field(pm, 'Tender number').fill(`TDR-E2E-${S.RUN}`);
    await field(pm, "Client's tender reference").fill('HT/2026/88');
    await field(pm, 'BQ reference').fill('BQ rev A');
    await dialog(pm).getByRole('button', { name: 'Save Tender' }).click();
    await pm.waitForTimeout(800);
    S.tdr = q(`select id from commercial_tenders where data->>'tender_number'='TDR-E2E-${S.RUN}'`);
    record(2, 'UI: Enquiry › Create Tender (PM)', `tender ${S.tdr} enquiry_id=${q(`select enquiry_id from commercial_tenders where id='${S.tdr}'`)}; enquiry now ${q(`select status from client_enquiries where id='${S.enq}'`)}`);
  });

  stage(3, 'Quotation + 4 internal costing', async () => {
    const pm = await as('project-manager');
    await commercialTab(pm, 'Tenders');
    await pm.getByTestId(`tender-TDR-E2E-${S.RUN}`).getByRole('button', { name: 'Quote' }).click();
    const d = dialog(pm);
    await d.getByLabel('Item 1 code').fill('BAR-01');
    await d.getByLabel('Item 1 description').fill('Bar counter 3600mm');
    await d.getByLabel('Item 1 specification').fill('Oak veneer, quartz top');
    await d.getByLabel('Item 1 quantity').fill('1');
    await d.getByLabel('Item 1 unit price').fill('60000');
    await d.getByLabel('Item 1 material cost').fill('21000');
    await d.getByLabel('Item 1 labour cost').fill('11000');
    await d.getByRole('button', { name: 'Save Draft' }).click();
    await pm.waitForTimeout(1000);
    S.qt = q(`select id from commercial_quotations where data->>'tender_id'='${S.tdr}'`);
    S.qtCode = q(`select data->>'version_code' from commercial_quotations where id='${S.qt}'`);
    record(3, 'UI: Tender › Quote (PM)', `quotation ${S.qtCode} status=${q(`select status from commercial_quotations where id='${S.qt}'`)}`);
    record(4, 'UI: quotation line material/labour cost (PM); priced by server', `subtotal=${q(`select data->>'subtotal_selling_price' from commercial_quotations where id='${S.qt}'`)} cost=${q(`select total_estimated_cost from commercial_quotations where id='${S.qt}'`)} GP=${q(`select data->>'estimated_gross_profit' from commercial_quotations where id='${S.qt}'`)}`);
  });

  stage(5, 'Quotation submission', async () => {
    const pm = await as('project-manager');
    await commercialTab(pm, 'Quotations');
    await pm.getByTestId(`quotation-${S.qtCode}`).click();
    await pm.getByRole('button', { name: 'Submit for internal review' }).click(); await pm.waitForTimeout(800);
    await pm.getByRole('button', { name: /Submit to client/ }).click(); await pm.waitForTimeout(800);
    const refused = (await pm.getByRole('alert').first().innerText()).slice(0, 90);
    const acct = await as('accountant');
    await commercialTab(acct, 'Quotations');
    await acct.getByTestId(`quotation-${S.qtCode}`).click();
    await acct.getByRole('button', { name: 'Approve internally' }).click(); await acct.waitForTimeout(800);
    await fresh('project-manager');
    await commercialTab(pm, 'Quotations');
    await pm.getByTestId(`quotation-${S.qtCode}`).click();
    await pm.getByRole('button', { name: /Submit to client/ }).click(); await pm.waitForTimeout(800);
    await pm.getByRole('button', { name: /Client quotation/ }).click();
    const doc = await pm.getByTestId('client-quotation').innerText();
    await dialog(pm).getByRole('button', { name: 'Close' }).last().click();
    record(5, 'UI: Submit for review (PM) › Approve internally (Accountant) › Submit to client (PM) › Client quotation', `early submit refused inline: "${refused}"; approved_by=${q(`select data->>'approved_by_id' from commercial_quotations where id='${S.qt}'`)}; status=${q(`select status from commercial_quotations where id='${S.qt}'`)}; client copy shows internal cost/margin: ${/\bcost\b|margin|profit|21,000|32,000/i.test(doc)}`);
  });

  stage(6, 'Award', async () => {
    const pm = await as('project-manager');
    await pm.getByRole('button', { name: 'Award (won)' }).click(); await pm.waitForTimeout(800);
    record(6, 'UI: Award (won) (PM)', `quotation status=${q(`select status from commercial_quotations where id='${S.qt}'`)}`);
  });

  stage(7, 'Project creation', async () => {
    const owner = await as('owner-ceo');
    await commercialTab(owner, 'Quotations');
    await owner.getByTestId(`quotation-${S.qtCode}`).click();
    await owner.getByRole('button', { name: /Convert to project/ }).click();
    S.projectNumber = `NW-E2E-${S.RUN}`;
    await field(owner, 'Project number').fill(S.projectNumber);
    await dialog(owner).getByRole('button', { name: 'Create project' }).click();
    await owner.waitForTimeout(1500);
    S.project = q(`select id from projects where project_number='${S.projectNumber}'`);
    const landed = await owner.locator('h1, h2').filter({ hasText: `Sky Lounge ${S.RUN}` }).count();
    record(7, 'UI: Convert to project (Owner)', `project ${S.project} ${q(`select project_status||' contract='||contract_value||' client='||client_id from projects where id='${S.project}'`)}; budget=${q(`select original_budget_direct_cost from commercial_baselines where project_id='${S.project}'`)}; enquiry=${q(`select status from client_enquiries where id='${S.enq}'`)}; landed on project page: ${landed > 0}`);
  });

  const tab = async (page, name) => { await page.locator('header div.overflow-x-auto button').filter({ hasText: new RegExp(`^\\s*${name}\\s*\\d*\\s*$`) }).first().click(); await page.waitForTimeout(600); };
  const pickProject = async (page) => { await page.getByLabel('Active Project').selectOption(S.project); await page.waitForTimeout(400); };
  const sib = (page, label) => page.locator(`xpath=//label[normalize-space()="${label}"]/following-sibling::*[self::select or self::input or self::textarea][1]`).filter({ visible: true }).first();
  const assign = async (email) => {
    const admin = await fresh('admin');
    await L.nav(admin, 'User'); await admin.waitForTimeout(800);
    await admin.getByTestId(`user-row-${email}`).getByRole('button', { name: 'Edit' }).click();
    const box = dialog(admin).locator('label.flex', { hasText: S.projectNumber }).locator('input[type=checkbox]');
    if (!(await box.isChecked())) await box.check();
    await dialog(admin).getByRole('button', { name: 'Save changes' }).click(); await admin.waitForTimeout(900);
  };
  const openDrawing = async (page) => {
    await pickProject(page);
    await L.nav(page, 'Drawings'); await page.waitForTimeout(500);
    await L.vis(page.getByRole('button', { name: new RegExp(S.dwgNumber) })).click(); await page.waitForTimeout(300);
  };

  stage(8, 'Project activated, team assigned; drawing upload', async () => {
    const owner = await as('owner-ceo');
    await pickProject(owner);
    await L.nav(owner, 'Projects'); await owner.waitForTimeout(600);
    await L.vis(owner.getByRole('button', { name: /^Awarded/ })).click();
    await L.vis(owner.getByRole('button', { name: /^Active$/ })).click();
    await L.settle(owner);
    await assign('production-staff@dev.nwos.local');
    await assign('production-manager@dev.nwos.local');
    record('8a', 'UI: project status badge (Owner); Users › Edit › Assigned projects (Admin)', `project ${q(`select project_status||' pm='||project_manager_id||' site='||site_supervisor_id from projects where id='${S.project}'`)}; assigned: ${q(`select string_agg(user_id, ',') from project_assignments where project_id='${S.project}'`)}`);
    const pm = await fresh('project-manager');
    await pickProject(pm);
    await L.nav(pm, 'Drawings'); await pm.waitForTimeout(500);
    await pm.getByRole('button', { name: '+ Upload New Drawing' }).click();
    S.dwgNumber = `SL-${S.RUN}`;
    await pm.getByPlaceholder('e.g. A-103').fill(S.dwgNumber);
    await pm.getByPlaceholder('e.g. Checkout Counter Detailed Joinery Plan').fill('Sky Lounge bar counter');
    await pm.getByPlaceholder(/Issued for tender review/).fill('Client designer drawing, bar counter 3600mm');
    await pm.getByRole('button', { name: 'Upload & Register Drawing' }).click();
    await L.settle(pm);
    S.dwg = q(`select id from drawings where data->>'drawing_number'='${S.dwgNumber}'`);
    record(8, 'UI: Drawings › + Upload New Drawing (PM)', `drawing ${S.dwg} project=${q(`select project_id from drawings where id='${S.dwg}'`)}; revisions ${q(`select string_agg(revision||':'||approval_status||':current='||is_current, ', ') from drawing_revisions where drawing_id='${S.dwg}'`)}`);
  });

  stage(9, 'Drawing review', async () => {
    const pm = await as('project-manager');
    await L.vis(pm.getByRole('button', { name: 'Submit for Internal Review' })).click();
    await L.settle(pm);
    record(9, 'UI: Drawing viewer › Submit for Internal Review (PM)', `${q(`select string_agg(revision||':'||approval_status||' by '||coalesce(data->>'review_requested_by',''), ', ') from drawing_revisions where drawing_id='${S.dwg}'`)}; PM sees Approve button: ${(await pm.getByRole('button', { name: 'Approve Revision' }).count()) > 0}`);
  });

  stage(10, 'Drawing approval', async () => {
    const owner = await fresh('owner-ceo');
    await openDrawing(owner);
    await L.vis(owner.getByRole('button', { name: 'Approve Revision' })).click();
    await L.settle(owner);
    record(10, 'UI: Drawing viewer › Approve Revision (Owner)', `${q(`select string_agg(revision||':'||approval_status||':current='||is_current||' approved_by='||coalesce(data->>'approved_by',''), ', ') from drawing_revisions where drawing_id='${S.dwg}' and kind='client'`)}`);
  });

  stage(11, 'Work package', async () => {
    const pm = await fresh('project-manager');
    await pickProject(pm);
    await L.nav(pm, 'Projects'); await pm.waitForTimeout(600);
    await L.vis(pm.getByRole('button', { name: '+ New Work Package' })).click();
    await pm.locator('#wp-name-input').fill(`Bar joinery ${S.RUN}`);
    await pm.locator('#select-trade-category').selectOption('Carpentry');
    await pm.locator('#save-work-package-btn').click();
    await L.settle(pm);
    S.wp = q(`select id from work_packages where project_id='${S.project}' and name ilike 'BAR JOINERY ${S.RUN}%'`);
    record(11, 'UI: Project command center › + New Work Package (PM)', `work package ${S.wp} ${q(`select name||' contractor='||contractor_id||' status='||status from work_packages where id='${S.wp}'`)}`);
  });

  stage(12, 'Work items', async () => {
    const pm = await as('project-manager');
    await L.vis(pm.getByRole('button', { name: /New Work Item/ })).click();
    await pm.locator('#item-code-input').fill(`BAR-${S.RUN}`);
    await pm.locator('#item-description-input').fill('Bar counter 3600mm, oak veneer');
    await pm.locator('#select-drawing').selectOption(S.dwg);
    await pm.waitForTimeout(200);
    await pm.locator('#select-drawing-revision').selectOption('Rev 1');
    await pm.locator('#save-work-item-btn').click();
    await L.settle(pm);
    S.item = q(`select id from work_items where item_code='BAR-${S.RUN}'`);
    record(12, 'UI: Project command center › New Work Item (PM)', `work item ${S.item} ${q(`select 'package='||work_package_id||' drawing='||coalesce(drawing_id,'')||' rev='||coalesce(source_drawing_revision_id,'-')||' status='||status from work_items where id='${S.item}'`)}`);
  });

  stage(13, 'NW production drawing', async () => {
    const pm = await fresh('project-manager');
    await openDrawing(pm);
    await L.vis(pm.getByRole('button', { name: '+ Create NW Drawing' })).click();
    await L.vis(pm.getByRole('button', { name: 'Create NW Production Drawing' })).last().click();
    await L.settle(pm);
    const owner = await fresh('owner-ceo');
    await openDrawing(owner);
    await L.vis(owner.getByRole('button', { name: /NW Production Drawings \(/ })).click();
    await L.vis(owner.getByRole('button', { name: /APPROVED FOR PRODUCTION/ })).click();
    await L.settle(owner);
    S.nwd = q(`select id from drawing_revisions where drawing_id='${S.dwg}' and kind='nw_production'`);
    record('10b', 'UI: + Create NW Drawing (PM) › Authorize & Stamp APPROVED FOR PRODUCTION (Owner)', `NW drawing ${S.nwd} ${q(`select approval_status||' for_production='||approved_for_production||' linked='||coalesce(linked_client_revision_id,'-') from drawing_revisions where id='${S.nwd}'`)}`);
  });

  stage(13.5, 'Production order', async () => {
    if (q(`select count(*) from project_assignments where user_id='user-prod-mgr' and project_id='${S.project}'`) === '0') await assign('production-manager@dev.nwos.local');
    const pmgr = await fresh('production-manager');
    await tab(pmgr, 'Production');
    if (q(`select count(*) from production_orders where work_item_id='${S.item}'`) === '0') {
      await L.vis(pmgr.getByRole('button', { name: 'New Production Order' })).click();
      await pmgr.getByLabel('Select Approved Work Item').selectOption(S.item);
      await pmgr.getByRole('button', { name: 'Issue Production Order' }).click();
    }
    await L.settle(pmgr);
    S.order = q(`select id from production_orders where work_item_id='${S.item}'`);
    S.orderNumber = q(`select data->>'order_number' from production_orders where id='${S.order}'`);
    record(13, 'UI: Production › New Production Order (Production Manager)', `order ${S.orderNumber} ${q(`select 'status='||status||' check='||drawing_check||' client_rev='||coalesce(client_drawing_revision_id,'-')||' nw_rev='||coalesce(nw_drawing_revision_id,'-') from production_orders where id='${S.order}'`)}`);
  });

  stage(14, 'Material request', async () => {
    const buyer = await fresh('purchasing');
    await tab(buyer, 'Purchasing & Materials');
    await L.vis(buyer.getByRole('button', { name: 'Material Request' })).click();
    await sib(buyer, 'Project *').selectOption(S.project);
    await buyer.getByPlaceholder('e.g. Blum Soft-Close Hinges 110 deg').fill(`Oak veneer plywood 18mm (${S.RUN})`);
    await sib(buyer, 'Quantity *').fill('20');
    await buyer.getByPlaceholder('pcs / sets / meters').fill('sheets');
    await sib(buyer, 'Needed by Date *').fill('2026-11-20');
    await buyer.getByPlaceholder('e.g. Countertop internal drawer cabinets (CAR-003)').fill(`Bar counter carcass (BAR-${S.RUN})`);
    await buyer.getByRole('button', { name: 'Submit Request' }).click();
    await L.settle(buyer);
    S.mr = q(`select id from material_requests where data->>'material_name'='Oak veneer plywood 18mm (${S.RUN})'`);
    record(14, 'UI: Purchasing › Material Request (Purchasing)', `material request ${S.mr} ${q(`select coalesce(data->>'request_number','')||' project='||project_id||' status='||coalesce(data->>'status','') from material_requests where id='${S.mr}'`)}`);
  });

  stage(15, 'Purchase order (major purchase approval)', async () => {
    const buyer = await as('purchasing');
    await L.vis(buyer.getByRole('button', { name: /Create Purchase Order/ })).click();
    await sib(buyer, 'Project *').selectOption(S.project);
    await sib(buyer, 'Supplier *').selectOption({ index: 1 });
    await sib(buyer, 'Expected Delivery Date *').fill('2026-11-15');
    await L.vis(buyer.getByPlaceholder('Item Description (e.g. 18mm Birch Plywood)')).fill(`Oak veneer plywood 18mm (${S.RUN})`);
    await L.vis(buyer.getByPlaceholder('Qty')).fill('20');
    await L.vis(buyer.getByPlaceholder('Price (MYR)')).fill('1100');
    await L.vis(buyer.getByRole('button', { name: 'Issue Purchase Order' })).click();
    await L.settle(buyer);
    S.po = q(`select id from purchase_orders where project_id='${S.project}' order by created_at desc limit 1`);
    S.poNumber = q(`select data->>'po_number' from purchase_orders where id='${S.po}'`);
    const before = q(`select status||' total='||total_amount from purchase_orders where id='${S.po}'`);
    const apr = q(`select id||' '||coalesce(data->>'approval_number','') from approvals where data->>'related_entity_id'='${S.po}'`);
    const owner = await fresh('owner-ceo');
    await tab(owner, 'Approvals & Governance');
    const card = owner.locator('div.p-5').filter({ hasText: apr.split(' ')[1] }).filter({ has: owner.getByRole('button', { name: 'Approve Request' }) }).first();
    await card.getByRole('button', { name: 'Approve Request' }).click();
    await L.vis(owner.getByRole('button', { name: /^Confirm/ })).click();
    await L.settle(owner);
    await fresh('purchasing'); // the buyer sees the PO as issued after the decision
    record(15, 'UI: Purchasing › Create Purchase Order (Purchasing) › Approvals › Approve Request (Owner)', `PO ${S.poNumber}: created ${before}; approval ${apr} -> ${q(`select decision from approvals where id='${apr.split(' ')[0]}'`)}; PO now ${q(`select status from purchase_orders where id='${S.po}'`)}; committed cost ${JSON.stringify((await L.api(owner, 'GET', `/api/projects/${S.project}/profitability`)).body.committed_cost)}`);
  });

  stage(16, 'Goods received', async () => {
    const pm = await fresh('project-manager');
    await tab(pm, 'Purchasing & Materials');
    await L.vis(pm.getByTestId(`grn-${S.poNumber}`)).click();
    const d = dialog(pm);
    await d.getByLabel(/^Received /).first().fill('18');
    await d.getByRole('button', { name: 'Confirm goods received' }).click();
    await L.settle(pm);
    const first = q(`select status from purchase_orders where id='${S.po}'`);
    await L.vis(pm.getByTestId(`grn-${S.poNumber}`)).click();
    await dialog(pm).getByLabel(/^Received /).first().fill('2');
    await dialog(pm).getByRole('button', { name: 'Confirm goods received' }).click();
    await L.settle(pm);
    record(16, 'UI: Purchasing › Goods received on the PO (PM; the Site Supervisor role has no purchasing view)', `after 18/20: PO ${first}; after remaining 2: PO ${q(`select status from purchase_orders where id='${S.po}'`)}; GRNs ${q(`select string_agg(coalesce(data->>'grn_number',id)||' by '||coalesce(data->>'received_by_id',''), ', ') from goods_received where data->>'po_id'='${S.po}'`)}`);
  });

  const prodSub = async (page, name) => { await tab(page, 'Production'); await L.vis(page.getByRole('button', { name: new RegExp(`^\\s*${name}`) })).click(); await page.waitForTimeout(500); };
  const moveStage = async (page, stageName, note) => {
    await prodSub(page, 'Production Orders');
    await page.locator('tr', { hasText: S.orderNumber }).first().getByRole('button', { name: 'Details' }).click();
    await L.vis(page.getByRole('button', { name: 'Move Stage' })).click();
    await page.getByLabel('New Production Stage').selectOption(stageName);
    await page.getByPlaceholder(/Cut completed/).fill(note);
    await page.getByRole('button', { name: 'Confirm Stage Transition' }).click();
    await L.settle(page);
    const close = page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true });
    if (await close.count()) await close.first().click();
  };
  const orderState = () => q(`select o.status||' / item production_status='||w.production_status from production_orders o join work_items w on w.id=o.work_item_id where o.id='${S.order}'`);

  stage(17, 'Production', async () => {
    const staff = await fresh('production-staff');
    const trail = [];
    const ORDER = ['Not Started', 'Cutting', 'CNC', 'Edge Banding', 'Assembly', 'Finishing', 'QC'];
    for (const st of ORDER.slice(1)) {
      if (ORDER.indexOf(q(`select status from production_orders where id='${S.order}'`)) >= ORDER.indexOf(st)) { trail.push(st); continue; }
      await moveStage(staff, st, `${st} done for BAR-${S.RUN}`);
      trail.push(q(`select status from production_orders where id='${S.order}'`));
    }
    record(17, 'UI: Production Orders › Update Stage (Production Staff)', `stages ${trail.join(' → ')}; now ${orderState()}`);
  });

  stage(18, 'Factory QC', async () => {
    const staff = await as('production-staff');
    await prodSub(staff, 'QC Inspection');
    await L.vis(staff.getByRole('button', { name: 'Conduct Factory QC Inspection' })).click();
    await staff.getByLabel('Select Production Order').selectOption(S.order);
    await staff.getByRole('button', { name: 'Submit Factory QC Signoff' }).click();
    await L.settle(staff);
    record(18, 'UI: Production › QC Inspection › Conduct Factory QC Inspection (Production Staff)', `factory QC ${q(`select string_agg(id||' '||result, ', ') from factory_qc_inspections where production_order_id='${S.order}'`)}; order ${orderState()}`);
  });

  stage(19, 'Packing', async () => {
    const staff = await as('production-staff');
    await prodSub(staff, 'Packing');
    await L.vis(staff.getByRole('button', { name: 'New Dispatch Package' })).click();
    await staff.getByLabel('Select Production Order').selectOption(S.order);
    await staff.getByPlaceholder('e.g. Main Carcass Module A (Cashier Left)').fill(`Bar counter carcass BAR-${S.RUN}`);
    await staff.getByRole('button', { name: 'Register Package & Print Label' }).click();
    await L.settle(staff);
    const pmgr = await fresh('production-manager');
    await moveStage(pmgr, 'Ready for Delivery', 'Packed and labelled; released to delivery');
    record(19, 'UI: Packing › New Dispatch Package (Production Staff) › Update Stage → Ready for Delivery (Production Manager)', `packages ${q(`select string_agg(coalesce(data->>'package_number',id), ', ') from packing_packages where production_order_id='${S.order}'`)}; order ${orderState()}`);
  });

  const delSub = async (page, name) => { await tab(page, 'Delivery & Site'); await L.vis(page.getByRole('button', { name: new RegExp(`^\\s*${name}`) })).click(); await page.waitForTimeout(500); };

  stage(20, 'Delivery', async () => {
    const pm = await fresh('project-manager');
    await delSub(pm, 'Ready for Delivery');
    const card = pm.locator('div.rounded-xl, div.rounded-2xl').filter({ hasText: S.orderNumber }).filter({ has: pm.getByRole('button', { name: 'Arrange Delivery' }) }).last();
    await card.getByRole('button', { name: 'Arrange Delivery' }).click();
    await sib(pm, 'Driver Name').fill(`Ahmad ${S.RUN}`);
    await sib(pm, 'Vehicle Plate Number').fill('WXY 3838');
    await sib(pm, 'Delivery Date').fill('2026-12-02');
    await pm.getByRole('button', { name: 'Save & Schedule Delivery' }).click();
    await L.settle(pm);
    S.del = q(`select id from deliveries where data->>'driver_name'='Ahmad ${S.RUN}'`);
    record(20, 'UI: Delivery & Site › Ready for Delivery › Arrange Delivery (PM)', `delivery ${q(`select coalesce(data->>'delivery_number','')||' status='||status||' project='||project_id from deliveries where id='${S.del}'`)}; items ${q(`select string_agg(work_item_id, ',') from delivery_items where delivery_id='${S.del}'`)}; item delivery_status=${q(`select delivery_status from work_items where id='${S.item}'`)}`);
  });

  stage(21, 'Site receiving', async () => {
    const site = await fresh('site-supervisor');
    await delSub(site, 'Site Receiving');
    await site.locator('xpath=//label[normalize-space()="Select Delivery:"]/following-sibling::select').selectOption(S.del);
    await L.vis(site.getByRole('button', { name: /^✅ Received/ })).click();
    await L.vis(site.getByRole('button', { name: /Confirm Site Receiving/ })).click();
    await L.settle(site);
    record(21, 'UI: Delivery & Site › Site Receiving › Confirm Site Receiving (Site Supervisor)', `receipt ${q(`select id||' receiver='||receiver_id||' condition='||condition_status from delivery_receipts where delivery_id='${S.del}'`)}; delivery ${q(`select status from deliveries where id='${S.del}'`)}; installation jobs for item: ${q(`select count(*) from installation_jobs where work_item_id='${S.item}'`)} (receipt never starts installation)`);
  });

  stage(22, 'Installation', async () => {
    const pm = await fresh('project-manager');
    await delSub(pm, 'Installation');
    await L.vis(pm.getByRole('button', { name: 'Schedule installation' })).click();
    await dialog(pm).getByLabel('Installation work item').selectOption(S.item);
    await dialog(pm).getByLabel('Lead installer').fill('Ah Wah');
    await dialog(pm).getByRole('button', { name: 'Schedule installation' }).click();
    await L.settle(pm);
    S.inst = q(`select id from installation_jobs where work_item_id='${S.item}'`);
    S.instNumber = q(`select data->>'job_number' from installation_jobs where id='${S.inst}'`);
    const site = await fresh('site-supervisor');
    await delSub(site, 'Installation');
    await L.vis(site.getByText(S.instNumber)).click();
    await L.vis(site.getByRole('button', { name: /▶ Start/ })).click();
    await L.settle(site);
    record(22, 'UI: Installation › Schedule installation (PM) › ▶ Start (Site Supervisor)', `job ${S.instNumber} ${q(`select status||' supervisor='||coalesce(data->>'site_supervisor_id','') from installation_jobs where id='${S.inst}'`)}`);
  });

  stage(23, 'Site QC (fails)', async () => {
    const site = await fresh('site-supervisor');
    await delSub(site, 'Site QC');
    await site.getByRole('button', { name: 'Record inspection' }).click();
    await dialog(site).getByLabel('Installation').selectOption(S.inst);
    await dialog(site).getByRole('button', { name: 'Level & alignment fail' }).click();
    await dialog(site).getByLabel('Defects').fill('Bar top 4mm out of level at the left end');
    await dialog(site).getByRole('button', { name: /Record failure/ }).click();
    await site.getByTestId('site-qc-result').waitFor();
    S.sqcFail = q(`select id from site_qc_inspections where installation_job_id='${S.inst}' order by created_at desc limit 1`);
    S.rectIssue = q(`select rectification_issue_id from site_qc_inspections where id='${S.sqcFail}'`);
    await dialog(site).getByRole('button', { name: 'Close' }).last().click();
    const blocked = await L.api(site, 'PATCH', `/api/installation-jobs/${S.inst}`, { status: 'Completed' });
    record(23, 'UI: Site QC & Snagging › Record inspection (Site Supervisor)', `inspection ${S.sqcFail} ${q(`select result||' inspector='||coalesce(data->>'inspector_name','') from site_qc_inspections where id='${S.sqcFail}'`)}; rectification issue ${S.rectIssue} (${q(`select status from issues where id='${S.rectIssue}'`)}); completing the installation now -> ${blocked.status} "${blocked.body?.message ?? ''}"`);
  });

  stage(24, 'Rectification', async () => {
    const admin = await fresh('admin');
    await tab(admin, 'Automation');
    await admin.getByTestId('automation-rules').getByRole('button', { name: 'Run all now' }).click();
    await admin.waitForTimeout(1500);
    const task = q(`select id||' '||assigned_user_id||' '||status from tasks where issue_id='${S.rectIssue}'`);
    const site = await fresh('site-supervisor');
    await tab(site, 'Issues & Escalations');
    await L.vis(site.getByText(new RegExp(`Rectification: BAR-${S.RUN}`))).click();
    const evidence = site.getByTestId('issue-tasks').getByLabel(/^Evidence for /);
    if (await evidence.count()) await evidence.first().fill('Re-levelled the bar top with packers; level reading photo IMG_301');
    await site.getByTestId('issue-tasks').getByRole('button', { name: 'Mark done' }).click();
    await L.settle(site);
    const pm = await fresh('project-manager');
    await tab(pm, 'Issues & Escalations');
    await L.vis(pm.getByText(new RegExp(`Rectification: BAR-${S.RUN}`))).click();
    await pm.getByPlaceholder(/Enter official decision/).fill('Re-levelled the bar top with packers; checked with digital level');
    await pm.getByRole('button', { name: /Approve Decision & Resolve Issue/ }).click();
    await L.settle(pm);
    record(24, 'UI: Automation › Run now (Admin) › Issue › Mark done (Site Supervisor) › Resolve (PM)', `automation raised task ${task}; task now ${q(`select status from tasks where issue_id='${S.rectIssue}'`)}; issue ${q(`select status||' by '||coalesce(data->>'resolved_by_id','') from issues where id='${S.rectIssue}'`)}`);
  });

  stage(25, 'Re-inspection', async () => {
    const site = await fresh('site-supervisor');
    await delSub(site, 'Site QC');
    await site.locator('select').filter({ hasText: 'SQC-' }).first().selectOption(S.sqcFail);
    await site.getByRole('button', { name: /^Re-inspect/ }).click();
    await dialog(site).getByRole('button', { name: /Record pass/ }).click();
    await site.getByTestId('site-qc-result').waitFor();
    await dialog(site).getByRole('button', { name: 'Close' }).last().click();
    await delSub(site, 'Installation');
    await L.vis(site.getByText(S.instNumber)).click();
    await L.vis(site.getByRole('button', { name: /✅ Complete/ })).click();
    await L.settle(site);
    record(25, 'UI: Site QC › Re-inspect › Record pass › Installation ✅ Complete (Site Supervisor)', `inspections ${q(`select string_agg(result, ' → ' order by created_at) from site_qc_inspections where installation_job_id='${S.inst}'`)}; installation ${q(`select status from installation_jobs where id='${S.inst}'`)}`);
  });

  stage(26, 'Handover', async () => {
    const pm = await fresh('project-manager');
    await delSub(pm, 'Client Handover');
    await pm.getByRole('button', { name: 'Prepare handover' }).click();
    await dialog(pm).getByLabel('Project').selectOption(S.project);
    await dialog(pm).getByLabel('Client representative').fill('Ms Lim');
    await dialog(pm).getByLabel('CPC certificate number').fill(`CPC-${S.RUN}`);
    await dialog(pm).getByRole('button', { name: 'Create draft handover' }).click();
    await L.settle(pm);
    S.ho = q(`select id from handover_records where data->>'cpc_certificate_number'='CPC-${S.RUN}'`);
    const draft = q(`select coalesce(data->>'status','') from handover_records where id='${S.ho}'`);
    await L.vis(pm.locator('label', { hasText: 'Client Signatory Name' }).locator('..').locator('input')).fill('Ms Lim');
    await L.vis(pm.locator('label', { hasText: 'Digital Signature' }).locator('..').locator('input')).fill('Lim (signed on tablet)');
    await pm.getByRole('button', { name: /Endorse Certificate/ }).click();
    await L.settle(pm);
    record(26, 'UI: Client Handover › Prepare handover › Endorse (PM, with the client present)', `handover ${S.ho}: ${draft} → ${q(`select coalesce(data->>'status','')||' nw_signed_by='||coalesce(data->>'nw_signed_by_id','') from handover_records where id='${S.ho}'`)}; project status still ${q(`select project_status from projects where id='${S.project}'`)}`);
  });

  const openVariation = async (page) => {
    await tab(page, 'Variations & Claims');
    await page.getByLabel('Variations project').selectOption(S.project).catch(() => {});
    await L.vis(page.getByTestId(`variation-${S.voNumber}`)).click(); await page.waitForTimeout(300);
  };
  const contract = async (page) => { const c = (await L.api(page, 'GET', `/api/projects/${S.project}/contract-summary`)).body; return `original ${c.original_contract_value}, approved VOs ${c.approved_variations_total}, current ${c.current_contract_value}`; };

  stage(27, 'Variation', async () => {
    const pm = await fresh('project-manager');
    await tab(pm, 'Variations & Claims');
    await pm.getByLabel('Variations project').selectOption(S.project);
    await pm.getByRole('button', { name: 'New variation' }).click();
    await dialog(pm).getByLabel('Variation title').fill(`Extra wine rack bays (${S.RUN})`);
    await dialog(pm).getByLabel('Variation description').fill('Client asked for 2 extra wine rack bays');
    await dialog(pm).getByLabel('Variation internal cost').fill('3000');
    await dialog(pm).getByLabel('Variation selling price').fill('5000');
    await dialog(pm).getByRole('button', { name: 'Save variation' }).click();
    await L.settle(pm);
    S.vo = q(`select id from variations where data->>'title'='Extra wine rack bays (${S.RUN})'`);
    S.voNumber = q(`select data->>'variation_number' from variations where id='${S.vo}'`);
    await openVariation(pm);
    await pm.getByRole('button', { name: 'Send for internal approval' }).click(); await L.settle(pm);
    const pmCanApprove = await pm.getByRole('button', { name: /Approve internally/ }).count();
    const owner = await fresh('owner-ceo');
    await openVariation(owner);
    const before = await contract(owner);
    await owner.getByRole('button', { name: /Approve internally/ }).click(); await L.settle(owner);
    record(27, 'UI: Variations › New variation › Send for internal approval (PM) › Approve internally (Owner)', `${S.voNumber}: ${q(`select status||' internal_by='||coalesce(data->>'internal_approved_by_id','') from variations where id='${S.vo}'`)}; PM offered internal approval: ${pmCanApprove > 0}; contract unchanged while pending: ${before} → ${await contract(owner)}`);
  });

  stage(28, 'Client approval', async () => {
    const admin = await fresh('admin');
    await L.nav(admin, 'User'); await admin.waitForTimeout(800);
    await admin.getByRole('button', { name: 'New user' }).click();
    await dialog(admin).getByLabel('Name', { exact: true }).fill('Ms Lim (Horizon)');
    await dialog(admin).getByLabel('Email address').fill(`lim${S.RUN}@dev.nwos.local`);
    await dialog(admin).getByLabel('Role', { exact: true }).selectOption('Client');
    await dialog(admin).getByLabel('Client company').selectOption('client-2');
    await dialog(admin).getByLabel('Password', { exact: true }).fill('dev-password-123');
    await dialog(admin).getByRole('button', { name: 'Create account' }).click(); await admin.waitForTimeout(1000);
    const client = await as(`lim${S.RUN}`);
    await openVariation(client);
    const sees = await client.locator('body').innerText();
    await client.getByRole('button', { name: 'Accept variation' }).click(); await L.settle(client);
    const owner = await as('owner-ceo');
    record(28, 'UI: Users › New user (Admin, Horizon client account) › Variations › Accept variation (Client)', `${S.voNumber}: ${q(`select status||' client_by='||coalesce(data->>'client_approved_by_id','') from variations where id='${S.vo}'`)}; client saw internal cost 3,000: ${/3,000|RM 3000\b/.test(sees)}; contract now ${await contract(owner)}`);
  });

  const comm = async (page, label) => { await pickProject(page); await tab(page, 'Commercial'); await L.vis(page.getByRole('button', { name: new RegExp(`^\\s*${label.replace(/[()&]/g, '.')}`) })).click(); await page.waitForTimeout(500); };
  const profit = async (page) => (await L.api(page, 'GET', `/api/projects/${S.project}/profitability`)).body;
  const money = (p) => `selling ${p.selling_price}, budget ${p.estimated_direct_cost}, committed ${p.committed_cost}, actual ${p.actual_cost}, forecast ${p.forecast_final_cost}, GP ${p.project_gross_profit} (${p.project_gross_margin_percent}%)`;

  stage(29, 'Supplier invoice', async () => {
    const acct = await fresh('accountant');
    S.p0 = await profit(acct);
    await comm(acct, 'Invoices');
    await acct.getByRole('button', { name: 'Record supplier invoice' }).click();
    await dialog(acct).getByLabel('Invoice purchase order').selectOption(S.po);
    await dialog(acct).getByLabel('Supplier invoice number').fill(`TC-${S.RUN}`);
    await dialog(acct).getByLabel('Amount before tax (RM)').fill('22000');
    await dialog(acct).getByRole('button', { name: 'Record invoice' }).click();
    await L.settle(acct);
    S.inv = q(`select id from commercial_invoices where data->>'invoice_number'='TC-${S.RUN}'`);
    const recorded = q(`select status||' match='||coalesce(data->>'match_status','') from commercial_invoices where id='${S.inv}'`);
    const self = await acct.getByTestId(`invoice-TC-${S.RUN}`).getByRole('button', { name: 'Approve' }).count();
    let selfMsg = '';
    if (self) { await acct.getByTestId(`invoice-TC-${S.RUN}`).getByRole('button', { name: 'Approve' }).click(); await acct.waitForTimeout(800); selfMsg = (await acct.getByRole('alert').first().innerText().catch(() => '')).slice(0, 80); }
    const owner = await fresh('owner-ceo');
    await comm(owner, 'Invoices');
    await owner.getByTestId(`invoice-TC-${S.RUN}`).getByRole('button', { name: 'Approve' }).click();
    await L.settle(owner);
    record(29, 'UI: Commercial › Invoices › Record supplier invoice (Accountant) › Approve (Owner)', `invoice TC-${S.RUN}: recorded ${recorded}; recorder's own approval refused: "${selfMsg}"; now ${q(`select status||' by '||coalesce(data->>'approved_by_id','') from commercial_invoices where id='${S.inv}'`)}`);
  });

  stage(30, 'Project actual cost', async () => {
    const acct = await fresh('accountant');
    const p1 = await profit(acct);
    await comm(acct, 'Project Cost');
    record(30, 'UI: Commercial › Project Cost (Accountant); figures from the server', `before invoice: ${money(S.p0)}; after: ${money(p1)}; ledger ${q(`select string_agg(id||' '||status||' '||amount, ', ') from project_cost_ledger where project_id='${S.project}'`)}`);
  });

  stage(31, 'Claim / invoice', async () => {
    const acct = await as('accountant');
    await comm(acct, 'Claims');
    await acct.getByTestId('claims-section').getByRole('button', { name: 'New claim' }).click();
    await dialog(acct).getByLabel('Claim project').selectOption(S.project);
    await dialog(acct).getByLabel('Claim number').fill(`IPC-${S.RUN}-01`);
    await dialog(acct).getByLabel('Amount claimed').fill('65000');
    await dialog(acct).getByLabel('Claim invoice number').fill(`INV-${S.RUN}-01`);
    await dialog(acct).getByRole('button', { name: 'Save claim' }).click();
    await L.settle(acct);
    await acct.getByRole('button', { name: `Mark IPC-${S.RUN}-01 Submitted` }).click(); await L.settle(acct);
    await acct.getByRole('button', { name: `Mark IPC-${S.RUN}-01 Certified` }).click(); await L.settle(acct);
    S.claim = q(`select id from financial_claims where data->>'claim_number'='IPC-${S.RUN}-01'`);
    record(31, 'UI: Commercial › Claims (IPC) › New claim › Mark Submitted › Mark Certified (Accountant)', `claim ${q(`select coalesce(data->>'claim_number','')||' '||status||' claimed='||coalesce(data->>'cumulative_claimed','')||' retention='||coalesce(data->>'retention_amount','')||' net='||coalesce(data->>'net_claim_amount','') from financial_claims where id='${S.claim}'`)}`);
  });

  stage(32, 'Payment', async () => {
    const acct = await as('accountant');
    await comm(acct, 'Payments');
    await acct.getByTestId('payments-section').getByRole('button', { name: 'Record payment' }).click();
    await dialog(acct).getByLabel('Payment project').selectOption(S.project);
    await dialog(acct).getByLabel('Bank reference').fill(`TRF-${S.RUN}`);
    await dialog(acct).getByLabel('Payment amount').fill('61750');
    await dialog(acct).getByLabel('Settles claim').selectOption(`IPC-${S.RUN}-01`);
    await dialog(acct).getByRole('button', { name: 'Record payment' }).click();
    await L.settle(acct);
    record(32, 'UI: Commercial › Payments › Record payment, settling the claim (Accountant)', `payment ${q(`select reference||' '||amount||' '||type from (select data->>'reference_no' as reference, data->>'amount' as amount, data->>'type' as type from payments where data->>'reference_no'='TRF-${S.RUN}') x`)}; claim now ${q(`select status||' paid '||coalesce(data->>'payment_received_date','') from financial_claims where id='${S.claim}'`)}`);
  });

  stage(33, 'Profitability', async () => {
    const owner = await fresh('owner-ceo');
    await comm(owner, 'Profitability');
    const p = await profit(owner);
    const screen = await owner.locator('body').innerText();
    const fmt = (n) => Number(n).toLocaleString('en-US');
    const shown = [p.actual_cost, p.forecast_final_cost, p.project_gross_profit].map((n) => screen.includes(fmt(n)));
    const forged = await L.api(owner, 'POST', '/api/data/sync', { upserts: { commercialBaselines: [{ ...(await L.api(owner, 'GET', `/api/commercial-baselines/${S.project}`)).body, forecast_gross_profit: 999999999, actual_cost: 1 }] } });
    const after = await profit(owner);
    const site = await as('site-supervisor');
    const denied = (await L.api(site, 'GET', `/api/projects/${S.project}/profitability`)).status;
    record(33, 'UI: Commercial › Profitability (Owner); server-computed', `${money(p)}; screen shows actual/forecast/GP: ${shown.join('/')}; forged browser totals sync ${forged.status} -> server GP still ${after.project_gross_profit}; site supervisor profitability -> ${denied}`);
  });

  stage(34, 'Project completion / closure', async () => {
    const owner = await fresh('owner-ceo');
    await pickProject(owner);
    await tab(owner, 'Projects');
    await L.vis(owner.getByRole('button', { name: /^Active/ })).click();
    await L.vis(owner.getByRole('button', { name: /^Completed$/ })).click();
    await L.settle(owner);
    const completed = q(`select project_status from projects where id='${S.project}'`);
    await L.vis(owner.getByRole('button', { name: /^Completed/ })).first().click();
    await L.vis(owner.getByRole('button', { name: /^Closed$/ })).click();
    await L.settle(owner);
    const ex = (await L.api(owner, 'GET', '/api/exceptions')).body.filter((e) => e.project_id === S.project).length;
    record(34, 'UI: Projects › status badge → Completed → Closed (Owner)', `${completed} → ${q(`select project_status from projects where id='${S.project}'`)}; audit actions on the project: ${q(`select count(*) from audit_logs where project_id='${S.project}' or entity_id='${S.project}'`)}; exceptions still listed for it: ${ex}`);
  });

  return stages;
};
