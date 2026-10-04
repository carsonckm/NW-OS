import type { PermissionKey } from '../../src/types';
import { AccessContext, ForbiddenError } from '../auth/access';
import type { Pool } from '../db/pool';
import { CoreRepository, NotFoundError, ValidationError } from './repository';
import { COLLECTION_ORDER, type CoreCollection, type CoreData } from './schema';

type Row = Record<string, unknown>;

const VIEW: Record<CoreCollection, PermissionKey> = {
  clients: 'clients.view',
  projects: 'projects.view',
  workPackages: 'work_packages.view',
  workItems: 'work_items.view',
};

/**
 * Core-chain operations as one authenticated user. Every read is filtered to the
 * user's permissions and project scope; every write is authorised record by record.
 * Records outside the user's scope are reported as not found.
 */
export class CoreService {
  constructor(private repo: CoreRepository) {}

  static forPool(pool: Pool) {
    return new CoreService(new CoreRepository(pool));
  }

  private visible<T extends Row>(ctx: AccessContext, collection: CoreCollection, rows: T[]): T[] {
    if (!ctx.can(VIEW[collection])) return [];
    return rows.filter((r) => ctx.inScope(collection, r)).map((r) => ctx.redact(collection, r));
  }

  async list(ctx: AccessContext, collection: CoreCollection, filter: Record<string, string | undefined>) {
    ctx.require(VIEW[collection]);
    return this.visible(ctx, collection, await this.repo.list<Row>(collection, filter));
  }

  async get(ctx: AccessContext, collection: CoreCollection, id: string) {
    ctx.require(VIEW[collection]);
    const row = await this.repo.find<Row>(collection, id);
    if (!row || !ctx.inScope(collection, row)) throw new NotFoundError(collection, id);
    return ctx.redact(collection, row);
  }

  async create(ctx: AccessContext, collection: CoreCollection, input: Row) {
    if (typeof input.id === 'string' && (await this.repo.find(collection, input.id))) {
      throw new ForbiddenError(`${collection} ${input.id} already exists`);
    }
    const values = ctx.authorizeWrite(collection, undefined, await this.withPackageProject(ctx, collection, input))!;
    return ctx.redact(collection, await this.repo.create<Row>(collection, values));
  }

  /**
   * A work item may name only its package; resolve the project so scope can be checked.
   * Permission comes first, and an out-of-scope package reads as missing, so the
   * answer never reveals whether a package id exists.
   */
  private async withPackageProject(ctx: AccessContext, collection: CoreCollection, input: Row): Promise<Row> {
    if (collection !== 'workItems' || input.project_id || typeof input.work_package_id !== 'string') return input;
    ctx.require('work_items.create');
    const wp = await this.repo.find<Row>('workPackages', input.work_package_id);
    if (!wp || !ctx.inScope('workPackages', wp)) {
      throw new ValidationError(`work package ${input.work_package_id} does not exist`);
    }
    return { ...input, project_id: wp.project_id };
  }

  async update(ctx: AccessContext, collection: CoreCollection, id: string, patch: Row) {
    const existing = await this.repo.find<Row>(collection, id);
    if (!existing || !ctx.inScope(collection, existing)) throw new NotFoundError(collection, id);
    const values = ctx.authorizeWrite(collection, existing, patch)!;
    return ctx.redact(collection, await this.repo.update<Row>(collection, id, values));
  }

  async remove(ctx: AccessContext, collection: CoreCollection, id: string) {
    const existing = await this.repo.find<Row>(collection, id);
    if (!existing || !ctx.inScope(collection, existing)) throw new NotFoundError(collection, id);
    ctx.authorizeWrite(collection, existing, undefined);
    await this.repo.remove(collection, id);
  }

  async clientTree(ctx: AccessContext, clientId: string) {
    const client = await this.get(ctx, 'clients', clientId);
    // Plain records from here on: the visibility filters work on untyped rows.
    const tree = (await this.repo.clientTree(clientId)) as unknown as {
      projects: (Row & { work_packages: (Row & { work_items: Row[] })[] })[];
    };
    return {
      ...client,
      projects: this.visible(ctx, 'projects', tree.projects).map((p) => {
        const full = tree.projects.find((x) => x.id === p.id)!;
        return {
          ...p,
          work_packages: this.visible(ctx, 'workPackages', full.work_packages).map((wp) => ({
            ...wp,
            work_items: this.visible(
              ctx,
              'workItems',
              full.work_packages.find((x) => x.id === wp.id)!.work_items
            ),
          })),
        };
      }),
    };
  }

  async snapshot(ctx: AccessContext): Promise<CoreData> {
    const all = await this.repo.snapshot();
    const out = {} as Record<CoreCollection, Row[]>;
    for (const c of COLLECTION_ORDER) out[c] = this.visible(ctx, c, all[c] as unknown as Row[]);
    return out as unknown as CoreData;
  }

  applyChanges(
    ctx: AccessContext,
    changes: { upserts?: Partial<Record<CoreCollection, Row[]>>; deletes?: Partial<Record<CoreCollection, string[]>> }
  ) {
    return this.repo.applyChanges(changes, (collection, existing, incoming) => {
      if (existing && !ctx.inScope(collection, existing)) {
        throw new ForbiddenError(`${collection} ${String(existing.id)} not found or not accessible`);
      }
      return ctx.authorizeWrite(collection, existing, incoming);
    });
  }

  async importData(ctx: AccessContext, data: Partial<CoreData>, opts: { dryRun?: boolean }) {
    ctx.require('settings.manage');
    return this.repo.importData(data, opts);
  }

  async isEmpty() {
    const counts = await this.repo.counts();
    return Object.values(counts).every((n) => n === 0);
  }
}
