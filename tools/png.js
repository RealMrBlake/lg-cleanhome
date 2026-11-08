'use strict';
/*
 * Minimaler PNG-Leser (nur Node-Bordmittel): Größe, und ob die Ecken deckend sind und welche Farbe sie haben.
 * Damit entscheidet die Einrichtung, ob ein App-Icon seinen eigenen Hintergrund mitbringt (dann füllt es
 * die Kachel in dieser Farbe) oder freigestellt ist (dann liegt es auf der App-Farbe).
 */
const zlib = require('zlib');

function readPng(buf) {
  if (!buf || buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  let pos = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const info = { width, height, corners: null };
  // Nur der häufige Fall wird dekodiert: 8 Bit, nicht interlaced, RGB/RGBA/Grau/Palette.
  if (!width || !height || depth !== 8 || interlace !== 0 || width * height > 4096 * 4096) return info;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!channels) return info;
  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return info; }
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) return info;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[dst + x - channels] : 0;
      const b = y > 0 ? px[dst - stride + x] : 0;
      const c = x >= channels && y > 0 ? px[dst - stride + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + x] = v & 255;
    }
  }
  const rgba = (x, y) => {
    const i = y * stride + x * channels;
    if (ctype === 6) return [px[i], px[i + 1], px[i + 2], px[i + 3]];
    if (ctype === 2) return [px[i], px[i + 1], px[i + 2], 255];
    if (ctype === 0) return [px[i], px[i], px[i], 255];
    if (ctype === 4) return [px[i], px[i], px[i], px[i + 1]];
    const k = px[i];
    return palette ? [palette[k * 3], palette[k * 3 + 1], palette[k * 3 + 2], trns && k < trns.length ? trns[k] : 255] : [0, 0, 0, 255];
  };
  // Etwas nach innen versetzt, damit leicht abgerundete Ecken nicht als transparent gelten.
  const m = Math.max(1, Math.round(Math.min(width, height) * 0.06));
  info.corners = [rgba(m, m), rgba(width - 1 - m, m), rgba(m, height - 1 - m), rgba(width - 1 - m, height - 1 - m)];
  return info;
}

function hex(c) { return '#' + c.slice(0, 3).map((v) => ('0' + v.toString(16)).slice(-2)).join(''); }

/** { width, height, fill: bool, bg: '#rrggbb' | null } */
function analyse(buf) {
  const info = readPng(buf);
  if (!info) return null;   // JPEG o. ä.: als deckend behandeln, Farbe unbekannt
  const out = { width: info.width, height: info.height, fill: false, bg: null };
  if (info.corners) {
    const opaque = info.corners.every((c) => c[3] >= 240);
    const c0 = info.corners[0];
    const same = info.corners.every((c) => Math.abs(c[0] - c0[0]) + Math.abs(c[1] - c0[1]) + Math.abs(c[2] - c0[2]) < 40);
    if (opaque && same) { out.fill = true; out.bg = hex(c0); }
  }
  return out;
}

module.exports = { analyse };
