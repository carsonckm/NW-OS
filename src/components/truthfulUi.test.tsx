// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientDetailView } from './ClientDetailView';
import { DrawingViewer } from './DrawingViewer';
import { ContractorDashboard } from '../views/ContractorDashboard';
import { ClientDashboard } from '../views/ClientDashboard';

let context: any;
vi.mock('../context/NWContext', () => ({ useNW: () => context }));
vi.mock('../services/files', () => ({ filesAvailable: async () => false, isStoredFileUrl: (url: string) => url?.startsWith('/api/files/'), FILE_ACCEPT: { drawing: '.pdf' } }));
vi.mock('../services/authority', () => ({ useAuthority: () => ({ live: false, get: () => undefined }), authorityItem: (kind: string, id: string) => `${kind}:${id}` }));
vi.mock('./RecordFiles', () => ({ RecordFiles: () => null }));
vi.mock('./DecisionTrace', () => ({ DecisionTrace: () => null }));

beforeEach(() => {
  context = { currentUser: { id: 'synthetic-user', name: 'Synthetic reviewer', role: 'Client', client_id: 'c', contractor_id: 'con-test' }, projects: [{ id: 'p', client_id: 'c', project_name: 'Synthetic project', progress_percent: 0 }], clients: [{ id: 'c', company_name: 'Synthetic company' }], documents: [], auditLogs: [], workItems: [], workPackages: [], contractors: [], variations: [], selectedProject: { id: 'p', client_id: 'c', project_name: 'Synthetic project', progress_percent: 0 }, language: 'en' };
});
afterEach(cleanup);

describe('truthful record views', () => {
  it('starts a fresh client with no invented legal files, and filters real documents by client projects', () => {
    const client = { id: 'c', company_name: 'Synthetic company', client_type: 'Corporate', created_at: '2026-11-03', updated_at: '2026-11-03' } as any;
    const view = render(<ClientDetailView client={client} onBack={() => {}} onEditClient={() => {}} onNewProject={() => {}} />);
    fireEvent.click(screen.getByText('Documents (0)'));
    expect(screen.getByText('No documents recorded for this client.')).toBeTruthy();
    expect(screen.queryByText(/Master Framework/)).toBeNull();
    context.documents = [{ id: 'doc', project_id: 'p', title: 'Actual registered contract' }, { id: 'other-doc', project_id: 'other', title: 'Other client secret' }];
    view.rerender(<ClientDetailView client={client} onBack={() => {}} onEditClient={() => {}} onNewProject={() => {}} />);
    expect(screen.getByText('Actual registered contract')).toBeTruthy();
    expect(screen.queryByText('Other client secret')).toBeNull();
  });

  it('opens the exact requested revision and renders its stored file without invented instructions', () => {
    const drawing = { id: 'd', project_id: 'p', drawing_number: 'QA-D', current_revision_id: 'a', title: 'Synthetic', revisions: [{ id: 'a', revision: 'A', title: 'Revision A', file_url: '/api/files/a', approved_status: 'Draft' }, { id: 'b', revision: 'B', title: 'Revision B', file_url: '/api/files/b', approved_status: 'Draft' }] } as any;
    const view = render(<DrawingViewer drawing={drawing} initialRevisionId="b" />);
    expect(screen.getByTitle('Drawing QA-D B').getAttribute('src')).toBe('/api/files/b');
    expect(screen.queryByText(/APPROVED NW PRODUCTION METHOD/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Revision Impact & Work Item Check' }));
    expect(screen.queryByRole('button', { name: /Apply Plinth/ })).toBeNull();
    expect(screen.queryByText(/RM 4,200/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Drawing & Markups/ }));
    view.rerender(<DrawingViewer drawing={drawing} initialRevisionId="a" />);
    expect(screen.getByTitle('Drawing QA-D A').getAttribute('src')).toBe('/api/files/a');
  });

  it('includes package-owned contractor work and excludes the con-1 sample fallback', () => {
    context.workPackages = [{ id: 'wp', contractor_id: 'con-test' }];
    context.workItems = [{ id: 'mine', item_code: 'QA-PART', work_package_id: 'wp', contractor_id: '', description: 'Package-owned task', status: 'Draft', progress_percent: 0 }, { id: 'other', item_code: 'QA-OTHER', contractor_id: 'con-1', description: 'Wrong company', status: 'Draft', progress_percent: 0 }];
    render(<ContractorDashboard />);
    expect(screen.getAllByText(/Package-owned task/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Wrong company')).toBeNull();
  });

  it('counts only the selected client project', () => {
    context.workItems = [{ id: 'one', project_id: 'p', status: 'Completed' }, { id: 'two', project_id: 'other', status: 'Completed' }];
    render(<ClientDashboard />);
    expect(screen.getByText('1 of 1 items on site')).toBeTruthy();
    expect(screen.queryByText('Aurora Retail Sdn Bhd')).toBeNull();
  });
});
