'use strict';

/**
 * Der Durchlauf: Daten holen -> Signal rechnen -> kalibrieren -> ranken.
 *
 * Reihenfolge ist Absicht. Erst wird das gesamte Universum technisch bewertet,
 * daraus entsteht die gepoolte Kalibrierung (viele Stichproben statt weniger),
 * und erst die Spitzenkandidaten kosten zusaetzliche Abfragen fuer Nachrichten.
 * So bleibt ein Durchlauf auch mit kostenlosen Endpunkten in Sekunden fertig.
 */

const yahoo = require('../providers/yahoo');
const stooq = require('../providers/stooq');
const news = require('../providers/news');
const synthetic = require('../providers/synthetic');
const features = require('./features');
const model = require('./model');
const session = require('./session');
const universe = require('./universe');
const { inBatches } = require('./http');

const DEFAULTS = {
  markets: ['DE', 'US'],
  limit: 40,
  interval: '5m',
  range: '10d',
  horizonHours: 3,
  friction: 0.0005,
  threshold: 0.8,
  topN: 5,
  newsTop: 8,
  offline: false,
  batchSize: 6,
  batchPauseMs: 250,
  sparkBars: 78,
};

const newsCache = new Map();
const NEWS_TTL_MS = 10 * 60 * 1000;

const pct = (x) => (x === null || x === undefined ? null : x * 100);

/**
 * Kontextkorrektur und Handelszeit-Daempfung in einem Schritt.
 *
 * Wird bewusst auch auf die Intervallgrenzen angewandt: eine angezeigte
 * Wahrscheinlichkeit, die ausserhalb ihres eigenen Konfidenzintervalls liegt,
 * ist irrefuehrend. Die Abbildung ist monoton (additiv in Log-Odds, danach
 * lineare Stauchung), die Reihenfolge der Grenzen bleibt also erhalten.
 */
function project(p, adjustments, damping) {
  return model.damp(model.applyAdjustments(p, adjustments).probability, damping);
}

/**
 * Wahrscheinlichkeit, Band und Wirkung jeder einzelnen Korrektur festschreiben.
 *
 * Die Wirkung wird als Weglassprobe bestimmt: einmal mit allen Korrekturen,
 * einmal ohne diese eine. Die Differenz ist der Beitrag in Prozentpunkten —
 * eine Zahl, die man lesen kann, im Gegensatz zu Log-Odds.
 */
function finalize(item, adjustments) {
  const { rawProbability: raw, damping, intervalRaw } = item;
  const all = model.applyAdjustments(raw, adjustments).applied;
  const probability = project(raw, all, damping);

  item.probability = probability;
  item.interval = {
    low: project(intervalRaw.low, all, damping),
    high: project(intervalRaw.high, all, damping),
  };
  item.adjustments = all.map((a) => {
    const without = project(raw, all.filter((x) => x !== a), damping);
    return { label: a.label, delta: a.delta, effectPp: (probability - without) * 100 };
  });
  item.edge = item.baseRate === null ? null : probability - item.baseRate;
  return item;
}

async function cachedNews(symbol) {
  const hit = newsCache.get(symbol);
  if (hit && Date.now() - hit.at < NEWS_TTL_MS) return hit.value;
  const value = await news.fetchNews(symbol);
  newsCache.set(symbol, { at: Date.now(), value });
  return value;
}

/** Kerzen holen — echtes Portal, bei Ausfall der Demo-Generator. */
async function loadSeries(entry, config) {
  if (config.offline) {
    return synthetic.fetchCandles(entry.symbol, {
      venue: entry.venue, interval: config.interval, range: config.range,
    });
  }
  const res = await yahoo.fetchCandles(entry.symbol, {
    interval: config.interval, range: config.range,
  });
  if (res.ok) return res;
  return { ...synthetic.fetchCandles(entry.symbol, {
    venue: entry.venue, interval: config.interval, range: config.range,
  }), fallbackFrom: res.error };
}

/** Marktlage je Region aus dem Leitindex — derselbe Signalwert, andere Rolle. */
async function loadRegime(config) {
  const out = {};
  const benches = universe.BENCHMARKS.filter((b) => config.markets.includes(b.market));
  await Promise.all(
    benches.map(async (b) => {
      const res = await loadSeries(b, config);
      if (!res.ok || res.candles.length < features.WARMUP + 2) return;
      const { scores } = features.scoreSeries(res.candles);
      const z = scores[scores.length - 1];
      if (z === null) return;
      const last = res.candles[res.candles.length - 1];
      const ref = res.meta.previousClose || res.candles[0].o;
      const current = out[b.market];
      const item = {
        index: b.name,
        symbol: b.symbol,
        z,
        changePct: ref ? pct(last.c / ref - 1) : null,
        demo: Boolean(res.demo),
      };
      // Mehrere Indizes je Region: der mit dem klareren Signal gibt den Ton an.
      if (!current || Math.abs(z) > Math.abs(current.z)) out[b.market] = item;
    })
  );
  return out;
}

