/**
 * Reiter „Aus dem Exposé“ (Protokoll 27, T1): jede nicht-leere v1-Angabe eines Imports als Zeile mit deutscher
 * Bezeichnung, Einheit, Fundstelle, Beleg und dem Vergleich zum aktuellen Feld (gleich / abweichend / leer / keinFeld).
 * `uebernahmeWert` liefert, was die Übernahme schreiben darf — nur Ziele aus `ZIEL_OBJEKT`/`ZIEL_MAKLER`.
 *
 * `Angabe` ist strukturgleich zu `ExposeAngabe` im API-Vertrag (die Domain hängt nicht vom Vertrag ab).
 */
import { telefonSchluessel, type WeitereKontakte } from '../makler/kontakte.ts';
import type { ObjektWerte } from '../objekte/detail.ts';
import { kontaktName, ZIEL_MAKLER, ZIEL_OBJEKT, type Ziel } from './abbildung.ts';
import { BELEG_PFADE } from './belege.ts';
import { ANGABE_GRUPPEN, type ExposeV1 } from './schemaV1.ts';

export type AngabeWert = string | number | boolean | null;
export type AngabeStatus = 'gleich' | 'abweichend' | 'leer' | 'keinFeld';

export interface Angabe {
  importId: string; datum: string; gruppe: string;
  /** v1-Pfad, z. B. 'preise.kaufpreis', 'einheiten.3', 'weitere_angaben.3', 'weitere_kontakte.0' */
  feld: string; bezeichnung: string; wert: AngabeWert; einheit: string | null;
  seite: number | null; zitat: string | null; konfidenz: string | null; belegt: boolean | null;
  ziel: { feld: string | null; label: string | null; aktuell: AngabeWert; status: AngabeStatus };
}

export interface ImportFuerAngaben { id: string; datum: string; rohdaten: ExposeV1; belegt?: Record<string, boolean> | null }

export type ObjektFuerAngaben = ObjektWerte & { bundesland?: string | null; details?: Record<string, unknown> | null; notizen?: string | null };

export interface MaklerFuerAngaben {
  name?: string | null; firma?: string | null; tel?: string | null; mobil?: string | null; festnetz?: string | null; email?: string | null;
  webseite?: string | null; strasse?: string | null; plz?: string | null; ort?: string | null; weitereKontakte?: WeitereKontakte | null;
}

/** Gruppen der Makler-Zeilen (die Objekt-Zeilen nutzen `ANGABE_GRUPPEN`). */
export const MAKLER_GRUPPEN = ['kontakt', 'weitere_kontakte'] as const;

// ── Bezeichnungen ──────────────────────────────────────────────

type Gruppe = (typeof ANGABE_GRUPPEN)[number];
interface Feldinfo { bezeichnung: string; einheit?: string; gruppe: Gruppe }

