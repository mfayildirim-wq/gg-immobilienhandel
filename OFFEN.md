# Offene Punkte

Stand 21.09.2026. Lebendes Dokument — beim Abarbeiten hier streichen, bei neuen Funden ergänzen.

**Fachlich ist der Neubau fertig und nachgewiesen gleich** (`pnpm paritaet`: 17 Bereiche, 2.305 Merkmale,
0 Abweichungen). Was fehlt, ist der **Betrieb**. Hintergrund in `../protokoll/13-validierung-und-vollstaendigkeit.md`.

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
geprüft. Einzelheiten in `../protokoll/sessions/2026-09-21-echter-bestand.md`.

- [x] Makler-Kontaktfelder: `mobil`, `festnetz`, `strasse`, `plz`, `ort`, `weitere_kontakte` (Schema, Umzug,
      API, Makler-Profil, Exposé-Übernahme)
- [x] `immo-dd-template` → `dd_checkliste_vorlage` (34 Zeilen, Reihenfolge erhalten). **Oberfläche fehlt noch** —
      die alte App pflegt die Liste unter Einstellungen → DD.
- [x] `immo-offer-uids` → Einstellung `angebote-importierte-uids`. **Abnehmer fehlt noch**: die Angebots-Seite
      kennt keinen Duplikatschutz, der kommt mit dem Auto-Import.
- [x] Deal-Marker `_reconstructed*` begründet ausgelassen, `updatedAt` übernommen
- [ ] Eine Einheit mit `rend_k` = 655200 (Archiv-Deal) — Tippfehler im Bestand, wird beim Umzug leer. Fachfrage.
- [ ] **API-Tests hängen am Inhalt der Datenbank.** Mit echtem Bestand (eigene Kalkulations-Standards) werden
      4 Tests in `apps/api/test` rot, auf frischer DB sind sie grün. Vor `pnpm verify` deshalb `pnpm db:reset`,
      danach `pnpm umzug`. Sauber wäre: Tests legen ihre Voraussetzungen selbst an.
- [ ] **Umzug scharf**: unbekannte Felder zum Abbruchgrund machen — jetzt möglich, die Liste ist leer.

## Stufe 1 — vor dem Produktivgang

Ein zusammenhängender Arbeitsschritt; vorher hat nichts davon einen Gegenstand.

- [x] **Host-Allowlist für `redirectUri`** — Microsoft-Anmeldung leitet nur auf freigegebene Hosts zurück
      (`rueckwegPruefen` in `@gg/domain`, `OAUTH_HOSTS`)
- [x] **`hono/vercel`-Einstieg, `vercel.json`, Sicherheits-Header** — vorbereitet und lokal geprüft
      (`pnpm vercel:probe`), siehe `DEPLOYMENT.md`. CSP strenger als in der alten App: keine Inline-Skripte, kein `eval`.
- [ ] **Vercel-Projekt anlegen und einmal wirklich deployen** — braucht Konto und Freigabe; erst das zeigt
      Function-Größe, Kaltstart und das schreibgeschützte Dateisystem
- [ ] **Chromium für Vercel** (`@sparticuz/chromium`) — ohne das funktioniert online **kein** PDF-Export,
      obwohl Bankgespräch, Präsentation und Kundenkalkulation fachlich fertig sind (`packages/documents/src/pdf/browser.ts:5`)
- [ ] **Direkt-Upload** (Ticket → signierte URL → Übernahme) — sonst scheitert online jedes Exposé über
      4,5 MB; echte Exposés sind 0,7 bis 13,4 MB groß
- [ ] **Antwort-Streaming** für PDF-Exporte — Bank-Präsentation liegt bei ~5 MB
- [ ] Header-Vergleichstest gegen die alte App (wie dort `vercel.json` gegen Erwartung)

## Stufe 2 — ab echten Daten

- [ ] **Archiv-Spiegel** der Storage-Buckets + **Cron-Absicherung** — Fotos und Dokumente stehen in
      **keiner** Sicherung; Gelöschtes ist endgültig weg
- [ ] **Auto-Backups verwalten** — täglicher Cron, Aufbewahrung `{daily:7, weekly:4, monthly:3, safety:3}`,
      Liste mit Vorschau je Tabelle (aus `berichte/ui-abgleich-bewertung.md`)
- [ ] **Prod-Schutz** über alle DB-Variablen
- [ ] **Rate-Limits** auf den teuren Wegen (KI, Mail, Export)
- [ ] **CORS** mit Host-Prüfung, bevor Web und API getrennt ausgeliefert werden

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

## Erledigt (21.09.2026)

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
