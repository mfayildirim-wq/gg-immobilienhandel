# Offene Punkte

Stand 19.09.2026. Lebendes Dokument — beim Abarbeiten hier streichen, bei neuen Funden ergänzen.

**Fachlich ist der Neubau fertig und nachgewiesen gleich** (`pnpm paritaet`: 17 Bereiche, 2.305 Merkmale,
0 Abweichungen). Was fehlt, ist der **Betrieb**. Hintergrund in `../protokoll/13-validierung-und-vollstaendigkeit.md`.

## Wartet auf Zuarbeit

- [ ] **DB-Dump der Produktion.** Soll ins alte Dev-System eingespielt werden; danach: Umzug gegen echten
      Bestand, Feld-Inventar, Umzug scharf schalten.
- [ ] **`M365_ATTRAPPE=1` in die lokale `.env`.** Eine Zeile, dann ist `tests/e2e/angebote.spec.ts` grün.
      Von außen nicht setzbar: `--env-file` überschreibt Shell-Variablen.
- [ ] **Remote für dieses Repo.** Unter `mfayildirim`, **nicht** `acania-jonas`. Sichtbarkeit (privat
      empfohlen) und Name offen. Anlegen und Pushen nur auf ausdrückliche Freigabe.

## Stufe 1 — vor dem Produktivgang

Ein zusammenhängender Arbeitsschritt; vorher hat nichts davon einen Gegenstand.

- [ ] **Vercel-Projekt** und `hono/vercel`-Einstieg — existiert noch nicht
- [ ] **Chromium für Vercel** (`@sparticuz/chromium`) — ohne das funktioniert online **kein** PDF-Export,
      obwohl Bankgespräch, Präsentation und Kundenkalkulation fachlich fertig sind (`packages/documents/src/pdf/browser.ts:5`)
- [ ] **Direkt-Upload** (Ticket → signierte URL → Übernahme) — sonst scheitert online jedes Exposé über
      4,5 MB; echte Exposés sind 0,7 bis 13,4 MB groß
- [ ] **Antwort-Streaming** für PDF-Exporte — Bank-Präsentation liegt bei ~5 MB
- [ ] **`vercel.json` + Sicherheits-Header** (CSP, X-Frame-Options, nosniff), mit Vergleichstest wie in der alten App
- [ ] **Host-Allowlist für `redirectUri`** (`app.ts`, M365-Anmeldung) — einzige echte Sicherheits-Regression

## Stufe 2 — ab echten Daten

- [ ] **Archiv-Spiegel** der Storage-Buckets + **Cron-Absicherung** — Fotos und Dokumente stehen in
      **keiner** Sicherung; Gelöschtes ist endgültig weg
- [ ] **Auto-Backups verwalten** — täglicher Cron, Aufbewahrung `{daily:7, weekly:4, monthly:3, safety:3}`,
      Liste mit Vorschau je Tabelle (aus `berichte/ui-abgleich-bewertung.md`)
- [ ] **Prod-Schutz** über alle DB-Variablen
- [ ] **Rate-Limits** auf den teuren Wegen (KI, Mail, Export)
- [ ] **CORS** mit Host-Prüfung, bevor Web und API getrennt ausgeliefert werden
- [ ] **Umzug scharf**: unbekannte Felder zum Abbruchgrund machen (heute nur im Bericht, `ok` bleibt true)

## Stufe 3 — Fachentscheidungen, kein Fehler

Die alte App verhält sich genauso; eine Änderung ist eine bewusste Abweichung vom Ist-Verhalten.
**Regel und Test gemeinsam ändern**, dazu Paritätsvergleich.

- [ ] **Dubletten serverseitig** beim Anlegen von Makler/Objekt, mit `trotzdemAnlegen`-Flag — der
      Exposé-Weg macht es bereits so, die anderen Wege nicht *(lohnt sich)*
- [ ] **Kundenkalkulation beim Speichern nachrechnen** — die Ankaufskalkulation macht es bereits so *(lohnt sich)*
- [ ] Telefon-/E-Mail-Prüfung serverseitig als Warnung *(Sauberkeit)*
- [ ] zod-Schemata für jsonb-Inhalte (`vertriebslisten.daten`, `kundenkalkulationen.inputs`) *(Sauberkeit)*

## Bewusst offen

- [ ] **Auto-Import-Bot** — 1.972 Zeilen, mehr als die Hälfte der gesamten Code-Lücke. Triage ist portiert,
      das Gate steht.
- [ ] **Wählmaschine neu entwerfen.** Bis dahin ist ihr Klicktest übersprungen
      (`tests/e2e/ankauf.spec.ts`, Begründung steht dort). Beim Neuentwurf ohne Durchklicken durch die
      Warteschlange testen — der alte Test war davon abhängig, was vorherige Tests hinterlassen hatten.

## Erledigt (19.09.2026)

- [x] Exposé-Symbol 📄 in der schmalen Deals-Liste (war beim Umbau verlorengegangen)
- [x] Vertrag nimmt `null` für nicht gefundene Felder an — echte Exposés wurden sonst abgewiesen
- [x] Wizard prüft je Schritt mit denselben Verträgen wie der Server
- [x] `KI_ATTRAPPE=1` gewinnt gegen einen gesetzten Schlüssel
- [x] `pnpm demo:daten` — Demo-Deals mit Exposé-PDF nach jedem `db:reset`
- [x] Hilfe-Links bei den Zugängen
- [x] Propstack-Zielstatus einstellbar (`GET/PUT /api/propstack/status`)
- [x] Erster Commit — vorher lag alles ungesichert im Arbeitsverzeichnis
