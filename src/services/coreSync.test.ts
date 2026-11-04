// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CLIENTS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../data/initialData';
import type { CoreData, SyncData } from './coreApi';

const asSync = (d: CoreData) => d as unknown as SyncData;
import { dependencyGroups, diffCoreData, operationId, settleOperation, useCoreDatabaseSync } from './coreSync';
import { clearCoreCache, PRESERVED_LOCAL_PREFIX } from './authApi';
import { REQUEST_TIMEOUT_MS } from './requestDeadline';

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

describe('dependencyGroups (QA batch 1: which refused changes may be retried on their own)', () => {
  const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, project_id: 'proj-1', work_package_id: 'wp-1', item_code: id, ...extra });
  const ids = (groups: ReturnType<typeof dependencyGroups>) =>
    groups
      .map((g) => [...Object.entries(g.upserts).flatMap(([c, rows]) => rows.map((r) => `${c}:${String(r.id)}`)), ...Object.entries(g.deletes).flatMap(([c, d]) => d.map((x) => `-${c}:${x}`))].sort())
      .sort((a, b) => a[0].localeCompare(b[0]));

  it('keeps a production order and the work item that refers to it together', () => {
    const groups = dependencyGroups(
      { upserts: { productionOrders: [{ id: 'po-1', work_item_id: 'item-1' }], workItems: [item('item-1', { production_order_id: 'po-1' })] }, deletes: {} },
      {}
    );
    expect(ids(groups)).toEqual([['productionOrders:po-1', 'workItems:item-1']]);
  });

  it('keeps a delivery and every item it carries together (an array reference counts)', () => {
    const groups = dependencyGroups(
      { upserts: { deliveryRecords: [{ id: 'del-1', work_item_ids: ['item-1', 'item-2'] }], workItems: [item('item-1'), item('item-2'), item('item-3')] }, deletes: {} },
      {}
    );
    expect(ids(groups)).toEqual([['deliveryRecords:del-1', 'workItems:item-1', 'workItems:item-2'], ['workItems:item-3']]);
  });

  it('links a delete to the changes that refer to the deleted record or that it referred to', () => {
    const prev = { workItems: [item('item-9', { production_order_id: 'po-9' })] };
    const groups = dependencyGroups({ upserts: { productionOrders: [{ id: 'po-9', status: 'Cancelled' }], workItems: [item('item-1')] }, deletes: { workItems: ['item-9'] } }, prev);
    expect(ids(groups)).toEqual([['-workItems:item-9', 'productionOrders:po-9'], ['workItems:item-1']]);
  });

  it('finds references at any depth, and handles cyclic data', () => {
    let deep: Record<string, unknown> = { work_item_id: 'item-1' };
    for (let i = 0; i < 40; i++) deep = { level: i, child: [deep] };
    const cyclic: Record<string, unknown> = { id: 'iss-1', links: { order: 'po-1' } };
    (cyclic.links as Record<string, unknown>).self = cyclic;
    (cyclic.links as Record<string, unknown>).loop = [cyclic.links];
    const groups = dependencyGroups(
      { upserts: { issues: [{ id: 'iss-deep', nested: deep }, cyclic], workItems: [item('item-1'), item('item-2')], productionOrders: [{ id: 'po-1' }] }, deletes: {} },
      {}
    );
    expect(ids(groups)).toEqual([['issues:iss-1', 'productionOrders:po-1'], ['issues:iss-deep', 'workItems:item-1'], ['workItems:item-2']]);
  });

  it('separates only edits that refer to no other change in the batch (sharing a project or package is not a reference)', () => {
    const groups = dependencyGroups({ upserts: { workItems: [item('item-1'), item('item-2')], clients: [{ id: 'client-1', company_name: 'X' }] }, deletes: {} }, {});
    expect(ids(groups)).toEqual([['clients:client-1'], ['workItems:item-1'], ['workItems:item-2']]);
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
    routes['/api/data/status'] = () => ({ body: { databaseEmpty: true, importAllowed: true } });
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
    routes['/api/data/status'] = () => ({ body: { databaseEmpty: true, importAllowed: true } });
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

  it('never splits a refused dependent operation into record-by-record retries (QA batch 1)', async () => {
    routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
    routes['/api/data/snapshot'] = () => ({ body: demo() });
    routes['/api/data/sync'] = () => ({ status: 400, body: { error: 'validation_error', message: 'A production order needs an approved production method' } });

    const initial = demo();
    const setters = { clients: vi.fn(), projects: vi.fn(), workPackages: vi.fn(), workItems: vi.fn(), productionOrders: vi.fn() };
    const start = { ...asSync(initial), productionOrders: [] as Record<string, unknown>[] };
    const hook = renderHook(({ data }) => useCoreDatabaseSync(data, setters), { initialProps: { data: start } });
    await waitFor(() => expect(hook.result.current.mode).toBe('database'));

    const itemId = initial.workItems[0].id;
    const edited = {
      ...start,
      productionOrders: [{ id: 'po-new', work_item_id: itemId, status: 'Not Started' }],
      workItems: initial.workItems.map((w, i) => (i === 0 ? { ...w, production_order_id: 'po-new' } : w)),
    };
    act(() => hook.rerender({ data: edited }));
    await waitFor(() => expect(hook.result.current.status).toBe('error'));

    const writes = calls.filter((c) => c.url === '/api/data/sync');
    // One attempt with both records; no retry of the work item (or the order) on its own.
    expect(writes).toHaveLength(1);
    expect(hook.result.current.message).toMatch(/^1 change\(s\) not saved: .*approved production method/);
    expect(hook.result.current.message).toContain('productionOrders po-new');
    expect(hook.result.current.message).toContain(`workItems ${itemId}`);
  });

  describe('commit: a business operation saved as one unit (QA batch 1)', () => {
    const order = { id: 'po-c1', work_item_id: 'item-1', status: 'Not Started' };
    const start = () => ({ ...asSync(demo()), productionOrders: [] as Record<string, unknown>[] });
    const mount = async (dataSource: 'database' | 'local' = 'database') => {
      routes['/api/core/status'] = () => ({ body: { dataSource } });
      routes['/api/data/snapshot'] = () => ({ body: demo() });
      const setters = { clients: vi.fn(), projects: vi.fn(), workPackages: vi.fn(), workItems: vi.fn(), productionOrders: vi.fn() };
      const hook = renderHook(({ data }) => useCoreDatabaseSync(data, setters), { initialProps: { data: start() } });
      await waitFor(() => expect(hook.result.current.mode).toBe(dataSource));
      return { hook, setters };
    };
    const syncCalls = () => calls.filter((c) => c.url === '/api/data/sync');

    it('shows nothing as saved when the server refuses it, and returns the server\'s reason', async () => {
      routes['/api/data/sync'] = () => ({ status: 400, body: { error: 'validation_error', message: 'Production must use an approved, current drawing revision' } });
      const { hook, setters } = await mount();
      let result: Awaited<ReturnType<typeof hook.result.current.commit>> | undefined;
      await act(async () => {
        result = await hook.result.current.commit({ upserts: { productionOrders: [order] }, refresh: { workItems: ['item-1'] } });
      });
      expect(result).toEqual({ ok: false, uncertain: false, message: 'Production must use an approved, current drawing revision' });
      // Loading the database set the (empty) collection; the refused order never reached it.
      expect(setters.productionOrders.mock.calls.every(([rows]) => !(rows as { id: string }[]).some((r) => r.id === 'po-c1'))).toBe(true);
      expect(syncCalls()).toHaveLength(1);
    });

    it('on success puts the server\'s own versions in the app, the refreshed records included', async () => {
      routes['/api/data/sync'] = () => ({ body: { upserted: 1, deleted: 0 } });
      routes['/api/production-orders/po-c1'] = () => ({ body: { ...order, drawing_check: 'valid' } });
      const itemId = demo().workItems[0].id;
      routes[`/api/work-items/${itemId}`] = () => ({ body: { ...demo().workItems[0], production_order_id: 'po-c1' } });
      const { hook, setters } = await mount();
      let result: unknown;
      await act(async () => {
        result = await hook.result.current.commit({ upserts: { productionOrders: [order] }, refresh: { workItems: [itemId] } });
      });
      expect(result).toEqual({ ok: true });
      expect(setters.productionOrders).toHaveBeenLastCalledWith([{ ...order, drawing_check: 'valid' }]);
      const items = setters.workItems.mock.calls.at(-1)![0] as { id: string; production_order_id?: string }[];
      expect(items.find((w) => w.id === itemId)?.production_order_id).toBe('po-c1');
      expect(syncCalls()).toHaveLength(1);
    });

    it('after an unconfirmed attempt, asks the server first and never sends a duplicate', async () => {
      let attempts = 0;
      routes['/api/data/sync'] = () => (++attempts === 1 ? { status: 502, body: { error: 'bad_gateway', message: 'Bad gateway' } } : { body: {} });
      // The first attempt was in fact saved: the server has the order.
      routes['/api/production-orders/po-c1'] = () => ({ body: order });
      const { hook } = await mount();
      let first: { ok: boolean; uncertain?: boolean } | undefined;
      await act(async () => {
        first = (await hook.result.current.commit({ upserts: { productionOrders: [order] } })) as never;
      });
      expect(first).toMatchObject({ ok: false, uncertain: true });
      let second: unknown;
      await act(async () => {
        second = await hook.result.current.commit({ upserts: { productionOrders: [order] } });
      });
      expect(second).toEqual({ ok: true });
      expect(syncCalls()).toHaveLength(1); // the retry found the saved order and sent nothing
    });

    it('treats a real browser deadline as unknown and confirms an already saved retry without another write', async () => {
      const { hook } = await mount();
      const previousFetch = globalThis.fetch;
      let writes = 0;
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/data/sync') { writes += 1; return new Promise<Response>(() => {}); }
        return previousFetch(url, init);
      }));
      routes['/api/production-orders/po-c1'] = () => ({ body: order });
      vi.useFakeTimers();
      try {
        let pending!: ReturnType<typeof hook.result.current.commit>;
        act(() => { pending = hook.result.current.commit({ upserts: { productionOrders: [order] } }); });
        await act(async () => { await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS); });
        expect(await pending).toMatchObject({ ok: false, uncertain: true });
        let retried: unknown;
        await act(async () => { retried = await hook.result.current.commit({ upserts: { productionOrders: [order] } }); });
        expect(retried).toEqual({ ok: true });
        expect(writes).toBe(1);
      } finally { vi.useRealTimers(); }
    });

    it('after an unconfirmed attempt that was not saved, sends it again (same id)', async () => {
      // The first attempt failed without saving; the second stores the order.
      let attempts = 0;
      let stored = false;
      routes['/api/data/sync'] = () => {
        attempts += 1;
        if (attempts === 1) return { status: 503, body: { error: 'unavailable', message: 'Unavailable' } };
        stored = true;
        return { body: {} };
      };
      routes['/api/production-orders/po-c1'] = () => (stored ? { body: order } : { status: 404, body: { error: 'not_found', message: 'not found' } });
      const { hook } = await mount();
      await act(async () => {
        await hook.result.current.commit({ upserts: { productionOrders: [order] } });
      });
      let second: unknown;
      await act(async () => {
        second = await hook.result.current.commit({ upserts: { productionOrders: [order] } });
      });
      expect(second).toEqual({ ok: true });
      expect(syncCalls().map((c) => (c.body as { upserts: { productionOrders: { id: string }[] } }).upserts.productionOrders[0].id)).toEqual(['po-c1', 'po-c1']);
    });

    it('in local mode applies the operation, links the server would make included', async () => {
      const { hook, setters } = await mount('local');
      const itemId = demo().workItems[0].id;
      await act(async () => {
        await hook.result.current.commit({ upserts: { productionOrders: [order] }, localOnly: { workItems: [{ ...demo().workItems[0], production_order_id: 'po-c1' }] } });
      });
      expect(setters.productionOrders).toHaveBeenCalledWith([order]);
      const items = setters.workItems.mock.calls.at(-1)![0] as { id: string; production_order_id?: string }[];
      expect(items.find((w) => w.id === itemId)?.production_order_id).toBe('po-c1');
      expect(syncCalls()).toHaveLength(0);
    });
  });

  describe('timeout recovery (QA batch 1): corrections, concurrent edits and page reloads', () => {
    type Rec = Record<string, unknown>;
    let server: Record<string, Rec>;
    let failNext: number;
    let syncs: { upserts: Record<string, Rec[]>; expect?: { id: string; record: Rec }[] }[];
    const sent = (r: Rec) => ({ id: 'del-r1', project_id: 'proj-1', driver_name: 'Wrong', vehicle_plate: 'WXY 1', status_history: [{ at: String(Date.now()) }], ...r });
    beforeEach(() => {
      server = {};
      failNext = 0;
      syncs = [];
      routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
      routes['/api/data/snapshot'] = () => ({ body: demo() });
      // A server that stores what it is sent, honours preconditions, and can lose its answer.
      routes['/api/data/sync'] = (body) => {
        const b = body as (typeof syncs)[number];
        syncs.push(b);
        for (const e of b.expect ?? []) {
          if (JSON.stringify(server[e.id]) !== JSON.stringify(e.record)) return { status: 409, body: { error: 'conflict', message: `deliveryRecords ${e.id} has changed since you last loaded it.` } };
        }
        for (const r of b.upserts.deliveryRecords ?? []) server[String(r.id)] = r;
        if (failNext > 0) {
          failNext -= 1;
          return { status: 504, body: { error: 'timeout', message: 'Gateway timeout' } }; // saved, but the answer was lost
        }
        return { body: {} };
      };
      routes['/api/deliveries/del-r1'] = () => (server['del-r1'] ? { body: server['del-r1'] } : { status: 404, body: { error: 'not_found', message: 'not found' } });
    });
    const mount = async () => {
      const setters = { clients: vi.fn(), projects: vi.fn(), workPackages: vi.fn(), workItems: vi.fn(), deliveryRecords: vi.fn() };
      const hook = renderHook(({ data }) => useCoreDatabaseSync(data, setters), { initialProps: { data: { ...asSync(demo()), deliveryRecords: [] as Rec[] } } });
      await waitFor(() => expect(hook.result.current.mode).toBe('database'));
      return { hook, setters };
    };
    const commitDelivery = async (hook: Awaited<ReturnType<typeof mount>>['hook'], r: Rec) => {
      let result: Awaited<ReturnType<typeof hook.result.current.commit>> | undefined;
      await act(async () => {
        result = await hook.result.current.commit({ upserts: { deliveryRecords: [r] } });
      });
      return result!;
    };

    it('a corrected retry after a saved-but-unconfirmed attempt applies the corrections to the same record, with a precondition', async () => {
      const { hook } = await mount();
      failNext = 1;
      expect(await commitDelivery(hook, sent({}))).toMatchObject({ ok: false, uncertain: true });
      expect(server['del-r1'].driver_name).toBe('Wrong'); // it was in fact saved
      expect(await commitDelivery(hook, sent({ driver_name: 'Corrected' }))).toEqual({ ok: true });
      expect(server['del-r1'].driver_name).toBe('Corrected');
      expect(Object.keys(server)).toEqual(['del-r1']); // one record, no duplicate
      expect(syncs[1].expect?.[0]).toMatchObject({ id: 'del-r1', record: { driver_name: 'Wrong' } });
    });

    it('an identical retry is confirmed without sending again', async () => {
      const { hook } = await mount();
      failNext = 1;
      await commitDelivery(hook, sent({}));
      expect(await commitDelivery(hook, sent({}))).toEqual({ ok: true });
      expect(syncs).toHaveLength(1);
    });

    it('never overwrites a newer change by someone else: shows their version, and applies the corrections only when submitted again', async () => {
      const { hook, setters } = await mount();
      failNext = 1;
      await commitDelivery(hook, sent({}));
      server['del-r1'] = { ...server['del-r1'], vehicle_plate: 'CHANGED BY PM' }; // someone else's edit
      const result = await commitDelivery(hook, sent({ driver_name: 'Corrected' }));
      expect(result).toMatchObject({ ok: false, conflict: true });
      expect(syncs).toHaveLength(1); // nothing sent
      expect(server['del-r1']).toMatchObject({ driver_name: 'Wrong', vehicle_plate: 'CHANGED BY PM' });
      expect(setters.deliveryRecords).toHaveBeenLastCalledWith([expect.objectContaining({ vehicle_plate: 'CHANGED BY PM' })]); // now shown
      // Submitting again, having seen it, applies the corrections to that version.
      expect(await commitDelivery(hook, sent({ driver_name: 'Corrected', vehicle_plate: 'CHANGED BY PM' }))).toEqual({ ok: true });
      expect(server['del-r1']).toMatchObject({ driver_name: 'Corrected', vehicle_plate: 'CHANGED BY PM' });
    });

    it('a change between reading and writing is caught by the server precondition (409), and nothing is overwritten', async () => {
      const { hook } = await mount();
      failNext = 1;
      await commitDelivery(hook, sent({}));
      // The read sees our attempt; then someone else writes before the correction arrives.
      const read = routes['/api/deliveries/del-r1'];
      routes['/api/deliveries/del-r1'] = (b, u) => {
        const out = read(b, u);
        server['del-r1'] = { ...server['del-r1'], vehicle_plate: 'RACED' };
        return out;
      };
      const result = await commitDelivery(hook, sent({ driver_name: 'Corrected' }));
      expect(result).toMatchObject({ ok: false, uncertain: false, conflict: true });
      expect(server['del-r1']).toMatchObject({ driver_name: 'Wrong', vehicle_plate: 'RACED' });
    });

    it('survives a page reload: an attempt that was saved is recognised, and its form starts a new operation (no duplicate)', async () => {
      const formId = operationId('quick-schedule', 'del');
      const first = await mount();
      failNext = 1;
      await commitDelivery(first.hook, sent({ id: formId }));
      routes[`/api/deliveries/${formId}`] = () => (server[formId] ? { body: server[formId] } : { status: 404, body: {} });
      first.hook.unmount(); // the page is reloaded
      const second = await mount();
      await waitFor(() => expect(second.hook.result.current.message).toMatch(/Saved before the connection was lost/));
      expect(second.setters.deliveryRecords).toHaveBeenLastCalledWith([expect.objectContaining({ id: formId })]);
      expect(operationId('quick-schedule', 'del')).not.toBe(formId); // the saved one is never reused or overwritten
      expect(syncs).toHaveLength(1);
    });

    it('survives a page reload: an attempt that was not saved keeps its id, so submitting again cannot duplicate', async () => {
      const formId = operationId('quick-schedule', 'del');
      routes[`/api/deliveries/${formId}`] = () => ({ status: 404, body: {} });
      const first = await mount();
      routes['/api/data/sync'] = () => ({ status: 503, body: { error: 'unavailable', message: 'Unavailable' } }); // not saved
      await commitDelivery(first.hook, sent({ id: formId }));
      first.hook.unmount();
      expect(operationId('quick-schedule', 'del')).toBe(formId); // the reloaded form gets the same id
      settleOperation('quick-schedule');
      expect(operationId('quick-schedule', 'del')).not.toBe(formId); // until the form is saved or cancelled
    });
  });

  describe('browser import switched off on the server (NWOS_BROWSER_IMPORT)', () => {
    const storeLocally = (d: CoreData) => {
      for (const [k, v] of Object.entries(d)) localStorage.setItem(`nw_os_data_v1_${k}`, JSON.stringify(v));
    };
    const preserved = () => Object.keys(localStorage).filter((k) => k.startsWith(PRESERVED_LOCAL_PREFIX));

    it('an Owner on an empty database gets the empty database, with no import attempt', async () => {
      routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
      routes['/api/data/status'] = () => ({ body: { databaseEmpty: true, importAllowed: false } });
      routes['/api/data/snapshot'] = () => ({ body: empty() });

      const { hook, setters } = setup(demo()); // canImport defaults to true (an Owner)
      await waitFor(() => expect(hook.result.current.mode).toBe('database'));
      expect(hook.result.current.status).toBe('synced');
      expect(calls.some((c) => c.url.startsWith('/api/data/import'))).toBe(false);
      expect(setters.projects).toHaveBeenCalledWith([]);
    });

    it('never imports when the server does not say imports are allowed', async () => {
      routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
      routes['/api/data/status'] = () => ({ body: { databaseEmpty: true } }); // older server
      routes['/api/data/snapshot'] = () => ({ body: empty() });

      const { hook } = setup(demo());
      await waitFor(() => expect(hook.result.current.mode).toBe('database'));
      expect(calls.some((c) => c.url.startsWith('/api/data/import'))).toBe(false);
    });

    it('a non-empty database is loaded normally and later edits still sync', async () => {
      routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
      routes['/api/data/status'] = () => ({ body: { databaseEmpty: false, importAllowed: false } });
      routes['/api/data/snapshot'] = () => ({ body: demo() });
      routes['/api/data/sync'] = () => ({ body: { upserted: 1, deleted: 0 } });

      const initial = demo();
      const { hook, setters } = setup(initial);
      await waitFor(() => expect(hook.result.current.mode).toBe('database'));
      expect(setters.clients).toHaveBeenCalledWith(demo().clients);
      act(() => hook.rerender({ data: { ...initial, clients: initial.clients.map((c, i) => (i === 0 ? { ...c, company_name: 'Renamed' } : c)) } }));
      await waitFor(() => expect(calls.some((c) => c.url === '/api/data/sync')).toBe(true));
      expect(calls.some((c) => c.url.startsWith('/api/data/import'))).toBe(false);
    });

    it("keeps the browser's own data in a copy that sign-out does not remove, once", async () => {
      routes['/api/core/status'] = () => ({ body: { dataSource: 'database' } });
      routes['/api/data/status'] = () => ({ body: { databaseEmpty: true, importAllowed: false } });
      routes['/api/data/snapshot'] = () => ({ body: empty() });
      const local = demo();
      local.projects[0].project_name = 'Demo Supermarket — Outlet 001';
      storeLocally(local);

      const first = setup(local);
      await waitFor(() => expect(first.hook.result.current.mode).toBe('database'));
      expect(preserved()).toHaveLength(1);
      const copy = JSON.parse(localStorage.getItem(preserved()[0])!);
      expect(JSON.parse(copy.nw_os_data_v1_projects)[0].project_name).toBe('Demo Supermarket — Outlet 001');
      cleanup();

      // The cache now holds database data: a later load keeps no further copy of it.
      storeLocally(empty());
      const second = setup(empty());
      await waitFor(() => expect(second.hook.result.current.mode).toBe('database'));
      expect(preserved()).toHaveLength(1);

      // Sign-out clears the database cache and its backups, never the preserved copy.
      clearCoreCache();
      expect(localStorage.getItem('nw_os_data_v1_projects')).toBeNull();
      expect(Object.keys(localStorage).some((k) => k.startsWith('nw_os_core_backup_'))).toBe(false);
      expect(preserved()).toHaveLength(1);
    });
  });
});
