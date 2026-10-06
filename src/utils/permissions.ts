/**
 * NW OS — Role-Based Access Control (RBAC) & Permissions Engine
 * Project-aware, granular permission validation, self-approval prevention,
 * and Owner override recording.
 */

import {
  UserProfile,
  UserRole,
  PermissionKey,
  Project,
  WorkPackage,
  WorkItem,
  Drawing,
  Issue,
  ApprovalItem,
  ApprovalType,
} from '../types';

export interface RoleDefinition {
  role: UserRole;
  title: string;
  department: string;
  category: 'Executive' | 'Management' | 'Operations' | 'Finance & Supply' | 'External Stakeholder';
  description: string;
  capabilities: string[];
  restrictions: string[];
  defaultPermissions: PermissionKey[];
  canOverrideWorkflow: boolean;
  color: {
    bg: string;
    text: string;
    border: string;
    accent: string;
  };
}

export const ALL_PERMISSIONS: { key: PermissionKey; label: string; group: string; description: string }[] = [
  // Clients
  { key: 'clients.view', label: 'View Clients', group: 'Clients', description: 'Browse and view client directory details' },
  { key: 'clients.create', label: 'Create Clients', group: 'Clients', description: 'Register new client entities' },
  { key: 'clients.edit', label: 'Edit Clients', group: 'Clients', description: 'Update client details and contacts' },
  { key: 'clients.delete', label: 'Delete Clients', group: 'Clients', description: 'Archive or remove client entities' },

  // Projects
  { key: 'projects.view', label: 'View Projects', group: 'Projects', description: 'View assigned or company projects' },
  { key: 'projects.create', label: 'Create Projects', group: 'Projects', description: 'Initialize new project records' },
  { key: 'projects.edit', label: 'Edit Projects', group: 'Projects', description: 'Update dates, address, and project metadata' },
  { key: 'projects.delete', label: 'Delete Projects', group: 'Projects', description: 'Archive or delete project records' },

  // Contractors
  { key: 'contractors.view', label: 'View Contractors', group: 'Contractors', description: 'View contractor directory and trades' },
  { key: 'contractors.create', label: 'Add Contractors', group: 'Contractors', description: 'Onboard new trade contractors' },
  { key: 'contractors.edit', label: 'Edit Contractors', group: 'Contractors', description: 'Update contractor information' },
  { key: 'contractors.delete', label: 'Delete Contractors', group: 'Contractors', description: 'Remove contractor records' },

  // Work Packages & Items
  { key: 'work_packages.view', label: 'View Work Packages', group: 'Work Packages', description: 'View work package breakdown' },
  { key: 'work_packages.create', label: 'Create Work Packages', group: 'Work Packages', description: 'Create work packages and trade scope' },
  { key: 'work_packages.edit', label: 'Edit Work Packages', group: 'Work Packages', description: 'Reassign contractors and edit scope' },
  { key: 'work_items.view', label: 'View Work Items', group: 'Work Items', description: 'View work items and production status' },
  { key: 'work_items.create', label: 'Create Work Items', group: 'Work Items', description: 'Add new work items to packages' },
  { key: 'work_items.edit', label: 'Edit Work Items', group: 'Work Items', description: 'Update specs, dimensions, and materials' },
  { key: 'work_items.complete', label: 'Mark Complete', group: 'Work Items', description: 'Mark work complete for QC submission' },
  { key: 'work_items.qc', label: 'Perform QC', group: 'Work Items', description: 'Pass or reject QC inspections' },
  { key: 'work_items.delivery', label: 'Manage Delivery', group: 'Work Items', description: 'Schedule lorry delivery and confirm receipt' },
  { key: 'work_items.install', label: 'Manage Installation', group: 'Work Items', description: 'Update site installation progress' },

  // Drawings
  { key: 'drawings.view', label: 'View Drawings', group: 'Drawings', description: 'Inspect 2D/3D drawings and revisions' },
  { key: 'drawings.upload', label: 'Upload Drawings', group: 'Drawings', description: 'Upload client drawings and revision sets' },
  { key: 'drawings.markup', label: 'Create Markups', group: 'Drawings', description: 'Pin markups, annotations, and dimensions' },
  { key: 'drawings.analyze', label: 'AI Analyze Drawings', group: 'Drawings', description: 'Run Gemini AI drawing extraction' },
  { key: 'drawings.create_production', label: 'Create NW Production Drawing', group: 'Drawings', description: 'Generate production drawings from recommendations' },
  { key: 'drawings.approve', label: 'Approve Drawings', group: 'Drawings', description: 'Formally approve drawings for production' },
  { key: 'drawings.modify_approved', label: 'Modify Approved Drawings', group: 'Drawings', description: 'Supercede or issue revision to approved drawings' },

  // Knowledge Base
  { key: 'knowledge.view', label: 'View Knowledge Base', group: 'Knowledge', description: 'Access NW production standards and joinery methods' },
  { key: 'knowledge.edit', label: 'Edit Knowledge Base', group: 'Knowledge', description: 'Publish and curate company carpentry standards' },

  // Issues & Escalations
  { key: 'issues.view', label: 'View Issues', group: 'Issues', description: 'Monitor site, factory, and contractor issues' },
  { key: 'issues.create', label: 'Report Issues', group: 'Issues', description: 'Raise new defects, clashes, and site blockers' },
  { key: 'issues.assign', label: 'Assign Issues', group: 'Issues', description: 'Assign issues to trades and supervisors' },
  { key: 'issues.resolve', label: 'Resolve Issues', group: 'Issues', description: 'Mark issues as resolved with corrective actions' },
  { key: 'issues.escalate', label: 'Escalate Issues', group: 'Issues', description: 'Escalate urgent matters to PM or Owner' },

  // Production Management
  { key: 'production.view', label: 'View Production', group: 'Production', description: 'View workshop queue and part dimensions' },
  { key: 'production.update', label: 'Update Production Status', group: 'Production', description: 'Progress stages: Cutting, CNC, Assembly, Finishing' },
  { key: 'production.create_orders', label: 'Create Production Orders', group: 'Production', description: 'Release work orders to factory floor' },
  { key: 'production.cnc_manage', label: 'Manage CNC Data', group: 'Production', description: 'Configure toolpaths, nesting, and G-code' },
  { key: 'production.propose_methods', label: 'Propose Technical Methods', group: 'Production', description: 'Propose joinery and construction method changes' },

  // Delivery & Site Installation (Module 14)
  { key: 'delivery.view', label: 'View Delivery & Site', group: 'Delivery & Site', description: 'View delivery schedules, status, and installation boards' },
  { key: 'delivery.schedule', label: 'Arrange & Schedule Deliveries', group: 'Delivery & Site', description: 'Record transport arrangements, lorry plate, and dates' },
  { key: 'delivery.load', label: 'Verify Loading & QR Scan', group: 'Delivery & Site', description: 'Execute factory dispatch loading checklist and package scans' },
  { key: 'delivery.receive', label: 'Site Receiving & Receipts', group: 'Delivery & Site', description: 'Scan QR at site, inspect packages, record damages or short counts' },
  { key: 'installation.view', label: 'View Installation', group: 'Delivery & Site', description: 'Monitor site installation jobs and progress' },
  { key: 'installation.update', label: 'Update Installation Progress', group: 'Delivery & Site', description: 'Complete installation checklist and mark completion' },
  { key: 'installation.qc', label: 'Conduct Site QC Inspections', group: 'Delivery & Site', description: 'Inspect joinery on-site, log snags, and approve rectification' },
  { key: 'handover.manage', label: 'Manage Completion & CPC Handover', group: 'Delivery & Site', description: 'Manage Certificate of Practical Completion, DLP, and retention sum' },

  // Purchasing & Materials
  { key: 'purchasing.view', label: 'View Purchasing', group: 'Purchasing', description: 'View material requests and purchase orders' },
  { key: 'purchasing.create', label: 'Create Purchase Orders', group: 'Purchasing', description: 'Issue POs and material requisitions' },
  { key: 'purchasing.manage_suppliers', label: 'Manage Suppliers', group: 'Purchasing', description: 'Maintain supplier directory and quotes' },
  { key: 'purchasing.manage_pos', label: 'Manage PO Status', group: 'Purchasing', description: 'Track PO delivery and receipt confirmation' },

  // Financials & Claims
  { key: 'finance.view', label: 'View Financials', group: 'Finance', description: 'View project values and financial summaries' },
  { key: 'finance.edit', label: 'Edit Financials', group: 'Finance', description: 'Adjust contract values and budgets' },
  { key: 'finance.manage_claims', label: 'Manage Claims', group: 'Finance', description: 'Generate and submit progress claim certificates (IPC)' },
  { key: 'finance.record_payments', label: 'Record Payments', group: 'Finance', description: 'Record client inflows and contractor disbursements' },
  { key: 'finance.view_margins', label: 'View Profit Margins', group: 'Finance', description: 'View internal company margins and cost breakdowns' },

  // Commercial & Profit Control (Module 12)
  { key: 'commercial.view', label: 'View Commercial Module', group: 'Commercial', description: 'Access tenders, quotations, baselines, and project costs' },
  { key: 'commercial.costing', label: 'View Internal Costing', group: 'Commercial', description: 'Inspect item-level direct cost breakdown and confidence ratings' },
  { key: 'commercial.margins', label: 'View Commercial Margins & Profit', group: 'Commercial', description: 'Inspect executive profit calculations, margin %, and leak alerts' },
  { key: 'commercial.edit', label: 'Edit Commercial Records', group: 'Commercial', description: 'Create quotations, enter costs, and manage claim certificates' },

  // Variations
  { key: 'variations.view', label: 'View Variations', group: 'Variations', description: 'View variation orders and cost impact' },
  { key: 'variations.create', label: 'Create Variations', group: 'Variations', description: 'Draft new variation orders (VO)' },
  { key: 'variations.approve', label: 'Approve Variations (Internal)', group: 'Variations', description: 'Approve major internal variation costings' },
  { key: 'variations.client_approve', label: 'Client Approve Variations', group: 'Variations', description: 'Formally endorse or reject client-facing variation' },

  // Approvals Framework
  { key: 'approvals.view', label: 'View Approvals', group: 'Approvals', description: 'Access approval dashboard and pending items' },
  { key: 'approvals.request', label: 'Submit Approval Requests', group: 'Approvals', description: 'Submit technical, drawing, or cost approvals' },
  { key: 'approvals.decide', label: 'Make Approval Decisions', group: 'Approvals', description: 'Approve, reject, or request changes' },
  { key: 'approvals.override', label: 'Override Approvals', group: 'Approvals', description: 'Owner authority to override workflow holds' },

  // Administration & Security
  { key: 'users.view', label: 'View Users', group: 'Administration', description: 'Inspect user accounts and assigned roles' },
  { key: 'users.manage', label: 'Manage Users & Roles', group: 'Administration', description: 'Create, edit, deactivate users and role assignments' },
  { key: 'settings.manage', label: 'Manage System Settings', group: 'Administration', description: 'Configure system defaults and company policies' },
  { key: 'audit.view', label: 'View Audit Logs', group: 'Administration', description: 'Inspect tamper-evident system audit trail' },
  { key: 'ai.assistant', label: 'Use AI Copilot', group: 'Intelligence', description: 'Use NW OS AI intelligence assistant' },
  { key: 'workflow.override', label: 'Emergency Workflow Override', group: 'Administration', description: 'Bypass standard restrictions with mandatory audit log' },

  // Automation, Task & Escalation Engine (Module 15)
  { key: 'automation.view', label: 'View Automation & Tasks', group: 'Automation', description: 'Access automation center, task lists, and escalation logs' },
  { key: 'automation.manage_rules', label: 'Manage Automation Rules', group: 'Automation', description: 'Create, edit, activate, and deactivate workflow rules' },
  { key: 'automation.manage_tasks', label: 'Manage & Reassign Tasks', group: 'Automation', description: 'Assign, reassign, escalate, and cancel workflow tasks' },
  { key: 'automation.override', label: 'Owner Automation Override', group: 'Automation', description: 'Authorize emergency workflow bypass with logged justification' },
  { key: 'automation.execute_action', label: 'Execute Task & Trigger Actions', group: 'Automation', description: 'Complete tasks, acknowledge escalations, and run suggested actions' },

  // Management Intelligence & Owner Control Center (Module 16)
  { key: 'management.view', label: 'View Management Intelligence', group: 'Administration', description: 'Access company-wide portfolio, executive analytics, and owner command center' },
  { key: 'management.reports', label: 'Generate & Export Management Reports', group: 'Administration', description: 'Export executive reports in CSV and print formats' },
  { key: 'management.kpi_config', label: 'Configure Management KPIs', group: 'Administration', description: 'Update executive benchmark tolerances and performance targets' },
];

