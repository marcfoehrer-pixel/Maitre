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
const twelvedata = require('../providers/twelvedata');
const stooq = require('../providers/stooq');
const news = require('../providers/news');
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
  batchSize: 4,
  batchPauseMs: 400,
  sparkBars: 78,
  /**
   * Hoechstzahl Kursabrufe je Durchlauf.
   *
   * Vierzig Titel im Zweiminutentakt sind zwanzig Anfragen pro Minute — aus
   * einem Rechenzentrum genug, um von Yahoo gedrosselt zu werden. Mit
   * Zwischenspeicher wird nur geholt, was aelter ist als ein Kerzenraster;
   * die Obergrenze glaettet zusaetzlich den Kaltstart, bei dem sonst alle
   * Titel auf einmal abgefragt wuerden.
   */
  /*
   * Acht, weil der kostenlose Tarif von Twelve Data acht Abrufe je Minute
   * erlaubt. Mehr einzuplanen bringt nichts — die Minutenbremse der Quelle
   * stellt den Rest ohnehin zurueck.
   */
  fetchBudget: 8,
  /**
   * Haltedauer einer Kursreihe, bevor sie neu geholt wird.
   *
   * `null` bedeutet: das Doppelte des Kerzenrasters (bei 5-Minuten-Kerzen also
   * 10 Minuten). Das ist der wichtigste Stellhebel gegen Drosselung — die
   * Anfragen pro Stunde ergeben sich aus Titelzahl geteilt durch Haltedauer,
   * nicht aus dem Aktualisierungstakt. Aus einem Rechenzentrum sollte man
   * deutlich unter etwa 200 Anfragen je Stunde bleiben.
   */
  candleTtlMs: null,
  /** Darueber hinaus wird ein zwischengespeicherter Stand nicht mehr gezeigt. */
  cacheMaxAgeMs: 45 * 60 * 1000,
  /**
   * Bei geschlossener Boerse gilt eine weitere Grenze.
   *
   * Ein drei Stunden alter Kurs ist nach Handelsschluss kein veralteter Kurs,
   * sondern schlicht der Schlusskurs — er aendert sich bis zur naechsten
   * Eroeffnung nicht mehr. Waehrend des Handels dagegen waeren drei Stunden
   * ein Datenstand, auf den niemand schauen sollte.
   */
  closedMaxAgeMs: 14 * 3600 * 1000,
};

/**
 * Zwischenspeicher der Kursreihen ueber Durchlaeufe hinweg.
 *
 * Fuenfminutenkerzen aendern sich alle fuenf Minuten — sie alle zwei Minuten
 * neu zu holen war reine Zusatzlast. Der Speicher senkt die Anfragezahl auf
 * etwa ein Drittel und haelt das Dashboard ausserdem arbeitsfaehig, waehrend
 * eine Quelle gerade drosselt.
 */
const candleCache = new Map();

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

/**
 * Kerzen holen — echte Kurse oder gar keine.
 *
 * Frueher fiel diese Stelle bei einem Portalausfall auf erzeugte Kurse zurueck.
 * Das war der gefaehrlichste Zustand des ganzen Programms: eine Rangliste, die
 * aussieht wie immer, aber auf Zahlen beruht, die nie ein Markt gebildet hat.
 * Jetzt bleibt der Fehler stehen, der Titel wird uebersprungen und der Grund
 * in der Oberflaeche ausgewiesen.
 *
 * `config.fetchSeries` ist ausschliesslich die Einspeisung der Tests
 * (stocks/test/fixtures/kurse.js) — im Betrieb ist sie nie gesetzt.
 */
/**
 * Reihenfolge der Kursquellen.
 *
 * Liegt ein Twelve-Data-Schluessel vor, kommt die Quelle zuerst: sie erlaubt
 * den Serverbetrieb ausdruecklich, waehrend Yahoo Anfragen aus Rechenzentren
 * wegen ihrer Herkunft abweist — unabhaengig von der Menge. Yahoo bleibt als
 * Rueckfall, weil es im heimischen WLAN einwandfrei und ohne Schluessel laeuft.
 */
