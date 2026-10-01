'use strict';

/** Reproduzierbare Kunstkurse: geometrische Irrfahrt mit Drift und Schwankung. */
function zufall(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rnd) {
  return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
}

/** drift und vol jeweils annualisiert. */
function reihe({ tage = 1260, drift = 0.08, vol = 0.25, seed = 1, start = 100 }) {
  const rnd = zufall(seed);
  const dt = 1 / 252;
  const out = [];
  let c = start;
  let t = Date.UTC(2021, 9, 1) / 1000;
  for (let i = 0; i < tage; i++) {
    const o = c;
    c = c * Math.exp((drift - vol * vol / 2) * dt + vol * Math.sqrt(dt) * normal(rnd));
    const spanne = Math.abs(normal(rnd)) * vol * Math.sqrt(dt) * 0.5;
    out.push({ t, o, h: Math.max(o, c) * (1 + spanne), l: Math.min(o, c) * (1 - spanne), c });
    t += 86400 * (i % 5 === 4 ? 3 : 1);
  }
  return out;
}

function universum(anzahl = 30) {
  return Array.from({ length: anzahl }, (_, i) => ({
    symbol: `T${i}`,
    name: `Titel ${i}`,
    indizes: [['DAX', 'Nasdaq-100', 'Dow Jones'][i % 3]],
    waehrung: i % 3 === 0 ? 'EUR' : 'USD',
    quelle: 'Test',
    kurse: reihe({ seed: i + 1, drift: -0.1 + (i % 6) * 0.06, vol: 0.15 + (i % 5) * 0.08 }),
  }));
}

module.exports = { reihe, universum };
