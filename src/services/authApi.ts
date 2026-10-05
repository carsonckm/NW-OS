/**
 * Browser side of authentication. The session lives in an HttpOnly cookie the page
 * can't read; the server decides who the user is and what they may do.
 */
import type { PermissionKey, UserProfile, UserRole } from '../types';
import { SYNCED_COLLECTIONS } from './syncedCollections';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  client_id: string | null;
  contractor_id: string | null;
  phone: string | null;
  department: string | null;
  title: string | null;
  created_at: string;
  last_login: string | null;
  assigned_project_ids: string[];
  permissions: PermissionKey[];
}

export interface SessionInfo {
  authEnabled: boolean;
  user: SessionUser | null;
}

/** Fired when any API call answers 401, so the app can return to the sign-in screen. */
export const UNAUTHORIZED_EVENT = 'nwos:unauthorized';

async function post(path: string, body?: unknown) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const authApi = {
  async session(): Promise<SessionInfo> {
    const res = await fetch('/api/auth/session');
    if (!res.ok) throw new Error(`Session check failed (HTTP ${res.status})`);
    return res.json();
  },

  async login(email: string, password: string): Promise<SessionUser> {
    const res = await post('/api/auth/login', { email, password });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.message || 'Sign-in failed');
    return body.user;
  },

  async logout() {
    await post('/api/auth/logout').catch(() => undefined);
  },
};

/** The app's UserProfile for a signed-in user (the UI's existing shape). */
export function toUserProfile(user: SessionUser): UserProfile {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    email: user.email,
    phone: user.phone ?? undefined,
    department: user.department ?? undefined,
    title: user.title ?? undefined,
    status: user.is_active ? 'active' : 'inactive',
    assigned_project_ids: user.assigned_project_ids,
    contractor_id: user.contractor_id ?? undefined,
    client_id: user.client_id ?? undefined,
    created_at: user.created_at,
  };
}

// localStorage keys holding database-backed data. In database mode they are only a cache of
// what the signed-in user may see, so they are cleared on sign-out and when a different
// user signs in on the same browser.
const CORE_CACHE_KEYS = [...SYNCED_COLLECTIONS.map((c) => c.storageKey), 'currentUser', 'auditLogs'].map((k) => `nw_os_data_v1_${k}`);
const CACHE_OWNER_KEY = 'nw_os_core_cache_owner';

export function clearCoreCache() {
  try {
    CORE_CACHE_KEYS.forEach((k) => localStorage.removeItem(k));
    Object.keys(localStorage)
      .filter((k) => k.startsWith('nw_os_core_backup_'))
      .forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(CACHE_OWNER_KEY);
  } catch {
    /* storage unavailable */
  }
}

/** Clears cached core data left by a different user before this user's session starts. */
export function claimCoreCache(userId: string) {
  try {
    const owner = localStorage.getItem(CACHE_OWNER_KEY);
    if (owner !== userId) {
      clearCoreCache();
      localStorage.setItem(CACHE_OWNER_KEY, userId);
    }
  } catch {
    /* storage unavailable */
  }
}
