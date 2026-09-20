#!/usr/bin/env node
'use strict';

/**
 * Dashboard-Server: statische Oberflaeche + JSON-Schnittstelle + Live-Strom.
 *
 * Die Abfragen laufen hier und nicht im Browser, aus zwei Gruenden: die
 * Finanzportale setzen keine CORS-Freigabe (ein Browser kaeme gar nicht an die
 * Daten), und ein einziger Abrufzyklus bedient beliebig viele geoeffnete
 * Registerkarten — statt dass jede fuer sich das Portal belastet.
 *
 * Aktualisierung per Server-Sent Events: eine stehende HTTP-Verbindung,
 * automatischer Wiederaufbau durch den Browser, kein WebSocket-Ballast.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { runCycle, DEFAULTS } = require('./lib/engine');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inline] = arg.slice(2).split('=');
    const next = inline !== undefined ? inline : argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    out[key] = next;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const num = (v, fallback) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

const config = {
  port: num(args.port ?? process.env.PORT, 4173),
  refreshSeconds: Math.max(20, num(args.refresh ?? process.env.REFRESH, 60)),
  offline: (args.offline ?? process.env.OFFLINE ?? 'false') !== 'false',
  limit: num(args.limit, DEFAULTS.limit),
  interval: args.interval || DEFAULTS.interval,
  range: args.range || DEFAULTS.range,
  horizonHours: num(args.horizon, DEFAULTS.horizonHours),
  threshold: num(args.threshold, DEFAULTS.threshold),
  topN: num(args.top, DEFAULTS.topN),
  markets: (args.markets || 'DE,US').split(',').map((m) => m.trim().toUpperCase()).filter(Boolean),
};

/** Zulaessige Prognosehorizonte — die Oberflaeche darf nur daraus waehlen. */
const HORIZONS = [1, 2, 3, 4];

const snapshots = new Map();  // horizonHours -> snapshot
const clients = new Set();    // { res, horizon }
let activeHorizons = new Set([config.horizonHours]);
let cycleRunning = false;
let lastError = null;

function engineConfig(horizonHours) {
  return {
    markets: config.markets,
    limit: config.limit,
    interval: config.interval,
    range: config.range,
    horizonHours,
    threshold: config.threshold,
    topN: config.topN,
    offline: config.offline,
  };
}

function broadcast(horizon, payload) {
  const data = `event: snapshot\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    if (client.horizon !== horizon) continue;
    try {
      client.res.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

function broadcastStatus(status) {
  const data = `event: status\ndata: ${JSON.stringify(status)}\n\n`;
  for (const client of clients) {
    try {
      client.res.write(data);
    } catch {
      clients.delete(client);
    }
  }
}

async function refresh(reason = 'intervall') {
  if (cycleRunning) return;
  cycleRunning = true;
  const horizons = [...activeHorizons];
  broadcastStatus({ state: 'laeuft', reason, at: Date.now() });
  for (const horizon of horizons) {
    try {
      const snapshot = await runCycle(engineConfig(horizon));
      snapshot.refreshSeconds = config.refreshSeconds;
      snapshot.nextRefreshAt = Date.now() + config.refreshSeconds * 1000;
      snapshots.set(horizon, snapshot);
      lastError = null;
      broadcast(horizon, snapshot);
      const top = snapshot.ranking[0];
      console.log(
        `[${new Date().toLocaleTimeString('de-DE')}] Horizont ${horizon} h · ` +
          `${snapshot.watchlist.length} Titel · ${snapshot.cycleMs} ms · ` +
          `Spitze ${top ? `${top.symbol} ${(top.probability * 100).toFixed(1)} %` : '–'} · ` +
          `ueber Schwelle: ${snapshot.thresholdCount}`
      );
    } catch (err) {
      lastError = err.message;
      console.error(`[Fehler] Durchlauf Horizont ${horizon} h: ${err.message}`);
      broadcastStatus({ state: 'fehler', message: err.message, at: Date.now() });
    }
  }
  cycleRunning = false;
  broadcastStatus({
    state: 'bereit',
    at: Date.now(),
    nextRefreshAt: Date.now() + config.refreshSeconds * 1000,
  });
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.join(PUBLIC_DIR, rel);
  // Pfadausbruch verhindern — der Server liefert ausschliesslich aus public/.
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('verboten');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('nicht gefunden');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

const pickHorizon = (raw) => {
  const h = Number(raw);
  return HORIZONS.includes(h) ? h : config.horizonHours;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/snapshot') {
    const horizon = pickHorizon(url.searchParams.get('horizon'));
    activeHorizons.add(horizon);
    if (!snapshots.has(horizon)) await refresh('erstabruf');
    const snapshot = snapshots.get(horizon);
    if (!snapshot) {
      sendJson(res, 503, { error: lastError || 'noch keine Daten' });
      return;
    }
    sendJson(res, 200, snapshot);
    return;
  }

  if (url.pathname === '/api/stream') {
    const horizon = pickHorizon(url.searchParams.get('horizon'));
    activeHorizons.add(horizon);
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 5000\n\n`);
    const client = { res, horizon };
    clients.add(client);

    const existing = snapshots.get(horizon);
    if (existing) res.write(`event: snapshot\ndata: ${JSON.stringify(existing)}\n\n`);
    else refresh('neuer Horizont');

    // Ohne Lebenszeichen schliessen Proxys die stehende Verbindung nach ~30 s.
    const beat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(beat);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(beat);
      clients.delete(client);
      const stillUsed = [...clients].some((c) => c.horizon === horizon);
      if (!stillUsed && horizon !== config.horizonHours) activeHorizons.delete(horizon);
    });
    return;
  }

  if (url.pathname === '/api/refresh' && req.method === 'POST') {
    refresh('manuell');
    sendJson(res, 202, { ok: true });
    return;
  }

  if (url.pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      offline: config.offline,
      horizons: [...activeHorizons],
      clients: clients.size,
      lastError,
      snapshots: [...snapshots.keys()],
    });
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(config.port, () => {
  console.log(
    `Aktien-Dashboard auf http://localhost:${config.port}\n` +
      `  Maerkte: ${config.markets.join(', ')} · Titel: ${config.limit} · ` +
      `Raster: ${config.interval} · Historie: ${config.range}\n` +
      `  Horizont: ${config.horizonHours} h · Schwelle: ${(config.threshold * 100).toFixed(0)} % · ` +
      `Aktualisierung: alle ${config.refreshSeconds} s` +
      (config.offline ? '\n  MODUS: offline — es werden Demo-Daten erzeugt.' : '')
  );
  refresh('start');
  setInterval(() => refresh('intervall'), config.refreshSeconds * 1000);
});

process.on('SIGINT', () => {
  console.log('\nbeendet.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
