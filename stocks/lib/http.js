'use strict';

/**
 * Duenne Netzschicht: Zeitlimit, Wiederholung, Browser-Kennung.
 *
 * Bewusst ohne Abhaengigkeiten — Node 18+ bringt fetch mit. Jeder Fehler wird
 * zurueckgegeben statt geworfen: eine ausgefallene Quelle darf den Durchlauf
 * nicht abbrechen, sie soll nur im Quellen-Status als rot auftauchen.
 */

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/125.0 Safari/537.36';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, { timeout = 8000, retries = 1, headers = {} } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'user-agent': UA, accept: '*/*', ...headers },
      });
      const body = await res.text();
      clearTimeout(timer);
      if (res.ok) {
        return {
          ok: true, status: res.status, body, headers: res.headers, ms: Date.now() - started,
        };
      }

      lastError = `HTTP ${res.status}`;

      // 429 heisst "zu viele Anfragen". Eine Wiederholung ist dann genau das
      // Falsche — sie vertieft die Drosselung, statt sie abzuwarten. Frueher
      // wurde hier wiederholt; das hielt die Sperre dauerhaft aufrecht.
      if (res.status === 429) {
        return {
          ok: false,
          status: 429,
          error: lastError,
          retryAfter: Number(res.headers.get('retry-after')) || 0,
          headers: res.headers,
          ms: Date.now() - started,
        };
      }

      // Uebrige 4xx sind endgueltig; nur bei Serverfehlern lohnt ein erneuter Versuch.
      if (res.status < 500) {
        return {
          ok: false, status: res.status, error: lastError, headers: res.headers,
          ms: Date.now() - started,
        };
      }
    } catch (err) {
      clearTimeout(timer);
      lastError = err.name === 'AbortError' ? `Zeitlimit ${timeout} ms` : err.message;
    }
    if (attempt < retries) await sleep(400 * 2 ** attempt);
  }
  return { ok: false, status: 0, error: lastError || 'unbekannter Fehler', ms: 0 };
}

async function json(url, options) {
  const res = await request(url, options);
  if (!res.ok) return res;
  try {
    return { ...res, data: JSON.parse(res.body) };
  } catch (err) {
    return { ok: false, status: res.status, error: `ungueltiges JSON: ${err.message}`, ms: res.ms };
  }
}

/** Nacheinander in kleinen Gruppen — freundlich zu kostenlosen Endpunkten. */
async function inBatches(items, size, pauseMs, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    out.push(...(await Promise.all(batch.map(worker))));
    if (i + size < items.length && pauseMs > 0) await sleep(pauseMs);
  }
  return out;
}

module.exports = { request, json, inBatches, sleep, UA };
