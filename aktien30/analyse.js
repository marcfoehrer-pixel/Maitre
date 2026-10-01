'use strict';

/**
 * Bewertung je Titel fuer die kommenden 30 Kalendertage (= 21 Handelstage).
 *
 * Gefragt ist ein Ereignis aus zwei Teilen:
 *   1. Absicherung: der Kurs faellt in diesem Zeitraum zu keinem Zeitpunkt
 *      mehr als 5 % unter den heutigen Schluss (gemessen am Tagestief).
 *   2. Chance: nach 21 Handelstagen steht der Kurs hoeher als heute.
 *
 * Die Prozentzahl ist keine Formel-Annahme, sondern eine gemessene Trefferquote:
 * Wie oft trat genau dieses Ereignis in den letzten Jahren ein, wenn ein Titel
 * charttechnisch aehnlich dastand und aehnlich stark schwankte? Gemessen wird
 * ueber alle Titel gemeinsam (viele Faelle, stabile Quoten) und anschliessend
 * vorsichtig an das Eigenverhalten des einzelnen Titels angepasst.
 */

const HORIZONT = 21;          // Handelstage ≈ 30 Kalendertage
const MAX_VERLUST = 0.05;     // 5 %
const MIN_HISTORIE = 260;     // SMA 200 + 52-Wochen-Hoch brauchen ein Jahr Vorlauf
const SCHRITT = 3;            // Stichprobenabstand: benachbarte Tage sind fast dieselbe Beobachtung
const GLAETTUNG_ZELLE = 60;   // Faelle, mit denen eine duenne Zelle zur Zeilenquote gezogen wird
const GLAETTUNG_TITEL = 120;  // Faelle, ab denen das Eigenverhalten eines Titels Gewicht bekommt

// ---------------------------------------------------------------- Indikatoren

function sma(werte, n) {
  const out = new Array(werte.length).fill(null);
  let summe = 0;
  for (let i = 0; i < werte.length; i++) {
    summe += werte[i];
    if (i >= n) summe -= werte[i - n];
    if (i >= n - 1) out[i] = summe / n;
  }
  return out;
}

