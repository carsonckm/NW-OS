/**
 * Lets any screen open another top-level tab (App owns the active tab). Optionally selects
 * a project first, so "open project" lands on that project's command center, and a record to
 * focus (a notification's deep link): the target screen picks it up with useFocus().
 */
import { useEffect, useState } from 'react';

export const NAVIGATE_EVENT = 'nwos:navigate';
const FOCUS_KEY = 'nwos:focus';

export interface FocusTarget {
  type: string;
  id: string;
}

export interface NavigateDetail {
  tab: string;
  projectId?: string;
  focus?: FocusTarget;
}

export function navigateTo(tab: string, projectId?: string, focus?: FocusTarget) {
  try {
    if (focus) sessionStorage.setItem(FOCUS_KEY, JSON.stringify(focus));
  } catch {
    // focus is a convenience; navigation still works without storage
  }
  window.dispatchEvent(new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, { detail: { tab, projectId, focus } }));
}

/** The record a deep link asked this screen to show (for the given record types), once. */
export function useFocus(types: string[]): FocusTarget | null {
  const [focus, setFocus] = useState<FocusTarget | null>(null);
  const key = types.join('|');
  useEffect(() => {
    const read = () => {
      try {
        const raw = sessionStorage.getItem(FOCUS_KEY);
        if (!raw) return;
        const f = JSON.parse(raw) as FocusTarget;
        if (types.includes(f.type)) {
          sessionStorage.removeItem(FOCUS_KEY);
          setFocus(f);
        }
      } catch {
        // ignore unreadable focus
      }
    };
    read();
    const onNav = () => setTimeout(read, 0);
    window.addEventListener(NAVIGATE_EVENT, onNav);
    return () => window.removeEventListener(NAVIGATE_EVENT, onNav);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return focus;
}

/** Where a notification / exception about `entity_type` is handled. */
export function linkFor(entityType: string | null | undefined, fallbackTab: string | null | undefined) {
  switch (entityType) {
    case 'task':
      return 'automation';
    case 'variation':
      return 'variations';
    case 'drawing_revision':
    case 'drawing':
      return 'drawings';
    case 'issue':
      return 'issues';
    case 'production_order':
      return 'production';
    case 'delivery':
    case 'site_qc':
    case 'installation':
      return 'delivery';
    case 'material_request':
    case 'goods_received':
    case 'purchase_order':
      return 'purchasing';
    case 'invoice':
      return 'commercial';
    default:
      return fallbackTab || 'dashboard';
  }
}
