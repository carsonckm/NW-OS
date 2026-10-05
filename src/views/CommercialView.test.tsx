// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoData } from '../../server/modules/demo';
import { NWProvider } from '../context/NWContext';
import type { ServerFinancials } from '../services/coreApi';
import { CommercialView } from './CommercialView';

// Figures the server computes for proj-1. They differ from every figure the browser's demo
// baseline holds (contract 530,000, committed 280,000, actual 250,000...).
const SERVER: ServerFinancials = {
  project_id: 'proj-1',
  original_contract_value: 1480000,
  approved_variations_total: 12000,
  approved_variations_count: 1,
  current_contract_value: 1492000,
  pending_variations_total: 3500,
  pending_variations_count: 1,
  selling_price: 1492000,
  estimated_final_revenue: 1495500,
  estimated_direct_cost: 350000,
  committed_cost: 123456,
  actual_cost: 65432,
  forecast_final_cost: 371717,
  cost_variance: 21717,
  cost_variance_status: 'Minor Variance',
  current_gross_profit: 1426568,
  project_gross_profit: 1120283,
  project_gross_margin_percent: 75.09,
};

const tile = (label: string) => screen.getByText(label).parentElement as HTMLElement;

describe('CommercialView figures', () => {
  let profitabilityCalls = 0;

  beforeEach(() => {
    localStorage.clear();
    profitabilityCalls = 0;
    // A server in database mode: status, the data snapshot, and the profitability report.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
        if (url.endsWith('/api/core/status')) return ok({ configured: true, connected: true, dataSource: 'database', authEnabled: true, pendingMigrations: [] });
        if (url.endsWith('/api/data/status')) return ok({ databaseEmpty: false });
        if (url.endsWith('/api/data/snapshot')) return ok(demoData());
        if (url.includes('/api/projects/proj-1/profitability')) {
          profitabilityCalls++;
          return ok(SERVER);
        }
        return new Response(JSON.stringify({ error: 'not_found' }), { status: 404 });
      })
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the server profitability values, not the browser-calculated baseline', async () => {
    render(
      <NWProvider>
        <CommercialView />
      </NWProvider>
    );
    await waitFor(() => expect(within(tile('3. Committed Cost')).getByText('RM 123,456')).toBeTruthy());
    expect(profitabilityCalls).toBeGreaterThan(0);
    expect(within(tile('1. Contract Value')).getByText('RM 1,492,000')).toBeTruthy();
    expect(within(tile('1. Contract Value')).getByText(/Orig \+ RM 12,000 VO/)).toBeTruthy();
    expect(within(tile('4. Actual Cost')).getByText('RM 65,432')).toBeTruthy();
    expect(within(tile('5. Forecast Cost')).getByText('RM 371,717')).toBeTruthy();
    expect(within(tile('8. Forecast Profit')).getByText('RM 1,120,283')).toBeTruthy();
    // The browser's own baseline figures for proj-1 are not shown as the official totals.
    expect(screen.queryByText('RM 280,000')).toBeNull();
    expect(screen.queryByText('RM 530,000')).toBeNull();
  });

  it('shows the browser preview only in demo mode, where there is no server', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ configured: false, connected: false, dataSource: 'local', authEnabled: false, pendingMigrations: [] }), { status: 200 }))
    );
    render(
      <NWProvider>
        <CommercialView />
      </NWProvider>
    );
    await waitFor(() => expect(within(tile('3. Committed Cost')).getByText('RM 280,000')).toBeTruthy());
    expect(profitabilityCalls).toBe(0);
  });
});