/** Gerundet uebertragen — vier Nachkommastellen genuegen und sparen Nutzlast. */
function sparkline(candles, count) {
  return candles.slice(-count).map((c) => ({ t: c.t, c: Math.round(c.c * 10000) / 10000 }));
}

function intervalMinutes(interval) {
  const m = /^(\d+)m$/.exec(interval);
  if (m) return Number(m[1]);
  const h = /^(\d+)h$/.exec(interval);
  if (h) return Number(h[1]) * 60;
  return 5;
}

/**
 * Ein Durchlauf. Gibt die vollstaendige Momentaufnahme zurueck — die
 * Oberflaeche rechnet nichts nach, sie stellt nur dar.
 */
async function runCycle(userConfig = {}) {
  const config = { ...DEFAULTS, ...userConfig };
  const started = Date.now();
  const minutes = intervalMinutes(config.interval);
  const horizonBars = Math.max(1, Math.round((config.horizonHours * 60) / minutes));
  const horizonMinutes = config.horizonHours * 60;

  const list = universe.select({ markets: config.markets, limit: config.limit });
  const sourceStats = {
    'Yahoo Finance': { ok: 0, fail: 0, error: null },
    Stooq: { ok: 0, fail: 0, error: null },
    'Yahoo News': { ok: 0, fail: 0, error: null },
    'Demo-Generator': { ok: 0, fail: 0, error: null },
  };

  const [regime, quotes, seriesList] = await Promise.all([
    loadRegime(config),
    config.offline
      ? Promise.resolve({ ok: false, quotes: new Map(), error: 'Offline-Modus' })
      : stooq.fetchQuotes(list.map((s) => s.stooq)),
    inBatches(list, config.batchSize, config.batchPauseMs, (entry) => loadSeries(entry, config)),
  ]);

  if (!config.offline) {
    if (quotes.ok) sourceStats.Stooq.ok = quotes.quotes.size;
    else sourceStats.Stooq.error = quotes.error;
  }

  // --- Schritt 1: technische Bewertung des gesamten Universums -------------
  const pooledSamples = [];
  const prepared = [];

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const res = seriesList[i];
    if (res.demo) sourceStats['Demo-Generator'].ok += 1;
    else if (res.ok) sourceStats['Yahoo Finance'].ok += 1;
    if (res.fallbackFrom) {
      sourceStats['Yahoo Finance'].fail += 1;
      sourceStats['Yahoo Finance'].error = res.fallbackFrom;
    }
    if (!res.ok || res.candles.length < features.WARMUP + horizonBars + 5) {
      prepared.push({ entry, error: res.error || 'zu wenige Kerzen', res });
      continue;
    }
    const { prepared: p, scores, vectors } = features.scoreSeries(res.candles);
    const last = res.candles.length - 1;
    if (scores[last] === null) {
      prepared.push({ entry, error: 'Signal noch nicht eingeschwungen', res });
      continue;
    }
    const samples = model.outcomes(res.candles, scores, horizonBars, config.friction);
    pooledSamples.push(...samples);
    prepared.push({ entry, res, p, scores, vectors, samples, last });
  }

  // --- Schritt 2: Kalibrierung ueber alle Titel ----------------------------
  const pooled = model.buildCalibration(pooledSamples);

  // --- Schritt 3: Wahrscheinlichkeit je Titel ------------------------------
  const items = [];
  const skipped = [];

  for (const row of prepared) {
    if (row.error) {
      skipped.push({ symbol: row.entry.symbol, name: row.entry.name, reason: row.error });
      continue;
    }
    const { entry, res, p, scores, vectors, samples, last } = row;
    const candles = res.candles;
    const candle = candles[last];
    const score = scores[last];
    const symbolTable = model.buildCalibration(samples);
    const estimate = model.estimate({ score, pooled, symbol: symbolTable });

    const state = session.venueState(entry.venue);
    const ageSeconds = Math.round((Date.now() - candle.t) / 1000);
    const stale = state.open && ageSeconds > minutes * 60 * 3;

    // Zweitquelle: nur vergleichen, wenn sie frisch ist. Ein Schlusskurs von
    // gestern weicht natuerlich ab — das waere kein Fehler, sondern Alter.
    const quote = quotes.quotes ? quotes.quotes.get(entry.stooq) : null;
    const quoteFresh = quote && quote.time && Date.now() - quote.time < 45 * 60 * 1000;
    let deviation = null;
    if (quoteFresh && quote.price > 0) deviation = Math.abs(quote.price - candle.c) / candle.c;

    const adjustments = [];
    const marketRegime = regime[entry.market];
    if (marketRegime) {
      adjustments.push({
        label: `Marktlage ${marketRegime.index}`,
        delta: 0.5 * marketRegime.z,
      });
    }
    if (deviation !== null && deviation > 0.02) {
      adjustments.push({
        label: 'Kursabweichung zwischen Portalen',
        delta: -Math.min(0.4, (deviation - 0.02) * 10),
      });
    }
    const volRef = p.volSma20[last];
    if (volRef && volRef > 0) {
      const ratio = candle.v / volRef;
      if (ratio < 0.4) adjustments.push({ label: 'duenner Handel', delta: -0.2 });
    }
    if (stale) adjustments.push({ label: 'Daten nicht aktuell', delta: -0.25 });

    const damping = session.dampingFactor(state, horizonMinutes);

    // Vortagesschluss aus der Reihe selbst bestimmen.
    // `meta.previousClose` bezieht sich bei Yahoo auf den Schluss VOR dem
    // gesamten abgerufenen Fenster — bei zehn Tagen Historie waere die
    // Tagesveraenderung damit eine Zehntagesveraenderung.
    const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
    const today = dayKey(candle.t);
    const dayStart = candles.findIndex((c) => dayKey(c.t) === today);
    const prevClose = dayStart > 0 ? candles[dayStart - 1].c : candles[0].o;
    const dayCandles = candles.slice(Math.max(0, dayStart));
    const dayHigh = Math.max(...dayCandles.map((c) => c.h));
    const dayLow = Math.min(...dayCandles.map((c) => c.l));

    const item = {
      symbol: entry.symbol,
      name: entry.name,
      market: entry.market,
      currency: res.meta.currency || entry.currency,
      venue: state.venue,
      price: candle.c,
      changePct: prevClose ? pct(candle.c / prevClose - 1) : null,
      dayHigh,
      dayLow,
      dayRangePos: dayHigh > dayLow ? (candle.c - dayLow) / (dayHigh - dayLow) : 0.5,
      score,
      probability: null,
      interval: null,
      intervalRaw: { low: estimate.interval.low, high: estimate.interval.high },
      measured: estimate.measured.rate === null ? null : {
        ratePct: pct(estimate.measured.rate),
        hits: estimate.measured.hits,
        n: estimate.measured.n,
      },
      rawProbability: estimate.raw,
      samples: estimate.samples,
      symbolSamples: estimate.symbol.n,
      baseRate: estimate.baseRate,
      edge: null,
      expectedMovePct: pct(estimate.meanRet),
      drivers: features.explain(vectors[last]),
      adjustments: [],
      damping,
      session: { open: state.open, phase: state.phase, venue: state.venue, minutesToClose: state.minutesToClose },
      indicators: {
        rsi: p.rsi14[last],
        macdHist: p.macdHist[last],
        adx: p.adx[last],
        atrPct: pct(p.atr14[last] / candle.c),
        vwapDistPct: p.vwap[last] ? pct(candle.c / p.vwap[last] - 1) : null,
        volumeRatio: volRef ? candle.v / volRef : null,
        percentB: p.boll.percentB[last],
      },
      sources: [
        res.demo ? 'Demo-Generator' : 'Yahoo Finance',
        ...(quoteFresh ? ['Stooq'] : []),
      ],
      crossCheck: quote
        ? { price: quote.price, fresh: Boolean(quoteFresh), deviationPct: pct(deviation) }
        : null,
      demo: Boolean(res.demo),
      stale,
      lastCandle: candle.t,
      ageSeconds,
      spark: sparkline(candles, config.sparkBars),
      news: null,
    };
    items.push(finalize(item, adjustments));
  }

  // --- Schritt 4: Nachrichten nur fuer die Spitzenkandidaten ---------------
  items.sort((a, b) => b.probability - a.probability);
  const newsTargets = items.slice(0, Math.max(config.topN, config.newsTop));
  if (!config.offline && newsTargets.length > 0) {
    await inBatches(newsTargets, 4, 200, async (item) => {
      const result = await cachedNews(item.symbol);
      if (result.ok) sourceStats['Yahoo News'].ok += 1;
      else {
        sourceStats['Yahoo News'].fail += 1;
        sourceStats['Yahoo News'].error = result.error;
      }
      if (!result.ok || result.count === 0) return;
      item.news = {
        score: result.score,
        count: result.count,
        items: result.items.slice(0, 3).map((n) => ({ title: n.title, link: n.link, published: n.published, score: n.score })),
      };
      const before = item.probability;
      finalize(item, [
        ...item.adjustments.map((a) => ({ label: a.label, delta: a.delta })),
        { label: 'Schlagzeilen (24 h)', delta: 0.35 * result.score },
      ]);
      item.newsShift = item.probability - before;
      if (item.sources.indexOf('Yahoo News') === -1) item.sources.push('Yahoo News');
    });
    items.sort((a, b) => b.probability - a.probability);
  }

  items.forEach((item, i) => {
    item.rank = i + 1;
    item.confidence = model.confidenceGrade({
      samples: item.samples,
      intervalWidth: item.intervalRaw.high - item.intervalRaw.low,
      sources: item.sources.length,
      ageSeconds: item.ageSeconds,
      marketOpen: item.session.open,
    });
    item.meetsThreshold = item.probability >= config.threshold;
  });

  const sources = Object.entries(sourceStats)
    .filter(([, v]) => v.ok > 0 || v.fail > 0 || v.error)
    .map(([name, v]) => ({
      name,
      status: v.ok > 0 ? (v.fail > 0 ? 'degraded' : 'ok') : 'down',
      detail: v.error,
      count: v.ok,
    }));

  const venues = {};
  for (const market of config.markets) {
    venues[market] = session.venueState(market === 'DE' ? 'XETRA' : 'US');
  }
  const openMarkets = config.markets.filter((m) => venues[m].open);

  // Ausfuehrliche Karten: die Spitze insgesamt UND die Spitze je Markt. So kann
  // die Oberflaeche auf "nur Deutschland" umschalten, ohne dass der Server neu
  // rechnen muss — und ohne dass leere Plaetze entstehen.
  const detailed = [];
  const seen = new Set();
  const take = (list) => {
    for (const item of list.slice(0, config.topN)) {
      if (seen.has(item.symbol)) continue;
      seen.add(item.symbol);
      detailed.push(item);
    }
  };
  take(items);
  for (const market of config.markets) take(items.filter((i) => i.market === market));
  detailed.sort((a, b) => b.probability - a.probability);

  return {
    generatedAt: Date.now(),
    cycleMs: Date.now() - started,
    config: {
      markets: config.markets,
      interval: config.interval,
      range: config.range,
      horizonHours: config.horizonHours,
      horizonBars,
      friction: config.friction,
      threshold: config.threshold,
      topN: config.topN,
      offline: config.offline,
    },
    market: regime,
    openMarkets,
    sources,
    calibration: {
      pooledSamples: pooled.total.n,
      baseRate: pooled.total.n ? pooled.total.hits / pooled.total.n : null,
      meanRetPct: pct(pooled.total.meanRet),
      horizonBars,
      buckets: pooled.buckets.map((b, i) => ({
        from: model.BUCKET_EDGES[i],
        to: model.BUCKET_EDGES[i + 1],
        n: b.n,
        rate: b.n ? b.hits / b.n : null,
      })),
    },
    venues,
    ranking: detailed,
    watchlist: items.map((i) => ({
      rank: i.rank, symbol: i.symbol, name: i.name, market: i.market, currency: i.currency,
      price: i.price, changePct: i.changePct, probability: i.probability, score: i.score,
      samples: i.samples, confidence: i.confidence, meetsThreshold: i.meetsThreshold,
      sessionOpen: i.session.open, demo: i.demo, stale: i.stale,
      rsi: i.indicators.rsi, volumeRatio: i.indicators.volumeRatio,
    })),
    thresholdCount: items.filter((i) => i.meetsThreshold).length,
    thresholdCountByMarket: Object.fromEntries(
      config.markets.map((m) => [m, items.filter((i) => i.market === m && i.meetsThreshold).length])
    ),
    demoData: items.length > 0 && items.every((i) => i.demo),
    skipped,
  };
}

module.exports = { runCycle, DEFAULTS, intervalMinutes };
