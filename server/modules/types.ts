import type { PermissionKey } from '../../src/types';
import type { AccessContext } from '../auth/access';
import type { AuditActor } from '../audit';
import type { PoolClient } from '../db/pool';

export type Row = Record<string, unknown>;

/** A real column copied from the record (or computed from it) on every write. */
export interface ColumnSpec {
  col: string;
  /** Record field to read (defaults to `col`) or a function of the record. */
  from?: string | ((record: Row) => unknown);
  kind?: 'text' | 'num' | 'bool' | 'ts';
}

/**
 * How a record reaches its project, which decides who can see it:
 *  project - record.project_id (or `field`)
 *  order   - through its production order
 *  client  - pre-project commercial records tied to a client (project once awarded)
 *  company - company-wide catalogues, gated by permission only
 */
export type Scope =
  | { kind: 'project'; field?: string; optional?: boolean }
  | { kind: 'order' }
  | { kind: 'client' }
  | { kind: 'company' };

type Perm = PermissionKey | PermissionKey[];

export interface ModulePerms {
  view: Perm;
  create: Perm | null;
  edit: Perm | null;
  /** null = records are never deleted through the API (history is kept). */
  delete: Perm | null;
}

export type WriteMode = 'rest' | 'sync' | 'import';

export interface HookContext {
  ctx: AccessContext;
  db: PoolClient;
  actor: AuditActor;
  mode: WriteMode;
  /** Run after every write in the batch, before commit (cross-record rules). */
  defer: (check: () => Promise<void>) => void;
  /** Write another module record in the same transaction (e.g. a rectification issue). */
  insertSystemRecord: (collection: string, record: Row, details: string) => Promise<Row>;
  /** Collections written in this transaction (reported to commit listeners, e.g. automation). */
  touched?: Set<string>;
}

export interface ModuleHooks {
  /** Validate and normalise a write; return the record to store. `existing` is undefined on create. */
  beforeWrite?: (h: HookContext, existing: Row | undefined, incoming: Row) => Promise<Row>;
  /** Extra writes in the same transaction once the row is stored. */
  afterWrite?: (h: HookContext, existing: Row | undefined, stored: Row) => Promise<void>;
  /** What goes in `data` (default: the whole record). */
  serialize?: (record: Row) => Row;
  /** Rebuild app records from stored rows (e.g. attach revisions). */
  hydrate?: (db: PoolClient | import('../db/pool').Pool, records: Row[]) => Promise<Row[]>;
  /** Called before a delete is allowed (e.g. to protect history). */
  beforeDelete?: (h: HookContext, existing: Row) => Promise<void>;
}

export interface ModuleDef {
  /** Collection name used by the app (NWContext state) and in snapshot/sync payloads. */
  key: string;
  table: string;
  /** REST path under /api. */
  path: string;
  /** Primary key field in the app record (column is always `id`). */
  idField: string;
  columns: ColumnSpec[];
  scope: Scope;
  perms: ModulePerms;
  /** Records the server writes itself (e.g. receipts); the API and sync can only read them. */
  readOnly?: boolean;
  /**
   * Fields some readers may not see (e.g. a variation's internal cost for clients). Removed
   * from every response for users without `permission`, and kept unchanged when such a user
   * writes the record back.
   */
  hiddenFields?: { permission: PermissionKey; fields: string[] };
  /** Column the list is ordered by (default created_at). */
  orderBy?: string;
  /** Fields that must be present and non-empty in every record. */
  required?: string[];
  hooks?: ModuleHooks;
}
