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

if (args.offline !== undefined || process.env.OFFLINE) {
  console.warn(
    '[Hinweis] --offline gibt es nicht mehr. Das Dashboard zeigt ausschliesslich\n' +
      '          echte Kurse; ein Titel ohne abrufbare Daten wird uebersprungen.'
  );
}

const config = {
  host: args.host || process.env.HOST || '0.0.0.0',
  password: args.password || process.env.DASHBOARD_PASSWORD || null,
  authEnabled: !flag(args['no-auth']),
  public: isPublic,
  trustProxy: isPublic || flag(args['trust-proxy'] ?? process.env.TRUST_PROXY),
  port: num(args.port ?? process.env.PORT, 4173),
  refreshSeconds: Math.max(20, num(args.refresh ?? process.env.REFRESH, 60)),
  // Durchweg auch als Umgebungsvariable: gehostete Umgebungen kennen keine
  // Aufrufparameter, dort wird alles ueber die Umgebung gesetzt.
  limit: num(args.limit ?? process.env.LIMIT, DEFAULTS.limit),
  interval: args.interval || process.env.INTERVAL || DEFAULTS.interval,
  range: args.range || process.env.RANGE || DEFAULTS.range,
  horizonHours: num(args.horizon ?? process.env.HORIZON, DEFAULTS.horizonHours),
  threshold: num(args.threshold ?? process.env.THRESHOLD, DEFAULTS.threshold),
  topN: num(args.top ?? process.env.TOP, DEFAULTS.topN),
  // Haltedauer der Kursreihen in Minuten — der wirksamste Hebel gegen
  // Drosselung durch das Portal.
  candleTtlMinutes: num(args['candle-ttl'] ?? process.env.CANDLE_TTL_MIN, 0),
  // Optionaler Zweitanbieter. Ohne Schluessel bleibt es bei Yahoo — das
  // genuegt im eigenen WLAN, scheitert aber im Rechenzentrum.
  twelveDataKey: args['twelvedata-key'] || process.env.TWELVEDATA_API_KEY || null,
  markets: (args.markets || process.env.MARKETS || 'DE,US')
    .split(',').map((m) => m.trim().toUpperCase()).filter(Boolean),
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

/**
 * Kennwort merken.
 *
 * Ein bei jedem Start neu erzeugtes Kennwort waere beim taeglichen Gebrauch
 * eine Zumutung: nach jedem Neustart muesste man sich am Telefon neu anmelden
 * und die Zeichenfolge erneut abtippen. Es wird deshalb einmal erzeugt und
 * daneben abgelegt — nur fuer den Eigentuemer lesbar und nicht im Repository.
 */
// Ort ueberschreibbar: Tests duerfen dem Anwender nicht sein Kennwort
// ueberschreiben, und wer die Datei woanders haben will, kann sie verschieben.
const PASSWORD_FILE = args['password-file'] || process.env.KENNWORT_DATEI ||
  path.join(__dirname, '.kennwort');

function rememberedPassword() {
  try {
    const stored = fs.readFileSync(PASSWORD_FILE, 'utf8').trim();
    return stored || null;
  } catch {
    return null;
  }
}

function rememberPassword(password) {
  try {
    fs.writeFileSync(PASSWORD_FILE, `${password}\n`, { mode: 0o600 });
    return true;
  } catch (err) {
    console.warn(`[Hinweis] Kennwort konnte nicht gespeichert werden: ${err.message}`);
    return false;
  }
}

/*
 * Im Internet-Betrieb muss das Kennwort ausdruecklich gesetzt sein.
 *
 * Gehostete Umgebungen haben keinen bestaendigen Datentraeger: ein gemerktes
 * Kennwort waere nach dem naechsten Neustart weg und ein erzeugtes jedes Mal
 * ein anderes. Man kaeme also unvorhersehbar nicht mehr hinein — besser, der
 * Start scheitert sofort und sagt, was fehlt.
 */
if (config.public && config.authEnabled && !config.password) {
  console.error(
    'Abbruch: fuer den Betrieb mit --public muss ein Kennwort gesetzt sein.\n' +
      '  Umgebungsvariable DASHBOARD_PASSWORD setzen, oder --password "..." angeben.\n' +
      '  Ein automatisch erzeugtes Kennwort waere nach jedem Neustart ein anderes.'
  );
  process.exit(1);
}

let generatedPassword = null;
let passwordStored = false;
if (config.authEnabled && !config.password) {
  const remembered = rememberedPassword();
  if (remembered) {
    config.password = remembered;
    passwordStored = true;
  } else {
    config.password = auth.generatePassword();
    generatedPassword = config.password;
    passwordStored = rememberPassword(config.password);
  }
}
const sessionKey = config.authEnabled ? auth.deriveKey(config.password) : null;
const loginLimiter = auth.createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

/**
 * Welcher Stand laeuft hier eigentlich?
 *
 * Ohne diese Angabe ist nach einer Veroeffentlichung nicht feststellbar, ob
 * die neue Fassung bereits ausgerollt ist oder noch die alte antwortet — man
 * raet dann an der Oberflaeche herum. Gehosteter Betrieb liefert die Kennung
 * ueber die Umgebung; lokal wird sie direkt aus dem Git-Verzeichnis gelesen,
 * ohne ein Programm aufzurufen.
 */
function buildInfo() {
  const fromEnv =
    process.env.RENDER_GIT_COMMIT ||
    process.env.SOURCE_VERSION ||
    process.env.GIT_COMMIT ||
    process.env.COMMIT_SHA;
  let commit = fromEnv || null;

  if (!commit) {
    try {
      const gitDir = path.join(__dirname, '..', '.git');
      const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
      commit = head.startsWith('ref: ')
        ? fs.readFileSync(path.join(gitDir, head.slice(5)), 'utf8').trim()
        : head;
    } catch {
      commit = null;   // veroeffentlicht ohne Git-Verzeichnis — dann eben ohne
    }
  }

  return {
    commit: commit ? commit.slice(0, 7) : null,
    branch: process.env.RENDER_GIT_BRANCH || null,
    startedAt: Date.now(),
    node: process.version,
  };
}

const BUILD = buildInfo();

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
let cyclePromise = null;   // laeuft gerade ein Durchlauf? dann dieser
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
    candleTtlMs: config.candleTtlMinutes > 0 ? config.candleTtlMinutes * 60000 : null,
    twelveDataKey: config.twelveDataKey,
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

/**
 * Ein Abrufzyklus.
 *
 * Laeuft bereits einer, wird dessen Zusage zurueckgegeben statt einer zweiten
 * Runde. Wichtig fuer den ersten Aufruf: wer waehrend des Startdurchlaufs die
 * Seite oeffnet, soll dessen Ergebnis bekommen — vorher lief er in einen
 * Fehler "noch keine Daten", obwohl die Daten Sekunden spaeter da waren.
 */
function refresh(reason = 'intervall') {
  if (cyclePromise) return cyclePromise;
  cyclePromise = runRefresh(reason).finally(() => { cyclePromise = null; });
  return cyclePromise;
}

async function runRefresh(reason) {
  const horizons = [...activeHorizons];
  broadcastStatus({ state: 'laeuft', reason, at: Date.now() });
  for (const horizon of horizons) {
    try {
      const snapshot = await runCycle(engineConfig(horizon));
      snapshot.build = BUILD;
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
    // Zweimal: der erste Durchlauf kann fuer einen anderen Horizont gelaufen
    // sein — dann setzt der zweite Aufruf einen eigenen an.
    if (!snapshots.has(horizon)) await refresh('erstabruf');
    if (!snapshots.has(horizon)) await refresh('erstabruf');
    const snapshot = snapshots.get(horizon);
    if (!snapshot) {
      sendJson(res, 503, {
        error: lastError || 'noch keine Daten',
        // Die Oberflaeche soll auch im Fehlerfall benennen koennen, was
        // eingestellt war und welche Quelle klemmt.
        config: engineConfig(horizon),
      });
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
      build: BUILD,
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
 * Nur auf Nachfrage (--public) ausfuehrlich: im Normalfall sucht man beim
 * Start die Adresse fuers Telefon und das Kennwort, nichts sonst. Alles andere
 * an dieser Stelle verdeckt genau das.
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
  return lines.join('\n');
}

const RAHMEN = '  ' + '═'.repeat(58);

server.listen(config.port, config.host, () => {
  const lan = lanAddresses();
  const parts = [''];

  // --- Das Wesentliche zuerst, eingerahmt ---------------------------------
  parts.push(RAHMEN);
  parts.push('');
  if (lan.length > 0) {
    parts.push('    AM IPHONE IM SAFARI OEFFNEN');
    parts.push('');
    for (const i of lan) parts.push(`        http://${i.address}:${config.port}`);
  } else {
    parts.push('    KEINE NETZADRESSE GEFUNDEN');
    parts.push('');
    parts.push('        Der Rechner haengt in keinem WLAN oder Netzwerk.');
    parts.push('        Am Rechner selbst: http://localhost:' + config.port);
  }
  if (config.authEnabled) {
    parts.push('');
    parts.push('    KENNWORT');
    parts.push('');
    parts.push(`        ${config.password}`);
  }
  parts.push('');
  parts.push(RAHMEN);
  parts.push('');

  if (lan.length > 0) {
    parts.push('  Danach am iPhone: Teilen-Symbol -> "Zum Home-Bildschirm".');
    parts.push('  Dann startet es wie eine App, ohne Safari-Leisten.');
    parts.push('');
    parts.push('  iPhone und Rechner muessen im selben WLAN sein.');
    // Unter Windows fragt die Firewall beim ersten Start nach. Wird das
    // weggeklickt, laeuft der Server zwar, ist vom Telefon aber unerreichbar —
    // und man sucht den Fehler dann an der voellig falschen Stelle.
    if (process.platform === 'win32') {
      parts.push('');
      parts.push('  WICHTIG (Windows): Fragt die Firewall nach Netzwerkzugriff fuer');
      parts.push('  Node.js, bitte ZULASSEN — sonst kommt das iPhone nicht durch.');
    }
  }
  parts.push('  Dieses Fenster offen lassen — es ist der Server. Beenden: Strg + C.');
  parts.push('');

  // --- Einzelheiten danach -------------------------------------------------
  if (!config.authEnabled) {
    parts.push('  ZUGANG: offen — jeder, der die Adresse erreicht, sieht das Dashboard.');
    parts.push('  Das ist nur im eigenen WLAN vertretbar.');
  } else if (generatedPassword && passwordStored) {
    parts.push(`  Das Kennwort wurde einmalig erzeugt und gemerkt (${PASSWORD_FILE}).`);
    parts.push('  Es bleibt bei jedem Start gleich; die Anmeldung haelt 30 Tage je Geraet.');
  } else if (passwordStored) {
    parts.push(`  Kennwort gemerkt in ${PASSWORD_FILE} — zum Aendern Datei loeschen.`);
  }

  parts.push(
    `  Stand: ${BUILD.commit || 'unbekannt'}${BUILD.branch ? ` (${BUILD.branch})` : ''} · ` +
      `Node ${BUILD.node}`
  );
  parts.push(
    `  Kursquellen: ${config.twelveDataKey ? 'Twelve Data, dann Yahoo Finance' : 'nur Yahoo Finance'}`
  );
  if (config.public && !config.twelveDataKey) {
    parts.push('  HINWEIS: Yahoo weist Anfragen aus Rechenzentren haeufig ab (HTTP 429).');
    parts.push('  Fuer den Internet-Betrieb einen kostenlosen Schluessel bei twelvedata.com');
    parts.push('  holen und als TWELVEDATA_API_KEY setzen — siehe stocks/README.md.');
  }
  parts.push(
    `  Maerkte: ${config.markets.join(', ')} · Titel: ${config.limit} · ` +
      `Raster: ${config.interval} · Horizont: ${config.horizonHours} h · ` +
      `Aktualisierung: alle ${config.refreshSeconds} s`
  );
  if (config.public) {
    parts.push('');
    parts.push('  Betrieb hinter Tunnel: weitergereichte Absender werden beachtet.');
    parts.push(outsideHints());
  } else {
    parts.push('  Von unterwegs erreichbar? Siehe stocks/README.md ("Von unterwegs erreichbar").');
  }
  parts.push('');

  console.log(parts.join('\n'));
  refresh('start');
  setInterval(() => refresh('intervall'), config.refreshSeconds * 1000);
});

process.on('SIGINT', () => {
  console.log('\nbeendet.');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 500).unref();
});
