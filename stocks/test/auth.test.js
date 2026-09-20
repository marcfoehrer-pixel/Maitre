'use strict';

const test = require('node:test');
const assert = require('node:assert');
const auth = require('../lib/auth');

test('Vergleich in konstanter Zeit erkennt Gleichheit und Unterschiede', () => {
  assert.strictEqual(auth.timingSafeEqual('geheim', 'geheim'), true);
  assert.strictEqual(auth.timingSafeEqual('geheim', 'geheiM'), false);
  assert.strictEqual(auth.timingSafeEqual('geheim', 'geheim1'), false, 'Laenge zaehlt mit');
  assert.strictEqual(auth.timingSafeEqual('', ''), true);
  assert.strictEqual(auth.timingSafeEqual('a', ''), false);
  // Unterschiedliche Laengen duerfen nicht ueber eine Ausnahme durchschlagen.
  assert.doesNotThrow(() => auth.timingSafeEqual('kurz', 'sehr viel laenger'));
});

test('Der Sitzungsschluessel ist stabil und kennwortabhaengig', () => {
  // Stabil, damit ein Neustart niemanden abmeldet.
  assert.deepStrictEqual(auth.deriveKey('abc'), auth.deriveKey('abc'));
  assert.notDeepStrictEqual(auth.deriveKey('abc'), auth.deriveKey('abd'));
});

test('Eine Sitzung gilt nur mit dem richtigen Schluessel', () => {
  const key = auth.deriveKey('geheim');
  const token = auth.createSession(key);
  assert.strictEqual(auth.verifySession(token, key), true);
  assert.strictEqual(auth.verifySession(token, auth.deriveKey('anders')), false,
    'ein geaendertes Kennwort muss alle Sitzungen entwerten');
});

test('Eine Sitzung laeuft ab', () => {
  const key = auth.deriveKey('geheim');
  const token = auth.createSession(key, 0);
  assert.strictEqual(auth.verifySession(token, key, auth.SESSION_MS - 1000), true);
  assert.strictEqual(auth.verifySession(token, key, auth.SESSION_MS + 1000), false);
});

test('Manipulierte oder unsinnige Kennungen werden abgewiesen', () => {
  const key = auth.deriveKey('geheim');
  const token = auth.createSession(key);
  const [version, expiry, mac] = token.split('.');
  const faelle = {
    'verlaengerte Gueltigkeit': `${version}.${(Date.now() + 1e12).toString(36)}.${mac}`,
    'veraenderte Signatur': `${version}.${expiry}.${mac.slice(0, -1)}x`,
    'fremde Version': `v2.${expiry}.${mac}`,
    'ohne Signatur': `${version}.${expiry}`,
    leer: '',
    Unsinn: 'nicht.einmal.ansatzweise',
  };
  for (const [name, wert] of Object.entries(faelle)) {
    assert.strictEqual(auth.verifySession(wert, key), false, `durchgelassen: ${name}`);
  }
  for (const wert of [null, undefined, 42, {}, []]) {
    assert.strictEqual(auth.verifySession(wert, key), false, `durchgelassen: ${typeof wert}`);
  }
});

test('Cookies werden robust gelesen', () => {
  assert.deepStrictEqual(
    auth.parseCookies('a=1; maitre_session=xyz; leer=; b=2'),
    { a: '1', maitre_session: 'xyz', leer: '', b: '2' }
  );
  assert.deepStrictEqual(auth.parseCookies(''), {});
  assert.deepStrictEqual(auth.parseCookies(undefined), {});
  assert.deepStrictEqual(auth.parseCookies('kaputt'), {});
});

