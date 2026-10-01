#!/usr/bin/env node
'use strict';

/**
 * Aktien-Ranking fuer 30 Tage.
 *
 *   node aktien30/ranking.js                 # alle Titel laden, Bericht schreiben
 *   node aktien30/ranking.js --aus <ordner>  # Zielordner (Standard: aktien30/ausgabe)
 *
 * Schreibt <ordner>/index.html (das Ranking) und <ordner>/daten.json.
 */

const fs = require('fs');
const path = require('path');
const { UNIVERSUM } = require('./universum');
const { ladeAlle } = require('./quellen');
const { bewerten, MIN_HISTORIE } = require('./analyse');
const { seite } = require('./bericht');

async function main() {
  const arg = process.argv.indexOf('--aus');
  const ordner = path.resolve(arg > 0 ? process.argv[arg + 1] : path.join(__dirname, 'ausgabe'));
  const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

  log(`Lade Tageskurse fuer ${UNIVERSUM.length} Titel …`);
  const daten = await ladeAlle(UNIVERSUM, { log });
  const mitKursen = daten.filter((d) => d.kurse && d.kurse.length);
  if (mitKursen.length < 20) {
    for (const d of daten.filter((x) => !x.kurse).slice(0, 10)) log(`  ${d.symbol}: ${d.fehler.join(' | ')}`);
    throw new Error(`Nur ${mitKursen.length} Titel geladen — fuer eine belastbare Messung zu wenig. Ist die Kursquelle erreichbar?`);
  }

  log('Berechne Charttechnik und historische Trefferquoten …');
  const ergebnis = bewerten(mitKursen);
  const fehlend = [
    ...daten.filter((d) => !d.kurse || !d.kurse.length).map((d) => ({ symbol: d.symbol, grund: 'keine Kurse' })),
    ...daten.filter((d) => d.kurse && d.kurse.length && d.kurse.length < MIN_HISTORIE + 5).map((d) => ({ symbol: d.symbol, grund: 'Historie unter einem Jahr' })),
  ];

  fs.mkdirSync(ordner, { recursive: true });
  const bericht = { ...ergebnis, fehlend, erstellt: new Date().toISOString() };
  fs.writeFileSync(path.join(ordner, 'index.html'), seite(bericht));
  fs.writeFileSync(path.join(ordner, 'daten.json'), JSON.stringify(bericht, null, 1));

  log(`Fertig: ${ergebnis.ranking.length} Titel bewertet, ${fehlend.length} ohne Bewertung.`);
  log(`Basisquote sicher+steigend: ${(ergebnis.basis.beides * 100).toFixed(1)} %`);
  for (const [i, t] of ergebnis.ranking.slice(0, 10).entries()) {
    log(`  ${String(i + 1).padStart(2)}. ${t.name.padEnd(28)} ${(t.p.beides * 100).toFixed(1).padStart(5)} %   (Score ${t.score})`);
  }
  log(`Bericht: ${path.join(ordner, 'index.html')}`);
}

main().catch((e) => {
  console.error(`Abbruch: ${e.message}`);
  process.exit(1);
});
