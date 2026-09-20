'use strict';

/**
 * Portal 2: Stooq — unabhaengige Zweitquelle fuer den letzten Kurs.
 *
 * Nicht fuer die Analyse, sondern fuer die *Kontrolle*: weichen zwei Portale
 * beim selben Wert deutlich voneinander ab, stimmt etwas nicht (verzoegerter
 * Feed, Waehrungswechsel, Splitt) — dann wird die Wahrscheinlichkeit
 * heruntergestuft statt woanders hingerechnet.
 *
 * Praktisch: Stooq beantwortet bis zu einigen Dutzend Kuerzeln in einer Anfrage.
 */

const { request } = require('../lib/http');

const NA = new Set(['N/D', 'N/A', '', '-']);
const num = (s) => (NA.has(s) ? null : Number(s));

function parseCsv(body) {
  const lines = body.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(',').map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row = Object.fromEntries(head.map((h, i) => [h, (cells[i] || '').trim()]));
    const date = row.date && !NA.has(row.date) ? `${row.date}T${row.time || '00:00:00'}Z` : null;
    return {
      symbol: (row.symbol || '').toLowerCase(),
      price: num(row.close),
      open: num(row.open),
      high: num(row.high),
      low: num(row.low),
      volume: num(row.volume),
      time: date ? Date.parse(date) : null,
    };
  });
}

async function fetchQuotes(stooqSymbols, { timeout = 9000, chunk = 25 } = {}) {
  const out = new Map();
  const errors = [];
  for (let i = 0; i < stooqSymbols.length; i += chunk) {
    const part = stooqSymbols.slice(i, i + chunk);
    const url = `https://stooq.com/q/l/?s=${part.join('+')}&f=sd2t2ohlcv&h&e=csv`;
    const res = await request(url, { timeout, retries: 1 });
    if (!res.ok) {
      errors.push(res.error);
      continue;
    }
    for (const row of parseCsv(res.body)) {
      if (row.price !== null && Number.isFinite(row.price)) out.set(row.symbol, row);
    }
  }
  return {
    ok: out.size > 0,
    source: 'Stooq',
    quotes: out,
    error: out.size === 0 ? errors[0] || 'keine Kurse' : null,
  };
}

module.exports = { fetchQuotes, parseCsv };
