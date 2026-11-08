'use strict';
/*
 * CleanHome-Dienst auf dem TV: Wenn LGs Home in den Vordergrund kommt, wird CleanHome geöffnet.
 *
 * Wie: Der Dienst verbindet sich mit der eigenen Steuerschnittstelle des TVs (SSAP, wie die LG-App am Handy)
 * über die LAN-Adresse des TVs (Loopback lehnt der TV ab), meldet sich mit dem Schlüssel aus der Einrichtung
 * an und abonniert die Vordergrund-App. Er liest nur, welche App vorne ist, und startet nur CleanHome.
 *
 * Notausgang: Drückst du Home, während CleanHome schon offen ist, bleibt LGs Home stehen.
 * Abschalten: in CleanHome unter „Anpassen“ → „Home-Taste öffnet CleanHome“.
 */
var fs = require('fs');
var os = require('os');
var Service = require('webos-service');
var WebSocket = require('ws');

var SELF = 'io.cleanhome.tv';
var HOME_IDS = ['com.webos.app.home'];
var service = new Service('io.cleanhome.tv.service');

var cfg = {};
try { cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8')); } catch (e) { cfg = {}; }

var state = {
  enabled: true,
  connected: false,
  host: null,
  error: null,
  redirects: 0,
  recent: []          // die letzten Vordergrund-Apps, zur Fehlersuche
};
var socket = null, retryTimer = null, backoff = 3000, keep = null;
var prevApp = null, lastRedirect = 0, msgId = 0;

function log(msg) { try { console.log('[cleanhome] ' + msg); } catch (e) { /* egal */ } }

function keepAlive(on) {
  // Ohne laufende Aktivität beendet webOS einen untätigen Dienst nach kurzer Zeit.
  if (on && !keep) {
    keep = 'pending';
    service.activityManager.create('cleanhome-home-watch', function (activity) { keep = activity || null; });
  } else if (!on && keep && keep !== 'pending') {
    try { service.activityManager.complete(keep, function () {}); } catch (e) { /* egal */ }
    keep = null;
  }
}

function hosts() {
  var out = [];
  if (cfg.host) out.push(cfg.host);
  var ifs = os.networkInterfaces();
  Object.keys(ifs).forEach(function (n) {
    (ifs[n] || []).forEach(function (a) {
      if (a && a.family === 'IPv4' || a && a.family === 4) { if (!a.internal && out.indexOf(a.address) < 0) out.push(a.address); }
    });
  });
  return out;
}

function send(type, uri, payload) {
  if (!socket || socket.readyState !== 1) return null;
  var id = type + '_' + (++msgId);
  var m = { type: type, id: id, payload: payload || {} };
  if (uri) m.uri = uri;
  try { socket.send(JSON.stringify(m)); } catch (e) { return null; }
  return id;
}

function onForeground(appId) {
  if (!appId) return;   // direkt nach einem Start ist die Angabe kurz leer
  state.recent.unshift(appId);
  state.recent = state.recent.slice(0, 8);
  var wasSelf = prevApp === SELF;
  prevApp = appId;
  if (!state.enabled || HOME_IDS.indexOf(appId) < 0) return;
  if (wasSelf) { log('Home aus CleanHome heraus: LG Home bleibt'); return; }
  if (Date.now() - lastRedirect < 1500) return;
  lastRedirect = Date.now();
  state.redirects++;
  send('request', 'ssap://system.launcher/launch', { id: SELF });
}

function connect(index) {
  clearTimeout(retryTimer);
  if (!state.enabled) return;
  if (!cfg.clientKey) { state.error = 'kein Kopplungsschlüssel (setup erneut ausführen)'; return; }
  var list = hosts();
  if (!list.length) { state.error = 'keine Netzwerkadresse'; return retry(); }
  var host = list[(index || 0) % list.length];
  var ws;
  try { ws = new WebSocket('wss://' + host + ':3001', { rejectUnauthorized: false, handshakeTimeout: 8000 }); }
  catch (e) { state.error = String(e.message || e); return retry(index); }
  socket = ws;
  var subId = null;
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
      if (k && k !== cfg.clientKey) {   // der TV hat neu gekoppelt: Schlüssel merken
        cfg.clientKey = k;
        try { fs.writeFileSync(__dirname + '/config.json', JSON.stringify(cfg)); } catch (e) { /* Ordner evtl. schreibgeschützt */ }
      }
      state.connected = true; state.host = host; state.error = null; backoff = 3000;
      subId = send('subscribe', 'ssap://com.webos.applicationManager/getForegroundAppInfo', {});
      log('verbunden mit ' + host);
    } else if (m.type === 'error') {
      state.error = String(m.error || 'Fehler').slice(0, 200);
    } else if (subId && m.id === subId && m.payload) {
      onForeground(m.payload.appId);
    }
  });
  ws.on('error', function (e) { state.error = String(e && e.message || e).slice(0, 200); });
  ws.on('close', function () {
    state.connected = false;
    if (socket === ws) socket = null;
    retry((index || 0) + 1);
  });
}

function retry(index) {
  clearTimeout(retryTimer);
  if (!state.enabled) return;
  retryTimer = setTimeout(function () { connect(index); }, backoff);
  backoff = Math.min(backoff * 2, 60000);
}

function setEnabled(on) {
  state.enabled = !!on;
  keepAlive(state.enabled);
  if (state.enabled) { if (!socket) connect(0); }
  else { clearTimeout(retryTimer); if (socket) { try { socket.close(); } catch (e) { /* egal */ } } }
}

function snapshot() {
  return {
    returnValue: true, enabled: state.enabled, connected: state.connected, host: state.host,
    error: state.error, redirects: state.redirects, recent: state.recent
  };
}

// CleanHome ruft das bei jedem Start auf (startet damit auch den Dienst).
service.register('start', function (msg) {
  var p = msg.payload || {};
  setEnabled(p.enabled !== false);
  setTimeout(function () { msg.respond(snapshot()); }, state.connected || !state.enabled ? 0 : 2500);
});

service.register('status', function (msg) { msg.respond(snapshot()); });

process.on('uncaughtException', function (e) { state.error = String(e && e.message || e).slice(0, 200); log('Fehler: ' + state.error); });
