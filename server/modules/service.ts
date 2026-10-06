import { randomUUID } from 'crypto';
import { AccessContext, ForbiddenError } from '../auth/access';
import { changedFields, writeAudit, type AuditActor } from '../audit';
import { CoreRepository, NotFoundError, ValidationError, type CoreChanges } from '../core/repository';
import { COLLECTION_ORDER, type CoreCollection } from '../core/schema';
import { CoreService } from '../core/service';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import { findClientRevision } from './hooks/drawings';
import { hasOpenFailedSiteQc } from './hooks/site';
import { deriveWorkItem } from './workItemStatus';
import { MODULES, MODULE_BY_KEY } from './registry';
import { inModuleScope, loadOrderInfo, requireAny, hasAny, type OrderInfo } from './scope';
import { deleteRecord, findRecord, listRecords, recordId, validateRecord, writeRecord } from './store';
import type { HookContext, ModuleDef, Row, WriteMode } from './types';

const CORE = new Set<string>(COLLECTION_ORDER);

export interface DataChanges {
  upserts?: Record<string, Row[]>;
  deletes?: Record<string, string[]>;
}

/** 404 for a module record that does not exist or is outside the user's scope. */
function notFound(what: string) {
  const err = new NotFoundError('clients', what);
  err.message = `${what} not found`;
  return err;
}

/** Thrown inside a dry-run import to roll the transaction back after collecting results. */
class DryRunRollback extends Error {}

/**
 * Every read and write of core-chain and module records for one signed-in user.
 * Each write: permission -> scope (before and after) -> business-rule hook -> store ->
 * audit, all in one transaction; cross-record rules run just before commit.
 */
/** Called after a transaction commits, with the collections it wrote (e.g. to trigger automation). */
type CommitListener = (collections: string[]) => void;
const commitListeners = new Set<CommitListener>();
export function onCommitted(listener: CommitListener) {
  commitListeners.add(listener);
  return () => commitListeners.delete(listener);
}

export class DataService {
  readonly core: CoreService;
  private coreRepo: CoreRepository;

  constructor(private pool: Pool) {
    this.coreRepo = new CoreRepository(pool);
    this.core = new CoreService(this.coreRepo);
  }

  module(key: string): ModuleDef {
    const def = MODULE_BY_KEY.get(key);
    if (!def) throw notFound(`collection ${key}`);
    return def;
  }

  // ------------------------------------------------------------------ reads

  private visible(ctx: AccessContext, def: ModuleDef, rows: Row[], orders: OrderInfo) {
    if (!hasAny(ctx, def.perms.view)) return [];
    return rows.filter((r) => inModuleScope(ctx, def, r, orders)).map((r) => this.redact(ctx, def, r));
  }

  /** Removes the module's hidden fields for users without the permission to see them. */
  redact<T extends Row | undefined>(ctx: AccessContext, def: ModuleDef, record: T): T {
    if (!record || !def.hiddenFields || ctx.can(def.hiddenFields.permission)) return record;
    const out: Row = { ...record };
    for (const f of def.hiddenFields.fields) delete out[f];
    return out as T;
  }

  async list(ctx: AccessContext, def: ModuleDef, filter: Record<string, string | undefined>) {
    requireAny(ctx, def.perms.view, `viewing ${def.key}`);
    const [rows, orders] = await Promise.all([listRecords(this.pool, def, filter), loadOrderInfo(this.pool)]);
    return this.visible(ctx, def, rows, orders);
  }

  async get(ctx: AccessContext, def: ModuleDef, id: string) {
    requireAny(ctx, def.perms.view, `viewing ${def.key}`);
    const record = await findRecord(this.pool, def, id);
    if (!record || !inModuleScope(ctx, def, record, await loadOrderInfo(this.pool))) throw notFound(`${def.key} ${id}`);
    return this.redact(ctx, def, record);
  }

