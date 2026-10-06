/**
 * What the server's authority resolver decides for the signed-in user on the records a screen
 * shows (GET /api/authority/resolve). Screens show an approval action only when the server says
 * it is allowed, and otherwise say why (for example "Owner approval required"). There is no
 * authority logic here: the result is the resolver's own, and the server resolves again when
 * the action is taken, so a manipulated screen gains nothing.
 *
 * Items are "kind:id:action" (kind: drawing_revision, drawing, variation, purchase_order,
 * invoice, approval; action: approve, reject, request_changes).
 */
import { useEffect, useState } from 'react';
import { useNW } from '../context/NWContext';
import { api } from './coreApi';

export type AuthorityReasonCode =
  | 'ALLOWED'
  | 'OWNER_REQUIRED'
  | 'SENSITIVITY_BLOCKED'
  | 'NO_MATCHING_AUTHORITY'
  | 'INSUFFICIENT_PERMISSION'
  | 'OUT_OF_SCOPE'
  | 'VALUE_LIMIT_EXCEEDED'
  | 'RISK_LIMIT_EXCEEDED'
  | 'AUTHORITY_NOT_YET_ACTIVE'
  | 'AUTHORITY_EXPIRED'
  | 'AUTHORITY_DEACTIVATED'
  | 'CONDITION_NOT_MET'
  | 'SELF_APPROVAL_BLOCKED'
  | 'INVALID_AUTHORITY_CONTEXT';

export interface ScreenAuthority {
  item: string;
  allowed: boolean;
  reason_code: AuthorityReasonCode;
  reason: string;
  requires_owner: boolean;
  basis: string;
  decision_type: string;
  project_sensitivity: string | null;
  matched_rule_code: string | null;
}

export const authorityItem = (kind: string, id: string, action: 'approve' | 'reject' | 'request_changes' = 'approve') => `${kind}:${id}:${action}`;

/**
 * Resolves the given items for the signed-in user (database mode only), again after every
 * sync. `live` is false in demo mode, where there is no server to ask.
 */
export function useAuthority(items: string[]) {
  const { coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';
  const key = [...new Set(items)].sort().join(',');
  const [state, setState] = useState<{ key: string; byItem: Record<string, ScreenAuthority> }>({ key: '', byItem: {} });
  useEffect(() => {
    if (!live || !key) {
      setState({ key, byItem: {} });
      return;
    }
    let cancelled = false;
    const all = key.split(',');
    (async () => {
      const byItem: Record<string, ScreenAuthority> = {};
      for (let i = 0; i < all.length; i += 100) {
        const rows = await api.get<ScreenAuthority[]>(`/authority/resolve?items=${encodeURIComponent(all.slice(i, i + 100).join(','))}`);
        for (const r of rows) byItem[r.item] = r;
      }
      if (!cancelled) setState({ key, byItem });
    })().catch(() => !cancelled && setState({ key, byItem: {} }));
    return () => {
      cancelled = true;
    };
  }, [key, live, coreDataSync.lastSyncedAt]);
  return {
    live,
    /** The server's answer for an item; undefined while loading (show no action meanwhile). */
    get: (item: string): ScreenAuthority | undefined => (state.key === key ? state.byItem[item] : undefined),
  };
}
