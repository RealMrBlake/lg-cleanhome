#!/usr/bin/env node
/*
 * CleanHome-Einrichtung für LG webOS (Developer Mode, ohne Root).
 *
 *   node tools/cleanhome.js setup <TV-IP>    alles: koppeln, Apps lesen, bauen, installieren, starten
 *   node tools/cleanhome.js sync  [TV-IP]    nur die App-Liste und Icons neu vom TV holen (z. B. nach neuer App)
 *   node tools/cleanhome.js connect [TV-IP]  nur Developer-Mode-Verbindung einrichten und installieren
 *   node tools/cleanhome.js build            nur das .ipk bauen (dist/)
 *   node tools/cleanhome.js install          gebautes .ipk installieren und starten
 *   node tools/cleanhome.js uninstall        CleanHome vom TV entfernen
 *   node tools/cleanhome.js diag             Fehlersuche Home-Taste (Dienst-Status, Vordergrund-Apps)
 *   node tools/cleanhome.js apps             App-Namen und IDs anzeigen (für custom-icons/)
 *   node tools/cleanhome.js renew            Developer-Mode-Sitzung verlängern (Beta, s. README)
 *   node tools/cleanhome.js status           zeigt, was gespeichert ist
 *
 * Was am TV passiert:
 *   - Kopplung über LGs eigenes Steuerprotokoll (SSAP, wss://TV:3001), dasselbe wie die LG-ThinQ-App.
 *     Am TV erscheint einmal eine Abfrage, die du bestätigst. Gelesen wird nur: App-Liste, Eingänge.
 *   - Installation über den Developer Mode (SSH-Port 9922, Benutzer "prisoner") mit LGs ares-cli.
 * Gespeichert wird im Ordner ~/.lg-cleanhome (Kopplungsschlüssel, Zertifikat-Fingerabdruck).
 * Es wird nichts an Dritte gesendet.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');
const { analyse } = require('./png');
const { prepareWallpapers } = require('./assets');

const ROOT = path.resolve(__dirname, '..');
const APP_DIR = path.join(ROOT, 'app');
const HELPER_DIR = path.join(ROOT, 'helper');
const HELPER_ID = 'io.cleanhome.tv.helper';
const HELPER_REMOTE = '/media/developer/apps/usr/palm/applications/' + HELPER_ID;
const DIST = path.join(ROOT, 'dist');
const STATE_DIR = path.join(os.homedir(), '.lg-cleanhome');
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const DEVICE = 'lgtv';
const APP_ID = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'appinfo.json'), 'utf8')).id;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
const HOST_RE = /^[A-Za-z0-9.-]{1,253}$/;
const MANIFEST = {
  manifestVersion: 1,
  appVersion: '1.0',
  permissions: ['LAUNCH', 'READ_INSTALLED_APPS', 'READ_RUNNING_APPS', 'READ_APP_STATUS', 'READ_INPUT_DEVICE_LIST']
};

// ---------- Hilfen ----------

function say(msg) { process.stdout.write(msg + '\n'); }
function fail(msg) { process.stderr.write('\n✗ ' + msg + '\n'); process.exit(1); }

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), { mode: 0o600 });
}

function ares(cmd, args, opts) {
  const bin = path.join(ROOT, 'node_modules', '.bin', cmd + (process.platform === 'win32' ? '.cmd' : ''));
  if (!fs.existsSync(bin)) fail('ares-cli fehlt. Bitte zuerst im Projektordner "npm install" ausführen.');
  const r = spawnSync(bin, args, Object.assign({ stdio: 'inherit', shell: process.platform === 'win32' }, opts || {}));
  return r.status === 0 ? (r.stdout ? r.stdout.toString() : '') : null;
}

// ---------- SSAP (Kopplung, App-Liste) ----------

function ssapConnect(host, state) {
  let WebSocket;
  try { WebSocket = require('ws'); } catch (e) { fail('Modul "ws" fehlt. Bitte "npm install" ausführen.'); }
  return new Promise((resolve, reject) => {
    // Der TV hat ein selbst signiertes Zertifikat. Wir prüfen stattdessen beim zweiten Mal den Fingerabdruck.
    const ws = new WebSocket('wss://' + host + ':3001', { rejectUnauthorized: false, handshakeTimeout: 10000 });
    let next = 0;
    const waiting = new Map();
    ws.on('error', (e) => reject(new Error('TV nicht erreichbar auf ' + host + ':3001 (' + e.message + '). ' +
      'Ist der TV an und im selben Netz? Falls ja: in den TV-Einstellungen die Steuerung über Mobilgeräte erlauben (z. B. "TV-Einschaltung über Mobilgeräte" bzw. "LG Connect Apps", Name je nach Firmware).')));
    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch (e) { return; }
      const w = waiting.get(m.id);
      if (w) w(m);
    });
    ws.on('open', () => {
      const cert = ws._socket && ws._socket.getPeerCertificate ? ws._socket.getPeerCertificate() : null;
      const fp = cert && cert.raw ? crypto.createHash('sha256').update(cert.raw).digest('hex') : null;
      if (state.certSha256 && fp && fp !== state.certSha256 && state.host === host) {
        ws.close();
        return reject(new Error('Der TV zeigt ein anderes Zertifikat als bei der Kopplung (passiert nach manchen ' +
          'Firmware-Updates). Wenn du sicher bist, dass es dein TV ist: "node tools/cleanhome.js setup ' + host + ' --neu-koppeln".'));
      }
      const api = {
        fingerprint: fp,
        send(type, uri, payload, onMsg) {
          const id = type + '_' + (++next);
          waiting.set(id, onMsg);
          ws.send(JSON.stringify(Object.assign({ type, id, payload: payload || {} }, uri ? { uri } : {})));
          return id;
        },
        request(uri, payload) {
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error('keine Antwort auf ' + uri)), 10000);
            api.send('request', uri, payload, (m) => {
              clearTimeout(t);
              if (m.type === 'error' || (m.payload && m.payload.returnValue === false)) rej(new Error(m.error || (m.payload && m.payload.errorText) || 'abgelehnt'));
              else res(m.payload || {});
            });
          });
        },
        register(clientKey) {
          return new Promise((res, rej) => {
            const payload = { forcePairing: false, pairingType: 'PROMPT', manifest: MANIFEST };
            if (clientKey) payload['client-key'] = clientKey;
            const t = setTimeout(() => rej(new Error('Kopplung nicht bestätigt (60 s). Bitte erneut versuchen und am TV "Zulassen" wählen.')), 60000);
            api.send('register', null, payload, (m) => {
              if (m.type === 'registered') { clearTimeout(t); res(m.payload['client-key']); }
              else if (m.type === 'error') { clearTimeout(t); rej(new Error('Kopplung abgelehnt: ' + (m.error || ''))); }
              else if (m.payload && m.payload.pairingType === 'PROMPT') say('  → Bitte jetzt am TV die Verbindungsanfrage mit der Fernbedienung bestätigen …');
            });
          });
        },
        close() { ws.close(); }
      };
      resolve(api);
    });
  });
}

function fetchIcon(url, host) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(url); } catch (e) { return resolve(null); }
    // Nur vom TV selbst, nur dessen Ports, höchstens 512 KB, nur PNG/JPEG.
    if (u.hostname !== host || !['3000', '3001'].includes(u.port) || !/^https?:$/.test(u.protocol)) return resolve(null);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, { rejectUnauthorized: false, timeout: 8000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const chunks = []; let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 512 * 1024) { req.destroy(); resolve(null); } else chunks.push(c); });
      res.on('end', () => {
        const b = Buffer.concat(chunks);
        if (b.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) resolve({ data: b, ext: '.png' });
        else if (b[0] === 0xff && b[1] === 0xd8) resolve({ data: b, ext: '.jpg' });
        else resolve(null);
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function slug(s) { return String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ''); }

// Eigene Icons: custom-icons/<App-ID oder App-Name>.png|.jpg, z. B. custom-icons/netflix.png
function customIcons() {
  const dir = path.join(ROOT, 'custom-icons');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /\.(png|jpe?g)$/i.test(f)).map((f) => {
    const ext = /\.png$/i.test(f) ? '.png' : '.jpg';
    const stem = f.replace(/\.(png|jpe?g)$/i, '');
    return { file: path.join(dir, f), ext, key: /\./.test(stem) ? stem.toLowerCase() : slug(stem) };
  }).filter((c) => fs.statSync(c.file).size < 2 * 1024 * 1024);
}

async function sync(host, opts) {
  const state = loadState();
  if (!host) host = state.host;
  if (!host || !HOST_RE.test(host)) fail('Bitte die IP-Adresse des TVs angeben, z. B.: node tools/cleanhome.js setup 192.168.178.40');
  if (opts.repair || state.host !== host) { delete state.certSha256; delete state.clientKey; }

  say('\n① Verbinde mit dem TV (' + host + ') …');
  const tv = await ssapConnect(host, state);
  try {
    const key = await tv.register(state.clientKey);
    Object.assign(state, { host, clientKey: key, certSha256: state.certSha256 || tv.fingerprint });
    saveState(state);
    say('  ✓ gekoppelt');

    say('② Lese App-Liste und Eingänge …');
    const lp = await tv.request('ssap://com.webos.applicationManager/listLaunchPoints');
    const points = (lp.launchPoints || []).filter((p) => p && ID_RE.test(p.id || '') && !p.hidden && p.id !== APP_ID);
    let allIds = new Set(points.map((p) => p.id));
    try {
      const la = await tv.request('ssap://com.webos.applicationManager/listApps');
      (la.apps || []).forEach((a) => a && a.id && allIds.add(a.id));
    } catch (e) { /* nicht schlimm */ }

    let inputs = [];
    try {
      const ei = await tv.request('ssap://tv/getExternalInputList');
      inputs = (ei.devices || []).filter((d) => d && ID_RE.test(d.appId || '')).map((d) => ({
        app: d.appId,
        label: String(d.label || d.id || d.appId).slice(0, 32),
        connected: !!d.connected
      })).slice(0, 16);
    } catch (e) { say('  (Eingänge nicht lesbar: ' + e.message + ' — der Knopf öffnet dann LGs Eingangsauswahl)'); }

    const pick = (cands) => cands.find((id) => allIds.has(id)) || cands[0];
    const shortcuts = {
      settings: pick(['com.palm.app.settings']),
      livetv: pick(['com.webos.app.livetv']),
      inputs: pick(['com.webos.app.inputpicker', 'com.webos.app.inputmgr'])
    };

    say('③ Lade ' + points.length + ' App-Icons vom TV …');
    const artDir = path.join(APP_DIR, 'art');
    fs.rmSync(artDir, { recursive: true, force: true });
    fs.mkdirSync(artDir, { recursive: true });
    const apps = [];
    let withIcon = 0;
    const customs = customIcons();
    for (const p of points.slice(0, 300)) {
      const title = String(p.title || p.id).slice(0, 48);
      const base = crypto.createHash('sha256').update(p.id).digest('hex').slice(0, 16);
      let icon = null, fill = false, bg = null;
      const custom = customs.find((c) => c.key === p.id.toLowerCase() || c.key === slug(title));
      if (custom) {
        // Eigenes Bild aus custom-icons/: füllt immer die ganze Kachel.
        const name = base + 'c' + custom.ext;
        fs.copyFileSync(custom.file, path.join(artDir, name));
        icon = 'art/' + name; fill = true; withIcon++;
        const a = custom.ext === '.png' ? analyse(fs.readFileSync(custom.file)) : null;
        bg = a && a.bg;
      } else {
        // Alle Icon-Varianten des TVs holen und die größte nehmen.
        const urls = Object.keys(p).filter((k) => /icon/i.test(k) && !/recent/i.test(k) && typeof p[k] === 'string' && /^https?:/.test(p[k]))
          .map((k) => p[k]).filter((u, i, a) => a.indexOf(u) === i);
        let best = null;
        for (const url of urls) {
          const got = await fetchIcon(url, host);
          if (!got) continue;
          const a = got.ext === '.png' ? analyse(got.data) : { width: 0, height: 0, fill: true, bg: null };
          if (!best || (a && a.width > best.a.width)) best = { got, a: a || { width: 0, fill: false, bg: null } };
        }
        if (best) {
          const name = base + best.got.ext;
          fs.writeFileSync(path.join(artDir, name), best.got.data);
          icon = 'art/' + name; fill = !!best.a.fill; bg = best.a.bg; withIcon++;
        }
      }
      const color = bg || [p.bgColor, p.iconColor].find((c) => typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c)) || null;
      apps.push({ id: p.id, title, icon, fill, color, custom: !!custom });
    }
    if (customs.length) say('  eigene Icons aus custom-icons/: ' + customs.length);

    const inv = { synced: new Date().toISOString(), apps, inputs, shortcuts };
    const js = '/* Erzeugt von tools/cleanhome.js am ' + inv.synced + '. Nur Daten. */\n' +
      'window.CLEANHOME_INVENTORY = ' + JSON.stringify(inv, null, 1).replace(/</g, '\\u003c') + ';\n';
    fs.writeFileSync(path.join(APP_DIR, 'js', 'inventory.js'), js);
    say('  ✓ ' + apps.length + ' Apps (' + withIcon + ' mit Icon), ' + inputs.length + ' Eingänge');
  } finally {
    tv.close();
  }
}