  /** Everything this user may see: core chain plus every module collection. */
  async snapshot(ctx: AccessContext) {
    const core = await this.core.snapshot(ctx);
    const orders = await loadOrderInfo(this.pool);
    const out: Record<string, Row[]> = { ...(core as unknown as Record<string, Row[]>) };
    for (const def of MODULES) {
      out[def.key] = hasAny(ctx, def.perms.view) ? this.visible(ctx, def, await listRecords(this.pool, def), orders) : [];
    }
    return out;
  }

  // ----------------------------------------------------------------- writes

  private hookContext(ctx: AccessContext, db: PoolClient, actor: AuditActor, mode: WriteMode, deferred: (() => Promise<void>)[]): HookContext {
    const h: HookContext = {
      ctx,
      db,
      actor,
      mode,
      defer: (check) => deferred.push(check),
      touched: new Set<string>(),
      insertSystemRecord: async (collection, record, details) => {
        const def = this.module(collection);
        h.touched?.add(def.key);
        validateRecord(def, record);
        await writeRecord(db, def, record, actor.id ?? undefined, 'upsert');
        await writeAudit(db, actor, {
          action: 'create',
          entityType: def.key,
          entityId: recordId(def, record),
          projectId: (record.project_id as string) ?? null,
          after: record,
          details: `system: ${details}`,
        });
        return record;
      },
      writeModule: (collection, existing, incoming) => this.writeModule(h, this.module(collection), existing, incoming),
    };
    return h;
  }

  private orderCache = new WeakMap<PoolClient, OrderInfo>();

  private async ordersFor(db: PoolClient, needed?: unknown): Promise<OrderInfo> {
    let orders = this.orderCache.get(db);
    if (!orders || (typeof needed === 'string' && !orders.has(needed))) {
      orders = await loadOrderInfo(db);
      this.orderCache.set(db, orders);
    }
    return orders;
  }

  /** Authorise, validate, store and audit one module record (create when `existing` is undefined). */
  private async writeModule(h: HookContext, def: ModuleDef, existing: Row | undefined, incoming: Row) {
    if (def.readOnly) throw new ForbiddenError(`${def.key} are recorded by the server and cannot be written`);
    h.touched?.add(def.key);
    validateRecord(def, incoming);
    if (existing && !inModuleScope(h.ctx, def, existing, await this.ordersFor(h.db))) {
      throw new ForbiddenError(`${def.key} ${recordId(def, existing)} not found or not accessible`);
    }
    if (h.mode !== 'import') requireAny(h.ctx, existing ? def.perms.edit : def.perms.create, `${existing ? 'editing' : 'creating'} ${def.key}`);
    // A user who can't see hidden fields can't change them either: keep the stored values.
    if (def.hiddenFields && h.mode !== 'import' && !h.ctx.can(def.hiddenFields.permission)) {
      incoming = { ...incoming };
      for (const f of def.hiddenFields.fields) {
        if (existing && f in existing) incoming[f] = existing[f];
        else delete incoming[f];
      }
    }

    const values = def.hooks?.beforeWrite ? await def.hooks.beforeWrite(h, existing, incoming) : incoming;
    if (h.mode !== 'import' && !inModuleScope(h.ctx, def, values, await this.ordersFor(h.db, values.production_order_id))) {
      throw new ForbiddenError(`Target project for ${def.key} not found or not accessible`);
    }
    if (existing && JSON.stringify(existing) === JSON.stringify(values) && !def.hooks?.afterWrite) return values;

    await writeRecord(h.db, def, values, h.actor.id ?? undefined, 'upsert');
    if (h.mode !== 'import') {
      const changed = changedFields(existing, values);
      await writeAudit(h.db, h.actor, {
        action: existing ? 'update' : 'create',
        entityType: def.key,
        entityId: recordId(def, values),
        projectId: (values.project_id as string) ?? null,
        before: existing ? Object.fromEntries(changed.map((f) => [f, existing[f]])) : undefined,
        after: existing ? Object.fromEntries(changed.map((f) => [f, values[f]])) : values,
      });
    }
    await def.hooks?.afterWrite?.(h, existing, values);
    return values;
  }

