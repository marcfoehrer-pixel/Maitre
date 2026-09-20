# Tetris

Ein vollständiges Tetris für den Browser — ohne Framework, ohne Build-Schritt.
`index.html` öffnen und spielen.

## Starten

```bash
git clone https://github.com/marcfoehrer-pixel/Maitre.git
cd Maitre
```

Dann `index.html` im Browser öffnen. Alternativ über einen lokalen Server:

```bash
npx serve .
```

## Steuerung

| Taste | Funktion |
| --- | --- |
| ◀ ▶ | bewegen (mit Auto-Repeat beim Halten) |
| ▼ | Soft Drop (1 Punkt je Feld) |
| Leertaste | Hard Drop (2 Punkte je Feld) |
| ▲ oder `X` | im Uhrzeigersinn drehen |
| `Z` oder `Strg` | gegen den Uhrzeigersinn drehen |
| `A` | 180° drehen |
| `C` oder `Shift` | Hold (einmal pro Stein) |
| `P` oder `Esc` | Pause |
| `Enter` | neues Spiel |

Am Touchscreen: wischen bewegt, tippen dreht, nach unten wischen wirft ab.
Zusätzlich gibt es eine Tastenleiste; Halten von ◀ ▶ ▼ wiederholt die Aktion.
Das eingeblendete Overlay ist antippbar — Starten, Pausieren und Neustart
funktionieren damit ganz ohne Tastatur.

## Was drin ist

- **SRS-Rotation mit Wall Kicks** — Steine drehen sich auch an Wand und Stapel
  korrekt hinein, inklusive der abweichenden Kick-Tabelle für das I-Stück.
- **7-Bag-Randomizer** — jedes der sieben Tetrominos kommt pro Beutel genau
  einmal, statt echter Zufall mit Dürrestrecken.
- **Hold-Slot** mit Vorschau auf die nächsten vier Steine.
- **Ghost-Piece** zeigt die Landeposition.
- **Lock Delay** (500 ms, max. 15 Rücksetzungen) — kurze Korrektur, bevor ein
  aufliegender Stein fixiert wird.
- **T-Spin-Erkennung** nach der 3-Corner-Regel, inklusive Mini-Unterscheidung.
- **Scoring nach Guideline**: Single 100, Double 300, Triple 500, Tetris 800,
  T-Spins bis 1600 — jeweils mal Level, plus Back-to-Back (+50 %),
  Combo-Bonus und Perfect Clear.
- **Level** steigt alle zehn Reihen, die Fallgeschwindigkeit zieht mit an.
- **Rekord** wird lokal im Browser gespeichert.

## Aufbau

```
index.html          Seitengerüst
styles.css          Gestaltung, inkl. Mobil-Layout
src/engine.js       Spiellogik — ohne DOM, in Node testbar
src/renderer.js     Zeichnen auf Canvas
src/main.js         Spielschleife, Tastatur- und Touch-Steuerung
test/engine.test.js Tests der Spiellogik
tools/              Build zur Einzeldatei
```

Die Logik in `src/engine.js` kennt weder Canvas noch Tastatur. Sie läuft
deshalb direkt in Node und ist vollständig testbar — das Rendering lässt sich
austauschen, ohne die Spielregeln anzufassen.

## Einzeldatei bauen

```bash
npm run build      # -> dist/tetris.html
```

Fasst HTML, CSS und Skripte in eine einzige Datei zusammen — zum Verschicken,
für einen USB-Stick oder zum Offline-Spielen.

## Tests

```bash
npm test
```

26 Tests decken Bewegung und Kollision, Wall Kicks, 7-Bag, Hold, Ghost-Piece,
Reihenauflösung, Scoring inklusive Back-to-Back, Combo, Perfect Clear und
T-Spin, Level-Aufstieg, Pause sowie Game Over ab.

Der Zufallsgenerator ist über `new Tetris({ seed: 42 })` festlegbar, damit
Testläufe reproduzierbar sind.

## Debug-Zugriff

Im Browser liegt die laufende Partie unter `window.Tetris`:

```js
Tetris.game.score = 10000;   // Zustand verändern
Tetris.game.level = 10;      // Fallgeschwindigkeit testen
Tetris.newGame();            // neu starten
```
