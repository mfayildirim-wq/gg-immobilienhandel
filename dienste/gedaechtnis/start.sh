#!/bin/sh
# Dienst lokal starten: Zugänge aus .env.local, Postgres/Ollama wie in der Probe. Port 8800.
cd "$(dirname "$0")"
set -a; [ -f .env.local ] && . ./.env.local; set +a
exec uv run uvicorn --factory gedaechtnis.dienst:erzeuge --host 127.0.0.1 --port "${PORT:-8800}"
