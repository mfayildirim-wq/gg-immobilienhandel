# Gedächtnis-Dienst (Prototyp)

Zentrales Gedächtnis für Apps und KI: **Mem0** (Postgres + pgvector) mit einer eigenen Schicht davor.
Apps sprechen **REST** (`/v1/…`), KI-Clients **MCP** (`/mcp`, Streamable HTTP) — beide mit demselben Schlüssel.
Hintergrund und Vergleich mit Cognee: `../../werkzeuge/gedaechtnis-probe/README.md`.

## Was die Schicht vor Mem0 tut

- **Mandant und App aus dem Schlüssel** (Mem0: `user_id` = Mandant, `agent_id` = App). Wer schreibt, bestimmt nie der Aufrufer.
- **Freigaben:** Lesen in der eigenen App und in freigegebenen Apps desselben Mandanten (`"*"` = alle). Über Mandanten nie.
  Schreiben, Ändern, Löschen nur in der eigenen App. Gesucht wird je App einzeln; Treffer außerhalb der Freigabe werden zusätzlich verworfen.
- **Ersetzen** (Mem0 2.x legt nur an):
  - `ereignis` (App, wörtlich, ohne KI) ersetzt den letzten Eintrag gleicher `art` am selben `objekt`.
  - `merken` (KI zieht Fakten heraus) prüft mit einem kleinen KI-Aufruf gegen die Einträge zum selben `objekt`.
  - Überholtes bekommt ein Ablaufdatum (`abgeloest_durch`), gelöscht wird nichts — der Verlauf bleibt.
  - **App-Ereignisse sind maßgeblich:** sie ersetzt nur ein neues Ereignis der App, nie ein KI-Fakt (sonst löste
    „nur per E-Mail kontaktieren“ die Telefonnummern aus gg ab).
  - Jedes `merken` läuft mit eigener Lauf-Kennung: Mem0 gäbe sonst die letzten Nachrichten der App als Kontext mit,
    und das Modell legte daraus alte Fakten neu an.
- **Protokoll:** jede Ablage, Suche, Änderung in `gedaechtnis_protokoll` (wer, App, was, wann).

## Schnittstellen

| REST | MCP-Werkzeug | Was |
|---|---|---|
| `POST /v1/ereignis` `{text, objekt, art}` | – | App-Ereignis wörtlich ablegen |
| `POST /v1/merken` `{text \| nachrichten, objekt?}` | `merken` | Fakten aus Text/Gespräch |
| `POST /v1/suchen` `{frage, objekt?, apps?, anzahl?}` | `suchen` | Suche (Score, App, Bezug, Quelle) |
| `GET /v1/eintraege?objekt=` | `eintraege_zu` | gültige Einträge zu einem Bezug |
| `PATCH /v1/eintraege/{id}` `{text}` | – | von Hand korrigieren |
| `DELETE /v1/eintraege/{id}` | `vergessen` | löschen |
| `GET /v1/protokoll` | – | Protokoll der lesbaren Apps |
| `GET /v1/ich` | – | eigener Zugang |

`objekt` ist ein freier Bezug, z. B. `gg:makler:<id>`, `gg:deal:<id>`.

## Lokal starten

Voraussetzungen wie in der Probe: Postgres-Container `gedaechtnis-probe-pg` (Port 55440), Ollama mit `mistral-small3.2` und `bge-m3`.

```bash
uv sync
uv run python zugang_erzeugen.py claude ivtag claude '*'   # label mandant app [lesen] [nur-lesen]
uv run python zugang_erzeugen.py gg ivtag gg desk
./start.sh                                                  # http://127.0.0.1:8800  (Doku: /docs)
uv run pytest -q                                            # Rechte, Ersetzen, MCP (ohne Modell)
uv run python rauchtest.py                                  # Durchlauf mit echtem Mem0 (braucht gg, desk, fremd, claude)
```

Schlüssel stehen nur in `.schluessel.local.json`, die Hashes in `.env.local` (beide nicht im Repo).
Mit Claude statt lokal: `GEDAECHTNIS_LLM=anthropic` und `ANTHROPIC_API_KEY` in der Umgebung.

## Claude Code verbinden

```bash
claude mcp add-json -s user gedaechtnis-lokal "$(python3 -c 'import json;k=json.load(open(".schluessel.local.json"))["claude"];print(json.dumps({"type":"http","url":"http://127.0.0.1:8800/mcp","headers":{"Authorization":"Bearer "+k}}))')"
```

## Server (Coolify-Host 157.90.119.156)

`https://gedaechtnis.157.90.119.156.sslip.io` — `Dockerfile` + `docker-compose.yml` in `/opt/gedaechtnis`, hinter dem
Coolify-Traefik (Netz `coolify`, Let's Encrypt), eigene Postgres mit pgvector. Modell: Haiku; Embeddings: fastembed
`paraphrase-multilingual-MiniLM-L12-v2` (im Image, ohne GPU/Ollama).

```bash
ZIEL=server uv run python zugang_erzeugen.py gg ivtag gg '*'      # Schlüssel → .schluessel.server.json, Hashes → .env.server
rsync -az --exclude-from=.dockerignore Dockerfile docker-compose.yml .dockerignore pyproject.toml uv.lock gedaechtnis root@157.90.119.156:/opt/gedaechtnis/
grep '^GEDAECHTNIS_ZUGAENGE=' .env.server | ssh root@157.90.119.156 'cd /opt/gedaechtnis && grep -v "^GEDAECHTNIS_ZUGAENGE=" .env > .env.neu && cat >> .env.neu && mv .env.neu .env'
ssh root@157.90.119.156 'cd /opt/gedaechtnis && docker compose up -d --build'
ZIEL=server uv run python rauchtest.py https://gedaechtnis.157.90.119.156.sslip.io   # Zugänge rt-* in eigenen Mandanten
```

Auf dem Server steht in `/opt/gedaechtnis/.env`: `POSTGRES_PASSWORD`, `GEDAECHTNIS_HOST`, `ANTHROPIC_API_KEY`, `GEDAECHTNIS_ZUGAENGE` (nur Hashes).

## Offen

- Betrieb außerhalb des Rechners (eigener Server/Container), Embeddings dort (bge-m3 selbst oder ein Anbieter).
- Zugänge in einer Tabelle statt Umgebungsvariable, Oberfläche zum Verwalten.
