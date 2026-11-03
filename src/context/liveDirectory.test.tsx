// @vitest-environment jsdom
import React from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NWProvider, useNW } from './NWContext';
import type { UserProfile } from '../types';

const owner: UserProfile = { id: 'real-owner', name: 'Real session owner', email: 'owner@example.test', role: 'Owner / CEO', status: 'active' };
let directoryStatus: number;
let requested: string[];
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('nw_os_data_v1_availableUsers', JSON.stringify([{ id: 'user-pm', name: 'Demo manager', role: 'Project Manager' }]));
  directoryStatus = 200;
  requested = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    requested.push(url);
    const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (url === '/api/core/status') return reply({ dataSource: 'database' });
    if (url === '/api/data/status') return reply({ databaseEmpty: false, importAllowed: false });
    if (url === '/api/data/snapshot') return reply({ projects: [], workItems: [] });
    if (url === '/api/users') return reply(directoryStatus === 200 ? [{ ...owner, is_active: true }, { id: 'inactive', name: 'Inactive staff', role: 'Project Manager', is_active: false }] : { message: 'Forbidden' }, directoryStatus);
    return reply([]);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const mount = (user = owner) => renderHook(() => useNW(), { wrapper: ({ children }) => <NWProvider authUser={user}>{children}</NWProvider> });

describe('authenticated staff directory', () => {
  it('ignores the old demo cache and uses only active server identities', async () => {
    const { result } = mount();
    expect(result.current.availableUsers.map((u) => u.id)).toEqual(['real-owner']);
    await waitFor(() => expect(requested).toContain('/api/users'));
    await waitFor(() => expect(result.current.coreDataSync.mode).toBe('database'));
    expect(result.current.availableUsers.map((u) => u.name)).toEqual(['Real session owner']);
  });
  it('fails closed to the session identity when directory access fails', async () => {
    directoryStatus = 403;
    const { result } = mount();
    await waitFor(() => expect(result.current.coreDataSync.mode).toBe('database'));
    expect(result.current.availableUsers.map((u) => u.id)).toEqual(['real-owner']);
    expect(result.current.availableUsers.some((u) => u.name === 'Demo manager')).toBe(false);
  });
  it('does not request the directory for a user without users.view', async () => {
    const { result } = mount({ ...owner, id: 'contractor', role: 'Contractor', contractor_id: 'synthetic' });
    await waitFor(() => expect(result.current.coreDataSync.mode).toBe('database'));
    expect(requested).not.toContain('/api/users');
    expect(result.current.availableUsers.map((u) => u.id)).toEqual(['contractor']);
  });
});
