'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');

/**
 * Der Zugangsschutz am laufenden Server.
 *
 * Absichtlich kein Nachbau der Weiche, sondern ein echter Start: die
 * gefaehrlichste Luecke waere ein Pfad, den die Weiche schlicht nicht sieht.
 * Das faellt nur auf, wenn man wirklich anklopft.
 */

const SERVER = path.join(__dirname, '..', 'server.js');
const PASSWORD = 'Pruef-Kennwort-42';

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function waitFor(base, timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return;
    } catch { /* noch nicht oben */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Server ist nicht rechtzeitig gestartet');
}

async function withServer(extraArgs, run) {
  const port = await freePort();
  // Eigene Kennwortdatei je Lauf: ein Test darf niemals das gemerkte Kennwort
  // des Anwenders ueberschreiben oder von einem Vorlauf erben.
  const passwordFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'maitre-test-')),
    '.kennwort'
  );
  const child = spawn(
    process.execPath,
    [SERVER, '--offline', '--limit', '4', '--port', String(port), '--host', '127.0.0.1',
      '--password-file', passwordFile, ...extraArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitFor(base);
    await run(base, () => output);
  } finally {
    child.kill('SIGKILL');
    fs.rmSync(path.dirname(passwordFile), { recursive: true, force: true });
  }
}

