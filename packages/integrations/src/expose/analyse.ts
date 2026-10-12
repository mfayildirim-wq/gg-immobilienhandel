// Exposé auswerten: Textweg (günstiges Modell, bei schwachem Ergebnis gründlich) oder PDF-Weg (Scan).
// Übernommen aus gg-immohandel server/expose-analyse.ts – Wegwahl, Grenzen, Modelle und Anfrageform des v0-Wegs unverändert.
// Geändert: KI-Client, Kostenbuchung und PDF-Textlesen werden übergeben (testbar ohne Netz); die Route liegt in apps/api.
//
// Zwei Schemata (Protokoll 28):
// - v2 (Standard): Vollerfassung — jede Angabe wörtlich mit Seite, Standard-Pfad und gg-Vorschlag, Mietlisten als Tabellen.
//   max_tokens 32000, stop_reason wird ausgewertet. Abgeschnittene Antwort → eine Wiederholung ohne Mietliste, danach der
//   Nachfass nur für die Einheiten-Tabellen. Vor dem gründlichen Modell eine Kostenabschätzung gegen die Kostengrenze.
// - v0: der bisherige Weg (Mail-Weg, Prüfsatz-Vergleich), inhaltlich unverändert, aber mit denselben Messwerten.

import { EXPOSE_V0_SCHEMA, EXPOSE_V2_SCHEMA, EXPOSE_V2_TOOL_NAME, type ExposeV2, einheitenAusTabellen, exposeV2Bereinigen } from '@gg/domain';
import { type KiClient, KiDienstFehler, KiSchluesselFehler } from '../ki/anthropic.ts';
import { einheitenExtrahieren } from '../ki/einheiten.ts';
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

/** Fachlich erklärbarer Abbruch der Analyse (PDF unlesbar, nichts gefunden, Kostengrenze); die Meldung geht an die Oberfläche. */
export class AnalyseFehler extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnalyseFehler';
  }
}

/** Limit, Guthaben und Schlüssel ändern sich nicht durch einen zweiten Versuch mit einem anderen Modell. */
const endgueltig = (e: unknown) => (e instanceof KiDienstFehler && (e.art === 'limit' || e.art === 'guthaben')) || e instanceof KiSchluesselFehler;

