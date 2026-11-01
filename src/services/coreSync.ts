/**
 * Keeps the database-backed collections in NWContext (the core chain and every Phase 3
 * module, see syncedCollections.ts) in step with PostgreSQL when the server runs with
 * CORE_DATA_SOURCE=database. PostgreSQL is the source of truth; localStorage is a cache.
 *
 * - On load: the database's data replaces the browser's copy. The browser's own stored data
 *   (local mode) is first kept under nw_os_local_preserved_*, which sign-out does not remove.
 *   Only if the database is empty, the user may import and the server allows it
 *   (NWOS_BROWSER_IMPORT) is the browser's data validated and imported (never overwriting).
 * - After that: every change to these collections, from any screen or action, is diffed
 *   against the last saved state and written in one transaction; the server authorises
 *   every record and enforces the business rules.
 * - localStorage keeps working as the cache, and as the only store in local mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { coreApi, CoreApiError, dataApi, type SyncChanges, type SyncData } from './coreApi';
import { markCoreCacheFromDatabase, preserveLocalCoreData } from './authApi';
import { SYNCED_COLLECTIONS } from './syncedCollections';

export interface CoreSyncState {
  mode: 'checking' | 'local' | 'database';
  status: 'idle' | 'syncing' | 'synced' | 'error';
  message?: string;
  lastSyncedAt?: string;
}

type Rec = Record<string, unknown>;
type Setters = Record<string, (rows: never[]) => void>;

const BACKUP_PREFIX = 'nw_os_core_backup_';

/**
 * Collections whose stored figures the server derives from others: after a save that
 * touches any of the listed sources, the browser reloads them so it shows the server's
 * totals (e.g. committed cost after a PO is issued) instead of its own preview.
 */
const SERVER_DERIVED: { key: string; path: string; sources: string[] }[] = [
  {
    key: 'commercialBaselines',
    path: 'commercial-baselines',
    sources: ['projects', 'variations', 'purchaseOrders', 'projectCostLedger', 'commercialQuotations', 'commercialBaselines'],
  },
];
const MAX_BACKUPS = 3;
const DEBOUNCE_MS = 400;

const idOf = (collection: string) => SYNCED_COLLECTIONS.find((c) => c.key === collection)?.idField ?? 'id';
const pathOf = (collection: string) => SYNCED_COLLECTIONS.find((c) => c.key === collection)?.path ?? collection;
const key = (r: unknown) => JSON.stringify(r);

/** Records added or changed in `next`, and ids removed from `prev`, per collection. */
export function diffCoreData(prev: SyncData, next: SyncData): SyncChanges & { count: number } {
  const changes: SyncChanges & { count: number } = { upserts: {}, deletes: {}, count: 0 };
  for (const { key: c, idField } of SYNCED_COLLECTIONS) {
    if (!prev[c] || !next[c]) continue;
    const before = new Map(prev[c].map((r) => [String(r[idField]), key(r)]));
    const after = new Set(next[c].map((r) => String(r[idField])));
    const upserts = next[c].filter((r) => before.get(String(r[idField])) !== key(r));
    const deletes = [...before.keys()].filter((id) => !after.has(id));
    if (upserts.length) changes.upserts[c] = upserts;
    if (deletes.length) changes.deletes[c] = deletes;
    changes.count += upserts.length + deletes.length;
  }
  return changes;
}

type Change = { c: string; id: string; record?: Rec; deleted?: boolean };

/** Every string inside a record (nested objects and arrays included): the ids it may refer to. */
function referencedValues(value: unknown, out = new Set<string>(), depth = 0): Set<string> {
  if (typeof value === 'string') out.add(value);
  else if (depth < 4 && value && typeof value === 'object') {
    for (const v of Array.isArray(value) ? value : Object.values(value)) referencedValues(v, out, depth + 1);
  }
  return out;
}

/**
 * Splits a refused batch into groups that can be retried on their own. Two changes belong
 * together when either refers to the other's id (a production order and its work item, a
 * delivery and the items it carries, a record and the one it was deleted with): such a group is
 * retried as one atomic batch, never record by record. Only a change that refers to no other
 * change in the batch, and that none refers to, stands alone. Deleted records are judged by
 * their last saved content (`prev`).
 */
