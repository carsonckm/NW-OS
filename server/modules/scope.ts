import type { PermissionKey } from '../../src/types';
import { ForbiddenError, type AccessContext } from '../auth/access';
import type { Pool, PoolClient } from '../db/pool';
import type { ModuleDef, Row } from './types';

type Perm = PermissionKey | PermissionKey[] | null;

const CONTRACTOR_PROJECT_LEVEL = new Set(['drawings', 'documents']);

export function hasAny(ctx: AccessContext, perm: Perm): boolean {
  if (!perm) return false;
  return (Array.isArray(perm) ? perm : [perm]).some((p) => ctx.can(p));
}

export function requireAny(ctx: AccessContext, perm: Perm, what: string) {
  if (!hasAny(ctx, perm)) {
    const names = perm ? (Array.isArray(perm) ? perm.join(' or ') : perm) : 'none (not allowed)';
    throw new ForbiddenError(`Missing permission for ${what}: ${names}`);
  }
}

/** Production order id -> what scoping needs. Loaded once per request when required. */
export type OrderInfo = Map<string, { project_id: string; contractor_id: string | null; work_item_id: string }>;

export async function loadOrderInfo(db: Pool | PoolClient): Promise<OrderInfo> {
  const res = await db.query('SELECT id, project_id, contractor_id, work_item_id FROM production_orders');
  return new Map(res.rows.map((r) => [r.id, r]));
}

/** The project a module record belongs to (undefined for company-level records). */
export function projectOf(def: ModuleDef, record: Row, orders: OrderInfo): string | undefined {
  switch (def.scope.kind) {
    case 'project':
      return (record[def.scope.field ?? 'project_id'] as string) || undefined;
    case 'order':
      return orders.get(record.production_order_id as string)?.project_id;
    case 'client':
      return (record.project_id as string) || undefined;
    case 'company':
      return undefined;
  }
}

/**
 * Whether a record is inside the user's scope (permissions are checked separately).
 * Contractors additionally only see records tied to their own work: their contractor id,
 * their work items or packages, or their production orders.
 */
export function inModuleScope(ctx: AccessContext, def: ModuleDef, record: Row, orders: OrderInfo): boolean {
  const scope = def.scope;
  if (scope.kind === 'company') return true;
  if (scope.kind === 'client') {
    if (record.project_id) return ctx.canSeeProject(record.project_id);
    return ctx.inScope('clients', { id: record.client_id });
  }
  const project = projectOf(def, record, orders);
  if (!project) {
    // Records without a project (some tasks/escalations) are visible to company-wide roles,
    // or to the user they are assigned to.
    if (scope.kind === 'project' && scope.optional) {
      return ctx.companyWide || record.assigned_user_id === ctx.user.id;
    }
    return false;
  }
  if (!ctx.canSeeProject(project)) return false;

  if (ctx.user.role === 'Contractor') {
    const mine = ctx.user.contractor_id;
    // Tasks: a contractor sees only the tasks assigned to them (internal tasks stay internal).
    if (def.key === 'tasks') return record.assigned_user_id === ctx.user.id;
    if (typeof record.contractor_id === 'string' && record.contractor_id) return record.contractor_id === mine;
    if (scope.kind === 'order') {
      const order = orders.get(record.production_order_id as string);
      return order?.contractor_id === mine || ctx.contractorOwnsWorkItem(order?.work_item_id);
    }
    if (record.work_item_id) return ctx.contractorOwnsWorkItem(record.work_item_id);
    if (record.work_package_id) return ctx.packageContractorOf(record.work_package_id) === mine;
    if (record.assigned_user_id) return record.assigned_user_id === ctx.user.id;
    // Project-level records not tied to their work: only drawings and documents.
    return CONTRACTOR_PROJECT_LEVEL.has(def.key);
  }
  return true;
}
