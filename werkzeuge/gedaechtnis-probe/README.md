# Gedächtnis-Probe: Mem0 gegen Cognee

Gleiche Testdaten (`szenario.json`) für beide Engines: zwei Apps einer Firma (`gg`, `desk`) und eine fremde Firma.
Einträge kommen aus App-Ereignissen (API) und aus einem KI-Gespräch (MCP). 8 Fragen prüfen das Wiederfinden,
das Lesen über Apps hinweg und die Trennung (ohne Freigabe bzw. fremde Firma).

Alles lokal: Postgres 17 + pgvector in Docker (Port 55440), Sprachmodell `mistral-small3.2` und Embeddings `bge-m3` über Ollama.
Die Kosten sind auf Claude Haiku 4.5 umgerechnet (1 $ / 5 $ je 1 Mio. Token ein/aus), Embeddings nicht eingerechnet.

## Starten

```bash
docker run -d --name gedaechtnis-probe-pg -e POSTGRES_PASSWORD=probe -e POSTGRES_DB=probe -p 127.0.0.1:55440:5432 pgvector/pgvector:pg17
docker exec gedaechtnis-probe-pg psql -U postgres -c "create database cognee"
ollama pull mistral-small3.2 && ollama pull bge-m3
uv venv -p 3.12 .venv-mem0   && VIRTUAL_ENV=.venv-mem0   uv pip install mem0ai "psycopg[binary]" psycopg-pool ollama
uv venv -p 3.12 .venv-cognee && VIRTUAL_ENV=.venv-cognee uv pip install "cognee[postgres,ollama]"
MEM0_TELEMETRY=False .venv-mem0/bin/python probe_mem0.py
.venv-cognee/bin/python probe_cognee.py
```

Ergebnisse stehen in `ergebnisse/*.json` (Treffer je Frage, Zeiten, Token).

## Ergebnis (24.10.2026, Mem0 2.2.1, Cognee 1.6.5)

| | Mem0 | Cognee |
|---|---|---|
| Fragen richtig | 8/8 (mit deutscher Extraktionsanweisung; ohne: 6/8, Fakten teils englisch) | 8/8 |
| Ablage App-Ereignis | wörtlich, ohne KI (`infer=False`), kostenlos | Text → `cognify` (Wissensgraph), immer mit KI |
| Ablage KI-Gespräch | 1 KI-Aufruf, ≈ 8.800 Token ein → ≈ 0,01 $ | im selben `cognify`; 6 Dokumente: 15 Aufrufe ≈ 0,027 $ |
| Suche | nur Embedding, ohne KI, ≈ 0,1 s | `GRAPH_COMPLETION` mit KI-Antwort, ≈ 6.400 Token je Frage ≈ 0,007 $ |
| Antwort | Liste von Fakten mit Score und Herkunft (App, Bezug) | fertiger Antwortsatz, je Datensatz einer |
| Trennung | nur per Filter (`user_id` = Firma, `agent_id` = App) — Rechte muss unser Dienst prüfen | echte Rechte: Nutzer je App, Leserecht je Datensatz; fremder Zugriff → `PermissionDeniedError` |
| Speicher | eine Tabelle in Postgres (pgvector) + SQLite-Verlauf | eine Datenbank, je Datensatz ein Schema (`pgvector_shared`, `postgres_graph_shared`); ohne diese Schalter je Datensatz eine eigene Datenbank |
| Aktualisieren (noch nicht geprüft) | KI entscheidet bei `infer=True` ADD/UPDATE/DELETE gegen Bestehendes | neue Dokumente; altes bleibt, bis man es löscht |

Beobachtungen:
- `nomic-embed-text` (englisch) findet deutsche Fragen schlecht; `bge-m3` (mehrsprachig) ist nötig.
- Cognee liefert bei Suche über mehrere Datensätze je Datensatz eine Antwort („nicht im Kontext“ + richtige Antwort) — der Dienst muss zusammenführen.
- Cognee ist lokal langsam (cognify 2 min, 8 Fragen ≈ 3 min); mit Haiku deutlich schneller, aber teurer als Mem0.
