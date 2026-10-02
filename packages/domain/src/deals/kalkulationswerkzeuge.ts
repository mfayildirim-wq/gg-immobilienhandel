/**
 * Werkzeuge im Reiter Kalkulation: „Alle setzen“ (Rendite, KP/m², Mieterhöhung SOLL) und Kalkulationsvarianten.
 * Nach gg-immohandel src/modules/deals/deals.ts dealBulkRendite, dealBulkKpm2, dealBulkMietsteigerung,
 * dealVariantSave, dealVariantLoad, dealVariantDelete und fmtNum.
 */
import type { EinheitDaten } from '../ankaufkalkulation/engine.ts';
import { parseNum } from '../zahlen.ts';

type Einheit = EinheitDaten;
export type SammelErgebnis<E> = { ok: true; einheiten: E[]; hinweis: string } | { ok: false; fehler: string };

/** fmtNum (deals.ts): Tausenderpunkte, höchstens zwei Nachkommastellen. */
export function fmtNum(v: unknown): string {
  if (!v && v !== 0) return '';
  const n = typeof v === 'string' ? parseNum(v) : +(v as number);
  if (!n && n !== 0) return '';
  return n % 1 === 0 ? (+n || 0).toLocaleString('de-DE') : n.toLocaleString('de-DE', { maximumFractionDigits: 2 });
}

/** dealBulkRendite: Rendite auf alle Einheiten außer Stellplätzen; VKP wird wieder aus der Rendite berechnet. */
export function sammelRendite<E extends Einheit>(einheiten: E[], eingabe: unknown): SammelErgebnis<E> {
  const rk = parseFloat(String(eingabe ?? ''));
  if (!rk || rk <= 0) return { ok: false, fehler: 'Bitte Rendite eingeben' };
  return {
    ok: true,
    einheiten: einheiten.map((e) => (e.typ === 'Stellplatz' ? e : { ...e, renditeK: rk, verkaufspreis: null })),
    hinweis: `Rendite ${rk}% auf alle Einheiten gesetzt`,
  };
}

/** dealBulkKpm2: VKP = KP/m² × Fläche, Rendite zurückgerechnet (JNKM / VKP); Einheiten ohne Fläche bleiben. */
export function sammelKpm2<E extends Einheit>(einheiten: E[], eingabe: unknown): SammelErgebnis<E> {
  const kpm2 = parseNum(eingabe ?? '');
  if (!kpm2 || kpm2 <= 0) return { ok: false, fehler: 'Bitte KP/m² eingeben' };
  return {
    ok: true,
    einheiten: einheiten.map((e) => {
      if (e.typ === 'Stellplatz') return e;
      const fl = parseNum(e.flaeche) || 0;
      if (!fl) return e;
      const vkp = Math.round(kpm2 * fl);
      const mn = e.mieteNeuManuell ? parseNum(e.mieteNeu) || 0 : parseNum(e.mieteIst) || 0;
      return { ...e, verkaufspreis: vkp, renditeK: mn && vkp ? +((mn * 12) / vkp * 100).toFixed(1) : 0 };
    }),
    hinweis: `KP/m² ${fmtNum(kpm2)} € auf alle Einheiten gesetzt`,
  };
}

/** dealBulkMietsteigerung: KM SOLL = KM IST × (1 + pct/100); bei 0 % folgt SOLL wieder dem IST. */
export function sammelMietsteigerung<E extends Einheit>(einheiten: E[], pct: number): SammelErgebnis<E> {
  const factor = 1 + pct / 100;
  let touched = 0;
  const neu = einheiten.map((e) => {
    if (e.typ === 'Stellplatz') return e;
    const ist = parseNum(e.mieteIst) || 0;
    if (!ist) return e;
    touched++;
    return pct === 0
      ? { ...e, mieteNeu: ist, mieteNeuManuell: false, verkaufspreis: null }
      : { ...e, mieteNeu: Math.round(ist * factor), mieteNeuManuell: true, verkaufspreis: null };
  });
  const anzahl = `${touched} Einheit${touched !== 1 ? 'en' : ''}`;
  return {
    ok: true,
    einheiten: neu,
    hinweis: pct === 0 ? `KM SOLL = KM IST gesetzt (${anzahl})` : `KM SOLL = KM IST × ${factor.toFixed(2)} gesetzt (${anzahl})`,
  };
}

