# GG Immobilienhandel · Neubau

Neubau von GG Immohandel **neben der laufenden App** (`../gg-immohandel`), nach den Entscheidungen im Analyse-Protokoll (`../protokoll`):

- **10 · Neubau** mit Übernahme der bewährten Kerne, Umzugsskript, ein Umschalttag
- **07 · Zielschema** `fach` mit 37 Tabellen · **08 · Zielarchitektur** · **09 · Fachlichkeit**
- Hosting bleibt vorerst **Supabase + Vercel** (Alternative in 12 zurückgestellt)
- Offene Fachfragen (11): bis zur Antwort gilt das **Ist-Verhalten** der alten App

Stand: **Fachlich vollständig gegenüber der alten App** — bis auf den Auto-Import-Bot (Browser-Automatisierung mit AGB-Bestätigung), der bewusst offen ist. Startseite ist das **Ankauf-Cockpit** (Deals nachverfolgen, Makler kontaktieren, Anruf-Briefing, Wählmaschine, Tageslog). Bedienbar sind: Deal-Detail (Übersicht, Kalkulation mit Varianten und Sammelwerkzeugen, Dateien, Kundenkalkulation, Bank-Präsentation), Objekt-Detail, Makler-Detail mit KI, Listen mit gespeicherten Filtern, globale Suche, Angebote (Microsoft 365), Projekte, Vertriebslisten, Begleitscheine, Exposé-Import sowie die Einstellungen (Kalkulation, Kundenkalkulation, Bank-Präsentation, Vertriebslisten, Begleitscheine, Vorlagen-Texte, Microsoft 365, Sicherung, Zugänge, Werkzeuge, Audit-Log, Dubletten, Papierkorb, Aktionen nach außen, Anleitungen). Rechenkerne, Listen, Filter, Fälligkeiten, Hash-Kette, Dubletten, Gate und Mail-Triage sind per Golden Master gegen den Originalcode geprüft, 17 Bereiche zusätzlich gegen die laufende alte App (`pnpm paritaet`).

## Schnellstart

Voraussetzungen: Node ≥ 24, pnpm 10, Docker (für Supabase).

```bash
pnpm install
cp .env.example .env
pnpm db:start          # Supabase lokal auf Ports 554xx (Migration + Demodaten)
pnpm dev               # API http://localhost:3101 · Web http://localhost:5273
pnpm demo:daten        # Demo-Deals samt Exposé-PDF (nach jedem db:reset, API muss laufen)
```

| Was | Adresse |
|---|---|
| App | http://localhost:5273 |
| API / OpenAPI | http://localhost:3101/api/health · http://localhost:3101/api/openapi.json |
| Supabase Studio (Schema `fach`) | http://127.0.0.1:55423 |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:55422/postgres` |

Die alte App nutzt 5173/3001 und Supabase 543xx. Beide Stacks laufen parallel.

## Befehle

| Befehl | Zweck |
|---|---|
| `pnpm dev` | API + Web im Watch-Modus |
| `pnpm typecheck` · `pnpm test` · `pnpm build` | Prüfen (über Turborepo) |
| `pnpm verify` | alles zusammen |
| `pnpm e2e` | Playwright-Klicktests (Desktop + iPad), startet die Server bei Bedarf; Exposé-Import braucht `KI_ATTRAPPE=1` |
| `pnpm db:reset` | DB neu aufbauen: Migrationen + `supabase/seed.sql` |
| `pnpm demo:daten` | Demo-Deals über den echten Importweg, **mit** Exposé-PDF im Speicher. `seed.sql` kann keine Dateien anlegen — deshalb dieser Schritt nach jedem `db:reset`. |
| `pnpm db:generate` | nach Schemaänderung SQL-Migration erzeugen (`supabase/migrations`) |
| `pnpm db:stop` | Supabase-Container stoppen |
| `pnpm umzug:probe` | Umzug alt → neu als Probelauf (schreiben, prüfen, zurückrollen) |
| `pnpm umzug` | Umzug alt → neu speichern (nur wenn alle Prüfungen bestehen) |
| `pnpm paritaet` | Parallelprüfung gegen die laufende alte App (siehe unten) |
| `pnpm golden:erzeugen` | Golden Master aus dem Originalcode neu erzeugen (braucht `../gg-immohandel`) |

## Aufbau

```
apps/
  api/            Hono + zod-OpenAPI · routes (dünn) → services (Anwendungsfälle) → @gg/db
  web/            React 19 · Vite · Mantine · TanStack Router/Query
packages/
  domain/         reine Fachregeln: Deal-Status, Nachfassen, Frequenzen (keine Abhängigkeiten außer zod)
  db/             Drizzle-Schema „fach“ (37 Tabellen) + Client
  api-contract/   zod-Schemas, die API und Web teilen
  integrations/   KI (Anthropic, Kosten, Attrappe), PDF-Text, Exposé-Analyse + Prompt, Vorsortierung Mails, Dateiablage (Supabase Storage)
  documents/      Vorlagen Bankgespräch + Bank-Präsentation, Payload (auch im Browser: Live-Vorschau) · ./pdf: Chrome-Druck (Playwright), PowerPoint (pptxgenjs), Foto-Ablage für den Druck, Render-Schleuse (nur Node)
  umzug/          Umzugsskript kv_store (alte App) → Schema fach, mit Prüfbericht
supabase/         config.toml (Ports 554xx), migrations/, seed.sql
tests/e2e/        Playwright
scripts/          schema-aus-protokoll.py (erzeugt das Drizzle-Schema aus Protokoll 07)
```

**Abhängigkeitsrichtung:** `web → api-contract → domain` · `web/api → documents → domain` · `api → db → domain`. `domain` importiert nichts aus der App.

## Schema ändern

1. `packages/db/src/schema.ts` anpassen (Erstfassung wurde aus `../immohandel-doks/protokoll/werkzeuge/er_gen.py` erzeugt)
2. `pnpm db:generate` → neue Datei in `supabase/migrations/` prüfen
3. `pnpm db:reset` → Tests

## Exposé-Import (Charta Ablauf 1)

Knopf „Exposé importieren“ in der Kopfzeile → Upload (Stapel, Kostenschätzung, „bereits importiert“) → Objekt (Konfidenz-Punkte, Dubletten-Banner, Einheiten) → Makler (Auswahl, Dublette, Optionen, Prio, Frequenz) → Deal & Kalkulation → Deal mit Einheiten, Status-Verlauf und Exposé-PDF.

