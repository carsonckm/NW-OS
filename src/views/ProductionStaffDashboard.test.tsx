// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ProductionStaffDashboard } from './ProductionStaffDashboard';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../services/coreApi', async (original) => ({
  ...await original<typeof import('../services/coreApi')>(),
  api: { post },
}));
vi.mock('../context/NWContext', () => ({
  useNW: () => ({
    currentUser: { id: 'qa-staff', name: 'QA Staff', assigned_project_ids: ['qa-project'] },
    workItems: [{
      id: 'qa-item', project_id: 'qa-project', item_code: 'QA-1',
      description: 'Synthetic panel', production_status: 'Cutting',
    }],
    coreDataSync: { mode: 'database' },
    qcRecords: [],
  }),
}));

afterEach(() => { cleanup(); localStorage.clear(); post.mockReset(); });

it('does not offer simulated photo evidence or actions on an unmatched barcode', () => {
  render(<ProductionStaffDashboard />);
  expect((screen.getByRole('button', { name: 'Photo capture unavailable' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText('No drawing revision recorded')).toBeDefined();
  fireEvent.change(screen.getByPlaceholderText(/Scan barcode/), { target: { value: 'unmatched' } });
  expect(screen.queryByRole('button', { name: 'Report Problem' })).toBeNull();
});

it('retains a failed workshop report and uses the same ID on retry', async () => {
  post.mockRejectedValueOnce(new Error('Network disconnected')).mockResolvedValueOnce({});
  render(<ProductionStaffDashboard />);
  fireEvent.click(screen.getByRole('button', { name: 'Report Problem' }));
  const title = screen.getByPlaceholderText(/Veneer grain/) as HTMLInputElement;
  fireEvent.change(title, { target: { value: 'Synthetic workshop issue' } });
  fireEvent.change(screen.getByPlaceholderText(/Describe what occurred/), { target: { value: 'Synthetic details' } });
  fireEvent.click(screen.getByRole('button', { name: 'Report to Supervisor' }));
  expect((await screen.findByRole('alert')).textContent).toContain('did not confirm');
  expect(title.value).toBe('Synthetic workshop issue');
  expect(post.mock.calls[0][1]).toMatchObject({ work_item_id: 'qa-item', id: expect.stringMatching(/^issue-/) });
  fireEvent.click(screen.getByRole('button', { name: 'Report to Supervisor' }));
  await waitFor(() => expect(screen.queryByText('Report Workshop Problem')).toBeNull());
  expect(post.mock.calls[1]).toEqual(post.mock.calls[0]);
});
