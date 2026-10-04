import { randomUUID } from 'crypto';
import type { Client, Project, WorkItem, WorkPackage } from '../../src/types';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import {
  COLLECTION_ORDER,
  ENTITIES,
  fromRow,
  toRow,
  type CoreCollection,
  type CoreData,
  type EntityDef,
} from './schema';

type Row = Record<string, unknown>;
type Queryable = Pool | PoolClient;

export class NotFoundError extends Error {
  constructor(public collection: CoreCollection, public id: string) {
    super(`${collection} ${id} not found`);
  }
}

export class ValidationError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
  }
}

const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

function columnsOf(def: EntityDef) {
  return Object.keys(def.fields).map(q).join(', ');
}

async function insertRow(db: Queryable, def: EntityDef, row: Row, onConflict: 'error' | 'update' | 'skip') {
  const cols = Object.keys(row);
  const placeholders = cols.map((_, i) => `$${i + 1}`);
  let sql = `INSERT INTO ${q(def.table)} (${cols.map(q).join(', ')}) VALUES (${placeholders.join(', ')})`;
  if (onConflict === 'update') {
    const updates = cols.filter((c) => c !== 'id').map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
    sql += updates.length ? ` ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}` : ' ON CONFLICT (id) DO NOTHING';
  } else if (onConflict === 'skip') {
    sql += ' ON CONFLICT (id) DO NOTHING';
  }
  sql += ` RETURNING ${columnsOf(def)}`;
  const res = await db.query(sql, cols.map((c) => row[c]));
  return res.rows[0] as Row | undefined;
}

export class CoreRepository {
  constructor(private pool: Pool) {}

  // ---------- generic CRUD ----------

  async list<T>(collection: CoreCollection, filter: Record<string, string | undefined> = {}): Promise<T[]> {
    const def = ENTITIES[collection];
    const where: string[] = [];
    const values: string[] = [];
    for (const [field, value] of Object.entries(filter)) {
      if (value === undefined) continue;
      if (!(field in def.fields)) throw new ValidationError(`Unknown filter field: ${field}`);
      values.push(value);
      where.push(`${q(field)} = $${values.length}`);
    }
    const sql = `SELECT ${columnsOf(def)} FROM ${q(def.table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at, id`;
    const res = await this.pool.query(sql, values);
    return res.rows.map((r) => fromRow<T>(def, r));
  }

  async get<T>(collection: CoreCollection, id: string, db: Queryable = this.pool): Promise<T> {
    const def = ENTITIES[collection];
    const res = await db.query(`SELECT ${columnsOf(def)} FROM ${q(def.table)} WHERE id = $1`, [id]);
    if (!res.rows[0]) throw new NotFoundError(collection, id);
    return fromRow<T>(def, res.rows[0]);
  }

  async create<T>(collection: CoreCollection, input: Row): Promise<T> {
    const def = ENTITIES[collection];
    const data = await this.withDerivedProject(collection, input);
    const now = new Date().toISOString();
    const row = toRow(def, {
      ...data,
      id: typeof data.id === 'string' && data.id ? data.id : `${def.idPrefix}-${randomUUID()}`,
      created_at: data.created_at || now,
      updated_at: data.updated_at || now,
    });
    const created = await insertRow(this.pool, def, row, 'error');
    return fromRow<T>(def, created!);
  }

  async update<T>(collection: CoreCollection, id: string, patch: Row): Promise<T> {
    const def = ENTITIES[collection];
    if ('id' in patch && patch.id !== id) throw new ValidationError('id cannot be changed');
    const data = await this.withDerivedProject(collection, patch);
    const row = toRow(def, { ...data, updated_at: new Date().toISOString() });
    delete row.id;
    delete row.created_at;
    const cols = Object.keys(row);
    const sets = cols.map((c, i) => `${q(c)} = $${i + 2}`);
    const res = await this.pool.query(
      `UPDATE ${q(def.table)} SET ${sets.join(', ')} WHERE id = $1 RETURNING ${columnsOf(def)}`,
      [id, ...cols.map((c) => row[c])]
    );
    if (!res.rows[0]) throw new NotFoundError(collection, id);
    return fromRow<T>(def, res.rows[0]);
  }

  async remove(collection: CoreCollection, id: string): Promise<void> {
    const def = ENTITIES[collection];
    const res = await this.pool.query(`DELETE FROM ${q(def.table)} WHERE id = $1`, [id]);
    if (res.rowCount === 0) throw new NotFoundError(collection, id);
  }

  /** A work item's project_id can be omitted; it is taken from its work package. */
  private async withDerivedProject(collection: CoreCollection, input: Row): Promise<Row> {
    if (collection !== 'workItems' || input.project_id || typeof input.work_package_id !== 'string') return input;
    const res = await this.pool.query('SELECT project_id FROM work_packages WHERE id = $1', [input.work_package_id]);
    if (!res.rows[0]) throw new ValidationError(`work package ${input.work_package_id} does not exist`);
    return { ...input, project_id: res.rows[0].project_id };
  }

  // ---------- relationship reads ----------