- **KI:** `ANTHROPIC_API_KEY` in `.env` → echte Auswertung (Textweg Haiku → Sonnet, Scans als PDF an Sonnet; Kosten ins Audit). Ohne Schlüssel lokal `KI_ATTRAPPE=1`: liest „Feld: Wert“-Zeilen, in der Oberfläche als Test-Modus markiert, in Produktion nie aktiv.
- **Ablage:** Supabase Storage (`SUPABASE_SERVICE_ROLE_KEY`), Buckets `pdfs`, `deal-docs`, `obj-photos` wie in der alten App; Upload zuerst nach `pdfs/_eingang/<uuid>`.
- **Übernommen und geprüft:** Prompt/Schema wortgleich, Analyse-Wegwahl und PDF-Textlesen mit den Tests der alten App; Dubletten, Telefonregeln und Vorbereitung per Golden Master (150 Fälle); Vorsortierung der Mails (`triageMail`) mit Tests und Beispiel-Mails.
- **Bewusste Korrekturen:** Deal-Einheiten bekommen `flaeche` (alte App: nur `fl_ist`, Fläche fehlte in der Kalkulation jedes importierten Deals) · Risikopuffer als `rp_pct` (alt `rp`, wirkungslos) · eingegebene 0 bleibt 0 (alt `|| Standard`).
- **Noch offen:** E-Mail-Angebote aus dem Postfach und Auto-Import-Engine (brauchen Microsoft-Graph-Zugang, Browser, Outward-Gate), Fotos aus dem PDF, Entwurf/Minimieren, Massenimport mit CSV, Vergleich mit echten Exposés.

## Bankgespräch-PDF

- **Editor:** unter den Eingaben die Live-Vorschau (gleiche Vorlage, gleicher Payload-Bau wie das PDF, im isolierten Rahmen ohne Skripte). Knopf **PDF** druckt den *gespeicherten* Stand, deshalb erst aktiv, wenn „gespeichert“ steht.
- **Server:** `GET /api/kundenkalkulationen/{id}/pdf` → Chrome (playwright-core) druckt A4 mit Kopf/Fuß je Seite; jeder Export steht im Audit-Log. Die **Render-Schleuse** (2 parallel, 4 wartend, 45 s, danach 503 mit `Retry-After`) ist samt Tests aus der alten App übernommen; wer den Tab schließt, verlässt die Warteschlange.
- **Chrome:** lokal automatisch gefunden (macOS/Linux/Windows-Standardpfade) oder `CHROME_PFAD` in `.env`. Ohne Chrome antwortet die Route mit 503 und Hinweis.
- **Einstellungen → Kundenkalkulation:** „Ersteller“ (alt: „Mein Name“, nur im Browser gespeichert, deshalb nicht umziehbar) und Disclaimer.

## Bank-Präsentation

- **Deal → Reiter „Bank-Präsentation“:** höchstens eine je Deal (wie alt), anlegen als Standard-IVT-Pitch (13 Folien) oder leer; bearbeitet wird unter `/praesentationen/<id>`.
- **Editor:** Folienliste (Reihenfolge, ein-/ausblenden, löschen, 16 Folientypen hinzufügen), Formular je Typ mit denselben Feldern wie alt, Bildauswahl aus den Objektfotos (Mehrfachauswahl mit Reihenfolge, Hochladen, Zwischenablage), Live-Vorschau der Folie, automatisches Speichern mit Version.
- **Vorbelegung aus dem Deal** (Deckblatt, Objektbeschreibung, Aufteiler-/Global-Kalkulation, Verkaufspreise, Mietenaufstellung mit Spaltenwahl, Finanzierung + IVT-Standard) und **Konsistenz-Check** (GIK/EM/FM/Scope/Verkaufserlöse) rechnen wie alt (Golden Master, 120 Fälle).
- **Export:** `GET /api/praesentationen/{id}/pdf` (A4 quer, hinter der Render-Schleuse) und `/pptx`; Standardbilder (Organigramm, Abschlussfoto) und Geschäftsmodell-Texte kommen aus **Einstellungen → Bank-Präsentation**.
- **KI-Texte (02.10.2026, wie alt):** „🤖 KI: Beschreibung generieren“ auf der Objektbeschreibung (4–7 Sätze, nur aus den bekannten Fakten zu Deal, Objekt und Folie) und „🤖 KI: Lagebeschreibung generieren“ auf der Lagebeschreibung (je 3–5 Punkte für Standort und Anbindung aus der Adresse). Beide laufen mit Claude Haiku 4.5 über `POST /api/praesentationen/{id}/ki`; was schon getippt ist, geht als Vorgabe mit und bleibt erhalten, gespeichert wird erst durch den Editor. Prompts wörtlich aus `finanzpraes-ki.ts` (`packages/integrations/src/ki/praesentation.ts`), Regeln in `packages/domain/src/finanzpraesentation/ki.ts`, Kosten im Audit unter `praesentation/lage` und `praesentation/objekt`.
- **„✨ Helligkeit“ (02.10.2026, wie alt):** automatische Tonwertkorrektur an jedem Bild der Präsentation, im Browser gerechnet und keine KI (`helligkeitKorrigieren` in `@gg/domain`, wörtlich nach `autoEnhanceBrightness`). Die aufgehellte Kopie wird als neues Foto `enhanced-….jpg` ans Objekt gehängt (höchstens 1280 px breit, JPEG 0,85) und ersetzt das Bild in der Folie; das Original bleibt am Objekt.
- **Noch nicht übernommen:** PDF-Seiten als Grundrisse hochladen.

## Parallelprüfung gegen die alte App (`pnpm paritaet`)

Prüft **gegen die laufende alte App**, ob der Neubau fachlich dasselbe zeigt — zusätzlich zum Golden Master (der den Originalcode ohne Oberfläche ausführt).

1. Voraussetzung: alte App läuft (`../gg-immohandel`: `npm run dev` → 5173/3001) und Neubau läuft (`pnpm dev`).
2. Der Aufbau sichert die betroffenen Sammlungen der **alten lokalen** App, schreibt einen festen Prüfbestand hinein (`tests/paritaet/datenbestand.ts`, IDs `par-…`) und zieht ihn mit dem **echten Umzugsskript** in den Neubau.
3. Beide Oberflächen werden im Browser geöffnet und verglichen: Ankaufskalkulation (jede Kennzahl je Deal), Ankauf-Cockpit (Karten, Fälligkeit, letzter Kontakt), Bankgespräch-Vorschau (Text), Bank-Präsentation (Text je Folie), Begleitschein (Zähler, jede Zeile), Vertriebslisten (Übersicht, jede Zelle inkl. Rechenspalten), Listen mit gespeicherten Filtern (Deals, Objekte, Makler, Cockpit), Projektmanagement (Karten, Checkliste je Filter, jede Zelle der Einheitenliste, Finanzleiste, Globalverkauf, Mietergespräche, Anlegen aus einem Deal).
4. Danach wird der alte Stand der alten App zurückgeschrieben und der Neubau auf die Demodaten zurückgesetzt. Bericht: `berichte/paritaet/bericht.md`. Nach einem Abbruch: `pnpm paritaet:wiederherstellen`.

