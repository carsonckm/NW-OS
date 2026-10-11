/**
 * The database-verified identity of a transaction (Phase 6 Batch 12B, migration 031).
 *
 * The database decides which signed-in user a transaction acts for, from the session token
 * (auth_assume); nothing the server says about a user id or role is trusted. Writes to the
 * security-critical records (users, project assignments, authority rules, Owner absences, WhatsApp
 * contact mappings, project sensitivity, legacy review decisions) are refused unless the
 * transaction carries a verified identity with the right role. Background jobs have none.
 *
 * The identity is bound to the database transaction (backend pid + transaction id), so a pooled
 * connection never carries it into another request.
 */
import type { AccessContext } from './access';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';

/** Makes this transaction act for the context's signed-in user (no-op without a session). */
export async function assumeIdentity(db: PoolClient, ctx: Pick<AccessContext, 'sessionToken'>) {
  if (ctx.sessionToken) await db.query('SELECT auth_assume($1)', [ctx.sessionToken]);
}

/** A transaction acting for the context's signed-in user. */
export function withUserTransaction<T>(pool: Pool, ctx: Pick<AccessContext, 'sessionToken'>, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  return withTransaction(pool, async (db) => {
    await assumeIdentity(db, ctx);
    return fn(db);
  });
}
