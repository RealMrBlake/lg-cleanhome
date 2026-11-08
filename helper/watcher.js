'use strict';
/*
 * CleanHome-Wächter: Wenn LGs Home in den Vordergrund kommt, wird CleanHome geöffnet.
 *
 * Läuft als normaler Hintergrundprozess (Node), gestartet von start.sh. LGs Dienst-System (Luna-Services)
 * startet bei Developer-Mode-Apps auf webOS 25 nichts, deshalb dieser Weg.
 *
 * Wie: Verbindung zur eigenen Steuerschnittstelle des TVs (SSAP) über dessen LAN-Adresse (Loopback lehnt
 * der TV ab), Anmeldung mit dem Schlüssel aus der Einrichtung, Abo der Vordergrund-App. Liest nur, welche
 * App vorne ist, und startet nur CleanHome. Keine Verbindungen ins Internet.
 *
 * Notausgang: Home, während CleanHome offen ist, lässt LGs Home stehen.
 * Aus: Datei /tmp/cleanhome-watch.off (setzt CleanHome über „Anpassen“).
 */
var fs = require('fs');
var os = require('os');
var WebSocket = require('ws');

var SELF = 'io.cleanhome.tv';
var HOME_IDS = ['com.webos.app.home'];
var PID_FILE = '/tmp/cleanhome-watch.pid';
var OFF_FILE = '/tmp/cleanhome-watch.off';
var WAKE_OFF_FILE = '/tmp/cleanhome-wake.off';
// Womit der TV nach dem Einschalten startet; dann wird CleanHome geöffnet.
var START_IDS = ['com.webos.app.home', 'com.webos.app.livetv', 'com.webos.app.channeltuning'];
var WAKE_WINDOW_MS = 30000;   // so lange nach dem Aufwachen gilt die erste Vordergrund-App als „Startbild“

var cfg = {};
try { cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8')); } catch (e) { cfg = {}; }

function log(msg) { console.log(new Date().toISOString() + ' ' + msg); }

// Nur eine Instanz.
try {
  var other = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);
  if (other && other !== process.pid) { process.kill(other, 0); log('läuft bereits (pid ' + other + ')'); process.exit(0); }
} catch (e) { /* keine andere Instanz */ }
fs.writeFileSync(PID_FILE, String(process.pid));
process.on('exit', function () { try { if (fs.readFileSync(PID_FILE, 'utf8') === String(process.pid)) fs.unlinkSync(PID_FILE); } catch (e) { /* egal */ } });
['SIGTERM', 'SIGINT', 'SIGHUP'].forEach(function (s) { process.on(s, function () { if (s !== 'SIGHUP') process.exit(0); }); });

var socket = null, retryTimer = null, backoff = 2000;
var prevApp = null, lastRedirect = 0, msgId = 0, redirects = 0;
var wokeAt = 0, lastTick = Date.now(), closedAt = 0, prevPower = null;
var pending = {};          // id -> callback(message) für Einzelanfragen
var pollTimer = null;

function wakeEnabled() { return !fs.existsSync(WAKE_OFF_FILE); }
function enabled() { return !fs.existsSync(OFF_FILE); }

// Signal 1 fürs Einschalten: Zeitsprung. Ohne Quick Start+ steht der Prozess im Standby still.
setInterval(function () {
  var now = Date.now();
  if (now - lastTick > 15000) {
    log('Zeitsprung ' + Math.round((now - lastTick) / 1000) + ' s: TV war vermutlich aus');
    if (socket) { try { socket.terminate(); } catch (e) { /* egal */ } }
    wake('Zeitsprung');
  }
  lastTick = now;
}, 3000);

function hosts() {
  var out = [];
  if (cfg.host) out.push(cfg.host);
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (n) {
    (ifs[n] || []).forEach(function (a) {
      if (a && (a.family === 'IPv4' || a.family === 4) && !a.internal && out.indexOf(a.address) < 0) out.push(a.address);
    });
  });
  return out;
}

function send(type, uri, payload, cb) {
  if (!socket || socket.readyState !== 1) return null;
  var id = type + '_' + (++msgId);
  var m = { type: type, id: id, payload: payload || {} };
  if (uri) m.uri = uri;
  if (cb) pending[id] = cb;
  try { socket.send(JSON.stringify(m)); } catch (e) { delete pending[id]; return null; }
  return id;
}

function launchSelf(why) {
  lastRedirect = Date.now();
  log(why + ', öffne CleanHome');
  send('request', 'ssap://system.launcher/launch', { id: SELF });
}

// Einschalten erkannt: kurz warten, dann nachsehen, womit der TV gestartet ist.
function wake(why) {
  wokeAt = Date.now();
  log('Einschalten erkannt (' + why + ')');
  [1500, 4000].forEach(function (ms) {
    setTimeout(function () {
      send('request', 'ssap://com.webos.applicationManager/getForegroundAppInfo', {}, function (m) {
        var id = m.payload && m.payload.appId;
        if (wokeAt) checkWake(id);
      });
    }, ms);
  });
}

function checkWake(appId) {
  if (!wokeAt || Date.now() - wokeAt > WAKE_WINDOW_MS) { wokeAt = 0; return false; }
  if (!appId) return false;
  wokeAt = 0;
  if (appId !== SELF && START_IDS.indexOf(appId) >= 0 && enabled() && wakeEnabled()) {
    launchSelf('Eingeschaltet mit ' + appId);
    return true;
  }
  log('Eingeschaltet mit ' + appId + ', bleibt');
  return false;
}

