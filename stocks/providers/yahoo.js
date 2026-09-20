'use strict';

/**
 * Portal 1: Yahoo Finance Chart-API — Intraday-Kerzen (OHLCV).
 *
 * Die Hauptquelle, weil sie als einzige frei zugaengliche Schnittstelle
 * Minutenkerzen fuer deutsche *und* amerikanische Titel liefert. Zwei Hosts,
 * weil query1 zeitweise drosselt.
 */

const { json } = require('../lib/http');

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

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
  let lastError = 'nicht versucht';
  for (const host of HOSTS) {
    const url =
      `${host}/v8/finance/chart/${encodeURIComponent(symbol)}` +
      `?interval=${interval}&range=${range}&includePrePost=false`;
    const res = await json(url, { timeout, retries: 0 });
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
      return { ok: true, source: 'Yahoo Finance', symbol, ...parsed, ms: res.ms };
    } catch (err) {
      lastError = err.message;
    }
  }
  return { ok: false, source: 'Yahoo Finance', symbol, error: lastError };
}

module.exports = { fetchCandles, parseChart };