/** Deutsche Bezeichnung, Einheit und Gruppe je v1-Pfad des Objekts (Reihenfolge = Anzeige innerhalb der Gruppe). */
export const BEZEICHNUNGEN_OBJEKT: Record<string, Feldinfo> = {
  'geo.strasse': { bezeichnung: 'Straße', gruppe: 'lage' },
  'geo.hausnummer': { bezeichnung: 'Hausnummer', gruppe: 'lage' },
  'geo.plz': { bezeichnung: 'PLZ', gruppe: 'lage' },
  'geo.ort': { bezeichnung: 'Ort', gruppe: 'lage' },
  'geo.bundesland': { bezeichnung: 'Bundesland', gruppe: 'lage' },
  'geo.etage_anzahl': { bezeichnung: 'Geschosse', gruppe: 'lage' },
  'freitexte.lage': { bezeichnung: 'Lagebeschreibung', gruppe: 'lage' },
  'preise.kaufpreis': { bezeichnung: 'Kaufpreis', einheit: '€', gruppe: 'preise' },
  'preise.mieteinnahmen_ist_monat': { bezeichnung: 'Ist-Miete je Monat', einheit: '€', gruppe: 'preise' },
  'preise.mieteinnahmen_soll_monat': { bezeichnung: 'Soll-Miete je Monat', einheit: '€', gruppe: 'preise' },
  'preise.bruttorendite_angegeben': { bezeichnung: 'Bruttorendite (angegeben)', einheit: '%', gruppe: 'preise' },
  'preise.x_fache_angegeben': { bezeichnung: 'Kaufpreisfaktor (angegeben)', gruppe: 'preise' },
  'preise.provision_text': { bezeichnung: 'Provision', gruppe: 'preise' },
  'preise.provision_prozent': { bezeichnung: 'Provision', einheit: '%', gruppe: 'preise' },
  'preise.hausgeld_monat': { bezeichnung: 'Hausgeld je Monat', einheit: '€', gruppe: 'preise' },
  'preise.nebenkosten_monat': { bezeichnung: 'Nebenkosten je Monat', einheit: '€', gruppe: 'preise' },
  'flaechen.wohnflaeche': { bezeichnung: 'Wohnfläche', einheit: 'm²', gruppe: 'flaechen' },
  'flaechen.nutzflaeche': { bezeichnung: 'Nutzfläche', einheit: 'm²', gruppe: 'flaechen' },
  'flaechen.gewerbeflaeche': { bezeichnung: 'Gewerbefläche', einheit: 'm²', gruppe: 'flaechen' },
  'flaechen.grundstuecksflaeche': { bezeichnung: 'Grundstücksfläche', einheit: 'm²', gruppe: 'flaechen' },
  'flaechen.anzahl_stellplaetze': { bezeichnung: 'Stellplätze', einheit: 'Stück', gruppe: 'flaechen' },
  'ausstattung.heizungsart': { bezeichnung: 'Heizungsart', gruppe: 'ausstattung' },
  'ausstattung.energietraeger': { bezeichnung: 'Energieträger', gruppe: 'ausstattung' },
  'ausstattung.merkmale': { bezeichnung: 'Ausstattungsmerkmale', gruppe: 'ausstattung' },
  'freitexte.ausstattung': { bezeichnung: 'Ausstattungsbeschreibung', gruppe: 'ausstattung' },
  'zustand.baujahr': { bezeichnung: 'Baujahr', gruppe: 'zustand' },
  'zustand.heizung_baujahr': { bezeichnung: 'Baujahr Heizung', gruppe: 'zustand' },
  'zustand.sanierungen': { bezeichnung: 'Sanierungen', gruppe: 'zustand' },
  'zustand.zustand_text': { bezeichnung: 'Zustand', gruppe: 'zustand' },
  'energiepass.art': { bezeichnung: 'Energieausweis', gruppe: 'energie' },
  'energiepass.klasse': { bezeichnung: 'Energieklasse', gruppe: 'energie' },
  'energiepass.kennwert': { bezeichnung: 'Energiekennwert', einheit: 'kWh/(m²·a)', gruppe: 'energie' },
  'energiepass.gueltig_bis': { bezeichnung: 'Energieausweis gültig bis', gruppe: 'energie' },
  'verwaltung.anzahl_wohneinheiten': { bezeichnung: 'Wohneinheiten', einheit: 'Stück', gruppe: 'verwaltung' },
  'verwaltung.anzahl_gewerbeeinheiten': { bezeichnung: 'Gewerbeeinheiten', einheit: 'Stück', gruppe: 'verwaltung' },
  'verwaltung.einheiten_anzahl_dokument': { bezeichnung: 'Einheiten laut Dokument', einheit: 'Stück', gruppe: 'verwaltung' },
  'verwaltung.einheiten_vollstaendig': { bezeichnung: 'Einheitenliste vollständig', gruppe: 'verwaltung' },
  'verwaltung.verfuegbar_ab': { bezeichnung: 'Verfügbar ab', gruppe: 'verwaltung' },
  'zustand.denkmalschutz': { bezeichnung: 'Denkmalschutz', gruppe: 'recht' },
  'zustand.erbpacht': { bezeichnung: 'Erbbaurecht', gruppe: 'recht' },
  'dokument.objektnr_extern': { bezeichnung: 'Objekt-Nr. (Makler)', gruppe: 'vertrieb' },
  'dokument.datum': { bezeichnung: 'Datum des Exposés', gruppe: 'vertrieb' },
  'dokument.titel': { bezeichnung: 'Titel', gruppe: 'vertrieb' },
  'objektkategorie.nutzungsart': { bezeichnung: 'Nutzungsart', gruppe: 'sonstiges' },
  'objektkategorie.objektart': { bezeichnung: 'Objektart', gruppe: 'sonstiges' },
  'freitexte.objektbeschreibung': { bezeichnung: 'Objektbeschreibung', gruppe: 'sonstiges' },
  'freitexte.sonstiges': { bezeichnung: 'Sonstige Hinweise', gruppe: 'sonstiges' },
};

