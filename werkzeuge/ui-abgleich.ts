/**
 * Stellt die Bedienelemente beider Apps Seite für Seite gegenüber.
 *
 * Die Parallelprüfung (`pnpm paritaet`) vergleicht **Werte** — ob beide Apps dasselbe rechnen und anzeigen.
 * Sie sagt nichts darüber, ob eine Schaltfläche fehlt: ein verschwundenes „📄 Exposé öffnen" fällt dort nicht auf,
 * weil kein Wert davon abhängt. Genau das prüft dieses Werkzeug.
 *
 * Es ist ein **Analysewerkzeug, kein Test**: Das neue Design ist gewollt anders, deshalb ist jeder Fund ein
 * Prüfpunkt, kein Fehler. Die Bewertung („gewollt" / „fehlt") passiert von Hand im Bericht.
 *
 *   pnpm ui:abgleich          (beide Apps müssen laufen: 5173 alt, 5273 neu)
 *
 * Ergebnis: berichte/ui-abgleich.md
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

const ALT = 'http://localhost:5173';
const NEU = 'http://localhost:5273';

/** Seite der alten App → Route des Neubaus. */
const SEITEN = [
  { alt: 'ankauf', neu: '/', titel: 'Ankauf-Cockpit' },
  { alt: 'deals', neu: '/deals', titel: 'Deals' },
  { alt: 'objekte', neu: '/objekte', titel: 'Objekte' },
  { alt: 'makler', neu: '/makler', titel: 'Makler' },
  { alt: 'kkalk', neu: '/kundenkalkulationen', titel: 'Kundenkalkulation' },
  { alt: 'begleitscheine', neu: '/begleitscheine', titel: 'Begleitscheine' },
  { alt: 'vertriebslisten', neu: '/vertriebslisten', titel: 'Vertriebslisten' },
  { alt: 'pm', neu: '/projekte', titel: 'Projektmanagement' },
  { alt: 'settings', neu: '/einstellungen', titel: 'Einstellungen', unterseiten: true },
] as const;

/** Die Einstellungen des Neubaus verteilen sich auf Unterseiten; alle zusammen entsprechen der einen alten Seite. */
const EINSTELLUNGEN_UNTER = [
  '', '/kalkulation', '/vorlagen', '/vertriebslisten', '/zugaenge', '/sicherung', '/papierkorb',
  '/dubletten', '/audit', '/werkzeuge', '/freigaben', '/m365', '/anleitungen',
];

interface Bedienung { knoepfe: string[]; felder: string[]; spalten: string[]; reiter: string[] }

/** Was ein Nutzer auf der Seite anfassen kann — Beschriftungen, normalisiert. */
const SAMMLE = `() => {
  const sichtbar = (e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
  };
  const txt = (e) => (e.getAttribute('aria-label') || e.textContent || e.getAttribute('title') || '')
    .replace(/\\s+/g, ' ').trim().slice(0, 60);
  // Die Hauptnavigation steht auf jeder Seite und heißt im Neubau anders (\u201eObjekte\u201c statt \u201e\ud83c\udfe2 Objektdatenbank\u201c) —
  // sie als Verlust zu melden, verrauscht jede Seite. Ebenso Inhalte, die nur zufällig in einem Link stehen.
  const istNavigation = (e) => !!e.closest('nav, .ntabs, [aria-label="Hauptnavigation"]') || e.classList.contains('ntab');
  const istDaten = (t) => /^[+\\d][\\d\\s\\/()-]{6,}$/.test(t) || /^[^@\\s]+@[^@\\s]+\\.[a-z]{2,}$/i.test(t) || /^https?:/.test(t);
  const liste = (sel, f) => [...new Set([...document.querySelectorAll(sel)]
    .filter((e) => sichtbar(e) && !istNavigation(e)).map(f || txt).filter((t) => t && !istDaten(t)))].sort();
  return {
    knoepfe: liste('button:not([aria-hidden="true"]), a[href]:not([aria-hidden="true"]), [role="button"]'),
    felder: liste('input:not([type=hidden]), select, textarea', (e) =>
      (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.labels?.[0]?.textContent || e.name || '')
        .replace(/\\s+/g, ' ').trim().slice(0, 60)),
    spalten: liste('table th'),
    reiter: liste('[role="tab"], .tab, .ntab'),
  };
}`;

async function altSeite(page: Page, name: string): Promise<Bedienung> {
  await page.evaluate((n) => (window as unknown as { showPage: (s: string) => void }).showPage(n), name);
  await page.waitForTimeout(700);
  return page.evaluate(`(${SAMMLE})()`) as Promise<Bedienung>;
}

