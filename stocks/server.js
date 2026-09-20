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
const os = require('os');
const path = require('path');
const { runCycle, DEFAULTS } = require('./lib/engine');
const auth = require('./lib/auth');

const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

/**
 * Adressen im lokalen Netz.
 *
 * Auf dem iPhone laeuft kein Node — der Server steht auf dem Rechner, das
 * Telefon ruft ihn im WLAN auf. Deshalb wird die Netzadresse beim Start
 * ausgegeben: sonst muss man sie sich erst muehsam zusammensuchen.
 */
function lanAddresses() {
  const out = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (entry.internal) continue;
      out.push({ name, address: entry.address });
    }
  }
  return out;
}

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

const flag = (value, fallback = false) => {
  if (value === undefined) return fallback;
  return value !== 'false' && value !== '0' && value !== 'nein';
};

/**
 * `--public` buendelt, was fuer den Betrieb hinter einem Tunnel noetig ist:
 * Kennwort verpflichtend, weitergereichte Absender und Protokollangaben
 * beachten. Ein einzelner Schalter statt drei, die man einzeln vergessen kann.
 */
const isPublic = flag(args.public ?? process.env.PUBLIC);

const config = {
  host: args.host || process.env.HOST || '0.0.0.0',
  password: args.password || process.env.DASHBOARD_PASSWORD || null,
  authEnabled: !flag(args['no-auth']),
  public: isPublic,
  trustProxy: isPublic || flag(args['trust-proxy'] ?? process.env.TRUST_PROXY),
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

// Ein offen erreichbares Dashboard ohne Kennwort ist kein Versehen, das man
// stillschweigend korrigiert — es wird abgelehnt, bevor es laeuft.
if (config.public && !config.authEnabled) {
  console.error(
    'Abbruch: --public und --no-auth schliessen einander aus.\n' +
      'Ausserhalb des eigenen Netzes erreicht die Adresse jeder, der sie kennt.'
  );
  process.exit(1);
}

let generatedPassword = null;
if (config.authEnabled && !config.password) {
  config.password = auth.generatePassword();
  generatedPassword = config.password;
}
const sessionKey = config.authEnabled ? auth.deriveKey(config.password) : null;
const loginLimiter = auth.createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

/** Zulaessige Prognosehorizonte — die Oberflaeche darf nur daraus waehlen. */
const HORIZONS = [1, 2, 3, 4];

/**
 * Ohne Anmeldung erreichbar: die Anmeldeseite selbst und was der Browser
 * braucht, um sie und das App-Symbol darzustellen. Nichts davon verraet Daten.
 */
const OPEN_PATHS = new Set([
  '/login', '/login.html', '/login.css', '/login.js',
  '/dashboard.css', '/manifest.webmanifest',
  '/icon.svg', '/icon-180.png', '/icon-192.png', '/icon-512.png',
  '/healthz',
]);

/** Hoechstzahl gleichzeitiger Live-Verbindungen — Schutz vor Erschoepfung. */
const MAX_CLIENTS = 24;
/** Kuerzester Abstand zwischen zwei von Hand ausgeloesten Durchlaeufen. */
const MANUAL_REFRESH_MS = 10000;
let lastManualRefresh = 0;

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

/**
 * Sicherheitskopfzeilen fuer jede Antwort.
 *
 * Werden einmal ganz oben in der Weiche gesetzt, nicht an jedem Ausgang
 * einzeln: bei ueber einem Dutzend Antwortwegen wird sonst frueher oder
 * spaeter einer vergessen — und gerade Weiterleitungen fallen dabei durch.
 *
 * Die Richtlinie ist streng gehalten: kein eingebetteter Code, keine fremden
 * Quellen, kein Einbetten in fremde Seiten. Das ist moeglich, weil Stile und
 * Skripte durchweg in eigenen Dateien liegen und Balkenbreiten ueber das
 * Objektmodell gesetzt werden statt als style-Attribut.
 */
function securityHeaders(req) {
  const headers = {
    'content-security-policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self'",
      "script-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "object-src 'none'",
    ].join('; '),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), camera=(), microphone=(), interest-cohort=()',
    'cross-origin-opener-policy': 'same-origin',
  };
  // HSTS nur ueber HTTPS senden: auf einer HTTP-Verbindung im eigenen WLAN
  // wuerde der Browser sich die Regel merken und das Dashboard dort danach
  // gar nicht mehr oeffnen.
  if (auth.isSecureRequest(req, config.trustProxy)) {
    headers['strict-transport-security'] = 'max-age=15552000';
  }
  return headers;
}

