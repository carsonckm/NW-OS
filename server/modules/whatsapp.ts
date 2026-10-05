/**
 * WhatsApp gateway architecture (no provider is connected in Phase 4).
 *
 *   provider webhook -> verify signature -> handleInbound(phone, text)
 *     -> identify the sender ONLY from whatsapp_contacts (registered by an administrator)
 *     -> unknown or inactive number: fixed reply, no project information, logged
 *     -> known number: answer as that user, through the same AccessContext (role,
 *        permissions, project scope) the web app uses
 *   outbound replies go through a WhatsAppProvider; the default one sends nothing.
 *
 * Nothing the message or the caller says about who the sender is (name, role, project,
 * contact list) is trusted.
 */
import { AccessContext } from '../auth/access';
import type { AuthUser } from '../auth/store';
import type { Pool } from '../db/pool';

export interface WhatsAppProvider {
  readonly name: string;
  readonly configured: boolean;
  send(to: string, body: string): Promise<{ delivered: boolean; reason?: string }>;
}

/** Default provider: nothing is sent anywhere. */
export const NullProvider: WhatsAppProvider = {
  name: 'none',
  configured: false,
  send: async () => ({ delivered: false, reason: 'No WhatsApp provider is configured' }),
};

export const UNKNOWN_CONTACT_REPLY =
  'This number is not registered with NW OS, so no project information can be shared. Please contact your NW project manager.';

/** E.164: +, country code, digits only. */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const digits = raw.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : digits.startsWith('0') ? `+6${digits}` : `+${digits}`;
  return /^\+[0-9]{8,15}$/.test(e164) ? e164 : null;
}

async function log(pool: Pool, direction: 'inbound' | 'outbound', phone: string, userId: string | null, body: string, outcome: string) {
  await pool.query('INSERT INTO whatsapp_messages (direction, phone, user_id, body, outcome) VALUES ($1, $2, $3, $4, $5)', [direction, phone, userId, body.slice(0, 4000), outcome]);
}

async function replyFor(pool: Pool, user: AuthUser): Promise<string> {
  const ctx = await AccessContext.load(pool, user);
  const projects = (await pool.query('SELECT id, project_name, project_status FROM projects ORDER BY id')).rows.filter((p) => ctx.canSeeProject(p.id));
  if (user.role === 'Client') {
    // Clients get their project status only; nothing internal.
    return [`Hello ${user.name}.`, ...projects.map((p) => `${p.project_name}: ${p.project_status}`), 'For details please contact your NW project manager.'].join('\n');
  }
  const tasks = (
    await pool.query(
      `SELECT data->>'title' AS title, due_date FROM tasks WHERE assigned_user_id = $1 AND status NOT IN ('Completed', 'Cancelled') ORDER BY due_date NULLS LAST LIMIT 5`,
      [user.id]
    )
  ).rows;
  const lines = [`Hello ${user.name} (${user.role}).`];
  lines.push(tasks.length ? `Your open tasks:\n${tasks.map((t) => `- ${t.title}${t.due_date ? ` (due ${t.due_date})` : ''}`).join('\n')}` : 'You have no open tasks.');
  if (ctx.can('issues.view') && projects.length) {
    const ids = projects.map((p) => p.id);
    const open = (await pool.query(`SELECT count(*)::int AS n FROM issues WHERE project_id = ANY($1) AND status NOT IN ('Resolved', 'Closed')`, [ids])).rows[0].n;
    lines.push(`Open issues on your projects: ${open}.`);
  }
  lines.push('Approvals and decisions are made in NW OS, not over WhatsApp.');
  return lines.join('\n');
}

export interface InboundResult {
  recognized: boolean;
  user_id: string | null;
  reply: string;
  delivered: boolean;
  provider: string;
}

export async function handleInbound(pool: Pool, rawPhone: unknown, text: unknown, provider: WhatsAppProvider = NullProvider): Promise<InboundResult> {
  const phone = normalizePhone(rawPhone) ?? String(rawPhone ?? '').slice(0, 32);
  const body = typeof text === 'string' ? text : '';
  const contact = normalizePhone(rawPhone)
    ? (await pool.query('SELECT c.user_id, u.* FROM whatsapp_contacts c JOIN users u ON u.id = c.user_id WHERE c.phone = $1', [phone])).rows[0]
    : undefined;
  const known = contact && contact.is_active ? (contact as AuthUser) : undefined;
  await log(pool, 'inbound', phone, known?.id ?? null, body, known ? 'recognized' : contact ? 'inactive_user' : 'unknown_contact');
  const reply = known ? await replyFor(pool, known) : UNKNOWN_CONTACT_REPLY;
  const sent = await provider.send(phone, reply);
  await log(pool, 'outbound', phone, known?.id ?? null, reply, sent.delivered ? 'sent' : 'provider_not_configured');
  return { recognized: !!known, user_id: known?.id ?? null, reply, delivered: sent.delivered, provider: provider.name };
}
