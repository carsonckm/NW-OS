// @vitest-environment jsdom
/**
 * NW-002: the Upload Drawing modal names the project the drawing goes to, sends that project's
 * own id (never a hardcoded fallback), starts with every required field empty, refuses to
 * upload without a project, and offers the Quick Test Presets only in demo mode.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nw = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../context/NWContext', () => ({ useNW: () => nw.value }));
const files = vi.hoisted(() => ({
  filesAvailable: vi.fn(async () => true),
  uploadFile: vi.fn(async () => ({ id: 'file-1', url: '/api/files/file-1' })),
}));
vi.mock('../services/files', () => ({ FILE_ACCEPT: '.pdf', ...files }));

import { UploadDrawingModal } from './UploadDrawingModal';

const PROJECTS = [
  { id: 'proj-db-segar', project_name: 'Segar Mart Outlet 12', project_number: 'NW-2026-012' },
  { id: 'proj-db-other', project_name: 'Unrelated Fit-out', project_number: 'NW-2026-099' },
];

let uploadDrawing: ReturnType<typeof vi.fn>;
function setContext(over: Record<string, unknown> = {}) {
  uploadDrawing = vi.fn(() => ({ id: 'dwg-new' }));
  nw.value = {
    currentUser: { name: 'Pat PM', role: 'Project Manager' },
    selectedProjectId: 'proj-db-other',
    userProjects: PROJECTS,
    uploadDrawing,
    authMode: true,
    ...over,
  };
}

const field = (id: string) => document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
const submit = () => screen.getByRole('button', { name: /Upload & Register Drawing/ }) as HTMLButtonElement;

function fillRequired() {
  fireEvent.change(field('uploadDrawingNumber'), { target: { value: 'A-201' } });
  fireEvent.change(field('uploadDrawingRevision'), { target: { value: 'Rev 0' } });
  fireEvent.change(field('uploadDrawingCategory'), { target: { value: 'Carpentry' } });
  fireEvent.change(field('uploadDrawingTitle'), { target: { value: 'Cashier counter' } });
  fireEvent.change(field('uploadDrawingType'), { target: { value: 'Client / Designer Drawing' } });
  const file = new File(['%PDF-1.7'], 'A-201.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Drawing file'), { target: { files: [file] } });
}

describe('UploadDrawingModal (NW-002)', () => {
  beforeEach(() => {
    setContext();
    files.uploadFile.mockClear();
    files.filesAvailable.mockClear();
  });
  afterEach(cleanup);

  it('names the target project and uploads to its own id, not the header selection', async () => {
    render(<UploadDrawingModal isOpen onClose={() => {}} projectId="proj-db-segar" />);
    expect(screen.getByTestId('upload-target-project').textContent).toContain('Segar Mart Outlet 12');
    expect(field('uploadDrawingProject').value).toBe('proj-db-segar');
    fillRequired();
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(uploadDrawing).toHaveBeenCalled());
    expect(files.uploadFile).toHaveBeenCalledWith(expect.anything(), { purpose: 'drawing', projectId: 'proj-db-segar' });
    expect(uploadDrawing.mock.calls[0][0]).toMatchObject({ project_id: 'proj-db-segar', drawing_number: 'A-201', revision: 'Rev 0' });
  });

  it('defaults to the selected project when opened without one', () => {
    render(<UploadDrawingModal isOpen onClose={() => {}} />);
    expect(screen.getByTestId('upload-target-project').textContent).toContain('Unrelated Fit-out');
  });

  it('blocks the upload without a project, and never falls back to proj-1', async () => {
    setContext({ selectedProjectId: '' });
    render(<UploadDrawingModal isOpen onClose={() => {}} />);
    expect(screen.getByTestId('upload-target-project').textContent).toMatch(/No project selected/);
    fillRequired();
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId('upload-missing').textContent).toContain('project');
    fireEvent.submit(submit().closest('form')!);
    await waitFor(() => expect(screen.getByText(/Fill in: project/)).toBeTruthy());
    expect(files.uploadFile).not.toHaveBeenCalled();
    expect(uploadDrawing).not.toHaveBeenCalled();
  });

  it('treats a project id the user cannot see (or that does not exist) as no project', () => {
    setContext({ selectedProjectId: 'proj-1' });
    render(<UploadDrawingModal isOpen onClose={() => {}} />);
    expect(screen.getByTestId('upload-target-project').textContent).toMatch(/No project selected/);
    expect(field('uploadDrawingProject').value).toBe('');
    fillRequired();
    expect(submit().disabled).toBe(true);
  });

  it('starts with every required field empty and refuses to upload until each is filled', async () => {
    render(<UploadDrawingModal isOpen onClose={() => {}} projectId="proj-db-segar" />);
    for (const id of ['uploadDrawingNumber', 'uploadDrawingRevision', 'uploadDrawingCategory', 'uploadDrawingTitle', 'uploadDrawingType']) {
      expect(field(id).value, id).toBe('');
    }
    expect(submit().disabled).toBe(true);
    expect(screen.getByTestId('upload-missing').textContent).toBe('Still needed before upload: drawing number, revision, category, title, classification type.');
    fireEvent.submit(submit().closest('form')!);
    await waitFor(() => expect(screen.getByText(/^Fill in: drawing number/)).toBeTruthy());
    expect(files.uploadFile).not.toHaveBeenCalled();
    expect(uploadDrawing).not.toHaveBeenCalled();
  });

  it('shows the Quick Test Presets only in demo mode', () => {
    render(<UploadDrawingModal isOpen onClose={() => {}} projectId="proj-db-segar" />);
    expect(screen.queryByText(/Quick Test Presets/)).toBeNull();
    cleanup();
    setContext({ authMode: false });
    render(<UploadDrawingModal isOpen onClose={() => {}} projectId="proj-db-segar" />);
    expect(screen.getByText(/Quick Test Presets/)).toBeTruthy();
  });
});
