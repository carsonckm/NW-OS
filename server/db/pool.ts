import pg from 'pg';

// Return values in the shapes the NW OS types use (strings for dates, numbers for numerics)
// rather than pg's defaults (Date objects and numeric-as-string).
const DATE_OID = 1082;
const TIMESTAMP_OID = 1114;
const TIMESTAMPTZ_OID = 1184;
const NUMERIC_OID = 1700;

pg.types.setTypeParser(DATE_OID, (v: string) => v);
pg.types.setTypeParser(TIMESTAMP_OID, (v: string) => new Date(`${v}Z`).toISOString());
pg.types.setTypeParser(TIMESTAMPTZ_OID, (v: string) => new Date(v).toISOString());
pg.types.setTypeParser(NUMERIC_OID, (v: string) => Number(v));

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(config: pg.PoolConfig): pg.Pool {
  const pool = new pg.Pool(config);
  // An idle client erroring (e.g. the database restarting) must not crash the server.
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return pool;
}

export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
