# Aktien-Kurzfristprognose

Ein Dashboard, das deutsche und amerikanische Aktien danach ordnet, wie
wahrscheinlich ein **höherer Kurs in den kommenden Stunden** ist — mit einer
Zahl, die nicht geraten, sondern an der Vergangenheit **gemessen** ist.

```bash
npm run stocks          # Live-Betrieb, http://localhost:4173
npm run stocks:demo     # ohne Netz, mit erzeugten Demo-Daten
npm run test:stocks     # 48 Tests
```

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
Marktfilter (Deutschland / USA / beide). Horizontwechsel rechnet der Server neu,
Schwelle und Filter wirken sofort in der Anzeige.

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
    dashboard.css        Gestaltung, hell und dunkel, ab 390 px
    charts.js            Diagramme als Inline-SVG, ohne Bibliothek
    dashboard.js         Live-Verbindung, Zustand, Darstellung
  test/                  48 Tests
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

Auch als Umgebungsvariablen: `PORT`, `REFRESH`, `OFFLINE`.

### Schnittstelle

| Pfad | Zweck |
| --- | --- |
| `GET /api/snapshot?horizon=3` | vollständige Momentaufnahme als JSON |
| `GET /api/stream?horizon=3` | Live-Strom (SSE), Ereignisse `snapshot` und `status` |
| `POST /api/refresh` | Durchlauf sofort anstoßen |
| `GET /api/health` | Zustand des Servers |

---

## Tests

```bash
npm run test:stocks
```

48 Tests über vier Dateien. Die drei wichtigsten prüfen nicht Funktionen,
sondern **Zusagen**:

- *Signalberechnung ist kausal* — der Signalwert eines Balkens ändert sich
  nicht, wenn später Daten hinzukommen. Wäre das verletzt, wäre die gesamte
  Kalibrierung wertlos.
- *Kleine Stichproben werden geschrumpft* — fünf Treffer aus fünf Versuchen
  dürfen nie als Gewissheit durchgehen.
- *Der Punktschätzer liegt stets im eigenen Intervall* — eine Zahl außerhalb
  ihres eigenen Konfidenzintervalls ist irreführend.

Der Demo-Generator ist deterministisch (Startwert aus dem Kürzel), Testläufe
sind daher reproduzierbar.

---

## Grenzen

Was dieses Dashboard **nicht** kann, und zwar grundsätzlich:

- **Es ist keine Anlageberatung** und liefert keine Order-Signale.
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
