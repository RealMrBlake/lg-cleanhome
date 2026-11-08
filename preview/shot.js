// Rendert die Vorschau mit Demo-Daten und macht Screenshots: node preview/shot.js [Zielordner]
const { chromium } = require('playwright');
const path = require('path');
const root = path.resolve(__dirname, '..');
require(path.join(root, 'tools/assets')).prepareWallpapers();
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/js/inventory.js', r => r.fulfill({ path: path.join(root, 'preview/demo-inventory.js'), contentType: 'text/javascript' }));
  await page.goto('file://' + path.join(root, 'app/index.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(500);
  const out = process.argv[2] || path.join(root, 'preview');
  const shot = async (n) => { await page.waitForTimeout(450); await page.screenshot({ path: path.join(out, n) }); };
  const key = async (k, n = 1) => { for (let i = 0; i < n; i++) await page.keyboard.press(k); };
  await key('ArrowRight'); await shot('1-home.png');
  await key('ArrowDown'); await key('ArrowRight'); await shot('3-grid.png');
  await page.keyboard.down('Enter'); await page.waitForTimeout(800); await page.keyboard.up('Enter');
  await shot('4-menu.png');
  await key('Escape');
  await key('Escape'); await key('ArrowUp'); await key('ArrowLeft', 3);
  await key('Enter'); await shot('5-inputs.png');
  await key('Escape');
  // Anpassen (blaue Taste = keyCode 406)
  await page.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 406 })));
  await key('ArrowDown'); await key('ArrowRight'); await shot('6-anpassen.png');
  await key('ArrowDown', 6); await key('Enter'); await shot('7-apps.png');
  const hidden = await page.evaluate(() => window.__cleanhome.layout().hidden);
  await key('Escape'); await shot('8-wallpaper.png');
  console.log(JSON.stringify({ hidden, wallpaper: await page.evaluate(() => window.__cleanhome.layout().settings.wallpaper), errors }));
  await browser.close();
})();
