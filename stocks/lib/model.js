'use strict';

/**
 * Vom Signalwert zur Wahrscheinlichkeit — empirisch, nicht erfunden.
 *
 * Der ehrliche Kern dieses Dashboards. Eine Wahrscheinlichkeit entsteht hier
 * NICHT dadurch, dass Indikator-Gewichte durch eine Sigmoidfunktion geschickt
 * werden (das ergibt huebsche, aber bedeutungslose Prozentzahlen). Sie entsteht
 * als *gemessene relative Haeufigkeit*:
 *
 *   1. Fuer jeden vergangenen Balken wird derselbe Signalwert berechnet, den er
 *      in Echtzeit gehabt haette (kausal, ohne Blick nach vorn).
 *   2. Es wird nachgezaehlt, wie oft der Kurs H Balken spaeter tatsaechlich
 *      hoeher stand — netto nach Handelskosten.
 *   3. Die aktuelle Lage wird in denselben Signal-Eimer einsortiert; die
 *      Trefferquote dieses Eimers ist die Rohwahrscheinlichkeit.
 *   4. Kleine Stichproben werden gegen den gepoolten Universums-Wert und einen
 *      schwachen Prior geschrumpft (Bayes mit Pseudo-Beobachtungen), damit
 *      "3 von 3 Treffern" nicht als 100 % durchgeht.
 *
 * Beigelegt wird immer das Wilson-Konfidenzintervall und die Stichprobengroesse.
 * Wer die Zahl bewerten will, muss beides sehen.
 */

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const logit = (p) => Math.log(p / (1 - p));
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** Wie stark der Prior aus dem Signalwert selbst zieht, solange Daten fehlen. */
const PRIOR_GAIN = 1.4;
/** Pseudo-Beobachtungen: gepoolte Evidenz gegen Prior, Symbol-Evidenz gegen Pool. */
const POOL_PSEUDO = 25;
const SYMBOL_PSEUDO = 20;
/** Harte Deckel — kein Chartsignal rechtfertigt 99 %. */
const P_MIN = 0.02;
const P_MAX = 0.97;

const BUCKET_EDGES = [-1, -0.5, -0.35, -0.22, -0.12, -0.04, 0.04, 0.12, 0.22, 0.35, 0.5, 1];

function bucketOf(score) {
  for (let i = 1; i < BUCKET_EDGES.length; i++) {
    if (score < BUCKET_EDGES[i]) return i - 1;
  }
  return BUCKET_EDGES.length - 2;
}

/** Wilson-Intervall — belastbar auch bei kleinem n, anders als die Normalnaeherung. */
function wilson(hits, n, z = 1.96) {
  if (n <= 0) return { low: 0, high: 1, center: 0.5, width: 1 };
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    low: clamp(centre - margin, 0, 1),
    high: clamp(centre + margin, 0, 1),
    center: centre,
    width: clamp(2 * margin, 0, 1),
  };
}

/**
 * Ergebnisse der Vergangenheit einsammeln.
 * Ein Treffer ist nur, was die Reibung (Spread + Gebuehren) uebersteigt.
 */
function outcomes(candles, scores, horizonBars, friction = 0.0005) {
  const samples = [];
  for (let i = 0; i < scores.length - horizonBars; i++) {
    const z = scores[i];
    if (z === null) continue;
    const entry = candles[i].c;
    const exit = candles[i + horizonBars].c;
    if (!entry || !exit) continue;
    samples.push({
      score: z,
      up: exit >= entry * (1 + friction) ? 1 : 0,
      ret: exit / entry - 1,
    });
  }
  return samples;
}

/** Trefferquoten je Signal-Eimer. */
function buildCalibration(samples) {
  const buckets = Array.from({ length: BUCKET_EDGES.length - 1 }, () => ({ hits: 0, n: 0, retSum: 0 }));
  let hits = 0;
  let retSum = 0;
  for (const s of samples) {
    const b = buckets[bucketOf(s.score)];
    b.n += 1;
    b.hits += s.up;
    b.retSum += s.ret || 0;
    hits += s.up;
    retSum += s.ret || 0;
  }
  return {
    buckets,
    total: { hits, n: samples.length, meanRet: samples.length ? retSum / samples.length : 0 },
  };
}

/**
 * Nachbareimer mitzaehlen, wenn der eigene duenn besetzt ist. Der Preis dafuer
 * ist etwas Unschaerfe, der Gewinn eine belastbare Stichprobe.
 */
function lookup(table, score, minSamples = 40) {
  if (!table) return { hits: 0, n: 0, spread: 0, meanRet: null };
  const idx = bucketOf(score);
  let hits = table.buckets[idx].hits;
  let n = table.buckets[idx].n;
  let retSum = table.buckets[idx].retSum;
  let spread = 0;
  while (n < minSamples && spread < table.buckets.length) {
    spread += 1;
    const lo = idx - spread;
    const hi = idx + spread;
    if (lo >= 0) {
      hits += table.buckets[lo].hits;
      n += table.buckets[lo].n;
      retSum += table.buckets[lo].retSum;
    }
    if (hi < table.buckets.length) {
      hits += table.buckets[hi].hits;
      n += table.buckets[hi].n;
      retSum += table.buckets[hi].retSum;
    }
    if (lo < 0 && hi >= table.buckets.length) break;
  }
  return { hits, n, spread, meanRet: n ? retSum / n : null };
}

