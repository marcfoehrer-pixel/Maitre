'use strict';

const test = require('node:test');
const assert = require('node:assert');
const model = require('../lib/model');
const session = require('../lib/session');

const sampleSet = (n, rate, score) =>
  Array.from({ length: n }, (_, i) => ({ score, up: i < Math.round(n * rate) ? 1 : 0, ret: 0.001 }));

test('Wilson-Intervall behauptet bei drei von drei Treffern keine Gewissheit', () => {
  const w = model.wilson(3, 3);
  assert.ok(w.low < 0.5, 'die Untergrenze muss deutlich unter 100 % liegen');
  assert.strictEqual(w.high, 1);
});

test('Wilson-Intervall wird mit wachsender Stichprobe enger', () => {
  assert.ok(model.wilson(60, 100).width > model.wilson(600, 1000).width);
});

test('Eimer-Zuordnung deckt den gesamten Wertebereich ab', () => {
  assert.strictEqual(model.bucketOf(-1), 0);
  assert.strictEqual(model.bucketOf(1), model.BUCKET_EDGES.length - 2);
  assert.strictEqual(model.bucketOf(5), model.BUCKET_EDGES.length - 2, 'Ausreisser fallen in den Randeimer');
  for (let z = -1; z <= 1; z += 0.05) {
    const b = model.bucketOf(z);
    assert.ok(b >= 0 && b < model.BUCKET_EDGES.length - 1, `kein Eimer fuer ${z}`);
  }
});

test('Treffer werden erst ab Ueberschreiten der Reibung gezaehlt', () => {
  const candles = [{ c: 100 }, { c: 100.02 }, { c: 101 }];
  const scores = [0.5, 0.5, null];
  const withoutFriction = model.outcomes(candles, scores, 1, 0);
  const withFriction = model.outcomes(candles, scores, 1, 0.0005);
  assert.strictEqual(withoutFriction[0].up, 1);
  assert.strictEqual(withFriction[0].up, 0, '+0,02 % deckt die Kosten nicht');
});

test('Kleine Stichproben werden geschrumpft statt als Gewissheit ausgewiesen', () => {
  const table = model.buildCalibration(sampleSet(5, 1, 0.6));
  const e = model.estimate({ score: 0.6, symbol: table });
  assert.ok(e.raw < 0.85, `fuenf Treffer duerfen keine ${(e.raw * 100).toFixed(0)} % ergeben`);
  assert.ok(e.raw > 0.5);
});

test('Viel Evidenz setzt sich gegen den Prior durch', () => {
  const table = model.buildCalibration(sampleSet(4000, 0.72, 0.6));
  const e = model.estimate({ score: 0.6, symbol: table });
  assert.ok(Math.abs(e.raw - 0.72) < 0.02, `erwartet rund 72 %, erhalten ${(e.raw * 100).toFixed(1)} %`);
});

test('Der Punktschaetzer liegt stets im eigenen Intervall', () => {
  for (const [n, rate, score] of [[5, 1, 0.8], [40, 0.6, 0.2], [900, 0.55, -0.4]]) {
    const table = model.buildCalibration(sampleSet(n, rate, score));
    const e = model.estimate({ score, symbol: table });
    assert.ok(e.raw >= e.interval.low - 1e-9 && e.raw <= e.interval.high + 1e-9,
      `${e.raw} liegt ausserhalb [${e.interval.low}, ${e.interval.high}]`);
  }
});

test('Ohne jede Evidenz bleibt nur der schwache Prior', () => {
  const e = model.estimate({ score: 0 });
  assert.ok(Math.abs(e.raw - 0.5) < 1e-9);
  assert.strictEqual(e.samples, 0);
});

test('Die Schaetzung waechst monoton mit dem Signalwert', () => {
  const samples = [];
  for (let z = -1; z <= 1; z += 0.01) {
    const p = model.sigmoid(1.2 * z);
    for (let i = 0; i < 60; i++) samples.push({ score: z, up: i < Math.round(60 * p) ? 1 : 0, ret: 0 });
  }
  const pooled = model.buildCalibration(samples);
  let previous = -1;
  for (let z = -0.8; z <= 0.8; z += 0.2) {
    const e = model.estimate({ score: z, pooled });
    assert.ok(e.raw > previous, `bei z=${z.toFixed(1)} faellt die Schaetzung`);
    previous = e.raw;
  }
});

test('Einzelne Kontextbeitraege sind gedeckelt', () => {
  const big = model.applyAdjustments(0.5, [{ label: 'uebertrieben', delta: 99 }]);
  assert.strictEqual(big.applied[0].delta, model.ADJUSTMENT_CAP);
  assert.ok(big.probability < 0.62, 'ein einzelner Aufschlag darf die Lage nicht drehen');
});

test('Wahrscheinlichkeiten bleiben in den harten Grenzen', () => {
  const extreme = model.applyAdjustments(0.97, Array.from({ length: 20 }, () => ({ label: 'x', delta: 0.45 })));
  assert.ok(extreme.probability <= model.P_MAX);
  const low = model.applyAdjustments(0.02, Array.from({ length: 20 }, () => ({ label: 'x', delta: -0.45 })));
  assert.ok(low.probability >= model.P_MIN);
});

test('Daempfung zieht zur Mitte, ohne die Richtung zu drehen', () => {
  assert.strictEqual(model.damp(0.8, 0), 0.5);
  assert.strictEqual(model.damp(0.8, 1), 0.8);
  assert.ok(model.damp(0.8, 0.25) > 0.5 && model.damp(0.8, 0.25) < 0.8);
  assert.ok(model.damp(0.2, 0.25) < 0.5);
});

test('Belastbarkeit sinkt bei geschlossenem Markt und duenner Stichprobe', () => {
  const good = model.confidenceGrade({ samples: 900, intervalWidth: 0.08, sources: 3, ageSeconds: 60, marketOpen: true });
  const bad = model.confidenceGrade({ samples: 30, intervalWidth: 0.4, sources: 1, ageSeconds: 9000, marketOpen: false });
  assert.strictEqual(good.level, 'hoch');
  assert.strictEqual(bad.level, 'niedrig');
});

test('Handelszeiten: Wochenende ist geschlossen, Daempfung greift', () => {
  const saturday = new Date('2026-09-19T12:00:00Z');
  const state = session.venueState('XETRA', saturday);
  assert.strictEqual(state.open, false);
  assert.strictEqual(state.weekend, true);
  assert.ok(session.dampingFactor(state, 180) < 0.5);
});

test('Handelszeiten: Xetra-Mittag ist offen, New York vorboerslich', () => {
  const noonBerlin = new Date('2026-09-17T10:00:00Z'); // 12:00 Ortszeit Berlin, 06:00 New York
  assert.strictEqual(session.venueState('XETRA', noonBerlin).open, true);
  const us = session.venueState('US', noonBerlin);
  assert.strictEqual(us.open, false);
  assert.strictEqual(us.phase, 'vorboerslich');
});

test('Zeitzonen-Umrechnung beruecksichtigt die Sommerzeit', () => {
  assert.strictEqual(session.tzOffsetMinutes(new Date('2026-07-01T12:00:00Z'), 'Europe/Berlin'), 120);
  assert.strictEqual(session.tzOffsetMinutes(new Date('2026-12-01T12:00:00Z'), 'Europe/Berlin'), 60);
  const open = session.zonedTimeToUtc(2026, 6, 1, 9 * 60, 'Europe/Berlin');
  assert.strictEqual(new Date(open).toISOString(), '2026-07-01T07:00:00.000Z');
});
