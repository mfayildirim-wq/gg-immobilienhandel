/**
 * Exposé-Schema v1 → Spalten (Protokoll 27, T1).
 *
 * `ZIEL_OBJEKT` und `ZIEL_MAKLER` sind die Allowlist: nur diese v1-Pfade dürfen in eine Spalte oder in `details`
 * geschrieben werden; alles andere wird nur angezeigt oder landet als Notiz. `v1AlsV0` übersetzt ein v1-Ergebnis
 * in das heutige Format der Prüfseite (`ExposeObjektDaten`/`ExposeMaklerDaten`), damit `exposeVorbereiten` und die
 * Übernahme unverändert weiterlaufen.
 */
import type { ExposeV1, ExposeV1Einheit, Konfidenz } from './schemaV1.ts';

export type ObjektSpalte =
  | 'strasse' | 'hausnr' | 'plz' | 'stadt' | 'bundesland' | 'baujahr' | 'wohnflaeche' | 'grundstueck'
  | 'angebotspreis' | 'istMiete' | 'sollMiete' | 'einheitenAnzahl' | 'energieklasse' | 'heizung';
export type MaklerSpalte = 'name' | 'firma' | 'tel' | 'mobil' | 'festnetz' | 'email' | 'webseite' | 'strasse' | 'plz' | 'ort' | 'weitereKontakte';

/** Ziel eines v1-Pfads: Spalte und/oder Schlüssel in `details` (Punkt = verschachtelt, z. B. `energieausweis.art`). */
export interface Ziel<S extends string = string> { spalte?: S; details?: string; label: string }

export const ZIEL_OBJEKT: Record<string, Ziel<ObjektSpalte>> = {
  'geo.strasse': { spalte: 'strasse', label: 'Straße' },
  'geo.hausnummer': { spalte: 'hausnr', label: 'Hausnummer' },
  'geo.plz': { spalte: 'plz', label: 'PLZ' },
  'geo.ort': { spalte: 'stadt', label: 'Stadt' },
  'geo.bundesland': { spalte: 'bundesland', label: 'Bundesland' },
  'zustand.baujahr': { spalte: 'baujahr', label: 'Baujahr' },
  'flaechen.wohnflaeche': { spalte: 'wohnflaeche', label: 'Wohnfläche' },
  'flaechen.grundstuecksflaeche': { spalte: 'grundstueck', label: 'Grundstück' },
  'preise.kaufpreis': { spalte: 'angebotspreis', label: 'Angebotspreis' },
  'preise.mieteinnahmen_ist_monat': { spalte: 'istMiete', label: 'Ist-Miete' },
  'preise.mieteinnahmen_soll_monat': { spalte: 'sollMiete', label: 'Soll-Miete' },
  'verwaltung.anzahl_wohneinheiten': { spalte: 'einheitenAnzahl', label: 'Einheiten' },
  'energiepass.klasse': { spalte: 'energieklasse', details: 'energieausweis.klasse', label: 'Energieklasse' },
  'ausstattung.heizungsart': { spalte: 'heizung', label: 'Heizung' },
  // nur details
  'preise.bruttorendite_angegeben': { details: 'bruttorendite', label: 'Bruttorendite (Exposé)' },
  'zustand.heizung_baujahr': { details: 'heizungsbaujahr', label: 'Baujahr Heizung' },
  'energiepass.art': { details: 'energieausweis.art', label: 'Energieausweis' },
  'energiepass.kennwert': { details: 'energieausweis.kennwert', label: 'Energiekennwert' },
  'energiepass.gueltig_bis': { details: 'energieausweis.gueltig_bis', label: 'Energieausweis gültig bis' },
  'freitexte.lage': { details: 'lagebeschreibung', label: 'Lagebeschreibung' },
  'freitexte.ausstattung': { details: 'ausstattung', label: 'Ausstattung' },
  'preise.provision_text': { details: 'provision_text', label: 'Provision' },
  'preise.provision_prozent': { details: 'provision_prozent', label: 'Provision (%)' },
  'preise.hausgeld_monat': { details: 'hausgeld_monat', label: 'Hausgeld je Monat' },
  'preise.nebenkosten_monat': { details: 'nebenkosten_monat', label: 'Nebenkosten je Monat' },
  'zustand.denkmalschutz': { details: 'denkmalschutz', label: 'Denkmalschutz' },
  'zustand.erbpacht': { details: 'erbpacht', label: 'Erbbaurecht' },
  'objektkategorie.nutzungsart': { details: 'nutzungsart', label: 'Nutzungsart' },
  'objektkategorie.objektart': { details: 'objektart', label: 'Objektart' },
  'dokument.objektnr_extern': { details: 'objektnr_extern', label: 'Objekt-Nr. (Makler)' },
};