function providerChain(config) {
  if (config.fetchSeries) return [{ name: 'Einspeisung', fetch: config.fetchSeries }];
  const chain = [];
  if (config.twelveDataKey) {
    chain.push({
      name: 'Twelve Data',
      fetch: (entry, cfg) => twelvedata.fetchCandles(entry, {
        interval: cfg.interval, range: cfg.range, apiKey: cfg.twelveDataKey,
      }),
    });
  }
  chain.push({
    name: 'Yahoo Finance',
    fetch: (entry, cfg) => yahoo.fetchCandles(entry.symbol, {
      interval: cfg.interval, range: cfg.range,
    }),
  });
  return chain;
}

/**
 * Kerzen holen — echte Kurse oder gar keine.
 *
 * Frueher fiel diese Stelle bei einem Portalausfall auf erzeugte Kurse zurueck.
 * Das war der gefaehrlichste Zustand des ganzen Programms: eine Rangliste, die
 * aussieht wie immer, aber auf Zahlen beruht, die nie ein Markt gebildet hat.
 * Jetzt wird die naechste echte Quelle probiert; liefert keine, bleibt der
 * Fehler stehen und der Titel wird uebersprungen.
 */
async function loadSeries(entry, config) {
  const chain = providerChain(config);
  const fehler = [];
  const versuche = [];
  let gedrosselt = false;
  for (const provider of chain) {
    const res = await provider.fetch(entry, config);
    if (res.ok) return res;
    // "Steht an" ist kein Fehlschlag: der Titel wartet auf seinen Zeitschlitz.
    // Dann die naechste Quelle zu belasten waere unnoetig — und wuerde dort
    // womoeglich eine eigene Sperre ausloesen.
    if (res.deferred) {
      return { ...res, ok: false, waiting: true, attempts: versuche };
    }
    if (res.throttled) gedrosselt = true;
    versuche.push({ name: provider.name, error: res.error });
    fehler.push(`${provider.name}: ${res.error}`);
  }
  return {
    ok: false,
    source: chain[0].name,
    symbol: entry.symbol,
    throttled: gedrosselt,
    // Jede versuchte Quelle einzeln, damit die Ampeln den Zustand je Portal
    // zeigen und nicht nur den der ersten.
    attempts: versuche,
    // Bei mehreren Quellen alle Gruende nennen — sonst sucht man am falschen Ende.
    error: fehler.length === 1 ? fehler[0].split(': ').slice(1).join(': ') : fehler.join(' · '),
  };
}

const cacheKey = (entry, config) => `${entry.symbol}|${config.interval}|${config.range}`;

/**
 * Kursreihe holen — oder den zwischengespeicherten Stand verwenden.
 *
 * `refresh` entscheidet, ob dieser Titel in diesem Durchlauf an der Reihe ist.
 * Scheitert der Abruf, wird ein noch brauchbarer Zwischenstand weiterbenutzt
 * und als solcher gekennzeichnet — besser ein Kurs von vor zehn Minuten, klar
 * ausgewiesen, als gar keiner.
 */
async function loadSeriesCached(entry, config, cache, refresh, now = Date.now()) {
  const key = cacheKey(entry, config);
  const hit = cache.get(key);
  const offen = session.venueState(entry.venue || 'US', new Date(now)).open;
  const maxAge = offen
    ? config.cacheMaxAgeMs
    : Math.max(config.cacheMaxAgeMs, config.closedMaxAgeMs);
  const brauchbar = (eintrag) => eintrag && now - eintrag.at < maxAge;

  if (!refresh) {
    if (brauchbar(hit)) return { ...hit.res, fromCache: true, dataAge: now - hit.at };
    if (hit) return { ok: false, source: hit.res.source, symbol: entry.symbol, error: 'Stand zu alt' };
    return {
      ok: false, source: 'Kursquelle', symbol: entry.symbol,
      waiting: true, error: 'noch nicht abgerufen',
    };
  }

  const res = await loadSeries(entry, config);
  if (res.ok) {
    cache.set(key, { res, at: now });
    return { ...res, dataAge: 0 };
  }
  if (brauchbar(hit)) {
    return {
      ...hit.res, fromCache: true, dataAge: now - hit.at,
      fetchError: res.error, throttled: Boolean(res.throttled),
      waiting: Boolean(res.waiting), attempts: res.attempts,
    };
  }
  return res;
}

