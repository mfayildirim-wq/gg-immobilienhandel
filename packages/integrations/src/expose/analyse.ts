// Exposé auswerten: Textweg (günstiges Modell, bei schwachem Ergebnis gründlich) oder PDF-Weg (Scan).
// Übernommen aus gg-immohandel server/expose-analyse.ts – Wegwahl, Grenzen, Modelle und Anfrageform des v0-Wegs unverändert.
// Geändert: KI-Client, Kostenbuchung und PDF-Textlesen werden übergeben (testbar ohne Netz); die Route liegt in apps/api.
//
// Zwei Schemata (Protokoll 28):
// - v2 (Standard): Vollerfassung — jede Angabe wörtlich mit Seite, Standard-Pfad und gg-Vorschlag, Mietlisten als Tabellen.
//   max_tokens 32000, stop_reason wird ausgewertet. Abgeschnittene Antwort → eine Wiederholung ohne Mietliste, danach der
//   Nachfass nur für die Einheiten-Tabellen. Vor dem gründlichen Modell eine Kostenabschätzung gegen die Kostengrenze.
// - v0: der bisherige Weg (Mail-Weg, Prüfsatz-Vergleich), inhaltlich unverändert, aber mit denselben Messwerten.

import { EXPOSE_V0_SCHEMA, EXPOSE_V2_SCHEMA, EXPOSE_V2_TOOL_NAME, type ExposeV2, einheitenAusTabellen, exposeV2Bereinigen, v2Traegt } from '@gg/domain';
import type { KiClient } from '../ki/anthropic.ts';
import { kostenEur, type Verbrauch } from '../ki/kosten.ts';
import type { PdfTextResult } from '../pdf/text.ts';
import { EXTRACT_TOOL, SYSTEM_PROMPT } from './prompt.ts';
import { EINHEITEN_TOOL_V2, EXTRACT_TOOL_V2, HINWEIS_NACHFASS_V2, HINWEIS_WIEDERHOLUNG_V2, PROMPT_VERSION_V2, SYSTEM_PROMPT_V2 } from './prompt-v2.ts';

const MB = 1024 * 1024;
export const MODELL_SCHNELL = 'claude-haiku-4-5-20251001';
export const MODELL_GRUENDLICH = 'claude-sonnet-5';
export const TEXT_SCHWELLE_PRO_SEITE = 120;
export const TEXT_MIN_GESAMT = 200;
export const MAX_PDF_SEITEN = 200;
export const INLINE_MAX_BYTES = 20 * MB;
const ZEITLIMIT_PDF_MS = 300_000;

/** v2: 280 s für jeden Aufruf — unter den 300 s der Function, in der die Analyse läuft (Protokoll 26, 8.1). */
export const ZEITLIMIT_V2_MS = 280_000;
/** Vollerfassung mit ungekürzten Freitexten braucht Platz. */
export const MAX_TOKENS_V2 = 32_000;
/** Angenommene Ausgabe für die Kostenabschätzung vor dem gründlichen Modell. */
export const SCHAETZUNG_AUSGABE_TOKENS = 16_000;
export const KOSTENGRENZE_STANDARD_EUR = 1;
export const PROMPT_VERSION_V0 = 'v0';
export const SEITENMARKER = /^──────── Seite (\d+)\n?/m;

export type SchemaWahl = 'v0' | 'v2';

export interface AnalyseOptionen {
  /** Standard v2; v0 für den Mail-Weg und den Prüfsatz-Vergleich. */
  schema?: SchemaWahl;
  /** Obergrenze je Analyse in Euro; geprüft vor dem gründlichen Modell (Standard 1,00 €). */
  kostenGrenzeEur?: number;
}

export interface AnalyseErgebnis {
  /** v2: identisch mit `v2`; v0: die Antwort des v0-Werkzeugs. Bleibt gesetzt für Aufrufer, die nur dieses Feld kennen. */
  extrahiert: any;
  modus: 'text' | 'pdf';
  modell: string;
  seiten: number;
  zeichenProSeite: number;
  hinweis?: string;
  schemaVersion: typeof EXPOSE_V0_SCHEMA | typeof EXPOSE_V2_SCHEMA;
  promptVersion: string;
  /** stop_reason der Antwort, die ins Ergebnis eingeht (null, wenn Anthropic keinen liefert). */
  stopReason: string | null;
  /** Summe über alle Aufrufe dieser Analyse (Eingabe inkl. Cache-Tokens). */
  usage: { inputTokens: number; outputTokens: number };
  dauerMs: number;
  /** Summe der Kosten aller Aufrufe nach ki/kosten.ts. */
  kostenEur: number;
  /** Die Einheiten-Tabellen kommen aus dem Nachfass. */
  nachfass: boolean;
  /** Irgendeine Antwort dieser Analyse war abgeschnitten (max_tokens) und wurde ohne Mietliste wiederholt. */
  wiederholung: boolean;
  v2?: ExposeV2;
  warnungen: string[];
  /** Textweg: Text je Seite (Index 0 = Seite 1) aus den Seitenmarkern; PDF-Weg: leer. */
  seitenTexte: string[];
}