/**
 * Die eigentliche Schaetzung.
 * Reihenfolge der Schrumpfung: Prior -> Pool -> Symbol. Je mehr eigene Daten,
 * desto weniger zaehlt der Prior.
 */
function estimate({ score, pooled, symbol, minSamples = 40 }) {
  const prior = sigmoid(PRIOR_GAIN * score);
  const p = pooled ? lookup(pooled, score, minSamples) : { hits: 0, n: 0, spread: 0, meanRet: null };
  const s = symbol ? lookup(symbol, score, Math.min(minSamples, 25)) : { hits: 0, n: 0, spread: 0, meanRet: null };

  // Stufe 1: gepoolte Evidenz des Universums gegen den schwachen Prior.
  const pPool = (p.hits + POOL_PSEUDO * prior) / (p.n + POOL_PSEUDO);

  // Stufe 2: die Evidenz des Titels selbst, mit pPool als Vorwissen.
  // Als Beta-Posterior geschrieben, damit Punktschaetzer und Unsicherheit aus
  // derselben Verteilung kommen — ein Wilson-Intervall der Rohstichprobe wuerde
  // die geschrumpfte Zahl sonst gar nicht enthalten.
  const a = s.hits + SYMBOL_PSEUDO * pPool;
  const b = (s.n - s.hits) + SYMBOL_PSEUDO * (1 - pPool);
  const mass = a + b;
  const mean = a / mass;
  const sd = Math.sqrt((mean * (1 - mean)) / (mass + 1));

  return {
    raw: clamp(mean, P_MIN, P_MAX),
    prior,
    pooled: { ...p, rate: p.n ? p.hits / p.n : null },
    symbol: { ...s, rate: s.n ? s.hits / s.n : null },
    samples: p.n + s.n,
    effectiveN: mass,
    meanRet: s.meanRet !== null && s.n >= 20 ? s.meanRet : p.meanRet,
    // 95-%-Glaubwuerdigkeitsintervall des Posteriors (Normalnaeherung).
    interval: {
      low: clamp(mean - 1.96 * sd, 0, 1),
      high: clamp(mean + 1.96 * sd, 0, 1),
      width: clamp(3.92 * sd, 0, 1),
    },
    // Die unbearbeitete gemessene Trefferquote — zur Kontrolle daneben.
    measured: {
      hits: p.hits + s.hits,
      n: p.n + s.n,
      rate: p.n + s.n ? (p.hits + s.hits) / (p.n + s.n) : null,
      wilson: wilson(p.hits + s.hits, p.n + s.n),
    },
    baseRate: pooled && pooled.total.n ? pooled.total.hits / pooled.total.n : null,
  };
}

/**
 * Kontext aufschlagen — additiv in Log-Odds, jeder Beitrag gedeckelt.
 * Additiv, weil sich Log-Odds sauber addieren; gedeckelt, weil kein einzelner
 * Nachrichtenticker eine Chartlage umdrehen darf.
 */
const ADJUSTMENT_CAP = 0.45;

function applyAdjustments(p, adjustments) {
  let l = logit(clamp(p, P_MIN, P_MAX));
  const applied = [];
  for (const a of adjustments) {
    if (!a || !a.delta) continue;
    const delta = clamp(a.delta, -ADJUSTMENT_CAP, ADJUSTMENT_CAP);
    l += delta;
    applied.push({ label: a.label, delta });
  }
  return { probability: clamp(sigmoid(l), P_MIN, P_MAX), applied };
}

/** Ausserhalb der Handelszeit zieht die Schaetzung Richtung Muenzwurf. */
function damp(p, factor) {
  return 0.5 + (p - 0.5) * clamp(factor, 0, 1);
}

/**
 * Wie belastbar ist die Zahl? Stichprobe, Intervallbreite, Quellenlage und
 * Datenalter zusammengefasst — bewusst grob, damit niemand Scheinpraezision liest.
 */
function confidenceGrade({ samples, intervalWidth, sources, ageSeconds, marketOpen }) {
  let points = 0;
  if (samples >= 400) points += 2;
  else if (samples >= 150) points += 1;
  if (intervalWidth <= 0.12) points += 2;
  else if (intervalWidth <= 0.2) points += 1;
  if (sources >= 3) points += 1;
  if (ageSeconds !== null && ageSeconds <= 300) points += 1;
  if (!marketOpen) points -= 2;
  if (points >= 5) return { level: 'hoch', points };
  if (points >= 3) return { level: 'mittel', points };
  return { level: 'niedrig', points };
}

module.exports = {
  sigmoid, logit, wilson, bucketOf, BUCKET_EDGES,
  outcomes, buildCalibration, lookup, estimate,
  applyAdjustments, damp, confidenceGrade,
  P_MIN, P_MAX, ADJUSTMENT_CAP,
};
