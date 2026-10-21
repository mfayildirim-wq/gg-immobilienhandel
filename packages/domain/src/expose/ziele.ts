/**
 * gg-Zielfelder der Exposé-Erfassung v2 (Protokoll 28): wohin ein Wert aus dem Exposé im gg-Datenbestand gehen darf.
 * Das ist die Allowlist für automatische Zuordnung (Mapping-Tabelle), KI-Vorschlag und manuelle Zuordnung per Dropdown.
 *
 * - `pruef`: Pfad im Format der Prüfseite (`objekt.*`, `makler.*`, `kalkulation.*`), falls das Feld dort steht.
 * - `spalte`: Spalte in `objekte` bzw. `makler`.
 * - `details`: Schlüssel in `objekte.details` (Punkt = verschachtelt).
 * - `liste`: mehrere Angaben werden gesammelt statt „erster gewinnt“.
 */
import type { WertTyp } from './katalog.ts';

export type ZielArt = 'objekt' | 'makler' | 'kalkulation';

export interface GgZiel {
  art: ZielArt; label: string; typ: WertTyp; einheit?: string;
  pruef?: string; spalte?: string; details?: string; liste?: boolean;
}

const O = (label: string, typ: WertTyp, ort: Omit<GgZiel, 'art' | 'label' | 'typ'>): GgZiel => ({ art: 'objekt', label, typ, ...ort });
const M = (label: string, ort: Omit<GgZiel, 'art' | 'label' | 'typ'>): GgZiel => ({ art: 'makler', label, typ: 'text', ...ort });

