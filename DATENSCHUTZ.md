# Datensammlung am LG-TV abschalten (webOS 25)

Das bringt am meisten, ganz ohne Basteln. Menünamen können je nach Firmware leicht abweichen.
Wenn du einen Punkt nicht findest: in den Einstellungen gibt es oben eine **Suche**.

Startpunkt: Taste **Einstellungen (Zahnrad)** → **Alle Einstellungen**.

## 1. Inhaltserkennung (ACR) und Werbung

*Allgemein → System → Zusätzliche Einstellungen*

| Einstellung | Auf | Warum |
|---|---|---|
| **Live Plus** | **Aus** | Automatic Content Recognition: der TV erkennt, was du schaust, auch über HDMI, und meldet es. Der wichtigste Schalter. |
| **Werbung → Ad-Tracking einschränken** | **Ein** | Keine personalisierte Werbung über deine Werbe-ID. |
| **Werbung → Werbe-ID zurücksetzen** | einmal ausführen | Verwirft das bisher gesammelte Profil. |
| **Home-Einstellungen → Home-Promotion / Empfohlene Inhalte** | **Aus** | Weniger Werbekacheln in LGs Home. |
| **Home-Einstellungen → Home automatisch starten** | **Aus** | Beim Einschalten nicht in LGs Home landen. |

## 2. Benutzervereinbarungen widerrufen

*Support → Datenschutz & Bedingungen → Benutzervereinbarungen* (bei manchen Firmware-Ständen unter
*Allgemein → System → Zusätzliche Einstellungen*)

Nur die **Nutzungsbedingungen** (für Apps und Store nötig) und die **Datenschutzrichtlinie** zugestimmt lassen.
**Widerrufen**:

- **Sehinformationen** (Viewing Information)
- **Sprachinformationen** (Voice Information), außer du nutzt die Sprachsteuerung
- **Interessenbasierte Werbung** / geräteübergreifende Werbung
- **Live Plus / Inhaltserkennung**, falls hier separat aufgeführt
- alle weiteren optionalen Punkte (z. B. Marketing-Kommunikation)

Der TV fragt eventuell nach, ob du wirklich widerrufen willst und warnt, dass Empfehlungen nicht mehr
funktionieren. Genau das ist der Plan.

## 3. Weitere Schalter

- **Allgemein → System → Zusätzliche Einstellungen → Hinweise/Benachrichtigungen:** Werbe- und
  „Tipps“-Benachrichtigungen aus.
- **Allgemein → Externe Geräte → Geräteverbindungs-Einstellungen:** Automatische Geräteerkennung im
  Heimnetz aus, wenn du sie nicht brauchst (der TV scannt sonst andere Geräte im WLAN).
- **Allgemein → System → Standort:** Standort-Dienste auf das Nötige reduzieren.
- **Allgemein → AI-Dienste / Sprachassistent:** AI-Empfehlungen und Sprachassistent aus, falls ungenutzt.
- **LG-Konto:** ohne Anmeldung kann LG weniger zu einem Profil zusammenführen. Für den Developer Mode
  musst du allerdings angemeldet sein (das Developer-Konto reicht).
- **Software-Updates** lieber **an** lassen: Sie schließen Sicherheitslücken. Nach einem großen Update
  diese Liste nochmal prüfen, LG setzt gelegentlich Einstellungen zurück.

## 4. Optional: Werbe- und Tracking-Server per DNS sperren

Wenn du einen Pi-hole, AdGuard Home, NextDNS oder eine FRITZ!Box mit Sperrliste nutzt, kannst du diese
Domains für die IP des TVs sperren. Sie stammen aus verbreiteten Community-Sperrlisten, nicht von LG;
teste nach dem Sperren, ob deine Apps noch normal laufen.

**Werbung und Tracking (Sperren unkritisch):**

```
lgsmartad.com
ad.lgsmartad.com
info.lgsmartad.com
lgad.cjpowercast.com
alphonso.tv
```

**Mit Vorsicht (kann Store, App-Updates oder LGs Home-Inhalte stören):**

```
lgappstv.com
lgtvsdp.com
lgtvcommon.com
```

**Nicht sperren:** `developer.lge.com` (sonst läuft der Developer Mode ab und CleanHome kann
verschwinden), `snu.lge.com` / `ngfts.lge.com` (Firmware-Updates).

Tipp: Im Pi-hole/AdGuard-Log siehst du nach einem Tag, mit welchen Servern der TV wirklich spricht.
Das ist für dein Modell aussagekräftiger als jede Liste.
