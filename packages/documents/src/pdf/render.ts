/**
 * HTML → PDF (A4) mit Kopf- und Fußzeile auf jeder Seite.
 * Port von gg-immohandel server/kkalk-pdf.ts (dort Puppeteer, hier Playwright): Seite als Datei ablegen und per file:// laden
 * (setContent reißt bei vielen eingebetteten Bildern), großzügiges Zeitlimit für den Kaltstart.
 * Das PDF entsteht im Speicher; die Zwischendatei wird immer gelöscht.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { browserStarten } from './browser.ts';

export interface PdfAuftrag {
  html: string;
  /** Kopf-/Fußvorlage je Seite (Bankgespräch). Ohne beide: keine, Ränder 0 (Präsentation trägt beides in jeder Folie). */
  kopf?: string;
  fuss?: string;
  querformat?: boolean;
  rand?: { top: string; right: string; bottom: string; left: string };
  /** Verzeichnis mit den abgelegten Fotos (legeVerweiseAb); die Seite landet daneben. Aufräumen macht der Aufrufer. */
  verzeichnis?: string;
}

export const BANKGESPRAECH_RAND = { top: '38mm', right: '12mm', bottom: '18mm', left: '12mm' };

export async function htmlZuPdf(a: PdfAuftrag): Promise<Uint8Array> {
  const eigenes = !a.verzeichnis;
  const verzeichnis = a.verzeichnis ?? (await mkdtemp(join(tmpdir(), 'gg-pdf-')));
  const seite = join(verzeichnis, 'index.html');
  let browser: Awaited<ReturnType<typeof browserStarten>> | undefined;
  try {
    await writeFile(seite, a.html, 'utf8');
    browser = await browserStarten();
    const page = await browser.newPage();
    await page.goto(pathToFileURL(seite).href, { waitUntil: 'networkidle', timeout: 180_000 });
    const pdf = await page.pdf({
      format: 'A4',
      landscape: a.querformat ?? false,
      printBackground: true,
      displayHeaderFooter: a.kopf !== undefined || a.fuss !== undefined,
      ...(a.kopf !== undefined ? { headerTemplate: a.kopf } : {}),
      ...(a.fuss !== undefined ? { footerTemplate: a.fuss } : {}),
      margin: a.rand ?? { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return new Uint8Array(pdf);
  } finally {
    await browser?.close();
    if (eigenes) await rm(verzeichnis, { recursive: true, force: true });
  }
}
