'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Die Oberflaeche ist der Teil, den niemand kompiliert — ein fehlender
// Dateiname faellt sonst erst am iPhone auf, und zwar als leere Seite.
const PUBLIC = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(PUBLIC, file));

test('Alle in der Seite verlinkten Dateien liegen auch vor', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:src|href)="([^"#:]+)"/g)].map((m) => m[1]);
  assert.ok(refs.length >= 5, 'zu wenige Verweise gefunden — stimmt das Muster noch?');
  for (const ref of refs) {
    if (ref.startsWith('data:')) continue;
    assert.ok(exists(ref), `verlinkte Datei fehlt: ${ref}`);
  }
});

test('Das Manifest ist gueltig und zeigt auf vorhandene Symbole', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.strictEqual(manifest.display, 'standalone', 'sonst startet es nicht wie eine App');
  assert.ok(manifest.name && manifest.short_name);
  assert.ok(manifest.icons.length >= 2);
  for (const icon of manifest.icons) assert.ok(exists(icon.src), `Symbol fehlt: ${icon.src}`);
});

test('Das Symbol fuer den Home-Bildschirm ist ein PNG — iOS nimmt kein SVG', () => {
  const html = read('index.html');
  const match = /<link rel="apple-touch-icon" href="([^"]+)"/.exec(html);
  assert.ok(match, 'apple-touch-icon fehlt: das Symbol auf dem Home-Bildschirm bliebe leer');
  assert.ok(match[1].endsWith('.png'), 'iOS akzeptiert fuer apple-touch-icon kein SVG');
  const file = fs.readFileSync(path.join(PUBLIC, match[1]));
  assert.deepStrictEqual([...file.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'keine PNG-Signatur');
});

test('Die Seite ist fuer das iPhone ausgezeichnet', () => {
  const html = read('index.html');
  // Nur das Viewport-Tag selbst pruefen, nicht die ganze Datei — ein Kommentar,
  // der die Regel erklaert, ist kein Verstoss gegen sie.
  const viewport = /<meta name="viewport" content="([^"]+)"/.exec(html);
  assert.ok(viewport, 'kein Viewport-Tag');
  assert.match(viewport[1], /viewport-fit=cover/, 'ohne viewport-fit bleiben die Raender am Notch leer');
  assert.doesNotMatch(viewport[1], /user-scalable\s*=\s*no/, 'Zoom darf nicht gesperrt werden');
  assert.doesNotMatch(viewport[1], /maximum-scale\s*=\s*1/, 'Zoom darf nicht gedeckelt werden');
  assert.match(html, /apple-mobile-web-app-capable" content="yes"/);
  assert.match(html, /<html lang="de">/);
  // Beide Farbschemata muessen eine eigene Leistenfarbe haben.
  assert.match(html, /theme-color" content="[^"]+" media="\(prefers-color-scheme: light\)"/);
  assert.match(html, /theme-color" content="[^"]+" media="\(prefers-color-scheme: dark\)"/);
});

test('Sichere Raender werden im Stylesheet tatsaechlich benutzt', () => {
  const css = read('dashboard.css');
  for (const inset of ['safe-area-inset-top', 'safe-area-inset-bottom', 'safe-area-inset-left']) {
    assert.ok(css.includes(inset), `${inset} wird nicht berücksichtigt`);
  }
  assert.match(css, /--tap:\s*44px/, 'die kleinste Trefferfläche ist nicht festgelegt');
});

test('Jedes Element mit id wird nur einmal vergeben', () => {
  const ids = [...read('index.html').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.strictEqual(new Set(ids).size, ids.length, 'doppelte id im Markup');
});

test('Die Oberflaeche spricht nur ihre eigenen Endpunkte an', () => {
  const js = read('dashboard.js');
  const urls = [...js.matchAll(/(?:fetch|EventSource)\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 2);
  for (const url of urls) {
    assert.ok(url.startsWith('/api/'), `unerwarteter Endpunkt: ${url}`);
  }
});
