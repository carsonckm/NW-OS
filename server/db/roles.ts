/**
 * Database privilege separation (Phase 6 Batch 10). See docs/database-privileges.md.
 *
 *   nwos_owner     NOLOGIN. Owns the schema and every table, sequence, function and trigger.
 *   nwos_migrator  LOGIN, member of nwos_owner. Runs migrations (as nwos_owner) — never the app.
 *   nwos_app       LOGIN, NOINHERIT, member of nothing. What the running server connects as:
 *                  row reads and writes only, granted table by table.
 *
 * The runtime role owns nothing and holds no grant option, so it cannot disable or replace a
 * trigger, redefine a function, drop or alter a table, grant privileges or assume another role.
 * Append-only history additionally loses UPDATE / DELETE at the privilege level, so the database
 * refuses a change before the trigger is even reached (the triggers stay as a second layer).
 *
 * Everything here is idempotent: bootstrap and grants can be re-run safely.
 */
import type { Pool, PoolClient } from './pool';
import { writeAudit } from '../audit';

type Db = Pool | PoolClient;

export interface RoleNames {
  owner: string;
  migrator: string;
  app: string;
}

export const DEFAULT_ROLES: RoleNames = { owner: 'nwos_owner', migrator: 'nwos_migrator', app: 'nwos_app' };

/** History tables: the application may read and append, never change or remove. */
export const APPEND_ONLY_TABLES = ['audit_logs', 'owner_exception_events', 'delivery_receipts'];
/** Records the application updates but never deletes (their triggers refuse deletes too). */
export const NO_DELETE_TABLES = ['owner_exception_states', 'owner_exception_snoozes', 'drawing_revisions'];
/** Managed by the migrator only. */
export const READ_ONLY_TABLES = ['schema_migrations'];

const NAME = /^[a-z_][a-z0-9_]{0,62}$/;
export function roleNamesFromEnv(env: NodeJS.ProcessEnv = process.env): RoleNames {
  const roles = {
    owner: env.NWOS_DB_OWNER_ROLE?.trim() || DEFAULT_ROLES.owner,
    migrator: env.NWOS_DB_MIGRATOR_ROLE?.trim() || DEFAULT_ROLES.migrator,
    app: env.NWOS_DB_APP_ROLE?.trim() || DEFAULT_ROLES.app,
  };
  for (const r of Object.values(roles)) if (!NAME.test(r)) throw new Error(`Invalid database role name "${r}"`);
  if (new Set(Object.values(roles)).size !== 3) throw new Error('The owner, migrator and app database roles must be three different roles');
  return roles;
}

/** A quoted SQL identifier (role, schema or table name). */
export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

