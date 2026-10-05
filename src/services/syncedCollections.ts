/**
 * Collections whose source of truth is PostgreSQL in database mode, in dependency order
 * (parents first). `key` is the NWContext state / API collection name, `storageKey` the
 * localStorage cache key suffix, `idField` the record's key, `path` its REST path under /api.
 */
export interface SyncedCollection {
  key: string;
  storageKey: string;
  idField: string;
  /** REST path under /api (server/core/routes.ts, server/modules/registry.ts). */
  path: string;
}

export const SYNCED_COLLECTIONS: SyncedCollection[] = [
  // Phase 1 core chain
  { key: 'clients', storageKey: 'clients', idField: 'id', path: 'clients' },
  { key: 'projects', storageKey: 'projects', idField: 'id', path: 'projects' },
  { key: 'workPackages', storageKey: 'workPackages', idField: 'id', path: 'work-packages' },
  { key: 'workItems', storageKey: 'workItems', idField: 'id', path: 'work-items' },
  // Phase 3 modules
  { key: 'drawings', storageKey: 'drawings', idField: 'id', path: 'drawings' },
  { key: 'documents', storageKey: 'documents', idField: 'id', path: 'documents' },
  { key: 'issues', storageKey: 'issues', idField: 'id', path: 'issues' },
  { key: 'tasks', storageKey: 'nw_tasks', idField: 'id', path: 'tasks' },
  { key: 'escalations', storageKey: 'escalations', idField: 'id', path: 'escalations' },
  { key: 'approvals', storageKey: 'approvals', idField: 'id', path: 'approvals' },
  { key: 'variations', storageKey: 'variations', idField: 'id', path: 'variations' },
  { key: 'clientChangeRequests', storageKey: 'client_change_requests', idField: 'id', path: 'client-change-requests' },
  { key: 'qcRecords', storageKey: 'qcRecords', idField: 'id', path: 'qc-records' },
  { key: 'siteMeasurements', storageKey: 'site_measurements', idField: 'id', path: 'site-measurements' },
  { key: 'productionOrders', storageKey: 'production_orders', idField: 'id', path: 'production-orders' },
  { key: 'productionParts', storageKey: 'production_parts', idField: 'id', path: 'production-parts' },
  { key: 'cncJobs', storageKey: 'cnc_jobs', idField: 'id', path: 'cnc-jobs' },
  { key: 'assemblyJobs', storageKey: 'assembly_jobs', idField: 'id', path: 'assembly-jobs' },
  { key: 'finishingJobs', storageKey: 'finishing_jobs', idField: 'id', path: 'finishing-jobs' },
  { key: 'factoryQCInspections', storageKey: 'factory_qc_inspections', idField: 'id', path: 'factory-qc' },
  { key: 'packingPackages', storageKey: 'packing_packages', idField: 'id', path: 'packing-packages' },
  { key: 'productionIssues', storageKey: 'production_issues', idField: 'id', path: 'production-issues' },
  { key: 'cncFileVersions', storageKey: 'cnc_file_versions', idField: 'id', path: 'cnc-file-versions' },
  { key: 'productionMaterials', storageKey: 'production_materials', idField: 'id', path: 'production-materials' },
  { key: 'deliveryRecords', storageKey: 'delivery_records', idField: 'id', path: 'deliveries' },
  { key: 'installationJobs', storageKey: 'installation_jobs', idField: 'id', path: 'installation-jobs' },
  { key: 'siteQCInspections', storageKey: 'site_qc_inspections', idField: 'id', path: 'site-qc' },
  { key: 'handoverRecords', storageKey: 'handover_records', idField: 'id', path: 'handovers' },
  { key: 'clientEnquiries', storageKey: 'client_enquiries', idField: 'id', path: 'client-enquiries' },
  { key: 'commercialTenders', storageKey: 'commercial_tenders', idField: 'id', path: 'tenders' },
  { key: 'commercialQuotations', storageKey: 'commercial_quotations', idField: 'id', path: 'quotations' },
  { key: 'priceDatabase', storageKey: 'price_database', idField: 'id', path: 'price-database' },
  { key: 'commercialBaselines', storageKey: 'commercial_baselines', idField: 'project_id', path: 'commercial-baselines' },
  { key: 'suppliers', storageKey: 'suppliers', idField: 'id', path: 'suppliers' },
  { key: 'purchaseOrders', storageKey: 'purchaseOrders', idField: 'id', path: 'purchase-orders' },
  { key: 'goodsReceived', storageKey: 'goods_received', idField: 'id', path: 'goods-received' },
  { key: 'materialRequests', storageKey: 'materialRequests', idField: 'id', path: 'material-requests' },
  { key: 'projectCostLedger', storageKey: 'project_cost_ledger', idField: 'cost_id', path: 'cost-ledger' },
  { key: 'commercialInvoices', storageKey: 'commercial_invoices', idField: 'id', path: 'invoices' },
  { key: 'costLeakAlerts', storageKey: 'cost_leak_alerts', idField: 'id', path: 'cost-leak-alerts' },
  { key: 'cashflowEntries', storageKey: 'cashflow_entries', idField: 'id', path: 'cashflow' },
  { key: 'financialClaims', storageKey: 'financialClaims', idField: 'id', path: 'claims' },
  { key: 'payments', storageKey: 'payments', idField: 'id', path: 'payments' },
  // Phase 4
  { key: 'knowledge', storageKey: 'knowledge', idField: 'id', path: 'knowledge' },
];

export const SYNCED_KEYS = SYNCED_COLLECTIONS.map((c) => c.key);

export const COLLECTION_BY_KEY = new Map(SYNCED_COLLECTIONS.map((c) => [c.key, c]));
