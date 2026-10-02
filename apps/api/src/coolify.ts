import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { appAusUmgebung } from './kontext.ts';

/**
 * Einstieg auf einem eigenen Server (Docker, Coolify): ein Prozess für API und Oberfläche.
 *
 * Auf Vercel liefert die Plattform `apps/web/dist` aus und leitet `/api/*` an die Function (`vercel.ts`).
 * Hier gibt es nur diesen Prozess: `/api/*` geht an die App, alles andere kommt aus dem gebauten `apps/web/dist`.
 * Ohne Zeitlimit einer Function — PDF-Export und Auto-Import laufen im selben Prozess.
 */
const { app, speicher } = appAusUmgebung();
if (speicher) await speicher.bucketsSicherstellen().catch((e) => console.error('[speicher] Buckets:', e.message));

// serveStatic rechnet vom Arbeitsverzeichnis aus
const web = relative(process.cwd(), fileURLToPath(new URL('../../web/dist', import.meta.url))) || '.';
const oberflaeche = new Hono();
// Dateien mit Hash im Namen dürfen lange im Zwischenspeicher bleiben, index.html nie — sonst sieht der Browser einen neuen Stand nicht
oberflaeche.use('/assets/*', serveStatic({ root: web, onFound: (_pfad, c) => c.header('Cache-Control', 'public, max-age=31536000, immutable') }));
// Eine fehlende Datei unter /assets ist ein alter Stand im Browser — 404 statt index.html, sonst läuft dort HTML als Skript
oberflaeche.all('/assets/*', (c) => c.notFound());
oberflaeche.use('*', serveStatic({ root: web, onFound: (_pfad, c) => c.header('Cache-Control', 'no-cache') }));
// Alles andere ist eine Seite der App (Router im Browser)
oberflaeche.get('*', serveStatic({ root: web, path: 'index.html', onFound: (_pfad, c) => c.header('Cache-Control', 'no-cache') }));

const istApi = (pfad: string) => pfad === '/api' || pfad.startsWith('/api/');
const port = Number(process.env.PORT ?? process.env.API_PORT ?? 3101);
serve(
  { fetch: (anfrage, ...rest) => (istApi(new URL(anfrage.url).pathname) ? app.fetch(anfrage, ...rest) : oberflaeche.fetch(anfrage, ...rest)), port, hostname: '0.0.0.0' },
  () => console.log(`API und Oberfläche laufen auf Port ${port}`),
);