export const MIETERHOEHUNG_KNOEPFE = [
  { pct: 0, label: '0%', titel: 'KM SOLL = KM IST (keine Mieterhöhung)' },
  { pct: 10, label: '+10%', titel: 'KM SOLL = KM IST × 1,10' },
  { pct: 15, label: '+15%', titel: 'KM SOLL = KM IST × 1,15' },
] as const;

// ── Kalkulationsvarianten ────────────────────────────────────
// Gespeichert wie in der alten App (d.kalkVarianten[]): kalk, einheiten und sanierung im Altformat.

export interface VarianteEinheit extends EinheitDaten { id?: string; lage: string | null; zimmer: number | null }
export interface VarianteSanierung { id?: string; beschreibung: string | null; betrag: number | null; bereich: 'both' | 'auf' | 'glo' | null }

export const VARIANTE_NAME_FRAGE = 'Name der Variante? (z.B. Erstangebot)';
/** Rückfrage, bevor ungespeicherte Eingaben der Kalkulation verloren gingen (Reiter, anderer Deal, andere Seite). */
export const KALK_UNGESPEICHERT_FRAGE = 'Die Kalkulation hat ungespeicherte Änderungen.\n\nÄnderungen verwerfen?';
export const varianteLadenFrage = (name: string) =>
  `Aktuelle Kalkulation wird durch Variante "${name}" überschrieben.\n\nTipp: Speichere die aktuelle vorher als Variante!\n\nWirklich überschreiben?`;
export const varianteLoeschenFrage = (name: string) => `Variante "${name}" wirklich löschen?`;
export const varianteGespeichertHinweis = (name: string, anzahl: number) => `📸 Variante "${name}" gespeichert (${anzahl} insgesamt)`;
export const varianteGeladenHinweis = (name: string) => `✅ Variante "${name}" geladen`;
export const varianteGeloeschtHinweis = (name: string) => `🗑 Variante "${name}" gelöscht`;
/** Eintrag im Auswahlfeld: Name (Datum). */
export const varianteOption = (name: string, ts: string) => `${name} (${new Date(ts).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })})`;

/** Name wie prompt(...).trim(); leer = nicht speichern. */
export const varianteName = (eingabe: string | null | undefined) => (eingabe || '').trim();

/** Momentaufnahme im Altformat (dealDE/dealDSAN). */
export function varianteSchnappschuss(einheiten: VarianteEinheit[], sanierungen: VarianteSanierung[]) {
  return {
    einheiten: einheiten.map((e) => ({
      ...(e.id ? { id: e.id } : {}), typ: e.typ ?? 'Wohnung', lage: e.lage ?? '', zimmer: e.zimmer ?? 0, fl: e.flaeche ?? 0,
      mi_ist: e.mieteIst ?? '', mi_neu: e.mieteNeu ?? '', mi_neu_manual: e.mieteNeuManuell,
      rend_k: e.renditeK ?? '', ...(e.verkaufspreis !== null ? { vkp: e.verkaufspreis } : {}), stk: e.stueck ?? 1,
    })),
    sanierung: sanierungen.map((s) => ({ ...(s.id ? { id: s.id } : {}), desc: s.beschreibung ?? '', amt: s.betrag ?? '', scope: s.bereich ?? 'both' })),
  };
}

