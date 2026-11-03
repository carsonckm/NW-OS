import { describe, expect, it } from 'vitest';
import { deliveryHooks } from './hooks/delivery';

const stages = ['Loading', 'In Transit', 'Arrived at Site', 'Delivered', 'Received / Confirmed'];

function context(qc: { result: string; data: Record<string, boolean> } | null) {
  const queries: string[] = [];
  const h = {
    mode: 'create',
    ctx: { user: { role: 'Project Manager' }, can: () => true },
    db: { query: async (sql: string) => {
      queries.push(sql);
      if (sql.includes('FROM work_items')) return { rows: [{ id: 'item-1', project_id: 'proj-1' }] };
      if (sql.includes('FROM production_orders')) return { rows: [{ id: 'po-1', project_id: 'proj-1' }] };
      if (sql.includes('FROM factory_qc_inspections')) return { rows: qc ? [qc] : [] };
      return { rows: [] };
    } },
  };
  return { h, queries };
}

const checks = {
  dimensional_tolerance_pass: true,
  visual_inspection_pass: true,
  hardware_smoothness_pass: true,
  edge_banding_integrity_pass: true,
  grain_match_pass: true,
};
const delivery = (status: string) => ({
  id: 'del-1', project_id: 'proj-1', production_order_ids: ['po-1'],
  work_item_ids: [], status,
});

describe('Delivery dispatch Factory QC gate', () => {
  it('allows scheduling before QC', async () => {
    const { h } = context(null);
    await expect(deliveryHooks.beforeWrite!(h as any, undefined, delivery('Scheduled'))).resolves.toBeDefined();
  });

  for (const status of stages) {
    it(`rejects ${status} without passed QC`, async () => {
      const { h } = context(null);
      await expect(deliveryHooks.beforeWrite!(h as any, undefined, delivery(status))).rejects.toThrow(/passed Factory QC/);
    });
    it(`allows ${status} after passed QC`, async () => {
      const { h, queries } = context({ result: 'Passed', data: checks });
      await expect(deliveryHooks.beforeWrite!(h as any, undefined, delivery(status))).resolves.toBeDefined();
      expect(queries.some((sql) => sql.includes('FROM factory_qc_inspections'))).toBe(true);
    });
  }

  for (const status of stages) {
    it(`rejects work-item-only ${status} without associated order QC`, async () => {
      const { h } = context(null);
      await expect(deliveryHooks.beforeWrite!(h as any, undefined, {
        ...delivery(status), production_order_ids: [], work_item_ids: ['item-1'],
      })).rejects.toThrow(/passed Factory QC/);
    });
    it(`allows work-item-only ${status} with associated order QC`, async () => {
      const { h } = context({ result: 'Passed', data: checks });
      await expect(deliveryHooks.beforeWrite!(h as any, undefined, {
        ...delivery(status), production_order_ids: [], work_item_ids: ['item-1'],
      })).resolves.toBeDefined();
    });
  }

  it('rejects work-item-only dispatch when associated production order lacks QC', async () => {
    const { h } = context(null);
    await expect(deliveryHooks.beforeWrite!(h as any, undefined, {
      ...delivery('Loading'), production_order_ids: [], work_item_ids: ['item-1'],
    })).rejects.toThrow(/passed Factory QC/);
  });

  it('allows work-item-only dispatch when associated production order passes QC', async () => {
    const { h } = context({ result: 'Passed', data: checks });
    await expect(deliveryHooks.beforeWrite!(h as any, undefined, {
      ...delivery('Loading'), production_order_ids: [], work_item_ids: ['item-1'],
    })).resolves.toBeDefined();
  });

  it('rejects a failed checklist even if inspection result says Passed', async () => {
    const { h } = context({ result: 'Passed', data: { ...checks, grain_match_pass: false } });
    await expect(deliveryHooks.beforeWrite!(h as any, undefined, delivery('Loading'))).rejects.toThrow(/passed Factory QC/);
  });
});
