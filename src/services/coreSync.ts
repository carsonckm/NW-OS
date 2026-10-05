/**
 * Keeps the database-backed collections in NWContext (the core chain and every Phase 3
 * module, see syncedCollections.ts) in step with PostgreSQL when the server runs with
 * CORE_DATA_SOURCE=database. PostgreSQL is the source of truth; localStorage is a cache.
 *
 * - On load: if the database has data, it replaces the browser's copy (the browser's
 *   previous copy is backed up in localStorage first). If the database is empty and the
 *   user may import, the browser's data is validated and imported (never overwriting).
 * - After that: every change to these collections, from any screen or action, is diffed
 *   against the last saved state and written in one transaction; the server authorises
 *   every record and enforces the business rules.
 * - localStorage keeps working as the cache, and as the only store in local mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { coreApi, CoreApiError, dataApi, type SyncChanges, type SyncData } from './coreApi';
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
    // from the server; and only users allowed to import may seed the database.
    const empty = (await dataApi.status().catch(() => undefined))?.databaseEmpty ?? isEmpty(snap);
    if (empty && canImport) {
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
    } else if (!empty && diffCoreData(snap, latest.current).count > 0) {
      backupLocal(latest.current);
    }
    apply(snap);
    setState({ mode: 'database', status: 'synced', lastSyncedAt: new Date().toISOString() });
  }, [apply, canImport]);

  /** Writes the batch; if it is rejected, retries record by record so one bad change can't block the rest. */
  const write = useCallback(async (changes: SyncChanges, next: SyncData) => {
    try {
      await dataApi.sync(changes);
      saved.current = { ...saved.current, ...Object.fromEntries(Object.keys(saved.current ?? {}).map((c) => [c, next[c]])) };
      return [];
    } catch (err) {
      if (!(err instanceof CoreApiError) || err.status >= 500) throw err;
    }
    const failures: string[] = [];
    for (const { key: c } of SYNCED_COLLECTIONS) {
      for (const record of changes.upserts[c] ?? []) {
        const id = String(record[idOf(c)]);
        try {
          await dataApi.sync({ upserts: { [c]: [record] }, deletes: {} });
          saved.current = patchSnapshot(saved.current!, c, id, record);
        } catch (err) {
          failures.push(`${c} ${id}: ${errorText(err)}`);
        }
      }
    }
    for (const { key: c } of [...SYNCED_COLLECTIONS].reverse()) {
      for (const id of changes.deletes[c] ?? []) {
        try {
          await dataApi.sync({ upserts: {}, deletes: { [c]: [id] } });
          saved.current = patchSnapshot(saved.current!, c, id);
        } catch (err) {
          failures.push(`delete ${c} ${id}: ${errorText(err)}`);
        }
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

  const reloadFromDatabase = useCallback(async () => {
    try {
      apply(await dataApi.snapshot());
      setState({ mode: 'database', status: 'synced', lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', message: `Reload failed: ${errorText(err)}` }));
    }
  }, [apply]);

  return { ...state, reloadFromDatabase };
}
