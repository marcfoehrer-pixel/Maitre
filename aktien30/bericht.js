'use strict';

/**
 * Erzeugt eine eigenstaendige HTML-Seite: Daten eingebettet, keine externen
 * Skripte — laeuft auf GitHub Pages, lokal und offline gleichermassen.
 */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function seite({ ranking, basis, faelle, rueckblick, fehlend, erstellt }) {
  const daten = JSON.stringify({ ranking, basis, faelle, rueckblick, fehlend, erstellt })
    .replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Aktien-Ranking 30 Tage</title>
<meta name="description" content="Ranking aller DAX-, Nasdaq-100- und Dow-Jones-Werte nach gemessener Wahrscheinlichkeit für 30 Tage ohne mehr als 5 % Rückgang bei gleichzeitigem Anstieg.">
<link rel="icon" href="data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#2a78d6"/><rect x="7" y="18" width="4" height="7" rx="1" fill="#fff"/><rect x="14" y="12" width="4" height="13" rx="1" fill="#fff"/><rect x="21" y="7" width="4" height="18" rx="1" fill="#fff"/></svg>')}">
<style>
:root {
  color-scheme: light;
  --surface: #fcfcfb;
  --surface-2: #f3f2ee;
  --text: #0b0b0b;
  --text-2: #52514e;
  --muted: #6f6d68;
  --grid: #e1e0d9;
  --ring: rgba(11,11,11,0.10);
  --bar: #2a78d6;
  --bar-weak: #a9c6ec;
  --accent-ink: #1d5fae;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --surface: #1a1a19; --surface-2: #232322; --text: #ffffff; --text-2: #c3c2b7;
    --muted: #a3a198; --grid: #2c2c2a; --ring: rgba(255,255,255,0.10);
    --bar: #3987e5; --bar-weak: #2b4a72; --accent-ink: #8db8f0;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --surface: #1a1a19; --surface-2: #232322; --text: #ffffff; --text-2: #c3c2b7;
  --muted: #a3a198; --grid: #2c2c2a; --ring: rgba(255,255,255,0.10);
  --bar: #3987e5; --bar-weak: #2b4a72; --accent-ink: #8db8f0;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
  margin: 0; background: var(--surface); color: var(--text);
  font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-variant-numeric: tabular-nums;
}
main { max-width: 960px; margin: 0 auto; padding: max(20px, env(safe-area-inset-top)) 16px 48px; }
h1 { font-size: 24px; line-height: 1.2; margin: 0 0 4px; letter-spacing: -0.01em; }
.unter { color: var(--text-2); margin: 0 0 20px; }
.frage { background: var(--surface-2); border-radius: 12px; padding: 12px 14px; margin-bottom: 20px; color: var(--text-2); }
.frage b { color: var(--text); }
.kacheln { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-bottom: 20px; }
.kachel { border: 1px solid var(--ring); border-radius: 12px; padding: 10px 12px; min-width: 0; }
.kachel .zahl { font-size: 22px; font-weight: 650; }
.kachel .text { color: var(--text-2); font-size: 13px; }
.filter { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--ring); background: transparent; color: var(--text); border-radius: 999px;
  padding: 7px 12px; font: inherit; font-size: 14px; cursor: pointer; min-height: 36px;
}
.chip[aria-pressed="true"] { background: var(--text); color: var(--surface); border-color: var(--text); }
select, input[type=search] {
  font: inherit; font-size: 14px; color: var(--text); background: var(--surface);
  border: 1px solid var(--ring); border-radius: 10px; padding: 7px 10px; min-height: 36px;
}
input[type=search] { flex: 1 1 160px; min-width: 0; }
.legende { display: flex; gap: 16px; flex-wrap: wrap; color: var(--text-2); font-size: 13px; margin: 4px 0 8px; }
.legende span { display: inline-flex; align-items: center; gap: 6px; }
.sw { width: 14px; height: 10px; border-radius: 0 3px 3px 0; background: var(--bar); display: inline-block; }
.sw.schwach { background: var(--bar-weak); }
.ref { width: 0; height: 14px; border-left: 2px dashed var(--text-2); display: inline-block; }
.liste { list-style: none; margin: 0; padding: 0; }
.zeile { border-top: 1px solid var(--grid); }
.zeile > button {
  all: unset; box-sizing: border-box; display: grid; width: 100%; cursor: pointer;
  grid-template-columns: 30px minmax(0, 190px) minmax(0, 1fr); gap: 10px; align-items: center;
  padding: 8px 4px; min-height: 44px;
}
.zeile > button:hover, .zeile > button:focus-visible { background: var(--surface-2); }
.zeile > button:focus-visible { outline: 2px solid var(--bar); outline-offset: -2px; }
.rang { color: var(--muted); font-size: 13px; text-align: right; }
.titel { min-width: 0; }
.titel .n { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.titel .s { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.spur { position: relative; height: 22px; }
.balken { position: absolute; left: 0; top: 2px; height: 18px; border-radius: 0 4px 4px 0; background: var(--bar); }
.balken.schwach { background: var(--bar-weak); }
.wert { position: absolute; top: 0; line-height: 22px; font-size: 13px; font-weight: 600; padding-left: 6px; white-space: nowrap; }
.basislinie { position: absolute; top: -2px; bottom: -2px; border-left: 2px dashed var(--text-2); opacity: .55; }
.details { display: none; padding: 4px 4px 14px 44px; }
.zeile.offen .details { display: block; }
.raster { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px 16px; }
.raster div { min-width: 0; }
.raster dt { color: var(--muted); font-size: 12px; }
.raster dd { margin: 0; font-weight: 600; }
.teile { display: flex; gap: 2px; height: 8px; margin-top: 4px; border-radius: 4px; overflow: hidden; background: var(--grid); }
.teile i { display: block; background: var(--bar); }
.hinweis { color: var(--text-2); font-size: 13px; margin-top: 28px; }
.hinweis h2 { font-size: 16px; color: var(--text); margin: 24px 0 6px; }
.hinweis ul { padding-left: 18px; }
.leer { padding: 24px 0; color: var(--text-2); }
@media (max-width: 600px) {
  .kacheln { grid-template-columns: 1fr; }
  .zeile > button { grid-template-columns: 24px minmax(0, 1fr); row-gap: 4px; }
  .spur { grid-column: 2; }
  .details { padding-left: 34px; }
}
</style>
</head>
<body>
<main>
  <h1>Aktien-Ranking · 30 Tage</h1>
  <p class="unter" id="stand"></p>
  <p class="frage">Je Aktie: <b>Wie wahrscheinlich ist es, dass sie in den nächsten 30 Tagen nie mehr als 5&nbsp;% unter den heutigen Kurs fällt <i>und</i> am Ende höher steht?</b> Gemessen an der eigenen Vergangenheit aller Titel bei ähnlicher Charttechnik und Schwankung.</p>
  <div class="kacheln" id="kacheln"></div>
  <div class="filter">
    <div class="chips" role="group" aria-label="Index">
      <button class="chip" data-index="alle" aria-pressed="true">Alle</button>
      <button class="chip" data-index="DAX" aria-pressed="false">DAX</button>
      <button class="chip" data-index="Nasdaq-100" aria-pressed="false">Nasdaq-100</button>
      <button class="chip" data-index="Dow Jones" aria-pressed="false">Dow Jones</button>
    </div>
    <select id="sort" aria-label="Sortieren nach">
      <option value="beides">Gesamt: sicher und steigend</option>
      <option value="sicher">Nur: nicht mehr als 5 % Rückgang</option>
      <option value="steigt">Nur: höher in 30 Tagen</option>
    </select>
    <input type="search" id="suche" placeholder="Titel suchen" aria-label="Titel suchen">
  </div>
  <div class="legende" id="legende"></div>
  <ol class="liste" id="liste"></ol>
  <div class="hinweis" id="hinweis"></div>
</main>
<script>
const D = ${daten};
const pct = (x, d = 0) => (x * 100).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d }) + '\\u00a0%';
const vz = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '\\u2212' : '') + pct(Math.abs(x), d);
const geld = (x, w) => x.toLocaleString('de-DE', { style: 'currency', currency: w, maximumFractionDigits: x < 10 ? 2 : 2 });
const datum = (s) => new Date(s * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ZIEL = { beides: 'Sicher und steigend', sicher: 'Kein Rückgang über 5 %', steigt: 'Höher nach 30 Tagen' };

const zustand = { index: 'alle', sort: 'beides', suche: '' };
try { const s = JSON.parse(localStorage.getItem('aktien30') || '{}'); Object.assign(zustand, { index: s.index || 'alle', sort: s.sort || 'beides' }); } catch (e) {}
const merken = () => { try { localStorage.setItem('aktien30', JSON.stringify({ index: zustand.index, sort: zustand.sort })); } catch (e) {} };

document.getElementById('stand').textContent =
  'Stand: ' + new Date(D.erstellt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) +
  ' · ' + D.ranking.length + ' Titel · ' + D.faelle.toLocaleString('de-DE') + ' historische Vergleichsfälle';

function kacheln() {
  const r = D.rueckblick;
  const k = [
    [pct(D.basis.beides), 'Durchschnitt aller Titel und Tage (Basisquote, gestrichelte Linie)'],
    [D.ranking[0] ? pct(D.ranking[0].p.beides) : '–', 'Spitzenwert heute' + (D.ranking[0] ? ': ' + D.ranking[0].name : '')],
    r ? [pct(r.trefferTop20), 'Trefferquote der oberen 20 % im letzten Jahr (alle: ' + pct(r.trefferAlle) + ')']
      : ['–', 'Rückblick: zu wenig Historie'],
  ];
  document.getElementById('kacheln').innerHTML = k.map(([z, t]) =>
    '<div class="kachel"><div class="zahl">' + esc(z) + '</div><div class="text">' + esc(t) + '</div></div>').join('');
}

function zeichnen() {
  for (const b of document.querySelectorAll('.chip')) b.setAttribute('aria-pressed', String(b.dataset.index === zustand.index));
  document.getElementById('sort').value = zustand.sort;
  const z = zustand.sort;
  const q = zustand.suche.trim().toLowerCase();
  const liste = D.ranking
    .filter((t) => zustand.index === 'alle' || t.indizes.includes(zustand.index))
    .filter((t) => !q || t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q))
    .sort((a, b) => b.p[z] - a.p[z]);
  const basis = D.basis[z];
  // Achse bis zum naechsten vollen Zehner ueber dem Hoechstwert: Unterschiede bleiben sichtbar,
  // ohne die Laengen zu verzerren (Balken beginnen immer bei 0 %).
  const max = Math.min(1, Math.ceil(Math.max(basis, ...liste.map((t) => t.p[z]), 0.1) * 10) / 10);
  document.getElementById('legende').innerHTML =
    '<span><i class="sw"></i>' + esc(ZIEL[z]) + ' – über Durchschnitt</span>' +
    '<span><i class="sw schwach"></i>unter Durchschnitt</span>' +
    '<span><i class="ref"></i>Durchschnitt ' + esc(pct(basis)) + '</span>' +
    '<span>Achse 0–' + esc(pct(max)) + '</span>';
  const ol = document.getElementById('liste');
  if (!liste.length) { ol.innerHTML = '<li class="leer">Kein Titel passt zu Filter und Suche.</li>'; return; }
  ol.innerHTML = liste.map((t, i) => {
    const w = t.p[z] / max * 100;
    const innen = w > 82;
    return '<li class="zeile" data-symbol="' + esc(t.symbol) + '">' +
      '<button aria-expanded="false" aria-label="' + esc(t.name + ': ' + pct(t.p[z])) + '">' +
        '<span class="rang">' + (i + 1) + '</span>' +
        '<span class="titel"><span class="n">' + esc(t.name) + '</span><span class="s">' + esc(t.symbol + ' · ' + t.indizes.join(', ')) + '</span></span>' +
        '<span class="spur">' +
          '<span class="balken' + (t.p[z] < basis ? ' schwach' : '') + '" style="width:' + w.toFixed(2) + '%"></span>' +
          '<span class="basislinie" style="left:' + (basis / max * 100).toFixed(2) + '%"></span>' +
          '<span class="wert" style="' + (innen ? 'right:' + (100 - w).toFixed(2) + '%;padding-right:6px;color:' + (t.p[z] < basis ? 'var(--text)' : '#fff') : 'left:' + w.toFixed(2) + '%') + '">' + esc(pct(t.p[z])) + '</span>' +
        '</span>' +
      '</button>' +
      '<div class="details">' + details(t) + '</div>' +
    '</li>';
  }).join('');
}

