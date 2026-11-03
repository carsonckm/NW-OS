// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppUpdateNotice } from './AppUpdateNotice';

let workers: EventTarget & { controller: object | null };
const original = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker');
beforeEach(() => {
  workers = Object.assign(new EventTarget(), { controller: {} as object | null });
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers });
});
afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(navigator, 'serviceWorker', original);
  else Reflect.deleteProperty(navigator, 'serviceWorker');
});

describe('app update recovery', () => {
  it('offers an explicit reload for a replacement worker without discarding edits automatically', () => {
    const reload = vi.fn();
    render(<AppUpdateNotice busy={false} onReload={reload} />);
    expect(screen.queryByRole('status')).toBeNull();
    act(() => workers.dispatchEvent(new Event('controllerchange')));
    expect(screen.getByRole('status').textContent).toContain('new version');
    expect(reload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload updated app' }));
    expect(reload).toHaveBeenCalledOnce();
  });
  it('blocks reload while a save is in flight', () => {
    const reload = vi.fn();
    render(<AppUpdateNotice busy onReload={reload} />);
    act(() => workers.dispatchEvent(new Event('controllerchange')));
    const button = screen.getByRole('button', { name: 'Reload updated app' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(reload).not.toHaveBeenCalled();
  });
  it('does not prompt on the first service-worker installation', () => {
    workers.controller = null;
    render(<AppUpdateNotice busy={false} />);
    act(() => workers.dispatchEvent(new Event('controllerchange')));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
