import { EXPOSE_V2_SCHEMA, type ErfassteAngabe, type ExposeV2 } from '../../src/index.ts';

const A = (bezeichnung: string, wert: string, seite: number | null, pfad: string | null, extra: Partial<ErfassteAngabe> = {}): ErfassteAngabe =>
  ({ bezeichnung, wert, seite, pfad, kontakt: null, gg: null, ...extra });

/** Erfundenes Mehrfamilienhaus: drei Wohnungen, ein Stellplatz, ein Makler, ein zweiter Ansprechpartner. */
export function exposeV2Beispiel(): ExposeV2 {
  return {
    schema: EXPOSE_V2_SCHEMA,
    felder: null,
    angaben: [
      A('Objekt', 'Gepflegtes Mehrfamilienhaus in Ulm', 1, 'freitexte.objekttitel'),
      A('Adresse', 'Musterweg 12, 89073 Ulm', 1, 'geo.strasse'),
      A('Kaufpreis', '1.250.000,00 €', 1, 'preise.kaufpreis'),
      A('Käuferprovision', '3,57 % inkl. MwSt.', 1, 'preise.aussen_courtage'),
      A('Jahresnettokaltmiete (Ist)', '27.840 €', 2, 'preise.mieteinnahmen_ist_jahr'),
      A('Faktor', '22,9-fach', 2, 'preise.x_fache'),
      A('Wohnfläche ca.', '240 m²', 2, 'flaechen.wohnflaeche'),
      A('Grundstück', '480 m²', 2, 'flaechen.grundstuecksflaeche'),
      A('Wohneinheiten', '3', 2, 'flaechen.anzahl_wohneinheiten'),
      A('Baujahr', 'ca. 1965', 2, 'zustand_angaben.baujahr'),
      A('Heizung', 'Gas-Zentralheizung', 2, 'ausstattung.heizungsart'),
      A('Heizung erneuert', '2018', 2, 'gg.heizung_baujahr'),
      A('Aufzug', 'nein', 2, 'ausstattung.fahrstuhl'),
      A('Dach', '2015 neu eingedeckt', 2, 'gg.sanierung'),
      A('Energieausweis', 'Verbrauchsausweis', 3, 'zustand_angaben.energiepass.epart'),
      A('Endenergieverbrauch', '128,4 kWh/(m²·a)', 3, 'zustand_angaben.energiepass.energieverbrauchkennwert'),
      A('Effizienzklasse', 'D', 3, 'zustand_angaben.energiepass.wertklasse'),
      A('Lage', 'Ruhige Wohnlage nahe der Innenstadt. Schulen und Einkauf fußläufig.', 3, 'freitexte.lage'),
      A('Instandhaltungsrücklage', '12.000 €', 3, null, { gg: 'details.instandhaltungsruecklage' }),
      A('Besichtigung', 'nach Vereinbarung', 3, 'verwaltung_objekt.besichtigung'),
      A('Kaufpreis', '1.300.000 €', 5, 'preise.kaufpreis'),
      A('Ansprechpartner', 'Anna', 6, 'kontaktperson.vorname', { kontakt: 1 }),
      A('Ansprechpartner', 'Beispiel', 6, 'kontaktperson.name', { kontakt: 1 }),
      A('Firma', 'Beispiel Immobilien GmbH', 6, 'kontaktperson.firma', { kontakt: 1 }),
      A('Mobil', '0171 1234567', 6, 'kontaktperson.tel_handy', { kontakt: 1 }),
      A('Telefon', '0731 98765-0', 6, 'kontaktperson.tel_zentrale', { kontakt: 1 }),
      A('E-Mail', 'anna@beispiel.test', 6, 'kontaktperson.email_direkt', { kontakt: 1 }),
      A('Büro', 'Hafenstraße 3, 89073 Ulm', 6, 'kontaktperson.strasse', { kontakt: 1 }),
      A('Vertretung', 'Max Zweit', 6, 'kontaktperson.name', { kontakt: 2 }),
      A('Telefon', '0731 555', 6, 'kontaktperson.tel_durchw', { kontakt: 2 }),
      A('Position', 'Teamleitung', 6, 'kontaktperson.position', { kontakt: 2 }),
    ],
    einheiten_tabellen: [{
      seite: 4, titel: 'Mieterliste',
      spalten: [
        { ueberschrift: 'Whg.', feld: 'nr' }, { ueberschrift: 'Lage', feld: 'lage' }, { ueberschrift: 'Zi.', feld: 'zimmer' },
        { ueberschrift: 'Wfl.', feld: 'flaeche' }, { ueberschrift: 'NKM', feld: 'kaltmiete' }, { ueberschrift: 'NK-VZ', feld: 'nebenkosten' },
        { ueberschrift: 'Mietbeginn', feld: 'mietbeginn' }, { ueberschrift: 'Kaution', feld: null },
      ],
      zeilen: [
        ['1', 'EG', '3', '80,00', '800,00 €', '150 €', '01.01.2020', '2.400 €'],
        ['2', 'OG', '3', '80,00', '820,00 €', '', '', ''],
        ['3', 'DG', '2,5', '80,00', 'leer', '', '', ''],
        ['TG 1', 'Tiefgarage', '', '', '60,00 €', '', '', ''],
        ['Summe', '', '', '240,00', '1.680,00 €', '', '', ''],
      ],
    }],
    einheiten_im_dokument: 4,
    einheiten_vollstaendig: true,
  };
}