// ---------- Bauen und Installieren ----------

function build() {
  say('\n④ Baue die App-Pakete …');
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });
  say('  Hintergrundbilder: ' + prepareWallpapers());
  if (ares('ares-package', [APP_DIR, '-o', DIST, '--no-minify'], { stdio: ['inherit', 'inherit', 'ignore'] }) === null) fail('Paket konnte nicht gebaut werden.');
  // Helper für die Home-Taste: Kopplungsschlüssel und die WebSocket-Bibliothek mitgeben.
  const st = loadState();
  fs.writeFileSync(path.join(HELPER_DIR, 'config.json'), JSON.stringify({ host: st.host || null, clientKey: st.clientKey || null }));
  const wsDst = path.join(HELPER_DIR, 'node_modules', 'ws');
  fs.rmSync(wsDst, { recursive: true, force: true });
  fs.cpSync(path.dirname(require.resolve('ws/package.json')), wsDst, { recursive: true });
  fs.chmodSync(path.join(HELPER_DIR, 'start.sh'), 0o755);
  if (!st.clientKey) say('  (noch nicht gekoppelt: die Home-Umleitung bleibt aus, bis setup/sync gelaufen ist)');
  if (ares('ares-package', [HELPER_DIR, '-o', DIST, '--no-minify'], { stdio: ['inherit', 'inherit', 'ignore'] }) === null) fail('Helper-Paket konnte nicht gebaut werden.');
  const ipks = fs.readdirSync(DIST).filter((f) => f.endsWith('.ipk')).sort();
  if (ipks.length < 2) fail('Pakete nicht vollständig erzeugt.');
  ipks.forEach((f) => say('  ✓ ' + path.join('dist', f)));
  // Haupt-App zuletzt installieren, damit sie danach gestartet werden kann.
  return ipks.sort((x, y) => (x.includes('helper') ? -1 : 1) - (y.includes('helper') ? -1 : 1)).map((f) => path.join(DIST, f));
}

