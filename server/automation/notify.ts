/** Inserts in-app notifications once per (user, rule key), for active users only. */
import { randomUUID } from 'crypto';
import type { PoolClient } from '../db/pool';
import type { NoteSpec } from './types';

export async function insertNotifications(db: PoolClient, users: string[], note: NoteSpec, ruleKey: string, source: string) {
  let n = 0;
  for (const userId of new Set(users)) {
    const res = await db.query(
      `INSERT INTO notifications (id, user_id, title, message, type, priority, project_id, link_tab, entity_type, entity_id, rule_key, source, requires_ack)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13 WHERE EXISTS (SELECT 1 FROM users WHERE id = $2 AND is_active)
       ON CONFLICT (user_id, rule_key) DO NOTHING`,
      [`ntf-${randomUUID()}`, userId, note.title, note.message, note.type, note.priority, note.project_id, note.link_tab, note.entity_type, note.entity_id, ruleKey, source, note.type === 'escalation']
    );
    n += res.rowCount ?? 0;
  }
  return n;
}
