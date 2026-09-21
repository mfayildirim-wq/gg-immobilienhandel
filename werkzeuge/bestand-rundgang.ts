/**
 * Öffnet im Neubau **jede** Liste und **jeden** Datensatz einmal im Browser und hält fest, was dabei bricht.
 *
 * Der Umzug prüft Mengen und Summen — ob sich ein echter Datensatz auch **anzeigen** lässt, prüft er nicht.
 * Prüfbestände sind sauber; echte Bestände haben leere Pflichtfelder, Altformate und Ausreißer. Genau die
 * findet dieser Rundgang: Seitenfehler, Konsolenfehler, abgelehnte API-Aufrufe und die Fehlerseite der App.
 *
 *   pnpm bestand:rundgang            (Neubau muss laufen: 5273 / 3101)
 *   pnpm bestand:rundgang --probe    (nur die ersten 5 je Bereich — zum Ausprobieren)
 *
 * Ergebnis: berichte/bestand-rundgang.md
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const WEB = process.env.NEU_WEB ?? 'http://localhost:5273';
const API = process.env.NEU_API ?? 'http://localhost:3101';
const probe = process.argv.includes('--probe');

const liste = async (pfad: string): Promise<{ id: string }[]> => {
  const r = await fetch(`${API}${pfad}`);
  if (!r.ok) throw new Error(`${pfad}: HTTP ${r.status}`);
  return (await r.json()) as { id: string }[];
};

const LISTEN = ['/', '/deals', '/objekte', '/makler', '/kundenkalkulationen', '/vertriebslisten', '/projekte', '/begleitscheine', '/angebote', '/einstellungen'];
const BEREICHE = [
  { titel: 'Deals', api: '/api/deals', url: (id: string) => `/deals?deal=${encodeURIComponent(id)}` },
  { titel: 'Objekte', api: '/api/objekte', url: (id: string) => `/objekte?objekt=${encodeURIComponent(id)}` },
  { titel: 'Makler', api: '/api/makler', url: (id: string) => `/makler?makler=${encodeURIComponent(id)}` },
  { titel: 'Kundenkalkulationen', api: '/api/kundenkalkulationen', url: (id: string) => `/kundenkalkulationen/${encodeURIComponent(id)}` },
  { titel: 'Begleitscheine', api: '/api/begleitscheine', url: (id: string) => `/begleitscheine/${encodeURIComponent(id)}` },
];

interface Fund { bereich: string; url: string; art: string; text: string }
const funde: Fund[] = [];
let aktuell = { bereich: '', url: '' };

function lauschen(page: Page) {
  const fund = (art: string, text: string) => funde.push({ ...aktuell, art, text: text.slice(0, 300) });
  page.on('pageerror', (e) => fund('Seitenfehler', e.message));
  page.on('console', (m) => { if (m.type() === 'error') fund('Konsole', m.text()); });
  page.on('response', (r) => { if (r.status() >= 400 && r.url().includes('/api/')) fund(`HTTP ${r.status()}`, r.url().replace(API, '').replace(WEB, '')); });
}

async function besuchen(page: Page, bereich: string, url: string) {
  aktuell = { bereich, url };
  try {
    await page.goto(`${WEB}${url}`, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (e) {
    funde.push({ ...aktuell, art: 'Zeitüberschreitung', text: e instanceof Error ? e.message.split('\n')[0]! : String(e) });
    return;
  }
  const inhalt = (await page.locator('body').innerText()).trim();
  if (inhalt.length < 20) funde.push({ ...aktuell, art: 'Leere Seite', text: `nur ${inhalt.length} Zeichen sichtbar` });
  if (/Something went wrong|Unerwarteter Fehler|Etwas ist schiefgelaufen/i.test(inhalt)) funde.push({ ...aktuell, art: 'Fehlerseite', text: inhalt.slice(0, 200) });
}

const gesund = await fetch(`${API}/api/health`).catch(() => null);
if (!gesund?.ok) throw new Error(`Neubau nicht erreichbar unter ${API} — „pnpm dev" starten`);

const browser = await chromium.launch();
const page = await browser.newPage();
lauschen(page);

const besucht: Record<string, number> = {};
for (const url of LISTEN) { await besuchen(page, 'Listen', url); besucht.Listen = (besucht.Listen ?? 0) + 1; }
for (const b of BEREICHE) {
  const alle = await liste(b.api);
  const ids = probe ? alle.slice(0, 5) : alle;
  // Geprüft wird nur, wenn es etwas zu prüfen gab: ein leerer Bereich ist kein bestandener.
  if (alle.length === 0) funde.push({ bereich: b.titel, url: b.api, art: 'Leerer Bereich', text: 'keine Datensätze — nichts geprüft' });
  for (const [i, { id }] of ids.entries()) {
    await besuchen(page, b.titel, b.url(id));
    if ((i + 1) % 50 === 0) console.log(`${b.titel}: ${i + 1}/${ids.length} · Funde bisher ${funde.length}`);
  }
  besucht[b.titel] = ids.length;
  console.log(`${b.titel}: ${ids.length} besucht`);
}
await browser.close();

const gesamt = Object.values(besucht).reduce((a, b) => a + b, 0);
if (gesamt <= LISTEN.length) throw new Error('Kein einziger Datensatz besucht — der Rundgang hat nichts geprüft.');

const jeArt = new Map<string, Fund[]>();
for (const f of funde) jeArt.set(`${f.bereich} · ${f.art} · ${f.text.replace(/[0-9a-z]{15,}|\d+/gi, '#')}`, [...(jeArt.get(`${f.bereich} · ${f.art} · ${f.text.replace(/[0-9a-z]{15,}|\d+/gi, '#')}`) ?? []), f]);

const zeilen = [
  '# Bestands-Rundgang', '',
  `Stand ${new Date().toISOString()}${probe ? ' · **Probe** (5 je Bereich)' : ''} · ${gesamt} Seiten besucht · **${funde.length} Funde** in ${jeArt.size} Gruppen`, '',
  '| Bereich | besucht |', '|---|---|', ...Object.entries(besucht).map(([k, v]) => `| ${k} | ${v} |`), '',
  '## Funde (gleichartige zusammengefasst)', '',
  ...(jeArt.size === 0 ? ['Keine.'] : [...jeArt.entries()].sort((a, b) => b[1].length - a[1].length).flatMap(([k, fs]) => [
    `### ${fs.length}× ${k}`, '', ...fs.slice(0, 5).map((f) => `- \`${f.url}\` — ${f.text}`), fs.length > 5 ? `- … und ${fs.length - 5} weitere` : '', '',
  ])),
];
mkdirSync('berichte', { recursive: true });
writeFileSync('berichte/bestand-rundgang.md', zeilen.join('\n'));
console.log(`\n${gesamt} Seiten · ${funde.length} Funde in ${jeArt.size} Gruppen → berichte/bestand-rundgang.md`);
process.exitCode = funde.length ? 1 : 0;
