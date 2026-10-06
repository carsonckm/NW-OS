/**
 * Recurring problem detection: the same kind of problem showing up again and again in live
 * records (the last 180 days). Each pattern says what recurred, how often, on which
 * projects, with links to the examples, and suggests what a person might do — typically
 * write or apply an approved knowledge article. The detector never acts on its own: a person
 * records a decision (knowledge drafted, action taken, dismissed), and a pattern comes back
 * only if it keeps happening after that decision.
 *
 * Patterns are built only from records the asking user may see (project scope and module
 * permissions), so a pattern never reveals a project the user cannot open.
 */
import type { AccessContext } from '../auth/access';
import { ForbiddenError } from '../auth/access';
import type { Pool, PoolClient } from '../db/pool';
import type { PermissionKey } from '../../src/types';

type Db = Pool | PoolClient;
const WINDOW_DAYS = 180;

export interface Occurrence {
  type: string;
  id: string;
  project_id: string;
  tab: string;
  label: string;
  at: string;
}
export interface RecurringPattern {
  key: string;
  kind: 'issue_category' | 'site_qc_contractor' | 'factory_qc_check' | 'delivery_contractor' | 'supplier_receipts';
  title: string;
  occurrences: number;
  projects: string[];
  examples: Occurrence[];
  first_seen: string;
  last_seen: string;
  knowledge_category: string;
  suggestion: string;
  knowledge: { id: string; title: string; revision: number }[];
  review: null | { decision: string; note: string | null; decided_by: string; decided_at: string; occurrences: number; article_id: string | null };
  /** Open = never reviewed, or more occurrences since the last review. */
  open: boolean;
}

interface Scope {
  canSee: (projectId: string) => boolean;
  can: (perm: PermissionKey) => boolean;
}

const ISSUE_CATEGORY: Record<string, string> = { Drawing: 'Drawings', 'Drawing / Design': 'Drawings', 'Site condition': 'Site Problems', Material: 'Materials', Materials: 'Materials', Production: 'Production', Delivery: 'Site Problems', Installation: 'Installation', Contractor: 'Contractors', Client: 'Lessons Learned', Cost: 'Commercial', Variation: 'Commercial', Safety: 'Site Problems', Quality: 'QC', Supplier: 'Suppliers', Schedule: 'Lessons Learned' };
const QC_CHECKS: Record<string, string> = {
  dimensional_tolerance_pass: 'Dimensional tolerance',
  edge_banding_integrity_pass: 'Edge banding',
  grain_match_pass: 'Grain match',
  hardware_smoothness_pass: 'Hardware fitting',
  visual_inspection_pass: 'Visual finish',
};
const RECEIPT_PROBLEM = `(r.condition_status IN ('Short Quantity', 'Damaged', 'Wrong Item', 'Partially Rejected') OR r.damaged_quantity > 0 OR r.missing_quantity > 0)`;

/** Groups rows into patterns: 3+ occurrences, or 2+ on different projects. */
function group(rows: (Occurrence & { group: string; name: string })[], make: (g: string, name: string, n: number, projects: number) => Omit<RecurringPattern, 'occurrences' | 'projects' | 'examples' | 'first_seen' | 'last_seen' | 'knowledge' | 'review' | 'open'>) {
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.group, [...(by.get(r.group) ?? []), r]);
  const out: RecurringPattern[] = [];
  for (const [g, list] of by) {
    const projects = [...new Set(list.map((r) => r.project_id))];
    if (list.length < 3 && !(list.length >= 2 && projects.length >= 2)) continue;
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    out.push({
      ...make(g, list[0].name, list.length, projects.length),
      occurrences: list.length,
      projects,
      examples: sorted.slice(-5).reverse().map(({ group: _g, name: _n, ...o }) => o),
      first_seen: sorted[0].at,
      last_seen: sorted[sorted.length - 1].at,
      knowledge: [],
      review: null,
      open: true,
    });
  }
  return out;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''));