export function dependencyGroups(changes: SyncChanges, prev: SyncData): SyncChanges[] {
  const nodes: Change[] = [];
  for (const { key: c } of SYNCED_COLLECTIONS) {
    for (const record of changes.upserts[c] ?? []) nodes.push({ c, id: String(record[idOf(c)]), record });
    for (const id of changes.deletes[c] ?? []) {
      nodes.push({ c, id, deleted: true, record: (prev[c] ?? []).find((r) => String(r[idOf(c)]) === id) });
    }
  }
  const parent = nodes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };
  const byId = new Map<string, number[]>();
  nodes.forEach((n, i) => byId.set(n.id, [...(byId.get(n.id) ?? []), i]));
  for (const ids of byId.values()) for (const j of ids.slice(1)) union(ids[0], j);
  nodes.forEach((n, i) => {
    if (!n.record) return;
    for (const v of referencedValues(n.record)) for (const j of byId.get(v) ?? []) if (j !== i) union(i, j);
  });
  const groups = new Map<number, SyncChanges>();
  nodes.forEach((n, i) => {
    const g = groups.get(find(i)) ?? { upserts: {}, deletes: {} };
    if (n.deleted) (g.deletes[n.c] ??= []).push(n.id);
    else (g.upserts[n.c] ??= []).push(n.record!);
    groups.set(find(i), g);
  });
  return [...groups.values()];
}

const describeGroup = (g: SyncChanges) =>
  [
    ...Object.entries(g.upserts).flatMap(([c, rows]) => rows.map((r) => `${c} ${String(r[idOf(c)])}`)),
    ...Object.entries(g.deletes).flatMap(([c, ids]) => ids.map((id) => `delete ${c} ${id}`)),
  ].join(' + ');

/** What a business operation (commit) came to: saved, or refused / not confirmed. */
export type CommitResult =
  | { ok: true }
  | {
      ok: false;
      /** The server's answer is unknown (network failure, 5xx): retrying the same operation is safe and creates no duplicate. */
      uncertain: boolean;
      message: string;
    };

const isEmpty = (d: SyncData) => SYNCED_COLLECTIONS.every((c) => !d[c.key]?.length);

