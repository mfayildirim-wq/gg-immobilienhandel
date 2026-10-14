/**
 * Rohdaten ohne KI (Protokoll 30, P1): aus dem Dokument (`dokument.ts`) werden im Code die Angaben („Bezeichnung: Wert“,
 * Kopf-/Wertzeilen, Freitext-Abschnitte, Aufzählungen, Kontaktdaten) und die Mietlisten-Tabellen abgeleitet — im Format der
 * Erfassung v2 (`ErfassteAngabe`, `EinheitenTabelle`), damit Zuordnung, Prüfseite und Reiter unverändert bleiben.
 * Bezeichnung → Standard-Pfad über das Wörterbuch `bezeichnungZuPfad`.
 *
 * Grundsätze: Bezeichnung und Wert stehen wörtlich in den Zellen; nichts wird umgerechnet oder gedeutet. Was das Wörterbuch
 * nicht eindeutig kennt, bekommt keinen Pfad (lieber null als falsch). Mieternamen werden nicht übernommen.
 *
 * Ablauf je Seite: Tabellen → Kacheln (Kopfzeile + Wertzeile) → Paare in mehrzelligen Zeilen → „Bezeichnung: Wert“ und
 * „Bezeichnung Wert“ in einzelnen Zellen → Aufzählungen und Freitext-Abschnitte → Kontaktdaten per Muster.
 */
import type { Dokument } from './dokument.ts';
import type { EinheitenTabelle, ErfassteAngabe } from './erfassung.ts';
import { type EinheitFeld, KATALOG } from './katalog.ts';
import { leerraum, zahlAusText } from './normalisieren.ts';
import { istMobilnummer } from './uebernahme.ts';

export interface Rohdaten { angaben: ErfassteAngabe[]; einheiten_tabellen: EinheitenTabelle[]; einheiten_im_dokument: number | null }

// ── Wörterbuch ─────────────────────────────────────────────────

