'use strict';

const test = require('node:test');
const assert = require('node:assert');
const ind = require('../lib/indicators');
const features = require('../lib/features');
const fixture = require('./fixtures/kurse');

const close = (values) =>
  values.map((v, i) => ({ t: i * 300000, o: v, h: v + 0.5, l: v - 0.5, c: v, v: 1000 }));

test('SMA mittelt das gleitende Fenster und laesst den Vorlauf leer', () => {
  const out = ind.sma([1, 2, 3, 4, 5], 3);
  assert.deepStrictEqual(out, [null, null, 2, 3, 4]);
});

test('EMA startet auf dem SMA und gewichtet danach den neuen Wert', () => {
  const out = ind.ema([1, 2, 3, 4, 5], 3);
  assert.strictEqual(out[0], null);
  assert.strictEqual(out[2], 2);
  assert.strictEqual(out[3], 4 * 0.5 + 2 * 0.5);
});

test('RSI liegt zwischen 0 und 100 und wird bei reinem Anstieg maximal', () => {
  const rising = ind.rsi(Array.from({ length: 40 }, (_, i) => 100 + i), 14);
  assert.strictEqual(rising.at(-1), 100);
  const falling = ind.rsi(Array.from({ length: 40 }, (_, i) => 100 - i), 14);
  assert.strictEqual(falling.at(-1), 0);
});

test('ATR misst die wahre Spanne inklusive Kurslücken', () => {
  const candles = [
    { t: 0, o: 10, h: 11, l: 9, c: 10, v: 1 },
    { t: 1, o: 20, h: 21, l: 19, c: 20, v: 1 },
  ];
  const tr = ind.trueRange(candles);
  assert.strictEqual(tr[0], 2);
  // Der Sprung von 10 auf 19/21 zaehlt als Spanne, nicht nur Hoch minus Tief.
  assert.strictEqual(tr[1], 11);
});

test('VWAP wird zu jedem Handelstag zurueckgesetzt', () => {
  const day1 = Date.parse('2026-03-02T10:00:00Z');
  const day2 = Date.parse('2026-03-03T10:00:00Z');
  const candles = [
    { t: day1, o: 10, h: 10, l: 10, c: 10, v: 100 },
    { t: day1 + 300000, o: 20, h: 20, l: 20, c: 20, v: 100 },
    { t: day2, o: 50, h: 50, l: 50, c: 50, v: 100 },
  ];
  const out = ind.vwap(candles);
  assert.strictEqual(out[1], 15);
  assert.strictEqual(out[2], 50, 'der neue Tag startet ohne Altlast');
});

test('Bollinger-%B liegt in der Bandmitte bei 0,5', () => {
  const flat = ind.bollinger(new Array(25).fill(100), 20, 2);
  assert.strictEqual(flat.percentB.at(-1), 0.5);
});

test('Regressionssteigung trifft die exakte Steigung einer Geraden', () => {
  const out = ind.linregSlope([0, 2, 4, 6, 8], 5);
  assert.ok(Math.abs(out.at(-1) - 2) < 1e-9);
});

test('Stochastik steht bei einem Schlusskurs am Periodenhoch auf 100', () => {
  const out = ind.stochastic(close([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]), 14, 3);
  assert.ok(out.k.at(-1) > 95);
});

test('Signalberechnung ist kausal — kein Blick in die Zukunft', () => {
  // Der entscheidende Test des ganzen Projekts: haette der Signalwert eines
  // Balkens spaeter einen anderen Wert, waere jede Kalibrierung wertlos.
  const { candles } = fixture.buildCandles({ symbol: 'PRUEF', venue: 'US', days: 6 });
  const full = features.scoreSeries(candles);
  for (const cut of [90, 140, 200]) {
    const partial = features.scoreSeries(candles.slice(0, cut));
    assert.ok(
      Math.abs(partial.scores[cut - 1] - full.scores[cut - 1]) < 1e-12,
      `Signalwert an Position ${cut - 1} aendert sich durch spaetere Daten`
    );
  }
});

test('Merkmale bleiben im normierten Bereich', () => {
  const { candles } = fixture.buildCandles({ symbol: 'GRENZE', venue: 'XETRA', days: 6 });
  const { vectors, scores } = features.scoreSeries(candles);
  let checked = 0;
  vectors.forEach((vec, i) => {
    if (!vec) return;
    checked += 1;
    for (const [key, value] of Object.entries(vec)) {
      assert.ok(Number.isFinite(value), `${key} ist keine Zahl`);
      assert.ok(value >= -1.0001 && value <= 1.0001, `${key} liegt ausserhalb [-1, 1]: ${value}`);
    }
    assert.ok(scores[i] >= -1 && scores[i] <= 1);
  });
  assert.ok(checked > 100, 'zu wenige Balken geprueft');
});
