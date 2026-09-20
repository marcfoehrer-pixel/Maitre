# Aktien-Kurzfristprognose

Ein Dashboard, das deutsche und amerikanische Aktien danach ordnet, wie
wahrscheinlich ein **höherer Kurs in den kommenden Stunden** ist — mit einer
Zahl, die nicht geraten, sondern an der Vergangenheit **gemessen** ist.

Gebaut fürs iPhone: einspaltig, Bedienung unten in der Daumenzone, alle
Trefferflächen mindestens 44 × 44 pt, Ränder auf Dynamic Island und
Home-Indikator abgestimmt. Am Schreibtisch wird daraus dieselbe Oberfläche in
mehreren Spalten mit voller Tabelle.

Starten per Doppelklick auf `Dashboard starten.command` (macOS) bzw.
`Dashboard starten.bat` (Windows) — oder im Terminal:

```bash
npm run stocks          # Live-Betrieb im eigenen WLAN
npm run stocks:public   # zusätzlich hinter einem Tunnel erreichbar
npm run stocks:demo     # ohne Netz und ohne Anmeldung, mit Demo-Daten
npm run test:stocks     # 78 Tests
```

---

## Am iPhone benutzen

Auf dem iPhone läuft kein Node — der Server steht auf Ihrem Rechner, das
Telefon ruft ihn im WLAN auf. Ohne Terminal, in vier Schritten:

