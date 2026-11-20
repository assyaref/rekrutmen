const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  for (const [w, h, f] of [[1440, 900, 'c-desktop'], [390, 844, 'c-mobile']]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto('http://localhost:8080/?page=careers'); await p.waitForSelector('.job');
    await p.waitForTimeout(400);
    await p.screenshot({ path: 'shots/' + f + '.png', fullPage: true });
    if (w > 1000) { await p.hover('.job >> nth=1'); await p.screenshot({ path: 'shots/c-hover.png' }); await p.click('.job >> nth=1'); await p.waitForSelector('.modal'); await p.waitForTimeout(300); await p.screenshot({ path: 'shots/c-modal.png' }); }
  }
  await b.close();
})();
