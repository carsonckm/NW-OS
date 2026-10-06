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
import { raiseProposal, validateProposal } from './assistantActions';
import type { DataService } from './service';

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

// ------------------------------------------------------------ message interpretation
export type Confidence = 'Confirmed' | 'Probable' | 'Unknown';
export interface Interpretation {
  intent: 'progress_update' | 'problem_report' | 'question' | 'unknown';
  confidence: Confidence;
  work_item_code: string | null;
  progress_percent: number | null;
  summary: string;
}

const PROBLEM = /\b(problem|issue|damage[d]?|broken|crack(ed)?|scratch(ed)?|wrong|missing|short|leak(ing)?|not fit|doesn'?t fit|rosak|pecah|salah|kurang|tak cukup|tak muat|bocor|calar)\b|问题|坏|破|裂|缺|不对|漏/i;
const DONE = /\b(done|finished|completed?|siap|habis pasang)\b|完成|装好|做好/i;
const PROGRESS = /\b(progress|installed|install(ing)?|pasang|fixing|half)\b|安装|进度/i;
const QUESTION = /\?|\b(what|when|where|which|bila|apa|mana|berapa)\b|吗|什么|几时/i;

/**
 * Reads a field message (English, Bahasa Malaysia, Chinese or a mix) into what it *probably*
 * reports. Deterministic, never guesses an item: without a work item code nothing is proposed.
 */
export function interpretMessage(text: string): Interpretation {
  const code = text.match(/\b([A-Za-z]{2,5})-?(\d{2,4})\b/);
  const work_item_code = code ? `${code[1].toUpperCase()}-${code[2]}` : null;
  const pct = text.match(/(\d{1,3})\s*(%|percent|peratus)/i);
  const percent = pct ? Math.min(100, Number(pct[1])) : null;
  if (PROBLEM.test(text)) {
    return { intent: 'problem_report', confidence: work_item_code ? 'Confirmed' : 'Unknown', work_item_code, progress_percent: null, summary: `Problem reported${work_item_code ? ` on ${work_item_code}` : ''}` };
  }
  if (percent !== null || DONE.test(text) || PROGRESS.test(text)) {
    const value = percent ?? (DONE.test(text) ? 100 : /half|separuh|一半/i.test(text) ? 50 : null);
    const confidence: Confidence = !work_item_code || value === null ? 'Unknown' : percent !== null ? 'Confirmed' : 'Probable';
    return { intent: 'progress_update', confidence, work_item_code, progress_percent: value, summary: `Progress${value !== null ? ` ${value}%` : ''}${work_item_code ? ` on ${work_item_code}` : ''}` };
  }
  if (QUESTION.test(text)) return { intent: 'question', confidence: 'Confirmed', work_item_code, progress_percent: null, summary: 'Question' };
  return { intent: 'unknown', confidence: 'Unknown', work_item_code, progress_percent: null, summary: 'Not understood' };
}

/**
 * A field report from a known contractor / site user becomes a proposal for the project's PM
 * (or the Owner if the project has no active PM). Nothing changes until that person approves.
 */
async function proposeFromMessage(pool: Pool, service: DataService, user: AuthUser, text: string, i: Interpretation): Promise<{ reply: string; outcome: string }> {
  const ask = 'Please include the item code (e.g. CAR-003) and what happened or the % done, so your PM can confirm it.';
  if (i.confidence === 'Unknown' || !i.work_item_code) return { reply: `I couldn't tell exactly what to record. ${ask}`, outcome: 'needs_clarification' };
  const ctx = await AccessContext.load(pool, user);
  const items = (await pool.query('SELECT * FROM work_items WHERE item_code = $1 ORDER BY id', [i.work_item_code])).rows.filter((w) => ctx.canView('workItems', w));
  if (items.length !== 1) return { reply: `I can't find ${i.work_item_code} among your work items${items.length > 1 ? ' (more than one matches)' : ''}. ${ask}`, outcome: 'item_not_found' };
  const item = items[0];
  let checked;
  try {
    if (i.intent === 'problem_report') {
      checked = await validateProposal(pool, ctx, 'report_issue', { work_item_id: item.id, title: `${item.item_code}: ${text.slice(0, 120)}`, description: `Message from ${user.name} (${user.role}) via WhatsApp:\n"${text.slice(0, 1000)}"`, category: 'Installation', priority: 'High' });
    } else {
      const job = (await pool.query(`SELECT id FROM installation_jobs WHERE work_item_id = $1 AND status NOT IN ('Cancelled', 'Completed') ORDER BY updated_at DESC LIMIT 1`, [item.id])).rows[0];
      if (!job) return { reply: `${item.item_code} has no open installation job to record progress on. Your PM has the details.`, outcome: 'no_installation_job' };
      checked = await validateProposal(pool, ctx, 'record_progress', { installation_job_id: job.id, progress_percent: i.progress_percent, note: `WhatsApp: "${text.slice(0, 300)}"` });
    }
  } catch {
    return { reply: `I can't record that for ${i.work_item_code}. ${ask}`, outcome: 'not_permitted' };
  }
  const p = (await pool.query(`SELECT u.id, u.name, u.role FROM projects p JOIN users u ON u.id = p.project_manager_id AND u.is_active WHERE p.id = $1`, [checked.project_id])).rows[0]
    ?? (await pool.query(`SELECT id, name, role FROM users WHERE role = 'Owner / CEO' AND is_active ORDER BY id LIMIT 1`)).rows[0];
  if (!p) return { reply: 'Received. No project manager is available to confirm it right now; please call the office.', outcome: 'no_approver' };
  // The same report delivered twice (provider retries, resends) raises one proposal.
  const same = (
    await pool.query(
      `SELECT id, data->>'approval_number' AS number FROM approvals WHERE approval_type = 'AI Proposal' AND decision = 'Pending'
       AND data->>'asked_by_id' = $1 AND data->'proposal'->>'action' = $2 AND data->'proposal'->'params' @> $3::jsonb AND data->>'source' = 'WhatsApp' LIMIT 1`,
      [user.id, checked.action, JSON.stringify(checked.action === 'record_progress' ? { installation_job_id: checked.params.installation_job_id, progress_percent: checked.params.progress_percent } : { work_item_id: checked.params.work_item_id, title: checked.params.title })]
    )
  ).rows[0];
  if (same) return { reply: `Already received: ${checked.summary}. It is waiting for ${p.name} to confirm (ref ${same.number}).`, outcome: `duplicate:${same.id}` };
  const proposal = await raiseProposal(service, ctx, { id: user.id, name: user.name, role: user.role }, checked, {
    approver: p,
    source: 'WhatsApp',
    requestedBy: `WhatsApp interpreter (${user.name})`,
    rationale: `Interpreted (${i.confidence}) from a WhatsApp message by ${user.name}: "${text.slice(0, 500)}"`,
  });
  return {
    reply: `Received (${i.confidence.toLowerCase()}): ${checked.summary}. Sent to ${p.name} to confirm — nothing is changed until they approve. Ref ${proposal.approval_number}.`,
    outcome: `proposal:${proposal.id}`,
  };
}

export interface InboundResult {
  recognized: boolean;
  user_id: string | null;
  reply: string;
  delivered: boolean;
  provider: string;
  interpretation?: Interpretation;
  proposal_id?: string;
}

export async function handleInbound(pool: Pool, rawPhone: unknown, text: unknown, provider: WhatsAppProvider = NullProvider, service?: DataService): Promise<InboundResult> {
  const phone = normalizePhone(rawPhone) ?? String(rawPhone ?? '').slice(0, 32);
  const body = typeof text === 'string' ? text : '';
  const contact = normalizePhone(rawPhone)
    ? (await pool.query('SELECT c.user_id, u.* FROM whatsapp_contacts c JOIN users u ON u.id = c.user_id WHERE c.phone = $1', [phone])).rows[0]
    : undefined;
  const known = contact && contact.is_active ? (contact as AuthUser) : undefined;
  await log(pool, 'inbound', phone, known?.id ?? null, body, known ? 'recognized' : contact ? 'inactive_user' : 'unknown_contact');
  // Unknown numbers never get project information or have anything interpreted.
  let reply = UNKNOWN_CONTACT_REPLY;
  let interpretation: Interpretation | undefined;
  let proposal_id: string | undefined;
  if (known) {
    interpretation = interpretMessage(body);
    const fieldRole = ['Contractor', 'Site Supervisor'].includes(known.role);
    if (service && fieldRole && (interpretation.intent === 'progress_update' || interpretation.intent === 'problem_report')) {
      const r = await proposeFromMessage(pool, service, known, body, interpretation);
      reply = r.reply;
      if (r.outcome.startsWith('proposal:')) proposal_id = r.outcome.slice(9);
      await log(pool, 'inbound', phone, known.id, `[interpreted ${interpretation.intent} / ${interpretation.confidence}]`, r.outcome);
    } else reply = await replyFor(pool, known);
  }
  const sent = await provider.send(phone, reply);
  await log(pool, 'outbound', phone, known?.id ?? null, reply, sent.delivered ? 'sent' : 'provider_not_configured');
  return { recognized: !!known, user_id: known?.id ?? null, reply, delivered: sent.delivered, provider: provider.name, interpretation, proposal_id };
}
