'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBackoff } = require('../lib/throttle');
const { runCycle } = require('../lib/engine');
const { fetchSeries } = require('./fixtures/kurse');

/*
 * Schutz gegen Drosselung.
 *
 * Aus einem echten Ausfall entstanden: Yahoo antwortete auf jede Abfrage mit
 * HTTP 429, und das Dashboard machte es selbst schlimmer — bei Fehlschlag
 * probierte jeder Titel einen zweiten Host, und 429 wurde sogar wiederholt.
 * Aus 43 Titeln wurden so 86 abgewiesene Anfragen je Durchlauf, was die
 * Drosselung dauerhaft am Leben hielt.
 */

test('Die Sperre waechst mit jeder Abweisung und faellt beim Erfolg', () => {
  const b = createBackoff({ base: 1000, max: 8000 });
  const t = 1_000_000;
  assert.strictEqual(b.blocked(t), false);

  assert.strictEqual(b.penalise({ now: t }), 1000);
  assert.strictEqual(b.penalise({ now: t }), 2000);
  assert.strictEqual(b.penalise({ now: t }), 4000);
  assert.strictEqual(b.penalise({ now: t }), 8000, 'die Obergrenze greift nicht');
  assert.strictEqual(b.penalise({ now: t }), 8000);
  assert.strictEqual(b.blocked(t), true);

  b.succeed();
  assert.strictEqual(b.blocked(t), false, 'ein Erfolg muss sofort freigeben');
});

test('Ein genanntes Retry-After schlaegt die eigene Wartezeit', () => {
  const b = createBackoff({ base: 1000, max: 600000 });
  const t = 1_000_000;
  assert.strictEqual(b.penalise({ retryAfter: 120, now: t }), 120000);
  assert.strictEqual(b.secondsLeft(t), 120);
});

test('Waehrend der Sperre bleibt die Sperre bestehen, auch ohne neue Abweisung', () => {
  const b = createBackoff({ base: 10000 });
  const t = 1_000_000;
  b.penalise({ now: t });
  assert.strictEqual(b.blocked(t + 5000), true);
  assert.strictEqual(b.blocked(t + 11000), false, 'die Sperre loest sich nicht');
});

test('Der Zwischenspeicher senkt die Zahl der Abfragen deutlich', async () => {
  const cache = new Map();
  let abrufe = 0;
  const zaehlend = (entry, config) => {
    abrufe += 1;
    return fetchSeries(entry, config);
  };
  const opts = { fetchSeries: zaehlend, cache, limit: 10, fetchBudget: 40 };

  await runCycle(opts);
  const ersterDurchlauf = abrufe;
  assert.ok(ersterDurchlauf >= 10, 'der erste Durchlauf muss die Titel holen');

  abrufe = 0;
  const zweiter = await runCycle(opts);
  assert.strictEqual(abrufe, 0, 'innerhalb der Haltedauer darf nichts erneut geholt werden');
  assert.strictEqual(zweiter.watchlist.length, 10, 'aus dem Speicher fehlt ein Titel');
  assert.strictEqual(zweiter.cached, 10);
  assert.strictEqual(zweiter.fetched, 0);
});

test('Die Obergrenze verteilt den Kaltstart ueber mehrere Durchlaeufe', async () => {
  // Sonst gehen beim ersten Start alle Titel auf einmal los — genau der
  // Schwall, der die Drosselung ausloest.
  const cache = new Map();
  const opts = { fetchSeries, cache, limit: 12, fetchBudget: 4 };

  const a = await runCycle(opts);
  assert.strictEqual(a.fetched, 4);
  assert.strictEqual(a.watchlist.length, 4);
  assert.strictEqual(a.skipped.length, 8);
  assert.ok(a.skipped.every((x) => x.reason === 'noch nicht abgerufen'),
    'wartende Titel duerfen nicht wie Fehler aussehen');

  await runCycle(opts);
  const c = await runCycle(opts);
  assert.strictEqual(c.watchlist.length, 12, 'nach drei Durchlaeufen fehlt noch etwas');
  assert.strictEqual(c.skipped.length, 0);
});

