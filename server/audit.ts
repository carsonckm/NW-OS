import type { Pool, PoolClient } from './db/pool';

/**
 * Append-only audit trail (table audit_logs, protected by a trigger against UPDATE,
 * DELETE and TRUNCATE). Callers pass the transaction client so the audit row commits or
 * rolls back together with the change it describes.
 */
export interface AuditActor {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  ip?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  projectId?: string | null;
  before?: unknown;
  after?: unknown;
  details?: string;
}

/** Keeps audit rows readable and bounded: drops bulky fields and truncates long strings. */
function compact(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  const json = JSON.stringify(value, (_k, v) => (typeof v === 'string' && v.length > 2000 ? `${v.slice(0, 2000)}…` : v));
  return json.length > 64_000 ? { truncated: true, size: json.length } : JSON.parse(json);
}

export async function writeAudit(db: Pool | PoolClient, actor: AuditActor, entry: AuditEntry) {
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_name, actor_role, action, entity_type, entity_id, project_id, before, after, details, ip)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      actor.id ?? null,
      actor.name ?? null,
      actor.role ?? null,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.projectId ?? null,
      JSON.stringify(compact(entry.before)),
      JSON.stringify(compact(entry.after)),
      entry.details ?? null,
      actor.ip ?? null,
    ]
  );
}

/** Field names whose values differ between two records (for concise update audits). */
export function changedFields(before: Record<string, unknown> | undefined, after: Record<string, unknown>) {
  if (!before) return Object.keys(after);
  return Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
}