/** Zeilen der Kontaktperson; `kontaktperson.name` ist Vorname + Nachname (keine eigene Vorname-Zeile). */
export const BEZEICHNUNGEN_MAKLER: Record<string, string> = {
  'kontaktperson.anrede': 'Anrede', 'kontaktperson.titel': 'Titel', 'kontaktperson.name': 'Name', 'kontaktperson.position': 'Position',
  'kontaktperson.firma': 'Firma', 'kontaktperson.strasse': 'Straße', 'kontaktperson.plz': 'PLZ', 'kontaktperson.ort': 'Ort',
  'kontaktperson.tel_zentrale': 'Telefon Zentrale', 'kontaktperson.tel_durchwahl': 'Durchwahl', 'kontaktperson.mobil': 'Mobil',
  'kontaktperson.fax': 'Fax', 'kontaktperson.email': 'E-Mail', 'kontaktperson.web': 'Webseite',
};

// ── Hilfen ─────────────────────────────────────────────────────

/** Zahl in deutscher Schreibweise, höchstens zwei Nachkommastellen, ohne Nullen am Ende (1.250.000 · 85,5). */
export function zahlDe(n: number): string {
  const [ganz = '0', dez] = Math.abs(n).toFixed(2).replace(/\.?0+$/, '').split('.');
  return (n < 0 ? '-' : '') + ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dez ? `,${dez}` : '');
}

const wertText = (w: AngabeWert): string => (typeof w === 'number' ? zahlDe(w) : typeof w === 'boolean' ? (w ? 'ja' : 'nein') : (w ?? ''));
const normText = (s: string) => s.trim().toLowerCase();
const leer = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim());

const alsAngabeWert = (v: unknown): AngabeWert =>
  v === null || v === undefined ? null : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v);

function pfadLesen(o: unknown, pfad: string): unknown {
  let akt: unknown = o;
  for (const p of pfad.split('.')) {
    if (!akt || typeof akt !== 'object') return undefined;
    akt = (akt as Record<string, unknown>)[p];
  }
  return akt;
}

/** v1-Wert als Zeilenwert: Listen werden Text, Leeres (null, '', []) wird null. */
function v1Wert(v1: ExposeV1, pfad: string): AngabeWert {
  const v = pfadLesen(v1, pfad);
  if (Array.isArray(v)) {
    if (pfad === 'zustand.sanierungen') {
      const s = (v as ExposeV1['zustand']['sanierungen']).map((x) => [x.jahr, x.was].filter((t) => t !== null && t !== '').join(' ')).filter(Boolean).join('; ');
      return s || null;
    }
    const s = v.filter((x) => typeof x === 'string' && x.trim()).join(', ');
    return s || null;
  }
  return leer(v) ? null : alsAngabeWert(v);
}

