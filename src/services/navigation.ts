/**
 * Lets any screen open another top-level tab (App owns the active tab). Optionally selects
 * a project first, so "open project" lands on that project's command center.
 */
export const NAVIGATE_EVENT = 'nwos:navigate';

export interface NavigateDetail {
  tab: string;
  projectId?: string;
}

export function navigateTo(tab: string, projectId?: string) {
  window.dispatchEvent(new CustomEvent<NavigateDetail>(NAVIGATE_EVENT, { detail: { tab, projectId } }));
}
