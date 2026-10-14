/**
 * Belegprüfung der Erfassung v2 (Protokoll 28): Die KI liefert jeden Wert wörtlich mit Seite. Belegt ist eine Angabe,
 * wenn ihr Wert tatsächlich auf der genannten Seite des Textlayers steht (Leerraum und Groß/Klein egal, lange Werte
 * über ihren Anfang). Steht er auf einer anderen Seite, gilt er als belegt und die Seite wird berichtigt.
 * Ohne Textlayer (PDF-Weg) bleibt die Prüfung offen (null).
 */
import type { ExposeV2 } from './erfassung.ts';

const PRUEF_LAENGE = 60;

/** Für den Vergleich: ohne Leerraum, weiche Trennstriche und Anführungszeichen-Varianten, klein. */
export const vergleichsText = (s: string) =>
  s.replace(/­/g, '').replace(/[„“”"«»‚‘’']/g, '').replace(/[‐‑‒–—]/g, '-').replace(/[\s  ]+/g, '').toLowerCase();

export interface BelegErgebnis {
  /** je Angabe: true belegt, false nicht im Text gefunden, null nicht prüfbar */
  belegt: (boolean | null)[];
  /** Index → richtige Seite, wo die KI eine falsche genannt hat */
  seiteBerichtigt: Record<number, number>;
  quote: number | null;
}

export function belegePruefen(v2: ExposeV2, seitenTexte: string[]): BelegErgebnis {
  const seiten = seitenTexte.map(vergleichsText);
  const seiteBerichtigt: Record<number, number> = {};
  const belegt = v2.angaben.map((a, i) => {
    if (!seiten.length) return null;
    const suche = vergleichsText(a.wert).slice(0, PRUEF_LAENGE);
    if (!suche) return null;
    if (a.seite && seiten[a.seite - 1]?.includes(suche)) return true;
    const andere = seiten.findIndex((s) => s.includes(suche));
    if (andere >= 0) { seiteBerichtigt[i] = andere + 1; return true; }
    return false;
  });
  const geprueft = belegt.filter((b) => b !== null);
  return { belegt, seiteBerichtigt, quote: geprueft.length ? +(geprueft.filter(Boolean).length / geprueft.length).toFixed(3) : null };
}