/** Formularinhalt lesen, mit hartem Deckel gegen aufgeblaehte Anfragen. */
function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error('Anfrage zu gross'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function hasSession(req) {
  if (!config.authEnabled) return true;
  const cookies = auth.parseCookies(req.headers.cookie);
  return auth.verifySession(cookies[auth.COOKIE_NAME], sessionKey);
}

function redirect(res, location, extraHeaders = {}) {
  res.writeHead(302, { location, 'cache-control': 'no-store', ...extraHeaders });
  res.end();
}

function sendJson(res, status, body, headers = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
    ...headers,
  });
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC_DIR, rel);
  // Pfadausbruch verhindern — der Server liefert ausschliesslich aus public/.
  // Mit dem Trennzeichen vergleichen, sonst kaeme auch ein Geschwisterordner
  // durch, dessen Name mit demselben Wortstamm beginnt.
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('verboten');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res
        .writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end('nicht gefunden');
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

/**
 * Die Weiche selbst — von handle() umhuellt, damit kein einzelner Fehler
 * den Dienst beendet.
 */
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const secure = auth.isSecureRequest(req, config.trustProxy);

  // Gilt ab hier fuer jede Antwort dieser Anfrage, gleich welcher Zweig sie gibt.
  for (const [name, value] of Object.entries(securityHeaders(req))) res.setHeader(name, value);

  // --- Lebenszeichen fuer Ueberwachung: verraet nichts, braucht keine Anmeldung
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  // --- Anmeldung ----------------------------------------------------------
  if (url.pathname === '/login') {
    if (!config.authEnabled) {
      redirect(res, '/');
      return;
    }
    if (req.method === 'GET') {
      if (hasSession(req)) {
        redirect(res, '/');
        return;
      }
      serveStatic(req, res, '/login.html');
      return;
    }
    if (req.method === 'POST') {
      const key = auth.clientKey(req, config.trustProxy);
      const limit = loginLimiter.check(key);
      if (!limit.allowed) {
        redirect(res, '/login?fehler=gesperrt', { 'retry-after': String(limit.retryAfter) });
        return;
      }
      let body = '';
      try {
        body = await readBody(req);
      } catch {
        redirect(res, '/login?fehler=fehlt');
        return;
      }
      const submitted = new URLSearchParams(body).get('password') || '';
      if (!submitted) {
        redirect(res, '/login?fehler=fehlt');
        return;
      }
      if (!auth.timingSafeEqual(submitted, config.password)) {
        loginLimiter.fail(key);
        console.warn(`[Anmeldung] fehlgeschlagen von ${key}`);
        redirect(res, '/login?fehler=falsch');
        return;
      }
      loginLimiter.reset(key);
      redirect(res, '/', {
        'set-cookie': auth.cookieHeader(auth.createSession(sessionKey), {
          secure,
          maxAge: Math.floor(auth.SESSION_MS / 1000),
        }),
      });
      return;
    }
    res.writeHead(405).end();
    return;
  }

  if (url.pathname === '/api/logout' && req.method === 'POST') {
    sendJson(res, 200, { ok: true }, {
      'set-cookie': auth.cookieHeader('', { secure, maxAge: 0 }),
    });
    return;
  }

  // --- Ab hier ist eine gueltige Sitzung Voraussetzung ---------------------
  if (!OPEN_PATHS.has(url.pathname) && !hasSession(req)) {
    // Schnittstellen bekommen einen Fehlercode, damit die Oberflaeche ihn
    // auswerten kann; alles andere wird auf die Anmeldeseite geschickt.
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, 401, { error: 'nicht angemeldet' });
      return;
    }
    redirect(res, '/login?fehler=abgelaufen');
    return;
  }

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
    if (clients.size >= MAX_CLIENTS) {
      sendJson(res, 503, { error: 'zu viele gleichzeitige Verbindungen' });
      return;
    }
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
    // Bremse: ohne sie koennte ein haengender Tab oder ein Fremder die
    // Finanzportale im Sekundentakt belasten, bis die eigene Adresse dort
    // gesperrt wird.
    const since = Date.now() - lastManualRefresh;
    if (since < MANUAL_REFRESH_MS) {
      sendJson(res, 429, { error: 'zu haeufig', retryAfter: Math.ceil((MANUAL_REFRESH_MS - since) / 1000) },
        { 'retry-after': String(Math.ceil((MANUAL_REFRESH_MS - since) / 1000)) });
      return;
    }
    lastManualRefresh = Date.now();
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
      auth: config.authEnabled,
    });
    return;
  }

  serveStatic(req, res, url.pathname);
}

/**
 * Auffangnetz um jede Anfrage.
 *
 * Ein Dashboard, das aus dem Internet erreichbar ist, darf an keiner
 * unerwarteten Eingabe sterben — sonst genuegt eine einzige krumme Kopfzeile,
 * um es fuer alle abzuschalten. Gefunden wurde genau das: eine fehlerhafte
 * Prozentkodierung im Cookie beendete den Dienst.
 */
