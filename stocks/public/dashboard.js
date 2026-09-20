'use strict';

/**
 * Oberflaeche: Live-Verbindung, Zustand, Darstellung.
 *
 * Der Browser rechnet bewusst nichts nach. Alles, was eine Zahl ist, kommt
 * fertig vom Server — hier wird nur gefiltert, sortiert und gezeichnet. So
 * gibt es keine zweite, abweichende Wahrheit in der Anzeige.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    snapshot: null,
    horizon: 3,
    threshold: 0.8,
    market: 'alle',
    sort: { key: 'probability', dir: 'desc' },
    connection: 'verbinde',
    source: null,
    countdownTimer: null,
  };

  // ---------- Formatierung -------------------------------------------------

  const nf = (digits) =>
    new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const num = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf(digits).format(v));
  const pct = (v, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : `${nf(digits).format(v)} %`);
  const signed = (v, digits = 2) =>
    v === null || v === undefined || Number.isNaN(v) ? '–' : `${v > 0 ? '+' : ''}${nf(digits).format(v)} %`;
  const clock = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Richtung nie nur ueber Farbe: Pfeil und Vorzeichen tragen die Aussage. */
  function deltaMarkup(value) {
    if (value === null || value === undefined) return '<span class="delta flat">–</span>';
    const cls = value > 0.02 ? 'up' : value < -0.02 ? 'down' : 'flat';
    const arrow = value > 0.02 ? '▲' : value < -0.02 ? '▼' : '■';
    return `<span class="delta ${cls}">${arrow} ${esc(signed(value))}</span>`;
  }

  // ---------- Live-Verbindung ---------------------------------------------

  function setConnection(stateName, text) {
    state.connection = stateName;
    $('live').dataset.state = stateName;
    $('liveText').textContent = text;
  }

  function connect() {
    if (state.source) state.source.close();
    setConnection('busy', 'verbinde …');
    const source = new EventSource(`/api/stream?horizon=${state.horizon}`);
    state.source = source;

    source.addEventListener('snapshot', (event) => {
      state.snapshot = JSON.parse(event.data);
      setConnection('live', 'live');
      render();
    });

    source.addEventListener('status', (event) => {
      const status = JSON.parse(event.data);
      if (status.state === 'laeuft') setConnection('busy', 'aktualisiert …');
      else if (status.state === 'fehler') setConnection('error', `Fehler: ${status.message}`);
      else if (state.snapshot) setConnection('live', 'live');
    });

    // EventSource baut von selbst wieder auf — hier nur die Anzeige ehrlich halten.
    source.onerror = () => setConnection('error', 'Verbindung unterbrochen – neuer Versuch …');
  }

  // ---------- Darstellung ---------------------------------------------------

  function visibleItems() {
    if (!state.snapshot) return [];
    const all = state.snapshot.ranking;
    const filtered = state.market === 'alle' ? all : all.filter((i) => i.market === state.market);
    return filtered.slice(0, state.snapshot.config.topN);
  }

  function renderClocks() {
    const snap = state.snapshot;
    const box = $('clocks');
    if (!snap || !snap.venues) {
      box.textContent = '';
      return;
    }
    const names = { DE: 'Xetra', US: 'NYSE' };
    box.innerHTML = Object.entries(snap.venues)
      .map(([market, v]) => {
        const time = new Date().toLocaleTimeString('de-DE', {
          timeZone: v.timezone, hour: '2-digit', minute: '2-digit',
        });
        const mark = v.open ? '●' : '○';
        return `<span class="clock"><b>${esc(names[market] || market)}</b> ${esc(time)} ${mark} ${esc(v.open ? 'offen' : v.phase)}</span>`;
      })
      .join('');
  }

  function renderNotices() {
    const snap = state.snapshot;
    const box = $('notices');
    if (!snap) return;
    const notices = [];

    if (snap.demoData) {
      notices.push({
        level: 'critical',
        icon: '⚠',
        html:
          '<strong>Demo-Daten, keine echten Kurse.</strong> Der Server läuft im Offline-Modus oder ' +
          'erreicht die Portale nicht. Die Zahlen zeigen, dass die Pipeline arbeitet — ' +
          'handeln lässt sich danach nicht. Ohne <code>--offline</code> starten und die ' +
          'Netzverbindung zu den Portalen prüfen.',
      });
    }

    const items = visibleItems();
    const best = items[0];
    const metCount = state.market === 'alle'
      ? snap.thresholdCount
      : (snap.thresholdCountByMarket || {})[state.market] || 0;

    if (best && metCount === 0) {
      notices.push({
        level: 'info',
        icon: 'ℹ',
        html:
          `<strong>Kein Titel erreicht derzeit ${Math.round(state.threshold * 100)} %.</strong> ` +
          `Der stärkste Kandidat steht bei ${esc(pct(best.probability * 100))}. ` +
          'Das ist der Normalfall und kein Fehler: über wenige Stunden ist Kursbewegung ' +
          'weit überwiegend Rauschen. Gemessene Trefferquoten oberhalb von etwa 60 % ' +
          'treten fast nur bei zu kleinen Stichproben auf — deshalb wird hier geschrumpft ' +
          'statt aufgerundet. Die Rangliste bleibt trotzdem nützlich: sie ordnet die Lage, ' +
          'auch wenn niemand die Wunschmarke reißt.',
      });
    }

    const closed = Object.entries(snap.venues || {}).filter(([, v]) => !v.open);
    if (closed.length > 0) {
      notices.push({
        level: 'warning',
        icon: '◷',
        html:
          `<strong>${closed.map(([m, v]) => `${m === 'DE' ? 'Xetra' : 'NYSE/Nasdaq'} ${v.phase}`).join(', ')}.</strong> ` +
          'Außerhalb der Handelszeit findet die prognostizierte Bewegung nicht statt. ' +
          'Alle Werte sind deshalb stark zur Mitte gedämpft und dienen nur der Vorbereitung.',
      });
    }

    if (snap.skipped && snap.skipped.length > 0) {
      notices.push({
        level: 'warning',
        icon: '⚠',
        html:
          `<strong>${snap.skipped.length} Titel übersprungen.</strong> ` +
          esc(snap.skipped.slice(0, 5).map((s) => `${s.symbol} (${s.reason})`).join(', ')),
      });
    }

    box.hidden = notices.length === 0;
    box.innerHTML = notices
      .map(
        (n) =>
          `<div class="notice" data-level="${n.level}"><span class="notice-icon" aria-hidden="true">${n.icon}</span><div>${n.html}</div></div>`
      )
      .join('');
  }

  function driverChip(d) {
    // Gleiche Zeichen wie bei der Kursveraenderung, damit Richtung ueberall
    // identisch gelesen wird — und nie nur ueber Farbe.
    const arrow = d.value > 0.05 ? '▲' : d.value < -0.05 ? '▼' : '■';
    const cls = d.value > 0.05 ? 'up' : d.value < -0.05 ? 'down' : 'flat';
    return `<span class="driver"><span class="sign ${cls}">${arrow}</span>${esc(d.label)}</span>`;
  }

  function cardMarkup(item, displayRank) {
    const marketChip = item.market === 'DE'
      ? '<span class="chip chip-de">Deutschland</span>'
      : '<span class="chip chip-us">USA</span>';
    const flags = [
      item.session.open ? '' : `<span class="chip chip-warn">${esc(item.session.phase)}</span>`,
      item.stale ? '<span class="chip chip-warn">Daten veraltet</span>' : '',
      item.demo ? '<span class="chip chip-demo">Demo</span>' : '',
      item.meetsThreshold ? '<span class="chip" style="border-color:var(--good);color:var(--good-ink)">Schwelle erreicht</span>' : '',
    ].join('');

    // effectPp ist die Weglassprobe des Servers: Wirkung dieser einen Korrektur
    // auf das Endergebnis, in Prozentpunkten.
    const context = (item.adjustments || [])
      .map((a) => `${esc(a.label)} ${a.effectPp >= 0 ? '+' : '−'}${esc(num(Math.abs(a.effectPp), 2))} Pp.`)
      .join(' · ');

    const headlines = item.news && item.news.items.length
      ? `<ul class="headlines">${item.news.items
          .map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">${n.score > 0 ? '▲' : n.score < 0 ? '▼' : '·'} ${esc(n.title)}</a></li>`)
          .join('')}</ul>`
      : '';

    return `
      <article class="card" data-met="${item.meetsThreshold}">
        <div class="card-head">
          <span class="rank-badge">${displayRank}</span>
          <div class="card-title">
            <h3>${esc(item.symbol)} ${marketChip}${flags}</h3>
            <p>${esc(item.name)} · ${esc(item.venue)}</p>
          </div>
          <div class="price">
            <span class="value">${esc(num(item.price, item.price >= 100 ? 2 : 3))} ${esc(item.currency || '')}</span>
            ${deltaMarkup(item.changePct)}
          </div>
        </div>

        <div>
          <div class="prob-block">
            <span class="prob-value">${esc(pct(item.probability * 100))}</span>
            <span class="prob-caption">für einen höheren Kurs in ${state.horizon} h</span>
          </div>
          <div class="meter" data-meter></div>
          <p class="prob-band">
            Glaubwürdigkeitsband ${esc(num(item.interval.low * 100, 1))}–${esc(pct(item.interval.high * 100))} ·
            ${esc(item.samples.toLocaleString('de-DE'))} vergleichbare Lagen ·
            Basisquote ${esc(pct((item.baseRate || 0) * 100))} ·
            Vorteil ${esc(signed((item.edge || 0) * 100, 1).replace(' %', ' Pp.'))}
          </p>
        </div>

        <dl class="facts">
          <div class="fact"><dt>typische Bewegung</dt><dd>${esc(signed(item.expectedMovePct, 2))}</dd></div>
          <div class="fact"><dt>Belastbarkeit</dt><dd><span class="grade" data-level="${esc(item.confidence.level)}"><span class="dot"></span>${esc(item.confidence.level)}</span></dd></div>
          <div class="fact"><dt>Signalwert</dt><dd>${esc(num(item.score, 2))}</dd></div>
          <div class="fact"><dt>RSI (14)</dt><dd>${esc(num(item.indicators.rsi, 0))}</dd></div>
          <div class="fact"><dt>Volumen</dt><dd>${item.indicators.volumeRatio ? `${esc(num(item.indicators.volumeRatio, 1))}×` : '–'}</dd></div>
          <div class="fact"><dt>Schwankung (ATR)</dt><dd>${esc(pct(item.indicators.atrPct, 2))}</dd></div>
        </dl>

        <div class="chart spark" data-spark></div>

        <div class="drivers">${(item.drivers || []).map(driverChip).join('')}</div>

        ${context ? `<p class="card-note">Kontextkorrektur: ${context}${item.damping < 1 ? ` · Dämpfung Handelszeit ×${esc(num(item.damping, 2))}` : ''}</p>` : ''}
        ${headlines}
        <p class="card-note">
          Quellen: ${esc((item.sources || []).join(', '))}${item.crossCheck && item.crossCheck.fresh ? ` · Zweitquelle ${esc(num(item.crossCheck.price, 2))} (${esc(num(item.crossCheck.deviationPct, 2))} % Abweichung)` : ''}
          · letzte Kerze ${esc(clock(item.lastCandle))} Uhr
        </p>
      </article>`;
  }

  function renderRanking() {
    const box = $('ranking');
    const items = visibleItems();
    if (items.length === 0) {
      box.innerHTML = '<div class="panel empty">Noch keine Daten — der erste Durchlauf läuft.</div>';
      return;
    }
    box.innerHTML = items.map((item, i) => cardMarkup(item, i + 1)).join('');
    const cards = box.querySelectorAll('.card');
    items.forEach((item, i) => {
      const card = cards[i];
      Charts.meter(card.querySelector('[data-meter]'), {
        value: item.probability,
        low: item.interval.low,
        high: item.interval.high,
        threshold: state.threshold,
      });
      const sparkBox = card.querySelector('[data-spark]');
      Charts.sparkline(sparkBox, item.spark, {
        currency: item.currency,
        label: `Kursverlauf ${item.symbol}`,
        height: sparkBox.clientHeight || 74,
      });
    });

    const snap = state.snapshot;
    $('rankSub').textContent =
      `Die ${items.length} stärksten Kandidaten ${state.market === 'alle' ? 'aus beiden Märkten' : state.market === 'DE' ? 'aus Deutschland' : 'aus den USA'} ` +
      `für die kommenden ${snap.config.horizonHours} Stunden (${snap.config.horizonBars} Balken à ${snap.config.interval}).`;
  }

  function renderCalibration() {
    const snap = state.snapshot;
    if (!snap) return;
    Charts.calibration($('calChart'), snap.calibration.buckets, { baseRate: snap.calibration.baseRate });
    $('calStats').innerHTML = [
      ['Beobachtungen gesamt', snap.calibration.pooledSamples.toLocaleString('de-DE')],
      ['Basisquote', pct((snap.calibration.baseRate || 0) * 100)],
      ['mittlere Bewegung', signed(snap.calibration.meanRetPct, 2)],
      ['Prognosehorizont', `${snap.config.horizonBars} Balken`],
      ['Reibung abgezogen', pct(snap.config.friction * 100, 3)],
    ]
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('');
    $('calSub').textContent =
      `Grundlage jeder Prozentzahl: ${snap.calibration.pooledSamples.toLocaleString('de-DE')} ausgewertete ` +
      'Vergangenheitslagen des gesamten Universums. Blasse Balken haben zu wenige Beobachtungen, ' +
      'um für sich allein belastbar zu sein.';
  }

  function renderSources() {
    const snap = state.snapshot;
    const labels = { ok: 'erreichbar', degraded: 'teilweise gestört', down: 'nicht erreichbar' };
    $('sources').innerHTML = (snap.sources || [])
      .map(
        (s) =>
          `<li class="source" data-status="${esc(s.status)}"><span class="dot"></span>` +
          `<span class="name">${esc(s.name)}</span>` +
          `<span class="detail">${esc(labels[s.status])}${s.count ? ` · ${s.count} Abrufe` : ''}${s.detail ? ` · ${esc(s.detail)}` : ''}</span></li>`
      )
      .join('');
  }

  const SORTERS = {
    symbol: (a, b) => a.symbol.localeCompare(b.symbol),
    market: (a, b) => a.market.localeCompare(b.market),
    confidence: (a, b) => (a.confidence.points || 0) - (b.confidence.points || 0),
  };

  function renderWatchlist() {
    const snap = state.snapshot;
    let rows = snap.watchlist.slice();
    if (state.market !== 'alle') rows = rows.filter((r) => r.market === state.market);

    const { key, dir } = state.sort;
    const sorter = SORTERS[key] || ((a, b) => (a[key] ?? -Infinity) - (b[key] ?? -Infinity));
    rows.sort((a, b) => (dir === 'asc' ? sorter(a, b) : -sorter(a, b)));

    $('watchlistBody').innerHTML = rows
      .map((r) => {
        const met = r.probability >= state.threshold;
        return `<tr>
          <td class="num">${r.rank}</td>
          <td><span class="sym">${esc(r.symbol)}</span> <span class="name">${esc(r.name)}</span>${met ? ' <span class="chip" style="border-color:var(--good);color:var(--good-ink)">✓</span>' : ''}${r.demo ? ' <span class="chip chip-demo">Demo</span>' : ''}</td>
          <td>${r.market === 'DE' ? 'Deutschland' : 'USA'}</td>
          <td class="num">${esc(num(r.price, 2))} ${esc(r.currency || '')}</td>
          <td class="num">${deltaMarkup(r.changePct)}</td>
          <td class="num"><span class="bar-cell"><span class="bar-track"><span class="bar-fill" style="width:${Math.max(2, Math.round(r.probability * 100))}%"></span></span>${esc(pct(r.probability * 100))}</span></td>
          <td class="num">${esc(num(r.score, 2))}</td>
          <td class="num">${esc(num(r.rsi, 0))}</td>
          <td class="num">${r.volumeRatio ? `${esc(num(r.volumeRatio, 1))}×` : '–'}</td>
          <td class="num">${r.samples.toLocaleString('de-DE')}</td>
          <td><span class="grade" data-level="${esc(r.confidence.level)}"><span class="dot"></span>${esc(r.confidence.level)}</span></td>
        </tr>`;
      })
      .join('');

    document.querySelectorAll('#watchlist th').forEach((th) => {
      if (th.dataset.sort === key) th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  function renderMeta() {
    const snap = state.snapshot;
    $('updatedAt').textContent = `${clock(snap.generatedAt)} Uhr`;
    $('colophon').textContent =
      `Durchlauf ${snap.cycleMs} ms · ${snap.watchlist.length} Titel · Raster ${snap.config.interval} · ` +
      `Historie ${snap.config.range} · Aktualisierung alle ${snap.refreshSeconds || 60} s · ` +
      `Schwelle serverseitig ${Math.round(snap.config.threshold * 100)} %, Anzeige ${Math.round(state.threshold * 100)} %.`;

    if (state.countdownTimer) clearInterval(state.countdownTimer);
    const tick = () => {
      if (!snap.nextRefreshAt) {
        $('countdown').textContent = '–';
        return;
      }
      const left = Math.max(0, Math.round((snap.nextRefreshAt - Date.now()) / 1000));
      $('countdown').textContent = left === 0 ? 'jetzt …' : `in ${left} s`;
    };
    tick();
    state.countdownTimer = setInterval(tick, 1000);
  }

  function render() {
    if (!state.snapshot) return;
    renderClocks();
    renderNotices();
    renderRanking();
    renderCalibration();
    renderSources();
    renderWatchlist();
    renderMeta();
  }

  // ---------- Bedienung ------------------------------------------------------

  function setupSegmented(id, onChange) {
    const group = $(id);
    group.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b === button)));
      onChange(button.dataset.value);
    });
  }

  setupSegmented('horizon', (value) => {
    state.horizon = Number(value);
    state.snapshot = null;
    $('ranking').innerHTML = '<div class="panel empty">Horizont wird neu gerechnet …</div>';
    connect();
  });

  setupSegmented('markets', (value) => {
    state.market = value;
    render();
  });

  $('threshold').addEventListener('input', (event) => {
    state.threshold = Number(event.target.value) / 100;
    $('thresholdOut').textContent = `${event.target.value} %`;
    if (state.snapshot) render();
  });

  $('refreshBtn').addEventListener('click', async () => {
    setConnection('busy', 'aktualisiert …');
    await fetch('/api/refresh', { method: 'POST' }).catch(() => {});
  });

  $('themeBtn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : current === 'light' ? '' : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try {
      if (next) localStorage.setItem('theme', next);
      else localStorage.removeItem('theme');
    } catch { /* privater Modus: Einstellung gilt dann nur fuer diese Sitzung */ }
    if (state.snapshot) render();
  });

  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch { /* ohne gespeicherte Einstellung gilt die des Systems */ }

  $('watchlist').addEventListener('click', (event) => {
    const th = event.target.closest('th');
    if (!th || !th.dataset.sort) return;
    const key = th.dataset.sort;
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'symbol' || key === 'market' ? 'asc' : 'desc' };
    renderWatchlist();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.snapshot) {
        renderRanking();
        renderCalibration();
      }
    }, 180);
  });

  $('ranking').innerHTML = '<div class="panel empty">Erster Durchlauf läuft — die Portale werden abgefragt …</div>';
  connect();
})();
