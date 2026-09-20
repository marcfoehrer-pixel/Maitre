'use strict';

/**
 * Reine Indikator-Mathematik — kein DOM, kein Netz, keine Zeit.
 *
 * Alle Funktionen sind *kausal*: der Wert an Position i benutzt ausschliesslich
 * Daten bis einschliesslich i. Das ist die Voraussetzung dafuer, dass dieselbe
 * Rechnung sowohl fuer den aktuellen Balken als auch fuer die historische
 * Kalibrierung (model.js) verwendet werden darf — ohne Blick in die Zukunft.
 *
 * Rueckgabe ist immer ein Array in Laenge der Eingabe; fuehrende, noch nicht
 * berechenbare Positionen sind `null` statt 0, damit "unbekannt" nicht
 * versehentlich als Messwert durchrutscht.
 */

const nulls = (n) => new Array(n).fill(null);

function sma(values, period) {
  const out = nulls(values.length);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = nulls(values.length);
  if (period <= 0 || values.length < period) return out;
  const k = 2 / (period + 1);
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Wilder-Glaettung (RMA) — Basis fuer RSI, ATR und ADX. */
function rma(values, period) {
  const out = nulls(values.length);
  if (period <= 0 || values.length < period) return out;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  let prev = seed / period;
  out[period - 1] = prev;
  for (let i = period; i < values.length; i++) {
    prev = (prev * (period - 1) + values[i]) / period;
    out[i] = prev;
  }
  return out;
}

function stdev(values, period) {
  const out = nulls(values.length);
  for (let i = period - 1; i < values.length; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) acc += (values[j] - mean) ** 2;
    out[i] = Math.sqrt(acc / period);
  }
  return out;
}

function rsi(values, period = 14) {
  const out = nulls(values.length);
  if (values.length <= period) return out;
  const gains = [0];
  const losses = [0];
  for (let i = 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    gains.push(Math.max(0, diff));
    losses.push(Math.max(0, -diff));
  }
  // Der erste Differenzwert ist kuenstlich 0, deshalb ab Index 1 glaetten.
  const avgGain = rma(gains.slice(1), period);
  const avgLoss = rma(losses.slice(1), period);
  for (let i = 0; i < avgGain.length; i++) {
    if (avgGain[i] === null) continue;
    const loss = avgLoss[i];
    out[i + 1] = loss === 0 ? 100 : 100 - 100 / (1 + avgGain[i] / loss);
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const line = values.map((_, i) =>
    emaFast[i] === null || emaSlow[i] === null ? null : emaFast[i] - emaSlow[i]
  );
  const firstLine = line.findIndex((v) => v !== null);
  const signal = nulls(values.length);
  const hist = nulls(values.length);
  if (firstLine !== -1) {
    const dense = line.slice(firstLine);
    const sig = ema(dense, signalPeriod);
    for (let i = 0; i < sig.length; i++) {
      if (sig[i] === null) continue;
      signal[firstLine + i] = sig[i];
      hist[firstLine + i] = dense[i] - sig[i];
    }
  }
  return { macd: line, signal, hist };
}

function trueRange(candles) {
  return candles.map((c, i) => {
    if (i === 0) return c.h - c.l;
    const prev = candles[i - 1].c;
    return Math.max(c.h - c.l, Math.abs(c.h - prev), Math.abs(c.l - prev));
  });
}

function atr(candles, period = 14) {
  return rma(trueRange(candles), period);
}

function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const sd = stdev(values, period);
  const upper = nulls(values.length);
  const lower = nulls(values.length);
  const percentB = nulls(values.length);
  const bandwidth = nulls(values.length);
  for (let i = 0; i < values.length; i++) {
    if (mid[i] === null || sd[i] === null) continue;
    upper[i] = mid[i] + mult * sd[i];
    lower[i] = mid[i] - mult * sd[i];
    const span = upper[i] - lower[i];
    percentB[i] = span === 0 ? 0.5 : (values[i] - lower[i]) / span;
    bandwidth[i] = mid[i] === 0 ? 0 : span / mid[i];
  }
  return { mid, upper, lower, percentB, bandwidth };
}