**Regel:** Jede neu übernommene Fachfunktion bekommt hier einen Vergleich (Daten in `datenbestand.ts`, Auslesen in `alt.ts`/`neu.ts`). Neubau-Ansichten tragen dafür `data-*`-Merkmale (z. B. `data-kennzahl`).

**Bisher gefunden:** Datumsanzeige „Zuletzt“ war im Neubau „8.9.2026“, alt „08.09.2026“ → angeglichen.

## Deal-Detail, Makler, Cockpit-KI, Vorlagen

- **Deal-Info:** Objekt wechseln/neu anlegen (Kaufpreis, Wohnfläche, Einheiten aus dem Objekt), Makler-Pflicht beim manuellen Anlegen, Dublette Objekt+Makler, Frequenzwechsel belegt den nächsten Kontakt vor (nur wenn leer), 1 Wo/1 Mo/3 Mo/6 Mo, E-Mail an Makler, Objektfotos, Gesprächslog, Löschen.
- **📁 Dateien:** Hochladen (bis 20 Dateien, 200 MB je Datei, Signaturprüfung aus `server/upload-guard.ts` portiert), Bezeichnung, Öffnen, Löschen; Umzug `app.deal_documents`; 📄 Exposé in der Deal-Liste.
- **🧮 Kalkulation:** Datei-Leiste über Übersicht und Kalkulation (`dealDocsStrip`), „Alle setzen“ (Rendite, KP/m², Mieterhöhung SOLL 0/+10/+15 %), **Einheiten aus Mieterliste-PDF** (KI liest die Liste, ersetzt nach Rückfrage die Einheiten; das PDF bleibt in den Dateien) und **📸 Varianten** (Momentaufnahme von Kalkulation, Einheiten und Sanierung speichern, laden, löschen; Einheiten behalten ihre IDs). Regeln in `packages/domain/src/deals/kalkulationswerkzeuge.ts` (Golden Master 60 Fälle), Varianten in `fach.deal_kalk_varianten` (`/api/deals/{id}/varianten`), Erkennung unter `POST /api/deals/{id}/einheiten-aus-pdf`.
- **Feste Leiste (02.10.2026):** Im Deal bleiben die Adresszeile (Adresse, Stadt und Makler in einer Zeile, rechts der Status) und die Reiterleiste beim Scrollen oben stehen. In der Kalkulation steht direkt darunter eine Knopfleiste, die ebenfalls stehen bleibt: links die Varianten („💾 Speichern als…“, „Variante laden“), rechts „Verwerfen“ und „Speichern“, darunter die Marke „ungespeichert“. Bei ungespeicherten Änderungen fragen Reiterwechsel, ein anderer Deal, eine andere Seite und das Neuladen nach, bevor die Eingaben verloren gehen (`apps/web/src/lib/ungespeichert.ts`).
- **Aufbau wie in der alten App (02.10.2026, Kundenwunsch):** Unter der festen Leiste folgt der Inhalt wieder `dealKalkHTML`: Einheitenliste IST / SOLL (Alle setzen, IST-/SOLL-/VKP-Spalten, Ø-Fußzeile) → Kaufpreis & Nebenkosten (mit KP/m² und Rendite) → Finanzierung → Sanierungskosten (Auf/Beide/Glo, Risikopuffer in Prozent oder als fester Betrag — wer das eine setzt, nimmt das andere zurück) → GIK & Ergebnis mit den Boxen Aufteiler und Global (Projektkosten, Herstellungskosten, Exit, Ampel). Der Rechenkern ist unverändert. Dabei behoben: Zwischenstände beim Tippen ("01", wenn im Feld „0“ steht) galten als leer und verschluckten das erste Zeichen (`alsZahl`).
- **Makler-Detail:** Profil (Prio, Telefon normalisiert, „Nicht kontaktieren“, zuletzt kontaktiert, Dublette beim Anlegen, Löschen), Kommunikation (Verlauf wie alt, Notiz, WhatsApp, E-Mail mit Vorlagen, 🎤 Anruf aufnehmen + Whisper, letzter Kontakt rückt nur vor), KI-Zusammenfassung, Beziehungsprofil + Du/Sie, Persönlich (Erwähnungen, Geburtstag, Ansprache, KI-Extraktion, OSINT), Deals-Reiter.
- **Cockpit-KI:** Kommunikationsstil (Sonnet) mit Konfidenz, KI-Entwurf WhatsApp + E-Mail je Makler, Kontakt-Anlässe (Web-Suche + News + Haiku) für fällige Makler, Gesprächsöffner und Aufnahme im Briefing, Mail-Auswahl mit Vorlagen auf Deal- und Makler-Karten.
- **Einstellungen → Vorlagen-Texte:** Vorlagen mit Platzhaltern, „Mein Name“; Umzug `immo-vorlagen`.
- **KI ohne Schlüssel:** `KI_ATTRAPPE=1` liefert erkennbare Test-Antworten und keine öffentliche Suche. Whisper braucht `OPENAI_API_KEY`.
- **Prompts** wörtlich in `packages/integrations/src/ki/persona.ts`, `anreicherung.ts` und `einheiten.ts` (dort geht das PDF als Dokument an das Modell statt als JPEG-Seiten — der Neubau hat keinen Seiten-Renderer); reine Regeln in `packages/domain/src/makler`, `deals/info.ts`, `vorlagen.ts`.

## Objekt-Detail

Zwei Reiter wie alt: **📋 Details** (Lage, Recherche-Links Google Maps/Street View/ImmoScout/Bodenrichtwert, Gebäude, Kennzahlen mit Bruttorendite und KP-Faktor, Einheitenaufstellung, Notizen) und **✏️ Bearbeiten** (alle Felder, Einheiten mit €/m² je Zeile und Summen). Status-Schnellwahl über dem Reiter, „🗑 Löschen“ legt das Objekt in den Papierkorb (`DELETE /api/objekte/{id}`). **Bewusste Abweichung (Fachentscheidung 02.10.2026):** Hängt ein Deal am Objekt, ist „Löschen“ gesperrt und ein Hinweis nennt den Grund (API: 409). Umgekehrt geht das Objekt von selbst mit in den Papierkorb, wenn sein letzter Deal gelöscht wird (`DELETE /api/deals/{id}`); hängt noch ein anderer Deal daran, bleibt es. Die alte App ließ das Objekt löschen und den Deal stehen und ließ beim Löschen eines Deals das Objekt zurück. Einheiten werden mit dem Objekt gespeichert (`PATCH /api/objekte/{id}` mit `einheiten`) und behalten ihre IDs. Regeln in `packages/domain/src/objekte/detail.ts` (Golden Master aus `objDetailHTML`/`objRenderEinheiten`).