function toolErgebnis(data: any, toolName = EXTRACT_TOOL.name): any {
  if (data?.error) throw new KiDienstFehler(200, 'anfrage', `Anthropic meldete einen Fehler: ${data.error.message || 'ohne Text'}`);
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
      throw new AnalyseFehler(`Das PDF hat ${seiten} Seiten und enthält keinen auslesbaren Text — ausgewertet werden höchstens ${MAX_PDF_SEITEN} Seiten. Bitte das Exposé ohne Anhänge hochladen.`);
    }
    if (seiten === 0) {
      throw new AnalyseFehler(gelesen.grund ? `Das PDF ließ sich nicht öffnen — ${gelesen.grund}` : 'Das PDF ließ sich nicht öffnen — bitte die Datei prüfen.');
    }
  };

  // ───────────── Teil A = v0 (Ist-Verhalten der alten App, unverändert) ─────────────
  interface TeilA { extrahiert: any; modus: 'text' | 'pdf'; modell: string; stopReason: string | null }
  const teilA = async (): Promise<TeilA> => {
    let stopReason: string | null = null;
    const rufe = async (model: string, inhalt: unknown[], quelle: string, zeitlimitMs?: number) => {
      const data = await a.ki.nachricht(anfrage(model, inhalt), zeitlimitMs);
      await vermerke(model, data?.usage, quelle);
      stopReason = data?.stop_reason ?? null;
      return toolErgebnis(data);
    };
    if (textTraegt) {
      const inhalt = [{ type: 'text', text: `Analysiere dieses Immobilien-Exposé (extrahierter Text-Layer) und extrahiere ALLE relevanten Daten vollständig:\n\n${gelesen.text}` }];
      let extrahiert: any = null;
      let modell = MODELL_SCHNELL;
      try {
        extrahiert = await rufe(MODELL_SCHNELL, inhalt, 'expose-analyse/text-schnell');
      } catch (e) {
        if (endgueltig(e)) throw e;
        console.warn('[expose-analyse] schneller Versuch fehlgeschlagen:', e);
      }
      if (!ergebnisTraegt(extrahiert)) {
        extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/text-gruendlich');
        modell = MODELL_GRUENDLICH;
      }
      if (!extrahiert) throw new AnalyseFehler(NICHTS);
      return { extrahiert, modus: 'text', modell, stopReason };
    }
    pdfWegPruefen();
    const frage = { type: 'text', text: 'Analysiere dieses Immobilien-Exposé und extrahiere alle relevanten Daten vollständig.' };
    if (pdf.byteLength <= INLINE_MAX_BYTES) {
      const inhalt = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zuBase64(pdf) } }, frage];
      const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf', ZEITLIMIT_PDF_MS);
      if (!extrahiert) throw new AnalyseFehler(NICHTS);
      return { extrahiert, modus: 'pdf', modell: MODELL_GRUENDLICH, stopReason };
    }
    const fileId = await a.ki.dateiHochladen(pdf, dateiname, 'application/pdf', ZEITLIMIT_PDF_MS);
    try {
      const inhalt = [{ type: 'document', source: { type: 'file', file_id: fileId } }, frage];
      const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf-datei', ZEITLIMIT_PDF_MS);
      if (!extrahiert) throw new AnalyseFehler(NICHTS);
      return { extrahiert, modus: 'pdf', modell: MODELL_GRUENDLICH, stopReason };
    } finally {
      await a.ki.dateiLoeschen(fileId);
    }
  };

  if (schema === 'v0') {
    const r = await teilA();
    return {
      extrahiert: r.extrahiert, modus: r.modus, modell: r.modell, seiten, zeichenProSeite, ...(r.modus === 'text' && hinweis ? { hinweis } : {}),
      schemaVersion: EXPOSE_V0_SCHEMA, promptVersion: PROMPT_VERSION_V0, stopReason: r.stopReason, ...messwerte(),
      nachfass: false, wiederholung: false, warnungen: [], seitenTexte: r.modus === 'text' ? seitenAufteilen(gelesen.text) : [],
    };
  }

  // ───────────── v2 = Teil A (wie oben, unverändert) ∥ Teil B (Vollerfassung, eigener Aufruf) ─────────────
  // Prüfung 12.10.2026 (5 Exposés, main gegen Branch): in EINEM Aufruf lieferte Teil A weniger Einheiten und Stellplätze
  // als allein. Darum laufen beide Teile getrennt und parallel; Teil A bleibt Wort für Wort der Aufruf von main.
  const warnungen: string[] = [];
  let nachfass = false;
  let wiederholung = false;

  interface Ruf { roh: any; stopReason: string | null }
  const rufeV2 = async (model: string, inhalt: unknown[], tool: typeof EXTRACT_TOOL_V2, quelle: string): Promise<Ruf> => {
    const data = await a.ki.nachricht(anfrageV2(model, inhalt, tool), ZEITLIMIT_V2_MS);
    await vermerke(model, data?.usage, quelle);
    return { roh: toolErgebnis(data, EXPOSE_V2_TOOL_NAME), stopReason: data?.stop_reason ?? null };
  };

  /** Teil B: Vollerfassung. Abgeschnitten (max_tokens) → einmal ohne Mietliste wiederholen. Scheitert Teil B, bleibt Teil A. */
  const teilB = async (model: string, inhalt: unknown[], quelle: string): Promise<Ruf | null> => {
    try {
      let r = await rufeV2(model, inhalt, EXTRACT_TOOL_V2, quelle);
      if (r.stopReason === 'max_tokens') {
        wiederholung = true;
        warnungen.push(`${model}: Vollerfassung abgeschnitten (max_tokens) — Wiederholung ohne Mietliste`);
        r = await rufeV2(model, [...inhalt, { type: 'text', text: HINWEIS_WIEDERHOLUNG_V2 }], EXTRACT_TOOL_V2, `${quelle}-wiederholung`);
        if (r.stopReason === 'max_tokens' || !r.roh) { warnungen.push(`${model}: Vollerfassung auch nach der Wiederholung abgeschnitten — nur Teil A`); return null; }
        r.roh.einheiten_tabellen = [];
      }
      return r.roh ? r : null;
    } catch (e) {
      if (endgueltig(e)) throw e;
      warnungen.push(`Vollerfassung fehlgeschlagen: ${fehlerText(e)} — nur Teil A`);
      return null;
    }
  };

  // Teil B liest dasselbe wie Teil A: Textlayer (Haiku) oder bei Scans das PDF (gründliches Modell)
  const inhaltB = textTraegt
    ? { model: MODELL_SCHNELL, quelle: 'expose-analyse/v2-text', inhalt: [{ type: 'text', text: `Erfasse dieses Immobilien-Exposé vollständig und wörtlich (extrahierter Text-Layer, Seiten durch "──────── Seite N" getrennt):\n\n${gelesen.text}` }] }
    : pdf.byteLength <= INLINE_MAX_BYTES
      ? { model: MODELL_GRUENDLICH, quelle: 'expose-analyse/v2-pdf', inhalt: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zuBase64(pdf) } }, { type: 'text', text: 'Erfasse dieses Immobilien-Exposé vollständig und wörtlich. Seitennummern sind die PDF-Seiten.' }] }
      : null;
  if (!inhaltB) warnungen.push('PDF zu groß für die Vollerfassung — nur Teil A');

  const [a0, b0] = await Promise.all([teilA(), inhaltB ? teilB(inhaltB.model, inhaltB.inhalt, inhaltB.quelle) : Promise.resolve(null)]);
  const roh: Record<string, any> = { ...(b0?.roh ?? {}), ...pickeTeilA(a0.extrahiert) };

  // Einheiten-Nachfass wie in der alten App (extract_einheiten): erst wenn beide Teile da sind und das Dokument mehr
  // Einheiten nennt als Teil A und die Tabellen aus Teil B. Die Antwort von Teil A schwankt zwischen Läufen (Prüfung
  // 12.10.2026: dasselbe Exposé einmal 2, einmal 34 Einheiten) — der Nachfass fängt das ab.
  const einheitenA = Array.isArray(roh.objekt?.einheiten) ? roh.objekt.einheiten.length : 0;
  const bisher = Math.max(einheitenA, zeilenAnzahl(roh));
  const soll = typeof roh.einheiten_im_dokument === 'number' ? roh.einheiten_im_dokument : null;
  if (soll !== null && soll > bisher) {
    warnungen.push(`Einheitenliste unvollständig (${bisher} von ${soll}) — Nachfass`);
    try {
      const e = await einheitenExtrahieren(a.ki, pdf, seiten);
      await vermerke(e.model, e.usage, 'expose-analyse/v2-einheiten');
      const liste = einheitenAusNachfass(e.wert);
      if (liste.length > bisher) {
        roh.objekt = { ...(roh.objekt ?? {}), einheiten: liste };
        nachfass = true;
      }
    } catch (e) {
      if (endgueltig(e)) throw e;
      warnungen.push(`Einheiten-Nachfass fehlgeschlagen: ${fehlerText(e)}`);
    }
  }
  const { v2, warnungen: w } = exposeV2Bereinigen(roh);
  warnungen.push(...w);
  return {
    extrahiert: v2, v2, modus: a0.modus, modell: a0.modell, seiten, zeichenProSeite, ...(a0.modus === 'text' && hinweis ? { hinweis } : {}),
    schemaVersion: EXPOSE_V2_SCHEMA, promptVersion: PROMPT_VERSION_V2, stopReason: a0.stopReason, ...messwerte(),
    nachfass, wiederholung, warnungen, seitenTexte: a0.modus === 'text' ? seitenAufteilen(gelesen.text) : [],
  };
}

