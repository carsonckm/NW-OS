import type { Pool, PoolClient } from '../db/pool';
import { ValidationError } from '../core/repository';
import type { ColumnSpec, ModuleDef, Row } from './types';

type Db = Pool | PoolClient;
const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

function columnValue(spec: ColumnSpec, record: Row): unknown {
  const raw = typeof spec.from === 'function' ? spec.from(record) : record[spec.from ?? spec.col];
  if (raw === undefined || raw === null || raw === '') return null;
  switch (spec.kind) {
    case 'num': {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new ValidationError(`${spec.col} must be a number`);
      return n;
    }
    case 'bool':
      return Boolean(raw);
    case 'ts': {
      const d = new Date(String(raw));
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      if (typeof raw === 'object') throw new ValidationError(`${spec.col} must be a string`);
      return String(raw);
  }
}

export function recordId(def: ModuleDef, record: Row): string {
  const id = record[def.idField];
  if (typeof id !== 'string' || !id.trim()) throw new ValidationError(`${def.key} record needs ${def.idField}`);
  return id;
}

/** Checks the record's shape before it is stored (the `data` column is not free-form). */
export function validateRecord(def: ModuleDef, record: unknown): asserts record is Row {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new ValidationError(`${def.key}: record must be an object`);
  const r = record as Row;
  recordId(def, r);
  for (const field of def.required ?? []) {
    if (r[field] === undefined || r[field] === null || r[field] === '') {
      throw new ValidationError(`${def.key} ${String(r[def.idField])}: ${field} is required`);
    }
  }
}

/** Stored rows -> app records (`data`, with the key field restored). */
function toRecords(def: ModuleDef, rows: Row[]): Row[] {
  return rows.map((r) => ({ ...(r.data as Row), [def.idField]: r.id }));
}

export async function findRecord(db: Db, def: ModuleDef, id: string, lock = false): Promise<Row | undefined> {
  const res = await db.query(`SELECT id, data FROM ${q(def.table)} WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!res.rows[0]) return undefined;
  const [record] = toRecords(def, res.rows);
  return def.hooks?.hydrate ? (await def.hooks.hydrate(db, [record]))[0] : record;
}

export async function listRecords(db: Db, def: ModuleDef, filter: Record<string, string | undefined> = {}): Promise<Row[]> {
  const allowed = new Set(['id', ...def.columns.map((c) => c.col)]);
  const where: string[] = [];
  const values: string[] = [];
  for (const [col, value] of Object.entries(filter)) {
    if (value === undefined) continue;
    if (!allowed.has(col)) throw new ValidationError(`Unknown filter: ${col}`);
    values.push(value);
    where.push(`${q(col)} = $${values.length}`);
  }
  const res = await db.query(
    `SELECT id, data FROM ${q(def.table)}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY ${q(def.orderBy ?? 'created_at')}, id`,
    values
  );
  const records = toRecords(def, res.rows);
  return def.hooks?.hydrate ? def.hooks.hydrate(db, records) : records;
}

/** Inserts or updates one record: projected columns + `data`. Returns the stored record. */
export async function writeRecord(db: PoolClient, def: ModuleDef, record: Row, actorId: string | undefined, mode: 'upsert' | 'insert-only') {
  const id = recordId(def, record);
  const data = def.hooks?.serialize ? def.hooks.serialize(record) : record;
  const cols = def.columns.map((c) => c.col);
  const values = def.columns.map((c) => columnValue(c, record));
  const all = ['id', ...cols, 'data', 'created_by', 'updated_by'];
  const params = [id, ...values, JSON.stringify(data), actorId ?? null, actorId ?? null];
  const placeholders = all.map((_, i) => `$${i + 1}`);
  let sql = `INSERT INTO ${q(def.table)} (${all.map(q).join(', ')}) VALUES (${placeholders.join(', ')})`;
  if (mode === 'upsert') {
    const updates = [...cols, 'data'].map((c) => `${q(c)} = EXCLUDED.${q(c)}`);
    sql += ` ON CONFLICT (id) DO UPDATE SET ${updates.join(', ')}, updated_at = now(), updated_by = EXCLUDED.updated_by`;
  } else {
    sql += ' ON CONFLICT (id) DO NOTHING';
  }
  const res = await db.query(`${sql} RETURNING id`, params);
  return { inserted: (res.rowCount ?? 0) > 0, record: { ...record } };
}

export async function deleteRecord(db: PoolClient, def: ModuleDef, id: string) {
  const res = await db.query(`DELETE FROM ${q(def.table)} WHERE id = $1`, [id]);
  return (res.rowCount ?? 0) > 0;
}

export async function countAll(db: Db, defs: ModuleDef[]) {
  const out: Record<string, number> = {};
  for (const def of defs) {
    out[def.key] = (await db.query(`SELECT count(*)::int AS n FROM ${q(def.table)}`)).rows[0].n;
  }
  return out;
}