const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => route(req, res))
    .catch((err) => {
      console.error(`[Fehler] ${req.method} ${req.url}: ${err.message}`);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('interner Fehler');
    });
});

// Fehlerhafte Anfragen auf Protokollebene (abgeschnittene Kopfzeilen und
// aehnliches) hoeflich abweisen, statt sie durchschlagen zu lassen.
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  socket.destroy();
});

/** Liegt dieses Programm im Suchpfad? Ohne Ausfuehren, nur nachsehen. */
function isInstalled(binary) {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? [`${binary}.exe`, `${binary}.cmd`] : [binary];
  for (const dir of dirs) {
    for (const name of names) {
      try {
        fs.accessSync(path.join(dir, name), fs.constants.X_OK);
        return true;
      } catch { /* im naechsten Verzeichnis weitersuchen */ }
    }
  }
  return false;
}

/**
 * Hinweise fuer den Zugriff von unterwegs.
 *
 * Bewusst nur Vorschlaege statt eines automatisch gestarteten Tunnels: was das
 * eigene Dashboard ins Internet stellt, soll man selbst ausloesen und sehen.
 */
function outsideHints() {
  const lines = [];
  const hasTailscale = isInstalled('tailscale');
  const hasCloudflared = isInstalled('cloudflared');

  lines.push('  Ausserhalb des WLANs erreichbar machen:');
  if (hasTailscale) {
    lines.push(`    tailscale serve --bg ${config.port}      (privat, nur eigene Geraete)`);
    lines.push(`    tailscale funnel --bg ${config.port}     (oeffentliche Adresse mit HTTPS)`);
  }
  if (hasCloudflared) {
    lines.push(`    cloudflared tunnel --url http://localhost:${config.port}`);
  }
  if (!hasTailscale && !hasCloudflared) {
    lines.push('    Tailscale oder Cloudflare Tunnel installieren — siehe stocks/README.md.');
    lines.push('    Den Router NICHT oeffnen: ein weitergeleiteter Port stellt den Rechner');
    lines.push('    ungeschuetzt ins Netz.');
  }
  if (!config.public) {
    lines.push('    Dabei den Server mit --public starten, sonst fehlen die Einstellungen');
    lines.push('    fuer den Betrieb hinter einem Tunnel.');
  }
  return lines.join('\n');
}

server.listen(config.port, config.host, () => {
  const lan = lanAddresses();
  const parts = [
    'Aktien-Dashboard',
    `  an diesem Rechner   http://localhost:${config.port}`,
  ];
  for (const i of lan) {
    parts.push(`  am iPhone im WLAN   http://${i.address}:${config.port}   (${i.name})`);
  }
  if (lan.length > 0) {
    parts.push('  Dort im Browser oeffnen, dann Teilen -> "Zum Home-Bildschirm" —');
    parts.push('  danach startet es wie eine App, ohne Safari-Leisten.');
  }
  parts.push('');
  parts.push(outsideHints());
  parts.push('');

  if (!config.authEnabled) {
    parts.push('  ZUGANG: offen — jeder, der die Adresse erreicht, sieht das Dashboard.');
    parts.push('  Das ist nur im eigenen WLAN vertretbar.');
  } else if (generatedPassword) {
    parts.push('  ZUGANG: Kennwort (neu erzeugt, gilt nur fuer diesen Start)');
    parts.push('');
    parts.push(`      ${generatedPassword}`);
    parts.push('');
    parts.push('  Dauerhaft festlegen, damit es Neustarts uebersteht:');
    parts.push('      DASHBOARD_PASSWORD="..." npm run stocks');
    parts.push('  Die Anmeldung am Geraet haelt danach 30 Tage.');
  } else {
    parts.push('  ZUGANG: Kennwort aus der Vorgabe. Anmeldung haelt 30 Tage je Geraet.');
  }

  parts.push('');
  parts.push(
    `  Maerkte: ${config.markets.join(', ')} · Titel: ${config.limit} · ` +
      `Raster: ${config.interval} · Historie: ${config.range}`
  );
  parts.push(
    `  Horizont: ${config.horizonHours} h · Schwelle: ${(config.threshold * 100).toFixed(0)} % · ` +
      `Aktualisierung: alle ${config.refreshSeconds} s`
  );
  if (config.public) parts.push('  Betrieb hinter Tunnel: weitergereichte Absender werden beachtet.');
  if (config.offline) parts.push('  MODUS: offline — es werden Demo-Daten erzeugt.');

  console.log(parts.join('\n'));
  refresh('start');
  setInterval(() => refresh('intervall'), config.refreshSeconds * 1000);
});

process.on('SIGINT', () => {
  console.log('\nbeendet.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
