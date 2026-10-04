import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'crypto';

// scrypt with N=2^15, r=8, p=1 (~32 MiB per hash). Parameters are stored with each
// hash so they can be raised later without invalidating existing passwords.
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAXMEM = 128 * N * R * 2;

export const MIN_PASSWORD_LENGTH = 12;

function scrypt(password: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)))
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64url');
  const opts = { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 };
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64url'), expected.length, opts);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Verified against when the email is unknown, so a miss takes as long as a wrong password.
let dummyHash: Promise<string> | undefined;
export function dummyPasswordHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

export function passwordProblem(password: unknown): string | undefined {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < MIN_PASSWORD_LENGTH) return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > 256) return 'Password is too long';
  return undefined;
}
