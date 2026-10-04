import type { PermissionKey, UserRole } from '../../src/types';
import type { Pool, PoolClient } from '../db/pool';
import type { CoreCollection } from '../core/schema';
import { canSeeProjectFinancials, permissionsFor } from './permissions';
import type { AuthUser } from './store';

type Row = Record<string, unknown>;

export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission for this action') {
    super(message);
  }
}

/** Roles that see every project (matches canAccessProject in src/utils/permissions.ts). */
const COMPANY_WIDE: UserRole[] = ['Owner / CEO', 'Admin', 'Purchasing', 'Accountant'];

const VIEW: Record<CoreCollection, PermissionKey> = {
  clients: 'clients.view',
  projects: 'projects.view',
  workPackages: 'work_packages.view',
  workItems: 'work_items.view',
};
const CREATE: Record<CoreCollection, PermissionKey> = {
  clients: 'clients.create',
  projects: 'projects.create',
  workPackages: 'work_packages.create',
  workItems: 'work_items.create',
};
const EDIT: Record<CoreCollection, PermissionKey> = {
  clients: 'clients.edit',
  projects: 'projects.edit',
  workPackages: 'work_packages.edit',
  workItems: 'work_items.edit',
};
// There is no work_packages.delete / work_items.delete permission; deleting needs edit.
const DELETE: Record<CoreCollection, PermissionKey> = {
  clients: 'clients.delete',
  projects: 'projects.delete',
  workPackages: 'work_packages.edit',
  workItems: 'work_items.edit',
};

/** Fields a user with only work_items.complete (site/contractor execution) may change. */
const EXECUTION_FIELDS = new Set([
  'status',
  'progress_percent',
  'notes',
  'photos',
  'item_photos',
  'production_status',
  'updated_at',
]);
const FINANCIAL_FIELDS: Partial<Record<CoreCollection, string[]>> = { projects: ['contract_value'] };

/**
 * Everything the server needs to decide what one authenticated user may see and do
 * with core-chain records. Built per request from the database, never from the browser.
 */
export class AccessContext {
  readonly permissions: ReadonlySet<PermissionKey>;
  private constructor(
    readonly user: AuthUser,
    /** null = every project */
    private visibleProjects: Set<string> | null,
    private projectClient: Map<string, string>,
    private packageContractor: Map<string, string>,
    private packageProject: Map<string, string>
  ) {
    this.permissions = permissionsFor(user.role);
  }

  static async load(db: Pool | PoolClient, user: AuthUser): Promise<AccessContext> {
    const [projects, packages, assignments] = await Promise.all([
      db.query('SELECT id, client_id, project_manager_id, site_supervisor_id FROM projects'),
      db.query('SELECT id, project_id, contractor_id FROM work_packages'),
      db.query('SELECT project_id FROM project_assignments WHERE user_id = $1', [user.id]),
    ]);
    const assigned = new Set<string>(assignments.rows.map((r) => r.project_id));
    const projectClient = new Map<string, string>(projects.rows.map((p) => [p.id, p.client_id]));
    const packageContractor = new Map<string, string>(packages.rows.map((w) => [w.id, w.contractor_id]));
    const packageProject = new Map<string, string>(packages.rows.map((w) => [w.id, w.project_id]));

    let visible: Set<string> | null;
    switch (user.role) {
      case 'Owner / CEO':
      case 'Admin':
      case 'Purchasing':
      case 'Accountant':
        visible = null;
        break;
      case 'Production Manager':
        // Oversees all fabrication unless limited to specific projects.
        visible = assigned.size ? assigned : null;
        break;
      case 'Project Manager':
        visible = new Set([...assigned, ...projects.rows.filter((p) => p.project_manager_id === user.id).map((p) => p.id)]);
        break;
      case 'Site Supervisor':
        visible = new Set([...assigned, ...projects.rows.filter((p) => p.site_supervisor_id === user.id).map((p) => p.id)]);
        break;
      case 'Contractor':
        visible = new Set([
          ...assigned,
          ...packages.rows.filter((w) => user.contractor_id && w.contractor_id === user.contractor_id).map((w) => w.project_id),
        ]);
        break;
      case 'Client':
        visible = new Set(projects.rows.filter((p) => user.client_id && p.client_id === user.client_id).map((p) => p.id));
        break;
      case 'Production Staff':
      default:
        // Assigned production work only.
        visible = assigned;
    }
    return new AccessContext(user, visible, projectClient, packageContractor, packageProject);
  }

  get companyWide() {
    return COMPANY_WIDE.includes(this.user.role) && this.visibleProjects === null;
  }

  can(permission: PermissionKey) {
    return this.permissions.has(permission);
  }

