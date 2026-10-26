/**
 * Whether the browser may bulk-import its local data into PostgreSQL (POST /api/data/import and
 * POST /api/core/import), which the app does on first load against an empty database.
 *
 * NWOS_BROWSER_IMPORT=on   allowed (still only for users with settings.manage)
 * NWOS_BROWSER_IMPORT=off  refused for everyone
 * unset                    off in production (NODE_ENV=production), on otherwise
 * any other value          off
 *
 * Read on every request, so a restart is enough to change it. Operator tools that import on
 * purpose (npm run db:import-demo) do not go through these routes and are not affected.
 */
export function browserImportAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.NWOS_BROWSER_IMPORT?.trim().toLowerCase();
  if (!value) return env.NODE_ENV !== 'production';
  return value === 'on';
}

export const BROWSER_IMPORT_DISABLED = {
  error: 'import_disabled',
  message: 'Importing browser data is disabled on this server (NWOS_BROWSER_IMPORT). Records are saved to the database one by one as you work.',
};
