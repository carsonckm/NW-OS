/**
 * Who automation may notify or assign: active users only, resolved on the server from the
 * users table, roles/permissions and project scope (the same AccessContext the API uses).
 */
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import type { PermissionKey } from '../../src/types';
import type { Pool } from '../db/pool';

export class People {
  private contexts = new Map<string, AccessContext>();
  private constructor(
    private pool: Pool,
    readonly users: AuthUser[],
    private projects: Map<string, { pm: string; site: string; name: string; status: string }>
  ) {}

  static async load(pool: Pool) {
    const users = (await pool.query('SELECT * FROM users WHERE is_active ORDER BY id')).rows as AuthUser[];
    const projects = new Map(
      (await pool.query('SELECT id, project_manager_id, site_supervisor_id, project_name, project_status FROM projects')).rows.map((p) => [
        p.id as string,
        { pm: p.project_manager_id as string, site: p.site_supervisor_id as string, name: p.project_name as string, status: p.project_status as string },
      ])
    );
    return new People(pool, users, projects);
  }

  private async ctx(user: AuthUser) {
    let c = this.contexts.get(user.id);
    if (!c) this.contexts.set(user.id, (c = await AccessContext.load(this.pool, user)));
    return c;
  }

  user(id: string | null | undefined) {
    return this.users.find((u) => u.id === id);
  }

  isActive(id: string | null | undefined) {
    return !!this.user(id);
  }

  projectName(id: string | null | undefined) {
    return (id && this.projects.get(id)?.name) || id || '';
  }

  projectOpen(id: string | null | undefined) {
    const s = id ? this.projects.get(id)?.status : undefined;
    return !!s && !['Completed', 'Closed', 'Cancelled'].includes(s);
  }

  /** Active users who hold `permission` and can see the project. */
  async withPermission(permission: PermissionKey, projectId: string, except: (string | null | undefined)[] = []) {
    const out: string[] = [];
    for (const u of this.users) {
      if (except.includes(u.id)) continue;
      const c = await this.ctx(u);
      if (c.can(permission) && c.canSeeProject(projectId)) out.push(u.id);
    }
    return out;
  }

  /** Whether this user may see the project (used to keep notifications in scope). */
  async canSee(userId: string, projectId: string | null) {
    const u = this.user(userId);
    if (!u) return false;
    if (!projectId) return true;
    return (await this.ctx(u)).canSeeProject(projectId);
  }

  pm(projectId: string) {
    const id = this.projects.get(projectId)?.pm;
    return this.isActive(id) ? [id!] : [];
  }

  site(projectId: string) {
    const id = this.projects.get(projectId)?.site;
    return this.isActive(id) ? [id!] : [];
  }

  owners() {
    return this.users.filter((u) => u.role === 'Owner / CEO').map((u) => u.id);
  }
}