function backupLocal(data: SyncData) {
  try {
    localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}`, JSON.stringify(data));
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(BACKUP_PREFIX))
      .sort();
    keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS)).forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.error('[sync] could not back up local data', err);
  }
}

/** Returns `snapshot` with one record upserted or removed. */
function patchSnapshot(snapshot: SyncData, c: string, id: string, record?: Rec): SyncData {
  const field = idOf(c);
  const rows = (snapshot[c] ?? []).filter((r) => String(r[field]) !== id);
  return { ...snapshot, [c]: record ? [...rows, record] : rows };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export interface CoreSyncOptions {
  /** Whether this user may import local data into an empty database (settings.manage). */
  canImport?: boolean;
  /** Whether this user may read a server-derived collection (e.g. baselines need commercial.view). */
  canRead?: (collection: string) => boolean;
}

export function useCoreDatabaseSync(data: SyncData, setters: Setters, { canImport = true, canRead }: CoreSyncOptions = {}) {
  const canReadRef = useRef(canRead);
  canReadRef.current = canRead;
  const [state, setState] = useState<CoreSyncState>({ mode: 'checking', status: 'idle' });
  const latest = useRef(data);
  latest.current = data;
  const saved = useRef<SyncData | null>(null);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback(
    (snap: SyncData) => {
      // Only collections the page manages; set `saved` first so the state change diffs as "no changes".
      const managed: SyncData = {};
      for (const { key: c } of SYNCED_COLLECTIONS) if (setters[c]) managed[c] = snap[c] ?? [];
      saved.current = managed;
      for (const [c, rows] of Object.entries(managed)) setters[c](rows as never[]);
    },
    [setters]
  );

  const hydrate = useCallback(async () => {
    let snap = await dataApi.snapshot();
    // With sign-in, the snapshot only holds what this user may see, so "empty" must come
    // from the server; and only users allowed to import may seed the database, only when the
    // server allows browser imports (NWOS_BROWSER_IMPORT; never assumed if it does not say).
    const status = await dataApi.status().catch(() => undefined);
    const empty = status?.databaseEmpty ?? isEmpty(snap);
    // The browser's own stored data is kept (nw_os_local_preserved_*) before the database's
    // replaces it, whether or not it is imported.
    preserveLocalCoreData();
    if (empty && canImport && status?.importAllowed === true) {
      const local = latest.current;
      const check = await dataApi.importData(local, { dryRun: true });
      if (!check.ok) {
        setState({
          mode: 'local',
          status: 'error',
          message: `Database is empty and local data could not be imported: ${check.problems.slice(0, 3).join('; ')}`,
        });
        return;
      }
      await dataApi.importData(local);
      snap = await dataApi.snapshot();
    } else if (diffCoreData(snap, latest.current).count > 0) {
      // Not imported (data already there, no permission, or imports switched off): the
      // database is shown as it is, even when empty.
      backupLocal(latest.current);
    }
    apply(snap);
    markCoreCacheFromDatabase();
    setState({ mode: 'database', status: 'synced', lastSyncedAt: new Date().toISOString() });
  }, [apply, canImport]);

  /**
   * Writes the batch. If the server refuses it, the batch is split only into groups of changes
   * that do not refer to each other (dependencyGroups); each group is retried as one atomic
   * batch, so a dependent operation is never saved in part. A batch that is one group is not
   * retried.
   */
  const write = useCallback(async (changes: SyncChanges, next: SyncData) => {
    try {
      await dataApi.sync(changes);
      saved.current = { ...saved.current, ...Object.fromEntries(Object.keys(saved.current ?? {}).map((c) => [c, next[c]])) };
      return [];
    } catch (err) {
      if (!(err instanceof CoreApiError) || err.status >= 500) throw err;
      const groups = dependencyGroups(changes, saved.current ?? {});
      if (groups.length === 1) return [`${describeGroup(groups[0])}: ${errorText(err)}`];
    }
    const failures: string[] = [];
    for (const group of dependencyGroups(changes, saved.current ?? {})) {
      try {
        await dataApi.sync(group);
        for (const [c, rows] of Object.entries(group.upserts)) for (const r of rows) saved.current = patchSnapshot(saved.current!, c, String(r[idOf(c)]), r);
        for (const [c, ids] of Object.entries(group.deletes)) for (const id of ids) saved.current = patchSnapshot(saved.current!, c, id);
      } catch (err) {
        failures.push(`${describeGroup(group)}: ${errorText(err)}`);
      }
    }
    return failures;
  }, []);

  const refreshDerived = useCallback(
    async (changes: SyncChanges) => {
      for (const d of SERVER_DERIVED) {
        if (!setters[d.key] || !saved.current || canReadRef.current?.(d.key) === false) continue;
        if (!d.sources.some((c) => changes.upserts[c] || changes.deletes[c])) continue;
        try {
          const rows = await dataApi.list(d.path);
          const field = idOf(d.key);
          // Skip if the user has unsaved edits to this collection; the next save refreshes it.
          const pending = diffCoreData({ [d.key]: saved.current[d.key] ?? [] }, { [d.key]: latest.current[d.key] ?? [] }).count;
          if (pending || !saved.current) continue;
          const order = new Map((latest.current[d.key] ?? []).map((r, i) => [String(r[field]), i]));
          rows.sort((a, b) => (order.get(String(a[field])) ?? 1e9) - (order.get(String(b[field])) ?? 1e9));
          saved.current = { ...saved.current, [d.key]: rows };
          setters[d.key](rows as never[]);
        } catch {
          // Not allowed to read it, or offline: keep what is shown.
        }
      }
    },
    [setters]
  );

  const flush = useCallback(async () => {
    if (!saved.current) return;
    if (inFlight.current) {
      rerun.current = true;
      return;
    }
    const next = latest.current;
    const changes = diffCoreData(saved.current, next);
    if (changes.count === 0) return;
    inFlight.current = true;
    setState((s) => ({ ...s, status: 'syncing' }));
    try {
      const failures = await write(changes, next);
      // A refused change must not stay pending and slip through on a later save (e.g. once a
      // blocking rule no longer applies): show the database's state again, unless the user
      // has edited since this save started (the next save will then run anyway).
      if (failures.length && diffCoreData(next, latest.current).count === 0) apply(await dataApi.snapshot());
      else if (!failures.length) await refreshDerived(changes);
      setState((s) =>
        failures.length
          ? { ...s, status: 'error', message: `${failures.length} change(s) not saved: ${failures[0]}` }
          : { ...s, status: 'synced', message: undefined, lastSyncedAt: new Date().toISOString() }
      );
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', message: `Sync failed: ${errorText(err)}` }));
    } finally {
      inFlight.current = false;
      if (rerun.current) {
        rerun.current = false;
        void flush();
      }
    }
  }, [write, refreshDerived]);

  // Decide the mode once on load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const status = await coreApi.status();
        if (cancelled) return;
        if (status.dataSource !== 'database') {
          setState({ mode: 'local', status: 'idle' });
          return;
        }
        await hydrate();
      } catch (err) {
        if (!cancelled) setState({ mode: 'local', status: 'error', message: `Database unavailable: ${errorText(err)}` });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrate]);

  // Any change to a synced collection, from any action, is written after a short debounce.
  const watched = SYNCED_COLLECTIONS.map((c) => data[c.key]);
  useEffect(() => {
    if (state.mode !== 'database') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.mode, flush, ...watched]);

  // A refresh or tab close inside the debounce window must not drop the last edit.
  useEffect(() => {
    if (state.mode !== 'database') return;
    const onHide = () => {
      if (!saved.current || inFlight.current) return;
      const changes = diffCoreData(saved.current, latest.current);
      if (changes.count === 0) return;
      const body = new Blob([JSON.stringify({ upserts: changes.upserts, deletes: changes.deletes })], {
        type: 'application/json',
      });
      if (navigator.sendBeacon?.('/api/data/sync', body)) saved.current = latest.current;
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [state.mode]);

  /**
   * Puts records the server returned (after a direct API action) into the app, as saved:
   * merged by id, or replacing the whole collection. Unsaved local edits to other records
   * of the collection are kept.
   */
  const applyRows = useCallback(
    (collection: string, rows: Rec[], { replace = false } = {}) => {
      if (!setters[collection]) return;
      const field = idOf(collection);
      const merge = (current: Rec[] | undefined) => {
        if (replace) return rows;
        const byId = new Map(rows.map((r) => [String(r[field]), r]));
        const kept = (current ?? []).map((r) => byId.get(String(r[field])) ?? r);
        const known = new Set(kept.map((r) => String(r[field])));
        return [...rows.filter((r) => !known.has(String(r[field]))), ...kept];
      };
      if (saved.current) saved.current = { ...saved.current, [collection]: merge(saved.current[collection]) };
      setters[collection](merge(latest.current[collection]) as never[]);
    },
    [setters]
  );

  const reloadFromDatabase = useCallback(async () => {
    try {
      apply(await dataApi.snapshot());
      setState({ mode: 'database', status: 'synced', lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', message: `Reload failed: ${errorText(err)}` }));
    }
  }, [apply]);

  // Records whose last commit got no clear answer (network failure, 5xx): "collection:id".
  const unconfirmed = useRef(new Set<string>());

  /**
   * Saves one business operation (e.g. a production order, a delivery and the items it carries)
   * as a single atomic batch: never split, never retried record by record, and nothing is shown
   * as saved until the server confirms it. On success the server's own versions of the records
   * (and of `refresh`, the records the server updates alongside) replace the app's. If the last
   * attempt's outcome was unknown, the server is asked first whether the records exist, so
   * submitting again never creates a duplicate. `localOnly` is applied too when there is no
   * database (local mode), for links the server makes itself.
   */
  const commit = useCallback(
    async (op: { upserts: Record<string, Rec[]>; refresh?: Record<string, string[]>; localOnly?: Record<string, Rec[]> }): Promise<CommitResult> => {
      const entries = Object.entries(op.upserts).filter(([, rows]) => rows.length);
      if (state.mode !== 'database') {
        for (const [c, rows] of [...entries, ...Object.entries(op.localOnly ?? {})]) applyRows(c, rows);
        return { ok: true };
      }
      const keys = entries.flatMap(([c, rows]) => rows.map((r) => `${c}:${String(r[idOf(c)])}`));
      const fetchOne = (c: string, id: string) => dataApi.get<Rec>(pathOf(c), id);
      // Let a debounced save that is already running finish: the operation is its own batch.
      while (inFlight.current) await new Promise((r) => setTimeout(r, 25));
      inFlight.current = true;
      try {
        let alreadySaved = false;
        if (keys.some((k) => unconfirmed.current.has(k))) {
          const found = await Promise.all(entries.flatMap(([c, rows]) => rows.map((r) => fetchOne(c, String(r[idOf(c)])).then(() => true, () => false))));
          alreadySaved = found.every(Boolean);
        }
        if (!alreadySaved) await dataApi.sync({ upserts: Object.fromEntries(entries), deletes: {} });
        keys.forEach((k) => unconfirmed.current.delete(k));
      } catch (err) {
        const uncertain = !(err instanceof CoreApiError) || err.status >= 500;
        keys.forEach((k) => (uncertain ? unconfirmed.current.add(k) : unconfirmed.current.delete(k)));
        return {
          ok: false,
          uncertain,
          message: uncertain ? `The server did not confirm the save (${errorText(err)}). Try again: it will not create a duplicate.` : errorText(err),
        };
      } finally {
        inFlight.current = false;
        if (rerun.current) {
          rerun.current = false;
          void flush();
        }
      }
      const reload = async (c: string, ids: string[], sent: Rec[] = []) => {
        const rows = await Promise.all(ids.map((id) => fetchOne(c, id).catch(() => sent.find((r) => String(r[idOf(c)]) === id))));
        applyRows(c, rows.filter(Boolean) as Rec[]);
      };
      for (const [c, rows] of entries) await reload(c, rows.map((r) => String(r[idOf(c)])), rows);
      for (const [c, ids] of Object.entries(op.refresh ?? {})) if (ids.length) await reload(c, ids);
      setState((s) => ({ ...s, status: 'synced', message: undefined, lastSyncedAt: new Date().toISOString() }));
      return { ok: true };
    },
    [state.mode, applyRows, flush]
  );

  return { ...state, reloadFromDatabase, applyRows, commit };
}
