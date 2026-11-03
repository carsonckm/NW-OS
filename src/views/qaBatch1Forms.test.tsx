// @vitest-environment jsdom
/**
 * QA batch 1, through the real screens and app context in database mode (server stubbed):
 * the delivery form starts empty, resets its dependent choices when the project or package
 * changes and offers only that package's items; the production order form invents nothing.
 * Both stay open with the server's reason when a save is refused, and retry with the same id.
 */
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_CLIENTS, INITIAL_CONTRACTORS, INITIAL_PROJECTS, INITIAL_WORK_ITEMS, INITIAL_WORK_PACKAGES } from '../data/initialData';
import { NWProvider, useNW } from '../context/NWContext';
import { DeliveryView } from './DeliveryView';
import { ProductionView } from './ProductionView';

type Rec = Record<string, unknown>;
let syncAnswers: { status: number; body: Rec }[];
let syncBodies: { upserts: Record<string, Rec[]> }[];
let ready = false;
let selectedProject = "";
let latestNW: ReturnType<typeof useNW>;

function ModeProbe() {
  const nw = useNW();
  ready = nw.coreDataSync.mode === 'database';
  selectedProject = nw.selectedProjectId;
  latestNW = nw;
  return null;
}

beforeEach(() => {
  localStorage.clear();
  syncBodies = [];
  syncAnswers = [];
  ready = false;
  const snapshot = { clients: INITIAL_CLIENTS, projects: INITIAL_PROJECTS, workPackages: INITIAL_WORK_PACKAGES, workItems: INITIAL_WORK_ITEMS, contractors: INITIAL_CONTRACTORS, productionOrders: [], deliveryRecords: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.split('?')[0];
      const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (path === '/api/core/status') return reply(200, { dataSource: 'database' });
      if (path === '/api/data/snapshot') return reply(200, snapshot);
      if (path === '/api/data/status') return reply(200, { databaseEmpty: false, importAllowed: false });
      if (path === '/api/data/sync') {
        syncBodies.push(JSON.parse(String(init?.body)));
        const answer = syncAnswers.shift() ?? { status: 200, body: {} };
        return reply(answer.status, answer.body);
      }
      return reply(404, { error: 'not_found', message: 'not found' });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const mount = async (view: React.ReactElement) => {
  render(
    <NWProvider>
      <ModeProbe />
      {view}
    </NWProvider>
  );
  await waitFor(() => expect(ready).toBe(true));
};
const select = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const inputAfter = (labelText: string) => screen.getByText(labelText).parentElement!.querySelector('input, textarea') as HTMLInputElement;

describe('Arrange Delivery form', () => {
  const fillTransport = () => {
    const contractor = select('Responsible Contractor');
    fireEvent.change(contractor, { target: { value: (contractor.options[1] as HTMLOptionElement).value } });
    fireEvent.change(inputAfter('Driver Name'), { target: { value: 'Ahmad' } });
    fireEvent.change(inputAfter('Driver Contact Number'), { target: { value: '012' } });
    fireEvent.change(inputAfter('Vehicle Plate Number'), { target: { value: 'WXY 1' } });
    fireEvent.change(inputAfter('Vehicle Type'), { target: { value: 'Lorry' } });
    fireEvent.change(inputAfter('Delivery Date'), { target: { value: '2026-11-20' } });
    fireEvent.change(inputAfter('Delivery Time Slot'), { target: { value: '10:00 AM' } });
    fireEvent.change(inputAfter('Estimated Arrival at Site'), { target: { value: '11:00 AM' } });
    fireEvent.change(inputAfter('Package Count'), { target: { value: '2' } });
  };
  const itemBoxes = () => within(screen.getByText('Work Items on this Delivery').parentElement!).queryAllByRole('checkbox') as HTMLInputElement[];

  it('starts empty and resets the package and items when the project or package changes; only that package\'s items are offered', async () => {
    await mount(<DeliveryView />);
    fireEvent.click(screen.getByRole('button', { name: /Arrange Delivery/ }));
    expect(select('Project').value).toBe('');
    expect(select('Work Package').disabled).toBe(true);
    expect(inputAfter('Driver Name').value).toBe('');
    expect(screen.getByText('Select the project and work package first.')).toBeTruthy();

    fireEvent.change(select('Project'), { target: { value: 'proj-1' } });
    fireEvent.change(select('Work Package'), { target: { value: 'wp-1' } });
    const offered = within(screen.getByText('Work Items on this Delivery').parentElement!).getAllByText(/^(CAR|GLS|MET|ELE)-/).map((n) => n.textContent);
    const wp1Codes = INITIAL_WORK_ITEMS.filter((w) => w.work_package_id === 'wp-1').map((w) => w.item_code);
    expect(offered.sort()).toEqual([...wp1Codes].sort());
    fireEvent.click(itemBoxes()[0]);
    expect(itemBoxes()[0].checked).toBe(true);

    // Another package: the chosen items are cleared.
    fireEvent.change(select('Work Package'), { target: { value: 'wp-2' } });
    expect(itemBoxes().every((b) => !b.checked)).toBe(true);
    // Another project: the package is cleared too, and no item of the old project remains.
    fireEvent.click(itemBoxes()[0]);
    fireEvent.change(select('Project'), { target: { value: 'proj-2' } });
    expect(select('Work Package').value).toBe('');
    expect(itemBoxes()).toHaveLength(0);
  });

  it('a refused delivery keeps the form open with the server\'s reason, adds nothing, and the retry reuses the same id', async () => {
    await mount(<DeliveryView />);
    fireEvent.click(screen.getByRole('button', { name: /Arrange Delivery/ }));
    fireEvent.change(select('Project'), { target: { value: 'proj-1' } });
    fireEvent.change(select('Work Package'), { target: { value: 'wp-1' } });
    fireEvent.click(itemBoxes()[0]);
    fillTransport();
    syncAnswers = [{ status: 400, body: { error: 'validation_error', message: 'Delivery work item item-x is on another project' } }];
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save & Schedule Delivery/ }));
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Delivery work item item-x is on another project'));
    expect(select('Project').value).toBe('proj-1'); // still open, entries kept
    expect(syncBodies).toHaveLength(1);
    expect(Object.keys(syncBodies[0].upserts)).toEqual(['deliveryRecords']);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Save & Schedule Delivery/ }));
    });
    await waitFor(() => expect(screen.queryByText('Work Items on this Delivery')).toBeNull()); // saved: closed
    const ids = syncBodies.map((b) => b.upserts.deliveryRecords[0].id);
    expect(ids[1]).toBe(ids[0]);
    expect(syncBodies[0].upserts.deliveryRecords[0]).toMatchObject({ project_id: 'proj-1', work_package_id: 'wp-1', driver_name: 'Ahmad' });
  });
});

