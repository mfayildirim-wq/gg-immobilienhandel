// Exposé auswerten: Textweg (günstiges Modell, bei schwachem Ergebnis gründlich) oder PDF-Weg (Scan).
// Übernommen aus gg-immohandel server/expose-analyse.ts – Wegwahl, Grenzen, Modelle und Anfrageform unverändert.
// Geändert: KI-Client, Kostenbuchung und PDF-Textlesen werden übergeben (testbar ohne Netz); die Route liegt in apps/api.

import type { KiClient } from '../ki/anthropic.ts';
import type { Verbrauch } from '../ki/kosten.ts';
import type { PdfTextResult } from '../pdf/text.ts';
import { EXTRACT_TOOL, SYSTEM_PROMPT } from './prompt.ts';

const MB = 1024 * 1024;
export const MODELL_SCHNELL = 'claude-haiku-4-5-20251001';
export const MODELL_GRUENDLICH = 'claude-sonnet-5';
export const TEXT_SCHWELLE_PRO_SEITE = 120;
export const TEXT_MIN_GESAMT = 200;
export const MAX_PDF_SEITEN = 200;
export const INLINE_MAX_BYTES = 20 * MB;
const ZEITLIMIT_PDF_MS = 300_000;

export interface AnalyseErgebnis {
  extrahiert: any;
  modus: 'text' | 'pdf';
  modell: string;
  seiten: number;
  zeichenProSeite: number;
  hinweis?: string;
}

export interface AnalyseAbhaengigkeiten {
  ki: KiClient;
  pdfText: (pdf: Uint8Array) => Promise<PdfTextResult>;
  buchen: (model: string, usage: Verbrauch | undefined, quelle: string) => Promise<void>;
}

function toolErgebnis(data: any): any {
  if (data?.error) throw new Error(data.error.message || 'Anthropic meldete einen Fehler');
  return data?.content?.find((c: any) => c.type === 'tool_use' && c.name === 'extract_expose_data')?.input ?? null;
}

/** Zwei von drei Kernsignalen (Ort, Preis, Einheiten) – sonst schlägt der Textweg gründlich nach. */
export function ergebnisTraegt(ex: any): boolean {
  if (!ex) return false;
  const o = ex.objekt || {};
  const hatOrt = !!(o.strasse || o.stadt || o.plz);
  const hatPreis = !!(o.angebotspreis || ex.kalkulation?.kaufpreis);
  const hatEinheiten = Array.isArray(o.einheiten) && o.einheiten.length > 0;
  return [hatOrt, hatPreis, hatEinheiten].filter(Boolean).length >= 2;
}

/** System-Prompt und Schema sind bei jedem Exposé gleich → als zwischenspeicherbar markiert. */
export function anfrage(model: string, inhalt: unknown[]): any {
  return {
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{ ...EXTRACT_TOOL, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: 'extract_expose_data' },
    messages: [{ role: 'user', content: inhalt }],
  };
}

const zuBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

/** Wirft, wenn nichts herauskommt – ein leeres Ergebnis darf keinen Deal aus Nichts anlegen. */
export async function analysiereExpose(pdf: Uint8Array, dateiname: string, a: AnalyseAbhaengigkeiten): Promise<AnalyseErgebnis> {
  const rufe = async (model: string, inhalt: unknown[], quelle: string, zeitlimitMs?: number) => {
    const data = await a.ki.nachricht(anfrage(model, inhalt), zeitlimitMs);
    await a.buchen(model, data?.usage, quelle);
    return toolErgebnis(data);
  };

  const gelesen = await a.pdfText(pdf);
  const zeichenProSeite = gelesen.pageCount > 0 ? Math.round(gelesen.charsTotal / gelesen.pageCount) : 0;
  const seiten = gelesen.seitenGesamt;
  const textTraegt = zeichenProSeite >= TEXT_SCHWELLE_PRO_SEITE && gelesen.text.length > TEXT_MIN_GESAMT;

  if (textTraegt) {
    const inhalt = [{ type: 'text', text: `Analysiere dieses Immobilien-Exposé (extrahierter Text-Layer) und extrahiere ALLE relevanten Daten vollständig:\n\n${gelesen.text}` }];
    let extrahiert: any = null;
    let modell = MODELL_SCHNELL;
    try {
      extrahiert = await rufe(MODELL_SCHNELL, inhalt, 'expose-analyse/text-schnell');
    } catch (e) {
      console.warn('[expose-analyse] schneller Versuch fehlgeschlagen:', e);
    }
    if (!ergebnisTraegt(extrahiert)) {
      extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/text-gruendlich');
      modell = MODELL_GRUENDLICH;
    }
    if (!extrahiert) throw new Error('Aus dem Exposé ließ sich nichts auslesen — bitte erneut versuchen.');
    const hinweis = gelesen.pageCount < seiten ? `Ausgewertet wurden die ersten ${gelesen.pageCount} von ${seiten} Seiten.` : undefined;
    return { extrahiert, modus: 'text', modell, seiten, zeichenProSeite, ...(hinweis ? { hinweis } : {}) };
  }

  if (seiten > MAX_PDF_SEITEN) {
    throw new Error(`Das PDF hat ${seiten} Seiten und enthält keinen auslesbaren Text — ausgewertet werden höchstens ${MAX_PDF_SEITEN} Seiten. Bitte das Exposé ohne Anhänge hochladen.`);
  }
  if (seiten === 0) {
    throw new Error(gelesen.grund ? `Das PDF ließ sich nicht öffnen — ${gelesen.grund}` : 'Das PDF ließ sich nicht öffnen — bitte die Datei prüfen.');
  }

  const frage = { type: 'text', text: 'Analysiere dieses Immobilien-Exposé und extrahiere alle relevanten Daten vollständig.' };
  if (pdf.byteLength <= INLINE_MAX_BYTES) {
    const inhalt = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zuBase64(pdf) } }, frage];
    const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf', ZEITLIMIT_PDF_MS);
    if (!extrahiert) throw new Error('Aus dem Exposé ließ sich nichts auslesen — bitte erneut versuchen.');
    return { extrahiert, modus: 'pdf', modell: MODELL_GRUENDLICH, seiten, zeichenProSeite };
  }

  const fileId = await a.ki.dateiHochladen(pdf, dateiname, 'application/pdf', ZEITLIMIT_PDF_MS);
  try {
    const inhalt = [{ type: 'document', source: { type: 'file', file_id: fileId } }, frage];
    const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf-datei', ZEITLIMIT_PDF_MS);
    if (!extrahiert) throw new Error('Aus dem Exposé ließ sich nichts auslesen — bitte erneut versuchen.');
    return { extrahiert, modus: 'pdf', modell: MODELL_GRUENDLICH, seiten, zeichenProSeite };
  } finally {
    await a.ki.dateiLoeschen(fileId);
  }
}

/** Signaturprüfung: „%PDF-“ am Anfang. Ein als PDF benanntes Archiv geht nicht an das Modell. */
export const istPdf = (bytes: Uint8Array) => bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