  private async deleteModule(h: HookContext, def: ModuleDef, existing: Row) {
    if (def.readOnly) throw new ForbiddenError(`${def.key} cannot be deleted`);
    if (!inModuleScope(h.ctx, def, existing, await this.ordersFor(h.db))) throw new ForbiddenError(`${def.key} not found or not accessible`);
    if (!def.perms.delete) throw new ForbiddenError(`${def.key} records are kept for history and cannot be deleted`);
    requireAny(h.ctx, def.perms.delete, `deleting ${def.key}`);
    await def.hooks?.beforeDelete?.(h, existing);
    await deleteRecord(h.db, def, recordId(def, existing));
    await writeAudit(h.db, h.actor, {
      action: 'delete',
      entityType: def.key,
      entityId: recordId(def, existing),
      projectId: (existing.project_id as string) ?? null,
      before: existing,
    });
  }

  /** Core-chain write authorisation for the unified sync, plus Phase 3 rules for work items. */
  private coreAuthorize(h: HookContext) {
    return async (collection: CoreCollection, existing: Row | undefined, incoming: Row | undefined) => {
      if (existing && !h.ctx.inScope(collection, existing)) {
        throw new ForbiddenError(`${collection} ${String(existing.id)} not found or not accessible`);
      }
      const values = h.ctx.authorizeWrite(collection, existing, incoming);
      if (values && collection === 'projects' && h.mode !== 'import') this.checkProjectCompletion(h, existing, values);
      // Risk is computed by the server (risk engine), never set from the browser.
      if (values && collection === 'projects' && h.mode !== 'import') {
        values.risk_status = existing?.risk_status ?? null;
        values.is_at_risk = existing?.is_at_risk ?? null;
        values.risk_reason = existing?.risk_reason ?? null;
      }
      // Sensitivity is the Owner's setting (PUT /api/projects/:id/sensitivity), never the browser's.
      // An import may carry a valid stored value; everything else keeps what is stored.
      if (values && collection === 'projects') {
        const imported = h.mode === 'import' && ['Normal', 'Sensitive', 'Strategic'].includes(String(values.sensitivity)) ? values.sensitivity : undefined;
        values.sensitivity = imported ?? existing?.sensitivity ?? 'Normal';
      }
      if (!values || collection !== 'workItems') return values;
      // A production user (no work_items.edit) may only link an item to an order made for that item.
      if (h.mode !== 'import' && !h.ctx.can('work_items.edit') && values.production_order_id && values.production_order_id !== existing?.production_order_id) {
        const itemId = String(existing?.id ?? values.id);
        const orderId = String(values.production_order_id);
        h.defer(async () => {
          const order = (await h.db.query('SELECT work_item_id FROM production_orders WHERE id = $1', [orderId])).rows[0];
          if (!order || order.work_item_id !== itemId) throw new ValidationError(`Production order ${orderId} is not an order for work item ${itemId}`);
        });
      }
      // The revision an item was created from is fixed at creation.
      if (existing) values.source_drawing_revision_id = existing.source_drawing_revision_id ?? undefined;
      else if (!values.source_drawing_revision_id) {
        values.source_drawing_revision_id = (await findClientRevision(h.db, values.drawing_id, values.drawing_revision))?.id;
      }
      const completing =
        (values.status === 'Completed' && existing?.status !== 'Completed') ||
        (values.installation_status === 'Completed' && existing?.installation_status !== 'Completed');
      if (completing) {
        const id = String(values.id ?? existing?.id);
        h.defer(async () => {
          if (await hasOpenFailedSiteQc(h.db, id)) {
            throw new ForbiddenError(`Work item ${id} cannot be completed: its latest site QC failed and needs rectification`);
          }
        });
      }
      // Production, delivery, installation and the overall status come from their records
      // (orders, deliveries, installation jobs, site QC), never from the browser.
      if (h.mode !== 'import' && existing) Object.assign(values, await deriveWorkItem(h.db, String(existing.id), values));
      return values;
    };
  }