/** Marktlage je Region aus dem Leitindex — derselbe Signalwert, andere Rolle. */
async function loadRegime(config, cache, now, ttl) {
  const out = {};
  const benches = universe.BENCHMARKS.filter((b) => config.markets.includes(b.market));
  await Promise.all(
    benches.map(async (b) => {
      // Leitindizes ebenfalls nach Alter: sie aendern sich nicht schneller als
      // die Einzeltitel, und drei Abrufe je Durchlauf sind bei einer
      // gedrosselten Quelle drei zu viel.
      const hit = cache.get(cacheKey(b, config));
      const faellig = !hit || now - hit.at >= ttl;
      const res = await loadSeriesCached(b, config, cache, faellig, now);
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
      };
      // Mehrere Indizes je Region: der mit dem klareren Signal gibt den Ton an.
      if (!current || Math.abs(z) > Math.abs(current.z)) out[b.market] = item;
    })
  );
  return out;
}

/** Gerundet uebertragen — vier Nachkommastellen genuegen und sparen Nutzlast. */
/** Drosselung ueber alle Kursquellen zusammengefasst — fuer die Anzeige. */
function throttleSummary(config) {
  if (config.fetchSeries) return { blocked: false, secondsLeft: 0, sources: [] };
  const zustaende = [
    { name: 'Yahoo Finance', ...yahoo.throttleState() },
    ...(config.twelveDataKey ? [{ name: 'Twelve Data', ...twelvedata.throttleState() }] : []),
  ];
  const gesperrt = zustaende.filter((z) => z.blocked);
  return {
    // Erst wenn ALLE Quellen pausieren, ist das Dashboard wirklich blockiert.
    blocked: gesperrt.length > 0 && gesperrt.length === zustaende.length,
    secondsLeft: Math.max(0, ...zustaende.map((z) => z.secondsLeft)),
    sources: zustaende.map((z) => ({ name: z.name, blocked: z.blocked, secondsLeft: z.secondsLeft })),
  };
}

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
  const now = Date.now();

  // Tests speisen eigene Kurse ein und bekommen dann auch einen eigenen
  // Zwischenspeicher — sonst truegen Ergebnisse aus einem frueheren Testlauf
  // in den naechsten hinein.
  const cache = config.cache || (config.fetchSeries ? new Map() : candleCache);
  const ttl = config.candleTtlMs || minutes * 2 * 60000;

  /*
   * Wer ist in diesem Durchlauf an der Reihe?
   *
   * Nur Titel, deren Stand aelter ist als ein Kerzenraster — und davon
   * hoechstens `fetchBudget` viele, die aeltesten zuerst. Dadurch verteilen
   * sich die Abrufe von selbst ueber mehrere Durchlaeufe, statt in einem
   * Schwall loszugehen.
   */
  const faellig = list
    .map((entry) => {
      const hit = cache.get(cacheKey(entry, config));
      return { entry, age: hit ? now - hit.at : Infinity, hit };
    })
    .filter((x) => {
      if (x.age < ttl) return false;
      // Bei geschlossener Boerse aendert sich nichts mehr. Ein vorhandener
      // Stand vom selben Handelstag reicht dann bis zur naechsten Eroeffnung —
      // das spart bei knappen Tarifen den groessten Teil des Kontingents.
      if (!x.hit) return true;
      const geschlossen = !session.venueState(x.entry.venue || 'US', new Date(now)).open;
      return !(geschlossen && x.age < 12 * 3600 * 1000);
    })
    .sort((a, b) => b.age - a.age);
  const refreshSet = new Set(faellig.slice(0, config.fetchBudget).map((x) => x.entry.symbol));
  const sourceStats = {};
  const noteSource = (name, feld, detail) => {
    if (!sourceStats[name]) sourceStats[name] = { ok: 0, fail: 0, error: null };
    sourceStats[name][feld] += 1;
    if (detail) sourceStats[name].error = detail;
  };
  for (const provider of providerChain(config)) noteSource(provider.name, 'ok', null);
  for (const name of Object.keys(sourceStats)) sourceStats[name].ok = 0;
  noteSource('Stooq', 'ok', null);
  sourceStats.Stooq.ok = 0;
  noteSource('Yahoo News', 'ok', null);
  sourceStats['Yahoo News'].ok = 0;

  const [regime, quotes, seriesList] = await Promise.all([
    loadRegime(config, cache, now, ttl),
    stooq.fetchQuotes(list.map((s) => s.stooq)),
    inBatches(list, config.batchSize, config.batchPauseMs, (entry) =>
      loadSeriesCached(entry, config, cache, refreshSet.has(entry.symbol), now)),
  ]);

  if (quotes.ok) sourceStats.Stooq.ok = quotes.quotes.size;
  else sourceStats.Stooq.error = quotes.error;

  // --- Schritt 1: technische Bewertung des gesamten Universums -------------
  const pooledSamples = [];
  const prepared = [];

  for (let i = 0; i < list.length; i++) {
    const entry = list[i];
    const res = seriesList[i];
    if (res.ok) {
      noteSource(res.source || 'Kursquelle', 'ok', res.fetchError || null);
    } else if (res.waiting) {
      // Anstehen ist kein Ausfall — die Ampel bliebe sonst grundlos rot.
    } else if (res.attempts && res.attempts.length > 0) {
      for (const versuch of res.attempts) noteSource(versuch.name, 'fail', versuch.error);
    } else {
      noteSource(res.source || 'Kursquelle', 'fail', res.error);
    }
    if (!res.ok || res.candles.length < features.WARMUP + horizonBars + 5) {
      prepared.push({
        entry,
        error: res.error || 'zu wenige Kerzen',
        waiting: Boolean(res.waiting),
        res,
      });
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
      skipped.push({
        symbol: row.entry.symbol,
        name: row.entry.name,
        reason: row.error,
        // Wartende Titel sind kein Ausfall, sondern der geordnete Aufbau —
        // die Oberflaeche soll das eine nicht wie das andere darstellen.
        waiting: Boolean(row.waiting),
      });
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
      sources: [res.source || 'Kursquelle', ...(quoteFresh ? ['Stooq'] : [])],
      crossCheck: quote
        ? { price: quote.price, fresh: Boolean(quoteFresh), deviationPct: pct(deviation) }
        : null,
      stale,
      lastCandle: candle.t,
      ageSeconds,
      // Wie alt ist der zugrunde liegende Abruf? Bei Drosselung wird ein
      // zwischengespeicherter Stand weiterbenutzt — das gehoert ausgewiesen.
      fromCache: Boolean(res.fromCache),
      dataAgeSeconds: Math.round((res.dataAge || 0) / 1000),
      spark: sparkline(candles, config.sparkBars),
      news: null,
    };
    items.push(finalize(item, adjustments));
  }

  // --- Schritt 4: Nachrichten nur fuer die Spitzenkandidaten ---------------
  items.sort((a, b) => b.probability - a.probability);
  const newsTargets = items.slice(0, Math.max(config.topN, config.newsTop));
  if (newsTargets.length > 0) {
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
      limit: config.limit,
      interval: config.interval,
      range: config.range,
      horizonHours: config.horizonHours,
      horizonBars,
      friction: config.friction,
      threshold: config.threshold,
      topN: config.topN,
      candleTtlMinutes: Math.round(ttl / 60000),
      requestsPerHour: Math.round((list.length * 3600000) / ttl),
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
      sessionOpen: i.session.open, stale: i.stale,
      rsi: i.indicators.rsi, volumeRatio: i.indicators.volumeRatio,
    })),
    thresholdCount: items.filter((i) => i.meetsThreshold).length,
    thresholdCountByMarket: Object.fromEntries(
      config.markets.map((m) => [m, items.filter((i) => i.market === m && i.meetsThreshold).length])
    ),
    // Kein Titel auswertbar: die Oberflaeche muss das als Ausfall darstellen,
    // nicht als leere Rangliste — sonst sieht "nichts gefunden" aus wie
    // "nichts dabei".
    noData: items.length === 0,
    // Zustand der Drosselung: die Oberflaeche soll "Quelle pausiert" von
    // "Quelle kaputt" unterscheiden koennen.
    throttle: throttleSummary(config),
    fetched: refreshSet.size,
    cached: list.length - refreshSet.size,
    skipped,
  };
}

module.exports = { runCycle, DEFAULTS, intervalMinutes };
