'use strict';

/**
 * Portal 3: Nachrichten-Schlagzeilen (Yahoo-RSS je Titel).
 *
 * Bewusst grob: gezaehlt werden Signalwoerter in Ueberschriften, deutsch und
 * englisch. Das ersetzt keine Sprachanalyse und wird im Dashboard auch so
 * ausgewiesen. Der Beitrag zur Wahrscheinlichkeit ist entsprechend klein
 * gedeckelt — Nachrichten sollen eine Chartlage faerben, nicht drehen.
 */

const { request } = require('../lib/http');

const POSITIVE = [
  'beat', 'beats', 'surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'jump', 'jumps',
  'upgrade', 'upgrades', 'raises', 'record', 'strong', 'growth', 'profit', 'buyback',
  'outperform', 'bullish', 'approval', 'wins', 'deal', 'partnership', 'expands',
  'steigt', 'steigen', 'uebertrifft', 'rekord', 'kaufen', 'hochgestuft', 'gewinn',
  'wachstum', 'auftrag', 'durchbruch', 'erholung', 'anhebung',
];
const NEGATIVE = [
  'miss', 'misses', 'plunge', 'plunges', 'slump', 'slumps', 'drop', 'drops', 'fall', 'falls',
  'downgrade', 'downgrades', 'cuts', 'warning', 'warns', 'probe', 'lawsuit', 'recall',
  'layoff', 'layoffs', 'bearish', 'weak', 'loss', 'fraud', 'delay', 'halt', 'strike',
  'faellt', 'fallen', 'verlust', 'warnung', 'abgestuft', 'ruecklauf', 'rueckruf',
  'klage', 'ermittlung', 'streik', 'kuerzung', 'gewinnwarnung', 'schwach',
];

const WORD = /[a-zA-ZäöüÄÖÜß]+/g;

function scoreHeadline(title) {
  const words = (title.toLowerCase().normalize('NFC').match(WORD) || []);
  let hits = 0;
  for (const w of words) {
    if (POSITIVE.includes(w)) hits += 1;
    else if (NEGATIVE.includes(w)) hits -= 1;
  }
  return Math.max(-2, Math.min(2, hits));
}

function parseRss(xml, limit = 8) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const pick = (tag) => {
      const hit = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
      if (!hit) return '';
      return hit[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .trim();
    };
    const title = pick('title');
    if (!title) continue;
    const pubDate = pick('pubDate');
    items.push({
      title,
      link: pick('link'),
      published: pubDate ? Date.parse(pubDate) : null,
      score: scoreHeadline(title),
    });
  }
  return items;
}

/** Nur frische Schlagzeilen zaehlen — aeltere faerben die naechsten Stunden nicht. */
function aggregate(items, maxAgeHours = 24) {
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  const fresh = items.filter((i) => !i.published || i.published >= cutoff);
  if (fresh.length === 0) return { score: 0, count: 0, items: [] };
  const sum = fresh.reduce((acc, i) => acc + i.score, 0);
  return {
    score: Math.max(-1, Math.min(1, sum / (2 * Math.sqrt(fresh.length)))),
    count: fresh.length,
    items: fresh,
  };
}

async function fetchNews(symbol, { timeout = 7000, limit = 8 } = {}) {
  const url =
    'https://feeds.finance.yahoo.com/rss/2.0/headline' +
    `?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const res = await request(url, { timeout, retries: 0 });
  if (!res.ok) return { ok: false, source: 'Yahoo News', symbol, error: res.error, ...aggregate([]) };
  const items = parseRss(res.body, limit);
  return { ok: true, source: 'Yahoo News', symbol, ...aggregate(items) };
}

module.exports = { fetchNews, parseRss, scoreHeadline, aggregate };
