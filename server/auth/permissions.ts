import type { PermissionKey, UserRole } from '../../src/types';
import { ROLE_DEFINITIONS, canViewProjectFinancials } from '../../src/utils/permissions';

/**
 * User -> Role -> Permissions. The role table is the same one the UI uses
 * (src/utils/permissions.ts), but here it is evaluated on the server against the
 * session's user, never against anything the browser sends.
 */
export const ROLES = Object.keys(ROLE_DEFINITIONS) as UserRole[];

const BY_ROLE = new Map<UserRole, ReadonlySet<PermissionKey>>(
  ROLES.map((role) => [role, new Set(ROLE_DEFINITIONS[role].defaultPermissions)])
);

export function permissionsFor(role: UserRole): ReadonlySet<PermissionKey> {
  return BY_ROLE.get(role) ?? new Set();
}

export function isRole(value: unknown): value is UserRole {
  return typeof value === 'string' && BY_ROLE.has(value as UserRole);
}

/** Contract values and budgets (same rule the UI uses). */
export function canSeeProjectFinancials(role: UserRole): boolean {
  return canViewProjectFinancials({ id: '', name: '', email: '', role });
}