test('Bei Drosselung wird der zwischengespeicherte Stand weiterbenutzt', async () => {
  // Ein ausgewiesener Kurs von vor zehn Minuten ist brauchbar. Gar kein Kurs,
  // obwohl einer vorliegt, waere nur ein Datenverlust aus Prinzip.
  const cache = new Map();
  await runCycle({ fetchSeries, cache, limit: 6, fetchBudget: 40 });

  // Haltedauer auf null: alles ist faellig — aber die Quelle drosselt.
  const snap = await runCycle({
    cache,
    limit: 6,
    fetchBudget: 40,
    candleTtlMs: 1,
    fetchSeries: () => ({
      ok: false, source: 'Yahoo Finance', throttled: true, error: 'HTTP 429',
    }),
  });

  assert.strictEqual(snap.watchlist.length, 6, 'trotz vorhandenem Speicher nichts angezeigt');
  assert.strictEqual(snap.noData, false);
  assert.ok(snap.ranking.every((i) => i.fromCache === true),
    'die Herkunft aus dem Speicher wird nicht ausgewiesen');
  assert.ok(snap.ranking.every((i) => typeof i.dataAgeSeconds === 'number'));
});

test('Ein zu alter Zwischenstand wird nicht mehr gezeigt', async () => {
  // Zwei Tage alt — das liegt ueber jeder Grenze, auch der grosszuegigen fuer
  // geschlossene Boersen. Damit ist der Test unabhaengig von der Uhrzeit.
  const cache = new Map();
  await runCycle({ fetchSeries, cache, limit: 4, fetchBudget: 40 });
  for (const [, eintrag] of cache) eintrag.at = Date.now() - 48 * 3600 * 1000;

  const snap = await runCycle({
    cache,
    limit: 4,
    fetchBudget: 40,
    candleTtlMs: 1,
    fetchSeries: () => ({ ok: false, source: 'Yahoo Finance', error: 'HTTP 429', throttled: true }),
  });
  assert.strictEqual(snap.watchlist.length, 0, 'zwei Tage alte Kurse wurden angezeigt');
  assert.strictEqual(snap.noData, true);
});

test('Nach Handelsschluss gilt eine grosszuegigere Altersgrenze', async () => {
  // Ein drei Stunden alter Kurs ist nach Boersenschluss kein veralteter Kurs,
  // sondern der Schlusskurs. Waehrend des Handels waere er unbrauchbar.
  const cache = new Map();
  await runCycle({ fetchSeries, cache, limit: 4, fetchBudget: 40, markets: ['DE'] });
  for (const [, eintrag] of cache) eintrag.at = Date.now() - 3 * 3600 * 1000;

  const snap = await runCycle({
    cache, limit: 4, fetchBudget: 40, markets: ['DE'], candleTtlMs: 1,
    fetchSeries: () => ({ ok: false, source: 'Yahoo Finance', error: 'HTTP 429', throttled: true }),
  });
  const xetraOffen = snap.venues.DE.open;
  if (xetraOffen) {
    assert.strictEqual(snap.watchlist.length, 0, 'waehrend des Handels sind 3 h zu alt');
  } else {
    assert.strictEqual(snap.watchlist.length, 4, 'nach Schluss ist der Schlusskurs gueltig');
    assert.ok(snap.ranking.every((i) => i.fromCache === true));
  }
});

test('Die Last je Stunde wird ausgewiesen', async () => {
  // Diese Zahl ist der Unterschied zwischen "laeuft" und "HTTP 429".
  const snap = await runCycle({
    fetchSeries, cache: new Map(), limit: 24, candleTtlMs: 15 * 60000, fetchBudget: 40,
  });
  assert.strictEqual(snap.config.candleTtlMinutes, 15);
  assert.strictEqual(snap.config.requestsPerHour, 96);
});

// --- Minutenkontingent der Zweitquelle -------------------------------------

const twelvedata = require('../providers/twelvedata');

