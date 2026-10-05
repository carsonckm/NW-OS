// Signs in as each dev account and clicks every nav tab; records uncaught page errors.
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const ACCOUNTS = ['owner-ceo','admin','project-manager','site-supervisor','purchasing','accountant','production-manager','production-staff','contractor','client'];
(async () => {
  const browser = await chromium.launch();
  const errors = []; let clicks = 0; const failedApi = new Map();
  for (const a of ACCOUNTS) {
    const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 } });
    const page = await ctx.newPage();
    let where = `${a} > login`;
    page.on('pageerror', (e) => errors.push(`[${where}] ${e.message.split('\n')[0]}`));
    page.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) { const k = `${a} ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`; failedApi.set(k, (failedApi.get(k) || 0) + 1); } });
    await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
    await page.getByLabel('Email').fill(`${a}@dev.nwos.local`);
    await page.getByLabel('Password').fill('dev-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByTestId('core-sync-status').waitFor({ timeout: 15000 });
    const NAV = 'header div.overflow-x-auto button';
    const labels = await page.locator(NAV).allInnerTexts();
    for (let i = 0; i < labels.length; i++) {
      where = `${a} > ${labels[i].split('\n')[0]}`;
      await page.locator(NAV).nth(i).click({ timeout: 3000 }).then(() => clicks++).catch(() => {});
      await page.waitForTimeout(250);
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(800);
    const status = await page.getByTestId('core-sync-status').innerText();
    if (!/synced/.test(status)) errors.push(`[${a}] sync status: ${status}`);
    await ctx.close();
  }
  console.log('tab clicks:', clicks);
  console.log('API 4xx/5xx during browsing:', failedApi.size ? [...failedApi].map(([k, n]) => `${k} x${n}`).join('\n  ') : 'none');
  console.log('ERRORS:', errors.length); console.log([...new Set(errors)].join('\n'));
  await browser.close();
})();
