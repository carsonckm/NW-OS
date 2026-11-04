// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceConnectionGate } from './WorkspaceConnectionGate';

const state = vi.hoisted(() => ({ mode: 'database', status: 'syncing', lastSyncedAt: undefined as string | undefined, reloadFromDatabase: vi.fn() }));
vi.mock('../context/NWContext', () => ({ useNW: () => ({ coreDataSync: state }) }));
beforeEach(() => { state.mode = 'database'; state.status = 'syncing'; state.lastSyncedAt = undefined; state.reloadFromDatabase.mockReset(); });
afterEach(cleanup);
const mount = () => render(<WorkspaceConnectionGate><button>Create business record</button></WorkspaceConnectionGate>);

it('withholds workflow controls while the first snapshot is loading', () => {
  mount();
  expect(screen.queryByRole('button', { name: 'Create business record' })).toBeNull();
  expect(screen.getByRole('status').textContent).toContain('Loading your workspace');
});
it('offers a read-only reconnect action after an initial connection failure', () => {
  state.status = 'error';
  mount();
  expect(screen.queryByRole('button', { name: 'Create business record' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry connection' }));
  expect(state.reloadFromDatabase).toHaveBeenCalledOnce();
});
it('keeps loaded workflows available when a later save needs review', () => {
  state.status = 'error';
  state.lastSyncedAt = '2026-11-04T00:00:00Z';
  mount();
  expect(screen.getByRole('button', { name: 'Create business record' })).toBeDefined();
});
it('preserves the explicit unauthenticated local-demo workspace', () => {
  state.mode = 'local';
  mount();
  expect(screen.getByRole('button', { name: 'Create business record' })).toBeDefined();
});
