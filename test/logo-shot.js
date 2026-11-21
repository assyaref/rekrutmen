const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.route(/drive\.google\.com/, r => r.abort());
  await p.goto('http://localhost:8080/'); await p.waitForSelector('.logo-plate img'); await p.waitForTimeout(500);
  await p.screenshot({ path: 'shots/L-careers.png', clip: { x: 0, y: 0, width: 1440, height: 520 } });
  console.log('cached in localStorage:', await p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('rec_logo_')).length));
  await p.click('button:has-text("Masuk Admin")'); await p.waitForSelector('.login .logo-plate img');
  await p.screenshot({ path: 'shots/L-login.png', clip: { x: 0, y: 0, width: 720, height: 200 } });
  await p.fill('input[type=email]', 'admin@admin.com'); await p.fill('input[type=password]', 'admin123'); await p.click('button:has-text("Masuk")');
  await p.waitForSelector('.side .logo-plate img'); await p.waitForTimeout(400);
  await p.screenshot({ path: 'shots/L-admin.png', clip: { x: 0, y: 0, width: 760, height: 260 } });
  const m = await b.newPage({ viewport: { width: 390, height: 844 } });
  await m.goto('http://localhost:8080/?page=careers'); await m.waitForSelector('.logo-plate img'); await m.waitForTimeout(400);
  await m.screenshot({ path: 'shots/L-mobile.png', clip: { x: 0, y: 0, width: 390, height: 300 } });
  await b.close();
})();
