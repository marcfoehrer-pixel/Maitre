'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { runCycle } = require('../lib/engine');
const universe = require('../lib/universe');

// Ein vollstaendiger Durchlauf gegen den Demo-Generator: kein Netz, aber
// dieselbe Rechenkette wie im Echtbetrieb.
const cycle = runCycle({ offline: true, limit: 12, horizonHours: 2 });

test('Ein Durchlauf liefert eine vollstaendige Momentaufnahme', async () => {
  const snap = await cycle;
  assert.ok(snap.generatedAt > 0);
  assert.strictEqual(snap.config.horizonHours, 2);
  assert.strictEqual(snap.config.horizonBars, 24, 'zwei Stunden sind 24 Balken zu fuenf Minuten');
  assert.strictEqual(snap.watchlist.length, 12);
  assert.ok(snap.ranking.length >= 5);
  assert.ok(snap.calibration.pooledSamples > 1000, 'die Kalibrierung braucht eine echte Stichprobe');
});

test('Beide Maerkte sind vertreten', async () => {
  const snap = await cycle;
  const markets = new Set(snap.watchlist.map((w) => w.market));
  assert.ok(markets.has('DE') && markets.has('US'));
  // Auch bei Filterung auf einen Markt muessen fuenf Karten darstellbar sein.
  for (const market of ['DE', 'US']) {
    assert.ok(
      snap.ranking.filter((r) => r.market === market).length >= snap.config.topN,
      `zu wenige ausfuehrliche Karten fuer ${market}`
    );
  }
});

test('Die Rangliste ist absteigend nach Wahrscheinlichkeit sortiert', async () => {
  const snap = await cycle;
  for (let i = 1; i < snap.ranking.length; i++) {
    assert.ok(snap.ranking[i - 1].probability >= snap.ranking[i].probability);
  }
  for (let i = 1; i < snap.watchlist.length; i++) {
    assert.ok(snap.watchlist[i - 1].probability >= snap.watchlist[i].probability);
  }
});

test('Jede Zahl ist endlich und liegt in ihrem Wertebereich', async () => {
  const snap = await cycle;
  for (const item of snap.ranking) {
    assert.ok(Number.isFinite(item.probability), `${item.symbol}: Wahrscheinlichkeit ist keine Zahl`);
    assert.ok(item.probability > 0 && item.probability < 1);
    assert.ok(item.score >= -1 && item.score <= 1);
    assert.ok(Number.isFinite(item.price) && item.price > 0);
    assert.ok(item.samples >= 0);
    assert.ok(item.spark.length > 10);
    assert.ok(['hoch', 'mittel', 'niedrig'].includes(item.confidence.level));
  }
});

test('Der Punktschaetzer liegt im angezeigten Band', async () => {
  const snap = await cycle;
  for (const item of snap.ranking) {
    assert.ok(
      item.probability >= item.interval.low - 1e-9 && item.probability <= item.interval.high + 1e-9,
      `${item.symbol}: ${item.probability} ausserhalb [${item.interval.low}, ${item.interval.high}]`
    );
    assert.ok(item.interval.low <= item.interval.high);
  }
});

test('Kontextkorrekturen sind gedeckelt und einzeln ausgewiesen', async () => {
  const snap = await cycle;
  for (const item of snap.ranking) {
    for (const adj of item.adjustments) {
      assert.ok(Math.abs(adj.delta) <= 0.45 + 1e-9, `${item.symbol}: ${adj.label} ist nicht gedeckelt`);
      assert.ok(Number.isFinite(adj.effectPp), `${item.symbol}: ${adj.label} ohne Wirkungsangabe`);
      assert.ok(typeof adj.label === 'string' && adj.label.length > 0);
    }
  }
});

test('Am Wochenende wird zur Mitte gedaempft', async () => {
  const snap = await cycle;
  const closed = snap.ranking.filter((i) => !i.session.open);
  if (closed.length === 0) return; // waehrend der Handelszeit nicht pruefbar
  for (const item of closed) {
    assert.ok(item.damping < 1);
    assert.ok(Math.abs(item.probability - 0.5) < 0.2, `${item.symbol} ist trotz geschlossener Boerse extrem`);
  }
});

test('Demo-Daten sind als solche gekennzeichnet', async () => {
  const snap = await cycle;
  assert.strictEqual(snap.demoData, true);
  assert.ok(snap.ranking.every((i) => i.demo === true));
  assert.ok(snap.sources.some((s) => s.name === 'Demo-Generator'));
});

test('Ein laengerer Horizont aendert die Balkenzahl und die Schaetzung', async () => {
  const short = await runCycle({ offline: true, limit: 6, horizonHours: 1 });
  const long = await runCycle({ offline: true, limit: 6, horizonHours: 4 });
  assert.strictEqual(short.config.horizonBars, 12);
  assert.strictEqual(long.config.horizonBars, 48);
  const bySymbol = (snap) => Object.fromEntries(snap.watchlist.map((w) => [w.symbol, w.probability]));
  const a = bySymbol(short);
  const b = bySymbol(long);
  assert.ok(Object.keys(a).some((sym) => Math.abs(a[sym] - b[sym]) > 1e-6),
    'unterschiedliche Horizonte muessen zu unterschiedlichen Schaetzungen fuehren');
});

test('Ein Marktfilter schraenkt das Universum wirklich ein', async () => {
  const snap = await runCycle({ offline: true, limit: 6, markets: ['DE'] });
  assert.ok(snap.watchlist.every((w) => w.market === 'DE'));
  assert.deepStrictEqual(Object.keys(snap.venues), ['DE']);
});

test('Die Beobachtungsliste enthaelt nur bekannte Titel', async () => {
  const snap = await cycle;
  const known = new Set(universe.UNIVERSE.map((u) => u.symbol));
  for (const w of snap.watchlist) assert.ok(known.has(w.symbol), `${w.symbol} steht nicht im Universum`);
});

test('Zu kurze Zeitreihen werden uebersprungen statt geraten', async () => {
  // Eine Historie von einem Tag reicht fuer Vorlauf plus Horizont nicht aus.
  const snap = await runCycle({ offline: true, limit: 4, range: '1d', horizonHours: 4 });
  assert.strictEqual(snap.ranking.length, 0);
  assert.strictEqual(snap.skipped.length, 4);
  assert.ok(snap.skipped.every((s) => typeof s.reason === 'string' && s.reason.length > 0));
});
