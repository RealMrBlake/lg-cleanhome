'use strict';
// Kopiert die Hintergrundbilder aus wallpapers/ in die App und schreibt die Liste app/js/wallpapers.js.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MAX = 3 * 1024 * 1024;

function prepareWallpapers() {
  const src = path.join(ROOT, 'wallpapers');
  const dst = path.join(ROOT, 'app', 'wallpapers');
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(dst, { recursive: true });
  let caps = {};
  try { caps = JSON.parse(fs.readFileSync(path.join(src, 'captions.json'), 'utf8')); } catch (e) { caps = {}; }
  const list = [];
  const files = fs.existsSync(src) ? fs.readdirSync(src).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort() : [];
  files.forEach((f, i) => {
    const full = path.join(src, f);
    if (fs.statSync(full).size > MAX) { console.log('  (übersprungen, größer als 3 MB: wallpapers/' + f + ')'); return; }
    const name = ('0' + i).slice(-2) + path.extname(f).toLowerCase();
    fs.copyFileSync(full, path.join(dst, name));
    const own = !caps[f];
    list.push({ file: 'wallpapers/' + name, name: f.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' '), credit: caps[f] || 'Eigenes Bild', own });
  });
  fs.writeFileSync(path.join(ROOT, 'app', 'js', 'wallpapers.js'),
    '/* Erzeugt beim Bauen aus wallpapers/. */\nwindow.CLEANHOME_WALLPAPERS = ' +
    JSON.stringify(list, null, 1).replace(/</g, '\\u003c') + ';\n');
  return list.length;
}

module.exports = { prepareWallpapers };
