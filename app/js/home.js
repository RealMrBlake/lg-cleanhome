/*
 * CleanHome — ein ruhiger Startbildschirm für LG webOS (Developer Mode, ohne Root).
 *
 * Was die App auf dem TV tut — und nur das:
 *   - Apps und Eingänge über den webOS Application Manager starten (luna://com.webos.applicationManager/launch)
 *   - einmal versuchen, die App-Liste live zu lesen (wird Developer-Mode-Apps auf webOS 25 meist verweigert,
 *     dann gilt die Liste aus inventory.js, die das Einrichtungsskript vom TV geholt hat)
 *   - den eigenen Dienst io.cleanhome.tv.service starten, der die Home-Taste zu CleanHome umleitet
 *   - Anordnung und Einstellungen im localStorage der App speichern
 * Keine Netzwerkverbindungen, keine Analytik (siehe Content-Security-Policy in index.html).
 */
(function () {
  'use strict';

  var INV = window.CLEANHOME_INVENTORY || { apps: [], inputs: [], shortcuts: {} };
  INV.shortcuts = INV.shortcuts || {};
  var BRANDS = window.CLEANHOME_BRANDS || [];
  var WALLS = window.CLEANHOME_WALLPAPERS || [];
  var SELF_ID = 'io.cleanhome.tv';
  var SERVICE = 'luna://io.cleanhome.tv.service/';
  var STORE_KEY = 'cleanhome.layout.v1';
  var COLS = 6;
  var DOCK_MAX = 6;
  var HOLD_MS = 600;
  var WALL_ROTATE_MS = 60 * 60 * 1000;
  var KEY = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, OK: 13, BACK: 461, ESC: 27, RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406 };
  var PREFERRED_DOCK = [/^netflix/i, /^youtube$/i, /prime video/i, /^disney/i, /^apple tv/i, /^spotify/i, /^emby/i, /^plex/i, /^crunchyroll/i, /^paramount/i];
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
  var apps = {};       // id -> {id, title, icon, fill, custom, color, brand}
  var layout = null;   // {dock:[], order:[], hidden:[], settings:{}}
  var DEFAULT_SETTINGS = { home: true, brand: true, wallpaper: 'auto' };

  function brandFor(title) {
    for (var i = 0; i < BRANDS.length; i++) if (BRANDS[i].match.test(title)) return BRANDS[i];
    return null;
  }

  function setApps(list, iconPrefix) {
    apps = {};
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (!a || typeof a.id !== 'string' || !ID_RE.test(a.id) || a.id === SELF_ID || NOISE.test(a.id)) continue;
      var icon = a.icon || null;
      if (icon && iconPrefix && icon.charAt(0) === '/') icon = iconPrefix + icon;
      var title = String(a.title || a.id).slice(0, 48);
      apps[a.id] = { id: a.id, title: title, icon: icon, fill: !!a.fill, custom: !!a.custom, color: a.color || null, brand: brandFor(title) };
    }
  }

  function loadLayout() {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { saved = null; }
    var fresh = !saved || !Array.isArray(saved.dock);
    if (fresh) saved = { dock: [], order: [], hidden: [] };
    layout = { dock: saved.dock, order: saved.order || [], hidden: saved.hidden || [], settings: {} };
    var s = saved.settings || {};
    for (var k in DEFAULT_SETTINGS) layout.settings[k] = s.hasOwnProperty(k) ? s[k] : DEFAULT_SETTINGS[k];
    if (fresh) {
      var ids = Object.keys(apps);
      PREFERRED_DOCK.forEach(function (re) {
        if (layout.dock.length >= 5) return;
        for (var i = 0; i < ids.length; i++) if (re.test(apps[ids[i]].title) && layout.dock.indexOf(ids[i]) < 0) { layout.dock.push(ids[i]); break; }
      });
    }
    reconcile();
  }

  function sortedIds() {
    return Object.keys(apps).sort(function (a, b) { return apps[a].title.localeCompare(apps[b].title, 'de'); });
  }

  function reconcile() {
    // Entfernte Apps vergessen, neue Apps hinten anhängen.
    function keep(id) { return !!apps[id]; }
    layout.dock = uniq(layout.dock.filter(keep)).slice(0, DOCK_MAX);
    layout.hidden = uniq(layout.hidden.filter(keep));
    layout.order = uniq(layout.order.filter(keep));
    var ids = sortedIds();
    for (var i = 0; i < ids.length; i++) if (layout.order.indexOf(ids[i]) < 0) layout.order.push(ids[i]);
    if (!layout.dock.length && !layout.hidden.length) layout.dock = ids.slice(0, 5);
  }

  function saveLayout() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(layout)); } catch (e) { /* voll oder gesperrt */ }
  }

  function uniq(a) { var s = {}, o = []; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; o.push(a[i]); } return o; }
  function gridIds() {
    return layout.order.filter(function (id) { return layout.dock.indexOf(id) < 0 && layout.hidden.indexOf(id) < 0; });
  }
  function isHidden(id) { return layout.hidden.indexOf(id) >= 0; }
  function inDock(id) { return layout.dock.indexOf(id) >= 0; }

  function setHidden(id, hide) {
    var h = layout.hidden.indexOf(id);
    if (hide && h < 0) { layout.hidden.push(id); var d = layout.dock.indexOf(id); if (d >= 0) layout.dock.splice(d, 1); }
    if (!hide && h >= 0) layout.hidden.splice(h, 1);
  }
  function setDock(id, on) {
    var d = layout.dock.indexOf(id);
    if (on && d < 0) {
      if (layout.dock.length >= DOCK_MAX) { toast('Das Dock ist voll (' + DOCK_MAX + ' Apps)'); return false; }
      setHidden(id, false); layout.dock.push(id);
    }
    if (!on && d >= 0) layout.dock.splice(d, 1);
    return true;
  }

  // ---------- Darstellung ----------

  var $ = function (id) { return document.getElementById(id); };
  var view = 'home';     // 'home' | 'settings'
  var focus = { zone: 'dock', index: 0 };
  var moving = null;     // {zone, id} während „Verschieben“
  var sheet = null;      // offenes Menü: {items:[{label, meta, run}], index}

  function hashHue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) % 360; }
  function appColor(a) { return a.color || 'hsl(' + hashHue(a.id) + ',38%,34%)'; }
  function glowColor(a) {
    if (a.brand && layout.settings.brand && !a.custom) return /^#/.test(a.brand.fg) && a.brand.fg !== '#ffffff' ? a.brand.fg : (/^#/.test(a.brand.bg) ? a.brand.bg : '#3a4a6b');
    return appColor(a);
  }

  function artEl(a) {
    var art = document.createElement('div');
    art.className = 'art';
    var brand = a.brand && layout.settings.brand && !a.custom ? a.brand : null;
    if (brand) {
      art.style.background = brand.bg;
      var t = document.createElement('div');
      t.className = 'brand brand-' + (brand.style || 'heavy');
      t.style.color = brand.fg;
      t.style.fontSize = (brand.size || 40) + 'px';
      t.textContent = brand.text;
      art.appendChild(t);
      return art;
    }
    art.style.background = appColor(a);
    var letter = document.createElement('div');
    letter.className = 'letter';
    letter.textContent = a.title.charAt(0).toUpperCase();
    art.appendChild(letter);
    if (a.icon) {
      var img = new Image();
      img.className = a.custom ? 'cover' : (a.fill ? 'full' : 'inset');
      img.onload = function () { art.textContent = ''; art.appendChild(img); };
      img.src = a.icon;
    }
    return art;
  }

  function tileEl(a, zone, idx) {
    var t = document.createElement('button');
    t.className = 'tile';
    t.setAttribute('data-zone', zone);
    t.setAttribute('data-index', idx);
    if (a) {
      t.appendChild(artEl(a));
      var name = document.createElement('div');
      name.className = 'name';
      name.textContent = a.title;
      t.appendChild(name);
    } else {
      t.classList.add('empty');
      var art = document.createElement('div');
      art.className = 'art';
      art.innerHTML = '<div class="letter small">Apps verwalten</div>';
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
    grid.appendChild(tileEl(null, 'grid', g.length));   // „Apps verwalten“ öffnet Anpassen
    applyWallpaper();
    applyFocus();
  }

  function zoneEls(zone) {
    if (zone === 'actions') return Array.prototype.filter.call(document.querySelectorAll('#actions .pill'), function (e) { return !e.classList.contains('hidden'); });
    if (zone === 'dock') return Array.prototype.slice.call($('dock').children);
    if (zone === 'grid') return Array.prototype.slice.call($('grid').children);
    return [];
  }

  function clearFocus() {
    var all = document.querySelectorAll('.focus, .moving');
    for (var i = 0; i < all.length; i++) all[i].classList.remove('focus', 'moving');
  }

  function applyFocus() {
    clearFocus();
    if (sheet) {
      var items = $('sheet-list').children;
      if (items[sheet.index]) items[sheet.index].classList.add('focus');
      return;
    }
    if (view === 'settings') return applySettingsFocus();

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
      document.body.classList.add('grid');
      main.style.transform = 'translateY(' + (-360 - Math.max(0, row - 1) * 184) + 'px)';
    } else {
      document.body.classList.remove('grid');
      main.style.transform = '';
    }

    // Top-Regal und Leuchten zeigen die fokussierte App.
    var a = focusedApp();
    $('shelf-title').textContent = a ? a.title : (focus.zone === 'grid' ? 'Apps verwalten' : '');
    $('shelf-sub').textContent = a ? (focus.zone === 'dock' ? 'Im Dock' : '') : (focus.zone === 'grid' ? 'Apps ein- und ausblenden' : '');
    document.documentElement.style.setProperty('--glow', a ? glowColor(a) : '#3a4a6b');
  }

  function focusedId() {
    if (focus.zone === 'dock') return layout.dock[focus.index];
    if (focus.zone === 'grid') return gridIds()[focus.index];
    return null;
  }
  function focusedApp() { var id = focusedId(); return id ? apps[id] : null; }

  // ---------- Hintergrund ----------

  var wallTimer = null;
  function currentWall() {
    var w = layout.settings.wallpaper;
    if (w === 'off' || !WALLS.length) return null;
    if (w === 'auto') return WALLS[Math.floor(Date.now() / WALL_ROTATE_MS) % WALLS.length];
    for (var i = 0; i < WALLS.length; i++) if (WALLS[i].file === w) return WALLS[i];
    return WALLS[0];
  }
  function applyWallpaper() {
    var w = currentWall();
    var el = $('wall');
    document.body.classList.toggle('has-wall', !!w);
    if (!w) { el.style.backgroundImage = ''; $('wall-credit').textContent = ''; return; }
    var url = 'url("' + w.file + '")';
    if (el.getAttribute('data-file') !== w.file) {
      el.style.opacity = '0';
      setTimeout(function () { el.style.backgroundImage = url; el.setAttribute('data-file', w.file); el.style.opacity = '1'; }, 250);
    }
    $('wall-credit').textContent = w.own ? '' : w.credit;
    clearTimeout(wallTimer);
    if (layout.settings.wallpaper === 'auto') wallTimer = setTimeout(applyWallpaper, WALL_ROTATE_MS - (Date.now() % WALL_ROTATE_MS) + 500);
  }

  // ---------- Home-Tasten-Dienst ----------

  var homeStatus = null;   // Antwort des Dienstes oder {error}
  function startHomeService(cb) {
    luna(SERVICE + 'start', { enabled: !!layout.settings.home }, function (err, d) {
      homeStatus = err ? { error: err.message } : d;
      if (cb) cb();
    }, 8000);
  }
  function homeStatusText() {
    if (!hasBridge()) return 'Nur auf dem TV verfügbar';
    if (!homeStatus) return 'Prüfe …';
    if (homeStatus.error && !homeStatus.returnValue) return 'Dienst nicht erreichbar: ' + homeStatus.error;
    if (!homeStatus.enabled) return 'Aus: die Home-Taste öffnet LGs Home';
    if (homeStatus.connected) return 'Aktiv · Home aus CleanHome heraus öffnet LGs Home' + (homeStatus.redirects ? ' · ' + homeStatus.redirects + '× umgeleitet' : '');
    return 'Verbindet … ' + (homeStatus.error ? '(' + homeStatus.error + ')' : '');
  }

  // ---------- Anpassen (Einstellungen) ----------

  var srows = [];          // [{type, ...}]
  var sfocus = { row: 0, col: 0 };
  var confirmReset = false;

  function wallLabel() {
    var w = layout.settings.wallpaper;
    if (w === 'off') return 'Aus (schwarz)';
    if (w === 'auto') return 'Wechselnd (stündlich)';
    var c = currentWall();
    return c ? c.credit.split(' · ')[0] : 'Aus';
  }
  function cycleWallpaper(dir) {
    var opts = ['off', 'auto'].concat(WALLS.map(function (w) { return w.file; }));
    var i = opts.indexOf(layout.settings.wallpaper);
    layout.settings.wallpaper = opts[(i + dir + opts.length) % opts.length];
    saveLayout(); applyWallpaper();
  }

  function buildSettings() {
    srows = [];
    srows.push({ type: 'head', label: 'Allgemein' });
    srows.push({ type: 'toggle', label: 'Home-Taste öffnet CleanHome', sub: homeStatusText, value: function () { return layout.settings.home; },
      run: function () { layout.settings.home = !layout.settings.home; saveLayout(); homeStatus = null; startHomeService(renderSettings); } });
    srows.push({ type: 'choice', label: 'Hintergrund', sub: function () { var c = currentWall(); return c && !c.own && layout.settings.wallpaper !== 'auto' ? c.credit : (WALLS.length ? 'OK oder ◀ ▶ zum Wechseln' : 'Keine Bilder vorhanden'); }, value: wallLabel,
      run: function (dir) { cycleWallpaper(dir || 1); } });
    srows.push({ type: 'toggle', label: 'Markenkacheln für bekannte Apps', sub: function () { return 'Eigene Kacheln statt der Icons vom TV (Netflix, YouTube, Emby …)'; },
      value: function () { return layout.settings.brand; }, run: function () { layout.settings.brand = !layout.settings.brand; saveLayout(); render(); } });
    srows.push({ type: 'action', label: 'Anordnung zurücksetzen', sub: function () { return confirmReset ? 'Nochmal OK drücken zum Bestätigen' : 'Dock, Reihenfolge und ausgeblendete Apps'; },
      run: function () {
        if (!confirmReset) { confirmReset = true; return; }
        confirmReset = false;
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* egal */ }
        var keepSettings = layout.settings;
        loadLayout(); layout.settings = keepSettings; saveLayout(); render(); toast('Anordnung zurückgesetzt');
      } });
    srows.push({ type: 'head', label: 'Apps · ' + Object.keys(apps).length + ' installiert' });
    sortedIds().forEach(function (id) { srows.push({ type: 'app', id: id }); });
  }

  function renderSettings() {
    var list = $('settings-list');
    list.textContent = '';
    srows.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'srow srow-' + r.type;
      row.setAttribute('data-row', i);
      if (r.type === 'head') { row.textContent = r.label; list.appendChild(row); return; }
      if (r.type === 'app') {
        var a = apps[r.id];
        var mini = document.createElement('div');
        mini.className = 'mini';
        mini.appendChild(artEl(a));
        var label = document.createElement('div');
        label.className = 'slabel';
        label.innerHTML = '<div class="stitle"></div><div class="ssub"></div>';
        label.firstChild.textContent = a.title;
        label.lastChild.textContent = isHidden(a.id) ? 'Ausgeblendet' : inDock(a.id) ? 'Im Dock' : 'Im Raster';
        row.appendChild(mini); row.appendChild(label);
        row.appendChild(chip(isHidden(a.id) ? 'Ausgeblendet' : 'Sichtbar', !isHidden(a.id), i, 0, 'dot'));
        row.appendChild(chip(inDock(a.id) ? 'Im Dock' : 'Nicht im Dock', inDock(a.id), i, 1, 'dot'));
        if (isHidden(a.id)) row.classList.add('off');
      } else {
        var l = document.createElement('div');
        l.className = 'slabel';
        l.innerHTML = '<div class="stitle"></div><div class="ssub"></div>';
        l.firstChild.textContent = r.label;
        l.lastChild.textContent = r.sub ? r.sub() : '';
        row.appendChild(l);
        if (r.type === 'toggle') row.appendChild(chip(r.value() ? 'An' : 'Aus', r.value(), i, 0, 'dot'));
        else if (r.type === 'choice') row.appendChild(chip('◀  ' + r.value() + '  ▶', true, i, 0, 'wide'));
        else row.appendChild(chip(confirmReset ? 'Wirklich?' : 'Zurücksetzen', confirmReset, i, 0));
      }
      list.appendChild(row);
    });
    applyFocus();
  }

  function chip(text, on, row, col, extra) {
    var c = document.createElement('button');
    c.className = 'chip' + (on ? ' on' : '') + (extra ? ' ' + extra : '');
    c.setAttribute('data-srow', row);
    c.setAttribute('data-scol', col);
    c.textContent = text;
    return c;
  }

  function applySettingsFocus() {
    var row = $('settings-list').querySelector('[data-row="' + sfocus.row + '"]');
    if (!row) return;
    var chips = row.querySelectorAll('.chip');
    sfocus.col = Math.min(sfocus.col, chips.length - 1);
    if (chips[sfocus.col]) chips[sfocus.col].classList.add('focus');
    row.classList.add('focus');
    // Mitscrollen: fokussierte Zeile im sichtbaren Bereich halten.
    var box = $('settings-scroll'), list = $('settings-list');
    var top = row.offsetTop, h = box.clientHeight;
    var y = Math.max(0, Math.min(top - h * 0.35, list.scrollHeight - h));
    list.style.transform = 'translateY(' + (-y) + 'px)';
  }

  function openSettings(toApps) {
    view = 'settings';
    confirmReset = false;
    buildSettings();
    sfocus = { row: 1, col: 0 };
    if (toApps) for (var i = 0; i < srows.length; i++) if (srows[i].type === 'app') { sfocus.row = i; break; }
    document.body.classList.add('settings-open');
    $('settings').classList.remove('hidden');
    renderSettings();
    if (hasBridge()) startHomeService(function () { if (view === 'settings') renderSettings(); });
  }
  function closeSettings() {
    view = 'home';
    document.body.classList.remove('settings-open');
    $('settings').classList.add('hidden');
    render();
  }

  function moveSettings(dir) {
    var r = sfocus.row;
    if (dir === 'up' || dir === 'down') {
      var step = dir === 'up' ? -1 : 1;
      do { r += step; } while (srows[r] && srows[r].type === 'head');
      if (srows[r]) sfocus.row = r;
    } else if (srows[r].type === 'choice') {
      srows[r].run(dir === 'left' ? -1 : 1); renderSettings(); return;
    } else if (srows[r].type === 'app') {
      sfocus.col = dir === 'left' ? 0 : 1;
    }
    if (srows[sfocus.row].type !== 'action') confirmReset = false;
    renderSettings();
  }

  function activateSettings() {
    var r = srows[sfocus.row];
    if (!r) return;
    if (r.type === 'app') {
      if (sfocus.col === 0) setHidden(r.id, !isHidden(r.id));
      else setDock(r.id, !inDock(r.id));
      saveLayout();
    } else r.run(1);
    renderSettings();
  }

  // ---------- Navigation (Home) ----------

  function move(dir) {
    if (sheet) return moveSheet(dir);
    if (view === 'settings') return moveSettings(dir);
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
    if (view === 'settings') return activateSettings();
    if (moving) { moving = null; toast('Gespeichert'); applyFocus(); return; }
    if (focus.zone === 'actions') { action(zoneEls('actions')[focus.index].getAttribute('data-action')); return; }
    var a = focusedApp();
    if (a) launch(a.id, a.title);
    else if (focus.zone === 'grid') openSettings(true);
  }

  function hold() {
    if (sheet || moving || view !== 'home' || focus.zone === 'actions') return;
    var a = focusedApp();
    if (!a) return;
    var zone = focus.zone;
    var items = [{ label: 'Verschieben', meta: 'Pfeile, dann OK', run: function () { moving = { zone: zone, id: a.id }; applyFocus(); } }];
    if (zone === 'dock') items.push({ label: 'Aus dem Dock nehmen', run: function () { setDock(a.id, false); saveLayout(); render(); } });
    else items.push({ label: 'Ins Dock legen', meta: layout.dock.length >= DOCK_MAX ? 'Dock ist voll' : '', run: function () { if (setDock(a.id, true)) { saveLayout(); render(); } } });
    items.push({ label: 'Ausblenden', meta: 'bleibt installiert', run: function () {
      setHidden(a.id, true); saveLayout(); render(); toast('„' + a.title + '“ ausgeblendet · Anpassen holt es zurück');
    } });
    items.push({ label: 'Abbrechen', run: function () {} });
    openSheet(a.title, items);
  }

  function back() {
    if (sheet) { closeSheet(); return; }
    if (view === 'settings') { closeSettings(); return; }
    if (moving) { moving = null; applyFocus(); return; }
    if (focus.zone === 'grid') { focus.zone = layout.dock.length ? 'dock' : 'actions'; focus.index = 0; applyFocus(); return; }
    // Auf Home tut Zurück nichts: der Launcher schließt sich nicht selbst.
  }

  // ---------- Aktionen und Menüs ----------

  function action(kind) {
    if (kind === 'settings') launch(INV.shortcuts.settings || 'com.palm.app.settings', 'TV-Einstellungen');
    else if (kind === 'livetv') launch(INV.shortcuts.livetv || 'com.webos.app.livetv', 'Live-TV');
    else if (kind === 'inputs') openInputs();
    else if (kind === 'customize') openSettings(false);
  }

  function openInputs() {
    var items = (INV.inputs || []).map(function (x) {
      return { label: x.label, meta: x.connected ? 'verbunden' : '', run: function () { launch(x.app, x.label); } };
    });
    if (INV.shortcuts.livetv) items.push({ label: 'Live-TV', run: function () { launch(INV.shortcuts.livetv, 'Live-TV'); } });
    if (!items.length) { launch(INV.shortcuts.inputs || 'com.webos.app.inputpicker', 'Eingänge'); return; }
    openSheet('Eingänge', items);
  }

  function openSheet(title, items) {
    sheet = { items: items, index: 0 };
    $('sheet-title').textContent = title;
    var list = $('sheet-list');
    list.textContent = '';
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
    var i = sheet.index + (dir === 'up' ? -1 : dir === 'down' ? 1 : 0);
    if (i >= 0 && i < sheet.items.length) sheet.index = i;
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
    else if (k === KEY.BLUE) { if (view === 'settings') closeSettings(); else if (!sheet) openSettings(false); }
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

  // Magic Remote (Zeiger): Hover fokussiert, Klick löst aus.
  function target(e) {
    return e.target.closest ? e.target.closest('[data-zone],[data-sheet],[data-srow],#actions .pill') : null;
  }
  document.addEventListener('mouseover', function (e) {
    if (moving) return;
    var t = target(e);
    if (!t) return;
    if (t.hasAttribute('data-sheet')) { if (sheet) { sheet.index = +t.getAttribute('data-sheet'); applyFocus(); } return; }
    if (sheet) return;
    if (t.hasAttribute('data-srow')) {
      if (view !== 'settings') return;
      sfocus = { row: +t.getAttribute('data-srow'), col: +t.getAttribute('data-scol') };
      clearFocus(); t.classList.add('focus'); t.parentNode.classList.add('focus');   // ohne Scrollen
      return;
    }
    if (view !== 'home') return;
    if (t.classList.contains('pill')) focus = { zone: 'actions', index: zoneEls('actions').indexOf(t) };
    else focus = { zone: t.getAttribute('data-zone'), index: +t.getAttribute('data-index') };
    applyFocus();
  });
  document.addEventListener('click', function (e) {
    if (Date.now() - lastOk < 400) return;   // OK der Magic Remote kommt manchmal als Taste und als Klick
    if (e.target.id === 'overlay') { closeSheet(); return; }
    if (target(e)) activate();
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
    if (!INV.shortcuts.livetv && hasBridge()) $('btn-livetv').classList.add('hidden');
    if (view === 'settings') { buildSettings(); renderSettings(); return; }
    focus = { zone: layout.dock.length ? 'dock' : 'grid', index: 0 };
    render();
  }

  tick();
  setInterval(tick, 10000);
  start(INV.apps || [], null);
  startHomeService();

  // Einmal live versuchen. Gibt der TV die Liste her, wird sie bevorzugt (dann sind auch neu installierte Apps da).
  luna('luna://com.webos.applicationManager/listLaunchPoints', {}, function (err, data) {
    if (err || !data || !Array.isArray(data.launchPoints) || !data.launchPoints.length) return;
    var baked = {};
    (INV.apps || []).forEach(function (a) { baked[a.id] = a; });
    var list = data.launchPoints.filter(function (p) { return !p.hidden; }).map(function (p) {
      var b = baked[p.id];   // mitgelieferte Icons sind zuverlässiger als file://-Pfade
      return b ? b : { id: p.id, title: p.title, icon: p.largeIcon || p.icon, color: p.bgColor || p.iconColor };
    });
    start(list, 'file://');
  }, 4000);

  // Für die Browser-Vorschau
  window.__cleanhome = {
    layout: function () { return layout; }, focus: function () { return focus; },
    view: function () { return view; }, sfocus: function () { return sfocus; }
  };
})();
