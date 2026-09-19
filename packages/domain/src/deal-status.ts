import { z } from 'zod';

/** Die sechs Deal-Status in fachlicher Reihenfolge (09 · Zeichnung 2). */
export const DEAL_STATUS = [
  'In Prüfung',
  'Angebot abgegeben',
  'Über Zeit nachfassen',
  'Closing Path',
  'Angekauft',
  'Archiv',
] as const;

export const DealStatus = z.enum(DEAL_STATUS);
export type DealStatus = z.infer<typeof DealStatus>;

export const START_STATUS: DealStatus = 'In Prüfung';

/** Sortierung im Cockpit (09 · Fachregeln): Closing Path zuerst. */
export const STATUS_SORT: Record<DealStatus, number> = {
  'Closing Path': 0,
  'Angebot abgegeben': 1,
  'In Prüfung': 2,
  'Über Zeit nachfassen': 3,
  Angekauft: 4,
  Archiv: 5,
};

/** Im Cockpit sichtbar sind nur die aktiven Status (Sort 0–3). */
export function imCockpit(status: DealStatus): boolean {
  return STATUS_SORT[status] <= 3;
}

/** „Angekauft“ schaltet Vertriebsliste und Projekt frei. */
export function schaltetVerkaufFrei(status: DealStatus): boolean {
  return status === 'Angekauft';
}

export type StatuswechselErgebnis =
  | { erlaubt: true; aenderung: boolean }
  | { erlaubt: false; grund: string };

/**
 * Ist-Verhalten (Entscheidung 10, Fachfrage 2 offen): jeder Status → jeder Status, ohne Pflichtangaben.
 * Wird die Fachfrage beantwortet, ändern sich diese Funktion und ihr Test gemeinsam.
 */
export function pruefeStatuswechsel(von: DealStatus, nach: DealStatus): StatuswechselErgebnis {
  return { erlaubt: true, aenderung: von !== nach };
}
