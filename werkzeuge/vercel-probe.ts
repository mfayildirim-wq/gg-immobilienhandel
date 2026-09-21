/**
 * Probe des Vercel-Zuschnitts **ohne Vercel**: liefert `apps/web/dist` mit den Headern und Umleitungen aus
 * `vercel.json` aus und bedient `/api/*` über das gebündelte `api/index.mjs` — also genau die beiden Teile, die
 * online laufen. Danach öffnet ein Browser die wichtigsten Seiten und meldet, was die Content-Security-Policy
 * blockiert oder was sonst bricht.
 *
 *   pnpm --filter @gg/web build && pnpm --filter @gg/api bau:vercel && pnpm vercel:probe
 *
 * Ersetzt kein echtes Deployment (Function-Grenzen, Kaltstart, Dateisystem), findet aber CSP- und Bündelfehler vorher.
 */
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const WURZEL = join(import.meta.dirname, '..');
const DIST = join(WURZEL, 'apps/web/dist');
const konfig = JSON.parse(readFileSync(join(WURZEL, 'vercel.json'), 'utf8')) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
const kopf = konfig.headers.flatMap((h) => h.headers);
if (!existsSync(join(DIST, 'index.html'))) throw new Error('apps/web/dist fehlt — erst „pnpm --filter @gg/web build"');
const funktion = (await import(join(WURZEL, 'api/index.mjs'))) as Record<string, (r: Request) => Promise<Response>>;
const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon' };

const server = createServer(async (req, res) => {
  for (const h of kopf) res.setHeader(h.key, h.value);
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    const teile: Buffer[] = [];
    for await (const t of req) teile.push(t as Buffer);
    const koerper = ['GET', 'HEAD'].includes(req.method ?? 'GET') ? undefined : Buffer.concat(teile);
    const antwort = await funktion[req.method ?? 'GET']!(new Request(url, { method: req.method, headers: req.headers as Record<string, string>, body: koerper }));
    res.statusCode = antwort.status;
    antwort.headers.forEach((v, k) => res.setHeader(k, v));
    res.end(Buffer.from(await antwort.arrayBuffer()));
    return;
  }
  const datei = join(DIST, normalize(url.pathname));
  const ziel = datei.startsWith(DIST) && existsSync(datei) && statSync(datei).isFile() ? datei : join(DIST, 'index.html'); // SPA-Umleitung
  res.setHeader('content-type', MIME[extname(ziel)] ?? 'application/octet-stream');
  res.end(readFileSync(ziel));
});
await new Promise<void>((ok) => server.listen(0, ok));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch();
const page = await browser.newPage();
const funde: string[] = [];
let seite = '';
page.on('console', (m) => { if (m.type() === 'error') funde.push(`${seite} · Konsole: ${m.text().slice(0, 220)}`); });
page.on('pageerror', (e) => funde.push(`${seite} · Seitenfehler: ${e.message.slice(0, 220)}`));
page.on('response', (r) => { if (r.status() >= 500) funde.push(`${seite} · HTTP ${r.status()} ${new URL(r.url()).pathname}`); });

const SEITEN = ['/', '/deals', '/objekte', '/makler', '/kundenkalkulationen', '/vertriebslisten', '/begleitscheine', '/einstellungen/kalkulation', '/einstellungen/sicherung'];
let besucht = 0;
for (seite of SEITEN) {
  await page.goto(`http://localhost:${port}${seite}`, { waitUntil: 'networkidle', timeout: 30_000 });
  const text = (await page.locator('body').innerText()).trim();
  if (text.length < 20) funde.push(`${seite} · leere Seite (${text.length} Zeichen)`);
  besucht++;
}
const antwort = await page.request.get(`http://localhost:${port}/deals`);
const csp = antwort.headers()['content-security-policy'] ?? '';
await browser.close();
server.close();

if (besucht === 0) throw new Error('Keine Seite besucht — die Probe hat nichts geprüft.');
console.log(`${besucht} Seiten über den Vercel-Zuschnitt · CSP gesetzt: ${csp.length > 0} · ${funde.length} Funde`);
for (const f of [...new Set(funde)].slice(0, 25)) console.log('  ' + f);
process.exit(funde.length ? 1 : 0);