  /**
   * A project is marked Completed / Closed only by a person, and only when its handover is
   * signed and no site QC failure is still open. Closed comes after Completed.
   */
  private checkProjectCompletion(h: HookContext, existing: Row | undefined, values: Row) {
    const to = values.project_status;
    if (to !== 'Completed' && to !== 'Closed') return;
    if (existing?.project_status === to) return;
    if (to === 'Closed' && existing?.project_status !== 'Completed') throw new ForbiddenError('A project is closed after it is completed');
    const id = String(values.id ?? existing?.id);
    h.defer(async () => {
      const signed = await h.db.query(
        `SELECT 1 FROM handover_records WHERE project_id = $1 AND status IN ('Formal CPC Handover Signed', 'In DLP Period') LIMIT 1`,
        [id]
      );
      if (!signed.rowCount) throw new ForbiddenError('The project can be completed once its handover is signed');
      const failed = await h.db.query(
        `SELECT DISTINCT ON (work_item_id) work_item_id, result FROM site_qc_inspections
         WHERE project_id = $1 ORDER BY work_item_id, coalesce(inspected_at, '') DESC, created_at DESC, id DESC`,
        [id]
      );
      const open = failed.rows.filter((r) => r.result === 'Fail / Rectification Required');
      if (open.length) throw new ForbiddenError(`The project has ${open.length} work item(s) whose latest site QC failed`);
    });
  }

  private coreWritten(h: HookContext) {
    return async (collection: CoreCollection, existing: Row | undefined, stored: Row | undefined) => {
      h.touched?.add(collection);
      const id = String(stored?.id ?? existing?.id);
      const changed = stored ? changedFields(existing, stored) : [];
      await writeAudit(h.db, h.actor, {
        action: !stored ? 'delete' : existing ? 'update' : 'create',
        entityType: collection,
        entityId: id,
        projectId: (collection === 'projects' ? id : ((stored ?? existing)?.project_id as string)) ?? null,
        before: existing && stored ? Object.fromEntries(changed.map((f) => [f, existing[f]])) : existing,
        after: stored ? (existing ? Object.fromEntries(changed.map((f) => [f, stored[f]])) : stored) : undefined,
      });
    };
  }

  private async inTransaction<T>(ctx: AccessContext, actor: AuditActor, mode: WriteMode, fn: (h: HookContext) => Promise<T>) {
    let touched: Set<string> | undefined;
    const result = await withTransaction(this.pool, async (db) => {
      await db.query('SET CONSTRAINTS ALL DEFERRED');
      const deferred: (() => Promise<void>)[] = [];
      const h = this.hookContext(ctx, db, actor, mode, deferred);
      touched = h.touched;
      const result = await fn(h);
      for (const check of deferred) await check();
      // Surface deferred foreign-key errors here, as a normal error, instead of at COMMIT.
      await db.query('SET CONSTRAINTS ALL IMMEDIATE');
      return result;
    });
    // Automation's own writes don't re-trigger automation.
    if (touched?.size && mode !== 'import' && actor.role !== 'system') for (const listener of commitListeners) listener([...touched]);
    return result;
  }

  async create(ctx: AccessContext, def: ModuleDef, input: Row, actor: AuditActor) {
    const record = { ...input, [def.idField]: (input[def.idField] as string) || `${def.key}-${randomUUID()}` };
    return this.inTransaction(ctx, actor, 'rest', async (h) => {
      if (await findRecord(h.db, def, recordId(def, record))) throw new ForbiddenError(`${def.key} ${recordId(def, record)} already exists`);
      await this.writeModule(h, def, undefined, record);
      return this.redact(ctx, def, await findRecord(h.db, def, recordId(def, record)));
    });
  }

