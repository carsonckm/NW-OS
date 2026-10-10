/**
 * Owner exception lifecycle (Phase 6 Batch 9).
 *
 * The Owner Exception Center computes exceptions from live data (ownerExceptions). This module
 * records what happens to each one, keyed by the exception's stable id:
 *
 *   active ──acknowledge──▶ acknowledged ──wait──▶ waiting
 *     │  ▲                      │    ▲              │
 *     │  └────────── (any of active / acknowledged / waiting / stale) ──────────┐
 *     ├─ resolve ─▶ resolved ─ reopen (reason) ─▶ active                         │
 *     └─ dismiss (reason; never critical) ─▶ dismissed ─ reopen (reason) ─▶ active
 *   stale: set by NW OS when an unresolved exception has had no meaningful activity for
 *   STALE_DAYS; any Owner action moves it on. Stale is never "resolved".
 *
 * - Severity is the server's own (ownerExceptions), re-computed at the moment of every action;
 *   a critical exception can be acknowledged, put on waiting and resolved, never dismissed (or
 *   snoozed — snoozeException already refuses it).
 * - An approval exception is resolved by deciding the approval on its record, not here: while the
 *   approval is pending, "resolve" is refused. When its condition clears, NW OS records
 *   "auto_resolve" itself.
 * - Reopening is always explicit, by the Owner, with a reason. If a resolved / dismissed
 *   condition comes back, NW OS only records "recurred"; it never reopens on its own.
 * - Meaningful activity = an Owner lifecycle action, or a material change of the exception
 *   (severity, reason codes, status). Viewing or polling the list writes nothing.
 * - Every transition locks the row (SELECT … FOR UPDATE), checks the optional expected_state,
 *   appends an event and an audit row in one transaction; repeating the same action is a no-op.
 *   History (owner_exception_events) is append-only and nothing is deleted (database triggers).
 */
import { AccessContext, type AccessContext as Ctx } from '../auth/access';
import type { AuthUser } from '../auth/store';
import { writeAudit, type AuditActor } from '../audit';
import { NotFoundError, ValidationError } from '../core/repository';
import { withTransaction, type Pool, type PoolClient } from '../db/pool';
import type { PlannedAction, RuleDef } from '../automation/types';
import { insertNotifications } from '../automation/notify';
import { ownerExceptions, requireOwner, type OwnerException } from './approvalOps';

type Row = Record<string, any>;
type Db = Pool | PoolClient;

/** No meaningful activity for this long → stale (centralised; no settings UI in this batch). */
export const STALE_DAYS = 14;

export const STATES = ['active', 'acknowledged', 'waiting', 'resolved', 'stale', 'dismissed'] as const;
export type LifecycleStateName = (typeof STATES)[number];
export const ACTIONS = ['acknowledge', 'wait', 'resolve', 'dismiss', 'reopen'] as const;
export type LifecycleAction = (typeof ACTIONS)[number];

const TARGET: Record<LifecycleAction, LifecycleStateName> = { acknowledge: 'acknowledged', wait: 'waiting', resolve: 'resolved', dismiss: 'dismissed', reopen: 'active' };
/** Which states each Owner action may start from. Anything else is an invalid transition. */
const FROM: Record<LifecycleAction, LifecycleStateName[]> = {
  acknowledge: ['active', 'waiting', 'stale'],
  wait: ['active', 'acknowledged', 'stale'],
  resolve: ['active', 'acknowledged', 'waiting', 'stale'],
  dismiss: ['active', 'acknowledged', 'waiting', 'stale'],
  reopen: ['resolved', 'dismissed'],
};
const REASON_REQUIRED: LifecycleAction[] = ['wait', 'dismiss', 'reopen'];
const OPEN_STATES: LifecycleStateName[] = ['active', 'acknowledged', 'waiting', 'stale'];

const notFound = (id: string) => {
  const err = new NotFoundError('clients', id);
  err.message = `Exception ${id} not found`;
  return err;
};
class ConflictError extends ValidationError {
  status = 409;
}