async function neuSeite(page: Page, route: string): Promise<Bedienung> {
  // Der Neubau zeigt Listen standardmäßig schmal neben dem Detail; für den Spaltenvergleich braucht es die Tabelle.
  await page.addInitScript(() => {
    try { for (const m of ['deals', 'objekte', 'makler']) localStorage.setItem(`gg.${m}.layout`, 'untereinander'); } catch { /* */ }
  });
  await page.goto(NEU + route, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  return page.evaluate(`(${SAMMLE})()`) as Promise<Bedienung>;
}

/** Grobe Zuordnung: Beschriftungen unterscheiden sich im neuen Design, der Kern soll aber wiederkehren. */
const kern = (s: string) => s.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const findetSich = (was: string, wo: string[]) => {
  const k = kern(was);
  if (!k || k.length < 3) return true;
  return wo.some((x) => { const y = kern(x); return y.includes(k) || k.includes(y); });
};

const browser = await chromium.launch();
const altSeiteTab = await browser.newPage();
const neuSeiteTab = await browser.newPage();
await altSeiteTab.goto(ALT, { waitUntil: 'networkidle' });
await altSeiteTab.waitForTimeout(2500); // die alte App baut ihre Seiten beim Start auf

const zeilen: string[] = [
  '# UI-Abgleich alt → neu', '',
  `Stand: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · erzeugt mit \`pnpm ui:abgleich\``, '',
  'Verglichen werden **Bedienelemente** (Schaltflächen, Links, Eingabefelder, Tabellenspalten, Reiter),',
  'nicht Werte — dafür gibt es die Parallelprüfung. Das neue Design ist gewollt anders:',
  'jeder Eintrag hier ist ein **Prüfpunkt**, kein Fehler.', '',
];
let summeFehlt = 0;

for (const { alt, neu, titel } of SEITEN) {
  let a: Bedienung | null = null;
  let n: Bedienung | null = null;
  let panne = '';
  try { a = await altSeite(altSeiteTab, alt); } catch (e) { panne = `alte App: ${(e as Error).message.split('\n')[0]}`; }
  try {
    if ((SEITEN.find((x) => x.alt === alt) as { unterseiten?: boolean }).unterseiten) {
      // Alle Unterseiten zusammenfassen: erst ihre Summe entspricht der einen Einstellungsseite der alten App.
      const teile: Bedienung[] = [];
      for (const u of EINSTELLUNGEN_UNTER) teile.push(await neuSeite(neuSeiteTab, neu + u));
      n = {
        knoepfe: [...new Set(teile.flatMap((t) => t.knoepfe))].sort(),
        felder: [...new Set(teile.flatMap((t) => t.felder))].sort(),
        spalten: [...new Set(teile.flatMap((t) => t.spalten))].sort(),
        reiter: [...new Set(teile.flatMap((t) => t.reiter))].sort(),
      };
    } else {
      n = await neuSeite(neuSeiteTab, neu);
    }
  } catch (e) { panne += ` · Neubau: ${(e as Error).message.split('\n')[0]}`; }
  zeilen.push(`## ${titel}`, '', `\`${alt}\` → \`${neu}\``, '');
  if (!a || !n) {
    console.error(`✗ ${titel}: ${panne}`);
    zeilen.push(`> **Nicht verglichen** — ${panne}`, '');
    continue;
  }
  console.log(`· ${titel}: alt ${a.knoepfe.length} Knöpfe / neu ${n.knoepfe.length}`);

  for (const [art, beschriftung] of [['knoepfe', 'Schaltflächen und Links'], ['felder', 'Eingabefelder'], ['spalten', 'Tabellenspalten'], ['reiter', 'Reiter']] as const) {
    const fehlt = a[art].filter((x) => !findetSich(x, n[art]));
    const neuDazu = n[art].filter((x) => !findetSich(x, a[art]));
    summeFehlt += fehlt.length;
    zeilen.push(`### ${beschriftung} — alt ${a[art].length}, neu ${n[art].length}`, '');
    zeilen.push(fehlt.length ? `**Nur in der alten App (${fehlt.length}):** ${fehlt.map((x) => `\`${x}\``).join(' · ')}` : '_Alles wiedergefunden._');
    if (neuDazu.length) zeilen.push('', `_Neu hinzugekommen (${neuDazu.length}):_ ${neuDazu.map((x) => `\`${x}\``).join(' · ')}`);
    zeilen.push('');
  }
}

zeilen.push('---', '', `**Summe der Prüfpunkte:** ${summeFehlt} Beschriftungen aus der alten App ohne Entsprechung im Neubau.`);
mkdirSync('berichte', { recursive: true });
writeFileSync('berichte/ui-abgleich.md', zeilen.join('\n'), 'utf-8');
console.log(`Bericht: berichte/ui-abgleich.md — ${summeFehlt} Prüfpunkte`);
await browser.close();
