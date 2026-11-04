// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NWProvider, useNW } from './NWContext';
import { claimCoreCache, markCoreCacheFromDatabase } from '../services/authApi';
import type { UserProfile } from '../types';

const owner: UserProfile = { id: 'offline-owner', name: 'Synthetic Owner', role: 'Owner / CEO', email: 'owner@example.test', status: 'active' };
const cached = [{ id: 'cached-project', project_name: 'Synthetic cached project' }];
let mode: 'offline' | 'delayed' | 'local';
let releaseSnapshot: ((value: Response) => void) | undefined;
let writes: number;
let stored: Record<string, unknown> | undefined;
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  localStorage.clear();
  claimCoreCache(owner.id);
  mode = 'offline';
  writes = 0;
  stored = undefined;
  releaseSnapshot = undefined;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method && init.method !== 'GET') writes += 1;
    if (url === '/api/users') return reply([{ ...owner, is_active: true }]);
    if (url === '/api/core/status') {
      if (mode === 'offline') throw new Error('Synthetic disconnected transport');
      return reply({ dataSource: mode === 'local' ? 'local' : 'database' });
    }
    if (url === '/api/data/snapshot') return new Promise<Response>((resolve) => { releaseSnapshot = resolve; });
    if (url === '/api/data/status') return reply({ databaseEmpty: false, importAllowed: false });
    if (url === '/api/data/sync') {
      stored = JSON.parse(String(init?.body)).upserts.projects[0];
      return reply({ upserted: 1, deleted: 0 });
    }
    if (url === '/api/projects/confirmed-synthetic') return reply(stored);
    return reply([]);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (authenticated = true) => renderHook(() => useNW(), { wrapper: ({ children }) => <NWProvider authUser={authenticated ? owner : undefined}>{children}</NWProvider> });

describe('authenticated offline boundary', () => {
  it('does not show sample records or confirm a local-only save after a connection failure', async () => {
    const { result } = mount();
    expect(result.current.projects).toEqual([]);
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(result.current.coreDataSync.mode).toBe('database');
    let saved: unknown;
    await act(async () => { saved = await result.current.coreDataSync.commit({ upserts: { projects: [{ id: 'unsaved-synthetic' }] } }); });
    expect(saved).toMatchObject({ ok: false, uncertain: false });
    expect(result.current.projects).toEqual([]);
    expect(writes).toBe(0);
  });
  it('blocks saves during initial hydration and accepts only the authoritative snapshot', async () => {
    mode = 'delayed';
    const { result } = mount();
    await waitFor(() => expect(releaseSnapshot).toBeTypeOf('function'));
    let saved: unknown;
    await act(async () => { saved = await result.current.coreDataSync.commit({ upserts: { projects: [{ id: 'premature' }] } }); });
    expect(saved).toMatchObject({ ok: false, uncertain: false });
    expect(writes).toBe(0);
    await act(async () => releaseSnapshot!(reply({ projects: cached, workItems: [] })));
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('synced'));
    expect(result.current.projects.map((p) => p.id)).toEqual(['cached-project']);
    await act(async () => { saved = await result.current.coreDataSync.commit({ upserts: { projects: [{ id: 'confirmed-synthetic' }] } }); });
    expect(saved).toEqual({ ok: true });
    expect(result.current.projects.some((p) => p.id === 'confirmed-synthetic')).toBe(true);
    expect(writes).toBe(1);
  });
  it('keeps the same user’s verified database cache visible when disconnected', async () => {
    markCoreCacheFromDatabase();
    localStorage.setItem('nw_os_data_v1_projects', JSON.stringify(cached));
    localStorage.setItem('nw_os_selected_project', 'cached-project');
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(result.current.projects.map((p) => p.id)).toEqual(['cached-project']);
    expect(result.current.selectedProjectId).toBe('cached-project');
    expect(writes).toBe(0);
  });
  it('ignores unverified local/demo records without overwriting that stored source', async () => {
    localStorage.setItem('nw_os_data_v1_projects', JSON.stringify(cached));
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(result.current.projects).toEqual([]);
    expect(JSON.parse(localStorage.getItem('nw_os_data_v1_projects')!)).toEqual(cached);
  });
  it('refuses a local-mode status from an authenticated workspace', async () => {
    mode = 'local';
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(result.current.coreDataSync.mode).toBe('database');
    expect(result.current.projects).toEqual([]);
  });
  it('does not reuse another user’s cached rows', async () => {
    claimCoreCache('another-synthetic-user');
    markCoreCacheFromDatabase();
    localStorage.setItem('nw_os_data_v1_projects', JSON.stringify(cached));
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(result.current.projects).toEqual([]);
    expect(JSON.parse(localStorage.getItem('nw_os_data_v1_projects')!)).toEqual(cached);
  });
  it.each([{ invalid: 'synthetic cache' }, [null], ['not a record']])('handles an invalid cache %j without rendering it as records', async (invalid) => {
    markCoreCacheFromDatabase();
    localStorage.setItem('nw_os_data_v1_projects', JSON.stringify(invalid));
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(result.current.projects).toEqual([]);
  });
  it('preserves unverified browser data before signing out of an offline startup', async () => {
    localStorage.setItem('nw_os_data_v1_projects', JSON.stringify(cached));
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    act(() => result.current.signOut());
    const preserved = Object.keys(localStorage).find((k) => k.startsWith('nw_os_local_preserved_'))!;
    expect(JSON.parse(JSON.parse(localStorage.getItem(preserved)!)['nw_os_data_v1_projects'])).toEqual(cached);
    expect(localStorage.getItem('nw_os_data_v1_projects')).toBeNull();
  });
  it('does not overwrite local-only collections when loading a verified database cache', async () => {
    markCoreCacheFromDatabase();
    const localMessages = [{ id: 'local-only-message', text: 'Synthetic draft' }];
    localStorage.setItem('nw_os_data_v1_gateway_messages', JSON.stringify(localMessages));
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    expect(JSON.parse(localStorage.getItem('nw_os_data_v1_gateway_messages')!)).toEqual(localMessages);
  });
  it('reconnects by reading the snapshot and preserves unverified browser data before replacing it', async () => {
    localStorage.setItem('nw_os_data_v1_projects', JSON.stringify(cached));
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.status).toBe('error'));
    let reload!: Promise<void>;
    act(() => { reload = result.current.coreDataSync.reloadFromDatabase(); });
    await waitFor(() => expect(releaseSnapshot).toBeTypeOf('function'));
    await act(async () => { releaseSnapshot!(reply({ projects: [{ id: 'server-project' }] })); await reload; });
    expect(result.current.coreDataSync.status).toBe('synced');
    expect(result.current.projects.map((p) => p.id)).toEqual(['server-project']);
    const preserved = Object.keys(localStorage).find((k) => k.startsWith('nw_os_local_preserved_'))!;
    expect(JSON.parse(JSON.parse(localStorage.getItem(preserved)!)['nw_os_data_v1_projects'])).toEqual(cached);
    expect(writes).toBe(0);
  });
});
