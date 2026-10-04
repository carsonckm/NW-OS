/**
 * Keeps the core chain (clients, projects, work packages, work items) in NWContext
 * in step with the database when the server runs with CORE_DATA_SOURCE=database.
 *
 * - On load: if the database has core data, it replaces the browser's copy (the
 *   browser's previous copy is backed up in localStorage first). If the database is
 *   empty, the browser's data is validated and imported (existing rows never overwritten).
 * - After that: every change to the four arrays, from any screen or action, is diffed
 *   against the last saved state and written in one transaction.
 * - localStorage keeps working as the cache, and as the only store in local mode.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { CORE_COLLECTIONS, coreApi, CoreApiError, type CoreChanges, type CoreCollection, type CoreData } from './coreApi';

export interface CoreSyncState {
  mode: 'checking' | 'local' | 'database';
  status: 'idle' | 'syncing' | 'synced' | 'error';
  message?: string;
  lastSyncedAt?: string;
}

type Setters = { [K in CoreCollection]: (rows: CoreData[K]) => void };
type AnyRecord = { id: string };

const BACKUP_PREFIX = 'nw_os_core_backup_';
const MAX_BACKUPS = 3;
const DEBOUNCE_MS = 400;

const key = (r: unknown) => JSON.stringify(r);

/** Records added or changed in `next`, and ids removed from `prev`. */
export function diffCoreData(prev: CoreData, next: CoreData): CoreChanges & { count: number } {
  const changes: CoreChanges & { count: number } = { upserts: {}, deletes: {}, count: 0 };
  for (const c of CORE_COLLECTIONS) {
    const before = new Map((prev[c] as AnyRecord[]).map((r) => [r.id, key(r)]));
    const after = new Set((next[c] as AnyRecord[]).map((r) => r.id));
    const upserts = (next[c] as AnyRecord[]).filter((r) => before.get(r.id) !== key(r));
    const deletes = [...before.keys()].filter((id) => !after.has(id));
    if (upserts.length) (changes.upserts as Record<string, AnyRecord[]>)[c] = upserts;
    if (deletes.length) changes.deletes[c] = deletes;
    changes.count += upserts.length + deletes.length;
  }
  return changes;
}

const isEmpty = (d: CoreData) => CORE_COLLECTIONS.every((c) => d[c].length === 0);

function backupLocal(data: CoreData) {
  try {
    localStorage.setItem(`${BACKUP_PREFIX}${new Date().toISOString()}`, JSON.stringify(data));
    const keys = Object.keys(localStorage)
      .filter((k) => k.startsWith(BACKUP_PREFIX))
      .sort();
    keys.slice(0, Math.max(0, keys.length - MAX_BACKUPS)).forEach((k) => localStorage.removeItem(k));
  } catch (err) {
    console.error('[core sync] could not back up local data', err);
  }
}

/** Returns `snapshot` with one record upserted or removed. */
function patchSnapshot(snapshot: CoreData, c: CoreCollection, id: string, record?: AnyRecord): CoreData {
  const rows = (snapshot[c] as AnyRecord[]).filter((r) => r.id !== id);
  return { ...snapshot, [c]: record ? [...rows, record] : rows };
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export function useCoreDatabaseSync(data: CoreData, setters: Setters) {
  const [state, setState] = useState<CoreSyncState>({ mode: 'checking', status: 'idle' });
  const latest = useRef(data);
  latest.current = data;
  const saved = useRef<CoreData | null>(null);
  const inFlight = useRef(false);
  const rerun = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const apply = useCallback(
    (snap: CoreData) => {
      saved.current = snap; // set first, so the state change below diffs as "no changes"
      setters.clients(snap.clients);
      setters.projects(snap.projects);
      setters.workPackages(snap.workPackages);
      setters.workItems(snap.workItems);
    },
    [setters]
  );

  const hydrate = useCallback(async () => {
    let snap = await coreApi.snapshot();
    if (isEmpty(snap)) {
      const local = latest.current;
      const check = await coreApi.importData(local, { dryRun: true });
      if (!check.ok) {
        setState({
          mode: 'local',
          status: 'error',
          message: `Database is empty and local data could not be imported: ${check.problems.slice(0, 3).join('; ')}`,
        });
        return;
      }
      await coreApi.importData(local);
      snap = await coreApi.snapshot();
    } else if (diffCoreData(snap, latest.current).count > 0) {
      backupLocal(latest.current);
    }
    apply(snap);
    setState({ mode: 'database', status: 'synced', lastSyncedAt: new Date().toISOString() });
  }, [apply]);

  /** Writes the batch; if it is rejected, retries record by record so one bad change can't block the rest. */
  const write = useCallback(async (changes: CoreChanges, next: CoreData) => {
    try {
      await coreApi.sync(changes);
      saved.current = next;
      return [];
    } catch (err) {
      if (!(err instanceof CoreApiError) || err.status >= 500) throw err;
    }
    const failures: string[] = [];
    for (const c of CORE_COLLECTIONS) {
      for (const record of (changes.upserts[c] ?? []) as AnyRecord[]) {
        try {
          await coreApi.sync({ upserts: { [c]: [record] }, deletes: {} });
          saved.current = patchSnapshot(saved.current!, c, record.id, record);
        } catch (err) {
          failures.push(`${c} ${record.id}: ${errorText(err)}`);
        }
      }
    }
    for (const c of [...CORE_COLLECTIONS].reverse()) {
      for (const id of changes.deletes[c] ?? []) {
        try {
          await coreApi.sync({ upserts: {}, deletes: { [c]: [id] } });
          saved.current = patchSnapshot(saved.current!, c, id);
        } catch (err) {
          failures.push(`delete ${c} ${id}: ${errorText(err)}`);
        }
      }
    }
    return failures;
  }, []);

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
  }, [write]);

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

  // Any change to the core arrays, from any action, is written after a short debounce.
  useEffect(() => {
    if (state.mode !== 'database') return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [state.mode, data.clients, data.projects, data.workPackages, data.workItems, flush]);

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
      if (navigator.sendBeacon?.('/api/core/sync', body)) saved.current = latest.current;
    };
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [state.mode]);

  const reloadFromDatabase = useCallback(async () => {
    try {
      apply(await coreApi.snapshot());
      setState({ mode: 'database', status: 'synced', lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      setState((s) => ({ ...s, status: 'error', message: `Reload failed: ${errorText(err)}` }));
    }
  }, [apply]);

  return { ...state, reloadFromDatabase };
}
