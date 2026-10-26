/**
 * Verlauf der Gespräche je Dialog. Die App bringt den Speicher mit (gg: Tabelle `ki_gespraeche`);
 * hier stehen die Schnittstelle und ein Speicher im Arbeitsspeicher für Tests.
 */
import type { KiBezug, KiGespraech, KiGespraechKopf } from './vertrag.ts';

export interface VerlaufSpeicher {
  /** Gespräche zum Dialog, neueste zuerst; ohne Bezug die allgemeinen Gespräche */
  liste(bezug: KiBezug | null, anzahl: number): Promise<KiGespraechKopf[]>;
  laden(id: string): Promise<KiGespraech | null>;
  speichern(g: KiGespraech): Promise<void>;
}

export const gleicherBezug = (a: KiBezug | null, b: KiBezug | null) => (a === null || b === null ? a === b : a.art === b.art && a.id === b.id);

export const kopfAus = ({ nachrichten: _n, ...kopf }: KiGespraech): KiGespraechKopf => kopf;

export function verlaufImArbeitsspeicher(): VerlaufSpeicher {
  const alle = new Map<string, KiGespraech>();
  return {
    async liste(bezug, anzahl) {
      return [...alle.values()].filter((g) => gleicherBezug(g.bezug, bezug)).sort((a, b) => b.am.localeCompare(a.am)).slice(0, anzahl).map(kopfAus);
    },
    async laden(id) {
      const g = alle.get(id);
      return g ? structuredClone(g) : null;
    },
    async speichern(g) {
      alle.set(g.id, structuredClone(g));
    },
  };
}
