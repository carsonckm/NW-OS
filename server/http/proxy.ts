/**
 * Which reverse proxies the server trusts to report the client's address (X-Forwarded-For).
 *
 * TRUST_PROXY (explicit; default: trust none):
 *   unset / "" / "false"   req.ip is the TCP peer. X-Forwarded-For is ignored entirely.
 *   "1" .. "5"             trust that many proxy hops in front of the server: req.ip is the
 *                          address the outermost trusted proxy saw, never an address the client
 *                          wrote itself (Express takes it from the right of X-Forwarded-For).
 *   a list                 trust only these proxy addresses: IPs, CIDR ranges, or the names
 *                          loopback / linklocal / uniquelocal, comma-separated.
 * "true" (trust every hop) is refused: it would let any client choose its own address.
 * Anything else is a configuration error and the server does not start.
 *
 * req.ip is what sessions, the audit trail and the sign-in limiter record.
 */
import { isIP } from 'node:net';
import type { Express } from 'express';

const NAMES = new Set(['loopback', 'linklocal', 'uniquelocal']);

export class ProxyConfigError extends Error {}

function validAddress(entry: string) {
  if (NAMES.has(entry)) return true;
  const [ip, prefix, extra] = entry.split('/');
  const family = isIP(ip);
  if (!family || extra !== undefined) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return Number(prefix) <= (family === 4 ? 32 : 128);
}

export function trustProxySetting(env: NodeJS.ProcessEnv = process.env): false | number | string[] {
  const raw = (env.TRUST_PROXY ?? '').trim();
  if (raw === '' || raw.toLowerCase() === 'false') return false;
  if (raw.toLowerCase() === 'true') throw new ProxyConfigError('TRUST_PROXY=true would trust any X-Forwarded-For a client sends; set the number of proxy hops (e.g. 1) or the proxy addresses');
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops < 1 || hops > 5) throw new ProxyConfigError('TRUST_PROXY must be 1 to 5 proxy hops');
    return hops;
  }
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = list.filter((e) => !validAddress(e));
  if (!list.length || bad.length) throw new ProxyConfigError(`TRUST_PROXY: not an address, range or known name: ${bad.join(', ') || raw}`);
  return list;
}

export function configureTrustProxy(app: Express, env: NodeJS.ProcessEnv = process.env) {
  app.set('trust proxy', trustProxySetting(env));
}
