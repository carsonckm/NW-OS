const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { execSync } = require('child_process');
const BASE = 'http://localhost:3000/';
const SHOTS = __dirname + '/out/';
// Fixture SQL (row reads / writes only). ACCEPTANCE_DATABASE_URL points it at another login, e.g.
// the restricted runtime role of a role-separated database (docs/database-privileges.md).
const psql = (sql) =>
  process.env.ACCEPTANCE_DATABASE_URL
    ? execSync(`psql "$ACCEPTANCE_DATABASE_URL" -tAc ${JSON.stringify(sql)}`).toString().trim()
    : execSync(`PGPASSWORD=nwos psql -h localhost -U nwos -d ${process.env.PGDATABASE || 'nwos_dev'} -tAc ${JSON.stringify(sql)}`).toString().trim();
// Fixture SQL that sets up protected records (authority rules, accounts) for a scenario, such as
// moving a rule's dates to simulate time. Since Batch 12B the runtime role cannot do that without
// a signed-in Owner (migration 031), so it runs on ACCEPTANCE_ADMIN_DATABASE_URL (the migrator)
// when it is set, like the account scripts.
const psqlAdmin = (sql) =>
  process.env.ACCEPTANCE_ADMIN_DATABASE_URL
    ? execSync(`psql "$ACCEPTANCE_ADMIN_DATABASE_URL" -tAc ${JSON.stringify(sql)}`).toString().trim()
    : psql(sql);
// Signs in; with a code, first sets the account's password with it (Batch 12B: a new account has no
// password until its holder sets one with the activation code an Owner or Admin was shown).
async function open(account, browser, code) {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message.split('\n')[0]));
  page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) page.errors.push(`${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (code) {
    await page.getByRole('button', { name: 'Set a new password with a code' }).click();
    await page.getByLabel('Email').fill(`${account}@dev.nwos.local`);
    await page.getByLabel('Code').fill(code);
    await page.getByLabel('New password', { exact: true }).fill('dev-password-123');
    await page.getByLabel('Repeat new password').fill('dev-password-123');
    await page.getByRole('button', { name: 'Set password and sign in' }).click();
    await synced(page);
    return page;
  }
  await page.getByLabel('Email').fill(`${account}@dev.nwos.local`);
  await page.getByLabel('Password').fill('dev-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await synced(page);
  return page;
}
const synced = (page) => page.getByTestId('core-sync-status').filter({ hasText: 'Database (synced)' }).waitFor({ timeout: 15000 });
const settle = async (page) => { await page.waitForTimeout(900); await synced(page); };
const nav = (page, label) => page.locator('header div.overflow-x-auto button', { hasText: label }).first().click();
const api = (page, method, path, body) => page.evaluate(async ([m, p, b]) => { const r = await fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; }, [method, path, body]);
const vis = (loc) => loc.filter({ visible: true }).first();
let n = 0;
const step = (msg) => console.log(`${++n}. ${msg}`);
module.exports = { chromium, psql, psqlAdmin, open, synced, settle, nav, api, vis, step, SHOTS };