## Sicherung, Zugänge und Werkzeuge

- **Einstellungen → Sicherung:** Export des ganzen Datenbestands als JSON, Einspielen in zwei Schritten (Plan mit „neu/aktualisiert“ je Tabelle, dann Ausführen in einer Transaktion; es wird nichts gelöscht). Jede Tabelle ist entweder gesichert oder mit Begründung ausgenommen — ein Test hält das gegen `schema.ts`.
- **Einstellungen → Zugänge:** Anthropic-, OpenAI- und Propstack-Schlüssel verschlüsselt (AES-256-GCM, `GG_ENCRYPTION_KEY` oder `data/.encryption-key`) hinterlegen; sie haben Vorrang vor den Umgebungsvariablen und werden nur maskiert angezeigt.
- **Einstellungen → Anleitungen:** Einrichtungsschritte und Abläufe (App-Adresse, iOS-Kurzbefehl für eingehende Anrufe, Wählmaschine, Zugänge, Sicherung, Papierkorb, Dubletten, Varianten, Audit-Log, Tabellen-Import).
- **Makler aus Tabelle importieren** (Einstellungen → Sicherung): .xlsx/.xls, Spalten werden über die Überschriften erkannt, Vorschau vor dem Übernehmen; Zeilen ohne Namen und bekannte E-Mails werden übersprungen (Regeln in `packages/domain/src/makler/xlsxImport.ts`).
- **Eingehende Anrufe:** `/?incoming=<nummer>` öffnet das Anruf-Briefing des passenden Maklers (auch bei 0049/+49/0), sonst erscheint die Nummer im Cockpit.
- **Einstellungen → Werkzeuge:** Nachfass-Datum-Reset (Vorschau, dann löschen) und KI-Kosten je Modell und Funktion aus dem Audit-Log.

## Microsoft 365 (Angebote)

**Einstellungen → Microsoft 365**: Client-ID, Verzeichnis und Geheimnis der Azure-App eintragen (das Geheimnis verschlüsselt), dann „Mit Microsoft verbinden“ — Authorization-Code-Flow gegen `login.microsoftonline.com`, angefordert werden nur Leserechte (`Mail.Read`, `Mail.ReadBasic`, `User.Read`, `offline_access`). Tokens liegen verschlüsselt in `fach.oauth_tokens` und werden bei Bedarf erneuert.

Jede Mail durchläuft die **Triage** (Stufe 0, rein gerechnet: Anhangsnamen, Freischaltwege, Objektnummern, Ankündigungen — `packages/integrations/src/expose/triage.ts`) und sagt, wo das Exposé steckt und warum. Die Seite **Angebote** zeigt die letzten Mails des eingestellten Ordners mit Anhängen (nur PDFs sind auswertbar) und den Exposé-Links aus dem Mailtext (gefiltert und nach Wahrscheinlichkeit sortiert, Regeln in `packages/domain/src/mail/auswertung.ts`, Golden Master aus `server/graph.ts`). „📄 Anhang“ übernimmt das PDF in den Exposé-Eingang und öffnet den Import mit der Analyse; „🚫 Sperren“ blendet die Mail dauerhaft aus, „↩ Sperre aufheben“ nimmt das zurück (bewusste Ergänzung — die alte App konnte das nicht). Ohne Zugang liefert `M365_ATTRAPPE=1` zwei Beispielmails.

## Propstack (Bewertung je Einheit)

In der Einheitenliste der Kalkulation öffnet 📊 den Bewertungsdialog: Adresse und Maße kommen aus Objekt und Einheit, Etage, Etagenzahl, Balkon, letzte Modernisierung und Qualität gibt man dazu (sie bleiben an der Einheit für das nächste Mal). „An Propstack senden“ legt die Einheit im CRM an — **nur**, wenn das Default-Deny-Gate sie durchlässt; sonst nennt der Dialog die offenen Bedingungen. Feldabbildung in `packages/domain/src/propstack.ts` (wörtlich aus `src/lib/propstack.ts`), API-Client in `packages/integrations/src/propstack.ts` (mit Attrappe für Tests), Schlüssel unter Einstellungen → Zugänge.

## Anmeldung

Mit `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` zeigt die Web-App eine Anmeldemaske (E-Mail + Passwort, Supabase Auth). Die Sitzung hält `supabase-js` im Browser und erneuert sie selbst; jedes Token wandert zusätzlich in den Cookie `gg-auth`, weil Bilder und Download-Links keinen Authorization-Header tragen. Jeder API-Aufruf schickt das Token, bei `401` wird die Sitzung einmal erneuert und der Aufruf wiederholt. Die API prüft das JWT gegen die JWKS von Supabase und danach die Allowlist (`AUTH_ALLOWED_EMAILS`); lokal genügt `AUTH_LOCAL_OPEN=1`, dann läuft alles ohne Anmeldung (`apps/web/src/lib/sitzung.ts`, `apps/api/src/middleware/auth.ts`).

## Aktionen nach außen (Default-Deny-Gate)

Zwei Aktionen verändern etwas außerhalb der App: die AGB-/Provisionsbestätigung im Auto-Import und das Anlegen einer Einheit in Propstack. Beide laufen durch das Gate aus `packages/domain/src/outward/gate.ts` (wörtlich aus `server/outward-gate.ts`, Golden Master mit 68 Fällen): erlaubt wird nur, wenn **alle** Bedingungen erfüllt sind — bekannte Aktion, kein Not-Aus (`OUTWARD_GATE_KILL`), scharfe Umgebung (nur Vercel-Produktion), Schalter an und Ziel-Host auf der Liste. **Einstellungen → Aktionen nach außen** zeigt Umgebung, Schalter, zusätzliche Hosts, je Aktion eine Probe („was gerade durchginge“) und die offenen Freigabe-Anträge (MCP). Jede Entscheidung steht im Audit-Log.

## MCP-Server

