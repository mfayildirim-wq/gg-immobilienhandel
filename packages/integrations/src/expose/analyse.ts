// Exposé auswerten: Textweg (günstiges Modell, bei schwachem Ergebnis gründlich) oder PDF-Weg (Scan).
// Übernommen aus gg-immohandel server/expose-analyse.ts – Wegwahl, Grenzen, Modelle und Anfrageform des v0-Wegs unverändert.
// Geändert: KI-Client, Kostenbuchung und PDF-Textlesen werden übergeben (testbar ohne Netz); die Route liegt in apps/api.
//
// Zwei Schemata (Protokoll 28):
// - v2 (Standard): Vollerfassung — jede Angabe wörtlich mit Seite, Standard-Pfad und gg-Vorschlag, Mietlisten als Tabellen.
//   max_tokens 32000, stop_reason wird ausgewertet. Abgeschnittene Antwort → eine Wiederholung ohne Mietliste, danach der
//   Nachfass nur für die Einheiten-Tabellen. Vor dem gründlichen Modell eine Kostenabschätzung gegen die Kostengrenze.
// - v0: der bisherige Weg (Mail-Weg, Prüfsatz-Vergleich), inhaltlich unverändert, aber mit denselben Messwerten.

import {
  type Dokument, dokumentText, dokumentZeichen, EXPOSE_V0_SCHEMA, EXPOSE_V2_SCHEMA, type ExposeV2, einheitenAusTabellen, exposeV2Bereinigen, rohdatenAusDokument, seitenText,
} from '@gg/domain';
import { type KiClient, KiDienstFehler, KiSchluesselFehler } from '../ki/anthropic.ts';
import { einheitenExtrahieren } from '../ki/einheiten.ts';
import { kostenEur, type Verbrauch } from '../ki/kosten.ts';
import { genutztesModell } from '../ki/modelle.ts';
import type { PdfTextResult } from '../pdf/text.ts';
import { EXTRACT_TOOL, SYSTEM_PROMPT } from './prompt.ts';
import { pdfDokument } from '../pdf/dokument.ts';
import { bezeichnungenZuordnen, PROMPT_VERSION_V2 } from './bezeichnungen.ts';

