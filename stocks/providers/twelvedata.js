'use strict';

/**
 * Portal 4: Twelve Data — Intraday-Kerzen mit Zugangsschluessel.
 *
 * Grund fuer diese Quelle: Yahoo weist Anfragen aus Rechenzentren ab, und zwar
 * nicht wegen der Menge, sondern wegen der Herkunft. Aus dem heimischen WLAN
 * laeuft Yahoo einwandfrei; auf einem gehosteten Server kam nur noch HTTP 429
 * zurueck — auch nachdem die Anfragezahl auf ein Fuenftel gesenkt war.
 *
 * Twelve Data erlaubt den Serverbetrieb ausdruecklich und deckt Xetra und die
 * US-Boersen ab. Der kostenlose Tarif ist eng (800 Abrufe je Tag, 8 je
 * Minute), deshalb greifen hier dieselben Vorkehrungen wie bei Yahoo:
 * Zwischenspeicher, Sperre nach Drosselung, keine Abrufe bei geschlossener
 * Boerse.
 *
 * Besonderheit: Fehler kommen haeufig mit HTTP 200 und einem Fehlerfeld im
 * Rumpf. Wer nur den Statuscode prueft, haelt eine Fehlermeldung fuer Kurse.
 */

const { json } = require('../lib/http');
const { createBackoff } = require('../lib/throttle');

const BASE = 'https://api.twelvedata.com/time_series';

const backoff = createBackoff({ base: 60000, max: 20 * 60000, label: 'Twelve Data' });

/**
 * Minutenbremse.
 *
 * Der kostenlose Tarif erlaubt acht Abrufe je Minute. Beim Kaltstart gingen
 * dagegen zwanzig Titel und drei Leitindizes in wenigen Sekunden los — ab dem
 * neunten kam 429, und die Sperre legte anschliessend alles still. Am Ende kam
 * genau ein Titel durch.
 *
 * Deshalb hier ein Eimer mit Zeitstempeln: ist er voll, wird gar nicht erst
 * gefragt. Der Titel behaelt seinen Zwischenstand und kommt im naechsten
 * Durchlauf an die Reihe. Das ist kein Fehler, sondern geordnetes Anstehen.
 */
const DEFAULT_RPM = 8;
let rpm = DEFAULT_RPM;
let fenster = [];

function slotFrei(now = Date.now()) {
  fenster = fenster.filter((t) => now - t < 60000);
  return fenster.length < rpm;
}

function slotNehmen(now = Date.now()) {
  fenster.push(now);
}

function sekundenBisSlot(now = Date.now()) {
  if (slotFrei(now)) return 0;
  return Math.max(1, Math.ceil((60000 - (now - fenster[0])) / 1000));
}

/** Nur fuer Tests und fuer Tarife mit anderem Kontingent. */
function setRequestsPerMinute(value) {
  rpm = Math.max(1, Number(value) || DEFAULT_RPM);
}

function resetRateLimiter() {
  fenster = [];
}

/** Rasterbezeichnungen unterscheiden sich von denen bei Yahoo. */
const INTERVALS = {
  '1m': '1min', '5m': '5min', '15m': '15min', '30m': '30min',
  '45m': '45min', '1h': '1h', '2h': '2h', '4h': '4h',
};

/** Wie viele Balken brauchen wir? Aus Zeitraum und Raster abgeleitet. */
function outputSize(interval, range) {
  const minutes = Number(String(interval).replace(/\D/g, '')) || 5;
  const days = Number(String(range).replace(/\D/g, '')) || 10;
  // Rund 8 Handelsstunden je Tag, grosszuegig aufgerundet, gedeckelt.
  return Math.min(5000, Math.max(200, Math.ceil((days * 8 * 60) / minutes) + 50));
}

function parseSeries(data) {
  if (!data || !Array.isArray(data.values)) throw new Error('keine Zeitreihe');
  const candles = [];
  // Twelve Data liefert neueste zuerst — wir rechnen aufsteigend.
  for (let i = data.values.length - 1; i >= 0; i--) {
    const v = data.values[i];
    const o = Number(v.open);
    const h = Number(v.high);
    const l = Number(v.low);
    const c = Number(v.close);
    if (![o, h, l, c].every(Number.isFinite)) continue;
    // Zeitstempel kommen ohne Zonenangabe, aber auf UTC gestellt (timezone=UTC).
    const t = Date.parse(v.datetime.includes(' ') ? `${v.datetime.replace(' ', 'T')}Z` : `${v.datetime}T00:00:00Z`);
    if (!Number.isFinite(t)) continue;
    candles.push({ t, o, h, l, c, v: Number(v.volume) || 0 });
  }
  const meta = data.meta || {};
  return {
    candles,
    meta: {
      symbol: meta.symbol,
      currency: meta.currency,
      exchange: meta.exchange,
      price: candles.length ? candles[candles.length - 1].c : null,
      previousClose: null,   // wird in der Engine aus der Reihe selbst bestimmt
      quoteTime: candles.length ? candles[candles.length - 1].t : null,
    },
  };
}

