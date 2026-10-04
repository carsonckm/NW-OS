import { createHash, randomBytes, randomUUID } from 'crypto';
import type { UserRole } from '../../src/types';
import type { Pool } from '../db/pool';
import { hashPassword } from './password';

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
const IDLE_MS = 12 * 60 * 60 * 1000; // sliding: 12h without activity ends the session
const ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000; // hard cap regardless of activity
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export class AuthStore {
  constructor(private pool: Pool) {}

  async findByEmailWithHash(email: string): Promise<(AuthUser & { password_hash: string | null }) | undefined> {
    const res = await this.pool.query(`SELECT ${USER_COLUMNS}, password_hash FROM users WHERE lower(email) = lower($1)`, [
      email.trim(),
    ]);
    return res.rows[0];
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

  async createUser(input: {
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
    const res = await this.pool.query(
      `INSERT INTO users (id, name, email, password_hash, role, is_active, is_dev_seed, client_id, contractor_id,
         phone, department, title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING ${USER_COLUMNS}`,
      [
        input.id || `user-${randomUUID()}`,
        input.name.trim(),
        input.email.trim(),
        input.password ? await hashPassword(input.password) : null,
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
    return res.rows[0];
  }

  async updateUser(
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
    if (patch.password) {
      values.push(await hashPassword(patch.password));
      sets.push(`password_hash = $${values.length}`);
    }
    sets.push('updated_at = now()');
    const res = await this.pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING ${USER_COLUMNS}`, values);
    const user: AuthUser | undefined = res.rows[0];
    // A deactivated user, or a changed password or role, ends every existing session.
    if (user && (patch.is_active === false || patch.password || patch.role)) await this.revokeUserSessions(id);
    return user;
  }

  async setAssignments(userId: string, projectIds: string[]) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM project_assignments WHERE user_id = $1', [userId]);
      for (const projectId of new Set(projectIds)) {
        await client.query('INSERT INTO project_assignments (user_id, project_id) VALUES ($1, $2)', [userId, projectId]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  async recordLogin(userId: string) {
    await this.pool.query('UPDATE users SET last_login = now() WHERE id = $1', [userId]);
  }

  // ---------- sessions ----------

  async createSession(userId: string, meta: { userAgent?: string; ip?: string }) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + IDLE_MS);
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)`,
      [sha256(token), userId, expiresAt, meta.userAgent?.slice(0, 300) ?? null, meta.ip ?? null]
    );
    return { token, expiresAt };
  }

  /** Returns the session's user if the token is valid, unexpired and the user is active. */
  async resolveSession(token: string): Promise<AuthUser | undefined> {
    const res = await this.pool.query(
      `SELECT s.token_hash, s.created_at AS session_created_at, s.last_seen_at, ${USER_COLUMNS
        .split(',')
        .map((c) => `u.${c.trim()}`)
        .join(', ')}
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now() AND u.is_active`,
      [sha256(token)]
    );
    const row = res.rows[0];
    if (!row) return undefined;
    if (Date.now() - new Date(row.session_created_at).getTime() > ABSOLUTE_MS) {
      await this.revokeSession(token);
      return undefined;
    }
    if (Date.now() - new Date(row.last_seen_at).getTime() > TOUCH_EVERY_MS) {
      await this.pool.query(`UPDATE sessions SET last_seen_at = now(), expires_at = $2 WHERE token_hash = $1`, [
        row.token_hash,
        new Date(Date.now() + IDLE_MS),
      ]);
    }
    const { token_hash: _h, session_created_at: _c, last_seen_at: _l, ...user } = row;
    return user as AuthUser;
  }

  async revokeSession(token: string) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)]);
  }

  async revokeUserSessions(userId: string) {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async purgeExpiredSessions() {
    await this.pool.query('DELETE FROM sessions WHERE expires_at < now()');
  }
}
