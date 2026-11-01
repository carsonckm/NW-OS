// @vitest-environment jsdom
/**
 * QA batch 1, in the app itself (database mode, server stubbed): a production order or a
 * delivery is shown, audited and notified only once the server has saved it; a refused one
 * leaves the app exactly as it was, and is sent as one batch with nothing split off.
 */
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CLIENTS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../data/initialData';
import { NWProvider, useNW } from './NWContext';

type Rec = Record<string, unknown>;
const wrapper = ({ children }: { children: React.ReactNode }) => <NWProvider>{children}</NWProvider>;

let syncAnswer: { status: number; body: Rec };
let syncBodies: { upserts: Record<string, Rec[]>; deletes: Rec }[];
let stored: Record<string, Rec>;

beforeEach(() => {
  localStorage.clear();
  syncBodies = [];
  stored = {};
  syncAnswer = { status: 200, body: { upserted: 1, deleted: 0 } };
  const snapshot = { clients: INITIAL_CLIENTS, projects: INITIAL_PROJECTS, workPackages: INITIAL_WORK_PACKAGES, workItems: INITIAL_WORK_ITEMS, productionOrders: [], deliveryRecords: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0];
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (path === '/api/core/status') return reply(200, { dataSource: 'database' });
      if (path === '/api/data/snapshot') return reply(200, snapshot);
      if (path === '/api/data/status') return reply(200, { databaseEmpty: false, importAllowed: false });
      if (path === '/api/data/sync') {
        const body = JSON.parse(String(init?.body));
        syncBodies.push(body);
        if (syncAnswer.status === 200) for (const rows of Object.values(body.upserts as Record<string, Rec[]>)) for (const r of rows) stored[String(r.id)] = r;
        return reply(syncAnswer.status, syncAnswer.body);
      }
      const id = decodeURIComponent(path.split('/').pop() ?? '');
      if (stored[id]) return reply(200, stored[id]);
      return reply(404, { error: 'not_found', message: 'not found' });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = async () => {
  const hook = renderHook(() => useNW(), { wrapper });
  await waitFor(() => expect(hook.result.current.coreDataSync.mode).toBe('database'));
  return hook;
};

const item = INITIAL_WORK_ITEMS[0];
const deliveryInput = () => ({
  project_id: item.project_id,
  project_name: 'Aurora',
  work_package_id: item.work_package_id,
  work_package_name: 'Joinery',
  work_item_ids: [item.id],
  work_item_codes: [item.item_code],
  production_order_ids: [],
  contractor_id: 'con-1',
  contractor_name: 'Hock Seng',
  driver_name: 'Driver',
  driver_contact: '012',
  vehicle_plate: 'WXX 1',
  vehicle_type: 'Lorry',
  delivery_date: '2026-11-20',
  delivery_time: '10:00 AM',
  estimated_arrival: '11:00 AM',
  destination_site: 'Site',
  special_instructions: '',
  package_count: 1,
  status: 'Scheduled' as const,
  scanned_packages: [],
  loading_checklist: { correct_project: false, correct_work_items: false, correct_quantity: false, correct_package_count: false, correct_destination: false, protection_applied: false, hardware_accessories_included: false, delivery_documents_included: false, photos: [] },
  notes: '',
  photos: [],
});
const orderInput = () => ({
  project_id: item.project_id,
  project_number: 'NW-1',
  project_name: 'Aurora',
  work_package_id: item.work_package_id,
  work_package_name: 'Joinery',
  work_item_id: item.id,
  work_item_code: item.item_code,
  client_id: 'client-1',
  client_name: 'Client',
  location: 'L1',
  contractor_id: 'con-1',
  contractor_name: 'Hock Seng',
  production_manager_id: 'u',
  production_manager_name: 'U',
  required_date: '2026-11-01',
  current_stage: 'Not Started' as const,
  priority: 'Normal' as const,
  status: 'Not Started' as const,
  approved_client_drawing_id: 'dwg-1',
  approved_client_drawing_revision: 'Rev 3',
  approved_nw_production_drawing_id: 'nwd-1',
  approved_nw_production_drawing_revision: 'Rev 1',
  production_method: 'NW-PM-1',
  material: 'ply',
  finish: 'oak',
  dimensions: '1x1',
  quantity: 1,
  notes: '',
  photos: [],
});

describe('delivery: shown, audited and notified only after the server saves it', () => {
  it('a refused delivery (e.g. an item of another project) changes nothing: no delivery, schedule, notification or audit entry', async () => {
    const hook = await mount();
    syncAnswer = { status: 400, body: { error: 'validation_error', message: 'Delivery work item item-x is on another project' } };
    const before = { n: hook.result.current.notifications.length, a: hook.result.current.auditLogs.length, items: hook.result.current.workItems };
    let result: Awaited<ReturnType<typeof hook.result.current.createDeliveryRecord>> | undefined;
    await act(async () => {
      result = await hook.result.current.createDeliveryRecord(deliveryInput(), { id: 'del-q1' });
    });
    expect(result).toEqual({ ok: false, uncertain: false, message: 'Delivery work item item-x is on another project' });
    expect(hook.result.current.deliveryRecords.some((d) => d.id === 'del-q1')).toBe(false);
    expect(hook.result.current.notifications).toHaveLength(before.n);
    expect(hook.result.current.auditLogs).toHaveLength(before.a);
    expect(hook.result.current.workItems).toEqual(before.items);
    // Sent once, as the delivery alone: the items' schedule is the server's to set.
    await new Promise((r) => setTimeout(r, 600)); // past the debounce: nothing else is sent
    expect(syncBodies).toHaveLength(1);
    expect(Object.keys(syncBodies[0].upserts)).toEqual(['deliveryRecords']);
  });

  it('a saved delivery appears with its notification and audit entry, and its items as the server holds them', async () => {
    const hook = await mount();
    stored[item.id] = { ...item, delivery_status: 'Scheduled', scheduled_delivery_date: '2026-11-20' };
    const before = { n: hook.result.current.notifications.length, a: hook.result.current.auditLogs.length };
    let result: { ok: boolean } | undefined;
    await act(async () => {
      result = await hook.result.current.createDeliveryRecord(deliveryInput(), { id: 'del-q2' });
    });
    expect(result?.ok).toBe(true);
    expect(hook.result.current.deliveryRecords.some((d) => d.id === 'del-q2')).toBe(true);
    expect(hook.result.current.notifications).toHaveLength(before.n + 1);
    expect(hook.result.current.auditLogs.length).toBeGreaterThan(before.a);
    expect(hook.result.current.workItems.find((w) => w.id === item.id)?.delivery_status).toBe('Scheduled');
  });

  it('Quick Schedule creates a real delivery record for the item, through the same operation', async () => {
    const hook = await mount();
    let result: { ok: boolean } | undefined;
    await act(async () => {
      result = await hook.result.current.scheduleDelivery(
        item.id,
        { contractor_id: 'con-1', delivery_date: '2026-11-21', delivery_time: '9:00 AM', driver_name: 'D', driver_contact: '1', vehicle_plate: 'P', vehicle_type: 'Lorry', destination_site: 'Site', package_count: 2 },
        { id: 'del-quick' }
      );
    });
    expect(result?.ok).toBe(true);
    expect(syncBodies).toHaveLength(1);
    const sent = syncBodies[0].upserts.deliveryRecords;
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ id: 'del-quick', project_id: item.project_id, work_item_ids: [item.id], status: 'Scheduled', package_count: 2 });
    expect(syncBodies[0].upserts.workItems).toBeUndefined(); // no Scheduled written on the item itself
  });
});

