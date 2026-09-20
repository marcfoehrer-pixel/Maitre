'use strict';

/* Fehlergrund aus der Adresse lesen und danach entfernen, damit er beim
   Neuladen nicht erneut erscheint. */
(() => {
  const reasons = {
    falsch: 'Kennwort falsch.',
    fehlt: 'Bitte das Kennwort eingeben.',
    gesperrt: 'Zu viele Versuche. Bitte einige Minuten warten.',
    abgelaufen: 'Die Anmeldung ist abgelaufen. Bitte erneut anmelden.',
  };
  const params = new URLSearchParams(location.search);
  const reason = params.get('fehler');
  if (reason && reasons[reason]) {
    document.getElementById('errorText').textContent = reasons[reason];
    document.getElementById('error').hidden = false;
    history.replaceState(null, '', location.pathname);
  }
  document.getElementById('password').focus();
})();
