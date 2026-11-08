/*
 * CleanHome — ein ruhiger Startbildschirm für LG webOS (Developer Mode, ohne Root).
 *
 * Was die App auf dem TV tut — und nur das:
 *   - Apps und Eingänge über den webOS Application Manager starten (luna://com.webos.applicationManager/launch)
 *   - einmal versuchen, die App-Liste live zu lesen (wird Developer-Mode-Apps auf webOS 25 meist verweigert,
 *     dann gilt die Liste aus inventory.js, die das Installationsskript vom TV geholt hat)
 *   - die eigene Anordnung (Dock, Reihenfolge, ausgeblendete Apps) im localStorage der App speichern
 * Keine Netzwerkverbindungen, keine Analytik (siehe Content-Security-Policy in index.html).
 */
(function () {
  'use strict';

  var INV = window.CLEANHOME_INVENTORY || { apps: [], inputs: [], shortcuts: {} };
  var SELF_ID = 'io.cleanhome.tv';
  var STORE_KEY = 'cleanhome.layout.v1';
  var COLS = 6;
  var DOCK_MAX = 6;
  var HOLD_MS = 600;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
  var PREFERRED_DOCK = [
    'netflix', 'youtube.leanback.v4', 'amazon', 'com.disney.disneyplus-prod', 'com.apple.appletv',
    'spotify-beehive', 'de.ard.mediathek', 'de.zdf.app.zdfmediathek', 'com.wow.app', 'joyn', 'rtlplus', 'magentatv'
  ];
  // Systemdienste, die keine sinnvollen Kacheln sind (LG-Werbe- und Shop-Flächen eingeschlossen).
  var NOISE = /^(com\.webos\.app\.(home|discovery|lgchannels|adoverlay|adapi|shoppinghub|recommend|browser\.sports)|com\.webos\.app\.hdmi\d|com\.webos\.app\.(livetv|inputpicker|inputmgr|externalinput.*)|com\.palm\.app\.settings|com\.webos\.app\.notificationcenter)$/;

  // ---------- Plattform ----------

  var bridges = [];
  function hasBridge() { return typeof window.PalmServiceBridge !== 'undefined'; }

  function luna(uri, params, cb, timeoutMs) {
    if (!hasBridge()) { cb(new Error('kein webOS')); return; }
    var done = false, bridge;
    var timer = setTimeout(function () { finish(new Error('keine Antwort')); }, timeoutMs || 6000);
    function finish(err, data) {
      if (done) return;
      done = true; clearTimeout(timer);
      var i = bridges.indexOf(bridge); if (i >= 0) bridges.splice(i, 1);
      cb(err, data);
    }
    try {
      bridge = new window.PalmServiceBridge();
      bridges.push(bridge);   // Referenz halten, sonst kann die Bridge mitten im Aufruf eingesammelt werden
      bridge.onservicecallback = function (raw) {
        var d; try { d = JSON.parse(raw); } catch (e) { finish(new Error('unlesbare Antwort')); return; }
        if (!d || d.returnValue === false) finish(new Error((d && (d.errorText || d.errorCode)) || 'abgelehnt'));
        else finish(null, d);
      };
      bridge.call(uri, JSON.stringify(params || {}));
    } catch (e) { finish(e); }
  }

  function launch(id, title) {
    if (!id) return;
    if (!hasBridge()) { toast('Vorschau: würde „' + (title || id) + '“ öffnen'); return; }
    luna('luna://com.webos.applicationManager/launch', { id: id }, function (err) {
      if (err) toast('„' + (title || id) + '“ ließ sich nicht öffnen (' + err.message + ')');
    });
  }

  // ---------- Daten ----------

  var ID_RE = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;
  var apps = {};       // id -> {id, title, icon, color}
  var layout = null;   // {dock:[], order:[], hidden:[]}

  function setApps(list, iconPrefix) {
    apps = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || typeof a.id !== 'string' || !ID_RE.test(a.id) || a.id === SELF_ID || NOISE.test(a.id)) continue;
      var icon = a.icon || null;
      if (icon && iconPrefix && icon.charAt(0) === '/') icon = iconPrefix + icon;
      apps[a.id] = { id: a.id, title: String(a.title || a.id).slice(0, 48), icon: icon, color: a.color || null };
    }
  }

  function loadLayout() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !Array.isArray(saved.dock)) saved = { dock: [], order: [], hidden: [], fresh: true };
    layout = { dock: saved.dock, order: saved.order || [], hidden: saved.hidden || [] };
    if (saved.fresh) {
      for (var i = 0; i < PREFERRED_DOCK.length && layout.dock.length < 5; i++) {
        if (apps[PREFERRED_DOCK[i]]) layout.dock.push(PREFERRED_DOCK[i]);
      }
    }
    reconcile();
  }

  function reconcile() {
    // Entfernte Apps vergessen, neue Apps hinten anhängen.
    function keep(id) { return !!apps[id]; }
    layout.dock = uniq(layout.dock.filter(keep)).slice(0, DOCK_MAX);
    layout.hidden = uniq(layout.hidden.filter(keep));
    layout.order = uniq(layout.order.filter(keep));
    var ids = Object.keys(apps).sort(function (a, b) { return apps[a].title.localeCompare(apps[b].title, 'de'); });
    for (var i = 0; i < ids.length; i++) if (layout.order.indexOf(ids[i]) < 0) layout.order.push(ids[i]);
    if (!layout.dock.length) layout.dock = ids.slice(0, 5);
  }

  function saveLayout() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(layout)); } catch (e) { /* voll oder gesperrt */ }
  }

  function uniq(a) { var s = {}, o = []; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } return o; }
  function gridIds() {
    return layout.order.filter(function (id) { return layout.dock.indexOf(id) < 0 && layout.hidden.indexOf(id) < 0; });
  }

  // ---------- Darstellung ----------

  var $ = function (id) { return document.getElementById(id); };
  var focus = { zone: 'dock', index: 0 };
  var moving = null;     // {zone, id} während „Verschieben“
  var sheet = null;      // offenes Menü: {items:[{label, meta, run}], index, cols}

  function hashHue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 360; }
  function appColor(a) { return a.color || 'hsl(' + hashHue(a.id) + ',38%,34%)'; }

  function tileEl(a, zone, idx) {
    var t = document.createElement('button');
    t.className = 'tile focusable';
    t.setAttribute('data-zone', zone);
    t.setAttribute('data-index', idx);
    var art = document.createElement('div');
    art.className = 'art';
    if (a) {
      art.style.background = appColor(a);
      var letter = document.createElement('div');
      letter.className = 'letter';
      letter.textContent = a.title.charAt(0).toUpperCase();
      if (a.icon) {
        var img = new Image();
        img.onload = function () { art.textContent = ''; art.appendChild(img); };
        img.onerror = function () { /* Buchstabe bleibt */ };
        img.src = a.icon;
      }
      art.appendChild(letter);
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = a.title;
      t.appendChild(art);
      t.appendChild(name);
    } else {
      t.classList.add('empty');
      art.innerHTML = '<div class="letter">＋ Apps</div>';
      t.appendChild(art);
    }
    return t;
  }

  function render() {
    var dock = $('dock'), grid = $('grid');
    dock.textContent = ''; grid.textContent = '';
    layout.dock.forEach(function (id, i) { dock.appendChild(tileEl(apps[id], 'dock', i)); });
    var g = gridIds();
    g.forEach(function (id, i) { grid.appendChild(tileEl(apps[id], 'grid', i)); });
    grid.appendChild(tileEl(null, 'grid', g.length));   // „+ Apps“ öffnet die App-Bibliothek
    if (!INV.livetv && !INV.shortcuts.livetv) $('btn-livetv').classList.add('hidden');
    applyFocus();
  }

  function zoneEls(zone) {
    if (zone === 'actions') return Array.prototype.filter.call(document.querySelectorAll('#actions .pill'), function (e) { return !e.classList.contains('hidden'); });
    if (zone === 'dock') return Array.prototype.slice.call($('dock').children);
    if (zone === 'grid') return Array.prototype.slice.call($('grid').children);
    return [];
  }

  function applyFocus() {
    var all = document.querySelectorAll('.focus');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('focus');
    var moved = document.querySelectorAll('.moving');
    for (i = 0; i < moved.length; i++) moved[i].classList.remove('moving');

    if (sheet) {
      var items = $('sheet-list').children;
      if (items[sheet.index]) items[sheet.index].classList.add('focus');
      return;
    }
    var els = zoneEls(focus.zone);
    if (!els.length && focus.zone === 'dock') { focus.zone = 'grid'; els = zoneEls('grid'); }
    focus.index = Math.max(0, Math.min(focus.index, els.length - 1));
    var el = els[focus.index];
    if (el) { el.classList.add('focus'); if (moving) el.classList.add('moving'); }
    document.body.classList.toggle('move-mode', !!moving);

    // Raster-Ansicht: nach oben schieben und bei vielen Reihen mitscrollen.
    var main = $('main');
    if (focus.zone === 'grid') {
      var row = Math.floor(focus.index / COLS);
      main.classList.add('grid-mode');
      document.body.classList.add('grid');
      main.style.transform = 'translateY(' + (-360 - Math.max(0, row - 1) * 184) + 'px)';
    } else {
      main.classList.remove('grid-mode');
      document.body.classList.remove('grid');
      main.style.transform = '';
    }

    // Top-Regal und Leuchten zeigen die fokussierte App.
    var a = focusedApp();
    $('shelf-title').textContent = a ? a.title : (focus.zone === 'grid' ? 'App-Bibliothek' : '');
    $('shelf-sub').textContent = a ? (focus.zone === 'dock' ? 'Im Dock' : '') : (focus.zone === 'grid' ? 'Ausgeblendete Apps wieder anzeigen' : '');
    document.documentElement.style.setProperty('--glow', a ? appColor(a) : '#3a4a6b');
  }

  function focusedId() {
    if (focus.zone === 'dock') return layout.dock[focus.index];
    if (focus.zone === 'grid') return gridIds()[focus.index];
    return null;
  }
  function focusedApp() { var id = focusedId(); return id ? apps[id] : null; }

  // ---------- Navigation ----------

  function move(dir) {
    if (sheet) return moveSheet(dir);
    if (moving) return moveTile(dir);
    var n = zoneEls(focus.zone).length;
    if (focus.zone === 'actions') {
      if (dir === 'left') focus.index = Math.max(0, focus.index - 1);
      else if (dir === 'right') focus.index = Math.min(n - 1, focus.index + 1);
      else if (dir === 'down') { focus.zone = layout.dock.length ? 'dock' : 'grid'; focus.index = 0; }
    } else if (focus.zone === 'dock') {
      if (dir === 'left') focus.index = Math.max(0, focus.index - 1);
      else if (dir === 'right') focus.index = Math.min(n - 1, focus.index + 1);
      else if (dir === 'up') { focus.zone = 'actions'; focus.index = zoneEls('actions').length - 1; }
      else if (dir === 'down') { focus.zone = 'grid'; focus.index = Math.min(focus.index, zoneEls('grid').length - 1); }
    } else if (focus.zone === 'grid') {
      var i = focus.index;
      if (dir === 'left' && i % COLS > 0) i--;
      else if (dir === 'right' && i % COLS < COLS - 1 && i + 1 < n) i++;
      else if (dir === 'down' && i + COLS < n) i += COLS;
      else if (dir === 'down' && Math.floor(i / COLS) < Math.floor((n - 1) / COLS)) i = n - 1;
      else if (dir === 'up') {
        if (i - COLS >= 0) i -= COLS;
        else { focus.zone = layout.dock.length ? 'dock' : 'actions'; focus.index = Math.min(i, zoneEls(focus.zone).length - 1); applyFocus(); return; }
      }
      focus.index = i;
    }
    applyFocus();
  }

  function moveTile(dir) {
    var list = moving.zone === 'dock' ? layout.dock : layout.order;
    var visible = moving.zone === 'dock' ? layout.dock : gridIds();
    var from = visible.indexOf(moving.id);
    var step = { left: -1, right: 1, up: moving.zone === 'grid' ? -COLS : 0, down: moving.zone === 'grid' ? COLS : 0 }[dir];
    var to = Math.max(0, Math.min(visible.length - 1, from + step));
    if (to === from) return;
    // Im Raster wird in layout.order verschoben, relativ zur sichtbaren Nachbar-App.
    var target = visible[to];
    var a = list.indexOf(moving.id), b = list.indexOf(target);
    list.splice(a, 1);
    list.splice(b, 0, moving.id);
    saveLayout();
    render();
    focus.index = (moving.zone === 'dock' ? layout.dock : gridIds()).indexOf(moving.id);
    applyFocus();
  }

  function activate() {
    if (sheet) { var it = sheet.items[sheet.index]; if (it) { var run = it.run; closeSheet(); run(); } return; }
    if (moving) { moving = null; toast('Gespeichert'); applyFocus(); return; }
    if (focus.zone === 'actions') { action(zoneEls('actions')[focus.index].getAttribute('data-action')); return; }
    var a = focusedApp();
    if (a) launch(a.id, a.title);
    else if (focus.zone === 'grid') openLibrary();
  }

  function hold() {
    if (sheet || moving || focus.zone === 'actions') return;
    var a = focusedApp();
    if (!a) return;
    var zone = focus.zone;
    var items = [{ label: 'Verschieben', meta: 'Pfeile, dann OK', run: function () { moving = { zone: zone, id: a.id }; applyFocus(); } }];
    if (zone === 'dock') {
      items.push({ label: 'Aus dem Dock nehmen', run: function () { layout.dock.splice(layout.dock.indexOf(a.id), 1); saveLayout(); render(); } });
    } else if (layout.dock.length < DOCK_MAX) {
      items.push({ label: 'Ins Dock legen', run: function () { layout.dock.push(a.id); saveLayout(); render(); } });
    } else {
      items.push({ label: 'Ins Dock legen', meta: 'Dock ist voll (' + DOCK_MAX + ')', run: function () { toast('Erst eine App aus dem Dock nehmen'); } });
    }
    items.push({ label: 'Ausblenden', meta: 'bleibt installiert', run: function () {
      layout.hidden.push(a.id);
      var d = layout.dock.indexOf(a.id); if (d >= 0) layout.dock.splice(d, 1);
      saveLayout(); render(); toast('„' + a.title + '“ ausgeblendet · Blaue Taste holt es zurück');
    } });
    items.push({ label: 'Abbrechen', run: function () {} });
    openSheet(a.title, items);
  }

  function back() {
    if (sheet) { closeSheet(); return; }
    if (moving) { moving = null; applyFocus(); return; }
    if (focus.zone === 'grid') { focus.zone = layout.dock.length ? 'dock' : 'actions'; focus.index = 0; applyFocus(); return; }
    // Auf Home tut Zurück nichts: der Launcher schließt sich nicht selbst.
  }

  // ---------- Aktionen und Menüs ----------

  function action(kind) {
    if (kind === 'settings') launch(INV.shortcuts.settings || 'com.palm.app.settings', 'Einstellungen');
    else if (kind === 'livetv') launch(INV.shortcuts.livetv || 'com.webos.app.livetv', 'Live-TV');
    else if (kind === 'inputs') openInputs();
  }

  function openInputs() {
    var items = (INV.inputs || []).map(function (x) {
      return { label: x.label, meta: x.connected ? 'verbunden' : '', run: function () { launch(x.app, x.label); } };
    });
    if (INV.shortcuts.livetv) items.push({ label: 'Live-TV', run: function () { launch(INV.shortcuts.livetv, 'Live-TV'); } });
    if (!items.length) { launch(INV.shortcuts.inputs || 'com.webos.app.inputpicker', 'Eingänge'); return; }
    openSheet('Eingänge', items);
  }

  function openLibrary() {
    var hidden = layout.hidden.slice().sort(function (a, b) { return apps[a].title.localeCompare(apps[b].title, 'de'); });
    if (!hidden.length) { toast('Keine ausgeblendeten Apps'); return; }
    openSheet('App-Bibliothek · ausgeblendet', hidden.map(function (id) {
      return { label: apps[id].title, meta: 'zeigen', run: function () {
        layout.hidden.splice(layout.hidden.indexOf(id), 1); saveLayout(); render(); toast('„' + apps[id].title + '“ ist wieder da');
      } };
    }), hidden.length > 8);
  }

  function openSheet(title, items, cols) {
    sheet = { items: items, index: 0, cols: cols ? 3 : 1 };
    $('sheet-title').textContent = title;
    var list = $('sheet-list');
    list.textContent = '';
    list.className = cols ? 'cols' : '';
    items.forEach(function (it, i) {
      var b = document.createElement('button');
      b.className = 'item';
      b.setAttribute('data-sheet', i);
      b.innerHTML = '<span></span><span class="meta"></span>';
      b.firstChild.textContent = it.label;
      b.lastChild.textContent = it.meta || '';
      list.appendChild(b);
    });
    $('overlay').classList.remove('hidden');
    applyFocus();
  }

  function closeSheet() { sheet = null; $('overlay').classList.add('hidden'); applyFocus(); }

  function moveSheet(dir) {
    var n = sheet.items.length, c = sheet.cols, i = sheet.index;
    if (dir === 'up') i -= c; else if (dir === 'down') i += c;
    else if (c > 1 && dir === 'left') i -= 1; else if (c > 1 && dir === 'right') i += 1;
    if (i >= 0 && i < n) sheet.index = i;
    applyFocus();
  }

  var toastTimer = null;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 2600);
  }

  // ---------- Fernbedienung ----------

  var okDown = false, okTimer = null, held = false, lastOk = 0;
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, handled = true;
    if (k === KEY.LEFT) move('left');
    else if (k === KEY.RIGHT) move('right');
    else if (k === KEY.UP) move('up');
    else if (k === KEY.DOWN) move('down');
    else if (k === KEY.OK) {
      if (!e.repeat && !okDown) {
        okDown = true; held = false;
        okTimer = setTimeout(function () { okTimer = null; held = true; hold(); }, HOLD_MS);
      }
    }
    else if (k === KEY.BACK || k === KEY.ESC) back();
    else if (k === KEY.BLUE) openLibrary();
    else if (k === KEY.RED) hold();
    else handled = false;   // Lautstärke, Programm, Home usw. behalten ihre Systemfunktion
    if (handled) e.preventDefault();
  });
  document.addEventListener('keyup', function (e) {
    if (e.keyCode !== KEY.OK) return;
    e.preventDefault();
    if (!okDown) return;
    okDown = false;
    if (okTimer) { clearTimeout(okTimer); okTimer = null; }
    if (!held) { lastOk = Date.now(); activate(); }
  });

  // Magic Remote (Zeiger): Hover fokussiert, Klick startet.
  document.addEventListener('mouseover', function (e) {
    if (moving) return;
    var t = e.target.closest ? e.target.closest('[data-zone],[data-sheet],#actions .pill') : null;
    if (!t) return;
    if (t.hasAttribute('data-sheet')) { if (sheet) { sheet.index = +t.getAttribute('data-sheet'); applyFocus(); } return; }
    if (sheet) return;
    if (t.classList.contains('pill')) { focus = { zone: 'actions', index: zoneEls('actions').indexOf(t) }; }
    else focus = { zone: t.getAttribute('data-zone'), index: +t.getAttribute('data-index') };
    applyFocus();
  });
  document.addEventListener('click', function (e) {
    if (Date.now() - lastOk < 400) return;   // OK der Magic Remote kommt manchmal als Taste und als Klick
    if (e.target.id === 'overlay') { closeSheet(); return; }
    var t = e.target.closest ? e.target.closest('[data-zone],[data-sheet],#actions .pill') : null;
    if (t) activate();
  });

  // ---------- Uhr ----------

  var DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function tick() {
    var d = new Date();
    $('clock').textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    $('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()];
  }

  // ---------- Start ----------

  function start(list, prefix) {
    setApps(list, prefix);
    loadLayout();
    saveLayout();
    focus = { zone: layout.dock.length ? 'dock' : 'grid', index: 0 };
    render();
  }

  tick();
  setInterval(tick, 10000);
  start(INV.apps || [], null);

  // Einmal live versuchen. Gibt der TV die Liste her, wird sie bevorzugt (dann sind auch neu installierte Apps da).
  luna('luna://com.webos.applicationManager/listLaunchPoints', {}, function (err, data) {
    if (err || !data || !Array.isArray(data.launchPoints) || !data.launchPoints.length) return;
    var baked = {};
    (INV.apps || []).forEach(function (a) { baked[a.id] = a; });
    var list = data.launchPoints.filter(function (p) { return !p.hidden; }).map(function (p) {
      var b = baked[p.id];   // mitgelieferte Icons sind zuverlässiger als file://-Pfade
      return { id: p.id, title: p.title, icon: b && b.icon ? b.icon : (p.largeIcon || p.icon),
               color: (b && b.color) || p.bgColor || p.iconColor };
    });
    start(list, 'file://');
  }, 4000);

  // Für die Browser-Vorschau
  window.__cleanhome = { layout: function () { return layout; }, focus: function () { return focus; } };
})();