async function fetchCandles(entry, { interval = '5m', range = '10d', apiKey, timeout = 9000 } = {}) {
  if (!apiKey) return { ok: false, source: 'Twelve Data', symbol: entry.symbol, error: 'kein Schluessel' };
  if (!entry.td) return { ok: false, source: 'Twelve Data', symbol: entry.symbol, error: 'kein Kuerzel hinterlegt' };
  if (backoff.blocked()) {
    return {
      ok: false, source: 'Twelve Data', symbol: entry.symbol, throttled: true,
      error: `gedrosselt, noch ${backoff.secondsLeft()} s`,
    };
  }
  if (!slotFrei()) {
    // Bewusst kein Fehler: der Titel steht an, nicht aus.
    return {
      ok: false, source: 'Twelve Data', symbol: entry.symbol, deferred: true,
      error: `Minutenkontingent voll — naechster Versuch in ${sekundenBisSlot()} s`,
    };
  }

  const params = new URLSearchParams({
    symbol: entry.td,
    interval: INTERVALS[interval] || '5min',
    outputsize: String(outputSize(interval, range)),
    timezone: 'UTC',
    format: 'JSON',
    apikey: apiKey,
  });
  if (entry.tdMic) params.set('mic_code', entry.tdMic);

  slotNehmen();
  const res = await json(`${BASE}?${params}`, { timeout, retries: 0 });

  if (res.status === 429) {
    const wait = backoff.penalise({ retryAfter: res.retryAfter, reason: 'HTTP 429' });
    return {
      ok: false, source: 'Twelve Data', symbol: entry.symbol, throttled: true,
      error: `HTTP 429 — Abfragen pausiert fuer ${Math.round(wait / 1000)} s`,
    };
  }
  if (!res.ok) {
    return { ok: false, source: 'Twelve Data', symbol: entry.symbol, error: res.error };
  }

  // Der haeufigste Stolperstein: Fehler kommen mit Status 200 im Rumpf.
  if (res.data && res.data.status === 'error') {
    const code = Number(res.data.code);
    const message = res.data.message || 'Fehler ohne Angabe';

    if (code === 429 || /limit|credits/i.test(message)) {
      // Minuten- und Tagesgrenze sind grundverschieden: die eine ist nach
      // einer Minute vorbei, die andere erst am naechsten Tag. Beides mit
      // derselben wachsenden Sperre zu behandeln waere in einem Fall zu hart
      // und im anderen zu lasch.
      const minute = /minute/i.test(message);
      if (minute) {
        // Eimer als voll markieren, bis das Zeitfenster abgelaufen ist.
        const jetzt = Date.now();
        fenster = Array.from({ length: rpm }, () => jetzt);
        return {
          ok: false, source: 'Twelve Data', symbol: entry.symbol, deferred: true,
          error: 'Minutenkontingent erreicht — naechster Versuch in 60 s',
        };
      }
      const wait = backoff.penalise({ reason: message });
      return {
        ok: false, source: 'Twelve Data', symbol: entry.symbol, throttled: true,
        dailyLimit: /day|daily/i.test(message),
        error: /day|daily/i.test(message)
          ? 'Tageskontingent aufgebraucht — morgen wieder verfuegbar (keine Kosten)'
          : `Kontingent erreicht — pausiert fuer ${Math.round(wait / 1000)} s`,
      };
    }
    return { ok: false, source: 'Twelve Data', symbol: entry.symbol, error: message };
  }

  try {
    const parsed = parseSeries(res.data);
    if (parsed.candles.length === 0) {
      return { ok: false, source: 'Twelve Data', symbol: entry.symbol, error: 'leere Zeitreihe' };
    }
    backoff.succeed();
    return { ok: true, source: 'Twelve Data', symbol: entry.symbol, ...parsed, ms: res.ms };
  } catch (err) {
    return { ok: false, source: 'Twelve Data', symbol: entry.symbol, error: err.message };
  }
}

const throttleState = () => ({
  ...backoff.state(),
  requestsPerMinute: rpm,
  slotsFrei: Math.max(0, rpm - fenster.filter((t) => Date.now() - t < 60000).length),
});

module.exports = {
  fetchCandles, parseSeries, outputSize, throttleState, backoff, INTERVALS,
  setRequestsPerMinute, resetRateLimiter, DEFAULT_RPM,
};
