# CleanHome für LG webOS

Ein ruhiger, dunkler Startbildschirm für deinen **LG OLED55B39LA (webOS 25)**, angelehnt an
[cleanyourtv](https://github.com/Gathin23/cleanyourtv): deine Apps im Dock, alle übrigen in einem Raster,
Eingänge und Einstellungen als Knöpfe, Uhr und Datum, Hintergrundbilder, eigene Kacheln für bekannte Apps
und ein „Anpassen“-Bildschirm zum Ein- und Ausblenden. Keine Werbezeilen, keine Empfehlungen,
**keine Netzwerkverbindungen** (in der App per Content-Security-Policy gesperrt).

> **Vorweg:** Das Original-Projekt läuft nur auf Android-TVs. Auf webOS gibt es ohne Root kein
> „Apps deaktivieren“. Die Home-Taste leitet ein kleiner Dienst auf dem TV um (siehe unten). Das Wichtigste
> gegen die Datensammelei sind die Einstellungen in **[DATENSCHUTZ.md](DATENSCHUTZ.md)**.

| Home mit Hintergrund | Alle Apps | Anpassen | Apps ein-/ausblenden |
|---|---|---|---|
| ![](preview/1-home.png) | ![](preview/3-grid.png) | ![](preview/6-anpassen.png) | ![](preview/7-apps.png) |

*Browser-Vorschau mit Beispieldaten.*

## Was du brauchst

- Einen Computer (Windows, macOS oder Linux) im selben Netz wie der TV, mit **Node.js 18 oder neuer**
  ([nodejs.org](https://nodejs.org)).
- Ein kostenloses **LG-Developer-Konto** ([webostv.developer.lge.com](https://webostv.developer.lge.com), „Sign in“).
- Etwa 15 Minuten.

## Einrichtung

**1. Am TV: Developer Mode einschalten**

1. Im LG Content Store die App **„Developer Mode“** installieren und öffnen.
2. Mit dem LG-Developer-Konto anmelden, **Dev Mode Status** auf **ON**. Der TV startet neu.
3. Developer Mode wieder öffnen und **Key Server** auf **ON** stellen. Die angezeigte **Passphrase**
   (6 Zeichen) und die **IP-Adresse** brauchst du gleich.

**2. Am Computer: dieses Projekt holen und einrichten**

```bash
cd lg-cleanhome
```

```bash
npm install
```

```bash
node tools/cleanhome.js setup 192.168.178.40
```

(Die IP durch die deines TVs ersetzen.) Das Skript:

1. koppelt sich mit dem TV. Am TV erscheint eine Abfrage, die du mit der Fernbedienung **zulässt**;
2. liest die Liste deiner installierten Apps, ihre Icons und deine HDMI-Eingänge;
3. baut daraus das App-Paket (`dist/*.ipk`);
4. fragt nach der **Passphrase** aus der Developer-Mode-App und installiert CleanHome;
5. startet CleanHome.

**3. Am TV: CleanHome bequem erreichbar machen**

- **Home-Taste:** Ist CleanHome einmal geöffnet worden, führt die Home-Taste zu CleanHome (siehe unten).
- **Schnellzugriff:** CleanHome öffnen, dann eine **Zifferntaste (z. B. 1) lange drücken** und „Registrieren“
  wählen. Ab dann öffnet langes Drücken von 1 immer CleanHome. Praktisch nach einem Neustart des TVs.
- Unter *Einstellungen → Allgemein → System → Zusätzliche Einstellungen → Home-Einstellungen* die
  **automatische Anzeige von Home beim Einschalten** und **Home-Promotion** ausschalten.
  (Bezeichnungen können je nach Firmware leicht abweichen.)

## Bedienung

| Taste | Wirkung |
|---|---|
| Pfeile, OK | bewegen, App öffnen |
| **OK lang drücken** (oder rote Taste) | Kachel-Menü: *Verschieben*, *Ins Dock / Aus dem Dock*, *Ausblenden* |
| **Blaue Taste**, Regler-Knopf oben rechts oder Kachel „Apps verwalten“ | **Anpassen** (siehe unten) |
| Zurück | schließt Menüs, aus dem Raster zurück zum Dock. CleanHome schließt sich nie selbst. |
| Magic-Remote-Zeiger | zeigen = fokussieren, klicken = öffnen |

Die Anordnung speichert CleanHome auf dem TV. Ausblenden deinstalliert nichts.

## Anpassen

- **Apps:** jede installierte App mit zwei Schaltern, *Sichtbar / Ausgeblendet* und *Im Dock / Nicht im Dock*
  (mit ◀ ▶ zwischen den Schaltern wechseln, OK schaltet um). Ausblenden deinstalliert nichts.
- **Home-Taste öffnet CleanHome:** an/aus, mit Statusanzeige des Dienstes.
- **Hintergrund:** aus, stündlich wechselnd oder ein festes Bild (◀ ▶ blättert).
- **Markenkacheln:** eigene Kacheln in Markenfarbe für bekannte Apps (Netflix, YouTube, Prime Video, Disney+,
  Emby, Plex, Jellyfin, Crunchyroll, Paramount+, DAZN, ARD, ZDF und weitere, siehe `app/js/brands.js`).
  Aus = die Icons vom TV.
- **Anordnung zurücksetzen.**

## Home-Taste

Ein kleiner Hintergrundprozess (der „Wächter“, `helper/watcher.js`) schaut, welche App vorne ist. Erscheint
LGs Home, öffnet er sofort CleanHome. Für einen Moment ist LGs Home dabei zu sehen.

- **Notausgang:** Drückst du Home, *während CleanHome offen ist*, bleibt LGs Home stehen. So kommst du
  jederzeit an LGs eigene Menüs.
- **Wer startet ihn?** `install`/`setup` starten ihn direkt. Außerdem startet CleanHome ihn bei jedem Öffnen
  über die unsichtbare App „CleanHome Helper“ (`helper/`), falls er nicht läuft.
- **Nach einem kompletten Neustart** des TVs (Stromstecker, Update) läuft er erst wieder, wenn CleanHome
  einmal geöffnet wurde, z. B. über die Schnellzugriffs-Zifferntaste. Aus dem Standby heraus läuft er weiter.
- Abschalten: *Anpassen → Home-Taste öffnet CleanHome → Aus.*
- Er nutzt die Steuerschnittstelle des TVs mit dem Kopplungsschlüssel aus `setup`, liest nur, welche App vorne
  ist, und startet nur CleanHome. Keine Verbindungen ins Internet. Log auf dem TV: `/tmp/cleanhome-watch.log`.
- Fehlersuche: `node tools/cleanhome.js diag --kurz`

LGs eigenes Dienst-System (Luna-Services) startet bei Developer-Mode-Apps auf webOS 25 nichts. Deshalb dieser Weg.

## Eigene Icons und Hintergründe

- **Icons:** Bilder in [`custom-icons/`](custom-icons/README.md) legen (Dateiname = App-Name), dann
  `node tools/cleanhome.js sync`. Sie füllen die ganze Kachel und haben Vorrang vor allem anderen.
- **Hintergründe:** JPG/PNG in [`wallpapers/`](wallpapers/README.md) legen, dann `node tools/cleanhome.js install`.
  Mitgeliefert sind 12 frei lizenzierte Bilder (NASA-Aufnahmen, Landschaften, Illustrationen), Nachweise dort.

## Wichtig: Developer Mode läuft ab

LG beendet die Developer-Mode-Sitzung nach einiger Zeit (in der App läuft ein Countdown, typischerweise
50 Stunden ab dem letzten Verlängern). **Läuft sie ab, kann der TV selbst installierte Apps wie CleanHome
entfernen.** Dann einfach `setup` nochmal ausführen. Verlängern geht so:

- In der Developer-Mode-App am TV auf **„Extend“** drücken, oder
- vom Computer aus (Beta, ungetestet auf deinem Modell):

```bash
node tools/cleanhome.js renew
```

  Das liest das Sitzungs-Token vom TV und meldet es bei LG zurück, wie es auch
  [webOS Dev Manager](https://github.com/webosbrew/dev-manager-desktop) tut. Wer will, lässt das per
  Aufgabenplanung bzw. cron täglich laufen.

## Weitere Befehle

| Befehl | Wozu |
|---|---|
| `node tools/cleanhome.js connect` | Nur Developer-Mode-Verbindung einrichten und installieren (z. B. wenn `setup` bei Schritt 5 abbrach). |
| `node tools/cleanhome.js diag --kurz` | Fehlersuche für die Home-Umleitung. |
| `node tools/cleanhome.js apps` | App-Namen und IDs anzeigen (für `custom-icons/`). |
| `node tools/cleanhome.js sync` | Neue App installiert? Liste und Icons neu holen und CleanHome aktualisieren. |
| `node tools/cleanhome.js uninstall` | CleanHome entfernen. Der TV ist danach wie vorher. |
| `node tools/cleanhome.js status` | Zeigt gekoppelten TV und Stand der App-Liste. |
| `npm run preview` | Browser-Vorschau mit Beispieldaten rendern (braucht Playwright). |

## Was wo gespeichert und gesendet wird

- **Auf dem Computer:** `~/.lg-cleanhome/state.json` (TV-IP, Kopplungsschlüssel, Zertifikat-Fingerabdruck),
  `~/.webos/` (SSH-Schlüssel für den Developer Mode, von LGs ares-cli).
- **Auf dem TV:** die App und deine Anordnung (localStorage der App).
- **Ins Internet:** nichts. Ausnahme: `renew` spricht mit `developer.lge.com`, wie die Developer-Mode-App selbst.

## Grenzen

- Die **Home-Taste** wird nicht abgefangen, sondern umgeleitet: LGs Home blitzt kurz auf. Ohne Root geht es
  nicht sauberer.
- Neu installierte Apps erscheinen erst nach `sync` (webOS 25 gibt Developer-Mode-Apps die App-Liste nicht
  heraus; CleanHome fragt trotzdem bei jedem Start einmal nach und nutzt sie, falls doch).
- LGs eigene Werbeflächen in anderen Menüs (Einstellungen, Eingangsauswahl) bleiben. Dagegen hilft
  [DATENSCHUTZ.md](DATENSCHUTZ.md).

## Aufbau

```
app/                 die TV-App (HTML/CSS/JS, keine Abhängigkeiten)
  appinfo.json       App-ID io.cleanhome.tv, Luna-Recht nur zum Starten von Apps
  js/home.js         Oberfläche, Navigation, Anpassen, Starten
  js/brands.js       Markenkacheln (Farbe + Schrift, keine Logos)
  js/inventory.js    App-Liste deines TVs (wird von setup/sync erzeugt)
helper/              unsichtbare Helper-App und Wächter, der die Home-Taste zu CleanHome umleitet
custom-icons/        eigene App-Icons (optional)
wallpapers/          Hintergrundbilder
tools/cleanhome.js   Kopplung, App-Liste und Icons lesen, bauen, installieren
preview/             Browser-Vorschau mit Beispieldaten
```