/** Detects patterns within a scope (a user's, or company-wide for automation). */
export async function detectRecurring(db: Db, scope: Scope): Promise<RecurringPattern[]> {
  const since = `now() - interval '${WINDOW_DAYS} days'`;
  const visible = <T extends { project_id: string }>(rows: T[]) => rows.filter((r) => r.project_id && scope.canSee(r.project_id));
  const patterns: RecurringPattern[] = [];

  if (scope.can('issues.view')) {
    const rows = visible((await db.query(`SELECT id, project_id, data->>'category' AS cat, data->>'title' AS title, created_at FROM issues WHERE created_at > ${since} AND coalesce(data->>'category', '') <> ''`)).rows);
    patterns.push(
      ...group(
        rows.map((r) => ({ group: r.cat, name: r.cat, type: 'issue', id: r.id, project_id: r.project_id, tab: 'issues', label: r.title ?? r.id, at: iso(r.created_at) })),
        (cat, _n, n, p) => ({ key: `issue:${cat}`, kind: 'issue_category', title: `${cat} issues keep recurring`, knowledge_category: ISSUE_CATEGORY[cat] ?? 'Lessons Learned', suggestion: `${n} ${cat.toLowerCase()} issues on ${p} project(s). Agree the root cause and capture the fix as an approved ${ISSUE_CATEGORY[cat] ?? 'Lessons Learned'} article, then check it before the next similar job.` })
      )
    );
  }
  if (scope.can('installation.view')) {
    const rows = visible(
      (
        await db.query(
          `SELECT q.id, q.project_id, q.created_at, j.contractor_id, coalesce(j.data->>'contractor_name', j.contractor_id) AS name, q.data->>'work_item_code' AS code
           FROM site_qc_inspections q JOIN installation_jobs j ON j.id = q.installation_job_id
           WHERE q.result = 'Fail / Rectification Required' AND q.created_at > ${since} AND j.contractor_id IS NOT NULL`
        )
      ).rows
    );
    patterns.push(
      ...group(
        rows.map((r) => ({ group: r.contractor_id, name: r.name, type: 'site_qc', id: r.id, project_id: r.project_id, tab: 'delivery', label: `Site QC failed${r.code ? ` (${r.code})` : ''}`, at: iso(r.created_at) })),
        (id, name, n, p) => ({ key: `site_qc_fail:contractor:${id}`, kind: 'site_qc_contractor', title: `${name}: repeated site QC failures`, knowledge_category: 'Contractors', suggestion: `${n} failed site inspections on ${p} project(s) for this contractor. Review the snags with them, and consider an installation checklist article they must follow.` })
      )
    );
  }
  if (scope.can('production.view')) {
    const rows = (
      await db.query(
        `SELECT f.id, f.created_at, f.data, o.project_id FROM factory_qc_inspections f JOIN production_orders o ON o.id = f.production_order_id
         WHERE f.result <> 'Passed' AND f.created_at > ${since}`
      )
    ).rows;
    const flat: (Occurrence & { group: string; name: string })[] = [];
    for (const r of visible(rows)) {
      for (const [field, label] of Object.entries(QC_CHECKS)) {
        if (r.data?.[field] === false) flat.push({ group: field, name: label, type: 'factory_qc', id: r.id, project_id: r.project_id, tab: 'production', label: `${r.data.production_order_number ?? r.id}: ${r.data.rework_reason ?? label}`, at: iso(r.created_at) });
      }
    }
    patterns.push(...group(flat, (field, label, n, p) => ({ key: `factory_qc:${field}`, kind: 'factory_qc_check', title: `Factory QC: ${label} failures recurring`, knowledge_category: 'QC', suggestion: `${n} factory QC reworks for ${label.toLowerCase()} on ${p} project(s). Check the machine / method and write the corrective procedure as an approved QC article.` })));
  }
  if (scope.can('delivery.view')) {
    const rows = visible(
      (
        await db.query(
          `SELECT r.id, r.delivery_id, d.project_id, r.received_at, r.condition_status, d.contractor_id, coalesce(d.data->>'contractor_name', d.contractor_id) AS name
           FROM delivery_receipts r JOIN deliveries d ON d.id = r.delivery_id
           WHERE ${RECEIPT_PROBLEM} AND r.received_at > ${since} AND d.contractor_id IS NOT NULL`
        )
      ).rows
    );
    patterns.push(
      ...group(
        rows.map((r) => ({ group: r.contractor_id, name: r.name, type: 'delivery', id: r.delivery_id, project_id: r.project_id, tab: 'delivery', label: `Delivery received: ${r.condition_status}`, at: iso(r.received_at) })),
        (id, name, n, p) => ({ key: `delivery:contractor:${id}`, kind: 'delivery_contractor', title: `${name}: deliveries arriving short or damaged`, knowledge_category: 'Contractors', suggestion: `${n} problem deliveries on ${p} project(s). Agree a packing / loading checklist with the contractor and record it as an approved article.` })
      )
    );
  }
  if (scope.can('purchasing.view')) {
    const rows = visible(
      (
        await db.query(
          `SELECT g.id, g.project_id, g.created_at, g.supplier_id, coalesce(s.data->>'name', g.supplier_id) AS name, g.data->>'condition' AS condition
           FROM goods_received g LEFT JOIN suppliers s ON s.id = g.supplier_id
           WHERE coalesce(g.data->>'condition', 'Good') <> 'Good' AND g.created_at > ${since} AND g.supplier_id IS NOT NULL`
        )
      ).rows
    );
    patterns.push(
      ...group(
        rows.map((r) => ({ group: r.supplier_id, name: r.name, type: 'goods_received', id: r.id, project_id: r.project_id, tab: 'purchasing', label: `Goods received: ${r.condition}`, at: iso(r.created_at) })),
        (id, name, n, p) => ({ key: `supplier:${id}`, kind: 'supplier_receipts', title: `${name}: repeated short / damaged supplies`, knowledge_category: 'Suppliers', suggestion: `${n} problem receipts on ${p} project(s) from this supplier. Raise it with the supplier and note the lesson (lead time, buffer quantity or alternative supplier) as an approved Suppliers article.` })
      )
    );
  }

  if (!patterns.length) return patterns;
  // Approved knowledge already covering the category, and the latest human decision.
  const articles = (await db.query(`SELECT id, data->>'title' AS title, category, revision FROM knowledge_articles WHERE status = 'Approved'`)).rows;
  const reviews = new Map((await db.query('SELECT * FROM recurring_problem_reviews WHERE pattern_key = ANY($1)', [patterns.map((p) => p.key)])).rows.map((r) => [r.pattern_key, r]));
  for (const p of patterns) {
    p.knowledge = articles.filter((a) => a.category === p.knowledge_category).map((a) => ({ id: a.id, title: a.title, revision: a.revision }));
    const r = reviews.get(p.key);
    if (r) {
      p.review = { decision: r.decision, note: r.note, decided_by: r.decided_by, decided_at: iso(r.decided_at), occurrences: r.occurrences, article_id: r.article_id };
      p.open = p.occurrences > r.occurrences;
    }
  }
  return patterns.sort((a, b) => Number(b.open) - Number(a.open) || b.occurrences - a.occurrences);
}

/** Patterns for a signed-in user (NW staff only). */
export async function recurringFor(pool: Pool, ctx: AccessContext) {
  if (['Client', 'Contractor'].includes(ctx.user.role)) throw new ForbiddenError('Recurring problem analysis is for NW staff');
  return detectRecurring(pool, { canSee: (id) => ctx.canSeeProject(id), can: (p) => ctx.can(p) });
}
