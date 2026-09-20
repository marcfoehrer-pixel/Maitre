#!/bin/bash
#
# Doppelklick-Starter fuer macOS.
#
# Der Weg ueber das Terminal ist fuer den taeglichen Gebrauch zu umstaendlich:
# Befehle abtippen, Verzeichnis wechseln, Umgebungsvariablen setzen. Diese
# Datei erledigt das und zeigt am Ende gross und lesbar, was man am iPhone
# eingeben muss.

cd "$(dirname "$0")" || exit 1

fett=$(printf '\033[1m'); normal=$(printf '\033[0m')
blau=$(printf '\033[34m'); rot=$(printf '\033[31m')

clear 2> /dev/null || true
echo "${fett}Aktien-Dashboard wird gestartet …${normal}"
echo

# Node ist die einzige Voraussetzung. Ohne klare Ansage wuerde der Start hier
# mit einer kryptischen Meldung abbrechen.
if ! command -v node > /dev/null 2>&1; then
  echo "${rot}${fett}Node.js fehlt.${normal}"
  echo
  echo "  Bitte einmalig installieren:"
  echo "    1. https://nodejs.org oeffnet sich gleich"
  echo "    2. Dort die grosse Schaltflaeche mit ${fett}LTS${normal} anklicken"
  echo "    3. Geladene Datei doppelklicken, Installation durchklicken"
  echo "    4. Danach diese Datei hier wieder doppelklicken"
  echo
  sleep 3
  open "https://nodejs.org/de/download" 2>/dev/null
  echo "Fenster kann geschlossen werden."
  read -r -p "" _
  exit 1
fi

version=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$version" -lt 18 ] 2>/dev/null; then
  echo "${rot}Node.js ist zu alt ($(node -v)). Benoetigt wird Version 18 oder neuer.${normal}"
  echo "Bitte von https://nodejs.org die LTS-Fassung installieren."
  read -r -p "Zum Schliessen Enter druecken." _
  exit 1
fi

echo "${blau}Kurse werden abgerufen, das dauert einen Moment …${normal}"
echo

# exec: der Server tritt an die Stelle dieses Skripts. Schliesst man das
# Fenster, ist auch der Server beendet — kein unsichtbarer Rest.
exec node stocks/server.js "$@"
