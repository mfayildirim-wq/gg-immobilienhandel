# AgentMode — Umsetzungsplan (Lieferung 1: Vertrag, Kern, Host gg-immo, Oberfläche)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CoSAi als Bibliothek in TypeScript (`@cosai/kern`, `@cosai/agentmode`) mit LangGraph.js, eingebaut in gg-immo: ein Agent, der über einen Kanal die Oberfläche beobachtet und sichtbar bedient, Chips vorschlägt, ein Gedächtnis hat und im Overlay oder auf der Seite `/agent` spricht und mitschreibt.

**Architecture:** Zwei Pakete im Monorepo ohne Import aus `@gg/*` (später herauslösbar): `packages/cosai-kern` (Vertrag als zod, Schema `cosai` als Drizzle, Werkzeugkatalog aus OpenAPI, Gedächtnis, LangGraph-Graph mit Meister-Knoten und Bestätigungs-Unterbrechung, Drizzle-Checkpointer, Hono-Routen) und `packages/cosai-agentmode` (React: Sprechkreis mit Stilwahl, Sprechblasen, Chips, Kommunikationsleiste, Schaufenster, Kanal-Client, Web Speech). gg-immo ist Host: Schema-Migration, `data-agent`-Ziele + Oberflächenkarte, Routen unter `/api/agent`, Overlay + Seite `/agent`. Schreiben nur über die Oberfläche in der Sitzung des Nutzers; Lesen über OpenAPI-Werkzeuge in-process (`app.request`).

**Tech Stack:** TypeScript, zod 4, drizzle-orm (pgSchema `cosai`), `@langchain/langgraph` 1.4, `@langchain/core`, `@langchain/anthropic`, Hono, React 19, Web Speech API, vitest, Playwright.

---

## Dateistruktur

```
packages/cosai-kern/
  package.json                 @cosai/kern — exports ".", "./schema", "./hono", "./vertrag"
  tsconfig.json
  src/vertrag.ts               zod: DNA, Ereignis (Beobachtung/Steuerung), Chip, GedaechtnisEintrag, Antwort
  src/schema.ts                drizzle pgSchema('cosai'): agenten, faehigkeiten, sitzungen, nachrichten, ereignisse, gedaechtnis, laeufe, checkpoints, checkpoint_writes, vorschlaege
  src/katalog.ts               OpenAPI-Dokument → Werkzeuge (Name, Beschreibung, Methode, Pfad, Parameter-Schema, lesend/schreibend)
  src/gedaechtnis.ts           merke / erinnere / verlauf / loeschen über drizzle
  src/checkpointer.ts          BaseCheckpointSaver über drizzle (Tabellen checkpoints, checkpoint_writes)
  src/modell.ts                ModellVertrag (BaseChatModel), Attrappe mit Drehbuch für Tests
  src/graph.ts                 StateGraph: meister → (werkzeuge | steuerung | bestaetigung) → meister; interrupt vor `sende`
  src/kern.ts                  agentKern({db, schema, openapi, modell, aufruf, nutzerAus}) → { nachricht, entscheidung, ereignis, gedaechtnis, stand }
  src/hono.ts                  agentRouten(kern) → Hono-Unterapp (/sitzung, /nachricht, /entscheidung, /ereignis, /gedaechtnis, /stand)
  src/index.ts
  test/katalog.test.ts, gedaechtnis.test.ts, checkpointer.test.ts, graph.test.ts, hono.test.ts
packages/cosai-agentmode/
  package.json                 @cosai/agentmode — React-Komponenten, peer react
  src/Sprechkreis.tsx          Stile: kern (CoSAi-Leuchtkern), puls, orbit; Zustände ruhig/hoert/denkt/spricht
  src/konstellation.ts         aus CoSAi übernommen
  src/Sprechblasen.tsx, Chips.tsx, Kommunikationsleiste.tsx, Gedaechtnisleiste.tsx
  src/Schaufenster.tsx         Overlay: Schleier, Hervorhebung des Ziels, Etikett, Geisterzeiger, „Übernehmen“
  src/kanal.ts                 Kanal-Client: Beobachtung senden, Steuerung ausführen (data-agent), Ziele finden
  src/sprache.ts               useVorlesen (aus CoSAi), useZuhoeren (SpeechRecognition)
  src/AgentMode.tsx            Overlay + Seite aus einer Komponente; Kontext-Provider
  src/agentmode.css
  src/index.ts
  test/kanal.test.ts, konstellation.test.ts, Sprechkreis.test.tsx
apps/api/src/app.ts            mountet agentRouten unter /api/agent; auth setzt c.set('nutzer', email)
packages/db/src/schema.ts      export * from '@cosai/kern/schema'; drizzle.config schemaFilter ['fach','cosai']
supabase/migrations/…_cosai.sql
apps/web/src/agent/oberflaechenkarte.ts   Liste der Ziele mit Beschreibung
apps/web/src/agent/AgentSeite.tsx         Route /agent
apps/web/src/components/AppRahmen.tsx     Schalter „AgentMode“, Overlay eingebunden
apps/web/src/components/... data-agent-Marken (Ankauf-Liste, Deal-Reiter, Kommentar, Senden, Anrufergebnis)
tests/e2e/agentmode.spec.ts
```

