// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SyncErrorBanner } from './SyncErrorBanner';

const state = vi.hoisted(() => ({ message: '' }));
vi.mock('../../context/NWContext', () => ({ useNW: () => ({ coreDataSync: { status: 'error', message: state.message } }) }));
afterEach(cleanup);

it('does not claim an unconfirmed write was not saved', () => {
  state.message = 'Sync failed: The server did not respond in time. It may still be processing the request.';
  render(<SyncErrorBanner />);
  expect(screen.getByTestId('sync-error-banner').textContent).toContain('may still be processing');
  expect(screen.getByTestId('sync-error-banner').textContent).not.toContain('Not saved');
});

it('preserves an explicit server refusal without inventing a different outcome', () => {
  state.message = '1 change(s) not saved: An approved current drawing is required';
  render(<SyncErrorBanner />);
  expect(screen.getByTestId('sync-error-banner').textContent).toContain(state.message);
});
