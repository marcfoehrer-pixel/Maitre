'use strict';

/**
 * Diagramme — als Inline-SVG, ohne Bibliothek.
 *
 * Drei Formen, jede fuer genau eine Aufgabe:
 *   Sparkline     — Verlauf ueber die Zeit (eine Reihe, deshalb keine Legende;
 *                   die Ueberschrift benennt sie).
 *   Meter         — eine einzelne Kennzahl gegen eine Schwelle.
 *   Kalibrierung  — Groesse je Kategorie, eine Farbe fuer alle Balken.
 *
 * Farbe folgt der Bedeutung, nie dem Rang: alle Balken tragen denselben
 * Blauton. Eine Umsortierung faerbt deshalb nichts um.
 */

const Charts = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const tooltipEl = () => document.getElementById('tooltip');

  function el(name, attrs = {}, parent = null) {
    const node = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      node.setAttribute(k, String(v));
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /**
   * Einblendung positionieren.
   *
   * Am Finger anders als an der Maus: der Daumen verdeckt alles unter dem
   * Beruehrpunkt, deshalb wird die Einblendung dort mittig darueber gesetzt
   * statt schraeg daneben.
   */
  function showTip(html, event) {
    const tip = tooltipEl();
    if (!tip) return;
    tip.innerHTML = html;
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const margin = 8;
    const touch = event.pointerType === 'touch';
    let x;
    let y;

    if (touch) {
      x = event.clientX - box.width / 2;
      y = event.clientY - box.height - 22;
      if (y < margin) y = event.clientY + 26;
    } else {
      x = event.clientX + 14;
      y = event.clientY + 14;
      if (x + box.width > window.innerWidth - margin) x = event.clientX - box.width - 14;
      if (y + box.height > window.innerHeight - margin) y = event.clientY - box.height - 14;
    }

    tip.style.left = `${Math.min(Math.max(margin, x), window.innerWidth - box.width - margin)}px`;
    tip.style.top = `${Math.min(Math.max(margin, y), window.innerHeight - box.height - margin)}px`;
  }

  function hideTip() {
    const tip = tooltipEl();
    if (tip) tip.hidden = true;
  }

  // Tippen irgendwo ausserhalb eines Diagramms blendet wieder aus. In der
  // Erfassungsphase, damit ein Tipp auf einen Balken danach neu einblenden kann.
  document.addEventListener(
    'pointerdown',
    (event) => {
      if (!event.target.closest || !event.target.closest('svg')) hideTip();
    },
    true
  );

  const fmtTime = (t) =>
    new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const fmtDay = (t) =>
    new Date(t).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });

  /**
   * Kursverlauf. Referenzlinie ist der erste sichtbare Kurs — dadurch liest
   * man Richtung und Groessenordnung ohne Achsenbeschriftung ab.
   */
  function sparkline(container, points, options = {}) {
    container.textContent = '';
    if (!points || points.length < 2) {
      container.innerHTML = '<p class="card-note">kein Verlauf verfügbar</p>';
      return;
    }
    const w = Math.max(240, container.clientWidth || 300);
    const h = options.height || 74;
    const padY = 8;
    const svg = el('svg', {
      viewBox: `0 0 ${w} ${h}`,
      width: w,
      height: h,
      role: 'img',
      'aria-label': options.label || 'Kursverlauf',
    }, container);

    const values = points.map((p) => p.c);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || Math.max(1e-6, max * 0.001);
    const x = (i) => (i / (points.length - 1)) * w;
    const y = (v) => h - padY - ((v - min) / span) * (h - 2 * padY);

    const base = values[0];
    const rising = values[values.length - 1] >= base;

    // Referenz auf den Startkurs — hauchduenn, damit sie die Linie nicht stoert.
    el('line', {
      x1: 0, x2: w, y1: y(base), y2: y(base),
      stroke: 'var(--axis)', 'stroke-width': 1, 'stroke-dasharray': '2 3',
    }, svg);

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(p.c).toFixed(2)}`).join(' ');
    el('path', {
      d: `${line} L${w},${h} L0,${h} Z`,
      fill: 'var(--series-1-soft)',
      stroke: 'none',
    }, svg);
    el('path', {
      d: line,
      fill: 'none',
      stroke: 'var(--series-1)',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }, svg);

    // Letzter Punkt: 8 px Marker mit 2 px Flaechenring, damit er auf der
    // Flaeche nicht mit der Linie verschmilzt.
    const lastX = x(points.length - 1);
    const lastY = y(values[values.length - 1]);
    el('circle', { cx: lastX, cy: lastY, r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2 }, svg);

    const crosshair = el('line', {
      y1: 0, y2: h, stroke: 'var(--axis)', 'stroke-width': 1, opacity: 0,
    }, svg);
    const marker = el('circle', {
      r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', 'stroke-width': 2, opacity: 0,
    }, svg);

    const hit = el('rect', { x: 0, y: 0, width: w, height: h, fill: 'transparent' }, svg);
    const currency = options.currency || '';

    const move = (event) => {
      const box = svg.getBoundingClientRect();
      const rel = ((event.clientX - box.left) / box.width) * w;
      const i = Math.max(0, Math.min(points.length - 1, Math.round((rel / w) * (points.length - 1))));
      const p = points[i];
      crosshair.setAttribute('x1', x(i));
      crosshair.setAttribute('x2', x(i));
      crosshair.setAttribute('opacity', 1);
      marker.setAttribute('cx', x(i));
      marker.setAttribute('cy', y(p.c));
      marker.setAttribute('opacity', 1);
      const diff = ((p.c / base - 1) * 100).toFixed(2);
      showTip(
        `<b>${p.c.toLocaleString('de-DE', { maximumFractionDigits: 2 })} ${currency}</b>` +
          `<span class="t-sub">${fmtDay(p.t)} ${fmtTime(p.t)} Uhr · ${diff > 0 ? '+' : ''}${diff} % seit Beginn</span>`,
        event
      );
    };
    const clear = () => {
      crosshair.setAttribute('opacity', 0);
      marker.setAttribute('opacity', 0);
      hideTip();
    };
    hit.addEventListener('pointerdown', (event) => {
      // Zeiger erfassen: der Finger darf beim Abtasten den Balken verlassen.
      if (hit.setPointerCapture) hit.setPointerCapture(event.pointerId);
      move(event);
    });
    hit.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' && !event.buttons && !hit.hasPointerCapture?.(event.pointerId)) return;
      move(event);
    });
    hit.addEventListener('pointerup', (event) => { if (event.pointerType === 'touch') clear(); });
    hit.addEventListener('pointercancel', clear);
    hit.addEventListener('pointerleave', (event) => { if (event.pointerType !== 'touch') clear(); });

    return { rising };
  }

  /**
   * Wahrscheinlichkeits-Balken mit Glaubwuerdigkeitsband, Muenzwurf-Marke (50 %)
   * und der eingestellten Schwelle. Der Wert steht als Zahl daneben — Farbe
   * allein traegt hier nichts.
   */
  function meter(container, { value, low, high, threshold }) {
    container.textContent = '';
    const w = Math.max(200, container.clientWidth || 300);
    const h = 26;
    const trackY = 10;
    const trackH = 8;
    const svg = el('svg', {
      viewBox: `0 0 ${w} ${h}`, width: w, height: h,
      role: 'img',
      'aria-label': `Wahrscheinlichkeit ${(value * 100).toFixed(1)} Prozent, Band ${(low * 100).toFixed(0)} bis ${(high * 100).toFixed(0)} Prozent`,
    }, container);
    const px = (p) => p * w;

    el('rect', { x: 0, y: trackY, width: w, height: trackH, rx: 4, fill: 'var(--surface-sunken)' }, svg);
    el('rect', {
      x: px(low), y: trackY, width: Math.max(2, px(high - low)), height: trackH, rx: 4,
      fill: 'var(--series-1-soft)',
    }, svg);
    el('rect', {
      x: 0, y: trackY, width: Math.max(4, px(value)), height: trackH, rx: 4,
      fill: 'var(--series-1)',
    }, svg);

    // Muenzwurf: alles links davon ist kein Kaufargument.
    el('line', { x1: px(0.5), x2: px(0.5), y1: trackY - 3, y2: trackY + trackH + 3, stroke: 'var(--axis)', 'stroke-width': 1 }, svg);
    el('text', { x: px(0.5), y: h - 1, 'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 8.5 }, svg)
      .appendChild(document.createTextNode('50'));

    if (threshold > 0 && threshold < 1) {
      el('line', {
        x1: px(threshold), x2: px(threshold), y1: trackY - 5, y2: trackY + trackH + 5,
        stroke: 'var(--text-primary)', 'stroke-width': 2,
      }, svg);
      // Beschriftung nach links klappen, sobald sie sonst am Rand abgeschnitten
      // wuerde — die Marke steht typisch bei 80 %, also fast immer rechts.
      const text = `Schwelle ${Math.round(threshold * 100)} %`;
      const estimatedWidth = text.length * 4.6;
      const flip = px(threshold) + estimatedWidth + 4 > w;
      const label = el('text', {
        x: flip ? px(threshold) - 4 : px(threshold) + 4,
        y: 7,
        'text-anchor': flip ? 'end' : 'start',
        fill: 'var(--text-secondary)', 'font-size': 8.5,
      }, svg);
      label.appendChild(document.createTextNode(text));
    }
  }

  /**
   * Trefferquote je Signal-Eimer. Eine Reihe, eine Farbe; die Basisquote liegt
   * als Referenzlinie darueber, sonst laesst sich "besser als nichts" nicht ablesen.
   */
  function calibration(container, buckets, { baseRate } = {}) {
    container.textContent = '';
    const usable = (buckets || []).filter((b) => b.n > 0);
    if (usable.length === 0) {
      container.innerHTML = '<p class="card-note">noch keine Kalibrierungsdaten</p>';
      return;
    }
    const w = Math.max(280, container.clientWidth || 520);
    const h = 230;
    const m = { top: 14, right: 12, bottom: 44, left: 38 };
    const plotW = w - m.left - m.right;
    const plotH = h - m.top - m.bottom;
    const svg = el('svg', {
      viewBox: `0 0 ${w} ${h}`, width: w, height: h,
      role: 'img', 'aria-label': 'Gemessene Trefferquote je Signalstärke',
    }, container);

    const maxRate = Math.max(0.65, ...usable.map((b) => b.rate));
    const yMax = Math.min(1, Math.ceil(maxRate * 12) / 12);
    const y = (v) => m.top + plotH - (v / yMax) * plotH;
    const slot = plotW / usable.length;
    const barW = Math.max(6, slot - 6);

    for (let t = 0; t <= yMax + 1e-9; t += 0.1) {
      const yy = y(t);
      el('line', { x1: m.left, x2: w - m.right, y1: yy, y2: yy, stroke: 'var(--grid)', 'stroke-width': 1 }, svg);
      const label = el('text', {
        x: m.left - 7, y: yy + 3, 'text-anchor': 'end', fill: 'var(--text-muted)', 'font-size': 9.5,
      }, svg);
      label.appendChild(document.createTextNode(`${Math.round(t * 100)}%`));
    }

    usable.forEach((b, i) => {
      const x = m.left + i * slot + (slot - barW) / 2;
      const top = y(b.rate);
      const thin = b.n < 40;
      const bar = el('rect', {
        x, y: top, width: barW, height: Math.max(2, m.top + plotH - top),
        rx: 4,
        fill: 'var(--series-1)',
        opacity: thin ? 0.42 : 1,
      }, svg);
      const tip = () =>
        `<b>${(b.rate * 100).toFixed(1)} % Trefferquote</b>` +
        `<span class="t-sub">Signal ${b.from.toFixed(2)} bis ${b.to.toFixed(2)}</span>` +
        `<span class="t-sub">${b.n.toLocaleString('de-DE')} Beobachtungen${thin ? ' · dünne Stichprobe' : ''}</span>`;
      // pointerdown deckt Finger und Maus gleichermassen ab; pointerenter ist
      // nur die Zugabe fuer die Maus.
      bar.addEventListener('pointerdown', (event) => showTip(tip(), event));
      bar.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') showTip(tip(), event);
      });
      bar.addEventListener('pointermove', (event) => {
        if (event.pointerType !== 'touch') showTip(tip(), event);
      });
      bar.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'touch') hideTip();
      });

      // Unsichtbare Trefferflaeche ueber die volle Spaltenhoehe: ein 20 px
      // breiter Balken ist am Finger sonst kaum zu treffen.
      const target = el('rect', {
        x: m.left + i * slot, y: m.top, width: slot, height: plotH, fill: 'transparent',
      }, svg);
      target.addEventListener('pointerdown', (event) => showTip(tip(), event));
      target.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'touch') showTip(tip(), event);
      });
      target.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'touch') hideTip();
      });

      // Nur jede zweite Achsenmarke beschriften — sonst kollidieren die Zahlen.
      if (i % 2 === 0 || usable.length <= 6) {
        const tick = el('text', {
          x: x + barW / 2, y: m.top + plotH + 14,
          'text-anchor': 'middle', fill: 'var(--text-muted)', 'font-size': 9.5,
        }, svg);
        tick.appendChild(document.createTextNode(b.from.toFixed(2)));
      }
    });

    if (baseRate !== null && baseRate !== undefined) {
      const yy = y(baseRate);
      el('line', {
        x1: m.left, x2: w - m.right, y1: yy, y2: yy,
        stroke: 'var(--series-2)', 'stroke-width': 2, 'stroke-dasharray': '5 4',
      }, svg);
      const label = el('text', {
        x: w - m.right, y: yy - 5, 'text-anchor': 'end',
        fill: 'var(--text-secondary)', 'font-size': 9.5,
      }, svg);
      label.appendChild(
        document.createTextNode(`Basisquote aller Lagen ${(baseRate * 100).toFixed(1)} %`)
      );
    }

    const axis = el('text', {
      x: m.left + plotW / 2, y: h - 8, 'text-anchor': 'middle',
      fill: 'var(--text-muted)', 'font-size': 9.5,
    }, svg);
    axis.appendChild(document.createTextNode('Signalwert (negativ = bärisch · positiv = bullisch)'));
  }

  return { sparkline, meter, calibration, showTip, hideTip };
})();

if (typeof module !== 'undefined') module.exports = Charts;
