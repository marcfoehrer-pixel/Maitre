'use strict';

/**
 * Zugangsschutz.
 *
 * Sobald das Dashboard ausserhalb des eigenen WLANs erreichbar ist, ist es fuer
 * jeden erreichbar, der die Adresse kennt. Ohne Schutz waere das nicht nur eine
 * offene Tuer zu den eigenen Daten — jeder Fremde koennte ueber den
 * Aktualisieren-Knopf die Finanzportale mit Anfragen belasten, bis die eigene
 * IP-Adresse dort gesperrt wird.
 *
 * Bewusst ohne Abhaengigkeiten und ohne Benutzerverwaltung: ein Kennwort, eine
 * signierte Sitzungskennung im Cookie. Mehr braucht ein Dashboard fuer eine
 * Person nicht, und jede zusaetzliche Zeile waere eine zusaetzliche Angriffsflaeche.
 */

const crypto = require('crypto');

const COOKIE_NAME = 'maitre_session';
const VERSION = 'v1';
/** 30 Tage: lang genug, dass man sich am Telefon nicht staendig anmeldet. */
const SESSION_MS = 30 * 24 * 3600 * 1000;

/**
 * Vergleich in konstanter Zeit.
 *
 * Ein gewoehnlicher Vergleich bricht beim ersten falschen Zeichen ab. Aus den
 * Laufzeitunterschieden laesst sich ein Kennwort Zeichen fuer Zeichen erraten —
 * ein Lehrbuchangriff, der ueber das Netz tatsaechlich funktioniert.
 */
function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  // Beide Seiten auf gleiche Laenge bringen, sonst wirft der Vergleich und
  // verraet ueber die Ausnahme schon die Laenge.
  const length = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(length);
  const padB = Buffer.alloc(length);
  bufA.copy(padA);
  bufB.copy(padB);
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length;
}

/**
 * Schluessel aus dem Kennwort ableiten.
 *
 * Absichtlich deterministisch: ein Neustart des Servers soll niemanden
 * abmelden. Ein geaendertes Kennwort dagegen macht alle bestehenden
 * Sitzungen sofort ungueltig — genau das erwartet man davon.
 */
function deriveKey(password) {
  return crypto.scryptSync(String(password), 'maitre-stocks-session-v1', 32);
}

function sign(payload, key) {
  return crypto.createHmac('sha256', key).update(payload).digest('base64url');
}

function createSession(key, now = Date.now()) {
  const payload = `${VERSION}.${(now + SESSION_MS).toString(36)}`;
  return `${payload}.${sign(payload, key)}`;
}

function verifySession(token, key, now = Date.now()) {
  if (typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [version, expiry, mac] = parts;
  if (version !== VERSION) return false;
  const payload = `${version}.${expiry}`;
  if (!timingSafeEqual(mac, sign(payload, key))) return false;
  const expiresAt = parseInt(expiry, 36);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * Cookies lesen — ohne bei Unsinn zu stolpern.
 *
 * decodeURIComponent wirft bei fehlerhafter Prozentkodierung (etwa "%zz").
 * Da der Cookie-Kopf von aussen kommt und vor jeder Anmeldung gelesen wird,
 * genuegte ein einziger solcher Wert, um den Server zu beenden. Ein
 * unbrauchbarer Wert wird deshalb roh durchgereicht — die Signaturpruefung
 * weist ihn danach ohnehin ab.
 */
function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name) continue;
    const raw = part.slice(index + 1).trim();
    try {
      out[name] = decodeURIComponent(raw);
    } catch {
      out[name] = raw;
    }
  }
  return out;
}

function cookieHeader(value, { secure, maxAge }) {
  const bits = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',                 // fuer Skripte im Browser unsichtbar
    'SameSite=Lax',             // kein Mitsenden bei fremden Formularen
    `Max-Age=${maxAge}`,
  ];
  // Das Secure-Kennzeichen nur ueber HTTPS setzen: im heimischen WLAN laeuft
  // das Dashboard per HTTP, und ein Secure-Cookie wuerde dort schlicht
  // verworfen — die Anmeldung liefe endlos im Kreis.
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** Ein lesbares, aber nicht ratbares Kennwort, falls keines vorgegeben wurde. */
function generatePassword() {
  // Ohne leicht verwechselbare Zeichen (0/O, 1/l/I) — es wird abgetippt.
  const alphabet = 'abcdefghijkmnopqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let out = '';
  for (let i = 0; i < 16; i++) {
    out += alphabet[bytes[i] % alphabet.length];
    if (i === 3 || i === 7 || i === 11) out += '-';
  }
  return out;
}

/**
 * Versuchsbremse gegen das Durchprobieren von Kennwoertern.
 * Gezaehlt wird je Absender; erfolgreiche Anmeldungen loeschen den Zaehler.
 */
function createRateLimiter({ max = 10, windowMs = 15 * 60 * 1000, maxKeys = 10000 } = {}) {
  const hits = new Map();

  const prune = (now) => {
    for (const [key, entry] of hits) if (entry.resetAt <= now) hits.delete(key);
    // Obergrenze gegen Versuche von vielen Adressen zugleich: die Bremse darf
    // nicht selbst zum Mittel werden, dem Server den Speicher zu fuellen.
    if (hits.size > maxKeys) {
      const zuViel = hits.size - maxKeys;
      let entfernt = 0;
      for (const key of hits.keys()) {
        hits.delete(key);
        if (++entfernt >= zuViel) break;
      }
    }
  };

  return {
    check(key, now = Date.now()) {
      prune(now);
      const entry = hits.get(key);
      if (!entry) return { allowed: true, remaining: max - 1, retryAfter: 0 };
      if (entry.count >= max) {
        return { allowed: false, remaining: 0, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
      }
      return { allowed: true, remaining: max - entry.count - 1, retryAfter: 0 };
    },
    fail(key, now = Date.now()) {
      prune(now);
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= now) hits.set(key, { count: 1, resetAt: now + windowMs });
      else entry.count += 1;
    },
    reset(key) {
      hits.delete(key);
    },
    get size() {
      return hits.size;
    },
  };
}

/**
 * Absenderkennung fuer die Versuchsbremse.
 *
 * Hinter einem Tunnel steht in der Socket-Adresse nur der Tunnel selbst — dann
 * zaehlt der weitergereichte Absender. Diese Angabe ist faelschbar, deshalb
 * wird sie nur beachtet, wenn der Betrieb hinter einem Proxy ausdruecklich
 * eingeschaltet ist.
 */
function clientKey(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || 'unbekannt';
}

function isSecureRequest(req, trustProxy) {
  if (req.socket && req.socket.encrypted) return true;
  if (!trustProxy) return false;
  const proto = req.headers['x-forwarded-proto'];
  return String(proto || '').split(',')[0].trim().toLowerCase() === 'https';
}

module.exports = {
  COOKIE_NAME, SESSION_MS,
  timingSafeEqual, deriveKey, createSession, verifySession,
  parseCookies, cookieHeader, generatePassword, createRateLimiter,
  clientKey, isSecureRequest,
};