/** Schlüssel einer Bezeichnung: klein, ohne Sonderzeichen, Umlaute und ß vereinheitlicht („Grundstück“ = „Grundstueck“). */
export function bezeichnungSchluessel(s: string): string {
  return leerraum(s).toLowerCase()
    .replace(/[²]/g, '2')
    .replace(/ä|ae/g, 'a').replace(/ö|oe/g, 'o').replace(/ü|ue/g, 'u').replace(/ß|ss/g, 's')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Pfad → Bezeichnungen (Synonyme). `null` als Pfad = bewusst ohne Pfad (mehrdeutig). */
const SYNONYME: [string | null, string[]][] = [
  ['preise.kaufpreis', ['Kaufpreis', 'KP', 'Angebotspreis', 'Preis', 'Verkaufspreis', 'Kaufpreisvorstellung', 'Preisvorstellung', 'Kaufpreis gesamt', 'Gesamtkaufpreis', 'Kaufpreis ca', 'Objektpreis', 'Gesamtpreis']],
  ['preise.kaufpreis_pro_qm', ['Kaufpreis je m2', 'Kaufpreis pro m2', 'Kaufpreis/m2', 'Preis/m2', 'Preis pro m2', 'Preis je m2', 'Quadratmeterpreis', 'Preis je qm', 'Kaufpreis je qm', 'qm-Preis', 'Kaufpreis pro Quadratmeter']],
  ['preise.kaufpreisnetto', ['Kaufpreis netto', 'Nettokaufpreis']],
  ['preise.kaufpreisbrutto', ['Kaufpreis brutto', 'Bruttokaufpreis']],
  ['preise.aussen_courtage', ['Käuferprovision', 'Provision', 'Courtage', 'Maklerprovision', 'Vermittlungsprovision', 'Außenprovision', 'Außencourtage', 'Käufercourtage', 'Provision für Käufer', 'Maklercourtage', 'Käufer-Provision', 'Provision Käufer', 'Käuferprovision inkl. MwSt', 'Provisionssatz']],
  ['preise.innen_courtage', ['Innenprovision', 'Verkäuferprovision', 'Innencourtage', 'Verkäufercourtage']],
  ['preise.courtage_hinweis', ['Provisionshinweis', 'Hinweis Provision', 'Hinweis zur Provision']],
  ['preise.provisionspflichtig', ['Provisionspflichtig']],
  ['preise.hausgeld', ['Hausgeld', 'Hausgeld monatlich', 'Wohngeld']],
  ['preise.nebenkosten', ['Nebenkosten', 'NK', 'Betriebskosten', 'Nebenkosten monatlich', 'Nebenkostenvorauszahlung', 'Nebenkosten-Vorauszahlung']],
  ['preise.heizkosten', ['Heizkosten']],
  ['preise.instandhaltungsruecklage', ['Instandhaltungsrücklage', 'Rücklage', 'Instandhaltungsrückstellung', 'Erhaltungsrücklage']],
  ['preise.kaution', ['Kaution', 'Mietkaution']],
  ['preise.erbpacht', ['Erbpacht', 'Erbbauzins', 'Erbbaurecht', 'Erbbauzins p.a.']],
  ['preise.x_fache', ['Faktor', 'Kaufpreisfaktor', 'x-fache', 'Vervielfältiger', 'Multiplikator', 'Faktor Ist', 'Faktor-Ist', 'Kaufpreisfaktor Ist', 'Ist-Faktor', 'Mietenmultiplikator', 'Jahresmietenfaktor']],
  ['gg.bruttorendite', ['Rendite', 'Bruttorendite', 'Bruttoanfangsrendite', 'Brutto-Anfangsrendite', 'Ist-Rendite', 'Rendite Ist', 'Mietrendite', 'Anfangsrendite', 'Bruttomietrendite', 'Rendite (Ist)', 'Rendite Brutto', 'Bruttorendite Ist', 'Rendite p.a.']],
  ['preise.nettorendite', ['Nettorendite', 'Nettoanfangsrendite']],
  ['preise.nettorendite_ist', ['Nettorendite Ist', 'Nettorendite-Ist']],
  ['preise.nettorendite_soll', ['Nettorendite Soll', 'Nettorendite-Soll']],
  ['flaechen.wohnflaeche', ['Wohnfläche', 'Wfl', 'Gesamtwohnfläche', 'Wohnfläche gesamt', 'Wohnfläche ca', 'Wohnfl', 'Wohnfläche insgesamt', 'Gesamt-Wohnfläche', 'Wohnfläche (ca.)', 'Wohnflaeche', 'Wohnflächen']],
  ['flaechen.nutzflaeche', ['Nutzfläche', 'Nutzfl', 'Nutzfläche gesamt', 'Nutz-/Nebenfläche', 'Nutzfläche ca', 'Nutzflaeche']],
  ['flaechen.gesamtflaeche', ['Gesamtfläche', 'Gesamtflaeche', 'Gesamtfläche ca', 'Gesamtflächen']],
  ['flaechen.vermietbare_flaeche', ['Vermietbare Fläche', 'Mietfläche', 'Vermietbare Gesamtfläche', 'Vermietbare Flaeche', 'Vermietbare Fläche gesamt']],
  ['flaechen.grundstuecksflaeche', ['Grundstück', 'Grundstücksfläche', 'Grundstücksgröße', 'Grundstücksgrösse', 'Grundstücksfl', 'Grundstücksfläche ca', 'Grundstücksflaeche', 'Grundstücksfläche gesamt', 'Fläche Grundstück']],
  ['flaechen.anzahl_wohneinheiten', ['Wohneinheiten', 'WE', 'Anzahl Wohnungen', 'Anzahl Wohneinheiten', 'Wohnungen', 'Anzahl WE', 'Wohneinheiten gesamt', 'Anzahl der Wohneinheiten', 'Anzahl der Wohnungen', 'Wohneinheit', 'Anzahl Wohneinheit']],
  ['flaechen.anzahl_gewerbeeinheiten', ['Gewerbeeinheiten', 'Anzahl Gewerbeeinheiten', 'Gewerbeeinheit', 'Anzahl Gewerbe', 'Anzahl der Gewerbeeinheiten']],
  ['flaechen.anzahl_stellplaetze', ['Stellplätze', 'Garagen', 'Anzahl Garagen', 'TG-Stellplätze', 'Anzahl Stellplätze', 'Stellplatz', 'Tiefgaragenstellplätze', 'Parkplätze', 'Anzahl Parkplätze', 'Garagen/Stellplätze', 'Stellplätze gesamt', 'Garage', 'Tiefgarage', 'PKW-Stellplätze', 'Parkplatz', 'Anzahl Tiefgaragenstellplätze', 'Außenstellplätze', 'Anzahl der Stellplätze', 'Anzahl PKW-Stellplätze', 'Garagenstellplätze', 'Anzahl Stellplatz']],
  ['flaechen.anzahl_zimmer', ['Zimmer', 'Anzahl Zimmer', 'Zimmeranzahl', 'Zi', 'Zimmer gesamt', 'Anzahl der Zimmer']],
  ['flaechen.anzahl_schlafzimmer', ['Schlafzimmer', 'Anzahl Schlafzimmer']],
  ['flaechen.anzahl_badezimmer', ['Badezimmer', 'Anzahl Badezimmer', 'Bäder', 'Anzahl Bäder']],
  ['flaechen.anzahl_balkone', ['Balkone', 'Anzahl Balkone']],
  ['flaechen.anzahl_terrassen', ['Terrassen', 'Anzahl Terrassen']],
  ['geo.anzahl_etagen', ['Etagen', 'Geschosse', 'Anzahl Etagen', 'Anzahl Geschosse', 'Vollgeschosse', 'Stockwerke', 'Anzahl Stockwerke', 'Anzahl der Etagen', 'Anzahl der Geschosse']],
  ['geo.etage', ['Etage', 'Geschoss', 'Stockwerk']],
  ['zustand_angaben.baujahr', ['Baujahr', 'Bj', 'Baujahr ca', 'Baujahr / Fertigstellung', 'Fertigstellung', 'Errichtungsjahr', 'Baujahr Gebäude', 'Erbaut', 'Baujahr des Gebäudes', 'Bauj', 'Baujahr (ca.)', 'Baujahr Haus', 'Baujahr/Fertigstellung', 'Fertigstellung ca']],
  ['gg.heizung_baujahr', ['Baujahr Heizung', 'Bj. Heizung', 'Bj. Wärmeerz.', 'Baujahr Wärmeerzeuger', 'Heizung Baujahr', 'Baujahr Heizungsanlage', 'Baujahr der Heizung', 'Bj Wärmeerzeuger']],
  ['ausstattung.heizungsart', ['Heizung', 'Heizungsart', 'Heizsystem', 'Heizungstyp', 'Beheizung', 'Heizungsanlage']],
  ['ausstattung.unterkellert', ['Unterkellerung', 'Unterkellert', 'Keller', 'Kellergeschoss']],
  ['ausstattung.fenster', ['Fenstertyp', 'Fenster', 'Verglasung']],
  ['ausstattung.dachform', ['Dach', 'Dachform', 'Dachart']],
  ['ausstattung.fahrstuhl', ['Aufzug', 'Fahrstuhl', 'Lift']],
  ['ausstattung.bad', ['Bad', 'Badausstattung']],
  ['ausstattung.kueche', ['Küche', 'Küchenausstattung']],
  ['ausstattung.boden', ['Bodenbelag', 'Boden', 'Fußboden']],
  ['ausstattung.warmwasser', ['Warmwasser', 'Warmwasserbereitung']],
  ['ausstattung.balkon_terrasse', ['Balkon', 'Terrasse', 'Balkon/Terrasse', 'Balkon / Terrasse', 'Balkon / Loggia']],
  ['ausstattung.garten', ['Garten', 'Gartennutzung']],
  ['ausstattung.barrierefrei', ['Barrierefrei', 'Barrierefreiheit']],
  ['ausstattung.rolladen', ['Rollläden', 'Rolladen', 'Rollladen']],
  ['ausstattung.befeuerung', ['Energieträger', 'Befeuerung', 'Hauptenergieträger', 'Energiequelle', 'Befeuerungsart']],
  ['zustand_angaben.energiepass.primaerenergietraeger', ['Wesentlicher Energieträger', 'Wesentliche Energieträger', 'Primärenergieträger']],
  ['zustand_angaben.energiepass.epart', ['Energieausweis Art', 'Energieausweistyp', 'Energieausweisart', 'Art des Energieausweises', 'Energieausweis-Typ', 'Energieausweis Typ', 'Energieausweis-Art']],
  ['zustand_angaben.energiepass.gueltig_bis', ['Energieausweis gültig bis', 'Energieausweis gueltig bis', 'Gültig bis', 'Energieausweis: gültig bis']],
  ['zustand_angaben.energiepass.ausstelldatum', ['Ausstellungsdatum Energieausweis', 'Energieausweis Ausstellungsdatum', 'Energieausweis ausgestellt', 'Energieausweis: Ausstellungsdatum', 'Ausstelldatum Energieausweis', 'Ausstellungsdatum']],
  ['zustand_angaben.energiepass.wertklasse', ['Energieeffizienzklasse', 'Effizienzklasse', 'Energieklasse', 'Energieausweisklasse', 'Energieeffizienz-Klasse', 'Energieeffizienz Klasse', 'Energieausweis Klasse', 'Klasse Energieausweis', 'Energieeffizienzklasse (Energieausweis)']],
  ['zustand_angaben.energiepass.endenergiebedarf', ['Endenergiebedarf', 'Endenergiebedarf Wärme', 'Endenergiebedarf Gebäude']],
  ['zustand_angaben.energiepass.energieverbrauchkennwert', ['Endenergieverbrauch', 'Energiekennwert', 'Energieverbrauch', 'Energieverbrauchskennwert', 'Verbrauchskennwert', 'Energieverbrauchskennwert Wärme', 'Endenergieverbrauchskennwert', 'Energiebedarf', 'Energiekennzahl', 'Energieverbrauch Wärme']],
  ['zustand_angaben.energiepass.primaerenergiebedarf', ['Primärenergiebedarf', 'Primärenergieverbrauch']],
  ['zustand_angaben.energiepass.baujahr', ['Baujahr laut Energieausweis', 'Baujahr Energieausweis', 'Baujahr (Energieausweis)']],
  ['zustand_angaben.energiepass.gebaeudeart', ['Gebäudeart laut Energieausweis', 'Gebäudeart Energieausweis']],
  ['verwaltung_techn.objektnr_extern', ['Objekt-Nr', 'Objektnummer', 'Kennung', 'Objekt-ID', 'Objektnr', 'Exposé-Nr', 'Expose Nr', 'Exposénummer', 'Angebotsnummer', 'Referenznummer', 'Ref-Nr', 'Referenz', 'Objekt ID', 'Ihre Objektnummer', 'Objekt Nr', 'Objekt-Nummer', 'Angebots-Nr', 'Ref.-Nr']],
  ['verwaltung_techn.stand_vom', ['Stand', 'Stand vom', 'Datenstand']],
  ['verwaltung_objekt.verfuegbar_ab', ['Verfügbar ab', 'Bezugsfrei', 'Bezugsfrei ab', 'Verfügbarkeit', 'Frei ab', 'Bezugstermin', 'Übergabe', 'Verfügbar', 'Bezugsfertig ab', 'Bezugsfertig']],
  ['verwaltung_objekt.denkmalgeschuetzt', ['Denkmalschutz', 'Denkmalgeschützt', 'Denkmal']],
  ['verwaltung_objekt.vermietet', ['Vermietet', 'Vermietungsstand', 'Derzeitige Nutzung', 'Aktuelle Nutzung']],
  ['verwaltung_objekt.hausverwaltung', ['Hausverwaltung', 'Verwalter', 'WEG-Verwaltung', 'Verwaltung']],
  ['verwaltung_objekt.teilungserklaerung', ['Teilungserklärung', 'Teilungserklaerung']],
  ['verwaltung_objekt.besichtigung', ['Besichtigung', 'Besichtigungstermin', 'Besichtigungen']],
  ['zustand_angaben.zustand', ['Zustand', 'Objektzustand', 'Bauzustand', 'Gebäudezustand', 'Allgemeinzustand', 'Zustand des Gebäudes', 'Erhaltungszustand']],
  ['zustand_angaben.letztemodernisierung', ['Letzte Modernisierung', 'Letzte Sanierung', 'Modernisierung (Jahr)', 'Jahr der Modernisierung', 'Letzte Renovierung', 'Letzte Modernisierung/Sanierung']],
  ['gg.sanierung', ['Modernisierung', 'Sanierung', 'Modernisierungen', 'Sanierungen', 'Sanierungsmaßnahmen', 'Modernisierungsmaßnahmen', 'Teilsanierung', 'Kernsanierung', 'Modernisierung/Sanierung', 'Sanierung/Modernisierung', 'Modernisierungs- und Sanierungsmaßnahmen', 'Renovierung', 'Durchgeführte Maßnahmen', 'Maßnahmen']],
  ['geo.strasse', ['Adresse', 'Straße', 'Objektadresse', 'Anschrift', 'Objektstandort', 'Straße / Hausnummer', 'Straße und Hausnummer', 'Straße, Hausnummer', 'Straße/Hausnr', 'Objekt-Adresse', 'Lage des Objekts']],
  ['geo.hausnummer', ['Hausnummer', 'Hausnr']],
  ['geo.plz', ['PLZ', 'Postleitzahl', 'PLZ/Ort', 'PLZ, Ort', 'PLZ Ort']],
  ['geo.ort', ['Ort', 'Stadt', 'Gemeinde', 'Ort/Stadt']],
  ['geo.ortsteil', ['Ortsteil', 'Stadtteil']],
  ['geo.bundesland', ['Bundesland']],
  ['geo.land', ['Land']],
  ['objektkategorie.objektart', ['Objektart', 'Objekttyp', 'Art des Objekts', 'Immobilienart', 'Immobilientyp', 'Objektkategorie', 'Art der Immobilie', 'Gebäudetyp', 'Haustyp']],
  ['objektkategorie.nutzungsart', ['Nutzungsart', 'Nutzung', 'Verwendungszweck']],
  ['objektkategorie.vermarktungsart', ['Vermarktungsart', 'Angebotsart']],
  ['kontaktperson.name', ['Ansprechpartner', 'Ihr Ansprechpartner', 'Ansprechperson', 'Kontaktperson', 'Ansprechpartnerin', 'Ihre Ansprechpartnerin', 'Ihr Ansprechpartner vor Ort', 'Nachname', 'Kontakt', 'Ihr Kontakt', 'Ihr Berater', 'Berater']],
  ['kontaktperson.vorname', ['Vorname']],
  ['kontaktperson.anrede', ['Anrede']],
  ['kontaktperson.position', ['Position', 'Funktion']],
  ['kontaktperson.firma', ['Firma', 'Unternehmen', 'Makler', 'Maklerbüro', 'Vermittler']],
  ['anbieter.firma', ['Anbieter']],
  ['kontaktperson.tel_zentrale', ['Telefon', 'Tel', 'Telefonnummer', 'Fon', 'Zentrale', 'Telefon Zentrale', 'Tel.-Nr', 'Phone', 'Telefon (Zentrale)', 'T']],
  ['kontaktperson.tel_durchw', ['Durchwahl', 'Telefon Durchwahl', 'Telefon direkt', 'Direkt', 'Tel. direkt', 'Direktwahl']],
  ['kontaktperson.tel_handy', ['Mobil', 'Mobiltelefon', 'Handy', 'Mobilnummer', 'Mobil-Nr', 'Mobile', 'Mobiltelefon-Nr', 'Telefon mobil', 'M']],
  ['kontaktperson.tel_fax', ['Fax', 'Telefax', 'Fax-Nr', 'Faxnummer']],
  ['kontaktperson.email_direkt', ['E-Mail', 'Email', 'Mail', 'E-Mail-Adresse', 'Email-Adresse', 'E-Mail Adresse', 'Emailadresse']],
  ['kontaktperson.url', ['Web', 'Webseite', 'Internet', 'Homepage', 'URL', 'Website', 'Webadresse', 'Web-Adresse']],
  ['freitexte.objektbeschreibung', ['Objektbeschreibung', 'Beschreibung', 'Objektbeschreibung/Ausstattung', 'Das Objekt', 'Objekt', 'Objektübersicht', 'Objektüberblick', 'Objektinformation']],
  ['freitexte.lage', ['Lage', 'Lagebeschreibung', 'Mikrolage', 'Makrolage', 'Standortbeschreibung', 'Die Lage', 'Standort', 'Lage und Umgebung', 'Lage & Umgebung', 'Lage/Umgebung', 'Umgebung']],
  ['freitexte.ausstatt_beschr', ['Ausstattung', 'Ausstattungsdetails', 'Ausstattungsübersicht', 'Ausstattungsbeschreibung', 'Ausstattungsmerkmale', 'Ausstattung und Zustand', 'Ausstattung & Zustand']],
  ['freitexte.sonstige_angaben', ['Sonstiges', 'Sonstige Angaben', 'Weitere Angaben', 'Hinweise', 'Hinweis', 'Sonstige Hinweise', 'Weitere Informationen', 'Zusätzliche Informationen', 'Wichtige Hinweise']],
  ['freitexte.dreizeiler', ['Kurzbeschreibung', 'Kurzinformation', 'Kurzexposé']],
  ['freitexte.objekttitel', ['Objekttitel']],
  ['anbieter.impressum', ['Impressum']],
  [null, ['Flur', 'Titel', 'Name', 'Mieter', 'Datum', 'Seite', 'Kategorie', 'Einheiten', 'Gesamteinheiten', 'Anzahl Einheiten', 'Gewerbefläche', 'Gewerbeflächen', 'Gewerbe', 'Preise', 'Flächen', 'Details', 'Miete', 'Mieteinnahmen Soll', 'Soll-Rendite', 'Rendite Soll']],
];

const WOERTERBUCH: Map<string, string | null> = (() => {
  const m = new Map<string, string | null>();
  for (const [pfad, namen] of SYNONYME) for (const n of namen) { const k = bezeichnungSchluessel(n); if (k && !m.has(k)) m.set(k, pfad); }
  // Katalog-Bezeichnungen, soweit nicht oben belegt (mehrdeutige Kurzwörter sind oben ausdrücklich auf null gesetzt)
  for (const [pfad, e] of Object.entries(KATALOG)) { const k = bezeichnungSchluessel(e.label); if (k && !m.has(k)) m.set(k, pfad); }
  return m;
})();

/** Alle Schlüssel des Wörterbuchs (auch die bewusst pfadlosen). */
const KATALOG_SCHLUESSEL = new Set(WOERTERBUCH.keys());
/** Zu allgemeine Wörter: als Bezeichnung nur mit Doppelpunkt oder in Tabellenzeilen, nicht im laufenden Text. */
const ZU_ALLGEMEIN = new Set(['titel', 'name', 'datum', 'seite', 'kategorie', 'preise', 'flachen', 'details', 'miete', 'objekt', 'lage', 'gewerbe', 'wohnungen', 'we', 'zi', 't', 'm', 'land', 'ort', 'mail', 'web', 'tel', 'fon', 'direkt', 'zentrale', 'bezug', 'kontakt', 'berater', 'verwaltung', 'maßnahmen', 'masnahmen', 'umgebung', 'verfugbar', 'beschreibung', 'hinweis', 'hinweise', 'sonstiges']);
/** Bekannte Bezeichnung (auch ohne Pfad), geeignet für „Bezeichnung Wert“ ohne Trenner. */
const bekanntFuerText = (bez: string) => { const k = bezeichnungSchluessel(bez); return !!k && !ZU_ALLGEMEIN.has(k) && (WOERTERBUCH.has(k) || kandidaten(bez).some((c) => WOERTERBUCH.has(c) && !ZU_ALLGEMEIN.has(c))); };

/** Perioden-Hinweis in Bezeichnung oder Wert („p.a.“, „pro Jahr“ → 'jahr'; „/ Monat“, „mtl.“ → 'monat'). */
function periode(text: string): 'jahr' | 'monat' | null {
  const t = leerraum(text).toLowerCase();
  if (/p\.\s?a\.|\bp\s?a\b|pro jahr|\/\s?jahr|im jahr|jahres|jahrlich|jährlich|per annum|\bjnkm\b|\bjahr\b/.test(t)) return 'jahr';
  if (/pro monat|\/\s?monat|monatlich|\bmtl|im monat|\bmonat\b|\bmonats/.test(t)) return 'monat';
  return null;
}

/** Zeitraum einer Bezeichnung (z. B. Spaltenüberschrift einer Mietliste) — für die Zuordnung: Jahreswerte ÷ 12. */
export const zeitraum = periode;

/** Miet-Bezeichnungen (Ist/Soll, Monat/Jahr) — nur aus Wortlaut von Bezeichnung und Wert. */
function mietPfad(n: string, bez: string, wert: string | undefined): string | null | undefined {
  if (/(je|pro|\/) ?(m2|qm)|m2 ?preis|\bm2\b/.test(n)) return undefined;
  if (/einheit|wohnung|zimmer|beginn|ende|vertrag|flache|sicherheit|steigerung|potenzial|rendite|faktor|kaution|erhohung|garage|stellpl/.test(n)) return undefined;
  const soll = /\bsoll\b|sollmiete|marktmiete|erzielbare|potenzial/.test(n) || /\bsoll/.test(n);
  const ist = /\bist\b|istmiete/.test(n);
  const miete = n.split(' ').some((t) => /miete$|^mieteinnahmen|^mietertrag|^jnkm$|^mieten$|^mieteinkunfte/.test(t));
  if (!miete) return undefined;
  const jahr = periode(bez) === 'jahr' || /jahresnettokaltmiete|jahresmiete|jahresnettomiete|\bjnkm\b|jahreskaltmiete/.test(n) ? 'jahr' : periode(bez) === 'monat' ? 'monat' : wert ? periode(wert) : null;
  const art = soll ? 'soll' : 'ist';
  // „Kaltmiete“/„Nettokaltmiete“ ohne Zeitangabe und ohne Ist/Soll: eigener Pfad ohne Zuordnung statt Raten
  if (!jahr && !soll && !ist && /^(netto ?)?(kalt ?)?miete$|^nettokaltmiete$|^kaltmiete$|^netto kaltmiete$|^nettomiete$/.test(n)) {
    return /kalt/.test(n) ? (/netto/.test(n) ? 'preise.nettokaltmiete' : 'preise.kaltmiete') : null;
  }
  if (!jahr && !soll && !ist && n === 'mieteinnahmen') return 'preise.mieteinnahmen_ist_monat';
  if (!soll && !ist && !/mieteinnahmen|jnkm|jahres/.test(n) && !jahr) return null;
  return `preise.mieteinnahmen_${art}_${jahr ?? 'monat'}`;
}

/** Kandidaten-Schlüssel einer Bezeichnung: zuerst wörtlich, dann ohne Zusätze („ca“, „gesamt“, Einheit, Zeitangabe, Klammer-Zusatz). */
function kandidaten(bez: string): string[] {
  const aus: string[] = [];
  const neu = (k: string) => { const t = k.replace(/\s+/g, ' ').trim(); if (t && !aus.includes(t)) aus.push(t); };
  const voll = bezeichnungSchluessel(bez.replace(/\*+$/, ''));
  neu(voll);
  // Klammer nur entfernen, wenn sie Einheit/Näherung/Zeitangabe ist („(ca.)“, „(in m²)“, „(p.a.)“) — „(Soll)“ bleibt
  const ohneKlammer = bez.replace(/\(\s*(?:ca\.?|circa|in\s[^)]*|m²|m2|qm|€|eur|p\.?\s?a\.?|jahr|monat|pro\s[^)]*|gesamt|insgesamt|lt\.[^)]*|laut[^)]*|\/\s?[^)]*)\)/gi, ' ');
  neu(bezeichnungSchluessel(ohneKlammer));
  const grund = bezeichnungSchluessel(ohneKlammer);
  const ohne = (re: RegExp) => grund.replace(re, ' ');
  neu(ohne(/\b(ca|circa|insgesamt|gesamt|rund|rd)\b/g));
  neu(ohne(/\b(ca|circa|insgesamt|gesamt|rund|rd|in m2|in eur|pro monat|pro jahr|monat|jahr|p a|pa|mtl|monatlich|jahrlich)\b/g));
  neu(ohne(/\blaut\b.*$/));
  neu(bezeichnungSchluessel(bez.replace(/\/.*$/, '')));
  return aus;
}