const leer = (v: unknown) => v === null || v === undefined || v === '';
/** Kalkulation liest fl/mi_ist/mi_neu mit parseNum, rend_k/vkp/stk mit Unärplus (wie der Umzug). */
const lesen = (v: unknown) => (leer(v) ? null : parseNum(v));
const lesenPlus = (v: unknown) => {
  if (leer(v)) return null;
  const n = +(v as number);
  return Number.isFinite(n) ? n : null;
};
const text = (v: unknown) => (leer(v) ? null : String(v));

/** Variante zurück in die Formularwerte (dealVariantLoad). */
export function varianteLaden(v: { einheiten?: unknown; sanierungen?: unknown }): { einheiten: VarianteEinheit[]; sanierungen: VarianteSanierung[] } {
  const liste = (x: unknown) => (Array.isArray(x) ? (x as Record<string, unknown>[]) : []);
  return {
    einheiten: liste(v.einheiten).map((e) => ({
      ...(typeof e.id === 'string' && e.id ? { id: e.id } : {}), typ: text(e.typ), lage: text(e.lage), zimmer: lesen(e.zimmer), flaeche: lesen(e.fl), mieteIst: lesen(e.mi_ist),
      mieteNeu: lesen(e.mi_neu), mieteNeuManuell: !!e.mi_neu_manual, renditeK: lesenPlus(e.rend_k), verkaufspreis: lesenPlus(e.vkp),
      stueck: lesenPlus(e.stk),
    })),
    sanierungen: liste(v.sanierungen).map((s) => ({
      ...(typeof s.id === 'string' && s.id ? { id: s.id } : {}), beschreibung: text(s.desc), betrag: lesenPlus(s.amt),
      bereich: ['both', 'auf', 'glo'].includes(String(s.scope)) ? (s.scope as VarianteSanierung['bereich']) : null,
    })),
  };
}

// ── Einheiten aus Mieterliste-PDF (dealExtractUnitsFromPdf) ──

export interface ErkannteEinheit { typ?: string | null; lage?: string | null; zimmer?: number | null; flaeche?: number | null; kaltmiete?: number | null; stk?: number | null }

/** Rückfrage, wenn schon Einheiten da sind: Vorschau der ersten fünf, Hinweis auf das Ersetzen. */
export function einheitenErsetzenFrage(einheiten: ErkannteEinheit[], seiten: number, bisher: number): string {
  const preview = einheiten.slice(0, 5)
    .map((e) => `• ${e.typ || '?'} ${e.lage || ''}${e.flaeche ? ` (${e.flaeche} m²)` : ''}${e.kaltmiete ? ` ${e.kaltmiete} €` : ''}`)
    .join('\n');
  const more = einheiten.length > 5 ? `\n… und ${einheiten.length - 5} weitere` : '';
  return `Aus ${seiten} PDF-Seite(n) wurden ${einheiten.length} Einheit(en) erkannt:\n\n${preview}${more}\n\n` +
    `⚠️ Die aktuelle Liste mit ${bisher} Einheit(en) wird KOMPLETT ERSETZT. Fortfahren?`;
}

/** Erkannte Einheiten → Einheitenliste der Kalkulation (ersetzt die bisherige komplett). */
export function einheitenAusErkennung(einheiten: ErkannteEinheit[], standardRendite: number): VarianteEinheit[] {
  const alt = einheiten.map((e) => {
    const isStpl = e.typ === 'Stellplatz';
    const km = typeof e.kaltmiete === 'number' ? e.kaltmiete : '';
    return {
      typ: e.typ || 'Wohnung', lage: e.lage || '', zimmer: isStpl ? 0 : e.zimmer || 0, fl: isStpl ? 0 : e.flaeche || 0,
      mi_ist: km, mi_neu: km, mi_neu_manual: false, rend_k: standardRendite, stk: isStpl ? e.stk || 1 : 1,
    };
  });
  return varianteLaden({ einheiten: alt }).einheiten; // ohne IDs: neue Einheiten
}
