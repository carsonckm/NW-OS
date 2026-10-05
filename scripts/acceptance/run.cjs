// Phase 4 end-to-end acceptance through the browser UI, against the dev PostgreSQL.
// Usage: node e2e/run.cjs [fromStage]  — state (ids) is kept in e2e/state.json between stages.
const fs = require('fs');
const L = require('./lib.cjs');
const STATE = __dirname + '/out/state.json';
const LOG = __dirname + '/out/log.jsonl';
fs.mkdirSync(__dirname + '/out', { recursive: true });
const S = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const save = () => fs.writeFileSync(STATE, JSON.stringify(S, null, 2));
const dialog = (page) => page.getByRole('dialog').last();
const field = (page, label) => dialog(page).getByLabel(label, { exact: true });
const sessions = {};
let browser;
async function as(account) {
  if (!sessions[account]) sessions[account] = await L.open(account, browser);
  const p = sessions[account];
  return p;
}
async function fresh(account) {
  const p = await as(account);
  await p.reload({ waitUntil: 'networkidle' });
  await L.synced(p);
  return p;
}
async function commercialTab(page, label) {
  await L.nav(page, 'Commercial'); await page.waitForTimeout(300);
  await L.vis(page.getByRole('button', { name: new RegExp(`^${label}`) })).click(); await page.waitForTimeout(300);
}
function record(step, via, evidence) {
  const line = { step, via, evidence };
  fs.appendFileSync(LOG, JSON.stringify(line) + '\n');
  console.log(`${step} [${via}] ${evidence}`);
}
const stages = require('./stages.cjs')({ L, S, save, dialog, field, as, fresh, commercialTab, record });

(async () => {
  const from = Number(process.argv[2] || 1);
  const to = Number(process.argv[3] || 99);
  browser = await L.chromium.launch();
  if (from === 1) { fs.writeFileSync(LOG, ''); for (const k of Object.keys(S)) delete S[k]; S.RUN = Date.now().toString().slice(-5); save(); }
  let current;
  try {
    for (const st of stages) {
      if (st.n < from || st.n > to) continue;
      current = st;
      await st.run();
      save();
    }
    const errs = Object.fromEntries(Object.entries(sessions).map(([k, p]) => [k, p.errors]));
    console.log('API refusals seen (expected ones are deliberate checks):', JSON.stringify(errs));
  } catch (e) {
    console.log(`FAILED at stage ${current?.n} ${current?.name}: ${e.message.split('\n')[0]}`);
    for (const [k, p] of Object.entries(sessions)) await p.screenshot({ path: `${__dirname}/out/fail-${k}.png`, fullPage: false }).catch(() => {});
    process.exitCode = 1;
  }
  await browser.close();
})();