function ask(question) {
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

// Holt den SSH-Schlüssel vom Key Server der Developer-Mode-App (http://TV:9991/webos_rsa).
// Selbst gemacht statt "ares-novacom --getkey", damit klar wird, woran es scheitert.
function fetchKey(host) {
  return new Promise((resolve) => {
    const req = http.get({ host, port: 9991, path: '/webos_rsa', timeout: 6000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.on('error', (e) => resolve({ error: e.code || e.message }));
  });
}

async function diag() {
  const st = loadState();
  if (!st.host || !st.clientKey) fail('Erst setup ausführen.');
  say('\n=== 1. Home-Wächter auf dem TV ===');
  const D = HELPER_REMOTE;
  const cmds = [
    'ls -la ' + D + ' 2>&1',
    'grep -o \'"host":"[^"]*"\' ' + D + '/config.json 2>&1',
    'node -v 2>&1',
    'P=$(cat /tmp/cleanhome-watch.pid 2>/dev/null); echo "pid=$P"; [ -n "$P" ] && kill -0 $P 2>/dev/null && echo "Wächter läuft" || echo "Wächter läuft NICHT"; [ -f /tmp/cleanhome-watch.off ] && echo "abgeschaltet (Anpassen)"; true',
    'tail -n 25 /tmp/cleanhome-watch.log 2>&1',
    'cd ' + D + ' && timeout 12 node selftest.js 2>&1; echo "exit=$?"'
  ];
  for (const c of cmds) {
    const r = sshQuick(c);
    say('$ ' + c.slice(0, 110));
    say('  ' + (r.out.replace(/\[Info\] Set target device : \S+\n?/g, '').trim() || '(keine Ausgabe)').split('\n').slice(0, 30).join('\n  '));
  }

  if (process.argv.includes('--kurz')) { say('\nFertig. Bitte die komplette Ausgabe an Claude schicken.'); return; }
  say('\n=== 2. Was meldet der TV als Vordergrund-App? ===');
  say('Bitte jetzt innerhalb von 45 Sekunden am TV:');
  say('  a) eine App öffnen (z. B. YouTube),  b) Home drücken,  c) CleanHome öffnen,  d) Home drücken.');
  const tv = await ssapConnect(st.host, st);
  await tv.register(st.clientKey);
  const t0 = Date.now();
  tv.send('subscribe', 'ssap://com.webos.applicationManager/getForegroundAppInfo', {}, (m) => {
    const p = m.payload || {};
    say('  +' + ((Date.now() - t0) / 1000).toFixed(1) + ' s  appId=' + JSON.stringify(p.appId) +
      (p.windowId ? '  windowId=' + p.windowId : '') + (m.type === 'error' ? '  FEHLER: ' + m.error : ''));
  });
  await new Promise((r) => setTimeout(r, 45000));
  tv.close();
  say('\nFertig. Bitte die komplette Ausgabe an Claude schicken.');
}

function sshQuick(cmd) {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'ares-novacom' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(bin, ['--device', DEVICE, '--run', cmd], { shell: process.platform === 'win32', timeout: 30000 });
  return { ok: r.status === 0, out: String(r.stdout || '') + String(r.stderr || '') };
}

async function setupDevice(host) {
  say('\n⑤ Developer-Mode-Verbindung einrichten …');
  const info = ['-i', 'host=' + host, '-i', 'port=9922', '-i', 'username=prisoner', '-i', 'default=true'];
  // Erst ändern versuchen (falls schon vorhanden), sonst neu anlegen.
  const quiet = { stdio: 'ignore' };
  if (ares('ares-setup-device', ['-m', DEVICE].concat(info), quiet) === null &&
      ares('ares-setup-device', ['-a', DEVICE].concat(info), quiet) === null) fail('Gerät konnte nicht eingetragen werden.');

  say('  Öffne am TV die App "Developer Mode". Dort müssen "Dev Mode Status" und "Key Server" AN sein.');
  let key = null;
  for (let attempt = 1; !key; attempt++) {
    const r = await fetchKey(host);
    if (r.status === 200 && /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(r.body)) { key = r.body; break; }
    if (r.error === 'ECONNREFUSED') {
      say('  ✗ Der TV lehnt die Verbindung auf Port 9991 ab: Der Schalter "Key Server" ist aus.');
      say('    (Er schaltet sich nach einem Neustart des TVs und nach einiger Zeit von selbst wieder aus.)');
    } else if (r.error === 'timeout' || r.error === 'EHOSTUNREACH' || r.error === 'ETIMEDOUT') {
      say('  ✗ Keine Antwort vom TV auf Port 9991 (' + r.error + '). Ist die Developer-Mode-App geöffnet?');
      say('    Blockiert eine Firewall auf diesem Computer ausgehende Verbindungen?');
    } else if (r.error) {
      say('  ✗ Verbindung zum Key Server fehlgeschlagen: ' + r.error);
    } else {
      say('  ✗ Key Server antwortete unerwartet (HTTP ' + r.status + ').');
    }
    if (attempt >= 5) fail('SSH-Schlüssel nicht abgeholt. Prüfe die Punkte oben und starte setup erneut.');
    await ask('    Schalte "Key Server" in der Developer-Mode-App ein und drücke dann Enter … ');
  }

  const sshDir = path.join(os.homedir(), '.ssh');
  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });
  const keyName = DEVICE + '_webos';
  fs.writeFileSync(path.join(sshDir, keyName), key, { mode: 0o600 });
  say('  ✓ SSH-Schlüssel abgeholt (~/.ssh/' + keyName + ')');

  for (let attempt = 1; ; attempt++) {
    const pass = await ask('  Passphrase aus der Developer-Mode-App (6 Zeichen, Groß/Klein beachten): ');
    if (!/^[A-Za-z0-9]{4,32}$/.test(pass)) { say('  Das sieht nicht nach der Passphrase aus. Nochmal.'); continue; }
    if (ares('ares-setup-device', ['-m', DEVICE, '-i', 'privatekey=' + keyName, '-i', 'passphrase=' + pass], quiet) === null) {
      fail('Gerät konnte nicht aktualisiert werden.');
    }
    const t = sshQuick('echo cleanhome-ok');
    if (t.ok && t.out.includes('cleanhome-ok')) break;
    say('  ✗ SSH-Anmeldung am TV (Port 9922) klappt nicht:\n    ' + t.out.trim().split('\n').slice(-2).join('\n    '));
    if (attempt >= 3) fail('Verbindung nicht hergestellt. Passphrase prüfen, Developer-Mode-App neu öffnen, setup erneut starten.');
    if (/ECONNREFUSED/.test(t.out)) say('  Port 9922 ist zu: Developer Mode ist nicht aktiv (Dev Mode Status AN, danach startet der TV neu).');
    else say('  Meist ist die Passphrase falsch abgetippt (z. B. 0 und O, 1 und l verwechselt).');
  }
  say('  ✓ Verbindung eingerichtet');
}

function install(ipks) {
  say('\n⑥ Installiere auf dem TV …');
  for (const ipk of ipks) {
    if (ares('ares-install', ['--device', DEVICE, ipk]) === null) fail('Installation fehlgeschlagen: ' + path.basename(ipk));
  }
  say('  ✓ installiert');
  // Alten Wächter beenden (neue Version), dann neu starten.
  sshQuick('kill $(cat /tmp/cleanhome-watch.pid 2>/dev/null) 2>/dev/null; rm -f /tmp/cleanhome-watch.off; sleep 1; sh ' + HELPER_REMOTE + '/start.sh');
  const r = sshQuick('sleep 3; tail -n 3 /tmp/cleanhome-watch.log');
  if (/verbunden mit/.test(r.out)) say('  ✓ Home-Umleitung läuft');
  else say('  ? Home-Umleitung: ' + r.out.replace(/\[Info\][^\n]*\n?/g, '').trim().split('\n').pop() + '  (Details: node tools/cleanhome.js diag --kurz)');
  ares('ares-launch', ['--device', DEVICE, APP_ID]);
}


function renew() {
  // Gleiches Vorgehen wie webOS Dev Manager: Sitzungs-Token vom TV lesen und bei LG die Sitzung zurücksetzen.
  const bin = path.join(ROOT, 'node_modules', '.bin', 'ares-novacom' + (process.platform === 'win32' ? '.cmd' : ''));
  const r = spawnSync(bin, ['--device', DEVICE, '--run', 'cat /var/luna/preferences/devmode_enabled'],
    { shell: process.platform === 'win32' });
  const token = r.status === 0 ? String(r.stdout).trim() : '';
  if (!/^[A-Za-z0-9]{16,128}$/.test(token)) fail('Konnte das Sitzungs-Token nicht lesen. Ist der TV an und Developer Mode aktiv?');
  return new Promise((resolve) => {
    https.get('https://developer.lge.com/secure/ResetDevModeSession.dev?sessionToken=' + token, { timeout: 15000 }, (res) => {
      let body = ''; res.on('data', (c) => { body += c; });
      res.on('end', () => {
        say((res.statusCode === 200 ? '✓' : '?') + ' LG antwortete mit ' + res.statusCode + ': ' + body.slice(0, 200).trim());
        say('  Prüfe die Restzeit in der Developer-Mode-App am TV. Im Zweifel dort auf "Extend" drücken.');
        resolve();
      });
    }).on('error', (e) => fail('LG-Server nicht erreichbar: ' + e.message));
  });
}

// ---------- Befehle ----------

async function main() {
  const [cmd, arg, ...rest] = process.argv.slice(2);
  const opts = { repair: rest.includes('--neu-koppeln') || arg === '--neu-koppeln' };
  const host = arg && !arg.startsWith('--') ? arg : undefined;
  switch (cmd) {
    case 'setup': {
      await sync(host, opts);
      const ipk = build();
      await setupDevice(loadState().host);
      install(ipk);
      say('\n✓ Fertig. CleanHome läuft jetzt.');
      say('  Tipp: Lege CleanHome auf eine Zifferntaste (Schnellzugriff), siehe README.');
      say('  Wichtig: Developer Mode läuft nach 50 Stunden ab, wenn du ihn nicht verlängerst (siehe README).');
      break;
    }
    case 'connect':
      // Nur Schritt 5 und 6: Developer-Mode-Verbindung einrichten und installieren (App-Liste bleibt).
      if (host) { const st = loadState(); st.host = host; saveState(st); }
      if (!loadState().host) fail('Bitte die IP-Adresse angeben: node tools/cleanhome.js connect <TV-IP>');
      await setupDevice(loadState().host);
      install(build());
      break;
    case 'sync':
      await sync(host, opts);
      install(build());
      break;
    case 'build':
      build();
      break;
    case 'install':
      install(build());
      break;
    case 'uninstall':
      sshQuick('kill $(cat /tmp/cleanhome-watch.pid 2>/dev/null) 2>/dev/null');
      ares('ares-install', ['--device', DEVICE, '--remove', HELPER_ID]);
      if (ares('ares-install', ['--device', DEVICE, '--remove', APP_ID]) === null) fail('Entfernen fehlgeschlagen.');
      say('✓ CleanHome entfernt. Der TV ist wieder wie vorher.');
      break;
    case 'diag':
      await diag();
      break;
    case 'apps': {
      const txt = fs.readFileSync(path.join(APP_DIR, 'js', 'inventory.js'), 'utf8');
      const inv = JSON.parse(txt.slice(txt.indexOf('=') + 1).trim().replace(/;$/, ''));
      if (!inv.apps.length) say('Noch keine App-Liste. Erst setup oder sync ausführen.');
      inv.apps.forEach((a) => say(a.title.padEnd(32) + a.id));
      break;
    }
    case 'renew':
      await renew();
      break;
    case 'status': {
      const s = loadState();
      say('TV: ' + (s.host || '(noch nicht eingerichtet)'));
      say('gekoppelt: ' + (s.clientKey ? 'ja' : 'nein'));
      const m = fs.readFileSync(path.join(APP_DIR, 'js', 'inventory.js'), 'utf8').match(/"synced": "([^"]+)"/);
      say('App-Liste vom: ' + (m ? m[1] : '(leer)'));
      break;
    }
    default:
      say(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).map((l) => l.replace(/^ \* ?/, '')).join('\n'));
  }
}

main().catch((e) => fail(e.message));