**1. Projekt laden.** [Als ZIP herunterladen](https://github.com/marcfoehrer-pixel/Maitre/archive/refs/heads/claude/stock-forecast-dashboard-lmn641.zip).
Die Datei dann **entpacken** — unter Windows Rechtsklick → *Alle extrahieren*,
am Mac genügt ein Doppelklick. Direkt aus der ZIP-Datei heraus startet es nicht.

**2. Node.js installieren**, falls noch nicht vorhanden: auf
[nodejs.org](https://nodejs.org/de/download) die **LTS**-Fassung laden und
durchklicken. Einmalig. (Der Starter in Schritt 3 sagt Ihnen, ob es fehlt, und
öffnet die Seite selbst.)

**3. Im entpackten Ordner doppelklicken auf:**

| | |
| --- | --- |
| macOS | `Dashboard starten.command` |
| Windows | `Dashboard starten.bat` |

>  **Beim ersten Mal blockt das Betriebssystem geladene Dateien:**
>
> - **Windows:** „Der Computer wurde geschützt" → **Weitere Informationen** →
>   **Trotzdem ausführen**. Fragt danach die **Firewall** nach Netzwerkzugriff
>   für Node.js: **Zulassen** — sonst läuft der Server zwar, aber das iPhone
>   kommt nicht durch.
> - **macOS:** statt Doppelklick **Rechtsklick → Öffnen → Öffnen**.
>
> Meldet Windows dagegen **„Smart App Control hat eine Datei blockiert"**,
> hilft kein Bestätigen — siehe den folgenden Abschnitt.

### Wenn Smart App Control blockiert

Smart App Control (Windows 11) lässt unsignierte Skripte grundsätzlich nicht
zu und bietet **kein** „Trotzdem ausführen". Der Starter `.bat` ist damit auf
diesem Rechner nicht verwendbar.

**Schalten Sie Smart App Control nicht ab.** Es lässt sich anschließend nur
durch eine Neuinstallation von Windows wieder einschalten — ein hoher Preis
für ein Dashboard.

Stattdessen den Server direkt über Node starten. `node.exe` ist signiert und
wird von Smart App Control akzeptiert:

1. Den entpackten Ordner im Explorer öffnen.
2. Rechtsklick auf eine freie Stelle im Ordner → **„In Terminal öffnen"**
   (Windows 10: `Umschalt` + Rechtsklick → *PowerShell-Fenster hier öffnen*).
3. Eintippen und `Enter`:

   ```
   node stocks\server.js
   ```

Mehr ist es nicht — kein `npm install`, keine Umgebungsvariablen. Adresse und
Kennwort erscheinen wie gewohnt im Fenster.

Fehlt Node, meldet das Fenster `node ... nicht gefunden`: dann einmalig von
[nodejs.org](https://nodejs.org/de/download) die **LTS**-Fassung installieren
(der Installer ist signiert und wird akzeptiert), Fenster schließen, Schritt 2
wiederholen.

Es öffnet sich ein Fenster, und nach einem Moment steht dort das Wesentliche:

```
  ══════════════════════════════════════════════════════════

    AM IPHONE IM SAFARI OEFFNEN

        http://192.168.1.42:4173

    KENNWORT

        uzZc-9jk5-pLF6-aMEr

  ══════════════════════════════════════════════════════════
```

**4. Am iPhone** in Safari diese Adresse eingeben, Kennwort eintippen, fertig.
Dann **Teilen-Symbol → „Zum Home-Bildschirm"** — ab da starten Sie es über ein
eigenes Symbol wie jede andere App.

Drei Dinge, die es sonst scheitern lassen:

- **Das Fenster muss offen bleiben** — es *ist* der Server. Beenden mit
  `Strg` + `C` oder Fenster schließen.
- **iPhone und Rechner im selben WLAN**, nicht über Mobilfunk.
- **Die Adresse beginnt mit `192.168.…`** (oder `10.…`). `localhost` funktioniert
  nur am Rechner selbst, nie am Telefon.

Das Kennwort wird beim ersten Start einmal erzeugt und in `stocks/.kennwort`
gemerkt — es bleibt danach gleich. Zum Ändern die Datei löschen oder ein
eigenes vorgeben: `DASHBOARD_PASSWORD="…"`. Die Anmeldung am Gerät hält 30 Tage.

### Für Terminal-Nutzer

```bash
git clone -b claude/stock-forecast-dashboard-lmn641 https://github.com/marcfoehrer-pixel/Maitre.git
cd Maitre
npm run stocks
```

Keine Abhängigkeiten, kein `npm install`.

### Was am Telefon anders ist

| | |
| --- | --- |
| **Bedienung unten** | Horizont, Märkte, Schwelle und Aktualisieren liegen in der Daumenzone — nicht oben am Rand, wo man die Hand umgreifen müsste. |
| **Tippen statt Überfahren** | Es gibt keinen Mauszeiger: Diagrammbalken und Kursverläufe blenden ihre Werte beim Antippen ein, ein Tipp daneben blendet sie wieder aus. Über den Kursverlauf lässt sich mit dem Finger streichen. |
| **Wesentliches zuerst** | Je Titel stehen Wahrscheinlichkeit, Band und Verlauf offen; Kennzahlen und Begründung liegen einen Tipp entfernt. Hinweise zeigen ihre Kernaussage in einer Zeile. Am Schreibtisch ist alles aufgeklappt. |
| **Liste statt Tabelle** | Die Beobachtungsliste wird als Zeilen gezeichnet — kein Querscrollen durch elf Spalten. Ab Tablet-Breite erscheint die volle, sortierbare Tabelle. |
| **Ziehen zum Aktualisieren** | Von oben nach unten ziehen stößt einen Durchlauf an. |
| **Verbindung nach dem Zurückkehren** | iOS kappt stehende Verbindungen, sobald die App in den Hintergrund geht. Beim Zurückkehren baut das Dashboard sie neu auf und prüft, ob die Daten veraltet sind — stumm veraltete Kurse anzuzeigen wäre der gefährlichste Zustand. |
| **Akku** | Der Sekundenzähler läuft im Hintergrund nicht weiter. |

Läuft der Server dauerhaft (etwa auf einem Rechner, der ohnehin an ist), ist
das Dashboard jederzeit über das Symbol auf dem Home-Bildschirm erreichbar.
Ist der Server aus, meldet die Oberfläche das in der Kopfzeile, statt alte
Zahlen als aktuelle auszugeben.

---

## Von unterwegs erreichbar

Sobald das Dashboard außerhalb des eigenen WLANs erreichbar ist, ist es für
jeden erreichbar, der die Adresse kennt. Deshalb zuerst das Wichtigste:

### Der Zugangsschutz ist immer an

Beim Start verlangt der Server ein Kennwort. Ist keines vorgegeben, erzeugt er
eines und nennt es in der Ausgabe:

```
  ZUGANG: Kennwort (neu erzeugt, gilt nur fuer diesen Start)

      Vzpp-vpU5-Sy7J-hLXf
```

Ein erzeugtes Kennwort ändert sich bei jedem Neustart. Für den dauerhaften
Betrieb deshalb eines fest vorgeben:

```bash
DASHBOARD_PASSWORD="Ihr-Kennwort" npm run stocks
```

Die Anmeldung hält **30 Tage je Gerät** — am iPhone meldet man sich also
praktisch einmal an. Ein geändertes Kennwort macht alle Anmeldungen sofort
ungültig. Abmelden geht über die Schwellen-Leiste unten.

Nur für den Betrieb im eigenen WLAN lässt sich der Schutz mit `--no-auth`
abschalten. In Verbindung mit `--public` **verweigert der Server den Start** —
ein offenes Dashboard im Internet ist kein Zustand, den man versehentlich
herstellen können sollte.

### Der Weg nach draußen

Immer mit `--public` starten. Der Schalter bündelt, was hinter einem Tunnel
nötig ist: Kennwort verpflichtend, weitergereichte Absender und
HTTPS-Angaben beachten (sonst greift die Versuchsbremse ins Leere und das
Sitzungs-Cookie bekäme kein `Secure`-Kennzeichen).

```bash
DASHBOARD_PASSWORD="Ihr-Kennwort" npm run stocks:public
```

Dann einen der folgenden Wege — **empfohlen ist der erste**:

| Weg | Wie | Beurteilung |
| --- | --- | --- |
| **Tailscale, privat** *(empfohlen)* | `tailscale serve --bg 4173` | Das Dashboard steht **nicht** im Internet, sondern nur in Ihrem eigenen Geräteverbund. Das iPhone braucht die Tailscale-App, einmal angemeldet. Feste Adresse, HTTPS automatisch, kostenlos. Angriffsfläche: praktisch keine. |
| **Tailscale Funnel, öffentlich** | `tailscale funnel --bg 4173` | Feste öffentliche HTTPS-Adresse, keine App auf dem Telefon nötig. Geschützt allein durch Ihr Kennwort. Bequemer, aber die Adresse ist erreichbar. |
| **Cloudflare Tunnel** | `cloudflared tunnel --url http://localhost:4173` | Sinnvoll, wenn Sie ohnehin eine Domain bei Cloudflare haben. Die kostenlose Schnellvariante vergibt bei **jedem Start eine neue Adresse** — für ein Symbol auf dem Home-Bildschirm unbrauchbar. Dafür braucht es einen benannten Tunnel mit eigener Domain. |
| **Kleiner Server (VPS)** | Projekt dorthin kopieren, `npm run stocks:public` hinter einem Reverse-Proxy mit HTTPS | Die einzige Variante, die auch läuft, wenn Ihr Rechner aus ist. Dafür Kosten und Pflege. |
| **Port im Router freigeben** | — | **Nicht tun.** Damit steht Ihr Rechner ungeschützt im Netz, ohne HTTPS und ohne Schutz für alles andere, was darauf läuft. Ein Tunnel leistet dasselbe ohne diese Öffnung. |

Der Server erkennt beim Start selbst, ob `tailscale` oder `cloudflared`
installiert sind, und nennt dann den passenden Befehl.

### Was Sie dabei wissen sollten

- **Ihr Rechner muss laufen.** Ist er aus oder im Ruhezustand, ist auch das
  Dashboard weg. Die Oberfläche sagt das in der Kopfzeile, statt alte Zahlen
  als aktuelle auszugeben.
- **Mobilfunk-Datenverbrauch.** Jede Aktualisierung überträgt je nach
  Titelzahl etwa 50–130 KB. Bei 40 Titeln im Minutentakt sind das rund
  **7 MB pro Stunde**. Unterwegs lohnt ein größerer Abstand:
  `--refresh 180` senkt das auf etwa ein Drittel.
- **Abbrechende Verbindungen** sind unterwegs normal. Die Oberfläche baut die
  Verbindung selbst wieder auf und zeigt den Zustand in der Kopfzeile an.

### Wogegen der Server geschützt ist

| | |
| --- | --- |
| **Kennwort erraten** | Vergleich in konstanter Zeit (aus Laufzeitunterschieden lässt sich ein Kennwort sonst Zeichen für Zeichen erraten), dazu höchstens 10 Versuche je Absender und Viertelstunde. |
| **Sitzung fälschen** | Das Cookie ist mit HMAC-SHA256 signiert, der Schlüssel aus dem Kennwort abgeleitet (scrypt). `HttpOnly`, `SameSite=Lax`, `Secure` sobald HTTPS anliegt. |
| **Eingeschleuster Code** | Strenge Content-Security-Policy **ohne** `unsafe-inline` — dafür liegen alle Stile und Skripte in eigenen Dateien, und Balkenbreiten werden über das Objektmodell gesetzt statt als `style`-Attribut. Dazu `nosniff`, `frame-ancestors 'none'`, `no-referrer`. |
| **Dateien außerhalb von `public/`** | Pfade werden aufgelöst und gegen das Verzeichnis samt Trennzeichen geprüft. |
| **Missbrauch der Finanzportale** | Von Hand ausgelöste Durchläufe höchstens alle 10 Sekunden — sonst könnte ein Fremder (oder ein hängender Tab) die Portale so lange belasten, bis Ihre IP-Adresse dort gesperrt wird. |
| **Überlastung** | Höchstens 24 gleichzeitige Live-Verbindungen, Formularinhalte auf 4 KB begrenzt. |

Elf Tests starten dafür einen echten Server und klopfen jeden Pfad ab — die
gefährlichste Lücke wäre einer, den die Weiche schlicht nicht sieht.

---

## Vorab, in aller Deutlichkeit: die 80-Prozent-Marke

Die Anforderung lautete: Aktien anzeigen, die mit **über 80 % Wahrscheinlichkeit**
in den kommenden Stunden steigen. Diese Marke ist die Schwelle im Dashboard und
frei einstellbar — aber sie wird in aller Regel **nicht erreicht**, und das ist
kein Mangel der Umsetzung.

Über wenige Stunden ist Kursbewegung weit überwiegend Rauschen. Wer aus
Chartdaten eine belastbare Trefferquote über 80 % ausweist, hat fast immer
eines von drei Dingen getan: in die Zukunft geschaut, eine zu kleine Stichprobe
für eine Gesetzmäßigkeit gehalten, oder Handelskosten unterschlagen. Belastbar
sind Werte zwischen etwa 50 % und 60 %.

Deshalb liefert dieses Dashboard bewusst **das Erreichbare statt des
Gewünschten**:

- Die Rangliste ordnet fünf Titel nach Wahrscheinlichkeit — auch wenn keiner
  die 80 % reißt. Das ist der eigentliche Nutzen: sie sagt, **wo hinzuschauen
  ist**.
- Erreicht niemand die Schwelle, sagt das Dashboard das ausdrücklich und nennt
  den stärksten Wert. Es rundet nicht auf.
- Zu jeder Zahl stehen **Stichprobengröße**, **Glaubwürdigkeitsband** und
  **Basisquote** daneben. Ohne diese drei Angaben ist eine Prozentzahl in
  diesem Feld wertlos.
- Drei Sperren gegen Schönrechnerei sind fest eingebaut: kausale Berechnung,
  Schrumpfung kleiner Stichproben und ein harter Deckel bei 97 %.

Wer eine dauerhafte Quote über 80 % sieht, sieht einen Fehler — keine
Gelegenheit.

---

## Was das Dashboard zeigt

| Bereich | Inhalt |
| --- | --- |
| **Rangliste** | Die fünf stärksten Kandidaten, Platz 1 hervorgehoben. Wahrscheinlichkeit, Band, Stichprobe, Vorteil gegenüber der Basisquote, typische Bewegung, Kursverlauf, die vier stärksten Signaltreiber, jede Kontextkorrektur einzeln. |
| **Kalibrierung** | Die gemessene Trefferquote je Signalstärke — die Grundlage jeder Prozentzahl, offengelegt. Blasse Balken = zu dünne Stichprobe. |
| **Datenquellen** | Ampel je Portal (erreichbar / gestört / ausgefallen) und das Verfahren in fünf Schritten. |
| **Beobachtungsliste** | Alle geprüften Titel, sortierbar nach jeder Spalte. |

Bedienbar sind Prognosehorizont (1–4 h), Anzeigeschwelle (50–95 %) und
Marktfilter (Deutschland / USA / beide) — am Telefon über die Leiste am unteren
Rand. Horizontwechsel rechnet der Server neu, Schwelle und Filter wirken sofort
in der Anzeige.

**Live-Aktualisierung** über Server-Sent Events: der Server ruft in festem Takt
(Standard 60 s) ab und schiebt jede neue Momentaufnahme in alle offenen
Registerkarten. Ein Abrufzyklus bedient beliebig viele Browser — die Portale
werden nicht je Tab belastet. Bricht die Verbindung ab, baut der Browser sie
selbst wieder auf; der Zustand in der Kopfzeile sagt jederzeit, woran man ist.

---

## Die Datenquellen

Vier Quellen mit unterschiedlichen Rollen — bewusst nicht vier Kursquellen,
sondern vier Blickwinkel:

| Portal | Rolle | Warum |
| --- | --- | --- |
| **Yahoo Finance** (Chart-API) | Intraday-Kerzen, OHLCV | Die einzige frei zugängliche Schnittstelle mit Minutenkerzen für deutsche *und* amerikanische Titel. Zwei Hosts als Rückfallebene. |
| **Stooq** | unabhängige Zweitquelle für den letzten Kurs | Kontrolle, nicht Analyse: weichen zwei Portale deutlich ab, stimmt etwas nicht — dann wird die Wahrscheinlichkeit herabgestuft, statt woanders hingerechnet. Nur *frische* Kurse (< 45 min) werden verglichen; ein Schlusskurs von gestern weicht naturgemäß ab, das wäre kein Fehler, sondern Alter. |
| **Yahoo-Nachrichten** (RSS) | Schlagzeilen der letzten 24 h | Signalwortzählung, deutsch und englisch. Bewusst grob und entsprechend klein gedeckelt: Nachrichten sollen eine Chartlage färben, nicht drehen. Wird nur für die Spitzenkandidaten abgerufen. |
| **Leitindizes** (DAX, S&P 500, Nasdaq) | Marktlage je Region | Dieselbe Signalrechnung, andere Rolle: ein bullischer Einzeltitel im fallenden Gesamtmarkt verdient einen Abschlag. |

Kein API-Schlüssel, keine Abhängigkeiten, keine Registrierung. Alle Abrufe
laufen **serverseitig** — die Portale setzen keine CORS-Freigabe, ein Browser
käme gar nicht an die Daten.

**Fällt ein Portal aus**, bricht nichts ab: die Quellen-Ampel färbt sich, die
betroffenen Titel werden übersprungen oder auf Demo-Daten zurückgestellt — und
Demo-Daten sind an jeder Stelle als solche gekennzeichnet.

---

## Wie die Wahrscheinlichkeit entsteht

Der ehrliche Kern. Die Zahl ist **keine** durch eine Sigmoidfunktion geschickte
Summe von Indikator-Gewichten — das ergibt hübsche, aber bedeutungslose
Prozentzahlen. Sie ist eine **gemessene relative Häufigkeit**:

1. **Merkmale.** Aus den Kerzen werden elf Chart-Merkmale berechnet
   (EMA-Trend, Momentum, MACD, VWAP-Abstand, Regressionssteigung, ADX/DI,
   relatives Volumen, RSI, Bollinger-Position, OBV, Stochastik), jedes an der
   ATR skaliert und auf ungefähr [-1, 1] normiert. Gewichtet ergeben sie den
   **Signalwert z**.

2. **Kausalität.** Jeder vergangene Balken bekommt exakt den Signalwert, den er
   *in Echtzeit* gehabt hätte. Kein Indikator schaut nach vorn. Das ist die
   Voraussetzung dafür, dass Schritt 3 überhaupt etwas wert ist — und es ist
   als Test abgesichert (`Signalberechnung ist kausal`).

3. **Nachzählen.** Über die gesamte Historie des gesamten Universums wird
   gezählt, wie oft eine Signallage dieser Stärke H Balken später zu einem
   höheren Kurs führte — **nach Abzug von Spread und Gebühren** (Standard
   0,05 %). Ein Plus von 0,02 % ist kein Treffer.

4. **Schrumpfen.** „Drei von drei Treffern" sind nicht 100 %. Die Evidenz des
   einzelnen Titels wird als **Beta-Posterior** gegen die gepoolte Evidenz des
   Universums geschrumpft, diese wiederum gegen einen schwachen Prior aus dem
   Signalwert. Punktschätzer und Unsicherheitsband stammen aus derselben
   Verteilung — die angezeigte Zahl liegt deshalb immer im angezeigten Band
   (ebenfalls als Test abgesichert).

5. **Kontext.** Marktlage, Schlagzeilen, Quellenabweichung, dünner Handel und
   veraltete Daten werden additiv in Log-Odds aufgeschlagen, jeder Beitrag auf
   ±0,45 gedeckelt. Ausgewiesen wird jeder Beitrag einzeln — und in
   Prozentpunkten, ermittelt per Weglassprobe, nicht in Log-Odds.

6. **Handelszeit.** Ist die Börse geschlossen, finden die prognostizierten
   Stunden schlicht nicht statt: die Schätzung wird stark zur Mitte gedämpft.
   Kurz vor Handelsschluss wird anteilig gedämpft, weil die Zeit für die
   Bewegung nicht mehr reicht. Feiertage sind nicht gepflegt (eine handgeführte
   Liste ist nach einem Jahr falsch) — sie zeigen sich stattdessen darin, dass
   die Daten nicht frisch sind, und das steht in der Karte.

Zum Schluss ein harter Deckel: **2 % bis 97 %**.

---

## Aufbau

```
stocks/
  server.js              HTTP-Server, JSON-Schnittstelle, Live-Strom (SSE)
  lib/
    auth.js              Kennwort, signierte Sitzung, Versuchsbremse
    indicators.js        reine Indikator-Mathematik, kausal
    features.js          Kerzen -> Merkmalsvektor -> Signalwert
    model.js             Signalwert -> kalibrierte Wahrscheinlichkeit
    engine.js            ein Durchlauf: holen, rechnen, kalibrieren, ranken
    universe.js          Beobachtungsliste DE + US, Leitindizes
    session.js           Handelszeiten, Zeitzonen, Dämpfung
    http.js              Zeitlimit, Wiederholung, Stapelabruf
  providers/
    yahoo.js             Intraday-Kerzen
    stooq.js             Zweitquelle für den letzten Kurs
    news.js              Schlagzeilen und deren Bewertung
    synthetic.js         deterministischer Demo-Generator (Offline-Betrieb)
  public/
    index.html           Seitengerüst
    manifest.webmanifest Angaben für den Home-Bildschirm
    icon.svg             Quelle der App-Symbole
    icon-180/192/512.png App-Symbole (iOS nimmt für das Symbol kein SVG)
    login.html/.css/.js  Anmeldeseite
    dashboard.css        Gestaltung — iPhone zuerst, hell und dunkel
    charts.js            Diagramme als Inline-SVG, ohne Bibliothek
    dashboard.js         Live-Verbindung, Zustand, Darstellung
  test/                  78 Tests
```

`lib/` kennt weder Netz noch DOM und ist vollständig in Node testbar.
`providers/` kapselt jedes Portal hinter derselben Schnittstelle — eine weitere
Quelle ist eine neue Datei, kein Eingriff in die Rechenkette. Die Oberfläche
rechnet bewusst **nichts** nach: alles, was eine Zahl ist, kommt fertig vom
Server. So gibt es keine zweite, abweichende Wahrheit in der Anzeige.

---

## Einstellungen

```bash
node stocks/server.js [Optionen]
```

| Option | Standard | Bedeutung |
| --- | --- | --- |
| `--port` | `4173` | Port des Servers |
| `--refresh` | `60` | Sekunden zwischen zwei Abrufzyklen (Minimum 20) |
| `--horizon` | `3` | Prognosehorizont in Stunden (1–4) |
| `--threshold` | `0.8` | Schwelle, ab der ein Titel als Treffer gilt |
| `--limit` | `40` | Anzahl geprüfter Titel |
| `--markets` | `DE,US` | `DE`, `US` oder beides |
| `--interval` | `5m` | Kerzenraster |
| `--range` | `10d` | Historie für die Kalibrierung |
| `--top` | `5` | Länge der Rangliste |
| `--offline` | aus | Demo-Daten statt Portalabruf |
| `--password` | gemerkt/erzeugt | Zugangskennwort |
| `--password-file` | `stocks/.kennwort` | Ablage des gemerkten Kennworts |
| `--public` | aus | Betrieb hinter einem Tunnel: Kennwort verpflichtend, weitergereichte Absender und HTTPS-Angaben beachten |
| `--no-auth` | aus | Zugangsschutz abschalten — nur im eigenen WLAN vertretbar |
| `--host` | `0.0.0.0` | Adresse, an der gelauscht wird (`127.0.0.1` = nur dieser Rechner) |

Auch als Umgebungsvariablen: `PORT`, `REFRESH`, `OFFLINE`,
`DASHBOARD_PASSWORD`, `PUBLIC`, `HOST`, `TRUST_PROXY`, `KENNWORT_DATEI`.

### Schnittstelle

| Pfad | Zweck |
| --- | --- |
| `GET /api/snapshot?horizon=3` | vollständige Momentaufnahme als JSON |
| `GET /api/stream?horizon=3` | Live-Strom (SSE), Ereignisse `snapshot` und `status` |
| `POST /api/refresh` | Durchlauf sofort anstoßen |
| `GET /api/health` | Zustand des Servers |
| `GET /login`, `POST /login` | Anmeldung |
| `POST /api/logout` | Abmelden |
| `GET /healthz` | Lebenszeichen für Überwachung, ohne Anmeldung |

Alles außer `/healthz`, der Anmeldeseite und den App-Symbolen setzt eine
gültige Sitzung voraus.

---

## Tests

```bash
npm run test:stocks
```

78 Tests über sieben Dateien. Die wichtigsten prüfen nicht Funktionen,
sondern **Zusagen**:

- *Signalberechnung ist kausal* — der Signalwert eines Balkens ändert sich
  nicht, wenn später Daten hinzukommen. Wäre das verletzt, wäre die gesamte
  Kalibrierung wertlos.
- *Kleine Stichproben werden geschrumpft* — fünf Treffer aus fünf Versuchen
  dürfen nie als Gewissheit durchgehen.
- *Der Punktschätzer liegt stets im eigenen Intervall* — eine Zahl außerhalb
  ihres eigenen Konfidenzintervalls ist irreführend.
- *Die Seite ist fürs iPhone ausgezeichnet* — fehlt das Symbol als PNG oder
  der Eintrag für die sicheren Ränder, merkt man das sonst erst auf dem
  Telefon, und zwar als leere Fläche. Zoom darf nie gesperrt sein.
- *Ohne Anmeldung gibt der Server nichts heraus* — gegen einen echten,
  gestarteten Server, Pfad für Pfad. Diese Tests haben beim Schreiben eine
  Weiterleitung ohne Sicherheitskopfzeilen gefunden; seitdem werden die
  Kopfzeilen zentral gesetzt statt an jedem Ausgang einzeln.

Der Demo-Generator ist deterministisch (Startwert aus dem Kürzel), Testläufe
sind daher reproduzierbar.

---

## Grenzen

Was dieses Dashboard **nicht** kann, und zwar grundsätzlich:

- **Es ist keine Anlageberatung** und liefert keine Order-Signale.
- **Der Zugangsschutz ist ein Kennwort, keine Benutzerverwaltung.** Für ein
  Dashboard einer Person ist das angemessen; für mehrere Personen mit
  unterschiedlichen Rechten wäre es zu wenig.
- **Kurse sind verzögert.** Kostenlose Portale liefern für Xetra und die
  US-Börsen typisch 15 Minuten verzögert. Für Sekundenentscheidungen taugt das
  nicht — und mit verzögerten Daten wäre ohnehin nichts zu holen.
- **Kalibriert wird auf zehn Tagen Historie.** Das ist genug für belastbare
  Stichproben, aber zu wenig, um ein verändertes Marktregime zu erkennen.
- **Nachrichten werden per Signalwortzählung bewertet** — das ist eine grobe
  Näherung und keine Sprachanalyse. Ironie, Verneinung und Kontext gehen
  verloren.
- **Feiertage sind nicht gepflegt.** Sie zeigen sich indirekt über veraltete
  Daten.
- **Trefferquote ist nicht Rendite.** Ein Titel kann in 60 % der Fälle leicht
  steigen und in 40 % stark fallen. Deshalb steht die typische Bewegung
  daneben — sie gehört mitgelesen.
