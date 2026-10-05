/**
 * Operational calendar: the dated commitments in NW OS (task due dates, deliveries,
 * installation windows, production required dates, material needed-by dates, invoice due
 * dates, project handover dates) in one list. Every source is read through the DataService
 * with the user's own AccessContext, so module permissions, project scope, contractor and
 * client isolation and financial restrictions are exactly those of the screens. Nothing is
 * moved or promised here; it is a view of dates already recorded.
 */
import type { AccessContext } from '../auth/access';
import type { Pool } from '../db/pool';
import type { DataService } from './service';

type Row = Record<string, any>;
export interface CalendarEvent {
  id: string;
  date: string;
  type: 'task' | 'delivery' | 'installation_start' | 'installation_due' | 'production' | 'material' | 'invoice' | 'handover';
  title: string;
  status: string;
  project_id: string | null;
  project_name: string;
  person_id: string | null;
  person_name: string | null;
  role: string | null;
  tab: string;
  entity_type: string;
  entity_id: string;
  overdue: boolean;
}
export interface CalendarFilter {
  from?: string;
  to?: string;
  project_id?: string;
  person_id?: string;
  role?: string;
  status?: string;
  type?: string;
}

const DONE = new Set(['Completed', 'Cancelled', 'Closed', 'Delivered', 'Received / Confirmed', 'Paid', 'PO Created', 'Received', 'Ready for Delivery']);
const day = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : '');

/** Lists a module's records for this user, or nothing if they may not see that module. */
async function visible(service: DataService, ctx: AccessContext, key: string): Promise<Row[]> {
  try {
    return (await service.list(ctx, service.module(key), {})) as Row[];
  } catch {
    return [];
  }
}

export async function calendarFor(pool: Pool, service: DataService, ctx: AccessContext, f: CalendarFilter, now = new Date()): Promise<CalendarEvent[]> {
  const today = now.toISOString().slice(0, 10);
  const from = day(f.from) || new Date(now.getTime() - 14 * 86400_000).toISOString().slice(0, 10);
  const to = day(f.to) || new Date(now.getTime() + 45 * 86400_000).toISOString().slice(0, 10);
  const projects = new Map(
    (await pool.query('SELECT id, project_name, end_date, project_status, project_manager_id FROM projects')).rows.filter((p) => ctx.canSeeProject(p.id)).map((p) => [p.id as string, p])
  );
  const users = new Map((await pool.query('SELECT id, name, role FROM users')).rows.map((u) => [u.id as string, u]));
  const pname = (id: unknown) => (typeof id === 'string' ? projects.get(id)?.project_name ?? '' : '');
  const out: CalendarEvent[] = [];
  const push = (e: Omit<CalendarEvent, 'overdue' | 'project_name' | 'person_name' | 'role'> & { person_name?: string | null; role?: string | null }) => {
    if (!e.date) return;
    const person = e.person_id ? users.get(e.person_id) : undefined;
    out.push({ ...e, project_name: pname(e.project_id), person_name: e.person_name ?? person?.name ?? null, role: e.role ?? person?.role ?? null, overdue: e.date < today && !DONE.has(e.status) });
  };

  for (const t of await visible(service, ctx, 'tasks')) {
    push({ id: `task:${t.id}`, date: day(t.due_date), type: 'task', title: t.title, status: t.status, project_id: t.project_id ?? null, person_id: t.assigned_user_id ?? null, person_name: t.assigned_user_name, role: t.assigned_role, tab: 'automation', entity_type: 'task', entity_id: t.id });
  }
  for (const d of await visible(service, ctx, 'deliveryRecords')) {
    push({ id: `delivery:${d.id}`, date: day(d.delivery_date), type: 'delivery', title: `Delivery ${d.delivery_number ?? d.id}${d.contractor_name ? ` · ${d.contractor_name}` : ''}`, status: d.status, project_id: d.project_id, person_id: null, role: 'Contractor', tab: 'delivery', entity_type: 'delivery', entity_id: d.id });
  }
  for (const j of await visible(service, ctx, 'installationJobs')) {
    const base = { status: j.status, project_id: j.project_id, person_id: j.site_supervisor_id ?? null, tab: 'delivery', entity_type: 'installation', entity_id: j.id };
    push({ ...base, id: `inst-start:${j.id}`, date: day(j.planned_start_date), type: 'installation_start', title: `Install starts: ${j.work_item_code ?? j.job_number}` });
    push({ ...base, id: `inst-due:${j.id}`, date: day(j.planned_completion_date), type: 'installation_due', title: `Install due: ${j.work_item_code ?? j.job_number}` });
  }
  for (const o of await visible(service, ctx, 'productionOrders')) {
    push({ id: `prod:${o.id}`, date: day(o.required_date), type: 'production', title: `Production ${o.order_number ?? o.id} required (${o.work_item_code ?? ''})`, status: o.status, project_id: o.project_id, person_id: o.production_manager_id ?? null, tab: 'production', entity_type: 'production_order', entity_id: o.id });
  }
  for (const m of await visible(service, ctx, 'materialRequests')) {
    push({ id: `mr:${m.id}`, date: day(m.needed_by_date), type: 'material', title: `Material needed: ${m.material_name ?? m.id}`, status: m.status ?? 'Pending', project_id: m.project_id, person_id: null, role: 'Purchasing', tab: 'purchasing', entity_type: 'material_request', entity_id: m.id });
  }
  if (ctx.can('finance.view') || ctx.can('commercial.view')) {
    for (const i of await visible(service, ctx, 'commercialInvoices')) {
      push({ id: `inv:${i.id}`, date: day(i.due_date), type: 'invoice', title: `Invoice ${i.invoice_number ?? i.id} due${i.party_name ? ` · ${i.party_name}` : ''}`, status: i.status ?? '', project_id: i.project_id ?? null, person_id: null, role: 'Accountant', tab: 'commercial', entity_type: 'invoice', entity_id: i.id });
    }
  }
  for (const p of projects.values()) {
    push({ id: `handover:${p.id}`, date: day(p.end_date instanceof Date ? p.end_date.toISOString() : p.end_date), type: 'handover', title: `Planned completion: ${p.project_name}`, status: p.project_status, project_id: p.id, person_id: p.project_manager_id ?? null, tab: 'projects', entity_type: 'project', entity_id: p.id });
  }

  return out
    .filter((e) => (e.date >= from && e.date <= to) || (e.overdue && e.date < from && !f.from))
    .filter((e) => !f.project_id || e.project_id === f.project_id)
    .filter((e) => !f.person_id || e.person_id === f.person_id)
    .filter((e) => !f.role || e.role === f.role)
    .filter((e) => !f.type || e.type === f.type)
    .filter((e) => !f.status || (f.status === 'overdue' ? e.overdue : f.status === 'open' ? !DONE.has(e.status) : e.status === f.status))
    .sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type));
}
