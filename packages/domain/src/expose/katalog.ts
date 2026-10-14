/**
 * Standard-Katalog der Exposé-Erfassung v2 (Protokoll 28): Pfade nach OpenImmo 1.2.7 (Gruppe.Element, Unterelemente mit
 * Punkt) für Anlage- und Wohnimmobilien, dazu eine kleine gg-Erweiterung (`gg.*`) für Angaben, die OpenImmo nicht kennt.
 *
 * Die KI ordnet jede erfasste Angabe einem dieser Pfade zu (oder null). Der Pfad sagt nur, *was* die Angabe ist —
 * der Wert bleibt wörtlich wie im Dokument. Periodische Preise (OpenImmo-Attribut `periode`) sind als `_monat`/`_jahr`
 * getrennte Pfade geführt, damit die KI nichts umrechnen muss.
 */

export type WertTyp = 'text' | 'zahl' | 'ganzzahl' | 'jahr' | 'jaNein' | 'datum';

export interface KatalogEintrag { label: string; typ: WertTyp; einheit?: string }

/** Gruppen in Anzeigereihenfolge; der erste Pfadteil ist die Gruppe. */
export const KATALOG_GRUPPEN: Record<string, string> = {
  objektkategorie: 'Objektkategorie', geo: 'Lage', preise: 'Preise', flaechen: 'Flächen', ausstattung: 'Ausstattung',
  zustand_angaben: 'Zustand und Energie', bewertung: 'Bewertung', infrastruktur: 'Infrastruktur', freitexte: 'Freitexte',
  verwaltung_objekt: 'Verwaltung', verwaltung_techn: 'Vertrieb', kontaktperson: 'Kontakt', anbieter: 'Anbieter', gg: 'gg-Erweiterung',
};

const T = (label: string): KatalogEintrag => ({ label, typ: 'text' });
const Z = (label: string, einheit?: string): KatalogEintrag => ({ label, typ: 'zahl', ...(einheit ? { einheit } : {}) });
const G = (label: string, einheit?: string): KatalogEintrag => ({ label, typ: 'ganzzahl', ...(einheit ? { einheit } : {}) });
const J = (label: string): KatalogEintrag => ({ label, typ: 'jahr' });
const B = (label: string): KatalogEintrag => ({ label, typ: 'jaNein' });
const D = (label: string): KatalogEintrag => ({ label, typ: 'datum' });

