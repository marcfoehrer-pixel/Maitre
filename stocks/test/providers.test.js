'use strict';

const test = require('node:test');
const assert = require('node:assert');
const yahoo = require('../providers/yahoo');
const stooq = require('../providers/stooq');
const news = require('../providers/news');
const fixture = require('./fixtures/kurse');

test('Yahoo-Antwort wird zu Kerzen, Luecken fliegen raus', () => {
  const payload = {
    chart: { result: [{
      timestamp: [1700000000, 1700000300, 1700000600],
      indicators: { quote: [{
        open: [10, null, 12], high: [11, 11, 13], low: [9, 9, 11], close: [10.5, null, 12.5], volume: [100, 0, 300],
      }] },
      meta: { symbol: 'TEST.DE', currency: 'EUR', regularMarketPrice: 12.5, chartPreviousClose: 10 },
    }] },
  };
  const parsed = yahoo.parseChart(payload);
  assert.strictEqual(parsed.candles.length, 2, 'der Balken ohne Kurs wird verworfen, nicht aufgefuellt');
  assert.strictEqual(parsed.candles[0].t, 1700000000000);
  assert.strictEqual(parsed.meta.currency, 'EUR');
  assert.strictEqual(parsed.meta.previousClose, 10);
});

test('Yahoo-Fehlerantwort wird als Fehler gemeldet, nicht als leerer Chart', () => {
  assert.throws(
    () => yahoo.parseChart({ chart: { result: null, error: { description: 'Symbol unbekannt' } } }),
    /Symbol unbekannt/
  );
});

test('Stooq-CSV: Kurse werden gelesen, N/D wird zu null', () => {
  const rows = stooq.parseCsv(
    'Symbol,Date,Time,Open,High,Low,Close,Volume\n' +
    'SAP.DE,2026-09-18,17:35:00,241.1,243.0,240.2,242.8,1200000\n' +
    'XYZ.DE,N/D,N/D,N/D,N/D,N/D,N/D,N/D'
  );
  assert.strictEqual(rows[0].symbol, 'sap.de');
  assert.strictEqual(rows[0].price, 242.8);
  assert.strictEqual(rows[0].time, Date.parse('2026-09-18T17:35:00Z'));
  assert.strictEqual(rows[1].price, null, 'unbekannte Kurse duerfen nicht als 0 durchgehen');
});

test('Stooq-CSV ohne Datenzeile ergibt eine leere Liste', () => {
  assert.deepStrictEqual(stooq.parseCsv('Symbol,Date,Time,Open,High,Low,Close,Volume'), []);
});

test('Schlagzeilen-Bewertung erkennt beide Sprachen', () => {
  assert.ok(news.scoreHeadline('Nvidia beats estimates, shares surge') > 0);
  assert.ok(news.scoreHeadline('Bayer faellt nach Klage und Gewinnwarnung') < 0);
  assert.strictEqual(news.scoreHeadline('Unternehmen veroeffentlicht Quartalsbericht'), 0);
});

test('RSS wird gelesen, CDATA und Entities werden aufgeloest', () => {
  const now = new Date().toUTCString();
  const xml =
    `<rss><channel>` +
    `<item><title><![CDATA[Apple wins deal &amp; expands]]></title><link>https://a</link><pubDate>${now}</pubDate></item>` +
    `<item><title>Apple faces lawsuit</title><link>https://b</link><pubDate>${now}</pubDate></item>` +
    `</channel></rss>`;
  const items = news.parseRss(xml);
  assert.strictEqual(items.length, 2);
  assert.strictEqual(items[0].title, 'Apple wins deal & expands');
  assert.ok(items[0].score > 0 && items[1].score < 0);
});

test('Alte Schlagzeilen faerben die naechsten Stunden nicht mehr', () => {
  const old = [{ title: 'x', score: 2, published: Date.now() - 80 * 3600 * 1000 }];
  assert.strictEqual(news.aggregate(old, 24).count, 0);
  assert.strictEqual(news.aggregate(old, 24).score, 0);
});

test('Nachrichtenwert bleibt in [-1, 1], auch bei vielen Meldungen', () => {
  const many = Array.from({ length: 40 }, () => ({ title: 'x', score: 2, published: Date.now() }));
  const agg = news.aggregate(many);
  assert.ok(agg.score <= 1 && agg.score > 0);
});

test('Pruefstand-Kurse sind deterministisch und plausibel', () => {
  const now = new Date('2026-09-17T14:00:00Z');
  const a = fixture.fetchCandles('AAPL', { venue: 'US', now });
  const b = fixture.fetchCandles('AAPL', { venue: 'US', now });
  assert.deepStrictEqual(a.candles, b.candles, 'gleicher Titel muss gleiche Reihe ergeben');
  assert.ok(a.candles.length > 100);
  for (const c of a.candles) {
    assert.ok(c.h >= Math.max(c.o, c.c) && c.l <= Math.min(c.o, c.c), 'Hoch/Tief umschliessen den Koerper');
    assert.ok(c.l > 0 && c.v >= 0);
  }
  const other = fixture.fetchCandles('MSFT', { venue: 'US', now });
  assert.notDeepStrictEqual(a.candles[10], other.candles[10], 'verschiedene Titel duerfen nicht identisch sein');
});

test('Pruefstand-Kerzen liegen innerhalb der Handelszeit der jeweiligen Boerse', () => {
  const now = new Date('2026-09-17T14:00:00Z');
  const de = fixture.fetchCandles('SAP.DE', { venue: 'XETRA', now });
  for (const c of de.candles) {
    const berlin = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Berlin', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short',
    }).formatToParts(new Date(c.t));
    const p = Object.fromEntries(berlin.map((x) => [x.type, x.value]));
    const minutes = Number(p.hour) * 60 + Number(p.minute);
    assert.ok(minutes >= 9 * 60 && minutes < 17 * 60 + 30, `Kerze ausserhalb der Xetra-Zeit: ${p.hour}:${p.minute}`);
    assert.ok(p.weekday !== 'Sat' && p.weekday !== 'Sun', 'keine Kerzen am Wochenende');
  }
});