## Lieferung 1 — Tasks

### Task 1: Paket `@cosai/kern` anlegen, Vertrag als zod
- [ ] package.json, tsconfig, vitest; Abhängigkeiten: zod, drizzle-orm, @langchain/core, @langchain/langgraph, @langchain/anthropic, hono (peer)
- [ ] `src/vertrag.ts`: `Ziel` (string `bereich.objekt.aktion`), `Beobachtung` {art: navigation|klick|eingabe|gespeichert, ziel, wert?, kontext}, `Steuerung` {art: navigiere|oeffne|fuelle|sende|markiere|zeige|sprich, ziel?, wert?, text?}, `Chip` {label, wert, art: entscheidung|vorschlag}, `DNA` {slug, name, rolle, werkzeuge[], regeln[], beispiele[], version, fingerabdruck}, `GedaechtnisEintrag` {art: episode|formulierung|fakt|routine, schluessel, inhalt, haeufigkeit, zuletzt}, `AgentAntwort` {text, steuerung[], chips[], wartetAuf?: 'bestaetigung'}
- [ ] Test: Beispiele parsen, ungültige Ereignisse abgelehnt; `z.toJSONSchema` liefert JSON-Schema für den Vertrag
- [ ] Commit

### Task 2: Schema `cosai` als Drizzle + Migration in gg-immo
- [ ] `src/schema.ts` mit pgSchema('cosai') und den Tabellen (siehe Dateistruktur); Fachbezüge nur als Werte in `kontext` jsonb
- [ ] `packages/db/src/schema.ts` re-exportiert, drizzle.config `schemaFilter: ['fach','cosai']`, `pnpm db:generate` → Migration; lokal einspielen (`pnpm db:reset` oder `supabase db push` lokal)
- [ ] Test (`packages/db/test`): Tabellen im Schema `cosai` vorhanden
- [ ] Commit

### Task 3: Werkzeugkatalog aus OpenAPI
- [ ] `katalog.ts`: `werkzeugeAusOpenapi(doc, {nurLesend?})` → `Werkzeug[]` {name (`get_api_deals_id`), beschreibung, methode, pfad, parameter (zod aus JSON-Schema: nur path/query/body flach), lesend}
- [ ] Test mit einem kleinen OpenAPI-Dokument und mit dem echten von gg-immo (`app.getOpenAPIDocument`)
- [ ] Commit

### Task 4: Gedächtnis
- [ ] `gedaechtnis.ts`: `gedaechtnis(db, nutzer)` → `merke(art, schluessel, inhalt, kontext?)` (Formulierung: gleicher Text → haeufigkeit+1, zuletzt), `erinnere(art, schluessel?, n)` (nach haeufigkeit, zuletzt), `verlauf(sitzungId)`, `loeschen(id)`
- [ ] Test gegen lokale DB (übersprungen ohne DATABASE_URL)
- [ ] Commit

### Task 5: Drizzle-Checkpointer
- [ ] `checkpointer.ts`: Klasse `DrizzleSaver extends BaseCheckpointSaver` mit getTuple/list/put/putWrites/deleteThread über `checkpoints`/`checkpoint_writes`, Serialisierung mit `JsonPlusSerializer`
- [ ] Test: put → getTuple; Unterbrechung eines Graphen und Wiederaufnahme mit `Command({resume})` über den Saver
- [ ] Commit

### Task 6: Modell-Attrappe und Graph
- [ ] `modell.ts`: `modellAttrappe(drehbuch: AIMessage[])` (BaseChatModel, bindTools gibt sich selbst zurück), `anthropicModell(key, modell)`
- [ ] `graph.ts`: Zustand {messages, nutzer, sitzungId, ort, kontext, steuerung: Steuerung[], chips: Chip[]}; Werkzeuge: lesende OpenAPI-Werkzeuge (aufruf), `steuere(aktionen)`, `chips(liste)`, `merke`, `erinnere`; Knoten `meister` (LLM), `werkzeuge` (führt aus; `steuere` mit `sende` → `interrupt({frage, aktion})`), Kanten by tool_calls; Systemtext aus DNA + Oberflächenkarte + Gedächtnis-Auszug
- [ ] Test: Drehbuch „navigiere + fuelle + sende“ → Antwort wartetAuf bestaetigung; `entscheidung('ja')` → sende in steuerung; lesendes Werkzeug ruft `aufruf`
- [ ] Commit