  async update(ctx: AccessContext, def: ModuleDef, id: string, patch: Row, actor: AuditActor) {
    return this.inTransaction(ctx, actor, 'rest', async (h) => {
      const existing = await findRecord(h.db, def, id, true);
      if (!existing || !inModuleScope(ctx, def, existing, await this.ordersFor(h.db))) throw notFound(`${def.key} ${id}`);
      if (def.idField in patch && patch[def.idField] !== id) throw new ValidationError(`${def.idField} cannot be changed`);
      await this.writeModule(h, def, existing, { ...existing, ...patch, [def.idField]: id });
      return this.redact(ctx, def, await findRecord(h.db, def, id));
    });
  }

  async remove(ctx: AccessContext, def: ModuleDef, id: string, actor: AuditActor) {
    return this.inTransaction(ctx, actor, 'rest', async (h) => {
      const existing = await findRecord(h.db, def, id, true);
      if (!existing || !inModuleScope(ctx, def, existing, await this.ordersFor(h.db))) throw notFound(`${def.key} ${id}`);
      await this.deleteModule(h, def, existing);
    });
  }

  // Core chain REST writes (/api/clients, /projects, /work-packages, /work-items): same
  // authorisation and Phase 3 rules as the sync, and the audit row in the same transaction.
  private coreTx(h: HookContext) {
    return { db: h.db, authorize: this.coreAuthorize(h), onWritten: this.coreWritten(h) };
  }

  coreCreate(ctx: AccessContext, collection: CoreCollection, input: Row, actor: AuditActor) {
    return this.inTransaction(ctx, actor, 'rest', (h) => this.core.create(ctx, collection, input, this.coreTx(h)));
  }

  coreUpdate(ctx: AccessContext, collection: CoreCollection, id: string, patch: Row, actor: AuditActor) {
    return this.inTransaction(ctx, actor, 'rest', (h) => this.core.update(ctx, collection, id, patch, this.coreTx(h)));
  }

  coreRemove(ctx: AccessContext, collection: CoreCollection, id: string, actor: AuditActor) {
    return this.inTransaction(ctx, actor, 'rest', (h) => this.core.remove(ctx, collection, id, this.coreTx(h)));
  }

  /** Creates a core record (e.g. a project) inside a domain action's transaction, audited. */
  createCoreInTransaction(h: HookContext, collection: CoreCollection, input: Row) {
    return this.core.create(h.ctx, collection, input, this.coreTx(h));
  }

  /** Runs `fn` with a hook context in its own transaction (domain endpoints). */
  transact<T>(ctx: AccessContext, actor: AuditActor, fn: (h: HookContext) => Promise<T>) {
    return this.inTransaction(ctx, actor, 'rest', fn);
  }

  /** Writes a module record as part of a domain action (same rules as any write). */
  writeInTransaction(h: HookContext, def: ModuleDef, existing: Row | undefined, incoming: Row) {
    return this.writeModule(h, def, existing, incoming);
  }

