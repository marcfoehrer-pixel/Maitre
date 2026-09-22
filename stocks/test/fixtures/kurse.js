'use strict';

/**
 * Pruefstand-Kursreihen fuer die Tests.
 *
 * Deterministisch erzeugt, damit Testlaeufe reproduzierbar sind und ohne Netz
 * auskommen.
 *
 * Diese Datei liegt bewusst unter test/ und nicht bei den Providern: erzeugte
 * Kurse duerfen den Betrieb niemals erreichen. Das Dashboard zeigt echte Kurse
 * oder gar keine — ein Titel ohne abrufbare Daten wird uebersprungen und der
 * Grund ausgewiesen, statt eine Zahl zu erfinden.
 */

const { VENUES, zonedTimeToUtc, zonedDateParts } = require('../../lib/session');

/** Kleiner, schneller, deterministischer Zufallsgenerator. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Normalverteilte Zufallszahl ueber Box-Muller. */
function gauss(rnd) {
  const u = Math.max(1e-9, rnd());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
}

/**
 * Zeitstempel aller Handelsbalken der letzten `days` Kalendertage im Raster
 * `intervalMinutes` — Wochenenden ausgelassen, Zeitzone ueber session.js.
 */
function sessionStamps(venueKey, days, intervalMinutes, now) {
  const v = VENUES[venueKey] || VENUES.US;
  const stamps = [];
  for (let d = days; d >= 0; d--) {
    const dayDate = new Date(now.getTime() - d * 86400000);
    const parts = zonedDateParts(dayDate, v.tz);
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun') continue;
    const start = zonedTimeToUtc(parts.year, parts.month, parts.day, v.open, v.tz);
    for (let m = 0; m < v.close - v.open; m += intervalMinutes) {
      const t = start + m * 60000;
      if (t <= now.getTime()) stamps.push(t);
    }
  }
  return stamps.sort((a, b) => a - b);
}

function buildCandles({ symbol, venue = 'US', days = 5, intervalMinutes = 5, basePrice, now = new Date() }) {
  const rnd = mulberry32(hash(symbol));
  const stamps = sessionStamps(venue, days, intervalMinutes, now);
  const price0 = basePrice || 20 + rnd() * 380;
  const candles = [];
  let price = price0;
  let drift = (rnd() - 0.5) * 0.00025;
  const vol = 0.0012 + rnd() * 0.0016;
  const baseVolume = 20000 + Math.floor(rnd() * 180000);

  for (let i = 0; i < stamps.length; i++) {
    // Trendphasen: der Drift wechselt traege, damit echte Trendstrecken entstehen.
    if (i % 40 === 0) drift = drift * 0.5 + (rnd() - 0.5) * 0.0004;
    const shock = gauss(rnd) * vol;
    const open = price;
    price = Math.max(0.5, price * (1 + drift + shock));
    const wick = Math.abs(gauss(rnd)) * vol * price * 0.8;
    const high = Math.max(open, price) + wick;
    const low = Math.min(open, price) - wick;
    // U-Profil: zu Sitzungsbeginn und -ende wird mehr gehandelt.
    const perDay = Math.max(1, Math.floor((stamps.length / days) || 1));
    const pos = (i % perDay) / perDay;
    const shape = 1 + 1.6 * (Math.exp(-((pos / 0.18) ** 2)) + Math.exp(-(((1 - pos) / 0.18) ** 2)));
    candles.push({
      t: stamps[i],
      o: round(open),
      h: round(high),
      l: round(Math.max(0.1, low)),
      c: round(price),
      v: Math.floor(baseVolume * shape * (0.6 + rnd() * 0.9)),
    });
  }
  return { candles, price0 };
}

const round = (x) => Math.round(x * 10000) / 10000;

function fetchCandles(symbol, { venue = 'US', interval = '5m', range = '5d', now = new Date() } = {}) {
  const intervalMinutes = Number(String(interval).replace('m', '')) || 5;
  const days = Number(String(range).replace('d', '')) || 5;
  const { candles } = buildCandles({ symbol, venue, days, intervalMinutes, now });
  const last = candles[candles.length - 1];
  const first = candles[0];
  return {
    ok: candles.length > 0,
    source: 'Pruefstand',
    symbol,
    candles,
    meta: {
      symbol,
      currency: venue === 'XETRA' ? 'EUR' : 'USD',
      exchange: 'Pruefstand',
      price: last ? last.c : null,
      previousClose: first ? first.o : null,
      quoteTime: last ? last.t : null,
      volume: last ? last.v : 0,
    },
    error: candles.length === 0 ? 'keine Pruefstand-Kerzen erzeugbar' : null,
  };
}

/**
 * Einspeisung fuer runCycle: dieselbe Form wie der echte Abruf, damit die
 * Rechenkette im Test exakt dieselbe ist wie im Betrieb.
 */
function fetchSeries(entry, config) {
  return fetchCandles(entry.symbol, {
    venue: entry.venue,
    interval: config.interval,
    range: config.range,
  });
}

module.exports = { fetchCandles, fetchSeries, buildCandles, mulberry32, hash };
