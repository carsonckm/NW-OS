// @vitest-environment jsdom
/**
 * QA batch 1: Quick Schedule creates a real delivery record. It asks for what the delivery
 * needs (nothing invented), keeps the form open with the server's reason when the save is
 * refused, reuses the same delivery id on a retry, and closes only once the delivery is saved.
 * With the database, an item's receipt is recorded on its delivery, not on the item.
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nw = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../context/NWContext', () => ({ useNW: () => nw.value }));
const navigation = vi.hoisted(() => ({ navigateTo: vi.fn() }));
vi.mock('../services/navigation', () => navigation);

import { DeliveryModal } from './DeliveryModal';

const workItem = { id: 'item-1', item_code: 'CAR-665', description: 'Counter', project_id: 'proj-1', work_package_id: 'wp-1', contractor_id: 'con-1', location: 'L1' } as never;
let scheduleDelivery: ReturnType<typeof vi.fn>;
let confirmDeliveryReceived: ReturnType<typeof vi.fn>;

function setContext(mode: 'database' | 'local' = 'database') {
  scheduleDelivery = vi.fn();
  confirmDeliveryReceived = vi.fn();
  nw.value = {
    currentUser: { name: 'Pat', role: 'Project Manager' },
    projects: [{ id: 'proj-1', project_name: 'Segar Mart Outlet 12', site_address: 'Lot 5, Jalan Ujian' }],
    contractors: [{ id: 'con-1', company_name: 'Hock Seng' }, { id: 'con-2', company_name: 'Other Co' }],
    scheduleDelivery,
    confirmDeliveryReceived,
    activateInstallation: vi.fn(),
    completeInstallation: vi.fn(),
    coreDataSync: { mode },
  };
}

const byId = (id: string) => document.getElementById(id) as HTMLInputElement;
const fill = () => {
  fireEvent.change(byId('quickDeliveryDate'), { target: { value: '2026-11-21' } });
  fireEvent.change(byId('quickDeliveryTime'), { target: { value: '9:00 AM' } });
  fireEvent.change(byId('quickDeliveryDriver'), { target: { value: 'Ahmad' } });
  fireEvent.change(byId('quickDeliveryContact'), { target: { value: '012-345' } });
  fireEvent.change(byId('quickDeliveryPlate'), { target: { value: 'WXY 1' } });
  fireEvent.change(byId('quickDeliveryVehicle'), { target: { value: '3-Ton Lorry' } });
  fireEvent.change(byId('quickDeliveryPackages'), { target: { value: '2' } });
};
const submit = () => screen.getByRole('button', { name: /Create Delivery|Saving/ }) as HTMLButtonElement;

describe('DeliveryModal Quick Schedule', () => {
  beforeEach(() => setContext());
  afterEach(cleanup);

  it('asks for the transport details (nothing invented) and offers only known facts', () => {
    render(<DeliveryModal isOpen onClose={() => {}} workItem={workItem} mode="schedule" />);
    expect((document.getElementById('quickDeliveryContractor') as HTMLSelectElement).value).toBe('con-1');
    expect(byId('quickDeliveryDestination').value).toBe('Lot 5, Jalan Ujian');
    for (const id of ['quickDeliveryDate', 'quickDeliveryTime', 'quickDeliveryDriver', 'quickDeliveryContact', 'quickDeliveryPlate', 'quickDeliveryVehicle', 'quickDeliveryPackages']) {
      expect(byId(id).value, id).toBe('');
    }
    expect(submit().disabled).toBe(true);
    expect(screen.getByText(/Still needed: delivery date, arrival time, driver name/)).toBeTruthy();
  });

  it('creates the delivery with what was entered and closes only when it is saved', async () => {
    scheduleDelivery.mockResolvedValue({ ok: true, record: { id: 'del-1' } });
    const onClose = vi.fn();
    render(<DeliveryModal isOpen onClose={onClose} workItem={workItem} mode="schedule" />);
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(scheduleDelivery).toHaveBeenCalledWith(
      'item-1',
      expect.objectContaining({ contractor_id: 'con-1', delivery_date: '2026-11-21', driver_name: 'Ahmad', vehicle_plate: 'WXY 1', package_count: 2, destination_site: 'Lot 5, Jalan Ujian' }),
      { id: expect.stringMatching(/^del-/) }
    );
  });

  it('keeps the form open with the server\'s reason when refused, and retries with the same delivery id', async () => {
    scheduleDelivery
      .mockResolvedValueOnce({ ok: false, uncertain: true, message: 'The server did not confirm the save (Bad gateway). Try again: it will not create a duplicate.' })
      .mockResolvedValueOnce({ ok: true, record: { id: 'del-1' } });
    const onClose = vi.fn();
    render(<DeliveryModal isOpen onClose={onClose} workItem={workItem} mode="schedule" />);
    fill();
    fireEvent.click(submit());
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/did not confirm the save/));
    expect(onClose).not.toHaveBeenCalled();
    expect(byId('quickDeliveryDriver').value).toBe('Ahmad'); // entries kept for correction
    fireEvent.click(submit());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [first, second] = scheduleDelivery.mock.calls.map((c) => c[2].id);
    expect(second).toBe(first);
  });

  it('does not submit twice while a save is in progress', async () => {
    let resolve: (v: unknown) => void = () => {};
    scheduleDelivery.mockReturnValue(new Promise((r) => (resolve = r)));
    render(<DeliveryModal isOpen onClose={() => {}} workItem={workItem} mode="schedule" />);
    fill();
    fireEvent.click(submit());
    fireEvent.click(submit());
    expect(scheduleDelivery).toHaveBeenCalledTimes(1);
    resolve({ ok: true, record: {} });
  });
});

describe('DeliveryModal receive', () => {
  afterEach(cleanup);

  it('with the database, points to the delivery\'s site receipt instead of setting the item', () => {
    setContext('database');
    render(<DeliveryModal isOpen onClose={() => {}} workItem={workItem} mode="receive" />);
    expect(screen.queryByRole('button', { name: /Confirm Delivery Received/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Open Delivery › Site Receiving/ }));
    expect(navigation.navigateTo).toHaveBeenCalledWith('delivery', 'proj-1');
    expect(confirmDeliveryReceived).not.toHaveBeenCalled();
  });
});
