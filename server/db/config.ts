import type { PoolConfig } from 'pg';

export type CoreDataSource = 'local' | 'database';

export interface DatabaseSettings {
  /** Where the browser should treat core-chain data as stored. */
  dataSource: CoreDataSource;
  /** Present when DATABASE_URL is set. */
  pool?: PoolConfig;
}

/**
 * DATABASE_SSL:
 *  - "disable": plain connection (local Postgres, CI service container)
 *  - "require": TLS without certificate verification (Supabase pooler default)
 *  - "verify":  TLS with certificate verification (supply DATABASE_CA_CERT if the CA is private)
 *  - unset/"auto": disable for localhost, require otherwise
 */
function sslOption(url: string, env: NodeJS.ProcessEnv): PoolConfig['ssl'] {
  const mode = (env.DATABASE_SSL || 'auto').toLowerCase();
  if (mode === 'disable') return false;
  if (mode === 'verify') return env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : true;
  if (mode === 'require') return { rejectUnauthorized: false };
  const host = new URL(url).hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' ? false : { rejectUnauthorized: false };
}

export function readDatabaseSettings(env: NodeJS.ProcessEnv = process.env): DatabaseSettings {
  const url = env.DATABASE_URL?.trim();
  const dataSource: CoreDataSource = env.CORE_DATA_SOURCE === 'database' && url ? 'database' : 'local';
  if (!url) return { dataSource };
  return {
    dataSource,
    pool: {
      // sslmode in the URL would override `ssl`, so it is stripped and DATABASE_SSL decides.
      connectionString: url.replace(/([?&])sslmode=[^&]*&?/, '$1').replace(/[?&]$/, ''),
      ssl: sslOption(url, env),
      max: Number(env.DATABASE_POOL_MAX) || 10,
    },
  };
}