/** Seitentexte zum Beispiel (Textlayer), damit die Belegprüfung etwas findet. */
export const BEISPIEL_SEITEN = [
  'Gepflegtes Mehrfamilienhaus in Ulm\nMusterweg 12, 89073 Ulm\nKaufpreis: 1.250.000,00 €\nKäuferprovision 3,57 % inkl. MwSt.',
  'Jahresnettokaltmiete (Ist) 27.840 € Faktor 22,9-fach Wohnfläche ca. 240 m² Grundstück 480 m²',
  'Energieausweis: Verbrauchsausweis',
];

/** Teil A wie vom bisherigen Prompt: die KI hat die gg-Felder gedeutet (Adresse getrennt, Jahresmiete schon als Monat …). */
export function exposeV2MitFeldern(): ExposeV2 {
  const v2 = exposeV2Beispiel();
  v2.felder = {
    objekt: {
      strasse: 'Musterweg', hausnr: '12', plz: '89073', stadt: 'Ulm', bundesland: 'Baden-Württemberg', baujahr: 1965, wohnflaeche: 240,
      grundstueck: 480, einheitenAnz: 3, angebotspreis: 1_250_000, istmiete: 2320, bruttorendite: 2.23, heizungsart: 'Gas-Zentralheizung',
      heizungsbaujahr: null, energieausweis: { klasse: 'D', kennwert: 128.4, art: 'Verbrauchsausweis' }, lagebeschreibung: 'Ruhige Wohnlage.',
      ausstattung: 'Balkon, Keller', notizen: null,
      einheiten: [
        { typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, kaltmiete: 800, vermiet: 'Vermietet' },
        { typ: 'Wohnung', lage: 'OG', zimmer: 3, flaeche: 80, kaltmiete: 820, vermiet: 'Vermietet' },
        { typ: 'Wohnung', lage: 'DG', zimmer: 2.5, flaeche: 80, kaltmiete: 0, vermiet: 'Leerstand' },
        { typ: 'Stellplatz', lage: 'TG', zimmer: null, flaeche: null, kaltmiete: 60, vermiet: 'Vermietet' },
      ],
    },
    makler: { name: 'Anna Beispiel', firma: 'Beispiel Immobilien GmbH', mobiltel: '0171 1234567', festnetztel: '0731 98765-0', email: 'anna@beispiel.test', alleNamen: ['Anna Beispiel'] },
    kalkulation: { kaufpreis: 1_250_000, makler: 3.57, gest: 5 },
    _konfidenz: { angebotspreis: 'hoch', wohnflaeche: 'hoch' },
  };
  return v2;
}