/** `kontaktperson.name` steht für Vorname + Nachname; `weitere_kontakte` für jede Zeile `weitere_kontakte.N`. */
export const ZIEL_MAKLER: Record<string, Ziel<MaklerSpalte>> = {
  'kontaktperson.name': { spalte: 'name', label: 'Name' },
  'kontaktperson.firma': { spalte: 'firma', label: 'Firma' },
  'kontaktperson.mobil': { spalte: 'mobil', label: 'Mobil' },
  'kontaktperson.tel_zentrale': { spalte: 'festnetz', label: 'Festnetz' },
  'kontaktperson.tel_durchwahl': { spalte: 'festnetz', label: 'Festnetz' },
  'kontaktperson.email': { spalte: 'email', label: 'E-Mail' },
  'kontaktperson.web': { spalte: 'webseite', label: 'Webseite' },
  'kontaktperson.strasse': { spalte: 'strasse', label: 'Straße' },
  'kontaktperson.plz': { spalte: 'plz', label: 'PLZ' },
  'kontaktperson.ort': { spalte: 'ort', label: 'Ort' },
  'weitere_kontakte': { spalte: 'weitereKontakte', label: 'Weitere Kontakte' },
};

// ── v1 → v0 ───────────────────────────────────────────────────

export interface EinheitV0 { typ: string | null; lage: string | null; zimmer: number | null; flaeche: number | null; kaltmiete: number | null; vermiet: string | null }

export interface ObjektV0 {
  strasse: string | null; hausnr: string | null; plz: string | null; stadt: string | null; bundesland: string | null;
  baujahr: number | null; wohnflaeche: number | null; grundstueck: number | null; einheitenAnz: number | null;
  angebotspreis: number | null; istmiete: number | null; bruttorendite: number | null;
  heizungsart: string | null; heizungsbaujahr: number | null;
  energieausweis: { klasse: string | null; kennwert: number | null; art: string | null };
  lagebeschreibung: string | null; ausstattung: string | null; notizen: string | null;
  einheiten: EinheitV0[];
}

export interface MaklerV0 {
  name: string | null; alleNamen: string[]; firma: string | null;
  mobiltel: string | null; festnetztel: string | null; tel: string | null; alleTelefonnummern: string[];
  email: string | null; alleEmails: string[]; webseite: string | null;
}

export interface KalkulationV0 {
  kaufpreis: number | null; notar: number | null; gest: number | null; makler: number | null; fk_p: number | null; ek_p: number | null;
  euribor: number | null; margeB: number | null; ek_r: number | null; halt: number | null; rp_pct: number | null; glo_m: number | null;
}

export interface ExtrahiertV0 { objekt: ObjektV0; makler: MaklerV0; kalkulation: KalkulationV0; _konfidenz: Record<string, Konfidenz> }

const text = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);

function ohneDoppel(werte: (string | null | undefined)[]): string[] {
  const aus: string[] = [];
  for (const w of werte) {
    const t = text(w);
    if (t && !aus.includes(t)) aus.push(t);
  }
  return aus;
}

/** Vorname + Nachname der Kontaktperson, wie die alte App den Maklernamen führt. */
export const kontaktName = (k: ExposeV1['kontaktperson']): string | null => text([k.vorname, k.name].map(text).filter(Boolean).join(' '));

