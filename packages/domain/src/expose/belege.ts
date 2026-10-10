/**
 * Belege prüfen (Protokoll 27, T1): Jeder Kernwert aus Schema v1 kommt mit Seite + Zitat. Belegt ist ein Wert nur,
 * wenn das Zitat tatsächlich auf der genannten Seite steht und die Zahl des Felds im Zitat vorkommt. Was nicht
 * belegt ist, bekommt Konfidenz „niedrig“ — die Prüfseite zeigt das, der Wert bleibt stehen.
 */
import type { ExposeV1 } from './schemaV1.ts';

type BelegFeld = keyof ExposeV1['belege'];

/** Welcher v1-Wert zu welchem Beleg gehört. */
export const BELEG_WERT: Record<BelegFeld, (v1: ExposeV1) => number | string | null> = {
  kaufpreis: (v) => v.preise.kaufpreis,
  istmiete: (v) => v.preise.mieteinnahmen_ist_monat,
  wohnflaeche: (v) => v.flaechen.wohnflaeche,
  grundstueck: (v) => v.flaechen.grundstuecksflaeche,
  baujahr: (v) => v.zustand.baujahr,
  anzahl_we: (v) => v.verwaltung.anzahl_wohneinheiten,
  energiekennwert: (v) => v.energiepass.kennwert,
  adresse: (v) => v.geo.strasse,
};

/** v1-Pfade, deren Fundstelle aus einem Beleg kommt (Adresse gilt für die ganze Anschrift). */
export const BELEG_PFADE: Record<string, BelegFeld> = {
  'preise.kaufpreis': 'kaufpreis', 'preise.mieteinnahmen_ist_monat': 'istmiete', 'flaechen.wohnflaeche': 'wohnflaeche',
  'flaechen.grundstuecksflaeche': 'grundstueck', 'zustand.baujahr': 'baujahr', 'verwaltung.anzahl_wohneinheiten': 'anzahl_we',
  'energiepass.kennwert': 'energiekennwert', 'geo.strasse': 'adresse', 'geo.hausnummer': 'adresse', 'geo.plz': 'adresse', 'geo.ort': 'adresse',
};

/** Leerraum (auch geschützte Leerzeichen, weiche Trennstriche) auf ein Leerzeichen, Kleinschreibung. */
export const textNormalisieren = (s: string) => s.replace(/­/g, '').replace(/[\s ]+/g, ' ').trim().toLowerCase();

/** Alle Zahlen eines Textes in deutscher (1.250.000,50) und internationaler (1,250,000.50) Lesart. */
export function zahlenImText(s: string): number[] {
  const aus: number[] = [];
  for (const m of s.matchAll(/\d[\d.,]*/g)) {
    const roh = m[0].replace(/[.,]+$/, '');
    const de = Number(roh.replace(/\./g, '').replace(',', '.'));
    const en = Number(roh.replace(/,/g, ''));
    if (Number.isFinite(de)) aus.push(de);
    if (Number.isFinite(en)) aus.push(en);
  }
  return aus;
}

const zahlImZitat = (zitat: string, wert: number) => zahlenImText(zitat).some((z) => Math.abs(z - wert) < 1e-6);

const zitatAufSeite = (zitat: string, seite: string) =>
  seite.includes(zitat) || seite.replace(/ /g, '').includes(zitat.replace(/ /g, ''));

/**
 * Belege gegen die Seitentexte prüfen. Felder ohne Wert zählen nicht. Nicht belegt (Zitat fehlt, Seite außerhalb 1..n,
 * Zitat nicht auf der Seite, Zahl nicht im Zitat) → Konfidenz „niedrig“. Die Eingabe bleibt unverändert.
 */
export function belegePruefen(v1: ExposeV1, seitenTexte: string[]): { belegt: Record<string, boolean>; v1: ExposeV1 } {
  const belegt: Record<string, boolean> = {};
  const belege = { ...v1.belege };
  const seiten = seitenTexte.map(textNormalisieren);
  for (const feld of Object.keys(BELEG_WERT) as BelegFeld[]) {
    const wert = BELEG_WERT[feld](v1);
    if (wert === null || wert === '') continue;
    const b = belege[feld];
    const zitat = b.zitat ? textNormalisieren(b.zitat) : '';
    const seite = typeof b.seite === 'number' && b.seite >= 1 && b.seite <= seiten.length ? seiten[b.seite - 1]! : null;
    let ok = !!zitat && seite !== null && zitatAufSeite(zitat, seite);
    if (ok) ok = typeof wert === 'number' ? zahlImZitat(zitat, wert) : zitat.includes(textNormalisieren(wert));
    belegt[feld] = ok;
    if (!ok) belege[feld] = { ...b, konfidenz: 'niedrig' };
  }
  return { belegt, v1: { ...v1, belege } };
}

/** Synonyme der Kernfelder mit dem Schemafeld, in das die Angabe gehört. */
export const KERNFELD_SYNONYME: { muster: RegExp; feld: string }[] = [
  { muster: /kaufpreis|angebotspreis|\bpreis/i, feld: 'preise.kaufpreis' },
  { muster: /wohnfl(ä|ae)che/i, feld: 'flaechen.wohnflaeche' },
  { muster: /grundst(ü|ue)ck/i, feld: 'flaechen.grundstuecksflaeche' },
  { muster: /baujahr/i, feld: 'zustand.baujahr' },
  { muster: /kaltmiete|mieteinnahme|\bmiete\b|nettomiete|jahresmiete/i, feld: 'preise.mieteinnahmen_ist_monat' },
  { muster: /energie/i, feld: 'energiepass' },
  { muster: /heizung/i, feld: 'ausstattung.heizungsart' },
  { muster: /telefon|\btel\b|mobil|handy/i, feld: 'kontaktperson.tel_zentrale' },
  { muster: /e-?mail/i, feld: 'kontaktperson.email' },
  { muster: /adresse|anschrift|stra(ß|ss)e|\bplz\b/i, feld: 'geo' },
];

/** Einträge in `weitere_angaben`, die ein Kernfeld doppeln — Warnungen für Prüfseite und Prüfsatz. */
export function kernfeldDopplung(v1: ExposeV1): string[] {
  const warnungen: string[] = [];
  v1.weitere_angaben.forEach((a, i) => {
    const treffer = KERNFELD_SYNONYME.find((s) => s.muster.test(a.bezeichnung));
    if (treffer) warnungen.push(`weitere_angaben.${i} „${a.bezeichnung}“ ist ein Kernfeld (${treffer.feld})`);
  });
  return warnungen;
}