export const KATALOG: Record<string, KatalogEintrag> = {
  // ── objektkategorie
  'objektkategorie.nutzungsart': T('Nutzungsart'),
  'objektkategorie.vermarktungsart': T('Vermarktungsart'),
  'objektkategorie.objektart': T('Objektart'),
  'objektkategorie.objektart_zusatz': T('Objektart (Zusatz)'),
  // ── geo
  'geo.strasse': T('Straße'),
  'geo.hausnummer': T('Hausnummer'),
  'geo.plz': T('PLZ'),
  'geo.ort': T('Ort'),
  'geo.ortsteil': T('Ortsteil'),
  'geo.regionaler_zusatz': T('Regionaler Zusatz'),
  'geo.bundesland': T('Bundesland'),
  'geo.land': T('Land'),
  'geo.gemarkung': T('Gemarkung'),
  'geo.flur': T('Flur'),
  'geo.flurstueck': T('Flurstück'),
  'geo.etage': T('Etage'),
  'geo.anzahl_etagen': G('Anzahl Etagen'),
  'geo.lage_im_bau': T('Lage im Bau'),
  'geo.lage_gebiet': T('Gebiet'),
  // ── preise
  'preise.kaufpreis': Z('Kaufpreis', '€'),
  'preise.kaufpreis_auf_anfrage': B('Kaufpreis auf Anfrage'),
  'preise.kaufpreis_pro_qm': Z('Kaufpreis je m²', '€/m²'),
  'preise.kaufpreisnetto': Z('Kaufpreis netto', '€'),
  'preise.kaufpreisbrutto': Z('Kaufpreis brutto', '€'),
  'preise.nettokaltmiete': Z('Nettokaltmiete', '€'),
  'preise.kaltmiete': Z('Kaltmiete', '€'),
  'preise.warmmiete': Z('Warmmiete', '€'),
  'preise.nebenkosten': Z('Nebenkosten', '€'),
  'preise.heizkosten': Z('Heizkosten', '€'),
  'preise.heizkosten_enthalten': B('Heizkosten enthalten'),
  'preise.hausgeld': Z('Hausgeld', '€'),
  'preise.mieteinnahmen_ist_monat': Z('Mieteinnahmen Ist je Monat', '€'),
  'preise.mieteinnahmen_ist_jahr': Z('Mieteinnahmen Ist je Jahr', '€'),
  'preise.mieteinnahmen_soll_monat': Z('Mieteinnahmen Soll je Monat', '€'),
  'preise.mieteinnahmen_soll_jahr': Z('Mieteinnahmen Soll je Jahr', '€'),
  'preise.x_fache': Z('Kaufpreisfaktor (x-fache)'),
  'preise.nettorendite': Z('Nettorendite', '%'),
  'preise.nettorendite_ist': Z('Nettorendite Ist', '%'),
  'preise.nettorendite_soll': Z('Nettorendite Soll', '%'),
  'preise.aussen_courtage': T('Käuferprovision'),
  'preise.innen_courtage': T('Innenprovision'),
  'preise.courtage_hinweis': T('Provisionshinweis'),
  'preise.provisionspflichtig': B('Provisionspflichtig'),
  'preise.mwst_satz': Z('MwSt.-Satz', '%'),
  'preise.zzg_mehrwertsteuer': B('zzgl. MwSt.'),
  'preise.erbpacht': T('Erbpacht / Erbbauzins'),
  'preise.erschliessungskosten': Z('Erschließungskosten', '€'),
  'preise.kaution': T('Kaution'),
  'preise.stp_garage': Z('Preis Garage', '€'),
  'preise.stp_tiefgarage': Z('Preis Tiefgarage', '€'),
  'preise.stp_carport': Z('Preis Carport', '€'),
  'preise.stp_freiplatz': Z('Preis Außenstellplatz', '€'),
  'preise.freitext_preis': T('Preis (Freitext)'),
  'preise.instandhaltungsruecklage': Z('Instandhaltungsrücklage', '€'),
  // ── flaechen
  'flaechen.wohnflaeche': Z('Wohnfläche', 'm²'),
  'flaechen.nutzflaeche': Z('Nutzfläche', 'm²'),
  'flaechen.gesamtflaeche': Z('Gesamtfläche', 'm²'),
  'flaechen.ladenflaeche': Z('Ladenfläche', 'm²'),
  'flaechen.bueroflaeche': Z('Bürofläche', 'm²'),
  'flaechen.lagerflaeche': Z('Lagerfläche', 'm²'),
  'flaechen.gastroflaeche': Z('Gastronomiefläche', 'm²'),
  'flaechen.vermietbare_flaeche': Z('Vermietbare Fläche', 'm²'),
  'flaechen.grundstuecksflaeche': Z('Grundstücksfläche', 'm²'),
  'flaechen.kellerflaeche': Z('Kellerfläche', 'm²'),
  'flaechen.dachbodenflaeche': Z('Dachbodenfläche', 'm²'),
  'flaechen.gartenflaeche': Z('Gartenfläche', 'm²'),
  'flaechen.balkon_terrasse_flaeche': Z('Balkon-/Terrassenfläche', 'm²'),
  'flaechen.anzahl_zimmer': Z('Zimmer'),
  'flaechen.anzahl_schlafzimmer': G('Schlafzimmer'),
  'flaechen.anzahl_badezimmer': G('Badezimmer'),
  'flaechen.anzahl_balkone': G('Balkone'),
  'flaechen.anzahl_terrassen': G('Terrassen'),
  'flaechen.anzahl_wohneinheiten': G('Wohneinheiten', 'Stück'),
  'flaechen.anzahl_gewerbeeinheiten': G('Gewerbeeinheiten', 'Stück'),
  'flaechen.anzahl_stellplaetze': G('Stellplätze', 'Stück'),
  'flaechen.grz': Z('GRZ'),
  'flaechen.gfz': Z('GFZ'),
  'flaechen.bgf': Z('Bruttogrundfläche', 'm²'),
  // ── ausstattung
  'ausstattung.ausstatt_kategorie': T('Ausstattungsqualität'),
  'ausstattung.heizungsart': T('Heizungsart'),
  'ausstattung.befeuerung': T('Befeuerung / Energieträger'),
  'ausstattung.warmwasser': T('Warmwasser'),
  'ausstattung.fahrstuhl': T('Aufzug'),
  'ausstattung.stellplatzart': T('Stellplatzart'),
  'ausstattung.bad': T('Bad'),
  'ausstattung.kueche': T('Küche'),
  'ausstattung.boden': T('Bodenbelag'),
  'ausstattung.fenster': T('Fenster'),
  'ausstattung.dachform': T('Dachform'),
  'ausstattung.bauweise': T('Bauweise'),
  'ausstattung.unterkellert': T('Unterkellert'),
  'ausstattung.balkon_terrasse': T('Balkon / Terrasse'),
  'ausstattung.garten': T('Garten'),
  'ausstattung.barrierefrei': T('Barrierefrei'),
  'ausstattung.wasch_trockenraum': T('Wasch-/Trockenraum'),
  'ausstattung.abstellraum': T('Abstellraum'),
  'ausstattung.fahrradraum': T('Fahrradraum'),
  'ausstattung.kabel_sat_tv': T('Kabel/Sat-TV'),
  'ausstattung.breitband_zugang': T('Breitband'),
  'ausstattung.sicherheitstechnik': T('Sicherheitstechnik'),
  'ausstattung.rolladen': T('Rollläden'),
  'ausstattung.merkmal': T('Ausstattungsmerkmal'),
  // ── zustand_angaben (inkl. Energiepass)
  'zustand_angaben.baujahr': J('Baujahr'),
  'zustand_angaben.letztemodernisierung': T('Letzte Modernisierung'),
  'zustand_angaben.zustand': T('Zustand'),
  'zustand_angaben.alter': T('Alter'),
  'zustand_angaben.erschliessung': T('Erschließung'),
  'zustand_angaben.bebaubar_nach': T('Bebaubar nach'),
  'zustand_angaben.altlasten': T('Altlasten'),
  'zustand_angaben.verkaufstatus': T('Verkaufsstatus'),
  'zustand_angaben.energiepass.epart': T('Energieausweis Art'),
  'zustand_angaben.energiepass.gueltig_bis': D('Energieausweis gültig bis'),
  'zustand_angaben.energiepass.ausstelldatum': D('Energieausweis ausgestellt'),
  'zustand_angaben.energiepass.energieverbrauchkennwert': Z('Energieverbrauchskennwert', 'kWh/(m²·a)'),
  'zustand_angaben.energiepass.endenergiebedarf': Z('Endenergiebedarf', 'kWh/(m²·a)'),
  'zustand_angaben.energiepass.primaerenergiebedarf': Z('Primärenergiebedarf', 'kWh/(m²·a)'),
  'zustand_angaben.energiepass.mitwarmwasser': B('Energiekennwert mit Warmwasser'),
  'zustand_angaben.energiepass.primaerenergietraeger': T('Wesentlicher Energieträger'),
  'zustand_angaben.energiepass.wertklasse': T('Energieeffizienzklasse'),
  'zustand_angaben.energiepass.baujahr': J('Baujahr laut Energieausweis'),
  'zustand_angaben.energiepass.gebaeudeart': T('Gebäudeart (Energieausweis)'),
  // ── bewertung, infrastruktur
  'bewertung.feld': T('Bewertung'),
  'infrastruktur.distanz': T('Entfernung'),
  'infrastruktur.ausblick': T('Ausblick'),
  'infrastruktur.verkehr': T('Verkehrsanbindung'),
  // ── freitexte (immer vollständig wörtlich)
  'freitexte.objekttitel': T('Titel'),
  'freitexte.dreizeiler': T('Kurzbeschreibung'),
  'freitexte.lage': T('Lagebeschreibung'),
  'freitexte.ausstatt_beschr': T('Ausstattungsbeschreibung'),
  'freitexte.objektbeschreibung': T('Objektbeschreibung'),
  'freitexte.sonstige_angaben': T('Sonstige Angaben'),
  // ── verwaltung_objekt, verwaltung_techn
  'verwaltung_objekt.verfuegbar_ab': T('Verfügbar ab'),
  'verwaltung_objekt.vermietet': T('Vermietet'),
  'verwaltung_objekt.denkmalgeschuetzt': T('Denkmalschutz'),
  'verwaltung_objekt.gewerbliche_nutzung': T('Gewerbliche Nutzung'),
  'verwaltung_objekt.wbs_sozialwohnung': T('WBS / Sozialbindung'),
  'verwaltung_objekt.hausverwaltung': T('Hausverwaltung'),
  'verwaltung_objekt.teilungserklaerung': T('Teilungserklärung / WEG'),
  'verwaltung_objekt.besichtigung': T('Besichtigung'),
  'verwaltung_techn.objektnr_extern': T('Objekt-Nr. (Anbieter)'),
  'verwaltung_techn.stand_vom': D('Stand vom'),
  // ── kontaktperson (je Kontakt; `kontakt` der Angabe sagt, welcher)
  'kontaktperson.anrede': T('Anrede'),
  'kontaktperson.titel': T('Titel'),
  'kontaktperson.vorname': T('Vorname'),
  'kontaktperson.name': T('Name'),
  'kontaktperson.position': T('Position'),
  'kontaktperson.firma': T('Firma'),
  'kontaktperson.strasse': T('Straße'),
  'kontaktperson.hausnummer': T('Hausnummer'),
  'kontaktperson.plz': T('PLZ'),
  'kontaktperson.ort': T('Ort'),
  'kontaktperson.tel_zentrale': T('Telefon Zentrale'),
  'kontaktperson.tel_durchw': T('Telefon Durchwahl'),
  'kontaktperson.tel_handy': T('Mobil'),
  'kontaktperson.tel_fax': T('Fax'),
  'kontaktperson.email_direkt': T('E-Mail'),
  'kontaktperson.email_zentrale': T('E-Mail Zentrale'),
  'kontaktperson.url': T('Webseite'),
  // ── anbieter
  'anbieter.firma': T('Anbieter'),
  'anbieter.impressum': T('Impressum'),
  // ── gg-Erweiterung
  'gg.bruttorendite': Z('Bruttorendite (angegeben)', '%'),
  'gg.heizung_baujahr': J('Baujahr Heizung'),
  'gg.sanierung': T('Sanierung / Modernisierung'),
  'gg.kontakt_rolle': T('Rolle des Kontakts'),
  'gg.leerstand': T('Leerstand'),
  'gg.mietvertraege': T('Mietverträge'),
  'gg.rechte_lasten': T('Rechte und Lasten'),
  'gg.verkaufsablauf': T('Verkaufsablauf'),
};

export const KATALOG_PFADE = Object.keys(KATALOG) as [string, ...string[]];

export const gruppeVonPfad = (pfad: string | null): string => (pfad ? pfad.split('.')[0]! : 'ohne');

/** Spalten einer Mietliste (gif-Mieterebene); `feld` je Spaltenüberschrift, Rest bleibt mit Überschrift erhalten. */
export const EINHEIT_FELDER = {
  nr: T('Nr.'), typ: T('Art'), lage: T('Lage'), zimmer: Z('Zimmer'), flaeche: Z('Fläche', 'm²'),
  kaltmiete: Z('Kaltmiete', '€'), nebenkosten: Z('Nebenkosten', '€'), warmmiete: Z('Warmmiete', '€'), sollmiete: Z('Soll-Miete', '€'),
  status: T('Status'), mietbeginn: T('Mietbeginn'), mietende: T('Mietende'),
} satisfies Record<string, KatalogEintrag>;
export type EinheitFeld = keyof typeof EINHEIT_FELDER;
export const EINHEIT_FELD_NAMEN = Object.keys(EINHEIT_FELDER) as [EinheitFeld, ...EinheitFeld[]];
