/**
 * A work item's statuses have one source of truth each, and the overall status is derived
 * from them, so they cannot drift apart:
 *
 *   production_status    ← its current production order (latest non-cancelled)
 *   delivery_status      ← the latest delivery carrying it (receipt problems → Delivery Issue)
 *   installation_status  ← its current installation job; a failed latest site QC → Rectification
 *   status (overall)     ← derived from the three above and the latest site QC:
 *       Completed                 installation Completed and latest site QC passed (or none)
 *       QC Failed                 latest site QC failed
 *       Installation QC           installation Awaiting Inspection / QC
 *       Installation In Progress  installation In Progress / Rectification / Blocked / Delayed
 *       Delivered                 delivered to site, installation not started
 *       Ready for Delivery        production ready / delivery being arranged
 *       Blocked                   production blocked
 *       Ready for QC              production at factory QC
 *       In Progress               production running
 *   A field keeps the stored value only while its source record does not exist yet (e.g. an
 *   item not yet in production). Management states Draft, On Hold and Cancelled are kept.
 */
import type { Pool, PoolClient } from '../db/pool';

type Db = Pool | PoolClient;
type Row = Record<string, any>;

const KEEP = new Set(['Draft', 'On Hold', 'Cancelled']);
const RUNNING = new Set(['Cutting', 'CNC', 'Edge Banding', 'Assembly', 'Finishing', 'Packing', 'Material Ready']);
const QC_FAIL = 'Fail / Rectification Required';

function installationOf(jobStatus: string): string {
  switch (jobStatus) {
    case 'Site Ready':
    case 'Scheduled':
      return 'Scheduled';
    case 'Blocked':
    case 'Pending Information':
      return 'Pending / Blocked';
    case 'Not Started':
    case 'In Progress':
    case 'Awaiting Inspection':
    case 'QC':
    case 'Rectification':
    case 'Delayed':
    case 'Completed':
      return jobStatus;
    default:
      return 'Not Started';
  }
}

function deliveryOf(status: string): string {
  return status === 'Received / Confirmed' ? 'Delivered' : status;
}

/** The statuses this item should have, given its records (`base` = the stored or incoming item). */
export async function deriveWorkItem(db: Db, itemId: string, base: Row): Promise<Row> {
  const [order, delivery, job, qc] = await Promise.all([
    db.query(`SELECT status FROM production_orders WHERE work_item_id = $1 ORDER BY (status = 'Cancelled'), updated_at DESC, id DESC LIMIT 1`, [itemId]),
    db.query(
      `SELECT d.status, r.receipt_id, r.condition_status, r.damaged_quantity, r.missing_quantity FROM delivery_items i JOIN deliveries d ON d.id = i.delivery_id
       LEFT JOIN LATERAL (SELECT id AS receipt_id, condition_status, damaged_quantity, missing_quantity FROM delivery_receipts WHERE delivery_id = d.id ORDER BY received_at DESC LIMIT 1) r ON true
       WHERE i.work_item_id = $1 AND d.status <> 'Cancelled' ORDER BY d.updated_at DESC, d.id DESC LIMIT 1`,
      [itemId]
    ),
    db.query(`SELECT status FROM installation_jobs WHERE work_item_id = $1 ORDER BY (status = 'Cancelled'), updated_at DESC, id DESC LIMIT 1`, [itemId]),
    db.query(`SELECT result FROM site_qc_inspections WHERE work_item_id = $1 ORDER BY coalesce(inspected_at, '') DESC, created_at DESC, id DESC LIMIT 1`, [
      itemId,
    ]),
  ]);
  const out: Row = {};
  const production = order.rows[0]?.status ?? base.production_status;
  if (order.rows[0]) out.production_status = order.rows[0].status;

  let deliveryStatus = base.delivery_status;
  const d = delivery.rows[0];
  if (d) {
    // A site receipt settles it: received in order → Delivered, received with a problem → Delivery Issue.
    const problem =
      ['Short Quantity', 'Damaged', 'Wrong Item'].includes(d.condition_status) || Number(d.damaged_quantity) > 0 || Number(d.missing_quantity) > 0;
    deliveryStatus = d.receipt_id ? (problem ? 'Delivery Issue' : 'Delivered') : deliveryOf(d.status);
    out.delivery_status = deliveryStatus;
  }

  const qcResult: string | undefined = qc.rows[0]?.result;
  let installation = base.installation_status;
  if (job.rows[0] && job.rows[0].status !== 'Cancelled') installation = installationOf(job.rows[0].status);
  if (qcResult === QC_FAIL && installation !== 'Not Started') installation = 'Rectification';
  if (job.rows[0] || qcResult) out.installation_status = installation;

  // Overall status: only derived once the item is in production, delivery or installation.
  const hasSource = !!(order.rows[0] || d || job.rows[0] || qcResult);
  if (hasSource && !KEEP.has(String(base.status))) {
    let status: string | undefined;
    if (installation === 'Completed' && qcResult !== QC_FAIL) status = 'Completed';
    else if (qcResult === QC_FAIL) status = 'QC Failed';
    else if (['Awaiting Inspection', 'QC'].includes(installation)) status = 'Installation QC';
    else if (['In Progress', 'Rectification', 'Pending / Blocked', 'Delayed'].includes(installation)) status = 'Installation In Progress';
    else if (['Delivered', 'Arrived at Site'].includes(deliveryStatus)) status = 'Delivered';
    else if (
      production === 'Ready for Delivery' ||
      production === 'Completed' ||
      ['Scheduled', 'Loading', 'In Transit', 'Rescheduled', 'Delivery Issue'].includes(deliveryStatus)
    )
      status = 'Ready for Delivery';
    else if (production === 'Blocked') status = 'Blocked';
    else if (production === 'QC') status = 'Ready for QC';
    else if (RUNNING.has(production)) status = 'In Progress';
    if (status) {
      out.status = status;
      if (status === 'Completed') out.progress_percent = 100;
    }
  }
  return out;
}

/** Recomputes and stores an item's statuses (after a production, delivery, installation or QC write). */
export async function syncWorkItem(db: Db, itemId: string) {
  const item = (await db.query('SELECT * FROM work_items WHERE id = $1', [itemId])).rows[0];
  if (!item) return;
  const next = await deriveWorkItem(db, itemId, item);
  const changes = Object.entries(next).filter(([k, v]) => item[k] !== v);
  if (!changes.length) return;
  await db.query(`UPDATE work_items SET ${changes.map(([k], i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [
    itemId,
    ...changes.map(([, v]) => v),
  ]);
}