/** gleich: Zahlen ±0,5 %, Texte ohne Rand und Groß/Klein, Wahrheitswerte auch als Text. */
export function vergleichsStatus(wert: AngabeWert, aktuell: AngabeWert): AngabeStatus {
  if (leer(aktuell)) return 'leer';
  if (typeof wert === 'number') {
    const a = typeof aktuell === 'number' ? aktuell : Number(String(aktuell).replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(a)) return 'abweichend';
    return Math.abs(a - wert) <= 0.005 * Math.max(Math.abs(a), Math.abs(wert)) ? 'gleich' : 'abweichend';
  }
  if (typeof wert === 'boolean') return String(aktuell).toLowerCase() === String(wert) ? 'gleich' : 'abweichend';
  return normText(String(wert)) === normText(String(aktuell)) ? 'gleich' : 'abweichend';
}

const telefonGleich = (a: string, b: string) => telefonSchluessel(a) !== '' && telefonSchluessel(a) === telefonSchluessel(b);

function sortiert(zeilen: Angabe[], gruppen: readonly string[]): Angabe[] {
  const rang = (z: Angabe) => { const i = gruppen.indexOf(z.gruppe); return i < 0 ? gruppen.length : i; };
  return zeilen
    .map((z, i) => ({ z, i }))
    .sort((a, b) => rang(a.z) - rang(b.z) || (a.z.ziel.status === 'keinFeld' ? 1 : 0) - (b.z.ziel.status === 'keinFeld' ? 1 : 0) || a.i - b.i)
    .map((x) => x.z);
}

const keinFeld = (): Angabe['ziel'] => ({ feld: null, label: null, aktuell: null, status: 'keinFeld' });

// ── Objekt ─────────────────────────────────────────────────────

function fundstelle(imp: ImportFuerAngaben, pfad: string, seite: number | null): Pick<Angabe, 'seite' | 'zitat' | 'konfidenz' | 'belegt'> {
  const belegFeld = BELEG_PFADE[pfad];
  if (!belegFeld) return { seite, zitat: null, konfidenz: null, belegt: null };
  const b = imp.rohdaten.belege[belegFeld];
  return { seite: b.seite, zitat: b.zitat, konfidenz: b.konfidenz, belegt: imp.belegt?.[belegFeld] ?? null };
}

function zielObjekt(pfad: string, wert: AngabeWert, objekt: ObjektFuerAngaben): Angabe['ziel'] {
  const z = ZIEL_OBJEKT[pfad];
  if (!z) return keinFeld();
  const feld = z.spalte ?? `details.${z.details}`;
  const aktuell = alsAngabeWert(z.spalte ? (objekt as Record<string, unknown>)[z.spalte] : pfadLesen(objekt.details, z.details!));
  return { feld, label: z.label, aktuell, status: vergleichsStatus(wert, aktuell) };
}

/** Zeile je Einheit: „EG links · 3 Zi · 85,5 m² · 780 €“ (Leerstand genannt, Vermietet nicht). */
function einheitText(e: ExposeV1['einheiten'][number]): string {
  return [
    e.lage?.trim() || null,
    typeof e.zimmer === 'number' ? `${zahlDe(e.zimmer)} Zi` : null,
    typeof e.flaeche === 'number' ? `${zahlDe(e.flaeche)} m²` : null,
    typeof e.kaltmiete === 'number' ? `${zahlDe(e.kaltmiete)} €` : null,
    e.vermiet === 'Leerstand' ? 'Leerstand' : null,
  ].filter(Boolean).join(' · ');
}