/** Antwort von extract_einheiten im Format von Teil A; Stellplatz-Zeilen mit `stk` > 1 werden einzelne Einheiten. */
export function einheitenAusNachfass(wert: { typ: string; lage?: string; zimmer?: number | null; flaeche?: number | null; kaltmiete?: number | null; stk?: number | null }[]) {
  const aus: { typ: string; lage: string | null; zimmer: number | null; flaeche: number | null; kaltmiete: number | null; vermiet: string | null }[] = [];
  for (const e of wert) {
    const typ = ['Wohnung', 'Gewerbe', 'Stellplatz', 'Sonstiges'].includes(e.typ) ? e.typ : 'Sonstiges';
    const n = typ === 'Stellplatz' && typeof e.stk === 'number' && e.stk > 1 ? Math.min(Math.round(e.stk), 200) : 1;
    const vermiet = e.kaltmiete === 0 ? 'Leerstand' : typeof e.kaltmiete === 'number' && e.kaltmiete > 0 ? 'Vermietet' : null;
    for (let i = 0; i < n; i++) aus.push({ typ, lage: e.lage ?? null, zimmer: e.zimmer ?? null, flaeche: e.flaeche ?? null, kaltmiete: e.kaltmiete ?? null, vermiet });
  }
  return aus;
}

/** Teil A in die Rohdaten: die Gruppen des bisherigen Werkzeugs. */
function pickeTeilA(ex: any): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const k of ['objekt', 'makler', 'kalkulation', '_konfidenz']) if (ex?.[k] && typeof ex[k] === 'object') aus[k] = ex[k];
  return aus;
}

/** Signaturprüfung: „%PDF-“ am Anfang. Ein als PDF benanntes Archiv geht nicht an das Modell. */
export const istPdf = (bytes: Uint8Array) => bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