`POST /api/mcp` spricht JSON-RPC (initialize, tools/list, tools/call). Außerhalb einer nachweislich lokalen Umgebung braucht jeder Aufruf einen Schlüssel im Kopf `Authorization: Bearer …` — Cookies zählen nicht; hinterlegt werden nur SHA-256-Hashes in `MCP_API_KEYS` (`label:scope[+scope]:sha256`), verglichen wird in konstanter Zeit. Bereiche: `read`, `write`, `outward`; ein Werkzeug ohne gültigen Bereich ist weder auflistbar noch aufrufbar. Werkzeuge: `list_collections`, `read_collection`, `read_entity`, `list_files`, `read_audit_log` (lesen), `add_note` (schreiben) und `request_outward_approval` (legt nur einen Antrag an — ausgeführt wird nichts). Regeln in `packages/domain/src/mcp/zugang.ts` (Golden Master aus `server/mcp.ts`), Werkzeuge in `apps/api/src/services/mcp.ts`; die Übersicht steht unter Einstellungen → Aktionen nach außen.

## Audit-Log

**Einstellungen → Audit-Log**: Filter nach Typ, Entität und Zeitraum, Suche in Werten, IDs und Metadaten, Export als JSON oder CSV, „🔐 Hash-Kette prüfen“ und „🗑 Älter als 180 Tage löschen“ (hinterlässt einen Anker, damit die Prüfung ab dem verbliebenen Anfang weiterrechnet). Jede Schreibstelle (Dokumente, Fotos, KI-Aufrufe, PDF-Exporte, Merges) geht über `auditSchreiben` und hängt an der Kette; Zeitstempel in Sekunden wie in der alten App. Kette wörtlich in `packages/domain/src/audit/kette.ts` (Golden Master aus `server/audit-chain.ts`, sha256 wird übergeben), Dienst in `apps/api/src/services/audit.ts`.

## Dubletten

**Einstellungen → Dubletten**: Suche über Makler (E-Mail, Telefon, ähnlicher Name), Objekte (Adresse mit Hausnummer, Tippfehlertoleranz) und Deals (gleiche Objekt+Makler-Kombination) — exakte Treffer zuerst, „Keine Dublette“ merkt sich das Paar. Der Vergleich zeigt Konfliktfelder (Wahl A/B), Listen (A, B oder vereinen) und was mitwandert; beim Zusammenführen behält der Primäreintrag seine Kennung, Unterlisten und Verweise (Deals, Projekte, Kundenkalkulationen, Vertriebslisten, Präsentationen, Begleitscheine) hängen um, Dateien wechseln den Besitzer (Schlüssel bleibt), das Duplikat landet im Papierkorb. Alles steht in `fach.merge_protokoll` und ist 24 Stunden rückgängig zu machen (mit Nachfrage, wenn seither gearbeitet wurde). Regeln in `packages/domain/src/dubletten/` (Golden Master aus `dedup.ts`/`merge.ts`), Dienst in `apps/api/src/services/dubletten.ts`.

## Papierkorb

**Einstellungen → Papierkorb**: Gelöschtes aus Objekten, Maklern, Deals, Projekten, Vertriebslisten, Bank-Präsentationen, Kundenkalkulationen und Begleitscheinen — gruppiert wie alt (neueste Löschung zuerst), mit Restlaufzeit (rot ab drei Tagen), „↩ Wiederherstellen“, „✖ Endgültig“ und „Papierkorb leeren“. Die 30-Tage-Frist räumt beim Öffnen der Seite auf (alt: beim Start der App) und entfernt bei Deals auch die Dateien aus dem Bucket. Regeln in `packages/domain/src/papierkorb.ts`, Dienst in `apps/api/src/services/papierkorb.ts` (`/api/papierkorb`).

**Fremdschlüssel:** Fünf Verweise löschen in der Datenbank nicht mit — Deals und Begleitscheine zeigen auf Objekte; Kundenkalkulationen, Bank-Präsentationen und Vertriebslisten auf Deals. Der Dienst liest sie aus dem Schema ab und entfernt endgültig **Kinder vor Eltern** (Leeren und 30-Tage-Frist). **Abhängiges geht mit (Fachentscheidung 02.10.2026, `PAPIERKORB_ABHAENGIG`):** Mit einem Deal verschwinden seine Kundenkalkulationen, Bank-Präsentation und Vertriebsliste, mit einem Objekt seine Begleitscheine — auch wenn sie selbst nicht im Papierkorb liegen. Bis dahin bleiben sie stehen, ein wiederhergestellter Deal kommt also vollständig zurück. Nur ein Deal hält sein Objekt fest: Hängt an einem Objekt im Papierkorb noch ein Deal (Altbestand), bleibt es liegen — „Papierkorb leeren“ nennt die Anzahl, „✖ Endgültig“ antwortet mit einem Hinweis (409), die Frist überspringt es. Deal und Objekt gehen mit derselben Löschzeit in den Papierkorb und laufen nach 30 Tagen gemeinsam ab. „↩ Wiederherstellen“ eines Deals holt sein Objekt mit zurück.

## Globale Suche

🔍 im Kopfbereich oder ⌘F/Strg+F: sucht gleichzeitig in Objekten, Deals und Maklern (Adresse, Name, Firma, E-Mail, Telefonziffern ab 3, PLZ), je Bereich höchstens fünf Treffer; Klick öffnet den Datensatz. Regel in `packages/domain/src/suche.ts` (Golden Master aus `src/lib/search.ts`).

## Listen und gespeicherte Filter