export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinition> = {
  'Owner / CEO': {
    role: 'Owner / CEO',
    title: 'Owner / Chief Executive Officer',
    department: 'Executive Leadership',
    category: 'Executive',
    description: 'Full company visibility across all operations, financials, clients, production, and governance with supreme override authority.',
    capabilities: [
      'View all clients, projects, contractors, drawings, schedules, and costs',
      'Approve major decisions, major variations, and NW production drawings',
      'Approve company production standards & knowledge items',
      'Manage users, roles, permissions, and system settings',
      'Override normal workflow restrictions where appropriate (recorded in audit log)',
      'Full access to AI assistant and strategic financial reporting',
    ],
    restrictions: [
      'All emergency overrides are permanently recorded in the immutable audit log',
    ],
    canOverrideWorkflow: true,
    color: {
      bg: 'bg-amber-50',
      text: 'text-amber-900',
      border: 'border-amber-400',
      accent: 'amber',
    },
    defaultPermissions: ALL_PERMISSIONS.map((p) => p.key),
  },

  'Admin': {
    role: 'Admin',
    title: 'System & Operations Administrator',
    department: 'Company Administration',
    category: 'Management',
    description: 'Manages company projects, clients, documentation, dates, and user onboarding while protecting sensitive financial and technical controls.',
    capabilities: [
      'Create and edit clients and projects',
      'Upload project documents and client drawings',
      'Manage drawing revisions and project dates',
      'Manage local authority (LA) and insurance documents',
      'View project work info, contractors, work packages, and work items',
      'Manage users and system administration',
      'Use AI Assistant for document and drawing parsing',
    ],
    restrictions: [
      'CANNOT approve major technical production changes',
      'CANNOT approve major variations',
      'CANNOT view confidential company profit margins & financial rates',
      'CANNOT change Owner-level executive settings',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-blue-50',
      text: 'text-blue-900',
      border: 'border-blue-400',
      accent: 'blue',
    },
    defaultPermissions: [
      'clients.view',
      'clients.create',
      'clients.edit',
      'projects.view',
      'projects.create',
      'projects.edit',
      'contractors.view',
      'contractors.create',
      'contractors.edit',
      'work_packages.view',
      'work_packages.create',
      'work_packages.edit',
      'work_items.view',
      'work_items.create',
      'work_items.edit',
      'drawings.view',
      'drawings.upload',
      'drawings.markup',
      'drawings.analyze',
      'knowledge.view',
      'issues.view',
      'issues.create',
      'issues.assign',
      'issues.resolve',
      'production.view',
      'delivery.view',
      'delivery.schedule',
      'delivery.load',
      'delivery.receive',
      'installation.view',
      'installation.update',
      'installation.qc',
      'handover.manage',
      'purchasing.view',
      'commercial.view',
      'commercial.costing',
      'commercial.edit',
      'variations.view',
      'approvals.view',
      'approvals.request',
      'users.view',
      'users.manage',
      'audit.view',
      'ai.assistant',
      'automation.view',
      'automation.manage_rules',
      'automation.manage_tasks',
      'automation.override',
      'automation.execute_action',
      'management.view',
      'management.reports',
      'management.kpi_config',
    ],
  },

  'Project Manager': {
    role: 'Project Manager',
    title: 'Senior Project Manager',
    department: 'Project Management',
    category: 'Management',
    description: 'Comprehensive operational command of assigned projects, contractors, work packages, quality control, and schedule delivery.',
    capabilities: [
      'View and manage assigned projects',
      'Create/edit work packages and assign trade contractors',
      'Create/edit work items and monitor progress',
      'Review drawings, add markups, review AI drawing analysis',
      'Create NW Production Recommendations and request approval',
      'Manage, assign, and escalate operational issues',
      'Oversee delivery schedules, installation schedules, and QC approvals',
      'Communicate with contractors and update operational decisions',
    ],
    restrictions: [
      'CANNOT change approved client drawings',
      'CANNOT approve own major technical changes without peer/owner signoff',
      'CANNOT approve major variations or change contract value',
      'CANNOT see confidential internal financial profit margins',
      'CANNOT override Owner decisions or access unassigned projects',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-indigo-50',
      text: 'text-indigo-900',
      border: 'border-indigo-400',
      accent: 'indigo',
    },
    defaultPermissions: [
      'clients.view',
      'projects.view',
      'projects.edit',
      'contractors.view',
      'work_packages.view',
      'work_packages.create',
      'work_packages.edit',
      'work_items.view',
      'work_items.create',
      'work_items.edit',
      'work_items.complete',
      'work_items.qc',
      'work_items.delivery',
      'work_items.install',
      'drawings.view',
      'drawings.upload',
      'drawings.markup',
      'drawings.analyze',
      'drawings.create_production',
      'knowledge.view',
      'issues.view',
      'issues.create',
      'issues.assign',
      'issues.resolve',
      'issues.escalate',
      'production.view',
      'delivery.view',
      'delivery.schedule',
      'delivery.load',
      'delivery.receive',
      'installation.view',
      'installation.update',
      'installation.qc',
      'handover.manage',
      'purchasing.view',
      'commercial.view',
      'commercial.costing',
      'commercial.edit',
      'variations.view',
      'variations.create',
      'approvals.view',
      'approvals.request',
      'ai.assistant',
      'automation.view',
      'automation.manage_tasks',
      'automation.execute_action',
    ],
  },

  'Site Supervisor': {
    role: 'Site Supervisor',
    title: 'Site Supervisor / Clerk of Works',
    department: 'Site Operations',
    category: 'Operations',
    description: 'Manages day-to-day site installation, measurements, deliveries received, contractor coordination, and defect reporting on assigned sites.',
    capabilities: [
      'View assigned work items and approved construction drawings',
      'Update progress percentages and upload site photos',
      'Create site measurements and report site discrepancies',
      'Report problems, create issues, and update issue progress',
      'Mark work complete and submit for QC inspection',
      'Record deliveries received and update installation progress',
      'Add site notes and markups to drawings where authorized',
    ],
    restrictions: [
      'CANNOT modify approved drawings or dimensions',
      'CANNOT approve production drawings or variations',
      'CANNOT change contract values or contractor pricing',
      'CANNOT see internal project costs or supplier pricing',
      'Restricted strictly to assigned project locations',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-emerald-50',
      text: 'text-emerald-900',
      border: 'border-emerald-400',
      accent: 'emerald',
    },
    defaultPermissions: [
      'ai.assistant',
      'projects.view',
      'contractors.view',
      'work_packages.view',
      'work_items.view',
      'work_items.complete',
      'work_items.qc',
      'work_items.delivery',
      'work_items.install',
      'delivery.view',
      'delivery.receive',
      'installation.view',
      'installation.update',
      'installation.qc',
      'handover.manage',
      'drawings.view',
      'drawings.markup',
      'issues.view',
      'issues.create',
      'issues.assign',
      'issues.resolve',
      'production.view',
      'approvals.view',
      'approvals.request',
      'automation.view',
      'automation.execute_action',
    ],
  },

  'Purchasing': {
    role: 'Purchasing',
    title: 'Procurement & Purchasing Manager',
    department: 'Procurement',
    category: 'Finance & Supply',
    description: 'Manages material requisitions, purchase orders, supplier quotations, goods received, and material price tracking.',
    capabilities: [
      'View approved material requirements from drawings & work items',
      'Create material requisitions and purchase orders (PO)',
      'Manage supplier directory, ratings, and contact info',
      'Record supplier quotations and compare pricing',
      'Record goods received and material stock delivery status',
      'View material price history and update purchasing status',
    ],
    restrictions: [
      'CANNOT change approved drawing dimensions or specs',
      'CANNOT approve technical production changes',
      'CANNOT change project contract scope or approve variations',
      'CANNOT see confidential non-purchasing executive information',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-teal-50',
      text: 'text-teal-900',
      border: 'border-teal-400',
      accent: 'teal',
    },
    defaultPermissions: [
      'ai.assistant',
      'projects.view',
      'work_items.view',
      'drawings.view',
      'purchasing.view',
      'purchasing.create',
      'purchasing.manage_suppliers',
      'purchasing.manage_pos',
      'approvals.view',
      'approvals.request',
      'automation.view',
      'automation.execute_action',
    ],
  },

  'Accountant': {
    role: 'Accountant',
    title: 'Chartered Accountant / Financial Controller',
    department: 'Finance & Accounts',
    category: 'Finance & Supply',
    description: 'Financial control of project costs, interim payment claims (IPC), invoices, disbursements, supplier PO payments, and profitability margins.',
    capabilities: [
      'View project financial details, budgets, and actual costs',
      'Manage client claims (IPC) and issue invoices',
      'Record incoming payments and contractor disbursements',
      'View quotations, purchase orders, and variation costs',
      'Generate financial reports, margin forecasts, and cashflow charts',
      'Audit contractor billing and retention sums',
    ],
    restrictions: [
      'CANNOT modify drawings or production instructions',
      'CANNOT assign contractors or alter technical specifications',
      'CANNOT approve technical production changes',
      'CANNOT change construction scope directly',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-cyan-50',
      text: 'text-cyan-900',
      border: 'border-cyan-400',
      accent: 'cyan',
    },
    defaultPermissions: [
      'ai.assistant',
      'clients.view',
      'projects.view',
      'contractors.view',
      'work_packages.view',
      'work_items.view',
      'purchasing.view',
      'finance.view',
      'finance.edit',
      'finance.manage_claims',
      'finance.record_payments',
      'finance.view_margins',
      'commercial.view',
      'commercial.costing',
      'commercial.margins',
      'commercial.edit',
      'variations.view',
      'approvals.view',
      'approvals.request',
      'approvals.decide',
      'audit.view',
      'automation.view',
      'automation.execute_action',
    ],
  },

  'Production Manager': {
    role: 'Production Manager',
    title: 'Factory & Production Manager',
    department: 'Manufacturing & Carpentry',
    category: 'Operations',
    description: 'Directs carpentry workshop operations, CNC machinery, stage progression, factory QC, and technical joinery recommendations.',
    capabilities: [
      'View approved production drawings and instructions',
      'Create and manage factory production orders and parts',
      'Manage CNC information, toolpaths, and nesting programs',
      'Update production stages (Cutting, CNC, Assembly, Finishing)',
      'Perform factory quality control (QC) inspections',
      'Propose changes to production methods and joinery details',
      'Add NW Production Recommendations and request approvals',
      'Report production problems and factory bottlenecks',
    ],
    restrictions: [
      'CANNOT silently modify an approved production drawing',
      'Technical changes requiring approval must follow formal approval workflow',
      'CANNOT change client contract values or view commercial margins',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-rose-50',
      text: 'text-rose-900',
      border: 'border-rose-400',
      accent: 'rose',
    },
    defaultPermissions: [
      'projects.view',
      'work_packages.view',
      'work_items.view',
      'work_items.qc',
      'work_items.delivery',
      'drawings.view',
      'drawings.markup',
      'drawings.analyze',
      'drawings.create_production',
      'knowledge.view',
      'issues.view',
      'issues.create',
      'issues.resolve',
      'production.view',
      'production.update',
      'production.create_orders',
      'production.cnc_manage',
      'production.propose_methods',
      'delivery.view',
      'delivery.schedule',
      'delivery.load',
      'purchasing.view',
      'approvals.view',
      'approvals.request',
      'ai.assistant',
      'automation.view',
      'automation.manage_tasks',
      'automation.execute_action',
    ],
  },

  'Production Staff': {
    role: 'Production Staff',
    title: 'Senior Joinery Craftsman / CNC Operator',
    department: 'Manufacturing & Carpentry',
    category: 'Operations',
    description: 'Focused shop-floor joiners and CNC operators accessing assigned fabrication instructions, specifications, and stage check-ins.',
    capabilities: [
      'View approved production instructions and relevant 2D/3D drawings',
      'View dimensions, materials, grain orientation, and edge-banding specs',
      'Update production stage for assigned work items (Cutting, Assembly, etc.)',
      'Scan QR codes / barcodes on part stickers',
      'Upload production progress photos from factory floor',
      'Report production defects and material problems',
    ],
    restrictions: [
      'CANNOT modify drawings or alter cut dimensions',
      'CANNOT approve production methods or sign off QC',
      'CANNOT see project financial information or client confidential info',
      'Restricted only to assigned production tasks',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-stone-50',
      text: 'text-stone-900',
      border: 'border-stone-400',
      accent: 'stone',
    },
    defaultPermissions: [
      'ai.assistant',
      'work_items.view',
      'drawings.view',
      'production.view',
      'production.update',
      'delivery.view',
      'delivery.load',
      'issues.create',
      'automation.view',
      'automation.execute_action',
    ],
  },

  'Contractor': {
    role: 'Contractor',
    title: 'External Trade Contractor',
    department: 'Trade Partner',
    category: 'External Stakeholder',
    description: 'Clean, simplified portal displaying only assigned work packages, approved drawings, delivery scheduling, and issue reporting.',
    capabilities: [
      'View only assigned work packages and work items',
      'View approved drawings and production instructions relevant to their work',
      'Update progress percentage and upload progress photos',
      'Mark work complete and submit for supervisor QC inspection',
      'Report problems, site clashes, and ask clarification questions',
      'Enter lorry delivery dates, times, and vehicle plates',
      'Update delivery status',
    ],
    restrictions: [
      'CANNOT see other contractors’ work packages or pricing',
      'CANNOT see internal project costs, supplier costs, or margins',
      'CANNOT see internal management discussions or escalated notes',
      'CANNOT modify approved drawings, dimensions, or variations',
      'CANNOT change contract values',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-orange-50',
      text: 'text-orange-900',
      border: 'border-orange-400',
      accent: 'orange',
    },
    defaultPermissions: [
      'ai.assistant',
      'work_packages.view',
      'work_items.view',
      'work_items.complete',
      'work_items.delivery',
      'delivery.view',
      'delivery.schedule',
      'installation.view',
      'installation.update',
      'drawings.view',
      'issues.view',
      'issues.create',
      'automation.view',
      'automation.execute_action',
    ],
  },

  'Client': {
    role: 'Client',
    title: 'Client Representative / Owner',
    department: 'Client Representative',
    category: 'External Stakeholder',
    description: 'Dedicated stakeholder portal with approved progress photos, milestones, delivery schedules, and client-facing variation approvals.',
    capabilities: [
      'View overall project status and milestone progress for their own projects',
      'View delivery schedules and approved handover dates',
      'View approved progress photos and quality certificates',
      'View approved documents and client drawings intentionally shared',
      'Review and formally Approve or Reject client-facing variations (VO)',
      'Submit client requests and questions through permitted channels',
    ],
    restrictions: [
      'CANNOT see internal costs, contractor rates, supplier pricing, or margins',
      'CANNOT see internal contractor discussions or internal non-shared issues',
      'CANNOT modify NW production drawings or shop instructions',
      'Strictly isolated to their own projects',
    ],
    canOverrideWorkflow: false,
    color: {
      bg: 'bg-purple-50',
      text: 'text-purple-900',
      border: 'border-purple-400',
      accent: 'purple',
    },
    defaultPermissions: [
      'projects.view',
      'work_items.view',
      'delivery.view',
      'drawings.view',
      'variations.view',
      'variations.client_approve',
      'issues.create',
    ],
  },
};