export const GG_ZIELE: Record<string, GgZiel> = {
  // ── Objekt: Felder der Prüfseite
  'objekt.strasse': O('Straße', 'text', { pruef: 'objekt.strasse', spalte: 'strasse' }),
  'objekt.hausnr': O('Hausnummer', 'text', { pruef: 'objekt.hausnr', spalte: 'hausnr' }),
  'objekt.plz': O('PLZ', 'text', { pruef: 'objekt.plz', spalte: 'plz' }),
  'objekt.stadt': O('Stadt', 'text', { pruef: 'objekt.stadt', spalte: 'stadt' }),
  'objekt.bundesland': O('Bundesland', 'text', { pruef: 'objekt.bundesland', spalte: 'bundesland' }),
  'objekt.baujahr': O('Baujahr', 'jahr', { pruef: 'objekt.baujahr', spalte: 'baujahr' }),
  'objekt.wohnflaeche': O('Wohnfläche', 'zahl', { pruef: 'objekt.wohnflaeche', spalte: 'wohnflaeche', einheit: 'm²' }),
  'objekt.grundstueck': O('Grundstück', 'zahl', { pruef: 'objekt.grundstueck', spalte: 'grundstueck', einheit: 'm²' }),
  'objekt.einheitenAnz': O('Anzahl Einheiten', 'ganzzahl', { pruef: 'objekt.einheitenAnz', spalte: 'einheitenAnzahl' }),
  'objekt.angebotspreis': O('Angebotspreis', 'zahl', { pruef: 'objekt.angebotspreis', spalte: 'angebotspreis', einheit: '€' }),
  'objekt.istmiete': O('Ist-Miete je Monat', 'zahl', { pruef: 'objekt.istmiete', spalte: 'istMiete', einheit: '€' }),
  'objekt.heizungsart': O('Heizung', 'text', { pruef: 'objekt.heizungsart', spalte: 'heizung' }),
  'objekt.energieausweis.klasse': O('Energieklasse', 'text', { pruef: 'objekt.energieausweis.klasse', spalte: 'energieklasse', details: 'energieausweis.klasse' }),
  'objekt.bruttorendite': O('Bruttorendite (Exposé)', 'zahl', { pruef: 'objekt.bruttorendite', details: 'bruttorendite', einheit: '%' }),
  'objekt.heizungsbaujahr': O('Baujahr Heizung', 'jahr', { pruef: 'objekt.heizungsbaujahr', details: 'heizungsbaujahr' }),
  'objekt.energieausweis.kennwert': O('Energiekennwert', 'zahl', { pruef: 'objekt.energieausweis.kennwert', details: 'energieausweis.kennwert', einheit: 'kWh/(m²·a)' }),
  'objekt.energieausweis.art': O('Energieausweis', 'text', { pruef: 'objekt.energieausweis.art', details: 'energieausweis.art' }),
  'objekt.lagebeschreibung': O('Lagebeschreibung', 'text', { pruef: 'objekt.lagebeschreibung', details: 'lagebeschreibung' }),
  'objekt.ausstattung': O('Ausstattung', 'text', { pruef: 'objekt.ausstattung', details: 'ausstattung', liste: true }),
  'objekt.notizen': O('Notizen', 'text', { pruef: 'objekt.notizen', spalte: 'notizen', liste: true }),
  // ── Objekt: Spalte ohne Prüfseitenfeld
  'objekt.sollmiete': O('Soll-Miete je Monat', 'zahl', { spalte: 'sollMiete', einheit: '€' }),
  // ── Objekt: nur details
  'details.objektbeschreibung': O('Objektbeschreibung', 'text', { details: 'objektbeschreibung' }),
  'details.titel': O('Titel (Exposé)', 'text', { details: 'titel' }),
  'details.objektart': O('Objektart', 'text', { details: 'objektart' }),
  'details.nutzungsart': O('Nutzungsart', 'text', { details: 'nutzungsart' }),
  'details.objektnr_extern': O('Objekt-Nr. (Makler)', 'text', { details: 'objektnr_extern' }),
  'details.provision': O('Provision', 'text', { details: 'provision' }),
  'details.kaufpreisfaktor': O('Kaufpreisfaktor (Exposé)', 'zahl', { details: 'kaufpreisfaktor' }),
  'details.hausgeld_monat': O('Hausgeld je Monat', 'zahl', { details: 'hausgeld_monat', einheit: '€' }),
  'details.nebenkosten_monat': O('Nebenkosten je Monat', 'zahl', { details: 'nebenkosten_monat', einheit: '€' }),
  'details.instandhaltungsruecklage': O('Instandhaltungsrücklage', 'zahl', { details: 'instandhaltungsruecklage', einheit: '€' }),
  'details.nutzflaeche': O('Nutzfläche', 'zahl', { details: 'nutzflaeche', einheit: 'm²' }),
  'details.gewerbeflaeche': O('Gewerbefläche', 'zahl', { details: 'gewerbeflaeche', einheit: 'm²' }),
  'details.gewerbeeinheiten': O('Gewerbeeinheiten', 'ganzzahl', { details: 'gewerbeeinheiten' }),
  'details.stellplaetze': O('Stellplätze', 'ganzzahl', { details: 'stellplaetze' }),
  'details.etagen': O('Etagen', 'ganzzahl', { details: 'etagen' }),
  'details.energietraeger': O('Energieträger', 'text', { details: 'energietraeger' }),
  'details.energieausweis.gueltig_bis': O('Energieausweis gültig bis', 'text', { details: 'energieausweis.gueltig_bis' }),
  'details.sanierungen': O('Sanierungen', 'text', { details: 'sanierungen', liste: true }),
  'details.zustand': O('Zustand', 'text', { details: 'zustand' }),
  'details.denkmalschutz': O('Denkmalschutz', 'text', { details: 'denkmalschutz' }),
  'details.erbbaurecht': O('Erbbaurecht', 'text', { details: 'erbbaurecht' }),
  'details.verfuegbar_ab': O('Verfügbar ab', 'text', { details: 'verfuegbar_ab' }),
  'details.gemarkung': O('Grundbuch / Flurstück', 'text', { details: 'gemarkung', liste: true }),
  // ── Makler (Kontakt 1)
  'makler.name': M('Name', { pruef: 'makler.name', spalte: 'name' }),
  'makler.firma': M('Firma', { pruef: 'makler.firma', spalte: 'firma' }),
  'makler.mobiltel': M('Mobil', { pruef: 'makler.mobiltel', spalte: 'mobil' }),
  'makler.festnetztel': M('Festnetz', { pruef: 'makler.festnetztel', spalte: 'festnetz' }),
  'makler.email': M('E-Mail', { pruef: 'makler.email', spalte: 'email' }),
  'makler.webseite': M('Webseite', { pruef: 'makler.webseite', spalte: 'webseite' }),
  'makler.strasse': M('Straße', { spalte: 'strasse' }),
  'makler.plz': M('PLZ', { spalte: 'plz' }),
  'makler.ort': M('Ort', { spalte: 'ort' }),
  'makler.weitereKontakte': M('Weitere Kontakte', { spalte: 'weitereKontakte', liste: true }),
  // ── Kalkulation (nur Prüfseite)
  'kalkulation.kaufpreis': { art: 'kalkulation', label: 'Kaufpreis (Kalkulation)', typ: 'zahl', pruef: 'kalkulation.kaufpreis', einheit: '€' },
  'kalkulation.makler': { art: 'kalkulation', label: 'Maklerprovision % (Kalkulation)', typ: 'zahl', pruef: 'kalkulation.makler', einheit: '%' },
};

export const GG_ZIEL_SCHLUESSEL = Object.keys(GG_ZIELE) as [string, ...string[]];

export const zieleFuer = (art: ZielArt) => Object.entries(GG_ZIELE).filter(([, z]) => z.art === art).map(([schluessel, z]) => ({ schluessel, ...z }));