/** Bezeichnung (und optional der Wert für Zeitangaben) → Standard-Pfad (Wörterbuch), sonst null. */
export function bezeichnungZuPfad(bezeichnung: string, wert?: string): string | null {
  const cand = kandidaten(bezeichnung);
  const basis = cand[0] ?? '';
  if (!basis) return null;
  // Energieausweis & Co. sind mehrdeutig, wenn nur das Stichwort da steht: Wert entscheidet
  if (basis === 'energieausweis') {
    const w = leerraum(wert ?? '');
    if (/^[A-H]\+?$/.test(w)) return 'zustand_angaben.energiepass.wertklasse';
    if (/bedarf|verbrauch/i.test(w)) return 'zustand_angaben.energiepass.epart';
    if (/^\d{2}\.\d{2}\.\d{4}$/.test(w)) return 'zustand_angaben.energiepass.gueltig_bis';
    return null;
  }
  // Mieten: Ist/Soll und Monat/Jahr am Wortlaut
  for (const k of [basis, ...cand]) {
    const m = mietPfad(k, bezeichnung, wert);
    if (m !== undefined) return m;
  }
  // Rendite / Faktor mit Soll/Netto
  if (/rendite/.test(basis)) {
    if (/\bsoll\b/.test(basis)) return basis.includes('netto') ? 'preise.nettorendite_soll' : null;
    if (/netto/.test(basis)) return /\bist\b/.test(basis) ? 'preise.nettorendite_ist' : 'preise.nettorendite';
    if (/eigenkapital|ek |cash|\bauf\b|bei\b|potenzial/.test(basis)) return null;
  }
  if (/faktor|x fache/.test(basis) && /\bsoll\b/.test(basis)) return null;
  for (const k of cand) { const p = WOERTERBUCH.get(k); if (p !== undefined) return p; }
  return null;
}

// ── Erkennungshilfen ───────────────────────────────────────────

const hatZiffer = (s: string) => /\d/.test(s);
const buchstaben = (s: string) => (s.match(/[A-Za-zÄÖÜäöüß]/g) ?? []).length;
const woerter = (s: string) => s.split(/\s+/).filter(Boolean);
const GROSS = (s: string) => { const b = s.replace(/[^A-Za-zÄÖÜäöüß]/g, ''); return b.length >= 3 && b === b.toUpperCase(); };
const SATZENDE = /[.!?:;]$/;
const BULLET = /^\s*(?:[•·▪▫●○◦■□►▶➤✓✔–—*]|-(?=\s))\s*/;

/** Bezeichnungsartig: kurz, beginnt mit Buchstaben, kein Satz, kein Betrag. */
function labelartig(s0: string): boolean {
  const s = leerraum(s0).replace(/:$/, '').trim();
  if (s.length < 2 || s.length > 48) return false;
  if (!/^[A-Za-zÄÖÜäöüß]/.test(s)) return false;
  if (buchstaben(s) < 2) return false;
  if (/[€%]/.test(s) || /\d[.,]\d/.test(s)) return false;
  if (/:\s*\S/.test(s)) return false;
  if (woerter(s).length > 7) return false;
  if (/[.!?]\s+[A-ZÄÖÜ]/.test(s)) return false;
  if (/[.;]$/.test(s) && !/(\b\w{1,4}\.)$/.test(s)) return false;
  if (/@|https?:|www\./i.test(s)) return false;
  if (ANSCHRIFT.test(s) || /\b\d{5}\b/.test(s)) return false;
  if (/\s\d+\s?[a-z]?$/.test(s) && !KATALOG_SCHLUESSEL.has(bezeichnungSchluessel(s))) return false;
  return true;
}

/** Wertartig: enthält eine Ziffer oder ein typisches Kurzwort. */
const wertartig = (s: string) => hatZiffer(s) || /^(ja|nein|vorhanden|nicht vorhanden|keine?|auf anfrage|k\. ?a\.)\b/i.test(s.trim());