// ====================================================
// PERMISSION CHECK FUNCTIONS
// ====================================================

/**
 * Checks if a user has a specific granular permission.
 * Evaluates default role permissions plus any custom overrides.
 */
export function hasPermission(user: UserProfile | undefined, permission: PermissionKey): boolean {
  if (!user) return false;

  // Owner / CEO has absolute authority across every permission
  if (user.role === 'Owner / CEO') {
    return true;
  }

  // Check custom supplemental permissions on user object first
  if (user.custom_permissions && user.custom_permissions.includes(permission)) {
    return true;
  }

  // Check default role permissions
  const roleDef = ROLE_DEFINITIONS[user.role];
  if (!roleDef) return false;

  return roleDef.defaultPermissions.includes(permission);
}

/**
 * Checks if a user has ANY of the specified permissions.
 */
export function hasAnyPermission(user: UserProfile | undefined, permissions: PermissionKey[]): boolean {
  return permissions.some((perm) => hasPermission(user, perm));
}

/**
 * Checks if a user has ALL of the specified permissions.
 */
export function hasAllPermissions(user: UserProfile | undefined, permissions: PermissionKey[]): boolean {
  return permissions.every((perm) => hasPermission(user, perm));
}

// ====================================================
// PROJECT-LEVEL ACCESS VERIFICATION
// ====================================================

