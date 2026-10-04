// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CLIENTS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../data/initialData';
import type { CoreData, SyncData } from './coreApi';

const asSync = (d: CoreData) => d as unknown as SyncData;
import { diffCoreData, useCoreDatabaseSync } from './coreSync';

const demo = (): CoreData => ({
  clients: structuredClone(INITIAL_CLIENTS),
  projects: structuredClone(INITIAL_PROJECTS),
  workPackages: structuredClone(INITIAL_WORK_PACKAGES),
  workItems: structuredClone(INITIAL_WORK_ITEMS),
});
const empty = (): CoreData => ({ clients: [], projects: [], workPackages: [], workItems: [] });

describe('diffCoreData', () => {
  it('finds added, changed and removed records per collection', () => {
    const prev = demo();
    const next = demo();
    next.workItems[0] = { ...next.workItems[0], status: 'Completed' };
    next.clients = next.clients.slice(1);
    next.projects.push({ ...next.projects[0], id: 'proj-new' });

    const diff = diffCoreData(asSync(prev), asSync(next));
    expect(diff.upserts.workItems?.map((w) => w.id)).toEqual([prev.workItems[0].id]);
    expect(diff.upserts.projects?.map((p) => p.id)).toEqual(['proj-new']);
    expect(diff.deletes.clients).toEqual([prev.clients[0].id]);
    expect(diff.count).toBe(3);
  });

  it('reports nothing for identical data', () => {
    expect(diffCoreData(asSync(demo()), asSync(demo())).count).toBe(0);
  });
});

