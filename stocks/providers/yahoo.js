'use strict';

/**
 * Portal 1: Yahoo Finance Chart-API — Intraday-Kerzen (OHLCV).
 *
 * Die Hauptquelle, weil sie als einzige frei zugaengliche Schnittstelle
 * Minutenkerzen fuer deutsche *und* amerikanische Titel liefert.
 *
 * Drei Vorkehrungen gegen Drosselung, alle aus einem echten Ausfall gelernt:
 *
 *   1. Bei 429 wird der zweite Host NICHT mehr probiert. Beide teilen sich
 *      dieselbe Begrenzung; der zweite Versuch verdoppelte nur die Last und
 *      hielt die Drosselung am Leben.
 *   2. Eine Sperre pausiert danach alle weiteren Abfragen — statt im naechsten
 *      Durchlauf erneut vierzig Abweisungen zu kassieren.
 *   3. Eine Sitzung (Zustimmungs-Cookie und Pruefwert) wird angelegt, sobald
 *      ohne sie abgewiesen wird. Aus Rechenzentren verlangt Yahoo sie
 *      haeufiger als von privaten Anschluessen.
 */

const { json, request } = require('../lib/http');
const { createBackoff } = require('../lib/throttle');

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

const backoff = createBackoff({ base: 60000, max: 20 * 60000, label: 'Yahoo Finance' });

/** Eine angelegte Sitzung gilt mehrere Stunden; oefter waere nur Zusatzlast. */
const SESSION_TTL_MS = 6 * 3600 * 1000;
let session = { cookie: null, crumb: null, at: 0, tried: 0 };

async function establishSession() {
  if (session.cookie && Date.now() - session.at < SESSION_TTL_MS) return session;
  // Nicht in Endlosschleife versuchen, wenn Yahoo die Sitzung verweigert.
  if (Date.now() - session.tried < 5 * 60000) return session;
  session.tried = Date.now();

  const consent = await request('https://fc.yahoo.com/', { timeout: 7000, retries: 0 });
  const raw = consent.headers && consent.headers.getSetCookie
    ? consent.headers.getSetCookie()
    : [];
  const cookie = raw.map((c) => String(c).split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) return session;

  const crumbRes = await request('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    timeout: 7000, retries: 0, headers: { cookie },
  });
  session = {
    cookie,
    crumb: crumbRes.ok && crumbRes.body && crumbRes.body.length < 64 ? crumbRes.body.trim() : null,
    at: Date.now(),
    tried: session.tried,
  };
  return session;
}

function parseChart(data) {
  const result = data && data.chart && data.chart.result && data.chart.result[0];
  if (!result) {
    const desc = data && data.chart && data.chart.error && data.chart.error.description;
    throw new Error(desc || 'keine Chartdaten');
  }
  const stamps = result.timestamp || [];
  const q = (result.indicators && result.indicators.quote && result.indicators.quote[0]) || {};
  const candles = [];
  for (let i = 0; i < stamps.length; i++) {
    const o = q.open && q.open[i];
    const h = q.high && q.high[i];
    const l = q.low && q.low[i];
    const c = q.close && q.close[i];
    // Luecken kommen vor (Auktionen, Handelsunterbrechungen) — solche Balken
    // fliegen raus, statt mit dem Vorwert aufgefuellt zu werden.
    if (o == null || h == null || l == null || c == null) continue;
    candles.push({ t: stamps[i] * 1000, o, h, l, c, v: (q.volume && q.volume[i]) || 0 });
  }
  const meta = result.meta || {};
  return {
    candles,
    meta: {
      symbol: meta.symbol,
      currency: meta.currency,
      exchange: meta.fullExchangeName || meta.exchangeName,
      price: meta.regularMarketPrice,
      previousClose: meta.chartPreviousClose ?? meta.previousClose,
      dayHigh: meta.regularMarketDayHigh,
      dayLow: meta.regularMarketDayLow,
      volume: meta.regularMarketVolume,
      quoteTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
    },
  };
}

async function fetchCandles(symbol, { interval = '5m', range = '5d', timeout = 9000 } = {}) {
  if (backoff.blocked()) {
    return {
      ok: false, source: 'Yahoo Finance', symbol, throttled: true,
      error: `gedrosselt, noch ${backoff.secondsLeft()} s`,
    };
  }

  let lastError = 'nicht versucht';
  for (const host of HOSTS) {
    const params = new URLSearchParams({
      interval, range, includePrePost: 'false',
    });
    if (session.crumb) params.set('crumb', session.crumb);
    const url = `${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${params}`;
    const headers = session.cookie ? { cookie: session.cookie } : {};
    const res = await json(url, { timeout, retries: 0, headers });

    if (res.status === 429) {
      // Abbrechen statt den zweiten Host zu belasten — er teilt sich dieselbe
      // Begrenzung, und jede weitere Anfrage verlaengert die Drosselung.
      const wait = backoff.penalise({ retryAfter: res.retryAfter, reason: 'HTTP 429' });
      return {
        ok: false, source: 'Yahoo Finance', symbol, throttled: true,
        error: `HTTP 429 — Abfragen pausiert fuer ${Math.round(wait / 1000)} s`,
      };
    }

    // Fehlende Sitzung aeussert sich als 401/403. Einmal anlegen, dann weiter.
    if ((res.status === 401 || res.status === 403) && !session.cookie) {
      await establishSession();
      if (session.cookie) {
        const retry = await json(url, { timeout, retries: 0, headers: { cookie: session.cookie } });
        if (retry.ok) {
          try {
            const parsed = parseChart(retry.data);
            if (parsed.candles.length > 0) {
              backoff.succeed();
              return { ok: true, source: 'Yahoo Finance', symbol, ...parsed, ms: retry.ms };
            }
          } catch (err) {
            lastError = err.message;
          }
        }
      }
    }

    if (!res.ok) {
      lastError = res.error;
      continue;
    }
    try {
      const parsed = parseChart(res.data);
      if (parsed.candles.length === 0) {
        lastError = 'leere Zeitreihe';
        continue;
      }
      backoff.succeed();
      return { ok: true, source: 'Yahoo Finance', symbol, ...parsed, ms: res.ms };
    } catch (err) {
      lastError = err.message;
    }
  }
  return { ok: false, source: 'Yahoo Finance', symbol, error: lastError };
}

/** Zustand der Drosselung — die Oberflaeche soll ihn benennen koennen. */
const throttleState = () => backoff.state();

module.exports = { fetchCandles, parseChart, throttleState, backoff };