/**
 * Enforces project-level isolation.
 * - Owner and Admin have universal project visibility.
 * - PM and Site Supervisor are restricted to assigned projects.
 * - Contractor is restricted to projects containing their assigned work packages.
 * - Client is restricted strictly to their own client_id projects.
 * - Production Staff restricted to assigned projects.
 */
export function canAccessProject(
  user: UserProfile | undefined,
  project: Project,
  workPackages: WorkPackage[] = []
): boolean {
  if (!user || !project) return false;

  // 1. Owner & Admin have universal visibility
  if (user.role === 'Owner / CEO' || user.role === 'Admin') {
    return true;
  }

  // 2. Purchasing & Accountant have universal company project access for budgeting/procurement
  if (user.role === 'Purchasing' || user.role === 'Accountant') {
    return true;
  }

  // 3. Client can ONLY access projects matching their client_id
  if (user.role === 'Client') {
    return user.client_id === project.client_id || user.assigned_project_ids?.includes(project.id) || false;
  }

  // 4. Contractor can ONLY access projects where they have assigned work packages
  if (user.role === 'Contractor') {
    if (user.assigned_project_ids?.includes(project.id)) return true;
    if (user.contractor_id) {
      const hasAssignedPackage = workPackages.some(
        (wp) => wp.project_id === project.id && wp.contractor_id === user.contractor_id
      );
      if (hasAssignedPackage) return true;
    }
    return false;
  }

  // 5. Project Manager
  if (user.role === 'Project Manager') {
    if (project.project_manager_id === user.id) return true;
    if (user.assigned_project_ids && user.assigned_project_ids.includes(project.id)) return true;
    return false;
  }

  // 6. Site Supervisor
  if (user.role === 'Site Supervisor') {
    if (project.site_supervisor_id === user.id) return true;
    if (user.assigned_project_ids && user.assigned_project_ids.includes(project.id)) return true;
    return false;
  }

  // 7. Production Manager
  if (user.role === 'Production Manager') {
    // Production manager has visibility across fabrication projects
    if (!user.assigned_project_ids || user.assigned_project_ids.length === 0) return true;
    return user.assigned_project_ids.includes(project.id);
  }

  // 8. Production Staff
  if (user.role === 'Production Staff') {
    if (!user.assigned_project_ids || user.assigned_project_ids.length === 0) return true;
    return user.assigned_project_ids.includes(project.id);
  }

  return false;
}

