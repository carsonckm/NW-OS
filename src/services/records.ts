/**
 * Writes for the Phase 4 operational screens. In database mode every create, update and
 * workflow action goes straight to the server, which checks permissions and business rules;
 * the record the server returns is put into the app as saved, and a refusal comes back as
 * an ActionError the form shows next to the action (no silent revert). In demo mode simple
 * creates and edits stay in the browser; server-only workflow actions are unavailable.
 */
import { useMemo } from 'react';
import { useNW } from '../context/NWContext';
import { api, CoreApiError } from './coreApi';
import { COLLECTION_BY_KEY } from './syncedCollections';

type Rec = Record<string, unknown>;

export class ActionError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

export const NEEDS_DATABASE = 'This action needs the NW OS database (sign in to the live system). Demo mode cannot run it.';

/** A readable message for a failed call; never a stack trace. */
export function actionErrorOf(err: unknown): ActionError {
  if (err instanceof ActionError) return err;
  if (err instanceof CoreApiError) {
    if (err.status === 401) return new ActionError('Your session has ended. Sign in again.', 401);
    if (err.status === 404) return new ActionError(`Not found, or not available to you. ${err.message}`.trim(), 404);
    if (err.status === 409) return new ActionError('This conflicts with existing records (for example a missing or duplicate reference).', 409);
    return new ActionError(err.message || 'The server refused this change.', err.status);
  }
  return new ActionError('Could not reach the server. Check the connection and try again.');
}

function pathOf(collection: string) {
  const c = COLLECTION_BY_KEY.get(collection);
  if (!c) throw new ActionError(`Unknown collection ${collection}`);
  return c;
}

export function useRecords() {
  const { coreDataSync } = useNW();
  const live = coreDataSync.mode === 'database';
  const { applyRows } = coreDataSync;

  return useMemo(() => {
    const guard = async <T,>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch (err) {
        throw actionErrorOf(err);
      }
    };
    return {
      live,
      /** Creates a record. The server's stored version (ids, derived fields) is returned. */
      create: <T extends object>(collection: string, record: T) =>
        guard(async () => {
          const c = pathOf(collection);
          if (!live) {
            applyRows(collection, [record as unknown as Rec]);
            return record as T & Rec;
          }
          const stored = await api.post<T & Rec>(`/${c.path}`, record);
          applyRows(collection, [stored]);
          return stored;
        }),
      /** Updates fields of a record; the server checks who may change what. */
      update: <T extends object>(collection: string, id: string, patch: Partial<T>, current?: T) =>
        guard(async () => {
          const c = pathOf(collection);
          if (!live) {
            const merged = { ...(current ?? {}), ...patch, [c.idField]: id } as unknown as T & Rec;
            applyRows(collection, [merged]);
            return merged;
          }
          const stored = await api.patch<T & Rec>(`/${c.path}/${encodeURIComponent(id)}`, patch);
          applyRows(collection, [stored]);
          return stored;
        }),
      /**
       * A server workflow action (transition, convert, decide...). `apply` names the
       * collection the returned record belongs to; `refresh` reloads whole collections the
       * action changed.
       */
      action: <T,>(path: string, body: unknown, opts: { apply?: string; refresh?: string[] } = {}) =>
        guard(async () => {
          if (!live) throw new ActionError(NEEDS_DATABASE);
          const result = await api.post<T>(path, body);
          if (opts.apply && result && typeof result === 'object') applyRows(opts.apply, [result as Rec]);
          for (const c of opts.refresh ?? []) {
            applyRows(c, await api.get<Rec[]>(`/${pathOf(c).path}`), { replace: true });
          }
          return result;
        }),
      /** Reloads collections from the server. */
      refresh: (...collections: string[]) =>
        guard(async () => {
          if (!live) return;
          for (const c of collections) applyRows(c, await api.get<Rec[]>(`/${pathOf(c).path}`), { replace: true });
        }),
    };
  }, [live, applyRows]);
}
