# Betrieb im Internet — fuer jeden Anbieter, der Container ausfuehrt
# (Render, Railway, Fly.io, Koyeb, eigener Server).
#
# Kein Build-Schritt und kein "npm install": das Projekt hat bewusst keine
# Abhaengigkeiten. Deshalb genuegt es, die Quellen hineinzukopieren.

FROM node:22-alpine

WORKDIR /app
COPY . .

# PUBLIC=true schaltet den Betrieb hinter einem Reverse-Proxy frei:
# weitergereichte Absender und HTTPS-Angaben werden dann beachtet.
ENV NODE_ENV=production \
    PUBLIC=true \
    PORT=4173 \
    REFRESH=120

# DASHBOARD_PASSWORD wird beim Anbieter gesetzt, nicht hier — ein Kennwort
# gehoert nicht in ein Abbild, das weitergegeben werden kann.

EXPOSE 4173

# Nicht als Systemverwalter laufen lassen; das Abbild bringt den Nutzer mit.
USER node

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "stocks/server.js"]