### Task 7: Kern-Fassade und Hono-Routen
- [ ] `kern.ts`: `agentKern(opt)`; `nachricht({nutzer, sitzungId?, text, ort, kontext})` → AgentAntwort (legt Sitzung/Nachrichten an, Episoden ins Gedächtnis); `entscheidung({sitzungId, wert})`; `ereignis(beobachtung)` (speichert, `gespeichert` → Formulierung merken); `gedaechtnis.liste/loeschen`; `stand()`
- [ ] `hono.ts`: Unterapp mit zod-Validierung; `nutzerAus(c)`
- [ ] Test: Routen mit Attrappe gegen lokale DB
- [ ] Commit

### Task 8: gg-immo als Host (API)
- [ ] `auth.ts`: `c.set('nutzer', email || 'lokal')`; `AppKontext.agent?: { modell?: BaseChatModel }`; `kontext.ts` baut Anthropic-Modell aus `ANTHROPIC_API_KEY`, Attrappe bei KI_ATTRAPPE
- [ ] `app.ts`: `app.route('/api/agent', agentRouten(kern))`, `aufruf` über `app.request` mit dem Authorization-Header des Nutzers, `openapi` aus `app.getOpenAPI31Document`
- [ ] Test `apps/api/test/agent.test.ts`: `/api/agent/nachricht` mit Attrappe
- [ ] Commit

### Task 9: Paket `@cosai/agentmode` — Sprechkreis mit Stilwahl, Sprechblasen, Chips
- [ ] `konstellation.ts` (aus CoSAi), `Sprechkreis.tsx` mit `stil: 'kern'|'puls'|'orbit'`, `zustand: 'ruhig'|'hoert'|'denkt'|'spricht'`, `pegel` (0–1), Saat; CSS-Animationen
- [ ] `Sprechblasen.tsx` (letzte Agent-/Nutzer-Aussage), `Chips.tsx`
- [ ] Tests: konstellation deterministisch; Sprechkreis rendert alle drei Stile
- [ ] Commit

### Task 10: Kanal-Client und Schaufenster
- [ ] `kanal.ts`: `zielFinden(ziel)` (`[data-agent="…"]`), `ausfuehren(steuerung, {navigiere})` (oeffne → click, fuelle → native setter + input-Event, sende → click, markiere → Klasse), `beobachten(root, senden)` (Klicks auf `[data-agent]`, Eingaben bei blur, `gespeichert` über `document.dispatchEvent(new CustomEvent('agent:gespeichert'))`)
- [ ] `Schaufenster.tsx`: Schleier über `children`, `pointer-events: none` solange `aktiv`, Hervorhebung + Etikett + Geisterzeiger am Ziel, Knopf „Übernehmen“
- [ ] Tests (jsdom): ausfuehren setzt Wert und löst Events aus; beobachten meldet Klick mit Ziel
- [ ] Commit

### Task 11: AgentMode-Komponente (Overlay + Seite), Sprache Stufe 1
- [ ] `sprache.ts`: `useVorlesen` (aus CoSAi), `useZuhoeren` (webkitSpeechRecognition de-DE, liefert Text + Pegel-Schätzung)
- [ ] `AgentMode.tsx`: Props {api, ziele, modus: 'overlay'|'seite', navigiere, kontextKarte?, stil, onStil}; Ablauf: Text/Stimme → POST nachricht → Steuerung Schritt für Schritt sichtbar ausführen (Etikett je Schritt, 600 ms) → Chips; Bestätigung über Chips → POST entscheidung; Gedächtnis-Leiste; Stilwahl im Menü
- [ ] Commit

### Task 12: gg-immo Web als Host
- [ ] `data-agent`-Marken: Ankauf-Deals-Liste (`ankauf.deals.liste`, Einträge `ankauf.deals.eintrag` mit `data-agent-index`), Deal-Reiter (`deal.reiter.<name>`), Kommentar-Feld `deal.kommentar.text`, Senden `deal.kommentar.senden`, Anrufergebnis-Knöpfe `deal.anruf.<ergebnis>`, Nächster `ankauf.naechster`, Navigation `nav.<seite>`
- [ ] `oberflaechenkarte.ts` + Test, der Quelltext und Karte abgleicht
- [ ] `AgentSeite.tsx` (Route `/agent`), Schalter in der Seitenleiste, Overlay im AppRahmen; `useEinstellung('agent.stil')`
- [ ] `tests/e2e/agentmode.spec.ts`: Overlay einschalten, Nachricht mit Attrappe → Schaufenster zeigt Schritt, Chip „Ja“ → Kommentar gespeichert
- [ ] Commit, `pnpm verify`, `pnpm e2e`

## Weitere Lieferungen (Roadmap)
- **2 Lernen:** Formulierungs-Vorschläge im Kommentarfeld, Episoden-Zeitstrahl, Routinen, Morgenvorschlag per Cron.
- **3 Sprache Stufe 2:** OpenAI Realtime über WebRTC mit kurzlebigem Token.
- **4 Meta-Agent:** Bereichs-DNAs aus Oberflächenkarte + OpenAPI, Fingerabdruck, „zu prüfen“.
- **5 CoSAi-Backend:** AutoGen raus, `cosai-kern` (Python, LangGraph) gegen dieselbe Vertragssuite.
