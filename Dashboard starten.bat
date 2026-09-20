@echo off
title Aktien-Dashboard
REM
REM Doppelklick-Starter fuer Windows.
REM
REM Entspricht "Dashboard starten.command" unter macOS: Voraussetzung pruefen,
REM verstaendlich melden was fehlt, sonst den Server starten.

cd /d "%~dp0"
cls
echo Aktien-Dashboard wird gestartet ...
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js fehlt.
  echo.
  echo   Bitte einmalig installieren:
  echo     1. https://nodejs.org wird gleich geoeffnet
  echo     2. Dort die grosse Schaltflaeche mit LTS anklicken
  echo     3. Geladene Datei ausfuehren, Installation durchklicken
  echo     4. Danach diese Datei hier wieder doppelklicken
  echo.
  timeout /t 3 >nul
  start https://nodejs.org/de/download
  pause
  exit /b 1
)

echo Kurse werden abgerufen, das dauert einen Moment ...
echo.
echo Falls Windows nach Netzwerkzugriff fuer Node.js fragt: ZULASSEN.
echo Sonst kann das iPhone den Server nicht erreichen.
echo.
node stocks\server.js %*
echo.
echo Der Server wurde beendet.
pause
