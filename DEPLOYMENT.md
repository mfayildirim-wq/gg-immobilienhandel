# Deployment auf Vercel

Stand 21.09.2026 — **läuft online** auf dem Konto des Auftraggebers (eigenes Vercel- und Supabase-Projekt, getrennt
von der echten Produktion der alten App). Offene Punkte stehen in `OFFEN.md` unter „Stufe 1".

## Stand der Einrichtung (21.09.2026)

| | |
|---|---|
| GitHub | `mfayildirim-wq/gg-immobilienhandel`, privat |
| Supabase | Projekt `gg-immobilienhandel`, Ref `zbqdkfqsqdocrxxrtjow`, Frankfurt (`eu-central-1`), Organisation MFY. 7 Migrationen angewendet (37 Tabellen in `fach`), Buckets `pdfs`, `deal-docs`, `obj-photos` privat angelegt. Echter Bestand umgezogen am 21.09.2026. |
| Vercel | Team `mfy` (Hobby), Projekt `gg-immobilienhandel`, mit dem Repo verbunden, 7 Variablen für Production gesetzt |
| Zugangsdaten | nur lokal in `~/Documents/ivtag/immohandel-doks/.geheim/cloud.env` (Rechte 600, dort per `.gitignore` ausgeschlossen) und verschlüsselt bei Vercel — nicht im Repo |

**Online seit 21.09.2026:** <https://gg-immobilienhandel.vercel.app> — geprüft: Oberfläche, Anmeldung
(Supabase Auth, Registrierung geschlossen, E-Mail-Allowlist), API (ohne Token 401), Sicherheits-Header,
**PDF-Export mit dem gepackten Chromium** (Kundenkalkulation: 239 KB in 6,4 s), echter Bestand umgezogen
(alle Prüfungen bestanden). Vercel Hobby hat die 300 s der PDF-Function angenommen.

## Testumgebung (seit 23.09.2026)

Zweite, vollständig getrennte Umgebung zum Prüfen vor dem Produktivgang — **ohne Änderung am Code**: die
`vercel.json` lässt nur Builds mit `VERCEL_ENV=production` zu, und im Testprojekt ist der Branch `test` die Produktion.

| | |
|---|---|
| Adresse | <https://gg-immobilienhandel-test.vercel.app> |
| Branch | `test` — Sammelbranch: `main` plus alle offenen Pull Requests, die geprüft werden sollen |
| Vercel | Projekt `gg-immobilienhandel-test` (Team `mfy`), Produktions-Branch `test`, Node 24, eigene 8 Variablen (nur Production) |
| Supabase | Projekt `gg-immobilienhandel-test`, Ref `kpvlmvkyvickqtdswzmh`, Frankfurt, Organisation MFY; 8 Migrationen, 38 Tabellen, 5 Buckets, Registrierung geschlossen |
| Zugangsdaten | `~/Documents/ivtag/immohandel-doks/.geheim/cloud-test.env` (eigenes Passwort, eigener `GG_ENCRYPTION_KEY`, eigenes `CRON_SECRET`) |
| Alle Adressen | Dev, Test, Prod mit Konsolen: `../immohandel-doks/protokoll/18-umgebungen-mfayildirim.md` |
| Bestand | per `pnpm umzug` aus der alten lokalen DB (55/55 Prüfungen); Fotos und Dokumente fehlen wie online |

**Ablauf:** Branch → Pull Request → in `test` mergen (`git merge --no-ff`) → Push baut die Testumgebung (~2 min) →
online prüfen → erst dann Pull Request nach `main` mergen. **Migrationen** laufen auch hier nicht mit dem Deploy:
`npx supabase db push --db-url "$DATABASE_URL_SESSION"` aus `cloud-test.env`, vorher `--dry-run`.

Was dort anders ist: kein KI-Schlüssel (KI-Funktionen aus), kein M365, Auto-Import aus. Die nächtlichen Crons laufen
auch dort (sichern nur Testdaten). Supabase Free pausiert das Projekt nach einer Woche ohne Zugriff — im Dashboard wecken.

**Drei Stolpersteine des ersten Deployments — für das nächste Mal:**

1. **`BLOCKED / COMMIT_AUTHOR_REQUIRED`** (auch per CLI): Vercel braucht zum Commit-Autor ein GitHub-Konto.
   Das Vercel-Konto muss mit GitHub verbunden sein **und** die Commit-Adresse muss GitHub einem Konto zuordnen.
   In diesem Repo steht deshalb `git config user.email` auf der GitHub-Adresse `…+mfayildirim-wq@users.noreply.github.com`.
   `vercel inspect` zeigt dabei nur „UNKNOWN" — der Grund steht in der API (`readyStateReason`).
2. **`FUNCTION_INVOCATION_FAILED` auf jeder Route:** pdfjs verlangt beim Laden `DOMMatrix` aus `@napi-rs/canvas`;
   das Paket fehlte in der Function. Jetzt wird pdfjs erst beim ersten PDF geladen, und `includeFiles` nimmt
   Canvas und pdfjs mit. Lokal unsichtbar — dort ist das Paket installiert.
