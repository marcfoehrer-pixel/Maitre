'use strict';

/**
 * Sperre nach Drosselung.
 *
 * Antwortet ein Portal mit 429 ("zu viele Anfragen"), ist die einzig richtige
 * Antwort: aufhoeren. Ohne Sperre feuert der naechste Durchlauf dieselben
 * vierzig Anfragen erneut ab, kassiert vierzig Abweisungen und haelt die
 * Drosselung damit selbst am Leben.
 *
 * Die Wartezeit waechst mit jeder Abweisung und faellt beim ersten Erfolg
 * wieder auf null. Nennt das Portal ein `Retry-After`, gilt dieser Wert,
 * sofern er laenger ist.
 */

function createBackoff({ base = 60000, max = 20 * 60000, label = 'Quelle' } = {}) {
  let until = 0;
  let level = 0;
  let lastReason = null;

  return {
    label,

    /** Gesperrt? Dann gar nicht erst anfragen. */
    blocked(now = Date.now()) {
      return now < until;
    },

    /** Verbleibende Sperre in Sekunden — fuer die Anzeige. */
    secondsLeft(now = Date.now()) {
      return Math.max(0, Math.ceil((until - now) / 1000));
    },

    /** Abweisung vermerken und Wartezeit verlaengern. */
    penalise({ retryAfter = 0, reason = null, now = Date.now() } = {}) {
      level = Math.min(level + 1, 5);
      const wait = Math.max(retryAfter * 1000, Math.min(max, base * 2 ** (level - 1)));
      until = Math.max(until, now + wait);
      lastReason = reason;
      return wait;
    },

    /** Erfolg — die Sperre faellt sofort, nicht schrittweise. */
    succeed() {
      level = 0;
      until = 0;
      lastReason = null;
    },

    state(now = Date.now()) {
      return {
        blocked: now < until,
        secondsLeft: Math.max(0, Math.ceil((until - now) / 1000)),
        level,
        reason: lastReason,
      };
    },
  };
}

module.exports = { createBackoff };
