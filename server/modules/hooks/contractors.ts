/**
 * The subcontractor register (migration 032). A record carries two read-only lists:
 *   assigned_project_ids  the explicit assignments (contractor_project_assignments), editable
 *   project_ids           those plus every project where the subcontractor already has work
 *                         (work packages, work items, installation jobs, production orders)
 * project_ids decides who sees the subcontractor (scope 'contractor'); both lists are cut down to
 * the reader's own projects. A writer changes only the assignments on projects they can see; the
 * others are kept. Subcontractors are deactivated (is_active false), never deleted.
 */
import { ForbiddenError } from '../../auth/access';
import { ValidationError } from '../../core/repository';
import type { Pool, PoolClient } from '../../db/pool';
import type { ModuleHooks, Row } from '../types';

type Db = Pool | PoolClient;

const strings = (v: unknown) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.trim() !== ''))] : []);

/** contractor id -> { explicit assignments, projects where it has work, all of them }. */
async function projectsOf(db: Db, ids: string[]) {
  const out = new Map<string, { assigned: string[]; work: string[]; all: string[] }>();
  if (!ids.length) return out;
  const rows = (
    await db.query(
      `SELECT contractor_id, project_id, bool_or(explicit) AS explicit, bool_or(NOT explicit) AS has_work FROM (
         SELECT contractor_id, project_id, true AS explicit FROM contractor_project_assignments WHERE contractor_id = ANY($1)
         UNION ALL SELECT contractor_id, project_id, false FROM work_packages WHERE contractor_id = ANY($1)
         UNION ALL SELECT contractor_id, project_id, false FROM work_items WHERE contractor_id = ANY($1)
         UNION ALL SELECT contractor_id, project_id, false FROM installation_jobs WHERE contractor_id = ANY($1)
         UNION ALL SELECT contractor_id, project_id, false FROM production_orders WHERE contractor_id = ANY($1)
       ) p WHERE project_id IS NOT NULL GROUP BY contractor_id, project_id ORDER BY contractor_id, project_id`,
      [ids]
    )
  ).rows as { contractor_id: string; project_id: string; explicit: boolean; has_work: boolean }[];
  for (const r of rows) {
    const e = out.get(r.contractor_id) ?? { assigned: [], work: [], all: [] };
    e.all.push(r.project_id);
    if (r.explicit) e.assigned.push(r.project_id);
    if (r.has_work) e.work.push(r.project_id);
    out.set(r.contractor_id, e);
  }
  return out;
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export const contractorHooks: ModuleHooks = {
  async hydrate(db, records) {
    const projects = await projectsOf(db, records.map((r) => String(r.id)));
    return records.map((r) => ({ ...r, assigned_project_ids: projects.get(String(r.id))?.assigned ?? [], project_ids: projects.get(String(r.id))?.all ?? [] }));
  },

  // The lists are derived from tables, never stored in the record.
  serialize(record) {
    const { assigned_project_ids: _a, project_ids: _p, ...rest } = record;
    return rest;
  },

  redact(ctx, record) {
    if (ctx.companyWide && ctx.user.role !== 'Contractor') return record;
    const mine = (v: unknown) => strings(v).filter((p) => ctx.canSeeProject(p));
    return { ...record, assigned_project_ids: mine(record.assigned_project_ids), project_ids: mine(record.project_ids) };
  },

  async beforeWrite(h, existing, incoming) {
    const company = text(incoming.company_name);
    if (!company) throw new ValidationError('A subcontractor needs a company name');
    const values: Row = {
      ...incoming,
      company_name: company,
      contact_person: text(incoming.contact_person),
      phone: text(incoming.phone, 60),
      email: text(incoming.email),
      trade: text(incoming.trade, 100),
      is_active: incoming.is_active !== false,
    };
    // Assignments: the writer changes only projects they can see; the rest are kept as they are.
    const before = strings(existing?.assigned_project_ids);
    const requested = 'assigned_project_ids' in incoming ? strings(incoming.assigned_project_ids) : before.filter((p) => h.ctx.canSeeProject(p));
    if (h.mode !== 'import') {
      const hidden = requested.filter((p) => !h.ctx.canSeeProject(p));
      if (hidden.length) throw new ForbiddenError(`You cannot assign a subcontractor to a project outside your scope: ${hidden.join(', ')}`);
    }
    const known = new Set((await h.db.query('SELECT id FROM projects WHERE id = ANY($1)', [requested])).rows.map((r) => r.id as string));
    const unknown = requested.filter((p) => !known.has(p));
    if (unknown.length) throw new ValidationError(`Unknown project: ${unknown.join(', ')}`);
    const assigned = [...new Set([...before.filter((p) => !h.ctx.canSeeProject(p)), ...requested])].sort();
    const work = (await projectsOf(h.db, [String(incoming.id)])).get(String(incoming.id))?.work ?? [];
    values.assigned_project_ids = assigned;
    values.project_ids = [...new Set([...assigned, ...work])].sort();
    return values;
  },

  async afterWrite(h, _existing, stored) {
    const id = String(stored.id);
    const assigned = strings(stored.assigned_project_ids);
    await h.db.query('DELETE FROM contractor_project_assignments WHERE contractor_id = $1 AND NOT (project_id = ANY($2))', [id, assigned]);
    for (const p of assigned) {
      await h.db.query(
        'INSERT INTO contractor_project_assignments (contractor_id, project_id, assigned_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [id, p, h.actor.id ?? null]
      );
    }
  },
};