/** v1 in das heutige Format der Prüfseite (`ExposeObjektDaten`/`ExposeMaklerDaten`, Kalkulation, `_konfidenz`). */
export function v1AlsV0(v1: ExposeV1): ExtrahiertV0 {
  const { geo, preise, flaechen, ausstattung, zustand, energiepass, verwaltung, freitexte, kontaktperson: k, belege } = v1;
  const merkmale = ausstattung.merkmale.map(text).filter(Boolean).join(', ');
  const objekt: ObjektV0 = {
    strasse: text(geo.strasse), hausnr: text(geo.hausnummer), plz: text(geo.plz), stadt: text(geo.ort), bundesland: text(geo.bundesland),
    baujahr: zustand.baujahr, wohnflaeche: flaechen.wohnflaeche, grundstueck: flaechen.grundstuecksflaeche, einheitenAnz: verwaltung.anzahl_wohneinheiten,
    angebotspreis: preise.kaufpreis, istmiete: preise.mieteinnahmen_ist_monat, bruttorendite: preise.bruttorendite_angegeben,
    heizungsart: text(ausstattung.heizungsart), heizungsbaujahr: zustand.heizung_baujahr,
    energieausweis: { klasse: text(energiepass.klasse), kennwert: energiepass.kennwert, art: text(energiepass.art) },
    lagebeschreibung: text(freitexte.lage),
    ausstattung: text([merkmale, text(freitexte.ausstattung)].filter(Boolean).join(' — ')),
    notizen: text(freitexte.sonstiges),
    einheiten: v1.einheiten.map((e) => ({ typ: e.typ, lage: text(e.lage), zimmer: e.zimmer, flaeche: e.flaeche, kaltmiete: e.kaltmiete, vermiet: e.vermiet })),
  };
  const festnetz = text(k.tel_durchwahl) ?? text(k.tel_zentrale);
  const mobil = text(k.mobil);
  const makler: MaklerV0 = {
    name: kontaktName(k),
    alleNamen: ohneDoppel([kontaktName(k), ...v1.weitere_kontakte.map((w) => w.name)]),
    firma: text(k.firma),
    mobiltel: mobil, festnetztel: festnetz, tel: mobil ?? festnetz,
    alleTelefonnummern: ohneDoppel([k.tel_zentrale, k.tel_durchwahl, k.mobil, k.fax, ...v1.weitere_kontakte.flatMap((w) => [w.tel, w.mobil])]),
    email: text(k.email),
    alleEmails: ohneDoppel([k.email, ...v1.weitere_kontakte.map((w) => w.email)]),
    webseite: text(k.web),
  };
  const kalkulation: KalkulationV0 = {
    kaufpreis: preise.kaufpreis, makler: preise.provision_prozent,
    notar: null, gest: null, fk_p: null, ek_p: null, euribor: null, margeB: null, ek_r: null, halt: null, rp_pct: null, glo_m: null,
  };
  const _konfidenz: Record<string, Konfidenz> = {
    angebotspreis: belege.kaufpreis.konfidenz, istmiete: belege.istmiete.konfidenz, wohnflaeche: belege.wohnflaeche.konfidenz,
    grundstueck: belege.grundstueck.konfidenz, baujahr: belege.baujahr.konfidenz, einheitenAnz: belege.anzahl_we.konfidenz,
    energiekennwert: belege.energiekennwert.konfidenz, strasse: belege.adresse.konfidenz,
  };
  return { objekt, makler, kalkulation, _konfidenz };
}

export interface EinheitDetails { nebenkosten?: number; sollmiete?: number; mietbeginn?: string; seite?: number }

/** Zusatz einer Einheit für `objekt_einheiten.details`: nur gesetzte Werte; nichts gesetzt → null. */
export function einheitenDetails(e: ExposeV1Einheit): EinheitDetails | null {
  const d: EinheitDetails = {};
  if (typeof e.nebenkosten === 'number') d.nebenkosten = e.nebenkosten;
  if (typeof e.sollmiete === 'number') d.sollmiete = e.sollmiete;
  const mietbeginn = text(e.mietbeginn);
  if (mietbeginn) d.mietbeginn = mietbeginn;
  if (typeof e._seite === 'number') d.seite = e._seite;
  return Object.keys(d).length ? d : null;
}

/**
 * „Trägt“ ein v1-Ergebnis? Fachregel (Protokoll 27): Ort und Kaufpreis gefunden, mindestens eine Einheit,
 * und die Einheitenliste ist nicht abgeschnitten (`einheiten_vollstaendig` nicht ausdrücklich false).
 */
export function v1Traegt(v1: ExposeV1): boolean {
  return !!text(v1.geo.ort) && typeof v1.preise.kaufpreis === 'number' && v1.einheiten.length > 0 && v1.verwaltung.einheiten_vollstaendig !== false;
}