const ANSCHRIFT = /(str\.?|straße|strasse|weg|platz|allee|gasse|ring|damm|ufer|steige|hof|markt|chaussee|pfad|promenade|graben|anger|stieg|zeile|park)\s?\d+/i;
const adresseartig = (s: string) => /\b\d{5}\s+[A-ZÄÖÜ]/.test(s) || ANSCHRIFT.test(s);
const nameartig = (s: string) => {
  const t = leerraum(s);
  const w = woerter(t);
  return w.length >= 2 && w.length <= 5 && !hatZiffer(t) && !/[:@]/.test(t) && w.every((x) => /^(?:[A-ZÄÖÜ][\p{L}'’.-]*|von|van|de|zu|der|dem|Dr\.?|Prof\.?)$/u.test(x)) && t.length <= 50;
};

/** Passt der Wert zum Pfad? Sonst fällt der Pfad weg (lieber null als falsch). */
function wertPasst(pfad: string, wert: string): string | null {
  const w = leerraum(wert);
  const typ = KATALOG[pfad]?.typ;
  if (pfad === 'geo.strasse') return adresseartig(w) ? pfad : null;
  if (pfad === 'geo.plz') return /\b\d{5}\b/.test(w) ? pfad : null;
  if (pfad === 'geo.ort') return !hatZiffer(w) && w.length <= 40 ? pfad : null;
  if (pfad === 'geo.land' || pfad === 'geo.bundesland' || pfad === 'geo.ortsteil') return !hatZiffer(w) && w.length <= 40 ? pfad : null;
  if (pfad === 'kontaktperson.name') return nameartig(w) ? pfad : null;
  if (pfad === 'kontaktperson.vorname') return w.length <= 30 && !hatZiffer(w) ? pfad : null;
  if (pfad === 'kontaktperson.firma' || pfad === 'anbieter.firma') return w.length <= 80 && !/@/.test(w) ? pfad : null;
  if (pfad.startsWith('kontaktperson.tel')) return (w.match(/\d/g) ?? []).length >= 6 ? (pfad === 'kontaktperson.tel_zentrale' && istMobilnummer(w) ? 'kontaktperson.tel_handy' : pfad) : null;
  if (pfad.startsWith('kontaktperson.email')) return /@/.test(w) ? pfad : null;
  if (pfad === 'kontaktperson.url') return /\.|www|http/i.test(w) ? pfad : null;
  if (pfad === 'preise.mieteinnahmen_ist_monat' || pfad.startsWith('preise.mieteinnahmen') || pfad.startsWith('preise.kaltmiete') || pfad === 'preise.nettokaltmiete') return /\d/.test(w) && w.length <= 60 ? pfad : null;
  if (typ === 'zahl' || typ === 'ganzzahl' || typ === 'jahr' || typ === 'datum') {
    // Einheit des Werts muss zum Pfad passen („Wohnungen“ mit „68.800 € p.a.“ ist keine Anzahl)
    const einheit = KATALOG[pfad]?.einheit;
    if (typ === 'ganzzahl' || typ === 'jahr' || pfad === 'preise.x_fache' || einheit === 'Stück') { if (/€|eur\b|%|m²|m2|\bqm\b|kwh/i.test(w)) return null; }
    else if (einheit === '€') { if (/%|m²|m2|\bqm\b|kwh/i.test(w)) return null; }
    else if (einheit === '%') { if (/€|eur\b|m²|m2|\bqm\b|kwh/i.test(w)) return null; }
    else if (einheit === 'm²') { if (/€|eur\b|%|kwh/i.test(w)) return null; }
    if ((typ === 'zahl' || typ === 'ganzzahl') && hatZiffer(w) && !/^\D{0,6}\d/.test(w)) return null;
    if (typ === 'jahr' && !/\b(1[7-9]\d\d|20\d\d)\b/.test(w)) return null;
    if (!hatZiffer(w)) {
      // Ersatz für Zahlenpfade, wenn ein Text (z. B. „vorhanden“, „Tiefgarage“) da steht
      const ersatz: Record<string, string> = {
        'flaechen.anzahl_balkone': 'ausstattung.balkon_terrasse', 'flaechen.anzahl_terrassen': 'ausstattung.balkon_terrasse',
        'flaechen.anzahl_stellplaetze': 'ausstattung.stellplatzart',
      };
      return ersatz[pfad] ?? null;
    }
    if (w.length > 80) return null;
    return pfad;
  }
  if (pfad === 'verwaltung_objekt.verfuegbar_ab' || pfad === 'verwaltung_techn.stand_vom') return w.length <= 60 ? pfad : null;
  return pfad;
}

/** Pfad für eine Angabe: Wörterbuch + Plausibilität des Werts. Adresse unter „Lage“/„Standort“ erkennt man am Wert. */
function pfadFuer(bez: string, wert: string): string | null {
  const b = bezeichnungSchluessel(bez);
  let p = bezeichnungZuPfad(bez, wert);
  if ((b === 'lage' || b === 'standort' || b === 'objekt' || b === 'objekt adresse') && adresseartig(wert) && wert.length <= 120) p = 'geo.strasse';
  else if (b === 'standort' && p === 'freitexte.lage' && wert.length <= 40 && !hatZiffer(wert)) p = 'geo.ort';
  else if (b === 'objekt' && p === 'freitexte.objektbeschreibung' && wert.length < 150) p = null;
  if (!p && /^(ca\.?\s*)?\d[\d.,]*\s?(km|min\.?|minuten|gehminuten|fußminuten|fahrminuten|m(?![²2³\w]))/i.test(wert.trim()) && wert.length <= 40 && labelartig(bez) && !KATALOG_SCHLUESSEL.has(b) && !/flache|flaeche|fläche|wohnen|gewerbe|nutz|grund/i.test(bez)) p = 'infrastruktur.distanz';
  if (!p) return null;
  return wertPasst(p, wert);
}

// ── Zeilen einer Seite ─────────────────────────────────────────

interface Zl { c: string[]; used: boolean; o: number }

/** Seite säubern: Leerzellen weg, Aufzählungszeichen als eigene Zelle an den Text, bei Bild-Seiten Rauschen weg. */
function zeilenVon(zeilen: string[][], bild: boolean): Zl[] {
  const aus: Zl[] = [];
  zeilen.forEach((z, i) => {
    let c = z.map((x) => leerraum(x)).filter(Boolean);
    if (bild) c = c.filter((x) => /[A-Za-zÄÖÜäöüß0-9]{2,}/.test(x) && (x.match(/[A-Za-zÄÖÜäöüß0-9\s.,:;€%²/()-]/g) ?? []).length / x.length >= 0.7);
    if (c.length >= 2 && /^[•·▪●○◦■►▶➤✓✔–—*-]$/.test(c[0]!)) c = [`${c[0]} ${c[1]}`, ...c.slice(2)];
    if (c.length) aus.push({ c, used: false, o: i });
  });
  return spaltenEntflechten(aus);
}

/**
 * Zweispaltiger Fließtext: aufeinanderfolgende Zeilen mit zwei langen Textzellen sind links/rechts nebeneinander gesetzt.
 * Gelesen wird erst die linke, dann die rechte Spalte (die Seite kennt keine Positionen, nur die Reihenfolge).
 */
function spaltenEntflechten(zl: Zl[]): Zl[] {
  const zweispaltig = (l: Zl) => l.c.length === 2 && l.c[0]!.length >= 28 && l.c[1]!.length >= 28 && !labelartig(l.c[0]!);
  const aus: Zl[] = [];
  for (let i = 0; i < zl.length; i++) {
    let j = i;
    while (j < zl.length && zweispaltig(zl[j]!)) j++;
    if (j - i >= 2) {
      const lauf = zl.slice(i, j);
      for (const l of lauf) aus.push({ c: [l.c[0]!], used: false, o: l.o });
      lauf.forEach((l, k) => aus.push({ c: [l.c[1]!], used: false, o: lauf[lauf.length - 1]!.o + 0.001 * (k + 1) }));
      i = j - 1;
    } else aus.push(zl[i]!);
  }
  return aus;
}

// ── Mietlisten-Tabellen ────────────────────────────────────────

const SUMME = /^(summe|gesamt|total|σ|insgesamt|∑)/i;
// Mieterspalten (Datenschutz, Protokoll 28 §2): auch zusammengesetzt („Gewerbemieter“, „Hauptmieter“); „Mietbeginn/-ende“ prüft der Aufrufer
const MIETER = /^(mieter|mietername|mieterin|name|vorname|nachname|bewohner|nutzer|mietpartei|inhaber)( |$)|^[a-z]+mieter(in|name)?( |$)/;

type FeldOderMieter = EinheitFeld | 'mieter' | null;

/** Spaltenüberschrift → Feld der Einheit (Erkennungshilfen wie im Prompt der Vollerfassung). */
export function spaltenFeld(ueberschrift: string): FeldOderMieter {
  const n = bezeichnungSchluessel(ueberschrift);
  if (!n) return null;
  if (MIETER.test(n) && !/mietbeginn|mietende/.test(n)) return 'mieter';
  if (/(je|pro|\/) ?(m2|qm)|^soll je|^ist je/.test(n)) return null;
  if (/warmmiete|bruttomiete|bruttokaltmiete|\bbkm\b|inklusivmiete|gesamtmiete|\bbrutto\b|\bwarm\b|miete inkl/.test(n)) return 'warmmiete';
  if (/\bsoll\b|sollmiete|erzielbar|marktmiete|marktubliche/.test(n)) return 'sollmiete';
  if (/^nk\b|nebenkost|betriebskost|^bk\b|\bbk\b|heizkost|vorauszahl|umlage/.test(n)) return 'nebenkosten';
  if (/mietende|befristet|mietvertrag bis|ablauf|^bis\b/.test(n)) return 'mietende';
  if (/mietbeginn|mietvertrag (vom|seit)|^seit\b|vermietet seit|einzug|mietverhaltnis seit|^beginn/.test(n)) return 'mietbeginn';
  if (/mietvertrag|mietverhaltnis|laufzeit/.test(n)) return null;
  if (/^status|vermietet|leerstand|vermietung|belegung|belegt/.test(n)) return 'status';
  if (/flache|\bm2\b|\bqm\b|wfl|^wf\b|nutzfl|wohnfl|\bgrose\b/.test(n)) return 'flaeche';
  if (/kaltmiete|\bnkm\b|netto ?kalt|\bkalt\b|^km\b|nettomiete|^netto\b|miete|mietzins|mietpreis|^ist$/.test(n)) return 'kaltmiete';
  if (/^zi\b|\bzi$|zimmer|zkb|raume|\brooms?\b/.test(n)) return 'zimmer';
  if (/\blage\b|etage|geschos|^og\b|^eg\b|^dg\b|stockwerk|ebene/.test(n)) return 'lage';
  if (/^art\b|\bart$|\btyp\b|nutzung|kategorie/.test(n)) return 'typ';
  if (/^nr\b|\bnr$|\bnr\b|whg|^we$|^we\b|einheit|^wohnung\b|^id$|^pos\b|position|lfd/.test(n)) return 'nr';
  return null;
}

const KOPF_TERME = new Set<FeldOderMieter>(['nr', 'typ', 'lage', 'zimmer', 'flaeche', 'kaltmiete', 'nebenkosten', 'warmmiete', 'sollmiete', 'status', 'mietbeginn', 'mietende']);

/** Kopfzeile einer Mietliste? Mindestens zwei Einheiten-Begriffe, sonst nur kurze Textzellen. */
function kopfPruefen(c: string[]): FeldOderMieter[] | null {
  if (c.length < 3) return null;
  if (c.some((x) => x.length > 45 || /\d[.,]\d|€/.test(x) || /^\d+$/.test(x))) return null;
  const f = c.map(spaltenFeld);
  const treffer = new Set(f.filter((x) => x && KOPF_TERME.has(x)));
  if (treffer.size < 2) return null;
  if (treffer.size < 3 && !(treffer.has('flaeche') || treffer.has('kaltmiete') || treffer.has('warmmiete') || treffer.has('sollmiete'))) return null;
  return f;
}

const reDatum = /\d{1,2}\.\d{1,2}\.\d{2,4}/;
const reFlaeche = /\d\s?(?:m²|m2|qm)(?![A-Za-z0-9])/i;
const reEuro = /€|\beur\b/i;
const reZimmer = /\b\d+(?:[.,]5)?\s*(zi|zimmer|zkb|räume?)\b\.?/i;

/** Wie gut passt eine Zelle zu einer Spalte (für Zeilen mit fehlenden Zellen)? */
function passt(zelle: string, feld: string | null): number {
  const z = zelle.trim();
  const zahl = /^[-+]?\d[\d.,]*\s*(?:€|eur|m²|m2|qm)?$/i.test(z);
  switch (feld) {
    case 'flaeche': return reFlaeche.test(z) ? 3 : zahl ? 1 : -3;
    case 'kaltmiete': case 'nebenkosten': case 'warmmiete': case 'sollmiete':
      return reEuro.test(z) ? 3 : zahl ? 1 : /^(leer|frei|[-–—]|leerstand)$/i.test(z) ? 1 : -3;
    case 'zimmer': return reZimmer.test(z) ? 2 : /^\d+(?:[.,]5)?$/.test(z) ? 1 : -2;
    case 'mietbeginn': case 'mietende': return reDatum.test(z) ? 3 : /unbefristet|befristet/i.test(z) ? 2 : -2;
    case 'status': return /[A-Za-zÄÖÜäöüß]{3}/.test(z) && !reDatum.test(z) && !zahl ? 1 : -2;
    case 'lage': return /\b(eg|og|dg|ug|gg|geschoss|etage|links|rechts|mitte)\b/i.test(z) ? 3 : zahl ? -1 : 1;
    case 'nr': return zahl ? 1 : /^[A-Za-z]{0,3}\s?\d+/.test(z) ? 1 : 0;
    case 'typ': return zahl ? -2 : 1;
    case 'zahl': return reEuro.test(z) ? 2 : zahl ? 2 : /^(leer|frei|[-–—])$/i.test(z) ? 0 : -3;
    case 'datum': return reDatum.test(z) ? 3 : /unbefristet|befristet|laufend/i.test(z) ? 3 : -3;
    case 'text': return zahl ? -1 : 1;
    default: return 0;
  }
}

/** Zellen einer zu kurzen Zeile den Spalten in Reihenfolge zuordnen (beste Gesamtpassung); leere Spalten bleiben „“. */
function ausrichten(zellen: string[], felder: (string | null)[]): string[] {
  const n = felder.length, m = zellen.length;
  if (m >= n) return zellen.slice(0, n);
  const NEG = -1e9;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(NEG));
  const nimmt: boolean[][] = Array.from({ length: m + 1 }, () => new Array<boolean>(n + 1).fill(false));
  for (let j = 0; j <= n; j++) dp[0]![j] = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = i; j <= n; j++) {
      const skip = dp[i]![j - 1]!;
      const take = dp[i - 1]![j - 1]! + passt(zellen[i - 1]!, felder[j - 1]!);
      if (take >= skip) { dp[i]![j] = take; nimmt[i]![j] = true; } else dp[i]![j] = skip;
    }
  }
  const aus = new Array<string>(n).fill('');
  let i = m, j = n;
  while (i > 0 && j > 0) {
    if (nimmt[i]![j]) { aus[j - 1] = zellen[i - 1]!; i--; j--; } else j--;
  }
  return aus;
}

/** Zelle mit mehreren Werten („3 Zi · 75 m²“) in Teile zerlegen, wenn jeder Teil eindeutig Zimmer/Fläche/Typ ist. */
const TEIL_TRENNER = /\s*[·•|‖]\s*|\s{2,}|\s+\/\s+/;
type TeilArt = 'typ' | 'zimmer' | 'flaeche';
function teilArt(t: string): TeilArt | null {
  if (reFlaeche.test(t)) return 'flaeche';
  if (reZimmer.test(t)) return 'zimmer';
  if (/^(\d+\s*)?(whg|wohnung|gewerbe|büro|laden|stellpl|garage|praxis|lager|apartment|studio|einheit)/i.test(t)) return 'typ';
  return null;
}
function zellenTeilen(zellen: string[]): { art: TeilArt; werte: string[] }[] | null {
  const nichtLeer = zellen.filter(Boolean);
  if (nichtLeer.length < 1) return null;
  const teile = zellen.map((z) => (z ? z.split(TEIL_TRENNER).filter(Boolean) : []));
  const gesamt = teile.filter((t) => t.length >= 2).length;
  if (gesamt < Math.max(1, Math.ceil(nichtLeer.length * 0.6))) return null;
  const arten: TeilArt[] = [];
  const zuordnung: (Partial<Record<TeilArt, string>>)[] = [];
  for (const t of teile) {
    const z: Partial<Record<TeilArt, string>> = {};
    for (const p of t) {
      const a = teilArt(p);
      if (!a || z[a]) return null;
      z[a] = p;
    }
    zuordnung.push(z);
    for (const a of Object.keys(z) as TeilArt[]) if (!arten.includes(a)) arten.push(a);
  }
  if (arten.length < 2) return null;
  const reihenfolge: TeilArt[] = (['typ', 'zimmer', 'flaeche'] as const).filter((a) => arten.includes(a));
  return reihenfolge.map((a) => ({ art: a, werte: zuordnung.map((z) => z[a] ?? '') }));
}

const TEILFELD: Record<TeilArt, EinheitFeld> = { typ: 'typ', zimmer: 'zimmer', flaeche: 'flaeche' };
const TEILNAME: Record<TeilArt, string> = { typ: 'Typ', zimmer: 'Zimmer', flaeche: 'Fläche' };

/** Untertitel-Zeile unter der Kopfzeile („in m2“, „IST“, „SOLL“ …): nur kurze Textzellen ohne Beträge. */
function unterkopf(c: string[]): boolean {
  return c.length >= 2 && c.every((x) => x.length <= 28 && !/\d[.,]\d{2}\b|€\s?\d|\d\s?€/.test(x)) && !c.some((x) => SUMME.test(x)) && c.filter((x) => /^[A-Za-zÄÖÜäöüß]/.test(x) || /^\d{1,2}\s?%$|^\d$/.test(x)).length >= c.length - 1;
}

