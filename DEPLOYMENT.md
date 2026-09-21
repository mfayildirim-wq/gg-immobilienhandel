# Deployment auf Vercel

Stand 21.09.2026 — **vorbereitet, noch nie ausgeführt.** Es gibt kein Vercel-Projekt; alles hier ist lokal geprüft
(`pnpm vercel:probe`), nicht online. Offene Punkte stehen in `OFFEN.md` unter „Stufe 1".

## Zuschnitt

Ein Vercel-Projekt, eine Adresse:

| Teil | Woher | Wie |
|---|---|---|
| Oberfläche | `apps/web/dist` (Vite-Build) | statische Dateien; alles außer `/api/*` und `/assets/*` fällt auf `index.html` (SPA) |
| API | `api/index.mjs` → `apps/api/dist/vercel.mjs` | Function für alle `/api/*`-Routen, Region `fra1`, 60 s |
| PDF/PPTX | `api/render.mjs` → dasselbe Bündel | zweite Function für die drei Export-Routen: 300 s, mit gepacktem Chromium (`@sparticuz/chromium` 153, passend zu `playwright-core` 1.63). Speichergröße im Vercel-Dashboard einstellen (alte App: `docs/GO-LIVE-RUNBOOK.md`) |

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
| `OAUTH_HOSTS` | bei eigener Domain | zusätzliche Adressen für die Microsoft-Anmeldung; die Vercel-Domains gelten von selbst |

Nicht setzen: `AUTH_LOCAL_OPEN`, `KI_ATTRAPPE`, `M365_ATTRAPPE`, `PROPSTACK_ATTRAPPE` (in Produktion ohnehin wirkungslos).

## Einmalige Schritte

1. Vercel-Projekt anlegen, Repository verbinden, Root = Wurzel des Repos (die `vercel.json` liegt dort).
2. Variablen oben eintragen.
3. Migrationen gegen die Zieldatenbank anwenden — **laufen nicht mit dem Deploy mit**, bewusst von Hand.
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

## Was online noch nicht geht

- **PDF-Export**: der Weg über `@sparticuz/chromium` ist eingebaut, aber **online noch nie gelaufen** — die Linux-Binärdatei startet auf dem Mac nicht, prüfbar ist das nur im echten Deployment.
- **Uploads über 4,5 MB** (Grenze der Functions): braucht den Direkt-Upload über signierte Adressen.
- **Große Antworten** (PDF ~5 MB): braucht Streaming.