const MB = 1024 * 1024;
export const MODELL_SCHNELL = 'claude-haiku-4-5-20251001';
export const MODELL_GRUENDLICH = 'claude-sonnet-5';
export const TEXT_SCHWELLE_PRO_SEITE = 120;
export const TEXT_MIN_GESAMT = 200;
export const MAX_PDF_SEITEN = 200;
export const INLINE_MAX_BYTES = 20 * MB;
const ZEITLIMIT_PDF_MS = 300_000;

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
  /** v2: Dokument ohne KI (Textlayer + OCR); fehlt es, wird es ohne OCR gelesen. */
  dokument?: (pdf: Uint8Array) => Promise<Dokument>;
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
  const teilA = async (quelleText = gelesen.text, textOk = textTraegt): Promise<TeilA> => {
    let stopReason: string | null = null;
    // Gebucht und gemeldet wird das Modell, das geantwortet hat — die Modellwahl (Einstellungen) kann es umlenken (PR #28)
    let modell = '';
    const rufe = async (model: string, inhalt: unknown[], quelle: string, zeitlimitMs?: number) => {
      const data = await a.ki.nachricht(anfrage(model, inhalt), zeitlimitMs);
      modell = genutztesModell(data, model);
      await vermerke(modell, data?.usage, quelle);
      stopReason = data?.stop_reason ?? null;
      return toolErgebnis(data);
    };
    if (textOk) {
      const inhalt = [{ type: 'text', text: `Analysiere dieses Immobilien-Exposé (extrahierter Text-Layer) und extrahiere ALLE relevanten Daten vollständig:\n\n${quelleText}` }];
      let extrahiert: any = null;
      try {
        extrahiert = await rufe(MODELL_SCHNELL, inhalt, 'expose-analyse/text-schnell');
      } catch (e) {
        if (endgueltig(e)) throw e;
        console.warn('[expose-analyse] schneller Versuch fehlgeschlagen:', e);
      }
      if (!ergebnisTraegt(extrahiert)) extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/text-gruendlich');
      if (!extrahiert) throw new AnalyseFehler(NICHTS);
      return { extrahiert, modus: 'text', modell, stopReason };
    }
    pdfWegPruefen();
    const frage = { type: 'text', text: 'Analysiere dieses Immobilien-Exposé und extrahiere alle relevanten Daten vollständig.' };
    if (pdf.byteLength <= INLINE_MAX_BYTES) {
      const inhalt = [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: zuBase64(pdf) } }, frage];
      const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf', ZEITLIMIT_PDF_MS);
      if (!extrahiert) throw new AnalyseFehler(NICHTS);
      return { extrahiert, modus: 'pdf', modell, stopReason };
    }
    const fileId = await a.ki.dateiHochladen(pdf, dateiname, 'application/pdf', ZEITLIMIT_PDF_MS);
    try {
      const inhalt = [{ type: 'document', source: { type: 'file', file_id: fileId } }, frage];
      const extrahiert = await rufe(MODELL_GRUENDLICH, inhalt, 'expose-analyse/pdf-datei', ZEITLIMIT_PDF_MS);
      if (!extrahiert) throw new AnalyseFehler(NICHTS);
      return { extrahiert, modus: 'pdf', modell, stopReason };
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

  // ───────────── v2 (Protokoll 30, P1): Dokument ohne KI → Rohdaten im Code; KI nur für Teil A und unbekannte Bezeichnungen ─────────────
  const warnungen: string[] = [];
  let nachfass = false;

  // 1 · Erfassen ohne KI: Textlayer + OCR der Bild-Seiten. Das Dokument wird unverändert gespeichert.
  const dok = await (a.dokument ?? ((p: Uint8Array) => pdfDokument(p)))(pdf);
  const dokText = dokumentText(dok);
  const dokSeiten = dok.seiten.length;
  const dokTraegt = dokSeiten > 0 && dokumentZeichen(dok) / dokSeiten >= TEXT_SCHWELLE_PRO_SEITE && dokText.length > TEXT_MIN_GESAMT;
  const ocrSeiten = dok.seiten.filter((x) => x.ocr).length;
  if (ocrSeiten) warnungen.push(`${ocrSeiten} Bild-Seite(n) per Texterkennung gelesen`);

  // 2 · Rohdaten im Code
  const roh0 = rohdatenAusDokument(dok);

  // 3 · Deuten: Teil A (Aufruf von main, auf dem Dokument-Text) ∥ Zuordnung unbekannter Bezeichnungen (kleiner Aufruf)
  const [a0, zuordnung] = await Promise.all([
    teilA(dokText, dokTraegt),
    bezeichnungenZuordnen(a.ki, roh0.angaben, vermerke).catch((e) => {
      if (endgueltig(e)) throw e;
      warnungen.push(`Zuordnung unbekannter Bezeichnungen fehlgeschlagen: ${fehlerText(e)}`);
      return null;
    }),
  ]);
  if (zuordnung) for (const [i, z] of zuordnung) { const x = roh0.angaben[i]; if (x) { x.pfad ??= z.pfad; x.gg ??= z.gg; } }

  // Haiku lässt die Gruppen `makler`/`kalkulation` manchmal ganz weg (kein Pflichtfeld; Paritätstest 16.10.2026, E7a):
  // dann einmal wiederholen (≈ 1 ct), bevor die Rohdaten allein gelten. Beide Antworten werden gebucht.
  let fehlend = teilAFehlt(a0.extrahiert);
  if (fehlend.length && a0.modus === 'text') {
    try {
      const a1 = await teilA(dokText, dokTraegt);
      for (const k of fehlend) if (a1.extrahiert?.[k] && typeof a1.extrahiert[k] === 'object') a0.extrahiert[k] = a1.extrahiert[k];
      fehlend = teilAFehlt(a0.extrahiert);
    } catch (e) {
      if (endgueltig(e)) throw e;
      warnungen.push(`Wiederholung der KI-Auswertung fehlgeschlagen: ${fehlerText(e)}`);
    }
  }
  if (fehlend.length) warnungen.push(`KI lieferte keine Angaben zu ${fehlend.map((k) => (k === 'makler' ? 'Makler' : 'Kalkulation')).join(' und ')} — nur die Rohdaten gelten`);

  const roh: Record<string, any> = { ...roh0, einheiten_vollstaendig: true, ...pickeTeilA(a0.extrahiert), dokument: dok };

  // Einheiten-Nachfass wie in der alten App (extract_einheiten): nur wenn das Dokument mehr Einheiten nennt als erfasst
  const einheitenA = Array.isArray(roh.objekt?.einheiten) ? roh.objekt.einheiten.length : 0;
  const bisher = Math.max(einheitenA, zeilenAnzahl(roh));
  const soll = typeof roh.einheiten_im_dokument === 'number' ? roh.einheiten_im_dokument : null;
  if (soll !== null && soll > bisher) {
    warnungen.push(`Einheitenliste unvollständig (${bisher} von ${soll}) — Nachfass`);
    try {
      const e = await einheitenExtrahieren(a.ki, pdf, seiten);
      await vermerke(e.model, e.usage, 'expose-analyse/v2-einheiten');
      const liste = einheitenAusNachfass(e.wert);
      if (liste.length > bisher) { roh.objekt = { ...(roh.objekt ?? {}), einheiten: liste }; nachfass = true; }
    } catch (e) {
      if (endgueltig(e)) throw e;
      warnungen.push(`Einheiten-Nachfass fehlgeschlagen: ${fehlerText(e)}`);
    }
  }

  const { v2, warnungen: w } = exposeV2Bereinigen(roh);
  warnungen.push(...w);
  return {
    extrahiert: v2, v2, modus: a0.modus, modell: a0.modell, seiten, zeichenProSeite: dokSeiten ? Math.round(dokumentZeichen(dok) / dokSeiten) : 0,
    ...(dok.seitenGesamt > dokSeiten ? { hinweis: `Ausgewertet wurden die ersten ${dokSeiten} von ${dok.seitenGesamt} Seiten.` } : {}),
    schemaVersion: EXPOSE_V2_SCHEMA, promptVersion: PROMPT_VERSION_V2, stopReason: a0.stopReason, ...messwerte(),
    nachfass, wiederholung: false, warnungen, seitenTexte: dok.seiten.map((x) => seitenText(x)),
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

/** Gruppen, die Teil A weggelassen oder leer geliefert hat (`makler`, `kalkulation`). */
export function teilAFehlt(ex: any): ('makler' | 'kalkulation')[] {
  return (['makler', 'kalkulation'] as const).filter((k) => {
    const g = ex?.[k];
    return !g || typeof g !== 'object' || Object.values(g).every((v) => v === null || v === undefined || v === '');
  });
}

/** Teil A in die Rohdaten: die Gruppen des bisherigen Werkzeugs. */
function pickeTeilA(ex: any): Record<string, unknown> {
  const aus: Record<string, unknown> = {};
  for (const k of ['objekt', 'makler', 'kalkulation', '_konfidenz']) if (ex?.[k] && typeof ex[k] === 'object') aus[k] = ex[k];
  return aus;
}

/** Signaturprüfung: „%PDF-“ am Anfang. Ein als PDF benanntes Archiv geht nicht an das Modell. */
export const istPdf = (bytes: Uint8Array) => bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