export interface AnalyseAbhaengigkeiten {
  ki: KiClient;
  pdfText: (pdf: Uint8Array) => Promise<PdfTextResult>;
  buchen: (model: string, usage: Verbrauch | undefined, quelle: string) => Promise<void>;
}

function toolErgebnis(data: any, toolName = EXTRACT_TOOL.name): any {
  if (data?.error) throw new Error(data.error.message || 'Anthropic meldete einen Fehler');
  return data?.content?.find((c: any) => c.type === 'tool_use' && c.name === toolName)?.input ?? null;
}

/** Zwei von drei Kernsignalen (Ort, Preis, Einheiten) – sonst schlägt der Textweg gründlich nach. (v0, Ist-Verhalten) */
export function ergebnisTraegt(ex: any): boolean {
  if (!ex) return false;
  const o = ex.objekt || {};
  const hatOrt = !!(o.strasse || o.stadt || o.plz);
  const hatPreis = !!(o.angebotspreis || ex.kalkulation?.kaufpreis);
  const hatEinheiten = Array.isArray(o.einheiten) && o.einheiten.length > 0;
  return [hatOrt, hatPreis, hatEinheiten].filter(Boolean).length >= 2;
}

/** System-Prompt und Schema sind bei jedem Exposé gleich → als zwischenspeicherbar markiert. (v0) */
export function anfrage(model: string, inhalt: unknown[]): any {
  return {
    model,
    max_tokens: 4096,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    tools: [{ ...EXTRACT_TOOL, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: EXTRACT_TOOL.name },
    messages: [{ role: 'user', content: inhalt }],
  };
}

/** Anfrage v2: Vollerfassung (oder Nachfass nur Einheiten), max_tokens 32000, Anweisung und Werkzeug zwischenspeicherbar. */
export function anfrageV2(model: string, inhalt: unknown[], tool: typeof EXTRACT_TOOL_V2 = EXTRACT_TOOL_V2): any {
  return {
    model,
    max_tokens: MAX_TOKENS_V2,
    system: [{ type: 'text', text: SYSTEM_PROMPT_V2, cache_control: { type: 'ephemeral' } }],
    tools: [{ ...tool, cache_control: { type: 'ephemeral' } }],
    tool_choice: { type: 'tool', name: tool.name },
    messages: [{ role: 'user', content: inhalt }],
  };
}

/** Text an den Seitenmarkern „──────── Seite N“ aufteilen; Index 0 = Seite 1. Ohne Marker: der ganze Text als Seite 1. */
export function seitenAufteilen(text: string): string[] {
  const teile = text.split(/^──────── Seite (\d+)\n?/m);
  if (teile.length === 1) return text.trim() ? [text.trim()] : [];
  const seiten: string[] = [];
  for (let i = 1; i + 1 < teile.length; i += 2) {
    const nr = Number(teile[i]);
    if (!Number.isInteger(nr) || nr < 1) continue;
    seiten[nr - 1] = (teile[i + 1] ?? '').trim();
  }
  for (let i = 0; i < seiten.length; i++) seiten[i] ??= '';
  return seiten;
}

/**
 * Kostenabschätzung für einen Aufruf des gründlichen Modells: Eingabe ≈ Zeichen/4, Ausgabe pauschal 16000 Tokens,
 * Preise aus ki/kosten.ts. Grob, aber vor dem Aufruf — danach wäre das Geld ausgegeben.
 */
export function kostenSchaetzung(model: string, zeichen: number): number {
  return kostenEur(model, { input_tokens: Math.ceil(zeichen / 4), output_tokens: SCHAETZUNG_AUSGABE_TOKENS });
}

/** Erfasste Einheiten (ohne Summenzeilen) einer rohen Antwort. */
const zeilenAnzahl = (roh: any) => einheitenAusTabellen(exposeV2Bereinigen({ einheiten_tabellen: roh?.einheiten_tabellen }).v2.einheiten_tabellen).einheiten.length;

const zuBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const NICHTS = 'Aus dem Exposé ließ sich nichts auslesen — bitte erneut versuchen.';
const fehlerText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Wirft, wenn nichts herauskommt – ein leeres Ergebnis darf keinen Deal aus Nichts anlegen. */
export async function analysiereExpose(pdf: Uint8Array, dateiname: string, a: AnalyseAbhaengigkeiten, optionen: AnalyseOptionen = {}): Promise<AnalyseErgebnis> {
  const start = Date.now();
  const schema: SchemaWahl = optionen.schema ?? 'v2';
  const kostenGrenze = optionen.kostenGrenzeEur ?? KOSTENGRENZE_STANDARD_EUR;

  // Messwerte über alle Aufrufe dieser Analyse
  const usage = { inputTokens: 0, outputTokens: 0 };
  let kosten = 0;
  const vermerke = async (model: string, u: Verbrauch | undefined, quelle: string) => {
    await a.buchen(model, u, quelle);
    const v = u ?? {};
    usage.inputTokens += (v.input_tokens || 0) + (v.cache_creation_input_tokens || 0) + (v.cache_read_input_tokens || 0);
    usage.outputTokens += v.output_tokens || 0;
    kosten = +(kosten + kostenEur(model, v)).toFixed(4);
  };
  const messwerte = () => ({ usage: { ...usage }, kostenEur: kosten, dauerMs: Date.now() - start });

  const gelesen = await a.pdfText(pdf);
  const zeichenProSeite = gelesen.pageCount > 0 ? Math.round(gelesen.charsTotal / gelesen.pageCount) : 0;
  const seiten = gelesen.seitenGesamt;
  const textTraegt = zeichenProSeite >= TEXT_SCHWELLE_PRO_SEITE && gelesen.text.length > TEXT_MIN_GESAMT;
  const hinweis = gelesen.pageCount < seiten ? `Ausgewertet wurden die ersten ${gelesen.pageCount} von ${seiten} Seiten.` : undefined;

  const pdfWegPruefen = () => {
    if (seiten > MAX_PDF_SEITEN) {
      throw new Error(`Das PDF hat ${seiten} Seiten und enthält keinen auslesbaren Text — ausgewertet werden höchstens ${MAX_PDF_SEITEN} Seiten. Bitte das Exposé ohne Anhänge hochladen.`);
    }
    if (seiten === 0) {
      throw new Error(gelesen.grund ? `Das PDF ließ sich nicht öffnen — ${gelesen.grund}` : 'Das PDF ließ sich nicht öffnen — bitte die Datei prüfen.');
    }
  };

  // ───────────── v0 (Ist-Verhalten der alten App) ─────────────
  if (schema === 'v0') {
    let stopReason: string | null = null;
    const rufe = async (model: string, inhalt: unknown[], quelle: string, zeitlimitMs?: number) => {
      const data = await a.ki.nachricht(anfrage(model, inhalt), zeitlimitMs);
      await vermerke(model, data?.usage, quelle);
      stopReason = data?.stop_reason ?? null;
      return toolErgebnis(data);
    };
    const fertig = (extrahiert: any, modus: 'text' | 'pdf', modell: string): AnalyseErgebnis => ({
      extrahiert, modus, modell, seiten, zeichenProSeite, ...(modus === 'text' && hinweis ? { hinweis } : {}),
      schemaVersion: EXPOSE_V0_SCHEMA, promptVersion: PROMPT_VERSION_V0, stopReason, ...messwerte(),
      nachfass: false, wiederholung: false, warnungen: [], seitenTexte: modus === 'text' ? seitenAufteilen(gelesen.text) : [],
    });

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
      if (!extrahiert) throw new Error(NICHTS);
      return fertig(extrahiert, 'text', modell);
    }

    pdfWegPruefen();
    const frage = { type: 'text', text: 'Analysiere dieses Immobilien-Exposé und extrahiere alle relevanten Daten vollständig.' };
    if (pdf.byteLength <= INLINE_MAX_BYTES) {
      const inhalt = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zuBase64(pdf) } }, frage];
      const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf', ZEITLIMIT_PDF_MS);
      if (!extrahiert) throw new Error(NICHTS);
      return fertig(extrahiert, 'pdf', MODELL_GRUENDLICH);
    }
    const fileId = await a.ki.dateiHochladen(pdf, dateiname, 'application/pdf', ZEITLIMIT_PDF_MS);
    try {
      const inhalt = [{ type: 'document', source: { type: 'file', file_id: fileId } }, frage];
      const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf-datei', ZEITLIMIT_PDF_MS);
      if (!extrahiert) throw new Error(NICHTS);
      return fertig(extrahiert, 'pdf', MODELL_GRUENDLICH);
    } finally {
      await a.ki.dateiLoeschen(fileId);
    }
  }

  // ───────────── v2 ─────────────
  const warnungen: string[] = [];
  let nachfass = false;
  let wiederholung = false;

  interface Ruf { roh: any; stopReason: string | null }
  const rufeV2 = async (model: string, inhalt: unknown[], tool: typeof EXTRACT_TOOL_V2, quelle: string): Promise<Ruf> => {
    const data = await a.ki.nachricht(anfrageV2(model, inhalt, tool), ZEITLIMIT_V2_MS);
    await vermerke(model, data?.usage, quelle);
    return { roh: toolErgebnis(data, EXPOSE_V2_TOOL_NAME), stopReason: data?.stop_reason ?? null };
  };

  /**
   * Nachfass nur für die Einheiten-Tabellen: derselbe Inhalt, das Werkzeug ohne `angaben`. Übernommen wird nur eine
   * längere Liste aus einer nicht abgeschnittenen Antwort (Prüfsatz 10.10.2026: 1 von 34 Einheiten).
   */
  const nachfassen = async (r: Ruf, model: string, inhalt: unknown[], quelle: string) => {
    const bisher = zeilenAnzahl(r.roh);
    try {
      const n = await rufeV2(model, [...inhalt, { type: 'text', text: HINWEIS_NACHFASS_V2 }], EINHEITEN_TOOL_V2, `${quelle}-einheiten`);
      if (n.stopReason === 'max_tokens') { warnungen.push(`${model}: Einheiten-Nachfass abgeschnitten (max_tokens) — nicht übernommen`); return; }
      const neu = zeilenAnzahl(n.roh);
      if (!n.roh || neu <= bisher) return;
      r.roh.einheiten_tabellen = n.roh.einheiten_tabellen;
      if (typeof n.roh.einheiten_im_dokument === 'number') r.roh.einheiten_im_dokument = n.roh.einheiten_im_dokument;
      if (typeof n.roh.einheiten_vollstaendig === 'boolean') r.roh.einheiten_vollstaendig = n.roh.einheiten_vollstaendig;
      nachfass = true;
    } catch (e) {
      warnungen.push(`Einheiten-Nachfass fehlgeschlagen: ${fehlerText(e)}`);
    }
  };

  /**
   * Ein Versuch mit der Vollerfassung. Meldet die KI eine unvollständige Liste (oder weniger Zeilen als das Dokument
   * nennt), holt der Nachfass die Tabellen. Abgeschnitten (max_tokens) → einmal ohne Mietliste wiederholen, dann Nachfass.
   * Nie stille Teilübernahme: eine abgeschnittene Antwort trägt nicht.
   */
  const versuchV2 = async (model: string, inhalt: unknown[], quelle: string): Promise<Ruf> => {
    let r = await rufeV2(model, inhalt, EXTRACT_TOOL_V2, quelle);
    if (r.stopReason !== 'max_tokens') {
      if (!r.roh) return r;
      const bisher = zeilenAnzahl(r.roh);
      const imDokument = typeof r.roh.einheiten_im_dokument === 'number' ? r.roh.einheiten_im_dokument : null;
      if (r.roh.einheiten_vollstaendig === false || (imDokument !== null && imDokument > bisher)) {
        warnungen.push(`Einheitenliste unvollständig (${bisher} von ${imDokument ?? '?'}) — Nachfass`);
        await nachfassen(r, model, inhalt, quelle);
      }
      return r;
    }
    wiederholung = true;
    warnungen.push(`${model}: Antwort abgeschnitten (max_tokens) — Wiederholung ohne Mietliste`);
    r = await rufeV2(model, [...inhalt, { type: 'text', text: HINWEIS_WIEDERHOLUNG_V2 }], EXTRACT_TOOL_V2, `${quelle}-wiederholung`);
    if (r.stopReason === 'max_tokens' || !r.roh) return r;
    r.roh.einheiten_tabellen = [];
    await nachfassen(r, model, inhalt, quelle);
    return r;
  };

  /** Trägt der Versuch? Nicht abgeschnitten, und die bereinigte Erfassung nennt Ort, Preis und Einheiten. */
  const traegt = (r: Ruf | null) => !!r?.roh && r.stopReason !== 'max_tokens' && v2Traegt(exposeV2Bereinigen(r.roh).v2);

  const fertig = (ruf: Ruf, modus: 'text' | 'pdf', modell: string): AnalyseErgebnis => {
    if (!ruf.roh) throw new Error(NICHTS);
    if (ruf.stopReason === 'max_tokens') warnungen.push(`${modell}: Antwort auch nach der Wiederholung abgeschnitten — Erfassung unvollständig`);
    const { v2, warnungen: w } = exposeV2Bereinigen(ruf.roh);
    warnungen.push(...w);
    return {
      extrahiert: v2, v2, modus, modell, seiten, zeichenProSeite, ...(modus === 'text' && hinweis ? { hinweis } : {}),
      schemaVersion: EXPOSE_V2_SCHEMA, promptVersion: PROMPT_VERSION_V2, stopReason: ruf.stopReason, ...messwerte(),
      nachfass, wiederholung, warnungen, seitenTexte: modus === 'text' ? seitenAufteilen(gelesen.text) : [],
    };
  };

  if (textTraegt) {
    const text = `Erfasse dieses Immobilien-Exposé vollständig und wörtlich (extrahierter Text-Layer, Seiten durch "──────── Seite N" getrennt):\n\n${gelesen.text}`;
    const inhalt = [{ type: 'text', text }];
    let ruf: Ruf | null = null;
    try {
      ruf = await versuchV2(MODELL_SCHNELL, inhalt, 'expose-analyse/v2-text-schnell');
    } catch (e) {
      console.warn('[expose-analyse] schneller Versuch (v2) fehlgeschlagen:', e);
      warnungen.push(`${MODELL_SCHNELL}: ${fehlerText(e)}`);
    }
    if (traegt(ruf)) return fertig(ruf!, 'text', MODELL_SCHNELL);

    const zeichen = text.length + SYSTEM_PROMPT_V2.length + JSON.stringify(EXTRACT_TOOL_V2.input_schema).length;
    const geschaetzt = kostenSchaetzung(MODELL_GRUENDLICH, zeichen);
    if (geschaetzt > kostenGrenze) {
      throw new Error(`Kostengrenze ${kostenGrenze.toFixed(2)} € überschritten: der gründliche Versuch würde etwa ${geschaetzt.toFixed(2)} € kosten (${Math.ceil(zeichen / 4)} Eingabe-Tokens).`);
    }
    nachfass = false; // `wiederholung` bleibt: sie ist in dieser Analyse geschehen, auch wenn Sonnet jetzt neu beginnt
    const gruendlich = await versuchV2(MODELL_GRUENDLICH, inhalt, 'expose-analyse/v2-text-gruendlich');
    return fertig(gruendlich, 'text', MODELL_GRUENDLICH);
  }

  pdfWegPruefen();
  const frage = { type: 'text', text: 'Erfasse dieses Immobilien-Exposé vollständig und wörtlich. Seitennummern sind die PDF-Seiten.' };
  if (pdf.byteLength <= INLINE_MAX_BYTES) {
    const inhalt = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zuBase64(pdf) } }, frage];
    return fertig(await versuchV2(MODELL_GRUENDLICH, inhalt, 'expose-analyse/v2-pdf'), 'pdf', MODELL_GRUENDLICH);
  }
  const fileId = await a.ki.dateiHochladen(pdf, dateiname, 'application/pdf', ZEITLIMIT_V2_MS);
  try {
    const inhalt = [{ type: 'document', source: { type: 'file', file_id: fileId } }, frage];
    return fertig(await versuchV2(MODELL_GRUENDLICH, inhalt, 'expose-analyse/v2-pdf-datei'), 'pdf', MODELL_GRUENDLICH);
  } finally {
    await a.ki.dateiLoeschen(fileId);
  }
}

/** Signaturprüfung: „%PDF-“ am Anfang. Ein als PDF benanntes Archiv geht nicht an das Modell. */
export const istPdf = (bytes: Uint8Array) => bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
