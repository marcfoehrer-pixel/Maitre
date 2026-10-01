'use strict';

/**
 * Tageskurse (5 Jahre) je Titel.
 *
 * Erstquelle Yahoo: kein Konto noetig, im heimischen Netz zuverlaessig.
 * Yahoo weist aber Anfragen aus Rechenzentren zeitweise pauschal ab — dann
 * springt Twelve Data ein, sofern TWELVEDATA_API_KEY gesetzt ist (kostenloser
 * Schluessel: 8 Abrufe je Minute, 800 je Tag; ein Durchlauf braucht ~165).
 */

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const warte = (ms) => new Promise((r) => setTimeout(r, ms));

async function holeJson(url, versuche = 3) {
  let letzter;
  for (let v = 0; v < versuche; v++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) throw Object.assign(new Error('nicht gefunden (404)'), { endgueltig: true });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: res.status });
      return await res.json();
    } catch (e) {
      letzter = e;
      if (e.endgueltig) break;
      await warte(1500 * 2 ** v);
    }
  }
  throw letzter;
}

function yahooZuKursen(json) {
  const r = json?.chart?.result?.[0];
  if (!r) throw new Error(json?.chart?.error?.description || 'keine Daten');
  const q = r.indicators.quote[0];
  const out = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const [o, h, l, c] = [q.open[i], q.high[i], q.low[i], q.close[i]];
    if ([o, h, l, c].some((x) => x == null || !Number.isFinite(x))) continue;
    out.push({ t: r.timestamp[i], o, h, l, c });
  }
  return out;
}

async function yahoo(titel) {
  const host = Math.random() < 0.5 ? 'query1' : 'query2';
  const url = `https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(titel.symbol)}?range=5y&interval=1d&includePrePost=false`;
  return yahooZuKursen(await holeJson(url));
}

function twelveZuKursen(json) {
  if (json.status === 'error') throw Object.assign(new Error(json.message || 'Fehler'), { code: json.code });
  const werte = (json.values || []).map((v) => ({
    t: Math.floor(Date.parse(`${v.datetime}T00:00:00Z`) / 1000),
    o: +v.open, h: +v.high, l: +v.low, c: +v.close,
  }));
  return werte.filter((k) => [k.o, k.h, k.l, k.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}

/** Haelt das Minutenkontingent von Twelve Data ein (Standard: 8 je Minute). */
function minutenBremse(jeMinute) {
  const zeiten = [];
  return async () => {
    for (;;) {
      const jetzt = Date.now();
      while (zeiten.length && jetzt - zeiten[0] > 61000) zeiten.shift();
      if (zeiten.length < jeMinute) {
        zeiten.push(jetzt);
        return;
      }
      await warte(61000 - (jetzt - zeiten[0]) + 50);
    }
  };
}

function twelveData(schluessel, jeMinute) {
  const bremse = minutenBremse(jeMinute);
  return async (titel) => {
    for (let v = 0; v < 3; v++) {
      await bremse();
      const p = new URLSearchParams({ symbol: titel.td, interval: '1day', outputsize: '1300', apikey: schluessel });
      if (titel.tdMic) p.set('mic_code', titel.tdMic);
      try {
        return twelveZuKursen(await holeJson(`https://api.twelvedata.com/time_series?${p}`, 1));
      } catch (e) {
        if (e.code !== 429) throw e; // nur das Minutenlimit lohnt einen zweiten Anlauf
        await warte(61000);
      }
    }
    throw new Error('Minutenlimit dauerhaft erreicht');
  };
}

/**
 * Laedt alle Titel. Yahoo parallel (vier gleichzeitig); was dort scheitert,
 * geht der Reihe nach an Twelve Data. Jeder Fehlgrund bleibt erhalten.
 */
async function ladeAlle(universum, { log = () => {}, parallel = 4 } = {}) {
  const schluessel = process.env.TWELVEDATA_API_KEY;
  const td = schluessel ? twelveData(schluessel, Number(process.env.TWELVEDATA_PRO_MINUTE) || 8) : null;
  const ergebnis = new Map();
  let yahooFehler = 0;

  const warteschlange = [...universum];
  const arbeiter = Array.from({ length: parallel }, async () => {
    while (warteschlange.length) {
      const t = warteschlange.shift();
      // Sperrt Yahoo erkennbar pauschal, gar nicht weiter versuchen — spart Minuten.
      if (yahooFehler >= 15 && ergebnis.size === 0) {
        ergebnis.set(t.symbol, { ...t, fehler: ['Yahoo: uebersprungen (gesperrt)'] });
        continue;
      }
      try {
        ergebnis.set(t.symbol, { ...t, kurse: await yahoo(t), quelle: 'Yahoo' });
      } catch (e) {
        yahooFehler++;
        ergebnis.set(t.symbol, { ...t, fehler: [`Yahoo: ${e.message}`] });
      }
      await warte(150);
    }
  });
  await Promise.all(arbeiter);
  const okYahoo = [...ergebnis.values()].filter((d) => d.kurse).length;
  log(`Yahoo: ${okYahoo} von ${universum.length} Titeln geladen.`);

  const offen = [...ergebnis.values()].filter((d) => !d.kurse);
  if (offen.length && td) {
    log(`Twelve Data uebernimmt ${offen.length} Titel (Minutenlimit — das dauert etwa ${Math.ceil(offen.length / 8)} Minuten).`);
    for (const d of offen) {
      try {
        d.kurse = await td(d);
        d.quelle = 'Twelve Data';
      } catch (e) {
        d.fehler.push(`Twelve Data: ${e.message}`);
      }
    }
  } else if (offen.length) {
    log(`${offen.length} Titel fehlen. Mit TWELVEDATA_API_KEY springt eine Zweitquelle ein.`);
  }
  return universum.map((t) => ergebnis.get(t.symbol));
}

module.exports = { ladeAlle, yahooZuKursen, twelveZuKursen, minutenBremse };
