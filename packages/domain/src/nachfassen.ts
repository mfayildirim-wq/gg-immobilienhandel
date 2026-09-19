import { z } from 'zod';

/** Eine Werteliste für Deal und Makler (09 · Befund „Frequenz uneinheitlich“). */
export const FREQUENZEN = [
  'Täglich',
  'Wöchentlich',
  'Monatlich',
  'Alle 3 Monate',
  'Alle 6 Monate',
  'Alle 12 Monate',
  'Nie',
] as const;

export const Frequenz = z.enum(FREQUENZEN);
export type Frequenz = z.infer<typeof Frequenz>;

/** Altwerte aus der alten App auf die eine Liste abbilden; unbekannt → Wöchentlich (Ist: still 7 Tage). */
export function normalisiereFrequenz(wert: string | null | undefined): Frequenz {
  if (wert === 'Nicht kontaktieren') return 'Nie';
  const treffer = Frequenz.safeParse(wert);
  return treffer.success ? treffer.data : 'Wöchentlich';
}

/** ISO-Datum (YYYY-MM-DD) → Tage seit Epoche, ohne Zeitzonen-Verschiebung. */
function tagNummer(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(j!, m! - 1, t!) / 86_400_000);
}

export function isoPlusTage(iso: string, tage: number): string {
  return new Date((tagNummer(iso) + tage) * 86_400_000).toISOString().slice(0, 10);
}

// Fälligkeit, „Erledigt“ und Wählmaschine: ankauf/cockpit.ts (per Golden Master gegen die alte App geprüft).