/** Alle nicht-leeren Objekt-Angaben eines Imports; Gruppen in `ANGABE_GRUPPEN`-Reihenfolge, Zeilen mit Ziel zuerst. */
export function angabenAusImport(imp: ImportFuerAngaben, objekt: ObjektFuerAngaben): Angabe[] {
  const v1 = imp.rohdaten;
  const kopf = { importId: imp.id, datum: imp.datum };
  const zeilen: Angabe[] = [];
  for (const [pfad, info] of Object.entries(BEZEICHNUNGEN_OBJEKT)) {
    const wert = v1Wert(v1, pfad);
    if (wert === null) continue;
    zeilen.push({ ...kopf, gruppe: info.gruppe, feld: pfad, bezeichnung: info.bezeichnung, wert, einheit: info.einheit ?? null, ...fundstelle(imp, pfad, null), ziel: zielObjekt(pfad, wert, objekt) });
  }
  v1.einheiten.forEach((e, i) => {
    zeilen.push({ ...kopf, gruppe: 'verwaltung', feld: `einheiten.${i}`, bezeichnung: `Einheit ${i + 1} (${e.typ})`, wert: einheitText(e) || e.typ, einheit: null, seite: e._seite, zitat: null, konfidenz: null, belegt: null, ziel: keinFeld() });
  });
  v1.weitere_angaben.forEach((a, i) => {
    zeilen.push({ ...kopf, gruppe: a.gruppe, feld: `weitere_angaben.${i}`, bezeichnung: a.bezeichnung, wert: a.wert, einheit: a.einheit, seite: a.seite, zitat: null, konfidenz: null, belegt: null, ziel: keinFeld() });
  });
  return sortiert(zeilen, ANGABE_GRUPPEN);
}

// ── Makler ─────────────────────────────────────────────────────

const TELEFON_SPALTEN = new Set(['tel', 'mobil', 'festnetz']);

function zielMakler(pfad: string, wert: AngabeWert, makler: MaklerFuerAngaben): Angabe['ziel'] {
  const z = ZIEL_MAKLER[pfad];
  if (!z?.spalte) return keinFeld();
  const aktuell = alsAngabeWert((makler as Record<string, unknown>)[z.spalte]);
  let status: AngabeStatus;
  if (TELEFON_SPALTEN.has(z.spalte) && typeof wert === 'string') {
    // Telefon nach Ziffern; die Hauptnummer (`tel`) zählt für jede Telefonspalte als vorhanden
    const vorhanden = [aktuell, makler.tel].some((t) => typeof t === 'string' && telefonGleich(t, wert));
    status = vorhanden ? 'gleich' : leer(aktuell) ? 'leer' : 'abweichend';
  } else if (z.spalte === 'email' && typeof wert === 'string') {
    status = leer(aktuell) ? 'leer' : normText(String(aktuell)) === normText(wert) ? 'gleich' : 'abweichend';
  } else {
    status = vergleichsStatus(wert, aktuell);
  }
  return { feld: z.spalte, label: z.label, aktuell, status };
}

/** Weiterer Kontakt schon am Makler (Name, Nummer oder E-Mail) → gleich; sonst leer (er kann ergänzt werden). */
function zielWeitererKontakt(k: ExposeV1['weitere_kontakte'][number], makler: MaklerFuerAngaben): Angabe['ziel'] {
  const z = ZIEL_MAKLER['weitere_kontakte']!;
  const w = makler.weitereKontakte;
  const nummern = [k.tel, k.mobil].filter((t): t is string => !!t);
  const enthalten = !!w && (
    (!!k.name && w.namen.some((n) => normText(n) === normText(k.name!)))
    || nummern.some((t) => w.telefonnummern.some((x) => telefonGleich(x, t)))
    || (!!k.email && w.emails.some((e) => normText(e) === normText(k.email!)))
  );
  return { feld: z.spalte!, label: z.label, aktuell: w ? JSON.stringify(w) : null, status: enthalten ? 'gleich' : 'leer' };
}

const kontaktText = (k: ExposeV1['weitere_kontakte'][number]) =>
  [k.name, k.rolle ? `(${k.rolle})` : null, k.tel, k.mobil, k.email].map((s) => s?.trim() || null).filter(Boolean).join(' · ');