describe('useCoreDatabaseSync', () => {
  type Route = (body: unknown, url: string) => { status?: number; body?: unknown };
  let routes: Record<string, Route>;
  let calls: { url: string; body: unknown }[];

  beforeEach(() => {
    localStorage.clear();
    calls = [];
    routes = {};
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = init?.body ? JSON.parse(init.body as string) : undefined;
        calls.push({ url, body });
        const route = routes[url.split('?')[0]];
        const out = route ? route(body, url) : { status: 404, body: { error: 'not_found' } };
        return new Response(JSON.stringify(out.body ?? {}), { status: out.status ?? 200 });
      })
    );
  });
  afterEach(() => {
    cleanup(); // unmount hooks so an earlier test's sync can't fire into the next one
    vi.unstubAllGlobals();
  });

  const setup = (initial: CoreData) => {
    const setters = { clients: vi.fn(), projects: vi.fn(), workPackages: vi.fn(), workItems: vi.fn() };
    const hook = renderHook(({ data }) => useCoreDatabaseSync(asSync(data), setters), { initialProps: { data: initial } });
    return { hook, setters };
  };

  it('stays in local mode when the server says so', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'local' } });
    const { hook, setters } = setup(demo());
    await waitFor(() => expect(hook.result.current.mode).toBe('local'));
    expect(setters.clients).not.toHaveBeenCalled();
  });

  it('falls back to local mode when the API is unreachable', async () => {
    routes['/api/core/status'] = () => ({ status: 500, body: { error: 'boom', message: 'boom' } });
    const { hook } = setup(demo());
    await waitFor(() => expect(hook.result.current.mode).toBe('local'));
    expect(hook.result.current.status).toBe('error');
  });

  it('loads database data over local data and backs the local copy up', async () => {
    const dbData = demo();
    dbData.clients[0].company_name = 'From the database';
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/snapshot'] = () => ({ body: dbData });

    const { hook, setters } = setup(demo());
    await waitFor(() => expect(hook.result.current.mode).toBe('database'));
    expect(setters.clients).toHaveBeenCalledWith(dbData.clients);
    expect(Object.keys(localStorage).some((k) => k.startsWith('nw_os_core_backup_'))).toBe(true);
    expect(calls.some((c) => c.url.startsWith('/api/data/import'))).toBe(false);
  });

  it('imports local data when the database is empty', async () => {
    let imported = false;
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/snapshot'] = () => ({ body: imported ? demo() : empty() });
    routes['/api/data/import'] = (_b, url) => {
      if (!url.includes('dryRun')) imported = true;
      return { body: { ok: true, problems: [] } };
    };

    const { hook } = setup(demo());
    await waitFor(() => expect(hook.result.current.mode).toBe('database'));
    const importCalls = calls.filter((c) => c.url.startsWith('/api/data/import'));
    expect(importCalls.map((c) => c.url)).toEqual(['/api/data/import?dryRun=true', '/api/data/import']);
  });

  it('does not import when the database has data the user simply cannot see', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/status'] = () => ({ body: { databaseEmpty: false } });
    routes['/api/data/snapshot'] = () => ({ body: empty() }); // scoped view, e.g. a Contractor

    const { hook, setters } = setup(demo());
    await waitFor(() => expect(hook.result.current.mode).toBe('database'));
    expect(calls.some((c) => c.url.startsWith('/api/data/import'))).toBe(false);
    expect(setters.workItems).toHaveBeenCalledWith([]);
  });

  it('never imports for a user without the import permission', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/status'] = () => ({ body: { databaseEmpty: true } });
    routes['/api/data/snapshot'] = () => ({ body: empty() });
    const setters = { clients: vi.fn(), projects: vi.fn(), workPackages: vi.fn(), workItems: vi.fn() };
    const hook = renderHook(() => useCoreDatabaseSync(asSync(demo()), setters, { canImport: false }));

    await waitFor(() => expect(hook.result.current.mode).toBe('database'));
    expect(calls.some((c) => c.url.startsWith('/api/data/import'))).toBe(false);
  });

  it('does not import, and stays local, when local data fails validation', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/snapshot'] = () => ({ body: empty() });
    routes['/api/data/import'] = () => ({ status: 422, body: { ok: false, problems: ['projects p1: client_id "x" not found'] } });

    const { hook } = setup(demo());
    await waitFor(() => expect(hook.result.current.status).toBe('error'));
    expect(hook.result.current.mode).toBe('local');
    expect(calls.filter((c) => c.url === '/api/data/import')).toHaveLength(0);
  });

  it('writes only the changed records after an edit', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/snapshot'] = () => ({ body: demo() });
    routes['/api/data/sync'] = () => ({ body: { upserted: 1, deleted: 0 } });

    const initial = demo();
    const { hook } = setup(initial);
    await waitFor(() => expect(hook.result.current.mode).toBe('database'));

    const edited = { ...initial, workItems: initial.workItems.map((w, i) => (i === 0 ? { ...w, status: 'Completed' as const } : w)) };
    act(() => hook.rerender({ data: edited }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/data/sync')).toBe(true));

    const sync = calls.find((c) => c.url === '/api/data/sync')!.body as { upserts: CoreData };
    expect(sync.upserts.workItems.map((w) => w.id)).toEqual([initial.workItems[0].id]);
    expect(sync.upserts.clients).toBeUndefined();
    await waitFor(() => expect(hook.result.current.status).toBe('synced'));
  });

  it('retries record by record when a batch is rejected, saving what it can', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/snapshot'] = () => ({ body: demo() });
    // Any batch containing a client delete is refused (the client still has projects).
    routes['/api/data/sync'] = (body) =>
      (body as { deletes: { clients?: string[] } }).deletes?.clients?.length
        ? { status: 409, body: { error: 'foreign_key_violation', message: 'still referenced' } }
        : { body: { upserted: 1, deleted: 0 } };

    const initial = demo();
    const { hook } = setup(initial);
    await waitFor(() => expect(hook.result.current.mode).toBe('database'));

    const edited = {
      ...initial,
      clients: initial.clients.slice(1),
      workItems: initial.workItems.map((w, i) => (i === 0 ? { ...w, progress_percent: 99 } : w)),
    };
    act(() => hook.rerender({ data: edited }));
    await waitFor(() => expect(hook.result.current.status).toBe('error'));

    const singleItemWrite = calls.find(
      (c) => c.url === '/api/data/sync' && (c.body as { upserts: CoreData }).upserts.workItems?.length === 1 &&
        !(c.body as { deletes: { clients?: string[] } }).deletes.clients
    );
    expect(singleItemWrite).toBeDefined();
    expect(hook.result.current.message).toMatch(/1 change\(s\) not saved: delete clients/);
    // The refused delete isn't left pending: the database's state is loaded again.
    expect(calls.filter((c) => c.url === '/api/data/snapshot')).toHaveLength(2);
  });
});
