# Eigene App-Icons

Lege hier Bilder ab, die CleanHome statt der Icons vom TV verwenden soll. Danach:

    node tools/cleanhome.js sync

**Dateiname** = App-Name oder App-ID, Groß-/Kleinschreibung, Leer- und Sonderzeichen egal:

| Datei | passt zu |
|---|---|
| `netflix.png` | App „Netflix“ |
| `Prime Video.png` | App „Prime Video“ |
| `youtube.leanback.v4.png` | App mit dieser ID (enthält Punkte → wird als ID gelesen) |

**Format:** PNG oder JPG, am besten **496 × 280 Pixel** (Kachelformat 16:9), höchstens 2 MB.
Das Bild füllt die ganze Kachel. Ein eigenes Bild hat Vorrang vor den eingebauten Markenkacheln.

Die Namen und IDs deiner Apps zeigt `node tools/cleanhome.js apps`.