/**
 * Volumengewichteter Durchschnittskurs, pro Handelstag zurueckgesetzt.
 * `dayKey` trennt die Sitzungen — ohne Reset waere der VWAP am zweiten Tag
 * bereits von der Vorgeschichte dominiert und als Intraday-Marke wertlos.
 */
function vwap(candles, dayKey = (c) => new Date(c.t).toISOString().slice(0, 10)) {
  const out = nulls(candles.length);
  let key = null;
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const k = dayKey(c);
    if (k !== key) {
      key = k;
      pv = 0;
      vol = 0;
    }
    const typical = (c.h + c.l + c.c) / 3;
    const v = c.v > 0 ? c.v : 0;
    pv += typical * v;
    vol += v;
    out[i] = vol > 0 ? pv / vol : typical;
  }
  return out;
}

function adx(candles, period = 14) {
  const len = candles.length;
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < len; i++) {
    const up = candles[i].h - candles[i - 1].h;
    const down = candles[i - 1].l - candles[i].l;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = rma(trueRange(candles), period);
  const plus = rma(plusDM, period);
  const minus = rma(minusDM, period);
  const plusDI = nulls(len);
  const minusDI = nulls(len);
  const dx = [];
  const dxIndex = [];
  for (let i = 0; i < len; i++) {
    if (tr[i] === null || tr[i] === 0 || plus[i] === null || minus[i] === null) continue;
    plusDI[i] = (100 * plus[i]) / tr[i];
    minusDI[i] = (100 * minus[i]) / tr[i];
    const sum = plusDI[i] + minusDI[i];
    dx.push(sum === 0 ? 0 : (100 * Math.abs(plusDI[i] - minusDI[i])) / sum);
    dxIndex.push(i);
  }
  const smoothed = rma(dx, period);
  const out = nulls(len);
  for (let i = 0; i < smoothed.length; i++) {
    if (smoothed[i] !== null) out[dxIndex[i]] = smoothed[i];
  }
  return { adx: out, plusDI, minusDI };
}

function stochastic(candles, period = 14, smoothD = 3) {
  const len = candles.length;
  const k = nulls(len);
  for (let i = period - 1; i < len; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].h);
      lo = Math.min(lo, candles[j].l);
    }
    k[i] = hi === lo ? 50 : (100 * (candles[i].c - lo)) / (hi - lo);
  }
  const first = k.findIndex((v) => v !== null);
  const d = nulls(len);
  if (first !== -1) {
    const dense = sma(k.slice(first), smoothD);
    for (let i = 0; i < dense.length; i++) if (dense[i] !== null) d[first + i] = dense[i];
  }
  return { k, d };
}

function obv(candles) {
  const out = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].c - candles[i - 1].c;
    const v = candles[i].v > 0 ? candles[i].v : 0;
    out[i] = out[i - 1] + (diff > 0 ? v : diff < 0 ? -v : 0);
  }
  return out;
}

/** Steigung der Regressionsgeraden ueber `period` Balken, in Einheiten je Balken. */
function linregSlope(values, period) {
  const out = nulls(values.length);
  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumXX = ((n - 1) * n * (2 * n - 1)) / 6;
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return out;
  for (let i = period - 1; i < values.length; i++) {
    let sumY = 0;
    let sumXY = 0;
    for (let x = 0; x < n; x++) {
      const y = values[i - n + 1 + x];
      sumY += y;
      sumXY += x * y;
    }
    out[i] = (n * sumXY - sumX * sumY) / denom;
  }
  return out;
}

function roc(values, period) {
  const out = nulls(values.length);
  for (let i = period; i < values.length; i++) {
    const base = values[i - period];
    out[i] = base === 0 ? 0 : (values[i] - base) / base;
  }
  return out;
}

module.exports = {
  sma, ema, rma, stdev, rsi, macd, trueRange, atr, bollinger,
  vwap, adx, stochastic, obv, linregSlope, roc,
};
