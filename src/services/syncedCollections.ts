/**
 * Collections whose source of truth is PostgreSQL in database mode, in dependency order
 * (parents first). `key` is the NWContext state / API collection name, `storageKey` the
 * localStorage cache key suffix, `idField` the record's key.
 */
export interface SyncedCollection {
  key: string;
  storageKey: string;
  idField: string;
}

export const SYNCED_COLLECTIONS: SyncedCollection[] = [
  // Phase 1 core chain
  { key: 'clients', storageKey: 'clients', idField: 'id' },
  { key: 'projects', storageKey: 'projects', idField: 'id' },
  { key: 'workPackages', storageKey: 'workPackages', idField: 'id' },
  { key: 'workItems', storageKey: 'workItems', idField: 'id' },
  // Phase 3 modules
  { key: 'drawings', storageKey: 'drawings', idField: 'id' },
  { key: 'documents', storageKey: 'documents', idField: 'id' },
  { key: 'issues', storageKey: 'issues', idField: 'id' },
  { key: 'tasks', storageKey: 'nw_tasks', idField: 'id' },
  { key: 'escalations', storageKey: 'escalations', idField: 'id' },
  { key: 'approvals', storageKey: 'approvals', idField: 'id' },
  { key: 'variations', storageKey: 'variations', idField: 'id' },
  { key: 'clientChangeRequests', storageKey: 'client_change_requests', idField: 'id' },
  { key: 'qcRecords', storageKey: 'qcRecords', idField: 'id' },
  { key: 'siteMeasurements', storageKey: 'site_measurements', idField: 'id' },
  { key: 'productionOrders', storageKey: 'production_orders', idField: 'id' },
  { key: 'productionParts', storageKey: 'production_parts', idField: 'id' },
  { key: 'cncJobs', storageKey: 'cnc_jobs', idField: 'id' },
  { key: 'assemblyJobs', storageKey: 'assembly_jobs', idField: 'id' },
  { key: 'finishingJobs', storageKey: 'finishing_jobs', idField: 'id' },
  { key: 'factoryQCInspections', storageKey: 'factory_qc_inspections', idField: 'id' },
  { key: 'packingPackages', storageKey: 'packing_packages', idField: 'id' },
  { key: 'productionIssues', storageKey: 'production_issues', idField: 'id' },
  { key: 'cncFileVersions', storageKey: 'cnc_file_versions', idField: 'id' },
  { key: 'productionMaterials', storageKey: 'production_materials', idField: 'id' },
  { key: 'deliveryRecords', storageKey: 'delivery_records', idField: 'id' },
  { key: 'installationJobs', storageKey: 'installation_jobs', idField: 'id' },
  { key: 'siteQCInspections', storageKey: 'site_qc_inspections', idField: 'id' },
  { key: 'handoverRecords', storageKey: 'handover_records', idField: 'id' },
  { key: 'clientEnquiries', storageKey: 'client_enquiries', idField: 'id' },
  { key: 'commercialTenders', storageKey: 'commercial_tenders', idField: 'id' },
  { key: 'commercialQuotations', storageKey: 'commercial_quotations', idField: 'id' },
  { key: 'priceDatabase', storageKey: 'price_database', idField: 'id' },
  { key: 'commercialBaselines', storageKey: 'commercial_baselines', idField: 'project_id' },
  { key: 'suppliers', storageKey: 'suppliers', idField: 'id' },
  { key: 'purchaseOrders', storageKey: 'purchaseOrders', idField: 'id' },
  { key: 'goodsReceived', storageKey: 'goods_received', idField: 'id' },
  { key: 'materialRequests', storageKey: 'materialRequests', idField: 'id' },
  { key: 'projectCostLedger', storageKey: 'project_cost_ledger', idField: 'cost_id' },
  { key: 'commercialInvoices', storageKey: 'commercial_invoices', idField: 'id' },
  { key: 'costLeakAlerts', storageKey: 'cost_leak_alerts', idField: 'id' },
  { key: 'cashflowEntries', storageKey: 'cashflow_entries', idField: 'id' },
  { key: 'financialClaims', storageKey: 'financialClaims', idField: 'id' },
  { key: 'payments', storageKey: 'payments', idField: 'id' },
];

export const SYNCED_KEYS = SYNCED_COLLECTIONS.map((c) => c.key);
