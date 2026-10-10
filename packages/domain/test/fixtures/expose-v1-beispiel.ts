import { exposeV1Leer, type ExposeV1 } from '../../src/index.ts';

/** Ein v1-Ergebnis, wie es die KI für ein kleines Mehrfamilienhaus liefern würde. */
export function beispielV1(): ExposeV1 {
  const v1 = exposeV1Leer();
  v1.dokument = { objektnr_extern: '1072081', datum: null, titel: 'MFH in Stuttgart' };
  v1.objektkategorie = { nutzungsart: 'WOHNEN', objektart: 'Mehrfamilienhaus' };
  v1.geo = { strasse: 'Musterweg', hausnummer: '12', plz: '70173', ort: 'Stuttgart', bundesland: 'Baden-Württemberg', etage_anzahl: 3 };
  v1.preise = {
    kaufpreis: 1_250_000, provision_text: '3,57 % inkl. MwSt.', provision_prozent: 3.57, nebenkosten_monat: null, hausgeld_monat: null,
    mieteinnahmen_ist_monat: 5000, mieteinnahmen_soll_monat: 5600, x_fache_angegeben: 20.8, bruttorendite_angegeben: 4.8,
  };
  v1.flaechen = { wohnflaeche: 480.5, nutzflaeche: null, gewerbeflaeche: null, grundstuecksflaeche: 620, anzahl_stellplaetze: 2 };
  v1.ausstattung = { heizungsart: 'Gas-Zentralheizung', energietraeger: 'Gas', merkmale: ['Balkon', 'Keller'] };
  v1.zustand = { baujahr: 1962, heizung_baujahr: 2015, sanierungen: [{ jahr: 2015, was: 'Heizung erneuert' }], zustand_text: 'gepflegt', denkmalschutz: false, erbpacht: null };
  v1.energiepass = { art: 'Verbrauchsausweis', klasse: 'D', kennwert: 118, gueltig_bis: '2031' };
  v1.verwaltung = { anzahl_wohneinheiten: 6, anzahl_gewerbeeinheiten: 0, verfuegbar_ab: null, einheiten_anzahl_dokument: 7, einheiten_vollstaendig: true };
  v1.einheiten = [
    { typ: 'Wohnung', lage: 'EG links', zimmer: 3, flaeche: 85.5, kaltmiete: 780, nebenkosten: 180, sollmiete: null, vermiet: 'Vermietet', mietbeginn: '01.03.2019', _seite: 4 },
    { typ: 'Wohnung', lage: 'EG rechts', zimmer: 2, flaeche: null, kaltmiete: null, nebenkosten: null, sollmiete: 650, vermiet: 'Leerstand', mietbeginn: null, _seite: 4 },
    { typ: 'Stellplatz', lage: 'TG-01', zimmer: null, flaeche: null, kaltmiete: 40, nebenkosten: null, sollmiete: null, vermiet: 'Vermietet', mietbeginn: null, _seite: 4 },
  ];
  v1.freitexte = { lage: 'Ruhige Wohnlage', ausstattung: 'Fenster 2015', objektbeschreibung: null, sonstiges: 'Besichtigung nach Absprache' };
  v1.kontaktperson = {
    anrede: 'Frau', titel: null, vorname: 'Anna', name: 'Beispiel', position: 'Sachbearbeitung', firma: 'Immo GmbH',
    strasse: 'Königstraße 1', plz: '70173', ort: 'Stuttgart', tel_zentrale: '0711 123456', tel_durchwahl: '0711 123457',
    mobil: '0171 1234567', fax: '0711 123458', email: 'anna@immo.test', web: 'www.immo.test',
  };
  v1.weitere_kontakte = [{ name: 'Bodo Büro', rolle: 'Geschäftsführer', tel: '0711 999', mobil: null, email: 'bodo@immo.test' }];
  v1.weitere_angaben = [{ gruppe: 'verwaltung', bezeichnung: 'Instandhaltungsrücklage', wert: '12.000 €', einheit: '€', seite: 5 }];
  v1.belege = {
    kaufpreis: { seite: 2, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch' },
    istmiete: { seite: 3, zitat: 'Jahresnettokaltmiete 60.000 €', konfidenz: 'mittel' },
    wohnflaeche: { seite: 2, zitat: 'Wohnfläche ca. 480,5 m²', konfidenz: 'hoch' },
    grundstueck: { seite: 2, zitat: 'Grundstück 620 m²', konfidenz: 'hoch' },
    baujahr: { seite: 2, zitat: 'Baujahr 1962', konfidenz: 'hoch' },
    anzahl_we: { seite: 2, zitat: '6 Wohneinheiten', konfidenz: 'hoch' },
    energiekennwert: { seite: 6, zitat: 'Endenergieverbrauch 118 kWh/(m²·a)', konfidenz: 'hoch' },
    adresse: { seite: 1, zitat: 'Musterweg 12, 70173 Stuttgart', konfidenz: 'hoch' },
  };
  return v1;
}