/** Makler-Angaben eines Imports: Kontaktperson (Gruppe `kontakt`) und weitere Kontakte je Zeile. */
export function angabenAusImportMakler(imp: ImportFuerAngaben, makler: MaklerFuerAngaben): Angabe[] {
  const v1 = imp.rohdaten;
  const kopf = { importId: imp.id, datum: imp.datum, seite: null, zitat: null, konfidenz: null, belegt: null };
  const zeilen: Angabe[] = [];
  for (const [pfad, bezeichnung] of Object.entries(BEZEICHNUNGEN_MAKLER)) {
    const wert = pfad === 'kontaktperson.name' ? kontaktName(v1.kontaktperson) : v1Wert(v1, pfad);
    if (wert === null) continue;
    zeilen.push({ ...kopf, gruppe: 'kontakt', feld: pfad, bezeichnung, wert, einheit: null, ziel: zielMakler(pfad, wert, makler) });
  }
  v1.weitere_kontakte.forEach((k, i) => {
    const wert = kontaktText(k);
    if (!wert) return;
    zeilen.push({ ...kopf, gruppe: 'weitere_kontakte', feld: `weitere_kontakte.${i}`, bezeichnung: `Weiterer Kontakt ${i + 1}`, wert, einheit: null, ziel: zielWeitererKontakt(k, makler) });
  });
  return sortiert(zeilen, MAKLER_GRUPPEN);
}

// ── Übernahme ──────────────────────────────────────────────────

export type UebernahmeZiel = 'spalte' | 'details' | 'notizen';
export interface Uebernahme { spalte?: string; detailsSchluessel?: string; notizText?: string; wert: unknown }

const GANZZAHL = new Set(['baujahr', 'einheitenAnzahl']);

const zielFuer = (feld: string): Ziel | undefined =>
  ZIEL_OBJEKT[feld] ?? ZIEL_MAKLER[feld] ?? (feld.startsWith('weitere_kontakte.') ? ZIEL_MAKLER['weitere_kontakte'] : undefined);

/** Zeilentext „Name · (Rolle) · Tel · Mobil · E-Mail“ zurück in das Format der Spalte `weitereKontakte`. */
function weitererKontaktAusText(text: string): WeitereKontakte {
  const k: WeitereKontakte = { namen: [], telefonnummern: [], emails: [] };
  for (const teil of text.split(' · ').map((s) => s.trim()).filter(Boolean)) {
    if (teil.startsWith('(') && teil.endsWith(')')) continue;
    if (teil.includes('@')) k.emails.push(teil);
    else if (/^[+\d][\d\s\-()/]{4,}$/.test(teil)) k.telefonnummern.push(teil);
    else if (!k.namen.length) k.namen.push(teil);
  }
  return k;
}

/** Notiz „Bezeichnung: Wert Einheit (Exposé S. n)“. */
export const notizText = (a: Angabe): string =>
  `${a.bezeichnung}: ${wertText(a.wert)}${a.einheit ? ` ${a.einheit}` : ''}${a.seite ? ` (Exposé S. ${a.seite})` : ''}`;

/**
 * Was die Übernahme schreibt. `null`, wenn das Ziel für diese Angabe nicht erlaubt ist (Allowlist).
 * Zahlen bleiben Zahlen; `baujahr`/`einheitenAnzahl` ganzzahlig; Notizen sind für jede Angabe erlaubt.
 */
export function uebernahmeWert(a: Angabe, ziel: UebernahmeZiel): Uebernahme | null {
  if (ziel === 'notizen') return { notizText: notizText(a), wert: a.wert };
  const z = zielFuer(a.feld);
  if (!z) return null;
  const wert = typeof a.wert === 'string' ? a.wert.trim() : a.wert;
  if (ziel === 'spalte') {
    if (!z.spalte) return null;
    if (z.spalte === 'weitereKontakte') return { spalte: z.spalte, wert: weitererKontaktAusText(String(wert ?? '')) };
    return { spalte: z.spalte, wert: GANZZAHL.has(z.spalte) && typeof wert === 'number' ? Math.round(wert) : wert };
  }
  if (!z.details) return null;
  return { detailsSchluessel: z.details, wert };
}
