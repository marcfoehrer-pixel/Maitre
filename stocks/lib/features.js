'use strict';

/**
 * Kerzen -> Merkmalsvektor -> Signalwert.
 *
 * Getrennt von model.js, weil hier nur *beschrieben* wird, was der Chart zeigt.
 * Die Uebersetzung in eine Wahrscheinlichkeit passiert erst dort — und zwar
 * empirisch, nicht durch Umrechnung dieser Gewichte.
 *
 * Jedes Merkmal ist auf ungefaehr [-1, 1] normiert und gegen die ATR skaliert,
 * damit ein 400-EUR-Wert und ein 12-EUR-Wert vergleichbar bleiben.
 */

const ind = require('./indicators');

const clamp = (x, lo = -1, hi = 1) => Math.min(hi, Math.max(lo, x));
const tanh = Math.tanh;

/**
 * Gewichte des Signalwerts. Summe der Betraege = 1, damit z in [-1, 1] liegt.
 * Reihenfolge = Bedeutung: Trend und Momentum tragen am meisten, Oszillatoren
 * sind bewusst Beiwerk (sie sind im Intraday-Bereich notorisch unzuverlaessig).
 */
const WEIGHTS = {
  trendEma: 0.16,
  momentum: 0.15,
  macdTilt: 0.12,
  vwapTilt: 0.11,
  slopeTilt: 0.10,
  adxTrend: 0.09,
  volumeTilt: 0.08,
  rsiTilt: 0.07,
  bbTilt: 0.05,
  obvTilt: 0.04,
  stochTilt: 0.03,
};

const LABELS = {
  trendEma: 'EMA-Trend (9/21)',
  momentum: 'Momentum (12 Balken)',
  macdTilt: 'MACD-Histogramm',
  vwapTilt: 'Abstand zum VWAP',
  slopeTilt: 'Regressionssteigung',
  adxTrend: 'Trendstaerke (ADX/DI)',
  volumeTilt: 'Relatives Volumen',
  rsiTilt: 'RSI-Lage',
  bbTilt: 'Bollinger-Position',
  obvTilt: 'On-Balance-Volumen',
  stochTilt: 'Stochastik',
};

/** Einmal je Symbol rechnen, danach fuer jeden Balken wiederverwenden. */
function prepare(candles) {
  const close = candles.map((c) => c.c);
  const volume = candles.map((c) => (c.v > 0 ? c.v : 0));
  const macdBundle = ind.macd(close);
  const adxBundle = ind.adx(candles);
  const stochBundle = ind.stochastic(candles);
  const obvSeries = ind.obv(candles);
  return {
    close,
    volume,
    ema9: ind.ema(close, 9),
    ema21: ind.ema(close, 21),
    ema50: ind.ema(close, 50),
    rsi14: ind.rsi(close, 14),
    macd: macdBundle.macd,
    macdSignal: macdBundle.signal,
    macdHist: macdBundle.hist,
    atr14: ind.atr(candles, 14),
    boll: ind.bollinger(close, 20, 2),
    vwap: ind.vwap(candles),
    adx: adxBundle.adx,
    plusDI: adxBundle.plusDI,
    minusDI: adxBundle.minusDI,
    stochK: stochBundle.k,
    stochD: stochBundle.d,
    obv: obvSeries,
    obvSlope: ind.linregSlope(obvSeries, 20),
    slope20: ind.linregSlope(close, 20),
    volSma20: ind.sma(volume, 20),
  };
}

/** Ab diesem Index sind alle Indikatoren definiert. */
const WARMUP = 55;

/**
 * Merkmalsvektor am Balken i. Gibt `null` zurueck, solange die Indikatoren
 * noch nicht eingeschwungen sind — lieber kein Signal als ein halbes.
 */
