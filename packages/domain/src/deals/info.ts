/* eslint-disable @typescript-eslint/no-explicit-any -- Objekt im Altformat wie in der alten App */
/**
 * Regeln des Deal-Reiters „Info & Objekt“ (gg-immohandel src/modules/deals/deals.ts): Vorbelegung aus dem Objekt
 * (dealPrefillObj), Termin nach Frequenzwechsel (dealFreqChanged), Schnellknöpfe (dealSetNextDate), Betreff der Makler-Mail.
 */
import { isoPlusTage } from '../nachfassen.ts';
import { parseNum } from '../zahlen.ts';

/** Tage je Frequenz in dealFreqChanged; „Nie“ hat keinen Vorschlag. */
export const FREQUENZ_TAGE: Record<string, number> = { 'Täglich': 1, 'Wöchentlich': 7, 'Monatlich': 30, 'Alle 3 Monate': 90, 'Alle 6 Monate': 180, 'Alle 12 Monate': 365 };

/** Schnellknöpfe unter „Nächster Kontakt“. */
export const NAECHSTER_KONTAKT_KNOEPFE = [{ label: '1 Wo', tage: 7 }, { label: '1 Mo', tage: 30 }, { label: '3 Mo', tage: 90 }, { label: '6 Mo', tage: 180 }] as const;

/**
 * Frequenzwechsel: der nächste Kontakt wird nur vorbelegt, wenn noch keiner gesetzt ist (Nutzerwunsch 2026-05-05 —
 * ein manuell gesetztes Datum darf nicht zurückspringen). `heute` ist der lokale Tag (alt: UTC-Tag).
 */
export function naechsterKontaktNachFrequenz(frequenz: string, aktuell: string | null | undefined, heute: string): string | null {
  if (aktuell) return null;
  const tage = FREQUENZ_TAGE[frequenz];
  return tage ? isoPlusTage(heute, tage) : null;
}

/** dealPrefillObj: Kaufpreis und Wohnfläche aus dem Objekt, Einheiten aus den Objekt-Einheiten (Zielrendite 4,5). */
export function dealVorbelegungAusObjekt(o: any) {
  return {
    kalk: { kaufpreis: parseNum(o?.angebotspreis), wohnflaeche: parseNum(o?.wohnflaeche) },
    einheiten: (o?.einheiten || []).map((e: any) => ({ typ: e.typ || 'Wohnung', fl: parseNum(e.flaeche), mi_ist: parseNum(e.kaltmiete) || '', mi_neu: parseNum(e.kaltmiete) || '', rend_k: 4.5 })),
  };
}

/** Betreff von „✉️ E-Mail an Makler“. */
export function maklerMailBetreff(d: { adresse?: string | null; hausnr?: string | null; stadt?: string | null }): string {
  return 'Anfrage: ' + ([d.adresse, d.hausnr].filter(Boolean).join(' ') || 'Objekt') + (d.stadt ? ', ' + d.stadt : '');
}