function onForeground(appId) {
  if (!appId) return;   // direkt nach einem Start ist die Angabe kurz leer
  if (appId === prevApp) return;
  log('Vordergrund: ' + appId);
  var wasSelf = prevApp === SELF;
  prevApp = appId;
  if (checkWake(appId)) return;
  if (HOME_IDS.indexOf(appId) < 0) return;
  if (!enabled()) return;
  if (wasSelf) { log('Home aus CleanHome heraus: LG Home bleibt'); return; }
  if (Date.now() - lastRedirect < 1500) return;
  redirects++;
  launchSelf('LG Home erkannt (' + redirects + ')');
}

// Signal 2 fürs Einschalten: Ein/Aus-Zustand des TVs.
function onPower(p) {
  var st = p && (p.state || p.powerState);
  if (!st) return;
  if (st !== prevPower) log('Ein/Aus-Zustand: ' + st + (p.processing ? ' (' + p.processing + ')' : ''));
  if (prevPower && prevPower !== 'Active' && st === 'Active') wake('Zustand ' + prevPower + ' → Active');
  prevPower = st;
}

// Signal 3: regelmäßig selbst nachfragen (falls der TV Meldungen verschluckt) und tote Verbindungen erkennen.
function startPolling(ws) {
  clearInterval(pollTimer);
  var waiting = 0;
  pollTimer = setInterval(function () {
    if (socket !== ws) return clearInterval(pollTimer);
    if (waiting && Date.now() - waiting > 8000) {
      log('Keine Antwort vom TV, verbinde neu');
      waiting = 0;
      try { ws.terminate(); } catch (e) { /* egal */ }
      return;
    }
    if (waiting) return;
    waiting = Date.now();
    send('request', 'ssap://com.webos.applicationManager/getForegroundAppInfo', {}, function (m) {
      waiting = 0;
      onForeground(m.payload && m.payload.appId);
    });
  }, 4000);
}

function connect(index) {
  clearTimeout(retryTimer);
  if (!cfg.clientKey) { log('kein Kopplungsschlüssel in config.json, Ende'); process.exit(1); }
  var list = hosts();
  if (!list.length) { log('keine Netzwerkadresse'); return retry(index); }
  var host = list[(index || 0) % list.length];
  var ws;
  try { ws = new WebSocket('wss://' + host + ':3001', { rejectUnauthorized: false, handshakeTimeout: 8000 }); }
  catch (e) { log('Fehler: ' + e.message); return retry((index || 0) + 1); }
  socket = ws;
  var subId = null, powerId = null;
  ws.on('open', function () {
    send('register', null, {
      forcePairing: false, pairingType: 'PROMPT', 'client-key': cfg.clientKey,
      manifest: { manifestVersion: 1, appVersion: '1.0', permissions: ['LAUNCH', 'READ_INSTALLED_APPS', 'READ_RUNNING_APPS', 'READ_APP_STATUS', 'READ_INPUT_DEVICE_LIST'] }
    });
  });
  ws.on('message', function (raw) {
    var m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.type === 'registered') {
      var k = m.payload && m.payload['client-key'];
      if (k && k !== cfg.clientKey) {
        cfg.clientKey = k;
        try { fs.writeFileSync(__dirname + '/config.json', JSON.stringify(cfg)); } catch (e) { /* egal */ }
      }
      backoff = 2000;
      prevApp = null;
      log('verbunden mit ' + host);
      // Lange getrennt (TV war aus, Netzwerk weg): auch das als Einschalten werten.
      if (closedAt && Date.now() - closedAt > 15000) wake('Verbindung war ' + Math.round((Date.now() - closedAt) / 1000) + ' s weg');
      closedAt = 0;
      subId = send('subscribe', 'ssap://com.webos.applicationManager/getForegroundAppInfo', {});
      powerId = send('subscribe', 'ssap://com.webos.service.tvpower/power/getPowerState', {});
      startPolling(ws);
      return;
    }
    var cb = pending[m.id];
    if (cb) { delete pending[m.id]; if (m.type !== 'error') cb(m); else log('Anfrage abgelehnt: ' + String(m.error).slice(0, 160)); return; }
    if (m.type === 'error') {
      log((m.id === powerId ? 'Ein/Aus-Zustand nicht lesbar (nicht schlimm, Einschalten wird über die Verbindung erkannt): ' : 'TV meldet Fehler: ') + String(m.error).slice(0, 200));
    } else if (subId && m.id === subId && m.payload) {
      onForeground(m.payload.appId);
    } else if (powerId && m.id === powerId && m.payload) {
      onPower(m.payload);
    }
  });
  ws.on('error', function (e) { log('Verbindungsfehler: ' + String(e && e.message || e).slice(0, 200)); });
  ws.on('close', function () {
    if (socket === ws) socket = null;
    clearInterval(pollTimer);
    pending = {};
    if (!closedAt) closedAt = Date.now();
    log('Verbindung getrennt');
    retry((index || 0) + 1);
  });
}

function retry(index) {
  clearTimeout(retryTimer);
  // Kurze Wartezeit, damit es nach dem Aufwachen aus dem Standby schnell wieder geht.
  retryTimer = setTimeout(function () { connect(index); }, backoff);
  backoff = Math.min(backoff * 2, 10000);
}

process.on('uncaughtException', function (e) { log('Fehler: ' + (e && e.stack || e)); });
log('Start (pid ' + process.pid + ', Node ' + process.version + ')');
connect(0);