function featuresAt(p, candles, i) {
  if (i < WARMUP || i >= candles.length) return null;
  const atr = p.atr14[i];
  const price = p.close[i];
  if (!atr || !price || atr <= 0) return null;

  const f = {};

  // Trend: kurzer gegen mittleren EMA, in ATR gemessen.
  f.trendEma = tanh(((p.ema9[i] - p.ema21[i]) / atr) * 2);

  // Momentum ueber eine Stunde (bei 5-Minuten-Balken), ATR-normiert.
  const back = Math.min(12, i);
  f.momentum = tanh((p.close[i] - p.close[i - back]) / atr / 2);

  f.macdTilt = p.macdHist[i] === null ? 0 : tanh((p.macdHist[i] / atr) * 8);

  f.vwapTilt = p.vwap[i] ? tanh((price - p.vwap[i]) / atr) : 0;

  f.slopeTilt = p.slope20[i] === null ? 0 : tanh((p.slope20[i] * 20) / atr);

  // Trendstaerke traegt nur mit Vorzeichen der Richtungsindizes.
  if (p.adx[i] === null || p.plusDI[i] === null) {
    f.adxTrend = 0;
  } else {
    const dir = Math.sign(p.plusDI[i] - p.minusDI[i]);
    f.adxTrend = dir * clamp(p.adx[i] / 40, 0, 1);
  }

  // Volumen ohne Richtung waere blind — Vorzeichen kommt vom Balken selbst.
  const volRef = p.volSma20[i];
  if (!volRef || volRef <= 0) {
    f.volumeTilt = 0;
  } else {
    const ratio = p.volume[i] / volRef;
    const body = Math.sign(candles[i].c - candles[i].o);
    f.volumeTilt = clamp(body * tanh(ratio - 1), -1, 1);
  }

  // RSI: Rueckenwind im Bereich 50-70, Gegenwind bei Ueberhitzung.
  const rsi = p.rsi14[i];
  if (rsi === null) {
    f.rsiTilt = 0;
  } else {
    let tilt = clamp((rsi - 50) / 25);
    if (rsi > 78) tilt -= (rsi - 78) / 15;
    if (rsi < 22) tilt += (22 - rsi) / 30;
    f.rsiTilt = clamp(tilt);
  }

  // Bollinger: obere Haelfte ist Staerke, ausserhalb des Bandes ist Risiko.
  const pb = p.boll.percentB[i];
  if (pb === null) {
    f.bbTilt = 0;
  } else {
    let tilt = clamp((pb - 0.5) * 2);
    if (pb > 1.02) tilt -= (pb - 1.02) * 3;
    f.bbTilt = clamp(tilt);
  }

  const obvS = p.obvSlope[i];
  f.obvTilt = obvS === null || !volRef ? 0 : tanh(obvS / (volRef * 2));

  const k = p.stochK[i];
  if (k === null) {
    f.stochTilt = 0;
  } else {
    let tilt = clamp((k - 50) / 50);
    if (k > 92) tilt -= (k - 92) / 10;
    f.stochTilt = clamp(tilt);
  }

  return f;
}

/** Gewichtete Summe der Merkmale — der Signalwert z in [-1, 1]. */
function scoreOf(features) {
  let z = 0;
  for (const key of Object.keys(WEIGHTS)) z += WEIGHTS[key] * (features[key] || 0);
  return clamp(z);
}

/**
 * Signalverlauf ueber die gesamte Historie. Grundlage der empirischen
 * Kalibrierung: jeder vergangene Balken bekommt denselben Signalwert, den er
 * damals in Echtzeit bekommen haette.
 */
function scoreSeries(candles) {
  const p = prepare(candles);
  const scores = new Array(candles.length).fill(null);
  const vectors = new Array(candles.length).fill(null);
  for (let i = WARMUP; i < candles.length; i++) {
    const f = featuresAt(p, candles, i);
    if (!f) continue;
    vectors[i] = f;
    scores[i] = scoreOf(f);
  }
  return { prepared: p, scores, vectors };
}

/** Die staerksten Treiber im Klartext — fuer die Spalte "Warum". */
function explain(features, limit = 4) {
  return Object.keys(WEIGHTS)
    .map((key) => ({
      key,
      label: LABELS[key],
      value: features[key] || 0,
      contribution: WEIGHTS[key] * (features[key] || 0),
    }))
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, limit);
}

module.exports = { WEIGHTS, LABELS, WARMUP, prepare, featuresAt, scoreOf, scoreSeries, explain };