function tabelleAusKopf(seite: number, zl: Zl[], i: number, kopf: FeldOderMieter[]): { tabelle: EinheitenTabelle; verbraucht: Zl[] } | null {
  const kopfZeile = zl[i]!;
  let namen = [...kopfZeile.c];
  let felder: FeldOderMieter[] = [...kopf];
  const verbraucht: Zl[] = [kopfZeile];
  let j = i + 1;
  const unter: string[][] = [];
  while (j < zl.length && unter.length < 2 && !zl[j]!.used && unterkopf(zl[j]!.c) && zl[j]!.c.length >= 2) { unter.push(zl[j]!.c); j++; }
  // Datenzeilen sammeln
  const rows: { c: string[]; z: Zl; summe: boolean; freigabe?: boolean }[] = [];
  let luecke = 0;
  let k = j;
  const n0 = felder.length;
  while (k < zl.length) {
    const l = zl[k]!;
    if (l.used) break;
    const c = l.c;
    const summe = c.length >= 2 && c.slice(0, 2).some((x) => SUMME.test(x.trim()));
    // Nach einer Lücke nur weiter, wenn die Zeile klar wie eine Einheit aussieht (m² oder €, passende Spaltenzahl);
    // Kontaktzeilen (E-Mail) beenden die Tabelle — sonst wird ein Ansprechpartner zur Einheit
    const kontaktZeile = c.some((x) => x.includes('@'));
    const einheitArtig = c.some((x) => /m2|m²|qm|€|eur\b/i.test(x)) && Math.abs(c.length - n0) <= 1;
    const ok = !kontaktZeile && (summe || (c.length >= 3 && c.length >= n0 - 4 && c.length <= n0 + 3 && (c.some(hatZiffer) || c.some((x) => /leer|vermietet|frei/i.test(x))) && (luecke === 0 || einheitArtig)));
    if (ok) { rows.push({ c, z: l, summe }); luecke = 0; }
    else if (c.length === 1 && luecke < 2) luecke++;
    else break;
    k++;
  }
  const daten = rows.filter((r) => !r.summe);
  if (daten.length < (new Set(felder.filter(Boolean)).size >= 3 ? 1 : 2)) return null;
  // Kopf mit Untertiteln auf die Spaltenzahl der Daten bringen
  const modus = (() => {
    const z = new Map<number, number>(); for (const r of daten) z.set(r.c.length, (z.get(r.c.length) ?? 0) + 1);
    return [...z.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]![0];
  })();
  if (unter.length && modus > n0) {
    const sub = unter.flat().filter((x) => !/^\d{1,2}\s?%$|^\d$/.test(x));
    const eigene = new Set(felder.filter(Boolean));
    // Unterspalten, die nur eine Spalte der Kopfzeile näher beschreiben („in m2“), zählen nicht zusätzlich
    const echt = sub.filter((x) => { const f = spaltenFeld(x); return !(f && eigene.has(f) && f !== 'kaltmiete' && f !== 'nebenkosten') && !/^in\s/i.test(x); });
    const zusatz = modus - n0;
    for (let laenge = 1; laenge <= 3; laenge++) {
      if (echt.length - laenge !== zusatz) continue;
      // zusammenhängende Gruppe von Kopfzellen, die durch die Unterspalten ersetzt wird (keine Lage-/Typ-/Flächenspalte)
      for (let start = 0; start + laenge <= n0; start++) {
        const grp = felder.slice(start, start + laenge);
        if (grp.some((f) => f && ['nr', 'typ', 'lage', 'flaeche', 'zimmer', 'mietbeginn', 'status'].includes(f))) continue;
        if (/adresse|strasse/i.test(bezeichnungSchluessel(namen.slice(start, start + laenge).join(' ')))) continue;
        // „IST“ unter einer Mietspalte ist die Ist-Kaltmiete
        const neueFelder = echt.map((x): FeldOderMieter => spaltenFeld(x) ?? (bezeichnungSchluessel(x) === 'ist' ? 'kaltmiete' : null));
        namen = [...namen.slice(0, start), ...echt, ...namen.slice(start + laenge)];
        felder = [...felder.slice(0, start), ...neueFelder, ...felder.slice(start + laenge)];
        start = n0;
        laenge = 9;
      }
    }
    for (let q = i + 1; q < j; q++) verbraucht.push(zl[q]!);
  } else if (unter.length) {
    for (let q = i + 1; q < j; q++) verbraucht.push(zl[q]!);
  }
  const n = felder.length;
  // Spaltenart für die Ausrichtung: Feld, sonst aus der Überschrift (Zahl, Datum, Text)
  const arten = felder.map((f, ci) => {
    if (f) return f;
    const t = bezeichnungSchluessel(namen[ci] ?? '');
    return /beginn|datum|seit|vom|laufzeit|befrist|ende|bis/.test(t) ? 'datum' : /m2|eur|euro|miete|kosten|ust|betrag|preis|\bje\b|pro|rendite|faktor/.test(t) ? 'zahl' : 'text';
  });
  // Zeilen ausrichten; eine Summenzeile mit fremder erster Zelle (Nachbarspalte) gibt diese Zelle frei
  const zeilenAusgerichtet = rows.map((r) => {
    let c = r.c;
    if (r.summe) {
      if (c.length === n + 1 && SUMME.test(c[1]!.trim())) { r.z.c = [c[0]!]; c = c.slice(1); r.freigabe = true; }
      return c.length >= n ? c.slice(0, n) : [...c, ...new Array<string>(n - c.length).fill('')];
    }
    return c.length >= n ? c.slice(0, n) : ausrichten(c, arten);
  });
  for (const r of rows) if (!r.freigabe) verbraucht.push(r.z);
  // Spalten bilden; Mieterspalte entfällt
  let spalten: { ueberschrift: string; feld: EinheitFeld | null }[] = [];
  let zeilen: string[][] = zeilenAusgerichtet.map((r) => [...r]);
  const behalten = felder.map((f) => f !== 'mieter');
  spalten = namen.slice(0, n).map((u, ci) => ({ ueberschrift: u, feld: felder[ci] && felder[ci] !== 'mieter' ? felder[ci] as EinheitFeld : null })).filter((_, ci) => behalten[ci]);
  zeilen = zeilen.map((r) => r.filter((_, ci) => behalten[ci]));
  // Doppelte Felder: nur die erste Spalte behält das Feld
  const gesehen = new Set<string>();
  spalten = spalten.map((s) => { if (s.feld && gesehen.has(s.feld)) return { ...s, feld: null }; if (s.feld) gesehen.add(s.feld); return s; });
  // Mehrwertzellen aufteilen („3 Zi · 75 m²“)
  for (let ci = spalten.length - 1; ci >= 0; ci--) {
    const dateZeilen = zeilen.filter((_, ri) => !rows[ri]!.summe).map((r) => r[ci] ?? '');
    const teile = zellenTeilen(dateZeilen);
    if (!teile) continue;
    const bestehend = new Set(spalten.map((s) => s.feld).filter(Boolean));
    const neu = teile.map((t) => ({ ueberschrift: spalten[ci]!.ueberschrift ? `${spalten[ci]!.ueberschrift} · ${TEILNAME[t.art]}` : TEILNAME[t.art], feld: bestehend.has(TEILFELD[t.art]) && spalten[ci]!.feld !== TEILFELD[t.art] ? null : TEILFELD[t.art] as EinheitFeld | null }));
    let dz = 0;
    const neueZeilen = zeilen.map((r, ri) => {
      const summe = rows[ri]!.summe;
      const werte = summe ? teile.map((_, ti) => (ti === 0 ? r[ci] ?? '' : '')) : teile.map((t) => t.werte[dz]!);
      if (!summe) dz++;
      return [...r.slice(0, ci), ...werte, ...r.slice(ci + 1)];
    });
    spalten.splice(ci, 1, ...neu);
    zeilen = neueZeilen;
  }
  return { tabelle: { seite, titel: null, spalten, zeilen }, verbraucht };
}

/** Tabelle ohne Kopfzeile: aufeinanderfolgende Zeilen mit je einer Fläche (m²) und einem Betrag (€). */
function tabelleOhneKopf(seite: number, zl: Zl[], i: number): { tabelle: EinheitenTabelle; verbraucht: Zl[] } | null {
  const hatBeides = (c: string[]) => c.length >= 3 && c.some((x) => reFlaeche.test(x) || /^\d{2,4}[.,]\d\s?$/.test(x)) && c.some((x) => reEuro.test(x));
  if (zl[i]!.used || !hatBeides(zl[i]!.c)) return null;
  const rows: Zl[] = [zl[i]!];
  let luecke = 0, k = i + 1;
  while (k < zl.length) {
    const l = zl[k]!;
    if (l.used) break;
    if (hatBeides(l.c) && Math.abs(l.c.length - rows[0]!.c.length) <= 1) { rows.push(l); luecke = 0; }
    else if (l.c.length === 1 && luecke < 1) luecke++;
    else if (l.c.length >= 2 && l.c.slice(0, 2).some((x) => SUMME.test(x.trim()))) { rows.push(l); break; }
    else break;
    k++;
  }
  const daten = rows.filter((r) => !r.c.slice(0, 2).some((x) => SUMME.test(x.trim())));
  if (daten.length < 3) return null;
  const n = Math.max(...daten.map((r) => r.c.length));
  const zeilen = rows.map((r) => (r.c.length >= n ? r.c.slice(0, n) : [...r.c, ...new Array<string>(n - r.c.length).fill('')]));
  const dz = zeilen.filter((_, ri) => !rows[ri]!.c.slice(0, 2).some((x) => SUMME.test(x.trim())));
  const spalten: { ueberschrift: string; feld: EinheitFeld | null }[] = [];
  const eurSpalten: number[] = [];
  for (let ci = 0; ci < n; ci++) {
    const zellen = dz.map((r) => r[ci] ?? '').filter(Boolean);
    const anteil = (re: RegExp) => zellen.filter((x) => re.test(x)).length / Math.max(1, zellen.length);
    let feld: EinheitFeld | null = null;
    if (anteil(reFlaeche) >= 0.7) feld = 'flaeche';
    else if (anteil(reEuro) >= 0.7) { eurSpalten.push(ci); }
    else if (anteil(reZimmer) >= 0.7) feld = 'zimmer';
    else if (anteil(/^(eg|og|dg|ug|gg|\d+\.?\s?(og|ug|etage|geschoss)|erdgeschoss|dachgeschoss|obergeschoss|untergeschoss)/i) >= 0.6) feld = 'lage';
    else if (anteil(/^(whg|we|wohnung|einheit|nr)\.?\s?\d/i) >= 0.6) feld = 'nr';
    spalten.push({ ueberschrift: '', feld });
  }
  // Ein einziger Betragsspalte: Kaltmiete nur, wenn der Betrag je m² plausibel ist (1–60 €)
  if (eurSpalten.length === 1) {
    const fl = spalten.findIndex((s) => s.feld === 'flaeche');
    const ci = eurSpalten[0]!;
    if (fl >= 0) {
      const je = dz.map((r) => { const a = zahlAusText(r[fl] ?? ''), b = zahlAusText(r[ci] ?? ''); return a && b ? b / a : null; }).filter((x): x is number => x !== null);
      if (je.length >= 2 && je.every((x) => x >= 1 && x <= 60)) spalten[ci]!.feld = 'kaltmiete';
    }
  }
  // Datenschutz: Spalten mit Personennamen (Mieter) entfallen auch ohne Kopfzeile (Protokoll 31, B10)
  const namensSpalten = new Set<number>();
  for (let ci = 0; ci < n; ci++) {
    if (spalten[ci]!.feld || eurSpalten.includes(ci)) continue;
    const zellen = dz.map((r) => r[ci] ?? '').filter(Boolean);
    if (zellen.length >= 2 && zellen.filter(nameartig).length / zellen.length >= 0.6) namensSpalten.add(ci);
  }
  const behalten = (_: unknown, ci: number) => !namensSpalten.has(ci);
  return { tabelle: { seite, titel: null, spalten: spalten.filter(behalten), zeilen: zeilen.map((r) => r.filter(behalten)) }, verbraucht: rows };
}

/**
 * Dieselbe Mietliste auf mehreren Seiten (Übersicht und Anhang) zählt einmal: eine Tabelle, deren Datenzeilen alle schon in
 * einer früheren Tabelle stehen, entfällt — sonst verdoppeln sich Einheiten und `einheiten_im_dokument` (Protokoll 31, B9).
 */
function tabellenOhneDubletten(tabellen: EinheitenTabelle[]): EinheitenTabelle[] {
  const datenzeilen = (t: EinheitenTabelle) => t.zeilen
    .filter((z) => !z.slice(0, 2).some((c) => SUMME.test(c.trim())))
    .map((z) => z.map((c) => leerraum(c).toLowerCase()).join('\u0001'));
  const aus: EinheitenTabelle[] = [];
  const gesehen: Set<string>[] = [];
  for (const t of tabellen) {
    const zeilen = datenzeilen(t);
    if (zeilen.length >= 2 && gesehen.some((g) => zeilen.every((z) => g.has(z)))) continue;
    aus.push(t);
    gesehen.push(new Set(zeilen));
  }
  return aus;
}