/**
 * Checks if a user can access a specific Work Item based on project and trade assignment.
 */
export function canAccessWorkItem(
  user: UserProfile | undefined,
  item: WorkItem,
  project?: Project,
  workPackage?: WorkPackage
): boolean {
  if (!user || !item) return false;

  // Universal roles
  if (user.role === 'Owner / CEO' || user.role === 'Admin') return true;

  // Contractor: only items in their assigned package or with their contractor_id
  if (user.role === 'Contractor') {
    if (user.contractor_id && (item.contractor_id === user.contractor_id || workPackage?.contractor_id === user.contractor_id)) {
      return true;
    }
    return false;
  }

  // Client: can view item if it is in their project
  if (user.role === 'Client') {
    if (project && project.client_id !== user.client_id && !user.assigned_project_ids?.includes(item.project_id)) {
      return false;
    }
    return true;
  }

  // Check project access if project is passed
  if (project && !canAccessProject(user, project)) {
    return false;
  }

  // If user has specific assigned_project_ids
  if (user.assigned_project_ids && user.assigned_project_ids.length > 0) {
    return user.assigned_project_ids.includes(item.project_id);
  }

  return true;
}

// ====================================================
// DRAWING PERMISSION RULES (Section 12)
// ====================================================

/**
 * Upload Client Drawing: Allowed for Owner, Admin, PM where authorized
 */