test('Unsinnige Cookie-Werte legen nichts lahm', () => {
  // Gefundener Fehler: decodeURIComponent wirft bei fehlerhafter
  // Prozentkodierung. Weil der Cookie-Kopf vor jeder Anmeldung gelesen wird,
  // beendete ein einziges "%zz" von aussen den gesamten Server.
  for (const roh of ['%zz', '%', '%E0%A4%A', '%%%', 'a%2']) {
    assert.doesNotThrow(
      () => auth.parseCookies(`maitre_session=${roh}`),
      `Absturz bei Cookie-Wert ${roh}`
    );
    assert.strictEqual(auth.verifySession(auth.parseCookies(`maitre_session=${roh}`).maitre_session,
      auth.deriveKey('x')), false);
  }
});

test('Das Cookie traegt die schuetzenden Kennzeichen', () => {
  const header = auth.cookieHeader('abc', { secure: true, maxAge: 100 });
  assert.match(header, /HttpOnly/, 'sonst koennte Skriptcode es auslesen');
  assert.match(header, /SameSite=Lax/, 'sonst wuerde es bei fremden Formularen mitgesendet');
  assert.match(header, /Secure/);
  assert.match(header, /Max-Age=100/);
  // Ueber HTTP darf Secure nicht gesetzt sein, sonst verwirft Safari das
  // Cookie im eigenen WLAN und die Anmeldung laeuft im Kreis.
  assert.doesNotMatch(auth.cookieHeader('abc', { secure: false, maxAge: 100 }), /Secure/);
});

test('Erzeugte Kennwoerter sind lang, zufaellig und abtippbar', () => {
  const erste = auth.generatePassword();
  assert.ok(erste.length >= 16);
  assert.notStrictEqual(erste, auth.generatePassword());
  const proben = new Set(Array.from({ length: 200 }, () => auth.generatePassword()));
  assert.strictEqual(proben.size, 200, 'Kennwoerter wiederholen sich');
  for (const probe of proben) {
    assert.doesNotMatch(probe, /[0O1lI]/, 'verwechselbare Zeichen erschweren das Abtippen');
  }
});

test('Die Versuchsbremse greift und laesst sich zuruecksetzen', () => {
  const limiter = auth.createRateLimiter({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) {
    assert.strictEqual(limiter.check('ip').allowed, true, `Versuch ${i + 1} sollte erlaubt sein`);
    limiter.fail('ip');
  }
  const blocked = limiter.check('ip');
  assert.strictEqual(blocked.allowed, false);
  assert.ok(blocked.retryAfter > 0);
  // Andere Absender sind davon nicht betroffen.
  assert.strictEqual(limiter.check('andere-ip').allowed, true);
  limiter.reset('ip');
  assert.strictEqual(limiter.check('ip').allowed, true);
});

test('Die Versuchsbremse vergisst nach Ablauf des Fensters', () => {
  const limiter = auth.createRateLimiter({ max: 1, windowMs: 1000 });
  const start = 1_000_000;
  limiter.fail('ip', start);
  assert.strictEqual(limiter.check('ip', start + 500).allowed, false);
  assert.strictEqual(limiter.check('ip', start + 1500).allowed, true);
});

test('Weitergereichte Absender gelten nur hinter einem Proxy', () => {
  const req = {
    headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
    socket: { remoteAddress: '10.0.0.1' },
  };
  assert.strictEqual(auth.clientKey(req, true), '203.0.113.9');
  // Ohne ausdruecklichen Proxy-Betrieb waere die Angabe frei faelschbar —
  // jeder koennte sich damit an der Versuchsbremse vorbeischummeln.
  assert.strictEqual(auth.clientKey(req, false), '10.0.0.1');
});

test('HTTPS wird nur erkannt, wo es belegt ist', () => {
  const plain = { headers: {}, socket: {} };
  const tls = { headers: {}, socket: { encrypted: true } };
  const proxied = { headers: { 'x-forwarded-proto': 'https' }, socket: {} };
  assert.strictEqual(auth.isSecureRequest(plain, false), false);
  assert.strictEqual(auth.isSecureRequest(tls, false), true);
  assert.strictEqual(auth.isSecureRequest(proxied, false), false, 'ungeprueft ist die Angabe wertlos');
  assert.strictEqual(auth.isSecureRequest(proxied, true), true);
});