/** Überschrift einer Tabelle: eine der drei Zeilen davor, wenn sie nach Mietliste/Aufstellung/Übersicht klingt. */
function tabellenTitel(zl: Zl[], i: number): string | null {
  for (let k = i - 1; k >= Math.max(0, i - 3); k--) {
    for (const c of zl[k]!.c) {
      const t = c.replace(/:$/, '').trim();
      if (t.length <= 60 && !/[.,;]$/.test(t) && !/,/.test(t) && /aufstellung|liste\b|übersicht|uebersicht|mietspiegel|rent ?roll|einheiten|mieten\b|vermietung|belegung/i.test(t)) return t;
    }
  }
  return null;
}

// ── Angaben ────────────────────────────────────────────────────

interface Ctx { seite: number; bild: boolean; kontaktKontext: boolean; aus: { o: number; a: ErfassteAngabe }[]; einmal: Set<string> }

function melde(ctx: Ctx, o: number, bez0: string, wert0: string, pfadVorgabe?: string | null, kontaktVorgabe?: number | null): void {
  const bez = leerraum(bez0).replace(/:\s*$/, '').trim();
  const wert = leerraum(wert0);
  if (!bez || !wert || !/[A-Za-zÄÖÜäöüß0-9]/.test(wert)) return;
  // Datenschutz: keine Mieternamen
  if (/^(mieter|mieterin|mietername|mietpartei|bewohner)( in)?$/.test(bezeichnungSchluessel(bez))) return;
  let pfad = pfadVorgabe !== undefined ? pfadVorgabe : pfadFuer(bez, wert);
  // Bild-Seiten (OCR): Textpfade sind unsicher, nur Zahlen- und Kontaktpfade bleiben
  if (ctx.bild && pfad && KATALOG[pfad]?.typ === 'text' && !pfad.startsWith('kontaktperson.') && !pfad.startsWith('freitexte.')) pfad = null;
  // allgemeine Kontaktbezeichnungen nur im Kontaktumfeld
  if (pfad === 'kontaktperson.name' && !ctx.kontaktKontext && !/ansprech|kontaktperson/i.test(bez)) pfad = null;
  const kontakt = kontaktVorgabe !== undefined ? kontaktVorgabe : pfad && (pfad.startsWith('kontaktperson.') || pfad.startsWith('anbieter.firma')) ? 1 : null;
  ctx.aus.push({ o, a: { bezeichnung: bez, wert, seite: ctx.seite, pfad, kontakt, gg: null } });
}

/** Zwei Zellen als Paar annehmen? */
function paarOk(l: string, w: string, nachbarPaar: boolean): boolean {
  if (!labelartig(l)) return false;
  if (BULLET.test(w) && !/^-?\d/.test(w)) return false;
  const lk = bezeichnungZuPfad(l) !== null || KATALOG_SCHLUESSEL.has(bezeichnungSchluessel(l.replace(/:$/, '')));
  // zwei Bezeichnungen nebeneinander (ohne Doppelpunkt) sind kein Paar
  if (!/:\s*$/.test(l) && !hatZiffer(w) && labelartig(w) && (bezeichnungZuPfad(w) !== null || KATALOG_SCHLUESSEL.has(bezeichnungSchluessel(w)))) return false;
  return /:\s*$/.test(l) || lk || hatZiffer(w) || nachbarPaar;
}

/** Mehrzellige Zeilen als Paare lesen (2, 3, 4, 6 Zellen). Gibt true zurück, wenn die Zeile verwendet wurde. */
function paareInZeile(ctx: Ctx, l: Zl, prev: Zl | undefined, next: Zl | undefined): boolean {
  const c = l.c;
  const zweier = (z: Zl | undefined) => !!z && !z.used && z.c.length === 2 && labelartig(z.c[0]!);
  if (c.length === 2) {
    const nachbar = zweier(prev) || zweier(next);
    if (!paarOk(c[0]!, c[1]!, nachbar)) return false;
    if (bezeichnungZuPfad(c[0]!) === 'kontaktperson.name' && !nameartig(c[1]!)) return false;
    melde(ctx, l.o, c[0]!, c[1]!);
    return true;
  }
  if (c.length === 3) {
    // [Überschrift, Bezeichnung, Wert] oder [Bezeichnung, Wert, Überschrift]
    if (labelartig(c[1]!) && hatZiffer(c[2]!) && !hatZiffer(c[1]!) && !/^\d/.test(c[0]!)) { melde(ctx, l.o, c[1]!, c[2]!); return true; }
    if (labelartig(c[0]!) && hatZiffer(c[1]!) && labelartig(c[2]!) && !hatZiffer(c[2]!)) { melde(ctx, l.o, c[0]!, c[1]!); l.c = [c[2]!]; return false; }
    if (labelartig(c[0]!) && labelartig(c[1]!) && labelartig(c[2]!) && bezeichnungZuPfad(c[0]!) !== null && !hatZiffer(c.join(''))) { melde(ctx, l.o, c[0]!, c[1]!); l.c = [c[2]!]; return false; }
    return false;
  }
  if (c.length === 4 || c.length === 6) {
    const paare: [string, string][] = [];
    for (let i = 0; i < c.length; i += 2) paare.push([c[i]!, c[i + 1]!]);
    if (!paare.every(([a]) => labelartig(a))) return false;
    // keine Mietzeile: Wert-Zellen dürfen nicht alle Bezeichnungen sein, mindestens ein Paar muss „stark“ sein
    const stark = paare.filter(([a, b]) => paarOk(a, b, false));
    if (stark.length < Math.ceil(paare.length / 2) || stark.length < 1) return false;
    if (paare.some(([a]) => KATALOG_WERTSPALTE.test(a))) return false;
    for (const [a, b] of paare) melde(ctx, l.o, a, b);
    return true;
  }
  return false;
}
const KATALOG_WERTSPALTE = /^(nr\.?|lfd)$/i;

/** Kacheln: Zeile nur mit Bezeichnungen + (benachbarte) Zeile mit gleich vielen Werten. */
function kacheln(ctx: Ctx, zl: Zl[]): void {
  const istLabelZeile = (c: string[]) => {
    if (c.length < 2 || !c.every((x) => labelartig(x) && !hatZiffer(x.replace(/[A-Z]+\d?$/, '')) )) return false;
    const stark = c.filter((x) => GROSS(x) || bezeichnungZuPfad(x) !== null).length;
    return c.length === 2 ? stark === 2 && c.every((x) => GROSS(x) || bezeichnungZuPfad(x) !== null) : stark >= Math.ceil(c.length * 0.6);
  };
  const istWertZeile = (c: string[], n: number) => c.length === n && (n === 2 ? c.every(hatZiffer) : c.filter(hatZiffer).length >= Math.ceil(n / 2) || !c.every((x) => GROSS(x)));
  for (let i = 0; i < zl.length; i++) {
    const l = zl[i]!;
    if (l.used || !istLabelZeile(l.c)) continue;
    const n = l.c.length;
    // Wertzeile darüber (bevorzugt, wenn nur Zahlen) oder darunter; bis zu eine Zeile Abstand
    const kand: number[] = [];
    for (const d of [-1, 1, -2, 2]) { const k = i + d; if (k >= 0 && k < zl.length) kand.push(k); }
    let wahl = -1;
    for (const k of kand) {
      const z = zl[k]!;
      if (z.used || !istWertZeile(z.c, n)) continue;
      if (k < i && !z.c.every(hatZiffer) && !(zl[i + 1] && !zl[i + 1]!.used && istWertZeile(zl[i + 1]!.c, n))) { if (n < 3) continue; }
      if (k > i && istLabelZeile(z.c)) continue;
      // Abstand 2 nur, wenn dazwischen eine einzelne, nicht verbrauchte Zelle steht
      if (Math.abs(k - i) === 2 && zl[(k + i) / 2]!.c.length !== 1) continue;
      wahl = k; break;
    }
    if (wahl < 0) continue;
    const w = zl[wahl]!;
    for (let ci = 0; ci < n; ci++) melde(ctx, Math.min(l.o, w.o) + 0.01 * ci, l.c[ci]!, w.c[ci]!);
    l.used = true; w.used = true;
  }
}

/** Passt der Wert zur Art, die die Bezeichnung erwarten lässt? (3 passt, 0 unbekannt, -3 passt nicht) */
function artPasst(bez: string, wert: string): number {
  const p = bezeichnungZuPfad(bez, wert);
  if (!p) return 0;
  if (!wertPasst(p, wert)) return -3;
  const e = KATALOG[p]?.einheit, typ = KATALOG[p]?.typ;
  if (e === 'm²') return reFlaeche.test(wert) ? 3 : -3;
  if (typ === 'ganzzahl') return /^\d{1,3}$/.test(wert.trim()) ? 3 : -3;
  if (typ === 'jahr') return /^(1[7-9]|20)\d\d$/.test(wert.trim()) ? 3 : -3;
  return 1;
}

/**
 * Kacheln mit umbrochener Bezeichnung: eine Wertzeile mit n Werten, darüber/darunter n−1 Bezeichnungen, dazu zwei Zeilen mit
 * den Teilen einer Klammer-Bezeichnung („Mietfläche (lt.“ … „Vertrag)“). Wo die umbrochene Bezeichnung steht, ist
 * nicht erkennbar; es werden nur Paare erfasst, die für alle passenden Einfügepositionen gleich sind (Werte mit anderer Art).
 */
function kachelnVersetzt(ctx: Ctx, zl: Zl[]): void {
  for (let i = 0; i < zl.length; i++) {
    const v = zl[i]!;
    const n = v.c.length;
    if (v.used || n < 4 || !v.c.every((x) => x.length <= 24 && hatZiffer(x))) continue;
    const fenster = zl.map((_, k) => k).filter((k) => k !== i && Math.abs(k - i) <= 4 && !zl[k]!.used);
    const lk = fenster.find((k) => zl[k]!.c.length === n - 1 && zl[k]!.c.every((x) => labelartig(x) && !hatZiffer(x)) && zl[k]!.c.filter((x) => bezeichnungZuPfad(x) !== null).length >= n - 2);
    if (lk === undefined) continue;
    const auf = fenster.find((k) => zl[k]!.c.length === 1 && /\([^)]*$/.test(zl[k]!.c[0]!));
    const zu = fenster.find((k) => zl[k]!.c.length === 1 && /^[^(]*\)/.test(zl[k]!.c[0]!));
    if (auf === undefined || zu === undefined) continue;
    const fremd = `${zl[auf]!.c[0]} ${zl[zu]!.c[0]}`;
    const labels = zl[lk]!.c;
    let beste = -Infinity; let beste_pos: number[] = [];
    for (let pos = 0; pos < n; pos++) {
      const reihe = [...labels.slice(0, pos), fremd, ...labels.slice(pos)];
      const punkte = reihe.reduce((sum, b, ci) => sum + artPasst(b, v.c[ci]!), 0);
      if (punkte > beste) { beste = punkte; beste_pos = [pos]; } else if (punkte === beste) beste_pos.push(pos);
    }
    if (beste < n) continue;
    const reihen = beste_pos.map((pos) => [...labels.slice(0, pos), fremd, ...labels.slice(pos)]);
    for (let ci = 0; ci < n; ci++) {
      const b = reihen[0]![ci]!;
      if (reihen.every((r) => r[ci] === b)) melde(ctx, v.o + 0.01 * ci, b, v.c[ci]!);
    }
    v.used = true; zl[lk]!.used = true; zl[auf]!.used = true; zl[zu]!.used = true;
  }
}