export function canUploadClientDrawing(user: UserProfile | undefined): boolean {
  if (!user) return false;
  return user.role === 'Owner / CEO' || user.role === 'Admin' || user.role === 'Project Manager';
}

/**
 * Create Markup: Owner, Admin, PM, Production Manager, Site Supervisor
 */
export function canCreateDrawingMarkup(user: UserProfile | undefined): boolean {
  if (!user) return false;
  return ['Owner / CEO', 'Admin', 'Project Manager', 'Production Manager', 'Site Supervisor'].includes(user.role);
}

/**
 * AI Analyze Drawing: Owner, Admin, PM, Production Manager
 */
export function canAnalyzeDrawingWithAI(user: UserProfile | undefined): boolean {
  if (!user) return false;
  return ['Owner / CEO', 'Admin', 'Project Manager', 'Production Manager'].includes(user.role);
}

/**
 * Create NW Production Recommendation / Drawing: Owner, PM, Production Manager, Authorized technical staff
 */
export function canCreateProductionDrawing(user: UserProfile | undefined): boolean {
  if (!user) return false;
  return ['Owner / CEO', 'Project Manager', 'Production Manager'].includes(user.role);
}

/**
 * Approve NW Production Drawing:
 * - Allowed for Owner / CEO and Designated Authorized Managers
 * - Crucial Rule: The person creating a production drawing should NOT automatically
 *   be allowed to approve their own major technical change unless explicitly overridden by Owner.
 */