  require(permission: PermissionKey) {
    if (!this.can(permission)) throw new ForbiddenError(`Missing permission: ${permission}`);
  }

  canSeeProject(projectId: unknown): boolean {
    return typeof projectId === 'string' && (this.visibleProjects === null || this.visibleProjects.has(projectId));
  }

  /** Whether a stored record is inside this user's scope (ignores permissions). */
  inScope(collection: CoreCollection, row: Row): boolean {
    const contractor = this.user.role === 'Contractor' ? this.user.contractor_id : undefined;
    switch (collection) {
      case 'clients':
        if (this.user.role === 'Client') return row.id === this.user.client_id;
        if (this.visibleProjects === null) return true;
        return [...this.visibleProjects].some((p) => this.projectClient.get(p) === row.id);
      case 'projects':
        return this.canSeeProject(row.id);
      case 'workPackages':
        return this.canSeeProject(row.project_id) && (!contractor || row.contractor_id === contractor);
      case 'workItems':
        return (
          this.canSeeProject(row.project_id) &&
          (!contractor ||
            row.contractor_id === contractor ||
            this.packageContractor.get(row.work_package_id as string) === contractor)
        );
    }
  }

  canView(collection: CoreCollection, row: Row) {
    return this.can(VIEW[collection]) && this.inScope(collection, row);
  }

  /** Removes fields this user may not see. */
  redact<T extends Row>(collection: CoreCollection, row: T): T {
    const hidden = canSeeProjectFinancials(this.user.role) ? [] : FINANCIAL_FIELDS[collection] ?? [];
    if (!hidden.length) return row;
    const copy: Row = { ...row };
    hidden.forEach((f) => delete copy[f]);
    return copy as T;
  }

  /**
   * Authorises one write. `existing` is the stored row (undefined for a create),
   * `incoming` the new values (undefined for a delete). Returns the values that may be
   * written, with fields the user may not set removed. Throws ForbiddenError otherwise.
   * Out-of-scope existing records are reported as not found so their existence isn't leaked.
   */
  authorizeWrite(collection: CoreCollection, existing: Row | undefined, incoming: Row | undefined): Row | undefined {
    if (existing && !this.inScope(collection, existing)) throw new ForbiddenError('Record not found or not accessible');

    if (!incoming) {
      this.require(DELETE[collection]);
      return undefined;
    }

    const values: Row = { ...incoming };
    if (!canSeeProjectFinancials(this.user.role)) (FINANCIAL_FIELDS[collection] ?? []).forEach((f) => delete values[f]);

    if (!existing) {
      this.require(CREATE[collection]);
    } else if (!this.can(EDIT[collection])) {
      const onlyExecution =
        collection === 'workItems' &&
        this.can('work_items.complete') &&
        Object.keys(values).every((f) => EXECUTION_FIELDS.has(f) || f === 'id' || sameValue(f, values[f], existing[f]));
      if (!onlyExecution) throw new ForbiddenError(`Missing permission: ${EDIT[collection]}`);
    }

    // The record must stay (or land) inside the user's scope: no moving work into, or
    // creating it in, a project or package they can't see.
    const merged = { ...existing, ...values };
    if (collection === 'workItems' && !merged.project_id && typeof merged.work_package_id === 'string') {
      merged.project_id = this.packageProject.get(merged.work_package_id);
    }
    if (collection === 'projects' && !existing) {
      // A new project is checked against its client instead of the (not yet existing) project id.
      if (this.user.role === 'Client' || !this.companyWideOrClientVisible(merged.client_id)) {
        throw new ForbiddenError('Client not found or not accessible');
      }
      return values;
    }
    if (!this.inScopeForWrite(collection, merged)) throw new ForbiddenError('Target not found or not accessible');
    return values;
  }

  private companyWideOrClientVisible(clientId: unknown) {
    return this.visibleProjects === null || this.inScope('clients', { id: clientId });
  }

  private inScopeForWrite(collection: CoreCollection, row: Row) {
    if (collection === 'clients') return this.visibleProjects === null || this.inScope('clients', row);
    return this.inScope(collection, row);
  }
}

const blank = (v: unknown) => v === '' || v === undefined || v === null;

/** JSON with sorted keys: jsonb does not preserve the app's key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v);
}

/** Whether an incoming value equals the stored one, ignoring representation differences. */
export function sameValue(field: string, a: unknown, b: unknown) {
  if (a === b || (blank(a) && blank(b))) return true;
  if (field.endsWith('_at') && typeof a === 'string' && typeof b === 'string') {
    return new Date(a).getTime() === new Date(b).getTime();
  }
  return stable(a) === stable(b);
}