/** Einzelzelle: „Bezeichnung: Wert“, „Bezeichnung Wert“ (bekannte Bezeichnung), „Wert Bezeichnung“ (bekannte Bezeichnung). */
function segmentPaar(ctx: Ctx, o: number, seg0: string): boolean {
  const seg = seg0.replace(BULLET, '').trim();
  if (!seg) return false;
  // 1 · Doppelpunkt
  const m = seg.match(/^([^:]{2,42}?):\s*(\S.*)$/);
  if (m && labelartig(m[1]!) && !/^\/\//.test(m[2]!) && !/^\d{1,2}$/.test(m[1]!)) {
    const wert = m[2]!;
    if (wert.length >= 90 && !wertartig(wert.slice(0, 20)) && bezeichnungZuPfad(m[1]!) === null) return false; // Fließtext mit Doppelpunkt: Abschnitt
    if (bezeichnungZuPfad(m[1]!) === 'kontaktperson.name' && !nameartig(wert)) return false;
    melde(ctx, o, m[1]!, wert);
    return true;
  }
  const w = seg.split(/\s+/);
  // 2 · bekannte Bezeichnung + Wert
  for (let k = Math.min(5, w.length - 1); k >= 1; k--) {
    const bez = w.slice(0, k).join(' ');
    const rest = w.slice(k).join(' ');
    if (!bez || !bekanntFuerText(bez)) continue;
    if (/^kontaktperson\.tel/.test(bezeichnungZuPfad(bez, w.slice(k).join(' ')) ?? '') && !/^[+\d()\s\-/.]+$/.test(w.slice(k).join(' '))) continue;
    if (!/^(ca\.?|rd\.?|circa|über|ab|bis|mind\.?)?\s*(\d|€|ja\b|nein\b|keine?\b|vorhanden)/i.test(rest)) continue;
    if (rest.length > 60 || (buchstaben(rest) > 14 && !/m²|m2|€|eur|%|kwh|stück|stk/i.test(rest))) continue;
    melde(ctx, o, bez, rest);
    return true;
  }
  // 3 · Wert + bekannte Bezeichnung („7,20 % IST-RENDITE“, „34 EINHEITEN“)
  const r = seg.match(/^((?:ca\.?\s*)?\d[\d.,]*(?:\s?(?:€|eur|%|m²|m2|qm|stück|stk\.?|x|×))?(?:\s?(?:p\.\s?a\.))?)\s+(\S.{0,40})$/i);
  if (r) {
    const rest = r[2]!.replace(/[|·]\s*$/, '').trim();
    const rw = rest.split(/\s+/);
    for (let k = rw.length; k >= 1; k--) {
      if (k < rw.length && rw.slice(k).length > 2) break;
      const bez = rw.slice(0, k).join(' ');
      const typ = KATALOG[bezeichnungZuPfad(bez) ?? '']?.typ;
      if (bekanntFuerText(bez) && (typ === 'zahl' || typ === 'ganzzahl' || typ === 'jahr' || ZAEHL.test(bezeichnungSchluessel(bez)))) {
        melde(ctx, o, bez, r[1]!);
        return true;
      }
    }
  }
  return false;
}

const ZAEHL = /^(einheiten|gesamteinheiten|anzahl einheiten|gewerbeflache|gewerbeflachen|wohnen|wohnungen|stellplatze|garagen)$/;
const SEGMENT_TRENNER = /\s+[|·•‖]\s+|\s*\|\s*$|\s+\|\s+/;

// ── Abschnitte (Freitext, Aufzählung) ──────────────────────────

const UEBERSCHRIFT_BEKANNT = /^(lage|objektbeschreibung|beschreibung|ausstattung|sonstiges|mikrolage|makrolage|hinweis|hinweise|objekt|objektdaten|highlights|investment|kurzbeschreibung|energie|zustand|vermietung|vermietungssituation|grundstück|infrastruktur|verkehrsanbindung|standort)/i;

function ueberschriftartig(t0: string): boolean {
  const t = t0.replace(/:$/, '').trim();
  if (t.length < 3 || t.length > 50) return false;
  if (/[.,;!?]$/.test(t) || /,/.test(t)) return false;
  if (!/^(?:[A-ZÄÖÜ]|\d+[.)]\s*[A-ZÄÖÜ])/.test(t)) return false;
  if (buchstaben(t) < 3 || woerter(t).length > 6) return false;
  if (/\d{3,}|@|https?:|www\./i.test(t)) return false;
  if (BULLET.test(t) && !/^[A-ZÄÖÜ]/.test(t)) return false;
  return true;
}

const istProsa = (t: string) => t.length >= 45 || (SATZENDE.test(t) && t.length >= 25 && woerter(t).length >= 4);

/** Zeilen eines Fließtexts verbinden; Silbentrennung am Zeilenende zusammenziehen. */
function textVerbinden(zeilen: string[]): string {
  let aus = '';
  for (const z of zeilen) {
    const t = z.trim();
    if (!t) continue;
    if (!aus) { aus = t; continue; }
    if (/[A-Za-zÄÖÜäöüß]-$/.test(aus)) {
      if (/^[a-zäöüß]/.test(t) && !/^(und|oder|bzw|sowie|u\.|sowie|auch)\b/.test(t)) aus = aus.slice(0, -1) + t;
      else aus += t;
    } else aus += ` ${t}`;
  }
  return aus;
}

function abschnitte(ctx: Ctx, rest: Zl[]): void {
  let ueberschrift: string | null = null;
  let mitDoppelpunkt = false;
  let kopfO = 0;
  let buf: { t: string; o: number }[] = [];
  let nachPunkt = false;
  const leeren = () => {
    if (buf.length) {
      const text = textVerbinden(buf.map((b) => b.t));
      const prosa = buf.some((b) => istProsa(b.t));
      if ((prosa && text.length >= 40) || text.length >= 120) {
        const titel = ueberschrift ?? (/gewähr|haftung|irrtum|zwischenverkauf|freibleibend/i.test(text) ? 'Hinweis' : 'Text');
        const p = ueberschrift ? bezeichnungZuPfad(ueberschrift) : null;
        melde(ctx, ueberschrift ? kopfO : buf[0]!.o, titel, text, p && p.startsWith('freitexte.') ? p : null, null);
      } else if (ueberschrift && text.length >= 3 && text.length <= 200 && !(buf.length === 1 && ueberschriftartig(text)) && (mitDoppelpunkt || GROSS(ueberschrift) || KATALOG_SCHLUESSEL.has(bezeichnungSchluessel(ueberschrift)))) {
        // Überschrift mit kurzem Wert darunter („DAS OBJEKT“ / „Wohn- & Geschäftshaus“)
        melde(ctx, kopfO, ueberschrift, text);
      }
    }
    buf = [];
  };
  for (let i = 0; i < rest.length; i++) {
    const l = rest[i]!;
    const t = l.c[0]!;
    if (BULLET.test(t) && t.replace(BULLET, '').length >= 2) {
      leeren();
      const punkt = t.replace(BULLET, '').trim();
      melde(ctx, l.o, ueberschrift ?? 'Merkmal', punkt, ueberschrift && /^ausstattung/i.test(ueberschrift) ? 'ausstattung.merkmal' : null, null);
      l.used = true;
      nachPunkt = true;
      continue;
    }
    if (nachPunkt && !buf.length && !istProsa(t) && !ueberschriftartig(t)) { ueberschrift = null; nachPunkt = false; continue; }
    nachPunkt = false;
    // „Überschrift: langer Text“ in einer Zelle
    const k = t.match(/^([^:]{2,30}):\s+(\S.{60,})$/);
    if (k && ueberschriftartig(k[1]!)) { leeren(); ueberschrift = k[1]!; mitDoppelpunkt = true; kopfO = l.o; buf = [{ t: k[2]!, o: l.o }]; l.used = true; continue; }
    const vorher = buf.at(-1)?.t;
    const mitten = !!vorher && vorher.length >= 40 && !SATZENDE.test(vorher);
    if (ueberschriftartig(t) && !mitten && i + 1 < rest.length) {
      const ueberschriftNeu = !(ueberschrift && !buf.length && woerter(t).length >= 3 && !UEBERSCHRIFT_BEKANNT.test(t));
      if (ueberschriftNeu) { leeren(); ueberschrift = t.replace(/:$/, ''); mitDoppelpunkt = /:$/.test(t); kopfO = l.o; l.used = true; continue; }
    }
    buf.push({ t, o: l.o });
    l.used = true;
  }
  leeren();
}

// ── Kontakte ───────────────────────────────────────────────────

