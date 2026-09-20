'use strict';

/**
 * Handelszeiten je Boerse.
 *
 * Feiertage sind hier bewusst nicht gepflegt (eine handgepflegte Liste ist nach
 * einem Jahr falsch). Stattdessen prueft die Engine zusaetzlich, wie alt die
 * letzte Kerze ist — an einem Feiertag bleiben die Daten stehen, und genau das
 * wird im Dashboard als "keine frischen Daten" sichtbar.
 */

const VENUES = {
  XETRA: { tz: 'Europe/Berlin', open: 9 * 60, close: 17 * 60 + 30, label: 'Xetra' },
  US: { tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60, label: 'NYSE/Nasdaq' },
};

/**
 * Versatz einer Zeitzone zum gegebenen Zeitpunkt, in Minuten.
 * Ueber Intl statt ueber feste Werte — sonst bricht alles bei der Umstellung
 * auf Sommerzeit, und zwar in Deutschland und den USA an verschiedenen Tagen.
 */
function tzOffsetMinutes(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return (asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000;
}

/** Ortszeit (Jahr/Monat/Tag + Minuten seit Mitternacht) -> UTC-Zeitstempel. */
function zonedTimeToUtc(year, month, day, minutes, timeZone) {
  const naive = Date.UTC(year, month, day) + minutes * 60000;
  // Zwei Durchgaenge: der erste schaetzt den Versatz, der zweite korrigiert ihn
  // fuer den Fall, dass die Schaetzung ueber eine Umstellung gesprungen ist.
  let ts = naive - tzOffsetMinutes(new Date(naive), timeZone) * 60000;
  ts = naive - tzOffsetMinutes(new Date(ts), timeZone) * 60000;
  return ts;
}

/** Kalenderdatum in der Zielzone, als {year, month, day}. */
function zonedDateParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month - 1, day: +p.day, weekday: p.weekday };
}

function localParts(date, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    weekday: parts.weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function venueState(venueKey, date = new Date()) {
  const venue = VENUES[venueKey] || VENUES.US;
  const { weekday, minutes } = localParts(date, venue.tz);
  const weekend = weekday === 'Sat' || weekday === 'Sun';
  const open = !weekend && minutes >= venue.open && minutes < venue.close;
  const preMarket = !weekend && minutes < venue.open;
  const minutesToClose = open ? venue.close - minutes : 0;
  return {
    venue: venue.label,
    timezone: venue.tz,
    open,
    weekend,
    phase: weekend ? 'Wochenende' : open ? 'Handel' : preMarket ? 'vorboerslich' : 'nachboerslich',
    minutesToClose,
    localMinutes: minutes,
  };
}

/**
 * Daempfungsfaktor fuer die Wahrscheinlichkeit.
 * Geschlossener Markt: die naechsten Stunden finden schlicht nicht statt, das
 * Chartsignal sagt dann fast nichts. Kurz vor Schluss bleibt zu wenig Zeit,
 * damit sich die Prognose ueberhaupt erfuellen kann.
 */
function dampingFactor(state, horizonMinutes) {
  if (!state.open) return 0.25;
  if (state.minutesToClose >= horizonMinutes) return 1;
  return Math.max(0.35, state.minutesToClose / horizonMinutes);
}

module.exports = {
  VENUES, venueState, dampingFactor, tzOffsetMinutes, zonedTimeToUtc, zonedDateParts,
};
