// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { IssueModal } from './IssueModal';

const { createIssue } = vi.hoisted(() => ({ createIssue: vi.fn() }));
vi.mock('../context/NWContext', () => ({
  useNW: () => ({
    currentUser: { id: 'qa-owner', name: 'QA Owner', role: 'Owner / CEO' },
    workItems: [{ id: 'item-1', item_code: 'QA-1', description: 'Synthetic item' }],
    selectedProjectId: 'qa-project',
    tasks: [],
    createIssue,
  }),
}));
vi.mock('../services/records', () => ({ useRecords: () => ({ live: true }) }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  createIssue.mockReset();
});

it('keeps an unconfirmed issue open and retries with the same ID before closing', async () => {
  createIssue.mockRejectedValueOnce(new Error('The server did not confirm the save')).mockResolvedValueOnce({});
  const onClose = vi.fn();
  render(<IssueModal isOpen onClose={onClose} />);

  const title = screen.getByPlaceholderText(/Site Dimension Conflict/) as HTMLInputElement;
  const description = screen.getByPlaceholderText(/Counter 3 dimension/) as HTMLTextAreaElement;
  fireEvent.change(title, { target: { value: 'Synthetic issue' } });
  fireEvent.change(description, { target: { value: 'Synthetic connection test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Submit Issue' }));

  expect((await screen.findByRole('alert')).textContent).toContain('did not confirm');
  expect(title.value).toBe('Synthetic issue');
  expect(description.value).toBe('Synthetic connection test');
  expect(onClose).not.toHaveBeenCalled();
  const [payload, id] = createIssue.mock.calls[0];
  expect(id).toMatch(/^issue-/);

  fireEvent.click(screen.getByRole('button', { name: 'Submit Issue' }));
  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  expect(createIssue).toHaveBeenNthCalledWith(2, payload, id);
});
