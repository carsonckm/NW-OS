/**
 * The pre-Phase 6 AI endpoints' deterministic NW OS rules (Phase 4 demo screens): issue
 * classification, drawing analysis and comparison, contractor update parsing, project briefing,
 * the contractor assistant and the WhatsApp gateway simulator.
 *
 * These handlers NEVER call a language model. Since Phase 6 Batch 7 every model call goes through
 * the AI gateway (server/ai/gateway.ts): in database mode the legacy routes are answered by
 * server/ai/legacy.ts from the signed-in user's own records through AIService, before these rules
 * are reached. These rules only answer in demo mode (no database, no sign-in), where there is no
 * authorised data to give a model, and for the WhatsApp gateway simulator, which is rule-based.
 * They work only on what the browser sends and reply only to that same browser.
 */
import express from 'express';

export function registerLegacyRules(router: express.Router) {
// AI Briefing Endpoint for Owner Dashboard
router.post('/api/ai/briefing', async (req, res) => {
  try {
    const { projectsSummary, criticalIssues, atRiskProjects, todayDeliveries, todayInstallations } = req.body;


    // High quality domain fallback if API key not available or rate limited
    let fallbackText = "Overall active projects are progressing steadily. Project Aurora (Bukit Bintang Luxury Boutique) is currently the highest operational focus due to a 100mm site dimension variance on Cashier Counter CAR-003 awaiting Owner sign-off on splitting into dual 1200mm modules. 2 deliveries and 1 installation are scheduled today without blocker alerts.";
    if (atRiskProjects && atRiskProjects.length > 0) {
      const topRisk = atRiskProjects[0];
      fallbackText = `Executive Alert: ${topRisk.project_name || 'Project'} requires management attention due to ${topRisk.reason || 'critical milestone constraints'}. Carpentry work package coordination with Site Supervisor is underway while Owner variation decision remains pending.`;
    }
    return res.json({ briefing: fallbackText, source: 'domain-engine' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Briefing failed' });
  }
});

// AI Issue Classification
router.post('/api/ai/classify-issue', async (req, res) => {
  try {
    const { rawText, workItems, reportedBy, role } = req.body;


    // Heuristic Malaysian Construction / Trilingual NLP Fallback
    const lower = (rawText || '').toLowerCase();
    const isDimensionIssue = lower.includes('尺寸') || lower.includes('2400') || lower.includes('2300') || lower.includes('dimension') || lower.includes('saiz') || lower.includes('ukuran');
    const isDeliveryIssue = lower.includes('delivery') || lower.includes('hantar') || lower.includes('送货') || lower.includes('lorry') || lower.includes('lori');
    const isMaterialIssue = lower.includes('plywood') || lower.includes('laminate') || lower.includes('material') || lower.includes('rosak') || lower.includes('pecah') || lower.includes('kaca') || lower.includes('glass');

    let category = 'Site condition';
    let priority: 'Low' | 'Medium' | 'High' | 'Critical' = 'High';
    let escalation_target: 'Site Supervisor' | 'PM' | 'Owner' = 'PM';
    let action_required = 'PM REVIEW REQUIRED';

    if (isDimensionIssue) {
      category = 'Site condition';
      priority = 'High';
      action_required = 'PM REVIEW REQUIRED — Verify Site As-Built vs Approved Drawing Rev 2';
      escalation_target = 'PM';
    } else if (isDeliveryIssue) {
      category = 'Delivery';
      priority = 'Medium';
      action_required = 'Site Supervisor confirmation of unloading bay clearance';
      escalation_target = 'Site Supervisor';
    } else if (isMaterialIssue) {
      category = 'Material';
      priority = 'High';
      action_required = 'Inspect batch defect and notify supplier for replacement';
      escalation_target = 'PM';
    }

    let affected_item_code = 'CAR-003';
    if (lower.includes('car-001') || lower.includes('001')) affected_item_code = 'CAR-001';
    else if (lower.includes('car-004') || lower.includes('004')) affected_item_code = 'CAR-004';
    else if (lower.includes('gls') || lower.includes('glass')) affected_item_code = 'GLS-001';
    else if (lower.includes('elec') || lower.includes('wiring')) affected_item_code = 'ELE-002';

    return res.json({
      category,
      priority,
      affected_item_code,
      title: isDimensionIssue ? `Site Dimension Discrepancy (${affected_item_code})` : `Site Operational Report: ${rawText?.slice(0, 35)}...`,
      summary: `Reported issue by site personnel: "${rawText}". Automatically parsed by NW OS.`,
      action_required,
      escalation_target,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Drawing Analysis Endpoint
router.post('/api/ai/analyze-drawing', async (req, res) => {
  try {
    const { drawingTitle, drawingNumber, revision, notes, knowledgeBase } = req.body;

    // High-precision domain intelligence fallback
    const isCounter = (drawingTitle + ' ' + drawingNumber).toLowerCase().includes('counter') || (drawingTitle + ' ' + drawingNumber).toLowerCase().includes('103');
    const isRev4 = (revision || '').includes('4');

    return res.json({
      label: 'AI DRAFT — NOT APPROVED',
      drawing_number: drawingNumber || 'A-103',
      revision: revision || (isRev4 ? 'Rev 4' : 'Rev 3'),
      dimensions: isRev4
        ? [
            'Total Length: 2300mm (Client revision: reduced from 2400mm)',
            'Total Depth: 900mm',
            'Countertop Height: 900mm (Cashier Ergonomic standard)',
            'Privacy Screen Top Height: 1050mm',
            'Recessed Skirting: 100mm H × 50mm D',
          ]
        : [
            'Total Length: 2400mm (Module A: 1200mm + Module B: 1200mm)',
            'Total Depth: 900mm',
            'Countertop Height: 900mm (Cashier Ergonomic standard)',
            'Privacy Screen Top Height: 1050mm',
            'Recessed Skirting: 100mm H × 50mm D with Hairline Brass Trim',
          ],
      quantities: ['1 Unit Complete Checkout Counter (Split into 2 Modules)'],
      materials: isRev4
        ? [
            '25mm High-Grade Marine Plywood core (Client Rev 4 specification upgrade)',
            '1.0mm Wilsonart Natural Oak High-Pressure Laminate (HPL)',
            '12mm Corian Glacier White Solid Surface Countertop',
            'Blum Movento soft-close heavy-duty drawer runners (40kg payload)',
          ]
        : [
            '18mm High-Grade Marine Plywood core (E1 Formaldehyde compliant)',
            '1.0mm Wilsonart Natural Oak High-Pressure Laminate (HPL)',
            '12mm Corian Glacier White Solid Surface Countertop (Seamless Joint)',
            'Blum Movento soft-close drawer runners (40kg payload)',
          ],
      finishes: [
        'Matching 1mm PVC edge-banding applied on factory edge-bander',
        'Satin Polyurethane clear coat over solid timber edge lips',
        'Hairline brushed brass kickplate on plinth perimeter',
      ],
      locations: ['Ground Floor — Main Boutique Cashier & Reception Zone'],
      detail_references: ['Detail D-01: Modular Cam-lock joinery', 'Detail D-04: Sub-DB Cable Grommet', 'Detail D-09: Skirting Scribe'],
      work_items: ['CAR-003 Checkout Counter #03', 'MET-002 Hairline Brass Skirting Strip', 'ELE-004 POS Sub-DB Wiring Raceway'],
      potential_work_items: [
        {
          item_code: 'CAR-001',
          description: 'Checkout Counter #01 (Main Cashier & POS Station)',
          dimensions: isRev4 ? '2300 × 900 × 1050mm' : '2400 × 900 × 1050mm',
          material: isRev4 ? '25mm Marine Plywood' : '18mm Marine Plywood',
          finish: 'Laminate (Wilsonart Oak)',
          location: 'Ground Floor Cashier Area',
          quantity: 1,
          status: 'suggested',
        },
        {
          item_code: 'MET-004',
          description: 'Hairline Brushed Brass Skirting Trim (Perimeter Plinth)',
          dimensions: '2300 × 100 × 1.5mm',
          material: 'Solid Brass Alloy 260',
          finish: 'Brushed Hairline with Protective Clear Lacquer',
          location: 'Counter Base',
          quantity: 1,
          status: 'suggested',
        },
      ],
      production_concerns: [
        'Single 2300-2400mm monolithic carcass exceeds Pavilion Mall service lift diagonal clearance (2200mm).',
        'Solid surface countertop requires on-site inconspicuous thermal welding & polishing.',
        'Existing site opening measured 2300mm: zero-tolerance fit requires 20mm scribing allowance on end panel.',
      ],
      missing_info: [
        'Confirm mall POS terminal credit card EDC cable hole diameter (standard 60mm grommet).',
        'Client drawing does not indicate internal partition cutout for 240V power cord plug-top clearance.',
      ],
      conflicting_info: [
        isRev4
          ? 'Client Drawing Rev 4 specifies 25mm plywood, but tender BQ was priced based on 18mm plywood (potential cost variation).'
          : 'Designer elevation shows continuous grain across join, requiring sequential veneer press from same log flitch.',
      ],
      nw_recommendations: [
        'Split counter into 2 balanced modules with concealed Festool Domino pins and Lamello Clamex fasteners.',
        'Pre-route dual 50×75mm PVC cable raceways inside factory to eliminate site core drilling.',
        'Standardize 100mm field-adjusted plinth to absorb mall tenancy structural column variance.',
      ],
      matched_knowledge: [
        {
          id: 'know-1',
          title: 'Modular Split for Retail Counters Exceeding 2400mm',
          category: 'Transport',
          recommendation: 'Retail counters longer than 2100mm must be split into balanced modular segments (e.g. 1200mm + 1100mm) using concealed Festool Domino joinery for mall hoist transport.',
          source: 'NW Production Knowledge — Counter Construction Standard #001',
        },
        {
          id: 'know-2',
          title: 'Pre-Routed Internal Cable Raceways in Bespoke Joinery',
          category: 'Carpentry',
          recommendation: 'Incorporate 50mm × 75mm continuous PVC trunking internal channels through partitions before laminate press.',
          source: 'NW Production Knowledge — M&E Integration Standard #002',
        },
      ],
      analyzed_at: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Drawing Revision Comparison & Production Impact Check Endpoint
router.post('/api/ai/compare-drawings', async (req, res) => {
  try {
    const { drawingId, fromRevision, toRevision, currentWorkItems } = req.body;

    // High precision domain comparison fallback (e.g. Rev 3 -> Rev 4 comparison)
    const affectedItems: any[] = [];
    const items = (currentWorkItems || []) as any[];

    for (const item of items) {
      if (item.item_code === 'CAR-003' || item.drawing_id === drawingId) {
        const prodStatus = item.production_status || 'Assembly';
        let impact_level: 'PRODUCTION IMPACT POSSIBLE' | 'HIGH PRIORITY — REVISION AFTER COMPLETION' | 'LOW IMPACT' = 'PRODUCTION IMPACT POSSIBLE';
        let warning_message = 'Production has already started at Hock Seng factory. Work item CAR-003 is currently at Assembly stage. Re-cutting or modification required.';

        if (['Delivered', 'Installation In Progress', 'Completed'].includes(item.status) || prodStatus === 'Completed') {
          impact_level = 'HIGH PRIORITY — REVISION AFTER COMPLETION';
          warning_message = 'Item already completed or installed on site! Revision after completion requires urgent site inspection and client variation.';
        } else if (['Not Started', 'Material Required'].includes(prodStatus)) {
          impact_level = 'LOW IMPACT';
          warning_message = 'Production has not commenced. CNC cutting files can be updated prior to machining.';
        }

        affectedItems.push({
          work_item_id: item.id,
          item_code: item.item_code || 'CAR-003',
          description: item.description || 'Checkout Counter #03',
          current_status: item.status || 'In Progress',
          production_status: prodStatus,
          impact_level,
          warning_message,
          action_suggested: 'Request PM Review and evaluate NW Production Review (plinth trim vs re-cutting).',
        });
      }
    }

    return res.json({
      drawing_id: drawingId,
      from_revision: typeof fromRevision === 'string' ? fromRevision : fromRevision?.revision || 'Rev 3',
      to_revision: typeof toRevision === 'string' ? toRevision : toRevision?.revision || 'Rev 4',
      dimension_changes: [
        'Length reduced by 100mm: 2400mm → 2300mm (Mall structural column encroachment).',
        'End filler plinth dimension adjusted from 50mm to 100mm scribing face.',
      ],
      material_changes: [
        'Carcass specification updated: 18mm Marine Plywood → 25mm High-Grade Marine Plywood (Heavier carcase payload).',
      ],
      finish_changes: [
        'Wilsonart Warm Oak finish maintained; edge banding specification updated to 2mm impact-resistant PVC.',
      ],
      quantity_changes: ['Quantity unchanged: 1 Set (2 Modules).'],
      location_changes: ['Location unchanged: Ground Floor Cashier & Reception.'],
      detail_changes: [
        'Detail D-03: Added concealed 100mm plinth scribing panel for field tolerance.',
        'Detail D-07: Added reinforced 25mm intermediate shelf supports.',
      ],
      added_items: ['MET-004 Brass Corner Buffer Guards (4 sets).'],
      removed_items: ['None.'],
      affected_work_items: affectedItems.length > 0 ? affectedItems : [
        {
          work_item_id: 'item-1',
          item_code: 'CAR-003',
          description: 'Checkout Counter #03 (2 × 1200mm Split Modules with Corian Top)',
          current_status: 'In Progress',
          production_status: 'Assembly',
          impact_level: 'PRODUCTION IMPACT POSSIBLE',
          warning_message: 'WARNING: Production already started at Hock Seng factory: CAR-003 is currently at Assembly stage. Cutting of 18mm panels has already been completed.',
          action_suggested: 'Create Site Issue, notify PM Marcus Lee, and review NW Production Recommendation to trim Module B plinth by 100mm rather than scrapping carcass.',
        },
      ],
      warning_level: 'warning',
      compared_at: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Assistant Endpoint (Strict role permissions & approved information only)
router.post('/api/ai/assistant', async (req, res) => {
  try {
    const { question, userRole, userName, projectContext } = req.body;


    // Role-tailored fallback
    const qLower = (question || '').toLowerCase();
    if (userRole === 'Contractor') {
      if (qLower.includes('dimension') || qLower.includes('size') || qLower.includes('尺寸') || qLower.includes('car-003')) {
        return res.json({
          answer: 'Approved Dimension for CAR-003 (Checkout Counter): 2400mm L × 900mm D × 1050mm H as per NW Production Drawing Rev 2 (constructed as two 1200mm modules). If site opening shows 2300mm, please flag via the PROBLEM button for PM review.',
        });
      }
      return res.json({
        answer: 'You have 3 active assigned work items under Hock Seng Carpentry. CAR-003 is currently In Progress, CAR-004 is Ready for QC, and CAR-005 is scheduled for next week.',
      });
    }

    if (userRole === 'Client') {
      return res.json({
        answer: 'Your project (Project Aurora - Pavilion Retail Flagship) is currently at 68% progress. Practical Completion is targeted for 24 October 2026. The next major site delivery is scheduled for tomorrow morning (Custom Cashier Counter & Feature Wall).',
      });
    }

    if (qLower.includes('car-003') || qLower.includes('checkout counter') || qLower.includes('po-2026-003')) {
      return res.json({
        answer: 'Status of CAR-003 (PO-2026-003 — Checkout Counter #03): Currently in ASSEMBLY stage at Sungai Buloh factory (65% progress) under Hock Seng Carpentry. Approved drawing baseline is Client A-103 Rev 3 / NW Production Drawing A-103-NW Rev 1 (modular 2-split 1200+1200mm). ⚠️ Warning: Client uploaded revision A-103 Rev 4 with 2300mm length (-100mm) while in assembly. Production issue P-ISS-021 has been flagged for Owner decision on plinth scribe trim.',
      });
    }

    if (qLower.includes('waiting for cnc') || (qLower.includes('cnc') && qLower.includes('queue'))) {
      return res.json({
        answer: 'Parts currently waiting for CNC: (1) CAR-002-P02 (Concealed Pivot Hinge Header Block) queued on Homag Centateq P-110, and (2) CAR-201-P01 (Executive Boardroom Table Bevelled Edge Substrate) queued on Biesse Rover B FT 2231. Active CNC running: CAR-002-P01 on Homag Centateq.',
      });
    }

    if (qLower.includes('blocked') || (qLower.includes('blocker') && qLower.includes('production'))) {
      return res.json({
        answer: 'Currently 2 Production Blockers detected: (1) PO-2026-011 (CAR-005 Staff Locker Bank) is Blocked due to Homag Edge Bander spindle vibration causing face gouges on 3 door leaves (Maintenance tech on-site replacing bearing assembly), and (2) PO-2026-003 (CAR-003 Checkout Counter) has Critical Issue P-ISS-021 (Site opening 2300mm vs drawing 2400mm) awaiting Owner approval to execute NW Production Method Rev 2 scribe trim.',
      });
    }

    if ((qLower.includes('drawing') || qLower.includes('revision')) && (qLower.includes('affect') || qLower.includes('impact') || qLower.includes('production'))) {
      return res.json({
        answer: 'Drawing Revisions Affecting Active Production: Client Drawing A-103 Rev 4 uploaded with 2300mm length alteration. The system identified active impact on PO-2026-003 (CAR-003) currently in Assembly stage. Status: [⚠️ PRODUCTION IMPACT POSSIBLE]. CNC file CNC-CAR003-P01 has been flagged as OUTDATED / REQUIRES RE-GENERATION. No dimensions were changed automatically.',
      });
    }

    if (qLower.includes('qc') || qLower.includes('inspection')) {
      return res.json({
        answer: 'Current Factory QC Status: (1) PO-2026-004 (CAR-004 Display Island Table) PASSED QC on 7 Sept and is staged for packing, (2) PO-2026-001 (CAR-001 Feature Wall Cassettes) PASSED QC with fire-retardant compliance verified, (3) PO-2026-011 (CAR-005 Locker Doors) FAILED QC due to edge banding gouges and was assigned rework.',
      });
    }

    if (qLower.includes('ready for delivery') || qLower.includes('packing') || qLower.includes('dispatch')) {
      return res.json({
        answer: 'Ready for Delivery / Dispatch Status: (1) PO-2026-005 (GLS-001 Starphire Low-Iron Vitrines) crated and marked Ready for Delivery, (2) PO-2026-001 (CAR-001 Feature Wall) packed in Crates PKG-001-1/4 and PKG-001-2/4 stored in Factory Dispatch Bay, scheduled for tomorrow morning 10:00 AM delivery to Pavilion loading bay.',
      });
    }

    if (qLower.includes('margin') || qLower.includes('profit')) {
      return res.json({
        answer: 'Project Aurora (Pavilion Flagship) current contract value is RM 530,000 against a forecast final cost of RM 370,000, yielding an expected forecast gross profit of RM 160,000 (30.19% Gross Margin). Note: [AI ESTIMATE — NOT CONFIRMED] for pending subcontractor plinth adjustments.',
      });
    }

    if (qLower.includes('over budget') || qLower.includes('variance') || qLower.includes('losing money')) {
      return res.json({
        answer: 'Project Aurora is currently +RM 20,000 over its original budget direct cost (Forecast: RM 370k vs Budget: RM 350k). Primary variance drivers: (1) 18mm & 25mm marine plywood price increase from WoodSource (+12%, +RM 8,000 impact) and (2) Additional subcontractor field adjustment for scribing plinth trim (+RM 12,000 impact).',
      });
    }

    if (qLower.includes('material') && (qLower.includes('increase') || qLower.includes('price'))) {
      return res.json({
        answer: 'Materials with detected price increases this month: (1) 18mm Marine Plywood increased from RM 118 to RM 132/sheet (+12%, WoodSource MY), (2) 25mm Heavy Duty Marine Plywood increased from RM 175 to RM 188/sheet (+7.4%), and (3) Corian Glacier White Solid Surface increased from RM 1,380 to RM 1,450/slab (+5.1%). Recommended action: lock 6-month volume agreement.',
      });
    }

    if (qLower.includes('unbilled') || qLower.includes('variation')) {
      return res.json({
        answer: 'Active Unbilled Variations detected: Potential VO-002 (Rear Cashier Storage Cabinet) requested on site by client, estimated cost RM 8,500. Not yet billed or client-approved. VO-001 (Curved Acoustic Wall Cove Lighting) was approved at RM 30,000 and is included in current contract value.',
      });
    }

    if (qLower.includes('cash') || qLower.includes('collection')) {
      return res.json({
        answer: 'Expected Cash Collections: Project Aurora has billed RM 344,500 under IPC #01, with RM 275,000 collected and RM 69,500 outstanding. Expected collection for next month (October 2026) upon practical completion handover is RM 185,000.',
      });
    }

    return res.json({
      answer: 'Currently 12 active projects across NW OS: 9 are On Track, 2 are At Risk (Project Horizon glass lead time & Bangsar South delay), and 1 has a Critical Escalation (Project Aurora site dimension discrepancy CAR-003 awaiting Owner approval for variation/production split).',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Mixed-language contractor WhatsApp / Voice NLP Parser
router.post('/api/ai/parse-contractor-update', async (req, res) => {
  try {
    const { messageText } = req.body;


    // Heuristic parser
    const text = (messageText || '').toLowerCase();
    let action: 'Update Progress' | 'Complete Work' | 'Report Problem' | 'Schedule Delivery' | 'Question' = 'Update Progress';
    let status_suggestion = 'In Progress';
    let item_code = 'CAR-003';
    let delivery_timing: string | null = null;

    if (text.includes('004') || text.includes('4')) item_code = 'CAR-004';
    if (text.includes('001') || text.includes('1')) item_code = 'CAR-001';

    if (text.includes('siap') || text.includes('做好了') || text.includes('complete') || text.includes('done') || text.includes('finished')) {
      if (text.includes('送') || text.includes('hantar') || text.includes('deliver') || text.includes('tomorrow') || text.includes('besok') || text.includes('esok')) {
        action = 'Schedule Delivery';
        status_suggestion = 'Ready for Delivery';
        delivery_timing = text.includes('pagi') || text.includes('早上') || text.includes('morning') ? 'Tomorrow Morning (09:30 AM)' : 'Tomorrow Afternoon';
      } else {
        action = 'Complete Work';
        status_suggestion = 'Ready for QC';
      }
    } else if (text.includes('problem') || text.includes('salah') || text.includes('masalah') || text.includes('tak muat') || text.includes('不够') || text.includes('rosak')) {
      action = 'Report Problem';
      status_suggestion = 'Blocked';
    }

    return res.json({
      item_code,
      action,
      status_suggestion,
      delivery_timing,
      progress_percent: action === 'Complete Work' ? 100 : 75,
      notes: messageText,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Project Briefing & Risk Radar Endpoint
router.post('/api/ai/project-briefing', async (req, res) => {
  try {
    const { project, workPackages, workItems, issues, variations, drawings, userRole } = req.body;

    // High quality engineered Malaysian construction fallback
    const projName = project?.project_name || 'Project Aurora';
    const isAurora = projName.includes('Aurora') || projName.includes('Pavilion');

    if (isAurora) {
      return res.json({
        executive_summary: "Project Aurora (Pavilion Bukit Bintang) is at 68% progress with 28 days to contractual handover. Joinery and feature metal work are on the critical path. Site wall dimension discrepancy on CAR-003 is the primary gating issue.",
        handover_projection: "Current projected completion: 26 October 2026 (2 days behind contractual date unless Module B scribing solution is authorized today).",
        critical_path_bottlenecks: [
          "CAR-003 Cashier Counter: Site opening measured 2300mm vs 2400mm approved drawing. Hock Seng factory already at Assembly stage.",
          "Pavilion Mall Loading Bay: Heavy goods lift height restriction requires split carcass delivery.",
          "Client Variation VO-001 (Corian solid surface upgrade) awaiting formal signature from Michelle Tan."
        ],
        pm_action_checklist: [
          {
            task: "Direct Hock Seng Carpentry to execute 100mm plinth scribing on Module B per NW Production Standard #001 instead of scrapping 18mm core panels.",
            priority: "CRITICAL",
            reason: "Saves RM 14,500 and prevents 7-day factory recutting delay.",
            owner_needed: false
          },
          {
            task: "Dispatch Site Supervisor Suresh to re-verify mall service lift clear opening at Pavilion Loading Bay 3.",
            priority: "HIGH",
            reason: "Ensures delivery scheduled for tomorrow morning will clear entrance without transit damage.",
            owner_needed: false
          },
          {
            task: "Inspect ELE-002 wiring raceway before drywall ceiling closure by M&E subcontractor.",
            priority: "HIGH",
            reason: "Prevents remedial hacking after acoustic ceiling board installation.",
            owner_needed: false
          }
        ],
        owner_escalations_needed: [
          "Dato' Nicholas Wong executive approval required for VO-001 (RM 18,500 Corian Glacier White solid surface specification upgrade) before client submission."
        ],
        production_health: "Factory production running at 74% capacity across 8 trade items. Cutting and CNC completed; Edge banding 100%; Assembly queue congested.",
        financial_risk_summary: "Contract Value RM 1,480,000. Certified claims RM 650,000 (IPC-01). Approved variations RM 28,000. Potential Liquidated Ascertained Damages (LAD) risk: RM 2,500/day if handover exceeds Oct 24."
      });
    }

    return res.json({
      executive_summary: `${projName} is tracking at ${project?.progress_percent || 45}% progress. Pre-start and carpentry packages are advancing according to baseline program.`,
      handover_projection: `Handover on schedule for ${project?.end_date || 'Q4 2026'}. Low variance risk detected.`,
      critical_path_bottlenecks: [
        "Procurement lead time for imported hardware fittings and acoustic veneer flitches.",
        "Site access permit renewal required from building management."
      ],
      pm_action_checklist: [
        {
          task: "Confirm material arrival date with supplier for board delivery.",
          priority: "HIGH",
          reason: "Enables CNC cutting schedule to commence without idle workshop time.",
          owner_needed: false
        },
        {
          task: "Schedule joint inspection with client representative for sample mockups.",
          priority: "MEDIUM",
          reason: "Secures written sign-off before mass fabrication.",
          owner_needed: false
        }
      ],
      owner_escalations_needed: [],
      production_health: "Factory tooling configured. Material requisitions processed.",
      financial_risk_summary: `Contract Value RM ${(project?.contract_value || 800000).toLocaleString()}. Budget tracking within standard margins.`
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// AI Communication & Contractor Assistant Engine (Module 10)
router.post('/api/ai/contractor-assistant', async (req, res) => {
  try {
    const {
      user,
      message_text,
      channel,
      project_id,
      work_item_id,
      work_item_code,
      attachments,
      conversation_history,
      context,
    } = req.body;

    const rawMsg = (message_text || '').trim();
    const lower = rawMsg.toLowerCase();
    const userRole = user?.role || 'Contractor';
    const userName = user?.name || 'Contractor';

    // 1. Mandatory Security & Permission Guardrails (Section 30)
    const isAskingCosts =
      lower.includes('cost') ||
      lower.includes('profit') ||
      lower.includes('margin') ||
      lower.includes('harga modal') ||
      lower.includes('subcon price') ||
      lower.includes('claim amount') ||
      lower.includes('how much client pay') ||
      lower.includes('contract value');

    if (userRole === 'Contractor' && isAskingCosts) {
      return res.json({
        reply_text: 'As an external trade partner, internal commercial costs, tender pricing, and profit margins are confidential under NW OS security policies. I can assist you with approved drawing dimensions, finishes, schedules, and QC requirements.',
        language: 'en',
        classification: 'Normal Question',
        confidence: 'CONFIRMED',
        action_type: 'answer_question',
        action_details: {
          target_record: 'Security Policy Guard',
          approval_required: false,
        },
      });
    }

    if (userRole === 'Client' && isAskingCosts) {
      return res.json({
        reply_text: 'Contractor trade costs and internal factory pricing are confidential. I can provide your project overall progress percentage, certified claims, and client variation summaries.',
        language: 'en',
        classification: 'Normal Question',
        confidence: 'CONFIRMED',
        action_type: 'answer_question',
        action_details: {
          target_record: 'Security Policy Guard',
          approval_required: false,
        },
      });
    }

    // 3. Resilient Deterministic NLP Engine (Handles All 7 Core Scenarios & Malaysian Vernacular)
    // Scenario 7: Emergency & Critical Safety
    if (
      lower.includes('emergency') ||
      lower.includes('bahaya') ||
      lower.includes('exposed') ||
      lower.includes('cable exposed') ||
      lower.includes('wire') ||
      lower.includes('terbakar') ||
      lower.includes('runtuh') ||
      lower.includes('danger')
    ) {
      return res.json({
        reply_text: '⚠️ URGENT SAFETY ALERT: Live electrical cable exposure flagged. Nearby trade works must pause immediately. High-priority escalation dispatched to Site Supervisor Suresh Kumar, PM Marcus Lee, and Owner Dato’ Nicholas Wong.',
        language: 'en',
        classification: 'Urgent / Safety Issue',
        confidence: 'CONFIRMED',
        action_type: 'escalate',
        action_details: {
          target_record: 'Safety Issue: Exposed Electrical Cables',
          approval_required: true,
          routed_to: 'Owner',
        },
        pm_inbox_item: {
          needed: true,
          priority: 'Critical',
          recommended_action: 'Immediate site stop-work on Zone B and summon registered wireman to isolate circuit.',
        },
      });
    }

    // Scenario 1 & 7b: Completion Update ("Counter 3 sudah siap", "3号柜台做好了", "Counter 3 finished")
    if (
      lower.includes('sudah siap') ||
      lower.includes('dah siap') ||
      lower.includes('做好了') ||
      lower.includes('siap') ||
      lower.includes('finished') ||
      lower.includes('done') ||
      lower.includes('completed')
    ) {
      const itemCode = lower.includes('1') ? 'CAR-001' : 'CAR-003';
      const isMalay = lower.includes('siap') || lower.includes('sudah');
      const isChinese = rawMsg.includes('做好了') || rawMsg.includes('柜台');

      const reply = isChinese
        ? `${itemCode} 已标记为准备验收（Ready for QC）。工厂QC任务已自动生成并指派给现场主管 Suresh 和 PM Marcus 进行质检。（经审核前不可直接出厂）。`
        : isMalay
        ? `${itemCode} telah ditandakan sebagai Ready for QC. Tugasan pemeriksaan QC telah dijana untuk Site Supervisor Suresh dan PM Marcus Lee. (Status belum QC Passed sehingga disahkan).`
        : `${itemCode} marked Ready for QC. Factory QC inspection task has been generated for Site Supervisor Suresh and PM Marcus Lee.`;

      return res.json({
        reply_text: reply,
        language: isChinese ? 'zh' : isMalay ? 'ms' : 'en',
        classification: 'Completion Update',
        confidence: 'CONFIRMED',
        action_type: 'create_qc_task',
        action_details: {
          target_record: `WorkItem ${itemCode}`,
          previous_value: 'In Progress',
          new_value: 'Ready for QC',
          approval_required: false,
          routed_to: 'Site Supervisor',
        },
        pm_inbox_item: {
          needed: false,
        },
      });
    }

    // Scenario 2: Delivery Question ("boleh hantar esok?", "tomorrow can deliver?")
    if (
      lower.includes('deliver') ||
      lower.includes('hantar') ||
      lower.includes('送货') ||
      lower.includes('esok') ||
      lower.includes('tomorrow') ||
      lower.includes('lorry')
    ) {
      const isMalay = lower.includes('hantar') || lower.includes('esok');
      const reply = isMalay
        ? 'Tiada slot penghantaran disahkan lagi untuk CAR-003. Pemeriksaan QC kilang masih belum selesai. Saya telah menghantar permohonan pengesahan kepada PM Marcus Lee dan Site Supervisor Suresh.'
        : 'No delivery slot has been confirmed yet for CAR-003. Factory QC inspection is still required. I have requested PM Marcus Lee and Site Supervisor Suresh to verify site access and confirm the slot.';

      return res.json({
        reply_text: reply,
        language: isMalay ? 'ms' : 'en',
        classification: 'Delivery Request',
        confidence: 'PROBABLE',
        action_type: 'request_pm_review',
        action_details: {
          target_record: 'WorkItem CAR-003 (Delivery Schedule)',
          approval_required: true,
          routed_to: 'PM',
        },
        pm_inbox_item: {
          needed: true,
          priority: 'High',
          recommended_action: 'Verify loading bay clearance with Pavilion Mall management and confirm lorry dispatch time with Ah Seng.',
        },
      });
    }

    // Scenario 3 & 10: Drawing / Dimension Question ("Drawing 2400 but site 2300")
    if (
      (lower.includes('2400') && lower.includes('2300')) ||
      (lower.includes('drawing') && (lower.includes('size') || lower.includes('dimension') || lower.includes('tak muat') || lower.includes('尺寸')))
    ) {
      return res.json({
        reply_text: 'There is a dimension conflict between approved Drawing A-103 (2400mm) and site wall opening (2300mm). I cannot authorize a change to an approved drawing. I have created Issue ISS-001 and sent this to PM Marcus Lee for review.',
        language: 'en',
        classification: 'Drawing Question',
        confidence: 'CONFIRMED',
        action_type: 'create_issue',
        action_details: {
          target_record: 'Issue: Drawing vs Site Dimension Discrepancy (CAR-003)',
          approval_required: true,
          routed_to: 'PM',
        },
        pm_inbox_item: {
          needed: true,
          priority: 'Critical',
          recommended_action: 'Direct Hock Seng Carpentry to execute 100mm plinth scribing on Module B per NW Standard #001 instead of scrapping 18mm core panels.',
        },
      });
    }

    // Scenario 4 & 11: Material Substitution ("Can use 18mm instead of 25mm?")
    if (
      lower.includes('18mm') ||
      lower.includes('25mm') ||
      lower.includes('tukar plywood') ||
      lower.includes('substitute') ||
      lower.includes('material')
    ) {
      return res.json({
        reply_text: 'The approved specification is 25mm High-Grade Marine Plywood. I cannot approve a change to 18mm as it affects structural deflection. I have created a Material Change Request and sent it to PM Marcus Lee for authorized technical review.',
        language: 'en',
        classification: 'Material Question',
        confidence: 'CONFIRMED',
        action_type: 'create_material_request',
        action_details: {
          target_record: 'Material Change Request: 18mm vs 25mm Marine Plywood',
          approval_required: true,
          routed_to: 'PM',
        },
        pm_inbox_item: {
          needed: true,
          priority: 'Medium',
          recommended_action: 'Reject 18mm core substitution as 2400mm retail counter requires 25mm substrate for Corian solid surface warranty.',
        },
      });
    }

    // Scenario 5 & 16: Variation Request ("Client ask add one more cabinet")
    if (
      lower.includes('cabinet') ||
      lower.includes('add') ||
      lower.includes('tambah') ||
      lower.includes('variation') ||
      lower.includes('extra work') ||
      lower.includes('client ask')
    ) {
      return res.json({
        reply_text: 'Noted client site request for an additional cabinet. I have recorded this as a Potential Variation (Status: Identified) and forwarded it to PM Marcus Lee to prepare a formal quotation for client approval. Please do not begin fabrication until VO approval is finalized.',
        language: 'en',
        classification: 'Variation Request',
        confidence: 'CONFIRMED',
        action_type: 'create_variation_request',
        action_details: {
          target_record: 'Potential Variation VO-002: Additional Cashier Storage Cabinet',
          approval_required: true,
          routed_to: 'PM',
        },
        pm_inbox_item: {
          needed: true,
          priority: 'High',
          recommended_action: 'Price and issue formal Variation Order VO-002 (est. RM 8,500) for client Michelle Tan sign-off before workshop cutting.',
        },
      });
    }

    // Scenario 6 & 1: Production Inquiry in Chinese ("柜台3做到哪里？" / "柜台3进度？")
    if (rawMsg.includes('柜台') || rawMsg.includes('3号') || lower.includes('progress') || lower.includes('做到哪里')) {
      return res.json({
        reply_text: '3号收银柜台（CAR-003）目前在工厂组装阶段（Assembly）。由于现场墙面开口为2300mm，PM已安排调整端头100mm收口板。要求交付日期为9月28日。',
        language: 'zh',
        classification: 'Production Question',
        confidence: 'CONFIRMED',
        action_type: 'answer_question',
        action_details: {
          target_record: 'WorkItem CAR-003',
          approval_required: false,
          routed_to: 'AI',
        },
        pm_inbox_item: {
          needed: false,
        },
      });
    }

    // Default polite response
    return res.json({
      reply_text: `Understood: "${rawMsg}". I have logged your message in the project communications stream. If this requires action on drawings, materials, or delivery, I will coordinate directly with PM Marcus Lee and Site Supervisor Suresh.`,
      language: 'en',
      classification: 'Normal Question',
      confidence: 'CONFIRMED',
      action_type: 'answer_question',
      action_details: {
        target_record: 'General Communication Log',
        approval_required: false,
        routed_to: 'AI',
      },
      pm_inbox_item: {
        needed: false,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ====================================================
// WHATSAPP-READY COMMUNICATION GATEWAY PIPELINE ENDPOINT
// ====================================================
router.post('/api/gateway/process-message', async (req, res) => {
  try {
    const {
      sender_phone,
      sender_name: inputSenderName,
      channel = 'WHATSAPP',
      message_text = '',
      project_id,
      work_package_id,
      work_item_code,
      attachments,
      contacts = [],
      conversation_history = [],
      settings,
    } = req.body;

    const rawText = (message_text || '').trim();
    const lower = rawText.toLowerCase();
    const cleanPhone = (sender_phone || '').replace(/[\s-]/g, '');

    // Step 1: Sender Identification by Phone
    let matchedContact = contacts.find((c: any) => {
      const cPhone = (c.phone_number || '').replace(/[\s-]/g, '');
      return cPhone && cleanPhone && (cPhone === cleanPhone || cPhone.endsWith(cleanPhone) || cleanPhone.endsWith(cPhone));
    });

    // If phone is specifically the demo unregistered number
    const isUnregistered = cleanPhone.includes('99990000') || (!matchedContact && !inputSenderName);

    // Step 2: Handle Unknown Contact (Test 4)
    if (isUnregistered || !matchedContact) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone: sender_phone || '+60 11-9999 0000',
        sender_name: 'Unknown Sender',
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'GENERAL',
        ai_confidence: 'LOW',
        ai_status: 'UNKNOWN_CONTACT',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'This WhatsApp number is not registered with NW OS. No project information can be disclosed. An administrator has been notified to verify your contact.',
        timestamp: new Date().toISOString(),
        ai_classification: 'GENERAL',
        ai_confidence: 'LOW',
        ai_status: 'UNKNOWN_CONTACT',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const queueItem = {
        queue_id: 'q-' + Date.now(),
        message_id: outboundMsg.message_id,
        channel,
        recipient: sender_phone || 'Unknown',
        recipient_name: 'Unrecognized Contact',
        content: outboundMsg.message_text,
        status: 'SENT',
        retry_count: 0,
        scheduled_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        trigger_event: 'UNKNOWN_CONTACT_SHIELD',
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: false,
          authorized: false,
          auth_reason: 'Unregistered WhatsApp number. Strict zero-trust shielding activated.',
          assigned_projects: [],
          assigned_trades: [],
        },
        ai_interpretation: {
          intent: 'GENERAL',
          confidence: 'LOW',
          reason: 'Unknown contact attempted inbound access.',
        },
        decision_gate: {
          can_ai_execute: false,
          action_name: 'REJECT_UNREGISTERED',
          requires_human_approval: false,
          blocked_reason: 'Unregistered sender: Zero project disclosure enforced.',
        },
        system_action: {
          executed: false,
          description: 'Created Admin Notification: Unrecognized communication contact from ' + (sender_phone || 'Unknown'),
        },
        outbound_message: outboundMsg,
        queue_item: queueItem,
        audit_logged: true,
      });
    }

    // Step 3: Sender Authorization & Trade Context
    const senderRole = matchedContact.role || 'Contractor';
    const senderName = matchedContact.name || 'Contractor';
    const assignedTrades = matchedContact.assigned_trade_packages || ['Carpentry'];
    const assignedProjects = matchedContact.assigned_project_ids || ['proj-1'];
    const targetProject = project_id || assignedProjects[0] || 'proj-1';

    // Step 4: Security & Permission Check - Test 1: Cross-contractor isolation
    const isAskingAboutOtherContractor =
      (lower.includes('contractor b') || lower.includes('electrical') || lower.includes('megah glass') || lower.includes('other contractor') || lower.includes('subcon b')) &&
      assignedTrades.includes('Carpentry') &&
      !assignedTrades.includes('Electrical');

    if (isAskingAboutOtherContractor) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'QUESTION',
        ai_confidence: 'HIGH',
        ai_status: 'BLOCKED_PERMISSION',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'ACCESS DENIED: Under NW OS contractor isolation policies, trade sub-contractor activities and schedules are strictly segregated. You only have access to your assigned Carpentry work packages.',
        timestamp: new Date().toISOString(),
        ai_classification: 'QUESTION',
        ai_confidence: 'HIGH',
        ai_status: 'BLOCKED_PERMISSION',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: false,
          auth_reason: 'Denied: Cross-contractor trade isolation violation prevented.',
        },
        ai_interpretation: {
          intent: 'QUESTION',
          confidence: 'HIGH',
          reason: 'Inquiry targeted third-party trade activities outside contractor assignment.',
        },
        decision_gate: {
          can_ai_execute: false,
          action_name: 'BLOCK_CROSS_CONTRACTOR_ACCESS',
          requires_human_approval: false,
          blocked_reason: 'ACCESS DENIED / DO NOT DISCLOSE: Cross-contractor isolation policy enforced.',
        },
        system_action: {
          executed: false,
          description: 'Security exception logged. Zero third-party trade data leaked.',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'CROSS_CONTRACTOR_ISOLATION',
        },
        audit_logged: true,
      });
    }

    // Step 5: Security & Permission Check - Test 2: Commercial & Profit Protection
    const isAskingFinancials =
      lower.includes('profit') ||
      lower.includes('margin') ||
      lower.includes('untung') ||
      lower.includes('contract value') ||
      lower.includes('project cost') ||
      lower.includes('client price') ||
      lower.includes('claim amount');

    if (isAskingFinancials && senderRole === 'Contractor') {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'QUESTION',
        ai_confidence: 'HIGH',
        ai_status: 'BLOCKED_PERMISSION',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'DO NOT DISCLOSE: Financial margins, contract values, and project commercial claims are strictly confidential under NW OS security governance.',
        timestamp: new Date().toISOString(),
        ai_classification: 'QUESTION',
        ai_confidence: 'HIGH',
        ai_status: 'BLOCKED_PERMISSION',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: false,
          auth_reason: 'Denied: Contractor restricted from commercial / financial data.',
        },
        ai_interpretation: {
          intent: 'QUESTION',
          confidence: 'HIGH',
          reason: 'Inquiry sought confidential financial / commercial data.',
        },
        decision_gate: {
          can_ai_execute: false,
          action_name: 'BLOCK_COMMERCIAL_DISCLOSURE',
          requires_human_approval: false,
          blocked_reason: 'DO NOT DISCLOSE: Role permission checks forbid financial exposure.',
        },
        system_action: {
          executed: false,
          description: 'Security exception logged. Financial confidentiality preserved.',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'FINANCIAL_CONFIDENTIALITY_SHIELD',
        },
        audit_logged: true,
      });
    }

    // Step 6: Security & Permission Check - Test 3: Technical Dimension Modification Prohibition
    const isRequestingDimensionChange =
      (lower.includes('change') || lower.includes('tukar') || lower.includes('modify') || lower.includes('adjust') || rawText.includes('改')) &&
      (lower.includes('2300') || lower.includes('2400') || lower.includes('mm') || lower.includes('dimension') || lower.includes('size') || rawText.includes('尺寸'));

    if (isRequestingDimensionChange) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        work_item_code: 'CAR-003',
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'PROBLEM',
        ai_confidence: 'HIGH',
        ai_status: 'PENDING_HUMAN',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'AI REFUSAL: Under NW OS engineering governance, technical dimensions and approved drawings CANNOT be modified automatically by AI or contractors. I have created an urgent Technical Review Request for PM Marcus Lee and Owner Dato’ Nicholas Wong.',
        timestamp: new Date().toISOString(),
        ai_classification: 'PROBLEM',
        ai_confidence: 'HIGH',
        ai_status: 'PENDING_HUMAN',
        related_record: 'AI Action Request #req-dim-override',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: true,
          auth_reason: 'Authorized contractor, but action requires human engineering approval.',
        },
        ai_interpretation: {
          item_code: 'CAR-003',
          intent: 'PROBLEM',
          confidence: 'HIGH',
          reason: 'Contractor requested direct technical dimension change on approved drawing.',
        },
        decision_gate: {
          can_ai_execute: false,
          action_name: 'PROHIBIT_TECHNICAL_DIMENSION_CHANGE',
          requires_human_approval: true,
          blocked_reason: 'AI Action Gate: Technical drawing modification strictly requires PM & Owner sign-off.',
        },
        system_action: {
          executed: false,
          description: 'Refused automated modification. Created AI Action Request #req-1 with drawing A-103 Rev 4 comparison.',
          target_record: 'AI Action Request: Technical Review',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'TECHNICAL_OVERRIDE_ESCALATION',
        },
        audit_logged: true,
      });
    }

    // Step 7: Ambiguity & Anti-Guessing - Test 8: Ambiguous Message ("That one finished")
    const isAmbiguousMessage =
      lower === 'that one finished.' ||
      lower === 'that one finished' ||
      lower === 'yang tu siap' ||
      lower === 'almost done' ||
      lower === 'dah siap dah' ||
      lower === 'done already';

    if (isAmbiguousMessage && !work_item_code) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'COMPLETION',
        ai_confidence: 'LOW',
        ai_status: 'PENDING_HUMAN',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'Which item do you mean? You currently have 3 assigned items under Carpentry (CAR-001 Feature Wall, CAR-003 Checkout Counter, CAR-004 Island Vitrine). Please reply with the item code.',
        timestamp: new Date().toISOString(),
        ai_classification: 'COMPLETION',
        ai_confidence: 'LOW',
        ai_status: 'PENDING_HUMAN',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: true,
          auth_reason: 'Authorized contractor, but input lacks identifiable item code.',
        },
        ai_interpretation: {
          intent: 'COMPLETION',
          confidence: 'LOW',
          reason: 'Ambiguous subject. Multiple active work items exist in contractor work package.',
          clarification_prompt: 'Which item do you mean?',
        },
        decision_gate: {
          can_ai_execute: false,
          action_name: 'ASK_CLARIFICATION',
          requires_human_approval: false,
          blocked_reason: 'LOW Confidence: Anti-guessing rule prevents database mutation without item identification.',
        },
        system_action: {
          executed: false,
          description: 'No database modification executed. Clarification requested from contractor.',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'CLARIFICATION_PROMPT',
        },
        audit_logged: true,
      });
    }

    // Step 8: Test 5 - Routine Completion & QC Task Automation ("Counter 3 finished")
    const isCompletionUpdate =
      (lower.includes('counter 3') || lower.includes('car-003') || lower.includes('3号') || lower.includes('counter3')) &&
      (lower.includes('finished') || lower.includes('siap') || lower.includes('complete') || lower.includes('done') || rawText.includes('做好了') || rawText.includes('完成'));

    if (isCompletionUpdate) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        work_package_id: 'wp-1',
        work_item_id: 'item-1',
        work_item_code: 'CAR-003',
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'COMPLETION',
        ai_confidence: 'HIGH',
        ai_status: 'PROCESSED',
        related_record: 'WorkItem CAR-003',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'CAR-003 marked Ready for QC. QC inspection task has been requested and assigned to Site Supervisor Ahmad Razak. (Item will remain Ready for QC until physically inspected).',
        timestamp: new Date().toISOString(),
        ai_classification: 'COMPLETION',
        ai_confidence: 'HIGH',
        ai_status: 'PROCESSED',
        related_record: 'QC Inspection Task #QC-CAR-003',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: true,
          auth_reason: 'Contractor is assigned to CAR-003 Carpentry work item.',
        },
        ai_interpretation: {
          item_code: 'CAR-003',
          work_item_id: 'item-1',
          intent: 'COMPLETION',
          confidence: 'HIGH',
          reason: 'Identified WorkItem CAR-003 and completion declaration.',
        },
        decision_gate: {
          can_ai_execute: true,
          action_name: 'TRANSITION_READY_FOR_QC',
          requires_human_approval: false,
        },
        system_action: {
          executed: true,
          description: 'Updated CAR-003 status to "Ready for QC" and created factory QC task for Site Supervisor Ahmad Razak.',
          target_record: 'WorkItem CAR-003',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'QC_TASK_CREATED',
        },
        audit_logged: true,
      });
    }

    // Step 9: Test 6 - Unscheduled Delivery Safeguard ("Counter 3 tomorrow 10am")
    const isDeliveryRequest =
      (lower.includes('deliver') || lower.includes('hantar') || lower.includes('10am') || lower.includes('esok') || lower.includes('tomorrow') || rawText.includes('送货')) &&
      (lower.includes('counter') || lower.includes('3') || rawText.includes('柜台'));

    if (isDeliveryRequest) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        work_package_id: 'wp-1',
        work_item_id: 'item-1',
        work_item_code: 'CAR-003',
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'DELIVERY',
        ai_confidence: 'MEDIUM',
        ai_status: 'PENDING_HUMAN',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: 'No confirmed delivery schedule exists yet for CAR-003. I will notify PM Marcus Lee and Site Supervisor Ahmad Razak to coordinate loading bay permits and confirm your timing.',
        timestamp: new Date().toISOString(),
        ai_classification: 'DELIVERY',
        ai_confidence: 'MEDIUM',
        ai_status: 'PENDING_HUMAN',
        related_record: 'Delivery Request CAR-003',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: true,
          auth_reason: 'Contractor is assigned to CAR-003 Carpentry work item.',
        },
        ai_interpretation: {
          item_code: 'CAR-003',
          work_item_id: 'item-1',
          intent: 'DELIVERY',
          confidence: 'MEDIUM',
          reason: 'Delivery requested but site mall loading bay permit has not been approved.',
        },
        decision_gate: {
          can_ai_execute: false,
          action_name: 'HOLD_DELIVERY_FOR_PM_CONFIRMATION',
          requires_human_approval: true,
          blocked_reason: 'No confirmed delivery slot in database. Prevent uncoordinated site transport.',
        },
        system_action: {
          executed: false,
          description: 'Created PM Inbox action for Marcus Lee to confirm Pavilion mall loading dock permit before authorizing delivery.',
          target_record: 'PM Inbox Item: Delivery Clearance',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'DELIVERY_COORDINATION_PENDING',
        },
        audit_logged: true,
      });
    }

    // Step 10: Test 7 - Multilingual Chinese Natural Language Processing
    const isChineseInquiry =
      rawText.includes('柜台') ||
      rawText.includes('阶段') ||
      rawText.includes('做') ||
      rawText.includes('几时') ||
      rawText.includes('送货');

    if (isChineseInquiry) {
      const inboundMsg = {
        message_id: 'gmsg-in-' + Date.now(),
        channel,
        direction: 'INBOUND',
        sender_phone,
        sender_name: senderName,
        sender_user_id: matchedContact.user_id,
        project_id: targetProject,
        work_package_id: 'wp-1',
        work_item_id: 'item-1',
        work_item_code: 'CAR-003',
        message_text: rawText,
        timestamp: new Date().toISOString(),
        ai_classification: 'PRODUCTION_QUESTION',
        ai_confidence: 'HIGH',
        ai_status: 'PROCESSED',
        delivery_status: 'DELIVERED',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const outboundMsg = {
        message_id: 'gmsg-out-' + Date.now(),
        channel,
        direction: 'OUTBOUND',
        recipient_phone: sender_phone,
        sender_name: 'NW OS Gateway AI',
        message_text: '3号收银柜台（CAR-003）目前在工厂组装阶段（Assembly）。要求完成日期为9月28日。现场送货时间须待商场夜间卸货准证确认。',
        timestamp: new Date().toISOString(),
        ai_classification: 'PRODUCTION_QUESTION',
        ai_confidence: 'HIGH',
        ai_status: 'PROCESSED',
        related_record: 'WorkItem CAR-003',
        delivery_status: 'SENT',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return res.json({
        inbound: inboundMsg,
        sender_verification: {
          recognized: true,
          contact: matchedContact,
          assigned_projects: assignedProjects,
          assigned_trades: assignedTrades,
          authorized: true,
          auth_reason: 'Contractor assigned to CAR-003.',
        },
        ai_interpretation: {
          item_code: 'CAR-003',
          work_item_id: 'item-1',
          intent: 'PRODUCTION_QUESTION',
          confidence: 'HIGH',
          reason: 'Chinese natural language inquiry parsed for CAR-003 assembly status and schedule.',
        },
        decision_gate: {
          can_ai_execute: true,
          action_name: 'ANSWER_IN_CHINESE',
          requires_human_approval: false,
        },
        system_action: {
          executed: true,
          description: 'Provided approved assembly and delivery requirements in Chinese.',
          target_record: 'WorkItem CAR-003',
        },
        outbound_message: outboundMsg,
        queue_item: {
          queue_id: 'q-' + Date.now(),
          message_id: outboundMsg.message_id,
          channel,
          recipient: sender_phone,
          recipient_name: senderName,
          content: outboundMsg.message_text,
          status: 'SENT',
          retry_count: 0,
          scheduled_at: new Date().toISOString(),
          sent_at: new Date().toISOString(),
          trigger_event: 'CHINESE_PRODUCTION_STATUS',
        },
        audit_logged: true,
      });
    }

    // Step 11: General handling (rule-based; the simulator never calls a model)
    let replyText = `Understood: "${rawText}". I have recorded this in the project communication stream for PM Marcus Lee and Site Supervisor Ahmad Razak.`;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'HIGH';


    const inboundMsg = {
      message_id: 'gmsg-in-' + Date.now(),
      channel,
      direction: 'INBOUND',
      sender_phone,
      sender_name: senderName,
      sender_user_id: matchedContact.user_id,
      project_id: targetProject,
      message_text: rawText,
      timestamp: new Date().toISOString(),
      ai_classification: 'GENERAL',
      ai_confidence: confidence,
      ai_status: 'PROCESSED',
      delivery_status: 'DELIVERED',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const outboundMsg = {
      message_id: 'gmsg-out-' + Date.now(),
      channel,
      direction: 'OUTBOUND',
      recipient_phone: sender_phone,
      sender_name: 'NW OS Gateway AI',
      message_text: replyText,
      timestamp: new Date().toISOString(),
      ai_classification: 'GENERAL',
      ai_confidence: confidence,
      ai_status: 'PROCESSED',
      delivery_status: 'SENT',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return res.json({
      inbound: inboundMsg,
      sender_verification: {
        recognized: true,
        contact: matchedContact,
        assigned_projects: assignedProjects,
        assigned_trades: assignedTrades,
        authorized: true,
        auth_reason: 'Registered user verified.',
      },
      ai_interpretation: {
        intent: 'GENERAL',
        confidence,
        reason: 'Standard communication routed through unified gateway.',
      },
      decision_gate: {
        can_ai_execute: true,
        action_name: 'ROUTINE_GATEWAY_RESPONSE',
        requires_human_approval: false,
      },
      system_action: {
        executed: true,
        description: 'Logged communication in project thread.',
      },
      outbound_message: outboundMsg,
      queue_item: {
        queue_id: 'q-' + Date.now(),
        message_id: outboundMsg.message_id,
        channel,
        recipient: sender_phone,
        recipient_name: senderName,
        content: outboundMsg.message_text,
        status: 'SENT',
        retry_count: 0,
        scheduled_at: new Date().toISOString(),
        sent_at: new Date().toISOString(),
        trigger_event: 'GENERAL_RESPONSE',
      },
      audit_logged: true,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
}

/** The rule-based legacy routes as a router (mounted at the app root by mountSecureApi). */
export function createLegacyRulesRouter() {
  const router = express.Router();
  registerLegacyRules(router);
  return router;
}
