// Smoke test read-only terhadap aplikasi produksi (tidak membuat/mengubah data).
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/node22/lib/node_modules/playwright'); }
const { chromium } = pw;
const BASE = 'https://rekrutmen-eta.vercel.app';
const OUT = process.argv[2] || 'shots-live';
(async () => {
  const b = await chromium.launch(process.env.https_proxy ? { proxy: { server: process.env.https_proxy } } : {});
  const p = await b.newPage({ viewport: { width: 1366, height: 860 } });
  p.setDefaultTimeout(45000);
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  const t0 = Date.now();
  await p.goto(BASE);
  await p.waitForSelector('.job, .empty');
  console.log('careers loaded in', Date.now() - t0, 'ms; jobs:', await p.locator('.job').count());
  await p.screenshot({ path: OUT + '/1-careers.png' });
  if (await p.locator('.job').count()) {
    await p.click('.job'); await p.waitForSelector('.modal');
    console.log('form fields:', await p.locator('.modal .field').count());
    await p.screenshot({ path: OUT + '/2-job.png' });
    await p.click('.modal .x');
  }
  await p.click('button:has-text("Masuk Admin")');
  await p.fill('input[type=email]', 'admin@admin.com');
  await p.fill('input[type=password]', 'admin123');
  await p.click('button:has-text("Masuk")');
  const r = await Promise.race([
    p.waitForSelector('.stat').then(() => 'ADMIN_OK'),
    p.waitForSelector('.toast.error').then(async () => 'LOGIN_ERR: ' + await p.textContent('.toast')),
  ]);
  console.log(r);
  if (r === 'ADMIN_OK') {
    await p.screenshot({ path: OUT + '/3-dashboard.png' });
    console.log('stats:', (await p.locator('.stat').allInnerTexts()).map(s => s.replace(/\n/g, ' ')));
    for (const [nav, sel, f] of [['Kandidat', '.kanban, .tbl', '4-kandidat'], ['Pengaturan', '.tabs', '5-pengaturan']]) {
      await p.click(`.nav a:has-text("${nav}")`); await p.waitForSelector(sel); await p.waitForTimeout(400);
      await p.screenshot({ path: `${OUT}/${f}.png` });
    }
    await p.click('a:has-text("Keluar")');
  }
  console.log('ERRORS:', errs);
  await b.close();
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