3. **`vercel link` schreibt `.env*` in die `.gitignore`** — das verschluckt `.env.example`. Eingegrenzt auf `.vercel`.

**Noch offen:** `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` bei Vercel (ohne sie kein Exposé-Import, kein Diktat),
Azure-Redirect-URI für M365, Fotos und Dokumente der Produktion (nicht im Export), Direkt-Upload über 4,5 MB,
Streaming großer PDFs. Für gewerblichen Betrieb Vercel Pro; Supabase Free pausiert nach einer Woche ohne Zugriff.

## Zuschnitt

Ein Vercel-Projekt, eine Adresse:

| Teil | Woher | Wie |
|---|---|---|
| Oberfläche | `apps/web/dist` (Vite-Build) | statische Dateien; alles außer `/api/*` und `/assets/*` fällt auf `index.html` (SPA) |
| API | `api/index.mjs` → `apps/api/dist/vercel.mjs` | Function für alle `/api/*`-Routen, Region `fra1`, 60 s |
| PDF/PPTX | `api/render.mjs` → dasselbe Bündel | zweite Function für die drei Export-Routen, die Cron-Läufe und den Auto-Import (`/api/auto-import/*`): 300 s, mit gepacktem Chromium (`@sparticuz/chromium` 153, passend zu `playwright-core` 1.63). Speichergröße im Vercel-Dashboard einstellen (alte App: `docs/GO-LIVE-RUNBOOK.md`) |

Die Oberfläche ruft die API relativ (`/api/...`) — gleiche Adresse, kein CORS.

**Warum gebündelt wird:** Die Pakete des Arbeitsbereichs sind TypeScript-Quellen mit `.ts`-Importen. Lokal führt `tsx`
das direkt aus, der Node-Builder von Vercel nicht. `apps/api/bau-vercel.mjs` bündelt deshalb im Bauschritt
`src/vercel.ts` zu einer Datei; `api/index.mjs` lädt nur das Ergebnis. Der Zusammenbau der App
(`apps/api/src/kontext.ts`) ist für lokalen Server und Vercel derselbe.

**Nur Produktion wird gebaut** (`ignoreCommand`, wie in der alten App): Vorschau-Deployments liefen sonst mit dem
Code eines Branches gegen die echte Datenbank.

## Umgebungsvariablen (Vercel → Settings → Environment Variables, nur „Production")

| Variable | Pflicht | Wofür |
|---|---|---|
| `DATABASE_URL` | ja | Postgres über den Supabase-Pooler (Transaction Mode, Port 6543) |
| `SUPABASE_URL` | ja | Anmeldung (JWT-Prüfung) und Dateiablage |
| `SUPABASE_SERVICE_ROLE_KEY` | ja | Dateiablage (Fotos, Dokumente, Exposés) |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | ja | Anmeldung in der Oberfläche — werden **beim Bauen** eingesetzt |
| `AUTH_ALLOWED_EMAILS` | ja | wer sich anmelden darf, kommagetrennt |
| `GG_ENCRYPTION_KEY` | ja | base64 von 32 Byte; verschlüsselt hinterlegte Zugänge. **Ohne ihn startet die API online nicht** — ein online erzeugter Schlüssel überlebte keinen Kaltstart. Erzeugen: `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | für KI | Exposé-Import, Makler-Zusammenfassungen |
| `OPENAI_API_KEY` | für Diktat | Transkription |
| `CRON_SECRET` | ja | schützt `/api/cron/sicherung` und `/api/cron/archiv`; Vercel hängt es als `Authorization: Bearer …` an. Ohne Wert antworten beide immer mit 401 |
| `OAUTH_HOSTS` | bei eigener Domain | zusätzliche Adressen für die Microsoft-Anmeldung; die Vercel-Domains gelten von selbst |
| `AUTO_IMPORT_AKTIV` | zum Freischalten | Auto-Import-Bot. **Online ist er aus, bis hier `ja` steht** — dann antworten `/api/auto-import/lauf` und `…/abbrechen` mit 503 und die Oberfläche zeigt keine Bot-Knöpfe. Braucht zusätzlich `ANTHROPIC_API_KEY`, die M365-Verbindung und für AGB-Seiten die Freigabe unter Einstellungen → Freigaben |

Nicht setzen: `AUTH_LOCAL_OPEN`, `KI_ATTRAPPE`, `M365_ATTRAPPE`, `PROPSTACK_ATTRAPPE` (in Produktion ohnehin wirkungslos).

## Einmalige Schritte

1. Vercel-Projekt anlegen, Repository verbinden, Root = Wurzel des Repos (die `vercel.json` liegt dort).
2. Variablen oben eintragen.
3. Migrationen gegen die Zieldatenbank anwenden — **laufen nicht mit dem Deploy mit**, bewusst von Hand:
   `npx supabase db push --dry-run`, dann ohne `--dry-run`. Stand 24.09.2026: alle 8 Migrationen online (38 Tabellen).
4. Storage-Buckets anlegen (lokal macht das `server.ts` beim Start, online niemand).
5. In Azure AD die Redirect-URI `https://<adresse>/m365/rueckweg` registrieren.
6. Erst danach: `pnpm umzug:probe` gegen die Produktion (nur lesend), dann der Umzug.

