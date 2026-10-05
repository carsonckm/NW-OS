/**
 * Browser client for the core-chain database API (server/core/routes.ts).
 * Clients -> Projects -> Work Packages -> Work Items.
 */
import type { Client, Project, WorkItem, WorkPackage } from '../types';
import { UNAUTHORIZED_EVENT } from './authApi';

export interface CoreData {
  clients: Client[];
  projects: Project[];
  workPackages: WorkPackage[];
  workItems: WorkItem[];
}

export type CoreCollection = keyof CoreData;

export const CORE_COLLECTIONS: CoreCollection[] = ['clients', 'projects', 'workPackages', 'workItems'];

export interface CoreStatus {
  configured: boolean;
  connected: boolean;
  dataSource: 'local' | 'database';
  pendingMigrations: string[];
  authEnabled?: boolean;
  /** Only reported to signed-in users. */
  databaseEmpty?: boolean;
  error?: string;
}

export interface CoreChanges {
  upserts: Partial<{ [K in CoreCollection]: CoreData[K] }>;
  deletes: Partial<Record<CoreCollection, string[]>>;
}

export interface ImportResult {
  ok: boolean;
  dryRun: boolean;
  imported: boolean;
  summary: Record<CoreCollection, { received: number; new: number; skippedExisting: number }>;
  problems: string[];
}

export type ClientTree = Client & {
  projects: (Project & { work_packages: (WorkPackage & { work_items: WorkItem[] })[] })[];
};

export class CoreApiError extends Error {
  constructor(public status: number, public code: string, message: string, public body?: unknown) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new CoreApiError(res.status, body?.error || 'http_error', body?.message || `HTTP ${res.status}`, body);
  }
  return body as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

function resource<T extends { id: string }>(path: string) {
  return {
    list: (filter: Record<string, string> = {}) => {
      const qs = new URLSearchParams(filter).toString();
      return request<T[]>(`/${path}${qs ? `?${qs}` : ''}`);
    },
    get: (id: string) => request<T>(`/${path}/${encodeURIComponent(id)}`),
    create: (data: Partial<T>) => request<T>(`/${path}`, json('POST', data)),
    update: (id: string, patch: Partial<T>) => request<T>(`/${path}/${encodeURIComponent(id)}`, json('PATCH', patch)),
    remove: (id: string) => request<void>(`/${path}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  };
}

/** Any synced collection's records, keyed by collection (see syncedCollections.ts). */
export type SyncData = Record<string, Record<string, unknown>[]>;

export interface SyncChanges {
  upserts: Record<string, Record<string, unknown>[]>;
  deletes: Record<string, string[]>;
}

export interface DataImportResult {
  ok: boolean;
  dryRun: boolean;
  imported: boolean;
  summary: Record<string, { received: number; new: number; skippedExisting: number }>;
  problems: string[];
}

/** Unified data API (core chain + Phase 3 modules), one transaction per sync. */
export const dataApi = {
  status: () => request<{ databaseEmpty: boolean }>('/data/status'),
  snapshot: () => request<SyncData>('/data/snapshot'),
  sync: (changes: SyncChanges) => request<{ upserted: number; deleted: number }>('/data/sync', json('POST', changes)),
  importData: async (data: SyncData, { dryRun = false } = {}): Promise<DataImportResult> => {
    try {
      return await request<DataImportResult>(`/data/import${dryRun ? '?dryRun=true' : ''}`, json('POST', data));
    } catch (err) {
      if (err instanceof CoreApiError && err.status === 422) return err.body as DataImportResult;
      throw err;
    }
  },
  auditLogs: (limit = 300) => request<Record<string, unknown>[]>(`/audit-logs?limit=${limit}`),
  /** One collection as the server holds it (e.g. 'commercial-baselines'). */
  list: <T = Record<string, unknown>>(path: string) => request<T[]>(`/${path}`),
  /** The server's official contract value, costs and project gross profit for one project. */
  profitability: (projectId: string) => request<ServerFinancials>(`/projects/${encodeURIComponent(projectId)}/profitability`),
};

/** GET /api/projects/:id/profitability (server/modules/reports.ts). */
export interface ServerFinancials {
  project_id: string;
  original_contract_value: number;
  approved_variations_total: number;
  approved_variations_count: number;
  current_contract_value: number;
  pending_variations_total: number;
  pending_variations_count: number;
  selling_price: number;
  estimated_final_revenue: number;
  estimated_direct_cost: number;
  committed_cost: number;
  actual_cost: number;
  forecast_final_cost: number;
  cost_variance: number;
  cost_variance_status: 'On Budget' | 'Minor Variance' | 'Forecast Over Budget' | 'Critical Overrun';
  current_gross_profit: number;
  project_gross_profit: number;
  project_gross_margin_percent: number;
}

export const coreApi = {
  status: () => request<CoreStatus>('/core/status'),
  snapshot: () => request<CoreData>('/core/snapshot'),
  sync: (changes: CoreChanges) => request<{ upserted: number; deleted: number }>('/core/sync', json('POST', changes)),
  importData: async (data: CoreData, { dryRun = false } = {}): Promise<ImportResult> => {
    // A 422 still carries the validation report, so surface it rather than throwing.
    try {
      return await request<ImportResult>(`/core/import${dryRun ? '?dryRun=true' : ''}`, json('POST', data));
    } catch (err) {
      if (err instanceof CoreApiError && err.status === 422) return err.body as ImportResult;
      throw err;
    }
  },
  clientTree: (clientId: string) => request<ClientTree>(`/clients/${encodeURIComponent(clientId)}/tree`),
  clients: resource<Client>('clients'),
  projects: resource<Project>('projects'),
  workPackages: resource<WorkPackage>('work-packages'),
  workItems: resource<WorkItem>('work-items'),
};

/** Any authenticated JSON call under /api (Phase 4 workflow actions). */
export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown = {}) => request<T>(path, json('POST', body)),
  patch: <T>(path: string, body: unknown) => request<T>(path, json('PATCH', body)),
  put: <T>(path: string, body: unknown) => request<T>(path, json('PUT', body)),
  delete: (path: string) => request<void>(path, { method: 'DELETE' }),
};
