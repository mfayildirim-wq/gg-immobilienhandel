# Offene Punkte

Stand 21.09.2026. Lebendes Dokument — beim Abarbeiten hier streichen, bei neuen Funden ergänzen.

**Fachlich ist der Neubau fertig und nachgewiesen gleich** (`pnpm paritaet`: 17 Bereiche, 2.305 Merkmale,
0 Abweichungen — zuletzt am 21.09.2026 mit den echten Standardwerten). Was fehlt, ist der **Betrieb**. Hintergrund in `../immohandel-doks/protokoll/13-validierung-und-vollstaendigkeit.md`.

## Wartet auf Zuarbeit

- [ ] **Fotos, Dokumente, Protokoll der Produktion.** Geliefert wurde am 21.09. der Browser-Export (nur die
      Geschäftsschlüssel). `obj_photos`, `deal_documents`, `audit_log` und die Bucket-Dateien fehlen darin —
      lokal ist dieser Teil **nicht prüfbar**. Entweder ein echter Abzug (`pg_dump --schema=app` + Buckets)
      oder der Probelauf direkt gegen die Produktion (nur lesend, `pnpm umzug:probe`).
- [ ] **`M365_ATTRAPPE=1` in die lokale `.env`.** Eine Zeile, dann ist `tests/e2e/angebote.spec.ts` grün.
      Von außen nicht setzbar: `--env-file` überschreibt Shell-Variablen.
- [ ] **Remote für dieses Repo.** Unter `mfayildirim`, **nicht** `acania-jonas`. Sichtbarkeit (privat
      empfohlen) und Name offen. Anlegen und Pushen nur auf ausdrückliche Freigabe.

## Echter Bestand (21.09.2026)

Umzug gegen 273 Deals / 285 Objekte / 141 Makler: **55 Prüfungen bestanden, keine unbekannten Felder, nichts mehr
„noch nicht umgezogen"**. `pnpm umzug:inventar` hat alle 690 Attribut-Pfade des Bestands gegen den Neubau
geprüft. Einzelheiten in `../immohandel-doks/protokoll/sessions/2026-09-21-echter-bestand.md`.

- [x] Makler-Kontaktfelder: `mobil`, `festnetz`, `strasse`, `plz`, `ort`, `weitere_kontakte` (Schema, Umzug,
      API, Makler-Profil, Exposé-Übernahme)
- [x] `immo-dd-template` → `dd_checkliste_vorlage` (34 Zeilen, Reihenfolge erhalten). **Oberfläche fehlt noch** —
      die alte App pflegt die Liste unter Einstellungen → DD.
- [x] `immo-offer-uids` → Einstellung `angebote-importierte-uids`. **Abnehmer fehlt noch**: die Angebots-Seite
      kennt keinen Duplikatschutz, der kommt mit dem Auto-Import.
- [x] Deal-Marker `_reconstructed*` begründet ausgelassen, `updatedAt` übernommen
- [ ] Eine Einheit mit `rend_k` = 655200 (Archiv-Deal) — Tippfehler im Bestand, wird beim Umzug leer. Fachfrage.
- [x] API-Tests hingen an den gespeicherten Kalkulations-Standards — sie legen sie jetzt für ihre Dauer beiseite
      (`apps/api/test/standardwerte.ts`); `pnpm verify` ist auch mit echtem Bestand grün
- [ ] **Umzug scharf**: unbekannte Felder zum Abbruchgrund machen — jetzt möglich, die Liste ist leer.

## Stufe 1 — vor dem Produktivgang

Ein zusammenhängender Arbeitsschritt; vorher hat nichts davon einen Gegenstand.

- [x] **Host-Allowlist für `redirectUri`** — Microsoft-Anmeldung leitet nur auf freigegebene Hosts zurück
      (`rueckwegPruefen` in `@gg/domain`, `OAUTH_HOSTS`)
- [x] **`hono/vercel`-Einstieg, `vercel.json`, Sicherheits-Header** — vorbereitet und lokal geprüft
      (`pnpm vercel:probe`), siehe `DEPLOYMENT.md`. CSP strenger als in der alten App: keine Inline-Skripte, kein `eval`.
