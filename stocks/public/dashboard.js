'use strict';

/**
 * Oberflaeche: Live-Verbindung, Zustand, Darstellung — fuer den Finger gebaut.
 *
 * Der Browser rechnet bewusst nichts nach. Alles, was eine Zahl ist, kommt
 * fertig vom Server; hier wird nur gefiltert, sortiert und gezeichnet. So gibt
 * es keine zweite, abweichende Wahrheit in der Anzeige.
 *
 * Telefonspezifisch sind drei Dinge: die Liste wird am schmalen Bildschirm als
 * Zeilen statt als Tabelle gezeichnet, die Verbindung wird beim Zurueckkehren
 * in die App neu aufgebaut, und Ziehen von oben loest eine Aktualisierung aus.
 */

(() => {
  const $ = (id) => document.getElementById(id);
  const wide = window.matchMedia('(min-width: 760px)');

  const state = {
    snapshot: null,
    horizon: 3,
    threshold: 0.8,
    market: 'alle',
    sort: { key: 'probability', dir: 'desc' },
    source: null,
    countdownTimer: null,
    refreshing: false,
  };

  // ---------- Formatierung -------------------------------------------------

  const nf = (digits) =>
    new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });

  const num = (v, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? '–' : nf(digits).format(v));
  const pct = (v, digits = 1) => (v === null || v === undefined || Number.isNaN(v) ? '–' : `${nf(digits).format(v)} %`);
  const signed = (v, digits = 2) =>
    v === null || v === undefined || Number.isNaN(v) ? '–' : `${v > 0 ? '+' : ''}${nf(digits).format(v)} %`;
  const clock = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Richtung nie nur ueber Farbe: Pfeil und Vorzeichen tragen die Aussage. */
  function deltaMarkup(value, extraClass = 'delta') {
    if (value === null || value === undefined) return `<span class="${extraClass} flat">–</span>`;
    const cls = value > 0.02 ? 'up' : value < -0.02 ? 'down' : 'flat';
    const arrow = value > 0.02 ? '▲' : value < -0.02 ? '▼' : '■';
    return `<span class="${extraClass} ${cls}">${arrow} ${esc(signed(value))}</span>`;
  }

  // ---------- Live-Verbindung ---------------------------------------------

  function setConnection(stateName, text) {
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
      // Die Verbindung steht — aber "live" neben einer leeren Rangliste waere
      // beruhigend und falsch zugleich. Die Ampel soll den Datenstand zeigen,
      // nicht nur den Zustand der Leitung.
      if (state.snapshot.noData) setConnection('error', 'keine Kursdaten');
      else setConnection('live', 'live');
      endPull();
      render();
    });

    source.addEventListener('status', (event) => {
      const status = JSON.parse(event.data);
      if (status.state === 'laeuft') setConnection('busy', 'aktualisiert …');
      else if (status.state === 'fehler') setConnection('error', `Fehler: ${status.message}`);
      else if (state.snapshot && state.snapshot.noData) setConnection('error', 'keine Kursdaten');
      else if (state.snapshot) setConnection('live', 'live');
      if (status.state !== 'laeuft') endPull();
    });

    /*
     * EventSource verraet den Fehlercode nicht. Bei einem Abbruch wird deshalb
     * kurz nachgefragt: ist die Anmeldung abgelaufen (401), hilft kein
     * Wiederverbinden — dann gehoert der Nutzer auf die Anmeldeseite, statt
     * endlos ein totes "neuer Versuch" zu sehen.
     */
    source.onerror = async () => {
      setConnection('error', 'getrennt – neuer Versuch …');
      try {
        const probe = await fetch('/api/health', { cache: 'no-store' });
        if (probe.status === 401) {
          source.close();
          window.location.href = '/login?fehler=abgelaufen';
          return;
        }
        const health = await probe.json();
        $('logoutBtn').hidden = !health.auth;
      } catch { /* Server nicht erreichbar — der Browser versucht es selbst weiter */ }
    };
  }

  /**
   * iOS schliesst stehende Verbindungen, sobald die App in den Hintergrund
   * geht. Ohne diesen Wiederaufbau zeigt das Dashboard nach dem Zurueckkehren
   * stumm veraltete Kurse an — der gefaehrlichste aller Zustaende.
   */
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (state.countdownTimer) clearInterval(state.countdownTimer);
      state.countdownTimer = null;
      return;
    }
    const closed = !state.source || state.source.readyState === EventSource.CLOSED;
    const stale = state.snapshot && Date.now() - state.snapshot.generatedAt > 90000;
    if (closed || stale) connect();
    if (state.snapshot) startCountdown();
  });

  // ---------- Ziehen zum Aktualisieren --------------------------------------

  const pull = $('pull');
  const PULL_TRIGGER = 80;
  let pullStart = null;
  let pullArmed = false;

  function endPull() {
    state.refreshing = false;
    pullArmed = false;
    pullStart = null;
    pull.dataset.visible = 'false';
    pull.dataset.armed = 'false';
    pull.dataset.loading = 'false';
  }

  document.addEventListener('touchstart', (event) => {
    if (state.refreshing || window.scrollY > 0 || event.touches.length !== 1) return;
    pullStart = event.touches[0].clientY;
  }, { passive: true });

  document.addEventListener('touchmove', (event) => {
    if (pullStart === null || state.refreshing) return;
    const distance = event.touches[0].clientY - pullStart;
    if (distance <= 0 || window.scrollY > 0) {
      pull.dataset.visible = 'false';
      return;
    }
    pull.dataset.visible = 'true';
    pullArmed = distance > PULL_TRIGGER;
    pull.dataset.armed = String(pullArmed);
    $('pullText').textContent = pullArmed ? 'loslassen zum Aktualisieren' : 'zum Aktualisieren ziehen';
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (pullStart === null) return;
    if (pullArmed) {
      triggerRefresh();
      $('pullText').textContent = 'wird aktualisiert …';
      pull.dataset.loading = 'true';
      // Falls keine Antwort kommt, nicht ewig drehen lassen.
      setTimeout(endPull, 12000);
    } else {
      endPull();
    }
    pullStart = null;
    pullArmed = false;
  }, { passive: true });

  async function triggerRefresh() {
    state.refreshing = true;
    setConnection('busy', 'aktualisiert …');
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      if (res.status === 401) {
        window.location.href = '/login?fehler=abgelaufen';
        return;
      }
      if (res.status === 429) {
        // Die Bremse schuetzt die Finanzportale — das ist kein Fehler,
        // sondern beabsichtigt, also wird es auch so benannt.
        const body = await res.json().catch(() => ({}));
        setConnection('live', `gerade aktualisiert – in ${body.retryAfter || 10} s wieder`);
        endPull();
        return;
      }
    } catch {
      setConnection('error', 'Server nicht erreichbar');
      endPull();
    }
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
    const names = { DE: 'Xetra', US: 'NYSE' };
    $('clocks').innerHTML = Object.entries(snap.venues || {})
      .map(([market, v]) => {
        const time = new Date().toLocaleTimeString('de-DE', {
          timeZone: v.timezone, hour: '2-digit', minute: '2-digit',
        });
        return `<span class="clock" data-open="${v.open}"><b>${esc(names[market] || market)}</b> ${esc(time)} ` +
          `<span class="mark" aria-hidden="true">${v.open ? '●' : '○'}</span> ${esc(v.open ? 'offen' : v.phase)}</span>`;
      })
      .join('');
  }

  function renderNotices() {
    const snap = state.snapshot;
    const box = $('notices');
    const notices = [];

    if (snap.noData) {
      const gestoert = (snap.sources || []).filter((q) => q.status !== 'ok');
      notices.push({
        level: 'critical',
        icon: '⚠',
        title: 'Keine Kursdaten abrufbar — die Rangliste bleibt leer.',
        body:
          'Das Dashboard zeigt echte Kurse oder gar keine; erfundene Zahlen gibt es nicht. ' +
          (gestoert.length
            ? `Gemeldet: ${gestoert.map((q) => `${q.name} (${q.detail || 'nicht erreichbar'})`).join(', ')}. `
            : '') +
          'Meist liegt es an der Verbindung oder daran, dass das Portal gerade drosselt — ' +
          'in der Regel erledigt sich das mit dem nächsten Durchlauf.',
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
        title: `Kein Titel erreicht ${Math.round(state.threshold * 100)} % — stärkster: ${pct(best.probability * 100)}.`,
        body:
          'Das ist der Normalfall und kein Fehler: über wenige Stunden ist Kursbewegung ' +
          'weit überwiegend Rauschen. Die Rangliste bleibt nützlich — sie ordnet die Lage, ' +
          'auch wenn niemand die Wunschmarke reißt.',
      });
    }

    const closed = Object.entries(snap.venues || {}).filter(([, v]) => !v.open);
    if (closed.length > 0) {
      notices.push({
        level: 'warning',
        icon: '◷',
        title: `${closed.map(([m, v]) => `${m === 'DE' ? 'Xetra' : 'NYSE/Nasdaq'} ${v.phase}`).join(', ')}.`,
        body:
          'Außerhalb der Handelszeit findet die prognostizierte Bewegung nicht statt. ' +
          'Alle Werte sind stark zur Mitte gedämpft.',
      });
    }

    if (snap.skipped && snap.skipped.length > 0) {
      notices.push({
        level: 'warning',
        icon: '⚠',
        title: `${snap.skipped.length} Titel übersprungen.`,
        body: esc(snap.skipped.slice(0, 6).map((s) => `${s.symbol} (${s.reason})`).join(', ')),
      });
    }

    // Am Telefon zugeklappt: die Kernaussage steht in der Zeile, die Begruendung
    // einen Tipp entfernt. Sonst stehen vor der Rangliste drei Absaetze Text.
    box.hidden = notices.length === 0;
    box.innerHTML = notices
      .map((n) =>
        `<details class="notice" data-level="${n.level}"${wide.matches ? ' open' : ''}>` +
        `<summary><span class="notice-icon" aria-hidden="true">${n.icon}</span>` +
        `<strong>${n.title}</strong></summary>` +
        `<p class="notice-body">${n.body}</p></details>`)
      .join('');
  }

  function driverChip(d) {
    const arrow = d.value > 0.05 ? '▲' : d.value < -0.05 ? '▼' : '■';
    const cls = d.value > 0.05 ? 'up' : d.value < -0.05 ? 'down' : 'flat';
    return `<span class="driver"><span class="sign ${cls}">${arrow}</span>${esc(d.label)}</span>`;
  }

  function cardMarkup(item, displayRank) {
    const marketChip = item.market === 'DE'
      ? '<span class="chip chip-de">DE</span>'
      : '<span class="chip chip-us">US</span>';
    const flags = [
      item.session.open ? '' : `<span class="chip chip-warn">${esc(item.session.phase)}</span>`,
      item.stale ? '<span class="chip chip-warn">veraltet</span>' : '',
      item.meetsThreshold ? '<span class="chip chip-good">Schwelle erreicht</span>' : '',
    ].filter(Boolean).join(' ');

    const context = (item.adjustments || [])
      .map((a) => `${esc(a.label)} ${a.effectPp >= 0 ? '+' : '−'}${esc(num(Math.abs(a.effectPp), 2))} Pp.`)
      .join(' · ');

    const headlines = item.news && item.news.items.length
      ? `<ul class="headlines">${item.news.items
          .map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">` +
            `${n.score > 0 ? '▲' : n.score < 0 ? '▼' : '·'} ${esc(n.title)}</a></li>`)
          .join('')}</ul>`
      : '';

    return `
      <article class="card" data-met="${item.meetsThreshold}">
        <div class="card-head">
          <span class="rank-badge">${displayRank}</span>
          <div class="card-title">
            <h3>${esc(item.symbol)} ${marketChip}</h3>
            <p>${esc(item.name)} · ${esc(item.venue)}${flags ? ` ${flags}` : ''}</p>
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
          <div class="chart spark" data-spark></div>
          <p class="prob-band">
            Band ${esc(num(item.interval.low * 100, 1))}–${esc(pct(item.interval.high * 100))} ·
            ${esc(item.samples.toLocaleString('de-DE'))} vergleichbare Lagen ·
            Basisquote ${esc(pct((item.baseRate || 0) * 100))} ·
            Vorteil ${esc(signed((item.edge || 0) * 100, 1).replace(' %', ' Pp.'))}
          </p>
        </div>

        <details class="card-more"${wide.matches ? ' open' : ''}>
        <summary>Kennzahlen &amp; Begründung</summary>
        <dl class="facts">
          <div class="fact"><dt>typ. Bewegung</dt><dd>${esc(signed(item.expectedMovePct, 2))}</dd></div>
          <div class="fact"><dt>Belastbarkeit</dt><dd><span class="grade" data-level="${esc(item.confidence.level)}"><span class="dot"></span>${esc(item.confidence.level)}</span></dd></div>
          <div class="fact"><dt>Signalwert</dt><dd>${esc(num(item.score, 2))}</dd></div>
          <div class="fact"><dt>RSI (14)</dt><dd>${esc(num(item.indicators.rsi, 0))}</dd></div>
          <div class="fact"><dt>Volumen</dt><dd>${item.indicators.volumeRatio ? `${esc(num(item.indicators.volumeRatio, 1))}×` : '–'}</dd></div>
          <div class="fact"><dt>ATR</dt><dd>${esc(pct(item.indicators.atrPct, 2))}</dd></div>
        </dl>

        <div class="drivers">${(item.drivers || []).map(driverChip).join('')}</div>

        ${context ? `<p class="card-note">Kontext: ${context}${item.damping < 1 ? ` · Dämpfung ×${esc(num(item.damping, 2))}` : ''}</p>` : ''}
        ${headlines}
        <p class="card-note">
          Quellen: ${esc((item.sources || []).join(', '))}${item.crossCheck && item.crossCheck.fresh ? ` · Zweitquelle ${esc(num(item.crossCheck.price, 2))} (${esc(num(item.crossCheck.deviationPct, 2))} % Abw.)` : ''}
          · letzte Kerze ${esc(clock(item.lastCandle))} Uhr
        </p>
        </details>
      </article>`;
  }

  function renderRanking() {
    const box = $('ranking');
    const items = visibleItems();
    if (items.length === 0) {
      // "Leer" hat zwei sehr verschiedene Gruende — sie zu verwechseln waere
      // der Unterschied zwischen "nichts dabei" und "nichts abrufbar".
      const grund = state.snapshot.noData
        ? '<strong>Keine Kursdaten abrufbar.</strong><br>Die Portale antworten derzeit nicht. ' +
          `Der nächste Durchlauf läuft automatisch.${(state.snapshot.skipped || []).length
            ? `<br><span class="card-note">${esc(state.snapshot.skipped.slice(0, 3)
                .map((x) => `${x.symbol}: ${x.reason}`).join(' · '))}</span>` : ''}`
        : 'Kein Titel im gewählten Markt.';
      box.innerHTML = `<div class="panel empty">${grund}</div>`;
      // Die Unterzeile darf nicht weiter fuenf Kandidaten ankuendigen,
      // die es gerade nicht gibt.
      $('rankSub').textContent = state.snapshot.noData
        ? 'Derzeit keine auswertbaren Titel.'
        : 'Kein Titel im gewählten Markt.';
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
        height: sparkBox.clientHeight || 90,
      });
    });

    const snap = state.snapshot;
    const where = state.market === 'alle' ? 'beide Märkte' : state.market === 'DE' ? 'Deutschland' : 'USA';
    $('rankSub').textContent = wide.matches
      ? `Die ${items.length} stärksten Kandidaten (${where}) für die kommenden ` +
        `${snap.config.horizonHours} Stunden — ${snap.config.horizonBars} Balken à ${snap.config.interval}.`
      : `${items.length} Titel · ${where} · ${snap.config.horizonHours} h`;
  }

  function renderCalibration() {
    const snap = state.snapshot;
    Charts.calibration($('calChart'), snap.calibration.buckets, { baseRate: snap.calibration.baseRate });
    $('calStats').innerHTML = [
      ['Beobachtungen', snap.calibration.pooledSamples.toLocaleString('de-DE')],
      ['Basisquote', pct((snap.calibration.baseRate || 0) * 100)],
      ['mittlere Bewegung', signed(snap.calibration.meanRetPct, 2)],
      ['Horizont', `${snap.config.horizonBars} Balken`],
    ]
      .map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`)
      .join('');
    $('calSub').textContent =
      `Grundlage jeder Prozentzahl: ${snap.calibration.pooledSamples.toLocaleString('de-DE')} ausgewertete ` +
      'Vergangenheitslagen. Blasse Balken haben zu wenige Beobachtungen. Balken antippen für Details.';
  }

  function renderSources() {
    const labels = { ok: 'erreichbar', degraded: 'teilweise gestört', down: 'nicht erreichbar' };
    $('sources').innerHTML = (state.snapshot.sources || [])
      .map((s) =>
        `<li class="source" data-status="${esc(s.status)}"><span class="dot"></span>` +
        `<span class="name">${esc(s.name)}</span>` +
        `<span class="detail">${esc(labels[s.status])}${s.count ? ` · ${s.count} Abrufe` : ''}${s.detail ? ` · ${esc(s.detail)}` : ''}</span></li>`)
      .join('');
  }

  const SORTERS = {
    symbol: (a, b) => a.symbol.localeCompare(b.symbol),
    market: (a, b) => a.market.localeCompare(b.market),
    confidence: (a, b) => (a.confidence.points || 0) - (b.confidence.points || 0),
  };

  function sortedRows() {
    let rows = state.snapshot.watchlist.slice();
    if (state.market !== 'alle') rows = rows.filter((r) => r.market === state.market);
    const { key, dir } = state.sort;
    const sorter = SORTERS[key] || ((a, b) => (a[key] ?? -Infinity) - (b[key] ?? -Infinity));
    return rows.sort((a, b) => (dir === 'asc' ? sorter(a, b) : -sorter(a, b)));
  }

  /** Am Telefon: eine Zeile je Titel, alles Wesentliche ohne Querscrollen. */
  function renderRows(rows) {
    $('watchRows').innerHTML = rows
      .map((r) => {
        const met = r.probability >= state.threshold;
        return `<div class="row" data-met="${met}">
          <span class="row-rank">${r.rank}</span>
          <span class="row-main">
            <span class="row-sym">${esc(r.symbol)}
              <span class="chip ${r.market === 'DE' ? 'chip-de' : 'chip-us'}">${r.market}</span>
              ${met ? '<span class="chip chip-good">✓</span>' : ''}
            </span>
            <span class="row-sub">${esc(r.name)} · ${esc(num(r.price, 2))} ${esc(r.currency || '')} ·
              <span class="grade" data-level="${esc(r.confidence.level)}"><span class="dot"></span>${esc(r.confidence.level)}</span>
            </span>
          </span>
          <span class="row-right">
            <span class="row-prob">${esc(pct(r.probability * 100))}</span>
            ${deltaMarkup(r.changePct, 'row-delta')}
          </span>
          <span class="row-bar"><span data-width="${Math.max(2, Math.round(r.probability * 100))}"></span></span>
        </div>`;
      })
      .join('');
  }

  /** Am Schreibtisch: die volle Tabelle mit allen Kennzahlen. */
  function renderTable(rows) {
    $('watchlistBody').innerHTML = rows
      .map((r) => {
        const met = r.probability >= state.threshold;
        return `<tr>
          <td class="num">${r.rank}</td>
          <td><span class="sym">${esc(r.symbol)}</span> <span class="name">${esc(r.name)}</span>${met ? ' <span class="chip chip-good">✓</span>' : ''}</td>
          <td>${r.market === 'DE' ? 'Deutschland' : 'USA'}</td>
          <td class="num">${esc(num(r.price, 2))} ${esc(r.currency || '')}</td>
          <td class="num">${deltaMarkup(r.changePct)}</td>
          <td class="num"><span class="bar-cell"><span class="bar-track"><span class="bar-fill" data-width="${Math.max(2, Math.round(r.probability * 100))}"></span></span>${esc(pct(r.probability * 100))}</span></td>
          <td class="num">${esc(num(r.score, 2))}</td>
          <td class="num">${esc(num(r.rsi, 0))}</td>
          <td class="num">${r.volumeRatio ? `${esc(num(r.volumeRatio, 1))}×` : '–'}</td>
          <td class="num">${r.samples.toLocaleString('de-DE')}</td>
          <td><span class="grade" data-level="${esc(r.confidence.level)}"><span class="dot"></span>${esc(r.confidence.level)}</span></td>
        </tr>`;
      })
      .join('');

    document.querySelectorAll('#watchlist th').forEach((th) => {
      if (th.dataset.sort === state.sort.key) {
        th.setAttribute('aria-sort', state.sort.dir === 'asc' ? 'ascending' : 'descending');
      } else th.removeAttribute('aria-sort');
    });
  }

  /**
   * Balkenbreiten nachtraeglich setzen statt als style-Attribut im Markup.
   *
   * Ein Schreibzugriff ueber das Objektmodell faellt nicht unter die
   * Content-Security-Policy — dadurch kommt die Seite ohne 'unsafe-inline'
   * fuer Stile aus, was eine der wirksamsten Sperren gegen eingeschleusten
   * Code ueberhaupt ist.
   */
  function applyBarWidths(root) {
    root.querySelectorAll('[data-width]').forEach((el) => {
      el.style.width = `${el.dataset.width}%`;
    });
  }

  function renderWatchlist() {
    const rows = sortedRows();
    // Nur die sichtbare Fassung zeichnen — die andere waere verschwendete Arbeit.
    if (wide.matches) {
      renderTable(rows);
      applyBarWidths($('watchlistBody'));
    } else {
      renderRows(rows);
      applyBarWidths($('watchRows'));
    }
    $('listSub').textContent = wide.matches
      ? 'Alle geprüften Titel, absteigend nach Wahrscheinlichkeit. Spalten sind sortierbar.'
      : `Alle ${rows.length} geprüften Titel, absteigend nach Wahrscheinlichkeit.`;
  }

  function startCountdown() {
    const snap = state.snapshot;
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    const tick = () => {
      if (!snap.nextRefreshAt) {
        $('countdown').textContent = '–';
        return;
      }
      const left = Math.max(0, Math.round((snap.nextRefreshAt - Date.now()) / 1000));
      $('countdown').textContent = left === 0 ? 'gleich …' : `neu in ${left} s`;
    };
    tick();
    // Im Hintergrund nicht weiterticken — das kostet am Telefon nur Akku.
    state.countdownTimer = setInterval(() => { if (!document.hidden) tick(); }, 1000);
  }

  function renderMeta() {
    const snap = state.snapshot;
    $('updatedAt').textContent = `${clock(snap.generatedAt)}`;
    $('colophon').textContent =
      `Durchlauf ${snap.cycleMs} ms · ${snap.watchlist.length} Titel · Raster ${snap.config.interval} · ` +
      `Historie ${snap.config.range} · Aktualisierung alle ${snap.refreshSeconds || 60} s · ` +
      `Schwelle serverseitig ${Math.round(snap.config.threshold * 100)} %, Anzeige ${Math.round(state.threshold * 100)} %.`;
    startCountdown();
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
      if (!button || button.getAttribute('aria-checked') === 'true') return;
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

  $('sheetBtn').addEventListener('click', () => {
    const sheet = $('sheet');
    const open = sheet.hidden;
    sheet.hidden = !open;
    $('sheetBtn').setAttribute('aria-expanded', String(open));
  });

  $('threshold').addEventListener('input', (event) => {
    state.threshold = Number(event.target.value) / 100;
    const text = `${event.target.value} %`;
    $('thresholdOut').textContent = text;
    $('thresholdPill').textContent = text;
    if (state.snapshot) render();
  });

  $('refreshBtn').addEventListener('click', triggerRefresh);

  $('logoutBtn').addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } catch { /* selbst wenn das fehlschlaegt: die Anmeldeseite ist der richtige Ort */ }
    window.location.href = '/login';
  });

  // Der Abmelden-Knopf ergibt nur Sinn, wenn ueberhaupt ein Zugangsschutz laeuft.
  fetch('/api/health', { cache: 'no-store' })
    .then((res) => (res.ok ? res.json() : null))
    .then((health) => { if (health) $('logoutBtn').hidden = !health.auth; })
    .catch(() => {});

  $('themeBtn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : current === 'light' ? '' : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    try {
      if (next) localStorage.setItem('theme', next);
      else localStorage.removeItem('theme');
    } catch { /* privater Modus: die Wahl gilt dann nur fuer diese Sitzung */ }
    if (state.snapshot) render();
  });

  try {
    const saved = localStorage.getItem('theme');
    if (saved) document.documentElement.setAttribute('data-theme', saved);
  } catch { /* ohne gespeicherte Wahl gilt die des Systems */ }

  $('watchlist').addEventListener('click', (event) => {
    const th = event.target.closest('th');
    if (!th || !th.dataset.sort) return;
    const key = th.dataset.sort;
    state.sort = state.sort.key === key
      ? { key, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'symbol' || key === 'market' ? 'asc' : 'desc' };
    renderWatchlist();
  });

  /*
   * Die Bedienleiste liegt am Telefon fest ueber dem Inhalt. Wie hoch sie ist,
   * haengt davon ab, wie viele Gruppen umbrechen — das laesst sich nicht raten,
   * also wird es gemessen und als Freiraum unter den Rumpf geschrieben.
   */
  const toolbar = document.querySelector('.toolbar');
  const syncToolbarHeight = () => {
    const fixed = getComputedStyle(toolbar).position === 'fixed';
    document.documentElement.style.setProperty(
      '--toolbar-h',
      fixed ? `${Math.ceil(toolbar.getBoundingClientRect().height)}px` : '0px'
    );
  };
  if (window.ResizeObserver) new ResizeObserver(syncToolbarHeight).observe(toolbar);
  window.addEventListener('orientationchange', () => setTimeout(syncToolbarHeight, 120));
  syncToolbarHeight();

  /*
   * Am Telefon ist Bildschirmflaeche knapp, also ist Erklaerendes zugeklappt.
   * Am Schreibtisch ist sie es nicht — dort steht alles offen, ohne dass man
   * erst suchen muss.
   */
  function syncDisclosures() {
    document.querySelectorAll('.method-box').forEach((box) => {
      box.open = wide.matches;
    });
  }
  syncDisclosures();

  // Wechsel zwischen Zeilen- und Tabellenfassung, etwa beim Drehen des Geraets.
  wide.addEventListener('change', () => {
    syncDisclosures();
    if (state.snapshot) render();
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.snapshot) {
        renderRanking();
        renderCalibration();
      }
    }, 200);
  });

  $('ranking').innerHTML = '<div class="panel empty">Erster Durchlauf läuft — die Portale werden abgefragt …</div>';
  connect();
})();
