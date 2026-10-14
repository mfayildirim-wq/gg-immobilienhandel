/**
 * Reiter „Aus dem Exposé“ und „Weitere Angaben“ (Protokoll 28): jede erfasste Angabe eines Imports als Zeile — wörtlich,
 * mit Seite, Belegprüfung, Standard-Bezeichnung und gg-Ziel (aus der Mapping-Tabelle oder als KI-Vorschlag) samt Vergleich
 * zum gespeicherten Wert. Das Dropdown bietet `zieleMitStand` an; `uebernahmeWert` liefert, was die Übernahme schreibt.
 *
 * `Angabe` ist strukturgleich zu `ExposeAngabe` im API-Vertrag (die Domain hängt nicht vom Vertrag ab).
 */
import { telefonSchluessel, type WeitereKontakte } from '../makler/kontakte.ts';
import type { ExposeV2 } from './erfassung.ts';
import { gruppeVonPfad, KATALOG, KATALOG_GRUPPEN } from './katalog.ts';
import type { NormWert } from './normalisieren.ts';
import { GG_ZIELE, type ZielArt } from './ziele.ts';
import { einheitenAusTabellen, type Gelernt, MAPPING, zielWert, zuordnen, type ZuordnungGrund } from './zuordnung.ts';

export type AngabeWert = NormWert;
export type AngabeStatus = 'gleich' | 'abweichend' | 'leer' | 'keinFeld';
export type AngabeQuelle = 'mapping' | 'vorschlag' | null;

export interface Angabe {
  importId: string; datum: string; gruppe: string;
  /** 'angaben.12' oder 'einheiten.3' */
  feld: string;
  /** Standard-Pfad (OpenImmo/gg) oder null */
  pfad: string | null;
  /** Bezeichnung wörtlich aus dem Dokument */
  bezeichnung: string;
  /** Bezeichnung des Standard-Pfads */
  standard: string | null;
  /** Wert wörtlich aus dem Dokument */
  wert: string;
  seite: number | null; belegt: boolean | null;
  zuordnung: ZuordnungGrund | null;
  ziel: { feld: string | null; label: string | null; wert: AngabeWert; aktuell: AngabeWert; status: AngabeStatus; quelle: AngabeQuelle; hinweis: string | null };
}

export interface ImportFuerAngaben { id: string; datum: string; rohdaten: ExposeV2; belegt?: (boolean | null)[] | null }

/** Gespeicherter Stand, gegen den verglichen wird: Spalten + `details` (Objekt) bzw. Spalten (Makler). */
export type DatensatzFuerAngaben = Record<string, unknown> & { details?: Record<string, unknown> | null; weitereKontakte?: WeitereKontakte | null };

export const ANGABEN_GRUPPEN = [...Object.keys(KATALOG_GRUPPEN), 'ohne', 'einheiten'] as const;

// ── Hilfen ─────────────────────────────────────────────────────

/** Zahl in deutscher Schreibweise, höchstens zwei Nachkommastellen (1.250.000 · 85,5). */
export function zahlDe(n: number): string {
  const [ganz = '0', dez] = Math.abs(n).toFixed(2).replace(/\.?0+$/, '').split('.');
  return (n < 0 ? '-' : '') + ganz.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (dez ? `,${dez}` : '');
}

const normText = (s: string) => s.trim().toLowerCase();
const leer = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && !v.trim()) || (Array.isArray(v) && !v.length);

const alsWert = (v: unknown): AngabeWert =>
  v === null || v === undefined ? null : typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? v : JSON.stringify(v);

function pfadLesen(o: unknown, pfad: string): unknown {
  let akt: unknown = o;
  for (const p of pfad.split('.')) {
    if (!akt || typeof akt !== 'object') return undefined;
    akt = (akt as Record<string, unknown>)[p];
  }
  return akt;
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
  if (wert === null) return 'abweichend';
  const a = String(aktuell);
  return normText(a) === normText(String(wert)) || normText(a).includes(normText(String(wert))) ? 'gleich' : 'abweichend';
}

const telefonGleich = (a: string, b: string) => telefonSchluessel(a) !== '' && telefonSchluessel(a) === telefonSchluessel(b);

