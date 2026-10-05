/**
 * Server notifications for the signed-in user (/api/notifications). They are created by the
 * server's automation rules for the people who can act, so the list is personal and is the
 * same on every device. Polled every minute and after each data sync.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNW } from '../context/NWContext';
import { api } from './coreApi';

export interface ServerNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  priority: 'normal' | 'high' | 'urgent';
  project_id: string | null;
  link_tab: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

export function useServerNotifications() {
  const { authMode, coreDataSync } = useNW();
  const enabled = authMode && coreDataSync.mode === 'database';
  const [items, setItems] = useState<ServerNotification[]>([]);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      setItems(await api.get<ServerNotification[]>('/notifications'));
    } catch {
      // keep the last list; the sync banner reports connection problems
    }
  }, [enabled]);

  useEffect(() => {
    void load();
    if (!enabled) return;
    const t = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(t);
  }, [load, enabled, coreDataSync.lastSyncedAt]);

  const markRead = async (id: string) => {
    setItems((list) => list.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    await api.post(`/notifications/${encodeURIComponent(id)}/read`, {}).catch(() => undefined);
  };
  const markAllRead = async () => {
    setItems((list) => list.map((n) => ({ ...n, is_read: true })));
    await api.post('/notifications/read-all', {}).catch(() => undefined);
  };

  return { enabled, items, markRead, markAllRead, reload: load };
}