describe('production order: saved as one operation', () => {
  it('a refused order leaves no order and no audit entry, and its work item link is never sent', async () => {
    const hook = await mount();
    syncAnswer = { status: 400, body: { error: 'validation_error', message: 'A production order needs an approved production method' } };
    const auditBefore = hook.result.current.auditLogs.length;
    let result: { ok: boolean; message?: string } | undefined;
    await act(async () => {
      result = (await hook.result.current.createProductionOrder(orderInput(), { id: 'po-q1' })) as never;
    });
    expect(result).toMatchObject({ ok: false, message: 'A production order needs an approved production method' });
    expect(hook.result.current.productionOrders.some((o) => o.id === 'po-q1')).toBe(false);
    expect(hook.result.current.auditLogs).toHaveLength(auditBefore);
    expect(hook.result.current.workItems.find((w) => w.id === item.id)?.production_order_id).toBe(item.production_order_id);
    await new Promise((r) => setTimeout(r, 600));
    expect(syncBodies).toHaveLength(1);
    expect(Object.keys(syncBodies[0].upserts)).toEqual(['productionOrders']);
  });

  it('a saved order appears with the link the server made', async () => {
    const hook = await mount();
    stored[item.id] = { ...item, production_order_id: 'po-q2' };
    let result: { ok: boolean } | undefined;
    await act(async () => {
      result = await hook.result.current.createProductionOrder(orderInput(), { id: 'po-q2' });
    });
    expect(result?.ok).toBe(true);
    expect(hook.result.current.productionOrders.some((o) => o.id === 'po-q2')).toBe(true);
    expect(hook.result.current.workItems.find((w) => w.id === item.id)?.production_order_id).toBe('po-q2');
    expect(Object.keys(syncBodies[0].upserts)).toEqual(['productionOrders']);
  });
});