function ema(werte, n) {
  const out = new Array(werte.length).fill(null);
  const k = 2 / (n + 1);
  let e = null;
  for (let i = 0; i < werte.length; i++) {
    e = e === null ? werte[i] : werte[i] * k + e * (1 - k);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}

/** RSI nach Wilder. */
function rsi(werte, n = 14) {
  const out = new Array(werte.length).fill(null);
  let auf = 0;
  let ab = 0;
  for (let i = 1; i < werte.length; i++) {
    const d = werte[i] - werte[i - 1];
    const a = Math.max(d, 0);
    const b = Math.max(-d, 0);
    if (i <= n) {
      auf += a / n;
      ab += b / n;
    } else {
      auf = (auf * (n - 1) + a) / n;
      ab = (ab * (n - 1) + b) / n;
    }
    if (i >= n) out[i] = ab === 0 ? 100 : 100 - 100 / (1 + auf / ab);
  }
  return out;
}

/** MACD-Histogramm (12/26/9). */
function macdHist(werte) {
  const e12 = ema(werte, 12);
  const e26 = ema(werte, 26);
  const linie = werte.map((_, i) => (e26[i] === null ? null : e12[i] - e26[i]));
  const start = linie.findIndex((v) => v !== null);
  const signal = new Array(werte.length).fill(null);
  if (start >= 0) {
    const s = ema(linie.slice(start), 9);
    for (let i = 0; i < s.length; i++) signal[start + i] = s[i];
  }
  return linie.map((v, i) => (v === null || signal[i] === null ? null : v - signal[i]));
}

/** Annualisierte Schwankung der Tagesrenditen ueber n Tage. */
function volatilitaet(werte, n = 20) {
  const r = werte.map((v, i) => (i === 0 ? 0 : Math.log(v / werte[i - 1])));
  const out = new Array(werte.length).fill(null);
  for (let i = n; i < werte.length; i++) {
    let m = 0;
    for (let j = i - n + 1; j <= i; j++) m += r[j];
    m /= n;
    let q = 0;
    for (let j = i - n + 1; j <= i; j++) q += (r[j] - m) ** 2;
    out[i] = Math.sqrt(q / (n - 1)) * Math.sqrt(252);
  }
  return out;
}

function rollMax(werte, n) {
  const out = new Array(werte.length).fill(null);
  const dq = [];
  for (let i = 0; i < werte.length; i++) {
    while (dq.length && werte[dq[dq.length - 1]] <= werte[i]) dq.pop();
    dq.push(i);
    if (dq[0] <= i - n) dq.shift();
    if (i >= n - 1) out[i] = werte[dq[0]];
  }
  return out;
}

// ------------------------------------------------------- Charttechnik-Score

/**
 * Alle Merkmale eines Titels fuer jeden Tag — einmal berechnet, damit
 * Gegenwart und Vergangenheit mit exakt derselben Rechnung bewertet werden.
 */
function merkmale(kurse) {
  const c = kurse.map((k) => k.c);
  const h = kurse.map((k) => k.h);
  return {
    c,
    l: kurse.map((k) => k.l),
    sma50: sma(c, 50),
    sma200: sma(c, 200),
    rsi: rsi(c, 14),
    macd: macdHist(c),
    vol: volatilitaet(c, 20),
    hoch52: rollMax(h, 252),
  };
}

/**
 * Charttechnik-Score 0–100 am Tag i. Vier Bausteine, jeder fuer sich lesbar:
 * Trend (35), Momentum (25), RSI (20), Naehe zum 52-Wochen-Hoch (20).
 */
function score(m, i) {
  if (i < MIN_HISTORIE - 1 || m.sma200[i] === null || m.rsi[i] === null || m.macd[i - 3] == null) return null;
  const c = m.c[i];
  const teile = { trend: 0, momentum: 0, rsi: 0, hoch: 0 };

  if (c > m.sma50[i]) teile.trend += 10;
  if (m.sma50[i] > m.sma200[i]) teile.trend += 15;
  if (m.sma50[i] > m.sma50[i - 10]) teile.trend += 10;

  if (c > m.c[i - 63]) teile.momentum += 10;
  if (m.macd[i] > 0) teile.momentum += 8;
  if (m.macd[i] > m.macd[i - 3]) teile.momentum += 7;

  const r = m.rsi[i];
  if (r >= 45 && r <= 65) teile.rsi = 20;        // intakter Aufwaertsdruck ohne Ueberhitzung
  else if (r > 65 && r <= 72) teile.rsi = 12;
  else if (r >= 35 && r < 45) teile.rsi = 8;
  else if (r < 35) teile.rsi = 5;                 // ueberverkauft: Gegenbewegung moeglich, aber fallendes Messer
  else teile.rsi = 3;                             // ueberkauft

  const abstand = c / m.hoch52[i];
  if (abstand >= 0.95) teile.hoch = 20;
  else if (abstand >= 0.9) teile.hoch = 14;
  else if (abstand >= 0.8) teile.hoch = 7;

  return { wert: teile.trend + teile.momentum + teile.rsi + teile.hoch, teile };
}

/** Was in den 21 Handelstagen nach Tag i tatsaechlich geschah. */
function ergebnis(m, i) {
  if (i + HORIZONT >= m.c.length) return null;
  let tief = Infinity;
  for (let j = i + 1; j <= i + HORIZONT; j++) tief = Math.min(tief, m.l[j]);
  const sicher = tief >= m.c[i] * (1 - MAX_VERLUST);
  const steigt = m.c[i + HORIZONT] > m.c[i];
  return { sicher, steigt, beides: sicher && steigt };
}

// ---------------------------------------------------------- Kalibrierung

const SCORE_GRENZEN = [20, 40, 60, 80];
const binScore = (s) => SCORE_GRENZEN.filter((g) => s >= g).length;
const binVol = (v, grenzen) => grenzen.filter((g) => v >= g).length;
const ZIELE = ['sicher', 'steigt', 'beides'];

function quantile(werte, anteile) {
  const s = [...werte].sort((a, b) => a - b);
  return anteile.map((p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]);
}

/** Historische Stichproben aller Titel: Score, Schwankung, Ergebnis. */
function stichproben(titel, bisIndex = null) {
  const out = [];
  for (const t of titel) {
    const ende = t.m.c.length - 1 - HORIZONT;
    for (let i = MIN_HISTORIE - 1; i <= ende; i += SCHRITT) {
      const s = score(t.m, i);
      const e = ergebnis(t.m, i);
      if (!s || !e || t.m.vol[i] === null) continue;
      out.push({ symbol: t.symbol, zeit: t.zeit[i], score: s.wert, vol: t.m.vol[i], ...e });
    }
  }
  return bisIndex === null ? out : out.filter(bisIndex);
}

/**
 * Trefferquoten-Tabelle: 5 Score-Stufen × 5 Schwankungs-Stufen.
 * Duenn besetzte Zellen werden zur Quote ihrer Score-Stufe gezogen, damit
 * zwanzig Zufallsfaelle keine 95 % vortaeuschen.
 */
function kalibrieren(proben) {
  if (proben.length < 200) throw new Error(`Zu wenig Historie fuer eine belastbare Messung (${proben.length} Faelle).`);
  const volGrenzen = quantile(proben.map((p) => p.vol), [0.2, 0.4, 0.6, 0.8]);
  const leer = () => Object.fromEntries(ZIELE.map((z) => [z, 0]));
  const zellen = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ n: 0, ...leer() })));
  const zeilen = Array.from({ length: 5 }, () => ({ n: 0, ...leer() }));
  const gesamt = { n: 0, ...leer() };
  for (const p of proben) {
    const a = binScore(p.score);
    const b = binVol(p.vol, volGrenzen);
    for (const ziel of [zellen[a][b], zeilen[a], gesamt]) {
      ziel.n++;
      for (const z of ZIELE) ziel[z] += p[z] ? 1 : 0;
    }
  }
  const basis = Object.fromEntries(ZIELE.map((z) => [z, gesamt[z] / gesamt.n]));
  const quote = (zelle, z, vorwissen, k) => (zelle[z] + k * vorwissen) / (zelle.n + k);
  const tabelle = zellen.map((zeile, a) => zeile.map((zelle) => {
    const out = { n: zelle.n };
    for (const z of ZIELE) {
      const zeilenQuote = quote(zeilen[a], z, basis[z], GLAETTUNG_ZELLE);
      out[z] = quote(zelle, z, zeilenQuote, GLAETTUNG_ZELLE);
    }
    return out;
  }));
  return { volGrenzen, tabelle, basis, faelle: gesamt.n };
}