test('Die Minutenbremse laesst hoechstens acht Abrufe je Minute durch', async (t) => {
  // Der kostenlose Tarif erlaubt acht je Minute. Beim Kaltstart gingen vorher
  // 23 Abrufe in wenigen Sekunden los: ab dem neunten kam 429, die Sperre
  // legte alles still, und es kam genau ein Titel durch.
  const echtes = global.fetch;
  let anfragen = 0;
  global.fetch = async () => {
    anfragen += 1;
    return new Response(JSON.stringify({ meta: {}, values: [] }), { status: 200 });
  };
  t.after(() => {
    global.fetch = echtes;
    twelvedata.resetRateLimiter();
    twelvedata.backoff.succeed();
  });

  twelvedata.resetRateLimiter();
  twelvedata.backoff.succeed();

  const eintrag = { symbol: 'SAP.DE', td: 'SAP', tdMic: 'XETR' };
  const ergebnisse = [];
  for (let i = 0; i < 12; i++) {
    ergebnisse.push(await twelvedata.fetchCandles(eintrag, { apiKey: 'test', timeout: 500 }));
  }

  assert.strictEqual(anfragen, 8, `es gingen ${anfragen} Anfragen raus statt 8`);
  const angestellt = ergebnisse.filter((r) => r.deferred);
  assert.strictEqual(angestellt.length, 4);
  assert.ok(angestellt.every((r) => /Minutenkontingent/.test(r.error)));
  // Entscheidend: Anstehen ist kein Fehlschlag und loest keine lange Sperre aus.
  assert.strictEqual(twelvedata.throttleState().blocked, false);
});

test('Die Minutengrenze loest keine lange Sperre aus, die Tagesgrenze schon', async (t) => {
  const echtes = global.fetch;
  const antwort = (message) => async () =>
    new Response(JSON.stringify({ status: 'error', code: 429, message }), { status: 200 });
  t.after(() => {
    global.fetch = echtes;
    twelvedata.resetRateLimiter();
    twelvedata.backoff.succeed();
  });
  const eintrag = { symbol: 'SAP.DE', td: 'SAP', tdMic: 'XETR' };

  twelvedata.resetRateLimiter();
  twelvedata.backoff.succeed();
  global.fetch = antwort('You have run out of API credits for the current minute.');
  const proMinute = await twelvedata.fetchCandles(eintrag, { apiKey: 'test', timeout: 500 });
  assert.strictEqual(proMinute.deferred, true, 'die Minutengrenze gilt als Fehlschlag');
  assert.strictEqual(twelvedata.backoff.blocked(), false, 'eine Minute darf nicht lange sperren');

  twelvedata.resetRateLimiter();
  twelvedata.backoff.succeed();
  global.fetch = antwort('You have run out of API credits for the current day.');
  const proTag = await twelvedata.fetchCandles(eintrag, { apiKey: 'test', timeout: 500 });
  assert.strictEqual(proTag.throttled, true);
  assert.strictEqual(proTag.dailyLimit, true);
  assert.match(proTag.error, /keine Kosten/, 'die Kostenfrage bleibt unbeantwortet');
  assert.strictEqual(twelvedata.backoff.blocked(), true);
});

test('Ein anstehender Titel belastet die naechste Quelle nicht', async () => {
  // Sonst loest das Warten bei der einen Quelle eine Sperre bei der anderen aus.
  let yahooGefragt = 0;
  const snap = await runCycle({
    limit: 4,
    fetchBudget: 40,
    fetchSeries: (entry) => {
      if (entry.symbol.endsWith('.DE')) {
        return { ok: false, source: 'Twelve Data', deferred: true, error: 'Minutenkontingent voll' };
      }
      yahooGefragt += 1;
      return { ok: false, source: 'Yahoo Finance', error: 'HTTP 403' };
    },
  });
  const wartende = snap.skipped.filter((x) => x.waiting);
  assert.ok(wartende.length > 0, 'kein Titel als wartend gefuehrt');
  assert.ok(wartende.every((x) => x.symbol.endsWith('.DE')));
  // Wartende Titel duerfen die Quellen-Ampel nicht auf Rot ziehen.
  assert.ok(!snap.sources.some((q) => q.name === 'Twelve Data' && q.status === 'down'),
    'Anstehen wurde als Quellenausfall gewertet');
  assert.ok(yahooGefragt > 0, 'die Gegenprobe hat nicht gegriffen');
});