  /** Client with its projects, each with work packages, each with work items. */
  async clientTree(clientId: string) {
    const client = await this.get<Client>('clients', clientId);
    const projects = await this.list<Project>('projects', { client_id: clientId });
    const projectIds = projects.map((p) => p.id);
    const [packagesRes, itemsRes] = await Promise.all([
      this.pool.query(
        `SELECT ${columnsOf(ENTITIES.workPackages)} FROM work_packages WHERE project_id = ANY($1) ORDER BY created_at, id`,
        [projectIds]
      ),
      this.pool.query(
        `SELECT ${columnsOf(ENTITIES.workItems)} FROM work_items WHERE project_id = ANY($1) ORDER BY created_at, id`,
        [projectIds]
      ),
    ]);
    const packages = packagesRes.rows.map((r) => fromRow<WorkPackage>(ENTITIES.workPackages, r));
    const items = itemsRes.rows.map((r) => fromRow<WorkItem>(ENTITIES.workItems, r));
    return {
      ...client,
      projects: projects.map((p) => ({
        ...p,
        work_packages: packages
          .filter((wp) => wp.project_id === p.id)
          .map((wp) => ({ ...wp, work_items: items.filter((wi) => wi.work_package_id === wp.id) })),
      })),
    };
  }

  async snapshot(): Promise<CoreData> {
    const [clients, projects, workPackages, workItems] = await Promise.all([
      this.list<Client>('clients'),
      this.list<Project>('projects'),
      this.list<WorkPackage>('workPackages'),
      this.list<WorkItem>('workItems'),
    ]);
    return { clients, projects, workPackages, workItems };
  }

  // ---------- batch writes ----------

  /**
   * Applies upserts and deletes from the browser in one transaction. Foreign keys are
   * deferred to commit, so order within the batch doesn't matter but the end state must
   * be consistent (e.g. deleting a client that still has projects fails the whole batch).
   */
  async applyChanges(changes: {
    upserts?: Partial<Record<CoreCollection, Row[]>>;
    deletes?: Partial<Record<CoreCollection, string[]>>;
  }) {
    const counts = { upserted: 0, deleted: 0 };
    await withTransaction(this.pool, async (client) => {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const collection of [...COLLECTION_ORDER].reverse()) {
        const ids = changes.deletes?.[collection] ?? [];
        if (!ids.length) continue;
        const res = await client.query(`DELETE FROM ${q(ENTITIES[collection].table)} WHERE id = ANY($1)`, [ids]);
        counts.deleted += res.rowCount ?? 0;
      }
      for (const collection of COLLECTION_ORDER) {
        for (const record of changes.upserts?.[collection] ?? []) {
          if (typeof record.id !== 'string' || !record.id) throw new ValidationError(`${collection} record without id`);
          await insertRow(client, ENTITIES[collection], toRow(ENTITIES[collection], record), 'update');
          counts.upserted++;
        }
      }
    });
    return counts;
  }

  /**
   * Imports app data (localStorage or demo seed). Existing database rows are never
   * overwritten: records whose id already exists are skipped. References are checked
   * against the payload plus the database first; any problem aborts with nothing written.
   */
  async importData(data: Partial<CoreData>, { dryRun = false } = {}) {
    const problems: string[] = [];
    const existing: Record<CoreCollection, Set<string>> = {
      clients: new Set(),
      projects: new Set(),
      workPackages: new Set(),
      workItems: new Set(),
    };
    for (const collection of COLLECTION_ORDER) {
      const res = await this.pool.query(`SELECT id FROM ${q(ENTITIES[collection].table)}`);
      res.rows.forEach((r) => existing[collection].add(r.id));
    }

    const known: Record<CoreCollection, Set<string>> = {
      clients: new Set(existing.clients),
      projects: new Set(existing.projects),
      workPackages: new Set(existing.workPackages),
      workItems: new Set(existing.workItems),
    };
    for (const collection of COLLECTION_ORDER) {
      for (const r of (data[collection] ?? []) as unknown as Row[]) {
        if (typeof r.id !== 'string' || !r.id) problems.push(`${collection}: record without id`);
        else known[collection].add(r.id);
      }
    }
    for (const collection of COLLECTION_ORDER) {
      for (const r of (data[collection] ?? []) as unknown as Row[]) {
        for (const parent of ENTITIES[collection].parents) {
          const ref = r[parent.field];
          if (typeof ref !== 'string' || !known[parent.collection].has(ref)) {
            problems.push(`${collection} ${r.id}: ${parent.field} "${String(ref)}" not found`);
          }
        }
      }
    }

    const summary = Object.fromEntries(
      COLLECTION_ORDER.map((c) => {
        const incoming = ((data[c] ?? []) as unknown as Row[]).filter((r) => typeof r.id === 'string');
        const skipped = incoming.filter((r) => existing[c].has(r.id as string)).length;
        return [c, { received: incoming.length, new: incoming.length - skipped, skippedExisting: skipped }];
      })
    ) as Record<CoreCollection, { received: number; new: number; skippedExisting: number }>;

    if (problems.length || dryRun) return { ok: problems.length === 0, dryRun, imported: false, summary, problems };

    await withTransaction(this.pool, async (client) => {
      await client.query('SET CONSTRAINTS ALL DEFERRED');
      for (const collection of COLLECTION_ORDER) {
        for (const record of (data[collection] ?? []) as unknown as Row[]) {
          await insertRow(client, ENTITIES[collection], toRow(ENTITIES[collection], record), 'skip');
        }
      }
    });
    return { ok: true, dryRun, imported: true, summary, problems };
  }

  async counts(): Promise<Record<CoreCollection, number>> {
    const out = {} as Record<CoreCollection, number>;
    for (const collection of COLLECTION_ORDER) {
      const res = await this.pool.query(`SELECT count(*)::int AS n FROM ${q(ENTITIES[collection].table)}`);
      out[collection] = res.rows[0].n;
    }
    return out;
  }
}
