import { randomUUID } from 'crypto';
import type { UserRole } from '../../src/types';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import { deriveKey, newPasswordKey, type KeyParams } from './password';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  is_dev_seed: boolean;
  client_id: string | null;
  contractor_id: string | null;
  phone: string | null;
  department: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

/** Shape returned to the browser: never includes password data. */
export type PublicUser = AuthUser & { assigned_project_ids: string[] };

const USER_COLUMNS = `id, name, email, role, is_active, is_dev_seed, client_id, contractor_id, phone, department,
  title, created_at, updated_at, last_login`;

export const SESSION_COOKIE = 'nwos_session';

type Db = Pool | PoolClient;
export type LoginResult =
  | { status: 'ok'; user: AuthUser; token: string; expiresAt: Date }
  | { status: 'invalid' }
  | { status: 'locked' }
  | { status: 'inactive'; userId: string };

/**
 * Accounts and sessions (Phase 6 Batch 12B). Credentials and sessions live in owner-only tables;
 * the runtime role reaches them only through the database's authentication functions
 * (migration 031): the database verifies the password-derived key, creates the session token,
 * resolves sessions, and decides who a transaction acts for (auth_assume). Writes to users and
 * project assignments are checked by the database against that verified identity, so they run in
 * a transaction that has assumed the signed-in user's identity (withIdentity).
 */
export class AuthStore {
  constructor(private pool: Pool) {}

  /**
   * Runs fn in a transaction acting for the session's user (database-verified). Without a token
   * (scripts and tests on the migrator / administrator credential) no identity is assumed: the
   * database then accepts the change only from a role that owns the tables.
   */
  withIdentity<T>(token: string | undefined, fn: (db: PoolClient) => Promise<T>): Promise<T> {
    return withTransaction(this.pool, async (db) => {
      if (token) await db.query('SELECT auth_assume($1)', [token]);
      return fn(db);
    });
  }

  /** Verifies the password in the database and opens a session there. */
  async login(email: string, password: string, meta: { userAgent?: string; ip?: string }): Promise<LoginResult> {
    const params = (await this.pool.query('SELECT auth_password_params($1) AS p', [email])).rows[0].p as KeyParams & { scheme: string };
    // The same work for an unknown email (the database returns stable, plausible parameters).
    const keyHex = await deriveKey(password, params);
    const r = (await this.pool.query('SELECT * FROM auth_login($1, $2, $3, $4)', [email, keyHex, meta.userAgent ?? null, meta.ip ?? null])).rows[0];
    if (r.status === 'ok') {
      const user = await this.getUser(r.user_id);
      if (!user) return { status: 'invalid' };
      return { status: 'ok', user, token: r.token, expiresAt: new Date(r.expires_at) };
    }
    if (r.status === 'inactive') return { status: 'inactive', userId: r.user_id };
    return r.status === 'locked' ? { status: 'locked' } : { status: 'invalid' };
  }

  async getUser(id: string): Promise<AuthUser | undefined> {
    const res = await this.pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return res.rows[0];
  }

  async listUsers(): Promise<PublicUser[]> {
    const res = await this.pool.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY created_at, id`);
    const assignments = await this.pool.query('SELECT user_id, project_id FROM project_assignments');
    return res.rows.map((u: AuthUser) => ({
      ...u,
      assigned_project_ids: assignments.rows.filter((a) => a.user_id === u.id).map((a) => a.project_id),
    }));
  }

  async assignedProjectIds(userId: string): Promise<string[]> {
    const res = await this.pool.query('SELECT project_id FROM project_assignments WHERE user_id = $1 ORDER BY project_id', [
      userId,
    ]);
    return res.rows.map((r) => r.project_id);
  }

  async toPublic(user: AuthUser): Promise<PublicUser> {
    return { ...user, assigned_project_ids: await this.assignedProjectIds(user.id) };
  }

  async createUser(db: Db, input: {
    id?: string;
    name: string;
    email: string;
    role: UserRole;
    password?: string;
    is_active?: boolean;
    is_dev_seed?: boolean;
    client_id?: string | null;
    contractor_id?: string | null;
    phone?: string | null;
    department?: string | null;
    title?: string | null;
  }): Promise<AuthUser> {
    const res = await db.query(
      `INSERT INTO users (id, name, email, role, is_active, is_dev_seed, client_id, contractor_id, phone, department, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${USER_COLUMNS}`,
      [
        input.id || `user-${randomUUID()}`,
        input.name.trim(),
        input.email.trim(),
        input.role,
        input.is_active ?? true,
        input.is_dev_seed ?? false,
        input.client_id ?? null,
        input.contractor_id ?? null,
        input.phone ?? null,
        input.department ?? null,
        input.title ?? null,
      ]
    );
    const user: AuthUser = res.rows[0];
    if (input.password) await this.setPassword(db, user.id, input.password);
    return user;
  }

  /** Sets a password (the database checks who may, and ends the user's sessions). */
  async setPassword(db: Db, userId: string, password: string) {
    const k = await newPasswordKey(password);
    await db.query('SELECT auth_set_password($1, $2, $3, $4)', [userId, JSON.stringify(k.params), k.salt, k.keyHex]);
  }

  async updateUser(
    db: Db,
    id: string,
    patch: Partial<Pick<AuthUser, 'name' | 'email' | 'role' | 'is_active' | 'client_id' | 'contractor_id' | 'phone' | 'department' | 'title'>> & {
      password?: string;
    }
  ): Promise<AuthUser | undefined> {
    const allowed = ['name', 'email', 'role', 'is_active', 'client_id', 'contractor_id', 'phone', 'department', 'title'] as const;
    const sets: string[] = [];
    const values: unknown[] = [id];
    for (const field of allowed) {
      if (field in patch) {
        values.push(patch[field] ?? null);
        sets.push(`${field} = $${values.length}`);
      }
    }
    sets.push('updated_at = now()');
    const res = await db.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`, values);
    const user: AuthUser | undefined = res.rows[0];
    // A changed role or deactivation ends the user's sessions (database trigger); so does a new password.
    if (user && patch.password) await this.setPassword(db, id, patch.password);
    return user;
  }

  async setAssignments(db: Db, userId: string, projectIds: string[]) {
    await db.query('DELETE FROM project_assignments WHERE user_id = $1', [userId]);
    for (const projectId of new Set(projectIds)) {
      await db.query('INSERT INTO project_assignments (user_id, project_id) VALUES ($1, $2)', [userId, projectId]);
    }
  }

  // ---------- sessions (database functions) ----------

  /** The session's user if the token is valid, unexpired and the user active (sliding expiry in the database). */
  async resolveSession(token: string): Promise<AuthUser | undefined> {
    return (await this.pool.query('SELECT * FROM auth_session($1)', [token])).rows[0];
  }

  async revokeSession(token: string) {
    await this.pool.query('SELECT auth_logout($1)', [token]);
  }

  async purgeExpiredSessions() {
    return (await this.pool.query('SELECT auth_purge_expired() AS n')).rows[0].n as number;
  }
}
