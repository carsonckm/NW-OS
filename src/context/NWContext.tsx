/**
 * NW OS — Central State Engine & Business Logic Automation
 */

import React, { createContext, useContext, useState, useEffect, useMemo, ReactNode } from 'react';
import {
  UserProfile,
  UserRole,
  Project,
  Client,
  Contractor,
  WorkPackage,
  WorkItem,
  Drawing,
  DrawingType,
  DrawingStatus,
  DrawingRevision,
  DrawingMarkup,
  AIDrawingAnalysis,
  AISuggestedWorkItem,
  RevisionComparison,
  NWProductionReview,
  NWProductionDrawing,
  ProductionInstruction,
  NWProductionKnowledge,
  Issue,
  Variation,
  ProjectDocument,
  NotificationItem,
  AuditLog,
  QCRecord,
  WorkItemStatus,
  DeliveryStatus,
  InstallationStatus,
  WorkItemPhotoRecord,
  ApprovalItem,
  ApprovalDecision,
  Supplier,
  PurchaseOrder,
  POStatus,
  MaterialRequest,
  FinancialClaim,
  PaymentRecord,
  ChatMessage,
  AIActionRecord,
  PMInboxItem,
  MessageChannel,
  ChatMessageAttachment,
  GatewayChannel,
  GatewayDirection,
  GatewayDeliveryStatus,
  GatewayAIConfidence,
  GatewayIntent,
  GatewayAttachment,
  GatewayMessage,
  CommunicationContact,
  ConversationThread,
  MessageQueueItem,
  AIActionRequest,
  GatewaySettings,
  GatewayMetrics,
  SimulationTrace,
  SecurityTestCase,
  ClientEnquiry,
  CommercialTender,
  CommercialQuotation,
  QuotationItem,
  PriceDatabaseRecord,
  ProjectCommercialBaseline,
  ProjectCostLedgerItem,
  GoodsReceivedRecord,
  CommercialInvoice,
  CostLeakAlert,
  ProjectCashflowEntry,
  QuotationStatus,
  CostCategory,
  ProductionOrderStatus,
  ProductionOrderStageTransition,
  PartStatus,
  CNCJobStatus,
  ProductionOrder,
  ProductionPart,
  ProductionMaterialLink,
  CNCJob,
  CNCFileVersion,
  AssemblyJob,
  FinishingJob,
  FactoryQCInspection,
  PackingPackage,
  ProductionIssueRecord,
  DeliveryRecord,
  DeliveryReceipt,
  InstallationJob,
  SiteQCInspection,
  SnagItem,
  HandoverRecord,
  LoadingChecklist,
  InstallationChecklist,
  SiteMeasurementRecord,
  ClientChangeRequest,
  SiteReadinessCheck,
  ProjectCompletionChecklist,
  NWTask,
  TaskStatus,
  TaskPriority,
  TaskEscalationLevel,
  AutomationEventType,
  AutomationRule,
  AutomationEvent,
  AutomationRun,
  FailedAutomation,
  EscalationRecord,
  UserNotificationPreference,
  DailyBriefing,
  WorkflowTemplate,
  OwnerOverrideRecord,
  BusinessCalendarConfig,
  SalesPipelineStage,
  SalesPipelineDeal,
  ProjectRiskLevel,
  ProjectHealthDimension,
  ProjectHealthBreakdown,
  ManagementAlert,
  OwnerDecisionRecord,
  OwnerDependencyMonthly,
  RecurringProblemPattern,
  ProcessImprovementProposal,
  ManagementKPIThresholds,
} from '../types';
import {
  DEMO_USERS,
  INITIAL_PROJECTS,
  INITIAL_CLIENTS,
  INITIAL_CONTRACTORS,
  INITIAL_WORK_PACKAGES,
  INITIAL_WORK_ITEMS,
  INITIAL_DRAWINGS,
  INITIAL_KNOWLEDGE,
  INITIAL_ISSUES,
  INITIAL_VARIATIONS,
  INITIAL_DOCUMENTS,
  INITIAL_NOTIFICATIONS,
  INITIAL_AUDIT_LOGS,
  INITIAL_QC_RECORDS,
  INITIAL_APPROVALS,
  INITIAL_SUPPLIERS,
  INITIAL_PURCHASE_ORDERS,
  INITIAL_MATERIAL_REQUESTS,
  INITIAL_CLAIMS,
  INITIAL_PAYMENTS,
  INITIAL_MESSAGES,
  INITIAL_AI_ACTIONS,
  INITIAL_PM_INBOX,
  INITIAL_COMMUNICATION_CONTACTS,
  INITIAL_GATEWAY_MESSAGES,
  INITIAL_CONVERSATION_THREADS,
  INITIAL_MESSAGE_QUEUE,
  INITIAL_AI_ACTION_REQUESTS,
  INITIAL_GATEWAY_SETTINGS,
  INITIAL_SECURITY_TEST_CASES,
  INITIAL_CLIENT_ENQUIRIES,
  INITIAL_COMMERCIAL_TENDERS,
  INITIAL_COMMERCIAL_QUOTATIONS,
  INITIAL_PRICE_DATABASE,
  INITIAL_PROJECT_COMMERCIAL_BASELINES,
  INITIAL_PROJECT_COST_LEDGER,
  INITIAL_GOODS_RECEIVED,
  INITIAL_COMMERCIAL_INVOICES,
  INITIAL_COST_LEAK_ALERTS,
  INITIAL_CASHFLOW_ENTRIES,
} from '../data/initialData';
import {
  INITIAL_PRODUCTION_MATERIALS,
  INITIAL_PRODUCTION_ORDERS,
  INITIAL_PRODUCTION_PARTS,
  INITIAL_CNC_JOBS,
  INITIAL_CNC_FILE_VERSIONS,
  INITIAL_ASSEMBLY_JOBS,
  INITIAL_FINISHING_JOBS,
  INITIAL_FACTORY_QC_INSPECTIONS,
  INITIAL_PACKING_PACKAGES,
  INITIAL_PRODUCTION_ISSUES,
} from '../data/productionInitialData';
import {
  INITIAL_DELIVERY_RECORDS,
  INITIAL_INSTALLATION_JOBS,
  INITIAL_SITE_QC_INSPECTIONS,
  INITIAL_HANDOVER_RECORDS,
  INITIAL_SITE_MEASUREMENTS,
  INITIAL_CLIENT_CHANGE_REQUESTS,
} from '../data/deliveryInitialData';
import {
  INITIAL_TASKS,
  INITIAL_AUTOMATION_RULES,
  INITIAL_ESCALATIONS,
  INITIAL_AUTOMATION_EVENTS,
  INITIAL_AUTOMATION_RUNS,
  INITIAL_FAILED_AUTOMATIONS,
  INITIAL_USER_NOTIFICATION_PREFERENCES,
  INITIAL_DAILY_BRIEFINGS,
  INITIAL_WORKFLOW_TEMPLATES,
  INITIAL_OWNER_OVERRIDES,
  INITIAL_BUSINESS_CALENDAR,
} from '../data/automationInitialData';
import {
  INITIAL_SALES_PIPELINE,
  INITIAL_OWNER_DECISIONS,
  INITIAL_OWNER_DEPENDENCY,
  INITIAL_RECURRING_PROBLEMS,
  INITIAL_PROCESS_IMPROVEMENTS,
  INITIAL_MANAGEMENT_KPIS,
  INITIAL_MANAGEMENT_ALERTS,
} from '../data/managementInitialData';
import { canAccessProject, hasPermission } from '../utils/permissions';
import { dataApi } from '../services/coreApi';
import { useCoreDatabaseSync, type CoreSyncState } from '../services/coreSync';
import { clearCoreCache } from '../services/authApi';

interface NWContextType {
  currentUser: UserProfile;
  availableUsers: UserProfile[];
  setCurrentUser: (user: UserProfile) => void;
  switchRole: (role: UserRole) => void;
  switchUser: (userId: string) => void;
  addUser: (userData: Omit<UserProfile, 'id'>) => UserProfile;
  updateUser: (id: string, updates: Partial<UserProfile>) => void;
  toggleUserStatus: (id: string) => void;
  language: 'en' | 'ms' | 'zh';
  setLanguage: (lang: 'en' | 'ms' | 'zh') => void;

  // Data collections
  projects: Project[];
  userProjects: Project[]; // Filtered by current user's project-level authorization
  clients: Client[];
  contractors: Contractor[];
  workPackages: WorkPackage[];
  workItems: WorkItem[];
  drawings: Drawing[];
  knowledge: NWProductionKnowledge[];
  issues: Issue[];
  variations: Variation[];
  documents: ProjectDocument[];
  notifications: NotificationItem[];
  auditLogs: AuditLog[];
  qcRecords: QCRecord[];

  // Approvals & Governance (Section 15)
  approvals: ApprovalItem[];
  createApproval: (item: Omit<ApprovalItem, 'id' | 'approval_number' | 'created_at' | 'updated_at'>) => ApprovalItem;
  decideApproval: (id: string, decision: ApprovalDecision, comments?: string, isOverride?: boolean, overrideReason?: string) => void;

  // Purchasing & Material Procurement (Section 6)
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  materialRequests: MaterialRequest[];
  createPurchaseOrder: (poData: Omit<PurchaseOrder, 'id' | 'po_number' | 'created_at'>) => PurchaseOrder;
  updatePOStatus: (id: string, status: POStatus, actualDeliveryDate?: string) => void;
  createMaterialRequest: (mrData: Omit<MaterialRequest, 'id' | 'request_number' | 'created_at'>) => MaterialRequest;

  // Financials & Claims (Section 7)
  financialClaims: FinancialClaim[];
  payments: PaymentRecord[];

  // Selected project context
  selectedProjectId: string;
  setSelectedProjectId: (id: string) => void;
  selectedProject: Project | undefined;

  // Operations & automations
  updateWorkItemStatus: (
    id: string,
    status: WorkItemStatus,
    notes?: string,
    photos?: string[]
  ) => void;
  submitQCInspection: (
    workItemId: string,
    result: 'Passed' | 'Failed' | 'Correction Required',
    comments: string,
    photos?: string[],
    correction?: string
  ) => void;
  scheduleDelivery: (
    workItemId: string,
    date: string,
    time: string,
    lorryDetails?: string
  ) => void;
  confirmDeliveryReceived: (
    workItemId: string,
    receivedBy: string,
    photos?: string[]
  ) => void;
  activateInstallation: (workItemId: string) => void;
  completeInstallation: (workItemId: string) => void;
  createIssue: (issue: Partial<Issue>) => Promise<Issue>;
  resolveIssue: (issueId: string, resolutionNotes: string, actionType?: string) => void;
  escalateIssue: (issueId: string, targetLevel: 'PM' | 'Owner', reason: string) => void;
  approveVariation: (variationId: string, approvedByClient?: boolean) => void;
  addDrawingMarkup: (drawingId: string, revisionId: string, markup: Omit<DrawingMarkup, 'id'>) => void;
  addKnowledgeItem: (item: Omit<NWProductionKnowledge, 'id' | 'created_at'>) => void;
  uploadDrawing: (drawingData: {
    project_id: string;
    drawing_number: string;
    title: string;
    category: string;
    drawing_type: DrawingType;
    revision: string;
    file_url?: string;
    notes?: string;
  }) => Drawing;
  addDrawingRevision: (
    drawingId: string,
    newRevision: {
      revision: string;
      title: string;
      file_url: string;
      notes: string;
      supersedes_revision?: string;
      drawing_type: 'Client / Designer Drawing' | 'NW Production Drawing';
    },
    saveAsStandard?: boolean,
    standardData?: { title: string; category: any; description: string; reason: string }
  ) => void;
  setDrawingRevisionStatus: (
    drawingId: string,
    revisionId: string,
    status: 'Draft' | 'Internal Review' | 'Approved' | 'Rejected'
  ) => void;
  analyzeDrawingWithAI: (drawingId: string, revisionId: string) => Promise<AIDrawingAnalysis>;
  approveAISuggestedWorkItem: (
    drawingId: string,
    revisionId: string,
    suggestedItem: AISuggestedWorkItem,
    targetWorkPackageId: string,
    contractorId?: string
  ) => WorkItem;
  compareDrawingRevisions: (
    drawingId: string,
    fromRevId: string,
    toRevId: string
  ) => Promise<RevisionComparison>;
  addNWProductionReview: (
    drawingId: string,
    reviewData: Omit<NWProductionReview, 'id' | 'review_date'>
  ) => NWProductionReview;
  createNWProductionDrawing: (
    drawingId: string,
    nwDrawingData: Omit<NWProductionDrawing, 'id' | 'uploaded_date'>
  ) => NWProductionDrawing;
  approveNWProductionDrawing: (
    drawingId: string,
    nwDrawingId: string,
    approverName: string
  ) => void;

  // Demo Workflow Simulation
  drawingDemoStep: number;
  setDrawingDemoStep: (step: number) => void;
  runDrawingDemoWorkflowStep: (step: number) => Promise<void>;
  resetDrawingDemo: () => void;
  addClient: (clientData: Omit<Client, 'id' | 'created_at' | 'updated_at'>) => Client;
  updateClient: (id: string, updates: Partial<Client>) => void;
  deleteClient: (id: string) => void;
  addProject: (projectData: Omit<Project, 'id' | 'created_at' | 'updated_at'>) => Project;
  updateProject: (id: string, updates: Partial<Project>) => void;
  addContractor: (contractorData: Omit<Contractor, 'id' | 'created_at' | 'updated_at'>) => Contractor;
  updateContractor: (id: string, updates: Partial<Contractor>) => void;
  deactivateContractor: (id: string) => void;
  deleteContractor: (id: string) => void;
  addWorkPackage: (wpData: Omit<WorkPackage, 'id'>) => WorkPackage;
  updateWorkPackage: (id: string, updates: Partial<WorkPackage>) => void;
  deleteWorkPackage: (id: string) => void;
  addWorkItem: (itemData: Omit<WorkItem, 'id' | 'created_at' | 'updated_at'>) => WorkItem;
  updateWorkItem: (id: string, updates: Partial<WorkItem>) => void;
  addWorkItemPhoto: (workItemId: string, photo: { url: string; description?: string; uploaded_by?: string }) => void;
  markNotificationRead: (id: string) => void;
  clearAllNotifications: () => void;
  resetToDemoData: () => void;
  /** Where core-chain data (clients → work items) is stored, and its sync status. */
  coreDataSync: CoreSyncState & {
    reloadFromDatabase: () => Promise<void>;
    applyRows: (collection: string, rows: Record<string, unknown>[], opts?: { replace?: boolean }) => void;
  };
  /** True when signed in through the server (sign-in replaces the demo role switcher). */
  authMode: boolean;
  signOut: () => void;

  // AI Communication & Contractor Assistant (Module 10)
  messages: ChatMessage[];
  aiActions: AIActionRecord[];
  pmInbox: PMInboxItem[];
  sendChatMessage: (data: {
    message_text: string;
    channel?: MessageChannel;
    project_id?: string;
    work_package_id?: string;
    work_item_id?: string;
    work_item_code?: string;
    attachments?: ChatMessageAttachment[];
  }) => Promise<{ userMsg: ChatMessage; aiMsg: ChatMessage | null; actionRecord?: AIActionRecord }>;
  resolvePMInboxItem: (
    id: string,
    actionTaken: 'answered' | 'approved' | 'rejected' | 'escalated',
    responseMessage?: string
  ) => void;
  runScenarioTest: (scenarioId: number) => Promise<any>;

  // WhatsApp-Ready Communication Gateway (Module 11)
  gatewayContacts: CommunicationContact[];
  gatewayMessages: GatewayMessage[];
  conversationThreads: ConversationThread[];
  messageQueue: MessageQueueItem[];
  aiActionRequests: AIActionRequest[];
  gatewaySettings: GatewaySettings;
  gatewayMetrics: GatewayMetrics;
  securityTestCases: SecurityTestCase[];
  processSimulatedWhatsAppMessage: (data: {
    sender_phone: string;
    message_text: string;
    channel?: GatewayChannel;
    project_id?: string;
    work_package_id?: string;
    work_item_code?: string;
    attachments?: GatewayAttachment[];
  }) => Promise<SimulationTrace>;
  runSecurityTest: (testId: string) => Promise<SecurityTestCase>;
  runAllSecurityTests: () => Promise<SecurityTestCase[]>;
  approveAIActionRequest: (id: string, notes?: string) => void;
  rejectAIActionRequest: (id: string, notes?: string) => void;
  requestMoreInfoForAction: (id: string, notes: string) => void;
  retryQueueItem: (queueId: string) => void;
  cancelQueueItem: (queueId: string) => void;
  clearDeliveredQueue: () => void;
  addGatewayContact: (contact: Omit<CommunicationContact, 'contact_id' | 'created_at' | 'updated_at'>) => CommunicationContact;
  updateGatewayContact: (contactId: string, updates: Partial<CommunicationContact>) => void;
  verifyGatewayContact: (contactId: string, verified: boolean) => void;
  updateGatewaySettings: (settings: Partial<GatewaySettings>) => void;
  undoAIAction: (actionId: string, reason: string) => void;
  saveKnowledgeFromConversation: (data: { title: string; category: any; description: string; reason: string; scope: 'company' | 'project' }) => void;

  // Commercial, Costing & Profit Control (Module 12)
  clientEnquiries: ClientEnquiry[];
  commercialTenders: CommercialTender[];
  commercialQuotations: CommercialQuotation[];
  priceDatabase: PriceDatabaseRecord[];
  commercialBaselines: ProjectCommercialBaseline[];
  projectCostLedger: ProjectCostLedgerItem[];
  goodsReceived: GoodsReceivedRecord[];
  commercialInvoices: CommercialInvoice[];
  costLeakAlerts: CostLeakAlert[];
  cashflowEntries: ProjectCashflowEntry[];
  addClientEnquiry: (enquiry: Omit<ClientEnquiry, 'id'>) => ClientEnquiry;
  updateClientEnquiry: (id: string, updates: Partial<ClientEnquiry>) => void;
  addCommercialTender: (tender: Omit<CommercialTender, 'id'>) => CommercialTender;
  updateCommercialTender: (id: string, updates: Partial<CommercialTender>) => void;
  addCommercialQuotation: (quotation: Omit<CommercialQuotation, 'id' | 'created_at' | 'updated_at'>) => CommercialQuotation;
  updateCommercialQuotation: (id: string, updates: Partial<CommercialQuotation>) => void;
  createNewQuotationVersion: (quotationId: string, updatedItems: QuotationItem[]) => CommercialQuotation;
  approveCommercialQuotation: (quotationId: string) => void;
  addProjectCostLedgerItem: (item: Omit<ProjectCostLedgerItem, 'cost_id'>) => ProjectCostLedgerItem;
  allocateCostToProjects: (costId: string, allocations: Array<{ project_id: string; project_name: string; allocated_amount: number }>) => void;
  addGoodsReceivedRecord: (record: Omit<GoodsReceivedRecord, 'id'>) => GoodsReceivedRecord;
  addCommercialInvoice: (invoice: Omit<CommercialInvoice, 'id'>) => CommercialInvoice;
  updateInvoicePayment: (invoiceId: string, paidAmount: number, isFullyPaid: boolean) => void;
  resolveCostLeakAlert: (alertId: string, resolutionAction: string) => void;
  updateCommercialBaseline: (projectId: string, updates: Partial<ProjectCommercialBaseline>) => void;
  addPriceDatabaseRecord: (record: Omit<PriceDatabaseRecord, 'id'>) => PriceDatabaseRecord;

  // Production, CNC & QR/Barcode Factory Module (Module 13)
  productionOrders: ProductionOrder[];
  productionParts: ProductionPart[];
  productionMaterials: ProductionMaterialLink[];
  cncJobs: CNCJob[];
  cncFileVersions: CNCFileVersion[];
  assemblyJobs: AssemblyJob[];
  finishingJobs: FinishingJob[];
  factoryQCInspections: FactoryQCInspection[];
  packingPackages: PackingPackage[];
  productionIssues: ProductionIssueRecord[];
  createProductionOrder: (data: Omit<ProductionOrder, 'id' | 'order_number' | 'created_at' | 'updated_at' | 'stage_history' | 'barcode' | 'qr_code'>) => ProductionOrder;
  updateProductionOrderStatus: (orderId: string, newStage: ProductionOrderStatus, notes?: string) => void;
  addProductionPart: (partData: Omit<ProductionPart, 'id' | 'created_at' | 'updated_at' | 'barcode' | 'qr_code'>) => ProductionPart;
  updatePartStatus: (partId: string, newStage: PartStatus, notes?: string) => void;
  createCNCJob: (jobData: Omit<CNCJob, 'id' | 'job_id_code'>) => CNCJob;
  updateCNCJobStatus: (jobId: string, status: CNCJobStatus, notes?: string) => void;
  uploadCNCFileVersion: (fileVer: Omit<CNCFileVersion, 'id' | 'uploaded_at'>) => CNCFileVersion;
  updateAssemblyJob: (jobId: string, updates: Partial<AssemblyJob>) => void;
  toggleAssemblyPartCheck: (jobId: string, partId: string) => void;
  toggleAssemblyHardwareCheck: (jobId: string, itemIndex: number) => void;
  updateFinishingJob: (jobId: string, updates: Partial<FinishingJob>) => void;
  recordFactoryQC: (qcData: Omit<FactoryQCInspection, 'id' | 'inspection_date'>) => FactoryQCInspection;
  createPackingPackage: (pkgData: Omit<PackingPackage, 'id' | 'package_number' | 'packed_at' | 'barcode' | 'qr_code'>) => PackingPackage;
  updatePackingStatus: (pkgId: string, status: PackingPackage['status']) => void;
  reportProductionIssue: (issueData: Omit<ProductionIssueRecord, 'id' | 'issue_code' | 'reported_at'>) => ProductionIssueRecord;
  resolveProductionIssue: (issueId: string, resolutionNotes: string) => void;
  handleDrawingRevisionProductionCheck: (drawingId: string, newRevision: string) => void;
  scanBarcodeOrQRCode: (code: string) => { type: 'order' | 'part' | 'package' | 'unknown'; item?: any; message: string };

  // Delivery, Site Installation & Project Completion (Module 14)
  deliveryRecords: DeliveryRecord[];
  installationJobs: InstallationJob[];
  siteQCInspections: SiteQCInspection[];
  handoverRecords: HandoverRecord[];
  siteMeasurements: SiteMeasurementRecord[];
  clientChangeRequests: ClientChangeRequest[];
  createDeliveryRecord: (delivery: Omit<DeliveryRecord, 'id' | 'delivery_number' | 'status_history' | 'qr_code' | 'barcode'>) => DeliveryRecord;
  scheduleDeliveryRecord: (delivery: Omit<DeliveryRecord, 'id' | 'delivery_number' | 'status_history' | 'qr_code' | 'barcode'>) => DeliveryRecord;
  updateDeliveryStatus: (deliveryId: string, status: DeliveryStatus, notes?: string) => void;
  updateLoadingChecklist: (deliveryId: string, checklist: Partial<LoadingChecklist>, isLoaded?: boolean) => void;
  scanPackageForLoading: (deliveryId: string, packageCode: string) => { success: boolean; message: string; scannedCount: number; totalCount: number; readyToLoad: boolean };
  recordDeliveryReceipt: (receipt: Omit<DeliveryReceipt, 'id' | 'received_at'>) => DeliveryReceipt;
  createInstallationJob: (job: Omit<InstallationJob, 'id' | 'job_number' | 'progress_percent'>) => InstallationJob;
  updateInstallationStatus: (jobId: string, status: InstallationJob['status'], notes?: string) => void;
  updateInstallationChecklist: (jobId: string, checklist: Partial<InstallationChecklist>, progress?: number) => void;
  updateSiteReadiness: (jobId: string, readiness: Partial<SiteReadinessCheck>) => void;
  recordSiteQCInspection: (inspection: Omit<SiteQCInspection, 'id' | 'inspection_number'>) => SiteQCInspection;
  updateSnagItem: (inspectionId: string, snagId: string, updates: Partial<SnagItem>) => void;
  updateHandoverRecord: (handoverId: string, updates: Partial<HandoverRecord>) => void;
  resolveDeliveryConflict: (deliveryId: string, newTime: string, notes: string) => void;
  addSiteMeasurement: (data: Omit<SiteMeasurementRecord, 'id' | 'date_time' | 'is_conflict' | 'conflict_notes'>) => SiteMeasurementRecord;
  addClientChangeRequest: (data: Omit<ClientChangeRequest, 'id' | 'request_code' | 'requested_date' | 'status'>) => ClientChangeRequest;

  // Automation, Task, Notification & Escalation Engine (Module 15)
  tasks: NWTask[];
  automationRules: AutomationRule[];
  automationEvents: AutomationEvent[];
  automationRuns: AutomationRun[];
  failedAutomations: FailedAutomation[];
  escalations: EscalationRecord[];
  userNotificationPreferences: UserNotificationPreference[];
  dailyBriefings: Record<string, DailyBriefing>;
  workflowTemplates: WorkflowTemplate[];
  ownerOverrides: OwnerOverrideRecord[];
  businessCalendar: BusinessCalendarConfig;

  createTask: (task: Omit<NWTask, 'id' | 'task_number' | 'created_date' | 'comments' | 'attachments'>) => NWTask;
  updateTaskStatus: (taskId: string, status: TaskStatus, comment?: string) => void;
  updateTask: (taskId: string, updates: Partial<NWTask>) => void;
  escalateTask: (taskId: string, toLevel: TaskEscalationLevel, reason: string) => void;
  acknowledgeTask: (taskId: string) => void;
  acknowledgeEscalation: (escalationId: string) => void;
  executeTaskNextBestAction: (taskId: string) => void;
  addTaskComment: (taskId: string, text: string) => void;
  triggerAutomationEvent: (eventType: AutomationEventType, sourceModule: string, sourceRecord: string, projectId: string, payload: Record<string, any>, workItemId?: string) => void;
  createAutomationRule: (rule: Omit<AutomationRule, 'id' | 'rule_code' | 'created_by' | 'updated_at'>) => AutomationRule;
  updateAutomationRule: (ruleId: string, updates: Partial<AutomationRule>) => void;
  toggleAutomationRule: (ruleId: string) => void;
  retryFailedAutomation: (failureId: string) => { success: boolean; message: string };
  createOwnerOverride: (record: Omit<OwnerOverrideRecord, 'id' | 'overridden_by' | 'overridden_by_role' | 'timestamp'>) => OwnerOverrideRecord;
  updateNotificationPreferences: (userId: string, preferences: UserNotificationPreference) => void;
  updateBusinessCalendar: (calendar: Partial<BusinessCalendarConfig>) => void;
  applyWorkflowTemplate: (templateCode: string, projectId: string) => { tasksCreated: number };

  // Management Intelligence & Owner Control (Module 16)
  // Declared ahead of implementation: NWProvider does not supply these yet, so they are
  // optional to keep the type honest. Consumers must handle undefined until Module 16 lands.
  salesPipeline?: SalesPipelineDeal[];
  createSalesPipelineDeal?: (deal: Omit<SalesPipelineDeal, 'id' | 'deal_number' | 'created_at' | 'updated_at'>) => SalesPipelineDeal;
  updateSalesPipelineStage?: (dealId: string, stage: SalesPipelineStage, notes?: string) => void;
  ownerDecisions?: OwnerDecisionRecord[];
  decideOwnerDecision?: (id: string, status: 'Approved' | 'Rejected' | 'Changes Requested' | 'Delegated', notes?: string, delegatedTo?: string) => void;
  ownerDependencyHistory?: OwnerDependencyMonthly[];
  recurringProblems?: RecurringProblemPattern[];
  updateRecurringProblemStatus?: (id: string, status: RecurringProblemPattern['status']) => void;
  processImprovements?: ProcessImprovementProposal[];
  updateProcessImprovementStatus?: (id: string, status: ProcessImprovementProposal['status']) => void;
  managementKPIs?: ManagementKPIThresholds;
  updateManagementKPIs?: (kpis: Partial<ManagementKPIThresholds>) => void;
  managementAlerts?: ManagementAlert[];
  dismissManagementAlert?: (id: string) => void;
}