function nachschlagen(kal, s, vol) {
  return kal.tabelle[binScore(s)][binVol(vol, kal.volGrenzen)];
}

/**
 * Eigenverhalten: Lag ein Titel in seiner Vergangenheit systematisch ueber
 * oder unter dem, was die Tabelle fuer ihn erwartet hat? Der Faktor wird
 * stark gegen 1 gezogen — nur ein langer, eindeutiger Befund verschiebt ihn.
 */
function titelFaktoren(kal, proben) {
  const je = new Map();
  for (const p of proben) {
    if (!je.has(p.symbol)) je.set(p.symbol, { n: 0, ist: leerZiele(), soll: leerZiele() });
    const e = je.get(p.symbol);
    const erwartet = nachschlagen(kal, p.score, p.vol);
    e.n++;
    for (const z of ZIELE) {
      e.ist[z] += p[z] ? 1 : 0;
      e.soll[z] += erwartet[z];
    }
  }
  const out = new Map();
  for (const [symbol, e] of je) {
    const f = {};
    for (const z of ZIELE) {
      const roh = (e.ist[z] + GLAETTUNG_TITEL * (e.soll[z] / e.n)) / (e.soll[z] + GLAETTUNG_TITEL * (e.soll[z] / e.n));
      f[z] = Math.min(1.3, Math.max(0.7, roh));
    }
    out.set(symbol, f);
  }
  return out;
}

function leerZiele() {
  return Object.fromEntries(ZIELE.map((z) => [z, 0]));
}

const begrenzen = (p) => Math.min(0.99, Math.max(0.01, p));

