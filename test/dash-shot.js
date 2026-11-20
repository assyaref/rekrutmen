const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [w, h, f] of [[1440, 900, 'd-desktop'], [390, 844, 'd-mobile']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto('http://localhost:8080/?page=admin'); await p.waitForSelector('input[type=email]');
    await p.fill('input[type=email]', 'admin@admin.com'); await p.fill('input[type=password]', 'admin123');
    await p.click('button:has-text("Masuk")'); await p.waitForSelector('.kpi'); await p.waitForTimeout(500);
    await p.screenshot({ path: 'shots/' + f + '.png', fullPage: true });
    if (w > 1000) { await p.hover('.tcol >> nth=12'); await p.screenshot({ path: 'shots/d-hover.png', clip: { x: 248, y: 300, width: 1192, height: 360 } }); }
    console.log(f, 'errors', errs);
  }
  await b.close();
})();
