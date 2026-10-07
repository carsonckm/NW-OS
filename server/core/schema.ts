import type { Client, Project, WorkItem, WorkPackage } from '../../src/types';

/**
 * How each field of a core-chain type is stored. The `Record<keyof T, ...>` annotations
 * make the compiler reject a type change (field added or removed in src/types.ts) that
 * isn't reflected here; a test checks these columns against the live database.
 *
 *  text  - required string (NOT NULL)          text? - optional string (NULL <-> absent)
 *  date  - required date the UI may leave blank ('' <-> NULL)
 *  date? - optional date (absent or '' -> NULL; NULL -> absent)
 *  num   - numeric                              int   - integer
 *  bool? - optional boolean                     json / json? - jsonb (required / optional)
 *  ts    - timestamptz, defaults to now()
 */
export type FieldKind = 'text' | 'text?' | 'date' | 'date?' | 'num' | 'int' | 'bool?' | 'json' | 'json?' | 'ts';

const clientFields: Record<keyof Client, FieldKind> = {
  id: 'text',
  client_type: 'text',
  company_name: 'text',
  registration_number: 'text',
  contact_person: 'text',
  email: 'text',
  phone: 'text',
  billing_address: 'text',
  notes: 'text?',
  created_at: 'ts',
  updated_at: 'ts',
};

const projectFields: Record<keyof Project, FieldKind> = {
  id: 'text',
  project_number: 'text',
  project_name: 'text',
  client_id: 'text',
  site_address: 'text',
  contract_value: 'num',
  project_status: 'text',
  risk_status: 'text?',
  start_date: 'date',
  end_date: 'date',
  signed_date: 'date',
  project_manager_id: 'text',
  site_supervisor_id: 'text',
  progress_percent: 'int',
  description: 'text',
  is_at_risk: 'bool?',
  risk_reason: 'text?',
  sensitivity: 'text', // NOT NULL; the server always sets it (Owner-only, default Normal)
  created_at: 'ts',
  updated_at: 'ts',
};

const workPackageFields: Record<keyof WorkPackage, FieldKind> = {
  id: 'text',
  project_id: 'text',
  name: 'text',
  category: 'text',
  trade: 'text?',
  contractor_id: 'text',
  project_manager_id: 'text',
  start_date: 'date',
  end_date: 'date',
  status: 'text',
  progress_percent: 'int',
  notes: 'text?',
  scope: 'text?',
  created_at: 'ts',
  updated_at: 'ts',
};

const workItemFields: Record<keyof WorkItem, FieldKind> = {
  id: 'text',
  work_package_id: 'text',
  project_id: 'text',
  item_code: 'text',
  description: 'text',
  location: 'text',
  quantity: 'num',
  unit: 'text',
  drawing_id: 'text',
  drawing_revision: 'text',
  source_drawing_revision_id: 'text?',
  client_drawing_id: 'text?',
  client_drawing_revision: 'text?',
  nw_production_drawing_id: 'text?',
  nw_production_drawing_revision: 'text?',
  production_instruction: 'json?',
  revision_impact_alert: 'json?',
  material: 'text',
  finish: 'text',
  dimensions: 'text',
  required_date: 'date',
  contractor_id: 'text',
  status: 'text',
  progress_percent: 'int',
  notes: 'text?',
  photos: 'json',
  item_photos: 'json?',
  production_order_id: 'text?',
  production_status: 'text',
  delivery_status: 'text',
  installation_status: 'text',
  scheduled_delivery_date: 'date?',
  scheduled_delivery_time: 'text?',
  received_delivery_date: 'text?',
  created_at: 'ts',
  updated_at: 'ts',
};

export interface EntityDef {
  /** Key used in API payloads (snapshot, sync, import). */
  key: CoreCollection;
  table: string;
  idPrefix: string;
  fields: Record<string, FieldKind>;
  /** Parent references, checked in import validation. */
  parents: { field: string; collection: CoreCollection }[];
}

export type CoreCollection = 'clients' | 'projects' | 'workPackages' | 'workItems';

export const ENTITIES: Record<CoreCollection, EntityDef> = {
  clients: { key: 'clients', table: 'clients', idPrefix: 'client', fields: clientFields, parents: [] },
  projects: {
    key: 'projects',
    table: 'projects',
    idPrefix: 'proj',
    fields: projectFields,
    parents: [{ field: 'client_id', collection: 'clients' }],
  },
  workPackages: {
    key: 'workPackages',
    table: 'work_packages',
    idPrefix: 'wp',
    fields: workPackageFields,
    parents: [{ field: 'project_id', collection: 'projects' }],
  },
  workItems: {
    key: 'workItems',
    table: 'work_items',
    idPrefix: 'wi',
    fields: workItemFields,
    parents: [
      { field: 'project_id', collection: 'projects' },
      { field: 'work_package_id', collection: 'workPackages' },
    ],
  },
};

/** Parent-first order; deletes run in reverse. */
export const COLLECTION_ORDER: CoreCollection[] = ['clients', 'projects', 'workPackages', 'workItems'];

export interface CoreData {
  clients: Client[];
  projects: Project[];
  workPackages: WorkPackage[];
  workItems: WorkItem[];
}

type Row = Record<string, unknown>;

/** Converts an API/app object to column values, dropping unknown keys. */
export function toRow(def: EntityDef, input: Row): Row {
  const row: Row = {};
  for (const [field, kind] of Object.entries(def.fields)) {
    if (!(field in input)) continue;
    const v = input[field];
    if (kind === 'date' || kind === 'date?') row[field] = v === '' || v === undefined ? null : v;
    else if (kind === 'json' || kind === 'json?') row[field] = v === undefined || v === null ? null : JSON.stringify(v);
    else row[field] = v === undefined ? null : v;
  }
  return row;
}

/** Converts a database row back to the app's shape. */
export function fromRow<T>(def: EntityDef, row: Row): T {
  const out: Row = {};
  for (const [field, kind] of Object.entries(def.fields)) {
    const v = row[field];
    if (kind === 'date') out[field] = v ?? '';
    else if (v === null || v === undefined) {
      if (kind === 'json') out[field] = [];
      // optional fields are omitted when NULL, matching `field?: T` in the types
    } else out[field] = v;
  }
  return out as T;
}
