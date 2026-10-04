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
