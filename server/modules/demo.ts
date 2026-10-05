import * as D from '../../src/data/initialData';
import * as A from '../../src/data/automationInitialData';
import * as DL from '../../src/data/deliveryInitialData';
import * as P from '../../src/data/productionInitialData';
import type { Row } from './types';

/**
 * The app's built-in demo data, keyed by the collection names the server uses (core chain
 * + every Phase 3 module). Used by `npm run db:import-demo`, the dev seed and tests; it goes
 * through the same validated import as any other data.
 */
export function demoData(): Record<string, Row[]> {
  const rows = (v: unknown) => structuredClone(v) as Row[];
  return {
    clients: rows(D.INITIAL_CLIENTS),
    projects: rows(D.INITIAL_PROJECTS),
    workPackages: rows(D.INITIAL_WORK_PACKAGES),
    workItems: rows(D.INITIAL_WORK_ITEMS),
    drawings: rows(D.INITIAL_DRAWINGS),
    documents: rows(D.INITIAL_DOCUMENTS),
    issues: rows(D.INITIAL_ISSUES),
    tasks: rows(A.INITIAL_TASKS),
    escalations: rows(A.INITIAL_ESCALATIONS),
    approvals: rows(D.INITIAL_APPROVALS),
    variations: rows(D.INITIAL_VARIATIONS),
    clientChangeRequests: rows(DL.INITIAL_CLIENT_CHANGE_REQUESTS),
    qcRecords: rows(D.INITIAL_QC_RECORDS),
    siteMeasurements: rows(DL.INITIAL_SITE_MEASUREMENTS),
    productionOrders: rows(P.INITIAL_PRODUCTION_ORDERS),
    productionParts: rows(P.INITIAL_PRODUCTION_PARTS),
    cncJobs: rows(P.INITIAL_CNC_JOBS),
    assemblyJobs: rows(P.INITIAL_ASSEMBLY_JOBS),
    finishingJobs: rows(P.INITIAL_FINISHING_JOBS),
    factoryQCInspections: rows(P.INITIAL_FACTORY_QC_INSPECTIONS),
    packingPackages: rows(P.INITIAL_PACKING_PACKAGES),
    productionIssues: rows(P.INITIAL_PRODUCTION_ISSUES),
    cncFileVersions: rows(P.INITIAL_CNC_FILE_VERSIONS),
    productionMaterials: rows(P.INITIAL_PRODUCTION_MATERIALS),
    deliveryRecords: rows(DL.INITIAL_DELIVERY_RECORDS),
    installationJobs: rows(DL.INITIAL_INSTALLATION_JOBS),
    siteQCInspections: rows(DL.INITIAL_SITE_QC_INSPECTIONS),
    handoverRecords: rows(DL.INITIAL_HANDOVER_RECORDS),
    clientEnquiries: rows(D.INITIAL_CLIENT_ENQUIRIES),
    commercialTenders: rows(D.INITIAL_COMMERCIAL_TENDERS),
    commercialQuotations: rows(D.INITIAL_COMMERCIAL_QUOTATIONS),
    priceDatabase: rows(D.INITIAL_PRICE_DATABASE),
    commercialBaselines: rows(D.INITIAL_PROJECT_COMMERCIAL_BASELINES),
    suppliers: rows(D.INITIAL_SUPPLIERS),
    purchaseOrders: rows(D.INITIAL_PURCHASE_ORDERS),
    goodsReceived: rows(D.INITIAL_GOODS_RECEIVED),
    materialRequests: rows(D.INITIAL_MATERIAL_REQUESTS),
    projectCostLedger: rows(D.INITIAL_PROJECT_COST_LEDGER),
    commercialInvoices: rows(D.INITIAL_COMMERCIAL_INVOICES),
    costLeakAlerts: rows(D.INITIAL_COST_LEAK_ALERTS),
    cashflowEntries: rows(D.INITIAL_CASHFLOW_ENTRIES),
    financialClaims: rows(D.INITIAL_CLAIMS),
    payments: rows(D.INITIAL_PAYMENTS),
  };
}
