'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { yahooZuKursen, twelveZuKursen } = require('../quellen');
const { UNIVERSUM } = require('../universum');
const { seite } = require('../bericht');
const { bewerten } = require('../analyse');
const { universum } = require('./kurse');

test('Yahoo: Luecken (null) werden verworfen', () => {
  const json = { chart: { result: [{ timestamp: [1, 2, 3], indicators: { quote: [{
    open: [1, null, 3], high: [2, 2, 4], low: [0.5, 1, 2], close: [1.5, 1.8, 3.5] }] } }] } };
  assert.deepStrictEqual(yahooZuKursen(json).map((k) => k.t), [1, 3]);
  assert.throws(() => yahooZuKursen({ chart: { result: null, error: { description: 'No data found' } } }), /No data/);
});

test('Twelve Data: aufsteigend sortiert, Fehler mit Code', () => {
  const k = twelveZuKursen({ values: [
    { datetime: '2026-09-30', open: '2', high: '3', low: '1', close: '2.5' },
    { datetime: '2026-09-29', open: '1', high: '2', low: '1', close: '1.5' },
  ] });
  assert.deepStrictEqual(k.map((x) => x.c), [1.5, 2.5]);
  assert.throws(() => twelveZuKursen({ status: 'error', code: 429, message: 'limit' }), (e) => e.code === 429);
});

test('Universum: alle drei Indizes, Doppelmitglieder nur einmal', () => {
  const zahl = (i) => UNIVERSUM.filter((t) => t.indizes.includes(i)).length;
  assert.ok(zahl('DAX') >= 40 && zahl('Dow Jones') === 30 && zahl('Nasdaq-100') >= 100);
  assert.strictEqual(new Set(UNIVERSUM.map((t) => t.symbol)).size, UNIVERSUM.length);
  assert.deepStrictEqual(UNIVERSUM.find((t) => t.symbol === 'AAPL').indizes, ['Nasdaq-100', 'Dow Jones']);
});

test('Bericht: eigenstaendiges HTML, Namen sicher eingebettet', () => {
  const daten = universum(30);
  daten[0].name = '</script><b>Böse & Co</b>';
  const r = bewerten(daten);
  const html = seite({ ...r, fehlend: [{ symbol: 'XYZ', grund: 'keine Kurse' }], erstellt: '2026-10-01T20:00:00Z' });
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!html.includes('</script><b>'), 'eingebettete Daten duerfen den Skriptblock nicht schliessen');
  assert.ok(!/src="http/.test(html), 'keine externen Skripte');
});
