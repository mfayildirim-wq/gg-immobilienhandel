# syntax=docker/dockerfile:1
# gg-immobilienhandel auf einem eigenen Server (Coolify): ein Container für API und Oberfläche.
# Start: apps/api/src/coolify.ts. Datenbank, Anmeldung und Dateispeicher kommen aus Supabase (selbst gehostet oder Cloud).
FROM node:24-bookworm-slim

# Chromium für PDF-Export und Auto-Import (CHROME_PFAD); Schriften, damit PDFs nicht mit Ersatzschrift gesetzt werden
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation fonts-noto-color-emoji ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Pakete nur aus der Sperrdatei holen: die Schicht bleibt im Zwischenspeicher, solange sich pnpm-lock.yaml nicht ändert
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch

COPY . .
RUN pnpm install --frozen-lockfile --offline

# Vite setzt VITE_* beim Bauen fest ein
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
# Nur für den Stand mit CoSAi-Einbindung: Adresse von agent.js und Kennung der Anwendung im Portal.
# Im Repo steht der lokale Entwicklungswert; ohne diese Argumente bleibt index.html unverändert.
ARG COSAI_AGENT_SKRIPT
ARG COSAI_APP
RUN if [ -n "$COSAI_AGENT_SKRIPT" ] && [ -n "$COSAI_APP" ]; then \
      sed -i -E "s#src=\"[^\"]*/agent\\.js\" data-app=\"[^\"]*\"#src=\"$COSAI_AGENT_SKRIPT\" data-app=\"$COSAI_APP\"#" apps/web/index.html; \
    fi \
 && pnpm --filter @gg/web build

RUN mkdir -p /daten && chown -R node:node /daten /app/apps/api
USER node

# tsx direkt statt über pnpm: corepack bräuchte zur Laufzeit ein beschreibbares Heimverzeichnis
WORKDIR /app/apps/api
ENV NODE_ENV=production \
    PORT=3101 \
    CHROME_PFAD=/usr/bin/chromium
EXPOSE 3101
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=10 \
  CMD curl -fsS http://127.0.0.1:3101/api/health || exit 1
CMD ["node_modules/.bin/tsx", "src/coolify.ts"]