export async function roleExists(db: Db, role: string) {
  return (await db.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount === 1;
}

/**
 * The runtime grants. Run as the owner role (the migrator after migrations, or the bootstrap).
 * Resets the app role's table privileges, then grants exactly what the server needs.
 */
export async function applyRuntimeGrants(db: Db, schema: string, roles: RoleNames) {
  const s = ident(schema);
  const app = ident(roles.app);
  const owner = ident(roles.owner);
  const tables = (await db.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`, [schema])).rows.map((r) => r.relname as string);
  const has = (t: string) => tables.includes(t);
  const list = (names: string[]) => names.filter(has).map((t) => `${s}.${ident(t)}`).join(', ');
  const stmts = [
    `REVOKE CREATE ON SCHEMA ${s} FROM PUBLIC`,
    `GRANT USAGE ON SCHEMA ${s} TO ${app}`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM PUBLIC`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${app}`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${app}`,
    APPEND_ONLY_TABLES.some(has) && `REVOKE UPDATE, DELETE ON ${list(APPEND_ONLY_TABLES)} FROM ${app}`,
    NO_DELETE_TABLES.some(has) && `REVOKE DELETE ON ${list(NO_DELETE_TABLES)} FROM ${app}`,
    READ_ONLY_TABLES.some(has) && `REVOKE INSERT, UPDATE, DELETE ON ${list(READ_ONLY_TABLES)} FROM ${app}`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM PUBLIC`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM ${app}`,
    `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${app}`,
    // Trigger functions fire without EXECUTE; nobody else needs to call them.
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM PUBLIC`,
    `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ${s} FROM ${app}`,
    // Objects future migrations create (as the owner) get the same treatment.
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${app}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${owner} IN SCHEMA ${s} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
  ].filter(Boolean) as string[];
  for (const q of stmts) await db.query(q);
}

export interface PrivilegeReport {
  user: string;
  schema: string;
  issues: string[];
}

/**
 * The effective privileges of the connected user, through every inherited or SET ROLE-able
 * membership (pg_has_role … 'MEMBER'), not just its name. An empty `issues` list means it is
 * a restricted runtime role: it cannot bypass, disable or redefine the database protections.
 */
export async function runtimePrivilegeReport(db: Db, schema?: string): Promise<PrivilegeReport> {
  const who = (await db.query(`SELECT current_user AS u, current_schema() AS s, current_database() AS d`)).rows[0];
  const sch: string = schema ?? who.s ?? 'public';
  const issues: string[] = [];
  const r = (await db.query(`SELECT rolsuper, rolcreaterole, rolcreatedb, rolbypassrls, rolreplication FROM pg_roles WHERE rolname = current_user`)).rows[0];
  if (r.rolsuper) issues.push('is a superuser');
  if (r.rolcreaterole) issues.push('can create roles (CREATEROLE)');
  if (r.rolcreatedb) issues.push('can create databases (CREATEDB)');
  if (r.rolbypassrls) issues.push('bypasses row-level security (BYPASSRLS)');
  if (r.rolreplication) issues.push('has REPLICATION');
  const member = (await db.query(`SELECT r.rolname FROM pg_roles r WHERE r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER') ORDER BY 1`)).rows.map((x) => x.rolname as string);
  if (member.length) issues.push(`can act as other roles: ${member.join(', ')}`);
  const owned = (await db.query(
    `SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1 AND pg_has_role(current_user, c.relowner, 'MEMBER')`, [sch])).rows[0].n;
  if (owned) issues.push(`owns ${owned} table(s) / sequence(s) / index(es) in schema ${sch} (could disable triggers, alter or drop them)`);
  const fns = (await db.query(
    `SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = $1 AND pg_has_role(current_user, p.proowner, 'MEMBER')`, [sch])).rows[0].n;
  if (fns) issues.push(`owns ${fns} function(s) in schema ${sch} (could redefine protection functions)`);
  const so = (await db.query(`SELECT pg_has_role(current_user, nspowner, 'MEMBER') AS own, has_schema_privilege(current_user, oid, 'CREATE') AS create FROM pg_namespace WHERE nspname = $1`, [sch])).rows[0];
  if (so?.own) issues.push(`owns schema ${sch} (could drop any object in it)`);
  else if (so?.create) issues.push(`can create objects in schema ${sch}`);
  const dbo = (await db.query(`SELECT pg_has_role(current_user, datdba, 'MEMBER') AS own, has_database_privilege(current_user, oid, 'CREATE') AS create FROM pg_database WHERE datname = current_database()`)).rows[0];
  if (dbo.own) issues.push(`owns database ${who.d}`);
  else if (dbo.create) issues.push(`can create schemas in database ${who.d} (could shadow tables through search_path)`);
  const grantable = (await db.query(
    `SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE table_schema = $1 AND grantee = current_user AND is_grantable = 'YES'`, [sch])).rows[0].n;
  if (grantable) issues.push(`holds ${grantable} privilege(s) WITH GRANT OPTION`);
  const tables = (await db.query(`SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')`, [sch])).rows;
  for (const t of tables) {
    const p = (await db.query(`SELECT has_table_privilege(current_user, $1::oid, 'TRUNCATE') AS tr, has_table_privilege(current_user, $1::oid, 'TRIGGER') AS tg, has_table_privilege(current_user, $1::oid, 'REFERENCES') AS rf, has_table_privilege(current_user, $1::oid, 'UPDATE') AS up, has_table_privilege(current_user, $1::oid, 'DELETE') AS de, has_table_privilege(current_user, $1::oid, 'INSERT') AS ins`, [t.oid])).rows[0];
    if (p.tr || p.tg || p.rf) issues.push(`has ${[p.tr && 'TRUNCATE', p.tg && 'TRIGGER', p.rf && 'REFERENCES'].filter(Boolean).join('/')} on ${t.relname}`);
    if (APPEND_ONLY_TABLES.includes(t.relname) && (p.up || p.de)) issues.push(`can UPDATE or DELETE append-only ${t.relname}`);
    if (NO_DELETE_TABLES.includes(t.relname) && p.de) issues.push(`can DELETE ${t.relname}`);
    if (READ_ONLY_TABLES.includes(t.relname) && (p.ins || p.up || p.de)) issues.push(`can write ${t.relname}`);
  }
  const predefined = (await db.query(`SELECT rolname FROM pg_roles WHERE rolname IN ('pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_signal_backend', 'pg_write_all_data') AND pg_has_role(current_user, oid, 'MEMBER')`)).rows.map((x) => x.rolname);
  if (predefined.length) issues.push(`holds server roles: ${predefined.join(', ')}`);
  return { user: who.u, schema: sch, issues };
}

/**
 * Called before the server listens. A runtime connection that could bypass the database
 * protections is refused in production (no silent fallback). The only way past is an explicit,
 * logged operator decision: NWOS_ALLOW_PRIVILEGED_DATABASE=true. Elsewhere it is a warning.
 * Never logs connection strings or credentials.
 */
/** The server's database login is privileged and the server must not start. */
export class PrivilegedDatabaseError extends Error {}

export async function enforceRuntimePrivileges(db: Db, env: NodeJS.ProcessEnv = process.env, log: Pick<Console, 'warn' | 'error'> = console) {
  const report = await runtimePrivilegeReport(db);
  if (!report.issues.length) return report;
  const summary = `[db] The runtime database user "${report.user}" is not a restricted runtime role:\n  - ${report.issues.join('\n  - ')}\n  It could disable or rewrite NW OS's audit and history protections. Connect the server as ${roleNamesFromEnv(env).app} (docs/database-privileges.md).`;
  if (env.NODE_ENV === 'production') {
    if (env.NWOS_ALLOW_PRIVILEGED_DATABASE === 'true') {
      log.error(`${summary}\n  NWOS_ALLOW_PRIVILEGED_DATABASE=true: starting anyway by explicit operator choice. The database is NOT hardened.`);
      // The override is a security event of its own: recorded in the audit trail (no secrets).
      await writeAudit(db, { name: 'NW OS server', role: 'system' }, {
        action: 'security.privileged_database_override',
        entityType: 'database',
        details: `Started in production with a privileged runtime database user (${report.user}) because NWOS_ALLOW_PRIVILEGED_DATABASE=true`,
        after: { issues: report.issues },
      }).catch((err) => log.error(`[db] could not record the override in the audit trail: ${(err as Error).message}`));
      return report;
    }
    throw new PrivilegedDatabaseError(`${summary}\n  Refusing to start in production. (An operator can override, knowingly, with NWOS_ALLOW_PRIVILEGED_DATABASE=true.)`);
  }
  log.warn(`${summary}\n  (Development: starting anyway. Production refuses to start.)`);
  return report;
}

/**
 * Creates or repairs the three roles and moves the schema's objects to the owner role. Run by a
 * database administrator (superuser, or a CREATEROLE role such as Supabase's "postgres" that
 * owns the existing objects). Idempotent. Passwords are optional (set them out of band if not
 * given) and are never logged.
 */
export async function bootstrapRoles(admin: PoolClient, opts: { schema: string; roles: RoleNames; migratorPassword?: string; appPassword?: string; transferDatabase?: boolean }) {
  const { schema, roles } = opts;
  const [o, m, a, s] = [ident(roles.owner), ident(roles.migrator), ident(roles.app), ident(schema)];
  const done: string[] = [];
  await admin.query('BEGIN');
  try {
    // Role and database catalog changes from concurrent bootstraps must not interleave.
    await admin.query('SELECT pg_advisory_xact_lock(7334202)');
    for (const [role, login] of [[roles.owner, false], [roles.migrator, true], [roles.app, true]] as const) {
      if (!(await roleExists(admin, role))) {
        await admin.query(`CREATE ROLE ${ident(role)} ${login ? 'LOGIN' : 'NOLOGIN'}`);
        done.push(`created role ${role}`);
      }
    }
    // Attributes are (re)asserted every run, so a role altered by hand is repaired.
    await admin.query(`ALTER ROLE ${o} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`);
    await admin.query(`ALTER ROLE ${m} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`);
    await admin.query(`ALTER ROLE ${a} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT`);
    const setPassword = async (role: string, pw?: string) => {
      if (!pw) return;
      const sql = (await admin.query(`SELECT format('ALTER ROLE %I PASSWORD %L', $1::text, $2::text) AS q`, [role, pw])).rows[0].q;
      await admin.query(sql);
    };
    await setPassword(roles.migrator, opts.migratorPassword);
    await setPassword(roles.app, opts.appPassword);
    // The runtime role may act as nobody else.
    for (const r of (await admin.query(`SELECT g.rolname FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles mem ON mem.oid = am.member WHERE mem.rolname = $1`, [roles.app])).rows) {
      await admin.query(`REVOKE ${ident(r.rolname)} FROM ${a}`);
      done.push(`revoked ${r.rolname} from ${roles.app}`);
    }
    for (const r of [roles.owner, roles.migrator]) {
      const memberOfApp = (await admin.query(`SELECT 1 FROM pg_auth_members am JOIN pg_roles g ON g.oid = am.roleid JOIN pg_roles mem ON mem.oid = am.member WHERE g.rolname = $1 AND mem.rolname = $2`, [roles.app, r])).rowCount;
      if (memberOfApp) await admin.query(`REVOKE ${a} FROM ${ident(r)}`);
    }
    await admin.query(`GRANT ${o} TO ${m}`);
    // A non-superuser administrator must be able to act as the owner to hand objects over.
    const superuser = (await admin.query(`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)).rows[0].rolsuper;
    if (!superuser) await admin.query(`GRANT ${o} TO current_user`);
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${s}`);
    await admin.query(`ALTER SCHEMA ${s} OWNER TO ${o}`);
    const objects = (await admin.query(
      `SELECT c.relname AS name, c.relkind AS kind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S') AND c.relowner <> (SELECT oid FROM pg_roles WHERE rolname = $2)
          AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype IN ('a', 'i')))`,
      [schema, roles.owner]
    )).rows;
    for (const t of objects) {
      const kw = t.kind === 'S' ? 'SEQUENCE' : t.kind === 'v' ? 'VIEW' : t.kind === 'm' ? 'MATERIALIZED VIEW' : t.kind === 'f' ? 'FOREIGN TABLE' : 'TABLE';
      await admin.query(`ALTER ${kw} ${s}.${ident(t.name)} OWNER TO ${o}`);
    }
    const fns = (await admin.query(
      `SELECT p.oid::regprocedure::text AS sig, p.prokind FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = $1 AND p.proowner <> (SELECT oid FROM pg_roles WHERE rolname = $2)`,
      [schema, roles.owner]
    )).rows;
    for (const f of fns) await admin.query(`ALTER ${f.prokind === 'p' ? 'PROCEDURE' : 'FUNCTION'} ${f.sig} OWNER TO ${o}`);
    const types = (await admin.query(
      `SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = $1 AND t.typtype IN ('e', 'd') AND t.typowner <> (SELECT oid FROM pg_roles WHERE rolname = $2)`,
      [schema, roles.owner]
    )).rows;
    for (const t of types) await admin.query(`ALTER TYPE ${s}.${ident(t.typname)} OWNER TO ${o}`);
    if (objects.length || fns.length || types.length) done.push(`moved ${objects.length} relation(s), ${fns.length} function(s), ${types.length} type(s) to ${roles.owner}`);
    // Connecting is all the two login roles need at database level; nobody creates schemas.
    const dbname = (await admin.query('SELECT current_database() AS d')).rows[0].d as string;
    await admin.query(`GRANT CONNECT ON DATABASE ${ident(dbname)} TO ${m}, ${a}`);
    await admin.query(`REVOKE CREATE ON DATABASE ${ident(dbname)} FROM PUBLIC`);
    await admin.query(`REVOKE CREATE ON DATABASE ${ident(dbname)} FROM ${a}`);
    if (opts.transferDatabase) {
      await admin.query(`ALTER DATABASE ${ident(dbname)} OWNER TO ${o}`);
      done.push(`database ${dbname} owned by ${roles.owner}`);
    }
    await admin.query(`SET LOCAL ROLE ${o}`);
    await applyRuntimeGrants(admin, schema, roles);
    await admin.query('RESET ROLE');
    await admin.query('COMMIT');
  } catch (err) {
    await admin.query('ROLLBACK').catch(() => {});
    throw err;
  }
  return done;
}