- [x] **Online auf eigenem Vercel- und Supabase-Konto** — <https://gg-immobilienhandel.vercel.app>, echter Bestand
      umgezogen, Anmeldung, API und Header geprüft. Einzelheiten und Stolpersteine in `DEPLOYMENT.md`.
- [x] **Chromium für Vercel** — `@sparticuz/chromium` 153 + eigene Function `api/render.mjs`; PDF-Export online geprüft
- [ ] **KI-Schlüssel bei Vercel** (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`) — ohne sie online kein Exposé-Import, kein Diktat
- [ ] **Azure-Redirect-URI** `https://gg-immobilienhandel.vercel.app/m365/rueckweg` registrieren
- [x] **Direkt-Upload** für Exposés und Deal-Dokumente (Ticket → Browser lädt direkt in den Speicher → Übernahme
      prüft die liegende Datei). Gegen lokalen und Cloud-Speicher mit 6 MB geprüft. **Online geprüft am 21.09.2026.**
- [x] **Antwort-Streaming** für alle Datei-Antworten: PDF/PPTX-Exporte, Deal-Dokumente, Fotos, Sicherungs- und
      Audit-Export (`apps/api/src/strom.ts`, keine Längenangabe).
- [x] Online im echten Browser geprüft: 13,4-MB-Exposé hochgeladen (Eingang und Deal-Dokument), als Strom ohne
      Längenangabe in 1,2 s zurückgeladen, Byte für Byte gleich; keine CSP- oder CORS-Fehler
- [ ] **Noch durch die Function** (Grenze 4,5 MB): Sicherung einspielen (Bestand heute 3,5 MB — knapp), Fotos
      (nach Kompression meist klein), Diktat-Audio, Makler-Tabelle, Einheiten aus Mieterliste
- [ ] **Eingang aufräumen**: bricht der Browser zwischen Upload und Übernahme ab, bleibt ein Objekt unter
      `_eingang/` liegen — unsichtbar, aber es sammelt sich. Gehört zum Cron-Paket (Stufe 2).
- [ ] **Supabase-Dateigrenze**: im Free-Plan 50 MB je Datei; die App erlaubt 200 MB
- [ ] Header-Vergleichstest gegen die alte App (wie dort `vercel.json` gegen Erwartung)

## Stufe 2 — ab echten Daten

Erledigt und **online geprüft** am 21.09.2026. Gesamtbild und Ablauf der Produktivsetzung:
`../immohandel-doks/protokoll/17-prod-umgebung-mfayildirim.md`.

- [x] **Auto-Backups**: Cron 01:00 UTC → Bucket `backups`, Aufbewahrung `{daily:7, weekly:4, monthly:3, safety:3}`,
      Verwaltung mit Vorschau unter Einstellungen → Sicherung; Wiederherstellen legt vorher eine Sicherheitskopie an
- [x] **Archiv-Spiegel** der Storage-Buckets: Cron 01:30 UTC → Bucket `archive`, löscht und überschreibt nie
      (`_superseded/`), Verschwundenes wird datiert
- [x] **Upload-Eingang aufräumen** (im Archiv-Lauf, älter als 24 h)
- [x] **Cron-Absicherung**: `CRON_SECRET`, Default-Deny, Routen vor der Anmeldeprüfung
- [x] **Prod-Schutz**: Tests und lokal offener Server verweigern eine nicht-lokale Datenbank (`verlangeLokaleDatenbank`)
- [x] **Rate-Limits** auf KI, Diktat, Posteingang, Zugangsdaten (`middleware/begrenzung.ts`)
- [x] **Umzug scharf**: unbekannte Felder und nicht umgezogene Sammlungen brechen ab (`--nachsichtig` berichtet nur)
- [ ] **Archiv-Lauf stündlich** statt täglich — braucht Vercel Pro (`30 * * * *`)
- [ ] **CORS** mit Host-Prüfung, erst wenn Web und API getrennt ausgeliefert werden (heute dieselbe Adresse)

## Vor der Produktivsetzung

- [ ] **Dateien über die Projektgrenze kopieren** (`pdfs`, `deal-docs`, `obj-photos` von der alten Produktion in dieses
      Supabase-Projekt) — Werkzeug fehlt, Lesezugang fehlt. Ohne das zeigen alle Foto- und Dokument-Zeilen ins Leere.
- [ ] KI-Schlüssel, Azure-Redirect-URI, M365/Propstack neu hinterlegen, Nutzerkonten, Tarife (siehe Protokoll 17)

## Stufe 3 — Fachentscheidungen, kein Fehler

Die alte App verhält sich genauso; eine Änderung ist eine bewusste Abweichung vom Ist-Verhalten.
**Regel und Test gemeinsam ändern**, dazu Paritätsvergleich.

- [ ] **Dubletten serverseitig** beim Anlegen von Makler/Objekt, mit `trotzdemAnlegen`-Flag — der
      Exposé-Weg macht es bereits so, die anderen Wege nicht *(lohnt sich)*
- [ ] **Kundenkalkulation beim Speichern nachrechnen** — die Ankaufskalkulation macht es bereits so *(lohnt sich)*
- [ ] Telefon-/E-Mail-Prüfung serverseitig als Warnung *(Sauberkeit)*
- [ ] zod-Schemata für jsonb-Inhalte (`vertriebslisten.daten`, `kundenkalkulationen.inputs`) *(Sauberkeit)*

## Bewusst offen

- [x] **Auto-Import-Bot** — portiert am 21.09.2026 (`packages/integrations/src/autoimport/`, `services/autoImport.ts`,
      Angebots-Seite). Ablauf, Grenzen, Textmuster und KI-Prompts wörtlich aus der alten App; neu: Ports, Zielprüfung
      gegen interne Adressen, eigener Browser-Kontext je Mail, PDF-Prüfung ohne Rasterung, Ergebnis im Exposé-Eingang,
      Duplikatschutz auf dem Server. 12 Engine-Tests gegen Testseiten im echten Browser, 6 API-Tests, 1 Klicktest.
- [ ] **Auto-Import online freischalten.** Entscheidung des Auftraggebers vom 22.09.2026: der Bot bleibt online vorerst
      **aus** (`AUTO_IMPORT_AKTIV` nicht gesetzt → Routen 503, keine Bot-Knöpfe), kein `ANTHROPIC_API_KEY` bei Vercel.
      Freischalten heißt: KI-Schlüssel und `AUTO_IMPORT_AKTIV=ja` bei Vercel, M365 verbunden, Freigabe für AGB-Seiten.
- [ ] **Auto-Import gegen echte Maklerseiten prüfen.** Die Testseiten bilden die Seitenformen nach, an denen die alte
      Engine gewachsen ist — ob jede echte Seite noch passt, zeigt nur ein Lauf mit echten Mails (setzt das Freischalten
      voraus).
- [ ] Auto-Import: Zeitlimit in den Einstellungen einstellbar machen (`auto-import-zeitlimit-sek`, Standard 180 s;
      die alte App hatte dafür ein Feld)
- [x] **Ankaufseite mit zwei Reitern** (22.09.2026): „Deals kontaktieren“ und „Makler kontaktieren“ statt Deal-Liste plus
      Schubfach. Der Knopf neben „Nächste Kontakte“ wählt die Liste des aktiven Reiters in der angezeigten Reihenfolge
      durch (heute → überfällig → diese Woche, darin Termin, dann Status bzw. Prio); Zahlen und Fortschritt gelten je
      Reiter. Deals: je Halt der Makler des Deals, Ergebnis am Deal (`POST /api/deals/{id}/anruf-ergebnis`, Notiz als
      Kommentar). Makler: wie die alte Wählmaschine, jetzt mit derselben Liste wie das Cockpit (Fachfrage 7: A, ein
      Rückruf-Datum zählt). Der Telefonhörer im Kopf der App ist weg.
- [x] **KI-Anlässe sparsam** (23.09.2026, Branch `ki-anlaesse-sparsam`): Anlässe werden nur noch für die gewählte
      Makler-Karte und im Anruf-Briefing geladen (die alte App fragte für jede fällige Karte Web-Suche + KI ab — mit echtem
      Bestand >100 Aufrufe beim Öffnen, ab 60/min 429). Zwischenspeicher 24 h in der Tabelle `makler_anlaesse` statt im
      Prozess (online startet jede Function-Instanz leer). Gemessen: 1 Aufruf beim Öffnen statt >100. **Migration
      `20260923094658_makler_anlaesse` muss online von Hand eingespielt werden** (`npx supabase db push`).
- [ ] **Wählmaschine neu entwerfen.** Bis dahin ist ihr Klicktest übersprungen
      (`tests/e2e/ankauf.spec.ts`, Begründung steht dort). Beim Neuentwurf ohne Durchklicken durch die
      Warteschlange testen — der alte Test war davon abhängig, was vorherige Tests hinterlassen hatten.

- [x] **AgentMode Lieferung 1** (26.09.2026, Branch `agentmode`, `baf7ff4`): `@cosai/kern`, `@cosai/agentmode`, Overlay und
      Seite `/agent`, 26 `data-agent`-Marken, Klicktests 6/6. Protokoll 20, Fassung 4.
- [ ] **AgentMode nach `main`** — Merge macht der Auftraggeber. Online danach: Migrationen `…_cosai` und
      `…_cosai_gedaechtnis_index` einspielen (`npx supabase db push`), `ANTHROPIC_API_KEY` bei Vercel (sonst nur Attrappe).
- [x] **AgentMode Lieferung 2a** (26.09.2026): Lernen auch ohne Overlay, Vorschläge unter der Gesprächsnotiz,
      Morgenvorschlag einmal am Tag. Dazu drei Fehler, die nur mit dem echten Modell auftraten (temperature, halbe
      Antworten, falsche Gesamtzahlen nach dem Kürzen). Dev läuft mit `ANTHROPIC_API_KEY` (`KI_ATTRAPPE=0`); für Klicktests
      mit Attrappe `KI_ATTRAPPE=1` setzen und die API neu starten.
- [ ] AgentMode Lieferung 2b–5: Routinen, Realtime-Sprache, Meta-Agent,
      CoSAi-Backend in Python. Freigegebene Routinen ohne Rückfrage fehlen noch — heute wird jedes `sende` bestätigt.

## Erledigt (21.09.2026)

- [x] CI grün — sie lief erst seit dem Anlegen des Remotes und war von Anfang an rot (keine Dateiablage, kein Chrome-Pfad)

- [x] **Risikopuffer-Standard 0 % wurde ignoriert** (16.500 € statt 15.000 €) — gefunden von der Parallelprüfung mit den
      echten Standardwerten; behoben mit `kalkMitStandard` vor dem Rechenkern (wie `ensure()` der alten App)
- [x] DD-Dokumentenliste: Einstellungsseite wie in der alten App

- [x] Echten Bestand eingespielt (`pnpm umzug:quelle`), umgezogen, im Browser abgelaufen (`pnpm bestand:rundgang`)
- [x] Feld-Inventar (`pnpm umzug:inventar`)
- [x] Sicherung einspielen scheiterte an `dd_checkliste_vorlage` (ID „generated always") — fiel erst auf, als die
      Tabelle nicht mehr leer war

## Erledigt (19.09.2026)

- [x] Exposé-Symbol 📄 in der schmalen Deals-Liste (war beim Umbau verlorengegangen)
- [x] Vertrag nimmt `null` für nicht gefundene Felder an — echte Exposés wurden sonst abgewiesen
- [x] Wizard prüft je Schritt mit denselben Verträgen wie der Server
- [x] `KI_ATTRAPPE=1` gewinnt gegen einen gesetzten Schlüssel
- [x] `pnpm demo:daten` — Demo-Deals mit Exposé-PDF nach jedem `db:reset`
- [x] Hilfe-Links bei den Zugängen
- [x] Propstack-Zielstatus einstellbar (`GET/PUT /api/propstack/status`)
- [x] Erster Commit — vorher lag alles ungesichert im Arbeitsverzeichnis