function details(t) {
  const feld = (k, v) => '<div><dt>' + esc(k) + '</dt><dd>' + v + '</dd></div>';
  const teile = t.teile;
  const balken = [['trend', 35], ['momentum', 25], ['rsi', 20], ['hoch', 20]]
    .map(([k]) => '<i style="width:' + teile[k] + '%" title="' + k + ' ' + teile[k] + '"></i>').join('');
  return '<dl class="raster">' +
    feld('Kurs (' + datum(t.stand) + ')', esc(geld(t.kurs, t.waehrung))) +
    feld('Vortag / 1 Monat', esc(vz(t.tag) + ' / ' + vz(t.monat))) +
    feld('Sicher und steigend', esc(pct(t.p.beides, 1))) +
    feld('Kein Rückgang über 5 %', esc(pct(t.p.sicher, 1))) +
    feld('Höher nach 30 Tagen', esc(pct(t.p.steigt, 1))) +
    feld('Charttechnik-Score', esc(t.score + ' / 100') + '<div class="teile">' + balken + '</div>') +
    feld('Trend · Momentum · RSI · Hoch', esc(teile.trend + '/35 · ' + teile.momentum + '/25 · ' + teile.rsi + '/20 · ' + teile.hoch + '/20')) +
    feld('RSI (14)', esc(t.rsi.toLocaleString('de-DE', { maximumFractionDigits: 0 }))) +
    feld('Schwankung p. a.', esc(pct(t.vol))) +
    feld('Abstand GD 50 / GD 200', esc(vz(t.zuSma50) + ' / ' + vz(t.zuSma200))) +
    feld('Abstand 52-Wochen-Hoch', esc(vz(t.zumHoch))) +
    feld('Vergleichsfälle · Quelle', esc(t.vergleichsfaelle.toLocaleString('de-DE') + ' · ' + t.quelle)) +
  '</dl>';
}

