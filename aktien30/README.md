# Aktien-Ranking · 30 Tage

Ein Balkenranking aller Werte aus **DAX, Nasdaq-100 und Dow Jones** (rund 165 Titel).
Je Aktie beantwortet es eine Frage:

> **Wie wahrscheinlich ist es, dass die Aktie in den nächsten 30 Tagen nie mehr
> als 5 % unter den heutigen Kurs fällt *und* am Ende höher steht?**

Die Prozentzahl ist **gemessen, nicht geschätzt**. Sie gibt an, wie oft genau
dieses Ereignis in den letzten Jahren eintrat, wenn ein Titel charttechnisch
ähnlich dastand und ähnlich stark schwankte.

## Abrufen, wann Sie wollen: ohne eigenen Rechner

Die Berechnung läuft auf GitHub, das Ergebnis ist eine Webseite:

**https://marcfoehrer-pixel.github.io/Maitre/**

- **Automatisch:** Werktags nach US-Börsenschluss wird die Seite neu berechnet,
  sodass sie morgens aktuell ist.
- **Auf Knopfdruck:** In der GitHub-App oder auf github.com unter
  **Actions → Aktien-Ranking 30 Tage → Run workflow**. Nach etwa 2–5 Minuten
  zeigt die Seite den neuen Stand.

Tipp fürs iPhone: Seite in Safari öffnen, dann **Teilen → „Zum Home-Bildschirm“**.

### Einmalige Einrichtung (2 Minuten)

1. Im Repository **Settings → Pages → Source: „GitHub Actions“** wählen.
2. **Actions → Aktien-Ranking 30 Tage → Run workflow** einmal anstoßen.

**Nur falls der Lauf meldet, dass Yahoo keine Kurse liefert:** Yahoo weist
Anfragen von Rechenzentren zeitweise ab. Dann springt Twelve Data ein:

1. Kostenlosen Schlüssel holen: [twelvedata.com](https://twelvedata.com/pricing) → *Basic (free)*.
2. **Settings → Secrets and variables → Actions → New repository secret**,
   Name `TWELVEDATA_API_KEY`, Wert = Schlüssel.

Der kostenlose Tarif erlaubt 8 Abrufe je Minute. Ein Lauf über Twelve Data
dauert daher rund 20 Minuten, verursacht aber keine Kosten.

## Lokal starten

Node.js 18 oder neuer, keine weiteren Abhängigkeiten:

```bash
npm run aktien           # schreibt aktien30/ausgabe/index.html
npm run test:aktien      # Tests
```

## So entsteht die Zahl

**1. Charttechnik-Score (0–100)**, aus vier Bausteinen:

| Baustein | Punkte | Kriterien |
| --- | --- | --- |
| Trend | 35 | Kurs über GD 50 · GD 50 über GD 200 · GD 50 steigt |
| Momentum | 25 | 3-Monats-Rendite positiv · MACD-Histogramm positiv und steigend |
| RSI (14) | 20 | voll bei 45–65, abgestuft darüber und darunter |
| 52-Wochen-Hoch | 20 | voll bei weniger als 5 % Abstand, abgestuft bis 20 % |

**2. Messung an der Vergangenheit.** Für jeden Titel wird an jedem dritten
Handelstag der letzten fünf Jahre derselbe Score berechnet. Danach wird
nachgesehen, was in den folgenden 21 Handelstagen (≈ 30 Kalendertage)
tatsächlich geschah:

- *sicher*: Das Tagestief lag nie mehr als 5 % unter dem Ausgangskurs.
- *steigend*: Nach 21 Handelstagen stand der Kurs höher.

Die Fälle aller Titel bilden eine Tabelle aus 5 Score-Stufen × 5 Schwankungs-Stufen.
Die Schwankung gehört dazu, weil sie das 5-%-Risiko stärker bestimmt als jedes
Chartsignal. Die heutige Wahrscheinlichkeit ist die Trefferquote der passenden
Zelle. Sie wird vorsichtig an das Eigenverhalten des Titels angepasst, um
höchstens ±30 %.

**3. Gegenprobe.** Die Tabelle wird zusätzlich nur mit Daten bis vor einem Jahr
gebaut und am letzten Jahr geprüft. Die Seite zeigt, wie oft die oberen 20 %
des Rankings in diesem Jahr tatsächlich trafen, verglichen mit dem Durchschnitt.
So sehen Sie auf einen Blick, ob das Signal gerade trägt.

## Grenzen

- Charttechnik beschreibt Muster der Vergangenheit. Quartalszahlen, Nachrichten
  und Marktschocks erfasst sie nicht. **Keine Anlageberatung.**
- Die Indexlisten in `universum.js` sind von Hand gepflegt. Die Indizes werden
  quartalsweise angepasst. Ein nicht mehr gehandelter Titel wird übersprungen
  und auf der Seite als fehlend ausgewiesen.
- Titel mit weniger als einem Jahr Kurshistorie bleiben ohne Bewertung.
