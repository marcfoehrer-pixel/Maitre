'use strict';

const test = require('node:test');
const assert = require('node:assert');
const A = require('../analyse');
const { reihe, universum } = require('./kurse');

test('Gleitender Durchschnitt und rollendes Maximum', () => {
  assert.deepStrictEqual(A.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  assert.deepStrictEqual(A.rollMax([3, 1, 4, 1, 5, 2, 1], 3), [null, null, 4, 4, 5, 5, 5]);
});

test('RSI: Dauerhaft steigend = 100, dauerhaft fallend = 0', () => {
  const auf = Array.from({ length: 40 }, (_, i) => 100 + i);
  const ab = Array.from({ length: 40 }, (_, i) => 100 - i);
  assert.strictEqual(A.rsi(auf).at(-1), 100);
  assert.ok(A.rsi(ab).at(-1) < 1);
});

test('Ergebnis: 5-%-Schwelle am Tagestief, Anstieg am Schluss nach 21 Tagen', () => {
  const kurse = Array.from({ length: 30 }, (_, i) => ({ t: i, o: 100, h: 101, l: 99, c: 100 + i * 0.1 }));
  const m = A.merkmale(kurse);
  assert.deepStrictEqual(A.ergebnis(m, 0), { sicher: true, steigt: true, beides: true });
  kurse[10].l = 94.9; // ein einziges Tief knapp unter -5 % genuegt
  assert.strictEqual(A.ergebnis(A.merkmale(kurse), 0).sicher, false);
  kurse[10].l = 95;   // genau -5 % ist "nicht mehr als 5 %"
  assert.strictEqual(A.ergebnis(A.merkmale(kurse), 0).sicher, true);
  assert.strictEqual(A.ergebnis(m, 9), null, 'Zukunft unbekannt → kein Ergebnis');
});

test('Score: stabiler Aufwaertstrend schlaegt stabilen Abwaertstrend', () => {
  const auf = A.merkmale(reihe({ drift: 0.6, vol: 0.1, seed: 3 }));
  const ab = A.merkmale(reihe({ drift: -0.6, vol: 0.1, seed: 3 }));
  const i = auf.c.length - 1;
  assert.ok(A.score(auf, i).wert > A.score(ab, i).wert + 30);
  assert.strictEqual(A.score(auf, 100), null, 'ohne ein Jahr Vorlauf keine Bewertung');
});

test('Bewertung: Wahrscheinlichkeiten konsistent und absteigend sortiert', () => {
  const r = A.bewerten(universum(30));
  assert.strictEqual(r.ranking.length, 30);
  for (const t of r.ranking) {
    for (const p of Object.values(t.p)) assert.ok(p > 0 && p < 1);
    assert.ok(t.p.beides <= t.p.sicher + 1e-12 && t.p.beides <= t.p.steigt + 1e-12);
  }
  for (let i = 1; i < r.ranking.length; i++) assert.ok(r.ranking[i - 1].p.beides >= r.ranking[i].p.beides);
  assert.ok(r.basis.beides > 0.05 && r.basis.beides < 0.8);
  assert.ok(r.rueckblick && r.rueckblick.faelle > 100);
});

test('Bewertung: ruhiger Titel ist eher "sicher" als ein wilder', () => {
  const daten = universum(30);
  daten.push({ ...daten[0], symbol: 'RUHIG', kurse: reihe({ seed: 99, drift: 0.1, vol: 0.08 }) });
  daten.push({ ...daten[0], symbol: 'WILD', kurse: reihe({ seed: 99, drift: 0.1, vol: 0.9 }) });
  const r = A.bewerten(daten);
  const p = (s) => r.ranking.find((t) => t.symbol === s).p.sicher;
  assert.ok(p('RUHIG') > p('WILD') + 0.2, `${p('RUHIG')} vs ${p('WILD')}`);
});

test('Zu kurze Historie wird ausgewiesen statt bewertet', () => {
  const daten = universum(30);
  daten.push({ ...daten[0], symbol: 'NEU', kurse: reihe({ tage: 100 }) });
  const r = A.bewerten(daten);
  assert.ok(!r.ranking.some((t) => t.symbol === 'NEU'));
  assert.deepStrictEqual(r.zuKurz, ['NEU']);
});