- **Deals, Objekte, Makler:** Zähler je Status/Prio (Klick filtert), Chips, Suche, Tabellen mit den Spalten der alten App (Deals: Tabelle in der Ansicht „untereinander“). Reihenfolge wie die alte Sammlung (`reihenfolge`, neu angelegt = vorn).
- **Liste und Detail teilen (02.10.2026, Ankauf, Deals, Objekte, Makler):** Zwischen Liste und Detail liegt ein Teiler: ziehen ändert die Größe der Liste (Pfeiltasten gehen auch, Doppelklick stellt den Standard von 430 px wieder her; die Liste bleibt mindestens 240 px, das Detail mindestens 360 px breit). Der Knopf links neben der Adresse (Deal) bzw. vor den Reitern (Makler) klappt die Liste ganz zu, damit das Detail — vor allem die Kalkulation — die volle Breite bekommt. Beim Objekt sitzt der Knopf vor dem Objekt-Status. Größe und Zustand merkt sich die Ansicht je Gerät und je Seite bzw. Reiter (`GeteilteAnsicht`, `ListeUmschalter`); die Standardbreite der Liste ist auf den Seiten Deals, Objekte und Makler 360 px, im Ankauf 430 px.
- **Bank-Präsentation: Wohn-, Gewerbe- und Mietfläche (06.10.2026, Neuerung):** Auf der Folie „Objektbeschreibung“ gibt es neben der Wohnfläche die Gewerbe- und die Mietfläche. Im Formular steht die Mietfläche an der Stelle der früheren Wohnfläche, rechts daneben ein Knopf (↶), der Wohn- und Gewerbefläche aus der Kalkulation übernimmt und die Mietfläche als Summe einsetzt (Vorbelegung `flaechen`); darunter Wohn- und Gewerbefläche. In der Folie (Ansicht, PDF, PowerPoint) stehen Mietfläche, Wohnfläche und Gewerbefläche untereinander. Leere Felder erscheinen nicht (`objektFakten`). „Aus Deal/Objekt vorbelegen“ füllt sie aus den Einheiten (`flaechenVorbelegen`): Wohnfläche = Wohnungen + Sonstiges, Gewerbefläche = Gewerbe, Mietfläche = beides, Stellplätze zählen nicht; ohne Flächen in den Einheiten bleibt die Wohnfläche aus dem Objekt. Kaufpreis pro m² bezieht sich auf die Mietfläche. `objektbeschreibungVorbelegen` bleibt unverändert (Golden Master der alten App), die Flächen laufen danach.
- **KI-Schlüssel aus Einstellungen → Zugänge gilt überall (04.10.2026, Fehlerbehebung):** Der dort hinterlegte Anthropic-Schlüssel wirkte bisher nur für Makler-KI und Mieterliste; Exposé-Import, Statusanzeige, Auto-Import-Bot und Präsentations-Texte lasen nur `ANTHROPIC_API_KEY` aus der Umgebung — online stand deshalb „Keine KI eingerichtet“. Jetzt bildet `kiAktuell` in `apps/api/src/app.ts` die KI je Anfrage: Attrappe/Tests vor dem Schlüssel aus den Zugängen vor der Umgebung. Ein neu eingetragener Schlüssel wirkt sofort, ohne neues Deployment. Die Meldungen verweisen auf Einstellungen → Zugänge.
- **Ankauf — Karte bleibt bis „Erledigt“ (02.10.2026, wie alt):** Ein neuer Termin auf einer Deal- oder Makler-Karte (Datumsfeld oder 1W/1M/3M/6M) wird sofort gespeichert, die Karte bleibt aber an ihrem Platz stehen und zeigt „Termin geändert“. Erst „Erledigt“ schließt sie ab; ein weiter entfernter Termin bleibt dabei bestehen. Die alte App zeichnete die Liste nach `vtQuickDate`/`vtSetDealDate` ebenfalls nicht neu. Gehalten wird, solange die Ankaufseite offen ist (`cockpitMitGehaltenen` in `@gg/domain`); Zähler und Wählmaschine rechnen weiter mit den tatsächlich fälligen Einträgen.
- **Ankauf — Deal-Karte entschlackt (02.10.2026, Kundenwunsch, bewusst anders als alt):** Die Karte hat drei Zeilen: Adresse mit der Fälligkeit in Kurzform rechts daneben („32T“ statt „32T überfällig“, „Heute“, „in 3T“; der volle Text steht im Tooltip, `faelligKurz` in `@gg/domain`), Makler (Name, darunter die Firma) und eine Zeile mit schmalem Datumsfeld, Schnellwahl und „Erledigt“. Neben „Anrufen“ öffnet ein WhatsApp-Knopf den Chat mit der Nummer des Maklers (`wa.me`, ohne Protokolleintrag). Nicht mehr auf der Karte: Status, die Kennzahlenzeile (Kaufpreis, Fläche, Rendite, Jahresmiete) und „Zuletzt“ — alles steht im Deal-Detail. „Zuletzt“ und der volle Fälligkeitstext bleiben als unsichtbare Anker (`data-zuletzt`, `data-faellig-label`) für die Parallelprüfung erhalten.
- **Kopfzeile mit Brotkrumen, Ankauf ohne eigene Titelzeile (02.10.2026, Design):** Die Kopfzeile zeigt rechts vom Namen der App, auf welcher Seite man ist („GG Immobilienhandel › Ankauf“, „› Einstellungen › Papierkorb“; `brotkrumen` in `apps/web/src/lib`). Auf der Ankauf-Seite entfällt dafür die Zeile mit Titel und „Nächste Kontakte“: „Deals/Makler durchwählen“ und die drei Zahlen stehen fest über der Liste (`listeKopf` der `GeteilteAnsicht`), die Zahlen ohne Text und ohne Füllung — Farbe nur im Rahmen, die Bedeutung im Hinweis beim Überfahren. „Durchwählen“ ist ein Symbolknopf mit grünem Rahmen (Telefon, drei Punkte, Telefon), der Text mit der Anzahl steht im Hinweis. Auf den Karten haben Fälligkeit, WhatsApp und Anrufen nur noch einen farbigen Rahmen (WhatsApp und Anrufen so hoch wie der E-Mail-Knopf); „Erledigt“ bleibt gefüllt. Ansicht (neben-/untereinander) und Filter liegen im Menü „Ansicht und Filter“ der Kopfzeile links von „Exposé importieren“ (`AnsichtMenue`) — für Ankauf, Deals, Objekte und Makler; die frühere Filterleiste auf den Seiten entfällt. Auf Deals, Objekte und Makler entfällt die Titelzeile ebenfalls: die Zähler je Status stehen fest über der Liste (nur Zahl im farbigen Rahmen, Name im Hinweis, Klick filtert wie bisher), „Neuer Deal/Makler“ und „Neues Objekt“ stehen rechts neben dem Suchfeld. Auch „Einstellungen“, „Kundenkalkulationen“ und „Exposé importieren“ haben keine eigene Überschrift mehr. Die Reiter „Deals kontaktieren“ und „Makler kontaktieren“ stehen fett. Die Anzahl an den Reitern hat keine Hintergrundfarbe, die gewählte Zeile oder Karte ist in allen Listen dezent gelb mit gelbem Rahmen statt grün (Farben hell/dunkel in `apps/web/src/auswahl.css`), unter den festen Köpfen liegt ein Schatten.
- **Gespeicherte Filter** (Deals, Objekte, Makler, Ankauf-Cockpit): Auswahl, „Aktuelle als Filter speichern…“ (aus Chip + Suche), Verwalten (umbenennen, löschen). Aktiver Filter gilt für die Sitzung. Vorlagen der alten App werden beim ersten Anzeigen angelegt. Kriterien arbeiten wie alt auf Feldpfaden des Altformats (`GET /api/listen`).
- **Regeln** wörtlich in `packages/domain/src/listen` (Golden Master 50 Fälle). **Umzug** `immo-saved-filters` (exakte Doppel einmal).
- **Bewusst korrigiert:** Preise als Text zeigte alt „NaN €“/„690 €“, Objekt ohne Status „undefined“, unbekannter Deal-Status fehlte in den Zählern (Umzug: „In Prüfung“).