/** Aktueller Wert eines gg-Ziels im gespeicherten Datensatz. */
export function zielAktuell(ziel: string, d: DatensatzFuerAngaben): AngabeWert {
  const z = GG_ZIELE[ziel];
  if (!z) return null;
  if (z.spalte) return alsWert(d[z.spalte]);
  if (z.details) return alsWert(pfadLesen(d.details, z.details));
  return null;
}

/** Ziele einer Art mit aktuellem Wert — für das Dropdown (leere Felder zuerst anbieten). */
export function zieleMitStand(art: Exclude<ZielArt, 'kalkulation'>, d: DatensatzFuerAngaben) {
  return Object.entries(GG_ZIELE)
    .filter(([, z]) => z.art === art)
    .map(([schluessel, z]) => { const aktuell = zielAktuell(schluessel, d); return { schluessel, label: z.label, einheit: z.einheit ?? null, aktuell, leer: leer(aktuell) || !!z.liste }; });
}

function zielZeile(ziel: string | null, wert: AngabeWert, quelle: AngabeQuelle, d: DatensatzFuerAngaben, pfad: string | null, wortlaut: string, hinweis?: string): Angabe['ziel'] {
  if (!ziel) return { feld: null, label: null, wert: null, aktuell: null, status: 'keinFeld', quelle: null, hinweis: null };
  const z = GG_ZIELE[ziel]!;
  const aktuell = zielAktuell(ziel, d);
  let status: AngabeStatus;
  if (ziel === 'makler.weitereKontakte') {
    const w = d.weitereKontakte;
    const drin = !!w && (w.namen.some((n) => normText(n) === normText(wortlaut)) || w.telefonnummern.some((t) => telefonGleich(t, wortlaut)) || w.emails.some((e) => normText(e) === normText(wortlaut)));
    status = drin ? 'gleich' : 'leer';
  } else if (['mobil', 'festnetz', 'tel'].includes(z.spalte ?? '') && typeof wert === 'string') {
    const vorhanden = [aktuell, d.tel].some((t) => typeof t === 'string' && telefonGleich(t, wert));
    status = vorhanden ? 'gleich' : leer(aktuell) ? 'leer' : 'abweichend';
  } else if (z.liste && Array.isArray(pfadLesen(d.details, z.details ?? ''))) {
    const liste = pfadLesen(d.details, z.details!) as unknown[];
    status = liste.some((x) => typeof x === 'string' && typeof wert === 'string' && normText(x).includes(normText(wert))) ? 'gleich' : 'leer';
  } else status = vergleichsStatus(wert, aktuell);
  void pfad;
  return { feld: ziel, label: z.label, wert, aktuell, status, quelle, hinweis: hinweis ?? null };
}

const istMaklerAngabe = (a: ExposeV2['angaben'][number]) => a.kontakt !== null || !!a.pfad?.startsWith('kontaktperson.') || !!a.pfad?.startsWith('anbieter.');

function sortiert(zeilen: Angabe[]): Angabe[] {
  const rang = (z: Angabe) => { const i = (ANGABEN_GRUPPEN as readonly string[]).indexOf(z.gruppe); return i < 0 ? ANGABEN_GRUPPEN.length : i; };
  return zeilen.map((z, i) => ({ z, i })).sort((a, b) => rang(a.z) - rang(b.z) || a.i - b.i).map((x) => x.z);
}