const KONTAKT_KONTEXT = /ansprechpartner|ansprechperson|kontakt|makler|immobilien|\bgmbh\b|\bmbh\b|\bag\b|\bkg\b|\bohg\b|vermittl|real estate|\bberater|\bimmobilienberater|\bimpressum|capital|invest|verwaltung/i;
const reEmail = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
const reWeb = /(?:https?:\/\/|www\.)[^\s,;|<>"')]+/gi;
const rePhone = /(?<![\p{L}\d.,/])(?:\+\d{1,3}|00\d{2}|\(?0)[\d\s\-/().]{7,18}\d/gu;
const reDomain = /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:de|com|net|org|eu|info|immo|biz|at|ch)(?:\/[^\s,;|<>"')]*)?/gi;
const TEL_AUSSCHLUSS = /iban|\bbic\b|konto|steuer|ust-?id|\bhrb\b|\bhra\b|register|flurst|aktenz|\bblz\b|amtsgericht/i;

/** Enthält die Zelle eine E-Mail, Webadresse oder Telefonnummer? */
function zeileHatKontakt(c: string): boolean {
  reEmail.lastIndex = 0; reWeb.lastIndex = 0; rePhone.lastIndex = 0;
  const r = reEmail.test(c) || reWeb.test(c) || (!TEL_AUSSCHLUSS.test(c) && [...c.matchAll(rePhone)].some((m) => { const z = (m[0].match(/\d/g) ?? []).length; return z >= 8 && z <= 15 && !/\d{2}\.\d{2}\.\d{2,4}/.test(m[0]); }));
  reEmail.lastIndex = 0; reWeb.lastIndex = 0; rePhone.lastIndex = 0;
  return r;
}

/** Zeilen (nach `o`) in der Nähe von E-Mail, Telefon oder Web: dort steht die Anschrift des Anbieters, nicht die des Objekts. */
function kontaktNaehe(zl: Zl[]): (o: number) => boolean {
  const treffer = zl.map((l) => l.c.some((c) => { reEmail.lastIndex = 0; rePhone.lastIndex = 0; reWeb.lastIndex = 0; return reEmail.test(c) || reWeb.test(c) || (rePhone.test(c) && !TEL_AUSSCHLUSS.test(c) && (c.match(/\d/g) ?? []).length >= 8 && !/\d{2}\.\d{2}\.\d{2,4}/.test(c)); }));
  reEmail.lastIndex = 0; rePhone.lastIndex = 0; reWeb.lastIndex = 0;
  const idx = new Map(zl.map((l, i) => [Math.floor(l.o), i] as const));
  return (o) => { const i = idx.get(Math.floor(o)); if (i === undefined) return false; for (let k = Math.max(0, i - 3); k <= Math.min(zl.length - 1, i + 3); k++) if (treffer[k]) return true; return false; };
}

function kontakte(ctx: Ctx, zl: Zl[], bereits: Set<string>): void {
  const nahe = kontaktNaehe(zl);
  const text = zl.map((l) => l.c.join('  '));
  const seitenKontext = /ansprechpartner|ihr kontakt|kontakt:/i.test(text.join('\n'));
  const schluessel = (s: string) => s.toLowerCase().replace(/[^a-z0-9@]/g, '');
  const dazu = (o: number, bez: string, wert: string, pfadRoh: string, kontext: boolean) => {
    const k = schluessel(wert);
    if (bereits.has(k)) return;
    bereits.add(k);
    melde(ctx, o + 0.5, bez, wert, kontext ? pfadRoh : null, kontext ? 1 : null);
  };
  zl.forEach((l, idx) => {
    // am Zeilenende abgeschnittene E-Mail („name@“ + „firma.de“)
    const zellen = [...l.c];
    const letzte = zellen.at(-1)!;
    if (/@$/.test(letzte) && zl[idx + 1]) zellen[zellen.length - 1] = letzte + zl[idx + 1]!.c[0]!;
    const umfeld = text.slice(Math.max(0, idx - 6), idx + 4).join(' ');
    const kontext = KONTAKT_KONTEXT.test(umfeld) || seitenKontext;
    for (const zelle of zellen) {
      for (const m of zelle.matchAll(reEmail)) dazu(l.o, 'E-Mail', m[0], 'kontaktperson.email_direkt', kontext);
      for (const m of zelle.matchAll(reWeb)) dazu(l.o, 'Webseite', m[0].replace(/[.,;]+$/, ''), 'kontaktperson.url', kontext);
      if (TEL_AUSSCHLUSS.test(zelle)) continue;
      for (const m of zelle.matchAll(rePhone)) {
        const nr = m[0].replace(/[\s.]+$/, '').trim();
        const ziffern = (nr.match(/\d/g) ?? []).length;
        if (ziffern < 8 || ziffern > 15 || reDatum.test(nr) || /\d{2}\.\d{2}\.\d{2,4}/.test(nr)) continue;
        const vor = zelle.slice(Math.max(0, m.index - 24), m.index);
        const lab = vor.match(/(telefon|tel\.?|fon|mobil(?:telefon)?|handy|fax|telefax|phone|durchwahl|mob\.?|zentrale)\s*[:.]?\s*$/i)?.[1] ?? vor.match(/(?:^|\s)([TMF])\s*[:.]\s*$/)?.[1] ?? null;
        const intl = /^(\+|00)/.test(nr);
        if (!lab && !intl && !kontext) continue;
        if (!lab && !intl && !/^0\d{2,5}[\s\-/]\d/.test(nr) && !/^0\d{9,}/.test(nr.replace(/\D/g, ''))) continue;
        const l0 = (lab ?? '').toLowerCase();
        const pfad = /fax/.test(l0) || l0 === 'f' ? 'kontaktperson.tel_fax' : /mobil|handy|mob/.test(l0) || l0 === 'm' || istMobilnummer(nr) ? 'kontaktperson.tel_handy' : /durchwahl/.test(l0) ? 'kontaktperson.tel_durchw' : 'kontaktperson.tel_zentrale';
        dazu(l.o, lab ?? (pfad === 'kontaktperson.tel_handy' ? 'Mobil' : pfad === 'kontaktperson.tel_fax' ? 'Fax' : 'Telefon'), nr, pfad, kontext);
      }
    }
    // Webadresse ohne „www.“ im Kontaktumfeld
    if (kontext) {
      for (const zelle of zellen) {
        for (const m of zelle.replace(reEmail, ' ').matchAll(reDomain)) {
          const w = m[0].replace(/[.,;]+$/, '');
          const wk = schluessel(w.replace(/^www\./, ''));
          if (/^\d/.test(w) || [...bereits].some((b) => b.includes(wk))) continue;
          dazu(l.o, 'Webseite', w, 'kontaktperson.url', true);
        }
      }
    }
    // Anschrift des Anbieters: Straße und „PLZ Ort“ in der Nähe von E-Mail/Telefon
    if (nahe(l.o)) {
      for (const zelle of zellen) {
        for (const sg of zelle.split(SEGMENT_TRENNER)) {
          const t = sg.trim();
          if (/^[A-ZÄÖÜ][\p{L}.\- ]+\s\d+\s?[a-z]?$/u.test(t) && ANSCHRIFT.test(t)) dazu(l.o, 'Straße', t, 'kontaktperson.strasse', true);
          else if (/^(D-)?\d{5}\s+[A-ZÄÖÜ][\p{L}.\- ]+$/u.test(t)) dazu(l.o, 'PLZ Ort', t, 'kontaktperson.plz', true);
        }
      }
    }
  });
  reEmail.lastIndex = 0;
}

// ── Einheiten im Dokument ──────────────────────────────────────

function zaehle(angaben: ErfassteAngabe[], tabellen: EinheitenTabelle[], texte: string[]): number | null {
  const ganzzahl = (s: string) => { const n = zahlAusText(s); return n !== null && Number.isInteger(n) && n > 0 && n < 5000 ? n : null; };
  const erste = (pfade: string[]) => {
    for (const a of angaben) if (a.pfad && pfade.includes(a.pfad)) { const n = ganzzahl(a.wert); if (n !== null) return n; }
    return null;
  };
  const sucheText = (re: RegExp) => { for (const t of texte) { const m = t.match(re); if (m) { const n = Number(m[1]); if (n > 0 && n < 5000) return n; } } return null; };
  let gesamt: number | null = null;
  for (const a of angaben) {
    if (/^(gesamteinheiten|anzahl einheiten|einheiten|einheiten gesamt|einheiten insgesamt|anzahl der einheiten)$/.test(bezeichnungSchluessel(a.bezeichnung))) { gesamt = ganzzahl(a.wert); if (gesamt !== null) break; }
  }
  gesamt ??= sucheText(/\b(\d{1,4})\s*einheiten\b(?!\s*(?:leer|vermietet|frei|unvermietet))/i);
  const we = erste(['flaechen.anzahl_wohneinheiten']) ?? sucheText(/\b(\d{1,4})\s*(?:Wohneinheiten|Wohnungen|WE|Wohnen)\b/i);
  const ge = erste(['flaechen.anzahl_gewerbeeinheiten']) ?? sucheText(/\b(\d{1,4})\s*(?:Gewerbeeinheiten|Gewerbe)\b/i);
  const zeilen = tabellen.reduce((s, t) => s + t.zeilen.filter((z) => !z.slice(0, 2).some((c) => SUMME.test(c.trim()))).length, 0);
  const genannt = gesamt ?? (we !== null ? we + (ge ?? 0) : ge);
  // Mietliste mit mehr Zeilen als genannt (z. B. samt Stellplätzen): die Liste gilt
  if (zeilen > 0) return Math.max(genannt ?? 0, zeilen);
  return genannt;
}

/**
 * Kontaktangaben: Wiederholungen (Kopf-/Fußzeilen jeder Seite) nur einmal. Steht irgendwo ein ausdrücklicher „Ansprechpartner“,
 * gehören nur die Kontaktangaben seiner Seite zu Kontakt 1; Kontaktangaben anderer Seiten (Büroliste, Impressum) werden Kontakt 2.
 */
function kontakteOrdnen(angaben: ErfassteAngabe[]): ErfassteAngabe[] {
  const gesehen = new Set<string>();
  const aus = angaben.filter((a) => {
    if (!a.pfad || !(a.pfad.startsWith('kontaktperson.') || a.pfad.startsWith('anbieter.'))) return true;
    const k = `${a.pfad}|${a.wert.toLowerCase().replace(/[^a-z0-9@]/g, '')}`;
    if (gesehen.has(k)) return false;
    gesehen.add(k);
    return true;
  });
  const anker = new Set(aus.filter((a) => a.pfad === 'kontaktperson.name' && /ansprech/i.test(a.bezeichnung)).map((a) => a.seite));
  if (!anker.size) return aus;
  return aus.map((a) => (a.kontakt === 1 && a.pfad && a.pfad !== 'kontaktperson.name' && !anker.has(a.seite) ? { ...a, kontakt: 2 } : a));
}

// ── Hauptfunktion ──────────────────────────────────────────────

/** Rohdaten aus dem Dokument: Angaben in Dokumentreihenfolge, Mietlisten als Tabellen, Zahl der Einheiten. */
export function rohdatenAusDokument(d: Dokument): Rohdaten {
  const angaben: ErfassteAngabe[] = [];
  const tabellen: EinheitenTabelle[] = [];
  const bereits = new Set<string>();
  const einmal = new Set<string>();
  const texte: string[] = [];
  for (const s of d.seiten) {
    if (s.typ === 'leer' || !s.zeilen.length) continue;
    const zl = zeilenVon(s.zeilen, s.typ === 'bild');
    if (!zl.length) continue;
    texte.push(...zl.flatMap((l) => l.c));
    const seitenText = zl.map((l) => l.c.join('  ')).join('\n');
    const ctx: Ctx = { seite: s.nr, bild: s.typ === 'bild', kontaktKontext: KONTAKT_KONTEXT.test(seitenText), aus: [], einmal };

    // 1 · Tabellen (mit Kopfzeile, dann ohne)
    for (let i = 0; i < zl.length; i++) {
      if (zl[i]!.used) continue;
      const kopf = kopfPruefen(zl[i]!.c);
      if (!kopf) continue;
      const t = tabelleAusKopf(s.nr, zl, i, kopf);
      if (!t) continue;
      t.tabelle.titel = tabellenTitel(zl, i);
      tabellen.push(t.tabelle);
      for (const v of t.verbraucht) v.used = true;
    }
    for (let i = 0; i < zl.length; i++) {
      const t = tabelleOhneKopf(s.nr, zl, i);
      if (!t) continue;
      t.tabelle.titel = tabellenTitel(zl, i);
      tabellen.push(t.tabelle);
      for (const v of t.verbraucht) v.used = true;
    }

    // 2 · Kacheln, 3 · Paare in mehrzelligen Zeilen
    kacheln(ctx, zl);
    kachelnVersetzt(ctx, zl);
    for (let i = 0; i < zl.length; i++) {
      const l = zl[i]!;
      if (l.used || l.c.length < 2) continue;
      if (paareInZeile(ctx, l, zl[i - 1], zl[i + 1])) l.used = true;
    }

    // 4 · übrige Zeilen in Einzelzellen zerlegen (bei vielen Zellen nur Fließtext-Zellen: Reste von Tabellen und Kacheln sind Rauschen)
    const einzel: Zl[] = [];
    for (const l of zl) {
      if (l.used) continue;
      l.c.forEach((c, ci) => { if (l.c.length <= 2 || c.length >= 40) einzel.push({ c: [c], used: false, o: l.o + ci * 0.001 }); });
    }
    const nahe = kontaktNaehe(zl);
    // Einzelzellen: „Bezeichnung: Wert“, „Bezeichnung Wert“, „Wert Bezeichnung“ je Abschnitt der Zelle; Bezeichnung und Wert in Folgezeilen
    for (let i = 0; i < einzel.length; i++) {
      const l = einzel[i]!;
      if (l.used) continue;
      const t = l.c[0]!;
      const istPunkt = BULLET.test(t);
      if (t.length <= 160) {
        const segs = t.split(SEGMENT_TRENNER).map((x) => x.trim()).filter(Boolean);
        if (segs.length > 1 || !istProsa(t) || /:/.test(t)) {
          const verb = segs.map(() => false);
          segs.forEach((sg, si) => { if (segmentPaar(ctx, l.o, sg)) verb[si] = true; });
          // „4,00 % netto · Käuferprovision“: Wert und bekannte Bezeichnung in benachbarten Abschnitten
          segs.forEach((sg, si) => {
            if (verb[si] || !labelartig(sg) || !bekanntFuerText(sg) || sg.length > 30) return;
            const vor = si > 0 && !verb[si - 1] ? segs[si - 1]! : null;
            const nach = si + 1 < segs.length && !verb[si + 1] ? segs[si + 1]! : null;
            const w = vor && wertartig(vor) && vor.length <= 30 ? vor : nach && wertartig(nach) && nach.length <= 30 ? nach : null;
            if (w) { melde(ctx, l.o, sg, w); verb[si] = true; verb[segs.indexOf(w)] = true; }
          });
          // Anschrift des Objekts (nicht des Anbieters) und „PLZ Ort“ ohne Beschriftung
          segs.forEach((sg, si) => {
            if (verb[si] || nahe(l.o) || istPunkt) return;
            // Kopf-/Fußzeilen wiederholen die Anschrift auf jeder Seite: nur einmal
            const einmalig = (art: string) => { const k = `${art}|${sg.toLowerCase().replace(/[^a-z0-9]/g, '')}`; if (ctx.einmal.has(k)) return false; ctx.einmal.add(k); return true; };
            if (/^(D-)?\d{5}\s+[A-ZÄÖÜ][\p{L}.\- ]{2,40}$/u.test(sg)) { if (einmalig('plz')) melde(ctx, l.o, 'PLZ Ort', sg, 'geo.plz'); verb[si] = true; }
            else if (sg.length <= 90 && /^[A-ZÄÖÜ]/.test(sg) && adresseartig(sg) && !/\s(und|oder)\s/.test(sg) && buchstaben(sg) < sg.length) { if (einmalig('adr')) melde(ctx, l.o, 'Adresse', sg, 'geo.strasse'); verb[si] = true; }
          });
          if (verb.some(Boolean)) {
            // Aufzählungspunkte bleiben zusätzlich als Punkt erhalten
            if (!istPunkt && verb.every(Boolean)) { l.used = true; continue; }
            if (!istPunkt) { l.used = true; continue; }
          }
        }
      }
      // Bezeichnung in einer Zeile, Wert in der folgenden
      const bez = t.replace(/:$/, '');
      const pfad = !istPunkt && labelartig(t) ? bezeichnungZuPfad(bez) : null;
      if (pfad && !pfad.startsWith('freitexte.')) {
        for (let d2 = 1; d2 <= 2; d2++) {
          const nx = einzel[i + d2];
          if (!nx || nx.used) break;
          const w = nx.c[0]!;
          const name = pfad === 'kontaktperson.name';
          if (w.length > 70 || (labelartig(w) && !hatZiffer(w) && !(name && nameartig(w)))) continue;
          const p2 = pfadFuer(bez, w);
          if (!p2) continue;
          melde(ctx, l.o, bez, w);
          l.used = true; nx.used = true;
          break;
        }
      }
    }

    // 5 · Kontaktdaten per Muster (Zeilen mit E-Mail/Telefon/Web gehören nicht in einen Fließtext)
    for (const a of ctx.aus) bereits.add(a.a.wert.toLowerCase().replace(/[^a-z0-9@]/g, ''));
    kontakte(ctx, zl, bereits);
    for (const l of einzel) if (!l.used && l.c[0]!.length <= 160 && zeileHatKontakt(l.c[0]!)) l.used = true;

    // 6 · Aufzählungen und Freitext-Abschnitte
    abschnitte(ctx, einzel.filter((l) => !l.used));

    ctx.aus.sort((a, b) => a.o - b.o);
    for (const x of ctx.aus) angaben.push(x.a);
  }
  const eindeutig = tabellenOhneDubletten(tabellen);
  return { angaben: kontakteOrdnen(angaben), einheiten_tabellen: eindeutig, einheiten_im_dokument: zaehle(angaben, eindeutig, texte) };
}