export function canApproveProductionDrawing(
  user: UserProfile | undefined,
  creatorUserId?: string
): { allowed: boolean; isOverride: boolean; reason?: string } {
  if (!user) return { allowed: false, isOverride: false, reason: 'Unauthenticated' };

  // Owner can always approve or override
  if (user.role === 'Owner / CEO') {
    if (creatorUserId && user.id === creatorUserId) {
      return {
        allowed: true,
        isOverride: true,
        reason: 'Owner / CEO Self-Approval Override (Recorded in Audit Log)',
      };
    }
    return { allowed: true, isOverride: false };
  }

  // Other roles: prevent approving own technical change
  if (creatorUserId && user.id === creatorUserId) {
    return {
      allowed: false,
      isOverride: false,
      reason: 'Company governance policy: Creators cannot self-approve major technical drawings. An independent manager or Owner must approve.',
    };
  }

  // Production Manager or PM can approve if authorized
  if (user.role === 'Production Manager' || user.role === 'Project Manager') {
    return { allowed: true, isOverride: false };
  }

  return { allowed: false, isOverride: false, reason: 'Insufficient privileges to approve production drawings' };
}

// ====================================================
// GENERAL APPROVAL FRAMEWORK VALIDATION (Section 15)
// ====================================================

/**
 * Evaluates whether a user is authorized to approve, reject, or request changes
 * on a given ApprovalItem. Enforces:
 * - Anti-Self-Approval
 * - Role designation matching
 * - Owner override with audit justification
 */