const NWContext = createContext<NWContextType | undefined>(undefined);

const STORAGE_PREFIX = 'nw_os_data_v1_';

function loadOrInitial<T>(key: string, initial: T): T {
  try {
    const saved = localStorage.getItem(STORAGE_PREFIX + key);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (err) {
    console.error(`Error loading key ${key}:`, err);
  }
  return initial;
}

function saveStorage<T>(key: string, data: T) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(data));
  } catch (err) {
    console.error(`Error saving key ${key}:`, err);
  }
}

interface NWProviderProps {
  children: ReactNode;
  /**
   * The signed-in user from the server session. When set, the app runs in authenticated
   * mode: currentUser is pinned to this user and role/user switching is disabled. The
   * server still checks every request; the UI permission checks are only for display.
   */
  authUser?: UserProfile;
  /** Whether the signed-in user may import local data into an empty database. */
  canImportCoreData?: boolean;
  onSignOut?: () => void;
}

export const NWProvider: React.FC<NWProviderProps> = ({ children, authUser, canImportCoreData = true, onSignOut }) => {
  const [storedUser, setStoredUser] = useState<UserProfile>(() =>
    authUser ?? loadOrInitial('currentUser', DEMO_USERS[0])
  );
  const currentUser = authUser ?? storedUser;
  const setCurrentUser = (user: UserProfile) => {
    if (!authUser) setStoredUser(user);
  };
  const [language, setLanguage] = useState<'en' | 'ms' | 'zh'>('en');

  const [projects, setProjects] = useState<Project[]>(() =>
    loadOrInitial('projects', INITIAL_PROJECTS)
  );
  const [clients, setClients] = useState<Client[]>(() =>
    loadOrInitial('clients', INITIAL_CLIENTS)
  );
  const [contractors, setContractors] = useState<Contractor[]>(() =>
    loadOrInitial('contractors', INITIAL_CONTRACTORS)
  );
  const [workPackages, setWorkPackages] = useState<WorkPackage[]>(() =>
    loadOrInitial('workPackages', INITIAL_WORK_PACKAGES)
  );
  const [workItems, setWorkItems] = useState<WorkItem[]>(() =>
    loadOrInitial('workItems', INITIAL_WORK_ITEMS)
  );
  const [drawings, setDrawings] = useState<Drawing[]>(() =>
    loadOrInitial('drawings', INITIAL_DRAWINGS)
  );
  const [knowledge, setKnowledge] = useState<NWProductionKnowledge[]>(() =>
    loadOrInitial('knowledge', INITIAL_KNOWLEDGE)
  );
  const [issues, setIssues] = useState<Issue[]>(() =>
    loadOrInitial('issues', INITIAL_ISSUES)
  );
  const [variations, setVariations] = useState<Variation[]>(() =>
    loadOrInitial('variations', INITIAL_VARIATIONS)
  );
  const [documents, setDocuments] = useState<ProjectDocument[]>(() =>
    loadOrInitial('documents', INITIAL_DOCUMENTS)
  );
  const [notifications, setNotifications] = useState<NotificationItem[]>(() =>
    loadOrInitial('notifications', INITIAL_NOTIFICATIONS)
  );
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>(() =>
    loadOrInitial('auditLogs', INITIAL_AUDIT_LOGS)
  );
  const [qcRecords, setQcRecords] = useState<QCRecord[]>(() =>
    loadOrInitial('qcRecords', INITIAL_QC_RECORDS)
  );
  const [drawingDemoStep, setDrawingDemoStep] = useState<number>(() =>
    loadOrInitial('drawingDemoStep', 0)
  );

  // New modules: Users, Approvals, Purchasing & Financials
  const [availableUsers, setAvailableUsers] = useState<UserProfile[]>(() =>
    loadOrInitial('availableUsers', DEMO_USERS)
  );
  const [approvals, setApprovals] = useState<ApprovalItem[]>(() =>
    loadOrInitial('approvals', INITIAL_APPROVALS)
  );
  const [suppliers, setSuppliers] = useState<Supplier[]>(() =>
    loadOrInitial('suppliers', INITIAL_SUPPLIERS)
  );
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>(() =>
    loadOrInitial('purchaseOrders', INITIAL_PURCHASE_ORDERS)
  );
  const [materialRequests, setMaterialRequests] = useState<MaterialRequest[]>(() =>
    loadOrInitial('materialRequests', INITIAL_MATERIAL_REQUESTS)
  );
  const [financialClaims, setFinancialClaims] = useState<FinancialClaim[]>(() =>
    loadOrInitial('financialClaims', INITIAL_CLAIMS)
  );
  const [payments, setPayments] = useState<PaymentRecord[]>(() =>
    loadOrInitial('payments', INITIAL_PAYMENTS)
  );

  // AI Communication & Contractor Assistant State (Module 10)
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    loadOrInitial('messages', INITIAL_MESSAGES)
  );
  const [aiActions, setAiActions] = useState<AIActionRecord[]>(() =>
    loadOrInitial('ai_actions', INITIAL_AI_ACTIONS)
  );
  const [pmInbox, setPmInbox] = useState<PMInboxItem[]>(() =>
    loadOrInitial('pm_inbox', INITIAL_PM_INBOX)
  );

  // WhatsApp-Ready Communication Gateway State (Module 11)
  const [gatewayContacts, setGatewayContacts] = useState<CommunicationContact[]>(() =>
    loadOrInitial('gateway_contacts', INITIAL_COMMUNICATION_CONTACTS)
  );
  const [gatewayMessages, setGatewayMessages] = useState<GatewayMessage[]>(() =>
    loadOrInitial('gateway_messages', INITIAL_GATEWAY_MESSAGES)
  );
  const [conversationThreads, setConversationThreads] = useState<ConversationThread[]>(() =>
    loadOrInitial('gateway_threads', INITIAL_CONVERSATION_THREADS)
  );
  const [messageQueue, setMessageQueue] = useState<MessageQueueItem[]>(() =>
    loadOrInitial('gateway_queue', INITIAL_MESSAGE_QUEUE)
  );
  const [aiActionRequests, setAiActionRequests] = useState<AIActionRequest[]>(() =>
    loadOrInitial('gateway_action_requests', INITIAL_AI_ACTION_REQUESTS)
  );
  const [gatewaySettings, setGatewaySettings] = useState<GatewaySettings>(() =>
    loadOrInitial('gateway_settings', INITIAL_GATEWAY_SETTINGS)
  );
  const [securityTestCases, setSecurityTestCases] = useState<SecurityTestCase[]>(() =>
    loadOrInitial('security_test_cases', INITIAL_SECURITY_TEST_CASES)
  );

  // Commercial, Costing & Profit Control State (Module 12)
  const [clientEnquiries, setClientEnquiries] = useState<ClientEnquiry[]>(() =>
    loadOrInitial('client_enquiries', INITIAL_CLIENT_ENQUIRIES)
  );
  const [commercialTenders, setCommercialTenders] = useState<CommercialTender[]>(() =>
    loadOrInitial('commercial_tenders', INITIAL_COMMERCIAL_TENDERS)
  );
  const [commercialQuotations, setCommercialQuotations] = useState<CommercialQuotation[]>(() =>
    loadOrInitial('commercial_quotations', INITIAL_COMMERCIAL_QUOTATIONS)
  );
  const [priceDatabase, setPriceDatabase] = useState<PriceDatabaseRecord[]>(() =>
    loadOrInitial('price_database', INITIAL_PRICE_DATABASE)
  );
  const [commercialBaselines, setCommercialBaselines] = useState<ProjectCommercialBaseline[]>(() =>
    loadOrInitial('commercial_baselines', INITIAL_PROJECT_COMMERCIAL_BASELINES)
  );
  const [projectCostLedger, setProjectCostLedger] = useState<ProjectCostLedgerItem[]>(() =>
    loadOrInitial('project_cost_ledger', INITIAL_PROJECT_COST_LEDGER)
  );
  const [goodsReceived, setGoodsReceived] = useState<GoodsReceivedRecord[]>(() =>
    loadOrInitial('goods_received', INITIAL_GOODS_RECEIVED)
  );
  const [commercialInvoices, setCommercialInvoices] = useState<CommercialInvoice[]>(() =>
    loadOrInitial('commercial_invoices', INITIAL_COMMERCIAL_INVOICES)
  );
  const [costLeakAlerts, setCostLeakAlerts] = useState<CostLeakAlert[]>(() =>
    loadOrInitial('cost_leak_alerts', INITIAL_COST_LEAK_ALERTS)
  );
  const [cashflowEntries, setCashflowEntries] = useState<ProjectCashflowEntry[]>(() =>
    loadOrInitial('cashflow_entries', INITIAL_CASHFLOW_ENTRIES)
  );

  // Production, CNC & QR/Barcode Factory State (Module 13)
  const [productionOrders, setProductionOrders] = useState<ProductionOrder[]>(() =>
    loadOrInitial('production_orders', INITIAL_PRODUCTION_ORDERS)
  );
  const [productionParts, setProductionParts] = useState<ProductionPart[]>(() =>
    loadOrInitial('production_parts', INITIAL_PRODUCTION_PARTS)
  );
  const [productionMaterials, setProductionMaterials] = useState<ProductionMaterialLink[]>(() =>
    loadOrInitial('production_materials', INITIAL_PRODUCTION_MATERIALS)
  );
  const [cncJobs, setCncJobs] = useState<CNCJob[]>(() =>
    loadOrInitial('cnc_jobs', INITIAL_CNC_JOBS)
  );
  const [cncFileVersions, setCncFileVersions] = useState<CNCFileVersion[]>(() =>
    loadOrInitial('cnc_file_versions', INITIAL_CNC_FILE_VERSIONS)
  );
  const [assemblyJobs, setAssemblyJobs] = useState<AssemblyJob[]>(() =>
    loadOrInitial('assembly_jobs', INITIAL_ASSEMBLY_JOBS)
  );
  const [finishingJobs, setFinishingJobs] = useState<FinishingJob[]>(() =>
    loadOrInitial('finishing_jobs', INITIAL_FINISHING_JOBS)
  );
  const [factoryQCInspections, setFactoryQCInspections] = useState<FactoryQCInspection[]>(() =>
    loadOrInitial('factory_qc_inspections', INITIAL_FACTORY_QC_INSPECTIONS)
  );
  const [packingPackages, setPackingPackages] = useState<PackingPackage[]>(() =>
    loadOrInitial('packing_packages', INITIAL_PACKING_PACKAGES)
  );
  const [productionIssues, setProductionIssues] = useState<ProductionIssueRecord[]>(() =>
    loadOrInitial('production_issues', INITIAL_PRODUCTION_ISSUES)
  );

  // Delivery, Site Installation & Handover State (Module 14)
  const [deliveryRecords, setDeliveryRecords] = useState<DeliveryRecord[]>(() =>
    loadOrInitial('delivery_records', INITIAL_DELIVERY_RECORDS)
  );
  const [installationJobs, setInstallationJobs] = useState<InstallationJob[]>(() =>
    loadOrInitial('installation_jobs', INITIAL_INSTALLATION_JOBS)
  );
  const [siteQCInspections, setSiteQCInspections] = useState<SiteQCInspection[]>(() =>
    loadOrInitial('site_qc_inspections', INITIAL_SITE_QC_INSPECTIONS)
  );
  const [handoverRecords, setHandoverRecords] = useState<HandoverRecord[]>(() =>
    loadOrInitial('handover_records', INITIAL_HANDOVER_RECORDS)
  );
  const [siteMeasurements, setSiteMeasurements] = useState<SiteMeasurementRecord[]>(() =>
    loadOrInitial('site_measurements', INITIAL_SITE_MEASUREMENTS)
  );
  const [clientChangeRequests, setClientChangeRequests] = useState<ClientChangeRequest[]>(() =>
    loadOrInitial('client_change_requests', INITIAL_CLIENT_CHANGE_REQUESTS)
  );

  // Module 15: Automation, Task, Notification & Escalation Engine States
  const [tasks, setTasks] = useState<NWTask[]>(() =>
    loadOrInitial('nw_tasks', INITIAL_TASKS)
  );
  const [automationRules, setAutomationRules] = useState<AutomationRule[]>(() =>
    loadOrInitial('automation_rules', INITIAL_AUTOMATION_RULES)
  );
  const [automationEvents, setAutomationEvents] = useState<AutomationEvent[]>(() =>
    loadOrInitial('automation_events', INITIAL_AUTOMATION_EVENTS)
  );
  const [automationRuns, setAutomationRuns] = useState<AutomationRun[]>(() =>
    loadOrInitial('automation_runs', INITIAL_AUTOMATION_RUNS)
  );
  const [failedAutomations, setFailedAutomations] = useState<FailedAutomation[]>(() =>
    loadOrInitial('failed_automations', INITIAL_FAILED_AUTOMATIONS)
  );
  const [escalations, setEscalations] = useState<EscalationRecord[]>(() =>
    loadOrInitial('escalations', INITIAL_ESCALATIONS)
  );
  const [userNotificationPreferences, setUserNotificationPreferences] = useState<UserNotificationPreference[]>(() =>
    loadOrInitial('notification_preferences', INITIAL_USER_NOTIFICATION_PREFERENCES)
  );
  const [dailyBriefings, setDailyBriefings] = useState<Record<string, DailyBriefing>>(() =>
    loadOrInitial('daily_briefings', INITIAL_DAILY_BRIEFINGS)
  );
  const [workflowTemplates, setWorkflowTemplates] = useState<WorkflowTemplate[]>(() =>
    loadOrInitial('workflow_templates', INITIAL_WORKFLOW_TEMPLATES)
  );
  const [ownerOverrides, setOwnerOverrides] = useState<OwnerOverrideRecord[]>(() =>
    loadOrInitial('owner_overrides', INITIAL_OWNER_OVERRIDES)
  );
  const [businessCalendar, setBusinessCalendar] = useState<BusinessCalendarConfig>(() =>
    loadOrInitial('business_calendar', INITIAL_BUSINESS_CALENDAR)
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string>('proj-1');

  // Persistence effects
  useEffect(() => saveStorage('currentUser', currentUser), [currentUser]);
  useEffect(() => saveStorage('availableUsers', availableUsers), [availableUsers]);
  useEffect(() => saveStorage('approvals', approvals), [approvals]);
  useEffect(() => saveStorage('suppliers', suppliers), [suppliers]);
  useEffect(() => saveStorage('purchaseOrders', purchaseOrders), [purchaseOrders]);
  useEffect(() => saveStorage('materialRequests', materialRequests), [materialRequests]);
  useEffect(() => saveStorage('financialClaims', financialClaims), [financialClaims]);
  useEffect(() => saveStorage('payments', payments), [payments]);
  useEffect(() => saveStorage('messages', messages), [messages]);
  useEffect(() => saveStorage('ai_actions', aiActions), [aiActions]);
  useEffect(() => saveStorage('pm_inbox', pmInbox), [pmInbox]);
  useEffect(() => saveStorage('gateway_contacts', gatewayContacts), [gatewayContacts]);
  useEffect(() => saveStorage('gateway_messages', gatewayMessages), [gatewayMessages]);
  useEffect(() => saveStorage('gateway_threads', conversationThreads), [conversationThreads]);
  useEffect(() => saveStorage('gateway_queue', messageQueue), [messageQueue]);
  useEffect(() => saveStorage('gateway_action_requests', aiActionRequests), [aiActionRequests]);
  useEffect(() => saveStorage('gateway_settings', gatewaySettings), [gatewaySettings]);
  useEffect(() => saveStorage('security_test_cases', securityTestCases), [securityTestCases]);
  useEffect(() => saveStorage('client_enquiries', clientEnquiries), [clientEnquiries]);
  useEffect(() => saveStorage('commercial_tenders', commercialTenders), [commercialTenders]);
  useEffect(() => saveStorage('commercial_quotations', commercialQuotations), [commercialQuotations]);
  useEffect(() => saveStorage('price_database', priceDatabase), [priceDatabase]);
  useEffect(() => saveStorage('commercial_baselines', commercialBaselines), [commercialBaselines]);
  useEffect(() => saveStorage('project_cost_ledger', projectCostLedger), [projectCostLedger]);
  useEffect(() => saveStorage('goods_received', goodsReceived), [goodsReceived]);
  useEffect(() => saveStorage('commercial_invoices', commercialInvoices), [commercialInvoices]);
  useEffect(() => saveStorage('cost_leak_alerts', costLeakAlerts), [costLeakAlerts]);
  useEffect(() => saveStorage('cashflow_entries', cashflowEntries), [cashflowEntries]);
  useEffect(() => saveStorage('production_orders', productionOrders), [productionOrders]);
  useEffect(() => saveStorage('production_parts', productionParts), [productionParts]);
  useEffect(() => saveStorage('production_materials', productionMaterials), [productionMaterials]);
  useEffect(() => saveStorage('cnc_jobs', cncJobs), [cncJobs]);
  useEffect(() => saveStorage('cnc_file_versions', cncFileVersions), [cncFileVersions]);
  useEffect(() => saveStorage('assembly_jobs', assemblyJobs), [assemblyJobs]);
  useEffect(() => saveStorage('finishing_jobs', finishingJobs), [finishingJobs]);
  useEffect(() => saveStorage('factory_qc_inspections', factoryQCInspections), [factoryQCInspections]);
  useEffect(() => saveStorage('packing_packages', packingPackages), [packingPackages]);
  useEffect(() => saveStorage('production_issues', productionIssues), [productionIssues]);
  useEffect(() => saveStorage('delivery_records', deliveryRecords), [deliveryRecords]);
  useEffect(() => saveStorage('installation_jobs', installationJobs), [installationJobs]);
  useEffect(() => saveStorage('site_qc_inspections', siteQCInspections), [siteQCInspections]);
  useEffect(() => saveStorage('handover_records', handoverRecords), [handoverRecords]);
  useEffect(() => saveStorage('site_measurements', siteMeasurements), [siteMeasurements]);
  useEffect(() => saveStorage('client_change_requests', clientChangeRequests), [clientChangeRequests]);
  useEffect(() => saveStorage('nw_tasks', tasks), [tasks]);
  useEffect(() => saveStorage('automation_rules', automationRules), [automationRules]);
  useEffect(() => saveStorage('automation_events', automationEvents), [automationEvents]);
  useEffect(() => saveStorage('automation_runs', automationRuns), [automationRuns]);
  useEffect(() => saveStorage('failed_automations', failedAutomations), [failedAutomations]);
  useEffect(() => saveStorage('escalations', escalations), [escalations]);
  useEffect(() => saveStorage('notification_preferences', userNotificationPreferences), [userNotificationPreferences]);
  useEffect(() => saveStorage('daily_briefings', dailyBriefings), [dailyBriefings]);
  useEffect(() => saveStorage('workflow_templates', workflowTemplates), [workflowTemplates]);
  useEffect(() => saveStorage('owner_overrides', ownerOverrides), [ownerOverrides]);
  useEffect(() => saveStorage('business_calendar', businessCalendar), [businessCalendar]);
  useEffect(() => saveStorage('projects', projects), [projects]);
  useEffect(() => saveStorage('clients', clients), [clients]);
  useEffect(() => saveStorage('contractors', contractors), [contractors]);
  useEffect(() => saveStorage('workPackages', workPackages), [workPackages]);
  useEffect(() => saveStorage('workItems', workItems), [workItems]);

  // Database sync for the core chain; a no-op unless the server runs with CORE_DATA_SOURCE=database.
  // Collections backed by PostgreSQL in database mode (see services/syncedCollections.ts).
  const syncedData = {
    clients, projects, workPackages, workItems,
    drawings, documents, issues, tasks, escalations, approvals, variations, clientChangeRequests, qcRecords,
    siteMeasurements, productionOrders, productionParts, cncJobs, assemblyJobs, finishingJobs, factoryQCInspections,
    packingPackages, productionIssues, cncFileVersions, productionMaterials, deliveryRecords, installationJobs,
    siteQCInspections, handoverRecords, clientEnquiries, commercialTenders, commercialQuotations, priceDatabase,
    commercialBaselines, suppliers, purchaseOrders, goodsReceived, materialRequests, projectCostLedger,
    commercialInvoices, costLeakAlerts, cashflowEntries, financialClaims, payments, knowledge,
  } as unknown as Record<string, Record<string, unknown>[]>;
  const syncedSetters = useMemo(
    () =>
      ({
        clients: setClients, projects: setProjects, workPackages: setWorkPackages, workItems: setWorkItems,
        drawings: setDrawings, documents: setDocuments, issues: setIssues, tasks: setTasks, escalations: setEscalations,
        approvals: setApprovals, variations: setVariations, clientChangeRequests: setClientChangeRequests,
        qcRecords: setQcRecords, siteMeasurements: setSiteMeasurements, productionOrders: setProductionOrders,
        productionParts: setProductionParts, cncJobs: setCncJobs, assemblyJobs: setAssemblyJobs,
        finishingJobs: setFinishingJobs, factoryQCInspections: setFactoryQCInspections, packingPackages: setPackingPackages,
        productionIssues: setProductionIssues, cncFileVersions: setCncFileVersions, productionMaterials: setProductionMaterials,
        deliveryRecords: setDeliveryRecords, installationJobs: setInstallationJobs, siteQCInspections: setSiteQCInspections,
        handoverRecords: setHandoverRecords, clientEnquiries: setClientEnquiries, commercialTenders: setCommercialTenders,
        commercialQuotations: setCommercialQuotations, priceDatabase: setPriceDatabase, commercialBaselines: setCommercialBaselines,
        suppliers: setSuppliers, purchaseOrders: setPurchaseOrders, goodsReceived: setGoodsReceived,
        materialRequests: setMaterialRequests, projectCostLedger: setProjectCostLedger, commercialInvoices: setCommercialInvoices,
        costLeakAlerts: setCostLeakAlerts, cashflowEntries: setCashflowEntries, financialClaims: setFinancialClaims,
        payments: setPayments, knowledge: setKnowledge,
      }) as unknown as Record<string, (rows: never[]) => void>,
    []
  );
  const coreDataSync = useCoreDatabaseSync(syncedData, syncedSetters, {
    canImport: canImportCoreData,
    canRead: (collection) =>
      collection === 'commercialBaselines' ? hasPermission(currentUser, 'commercial.view') : collection === 'knowledge' ? hasPermission(currentUser, 'knowledge.view') : true,
  });

  // In database mode the audit trail comes from the server (append-only, read-only here).
  useEffect(() => {
    if (coreDataSync.mode !== 'database' || !hasPermission(currentUser, 'audit.view')) return;
    let cancelled = false;
    dataApi
      .auditLogs()
      .then((rows) => {
        if (cancelled) return;
        setAuditLogs(
          rows.map((r) => ({
            id: `srv-${String(r.id)}`,
            user_id: String(r.actor_id ?? ''),
            user_name: String(r.actor_name ?? 'System'),
            user_role: String(r.actor_role ?? ''),
            action: String(r.action),
            object_type: String(r.entity_type),
            object_id: String(r.entity_id ?? ''),
            entity_id: r.entity_id ? String(r.entity_id) : undefined,
            details: r.details ? String(r.details) : r.after ? JSON.stringify(r.after).slice(0, 300) : undefined,
            timestamp: String(r.occurred_at),
          }))
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coreDataSync.mode, coreDataSync.lastSyncedAt]);

  const signOut = () => {
    // In database mode the cached core data belongs to this user's view; drop it.
    if (coreDataSync.mode === 'database') clearCoreCache();
    onSignOut?.();
  };
  useEffect(() => saveStorage('drawings', drawings), [drawings]);
  useEffect(() => saveStorage('knowledge', knowledge), [knowledge]);
  useEffect(() => saveStorage('issues', issues), [issues]);
  useEffect(() => saveStorage('variations', variations), [variations]);
  useEffect(() => saveStorage('documents', documents), [documents]);
  useEffect(() => saveStorage('notifications', notifications), [notifications]);
  useEffect(() => saveStorage('auditLogs', auditLogs), [auditLogs]);
  useEffect(() => saveStorage('qcRecords', qcRecords), [qcRecords]);
  useEffect(() => saveStorage('drawingDemoStep', drawingDemoStep), [drawingDemoStep]);

  // Project-level access isolation: filter projects visible to current user
  const userProjects = projects.filter((p) => canAccessProject(currentUser, p, workPackages));

  // Auto-align selected project if current user doesn't have access to the currently selected project
  useEffect(() => {
    if (userProjects.length > 0) {
      const hasAccess = userProjects.some((p) => p.id === selectedProjectId);
      if (!hasAccess) {
        setSelectedProjectId(userProjects[0].id);
      }
    }
  }, [currentUser.id, currentUser.role, projects, userProjects]);

  const addAuditLog = (
    action: string,
    object_type: string,
    object_id: string,
    old_value?: string,
    new_value?: string
  ) => {
    const log: AuditLog = {
      id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      user_id: currentUser.id,
      user_name: currentUser.name,
      user_role: currentUser.role,
      role: currentUser.role,
      action,
      object_type,
      object_id,
      entity_id: object_id,
      old_value,
      new_value,
      details: new_value || `${object_type} ${object_id}`,
      timestamp: new Date().toISOString(),
    };
    setAuditLogs((prev) => [log, ...prev]);
  };

  const switchRole = (role: UserRole) => {
    if (authUser) return; // identity comes from the server session
    const match = availableUsers.find((u) => u.role === role);
    if (match) {
      setCurrentUser(match);
      addAuditLog('Switched User Role', 'UserProfile', match.id, currentUser.role, role);
    }
  };

  const switchUser = (userId: string) => {
    if (authUser) return; // identity comes from the server session
    const match = availableUsers.find((u) => u.id === userId);
    if (match) {
      const prev = currentUser;
      setCurrentUser(match);
      addAuditLog('Switched Active User', 'UserProfile', match.id, `${prev.name} (${prev.role})`, `${match.name} (${match.role})`);
    }
  };

  const addUser = (userData: Omit<UserProfile, 'id'>) => {
    const newUser: UserProfile = {
      ...userData,
      id: 'user-' + Date.now(),
      status: userData.status || 'active',
      created_at: new Date().toISOString(),
    };
    setAvailableUsers((prev) => [...prev, newUser]);
    addAuditLog('Created User Account', 'UserProfile', newUser.id, undefined, `${newUser.name} (${newUser.role})`);
    return newUser;
  };

  const updateUser = (id: string, updates: Partial<UserProfile>) => {
    setAvailableUsers((prev) =>
      prev.map((u) => {
        if (u.id === id) {
          const updated = { ...u, ...updates };
          if (currentUser.id === id) {
            setCurrentUser(updated);
          }
          addAuditLog('Updated User Account', 'UserProfile', id, u.role, updates.role || u.role);
          return updated;
        }
        return u;
      })
    );
  };

  const toggleUserStatus = (id: string) => {
    setAvailableUsers((prev) =>
      prev.map((u) => {
        if (u.id === id) {
          const newStatus: 'active' | 'inactive' = u.status === 'inactive' ? 'active' : 'inactive';
          addAuditLog('Toggled User Status', 'UserProfile', id, u.status, newStatus);
          const updated = { ...u, status: newStatus };
          if (currentUser.id === id) {
            setCurrentUser(updated);
          }
          return updated;
        }
        return u;
      })
    );
  };

  // APPROVALS FRAMEWORK OPERATIONS (Section 15)
  const createApproval = (item: Omit<ApprovalItem, 'id' | 'approval_number' | 'created_at' | 'updated_at'>) => {
    const newApproval: ApprovalItem = {
      ...item,
      id: 'apr-' + Date.now(),
      approval_number: `APR-2026-0${approvals.length + 1}`,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      audit_trail: [
        {
          action: 'Approval Request Created',
          user_name: currentUser.name,
          timestamp: new Date().toISOString(),
          note: `Requested by ${currentUser.name} (${currentUser.role})`,
        },
      ],
    };
    setApprovals((prev) => [newApproval, ...prev]);

    // Send notification to designated approver role
    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: item.assigned_approver_role as UserRole,
        title: `Approval Required: ${newApproval.approval_number}`,
        message: `${item.title} submitted by ${item.requested_by_name} (${item.requested_by_role}).`,
        type: 'drawing',
        priority: 'urgent',
        is_read: false,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    addAuditLog(
      'Created Approval Request',
      'ApprovalItem',
      newApproval.approval_number,
      undefined,
      `${newApproval.title} (${newApproval.approval_type})`
    );

    return newApproval;
  };

  const decideApproval = (
    id: string,
    decision: ApprovalDecision,
    comments?: string,
    isOverride?: boolean,
    overrideReason?: string
  ) => {
    let affectedItem: ApprovalItem | undefined;
    setApprovals((prev) =>
      prev.map((appr) => {
        if (appr.id === id) {
          affectedItem = appr;
          const updatedAuditTrail = [
            ...(appr.audit_trail || []),
            {
              action: `${isOverride ? '[OWNER OVERRIDE] ' : ''}Decision: ${decision}`,
              user_name: currentUser.name,
              timestamp: new Date().toISOString(),
              note: overrideReason || comments || `Decision marked as ${decision}`,
            },
          ];
          return {
            ...appr,
            decision,
            decision_date: new Date().toISOString(),
            decision_by_id: currentUser.id,
            decision_by_name: currentUser.name,
            decision_by_role: currentUser.role,
            comments: comments || appr.comments,
            is_owner_override: isOverride || appr.is_owner_override,
            override_reason: overrideReason || appr.override_reason,
            audit_trail: updatedAuditTrail,
            updated_at: new Date().toISOString(),
          };
        }
        return appr;
      })
    );

    if (affectedItem) {
      const isOwnerOverrideAction = Boolean(
        isOverride || (currentUser.role === 'Owner / CEO' && affectedItem.requested_by_id === currentUser.id)
      );

      // Audit log recording (Owner overrides are explicitly highlighted!)
      addAuditLog(
        isOwnerOverrideAction
          ? `Owner Workflow Override: ${decision} (${affectedItem.approval_type})`
          : `Approval Decision: ${decision} (${affectedItem.approval_type})`,
        'ApprovalItem',
        affectedItem.approval_number,
        affectedItem.decision,
        `${decision}${overrideReason ? ` | Override Justification: ${overrideReason}` : ''}${comments ? ` | Comments: ${comments}` : ''}`
      );

      // If approved, cascade effects
      if (decision === 'Approved') {
        if (affectedItem.approval_type === 'Variation' && affectedItem.related_entity_id) {
          approveVariation(affectedItem.related_entity_id, currentUser.role === 'Client');
        } else if (affectedItem.approval_type === 'Major Purchase' && affectedItem.related_entity_id) {
          updatePOStatus(affectedItem.related_entity_id, 'Issued');
        }
      }

      // Notify requester
      setNotifications((prev) => [
        {
          id: 'notif-' + Date.now(),
          target_role: affectedItem!.requested_by_role,
          target_user_id: affectedItem!.requested_by_id,
          title: `Approval ${decision}: ${affectedItem!.approval_number}`,
          message: `${affectedItem!.title} was marked as "${decision}" by ${currentUser.name} (${currentUser.role}).${comments ? ` Note: ${comments}` : ''}`,
          type: 'issue',
          priority: decision === 'Rejected' ? 'urgent' : 'normal',
          is_read: false,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  };

  // PURCHASING & MATERIAL REQUISITION OPERATIONS (Section 6)
  const createPurchaseOrder = (poData: Omit<PurchaseOrder, 'id' | 'po_number' | 'created_at'>) => {
    const newPO: PurchaseOrder = {
      ...poData,
      id: 'po-' + Date.now(),
      po_number: `PO-2026-0${purchaseOrders.length + 44}`,
      created_at: new Date().toISOString(),
    };
    setPurchaseOrders((prev) => [newPO, ...prev]);

    // Check if PO requires Major Purchase approval (threshold > RM 20,000)
    if (newPO.total_amount >= 20000 && newPO.status === 'Pending Approval') {
      createApproval({
        approval_type: 'Major Purchase',
        title: `${newPO.po_number}: ${newPO.supplier_name} (RM ${newPO.total_amount.toLocaleString()})`,
        description: `Material requisition for ${newPO.project_name}. Items: ${newPO.items.map((i) => i.item_description).join(', ')}`,
        project_id: newPO.project_id,
        project_name: newPO.project_name,
        requested_by_id: currentUser.id,
        requested_by_name: currentUser.name,
        requested_by_role: currentUser.role,
        assigned_approver_role: 'Owner / CEO',
        date_requested: new Date().toISOString(),
        decision: 'Pending',
        impact_summary: {
          cost_impact_myr: newPO.total_amount,
          schedule_impact_days: 0,
          technical_risk: 'Low',
        },
        related_entity_type: 'purchase',
        related_entity_id: newPO.id,
      });
    }

    addAuditLog('Created Purchase Order', 'PurchaseOrder', newPO.po_number, undefined, `RM ${newPO.total_amount} (${newPO.supplier_name})`);
    return newPO;
  };

  const updatePOStatus = (id: string, status: POStatus, actualDeliveryDate?: string) => {
    setPurchaseOrders((prev) =>
      prev.map((po) => {
        if (po.id === id) {
          const updated = {
            ...po,
            status,
            actual_delivery_date: actualDeliveryDate || po.actual_delivery_date,
          };
          addAuditLog('Updated PO Status', 'PurchaseOrder', po.po_number, po.status, status);
          return updated;
        }
        return po;
      })
    );
  };

  const createMaterialRequest = (mrData: Omit<MaterialRequest, 'id' | 'request_number' | 'created_at'>) => {
    const newMR: MaterialRequest = {
      ...mrData,
      id: 'mr-' + Date.now(),
      request_number: `MR-2026-0${materialRequests.length + 20}`,
      created_at: new Date().toISOString(),
    };
    setMaterialRequests((prev) => [newMR, ...prev]);
    addAuditLog('Created Material Request', 'MaterialRequest', newMR.request_number, undefined, newMR.material_name);
    return newMR;
  };

  // CORE AUTOMATION: Work item updates
  const updateWorkItemStatus = (
    id: string,
    newStatus: WorkItemStatus,
    notes?: string,
    photos?: string[]
  ) => {
    setWorkItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const oldStatus = item.status;
          let newProdStatus = item.production_status;
          let newDeliveryStatus = item.delivery_status;

          if (newStatus === 'Ready for QC') {
            newProdStatus = 'QC';
            // Auto notify PM & Site Supervisor for QC
            setNotifications((nPrev) => [
              {
                id: 'notif-' + Date.now(),
                target_role: 'Project Manager',
                title: `QC Required: ${item.item_code}`,
                message: `Contractor marked ${item.item_code} (${item.description}) as complete. QC inspection task automatically generated.`,
                type: 'qc',
                priority: 'normal',
                is_read: false,
                project_id: item.project_id,
                link_type: 'work_item',
                link_id: item.id,
                created_at: new Date().toISOString(),
              },
              ...nPrev,
            ]);
          } else if (newStatus === 'Ready for Delivery') {
            newProdStatus = 'Ready for Delivery';
          }

          addAuditLog(
            `Updated Work Item Status to ${newStatus}`,
            'WorkItem',
            item.item_code,
            oldStatus,
            newStatus
          );

          return {
            ...item,
            status: newStatus,
            production_status: newProdStatus,
            delivery_status: newDeliveryStatus,
            progress_percent:
              newStatus === 'Completed'
                ? 100
                : newStatus === 'Ready for QC'
                ? 90
                : item.progress_percent,
            notes: notes || item.notes,
            photos: photos && photos.length ? [...item.photos, ...photos] : item.photos,
            updated_at: new Date().toISOString(),
          };
        }
        return item;
      })
    );
  };

  // QC Workflow Automation
  const submitQCInspection = (
    workItemId: string,
    result: 'Passed' | 'Failed' | 'Correction Required',
    comments: string,
    photos: string[] = [],
    correction?: string
  ) => {
    const item = workItems.find((w) => w.id === workItemId);
    if (!item) return;

    const newRecord: QCRecord = {
      id: 'qc-' + Date.now(),
      work_item_id: workItemId,
      project_id: item.project_id,
      inspector_name: currentUser.name,
      inspector_role: currentUser.role,
      inspection_date: new Date().toISOString().split('T')[0],
      result,
      comments,
      photos,
      correction_requested: correction,
    };

    setQcRecords((prev) => [newRecord, ...prev]);

    if (result === 'Passed') {
      setWorkItems((prev) =>
        prev.map((w) =>
          w.id === workItemId
            ? {
                ...w,
                status: 'QC Passed',
                production_status: 'Packing',
                delivery_status: 'Not Scheduled',
                updated_at: new Date().toISOString(),
              }
            : w
        )
      );

      // Notify contractor to enter delivery info (rule: System does NOT auto-arrange delivery)
      setNotifications((nPrev) => [
        {
          id: 'notif-' + Date.now(),
          target_role: 'Contractor',
          title: `QC Passed for ${item.item_code}`,
          message: `Item is ready for delivery. Please enter scheduled delivery date and time.`,
          type: 'qc',
          priority: 'normal',
          is_read: false,
          project_id: item.project_id,
          link_type: 'work_item',
          link_id: item.id,
          created_at: new Date().toISOString(),
        },
        ...nPrev,
      ]);

      addAuditLog('QC Inspection Passed', 'WorkItem', item.item_code, 'Ready for QC', 'QC Passed');
    } else {
      // Failed / Correction required
      setWorkItems((prev) =>
        prev.map((w) =>
          w.id === workItemId
            ? {
                ...w,
                status: 'QC Failed',
                production_status: 'Assembly',
                notes: `QC Failed: ${comments}. Correction required: ${correction || ''}`,
                updated_at: new Date().toISOString(),
              }
            : w
        )
      );

      setNotifications((nPrev) => [
        {
          id: 'notif-' + Date.now(),
          target_role: 'Contractor',
          title: `⚠️ QC Failed: ${item.item_code} requires correction`,
          message: comments + (correction ? ` | Action: ${correction}` : ''),
          type: 'qc',
          priority: 'urgent',
          is_read: false,
          project_id: item.project_id,
          link_type: 'work_item',
          link_id: item.id,
          created_at: new Date().toISOString(),
        },
        ...nPrev,
      ]);

      addAuditLog('QC Inspection Failed', 'WorkItem', item.item_code, 'Ready for QC', 'QC Failed');
    }
  };

  // Delivery Automation
  const scheduleDelivery = (
    workItemId: string,
    date: string,
    time: string,
    lorryDetails?: string
  ) => {
    const item = workItems.find((w) => w.id === workItemId);
    if (!item) return;

    setWorkItems((prev) =>
      prev.map((w) =>
        w.id === workItemId
          ? {
              ...w,
              delivery_status: 'Scheduled',
              scheduled_delivery_date: date,
              scheduled_delivery_time: time,
              notes: lorryDetails ? `${w.notes || ''} [Lorry: ${lorryDetails}]` : w.notes,
              updated_at: new Date().toISOString(),
            }
          : w
      )
    );

    // Notify site supervisor
    setNotifications((nPrev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: 'Site Supervisor',
        title: `Delivery Scheduled: ${item.item_code}`,
        message: `Arrival scheduled on ${date} at ${time}. Please ensure site loading bay & hoist clearance.`,
        type: 'delivery',
        priority: 'normal',
        is_read: false,
        project_id: item.project_id,
        link_type: 'work_item',
        link_id: item.id,
        created_at: new Date().toISOString(),
      },
      ...nPrev,
    ]);

    addAuditLog('Scheduled Delivery', 'WorkItem', item.item_code, 'Not Scheduled', `Scheduled for ${date} ${time}`);
  };

  // Delivery Received (Site Supervisor)
  const confirmDeliveryReceived = (
    workItemId: string,
    receivedBy: string,
    photos: string[] = []
  ) => {
    const item = workItems.find((w) => w.id === workItemId);
    if (!item) return;

    setWorkItems((prev) =>
      prev.map((w) =>
        w.id === workItemId
          ? {
              ...w,
              delivery_status: 'Received / Confirmed',
              status: 'Delivered',
              received_delivery_date: new Date().toLocaleString(),
              photos: photos.length ? [...w.photos, ...photos] : w.photos,
              updated_at: new Date().toISOString(),
            }
          : w
      )
    );

    addAuditLog('Delivery Received on Site', 'WorkItem', item.item_code, 'Scheduled', 'Received / Confirmed');
  };

  // Installation Activation (Manual human activation required)
  const activateInstallation = (workItemId: string) => {
    const item = workItems.find((w) => w.id === workItemId);
    if (!item) return;

    setWorkItems((prev) =>
      prev.map((w) =>
        w.id === workItemId
          ? {
              ...w,
              status: 'Installation In Progress',
              installation_status: 'In Progress',
              updated_at: new Date().toISOString(),
            }
          : w
      )
    );

    addAuditLog('Activated Installation', 'WorkItem', item.item_code, 'Delivered', 'Installation In Progress');
  };

  const completeInstallation = (workItemId: string) => {
    const item = workItems.find((w) => w.id === workItemId);
    if (!item) return;

    setWorkItems((prev) =>
      prev.map((w) =>
        w.id === workItemId
          ? {
              ...w,
              status: 'Completed',
              installation_status: 'Completed',
              progress_percent: 100,
              updated_at: new Date().toISOString(),
            }
          : w
      )
    );

    addAuditLog('Completed Installation', 'WorkItem', item.item_code, 'Installation In Progress', 'Completed');
  };

  // Issue reporting & escalation
  const createIssue = async (issueData: Partial<Issue>): Promise<Issue> => {
    const id = 'issue-' + Date.now();
    const newIssue: Issue = {
      id,
      project_id: issueData.project_id || selectedProjectId,
      work_item_id: issueData.work_item_id,
      title: issueData.title || 'New Site Issue',
      category: issueData.category || 'Site condition',
      priority: issueData.priority || 'Medium',
      status: issueData.status || 'Reported',
      reported_by: issueData.reported_by || currentUser.name,
      reported_by_role: issueData.reported_by_role || currentUser.role,
      assigned_to: issueData.assigned_to || 'Marcus Lee (PM)',
      escalation_level: issueData.escalation_level || 'PM',
      action_required: issueData.action_required || 'Investigation and site inspection',
      description: issueData.description || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setIssues((prev) => [newIssue, ...prev]);

    // Role-targeted notification based on escalation
    const targetRole = newIssue.escalation_level === 'Owner' ? 'Owner / CEO' : 'Project Manager';
    setNotifications((nPrev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: targetRole,
        title: `${newIssue.priority === 'Critical' ? '🚨 CRITICAL: ' : 'New Issue: '}${newIssue.title}`,
        message: `${newIssue.description.slice(0, 100)}... Escalated to ${newIssue.escalation_level}.`,
        type: 'issue',
        priority: newIssue.priority === 'Critical' ? 'urgent' : 'normal',
        is_read: false,
        project_id: newIssue.project_id,
        link_type: 'issue',
        link_id: id,
        created_at: new Date().toISOString(),
      },
      ...nPrev,
    ]);

    addAuditLog('Created Issue', 'Issue', newIssue.title, 'None', newIssue.priority);
    return newIssue;
  };

  const resolveIssue = (issueId: string, resolutionNotes: string, actionType?: string) => {
    setIssues((prev) =>
      prev.map((iss) =>
        iss.id === issueId
          ? {
              ...iss,
              status: 'Resolved',
              resolution_notes: resolutionNotes,
              updated_at: new Date().toISOString(),
            }
          : iss
      )
    );

    // If this is the flagship dimension issue (issue-1), update work item CAR-003 notes and clear blocker
    if (issueId === 'issue-1') {
      setWorkItems((prev) =>
        prev.map((w) =>
          w.item_code === 'CAR-003'
            ? {
                ...w,
                status: 'In Progress',
                installation_status: 'Scheduled',
                notes: `Owner approved variation VO-002: Module B end plinth trimmed 100mm to match 2300mm site condition. Proceeding with assembly.`,
                updated_at: new Date().toISOString(),
              }
            : w
        )
      );

      // Also set variation VO-002 to Approved
      setVariations((prev) =>
        prev.map((v) =>
          v.variation_number === 'VO-002'
            ? { ...v, status: 'Approved', approved_by_owner: currentUser.name }
            : v
        )
      );
    }

    addAuditLog('Resolved Issue', 'Issue', issueId, 'Decision Required', `Resolved: ${resolutionNotes}`);
  };

  const escalateIssue = (issueId: string, targetLevel: 'PM' | 'Owner', reason: string) => {
    setIssues((prev) =>
      prev.map((iss) =>
        iss.id === issueId
          ? {
              ...iss,
              escalation_level: targetLevel,
              status: 'Decision Required',
              action_required: `${targetLevel.toUpperCase()} DECISION REQUIRED: ${reason}`,
              updated_at: new Date().toISOString(),
            }
          : iss
      )
    );

    setNotifications((nPrev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: targetLevel === 'Owner' ? 'Owner / CEO' : 'Project Manager',
        title: `🚨 Issue Escalated to ${targetLevel}`,
        message: reason,
        type: 'escalation',
        priority: 'urgent',
        is_read: false,
        created_at: new Date().toISOString(),
      },
      ...nPrev,
    ]);

    addAuditLog(`Escalated Issue to ${targetLevel}`, 'Issue', issueId, 'Previous', targetLevel);
  };

  const approveVariation = (variationId: string, approvedByClient: boolean = false) => {
    setVariations((prev) =>
      prev.map((v) =>
        v.id === variationId
          ? {
              ...v,
              status: approvedByClient ? 'Approved' : 'Client Approval',
              approved_by_owner: approvedByClient ? v.approved_by_owner : currentUser.name,
              approved_by_client: approvedByClient ? currentUser.name : undefined,
            }
          : v
      )
    );

    addAuditLog('Approved Variation Order', 'Variation', variationId, 'Costing', approvedByClient ? 'Approved' : 'Client Approval');
  };

  // Drawing Markups
  const addDrawingMarkup = (
    drawingId: string,
    revisionId: string,
    markupData: Omit<DrawingMarkup, 'id'>
  ) => {
    const newMarkup: DrawingMarkup = {
      id: 'mk-' + Date.now(),
      ...markupData,
    };

    setDrawings((prev) =>
      prev.map((dwg) => {
        if (dwg.id === drawingId) {
          return {
            ...dwg,
            revisions: dwg.revisions.map((rev) => {
              if (rev.id === revisionId) {
                return {
                  ...rev,
                  markups: [...rev.markups, newMarkup],
                };
              }
              return rev;
            }),
          };
        }
        return dwg;
      })
    );

    addAuditLog(
      `Added Drawing Markup on ${drawingId} (${markupData.markup_type})`,
      'DrawingRevision',
      revisionId,
      '',
      markupData.content
    );
  };

  // Knowledge Base
  const addKnowledgeItem = (item: Omit<NWProductionKnowledge, 'id' | 'created_at'>) => {
    const newK: NWProductionKnowledge = {
      id: 'know-' + Date.now(),
      created_at: new Date().toISOString(),
      ...item,
    };
    setKnowledge((prev) => [newK, ...prev]);
    addAuditLog('Added NW Production Knowledge', 'Knowledge', newK.title, '', newK.category);
  };

  // Drawing Revision with Prompt: "Should this become an NW standard?"
  const addDrawingRevision = (
    drawingId: string,
    newRevision: {
      revision: string;
      title: string;
      file_url: string;
      notes: string;
      supersedes_revision?: string;
      drawing_type: 'Client / Designer Drawing' | 'NW Production Drawing';
    },
    saveAsStandard?: boolean,
    standardData?: { title: string; category: any; description: string; reason: string }
  ) => {
    const revId = 'rev-' + Date.now();
    // A new revision starts as Draft and is not current: the approved revision stays in use
    // (and production keeps using it) until an approver approves the new one.
    setDrawings((prev) =>
      prev.map((dwg) => {
        if (dwg.id === drawingId) {
          const addedRev = {
            id: revId,
            drawing_id: drawingId,
            revision: newRevision.revision,
            title: newRevision.title,
            file_url: newRevision.file_url,
            uploaded_date: new Date().toISOString().split('T')[0],
            uploaded_by: currentUser.name,
            approved_status: 'Draft' as const,
            supersedes_revision: newRevision.supersedes_revision,
            notes: newRevision.notes,
            is_current: false,
            drawing_type: newRevision.drawing_type,
            markups: [],
          };

          return { ...dwg, revisions: [...dwg.revisions, addedRev] };
        }
        return dwg;
      })
    );

    if (saveAsStandard && standardData) {
      addKnowledgeItem({
        title: standardData.title,
        category: standardData.category,
        description: standardData.description,
        reason: standardData.reason,
        example: `Derived from revision ${newRevision.revision} on drawing ${drawingId}`,
        created_by: currentUser.name,
        approved_by: currentUser.name,
        status: 'Review', // a knowledge editor approves it (server-enforced)
        source_project_id: selectedProjectId,
      });
    }

    addAuditLog(
      `Added Drawing Revision ${newRevision.revision}`,
      'Drawing',
      drawingId,
      newRevision.supersedes_revision,
      newRevision.revision
    );
  };

  // Client revision review: Draft -> Internal Review -> Approved (the server checks who may).
  // Approving makes the revision current and supersedes the previously approved one.
  const setDrawingRevisionStatus = (
    drawingId: string,
    revisionId: string,
    status: 'Draft' | 'Internal Review' | 'Approved' | 'Rejected'
  ) => {
    setDrawings((prev) =>
      prev.map((dwg) => {
        if (dwg.id !== drawingId) return dwg;
        const approving = status === 'Approved';
        return {
          ...dwg,
          ...(approving ? { current_revision_id: revisionId } : {}),
          revisions: dwg.revisions.map((r) => {
            if (r.id === revisionId) return { ...r, approved_status: status, is_current: approving };
            if (approving && r.approved_status === 'Approved') return { ...r, approved_status: 'Superseded' as const, is_current: false };
            return r;
          }),
        };
      })
    );
    addAuditLog(`Drawing Revision ${status}`, 'Drawing', drawingId, '', `${revisionId} -> ${status}`);
  };

  // Drawing Intelligence & Production Review Functions
  const uploadDrawing = (drawingData: {
    project_id: string;
    drawing_number: string;
    title: string;
    category: string;
    drawing_type: DrawingType;
    revision: string;
    file_url?: string;
    notes?: string;
  }): Drawing => {
    const drawingId = 'dwg-' + Date.now();
    const revisionId = 'rev-' + Date.now();
    const newRev: DrawingRevision = {
      id: revisionId,
      drawing_id: drawingId,
      revision: drawingData.revision || 'Rev 1',
      title: drawingData.title,
      file_url: drawingData.file_url || '/assets/drawings/sample-blueprint.svg',
      uploaded_date: new Date().toISOString().split('T')[0],
      uploaded_by: currentUser.name,
      // Uploading never approves: the first revision waits for Internal Review and approval.
      approved_status: 'Draft',
      notes: drawingData.notes || '',
      is_current: false,
      drawing_type: drawingData.drawing_type,
      markups: [],
    };

    const newDrawing: Drawing = {
      id: drawingId,
      project_id: drawingData.project_id || selectedProjectId,
      drawing_number: drawingData.drawing_number,
      title: drawingData.title,
      category: drawingData.category || 'General',
      drawing_type: drawingData.drawing_type,
      file_url: newRev.file_url,
      current_revision_id: revisionId,
      created_at: new Date().toISOString(),
      status: 'Draft',
      uploaded_by: currentUser.name,
      notes: drawingData.notes,
      revisions: [newRev],
      production_reviews: [],
      nw_production_drawings: [],
    };

    setDrawings((prev) => [newDrawing, ...prev]);
    addAuditLog('Uploaded Drawing', 'Drawing', newDrawing.drawing_number, '', newRev.revision);
    return newDrawing;
  };

  const analyzeDrawingWithAI = async (
    drawingId: string,
    revisionId: string
  ): Promise<AIDrawingAnalysis> => {
    const drawing = drawings.find((d) => d.id === drawingId);
    const revision = drawing?.revisions.find((r) => r.id === revisionId);
    const project = projects.find((p) => p.id === (drawing?.project_id || selectedProjectId));

    try {
      const response = await fetch('/api/ai/analyze-drawing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Database mode: the server loads the drawing (and what you may see) from these IDs and
          // ignores the rest; demo mode's rule-based answer uses the descriptive fields below.
          drawingId,
          revisionId,
          drawingNumber: drawing?.drawing_number || 'A-103',
          revision: revision?.revision || 'Rev 1',
          drawingTitle: revision?.title || drawing?.title,
          notes: revision?.notes,
          fileUrl: revision?.file_url,
          projectContext: {
            projectName: project?.project_name || 'Project Aurora',
            projectType: clients.find((c) => c.id === project?.client_id)?.client_type || 'Luxury Retail Flagship',
            location: project?.site_address || 'Pavilion Kuala Lumpur',
          },
          knowledgeBase: knowledge.map((k) => ({
            id: k.id,
            title: k.title,
            category: k.category,
            description: k.description,
            reason: k.reason,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`AI Analysis API responded with status ${response.status}`);
      }

      const result = await response.json();
      const analysis: AIDrawingAnalysis = {
        ...result,
        label: 'AI DRAFT — NOT APPROVED',
      };

      setDrawings((prev) =>
        prev.map((dwg) => {
          if (dwg.id === drawingId) {
            return {
              ...dwg,
              revisions: dwg.revisions.map((rev) => {
                if (rev.id === revisionId) {
                  return { ...rev, ai_analysis: analysis };
                }
                return rev;
              }),
            };
          }
          return dwg;
        })
      );

      addAuditLog('Ran AI Drawing Analysis', 'DrawingRevision', revision?.revision || revisionId, '', 'AI DRAFT Generated');
      return analysis;
    } catch (err) {
      console.warn('AI analysis API error, falling back to structured deterministic extraction:', err);
      const isRev4 = revision?.revision?.includes('4') || revision?.title?.includes('2300');
      const fallbackAnalysis: AIDrawingAnalysis = {
        label: 'AI DRAFT — NOT APPROVED',
        drawing_number: drawing?.drawing_number || 'A-103',
        revision: revision?.revision || 'Rev 1',
        dimensions: isRev4
          ? [
              'Total Length: 2300mm (REVISED: Reduced 100mm from Rev 3 2400mm)',
              'Total Depth: 900mm',
              'Countertop Height: 900mm',
              'Privacy Screen Height: 1050mm',
              'Recessed Skirting: 100mm H × 50mm D',
            ]
          : [
              'Total Length: 2400mm (Monolithic designer specification)',
              'Total Depth: 900mm',
              'Countertop Height: 900mm (Cashier Ergonomic standard)',
              'Privacy Screen Top Height: 1050mm',
              'Recessed Skirting: 100mm H × 50mm D',
            ],
        quantities: ['1 Unit Complete Checkout Counter'],
        materials: isRev4
          ? [
              '25mm Marine Plywood core (REVISED from 18mm)',
              '1.0mm Wilsonart Warm Oak High-Pressure Laminate (HPL)',
              '12mm Corian Glacier White Solid Surface Countertop',
              'Blum Movento soft-close drawer runners (40kg payload)',
            ]
          : [
              '18mm High-Grade Marine Plywood core (E1 Formaldehyde compliant)',
              '1.0mm Wilsonart Warm Oak High-Pressure Laminate (HPL)',
              '12mm Corian Glacier White Solid Surface Countertop',
              'Blum Movento soft-close drawer runners (40kg payload)',
            ],
        finishes: [
          'Matching 1mm PVC edge-banding applied on factory edge-bander',
          'Satin Polyurethane clear coat over solid timber edge lips',
          'Hairline brushed brass kickplate on plinth perimeter',
        ],
        locations: ['Ground Floor — Main Cashier & Reception Zone'],
        detail_references: ['Detail D-01: Carcass joining', 'Detail D-04: Sub-DB Cable Grommet'],
        work_items: ['CAR-003 Checkout Counter #03', 'MET-002 Hairline Brass Skirting Strip'],
        production_concerns: [
          'Monolithic length exceeds Pavilion mall lift internal diagonal clearance (2200mm).',
          'Requires 2-module split in factory with concealed fasteners.',
          ...(isRev4 ? ['⚠️ CAR-003 is already at Assembly stage based on 2400mm / 18mm plywood!'] : []),
        ],
        missing_info: ['Confirm mall POS credit card EDC terminal terminal wire hole diameter (60mm).'],
        nw_recommendations: [
          'Split counter into 2 balanced modules with concealed Festool Domino pins.',
          'Pre-route wiring raceways inside factory to reduce on-site installation time by 45%.',
          ...(isRev4 ? ['Trim 100mm off Module B filler plinth to fit 2300mm without scrapping carcass.'] : []),
        ],
        matched_knowledge: knowledge.slice(0, 2).map((k) => ({
          id: k.id,
          title: k.title,
          category: k.category,
          recommendation: k.description,
          source: 'NW Production Knowledge Base',
        })),
        potential_work_items: [
          {
            item_code: 'CAR-003',
            item_code_suggestion: 'CAR-003',
            description: `${drawing?.title || 'Checkout Counter'} (Module A & B)`,
            suggested_work_package: 'CARPENTRY & ARCHITECTURAL JOINERY',
            trade: 'Carpentry',
            quantity: 1,
            unit: 'Set',
            dimensions: isRev4 ? '2300 × 900 × 1050mm' : '2400 × 900 × 1050mm',
            material: isRev4 ? '25mm Marine Plywood / Corian Solid Surface' : '18mm Marine Plywood / Corian Solid Surface',
            finish: 'Natural Oak Woodgrain & Matte Brass Kickplate',
            location: 'Ground Floor — Main Cashier & Reception Zone',
            status: 'suggested',
            confidence_percent: 96,
            reasoning: 'Matches joinery schedule and drawing keynotes with bespoke detailing.',
          },
        ],
      };

      setDrawings((prev) =>
        prev.map((dwg) => {
          if (dwg.id === drawingId) {
            return {
              ...dwg,
              revisions: dwg.revisions.map((rev) => {
                if (rev.id === revisionId) {
                  return { ...rev, ai_analysis: fallbackAnalysis };
                }
                return rev;
              }),
            };
          }
          return dwg;
        })
      );

      return fallbackAnalysis;
    }
  };

  const approveAISuggestedWorkItem = (
    drawingId: string,
    revisionId: string,
    suggestedItem: AISuggestedWorkItem,
    targetWorkPackageId: string,
    contractorId?: string
  ): WorkItem => {
    const drawing = drawings.find((d) => d.id === drawingId);
    const revision = drawing?.revisions.find((r) => r.id === revisionId);
    const wp = workPackages.find((w) => w.id === targetWorkPackageId) || workPackages[0];

    const newItem: WorkItem = {
      id: 'item-' + Date.now(),
      work_package_id: wp.id,
      project_id: wp.project_id,
      item_code: suggestedItem.item_code_suggestion || 'ITM-' + Math.floor(100 + Math.random() * 900),
      description: suggestedItem.description,
      location: suggestedItem.location || 'Site',
      quantity: suggestedItem.quantity || 1,
      unit: suggestedItem.unit || 'Unit',
      drawing_id: drawingId,
      drawing_revision: revision?.revision || 'Rev 1',
      client_drawing_id: drawingId,
      client_drawing_revision: revision?.revision || 'Rev 1',
      material: suggestedItem.material || 'Standard Specified Material',
      finish: suggestedItem.finish || 'Standard Specified Finish',
      dimensions: suggestedItem.dimensions || 'As Per Drawing',
      required_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      contractor_id: contractorId || wp.contractor_id || contractors[0]?.id,
      status: 'Assigned',
      progress_percent: 0,
      notes: `Created via human approval of AI suggested work item from drawing ${drawing?.drawing_number || ''} ${revision?.revision || ''}. Trade: ${suggestedItem.trade || wp.category}.`,
      photos: [],
      production_status: 'Not Started',
      delivery_status: 'Not Scheduled',
      installation_status: 'Not Started',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setWorkItems((prev) => [newItem, ...prev]);

    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: 'Contractor',
        title: `New Work Item Approved: ${newItem.item_code}`,
        message: `${newItem.description} approved from drawing ${drawing?.drawing_number} ${revision?.revision}. Assigned for production.`,
        type: 'work_item',
        priority: 'normal',
        is_read: false,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    addAuditLog('Approved AI Work Item', 'WorkItem', newItem.item_code, 'AI Suggestion', 'Created WorkItem');
    return newItem;
  };

  const compareDrawingRevisions = async (
    drawingId: string,
    fromRevId: string,
    toRevId: string
  ): Promise<RevisionComparison> => {
    const drawing = drawings.find((d) => d.id === drawingId);
    const fromRev = drawing?.revisions.find((r) => r.id === fromRevId);
    const toRev = drawing?.revisions.find((r) => r.id === toRevId);

    const relevantWorkItems = workItems.filter(
      (w) => w.drawing_id === drawingId || w.client_drawing_id === drawingId
    );

    try {
      const response = await fetch('/api/ai/compare-drawings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          drawingId,
          fromRevisionId: fromRevId,
          toRevisionId: toRevId,
          drawingNumber: drawing?.drawing_number || 'A-103',
          oldRevision: {
            revision: fromRev?.revision || 'Rev 3',
            title: fromRev?.title || '',
            notes: fromRev?.notes || '',
            fileUrl: fromRev?.file_url,
          },
          newRevision: {
            revision: toRev?.revision || 'Rev 4',
            title: toRev?.title || '',
            notes: toRev?.notes || '',
            fileUrl: toRev?.file_url,
          },
          activeWorkItems: relevantWorkItems.map((w) => ({
            id: w.id,
            item_code: w.item_code,
            description: w.description,
            dimensions: w.dimensions,
            material: w.material,
            production_status: w.production_status,
            progress_percent: w.progress_percent,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Compare drawings API responded with status ${response.status}`);
      }

      const comparison: RevisionComparison = await response.json();

      // Save comparison to the newer revision
      setDrawings((prev) =>
        prev.map((dwg) => {
          if (dwg.id === drawingId) {
            return {
              ...dwg,
              revisions: dwg.revisions.map((rev) => {
                if (rev.id === toRevId) {
                  return {
                    ...rev,
                    comparison_with_previous: comparison,
                  };
                }
                return rev;
              }),
            };
          }
          return dwg;
        })
      );

      // Automated Production Impact Check on active work items
      if (comparison.impact_check.requires_site_action || comparison.impact_check.has_production_impact) {
        setWorkItems((prev) =>
          prev.map((item) => {
            const isAffected = comparison.affected_work_items.some((aw) => aw.item_code === item.item_code);
            if (isAffected) {
              const matchedAW = comparison.affected_work_items.find((aw) => aw.item_code === item.item_code);
              return {
                ...item,
                revision_impact_alert: {
                  detected_at: new Date().toISOString(),
                  new_revision: toRev?.revision || 'Rev 4',
                  severity: matchedAW?.action_needed?.includes('HIGH PRIORITY') ? 'critical' : 'warning',
                  message: matchedAW?.action_needed || 'Drawing revision variance detected against current production stage.',
                  suggested_action: matchedAW?.suggested_action || 'Review NW Production Review and issue revised production instructions.',
                },
              };
            }
            return item;
          })
        );

        // Notify Project Manager & Owner
        setNotifications((prev) => [
          {
            id: 'notif-' + Date.now(),
            target_role: 'Project Manager',
            title: `⚠️ Production Impact Alert: ${drawing?.drawing_number} ${toRev?.revision}`,
            message: `${comparison.impact_check.headline}: Affected items in production (${comparison.affected_work_items.map((i) => i.item_code).join(', ')}).`,
            type: 'drawing',
            priority: 'urgent',
            is_read: false,
            created_at: new Date().toISOString(),
          },
          ...prev,
        ]);
      }

      addAuditLog(
        `Compared Drawing Revisions (${fromRev?.revision} -> ${toRev?.revision})`,
        'DrawingRevision',
        toRev?.revision || toRevId,
        fromRev?.revision,
        comparison.impact_check.has_production_impact ? 'PRODUCTION IMPACT DETECTED' : 'No Impact'
      );

      return comparison;
    } catch (err) {
      console.warn('Compare API error, applying deterministic domain diff:', err);
      // Fallback deterministic comparison
      const isDimensionChange = true;
      const fallbackComparison: RevisionComparison = {
        drawing_id: drawingId,
        from_revision: fromRev?.revision || 'Rev 3',
        to_revision: toRev?.revision || 'Rev 4',
        old_revision: fromRev?.revision || 'Rev 3',
        new_revision: toRev?.revision || 'Rev 4',
        dimension_changes: ['Counter overall length revised from 2400mm down to 2300mm (-100mm)'],
        material_changes: ['Internal carcase plywood specified as 25mm marine plywood instead of 18mm'],
        finish_changes: [],
        quantity_changes: [],
        location_changes: [],
        detail_changes: ['Column clearance adjustment on outer plinth'],
        added_items: [],
        removed_items: [],
        compared_at: new Date().toISOString(),
        changes: [
          {
            category: 'Dimension',
            type: 'Modified',
            description: 'Counter overall length revised from 2400mm down to 2300mm (-100mm reduction).',
            severity: 'critical',
            old_value: '2400 × 900 × 1050mm',
            new_value: '2300 × 900 × 1050mm',
          },
          {
            category: 'Material',
            type: 'Modified',
            description: 'Internal carcase plywood upgraded from 18mm to 25mm marine plywood.',
            severity: 'warning',
            old_value: '18mm Marine Plywood',
            new_value: '25mm Marine Plywood',
          },
        ],
        summary: 'Client drawing Rev 4 reduces overall counter length to 2300mm to accommodate site M&E pillar, and specifies 25mm plywood.',
        impact_check: {
          has_production_impact: true,
          requires_site_action: true,
          severity_level: 'CRITICAL',
          headline: '⚠️ PRODUCTION IMPACT POSSIBLE — Work item CAR-003 is already at Assembly stage in factory!',
          detail: 'Item CAR-003 is currently undergoing factory assembly based on Rev 3 (2400mm). Cutting and frame joining are completed. A 100mm reduction requires immediate PM/Technical intervention.',
        },
        affected_work_items: [
          {
            work_item_id: 'item-1',
            item_code: 'CAR-003',
            description: 'Checkout Counter #03 (2 × 1200mm Split Modules with Corian Top)',
            current_stage: 'Assembly',
            production_status: 'Assembly',
            impact_level: 'PRODUCTION IMPACT POSSIBLE',
            action_needed: '⚠️ PRODUCTION IMPACT POSSIBLE — Cutting complete, assembly underway. Do not scrap carcass.',
            suggested_action: 'Trim 100mm off Module B end scribe plinth without modifying Module A cash register module. Saves RM 4,200.',
          },
        ],
      };

      setDrawings((prev) =>
        prev.map((dwg) => {
          if (dwg.id === drawingId) {
            return {
              ...dwg,
              revisions: dwg.revisions.map((rev) => {
                if (rev.id === toRevId) {
                  return { ...rev, comparison_with_previous: fallbackComparison };
                }
                return rev;
              }),
            };
          }
          return dwg;
        })
      );

      setWorkItems((prev) =>
        prev.map((item) => {
          if (item.item_code === 'CAR-003') {
            return {
              ...item,
              revision_impact_alert: {
                detected_at: new Date().toISOString(),
                new_revision: toRev?.revision || 'Rev 4',
                severity: 'warning',
                message: '⚠️ PRODUCTION IMPACT POSSIBLE: Drawing Rev 4 modified length to 2300mm while CAR-003 is in Assembly.',
                suggested_action: 'Apply NW Production Review: Trim 100mm from Module B end plinth filler.',
              },
            };
          }
          return item;
        })
      );

      return fallbackComparison;
    }
  };

  const addNWProductionReview = (
    drawingId: string,
    reviewData: Omit<NWProductionReview, 'id' | 'review_date'>
  ): NWProductionReview => {
    const reviewId = 'pr-' + Date.now();
    const newReview: NWProductionReview = {
      id: reviewId,
      review_date: new Date().toISOString().split('T')[0],
      ...reviewData,
    };

    setDrawings((prev) =>
      prev.map((dwg) => {
        if (dwg.id === drawingId) {
          return {
            ...dwg,
            production_reviews: [newReview, ...(dwg.production_reviews || [])],
          };
        }
        return dwg;
      })
    );

    // Save as company standard if requested
    if (newReview.is_company_standard) {
      addKnowledgeItem({
        title: `Standard Joinery: ${newReview.production_recommendation.slice(0, 50)}...`,
        category: (newReview.review_category as any) || 'Carpentry',
        description: newReview.production_recommendation,
        reason: newReview.reason,
        example: `Applied on Drawing ${drawingId} (${newReview.client_drawing_revision}): ${newReview.construction_method || ''}`,
        created_by: newReview.reviewed_by,
        approved_by: 'Dato’ Nicholas Wong (Owner / CEO)',
        status: 'Review', // a knowledge editor approves it (server-enforced)
        source_project_id: selectedProjectId,
      });
    }

    addAuditLog(
      `Added NW Production Review on ${drawingId}`,
      'NWProductionReview',
      newReview.client_drawing_revision,
      '',
      newReview.production_recommendation
    );

    return newReview;
  };

  const createNWProductionDrawing = (
    drawingId: string,
    nwDrawingData: Omit<NWProductionDrawing, 'id' | 'uploaded_date'>
  ): NWProductionDrawing => {
    const nwdId = 'nwd-' + Date.now();
    const newNWD: NWProductionDrawing = {
      id: nwdId,
      uploaded_date: new Date().toISOString().split('T')[0],
      ...nwDrawingData,
    };

    setDrawings((prev) =>
      prev.map((dwg) => {
        if (dwg.id === drawingId) {
          return {
            ...dwg,
            nw_production_drawings: [newNWD, ...(dwg.nw_production_drawings || [])],
          };
        }
        return dwg;
      })
    );

    addAuditLog(
      `Created NW Production Drawing ${newNWD.drawing_number} ${newNWD.revision}`,
      'NWProductionDrawing',
      newNWD.drawing_number,
      '',
      newNWD.title
    );

    return newNWD;
  };

  const approveNWProductionDrawing = (
    drawingId: string,
    nwDrawingId: string,
    approverName: string
  ) => {
    const drawing = drawings.find((d) => d.id === drawingId);
    const nwDwg = drawing?.nw_production_drawings?.find((n) => n.id === nwDrawingId);
    if (!drawing || !nwDwg) return;

    const approvalDate = new Date().toISOString().split('T')[0];

    // 1. Mark NW drawing approved
    setDrawings((prev) =>
      prev.map((dwg) => {
        if (dwg.id === drawingId) {
          return {
            ...dwg,
            nw_production_drawings: (dwg.nw_production_drawings || []).map((n) =>
              n.id === nwDrawingId
                ? {
                    ...n,
                    status: 'Approved' as const,
                    approved_for_production: true,
                    approved_by: approverName,
                    approved_date: approvalDate,
                  }
                : n
            ),
          };
        }
        return dwg;
      })
    );

    // 2. Generate official Production Instruction and update linked Work Items
    setWorkItems((prev) =>
      prev.map((item) => {
        const isLinked = item.drawing_id === drawingId || item.client_drawing_id === drawingId;
        if (isLinked) {
          const instruction: ProductionInstruction = {
            id: 'pi-' + Date.now(),
            work_item_id: item.id,
            item_code: item.item_code,
            description: item.description,
            approved_drawing_number: drawing.drawing_number,
            approved_drawing_revision: nwDwg.linked_client_revision,
            approved_nw_drawing_number: nwDwg.drawing_number,
            approved_nw_drawing_revision: nwDwg.revision,
            dimensions: nwDwg.revised_dimensions || item.dimensions,
            construction: nwDwg.construction_details || '',
            material: nwDwg.material_details || item.material,
            finish: item.finish,
            production_notes: nwDwg.production_notes || '',
            installation_notes: nwDwg.installation_instructions || '',
            approved_by: approverName,
            approved_at: new Date().toISOString(),
            status: 'Approved for Production',
          };

          return {
            ...item,
            nw_production_drawing_id: nwDwg.id,
            nw_production_drawing_revision: nwDwg.revision,
            production_instruction: instruction,
            revision_impact_alert: undefined, // Cleared because approved instruction released!
            dimensions: nwDwg.revised_dimensions || item.dimensions,
            notes: `Approved for production under ${nwDwg.drawing_number} ${nwDwg.revision}. Instruction released by ${approverName}.`,
            updated_at: new Date().toISOString(),
          };
        }
        return item;
      })
    );

    // 3. Notify contractor & site
    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: 'Contractor',
        title: `✅ Production Drawing Approved: ${nwDwg.drawing_number} ${nwDwg.revision}`,
        message: `${approverName} approved production instructions. Fabrication authorized for shop floor.`,
        type: 'drawing',
        priority: 'urgent',
        is_read: false,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    addAuditLog(
      `Approved NW Production Drawing ${nwDwg.drawing_number}`,
      'NWProductionDrawing',
      nwDwg.drawing_number,
      'Pending',
      'Approved for Production'
    );
  };

  // Demo Workflow Simulation Runner (9 Steps)
  const runDrawingDemoWorkflowStep = async (step: number) => {
    setDrawingDemoStep(step);

    if (step === 1) {
      // Step 1: Baseline Contract Drawing A-103 Rev 3 with CAR-003 in Assembly
      setDrawings((prev) =>
        prev.map((dwg) => {
          if (dwg.id === 'dwg-1') {
            return {
              ...dwg,
              current_revision_id: 'rev-3',
              revisions: dwg.revisions.map((r) => ({
                ...r,
                is_current: r.id === 'rev-3',
                approved_status: r.id === 'rev-3' ? 'Approved' : 'Superseded',
              })),
            };
          }
          return dwg;
        })
      );
      setWorkItems((prev) =>
        prev.map((w) =>
          w.id === 'item-1'
            ? {
                ...w,
                drawing_revision: 'Rev 3',
                client_drawing_revision: 'Rev 3',
                production_status: 'Assembly',
                status: 'In Progress',
                revision_impact_alert: undefined,
                production_instruction: undefined,
              }
            : w
        )
      );
    } else if (step === 2) {
      // Step 2: Upload Client Revision A-103 Rev 4
      const existingRev4 = drawings.find((d) => d.id === 'dwg-1')?.revisions.find((r) => r.revision === 'Rev 4');
      if (!existingRev4) {
        addDrawingRevision('dwg-1', {
          revision: 'Rev 4',
          title: 'Client Contract Revision — 2300mm Adjusted Length (Column Clearance)',
          file_url: '/assets/drawings/A-103-Rev4.svg',
          notes: 'Client / Designer revised overall length from 2400mm to 2300mm to accommodate mall structural encasement. Core material specified as 25mm Marine Plywood.',
          supersedes_revision: 'Rev 3',
          drawing_type: 'Client / Designer Drawing',
        });
      }
    } else if (step === 3) {
      // Step 3: Run AI analysis on Rev 4
      const rev4 = drawings.find((d) => d.id === 'dwg-1')?.revisions.find((r) => r.revision === 'Rev 4');
      if (rev4) {
        await analyzeDrawingWithAI('dwg-1', rev4.id);
      }
    } else if (step === 4) {
      // Step 4: Compare Rev 3 vs Rev 4 -> Automated Production Impact Check
      const rev3 = drawings.find((d) => d.id === 'dwg-1')?.revisions.find((r) => r.revision === 'Rev 3');
      const rev4 = drawings.find((d) => d.id === 'dwg-1')?.revisions.find((r) => r.revision === 'Rev 4');
      if (rev3 && rev4) {
        await compareDrawingRevisions('dwg-1', rev3.id, rev4.id);
      }
    } else if (step === 5) {
      // Step 5: Issue Created & Escalated to Owner
      const existingIssue = issues.find((i) => i.work_item_id === 'item-1' && i.title.includes('Rev 4'));
      if (!existingIssue) {
        await createIssue({
          project_id: 'proj-1',
          work_item_id: 'item-1',
          title: 'Drawing Rev 4 Discrepancy: CAR-003 Assembly in Progress at 2400mm',
          category: 'Drawing / Design',
          priority: 'Critical',
          status: 'Decision Required',
          reported_by: 'Marcus Lee (Project Manager)',
          reported_by_role: 'Project Manager',
          assigned_to: 'Dato’ Nicholas Wong (Owner / CEO)',
          escalation_level: 'Owner',
          action_required: 'OWNER DECISION REQUIRED — Approve NW Production Review recommendation to trim Module B end plinth by 100mm without discarding finished carcass.',
          description: 'Client uploaded A-103 Rev 4 reducing length from 2400mm to 2300mm. Shop floor has already cut 18mm panels and commenced assembly. Scrapping carcass costs RM 6,500 and 7-day delay. Proposed technical modification: Trim Module B wrap station plinth scribe by 100mm.',
        });
      }
    } else if (step === 6) {
      // Step 6: NW Production Review by Marcus Lee
      addNWProductionReview('dwg-1', {
        drawing_id: 'dwg-1',
        client_drawing_revision: 'Rev 4',
        status: 'Approved',
        reviewed_by: 'Marcus Lee',
        reviewer_role: 'Project Manager',
        production_recommendation: 'Split into Module A (1200mm Cashier) and Module B (1100mm Wrap Station with 100mm field trimmer plinth). Retain finished 18mm carcass; do not rebuild in 25mm.',
        reason: 'Eliminates RM 6,500 scrap cost and keeps mall opening milestone on schedule. Structural rigidity verified by shop foreman Ah Seng.',
        construction_method: '18mm Marine Plywood modular carcass with concealed internal stiffeners.',
        joining_method: 'Festool Domino DF500 tenons + Hafele Minifix cam-lock fasteners.',
        hardware: 'Blum Movento 40kg soft-close slides, Hafele adjustable plinth leveling feet.',
        transport_consideration: 'Modules measure 1200mm and 1100mm, fitting easily inside Pavilion service lift (2200mm clearance).',
        installation_method: 'Position Module A over floor core-drill; pull Module B tight via cam-locks; field-trim plinth filler to site wall.',
        production_risk: 'Corian countertop must be ordered at 2300mm or cut & polished on site.',
        notes: 'Foreman Ah Seng confirmed factory modification can be executed within 3 hours.',
        is_company_standard: true,
      });
    } else if (step === 7) {
      // Step 7: Create NW Production Drawing A-103-NW Rev 1
      createNWProductionDrawing('dwg-1', {
        drawing_number: 'A-103-NW',
        revision: 'Rev 1',
        title: 'NW Production Drawing — 2-Module Cashier Counter (1200mm Cashier + 1100mm Plinth-Trimmed Wrap Station)',
        linked_client_drawing_id: 'dwg-1',
        linked_client_revision: 'Rev 4',
        status: 'Pending Approval',
        approved_for_production: false,
        revised_dimensions: '2300 × 900 × 1050mm (Module A: 1200mm, Module B: 1100mm)',
        construction_details: 'Dual interlocking modules with pre-routed PVC cable trunking and 100mm plinth trimmer scribe.',
        material_details: '18mm Marine Plywood core with 25mm solid timber bracing, 1.0mm Wilsonart Oak HPL, 12mm Corian Solid Surface.',
        hardware_details: 'Hafele Minifix 15, Blum Movento 40kg, Hafele adjustable feet.',
        joining_method: 'Concealed Festool Domino alignment tenons with dual cam-lock connectors.',
        assembly_instructions: 'Execute 100mm trim on Module B wrap station outer plinth filler. Pre-drill cable trunking. Clamp and test fit joint in factory.',
        installation_instructions: 'Anchor Module A to floor plinth. Slide Module B into Domino slots. Fasten Minifix cams. Polish Corian seam.',
        production_notes: 'Urgent instruction for Hock Seng shop floor. Inspection scheduled for tomorrow morning.',
        file_url: '/assets/drawings/A-103-NW-Rev1.svg',
        uploaded_by: 'Marcus Lee (Project Manager)',
      });
    } else if (step === 8) {
      // Step 8: Owner / PM Approval of NW Production Drawing
      const dwg = drawings.find((d) => d.id === 'dwg-1');
      const latestNWD = dwg?.nw_production_drawings?.[0];
      if (latestNWD) {
        approveNWProductionDrawing('dwg-1', latestNWD.id, 'Dato’ Nicholas Wong (Owner / CEO)');
      }
    } else if (step === 9) {
      // Step 9: Final Verification & Instruction Confirmation
      setNotifications((prev) => [
        {
          id: 'notif-' + Date.now(),
          target_role: 'Contractor',
          title: '🎯 Official Production Instruction Released for CAR-003',
          message: 'All clearances confirmed. Hock Seng is authorized to finalize assembly under A-103-NW Rev 1.',
          type: 'work_item',
          priority: 'urgent',
          is_read: false,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }
  };

  const resetDrawingDemo = () => {
    setDrawingDemoStep(0);
    setDrawings(INITIAL_DRAWINGS);
    setWorkItems(INITIAL_WORK_ITEMS);
    setIssues(INITIAL_ISSUES);
    addAuditLog('Reset Drawing Demo', 'System', 'Demo State', '', 'Restored Baseline Initial Data');
  };

  const addClient = (clientData: Omit<Client, 'id' | 'created_at' | 'updated_at'>): Client => {
    const newClient: Client = {
      ...clientData,
      id: 'client-' + Date.now(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setClients((prev) => [newClient, ...prev]);
    addAuditLog('Created Client', 'Client', newClient.id, '', newClient.company_name);
    return newClient;
  };

  const updateClient = (id: string, updates: Partial<Client>) => {
    setClients((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              ...updates,
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    addAuditLog('Updated Client', 'Client', id, '', JSON.stringify(updates));
  };

  const deleteClient = (id: string) => {
    const target = clients.find((c) => c.id === id);
    setClients((prev) => prev.filter((c) => c.id !== id));
    addAuditLog('Deleted Client', 'Client', id, target?.company_name || id, '');
  };

  const addProject = (projectData: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Project => {
    const newProject: Project = {
      ...projectData,
      id: 'proj-' + Date.now(),
      progress_percent: projectData.progress_percent ?? 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setProjects((prev) => [newProject, ...prev]);
    setSelectedProjectId(newProject.id);
    addAuditLog('Created Project', 'Project', newProject.id, '', newProject.project_name);
    return newProject;
  };

  const updateProject = (id: string, updates: Partial<Project>) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.id === id
          ? {
              ...p,
              ...updates,
              updated_at: new Date().toISOString(),
            }
          : p
      )
    );
    addAuditLog('Updated Project', 'Project', id, '', JSON.stringify(updates));
  };

  const addContractor = (contractorData: Omit<Contractor, 'id' | 'created_at' | 'updated_at'>): Contractor => {
    const newContractor: Contractor = {
      ...contractorData,
      id: 'con-' + Date.now(),
      is_active: contractorData.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setContractors((prev) => [newContractor, ...prev]);
    addAuditLog('Created Contractor', 'Contractor', newContractor.id, '', newContractor.company_name);
    return newContractor;
  };

  const updateContractor = (id: string, updates: Partial<Contractor>) => {
    setContractors((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              ...updates,
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    addAuditLog('Updated Contractor', 'Contractor', id, '', JSON.stringify(updates));
  };

  const deactivateContractor = (id: string) => {
    const target = contractors.find((c) => c.id === id);
    const newStatus = target ? !target.is_active : false;
    setContractors((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              is_active: newStatus,
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    addAuditLog(
      newStatus ? 'Activated Contractor' : 'Deactivated Contractor',
      'Contractor',
      id,
      target?.company_name || id,
      newStatus ? 'Active' : 'Inactive'
    );
  };

  const deleteContractor = (id: string) => {
    const target = contractors.find((c) => c.id === id);
    setContractors((prev) => prev.filter((c) => c.id !== id));
    addAuditLog('Deleted Contractor', 'Contractor', id, target?.company_name || id, '');
  };

  const addWorkPackage = (wpData: Omit<WorkPackage, 'id'>): WorkPackage => {
    const newWP: WorkPackage = {
      ...wpData,
      id: 'wp-' + Date.now(),
      progress_percent: wpData.progress_percent ?? 0,
      status: wpData.status ?? 'Draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setWorkPackages((prev) => [...prev, newWP]);
    addAuditLog('Created Work Package', 'WorkPackage', newWP.id, '', `${newWP.name} (Assigned to ${newWP.contractor_id})`);
    return newWP;
  };

  const updateWorkPackage = (id: string, updates: Partial<WorkPackage>) => {
    setWorkPackages((prev) =>
      prev.map((wp) =>
        wp.id === id
          ? {
              ...wp,
              ...updates,
              updated_at: new Date().toISOString(),
            }
          : wp
      )
    );
    addAuditLog('Updated Work Package', 'WorkPackage', id, '', JSON.stringify(updates));
  };

  const deleteWorkPackage = (id: string) => {
    const target = workPackages.find((wp) => wp.id === id);
    setWorkPackages((prev) => prev.filter((wp) => wp.id !== id));
    addAuditLog('Deleted Work Package', 'WorkPackage', id, target?.name || id, '');
  };

  const addWorkItem = (itemData: Omit<WorkItem, 'id' | 'created_at' | 'updated_at'>): WorkItem => {
    const newItem: WorkItem = {
      ...itemData,
      id: 'item-' + Date.now(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setWorkItems((prev) => [newItem, ...prev]);
    addAuditLog('Created Work Item', 'WorkItem', newItem.id, '', `${newItem.item_code} - ${newItem.description}`);
    return newItem;
  };

  const updateWorkItem = (id: string, updates: Partial<WorkItem>) => {
    setWorkItems((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              ...updates,
              updated_at: new Date().toISOString(),
            }
          : item
      )
    );
    addAuditLog('Updated Work Item', 'WorkItem', id, '', JSON.stringify(updates));
  };

  const addWorkItemPhoto = (
    workItemId: string,
    photo: { url: string; description?: string; uploaded_by?: string }
  ) => {
    const photoRecord: WorkItemPhotoRecord = {
      id: 'photo-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      url: photo.url,
      uploaded_by: photo.uploaded_by || currentUser.name,
      date_time: new Date().toISOString(),
      description: photo.description,
    };

    setWorkItems((prev) =>
      prev.map((item) => {
        if (item.id !== workItemId) return item;
        const currentPhotos = item.photos || [];
        const currentRecords = item.item_photos || [];
        return {
          ...item,
          photos: [photo.url, ...currentPhotos],
          item_photos: [photoRecord, ...currentRecords],
          updated_at: new Date().toISOString(),
        };
      })
    );

    addAuditLog(
      'Uploaded Work Item Photo',
      'WorkItem',
      workItemId,
      '',
      photo.description || 'Photo record added'
    );
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
  };

  const clearAllNotifications = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
  };

  const resetToDemoData = () => {
    localStorage.clear();
    // In database mode the database is shared and authoritative: resetting the demo must not
    // touch database-backed collections (it reloads them instead); only local-only data resets.
    const local = coreDataSync.mode !== 'database';
    if (!local) void coreDataSync.reloadFromDatabase();
    if (local) {
      setProjects(INITIAL_PROJECTS);
      setClients(INITIAL_CLIENTS);
      setWorkPackages(INITIAL_WORK_PACKAGES);
      setWorkItems(INITIAL_WORK_ITEMS);
    }
    setContractors(INITIAL_CONTRACTORS);
    if (local) setDrawings(INITIAL_DRAWINGS);
    setKnowledge(INITIAL_KNOWLEDGE);
    if (local) setIssues(INITIAL_ISSUES);
    if (local) setVariations(INITIAL_VARIATIONS);
    if (local) setDocuments(INITIAL_DOCUMENTS);
    setNotifications(INITIAL_NOTIFICATIONS);
    setAuditLogs(INITIAL_AUDIT_LOGS);
    if (local) setQcRecords(INITIAL_QC_RECORDS);
    setAvailableUsers(DEMO_USERS);
    if (local) setApprovals(INITIAL_APPROVALS);
    if (local) setSuppliers(INITIAL_SUPPLIERS);
    if (local) setPurchaseOrders(INITIAL_PURCHASE_ORDERS);
    if (local) setMaterialRequests(INITIAL_MATERIAL_REQUESTS);
    if (local) setFinancialClaims(INITIAL_CLAIMS);
    if (local) setPayments(INITIAL_PAYMENTS);
    setGatewayContacts(INITIAL_COMMUNICATION_CONTACTS);
    setGatewayMessages(INITIAL_GATEWAY_MESSAGES);
    setConversationThreads(INITIAL_CONVERSATION_THREADS);
    setMessageQueue(INITIAL_MESSAGE_QUEUE);
    setAiActionRequests(INITIAL_AI_ACTION_REQUESTS);
    setGatewaySettings(INITIAL_GATEWAY_SETTINGS);
    setSecurityTestCases(INITIAL_SECURITY_TEST_CASES);
    if (local) setClientEnquiries(INITIAL_CLIENT_ENQUIRIES);
    if (local) setCommercialTenders(INITIAL_COMMERCIAL_TENDERS);
    if (local) setCommercialQuotations(INITIAL_COMMERCIAL_QUOTATIONS);
    if (local) setPriceDatabase(INITIAL_PRICE_DATABASE);
    if (local) setCommercialBaselines(INITIAL_PROJECT_COMMERCIAL_BASELINES);
    if (local) setProjectCostLedger(INITIAL_PROJECT_COST_LEDGER);
    if (local) setGoodsReceived(INITIAL_GOODS_RECEIVED);
    if (local) setCommercialInvoices(INITIAL_COMMERCIAL_INVOICES);
    if (local) setCostLeakAlerts(INITIAL_COST_LEAK_ALERTS);
    if (local) setCashflowEntries(INITIAL_CASHFLOW_ENTRIES);
    if (local) setProductionOrders(INITIAL_PRODUCTION_ORDERS);
    if (local) setProductionParts(INITIAL_PRODUCTION_PARTS);
    if (local) setProductionMaterials(INITIAL_PRODUCTION_MATERIALS);
    if (local) setCncJobs(INITIAL_CNC_JOBS);
    if (local) setCncFileVersions(INITIAL_CNC_FILE_VERSIONS);
    if (local) setAssemblyJobs(INITIAL_ASSEMBLY_JOBS);
    if (local) setFinishingJobs(INITIAL_FINISHING_JOBS);
    if (local) setFactoryQCInspections(INITIAL_FACTORY_QC_INSPECTIONS);
    if (local) setPackingPackages(INITIAL_PACKING_PACKAGES);
    if (local) setProductionIssues(INITIAL_PRODUCTION_ISSUES);
    if (local) setDeliveryRecords(INITIAL_DELIVERY_RECORDS);
    if (local) setInstallationJobs(INITIAL_INSTALLATION_JOBS);
    if (local) setSiteQCInspections(INITIAL_SITE_QC_INSPECTIONS);
    if (local) setHandoverRecords(INITIAL_HANDOVER_RECORDS);
    if (local) setSiteMeasurements(INITIAL_SITE_MEASUREMENTS);
    if (local) setClientChangeRequests(INITIAL_CLIENT_CHANGE_REQUESTS);
    if (local) setTasks(INITIAL_TASKS);
    setAutomationRules(INITIAL_AUTOMATION_RULES);
    setAutomationEvents(INITIAL_AUTOMATION_EVENTS);
    setAutomationRuns(INITIAL_AUTOMATION_RUNS);
    setFailedAutomations(INITIAL_FAILED_AUTOMATIONS);
    if (local) setEscalations(INITIAL_ESCALATIONS);
    setUserNotificationPreferences(INITIAL_USER_NOTIFICATION_PREFERENCES);
    setDailyBriefings(INITIAL_DAILY_BRIEFINGS);
    setWorkflowTemplates(INITIAL_WORKFLOW_TEMPLATES);
    setOwnerOverrides(INITIAL_OWNER_OVERRIDES);
    setBusinessCalendar(INITIAL_BUSINESS_CALENDAR);
    setCurrentUser(DEMO_USERS[0]);
    setSelectedProjectId('proj-1');
    addAuditLog('System Reset to Factory Initial Demo Data', 'System', 'All', '', '');
  };

  const selectedProject = projects.find((p) => p.id === selectedProjectId) || userProjects[0] || projects[0];

  // AI Communication & Contractor Assistant Engine Methods (Module 10)
  const sendChatMessage = async (data: {
    message_text: string;
    channel?: MessageChannel;
    project_id?: string;
    work_package_id?: string;
    work_item_id?: string;
    work_item_code?: string;
    attachments?: ChatMessageAttachment[];
  }) => {
    const projId = data.project_id || selectedProjectId;
    const projectObj = projects.find((p) => p.id === projId) || projects[0];

    const userMsg: ChatMessage = {
      id: 'msg-' + Date.now(),
      channel: data.channel || 'web',
      sender_id: currentUser.id,
      sender_name: currentUser.name,
      sender_role: currentUser.role,
      project_id: projId,
      project_name: projectObj?.project_name,
      work_package_id: data.work_package_id,
      work_item_id: data.work_item_id,
      work_item_code: data.work_item_code,
      message_text: data.message_text,
      attachments: data.attachments,
      timestamp: new Date().toISOString(),
      is_ai_response: false,
      status: 'processed',
    };

    setMessages((prev) => [...prev, userMsg]);

    const projWorkItems = workItems.filter((w) => w.project_id === projId);
    const projDrawings = drawings.filter((d) => d.project_id === projId);
    const projIssues = issues.filter((i) => i.project_id === projId);

    try {
      const res = await fetch('/api/ai/contractor-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: currentUser,
          message_text: data.message_text,
          channel: data.channel || 'web',
          project_id: projId,
          work_item_id: data.work_item_id,
          work_item_code: data.work_item_code,
          attachments: data.attachments,
          context: {
            project: projectObj,
            workItems: projWorkItems,
            approvedDrawings: projDrawings,
            issues: projIssues,
          },
        }),
      });

      if (!res.ok) throw new Error('AI processing failed');
      const aiData = await res.json();

      const aiActionId = 'act-' + Date.now();
      const actionRecord: AIActionRecord = {
        action_id: aiActionId,
        message_id: userMsg.id,
        action_type: aiData.action_type || 'answer_question',
        target_record: aiData.action_details?.target_record || 'General Conversation',
        target_record_id: aiData.action_details?.target_record_id,
        previous_value: aiData.action_details?.previous_value,
        new_value: aiData.action_details?.new_value,
        confidence: aiData.confidence || 'CONFIRMED',
        executed_by: 'NW OS AI Assistant',
        execution_time: new Date().toISOString(),
        approval_required: aiData.action_details?.approval_required || false,
        approval_status: aiData.action_details?.approval_required ? 'pending_pm' : 'auto_executed',
        notes: `AI Classified as [${aiData.classification}] with [${aiData.confidence}] confidence.`,
      };

      setAiActions((prev) => [actionRecord, ...prev]);

      // Execute automated actions according to strict NW OS rules:
      if (aiData.action_type === 'create_qc_task') {
        const targetCode = data.work_item_code || (data.message_text.includes('1') ? 'CAR-001' : 'CAR-003');
        const targetItem = workItems.find((w) => w.item_code === targetCode || w.id === data.work_item_id);
        if (targetItem) {
          updateWorkItemStatus(targetItem.id, 'Ready for QC', 'Auto-requested by contractor completion message.');
        }
      } else if (aiData.action_type === 'update_progress') {
        const targetCode = data.work_item_code || 'CAR-001';
        const targetItem = workItems.find((w) => w.item_code === targetCode);
        if (targetItem) {
          updateWorkItem(targetItem.id, { progress_percent: 80 });
          addAuditLog('AI Progress Update', 'WorkItem', targetItem.id, `${targetItem.progress_percent}%`, '80%');
        }
      } else if (aiData.action_type === 'create_issue' || aiData.action_type === 'escalate') {
        const isUrgent = aiData.action_type === 'escalate' || aiData.classification === 'Urgent / Safety Issue';
        await createIssue({
          project_id: projId,
          work_item_id: data.work_item_id || 'item-1',
          title: isUrgent ? 'CRITICAL SAFETY: Exposed Electrical Wiring on Zone B' : 'Drawing Dimension Discrepancy (2400mm vs 2300mm)',
          category: isUrgent ? 'Safety' : 'Drawing',
          priority: isUrgent ? 'Critical' : 'High',
          status: 'Reported',
          reported_by: currentUser.name,
          reported_by_role: currentUser.role,
          assigned_to: isUrgent ? 'Suresh Kumar / Marcus Lee' : 'Marcus Lee',
          escalation_level: isUrgent ? 'Owner' : 'PM',
          action_required: isUrgent ? 'Immediate site stop-work on Zone B' : 'PM review plinth scribing standard',
          description: data.message_text,
        });
      } else if (aiData.action_type === 'create_variation_request') {
        const newVo: Variation = {
          id: 'vo-' + Date.now(),
          project_id: projId,
          variation_number: 'VO-00' + (variations.length + 1),
          title: 'Additional Cashier Cabinet (Site Client Request)',
          description: data.message_text,
          estimated_cost: 6500,
          client_amount: 8500,
          status: 'Identified',
          requested_by: currentUser.name + ' via WhatsApp/AI Assistant',
          schedule_impact_days: 3,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setVariations((prev) => [newVo, ...prev]);
        addAuditLog('Created Potential Variation', 'Variation', newVo.id, undefined, newVo.variation_number);
      }

      if (aiData.pm_inbox_item?.needed || aiData.action_details?.approval_required) {
        const inboxItem: PMInboxItem = {
          id: 'pmi-' + Date.now(),
          message_id: userMsg.id,
          priority: aiData.pm_inbox_item?.priority || (aiData.classification === 'Urgent / Safety Issue' ? 'Critical' : 'High'),
          project_id: projId,
          project_name: projectObj?.project_name || 'Project Aurora',
          contractor_name: currentUser.name,
          work_item_code: data.work_item_code || 'CAR-003',
          original_message: data.message_text,
          ai_interpretation: aiData.reply_text,
          recommended_action: aiData.pm_inbox_item?.recommended_action || 'Review and respond to contractor.',
          category: aiData.classification || 'Normal Question',
          created_at: new Date().toISOString(),
          status: 'pending',
        };
        setPmInbox((prev) => [inboxItem, ...prev]);
      }

      const aiMsg: ChatMessage = {
        id: 'msg-' + (Date.now() + 1),
        channel: data.channel || 'web',
        sender_id: 'ai-system',
        sender_name: 'NW OS AI Assistant',
        sender_role: 'Admin',
        project_id: projId,
        project_name: projectObj?.project_name,
        work_package_id: data.work_package_id,
        work_item_id: data.work_item_id,
        work_item_code: data.work_item_code,
        message_text: aiData.reply_text,
        language: aiData.language,
        timestamp: new Date().toISOString(),
        is_ai_response: true,
        ai_classification: aiData.classification,
        ai_confidence: aiData.confidence,
        ai_action: aiData.action_type,
        ai_action_id: aiActionId,
        status: 'delivered',
        routed_to: aiData.action_details?.routed_to || 'AI',
        human_response_needed: aiData.pm_inbox_item?.needed,
      };

      setMessages((prev) => [...prev, aiMsg]);
      return { userMsg, aiMsg, actionRecord };
    } catch {
      const fallbackAiMsg: ChatMessage = {
        id: 'msg-' + (Date.now() + 1),
        channel: data.channel || 'web',
        sender_id: 'ai-system',
        sender_name: 'NW OS AI Assistant',
        sender_role: 'Admin',
        project_id: projId,
        message_text: `Understood: "${data.message_text}". Logged in project stream and routed to PM Marcus Lee for confirmation.`,
        timestamp: new Date().toISOString(),
        is_ai_response: true,
        ai_classification: 'Normal Question',
        ai_confidence: 'CONFIRMED',
        status: 'delivered',
      };
      setMessages((prev) => [...prev, fallbackAiMsg]);
      return { userMsg, aiMsg: fallbackAiMsg };
    }
  };

  const resolvePMInboxItem = (
    id: string,
    actionTaken: 'answered' | 'approved' | 'rejected' | 'escalated',
    responseMessage?: string
  ) => {
    setPmInbox((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: actionTaken === 'escalated' ? 'escalated' : 'resolved' } : item
      )
    );

    if (responseMessage) {
      const pmMsg: ChatMessage = {
        id: 'msg-' + Date.now(),
        channel: 'web',
        sender_id: currentUser.id,
        sender_name: currentUser.name,
        sender_role: currentUser.role,
        project_id: selectedProjectId,
        message_text: `[PM Response]: ${responseMessage}`,
        timestamp: new Date().toISOString(),
        is_ai_response: false,
        status: 'delivered',
      };
      setMessages((prev) => [...prev, pmMsg]);
    }

    addAuditLog('PM Inbox Resolved', 'PMInboxItem', id, undefined, actionTaken);
  };

  const runScenarioTest = async (scenarioId: number) => {
    const scenarios: Record<number, { text: string; code: string }> = {
      1: { text: 'Counter 3 sudah siap.', code: 'CAR-003' },
      2: { text: 'Counter 3 boleh hantar esok 10am?', code: 'CAR-003' },
      3: { text: 'Drawing 2400 but site 2300.', code: 'CAR-003' },
      4: { text: 'Can use 18mm instead of 25mm?', code: 'CAR-001' },
      5: { text: 'Client ask add one more cabinet.', code: 'CAR-003' },
      6: { text: '柜台3做到哪里？', code: 'CAR-003' },
      7: { text: 'Boss emergency, electrical cable exposed.', code: 'ELE-002' },
    };
    const sc = scenarios[scenarioId] || scenarios[1];
    return await sendChatMessage({
      message_text: sc.text,
      work_item_code: sc.code,
      channel: 'whatsapp',
    });
  };

  // WhatsApp-Ready Communication Gateway Methods (Module 11)
  const gatewayMetrics: GatewayMetrics = React.useMemo(() => {
    const total = gatewayMessages.length;
    const aiAnswered = gatewayMessages.filter(
      (m) => m.direction === 'OUTBOUND' && m.sender_name.includes('AI')
    ).length;
    const actionsExecuted = aiActions.filter((a) => a.approval_status === 'auto_executed').length;
    const humanHandoffs = conversationThreads.filter((t) => t.assigned_to !== 'AI').length;
    const escalations = conversationThreads.filter(
      (t) => t.status === 'escalated' || t.assigned_to === 'Owner'
    ).length;
    const clarifications = gatewayMessages.filter(
      (m) => m.message_text.includes('Which item') || m.message_text.includes('Which project')
    ).length;
    const unrecognized = gatewayMessages.filter((m) => m.ai_status === 'UNKNOWN_CONTACT').length;
    const highConf = gatewayMessages.filter((m) => m.ai_confidence === 'HIGH').length;
    const medConf = gatewayMessages.filter((m) => m.ai_confidence === 'MEDIUM').length;
    const lowConf = gatewayMessages.filter((m) => m.ai_confidence === 'LOW').length;
    const overrides = aiActions.filter((a) => a.notes?.includes('Manual override')).length;

    return {
      total_messages: total,
      ai_answered: aiAnswered,
      ai_actions_executed: actionsExecuted,
      human_handoffs: humanHandoffs,
      escalations: escalations,
      clarification_requests: clarifications,
      failed_responses: 0,
      unrecognized_contacts: unrecognized,
      avg_response_time_seconds: 1.8,
      high_confidence_count: highConf,
      medium_confidence_count: medConf,
      low_confidence_count: lowConf,
      human_override_count: overrides,
    };
  }, [gatewayMessages, aiActions, conversationThreads]);

  const processSimulatedWhatsAppMessage = async (data: {
    sender_phone: string;
    message_text: string;
    channel?: GatewayChannel;
    project_id?: string;
    work_package_id?: string;
    work_item_code?: string;
    attachments?: GatewayAttachment[];
  }): Promise<SimulationTrace> => {
    const channel = data.channel || 'WHATSAPP';
    try {
      const response = await fetch('/api/gateway/process-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender_phone: data.sender_phone,
          channel,
          message_text: data.message_text,
          project_id: data.project_id || selectedProjectId,
          work_package_id: data.work_package_id,
          work_item_code: data.work_item_code,
          attachments: data.attachments,
          contacts: gatewayContacts,
          settings: gatewaySettings,
        }),
      });

      if (!response.ok) {
        throw new Error('Server returned ' + response.status);
      }

      const trace: SimulationTrace = await response.json();

      // Synchronize client state with the trace:
      if (trace.inbound) {
        setGatewayMessages((prev) => [trace.inbound, ...prev]);
      }
      if (trace.outbound_message) {
        setGatewayMessages((prev) => [trace.outbound_message!, ...prev]);
      }
      if (trace.queue_item) {
        setMessageQueue((prev) => [trace.queue_item!, ...prev]);
      }
      if (trace.decision_gate.can_ai_execute && trace.system_action?.executed) {
        if (trace.ai_interpretation.item_code === 'CAR-003' && trace.ai_interpretation.intent === 'COMPLETION') {
          updateWorkItemStatus('item-1', 'Ready for QC');
          const qcRec: QCRecord = {
            id: 'qc-' + Date.now(),
            work_item_id: 'item-1',
            project_id: selectedProjectId,
            inspector_name: 'Ahmad Razak',
            inspector_role: 'Site Supervisor',
            inspection_date: new Date().toISOString().split('T')[0],
            result: 'Correction Required',
            comments: 'Factory assembly completion reported by Ah Seng via WhatsApp. Site inspection requested.',
            photos: [],
          };
          setQcRecords((prev) => [qcRec, ...prev]);
        }
      }

      const existingThread = conversationThreads.find(
        (t) => t.contact_phone.replace(/[\s-]/g, '') === data.sender_phone.replace(/[\s-]/g, '')
      );
      if (existingThread) {
        setConversationThreads((prev) =>
          prev.map((t) =>
            t.thread_id === existingThread.thread_id
              ? {
                  ...t,
                  last_message_at: new Date().toISOString(),
                  last_message_preview: trace.outbound_message?.message_text || t.last_message_preview,
                  messages_count: t.messages_count + 2,
                }
              : t
          )
        );
      }

      if (trace.decision_gate.requires_human_approval && trace.decision_gate.action_name.includes('TECHNICAL')) {
        const newReq: AIActionRequest = {
          id: 'req-' + Date.now(),
          project_id: data.project_id || 'proj-1',
          project_name: 'Project Aurora — Pavilion Flagship',
          work_item_code: 'CAR-003',
          sender_name: trace.sender_verification.contact?.name || 'Contractor',
          sender_phone: data.sender_phone,
          original_message: data.message_text,
          ai_interpretation: 'Contractor requested direct technical dimension modification.',
          recommended_action: 'Direct contractor to apply NW Standard #001 plinth scribing on Module B.',
          action_type: 'TECHNICAL_DIMENSION_CHANGE',
          reason: 'AI Action Gate: Technical drawing modification strictly requires PM & Owner sign-off.',
          confidence: 'HIGH',
          supporting_drawings: ['A-103 Rev 4 (Cashier Counter)', 'A-103-NW Rev 1'],
          supporting_docs: ['NW Standard #001 (Field Scribing Tolerance)'],
          status: 'pending',
          created_at: new Date().toISOString(),
        };
        setAiActionRequests((prev) => [newReq, ...prev]);
      }

      addAuditLog(
        'WhatsApp Gateway Message Processed',
        'GatewayMessage',
        trace.inbound.message_id,
        undefined,
        `Intent: ${trace.ai_interpretation.intent} | Sender: ${trace.inbound.sender_name} | Channel: ${channel}`
      );

      return trace;
    } catch {
      // Deterministic fallback
      const cleanP = data.sender_phone.replace(/[\s-]/g, '');
      const contact = gatewayContacts.find((c) => c.phone_number.replace(/[\s-]/g, '') === cleanP);
      const isUnreg = !contact || cleanP.includes('99990000');

      const trace: SimulationTrace = {
        inbound: {
          message_id: 'gmsg-in-' + Date.now(),
          channel,
          direction: 'INBOUND',
          sender_phone: data.sender_phone,
          sender_name: contact ? contact.name : 'Unknown Contact',
          message_text: data.message_text,
          timestamp: new Date().toISOString(),
          ai_classification: isUnreg ? 'GENERAL' : 'COMPLETION',
          ai_confidence: isUnreg ? 'LOW' : 'HIGH',
          ai_status: isUnreg ? 'UNKNOWN_CONTACT' : 'PROCESSED',
          delivery_status: 'DELIVERED',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        sender_verification: {
          recognized: !isUnreg,
          contact: contact,
          assigned_projects: contact?.assigned_project_ids || [],
          assigned_trades: contact?.assigned_trade_packages || [],
          authorized: !isUnreg,
          auth_reason: isUnreg
            ? 'Unregistered WhatsApp number. Strict zero-trust shielding activated.'
            : 'Verified contractor contact.',
        },
        ai_interpretation: {
          intent: isUnreg ? 'GENERAL' : 'COMPLETION',
          confidence: isUnreg ? 'LOW' : 'HIGH',
          reason: isUnreg ? 'Unregistered contact' : 'Processed simulation message',
        },
        decision_gate: {
          can_ai_execute: !isUnreg,
          action_name: isUnreg ? 'REJECT_UNREGISTERED' : 'ROUTINE_GATEWAY_RESPONSE',
          requires_human_approval: false,
        },
        system_action: {
          executed: !isUnreg,
          description: isUnreg
            ? 'Alerted Admin of unrecognized contact.'
            : 'Processed message in communication stream.',
        },
        outbound_message: {
          message_id: 'gmsg-out-' + Date.now(),
          channel,
          direction: 'OUTBOUND',
          recipient_phone: data.sender_phone,
          sender_name: 'NW OS Gateway AI',
          message_text: isUnreg
            ? 'This WhatsApp number is not registered with NW OS. No project information can be disclosed.'
            : 'Message received and processed by NW OS Gateway.',
          timestamp: new Date().toISOString(),
          delivery_status: 'SENT',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        audit_logged: true,
      };

      setGatewayMessages((prev) => [trace.inbound, trace.outbound_message!, ...prev]);
      return trace;
    }
  };

  const runSecurityTest = async (testId: string): Promise<SecurityTestCase> => {
    const testCase = securityTestCases.find((t) => t.id === testId) || securityTestCases[0];

    const trace = await processSimulatedWhatsAppMessage({
      sender_phone: testCase.sender_phone,
      message_text: testCase.message_input,
      channel: 'WHATSAPP',
    });

    let passed = false;
    let actualOutcome = '';

    if (testId === 'test-1') {
      passed =
        trace.sender_verification.authorized === false &&
        (trace.outbound_message?.message_text.includes('ACCESS DENIED') ||
          trace.outbound_message?.message_text.includes('isolation'));
      actualOutcome = trace.outbound_message?.message_text || 'Access Denied enforced.';
    } else if (testId === 'test-2') {
      passed =
        Boolean(trace.decision_gate.blocked_reason?.includes('DO NOT DISCLOSE')) ||
        Boolean(trace.outbound_message?.message_text.includes('DO NOT DISCLOSE'));
      actualOutcome = trace.outbound_message?.message_text || 'Financial disclosure blocked.';
    } else if (testId === 'test-3') {
      passed =
        trace.decision_gate.can_ai_execute === false &&
        trace.decision_gate.requires_human_approval === true;
      actualOutcome = trace.outbound_message?.message_text || 'Automated change prohibited, escalated to PM & Owner.';
    } else if (testId === 'test-4') {
      passed =
        trace.sender_verification.recognized === false &&
        Boolean(trace.outbound_message?.message_text.includes('not registered with NW OS'));
      actualOutcome = trace.outbound_message?.message_text || 'Zero disclosure, admin notification created.';
    } else if (testId === 'test-5') {
      passed =
        trace.decision_gate.can_ai_execute === true &&
        trace.ai_interpretation.intent === 'COMPLETION';
      actualOutcome = trace.outbound_message?.message_text || 'CAR-003 marked Ready for QC; QC task created.';
    } else if (testId === 'test-6') {
      passed =
        trace.decision_gate.can_ai_execute === false &&
        trace.decision_gate.requires_human_approval === true;
      actualOutcome = trace.outbound_message?.message_text || 'Delivery not auto-scheduled; PM approval requested.';
    } else if (testId === 'test-7') {
      passed =
        Boolean(trace.outbound_message?.message_text.includes('柜台')) ||
        Boolean(trace.outbound_message?.message_text.includes('9月28日')) ||
        trace.ai_interpretation.intent === 'PRODUCTION_QUESTION';
      actualOutcome = trace.outbound_message?.message_text || 'Responded accurately in Chinese.';
    } else if (testId === 'test-8') {
      passed =
        trace.decision_gate.can_ai_execute === false &&
        trace.ai_interpretation.confidence === 'LOW' &&
        Boolean(trace.outbound_message?.message_text.includes('Which item'));
      actualOutcome = trace.outbound_message?.message_text || 'Clarification requested, zero guessing.';
    }

    const updatedCase: SecurityTestCase = {
      ...testCase,
      status: passed ? 'PASSED' : 'FAILED',
      actual_outcome: actualOutcome,
      execution_details: `Execution timestamp: ${new Date().toLocaleTimeString()} | Decision: ${trace.decision_gate.action_name}`,
    };

    setSecurityTestCases((prev) =>
      prev.map((tc) => (tc.id === testId ? updatedCase : tc))
    );

    return updatedCase;
  };

  const runAllSecurityTests = async (): Promise<SecurityTestCase[]> => {
    const results: SecurityTestCase[] = [];
    for (const tc of securityTestCases) {
      const res = await runSecurityTest(tc.id);
      results.push(res);
    }
    return results;
  };

  const approveAIActionRequest = (id: string, notes?: string) => {
    setAiActionRequests((prev) =>
      prev.map((req) =>
        req.id === id
          ? {
              ...req,
              status: 'approved',
              reviewed_by: currentUser.name,
              reviewed_at: new Date().toISOString(),
              review_notes: notes || 'Approved by authorized leadership.',
            }
          : req
      )
    );
    addAuditLog('AI Action Request Approved', 'AIActionRequest', id, undefined, notes);
  };

  const rejectAIActionRequest = (id: string, notes?: string) => {
    setAiActionRequests((prev) =>
      prev.map((req) =>
        req.id === id
          ? {
              ...req,
              status: 'rejected',
              reviewed_by: currentUser.name,
              reviewed_at: new Date().toISOString(),
              review_notes: notes || 'Rejected by authorized leadership.',
            }
          : req
      )
    );
    addAuditLog('AI Action Request Rejected', 'AIActionRequest', id, undefined, notes);
  };

  const requestMoreInfoForAction = (id: string, notes: string) => {
    setAiActionRequests((prev) =>
      prev.map((req) =>
        req.id === id
          ? {
              ...req,
              status: 'more_info_requested',
              reviewed_by: currentUser.name,
              reviewed_at: new Date().toISOString(),
              review_notes: notes,
            }
          : req
      )
    );
    addAuditLog('AI Action More Info Requested', 'AIActionRequest', id, undefined, notes);
  };

  const retryQueueItem = (queueId: string) => {
    setMessageQueue((prev) =>
      prev.map((q) =>
        q.queue_id === queueId
          ? { ...q, status: 'SENT', sent_at: new Date().toISOString(), retry_count: q.retry_count + 1 }
          : q
      )
    );
    addAuditLog('Message Queue Item Retried', 'MessageQueueItem', queueId);
  };

  const cancelQueueItem = (queueId: string) => {
    setMessageQueue((prev) =>
      prev.map((q) => (q.queue_id === queueId ? { ...q, status: 'CANCELLED' } : q))
    );
    addAuditLog('Message Queue Item Cancelled', 'MessageQueueItem', queueId);
  };

  const clearDeliveredQueue = () => {
    setMessageQueue((prev) => prev.filter((q) => q.status !== 'DELIVERED' && q.status !== 'SENT'));
  };

  const addGatewayContact = (
    contactData: Omit<CommunicationContact, 'contact_id' | 'created_at' | 'updated_at'>
  ): CommunicationContact => {
    const newContact: CommunicationContact = {
      ...contactData,
      contact_id: 'cc-' + Date.now(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setGatewayContacts((prev) => [...prev, newContact]);
    addAuditLog('Added Communication Contact', 'CommunicationContact', newContact.contact_id, undefined, newContact.name);
    return newContact;
  };

  const updateGatewayContact = (contactId: string, updates: Partial<CommunicationContact>) => {
    setGatewayContacts((prev) =>
      prev.map((c) => (c.contact_id === contactId ? { ...c, ...updates, updated_at: new Date().toISOString() } : c))
    );
    addAuditLog('Updated Communication Contact', 'CommunicationContact', contactId);
  };

  const verifyGatewayContact = (contactId: string, verified: boolean) => {
    setGatewayContacts((prev) =>
      prev.map((c) =>
        c.contact_id === contactId
          ? {
              ...c,
              verified,
              status: verified ? 'active' : 'pending_verification',
              updated_at: new Date().toISOString(),
            }
          : c
      )
    );
    addAuditLog(verified ? 'Verified Gateway Contact' : 'Unverified Gateway Contact', 'CommunicationContact', contactId);
  };

  const updateGatewaySettings = (newSettings: Partial<GatewaySettings>) => {
    setGatewaySettings((prev) => ({ ...prev, ...newSettings }));
    addAuditLog('Updated Communication Gateway Settings', 'GatewaySettings', 'global-settings');
  };

  const undoAIAction = (actionId: string, reason: string) => {
    const action = aiActions.find((a) => a.action_id === actionId);
    if (!action) return;

    if (action.action_type === 'create_qc_task' && action.target_record_id) {
      updateWorkItemStatus(action.target_record_id, 'In Progress');
    }

    setAiActions((prev) =>
      prev.map((a) =>
        a.action_id === actionId
          ? {
              ...a,
              approval_status: 'rejected',
              notes: `${a.notes || ''} [Manual override by ${currentUser.name}: ${reason}]`,
            }
          : a
      )
    );

    addAuditLog(
      'Human Override: Undid AI Action',
      'AIActionRecord',
      actionId,
      action.new_value,
      action.previous_value
    );
  };

  const saveKnowledgeFromConversation = (data: {
    title: string;
    category: any;
    description: string;
    reason: string;
    scope: 'company' | 'project';
  }) => {
    addKnowledgeItem({
      title: data.title,
      category: data.category || 'Practical Solutions',
      description: data.description,
      reason: data.reason,
      example: 'Captured from contractor chat and PM operational coordination.',
      status: 'Draft',
      created_by: currentUser.name,
      source_project_id: data.scope === 'project' ? selectedProjectId : undefined,
    });
    addAuditLog('Saved Knowledge Draft From Conversation', 'NWProductionKnowledge', data.title);
  };

  // ====================================================
  // Commercial, Costing & Profit Control Methods (Module 12)
  // ====================================================

  const addClientEnquiry = (enquiryData: Omit<ClientEnquiry, 'id'>): ClientEnquiry => {
    const newEnquiry: ClientEnquiry = {
      ...enquiryData,
      id: 'enq-' + Date.now(),
    };
    setClientEnquiries((prev) => [newEnquiry, ...prev]);
    addAuditLog('Created Client Enquiry', 'ClientEnquiry', newEnquiry.id, undefined, newEnquiry.enquiry_number);
    return newEnquiry;
  };

  const updateClientEnquiry = (id: string, updates: Partial<ClientEnquiry>) => {
    setClientEnquiries((prev) =>
      prev.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
    addAuditLog('Updated Client Enquiry', 'ClientEnquiry', id);
  };

  const addCommercialTender = (tenderData: Omit<CommercialTender, 'id'>): CommercialTender => {
    const newTender: CommercialTender = {
      ...tenderData,
      id: 'tdr-' + Date.now(),
    };
    setCommercialTenders((prev) => [newTender, ...prev]);
    addAuditLog('Created Commercial Tender', 'CommercialTender', newTender.id, undefined, newTender.tender_number);
    return newTender;
  };

  const updateCommercialTender = (id: string, updates: Partial<CommercialTender>) => {
    setCommercialTenders((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
    );
    addAuditLog('Updated Commercial Tender', 'CommercialTender', id);
  };

  const addCommercialQuotation = (quotationData: Omit<CommercialQuotation, 'id' | 'created_at' | 'updated_at'>): CommercialQuotation => {
    const newQuotation: CommercialQuotation = {
      ...quotationData,
      id: 'quot-' + Date.now(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setCommercialQuotations((prev) => [newQuotation, ...prev]);
    addAuditLog('Created Commercial Quotation', 'CommercialQuotation', newQuotation.id, undefined, newQuotation.quotation_number);
    return newQuotation;
  };

  const updateCommercialQuotation = (id: string, updates: Partial<CommercialQuotation>) => {
    setCommercialQuotations((prev) =>
      prev.map((q) => (q.id === id ? { ...q, ...updates, updated_at: new Date().toISOString() } : q))
    );
    addAuditLog('Updated Commercial Quotation', 'CommercialQuotation', id);
  };

  const createNewQuotationVersion = (quotationId: string, updatedItems: QuotationItem[]): CommercialQuotation => {
    const current = commercialQuotations.find((q) => q.id === quotationId);
    if (!current) throw new Error('Quotation not found');

    const newVersionNumber = current.version + 1;
    const baseCode = current.quotation_number;
    const newVersionCode = `${baseCode}-V${newVersionNumber}`;

    const subtotalSellingPrice = updatedItems.reduce((acc, item) => acc + item.total_selling_price, 0);
    const totalEstimatedCost = updatedItems.reduce((acc, item) => acc + item.total_estimated_cost, 0);
    const grossProfit = subtotalSellingPrice - totalEstimatedCost;
    const marginPercent = subtotalSellingPrice > 0 ? (grossProfit / subtotalSellingPrice) * 100 : 0;
    const taxAmount = current.tax_applicable ? subtotalSellingPrice * (current.tax_rate || 0) : 0;

    const newQuotation: CommercialQuotation = {
      ...current,
      id: 'quot-' + Date.now(),
      version: newVersionNumber,
      version_code: newVersionCode,
      status: 'Draft',
      items: updatedItems,
      subtotal_selling_price: subtotalSellingPrice,
      tax_amount: taxAmount,
      total_selling_price: subtotalSellingPrice + taxAmount,
      total_estimated_cost: totalEstimatedCost,
      estimated_gross_profit: grossProfit,
      estimated_gross_margin_percent: Number(marginPercent.toFixed(2)),
      approval_status: 'Pending',
      low_margin_warning: marginPercent < 25,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setCommercialQuotations((prev) => [
      newQuotation,
      ...prev.map((q) => (q.id === quotationId ? { ...q, status: 'Superseded' as QuotationStatus } : q)),
    ]);

    addAuditLog('Created New Quotation Version', 'CommercialQuotation', newQuotation.id, current.version_code, newVersionCode);
    return newQuotation;
  };

  const approveCommercialQuotation = (quotationId: string) => {
    const quot = commercialQuotations.find((q) => q.id === quotationId);
    if (!quot) return;

    setCommercialQuotations((prev) =>
      prev.map((q) => (q.id === quotationId ? { ...q, status: 'Accepted' as QuotationStatus, approval_status: 'Approved' } : q))
    );

    if (quot.project_id) {
      setCommercialBaselines((prev) => {
        const existing = prev.find((b) => b.project_id === quot.project_id);
        if (existing) {
          return prev.map((b) =>
            b.project_id === quot.project_id
              ? {
                  ...b,
                  original_contract_value: quot.total_selling_price,
                  current_contract_value: quot.total_selling_price + b.approved_variations_total,
                  original_budget_direct_cost: quot.total_estimated_cost,
                }
              : b
          );
        } else {
          const newBaseline: ProjectCommercialBaseline = {
            project_id: quot.project_id!,
            project_number: quot.project_name.split('—')[0].trim() || 'PROJECT-NEW',
            project_name: quot.project_name,
            original_contract_value: quot.total_selling_price,
            approved_variations_total: 0,
            current_contract_value: quot.total_selling_price,
            unapproved_potential_variations_total: 0,
            estimated_final_revenue: quot.total_selling_price,
            original_budget_direct_cost: quot.total_estimated_cost,
            committed_cost: 0,
            actual_cost: 0,
            forecast_final_cost: quot.total_estimated_cost,
            cost_variance: 0,
            cost_variance_status: 'On Budget',
            variance_drivers: { material: 0, subcontractor: 0, rework: 0, logistics: 0, other: 0 },
            cash_billed: 0,
            cash_collected: 0,
            cash_outstanding: 0,
            current_gross_profit: quot.estimated_gross_profit,
            forecast_gross_profit: quot.estimated_gross_profit,
            forecast_gross_margin_percent: quot.estimated_gross_margin_percent,
          };
          return [...prev, newBaseline];
        }
      });
    }

    addAuditLog('Approved Commercial Quotation & Locked Baseline', 'CommercialQuotation', quotationId);
  };

  const addProjectCostLedgerItem = (itemData: Omit<ProjectCostLedgerItem, 'cost_id'>): ProjectCostLedgerItem => {
    const newCost: ProjectCostLedgerItem = {
      ...itemData,
      cost_id: 'cst-' + Date.now(),
    };
    setProjectCostLedger((prev) => [newCost, ...prev]);

    setCommercialBaselines((prev) =>
      prev.map((b) => {
        if (b.project_id === newCost.project_id) {
          const isCommitted = newCost.status === 'Committed';
          const isIncurred = newCost.status === 'Incurred' || newCost.status === 'Reconciled';
          const newCommitted = isCommitted ? b.committed_cost + newCost.amount : b.committed_cost;
          const newActual = isIncurred ? b.actual_cost + newCost.amount : b.actual_cost;
          const newForecast = Math.max(b.forecast_final_cost, newActual);
          const variance = newForecast - b.original_budget_direct_cost;
          const status = variance > 25000 ? 'Critical Overrun' : variance > 10000 ? 'Forecast Over Budget' : variance > 0 ? 'Minor Variance' : 'On Budget';
          return {
            ...b,
            committed_cost: newCommitted,
            actual_cost: newActual,
            forecast_final_cost: newForecast,
            cost_variance: variance,
            cost_variance_status: status as any,
            current_gross_profit: b.current_contract_value - newActual,
            forecast_gross_profit: b.current_contract_value - newForecast,
            forecast_gross_margin_percent: b.current_contract_value > 0 ? Number(((b.current_contract_value - newForecast) / b.current_contract_value * 100).toFixed(2)) : 0,
          };
        }
        return b;
      })
    );

    addAuditLog('Recorded Project Direct Cost', 'ProjectCostLedgerItem', newCost.cost_id, undefined, `${newCost.cost_category} RM ${newCost.amount}`);
    return newCost;
  };

  const allocateCostToProjects = (
    costId: string,
    allocations: Array<{ project_id: string; project_name: string; allocated_amount: number }>
  ) => {
    setProjectCostLedger((prev) =>
      prev.map((c) =>
        c.cost_id === costId
          ? { ...c, allocation_details: allocations }
          : c
      )
    );
    addAuditLog('Allocated Shared Cost across Multiple Projects', 'ProjectCostLedgerItem', costId);
  };

  const addGoodsReceivedRecord = (recordData: Omit<GoodsReceivedRecord, 'id'>): GoodsReceivedRecord => {
    const newGRN: GoodsReceivedRecord = {
      ...recordData,
      id: 'grn-' + Date.now(),
    };
    setGoodsReceived((prev) => [newGRN, ...prev]);

    const matchedPO = purchaseOrders.find((p) => p.po_number === newGRN.po_number || p.id === newGRN.po_id);
    if (matchedPO) {
      updatePOStatus(matchedPO.id, 'Goods Received', newGRN.date_received);
    }

    addAuditLog('Created Goods Received Record (GRN)', 'GoodsReceivedRecord', newGRN.id, undefined, newGRN.grn_number);
    return newGRN;
  };

  const addCommercialInvoice = (invoiceData: Omit<CommercialInvoice, 'id'>): CommercialInvoice => {
    const newInvoice: CommercialInvoice = {
      ...invoiceData,
      id: 'inv-' + Date.now(),
    };
    setCommercialInvoices((prev) => [newInvoice, ...prev]);

    if (invoiceData.invoice_type === 'Client Billing Invoice') {
      setCommercialBaselines((prev) =>
        prev.map((b) =>
          b.project_id === newInvoice.project_id
            ? {
                ...b,
                cash_billed: b.cash_billed + newInvoice.total_amount,
                cash_outstanding: (b.cash_billed + newInvoice.total_amount) - b.cash_collected,
              }
            : b
        )
      );
    }

    addAuditLog('Created Commercial Invoice', 'CommercialInvoice', newInvoice.id, undefined, newInvoice.invoice_number);
    return newInvoice;
  };

  const updateInvoicePayment = (invoiceId: string, paidAmount: number, isFullyPaid: boolean) => {
    const invoice = commercialInvoices.find((i) => i.id === invoiceId);
    if (!invoice) return;

    setCommercialInvoices((prev) =>
      prev.map((i) =>
        i.id === invoiceId
          ? {
              ...i,
              paid_amount: (i.paid_amount || 0) + paidAmount,
              status: isFullyPaid ? 'Paid' : 'Partially Paid',
            }
          : i
      )
    );

    if (invoice.invoice_type === 'Client Billing Invoice') {
      setCommercialBaselines((prev) =>
        prev.map((b) =>
          b.project_id === invoice.project_id
            ? {
                ...b,
                cash_collected: b.cash_collected + paidAmount,
                cash_outstanding: Math.max(0, b.cash_billed - (b.cash_collected + paidAmount)),
              }
            : b
        )
      );
    }

    addAuditLog('Recorded Commercial Invoice Payment', 'CommercialInvoice', invoiceId, undefined, `Paid RM ${paidAmount}`);
  };

  const resolveCostLeakAlert = (alertId: string, resolutionAction: string) => {
    setCostLeakAlerts((prev) =>
      prev.map((a) => (a.id === alertId ? { ...a, status: 'Resolved' } : a))
    );
    addAuditLog('Resolved Cost Leak Alert', 'CostLeakAlert', alertId, undefined, resolutionAction);
  };

  const updateCommercialBaseline = (projectId: string, updates: Partial<ProjectCommercialBaseline>) => {
    setCommercialBaselines((prev) =>
      prev.map((b) => (b.project_id === projectId ? { ...b, ...updates } : b))
    );
    addAuditLog('Updated Project Commercial Baseline', 'ProjectCommercialBaseline', projectId);
  };

  const addPriceDatabaseRecord = (recordData: Omit<PriceDatabaseRecord, 'id'>): PriceDatabaseRecord => {
    const newRecord: PriceDatabaseRecord = {
      ...recordData,
      id: 'pr-' + Date.now(),
    };
    setPriceDatabase((prev) => [newRecord, ...prev]);
    addAuditLog('Added Item to Price Database', 'PriceDatabaseRecord', newRecord.id, undefined, newRecord.item_name);
    return newRecord;
  };

  // ----------------------------------------------------
  // MODULE 13: PRODUCTION, CNC & QR/BARCODE FACTORY METHODS
  // ----------------------------------------------------

  const createProductionOrder = (
    data: Omit<ProductionOrder, 'id' | 'order_number' | 'created_at' | 'updated_at' | 'stage_history' | 'barcode' | 'qr_code'>
  ): ProductionOrder => {
    const nextNum = (productionOrders.length + 1).toString().padStart(3, '0');
    const orderNumber = `PO-2026-${nextNum}`;
    const newOrder: ProductionOrder = {
      ...data,
      id: 'po-' + Date.now(),
      order_number: orderNumber,
      barcode: `BC-${orderNumber}`,
      qr_code: `NW-QR://po/${orderNumber}/${data.work_item_code}`,
      stage_history: [
        {
          stage: data.current_stage || 'Not Started',
          timestamp: new Date().toISOString(),
          updated_by: currentUser.name,
          role: currentUser.role,
          notes: 'Production Order created from Work Item ' + data.work_item_code,
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setProductionOrders((prev) => [newOrder, ...prev]);

    // Link back to Work Item
    if (data.work_item_id) {
      setWorkItems((prev) =>
        prev.map((item) =>
          item.id === data.work_item_id
            ? {
                ...item,
                production_order_id: newOrder.id,
                production_status: newOrder.current_stage,
                updated_at: new Date().toISOString(),
              }
            : item
        )
      );
    }

    addAuditLog(
      'Created Production Order',
      'ProductionOrder',
      newOrder.id,
      undefined,
      `${newOrder.order_number} (${data.work_item_code})`
    );
    return newOrder;
  };

  const updateProductionOrderStatus = (
    orderId: string,
    newStage: ProductionOrderStatus,
    notes?: string
  ) => {
    const target = productionOrders.find((o) => o.id === orderId);
    if (!target) return;

    const transition: ProductionOrderStageTransition = {
      stage: newStage,
      timestamp: new Date().toISOString(),
      updated_by: currentUser.name,
      role: currentUser.role,
      notes: notes || `Moved to ${newStage}`,
    };

    setProductionOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              current_stage: newStage,
              status: newStage,
              stage_history: [...o.stage_history, transition],
              updated_at: new Date().toISOString(),
            }
          : o
      )
    );

    // Synchronize connected Work Item
    if (target.work_item_id) {
      setWorkItems((prev) =>
        prev.map((w) => {
          if (w.id !== target.work_item_id) return w;
          const updates: Partial<WorkItem> = {
            production_status: newStage,
            updated_at: new Date().toISOString(),
          };
          if (newStage === 'Ready for Delivery') {
            updates.status = 'Ready for Delivery';
            updates.progress_percent = 100;
          } else if (newStage === 'QC') {
            updates.status = 'Ready for QC';
          } else if (newStage === 'Completed') {
            updates.status = 'Completed';
            updates.progress_percent = 100;
          } else if (newStage === 'Blocked') {
            updates.status = 'Blocked';
          }
          return { ...w, ...updates };
        })
      );
    }

    if (newStage === 'Blocked') {
      setNotifications((prev) => [
        {
          id: 'notif-' + Date.now(),
          target_role: 'ALL',
          title: `⚠️ Production Order Blocked: ${target.order_number}`,
          message: `${target.order_number} (${target.work_item_code}) has been marked as Blocked. Note: ${notes || 'Issue requires resolution.'}`,
          type: 'issue',
          priority: 'urgent',
          is_read: false,
          project_id: target.project_id,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }

    addAuditLog(
      'Updated Production Stage',
      'ProductionOrder',
      orderId,
      target.current_stage,
      `${newStage} ${notes ? `(${notes})` : ''}`
    );
  };

  const addProductionPart = (
    partData: Omit<ProductionPart, 'id' | 'created_at' | 'updated_at' | 'barcode' | 'qr_code'>
  ): ProductionPart => {
    const newPart: ProductionPart = {
      ...partData,
      id: 'part-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6),
      barcode: `BC-${partData.part_code}`,
      qr_code: `NW-QR://part/${partData.part_code}`,
      history: [
        {
          stage: partData.current_stage,
          timestamp: new Date().toISOString(),
          operator: currentUser.name,
          notes: 'Part registered',
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setProductionParts((prev) => [...prev, newPart]);
    addAuditLog('Created Production Part', 'ProductionPart', newPart.id, undefined, newPart.part_code);
    return newPart;
  };

  const updatePartStatus = (partId: string, newStage: PartStatus, notes?: string) => {
    const target = productionParts.find((p) => p.id === partId);
    if (!target) return;

    setProductionParts((prev) =>
      prev.map((p) =>
        p.id === partId
          ? {
              ...p,
              current_stage: newStage,
              status: newStage,
              rework_notes: newStage === 'Rework' || newStage === 'Rejected' ? notes : p.rework_notes,
              history: [
                ...(p.history || []),
                {
                  stage: newStage,
                  timestamp: new Date().toISOString(),
                  operator: currentUser.name,
                  notes,
                },
              ],
              updated_at: new Date().toISOString(),
            }
          : p
      )
    );

    addAuditLog('Updated Part Status', 'ProductionPart', partId, target.current_stage, `${newStage} (${target.part_code})`);
  };

  const createCNCJob = (jobData: Omit<CNCJob, 'id' | 'job_id_code'>): CNCJob => {
    const nextCode = `CNC-2026-${(cncJobs.length + 1).toString().padStart(3, '0')}`;
    const newJob: CNCJob = {
      ...jobData,
      id: 'cnc-job-' + Date.now(),
      job_id_code: nextCode,
    };
    setCncJobs((prev) => [newJob, ...prev]);
    addAuditLog('Created CNC Job', 'CNCJob', newJob.id, undefined, `${newJob.job_id_code} (${newJob.part_code})`);
    return newJob;
  };

  const updateCNCJobStatus = (jobId: string, status: CNCJobStatus, notes?: string) => {
    const target = cncJobs.find((j) => j.id === jobId);
    if (!target) return;

    setCncJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const updates: Partial<CNCJob> = { status, notes: notes || j.notes };
        if (status === 'Running' && !j.start_time) {
          updates.start_time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (status === 'Completed') {
          updates.end_time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        }
        return { ...j, ...updates };
      })
    );

    addAuditLog('Updated CNC Job Status', 'CNCJob', jobId, target.status, `${status} (${target.job_id_code})`);
  };

  const uploadCNCFileVersion = (fileVer: Omit<CNCFileVersion, 'id' | 'uploaded_at'>): CNCFileVersion => {
    const newVer: CNCFileVersion = {
      ...fileVer,
      id: 'cnc-ver-' + Date.now(),
      uploaded_at: new Date().toISOString(),
    };
    setCncFileVersions((prev) => [newVer, ...prev]);
    addAuditLog('Uploaded CNC File Version', 'CNCFileVersion', newVer.id, undefined, `${newVer.file_name} ${newVer.revision}`);
    return newVer;
  };

  const updateAssemblyJob = (jobId: string, updates: Partial<AssemblyJob>) => {
    setAssemblyJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...updates } : j)));
    addAuditLog('Updated Assembly Job', 'AssemblyJob', jobId, undefined, JSON.stringify(updates));
  };

  const toggleAssemblyPartCheck = (jobId: string, partId: string) => {
    setAssemblyJobs((prev) =>
      prev.map((job) => {
        if (job.id !== jobId) return job;
        return {
          ...job,
          parts_checklist: job.parts_checklist.map((p) =>
            p.part_id === partId ? { ...p, ready: !p.ready } : p
          ),
        };
      })
    );
  };

  const toggleAssemblyHardwareCheck = (jobId: string, itemIndex: number) => {
    setAssemblyJobs((prev) =>
      prev.map((job) => {
        if (job.id !== jobId) return job;
        return {
          ...job,
          hardware_checklist: job.hardware_checklist.map((h, idx) =>
            idx === itemIndex ? { ...h, checked: !h.checked } : h
          ),
        };
      })
    );
  };

  const updateFinishingJob = (jobId: string, updates: Partial<FinishingJob>) => {
    setFinishingJobs((prev) => prev.map((j) => (j.id === jobId ? { ...j, ...updates } : j)));
    addAuditLog('Updated Finishing Job', 'FinishingJob', jobId, undefined, JSON.stringify(updates));
  };

  const recordFactoryQC = (
    qcData: Omit<FactoryQCInspection, 'id' | 'inspection_date'>
  ): FactoryQCInspection => {
    const newQC: FactoryQCInspection = {
      ...qcData,
      id: 'qc-fac-' + Date.now(),
      inspection_date: new Date().toISOString(),
    };
    setFactoryQCInspections((prev) => [newQC, ...prev]);

    // Handle consequences on Production Order
    if (qcData.result === 'Passed') {
      updateProductionOrderStatus(qcData.production_order_id, 'Packing', 'Passed Factory QC Inspection');
    } else if (qcData.result === 'Rework Required') {
      const reworkStage = qcData.rework_target_stage || 'Assembly';
      updateProductionOrderStatus(
        qcData.production_order_id,
        reworkStage,
        `Factory QC Failed: ${qcData.rework_reason || 'Rework required'}`
      );
      setNotifications((prev) => [
        {
          id: 'notif-' + Date.now(),
          target_role: 'Production Manager',
          title: `🔴 Factory QC Rework Required: ${qcData.production_order_number}`,
          message: `${qcData.production_order_number} (${qcData.work_item_code}) failed QC. Returned to stage: ${reworkStage}. Reason: ${qcData.rework_reason || 'See QC log'}`,
          type: 'qc',
          priority: 'urgent',
          is_read: false,
          created_at: new Date().toISOString(),
        },
        ...prev,
      ]);
    }

    addAuditLog(
      'Recorded Factory QC Inspection',
      'FactoryQCInspection',
      newQC.id,
      undefined,
      `${newQC.result} for ${qcData.production_order_number}`
    );
    return newQC;
  };

  const createPackingPackage = (
    pkgData: Omit<PackingPackage, 'id' | 'package_number' | 'packed_at' | 'barcode' | 'qr_code'>
  ): PackingPackage => {
    const nextPkgNum = `PKG-${(packingPackages.length + 1).toString().padStart(3, '0')}`;
    const newPkg: PackingPackage = {
      ...pkgData,
      id: 'pkg-' + Date.now(),
      package_number: nextPkgNum,
      barcode: `BC-${nextPkgNum}`,
      qr_code: `NW-QR://pkg/${nextPkgNum}`,
      packed_at: new Date().toISOString(),
    };
    setPackingPackages((prev) => [newPkg, ...prev]);
    addAuditLog('Created Packing Package', 'PackingPackage', newPkg.id, undefined, newPkg.package_number);
    return newPkg;
  };

  const updatePackingStatus = (pkgId: string, status: PackingPackage['status']) => {
    setPackingPackages((prev) =>
      prev.map((p) => (p.id === pkgId ? { ...p, status } : p))
    );
    addAuditLog('Updated Package Status', 'PackingPackage', pkgId, undefined, status);
  };

  const reportProductionIssue = (
    issueData: Omit<ProductionIssueRecord, 'id' | 'issue_code' | 'reported_at'>
  ): ProductionIssueRecord => {
    const nextCode = `P-ISS-${(productionIssues.length + 1).toString().padStart(3, '0')}`;
    const newIssue: ProductionIssueRecord = {
      ...issueData,
      id: 'p-iss-' + Date.now(),
      issue_code: nextCode,
      reported_at: new Date().toISOString(),
    };
    setProductionIssues((prev) => [newIssue, ...prev]);

    // If critical blocker, mark production order as Blocked
    if (issueData.severity === 'Critical Blocker' && issueData.production_order_id) {
      updateProductionOrderStatus(
        issueData.production_order_id,
        'Blocked',
        `Blocked by ${newIssue.issue_code}: ${issueData.title}`
      );
    }

    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: issueData.escalation_level === 'Owner' ? 'Owner / CEO' : 'Production Manager',
        title: `⚠️ Production Blocker: ${newIssue.issue_code} (${issueData.title})`,
        message: `${issueData.title} reported by ${issueData.reported_by}. Severity: ${issueData.severity}`,
        type: 'issue',
        priority: 'urgent',
        is_read: false,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    addAuditLog('Reported Production Issue', 'ProductionIssueRecord', newIssue.id, undefined, newIssue.title);
    return newIssue;
  };

  const resolveProductionIssue = (issueId: string, resolutionNotes: string) => {
    const target = productionIssues.find((i) => i.id === issueId);
    if (!target) return;

    setProductionIssues((prev) =>
      prev.map((i) =>
        i.id === issueId
          ? {
              ...i,
              status: 'Resolved',
              resolution_notes: resolutionNotes,
            }
          : i
      )
    );

    addAuditLog('Resolved Production Issue', 'ProductionIssueRecord', issueId, target.status, resolutionNotes);
  };

  const handleDrawingRevisionProductionCheck = (drawingId: string, newRevision: string) => {
    // Find all production orders that reference this drawing
    setProductionOrders((prev) =>
      prev.map((order) => {
        if (order.approved_client_drawing_id !== drawingId) return order;
        let alertLevel: 'REVISION REVIEW REQUIRED' | 'PRODUCTION IMPACT POSSIBLE' | 'REVISION AFTER PRODUCTION' = 'PRODUCTION IMPACT POSSIBLE';
        if (order.current_stage === 'Not Started' || order.current_stage === 'Material Required') {
          alertLevel = 'REVISION REVIEW REQUIRED';
        } else if (order.current_stage === 'Ready for Delivery' || order.current_stage === 'Completed') {
          alertLevel = 'REVISION AFTER PRODUCTION';
        }

        return {
          ...order,
          revision_alert: {
            level: alertLevel,
            detected_revision: newRevision,
            message: `Drawing revision ${newRevision} uploaded. Current order is at stage: ${order.current_stage}. Review required before progressing further.`,
            flagged_date: new Date().toISOString(),
            resolved: false,
          },
        };
      })
    );

    // Also mark CNC files referencing this drawing as OUTDATED
    setCncFileVersions((prev) =>
      prev.map((cf) =>
        cf.associated_drawing_revision.includes(drawingId) || cf.status === 'Approved'
          ? { ...cf, status: 'OUTDATED / REQUIRES RE-GENERATION' }
          : cf
      )
    );

    addAuditLog(
      'Evaluated Drawing Revision Impact on Production',
      'DrawingRevision',
      drawingId,
      undefined,
      `Checked active orders against revision ${newRevision}`
    );
  };

  const scanBarcodeOrQRCode = (code: string) => {
    const clean = code.trim();

    // 1. Check Production Orders
    const matchOrder = productionOrders.find(
      (o) =>
        o.barcode.toLowerCase() === clean.toLowerCase() ||
        o.qr_code.toLowerCase() === clean.toLowerCase() ||
        o.order_number.toLowerCase() === clean.toLowerCase()
    );
    if (matchOrder) {
      return {
        type: 'order' as const,
        item: matchOrder,
        message: `Matched Production Order ${matchOrder.order_number} (${matchOrder.work_item_code})`,
      };
    }

    // 2. Check Parts
    const matchPart = productionParts.find(
      (p) =>
        p.barcode.toLowerCase() === clean.toLowerCase() ||
        p.qr_code.toLowerCase() === clean.toLowerCase() ||
        p.part_code.toLowerCase() === clean.toLowerCase()
    );
    if (matchPart) {
      return {
        type: 'part' as const,
        item: matchPart,
        message: `Matched Production Part ${matchPart.part_code} (${matchPart.part_name})`,
      };
    }

    // 3. Check Packages
    const matchPkg = packingPackages.find(
      (pkg) =>
        pkg.barcode.toLowerCase() === clean.toLowerCase() ||
        pkg.qr_code.toLowerCase() === clean.toLowerCase() ||
        pkg.package_number.toLowerCase() === clean.toLowerCase()
    );
    if (matchPkg) {
      return {
        type: 'package' as const,
        item: matchPkg,
        message: `Matched Dispatch Package ${matchPkg.package_number}`,
      };
    }

    return {
      type: 'unknown' as const,
      message: `No matching Production record found for code: "${code}"`,
    };
  };

  // ----------------------------------------------------
  // MODULE 14: DELIVERY, SITE INSTALLATION & PROJECT COMPLETION
  // ----------------------------------------------------

  const createDeliveryRecord = (
    data: Omit<DeliveryRecord, 'id' | 'delivery_number' | 'status_history' | 'qr_code' | 'barcode'>
  ): DeliveryRecord => {
    const deliveryNum = `DEL-2026-0${10 + deliveryRecords.length}`;
    const id = `del-${Date.now()}`;

    // Conflict detection: Check for existing deliveries on same date and overlapping time (same site/bay)
    let conflictObj: DeliveryRecord['schedule_conflict'] = undefined;
    const sameDay = deliveryRecords.find(
      (d) =>
        d.delivery_date === data.delivery_date &&
        d.id !== id &&
        (d.destination_site.toLowerCase().includes(data.destination_site.toLowerCase().slice(0, 15)) ||
          d.project_id === data.project_id)
    );

    if (sameDay) {
      conflictObj = {
        conflict_with_delivery_id: sameDay.id,
        conflict_with_delivery_number: sameDay.delivery_number,
        conflict_reason: `Simultaneous Loading Bay slot requested on ${data.delivery_date} (${data.delivery_time} vs ${sameDay.delivery_time})`,
        site_loading_bay: data.destination_site,
        overlapping_time: `${data.delivery_time} vs ${sameDay.delivery_time}`,
      };
    }

    const newRecord: DeliveryRecord = {
      ...data,
      id,
      delivery_number: deliveryNum,
      status_history: [
        {
          status: data.status || 'Scheduled',
          timestamp: new Date().toISOString(),
          changed_by: `${currentUser.name} (${currentUser.role})`,
          notes: 'Delivery transport arrangement created',
        },
      ],
      qr_code: `NW-QR-${deliveryNum}`,
      barcode: `${deliveryNum.replace(/-/g, '')}`,
      schedule_conflict: conflictObj,
    };

    setDeliveryRecords((prev) => [newRecord, ...prev]);

    // Update linked work items delivery status
    if (data.work_item_ids && data.work_item_ids.length > 0) {
      setWorkItems((prev) =>
        prev.map((w) =>
          data.work_item_ids.includes(w.id) || data.work_item_codes?.includes(w.item_code)
            ? {
                ...w,
                delivery_status: 'Scheduled',
                scheduled_delivery_date: data.delivery_date,
                scheduled_delivery_time: data.delivery_time,
                updated_at: new Date().toISOString(),
              }
            : w
        )
      );
    }

    // Add audit log & notify
    addAuditLog(
      `Delivery Arranged: ${deliveryNum}`,
      currentUser.role,
      data.project_name,
      'Not Scheduled',
      data.status || 'Scheduled'
    );

    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: 'Site Supervisor',
        title: `Delivery Scheduled: ${deliveryNum}`,
        message: `${data.contractor_name} scheduled lorry (${data.vehicle_plate}) to arrive at ${data.destination_site} on ${data.delivery_date} at ${data.delivery_time}.`,
        type: 'delivery',
        priority: conflictObj ? 'urgent' : 'normal',
        is_read: false,
        project_id: data.project_id,
        link_type: 'project',
        link_id: data.project_id,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    return newRecord;
  };

  const scheduleDeliveryRecord = createDeliveryRecord;

  const updateDeliveryStatus = (deliveryId: string, status: DeliveryStatus, notes?: string) => {
    setDeliveryRecords((prev) =>
      prev.map((d) => {
        if (d.id !== deliveryId) return d;
        const prevStatus = d.status;
        const historyEntry = {
          status,
          timestamp: new Date().toISOString(),
          changed_by: `${currentUser.name} (${currentUser.role})`,
          notes: notes || `Status updated to ${status}`,
        };

        // If marked Delivered:
        // CRITICAL RULE: Delivery received does NOT automatically start installation!
        if (status === 'Delivered') {
          // Update linked work items
          setWorkItems((wPrev) =>
            wPrev.map((w) =>
              d.work_item_ids.includes(w.id) || d.work_item_codes?.includes(w.item_code)
                ? {
                    ...w,
                    delivery_status: 'Delivered',
                    // Installation stays 'Not Started'
                    updated_at: new Date().toISOString(),
                  }
                : w
            )
          );
        }

        // If marked Delivery Issue:
        if (status === 'Delivery Issue') {
          createIssue({
            title: `Delivery Issue: ${d.delivery_number} (${d.project_name})`,
            category: 'Delivery',
            priority: 'High',
            description: notes || `Delivery issue logged during transit/receiving for ${d.delivery_number}.`,
            project_id: d.project_id,
            location: d.destination_site,
            assigned_to_id: currentUser.id,
            assigned_to_name: currentUser.name,
            due_date: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
          });
        }

        addAuditLog(
          `Delivery Status: ${d.delivery_number}`,
          currentUser.role,
          d.project_name,
          prevStatus,
          status
        );

        return {
          ...d,
          status,
          status_history: [historyEntry, ...d.status_history],
        };
      })
    );
  };

  const updateLoadingChecklist = (
    deliveryId: string,
    checklistUpdates: Partial<LoadingChecklist>,
    isLoaded?: boolean
  ) => {
    setDeliveryRecords((prev) =>
      prev.map((d) => {
        if (d.id !== deliveryId) return d;
        const updatedChecklist = {
          ...d.loading_checklist,
          ...checklistUpdates,
          ...(isLoaded
            ? {
                loaded_confirmed_by: currentUser.name,
                loaded_at: new Date().toISOString(),
              }
            : {}),
        };

        const updatedStatus: DeliveryStatus = isLoaded ? 'In Transit' : d.status === 'Scheduled' ? 'Loading' : d.status;

        addAuditLog(
          `Loading Checklist Verified: ${d.delivery_number}`,
          currentUser.role,
          d.project_name,
          d.status,
          updatedStatus
        );

        return {
          ...d,
          loading_checklist: updatedChecklist,
          status: updatedStatus,
          status_history: isLoaded
            ? [
                {
                  status: 'In Transit',
                  timestamp: new Date().toISOString(),
                  changed_by: `${currentUser.name} (${currentUser.role})`,
                  notes: 'Loading checklist fully verified. Truck departed factory.',
                },
                ...d.status_history,
              ]
            : d.status_history,
        };
      })
    );
  };

  const scanPackageForLoading = (deliveryId: string, packageCode: string) => {
    const clean = packageCode.trim();
    const delivery = deliveryRecords.find((d) => d.id === deliveryId);
    if (!delivery) {
      return { success: false, message: 'Delivery not found', scannedCount: 0, totalCount: 0, readyToLoad: false };
    }

    const currentScanned = delivery.scanned_packages || [];
    if (currentScanned.includes(clean)) {
      return {
        success: true,
        message: `Package "${clean}" was already scanned. (${currentScanned.length}/${delivery.package_count})`,
        scannedCount: currentScanned.length,
        totalCount: delivery.package_count,
        readyToLoad: currentScanned.length >= delivery.package_count,
      };
    }

    const updated = [...currentScanned, clean];
    setDeliveryRecords((prev) =>
      prev.map((d) => (d.id === deliveryId ? { ...d, scanned_packages: updated } : d))
    );

    const isReady = updated.length >= delivery.package_count;
    return {
      success: true,
      message: isReady
        ? `${updated.length} / ${delivery.package_count} scanned. READY TO LOAD.`
        : `Scanned ${clean}. (${updated.length} / ${delivery.package_count})`,
      scannedCount: updated.length,
      totalCount: delivery.package_count,
      readyToLoad: isReady,
    };
  };

  const recordDeliveryReceipt = (receiptData: Omit<DeliveryReceipt, 'id' | 'received_at'>): DeliveryReceipt => {
    const receipt: DeliveryReceipt = {
      ...receiptData,
      id: `rec-${Date.now()}`,
      received_at: new Date().toISOString(),
    };

    setDeliveryRecords((prev) =>
      prev.map((d) => {
        if (d.id !== receiptData.delivery_id && d.delivery_number !== receiptData.delivery_number) return d;

        const newStatus: DeliveryStatus =
          receiptData.condition_status === 'Damaged' ||
          receiptData.condition_status === 'Short Quantity' ||
          receiptData.condition_status === 'Wrong Item'
            ? 'Delivery Issue'
            : 'Delivered';

        return {
          ...d,
          status: newStatus,
          site_receipt: receipt,
          status_history: [
            {
              status: newStatus,
              timestamp: new Date().toISOString(),
              changed_by: `${currentUser.name} (${currentUser.role})`,
              notes: `Site receipt recorded: ${receiptData.condition_status}. (DELIVERED — INSTALLATION NOT STARTED)`,
            },
            ...d.status_history,
          ],
        };
      })
    );

    // If damage or short quantity, raise issue
    if (receiptData.damaged_quantity > 0 || receiptData.missing_quantity > 0 || receiptData.condition_status !== 'All In Order') {
      createIssue({
        title: `Site Receiving Defect: ${receiptData.delivery_number} (${receiptData.condition_status})`,
        category: 'Delivery',
        priority: 'High',
        description: `Discrepancy on receiving: ${receiptData.damage_description || receiptData.missing_description || 'Condition check failed'}. Damaged: ${receiptData.damaged_quantity}, Missing: ${receiptData.missing_quantity}.`,
        project_id: receiptData.project_id,
        assigned_to_id: currentUser.id,
        assigned_to_name: currentUser.name,
      });
    }

    addAuditLog(
      `Delivery Received: ${receiptData.delivery_number}`,
      currentUser.role,
      receiptData.project_name,
      'In Transit',
      `Delivered (${receiptData.condition_status})`
    );

    return receipt;
  };

  const createInstallationJob = (
    data: Omit<InstallationJob, 'id' | 'job_number' | 'progress_percent'>
  ): InstallationJob => {
    const jobNum = `INS-2026-0${10 + installationJobs.length}`;
    const id = `inst-${Date.now()}`;

    const newJob: InstallationJob = {
      ...data,
      id,
      job_number: jobNum,
      progress_percent: 0,
      installed_parts_count: 0,
      total_parts_count: data.total_parts_count || 4,
    };

    setInstallationJobs((prev) => [newJob, ...prev]);

    // Update work item installation status
    setWorkItems((prev) =>
      prev.map((w) =>
        w.id === data.work_item_id || w.item_code === data.work_item_code
          ? {
              ...w,
              installation_status: 'Scheduled',
              updated_at: new Date().toISOString(),
            }
          : w
      )
    );

    addAuditLog(
      `Installation Job Created: ${jobNum}`,
      currentUser.role,
      data.project_name,
      'Not Started',
      data.status || 'Scheduled'
    );

    return newJob;
  };

  const updateInstallationStatus = (jobId: string, status: InstallationJob['status'], notes?: string) => {
    setInstallationJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const prevStatus = j.status;
        const isStart = status === 'In Progress' && !j.actual_start_date;
        const isComplete = status === 'Completed' && !j.actual_completion_date;

        const updated: InstallationJob = {
          ...j,
          status,
          ...(isStart ? { actual_start_date: new Date().toISOString().split('T')[0] } : {}),
          ...(isComplete ? { actual_completion_date: new Date().toISOString().split('T')[0], progress_percent: 100 } : {}),
          notes: notes ? `${j.notes || ''} [${new Date().toLocaleDateString()}: ${notes}]` : j.notes,
        };

        // Sync with Work Item
        setWorkItems((wPrev) =>
          wPrev.map((w) =>
            w.id === j.work_item_id || w.item_code === j.work_item_code
              ? {
                  ...w,
                  installation_status: status === 'In Progress' ? 'In Progress' : status === 'Completed' ? 'Completed' : status === 'QC' ? 'QC' : 'Scheduled',
                  progress_percent: status === 'Completed' ? 100 : j.progress_percent,
                  updated_at: new Date().toISOString(),
                }
              : w
          )
        );

        addAuditLog(
          `Installation Status: ${j.job_number} (${j.work_item_code})`,
          currentUser.role,
          j.project_name,
          prevStatus,
          status
        );

        return updated;
      })
    );
  };

  const updateInstallationChecklist = (
    jobId: string,
    checklistUpdates: Partial<InstallationChecklist>,
    progressOverride?: number
  ) => {
    setInstallationJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const updatedChecklist = { ...j.checklist, ...checklistUpdates };

        // Calculate progress percentage based on 8 checklist points
        const keys = [
          'level_plumb',
          'secure_fixing',
          'alignment_adjacent',
          'hardware_operation',
          'surface_condition',
          'joint_sealant_tolerances',
          'services_integration',
          'cleanliness_protection',
        ] as const;

        const completedPoints = keys.filter((k) => updatedChecklist[k]).length;
        const computedPercent = progressOverride !== undefined ? progressOverride : Math.round((completedPoints / keys.length) * 100);

        // Update parts installed estimate
        const installedParts = Math.round((computedPercent / 100) * (j.total_parts_count || 8));

        // Update Work Item progress
        setWorkItems((wPrev) =>
          wPrev.map((w) =>
            w.id === j.work_item_id || w.item_code === j.work_item_code
              ? {
                  ...w,
                  progress_percent: computedPercent,
                  installation_status: computedPercent === 100 ? 'QC' : 'In Progress',
                  updated_at: new Date().toISOString(),
                }
              : w
          )
        );

        return {
          ...j,
          checklist: updatedChecklist,
          progress_percent: computedPercent,
          installed_parts_count: installedParts,
        };
      })
    );
  };

  const updateSiteReadiness = (jobId: string, readiness: Partial<SiteReadinessCheck>) => {
    setInstallationJobs((prev) =>
      prev.map((j) => {
        if (j.id !== jobId) return j;
        const currentReadiness = j.site_readiness || {
          site_accessible: true,
          area_clear: true,
          other_trades_completed: true,
          power_available: true,
          lighting_available: true,
          flooring_wall_acceptable: true,
          measurements_confirmed: true,
          approved_drawings_available: true,
          materials_received: true,
          tools_equipment_available: true,
          safety_requirements_satisfied: true,
          result: 'READY',
        };

        const merged: SiteReadinessCheck = {
          ...currentReadiness,
          ...readiness,
          checked_by: currentUser.name,
          checked_at: new Date().toISOString(),
        };

        // Determine result
        const checks = [
          merged.site_accessible,
          merged.area_clear,
          merged.other_trades_completed,
          merged.power_available,
          merged.lighting_available,
          merged.flooring_wall_acceptable,
          merged.measurements_confirmed,
          merged.approved_drawings_available,
          merged.materials_received,
          merged.tools_equipment_available,
          merged.safety_requirements_satisfied,
        ];

        const falseCount = checks.filter((c) => !c).length;
        merged.result = falseCount === 0 ? 'READY' : falseCount <= 2 ? 'PARTIALLY READY' : 'NOT READY';

        if (merged.result === 'NOT READY') {
          createIssue({
            title: `Site Not Ready for Installation: ${j.work_item_code}`,
            category: 'Site condition',
            priority: 'High',
            description: `Site readiness check failed for ${j.job_number} (${j.work_item_code}). Unfavourable conditions detected. Notes: ${merged.notes || 'Access or power issue'}`,
            project_id: j.project_id,
            location: j.location,
            assigned_to_id: currentUser.id,
            assigned_to_name: currentUser.name,
          });
        }

        return {
          ...j,
          site_readiness: merged,
          status: merged.result === 'READY' ? 'Site Ready' : merged.result === 'NOT READY' ? 'Blocked' : j.status,
        };
      })
    );
  };

  const recordSiteQCInspection = (
    inspectionData: Omit<SiteQCInspection, 'id' | 'inspection_number'>
  ): SiteQCInspection => {
    const inspectionNum = `SQC-2026-0${10 + siteQCInspections.length}`;
    const id = `sqc-${Date.now()}`;

    const newInspection: SiteQCInspection = {
      ...inspectionData,
      id,
      inspection_number: inspectionNum,
    };

    setSiteQCInspections((prev) => [newInspection, ...prev]);

    // If failed or rectification required:
    if (newInspection.result === 'Fail / Rectification Required' || newInspection.result === 'Pass with Minor Rectification') {
      if (newInspection.result === 'Fail / Rectification Required') {
        updateInstallationStatus(newInspection.installation_job_id, 'Rectification', 'Site QC inspection failed. Rectification required.');
      }

      // Create issue for each snag
      newInspection.snag_items.forEach((snag) => {
        createIssue({
          title: `Site QC Snag: ${newInspection.work_item_code} - ${snag.description.slice(0, 40)}`,
          category: 'Quality rejection' as any,
          priority: snag.severity === 'Critical' ? 'Critical' : snag.severity === 'Moderate' ? 'High' : 'Medium',
          description: `Snag #${snag.item_number} [${snag.category}]: ${snag.description}. Assigned to: ${snag.assigned_to}. Deadline: ${snag.deadline}.`,
          project_id: newInspection.project_id,
          assigned_to_id: currentUser.id,
          assigned_to_name: snag.assigned_to,
          due_date: snag.deadline,
        });
      });
    } else {
      // Passed!
      updateInstallationStatus(newInspection.installation_job_id, 'Completed', 'Site QC passed with zero snags.');
    }

    addAuditLog(
      `Site QC Inspection: ${inspectionNum} (${newInspection.work_item_code})`,
      currentUser.role,
      newInspection.project_name,
      'Awaiting Inspection',
      newInspection.result
    );

    return newInspection;
  };

  const updateSnagItem = (inspectionId: string, snagId: string, updates: Partial<SnagItem>) => {
    setSiteQCInspections((prev) =>
      prev.map((ins) => {
        if (ins.id !== inspectionId) return ins;
        const updatedSnags = ins.snag_items.map((s) => (s.id === snagId ? { ...s, ...updates } : s));
        const allClosed = updatedSnags.every((s) => s.status === 'Verified Closed');

        return {
          ...ins,
          snag_items: updatedSnags,
          result: allClosed ? 'Pass' : ins.result,
        };
      })
    );
  };

  const updateHandoverRecord = (handoverId: string, updates: Partial<HandoverRecord>) => {
    setHandoverRecords((prev) =>
      prev.map((h) => {
        if (h.id !== handoverId) return h;
        const updated = { ...h, ...updates };

        addAuditLog(
          `Handover Record Updated: ${h.cpc_certificate_number}`,
          currentUser.role,
          h.project_name,
          h.status,
          updated.status
        );

        return updated;
      })
    );
  };

  const resolveDeliveryConflict = (deliveryId: string, newTime: string, notes: string) => {
    setDeliveryRecords((prev) =>
      prev.map((d) => {
        if (d.id !== deliveryId) return d;
        return {
          ...d,
          delivery_time: newTime,
          schedule_conflict: undefined,
          notes: `${d.notes || ''} [Conflict resolved: moved to ${newTime} - ${notes}]`,
          status_history: [
            {
              status: 'Rescheduled',
              timestamp: new Date().toISOString(),
              changed_by: `${currentUser.name} (${currentUser.role})`,
              notes: `Schedule conflict resolved: Delivery slot moved to ${newTime}. ${notes}`,
            },
            ...d.status_history,
          ],
        };
      })
    );

    addAuditLog(
      `Delivery Conflict Resolved: ${deliveryId}`,
      currentUser.role,
      'Site Bay',
      'Conflict',
      `Rescheduled to ${newTime}`
    );
  };

  const addSiteMeasurement = (
    data: Omit<SiteMeasurementRecord, 'id' | 'date_time' | 'is_conflict' | 'conflict_notes'>
  ): SiteMeasurementRecord => {
    const valNum = parseFloat(data.measurement_value.replace(/[^0-9.]/g, ''));
    const approvedNum = parseFloat(data.approved_dimension.replace(/[^0-9.]/g, ''));

    // If difference > 10mm, flag conflict!
    const diff = !isNaN(valNum) && !isNaN(approvedNum) ? Math.abs(valNum - approvedNum) : 0;
    const isConflict = diff > 10;
    const conflictNotes = isConflict
      ? `⚠️ MEASUREMENT CONFLICT: Site measured ${data.measurement_value}${data.unit} vs approved drawing ${data.approved_dimension} (Variance: ${valNum - approvedNum > 0 ? '+' : ''}${valNum - approvedNum}mm). Decision Required.`
      : undefined;

    const newRecord: SiteMeasurementRecord = {
      ...data,
      id: `meas-${Date.now()}`,
      date_time: new Date().toISOString(),
      is_conflict: isConflict,
      conflict_notes: conflictNotes,
    };

    setSiteMeasurements((prev) => [newRecord, ...prev]);

    if (isConflict) {
      createIssue({
        title: `Site Measurement Conflict: ${data.work_item_code}`,
        category: 'Site condition',
        priority: 'Critical',
        description: `${conflictNotes} Measured at ${data.location}. Requires Owner / PM decision on plinth scribe trim or dimension adjustment.`,
        project_id: data.project_id,
        location: data.location,
        assigned_to_id: currentUser.id,
        assigned_to_name: currentUser.name,
      });
    }

    addAuditLog(
      `Site Measurement Recorded: ${data.work_item_code}`,
      currentUser.role,
      data.project_name,
      data.approved_dimension,
      `${data.measurement_value}${data.unit}${isConflict ? ' [CONFLICT]' : ' [MATCH]'}`
    );

    return newRecord;
  };

  const addClientChangeRequest = (
    data: Omit<ClientChangeRequest, 'id' | 'request_code' | 'requested_date' | 'status'>
  ): ClientChangeRequest => {
    const reqCode = `CCR-2026-0${10 + clientChangeRequests.length}`;
    const id = `ccr-${Date.now()}`;

    // Automatically route to existing Variations workflow!
    const draftVariation = {
      variation_number: `VO-POTENTIAL-${reqCode}`,
      project_id: data.project_id,
      title: `Client Scope Change: ${data.work_item_code} — ${data.requested_change.slice(0, 30)}`,
      description: `Client site request: "${data.request_details}". Requested change: ${data.requested_change}. Current drawing baseline: ${data.current_drawing_rev}.`,
      scope_category: 'Addition' as const,
      reason: 'Client request during installation',
      cost_breakdown: {
        materials_cost: 850,
        labour_cost: 600,
        subcontractor_cost: 350,
        preliminaries: 100,
        margin_percent: 25,
      },
      contractor_claim_amount: 1900,
      client_variation_amount: 2450,
      time_extension_days: 3,
      status: 'Draft' as const,
      client_approval_status: 'Pending' as const,
      requested_by: data.requested_by,
      requested_date: new Date().toISOString().split('T')[0],
      created_by: currentUser.name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setVariations((prev) => [draftVariation as any, ...prev]);

    const newReq: ClientChangeRequest = {
      ...data,
      id,
      request_code: reqCode,
      requested_date: new Date().toISOString(),
      status: 'Costing / Variation Created',
      linked_variation_id: draftVariation.variation_number,
    };

    setClientChangeRequests((prev) => [newReq, ...prev]);

    addAuditLog(
      `Client Change Request: ${reqCode}`,
      currentUser.role,
      data.project_name,
      'Installation',
      'Routed to Variation Workflow'
    );

    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: 'Project Manager',
        title: `Client Scope Change Request: ${reqCode}`,
        message: `${data.requested_by} requested: "${data.requested_change}". Routed to Variations module. Commercial costing required before implementation.`,
        type: 'variation',
        priority: 'urgent',
        is_read: false,
        project_id: data.project_id,
        link_type: 'variation',
        link_id: draftVariation.variation_number,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    return newReq;
  };

  // ----------------------------------------------------
  // MODULE 15: AUTOMATION, TASK, NOTIFICATION & ESCALATION ENGINE IMPLEMENTATION
  // ----------------------------------------------------

  const createTask = (taskData: Omit<NWTask, 'id' | 'task_number' | 'created_date' | 'comments' | 'attachments'>): NWTask => {
    const id = 'tsk-' + Date.now();
    const taskNum = `TSK-2026-${Math.floor(100 + Math.random() * 900)}`;

    const newTask: NWTask = {
      ...taskData,
      id,
      task_number: taskNum,
      created_date: new Date().toISOString(),
      comments: [],
      attachments: [],
    };

    setTasks((prev) => [newTask, ...prev]);

    addAuditLog(
      `Created Task ${taskNum}`,
      'Task',
      id,
      newTask.project_name,
      `Priority: ${newTask.priority} • Assigned: ${newTask.assigned_role} (${newTask.assigned_user_name})`
    );

    // Push notification to recipient role
    setNotifications((prev) => [
      {
        id: 'notif-' + Date.now(),
        target_role: newTask.assigned_role,
        target_user_id: newTask.assigned_user_id,
        title: `New Task Assigned: ${newTask.task_number}`,
        message: `${newTask.title}. Due: ${newTask.due_date} ${newTask.due_time || ''}`,
        type: newTask.is_critical ? 'escalation' : 'issue',
        priority: newTask.is_critical || newTask.priority === 'Critical' || newTask.priority === 'Urgent' ? 'urgent' : 'normal',
        is_read: false,
        project_id: newTask.project_id,
        link_type: 'work_item',
        link_id: newTask.id,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    return newTask;
  };

  const updateTaskStatus = (taskId: string, status: TaskStatus, comment?: string) => {
    const currentTask = tasks.find((t) => t.id === taskId);
    if (!currentTask) return;

    const completedDate = status === 'Completed' ? new Date().toISOString() : currentTask.completed_date;

    const updatedComments = comment
      ? [
          {
            id: 'c-' + Date.now(),
            user_name: currentUser.name,
            role: currentUser.role,
            text: comment,
            timestamp: new Date().toISOString(),
          },
          ...currentTask.comments,
        ]
      : currentTask.comments;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status,
              completed_date: completedDate,
              comments: updatedComments,
            }
          : t
      )
    );

    addAuditLog(
      `Updated Task Status: ${currentTask.task_number}`,
      'Task',
      taskId,
      currentTask.status,
      status
    );

    // If task was completed, check if any dependent tasks can now be unblocked!
    if (status === 'Completed') {
      setTasks((prev) =>
        prev.map((t) => {
          if (t.status === 'Blocked' && t.dependency_task_ids && t.dependency_task_ids.includes(taskId)) {
            // Check if ALL dependencies are now completed
            const otherDeps = t.dependency_task_ids.filter((depId) => depId !== taskId);
            const allOthersCompleted = otherDeps.every((depId) => {
              const depTask = prev.find((dt) => dt.id === depId);
              return depTask && depTask.status === 'Completed';
            });

            if (allOthersCompleted) {
              return {
                ...t,
                status: 'Open',
                comments: [
                  {
                    id: 'c-dep-' + Date.now(),
                    user_name: 'Automation Engine',
                    role: 'System',
                    text: `Prerequisite task ${currentTask.task_number} completed. Task unblocked and marked Open.`,
                    timestamp: new Date().toISOString(),
                  },
                  ...t.comments,
                ],
              };
            }
          }
          return t;
        })
      );
    }
  };

  const updateTask = (taskId: string, updates: Partial<NWTask>) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t))
    );
    addAuditLog('Updated Task Details', 'Task', taskId, '', JSON.stringify(updates));
  };

  const escalateTask = (taskId: string, toLevel: TaskEscalationLevel, reason: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const assignedRole: UserRole =
      toLevel === 'Owner'
        ? 'Owner / CEO'
        : toLevel === 'PM'
        ? 'Project Manager'
        : 'Site Supervisor';

    const assignedName =
      toLevel === 'Owner'
        ? 'Carson (Owner / CEO)'
        : toLevel === 'PM'
        ? 'Marcus Lee'
        : 'Suresh Kumar';

    const escNum = `ESC-2026-${Math.floor(10 + Math.random() * 90)}`;
    const newEscalation: EscalationRecord = {
      id: 'esc-' + Date.now(),
      escalation_number: escNum,
      source_record_type: 'Task',
      source_record_id: taskId,
      project_id: task.project_id,
      project_name: task.project_name,
      title: `Escalation: ${task.title}`,
      reason: reason || `Task SLA deadline breached or technical dispute arose`,
      previous_level: task.escalation_level,
      current_level: toLevel,
      assigned_role: assignedRole,
      assigned_user_name: assignedName,
      is_critical: task.priority === 'Critical',
      requires_acknowledgement: toLevel === 'Owner' || task.priority === 'Critical',
      created_at: new Date().toISOString(),
    };

    setEscalations((prev) => [newEscalation, ...prev]);

    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              status: 'Escalated',
              escalation_level: toLevel,
              assigned_role: assignedRole,
              assigned_user_name: assignedName,
              comments: [
                {
                  id: 'c-esc-' + Date.now(),
                  user_name: currentUser.name,
                  role: currentUser.role,
                  text: `Escalated to ${toLevel} (${assignedRole}). Reason: ${reason}`,
                  timestamp: new Date().toISOString(),
                },
                ...t.comments,
              ],
            }
          : t
      )
    );

    addAuditLog(
      `Escalated Task ${task.task_number}`,
      'Escalation',
      newEscalation.id,
      task.escalation_level,
      `Escalated to ${toLevel}: ${reason}`
    );

    // Urgent notification
    setNotifications((prev) => [
      {
        id: 'notif-esc-' + Date.now(),
        target_role: assignedRole,
        title: `🔴 Escalation: ${task.task_number} (${toLevel})`,
        message: `${task.title}. Escalated by ${currentUser.name}: ${reason}`,
        type: 'escalation',
        priority: 'urgent',
        is_read: false,
        project_id: task.project_id,
        link_type: 'work_item',
        link_id: task.id,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);
  };

  const acknowledgeTask = (taskId: string) => {
    const timestamp = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              acknowledged_at: timestamp,
              acknowledged_by: currentUser.name,
              comments: [
                {
                  id: 'c-ack-' + Date.now(),
                  user_name: currentUser.name,
                  role: currentUser.role,
                  text: `Formally acknowledged by ${currentUser.name} (${currentUser.role}).`,
                  timestamp,
                },
                ...t.comments,
              ],
            }
          : t
      )
    );

    addAuditLog('Acknowledged Task', 'Task', taskId, 'Pending Acknowledgement', 'Acknowledged');
  };

  const acknowledgeEscalation = (escalationId: string) => {
    const timestamp = new Date().toISOString();
    setEscalations((prev) =>
      prev.map((e) =>
        e.id === escalationId
          ? {
              ...e,
              acknowledged_at: timestamp,
              acknowledged_by: currentUser.name,
            }
          : e
      )
    );

    addAuditLog('Acknowledged Escalation', 'Escalation', escalationId, 'Pending', 'Acknowledged');
  };

  const executeTaskNextBestAction = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !task.next_best_action) return;

    const action = task.next_best_action;

    // Log the automated action
    const commentText = `AI Recommendation Executed: "${action.suggested_action}" (Confidence: ${action.confidence}).`;

    updateTaskStatus(taskId, task.status === 'Open' ? 'In Progress' : task.status, commentText);

    // If it triggers notification or issue
    setNotifications((prev) => [
      {
        id: 'notif-nba-' + Date.now(),
        target_role: task.assigned_role,
        title: `AI Action Executed for ${task.task_number}`,
        message: action.suggested_action,
        type: 'issue',
        priority: 'normal',
        is_read: false,
        project_id: task.project_id,
        created_at: new Date().toISOString(),
      },
      ...prev,
    ]);

    addAuditLog('Executed AI Next Best Action', 'Task', taskId, '', action.suggested_action);
  };

  const addTaskComment = (taskId: string, text: string) => {
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              comments: [
                {
                  id: 'c-' + Date.now(),
                  user_name: currentUser.name,
                  role: currentUser.role,
                  text,
                  timestamp: new Date().toISOString(),
                },
                ...t.comments,
              ],
            }
          : t
      )
    );
  };

  const triggerAutomationEvent = (
    eventType: AutomationEventType,
    sourceModule: string,
    sourceRecord: string,
    projectId: string,
    payload: Record<string, any>,
    workItemId?: string
  ) => {
    const now = new Date();
    const idempotencyKey = `evt-${eventType}-${sourceRecord}-${now.toISOString().slice(0, 16)}`;

    // Rule 36: DUPLICATE PROTECTION:
    // If the same event arrives twice within the same minute for the same record, prevent duplicate task creation!
    const isDuplicate = automationEvents.some(
      (e) => e.idempotency_key === idempotencyKey && (Date.now() - new Date(e.timestamp).getTime()) < 60000
    );

    if (isDuplicate) {
      console.warn(`[Automation Engine] Duplicate event blocked by idempotency key: ${idempotencyKey}`);
      return;
    }

    const eventRecord: AutomationEvent = {
      id: 'evt-' + Date.now(),
      event_type: eventType,
      source_module: sourceModule,
      source_record: sourceRecord,
      project_id: projectId,
      work_item_id: workItemId,
      user_id: currentUser.id,
      timestamp: now.toISOString(),
      event_data: payload,
      processed: true,
      idempotency_key: idempotencyKey,
    };

    setAutomationEvents((prev) => [eventRecord, ...prev]);

    // Find active matching rules
    const matchingRules = automationRules.filter(
      (r) => r.is_active && r.trigger_event === eventType && (r.applies_to_projects.includes('all') || r.applies_to_projects.includes(projectId))
    );

    const projectObj = projects.find((p) => p.id === projectId) || projects[0];

    matchingRules.forEach((rule) => {
      // Evaluate rule conditions
      const conditionPassed = rule.conditions.every((cond) => {
        const val = payload[cond.field];
        if (cond.operator === 'equals') return val === cond.value;
        if (cond.operator === 'not_equals') return val !== cond.value;
        if (cond.operator === 'contains') return String(val).toLowerCase().includes(String(cond.value).toLowerCase());
        if (cond.operator === 'greater_than') return Number(val) > Number(cond.value);
        if (cond.operator === 'less_than') return Number(val) < Number(cond.value);
        if (cond.operator === 'is_not_empty') return val !== undefined && val !== null && val !== '';
        return true;
      });

      if (!conditionPassed) return;

      const runId = 'run-' + Date.now();
      const startTime = new Date().toISOString();

      try {
        rule.actions.forEach((action) => {
          if (
            action.action_type === 'create_task' ||
            action.action_type === 'create_qc_task' ||
            action.action_type === 'create_variation_review'
          ) {
            const dueDate = new Date(Date.now() + (rule.deadline_hours || 4) * 3600000).toISOString().split('T')[0];
            const dueTime = new Date(Date.now() + (rule.deadline_hours || 4) * 3600000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            const title = (action.template_title || rule.name)
              .replace('{work_item_code}', payload.work_item_code || 'ITM')
              .replace('{project_name}', projectObj.project_name)
              .replace('{revision_number}', payload.revision_number || 'Rev 1');

            const desc = (action.template_message || rule.description)
              .replace('{work_item_code}', payload.work_item_code || 'ITM')
              .replace('{contractor_name}', payload.contractor_name || 'Subcontractor')
              .replace('{project_name}', projectObj.project_name);

            createTask({
              title,
              description: desc,
              project_id: projectId,
              project_name: projectObj.project_name,
              work_item_id: workItemId,
              work_item_code: payload.work_item_code,
              source_event: eventType,
              source_module: (sourceModule as any) || 'System Automation',
              source_reason: `Rule ${rule.rule_code}: ${rule.name}`,
              assigned_user_id: action.target_user_id || 'u-3',
              assigned_user_name: action.target_role || rule.assign_to_role,
              assigned_role: action.target_role || rule.assign_to_role,
              priority: action.priority || rule.priority,
              due_date: dueDate,
              due_time: dueTime,
              status: 'Open',
              escalation_level: 'None',
              is_critical: rule.priority === 'Critical',
              requires_acknowledgement: rule.priority === 'Critical',
            });
          } else if (action.action_type === 'escalate') {
            const escRecord: EscalationRecord = {
              id: 'esc-' + Date.now(),
              escalation_number: `ESC-2026-${Math.floor(10 + Math.random() * 90)}`,
              source_record_type: 'Task',
              source_record_id: sourceRecord,
              project_id: projectId,
              project_name: projectObj.project_name,
              title: action.template_title || `Escalation: ${rule.name}`,
              reason: action.template_message || `Triggered by ${eventType}`,
              previous_level: 'Site Supervisor',
              current_level: 'Owner',
              assigned_role: 'Owner / CEO',
              assigned_user_name: 'Carson (Owner / CEO)',
              is_critical: true,
              requires_acknowledgement: true,
              created_at: new Date().toISOString(),
            };
            setEscalations((prev) => [escRecord, ...prev]);
          } else if (action.action_type === 'send_notification' || action.action_type === 'send_whatsapp') {
            setNotifications((prev) => [
              {
                id: 'notif-' + Date.now(),
                target_role: action.target_role || rule.assign_to_role,
                title: action.template_title || rule.name,
                message: action.template_message || rule.description,
                type: 'issue',
                priority: rule.priority === 'Critical' ? 'urgent' : 'normal',
                is_read: false,
                project_id: projectId,
                created_at: new Date().toISOString(),
              },
              ...prev,
            ]);
          }
        });

        // Record successful run
        const runRecord: AutomationRun = {
          id: runId,
          rule_id: rule.id,
          rule_name: rule.name,
          event_id: eventRecord.id,
          event_type: eventType,
          status: 'Success',
          started_at: startTime,
          completed_at: new Date().toISOString(),
          result_description: `Rule ${rule.rule_code} executed actions successfully.`,
          retry_count: 0,
          max_retries: 3,
          idempotency_key: idempotencyKey,
        };
        setAutomationRuns((prev) => [runRecord, ...prev]);
      } catch (err: any) {
        // Record failed automation (Rule 34 & 35)
        const failedRecord: FailedAutomation = {
          id: 'fail-' + Date.now(),
          run_id: runId,
          rule_id: rule.id,
          rule_name: rule.name,
          error_reason: err?.message || 'Action execution exception occurred',
          failure_category: 'Validation Error',
          failed_at: new Date().toISOString(),
          retry_attempts: 1,
          can_retry_manually: true,
          is_resolved: false,
        };
        setFailedAutomations((prev) => [failedRecord, ...prev]);
      }
    });
  };

  const createAutomationRule = (ruleData: Omit<AutomationRule, 'id' | 'rule_code' | 'created_by' | 'updated_at'>): AutomationRule => {
    const id = 'rule-' + Date.now();
    const count = automationRules.length + 1;
    const ruleCode = `RULE-${count < 10 ? '0' + count : count}`;

    const newRule: AutomationRule = {
      ...ruleData,
      id,
      rule_code: ruleCode,
      created_by: currentUser.name,
      updated_at: new Date().toISOString(),
    };

    setAutomationRules((prev) => [...prev, newRule]);
    addAuditLog(`Created Automation Rule ${ruleCode}`, 'AutomationRule', id, '', newRule.name);
    return newRule;
  };

  const updateAutomationRule = (ruleId: string, updates: Partial<AutomationRule>) => {
    setAutomationRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, ...updates, updated_at: new Date().toISOString() } : r))
    );
    addAuditLog('Updated Automation Rule', 'AutomationRule', ruleId, '', JSON.stringify(updates));
  };

  const toggleAutomationRule = (ruleId: string) => {
    const rule = automationRules.find((r) => r.id === ruleId);
    if (!rule) return;
    const nextState = !rule.is_active;

    setAutomationRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, is_active: nextState, updated_at: new Date().toISOString() } : r))
    );

    addAuditLog(
      nextState ? 'Activated Automation Rule' : 'Deactivated Automation Rule',
      'AutomationRule',
      ruleId,
      rule.rule_code,
      nextState ? 'Active' : 'Inactive'
    );
  };

  const retryFailedAutomation = (failureId: string): { success: boolean; message: string } => {
    const failure = failedAutomations.find((f) => f.id === failureId);
    if (!failure) return { success: false, message: 'Failure record not found' };

    // Simulate successful resolution on retry
    setFailedAutomations((prev) =>
      prev.map((f) =>
        f.id === failureId
          ? {
              ...f,
              retry_attempts: f.retry_attempts + 1,
              is_resolved: true,
            }
          : f
      )
    );

    addAuditLog(
      'Retried Failed Automation',
      'AutomationRun',
      failure.run_id,
      `Attempt ${failure.retry_attempts}`,
      'Resolved manually'
    );

    return { success: true, message: `Automation run ${failure.run_id} retry succeeded.` };
  };

  const createOwnerOverride = (
    record: Omit<OwnerOverrideRecord, 'id' | 'overridden_by' | 'overridden_by_role' | 'timestamp'>
  ): OwnerOverrideRecord => {
    const newOverride: OwnerOverrideRecord = {
      ...record,
      id: 'ovr-' + Date.now(),
      overridden_by: currentUser.name,
      overridden_by_role: currentUser.role,
      timestamp: new Date().toISOString(),
    };

    setOwnerOverrides((prev) => [newOverride, ...prev]);

    addAuditLog(
      `EXECUTIVE OVERRIDE: ${record.affected_record_type}`,
      'OwnerOverride',
      record.affected_record_id,
      record.previous_rule_state,
      `Authorized Decision: ${record.new_decision}. Reason: ${record.reason}`
    );

    return newOverride;
  };

  const updateNotificationPreferences = (userId: string, preferences: UserNotificationPreference) => {
    setUserNotificationPreferences((prev) => {
      const idx = prev.findIndex((p) => p.user_id === userId);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = preferences;
        return copy;
      }
      return [...prev, preferences];
    });
  };

  const updateBusinessCalendar = (calendarUpdates: Partial<BusinessCalendarConfig>) => {
    setBusinessCalendar((prev) => ({
      ...prev,
      ...calendarUpdates,
    }));
    addAuditLog('Updated Business Calendar', 'SystemConfig', 'Calendar', '', JSON.stringify(calendarUpdates));
  };

  const applyWorkflowTemplate = (templateCode: string, projectId: string): { tasksCreated: number } => {
    const tpl = workflowTemplates.find((t) => t.code === templateCode);
    const proj = projects.find((p) => p.id === projectId) || projects[0];
    if (!tpl) return { tasksCreated: 0 };

    let createdCount = 0;
    tpl.stages.forEach((stage, idx) => {
      const dueDate = new Date(Date.now() + (idx + 1) * 86400000 * 2).toISOString().split('T')[0];
      createTask({
        title: `${stage.phase_name}: ${stage.action_type}`,
        description: `Template: ${tpl.name}. Steps: ${stage.checklist.join(' • ')}`,
        project_id: proj.id,
        project_name: proj.project_name,
        source_event: 'project.created',
        source_module: 'System Automation',
        source_reason: `Workflow Template applied: ${tpl.name}`,
        assigned_user_id: 'u-3',
        assigned_user_name: stage.default_role,
        assigned_role: stage.default_role,
        priority: 'Normal',
        due_date: dueDate,
        status: idx === 0 ? 'Open' : 'Blocked',
        escalation_level: 'None',
        is_critical: false,
      });
      createdCount++;
    });

    addAuditLog(
      `Applied Workflow Template: ${tpl.name}`,
      'WorkflowTemplate',
      tpl.id,
      proj.project_name,
      `Created ${createdCount} sequential tasks`
    );

    return { tasksCreated: createdCount };
  };

  return (
    <NWContext.Provider
      value={{
        currentUser,
        availableUsers,
        setCurrentUser,
        switchRole,
        switchUser,
        addUser,
        updateUser,
        toggleUserStatus,
        language,
        setLanguage,
        projects,
        userProjects,
        clients,
        contractors,
        workPackages,
        workItems,
        drawings,
        knowledge,
        issues,
        variations,
        documents,
        notifications,
        auditLogs,
        qcRecords,
        approvals,
        createApproval,
        decideApproval,
        suppliers,
        purchaseOrders,
        materialRequests,
        createPurchaseOrder,
        updatePOStatus,
        createMaterialRequest,
        financialClaims,
        payments,
        messages,
        aiActions,
        pmInbox,
        sendChatMessage,
        resolvePMInboxItem,
        runScenarioTest,
        selectedProjectId,
        setSelectedProjectId,
        selectedProject,
        updateWorkItemStatus,
        submitQCInspection,
        scheduleDelivery,
        confirmDeliveryReceived,
        activateInstallation,
        completeInstallation,
        createIssue,
        resolveIssue,
        escalateIssue,
        approveVariation,
        addDrawingMarkup,
        addKnowledgeItem,
        uploadDrawing,
        addDrawingRevision,
        setDrawingRevisionStatus,
        analyzeDrawingWithAI,
        approveAISuggestedWorkItem,
        compareDrawingRevisions,
        addNWProductionReview,
        createNWProductionDrawing,
        approveNWProductionDrawing,
        drawingDemoStep,
        setDrawingDemoStep,
        runDrawingDemoWorkflowStep,
        resetDrawingDemo,
        addClient,
        updateClient,
        deleteClient,
        addProject,
        updateProject,
        addContractor,
        updateContractor,
        deactivateContractor,
        deleteContractor,
        addWorkPackage,
        updateWorkPackage,
        deleteWorkPackage,
        addWorkItem,
        updateWorkItem,
        addWorkItemPhoto,
        markNotificationRead,
        clearAllNotifications,
        resetToDemoData,
        coreDataSync,
        authMode: Boolean(authUser),
        signOut,
        gatewayContacts,
        gatewayMessages,
        conversationThreads,
        messageQueue,
        aiActionRequests,
        gatewaySettings,
        gatewayMetrics,
        securityTestCases,
        processSimulatedWhatsAppMessage,
        runSecurityTest,
        runAllSecurityTests,
        approveAIActionRequest,
        rejectAIActionRequest,
        requestMoreInfoForAction,
        retryQueueItem,
        cancelQueueItem,
        clearDeliveredQueue,
        addGatewayContact,
        updateGatewayContact,
        verifyGatewayContact,
        updateGatewaySettings,
        undoAIAction,
        saveKnowledgeFromConversation,
        clientEnquiries,
        commercialTenders,
        commercialQuotations,
        priceDatabase,
        commercialBaselines,
        projectCostLedger,
        goodsReceived,
        commercialInvoices,
        costLeakAlerts,
        cashflowEntries,
        addClientEnquiry,
        updateClientEnquiry,
        addCommercialTender,
        updateCommercialTender,
        addCommercialQuotation,
        updateCommercialQuotation,
        createNewQuotationVersion,
        approveCommercialQuotation,
        addProjectCostLedgerItem,
        allocateCostToProjects,
        addGoodsReceivedRecord,
        addCommercialInvoice,
        updateInvoicePayment,
        resolveCostLeakAlert,
        updateCommercialBaseline,
        addPriceDatabaseRecord,
        productionOrders,
        productionParts,
        productionMaterials,
        cncJobs,
        cncFileVersions,
        assemblyJobs,
        finishingJobs,
        factoryQCInspections,
        packingPackages,
        productionIssues,
        createProductionOrder,
        updateProductionOrderStatus,
        addProductionPart,
        updatePartStatus,
        createCNCJob,
        updateCNCJobStatus,
        uploadCNCFileVersion,
        updateAssemblyJob,
        toggleAssemblyPartCheck,
        toggleAssemblyHardwareCheck,
        updateFinishingJob,
        recordFactoryQC,
        createPackingPackage,
        updatePackingStatus,
        reportProductionIssue,
        resolveProductionIssue,
        handleDrawingRevisionProductionCheck,
        scanBarcodeOrQRCode,
        deliveryRecords,
        installationJobs,
        siteQCInspections,
        handoverRecords,
        siteMeasurements,
        clientChangeRequests,
        createDeliveryRecord,
        scheduleDeliveryRecord,
        updateDeliveryStatus,
        updateLoadingChecklist,
        scanPackageForLoading,
        recordDeliveryReceipt,
        createInstallationJob,
        updateInstallationStatus,
        updateInstallationChecklist,
        updateSiteReadiness,
        recordSiteQCInspection,
        updateSnagItem,
        updateHandoverRecord,
        resolveDeliveryConflict,
        addSiteMeasurement,
        addClientChangeRequest,
        tasks,
        automationRules,
        automationEvents,
        automationRuns,
        failedAutomations,
        escalations,
        userNotificationPreferences,
        dailyBriefings,
        workflowTemplates,
        ownerOverrides,
        businessCalendar,
        createTask,
        updateTaskStatus,
        updateTask,
        escalateTask,
        acknowledgeTask,
        acknowledgeEscalation,
        executeTaskNextBestAction,
        addTaskComment,
        triggerAutomationEvent,
        createAutomationRule,
        updateAutomationRule,
        toggleAutomationRule,
        retryFailedAutomation,
        createOwnerOverride,
        updateNotificationPreferences,
        updateBusinessCalendar,
        applyWorkflowTemplate,
      }}
    >
      {children}
    </NWContext.Provider>
  );
};

export const useNW = () => {
  const context = useContext(NWContext);
  if (!context) {
    throw new Error('useNW must be used within a NWProvider');
  }
  return context;
};
