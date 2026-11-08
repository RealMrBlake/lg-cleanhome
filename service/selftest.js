'use strict';
// Selbsttest auf dem TV (per diag über SSH gestartet): Kann Node hier den TV per SSAP erreichen,
// sich mit dem Schlüssel anmelden und die Vordergrund-App lesen? Startet nichts und ändert nichts.
var fs = require('fs');
var out = function (s) { console.log('  selftest: ' + s); };
var WebSocket;
try { WebSocket = require('ws'); out('ws geladen'); } catch (e) { out('ws FEHLT: ' + e.message); process.exit(1); }
try { require('webos-service'); out('webos-service vorhanden'); } catch (e) { out('webos-service nicht ladbar: ' + e.message); }
var cfg = JSON.parse(fs.readFileSync(__dirname + '/config.json', 'utf8'));
var ws = new WebSocket('wss://' + cfg.host + ':3001', { rejectUnauthorized: false, handshakeTimeout: 6000 });
var t = setTimeout(function () { out('Zeitüberschreitung'); process.exit(2); }, 9000);
ws.on('open', function () {
  out('verbunden mit ' + cfg.host + ':3001');
  ws.send(JSON.stringify({ type: 'register', id: 'r1', payload: { forcePairing: false, pairingType: 'PROMPT', 'client-key': cfg.clientKey,
    manifest: { manifestVersion: 1, appVersion: '1.0', permissions: ['LAUNCH', 'READ_INSTALLED_APPS', 'READ_RUNNING_APPS', 'READ_APP_STATUS', 'READ_INPUT_DEVICE_LIST'] } } }));
});
ws.on('message', function (raw) {
  var m = JSON.parse(raw);
  if (m.type === 'registered') { out('angemeldet'); ws.send(JSON.stringify({ type: 'request', id: 'q1', uri: 'ssap://com.webos.applicationManager/getForegroundAppInfo', payload: {} })); }
  else if (m.id === 'q1') { out('Vordergrund: ' + (m.payload && m.payload.appId)); clearTimeout(t); ws.close(); process.exit(0); }
  else if (m.type === 'error') out('Fehler: ' + m.error);
  else if (m.payload && m.payload.pairingType) out('TV fragt nach Kopplung (Abfrage am TV?)');
});
ws.on('error', function (e) { out('Verbindungsfehler: ' + e.message); });