## Projekte (Projektmanagement, alt „📊 Vertrieb“)

- **Seitenleiste → Projekte:** Karten je Projekt (Checkliste in %, verkauft/Notar, Erlöse = beurkundete Ist-Kaufpreise / Ziel-VKP, PIP-Ampeln), neuestes zuerst. **＋ Projekt:** optional aus einem angekauften Deal ohne aktives Projekt (Adresse wird wie alt nur mit der Straße vorbelegt).
- **Beim Anlegen:** Einheiten aus dem Deal (Kaltmiete, mögliche Miete, Verkaufspreis je Einheit), Standard-Checkliste mit 136 Punkten, Ziel-VKP = Globalverkauf des Deals (GIK × Marge).
- **✅ Checkliste:** Zähler, Filter (Start „Offen“), Kategorien ein-/ausklappen und umbenennen, Zeilen hinzufügen/löschen; mit der letzten Zeile geht die Kategorie (mit Hinweis).
- **📊 Einheitenliste:** Gebäude-PIP, Finanzleiste, Kaufpreisbestandteile, Vertriebsstand, PIP-Ampel, Mietergespräche, Notartermin, Summenzeile, Globalverkauf. Nur „Notarvertrag“/„Verkauft“ zählen als beurkundet.
- **Regeln** wörtlich in `packages/domain/src/projekte` (alte Tests + Golden Master mit 60 Fällen und Bearbeitungsschritten), Speichern automatisch mit Version, Löschen in den Papierkorb.
- **Umzug** von `immo-projekte`: Projekte, Einheiten (Deal-Einheit verknüpft), Mietergespräche, Checkliste (Texte unverändert), Gebäude-Maßnahmen. Altformat `done` ohne `status` wird „erledigt“ (die alte Karte zählte es schon so, die Checkliste nicht).

## Vertriebslisten

- **Seitenleiste → Vertriebslisten:** alle angekauften Deals; je Deal höchstens eine Liste, einmalig aus den Deal-Einheiten erzeugt (Wohnungen/Stellplätze vorbelegt).
- **Tabelle:** 39 Standardspalten (Excel-Vertriebsliste), Zelltypen Text/Notiz/Zahl/€/%/Datum/Auswahl/Ampel/Ja-Nein, Rechenspalten (Miete/qm, Provision, Einkaufspreis aus GIK Aufteiler × Flächenanteil, Ergebnis IVT, KP/m², Renditen), Zeilen hinzufügen/löschen, Spalten ausblenden, automatisches Speichern.
- **Zahleneingabe wie alt:** „85.5“ wird zu „85,5“, „1.234“ zu „1234“ (deutsche Lesart, sichtbar vor dem Speichern).
- **Einstellungen → Vertriebslisten:** Provisionssatz (Standard 7,14 %) und Standardspalten (Reihenfolge, Name, Typ, hinzufügen, zurücksetzen).
- **Umzug:** Listen, Zeilen (Einheit verknüpft) und gespeicherte Standardspalten. Der Provisionssatz lag alt nur im Browser und zieht nicht mit (im Neubau einmal setzen, falls ≠ 7,14 %).

## Begleitscheine

- **Seitenleiste → Begleitscheine:** Übersicht nach Objekt (Ankauf vor Verkauf, Fortschritt, Archiv), Anlegen immer bewusst (Objekt, Typ, bei Verkauf Wohnungsnummer, Name → `Straße_Nr_Ort_Ankauf_Name`).
- **Arbeitsfläche:** vollständige Kopie der Vorlage (Ankauf: 133 Punkte aus der Excel F001), Ebenen-Grautöne und Statusfarben der Excel, Zählerblock (Unterpunkte zählen nicht), Texte/Verantwortung/Unterpunkte bearbeiten, Punkte verschieben/Ebene wechseln/löschen; der Abschlusspunkt „vollständig abgearbeitet“ archiviert und ist reversibel. Jede Änderung speichert (Version).
- **Aktionen je Punkt/Unterpunkt:** Link, Modul-Sprung (Deal-Reiter), Mail (mailto), Daten anzeigen (Projektkalkulation/Objekt/Deal, nur lesend), Vordruck (Entwurf mit `{platzhaltern}`, nie Versand), Dokumentenanalyse (noch nicht freigeschaltet, wie alt).
- **Einstellungen → Begleitscheine:** Aktionen, Vorlage (inkl. Auslieferungszustand), Vordrucke. Aktionen an gelöschten Vorlagenpunkten werden entfernt.
- **Regeln** in `packages/domain/src/begleitscheine/`: Engine, Vorlage und Aktions-Auslieferung wörtlich mit den alten Tests; Speicher-/DOM-Teile als reine Funktionen (`regeln.ts`).
- **Bewusst korrigiert:** „Daten anzeigen → Objekt“ zeigte bei Einheiten „[object Object]“, jetzt die Einheitenanzahl. Vorlagenänderungen an bestehende Begleitscheine vorschlagen (§F) ist als Regel vorhanden, war aber auch alt nicht in der Oberfläche.

## Objektfotos

Objekt-Schubfach → Fotos: mehrere hochladen (im Browser auf 1280 px / JPEG verkleinert, HEIC unverändert), sortieren (erstes = Titelbild), löschen. Ablage wie alt im Bucket `obj-photos/<objekt>/<foto>.jpg`, ausgeliefert unter `/api/photos/<objekt>/<foto>` (gleicher Pfad wie alt, die Vorlagen lösen `photo:`-Verweise so auf). Der Bildtyp wird an der Signatur geprüft (kein SVG). Präsentation und Kundenkalkulation verweisen mit `photo:<objekt>/<foto>`; beim Druck werden die Fotos als Dateien neben die Seite gelegt (Port von `finanzpraes-bilder.ts`).

## Rechenkerne und Golden Master