/**
 * Pruefung ausserhalb der Stichprobe: Tabelle nur mit Daten bis vor einem Jahr
 * bauen, dann am letzten Jahr messen. Zeigt, ob die Rangfolge traegt — also
 * ob die oberen 20 % des Rankings tatsaechlich haeufiger trafen als der Rest.
 */
function rueckblick(titel) {
  const alle = stichproben(titel);
  if (!alle.length) return null;
  const letzte = Math.max(...alle.map((p) => p.zeit));
  const grenze = letzte - 365 * 86400;
  const lern = alle.filter((p) => p.zeit < grenze);
  const test = alle.filter((p) => p.zeit >= grenze);
  if (lern.length < 200 || test.length < 100) return null;
  const kal = kalibrieren(lern);
  const bewertet = test
    .map((p) => ({ p: nachschlagen(kal, p.score, p.vol).beides, treffer: p.beides }))
    .sort((a, b) => b.p - a.p);
  const oben = bewertet.slice(0, Math.max(1, Math.floor(bewertet.length / 5)));
  const quoteVon = (xs) => xs.filter((x) => x.treffer).length / xs.length;
  return {
    faelle: bewertet.length,
    trefferAlle: quoteVon(bewertet),
    trefferTop20: quoteVon(oben),
    erwartetTop20: oben.reduce((s, x) => s + x.p, 0) / oben.length,
  };
}

/**
 * Hauptfunktion: nimmt Kursreihen, liefert Ranking + Kennzahlen.
 * @param {Array<{symbol,name,indizes,waehrung,kurse:Array<{t,o,h,l,c}>}>} daten
 */
function bewerten(daten) {
  const titel = daten
    .filter((d) => d.kurse && d.kurse.length >= MIN_HISTORIE + 5)
    .map((d) => ({ ...d, m: merkmale(d.kurse), zeit: d.kurse.map((k) => k.t) }));
  const proben = stichproben(titel);
  const kal = kalibrieren(proben);
  const faktoren = titelFaktoren(kal, proben);

  const ranking = [];
  for (const t of titel) {
    const i = t.m.c.length - 1;
    const s = score(t.m, i);
    if (!s || t.m.vol[i] === null) continue;
    const zelle = nachschlagen(kal, s.wert, t.m.vol[i]);
    const f = faktoren.get(t.symbol) || { sicher: 1, steigt: 1, beides: 1 };
    const sicher = begrenzen(zelle.sicher * f.sicher);
    const steigt = begrenzen(zelle.steigt * f.steigt);
    // Das Gesamtereignis kann nie wahrscheinlicher sein als jeder seiner Teile.
    const beides = Math.min(begrenzen(zelle.beides * f.beides), sicher, steigt);
    const c = t.m.c;
    ranking.push({
      symbol: t.symbol,
      name: t.name,
      indizes: t.indizes,
      waehrung: t.waehrung,
      quelle: t.quelle,
      stand: t.zeit[i],
      kurs: c[i],
      tag: c[i] / c[i - 1] - 1,
      monat: c[i] / c[i - 21] - 1,
      p: { beides, sicher, steigt },
      score: s.wert,
      teile: s.teile,
      rsi: t.m.rsi[i],
      vol: t.m.vol[i],
      zuSma50: c[i] / t.m.sma50[i] - 1,
      zuSma200: c[i] / t.m.sma200[i] - 1,
      zumHoch: c[i] / t.m.hoch52[i] - 1,
      vergleichsfaelle: zelle.n,
    });
  }
  ranking.sort((a, b) => b.p.beides - a.p.beides);

  return {
    ranking,
    basis: kal.basis,
    faelle: kal.faelle,
    rueckblick: rueckblick(titel),
    zuKurz: daten.filter((d) => d.kurse && d.kurse.length < MIN_HISTORIE + 5).map((d) => d.symbol),
  };
}

module.exports = {
  bewerten, merkmale, score, ergebnis, kalibrieren, stichproben,
  sma, ema, rsi, macdHist, volatilitaet, rollMax,
  HORIZONT, MAX_VERLUST, MIN_HISTORIE,
};
