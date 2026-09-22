'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { runCycle } = require('../lib/engine');
const universe = require('../lib/universe');
const { fetchSeries } = require('./fixtures/kurse');

/*
 * Ein vollstaendiger Durchlauf gegen Pruefstand-Kurse: kein Netz, aber exakt
 * dieselbe Rechenkette wie im Betrieb.
 *
 * Die Einspeisung ersetzt nur den Abruf. Sie ist der einzige Weg, erzeugte
 * Kurse in die Rechnung zu bekommen — im Betrieb ist sie nie gesetzt, und
 * genau deshalb kann das Dashboard keine erfundenen Zahlen anzeigen.
 */
// fetchBudget grosszuegig: die Einspeisung kennt keine Minutengrenze, und
// hier geht es um die Rechenkette, nicht um die Schonung einer Quelle. Die
// Obergrenze selbst wird in throttle.test.js geprueft.
const cycle = runCycle({ fetchSeries, fetchBudget: 40, limit: 12, horizonHours: 2, fetchBudget: 40 });

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

test('Es gibt keinen Rueckfall auf erzeugte Kurse', async () => {
  // Der wichtigste Test dieser Datei. Faellt ein Portal aus, darf kein Titel
  // mit erfundenen Zahlen in der Rangliste stehen — er wird uebersprungen.
  const snap = await runCycle({
    limit: 6,
    fetchBudget: 40,
    fetchSeries: () => ({ ok: false, source: 'Yahoo Finance', error: 'HTTP 503' }),
  });
  assert.strictEqual(snap.ranking.length, 0, 'trotz Ausfall stand etwas in der Rangliste');
  assert.strictEqual(snap.watchlist.length, 0);
  assert.strictEqual(snap.noData, true, 'der Ausfall wird nicht als solcher gemeldet');
  assert.strictEqual(snap.skipped.length, 6);
  assert.ok(snap.skipped.every((x) => x.reason === 'HTTP 503'),
    'der echte Grund geht verloren');
  assert.ok(!('demoData' in snap), 'der Demo-Begriff existiert noch');
});

test('Ein einzelner Ausfall kippt nicht den ganzen Durchlauf', async () => {
  const snap = await runCycle({
    limit: 8,
    fetchBudget: 40,
    fetchSeries: (entry, config) =>
      entry.symbol === 'SAP.DE'
        ? { ok: false, source: 'Yahoo Finance', error: 'Zeitlimit' }
        : fetchSeries(entry, config),
  });
  assert.ok(snap.watchlist.length >= 6, 'zu viele Titel verloren');
  assert.ok(!snap.watchlist.some((w) => w.symbol === 'SAP.DE'));
  assert.deepStrictEqual(snap.skipped.map((x) => x.symbol), ['SAP.DE']);
  assert.strictEqual(snap.noData, false);
});

test('Kein Titel traegt eine Demo-Kennzeichnung', async () => {
  const snap = await cycle;
  assert.ok(snap.ranking.every((i) => !('demo' in i)));
  assert.ok(snap.watchlist.every((w) => !('demo' in w)));
  // Im Test benennt sich die Einspeisung als "Pruefstand" — genau richtig:
  // eine Quelle soll immer sagen, was sie ist.
  assert.ok(snap.ranking.every((i) => i.sources.includes('Pruefstand')));
});

test('Im Betrieb stehen ausschliesslich echte Kursquellen in der Kette', async () => {
  // Ohne Einspeisung darf nichts Erzeugtes erreichbar sein — weder als
  // Rueckfall noch als benannte Quelle.
  const snap = await runCycle({ limit: 2 });
  const namen = snap.sources.map((q) => q.name);
  assert.ok(namen.length > 0);
  for (const name of namen) {
    assert.ok(/Yahoo|Stooq|Twelve Data/.test(name), `unerwartete Quelle: ${name}`);
  }
});

test('Ein laengerer Horizont aendert die Balkenzahl und die Schaetzung', async () => {
  const short = await runCycle({ fetchSeries, fetchBudget: 40, limit: 6, horizonHours: 1 });
  const long = await runCycle({ fetchSeries, fetchBudget: 40, limit: 6, horizonHours: 4 });
  assert.strictEqual(short.config.horizonBars, 12);
  assert.strictEqual(long.config.horizonBars, 48);
  const bySymbol = (snap) => Object.fromEntries(snap.watchlist.map((w) => [w.symbol, w.probability]));
  const a = bySymbol(short);
  const b = bySymbol(long);
  assert.ok(Object.keys(a).some((sym) => Math.abs(a[sym] - b[sym]) > 1e-6),
    'unterschiedliche Horizonte muessen zu unterschiedlichen Schaetzungen fuehren');
});

test('Ein Marktfilter schraenkt das Universum wirklich ein', async () => {
  const snap = await runCycle({ fetchSeries, fetchBudget: 40, limit: 6, markets: ['DE'] });
  assert.ok(snap.watchlist.every((w) => w.market === 'DE'));
  assert.deepStrictEqual(Object.keys(snap.venues), ['DE']);
});

test('Die Beobachtungsliste enthaelt nur bekannte Titel', async () => {
  const snap = await cycle;
  const known = new Set(universe.UNIVERSE.map((u) => u.symbol));
  for (const w of snap.watchlist) assert.ok(known.has(w.symbol), `${w.symbol} steht nicht im Universum`);
});

test('Zu kurze Zeitreihen werden uebersprungen statt geraten', async () => {
  // Grobes Raster bei kurzer Historie: rund 34 Balken je Titel, waehrend
  // Vorlauf (55) plus Horizont (8) allein schon 63 braucht.
  //
  // Bewusst so gewaehlt, dass es an jedem Wochentag zutrifft: eine fruehere
  // Fassung dieses Tests nahm 5-Minuten-Balken und ging nur am Wochenende
  // auf — unter der Woche liefert derselbe Zeitraum genug Balken, und der
  // Test schlug ohne jede Code-Aenderung fehl.
  const snap = await runCycle({
    fetchSeries, fetchBudget: 40, limit: 4, range: '1d', interval: '30m', horizonHours: 4,
  });
  assert.strictEqual(snap.ranking.length, 0);
  assert.strictEqual(snap.skipped.length, 4);
  assert.ok(snap.skipped.every((s) => typeof s.reason === 'string' && s.reason.length > 0));
});