function hinweis() {
  const r = D.rueckblick;
  let h = '<h2>So entsteht die Zahl</h2><ul>' +
    '<li><b>Charttechnik-Score (0–100)</b> aus vier Bausteinen: Trend (Kurs über GD 50, GD 50 über GD 200, GD 50 steigend), Momentum (3-Monats-Rendite, MACD), RSI (gesunder Bereich 45–65) und Nähe zum 52-Wochen-Hoch.</li>' +
    '<li><b>Messung statt Annahme:</b> Für jeden Titel wurde an jedem dritten Handelstag der letzten Jahre derselbe Score berechnet und nachgesehen, was in den folgenden 21 Handelstagen (≈ 30 Kalendertage) tatsächlich geschah. Die Prozentzahl ist die Trefferquote der Fälle mit ähnlichem Score und ähnlicher Schwankung – leicht angepasst an das Eigenverhalten des Titels.</li>' +
    '<li><b>„Sicher“</b> heißt: das Tagestief fällt im gesamten Zeitraum nie mehr als 5 % unter den heutigen Schlusskurs. <b>„Steigend“</b> heißt: nach 21 Handelstagen höher als heute.</li>';
  if (r) h += '<li><b>Gegenprobe ohne Rückschaufehler:</b> Mit Daten bis vor einem Jahr gebaut und am letzten Jahr gemessen, trafen die oberen 20 % der Bewertungen in ' + pct(r.trefferTop20) + ' der Fälle (vorhergesagt: ' + pct(r.erwartetTop20) + '), der Durchschnitt aller Fälle in ' + pct(r.trefferAlle) + '. ' + r.faelle.toLocaleString('de-DE') + ' Fälle.</li>';
  h += '</ul><p>Charttechnik beschreibt Wahrscheinlichkeiten aus der Vergangenheit, keine Gewissheit. Nachrichten, Quartalszahlen und Marktschocks erfasst sie nicht. Keine Anlageberatung.</p>';
  if (D.fehlend.length) h += '<p>Nicht bewertet (keine oder zu kurze Kurshistorie): ' + D.fehlend.map((f) => esc(f.symbol) + (f.grund ? ' (' + esc(f.grund) + ')' : '')).join(', ') + '.</p>';
  document.getElementById('hinweis').innerHTML = h;
}

document.querySelector('.chips').addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  zustand.index = b.dataset.index; merken(); zeichnen();
});
document.getElementById('sort').addEventListener('change', (e) => { zustand.sort = e.target.value; merken(); zeichnen(); });
document.getElementById('suche').addEventListener('input', (e) => { zustand.suche = e.target.value; zeichnen(); });
document.getElementById('liste').addEventListener('click', (e) => {
  const b = e.target.closest('.zeile > button'); if (!b) return;
  const li = b.parentElement; const offen = li.classList.toggle('offen');
  b.setAttribute('aria-expanded', String(offen));
});
kacheln(); zeichnen(); hinweis();
</script>
</body>
</html>
`;
}

module.exports = { seite, esc };