  /**
   * Applies the browser's changes to the core chain and every module in ONE transaction:
   * either everything in the batch is allowed and consistent, or nothing is written.
   */
  async sync(ctx: AccessContext, changes: DataChanges, actor: AuditActor) {
    const upserts = changes.upserts ?? {};
    const deletes = changes.deletes ?? {};
    for (const key of [...Object.keys(upserts), ...Object.keys(deletes)]) {
      if (!CORE.has(key) && !MODULE_BY_KEY.has(key)) throw new ValidationError(`Unknown collection: ${key}`);
    }
    return this.inTransaction(ctx, actor, 'sync', async (h) => {
      const coreChanges: CoreChanges = { upserts: {}, deletes: {} };
      for (const c of COLLECTION_ORDER) {
        if (upserts[c]) coreChanges.upserts![c] = upserts[c];
        if (deletes[c]) coreChanges.deletes![c] = deletes[c];
      }
      const counts = await this.coreRepo.applyChangesWith(h.db, coreChanges, this.coreAuthorize(h), this.coreWritten(h));

      for (const def of [...MODULES].reverse()) {
        for (const id of deletes[def.key] ?? []) {
          const existing = await findRecord(h.db, def, id, true);
          if (!existing) continue;
          await this.deleteModule(h, def, existing);
          counts.deleted++;
        }
      }
      for (const def of MODULES) {
        for (const record of upserts[def.key] ?? []) {
          validateRecord(def, record);
          const existing = await findRecord(h.db, def, recordId(def, record), true);
          await this.writeModule(h, def, existing, record);
          counts.upserted++;
        }
      }
      return counts;
    });
  }

  /**
   * Imports app data (a browser's local data or the demo seed) into the database. Records
   * whose id exists are skipped, never overwritten. Business-rule hooks run in import mode
   * (e.g. legacy production orders on superseded drawings are flagged, not rejected).
   * A dry run executes everything, checks every constraint, then rolls back.
   */
  async importData(ctx: AccessContext, data: Record<string, Row[]>, { dryRun = false }, actor: AuditActor) {
    ctx.require('settings.manage');
    const summary: Record<string, { received: number; new: number; skippedExisting: number }> = {};
    try {
      await this.inTransaction(ctx, actor, 'import', async (h) => {
        for (const c of COLLECTION_ORDER) {
          const rows = Array.isArray(data[c]) ? data[c] : [];
          summary[c] = { received: rows.length, new: 0, skippedExisting: 0 };
          for (const r of rows) {
            if ((await this.coreRepo.insertIfAbsent(h.db, c, this.withSource(r, c))) === false) summary[c].skippedExisting++;
            else summary[c].new++;
          }
        }
        // Work items get the revision they were created from once drawings exist (below).
        for (const def of MODULES) {
          const rows = def.readOnly || !Array.isArray(data[def.key]) ? [] : data[def.key];
          summary[def.key] = { received: rows.length, new: 0, skippedExisting: 0 };
          for (const r of rows) {
            validateRecord(def, r);
            if (await findRecord(h.db, def, recordId(def, r))) {
              summary[def.key].skippedExisting++;
              continue;
            }
            await this.writeModule(h, def, undefined, r);
            summary[def.key].new++;
          }
        }
        await h.db.query(`
          UPDATE work_items w SET source_drawing_revision_id = r.id
          FROM drawing_revisions r
          WHERE w.source_drawing_revision_id IS NULL AND r.drawing_id = w.drawing_id AND r.kind = 'client' AND r.revision = w.drawing_revision`);
        await writeAudit(h.db, actor, { action: 'import', entityType: 'data', details: JSON.stringify(summary) });
        if (dryRun) {
          await h.db.query('SET CONSTRAINTS ALL IMMEDIATE');
          throw new DryRunRollback();
        }
      });
    } catch (err) {
      if (!(err instanceof DryRunRollback)) {
        return { ok: false, dryRun, imported: false, summary, problems: [(err as Error).message + ((err as { detail?: string }).detail ? ` (${(err as { detail?: string }).detail})` : '')] };
      }
    }
    return { ok: true, dryRun, imported: !dryRun, summary, problems: [] as string[] };
  }

  private withSource(record: Row, collection: CoreCollection) {
    return collection === 'workItems' ? { ...record, source_drawing_revision_id: record.source_drawing_revision_id ?? undefined } : record;
  }

  async isEmpty() {
    if (!(await this.core.isEmpty())) return false;
    for (const def of MODULES) {
      if ((await this.pool.query(`SELECT 1 FROM "${def.table}" LIMIT 1`)).rowCount) return false;
    }
    return true;
  }
}
