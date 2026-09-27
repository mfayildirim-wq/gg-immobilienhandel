# AgentMode: Einstellungen (Dos & Don'ts, Anbieter) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eine Einstellungsseite für den Agenten: feste Grundregeln (nicht löschbar), ergänzbare Listen „Immer“ (Dos) und „Nie“ (Don'ts), Wahl des Modellanbieters (Anthropic, OpenAI, DeepSeek, Kimi) und des Modells. Erreichbar über ⚙ im Agenten-Block und unter Einstellungen → AgentMode.

**Wunsch des Auftraggebers (27.09.):** „Der Agent darf niemals von sich aus Aktionen ausführen“ — als feste Grundregel sichtbar, im Code ohnehin erzwungen (Bestätigung vor jedem Schreiben, Morgenlauf nur lesend).

**Architecture:**
- Kern: DNA um `nie` (Don'ts), `anbieter`, `modell` erweitert. `GRUNDREGELN` stehen im Code und immer im Systemtext. Die gespeicherte DNA liegt in `cosai.agenten` (slug `meister`, Version 1) und wird bei jedem Lauf gelesen. `modell` darf eine Funktion sein (`(wahl) => Modell | null`) — der Host baut damit das Modell des gewählten Anbieters.
- Routen: `GET /einstellungen` (Grundregeln, Immer, Nie, Anbieter, Modell, verfügbare Anbieter), `PUT /einstellungen` (geprüft: ≤ 30 Einträge à ≤ 300 Zeichen, Anbieter aus der Liste).
- Host: Zugänge `deepseek-api-key`, `moonshot-api-key` (Kimi); OpenAI-Schlüssel gilt auch für den Agenten. OpenAI-kompatible Anbieter über `@langchain/openai` mit `baseURL`, Werkzeuge nacheinander (`parallel_tool_calls: false`).
- Web: Seite `Einstellungen → AgentMode`; ⚙ im Block führt dorthin.

## Tasks
1. Kern: DNA-Felder, `GRUNDREGELN`, Systemtext; Tests (Systemtext enthält Grundregeln, Immer, Nie).
2. Kern: `einstellungen()` / `einstellungenSpeichern()` + gelesene DNA je Lauf; Modell-Wahl als Funktion; Tests.
3. Routen + Test (Prüfung der Eingabe).
4. Modellfabrik `openaiKompatibel()` im Kern; Host: Anbieter-Liste, Zugänge, Modellwahl; Test der Fabrik.
5. Web: Einstellungsseite, ⚙ im Block; Klicktest „Regel ergänzen, bleibt nach Neuladen“.
6. Doku (README, OFFEN, Protokoll 20).