describe('Production order form', () => {
  const openCreate = () => fireEvent.click(screen.getAllByRole('button', { name: /New Order/ })[0]);

  it('pre-chooses nothing, requires the method and date, and sends only the work item\'s and project\'s real values', async () => {
    await mount(<ProductionView />);
    openCreate();
    expect(select('Select Approved Work Item').value).toBe('');
    const issue = screen.getByRole('button', { name: /Issue Production Order/ }) as HTMLButtonElement;
    expect(issue.disabled).toBe(true);

    const item = INITIAL_WORK_ITEMS[0];
    fireEvent.change(select('Select Approved Work Item'), { target: { value: item.id } });
    expect(screen.getByText(/Still needed: production method, factory target date/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Approved Production Method'), { target: { value: 'NW-PM-Counter-001 Rev 2' } });
    fireEvent.change(screen.getByLabelText('Factory Target Completion Date'), { target: { value: '2026-12-01' } });
    syncAnswers = [{ status: 400, body: { error: 'validation_error', message: 'Production must use an approved, current drawing revision: client revision Rev 3 is not approved (Draft)' } }];
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Issue Production Order/ }));
    });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/approved, current drawing revision/));
    expect(select('Select Approved Work Item').value).toBe(item.id); // still open

    const sent = syncBodies[0].upserts;
    expect(Object.keys(sent)).toEqual(['productionOrders']); // no work item link from the browser
    const project = INITIAL_PROJECTS.find((p) => p.id === item.project_id)!;
    expect(sent.productionOrders[0]).toMatchObject({
      work_item_id: item.id,
      project_name: project.project_name,
      project_number: project.project_number,
      work_package_name: INITIAL_WORK_PACKAGES.find((wp) => wp.id === item.work_package_id)!.name,
      approved_client_drawing_id: item.client_drawing_id,
      approved_nw_production_drawing_id: item.nw_production_drawing_id,
      production_method: 'NW-PM-Counter-001 Rev 2',
      required_date: '2026-12-01',
    });
    expect(sent.productionOrders[0].production_manager_id).not.toBe('user-prod-mgr');

    // Retry after correction: the same order id, so no duplicate.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Issue Production Order/ }));
    });
    await waitFor(() => expect(screen.queryByLabelText('Approved Production Method')).toBeNull());
    expect(syncBodies[1].upserts.productionOrders[0].id).toBe(sent.productionOrders[0].id);
  });

  it('blocks a work item without approved drawings instead of filling in sample drawings', async () => {
    await mount(<ProductionView />);
    openCreate();
    const bare = INITIAL_WORK_ITEMS.find((w) => !w.nw_production_drawing_id);
    if (!bare) return; // every demo item has drawings
    fireEvent.change(select('Select Approved Work Item'), { target: { value: bare.id } });
    expect(screen.getByText(/an approved NW production drawing on the work item/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /Issue Production Order/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});


it('restores the selected project only after the authoritative snapshot loads', async () => {
  localStorage.setItem('nw_os_selected_project', 'remembered-project');
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/data/snapshot') return new Response(JSON.stringify({ clients: INITIAL_CLIENTS, projects: [{ ...INITIAL_PROJECTS[0], id: 'remembered-project' }], workPackages: [], workItems: [] }), { status: 200 });
    return originalFetch(url, init);
  }));
  await mount(<div />);
  expect(selectedProject).toBe('remembered-project');
});


it('never invents engineering data after live AI errors, or changes work items on comparison', async () => {
  await mount(<div />);
  const before = JSON.stringify({ items: latestNW.workItems, drawings: latestNW.drawings });
  await expect(latestNW.analyzeDrawingWithAI('d', 'r')).rejects.toThrow(/404/);
  await expect(latestNW.compareDrawingRevisions('d', 'a', 'b')).rejects.toThrow(/404/);
  const originalFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/ai/compare-drawings') return new Response(JSON.stringify({ from_revision: 'A', to_revision: 'B', affected_work_items: [{ item_code: INITIAL_WORK_ITEMS[0].item_code, action_needed: 'Review' }], impact_check: { has_production_impact: true, requires_site_action: true } }), { status: 200 });
    return originalFetch(url, init);
  }));
  await act(async () => { await latestNW.compareDrawingRevisions('d', 'a', 'b'); });
  expect(JSON.stringify({ items: latestNW.workItems, drawings: latestNW.drawings })).toBe(before);
  expect(syncBodies).toEqual([]);
});
