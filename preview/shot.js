// Rendert die Vorschau mit Demo-Daten und macht Screenshots: node preview/shot.js
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/js/inventory.js', r => r.fulfill({ path: path.join(root, 'preview/demo-inventory.js'), contentType: 'text/javascript' }));
  await page.goto('file://' + path.join(root, 'app/index.html'));
  await page.waitForTimeout(400);
  const out = process.argv[2] || path.join(root, 'preview');
  await page.screenshot({ path: path.join(out, '1-home.png') });
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(250);
  
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(out, '3-grid.png') });
  // OK halten -> Kachelmenü
  await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter'); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, '4-menu.png') });
  // "Ausblenden" (3. Eintrag) wählen
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
  const hidden = await page.evaluate(() => window.__cleanhome.layout().hidden);
  // Eingänge
  await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter'); await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out, '5-inputs.png') });
  console.log(JSON.stringify({ hidden, errors, focus: await page.evaluate(() => window.__cleanhome.focus()) }));
  await browser.close();
})();