| Kern | Quelle alt | Neu | Absicherung |
|---|---|---|---|
| Ankaufskalkulation (Aufteiler/Global, GIK, Marge) | `dealKalkRC` + `dealRenderEinheiten` in `deals.ts` (mit DOM verwoben) | `packages/domain/src/ankaufkalkulation/engine.ts` (rein) | 405 Golden-Master-Fälle: jede angezeigte Zahl gleich |
| Kundenkalkulation (Bankgespräch, 50-Jahres-Hochrechnung, IRR) | `src/lib/kundenKalkEngine.ts` | `packages/domain/src/kundenkalkulation/engine.ts` | 41 übernommene Tests + 120 Golden-Master-Fälle |
| Kundenkalkulation: Vorbelegung aus Deal, Feldregeln, EK-/Tranchen-Schnellwahl | `kundenkalk.ts` (`defaultsFromDeal`, `kkalkUpdateField`, `applyEK` …) | `packages/domain/src/kundenkalkulation/bearbeitung.ts`, `feld.ts` | 80 Fälle × 15 Bearbeitungsschritte |
| Bankgespräch (PDF + Live-Vorschau der Kundenkalkulation) | `buildPdfPayload` in `kundenkalk.ts` + `src/lib/bankgespraechTemplate.ts` | `packages/documents/src/bankgespraech/` (Vorlage wörtlich, Payload rein) | 60 Fälle: Payload gleich, HTML von PDF, Vorschau, Kopf- und Fußzeile byte-gleich (SHA-256), Zeitzone Europe/Berlin |
| Bank-Präsentation: Vorbelegung, Kalkulationszusammenfassung, Konsistenz, Standards | `finanzpraes.ts` (`computeDealKalkSummary`, `finanzpraesPrefill*`, `finanzpraesCheckConsistency`, `expandWithDefaults`) | `packages/domain/src/finanzpraesentation/` | 120 Fälle über den ganzen Ablauf |
| Bank-Präsentation: HTML und PowerPoint | `finanzpraesTemplate.ts`, `server/finanzpraes-pptx*.ts` | `packages/documents/src/finanzpraes/`, `src/pdf/pptx*.ts` (wörtlich) | 50 Präsentationen: PDF-/Vorschau-/Folien-HTML byte-gleich, PowerPoint-Inhalt je Datei gleich (ohne Zeitstempel) |
| Ankauf-Cockpit: Fälligkeit, Termin aus Frequenz, Geburtstag | `vertrieb.ts` (`vtDueStatus`, `vtNextDue`, `vtBirthdayDue`) | `packages/domain/src/ankauf/cockpit.ts` | 10 Stichtage (inkl. Sommerzeit) in Zeitzone Europe/Berlin; Listen, Wählmaschine, Erledigt, Anruf-Ergebnis mit Regeltests |

**Bewusste Abweichung:** Die alte App rechnete Termine über die Sommerzeit-Umstellung einen Tag zu früh; der Neubau rechnet in Kalendertagen (im Golden-Master-Test ausdrücklich zugelassen).
**Ist-Verhalten mit Fachfrage (Fragebogen 11, Fragen 6 und 7):** Frequenz „Nie“ rechnet bei Deals wie „Wöchentlich“; die Wählmaschine ignoriert ein gesetztes Rückruf-Datum.

`werkzeuge/golden-master/erzeugen.ts` liest den **Originalcode** aus `../gg-immohandel` (nur lesend), führt ihn mit festen Zufallsfällen und Randfällen aus und speichert Eingaben und Ergebnisse unter `packages/domain/test/golden/` (Dokumente: `packages/documents/test/golden/`). Die Tests brauchen das alte Repo danach nicht mehr (auch in CI nicht). **Eine Engine-Änderung, die das Ergebnis verändert, ist eine Fachentscheidung:** Regel, Test und gegebenenfalls Golden Master gemeinsam ändern.

Der Umzug-Prüfbericht rechnet die Ankaufskalkulation je Deal einmal aus den Altdaten und einmal aus den neuen Tabellen. Damit ist nachgewiesen, dass beim Umzug keine Rechengrundlage verloren geht.

## Datenumzug alt → neu

```bash
pnpm umzug:probe    # zuerst immer: Probelauf
pnpm umzug          # speichern
```

- **Quelle** `QUELLE_DATABASE_URL` (Standard: lokale alte App, Port 54322), wird **nur lesend** geöffnet. **Ziel** ist `DATABASE_URL`.
- Ein Ziel außerhalb von localhost wird nur mit `UMZUG_ZIEL_FREIGABE=ja` beschrieben.
- **Eine Transaktion:** Zieltabellen leeren → neu befüllen → Prüfbericht. Ein Probelauf oder eine fehlgeschlagene Prüfung rollt alles zurück.
- **Wiederholbar:** stabile IDs; der tägliche Lauf bis zum Umschalttag ergibt bei gleichem Bestand identische Zeilen. Im Neubau erfasste Daten in Makler/Objekte/Deals werden dabei überschrieben.
- **Prüfbericht:** Anzahlen, Papierkorb, Deals je Status, Summen (Angebotspreise, Kaufpreise, Sanierungen), Einheiten, Kommentare, Kommunikation. Dazu Befunde (unlesbare Werte, Waisen, abweichende Kopien), unbekannte Felder und noch nicht umgezogene Sammlungen. JSON unter `packages/umzug/berichte/`.
- **Altformate:** Zahlen als Text (`parseNum` der alten App), `Altbestand`, deutsches Datum als Berliner Zeit, `_deleted`-Varianten, Notizen → Kommentar/Kommunikation, fehlende Objekte oder Makler aus den Kopien im Deal.
- Umgezogen: `immo-makler`, `immo-objects`, `immo-deals`, `immo-kundenkalkulationen` und die Einstellungen `immo-kalk-defaults`, `immo-kkalk-defaults`, `immo-kkalk-hinweise`, `immo-kkalk-disclaimer`. Die übrigen Sammlungen folgen mit ihren Seiten.

## Nächste Schritte (aus Protokoll 10)

- **N2 Rest:** Projektmanagement (`immo-projekte`), gespeicherte Filter
- **Dokumente, noch offen:** Chromium für Vercel (`@sparticuz/chromium` mit playwright-core), PDF-Seiten als Grundrisse
- **N3 Rest:** Suche, Papierkorb, Audit (Hash-Kette), Deal-Dokumente, Objektfoto auf der Cockpit-Karte, Kalkulationsvarianten
- **Ankauf-Cockpit, noch offen:** gespeicherte Filter, E-Mail-Vorlagen (mailto mit Platzhaltern), KI-Hinweise/-Entwürfe (Persona, Enrichment), KI-Gesprächsöffner und Anruf-Aufnahme im Briefing
- **N3:** Objekte, Makler (+ Kommunikation), Deals (Info, Kalkulation, Dateien), Cockpit, Wählmaschine, Suche, Papierkorb, Audit
- Login über Supabase Auth im Web (API prüft JWT bereits, lokal `AUTH_LOCAL_OPEN=1`)
- Vercel-Einstieg für die API (`hono/vercel`), eigenes Vercel-Projekt