export function canEvaluateApproval(
  user: UserProfile | undefined,
  approval: ApprovalItem
): {
  canApprove: boolean;
  canReject: boolean;
  canRequestChanges: boolean;
  isOverride: boolean;
  warning?: string;
  blockedReason?: string;
} {
  if (!user) {
    return {
      canApprove: false,
      canReject: false,
      canRequestChanges: false,
      isOverride: false,
      blockedReason: 'Authentication required',
    };
  }

  // 1. Owner / CEO has supreme approval & override authority
  if (user.role === 'Owner / CEO') {
    const isSelf = user.id === approval.requested_by_id;
    return {
      canApprove: true,
      canReject: true,
      canRequestChanges: true,
      isOverride: isSelf,
      warning: isSelf
        ? 'Owner Self-Approval: Bypassing standard independent review. This action will be marked as an Owner Override in the audit log.'
        : undefined,
    };
  }

  // 2. Client-facing variations: Client can approve client variations for their project
  if (approval.approval_type === 'Variation' || approval.approval_type === 'Client Scope Change') {
    if (user.role === 'Client') {
      return {
        canApprove: true,
        canReject: true,
        canRequestChanges: true,
        isOverride: false,
      };
    }
  }

  // 3. Prevent self-approval for non-Owner roles
  if (user.id === approval.requested_by_id) {
    return {
      canApprove: false,
      canReject: false,
      canRequestChanges: false,
      isOverride: false,
      blockedReason: `Conflict of Interest: You created this request (${approval.requested_by_name}). Company policy requires independent approval.`,
    };
  }

  // 4. Role-based matching
  const targetRole = approval.assigned_approver_role;
  const isDirectAssignee = approval.assigned_approver_id === user.id;

  if (isDirectAssignee) {
    return { canApprove: true, canReject: true, canRequestChanges: true, isOverride: false };
  }

  // Check role match
  if (targetRole === user.role || targetRole === 'Designated Authorized Manager') {
    return { canApprove: true, canReject: true, canRequestChanges: true, isOverride: false };
  }

  // Accountant for financial items
  if (user.role === 'Accountant' && (approval.approval_type === 'Major Cost' || approval.approval_type === 'Major Purchase')) {
    return { canApprove: true, canReject: true, canRequestChanges: true, isOverride: false };
  }

  // Production Manager for technical/production items
  if (
    user.role === 'Production Manager' &&
    (approval.approval_type === 'Technical Change' || approval.approval_type === 'NW Production Drawing Approval')
  ) {
    return { canApprove: true, canReject: true, canRequestChanges: true, isOverride: false };
  }

  return {
    canApprove: false,
    canReject: false,
    canRequestChanges: false,
    isOverride: false,
    blockedReason: `Only ${approval.assigned_approver_role} or Owner / CEO may approve this item.`,
  };
}

// ====================================================
// FINANCIAL PRIVACY GUARDS
// ====================================================

/**
 * Checks whether user can see internal company profit margins,
 * supplier buy-rates, and internal cost breakdowns.
 * Strictly restricted to Owner and Accountant.
 */
export function canViewFinancialMargins(user: UserProfile | undefined): boolean {
  if (!user) return false;
  return user.role === 'Owner / CEO' || user.role === 'Accountant';
}

/**
 * Checks whether user can view contract values and project budgets.
 */
export function canViewProjectFinancials(user: UserProfile | undefined): boolean {
  if (!user) return false;
  return ['Owner / CEO', 'Admin', 'Accountant', 'Project Manager', 'Purchasing'].includes(user.role);
}