/** Zeilen eines Imports für Objekt oder Makler. */
export function angabenAusImport(imp: ImportFuerAngaben, art: 'objekt' | 'makler', d: DatensatzFuerAngaben, gelernt: Gelernt = {}): Angabe[] {
  const v2 = imp.rohdaten;
  const { zeilen: zuordnung } = zuordnen(v2, null, gelernt);
  const kopf = { importId: imp.id, datum: imp.datum };
  const aus: Angabe[] = [];
  v2.angaben.forEach((a, i) => {
    if ((art === 'makler') !== istMaklerAngabe(a)) return;
    const z = zuordnung[i]!;
    // doppelte Angaben: das Mapping-Ziel als Vorschlag, damit „Ersetzen“ einen Klick braucht
    const vorschlag = z.vorschlag ?? (z.grund === 'doppelt' && a.pfad ? MAPPING[a.pfad]?.[0] ?? null : null);
    const zielSchluessel = z.ziel ?? vorschlag;
    const passend = zielSchluessel && GG_ZIELE[zielSchluessel]?.art === art ? zielSchluessel : null;
    const wert = passend ? (z.ziel ? z.wert : zielWert(passend, a.wert, a.pfad).wert) : null;
    aus.push({
      ...kopf, gruppe: gruppeVonPfad(a.pfad), feld: `angaben.${i}`, pfad: a.pfad, bezeichnung: a.bezeichnung,
      standard: a.pfad ? KATALOG[a.pfad]?.label ?? null : null, wert: a.wert, seite: a.seite, belegt: imp.belegt?.[i] ?? null, zuordnung: z.grund,
      ziel: zielZeile(passend, wert, passend ? (z.ziel ? 'mapping' : 'vorschlag') : null, d, a.pfad, a.wert, z.gelernt ? (z.hinweis ? `gelernt · ${z.hinweis}` : 'gelernt') : z.hinweis),
    });
  });
  if (art === 'objekt') {
    const { einheiten, details } = einheitenAusTabellen(v2.einheiten_tabellen);
    einheiten.forEach((e, i) => {
      const t = [
        e.lage, typeof e.zimmer === 'number' ? `${zahlDe(e.zimmer)} Zi` : null, typeof e.flaeche === 'number' ? `${zahlDe(e.flaeche)} m²` : null,
        typeof e.kaltmiete === 'number' ? `${zahlDe(e.kaltmiete)} €` : null, e.vermiet === 'Leerstand' ? 'Leerstand' : null,
      ].filter(Boolean).join(' · ');
      aus.push({
        ...kopf, gruppe: 'einheiten', feld: `einheiten.${i}`, pfad: null, bezeichnung: `Einheit ${details[i]?.nr ?? i + 1} (${e.typ})`, standard: null,
        wert: t || (e.typ ?? ''), seite: details[i]?.seite ?? null, belegt: null, zuordnung: null,
        ziel: zielZeile(null, null, null, d, null, ''),
      });
    });
  }
  return sortiert(aus);
}

// ── Übernahme ──────────────────────────────────────────────────

export interface Uebernahme { spalte?: string; detailsSchluessel?: string; liste?: boolean; notizText?: string; wert: unknown }

/** Notiz „Bezeichnung: Wert (Exposé S. n)“. */
export const notizText = (a: Pick<Angabe, 'bezeichnung' | 'wert' | 'seite'>): string => `${a.bezeichnung}: ${a.wert}${a.seite ? ` (Exposé S. ${a.seite})` : ''}`;

/**
 * Was die Übernahme in `ziel` (gg-Ziel-Schlüssel oder 'notizen') schreibt; null, wenn das Ziel nicht zur Art passt oder der
 * Wert sich für den Zieltyp nicht lesen lässt (z. B. „auf Anfrage“ als Zahl).
 */
export function uebernahmeWert(a: Angabe, ziel: string, art: 'objekt' | 'makler'): Uebernahme | null {
  if (ziel === 'notizen') return { notizText: notizText(a), wert: a.wert };
  const z = GG_ZIELE[ziel];
  if (!z || z.art !== art) return null;
  if (ziel === 'makler.weitereKontakte') {
    const k: WeitereKontakte = { namen: [], telefonnummern: [], emails: [] };
    if (a.wert.includes('@')) k.emails.push(a.wert.trim());
    else if (/^[+\d][\d\s\-()/]{4,}$/.test(a.wert.trim())) k.telefonnummern.push(a.wert.trim());
    else k.namen.push(a.wert.trim());
    return { spalte: 'weitereKontakte', wert: k };
  }
  const { wert } = zielWert(ziel, a.wert, a.pfad);
  if (wert === null) return null;
  const eintrag = z.liste && typeof wert === 'string' && !a.pfad?.startsWith('freitexte.') ? `${a.bezeichnung}: ${wert}` : wert;
  if (z.spalte) return { spalte: z.spalte, wert: eintrag, ...(z.liste ? { liste: true } : {}) };
  return { detailsSchluessel: z.details!, wert: eintrag, ...(z.liste ? { liste: true } : {}) };
}