const login = async (base, password) => {
  const res = await fetch(`${base}/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  return { status: res.status, location: res.headers.get('location'), cookie };
};

test('Ohne Anmeldung gibt der Server nichts heraus', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    for (const pfad of ['/', '/index.html', '/dashboard.js', '/charts.js']) {
      const res = await fetch(base + pfad, { redirect: 'manual' });
      assert.strictEqual(res.status, 302, `${pfad} war ohne Anmeldung erreichbar`);
      assert.match(res.headers.get('location'), /^\/login/);
    }
    for (const pfad of ['/api/snapshot', '/api/health', '/api/stream']) {
      const res = await fetch(base + pfad, { redirect: 'manual' });
      assert.strictEqual(res.status, 401, `${pfad} war ohne Anmeldung erreichbar`);
    }
  });
});

test('Anmeldeseite und App-Symbol bleiben ohne Anmeldung erreichbar', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    // Sonst zeigte die Anmeldeseite ein leeres Symbol und keine Gestaltung.
    for (const pfad of ['/login', '/login.css', '/login.js', '/dashboard.css',
      '/manifest.webmanifest', '/icon-180.png', '/healthz']) {
      const res = await fetch(base + pfad);
      assert.strictEqual(res.status, 200, `${pfad} ist nicht erreichbar`);
    }
  });
});

test('Nur das richtige Kennwort oeffnet die Tuer', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    const falsch = await login(base, 'daneben');
    assert.match(falsch.location, /fehler=falsch/);
    assert.ok(!falsch.cookie.includes('maitre_session=v1'), 'trotz Fehlschlag eine Sitzung erhalten');

    const richtig = await login(base, PASSWORD);
    assert.strictEqual(richtig.location, '/');
    assert.match(richtig.cookie, /^maitre_session=v1\./);

    const res = await fetch(`${base}/api/snapshot`, { headers: { cookie: richtig.cookie } });
    assert.strictEqual(res.status, 200);
    const snapshot = await res.json();
    assert.ok(snapshot.ranking.length > 0);
  });
});

test('Eine gefaelschte Sitzung nuetzt nichts', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    for (const cookie of ['maitre_session=v1.zzzz.erfunden', 'maitre_session=', 'maitre_session=x']) {
      const res = await fetch(`${base}/api/snapshot`, { headers: { cookie } });
      assert.strictEqual(res.status, 401, `durchgelassen: ${cookie}`);
    }
  });
});

test('Krumme Anfragen beenden den Dienst nicht', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    // Jede dieser Kopfzeilen hat einmal gereicht, um den Server zu beenden —
    // ohne Anmeldung, von jedem aus erreichbar.
    for (const cookie of ['maitre_session=%zz', 'maitre_session=%', 'a=%E0%A4%A',
      'maitre_session=' + 'x'.repeat(5000), '=;;=;']) {
      const res = await fetch(`${base}/api/snapshot`, { headers: { cookie } });
      assert.ok(res.status === 401 || res.status === 400, `unerwartet: ${res.status}`);
    }
    // Der entscheidende Nachweis: der Dienst laeuft danach noch.
    const gesund = await fetch(`${base}/healthz`);
    assert.strictEqual(gesund.status, 200, 'der Server hat die Anfragen nicht ueberlebt');

    // Und die Anmeldung funktioniert weiterhin.
    const { location } = await login(base, PASSWORD);
    assert.strictEqual(location, '/');
  });
});

test('Kein Ausbruch aus dem oeffentlichen Verzeichnis', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    const { cookie } = await login(base, PASSWORD);
    for (const pfad of ['/../server.js', '/..%2fserver.js', '/%2e%2e/lib/auth.js',
      '/....//server.js', '/public/../../package.json']) {
      const res = await fetch(base + pfad, { headers: { cookie }, redirect: 'manual' });
      assert.ok(res.status === 404 || res.status === 403 || res.status === 400,
        `${pfad} lieferte ${res.status}`);
      if (res.status === 200) assert.fail(`Datei ausserhalb von public/ ausgeliefert: ${pfad}`);
    }
  });
});

test('Jede Antwort traegt die Sicherheitskopfzeilen', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    const { cookie } = await login(base, PASSWORD);
    for (const pfad of ['/', '/login', '/api/health']) {
      const res = await fetch(base + pfad, { headers: { cookie }, redirect: 'manual' });
      const csp = res.headers.get('content-security-policy') || '';
      assert.match(csp, /script-src 'self'/, `${pfad} ohne Skript-Richtlinie`);
      assert.doesNotMatch(csp, /unsafe-inline/, `${pfad} erlaubt eingebetteten Code`);
      assert.match(csp, /frame-ancestors 'none'/);
      assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
      // HSTS gehoert nicht auf eine HTTP-Verbindung: der Browser merkte sich
      // die Regel und koennte das Dashboard im WLAN nicht mehr oeffnen.
      assert.strictEqual(res.headers.get('strict-transport-security'), null);
    }
  });
});

test('Die Aktualisierungsbremse schuetzt die Finanzportale', { timeout: 40000 }, async () => {
  await withServer(['--password', PASSWORD], async (base) => {
    const { cookie } = await login(base, PASSWORD);
    const erste = await fetch(`${base}/api/refresh`, { method: 'POST', headers: { cookie } });
    assert.strictEqual(erste.status, 202);
    const zweite = await fetch(`${base}/api/refresh`, { method: 'POST', headers: { cookie } });
    assert.strictEqual(zweite.status, 429, 'zwei Durchlaeufe hintereinander waren moeglich');
    assert.ok(Number(zweite.headers.get('retry-after')) > 0);
  });
});

test('Ohne Vorgabe erzeugt der Server ein Kennwort und nennt es', { timeout: 40000 }, async () => {
  await withServer([], async (base, output) => {
    const res = await fetch(base, { redirect: 'manual' });
    assert.strictEqual(res.status, 302, 'ohne Vorgabe blieb der Zugang offen');
    const match = /KENNWORT\s*\n\s*\n\s+(\S+)\s*\n/.exec(output());
    assert.ok(match, 'das erzeugte Kennwort wird nicht ausgegeben');
    const angemeldet = await login(base, match[1]);
    assert.strictEqual(angemeldet.location, '/', 'das genannte Kennwort funktioniert nicht');
  });
});

test('Ein erzeugtes Kennwort ueberlebt den Neustart', { timeout: 60000 }, async () => {
  // Sonst muesste man sich nach jedem Start am Telefon neu anmelden und eine
  // neue Zeichenfolge abtippen — im taeglichen Gebrauch unzumutbar.
  const datei = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'maitre-pw-')), '.kennwort');
  const lies = () => fs.readFileSync(datei, 'utf8').trim();
  try {
    await withServer(['--password-file', datei], async () => {});
    const erstes = lies();
    assert.ok(erstes.length >= 16, 'kein Kennwort gemerkt');
    await withServer(['--password-file', datei], async (base) => {
      assert.strictEqual(lies(), erstes, 'das Kennwort hat sich beim Neustart geaendert');
      const angemeldet = await login(base, erstes);
      assert.strictEqual(angemeldet.location, '/', 'das gemerkte Kennwort funktioniert nicht');
    });
  } finally {
    fs.rmSync(path.dirname(datei), { recursive: true, force: true });
  }
});

test('Offen erreichbar ohne Kennwort wird verweigert', { timeout: 40000 }, async () => {
  const port = await freePort();
  const child = spawn(
    process.execPath,
    [SERVER, '--offline', '--public', '--no-auth', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let output = '';
  child.stdout.on('data', (d) => { output += d; });
  child.stderr.on('data', (d) => { output += d; });
  const code = await new Promise((resolve) => child.on('exit', resolve));
  assert.strictEqual(code, 1, 'der Server startete trotz offener Tuer ins Internet');
  assert.match(output, /schliessen einander aus/);
});

test('Mit --no-auth bleibt der Zugang offen — fuer den Betrieb im eigenen WLAN',
  { timeout: 40000 }, async () => {
    await withServer(['--no-auth'], async (base) => {
      assert.strictEqual((await fetch(base, { redirect: 'manual' })).status, 200);
      assert.strictEqual((await fetch(`${base}/api/snapshot`)).status, 200);
    });
  });
