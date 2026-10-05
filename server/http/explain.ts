import { ALL_PERMISSIONS, ROLE_DEFINITIONS, hasPermission } from '../../src/utils/permissions';
import type { PermissionKey, UserProfile, UserRole } from '../../src/types';

/** Roles that hold a permission, from the shared role table. */
export function rolesWith(permission: PermissionKey): UserRole[] {
  return (Object.keys(ROLE_DEFINITIONS) as UserRole[]).filter((role) =>
    hasPermission({ role } as UserProfile, permission)
  );
}

/**
 * Turns "Missing permission: drawings.approve" into an actionable sentence:
 * "This needs the “Approve Drawings” permission, which Owner / CEO has." Other messages
 * pass through unchanged. Never adds internal detail.
 */
export function explainRefusal(message: string): string {
  return message.replace(/Missing permission: ([a-z_]+\.[a-z_]+)(?: \(([^)]*)\))?/g, (_all, key: string, what?: string) => {
    const meta = ALL_PERMISSIONS.find((p) => p.key === key);
    const roles = rolesWith(key as PermissionKey);
    const label = meta ? `“${meta.label}”` : `“${key}”`;
    const who = roles.length ? `, which ${roles.join(', ')} ${roles.length === 1 ? 'has' : 'have'}` : '';
    return `${what ? `To ${what}, you need` : 'This needs'} the ${label} permission${who}`;
  });
}