## Vor jedem Deployment

```bash
pnpm --filter @gg/web build && pnpm --filter @gg/api bau:vercel
pnpm vercel:probe     # gebaute Oberfläche + gebündelte API + Header aus vercel.json, im Browser
```

Die Probe findet Bündelfehler und alles, was die Content-Security-Policy blockiert. Sie ersetzt **kein** echtes
Deployment: Function-Größe, Kaltstart und das schreibgeschützte Dateisystem zeigt nur Vercel selbst.

## SharePoint als Dokumentablage (Protokoll 19, seit 25.09.2026)

Dokumente an Deals und Objekten können in einer SharePoint-Dokumentbibliothek liegen; Bestände bleiben in Supabase
lesbar, bis sie übertragen werden. Ohne Einrichtung verhält sich alles wie zuvor.

1. **Azure (einmalig, Administrator):** in der App-Registrierung aus Einstellungen → Microsoft 365 die
   Anwendungsberechtigung `Sites.Selected` hinzufügen, Administratorzustimmung erteilen. Dann der App Schreibrechte auf
   genau eine Site geben — Graph Explorer als Admin (Zustimmung `Sites.FullControl.All` nur für den Explorer):
   `GET /sites/<host>.sharepoint.com:/sites/<Name>` → `id`, dann
   `POST /sites/<id>/permissions` mit `{ "roles": ["write"], "grantedToIdentities": [ { "application": { "id": "<Client-ID>", "displayName": "GG Immohandel" } } ] }`.
2. **App:** Einstellungen → Microsoft 365 (Client-ID, Tenant, Geheimnis — dieselbe App), dann Einstellungen → SharePoint:
   Site-Adresse, Wurzelordner, Speichern, **Verbindung prüfen** (schreibt/liest/löscht eine Probedatei), einschalten.
3. **CSP:** `connect-src` und `frame-src` erlauben `https://*.sharepoint.com` (Upload-Session und Vorschau) — steht in `vercel.json`.
4. **Bestand:** Einstellungen → SharePoint → „Bestand nach SharePoint übertragen“, 25 je Lauf, wiederaufnehmbar; die
   Supabase-Datei bleibt als Rückweg. „Abgleich“ findet in SharePoint verschobene Dateien über ihre Kennung wieder.
5. **Werkzeug:** `pnpm sharepoint:probe` prüft eine Site mit App-Token aus der Umgebung (`M365_TENANT_ID`, `M365_CLIENT_ID`,
   `M365_CLIENT_SECRET`, `SHAREPOINT_SITE_ID`).

Ablage: `<Wurzel>/Objekte/<Adresse> [<objekt-id>]/…` und `…/Deals/<deal-id>/…`. Große Dateien gehen vom Browser direkt an
die Graph-Upload-Session (Stücke mit `Content-Range`), Downloads über die kurzlebige Download-Adresse — beides ohne die
4,5-MB-Grenze der Function. SharePoint-Dateien sind **nicht** im Archiv-Spiegel; SharePoint versioniert selbst.

## Nächtliche Läufe (`vercel.json` → `crons`)

| Zeit (UTC) | Route | Was |
|---|---|---|
| 01:00 | `/api/cron/sicherung` | Bestand als Datei in `backups`, danach Aufbewahrung 7/4/3/3 |
| 01:30 | `/api/cron/archiv` | Upload-Eingang aufräumen, dann Dateien nach `archive` spiegeln |

Beide laufen über die lang laufende Function (`api/render.mjs`, 300 s). Buckets `backups` und `archive` müssen
existieren (einmalig `bucketsSicherstellen`). Vercel Hobby erlaubt Crons nur einmal täglich — die alte Produktion
spiegelt stündlich. Von Hand auslösen: `curl -H "Authorization: Bearer $CRON_SECRET" https://…/api/cron/sicherung`.

## Grenzen der Functions (4,5 MB hinein und hinaus)

- **Hinein:** Exposés und Deal-Dokumente gehen per Direkt-Upload an der Function vorbei (`/api/upload/ticket` →
  PUT an den Speicher → `…/uebernehmen`). Die CSP erlaubt dem Browser dafür `https://*.supabase.co`.
- **Hinaus:** jede Datei-Antwort ist ein Strom ohne `Content-Length` (`apps/api/src/strom.ts`) — nur so nimmt
  Vercel sie von der Grenze aus.
- **Noch durch die Function:** Sicherung einspielen, Fotos, Diktat, Makler-Tabelle, Mieterliste — siehe `OFFEN.md`.
