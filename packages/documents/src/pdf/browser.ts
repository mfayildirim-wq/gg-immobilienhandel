/**
 * Startet ein Chromium für den PDF-Druck. Einzige Stelle, die entscheidet, welcher Browser läuft.
 *
 * Lokal: `CHROME_PFAD` oder ein installiertes Google Chrome / Chromium an den üblichen Orten.
 * Online (Vercel) fehlt noch der Weg über `@sparticuz/chromium` (executablePath + args); er kommt mit dem Hosting-Schritt.
 *
 * Playwright statt Puppeteer (alte App): gleiche Chromium-Druckfunktion (page.pdf mit Kopf/Fuß-Vorlagen), aber nur
 * noch ein Browser-Werkzeug im Repo, dieselbe Version wie die Klicktests (@playwright/test).
 */
import { existsSync } from 'node:fs';
import { type Browser, chromium } from 'playwright-core';

const KANDIDATEN = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

export class KeinBrowserError extends Error {
  constructor() {
    super('Kein Chrome/Chromium für den PDF-Export gefunden. CHROME_PFAD in .env setzen.');
    this.name = 'KeinBrowserError';
  }
}

export function chromePfad(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.CHROME_PFAD) return existsSync(env.CHROME_PFAD) ? env.CHROME_PFAD : null;
  return KANDIDATEN.find((p) => existsSync(p)) ?? null;
}

export async function browserStarten(): Promise<Browser> {
  const pfad = chromePfad();
  if (!pfad) throw new KeinBrowserError();
  return chromium.launch({ executablePath: pfad, headless: true, args: ['--no-sandbox'] });
}
