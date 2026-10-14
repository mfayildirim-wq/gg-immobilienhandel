/**
 * Wörtliche Exposé-Werte in gg-Werte umwandeln (Protokoll 28). Nur Lesen, kein Schätzen: was sich nicht eindeutig als
 * Zahl/Jahr/Ja-Nein lesen lässt, ergibt null — die Angabe bleibt dann unter „Weitere Angaben“.
 */
import type { WertTyp } from './katalog.ts';

export type NormWert = string | number | boolean | null;

/** Leerraum (auch geschützte Leerzeichen, weiche Trennstriche) auf ein Leerzeichen. */
export const leerraum = (s: string) => s.replace(/­/g, '').replace(/[\s  ]+/g, ' ').trim();

/** Ein Zahl-Token deutsch oder international lesen: „1.250.000,50“, „1,250,000.50“, „85,5“, „1.250“ (= 1250). */
function tokenLesen(roh: string): number | null {
  const t = roh.replace(/[.,]+$/, '');
  if (!t) return null;
  const punkte = (t.match(/\./g) ?? []).length;
  const kommas = (t.match(/,/g) ?? []).length;
  let s: string;
  if (punkte && kommas) {
    s = t.lastIndexOf(',') > t.lastIndexOf('.') ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (kommas) {
    s = kommas === 1 && !/^\d{1,3},\d{3}$/.test(t) ? t.replace(',', '.') : t.replace(/,/g, '');
  } else if (punkte) {
    s = punkte === 1 && !/^\d{1,3}\.\d{3}$/.test(t) ? t : t.replace(/\./g, '');
  } else s = t;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Erste Zahl im Text; „Mio.“/„Tsd.“ direkt dahinter werden berücksichtigt. Mehrere verschiedene Zahlen (Spanne, Liste)
 * → null, außer `erste` ist gesetzt. Jahreszahlen in Klammern o. ä. stören nicht, wenn sie nach der Zahl stehen und
 * `erste` gesetzt ist.
 */
export function zahlAusText(text: string, erste = true): number | null {
  // Einheiten mit Ziffer („m2“, „m³“) sind keine Zahl
  const s = leerraum(text).replace(/\b(k?m|qm)[²³23]/gi, '$1');
  if (/auf anfrage|k\.\s?a\.|keine angabe|^-+$|^–$/i.test(s)) return null;
  const treffer = [...s.matchAll(/-?\d[\d.,]*(?:\s?(Mio\.?|Millionen|Tsd\.?|T€))?/gi)];
  if (!treffer.length) return null;
  if (!erste && treffer.length > 1) return null;
  const m = treffer[0]!;
  const zahlTeil = m[0].replace(/\s?(Mio\.?|Millionen|Tsd\.?|T€)$/i, '');
  let n = tokenLesen(zahlTeil.replace(/^-/, ''));
  if (n === null) return null;
  if (zahlTeil.startsWith('-')) n = -n;
  const faktor = m[1] ? (/^(mio|millionen)/i.test(m[1]) ? 1_000_000 : 1_000) : 1;
  return +(n * faktor).toFixed(4);
}

/** Vierstellige Jahreszahl 1700–2100 („Bj. 1912“, „ca. 1965“, „1912/2015“ → 1912). */
export function jahrAusText(text: string): number | null {
  const m = leerraum(text).match(/\b(1[7-9]\d{2}|20\d{2}|2100)\b/);
  return m ? Number(m[1]) : null;
}

/** Ja/Nein nur bei eindeutigem Wortlaut. */
export function jaNeinAusText(text: string): boolean | null {
  const s = leerraum(text).toLowerCase();
  if (/^(ja|vorhanden|yes|x|✓|✔|liegt vor|gegeben|zutreffend)\b/.test(s)) return true;
  if (/^(nein|nicht vorhanden|keine?|no|entfällt|nicht gegeben)\b/.test(s)) return false;
  return null;
}

/** Wert für einen Zieltyp. Text: Leerraum geglättet, sonst unverändert. */
export function wertNormalisieren(text: string, typ: WertTyp): NormWert {
  switch (typ) {
    case 'zahl': return zahlAusText(text);
    case 'ganzzahl': { const n = zahlAusText(text); return n === null ? null : Math.round(n); }
    case 'jahr': return jahrAusText(text);
    case 'jaNein': return jaNeinAusText(text);
    case 'datum':
    case 'text': { const t = leerraum(text); return t || null; }
  }
}

/** „Musterstraße 12a“ → { strasse: 'Musterstraße', hausnr: '12a' }; ohne Nummer am Ende bleibt alles Straße. */
export function strasseTrennen(text: string): { strasse: string; hausnr: string | null } {
  const s = leerraum(text);
  const m = s.match(/^(.*?[^\d\s])\s+(\d+\s?[a-zA-Z]?(?:\s?[-–/]\s?\d+\s?[a-zA-Z]?)?)$/);
  return m ? { strasse: m[1]!.replace(/,$/, ''), hausnr: m[2]!.replace(/\s+/g, '') } : { strasse: s, hausnr: null };
}

/** „76133 Karlsruhe“ → { plz, ort }; sonst null. */
export function plzOrtTrennen(text: string): { plz: string; ort: string } | null {
  const m = leerraum(text).match(/^(?:D-)?(\d{5})\s+(.+)$/);
  return m ? { plz: m[1]!, ort: m[2]! } : null;
}