export const fingerprintOf = (e: OwnerException) => [e.severity, e.type, e.status ?? '', [...new Set(e.reasons.map((r) => r.code))].sort().join(',')].join('|');

async function insertEvent(db: Db, key: string, ev: { action: string; from?: string | null; to?: string | null; actor?: { id: string; name: string; role: string } | null; reason?: string | null; severity?: string | null; data?: Row }) {
  await db.query(
    `INSERT INTO owner_exception_events (exception_key, action, from_state, to_state, actor_id, actor_name, actor_role, reason, severity, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [key, ev.action, ev.from ?? null, ev.to ?? null, ev.actor?.id ?? null, ev.actor?.name ?? null, ev.actor?.role ?? null, ev.reason ?? null, ev.severity ?? null, JSON.stringify(ev.data ?? {})]
  );
}

/** Creates the state row for an exception the first time it is seen (or acted on). */
async function ensureState(db: Db, e: OwnerException, now: Date) {
  const ins = await db.query(
    `INSERT INTO owner_exception_states (exception_key, exception_type, title, project_id, severity, fingerprint, first_seen_at, last_seen_at, last_activity_at, state_changed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $7, $7) ON CONFLICT (exception_key) DO NOTHING`,
    [e.id, e.type, String(e.title).slice(0, 500), e.project_id ?? null, e.severity, fingerprintOf(e), now]
  );
  if (ins.rowCount) await insertEvent(db, e.id, { action: 'observed', to: 'active', severity: e.severity, data: { type: e.type, reasons: e.reasons.map((r) => r.code) } });
}

/** Records what the server sees now on an existing state row: severity, fingerprint, presence. */
async function observe(db: Db, e: OwnerException, row: Row, now: Date) {
  const fp = fingerprintOf(e);
  // The fingerprint includes the severity; the stored severity is compared too, so a stored value
  // that drifted on its own is corrected (and recorded) as well.
  const changed = fp !== row.fingerprint || e.severity !== row.severity;
  const recurred = !row.present;
  await db.query(
    `UPDATE owner_exception_states SET last_seen_at = $2, present = true, severity = $3, fingerprint = $4, title = $5${changed ? ', last_activity_at = $2' : ''} WHERE exception_key = $1`,
    [e.id, now, e.severity, fp, String(e.title).slice(0, 500)]
  );
  if (changed) await insertEvent(db, e.id, { action: 'changed', from: row.state, to: row.state, severity: e.severity, data: { before: row.fingerprint, after: fp } });
  if (recurred) await insertEvent(db, e.id, { action: 'recurred', from: row.state, to: row.state, severity: e.severity, reason: ['resolved', 'dismissed'].includes(row.state) ? 'The condition is present again. It stays closed until the Owner reopens it.' : null });
  return { changed, recurred };
}

/**
 * Before a dismissal or snooze: brings the exception's stored record (its severity in particular)
 * up to date with what the server sees now, exactly as the lifecycle rule would, in its own
 * transaction. The database refuses a dismissal or snooze by the stored severity (migration 026)
 * and refuses lowering a critical exception in the same transaction as dismissing or snoozing it,
 * so the record is brought up to date first and the action then checks it under the row lock.
 */
export async function refreshObservation(pool: Pool, e: OwnerException, now: Date) {
  await withTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM owner_exception_states WHERE exception_key = $1 FOR UPDATE', [e.id])).rows[0];
    if (row && (fingerprintOf(e) !== row.fingerprint || e.severity !== row.severity || !row.present)) await observe(db, e, row, now);
  });
}

/**
 * Why an exception cannot be dismissed or snoozed. The restriction is permanent: an exception
 * that has been critical stays non-dismissible even if its severity drops (migration 027).
 */
export const NOT_DISMISSIBLE = {
  critical: 'Critical: it can never be dismissed or snoozed, now or later, even if its severity drops. You can acknowledge it, put it on waiting or resolve it.',
  locked: (act: 'dismiss' | 'snooze' | 'both', since: unknown) =>
    `This exception has been critical${since ? ` (since ${new Date(since as string).toISOString().slice(0, 10)})` : ''}, so it can never be ${act === 'dismiss' ? 'dismissed' : act === 'snooze' ? 'snoozed' : 'dismissed or snoozed'}. You can acknowledge it, put it on waiting or resolve it.`,
};
/** Whether the Owner may dismiss / snooze this exception, and the permanent reason if not. */
export function dismissibility(severity: string, row: Row | undefined) {
  if (row?.critical_locked && severity !== 'critical') return { dismissible: false, not_dismissible_reason: NOT_DISMISSIBLE.locked('both', row.critical_locked_at) };
  if (severity === 'critical' || row?.critical_locked) return { dismissible: false, not_dismissible_reason: NOT_DISMISSIBLE.critical };
  return { dismissible: true, not_dismissible_reason: null };
}

/**
 * The severity a dismissal or snooze is checked and recorded against: the stored one, which must
 * also be what the server sees now. Critical is refused; a mismatch means the exception changed
 * since the request was read (a conflict: reload and try again).
 */
function storedSeverityFor(act: 'dismiss' | 'snooze', row: Row, live: OwnerException | undefined) {
  const stored = row.severity as string;
  if (row.critical_locked && stored !== 'critical' && live?.severity !== 'critical') throw new ValidationError(NOT_DISMISSIBLE.locked(act, row.critical_locked_at));
  if (stored === 'critical' || live?.severity === 'critical') {
    throw new ValidationError(act === 'dismiss' ? 'A critical exception cannot be dismissed (it can be acknowledged, put on waiting or resolved)' : 'A critical exception cannot be snoozed (safety, Strategic, blocked production / site / payment, no valid approver, critical project)');
  }
  if (live && live.severity !== stored) throw new ConflictError('The exception changed while you were acting on it: reload and try again');
  return stored;
}

/** The live exceptions (visible and snoozed), keyed by id. */
async function liveExceptions(pool: Pool, ctx: Ctx, now: Date) {
  const cur = await ownerExceptions(pool, ctx, now);
  return new Map([...cur.exceptions, ...cur.snoozed].map((e) => [e.id, e]));
}

/**
 * An Owner lifecycle action. Body: { id, reason?, expected_state? }. The server finds the
 * exception and its severity itself; nothing about severity, state or actor comes from the body.
 */
export async function transitionException(pool: Pool, ctx: Ctx, actor: AuditActor, action: string, body: unknown, now = new Date()) {
  requireOwner(ctx, 'the exception lifecycle');
  if (!(ACTIONS as readonly string[]).includes(action)) throw new ValidationError(`action must be one of ${ACTIONS.join(', ')}`);
  const act = action as LifecycleAction;
  const b = (body && typeof body === 'object' && !Array.isArray(body) ? body : {}) as Row;
  const extra = Object.keys(b).filter((k) => !['id', 'reason', 'expected_state'].includes(k));
  if (extra.length) throw new ValidationError(`These fields are set by the server or not allowed: ${extra.join(', ')}`);
  if (typeof b.id !== 'string' || !b.id) throw new ValidationError('id is required');
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 1000) : '';
  if (REASON_REQUIRED.includes(act) && !reason) throw new ValidationError(act === 'wait' ? 'Say what or whom you are waiting for' : act === 'dismiss' ? 'A reason is required to dismiss an exception' : 'A reason is required to reopen an exception');
  if (b.expected_state !== undefined && !(STATES as readonly string[]).includes(b.expected_state)) throw new ValidationError('expected_state is not a lifecycle state');

  const live = (await liveExceptions(pool, ctx, now)).get(b.id);
  if (act === 'dismiss' && live) await refreshObservation(pool, live, now);
  return withTransaction(pool, async (db) => {
    if (live) await ensureState(db, live, now);
    const row = (await db.query('SELECT * FROM owner_exception_states WHERE exception_key = $1 FOR UPDATE', [b.id])).rows[0];
    if (!row) throw notFound(b.id);
    if (row.project_id && !ctx.canSeeProject(row.project_id)) throw notFound(b.id);
    const from = row.state as LifecycleStateName;
    if (b.expected_state !== undefined && b.expected_state !== from) throw new ConflictError(`The exception is now "${from}", not "${b.expected_state}": reload and try again`);
    const to = TARGET[act];
    // Repeating the same action (a double click, a replayed request) changes nothing.
    if (from === to && !(act === 'wait' && reason && reason !== row.waiting_for)) return { id: b.id, state: from, changed: false };
    if (!FROM[act].includes(from)) throw new ValidationError(`Cannot ${act} an exception that is ${from}`);
    const severity: string = act === 'dismiss' ? storedSeverityFor('dismiss', row, live) : live?.severity ?? row.severity;
    const present = Boolean(live);
    if (act === 'resolve' && present && b.id.startsWith('approval:')) throw new ValidationError('This approval is still pending: decide it on its record (it resolves on its own once decided)');
    if (act === 'reopen' && !present) throw new ValidationError('Its condition is no longer present: there is nothing to reopen');
    const who = { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role };
    await db.query(
      `UPDATE owner_exception_states SET state = $2, state_changed_at = $3, state_changed_by = $4, last_activity_at = $3, waiting_for = $5, version = version + 1 WHERE exception_key = $1`,
      [b.id, to, now, ctx.user.id, act === 'wait' ? reason : null]
    );
    await insertEvent(db, b.id, { action: act, from, to, actor: who, reason: reason || null, severity, data: { present } });
    await writeAudit(db, actor, { action: `owner_exception.${act}`, entityType: 'owner_exception', entityId: b.id, projectId: row.project_id, before: { state: from }, after: { state: to, severity, present }, details: reason || undefined });
    return { id: b.id, state: to, changed: true };
  });
}

/** Snooze / un-snooze also appear in the exception's history. */
export async function recordSnoozeEvent(db: Db, e: OwnerException | undefined, key: string, action: 'snooze' | 'unsnooze', ctx: Ctx, reason: string | null, now: Date, data: Row = {}) {
  if (e) await ensureState(db, e, now);
  const row = (await db.query('SELECT state, severity, critical_locked, critical_locked_at FROM owner_exception_states WHERE exception_key = $1 FOR UPDATE', [key])).rows[0];
  if (!row) return;
  const severity = action === 'snooze' ? storedSeverityFor('snooze', row, e) : e?.severity ?? null;
  await db.query('UPDATE owner_exception_states SET last_activity_at = $2 WHERE exception_key = $1', [key, now]);
  await insertEvent(db, key, { action, from: row.state, to: row.state, actor: { id: ctx.user.id, name: ctx.user.name, role: ctx.user.role }, reason, severity, data });
}

/** The full history of one exception (Owner only; 404 like a missing one otherwise). */
export async function exceptionHistory(pool: Pool, ctx: Ctx, id: string) {
  requireOwner(ctx, 'the exception lifecycle');
  const row = (await pool.query('SELECT * FROM owner_exception_states WHERE exception_key = $1', [id])).rows[0];
  if (!row || (row.project_id && !ctx.canSeeProject(row.project_id))) throw notFound(id);
  const events = (await pool.query('SELECT id, action, from_state, to_state, actor_id, actor_name, actor_role, reason, severity, occurred_at, data FROM owner_exception_events WHERE exception_key = $1 ORDER BY id', [id])).rows;
  return { id, state: row.state, severity: row.severity, present: row.present, first_seen_at: row.first_seen_at, last_activity_at: row.last_activity_at, waiting_for: row.waiting_for, events: events.map((ev) => ({ ...ev, id: String(ev.id), occurred_at: new Date(ev.occurred_at).toISOString(), actor: ev.actor_id ? { id: ev.actor_id, name: ev.actor_name, role: ev.actor_role } : { id: null, name: 'NW OS', role: 'system' } })) };
}

/** Lifecycle rows for the given keys, and the closed (resolved / dismissed) ones to list separately. */
export async function lifecycleRows(db: Db, keys: string[]) {
  const rows = keys.length ? (await db.query('SELECT * FROM owner_exception_states WHERE exception_key = ANY($1)', [keys])).rows : [];
  return new Map(rows.map((r) => [r.exception_key as string, r]));
}
export async function closedExceptions(db: Db, ctx: Ctx, now: Date, days = 30) {
  return (await db.query(`SELECT * FROM owner_exception_states WHERE state IN ('resolved', 'dismissed') AND state_changed_at > $1::timestamptz - make_interval(days => $2) ORDER BY state_changed_at DESC LIMIT 200`, [now, days])).rows.filter((r) => !r.project_id || ctx.canSeeProject(r.project_id));
}

/**
 * The lifecycle rule's work: record new exceptions, material changes, cleared conditions
 * (auto-resolve unless dismissed), recurrences (recorded only, never reopened) and stale ones.
 * Idempotent: running it twice in a row writes nothing the second time.
 */
export async function syncExceptionLifecycle(pool: Pool, ctx: Ctx, now = new Date()) {
  const live = await liveExceptions(pool, ctx, now);
  const counts = { observed: 0, changed: 0, cleared: 0, auto_resolved: 0, recurred: 0, stale: 0, findings_new: 0, findings_cleared: 0, findings_alerted: 0 };
  // Integrity first: before this run records anything (a lowered stored severity is still visible).
  const found = await detectIntegrityFindings(pool, live, now);
  counts.findings_new = found.created;
  counts.findings_cleared = found.cleared;
  await withTransaction(pool, async (db) => {
    const rows = await lifecycleRows(db, [...live.keys()]);
    for (const e of live.values()) {
      const row = rows.get(e.id);
      if (!row) {
        await ensureState(db, e, now);
        counts.observed++;
        continue;
      }
      const seen = await observe(db, e, row, now);
      if (seen.changed) counts.changed++;
      if (seen.recurred) counts.recurred++;
    }
    // Conditions that cleared.
    const gone = (await db.query(`SELECT * FROM owner_exception_states WHERE present AND NOT (exception_key = ANY($1)) FOR UPDATE`, [[...live.keys()]])).rows;
    for (const row of gone) {
      if (row.project_id && !ctx.canSeeProject(row.project_id)) continue;
      if (OPEN_STATES.includes(row.state)) {
        await db.query(`UPDATE owner_exception_states SET present = false, state = 'resolved', state_changed_at = $2, state_changed_by = NULL, last_activity_at = $2, waiting_for = NULL, version = version + 1 WHERE exception_key = $1`, [row.exception_key, now]);
        await insertEvent(db, row.exception_key, { action: 'auto_resolve', from: row.state, to: 'resolved', severity: row.severity, reason: 'The condition that raised it has cleared' });
        counts.auto_resolved++;
      } else {
        await db.query('UPDATE owner_exception_states SET present = false WHERE exception_key = $1', [row.exception_key]);
        await insertEvent(db, row.exception_key, { action: 'cleared', from: row.state, to: row.state, severity: row.severity, reason: 'The condition that raised it has cleared' });
        counts.cleared++;
      }
    }
    // Stale: unresolved, still present, no meaningful activity for STALE_DAYS.
    const stale = (await db.query(`SELECT exception_key, state, severity FROM owner_exception_states WHERE present AND state IN ('active', 'acknowledged', 'waiting') AND last_activity_at < $1::timestamptz - make_interval(days => $2) FOR UPDATE`, [now, STALE_DAYS])).rows;
    for (const row of stale) {
      if (!live.has(row.exception_key)) continue;
      await db.query(`UPDATE owner_exception_states SET state = 'stale', state_changed_at = $2, state_changed_by = NULL, version = version + 1 WHERE exception_key = $1`, [row.exception_key, now]);
      await insertEvent(db, row.exception_key, { action: 'stale', from: row.state, to: 'stale', severity: row.severity, reason: `No activity for ${STALE_DAYS} days` });
      counts.stale++;
    }
  });
  // Alerts are delivered after the findings are committed, one by one, and retried by every
  // run until delivered: a failed alert never loses the finding.
  counts.findings_alerted = await alertIntegrityFindings(pool, now);
  return counts;
}

// ---------------------------------------------------------------------------------------------
// Integrity findings (Batch 11). The database prevents dismissing or snoozing an exception that
// is, or has been, recorded as critical. It cannot prevent what a holder of the runtime
// credential records about an exception NW OS has not recorded yet, or a stored severity lowered
// with a forged event. The lifecycle rule compares what is stored with what the server sees now
// and records every inconsistency as a finding: evidence only, nothing is repaired or erased.
// ---------------------------------------------------------------------------------------------

export const INTEGRITY_FINDINGS = {
  closed_while_critical: {
    title: 'A critical exception is dismissed or snoozed',
    explain: 'NW OS sees this exception as critical now, but it is stored as dismissed or snoozed. Critical exceptions cannot be dismissed or snoozed through NW OS. Either it was closed while not critical and has become critical since, or the stored record was changed outside NW OS.',
  },
  severity_lowered_while_critical: {
    title: 'A critical exception was stored with a lower severity',
    explain: 'NW OS sees this exception as critical now, and it had been recorded as critical, but its stored severity was lowered. Either its risk fell and rose again between two runs, or the stored record was changed outside NW OS.',
  },
  locked_but_closed: {
    title: 'An exception that has been critical is dismissed or snoozed',
    explain: 'This exception has been critical, so it can never be dismissed or snoozed, yet it is stored as dismissed or snoozed. It may have been closed before it became critical, or the stored record was changed outside NW OS.',
  },
} as const;
type FindingKind = keyof typeof INTEGRITY_FINDINGS;

async function detectIntegrityFindings(pool: Pool, live: Map<string, OwnerException>, now: Date) {
  return withTransaction(pool, async (db) => {
    const rows = await lifecycleRows(db, [...live.keys()]);
    const snoozes = new Map((await db.query('SELECT exception_key, snoozed_until FROM owner_exception_snoozes WHERE snoozed_until > $1', [now])).rows.map((r) => [r.exception_key as string, r]));
    const detected = new Map<string, { key: string; finding: FindingKind; details: Row }>();
    for (const e of live.values()) {
      const row = rows.get(e.id);
      if (!row) continue;
      const snooze = snoozes.get(e.id);
      const closed = row.state === 'dismissed' || Boolean(snooze);
      const details = {
        live_severity: e.severity,
        stored_severity: row.severity,
        state: row.state,
        snoozed_until: snooze ? new Date(snooze.snoozed_until).toISOString() : null,
        critical_locked: Boolean(row.critical_locked),
        critical_locked_at: row.critical_locked_at ? new Date(row.critical_locked_at).toISOString() : null,
        reasons: e.reasons.filter((r) => r.level === 'critical').map((r) => r.code),
      };
      const add = (finding: FindingKind, extra: Row = {}) => detected.set(`${e.id}|${finding}`, { key: e.id, finding, details: { ...details, ...extra } });
      if (e.severity === 'critical' && closed) add('closed_while_critical');
      else if (row.critical_locked && closed) add('locked_but_closed');
      if (e.severity === 'critical' && row.severity !== 'critical' && row.critical_locked) {
        const lowering = (await db.query(`SELECT id, occurred_at, actor_name FROM owner_exception_events WHERE exception_key = $1 AND action IN ('changed', 'observed') AND severity IS DISTINCT FROM 'critical' ORDER BY id DESC LIMIT 1`, [e.id])).rows[0];
        add('severity_lowered_while_critical', lowering ? { lowering_event_id: String(lowering.id), lowering_event_at: new Date(lowering.occurred_at).toISOString(), lowering_event_actor: lowering.actor_name ?? 'NW OS' } : {});
      }
    }
    const open = (await db.query('SELECT * FROM owner_exception_integrity_findings WHERE cleared_at IS NULL FOR UPDATE')).rows;
    const openByKey = new Map(open.map((f) => [`${f.exception_key}|${f.finding}`, f]));
    const actor = { name: 'NW OS exception lifecycle', role: 'system' };
    let created = 0;
    let cleared = 0;
    for (const [k, d] of detected) {
      const existing = openByKey.get(k);
      if (existing) {
        // Still open: no new alert, only when it was last seen.
        await db.query('UPDATE owner_exception_integrity_findings SET last_detected_at = GREATEST(last_detected_at, $2) WHERE id = $1', [existing.id, now]);
        continue;
      }
      const ins = (await db.query(
        `INSERT INTO owner_exception_integrity_findings (exception_key, finding, first_detected_at, last_detected_at, details) VALUES ($1, $2, $3, $3, $4)
         ON CONFLICT (exception_key, finding) WHERE cleared_at IS NULL DO NOTHING RETURNING id`,
        [d.key, d.finding, now, JSON.stringify(d.details)]
      )).rows[0];
      if (!ins) continue;
      created++;
      await writeAudit(db, actor, { action: 'security.exception_integrity_finding', entityType: 'owner_exception', entityId: d.key, after: { finding_id: String(ins.id), finding: d.finding, ...d.details }, details: INTEGRITY_FINDINGS[d.finding].title });
    }
    for (const f of open) {
      if (detected.has(`${f.exception_key}|${f.finding}`)) continue;
      await db.query('UPDATE owner_exception_integrity_findings SET cleared_at = $2 WHERE id = $1', [f.id, now]);
      cleared++;
      await writeAudit(db, actor, { action: 'security.exception_integrity_cleared', entityType: 'owner_exception', entityId: f.exception_key, after: { finding_id: String(f.id), finding: f.finding }, details: 'The inconsistency no longer holds (the finding and its evidence are kept)' });
    }
    return { created, cleared };
  });
}

/** Alerts the active Owner(s) about open findings not alerted yet; one notification per finding. */
async function alertIntegrityFindings(pool: Pool, now: Date) {
  const pending = (await pool.query('SELECT * FROM owner_exception_integrity_findings WHERE cleared_at IS NULL AND alerted_at IS NULL ORDER BY id')).rows;
  let delivered = 0;
  for (const f of pending) {
    try {
      await withTransaction(pool, async (db) => {
        const owners = (await db.query(`SELECT id FROM users WHERE role = 'Owner / CEO' AND is_active ORDER BY id`)).rows.map((r) => r.id as string);
        if (!owners.length) throw new Error('No active Owner to alert');
        const kind = INTEGRITY_FINDINGS[f.finding as FindingKind];
        await insertNotifications(db, owners, { title: `Integrity check: ${kind.title}`, message: `${f.exception_key}. ${kind.explain}`, type: 'warning', priority: 'urgent', project_id: null, link_tab: 'dashboard', entity_type: 'owner_exception', entity_id: f.exception_key }, `exception-integrity:${f.id}`, 'exception_lifecycle');
        await db.query('UPDATE owner_exception_integrity_findings SET alerted_at = $2, alert_attempts = alert_attempts + 1, last_alert_error = NULL WHERE id = $1', [f.id, now]);
      });
      delivered++;
    } catch (err) {
      await pool.query('UPDATE owner_exception_integrity_findings SET alert_attempts = alert_attempts + 1, last_alert_error = $2 WHERE id = $1', [f.id, String((err as Error).message).slice(0, 300)]).catch(() => {});
    }
  }
  return delivered;
}

/** The Owner's context for the scheduled lifecycle rule (the Exception Center is the Owner's). */
async function ownerContext(pool: Pool) {
  const u = (await pool.query(`SELECT * FROM users WHERE role = 'Owner / CEO' AND is_active ORDER BY id LIMIT 1`)).rows[0] as AuthUser | undefined;
  return u ? AccessContext.load(pool, u) : undefined;
}

export const exceptionLifecycleRule: RuleDef = {
  key: 'exception_lifecycle',
  name: 'Owner exception lifecycle',
  description: `Keeps the Owner Exception Center's history: records new exceptions and material changes, resolves exceptions whose condition has cleared, records recurrences (never reopening on its own) and marks unresolved exceptions stale after ${STALE_DAYS} days without activity.`,
  watches: [],
  interval_minutes: 60,
  defaults: {},
  actions: 'Writes lifecycle states and their append-only history. Never deletes, never dismisses, never reopens, never touches the approval or record behind an exception.',
  human_in_loop: 'Acknowledging, waiting, resolving, dismissing and reopening are Owner actions; NW OS only records what it observes.',
  evaluate: async (rc): Promise<PlannedAction[]> => {
    const ctx = await ownerContext(rc.pool);
    if (ctx) await syncExceptionLifecycle(rc.pool, ctx, rc.now);
    return [];
  },
};

/**
 * GET /api/owner/exceptions: the live exceptions with their lifecycle. Resolved / dismissed
 * non-critical exceptions move to `closed`; a critical one is never hidden (it stays listed,
 * marked resolved, while its condition is present). Stale ones stay in the list, marked stale.
 * Optional ?state= filters every list to one lifecycle state. Reading writes nothing.
 */
export async function ownerExceptionCenter(pool: Pool, ctx: Ctx, now = new Date(), query: { state?: unknown } = {}) {
  const base = await ownerExceptions(pool, ctx, now);
  const state = typeof query.state === 'string' && query.state ? query.state : undefined;
  if (state && !(STATES as readonly string[]).includes(state)) throw new ValidationError(`state must be one of ${STATES.join(', ')}`);
  const rows = await lifecycleRows(pool, [...base.exceptions, ...base.snoozed].map((e) => e.id));
  const life = (key: string) => {
    const r = rows.get(key);
    return r
      ? { state: r.state as LifecycleStateName, state_changed_at: new Date(r.state_changed_at).toISOString(), last_activity_at: new Date(r.last_activity_at).toISOString(), waiting_for: r.waiting_for ?? null, present: true, tracked: true, critical_locked: Boolean(r.critical_locked), critical_locked_at: r.critical_locked_at ? new Date(r.critical_locked_at).toISOString() : null }
      : { state: 'active' as LifecycleStateName, state_changed_at: null, last_activity_at: null, waiting_for: null, present: true, tracked: false, critical_locked: false, critical_locked_at: null as string | null };
  };
  const withLife = <T extends OwnerException>(e: T) => ({ ...e, lifecycle: { ...life(e.id), ...dismissibility(e.severity, rows.get(e.id)) } });
  const exceptions: ReturnType<typeof withLife<OwnerException>>[] = [];
  const closedLive: typeof exceptions = [];
  for (const e of base.exceptions) {
    const item = withLife(e);
    if (['resolved', 'dismissed'].includes(item.lifecycle.state) && e.severity !== 'critical') closedLive.push(item);
    else exceptions.push(item);
  }
  const snoozed = base.snoozed.map((e) => withLife(e));
  const liveIds = new Set([...base.exceptions, ...base.snoozed].map((e) => e.id));
  const closed = [
    ...closedLive.map((e) => ({ id: e.id, title: e.title, type: e.type, severity: e.severity, project_id: e.project_id, state: e.lifecycle.state, state_changed_at: e.lifecycle.state_changed_at, present: true })),
    ...(await closedExceptions(pool, ctx, now))
      .filter((r) => !liveIds.has(r.exception_key))
      .map((r) => ({ id: r.exception_key as string, title: r.title as string, type: r.exception_type as string, severity: r.severity as string, project_id: r.project_id as string | null, state: r.state as string, state_changed_at: new Date(r.state_changed_at).toISOString(), present: Boolean(r.present) })),
  ];
  const byState = <T extends { lifecycle?: { state: string }; state?: string }>(list: T[]) => (state ? list.filter((x) => (x.lifecycle?.state ?? x.state) === state) : list);
  const shown = byState(exceptions);
  const all = [...exceptions, ...snoozed];
  return {
    ...base,
    summary: {
      ...base.summary,
      critical: exceptions.filter((e) => e.severity === 'critical').length,
      urgent: exceptions.filter((e) => e.severity === 'urgent').length,
      attention: exceptions.filter((e) => e.severity === 'attention').length,
      lifecycle: Object.fromEntries(STATES.map((st) => [st, [...all.map((e) => e.lifecycle.state as string), ...closed.map((c) => c.state)].filter((x) => x === st).length])),
    },
    exceptions: shown,
    snoozed: byState(snoozed),
    closed: byState(closed),
    state_filter: state ?? null,
    stale_after_days: STALE_DAYS,
  };
}

