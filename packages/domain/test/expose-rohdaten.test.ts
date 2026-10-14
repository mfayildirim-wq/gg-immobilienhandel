import { describe, expect, it } from 'vitest';
import { bezeichnungZuPfad, DOKUMENT_VERSION, type Dokument, EXPOSE_V2_SCHEMA, rohdatenAusDokument, spaltenFeld, zuordnen } from '../src/index.ts';

/** Synthetisches Dokument: je Seite die Zeilen (Zellen); alle Werte erfunden. */
const dok = (...seiten: string[][][]): Dokument => ({
  version: DOKUMENT_VERSION,
  seitenGesamt: seiten.length,
  seiten: seiten.map((zeilen, i) => ({ nr: i + 1, typ: 'text' as const, zeilen, ocr: null })),
});

const roh = (...seiten: string[][][]) => rohdatenAusDokument(dok(...seiten));
const finde = (r: ReturnType<typeof roh>, bez: string) => r.angaben.find((a) => a.bezeichnung === bez);

describe('Rohdaten: Wörterbuch bezeichnungZuPfad', () => {
  it.each([
    ['Kaufpreis', 'preise.kaufpreis'], ['KP', 'preise.kaufpreis'], ['Angebotspreis', 'preise.kaufpreis'], ['Preis', 'preise.kaufpreis'],
    ['Käuferprovision', 'preise.aussen_courtage'], ['Provision', 'preise.aussen_courtage'], ['Courtage', 'preise.aussen_courtage'], ['Maklerprovision', 'preise.aussen_courtage'],
    ['Faktor', 'preise.x_fache'], ['Kaufpreisfaktor', 'preise.x_fache'], ['x-fache', 'preise.x_fache'],
    ['Rendite', 'gg.bruttorendite'], ['Bruttorendite', 'gg.bruttorendite'],
    ['Wohnfläche', 'flaechen.wohnflaeche'], ['Wfl.', 'flaechen.wohnflaeche'], ['Gesamtwohnfläche', 'flaechen.wohnflaeche'],
    ['Grundstück', 'flaechen.grundstuecksflaeche'], ['Grundstücksfläche', 'flaechen.grundstuecksflaeche'],
    ['Nutzfläche', 'flaechen.nutzflaeche'],
    ['Wohneinheiten', 'flaechen.anzahl_wohneinheiten'], ['WE', 'flaechen.anzahl_wohneinheiten'], ['Anzahl Wohnungen', 'flaechen.anzahl_wohneinheiten'],
    ['Gewerbeeinheiten', 'flaechen.anzahl_gewerbeeinheiten'],
    ['Stellplätze', 'flaechen.anzahl_stellplaetze'], ['Garagen', 'flaechen.anzahl_stellplaetze'], ['Anzahl Garagen', 'flaechen.anzahl_stellplaetze'], ['TG-Stellplätze', 'flaechen.anzahl_stellplaetze'],
    ['Baujahr', 'zustand_angaben.baujahr'], ['Bj.', 'zustand_angaben.baujahr'], ['Baujahr ca.', 'zustand_angaben.baujahr'], ['Fertigstellung', 'zustand_angaben.baujahr'],
    ['Heizung', 'ausstattung.heizungsart'], ['Heizungsart', 'ausstattung.heizungsart'],
    ['Energieträger', 'ausstattung.befeuerung'], ['Befeuerung', 'ausstattung.befeuerung'], ['Hauptenergieträger', 'ausstattung.befeuerung'],
    ['Energieeffizienzklasse', 'zustand_angaben.energiepass.wertklasse'], ['Effizienzklasse', 'zustand_angaben.energiepass.wertklasse'], ['Energieklasse', 'zustand_angaben.energiepass.wertklasse'],
    ['Endenergiebedarf', 'zustand_angaben.energiepass.endenergiebedarf'], ['Endenergieverbrauch', 'zustand_angaben.energiepass.energieverbrauchkennwert'], ['Energiekennwert', 'zustand_angaben.energiepass.energieverbrauchkennwert'],
    ['Energieausweisart', 'zustand_angaben.energiepass.epart'],
    ['Hausgeld', 'preise.hausgeld'], ['Nebenkosten', 'preise.nebenkosten'], ['Instandhaltungsrücklage', 'preise.instandhaltungsruecklage'],
    ['Objekt-Nr.', 'verwaltung_techn.objektnr_extern'], ['Objektnummer', 'verwaltung_techn.objektnr_extern'], ['Kennung', 'verwaltung_techn.objektnr_extern'],
    ['Verfügbar ab', 'verwaltung_objekt.verfuegbar_ab'], ['Bezugsfrei', 'verwaltung_objekt.verfuegbar_ab'],
    ['Denkmalschutz', 'verwaltung_objekt.denkmalgeschuetzt'], ['Zustand', 'zustand_angaben.zustand'],
    ['Modernisierung', 'gg.sanierung'], ['Sanierung', 'gg.sanierung'],
    ['Etagen', 'geo.anzahl_etagen'], ['Geschosse', 'geo.anzahl_etagen'], ['Zimmer', 'flaechen.anzahl_zimmer'],
    ['Adresse', 'geo.strasse'], ['Straße', 'geo.strasse'], ['PLZ', 'geo.plz'], ['Ort', 'geo.ort'], ['Objektart', 'objektkategorie.objektart'], ['Objekttyp', 'objektkategorie.objektart'],
    ['Ansprechpartner', 'kontaktperson.name'], ['Firma', 'kontaktperson.firma'], ['Telefon', 'kontaktperson.tel_zentrale'], ['Mobil', 'kontaktperson.tel_handy'], ['Fax', 'kontaktperson.tel_fax'], ['E-Mail', 'kontaktperson.email_direkt'], ['Web', 'kontaktperson.url'],
  ])('%s → %s', (bez, pfad) => {
    expect(bezeichnungZuPfad(bez)).toBe(pfad);
  });

  it('Schreibweise egal: Doppelpunkt, Groß-/Kleinschreibung, Umlaute, Ersatzschreibung, Zusätze', () => {
    expect(bezeichnungZuPfad('KAUFPREIS:')).toBe('preise.kaufpreis');
    expect(bezeichnungZuPfad('Grundstuecksflaeche')).toBe('flaechen.grundstuecksflaeche');
    expect(bezeichnungZuPfad('grundstücksfläche (ca.)')).toBe('flaechen.grundstuecksflaeche');
    expect(bezeichnungZuPfad('Wohnfläche ca.')).toBe('flaechen.wohnflaeche');
    expect(bezeichnungZuPfad('Gesamtwohnfläche insgesamt')).toBe('flaechen.wohnflaeche');
    expect(bezeichnungZuPfad('Käuferprovision inkl. MwSt.')).toBe('preise.aussen_courtage');
    expect(bezeichnungZuPfad('Kaufpreis zuzüglich Erwerbsnebenkosten')).toBeNull(); // unbekannter Zusatz → lieber null
  });

  it('Miete: Jahr/Monat und Ist/Soll am Wortlaut von Bezeichnung oder Wert', () => {
    expect(bezeichnungZuPfad('Ist-Miete')).toBe('preise.mieteinnahmen_ist_monat');
    expect(bezeichnungZuPfad('Jahresnettokaltmiete')).toBe('preise.mieteinnahmen_ist_jahr');
    expect(bezeichnungZuPfad('Nettokaltmiete p.a.')).toBe('preise.mieteinnahmen_ist_jahr');
    expect(bezeichnungZuPfad('Mieteinnahmen p.a. (Ist)')).toBe('preise.mieteinnahmen_ist_jahr');
    expect(bezeichnungZuPfad('Mieteinnahmen pro Monat')).toBe('preise.mieteinnahmen_ist_monat');
    expect(bezeichnungZuPfad('Soll-Miete')).toBe('preise.mieteinnahmen_soll_monat');
    expect(bezeichnungZuPfad('Sollmiete p.a.')).toBe('preise.mieteinnahmen_soll_jahr');
    expect(bezeichnungZuPfad('Marktmiete')).toBe('preise.mieteinnahmen_soll_monat');
    // ohne Zeitangabe im Namen entscheidet der Wert
    expect(bezeichnungZuPfad('Ist-Miete', '72.200 € p.a.')).toBe('preise.mieteinnahmen_ist_jahr');
    expect(bezeichnungZuPfad('Nettokaltmiete', '5.100 € / Monat')).toBe('preise.mieteinnahmen_ist_monat');
    // ohne jede Zeitangabe: kein Raten
    expect(bezeichnungZuPfad('Nettokaltmiete')).toBe('preise.nettokaltmiete');
    expect(bezeichnungZuPfad('Kaltmiete')).toBe('preise.kaltmiete');
    expect(bezeichnungZuPfad('Miete je m²')).toBeNull();
  });

  it('mehrdeutig oder unbekannt → null', () => {
    for (const b of ['Gewerbefläche', 'Einheiten', 'Name', 'Titel', 'Flur', 'Soll-Rendite', 'Irgendetwas Unbekanntes', '']) expect(bezeichnungZuPfad(b)).toBeNull();
  });

  it('Energieausweis ohne Zusatz: der Wert entscheidet', () => {
    expect(bezeichnungZuPfad('Energieausweis', 'B')).toBe('zustand_angaben.energiepass.wertklasse');
    expect(bezeichnungZuPfad('Energieausweis', 'Verbrauchsausweis')).toBe('zustand_angaben.energiepass.epart');
    expect(bezeichnungZuPfad('Energieausweis', 'liegt vor')).toBeNull();
  });
});

describe('Rohdaten: Bezeichnung und Wert', () => {
  it('zwei Zellen in einer Zeile, auch mit Doppelpunkt; Bezeichnung und Wert wörtlich', () => {
    const r = roh([
      ['Kaufpreis', '1.250.000,00 €'], ['Baujahr:', 'ca. 1965'], ['Wohnfläche', 'ca. 410,5 m²'], ['Zustand', 'gepflegt'],
    ]);
    expect(finde(r, 'Kaufpreis')).toMatchObject({ wert: '1.250.000,00 €', seite: 1, pfad: 'preise.kaufpreis', kontakt: null, gg: null });
    expect(finde(r, 'Baujahr')).toMatchObject({ wert: 'ca. 1965', pfad: 'zustand_angaben.baujahr' });
    expect(finde(r, 'Wohnfläche')).toMatchObject({ wert: 'ca. 410,5 m²', pfad: 'flaechen.wohnflaeche' });
    expect(finde(r, 'Zustand')).toMatchObject({ wert: 'gepflegt', pfad: 'zustand_angaben.zustand' });
  });

  it('eine Zelle „Bezeichnung: Wert“', () => {
    const r = roh([['Kaufpreis: 890.000 EUR'], ['Objekt-Nr.: BSP-4711'], ['Hinweis zum Termin: 12:30 Uhr am Objekt']]);
    expect(finde(r, 'Kaufpreis')).toMatchObject({ wert: '890.000 EUR', pfad: 'preise.kaufpreis' });
    expect(finde(r, 'Objekt-Nr.')).toMatchObject({ wert: 'BSP-4711', pfad: 'verwaltung_techn.objektnr_extern' });
  });

  it('Bezeichnung und Wert in einer Zelle ohne Doppelpunkt (bekannte Bezeichnung), auch Wert vor Bezeichnung', () => {
    const r = roh([['KAUFPREIS 2.100.000 €'], ['Zentral · Baujahr 1970 · ruhig'], ['7,5 % RENDITE | 34 EINHEITEN']]);
    expect(finde(r, 'KAUFPREIS')).toMatchObject({ wert: '2.100.000 €', pfad: 'preise.kaufpreis' });
    expect(finde(r, 'Baujahr')).toMatchObject({ wert: '1970', pfad: 'zustand_angaben.baujahr' });
    expect(finde(r, 'RENDITE')).toMatchObject({ wert: '7,5 %', pfad: 'gg.bruttorendite' });
    expect(finde(r, 'EINHEITEN')).toMatchObject({ wert: '34' });
  });

  it('vier und sechs Zellen als Paare', () => {
    const r = roh([
      ['Baujahr', '1988', 'Wohneinheiten', '12'],
      ['Heizung', 'Fernwärme', 'Etagen', '4', 'Zimmer', '36'],
    ]);
    expect(finde(r, 'Baujahr')?.wert).toBe('1988');
    expect(finde(r, 'Wohneinheiten')).toMatchObject({ wert: '12', pfad: 'flaechen.anzahl_wohneinheiten' });
    expect(finde(r, 'Heizung')).toMatchObject({ wert: 'Fernwärme', pfad: 'ausstattung.heizungsart' });
    expect(finde(r, 'Etagen')).toMatchObject({ wert: '4', pfad: 'geo.anzahl_etagen' });
    expect(finde(r, 'Zimmer')).toMatchObject({ wert: '36', pfad: 'flaechen.anzahl_zimmer' });
  });

  it('zwei Bezeichnungen nebeneinander sind kein Paar', () => {
    const r = roh([['Wohneinheiten', 'Grundstücksfläche', 'Garagen', 'Baujahr']]);
    expect(r.angaben).toHaveLength(0);
  });

  it('Bezeichnung und Wert in aufeinanderfolgenden Zeilen', () => {
    const r = roh([['Vermittlungsprovision'], ['3,57 %'], ['Objekt-Nr.'], ['BSP-1']]);
    expect(finde(r, 'Vermittlungsprovision')).toMatchObject({ wert: '3,57 %', pfad: 'preise.aussen_courtage' });
    expect(finde(r, 'Objekt-Nr.')).toMatchObject({ wert: 'BSP-1', pfad: 'verwaltung_techn.objektnr_extern' });
  });

  it('Pfad nur, wenn der Wert passt: Anzahl mit Betrag, Adresse ohne Anschrift, Jahr ohne Jahreszahl', () => {
    const r = roh([
      ['Wohnungen (Soll)', 'ca. 68.800 € p.a.'], ['Lage', 'Innenstadt'], ['Baujahr', 'unbekannt'], ['Faktor', '7,20 %'],
      ['Stellplätze:', 'Tiefgarage'], ['Adresse', 'Musterweg 12, 12345 Beispielstadt'],
    ]);
    expect(finde(r, 'Wohnungen (Soll)')?.pfad).toBeNull();
    expect(finde(r, 'Lage')?.pfad).toBe('freitexte.lage'); // kurzer Text, keine Anschrift
    expect(finde(r, 'Baujahr')?.pfad).toBeNull();
    expect(finde(r, 'Faktor')?.pfad).toBeNull();
    expect(finde(r, 'Stellplätze')?.pfad).toBe('ausstattung.stellplatzart');
    expect(finde(r, 'Adresse')?.pfad).toBe('geo.strasse');
  });

  it('Lage mit Anschrift als Wert → geo.strasse, Standort mit Ort → geo.ort', () => {
    const r = roh([['Lage: Beispielallee 7, Beispielstadt'], ['Standort', 'Beispielstadt']]);
    expect(finde(r, 'Lage')?.pfad).toBe('geo.strasse');
    expect(finde(r, 'Standort')?.pfad).toBe('geo.ort');
  });

  it('Anschrift und „PLZ Ort“ ohne Beschriftung, bei Wiederholung in Kopfzeilen nur einmal', () => {
    const kopf = [['Musterweg 12, 12345 Beispielstadt'], ['Mehrfamilienhaus']];
    const r = roh(kopf, kopf, [['12345 Beispielstadt']]);
    const adr = r.angaben.filter((a) => a.pfad === 'geo.strasse');
    expect(adr).toHaveLength(1);
    expect(adr[0]).toMatchObject({ wert: 'Musterweg 12, 12345 Beispielstadt', seite: 1 });
  });

  it('Mieternamen werden nicht erfasst', () => {
    const r = roh([['Mieter', 'Erika Beispiel'], ['Mietername: Max Muster'], ['Kaufpreis', '500.000 €']]);
    expect(r.angaben.map((a) => a.bezeichnung)).toEqual(['Kaufpreis']);
  });

  it('Bild-Seiten: Rauschen fällt weg, Textpfade bleiben leer', () => {
    const d: Dokument = {
      version: DOKUMENT_VERSION, seitenGesamt: 1,
      seiten: [{ nr: 1, typ: 'bild', ocr: { sicherheit: 70, woerter: 10 }, zeilen: [['|', '=', '\\ |'], ['Küche', '1. OG'], ['Kaufpreis', '300.000 €']] }],
    };
    const r = rohdatenAusDokument(d);
    expect(finde(r, 'Kaufpreis')?.pfad).toBe('preise.kaufpreis');
    expect(finde(r, 'Küche')?.pfad).toBeNull();
    expect(r.angaben.some((a) => a.bezeichnung === '|')).toBe(false);
  });

  it('leere und nicht lesbare Seiten ergeben nichts', () => {
    const d: Dokument = { version: DOKUMENT_VERSION, seitenGesamt: 2, seiten: [{ nr: 1, typ: 'leer', zeilen: [], ocr: null }, { nr: 2, typ: 'text', zeilen: [[], ['']], ocr: null }] };
    expect(rohdatenAusDokument(d)).toEqual({ angaben: [], einheiten_tabellen: [], einheiten_im_dokument: null });
  });
});

describe('Rohdaten: Kopfzeile + Wertzeile (Kacheln)', () => {
  it('Werte unter den Bezeichnungen, in Spaltenreihenfolge', () => {
    const r = roh([['BAUJAHR', 'WOHNEINHEITEN', 'WOHNFLÄCHE', 'STELLPLÄTZE'], ['1972', '24', '1.560 m²', '18']]);
    expect(r.angaben.map((a) => [a.bezeichnung, a.wert, a.pfad])).toEqual([
      ['BAUJAHR', '1972', 'zustand_angaben.baujahr'], ['WOHNEINHEITEN', '24', 'flaechen.anzahl_wohneinheiten'],
      ['WOHNFLÄCHE', '1.560 m²', 'flaechen.wohnflaeche'], ['STELLPLÄTZE', '18', 'flaechen.anzahl_stellplaetze'],
    ]);
  });

  it('Werte über den Bezeichnungen (Zahlen oben)', () => {
    const r = roh([['17.985 €', '215.820 €'], ['NETTOKALTMIETE / MONAT', 'JAHRESNETTOKALTMIETE']]);
    expect(finde(r, 'NETTOKALTMIETE / MONAT')).toMatchObject({ wert: '17.985 €', pfad: 'preise.mieteinnahmen_ist_monat' });
    expect(finde(r, 'JAHRESNETTOKALTMIETE')).toMatchObject({ wert: '215.820 €', pfad: 'preise.mieteinnahmen_ist_jahr' });
  });

  it('Bezeichnung mit Zeilenumbruch in Klammern: nur eindeutige Paare', () => {
    // 503 m² und 607 m² könnten zu „Mietfläche“ oder „Grundstücksfläche“ gehören → nicht geraten
    const r = roh([['7', '503 m²', '607 m²', '4', '1963'], ['Mietfläche (lt.'], ['Wohneinheiten', 'Grundstücksfläche', 'Garagen', 'Baujahr'], ['Vertrag)']]);
    expect(r.angaben.map((a) => [a.bezeichnung, a.wert])).toEqual([['Wohneinheiten', '7'], ['Garagen', '4'], ['Baujahr', '1963']]);
  });

  it('Zeile mit drei Zellen: Überschrift + Paar', () => {
    const r = roh([['Preise', 'Nettomiete Ist p.a.', '292.000 €'], ['Kaltmiete', '292.000 €', 'Flächen']]);
    expect(finde(r, 'Nettomiete Ist p.a.')).toMatchObject({ wert: '292.000 €', pfad: 'preise.mieteinnahmen_ist_jahr' });
    expect(finde(r, 'Kaltmiete')).toMatchObject({ wert: '292.000 €', pfad: 'preise.kaltmiete' });
  });
});

describe('Rohdaten: Mietlisten', () => {
  const liste = [
    ['Mietaufstellung'],
    ['Whg.', 'Lage', 'Zi.', 'Fläche', 'Mieter', 'Kaltmiete', 'NK', 'Warmmiete', 'Status'],
    ['1', 'EG links', '3', '75,0 m²', 'Erika Beispiel', '650,00 €', '150,00 €', '800,00 €', 'vermietet'],
    ['2', 'EG rechts', '2', '54,0 m²', 'Max Muster', '480,00 €', '120,00 €', '600,00 €', 'vermietet'],
    ['3', 'OG links', '3', '76,5 m²', '', '0,00 €', '0,00 €', '0,00 €', 'leer'],
    ['Summe', '', '8', '205,5 m²', '', '1.130,00 €', '270,00 €', '1.400,00 €', ''],
  ];

  it('Kopfzeile erkannt: Felder per Synonym, Zeilen wörtlich, Summenzeile bleibt', () => {
    const r = roh(liste);
    expect(r.einheiten_tabellen).toHaveLength(1);
    const t = r.einheiten_tabellen[0]!;
    expect(t.seite).toBe(1);
    expect(t.titel).toBe('Mietaufstellung');
    expect(t.spalten.map((s) => s.feld)).toEqual(['nr', 'lage', 'zimmer', 'flaeche', 'kaltmiete', 'nebenkosten', 'warmmiete', 'status']);
    expect(t.spalten.map((s) => s.ueberschrift)).toEqual(['Whg.', 'Lage', 'Zi.', 'Fläche', 'Kaltmiete', 'NK', 'Warmmiete', 'Status']);
    expect(t.zeilen[0]).toEqual(['1', 'EG links', '3', '75,0 m²', '650,00 €', '150,00 €', '800,00 €', 'vermietet']);
    expect(t.zeilen).toHaveLength(4);
    expect(t.zeilen.at(-1)![0]).toBe('Summe');
  });

  it('Datenschutz: die Mieterspalte entfällt als Spalte und als Zelle', () => {
    const r = roh(liste);
    expect(JSON.stringify(r)).not.toMatch(/Erika|Beispiel|Max Muster/);
    expect(r.einheiten_tabellen[0]!.spalten.some((s) => /mieter/i.test(s.ueberschrift))).toBe(false);
    expect(r.einheiten_tabellen[0]!.zeilen.every((z) => z.length === 8)).toBe(true);
  });

  it('Warmmiete/Brutto ist nie Kaltmiete', () => {
    expect(spaltenFeld('Warmmiete')).toBe('warmmiete');
    expect(spaltenFeld('Bruttomiete*')).toBe('warmmiete');
    expect(spaltenFeld('Gesamtmiete inkl. NK')).toBe('warmmiete');
    expect(spaltenFeld('Brutto-Sollmiete')).toBe('warmmiete');
    expect(spaltenFeld('Kaltmiete')).toBe('kaltmiete');
    expect(spaltenFeld('NKM')).toBe('kaltmiete');
    expect(spaltenFeld('Miete kalt')).toBe('kaltmiete');
    expect(spaltenFeld('Soll-Miete')).toBe('sollmiete');
    expect(spaltenFeld('Mieter')).toBe('mieter');
    // Spalten je m² sind keine Miete
    expect(spaltenFeld('Miete je m²')).toBeNull();
    // nur Warmmiete in der Liste: es gibt keine Kaltmiete
    const r = roh([['Nr.', 'Fläche', 'Warmmiete'], ['1', '60 m²', '700 €'], ['2', '55 m²', '650 €'], ['3', '70 m²', '800 €']]);
    expect(r.einheiten_tabellen[0]!.spalten.map((s) => s.feld)).toEqual(['nr', 'flaeche', 'warmmiete']);
  });

  it('Zuordnung: Einheiten mit Kaltmiete, Warmmiete nur als Zusatz, Summe fällt weg, einheiten_im_dokument aus der Liste', () => {
    const r = roh(liste);
    expect(r.einheiten_im_dokument).toBe(3);
    const z = zuordnen({ schema: EXPOSE_V2_SCHEMA, felder: null, ...r, einheiten_vollstaendig: true });
    const e = z.pruefdaten.objekt.einheiten;
    expect(e).toHaveLength(3);
    expect(e[0]).toMatchObject({ lage: 'EG links', zimmer: 3, flaeche: 75, kaltmiete: 650, vermiet: 'Vermietet' });
    expect(e[2]).toMatchObject({ kaltmiete: 0, vermiet: 'Leerstand' });
    expect(z.einheitenDetails[0]).toMatchObject({ nebenkosten: 150, warmmiete: 800 });
  });

  it('fehlende Zellen werden nach Inhalt den Spalten zugeordnet', () => {
    const r = roh([
      ['Nr.', 'Fläche', 'Kaltmiete', 'Mietbeginn', 'Status'],
      ['1', '60 m²', '700 €', '01.03.2020', 'vermietet'],
      ['2', '55 m²', '650 €', '01.07.2021', 'vermietet'],
      ['3', '70 m²', '0 €', 'leer'],
    ]);
    expect(r.einheiten_tabellen[0]!.zeilen[2]).toEqual(['3', '70 m²', '0 €', '', 'leer']);
  });

  it('Stellplätze und Gewerbe bleiben in der Liste', () => {
    const r = roh([
      ['Einheit', 'Art', 'Fläche', 'Kaltmiete'],
      ['W1', 'Wohnung', '60 m²', '700 €'], ['G1', 'Gewerbe', '120 m²', '1.800 €'], ['S1', 'Stellplatz', '', '50 €'], ['S2', 'Stellplatz', '', '50 €'],
    ]);
    expect(r.einheiten_tabellen[0]!.zeilen).toHaveLength(4);
    expect(r.einheiten_im_dokument).toBe(4);
  });

  it('Werte in einer Zelle („3 Zi · 75 m²“) werden in Zimmer und Fläche geteilt, wörtlich', () => {
    const r = roh([
      ['Flächen- und Mietaufstellung'],
      ['Lage', 'Typ / Fläche', 'Miete/Monat'],
      ['UG/GG', '1 Whg · 85 m²', '1.190,00 €'], ['EG links', '3 Zi · 75 m²', '810,00 €'], ['EG rechts', '3 Zi · 74 m²', '799,20 €'],
      ['Summe', '3 WE · 234 m²', '2.799,20 €'],
    ]);
    const t = r.einheiten_tabellen[0]!;
    expect(t.titel).toBe('Flächen- und Mietaufstellung');
    expect(t.spalten.map((s) => s.feld)).toEqual(['lage', 'typ', 'zimmer', 'flaeche', 'kaltmiete']);
    expect(t.zeilen[0]).toEqual(['UG/GG', '1 Whg', '', '85 m²', '1.190,00 €']);
    expect(t.zeilen[1]).toEqual(['EG links', '', '3 Zi', '75 m²', '810,00 €']);
    const z = zuordnen({ schema: EXPOSE_V2_SCHEMA, felder: null, ...r, einheiten_vollstaendig: true });
    expect(z.pruefdaten.objekt.einheiten.map((e) => [e.flaeche, e.zimmer, e.kaltmiete])).toEqual([[85, null, 1190], [75, 3, 810], [74, 3, 799.2]]);
  });

  it('Liste zwischen Fließtextzeilen (Mehrspaltensatz): Zeilen trotzdem vollständig', () => {
    const r = roh([
      ['Lage', 'Typ / Fläche', 'Miete/Monat'],
      ['Hier steht ein Text, der aus der anderen Spalte stammt und in der Mitte umbricht,'],
      ['EG', '2 Zi · 50 m²', '500,00 €'],
      ['der Satz geht in der nächsten Zeile weiter.'],
      ['OG', '3 Zi · 70 m²', '700,00 €'],
    ]);
    expect(r.einheiten_tabellen[0]!.zeilen.map((z) => z[0])).toEqual(['EG', 'OG']);
  });

  it('ohne Kopfzeile: Zeilen mit m² und € sind eine Liste, die Betragsspalte nur bei plausibler Miete je m²', () => {
    const r = roh([
      ['EG links', '3 Zimmer', '75 m²', '810,00 €'],
      ['EG rechts', '3 Zimmer', '74 m²', '799,00 €'],
      ['OG links', '3 Zimmer', '75 m²', '825,00 €'],
    ]);
    const t = r.einheiten_tabellen[0]!;
    expect(t.zeilen).toHaveLength(3);
    expect(t.spalten.map((s) => s.feld)).toEqual(['lage', 'zimmer', 'flaeche', 'kaltmiete']);
    // Betrag je m² unplausibel (Kaufpreise): keine Kaltmiete
    const k = roh([['Whg 1', '3 Zimmer', '75 m²', '310.000 €'], ['Whg 2', '3 Zimmer', '74 m²', '299.000 €'], ['Whg 3', '3 Zimmer', '75 m²', '325.000 €']]);
    expect(k.einheiten_tabellen[0]!.spalten.map((s) => s.feld)).not.toContain('kaltmiete');
  });

  it('Kopfzeile mit Untertiteln und mehr Datenspalten (IST/SOLL unter „Nettokaltmiete“)', () => {
    const r = roh([
      ['Adresse', 'Lage', 'Typ', 'Fläche', 'Nettokaltmiete', 'Vorauszahlungen', 'Mietbeginn'],
      ['in m2', 'IST', 'SOLL', 'Betriebskosten', 'Heizkosten'],
      ['Musterweg 1', 'EG', 'Wohnung', '47,0', '350,00', '360,00', '75,00', '0,00', '01.01.2018'],
      ['Musterweg 1', 'OG', 'Wohnung', '65,0', '550,00', '560,00', '97,00', '0,00', '01.01.2019'],
    ]);
    const t = r.einheiten_tabellen[0]!;
    expect(t.spalten.map((s) => s.feld)).toEqual([null, 'lage', 'typ', 'flaeche', 'kaltmiete', 'sollmiete', 'nebenkosten', null, 'mietbeginn']);
    expect(t.zeilen[0]).toEqual(['Musterweg 1', 'EG', 'Wohnung', '47,0', '350,00', '360,00', '75,00', '0,00', '01.01.2018']);
  });

  it('Pärchen-Zeilen und Kennzahlen sind keine Mietliste', () => {
    const r = roh([
      ['Baujahr ca.', '1960', 'Wohneinheiten', '44'],
      ['Objektzustand', 'gepflegt', 'Gesamteinheiten', '44'],
      ['Wohnfläche ca.', '2.923,54 m²', 'Nebenkosten', '69.455 €'],
    ]);
    expect(r.einheiten_tabellen).toHaveLength(0);
    expect(r.einheiten_im_dokument).toBe(44);
  });
});

describe('Rohdaten: Freitext und Aufzählungen', () => {
  it('Abschnitt mit Überschrift: Blocksatzzeilen verbunden, Silbentrennung zusammengezogen, Pfad je Überschrift', () => {
    const r = roh([
      ['Objektbeschreibung'],
      ['Dieses gepflegte Mehrfamilienhaus liegt in einer ruhigen Wohnstra-'],
      ['ße und wurde im Jahr 1975 errichtet. Es umfasst zwölf Wohnein-'],
      ['heiten mit Balkon.'],
      ['Lage'],
      ['Die Gemeinde Beispielstadt zählt zu den gefragten Wohnstandorten. Die Innenstadt ist in zehn Minuten erreichbar.'],
      ['Sonstiges'],
      ['Die Angaben beruhen auf Auskünften des Eigentümers und sind ohne Gewähr.'],
    ]);
    expect(finde(r, 'Objektbeschreibung')).toMatchObject({
      wert: 'Dieses gepflegte Mehrfamilienhaus liegt in einer ruhigen Wohnstraße und wurde im Jahr 1975 errichtet. Es umfasst zwölf Wohneinheiten mit Balkon.',
      pfad: 'freitexte.objektbeschreibung', seite: 1,
    });
    expect(finde(r, 'Lage')).toMatchObject({ pfad: 'freitexte.lage' });
    expect(finde(r, 'Lage')!.wert).toContain('Innenstadt ist in zehn Minuten erreichbar.');
    expect(finde(r, 'Sonstiges')).toMatchObject({ pfad: 'freitexte.sonstige_angaben' });
  });

  it('Bindestrich bei Ergänzungsstrichen und Ortsnamen bleibt', () => {
    const r = roh([
      ['Lage'],
      ['Die Gebäude- und Freiflächen liegen im Ortsteil Beispiel-'],
      ['Neustadt und sind gut angebunden und vollständig erschlossen.'],
    ]);
    expect(finde(r, 'Lage')!.wert).toBe('Die Gebäude- und Freiflächen liegen im Ortsteil Beispiel-Neustadt und sind gut angebunden und vollständig erschlossen.');
  });

  it('unbekannte Überschrift: Angabe mit Überschrift, Pfad null; Text ohne Überschrift als „Text“', () => {
    const r = roh([
      ['Verkehrsanbindung'],
      ['Die Autobahn ist in wenigen Minuten erreichbar, der Bahnhof liegt in fußläufiger Entfernung.'],
      ['Der Flughafen ist mit dem Auto oder der S-Bahn gut zu erreichen und bietet viele Verbindungen.'],
    ]);
    expect(r.angaben).toHaveLength(1);
    expect(r.angaben[0]).toMatchObject({ bezeichnung: 'Verkehrsanbindung', pfad: null });
    const t = roh([['Ohne Überschrift beginnt hier ein langer Text, der mehr als genug Zeichen hat, um erfasst zu werden.']]);
    expect(t.angaben[0]).toMatchObject({ bezeichnung: 'Text', pfad: null });
  });

  it('Aufzählung: je Punkt eine Angabe, Bezeichnung = Überschrift oder „Merkmal“', () => {
    const r = roh([
      ['Ausstattung'],
      ['•', '12 Garagen'],
      ['• Balkone vorhanden'],
      ['- Fußbodenheizung'],
      ['Sonstiges'],
      ['Hier ein ausreichend langer Satz zum Abschluss, damit der Abschnitt als Text zählt und erfasst wird.'],
      ['• Dachterrasse'],
    ]);
    const punkte = r.angaben.filter((a) => a.bezeichnung === 'Ausstattung');
    expect(punkte.map((a) => a.wert)).toEqual(['12 Garagen', 'Balkone vorhanden', 'Fußbodenheizung']);
    expect(punkte.every((a) => a.pfad === 'ausstattung.merkmal')).toBe(true);
    expect(r.angaben.find((a) => a.wert === 'Dachterrasse')).toMatchObject({ bezeichnung: 'Sonstiges' });
    // zusätzlich als Paar gelesen, wenn eine bekannte Bezeichnung dabeisteht
    expect(r.angaben.find((a) => a.bezeichnung === 'Garagen')).toMatchObject({ wert: '12', pfad: 'flaechen.anzahl_stellplaetze' });
    const ohne = roh([['• ohne Überschrift ein Punkt']]);
    expect(ohne.angaben[0]).toMatchObject({ bezeichnung: 'Merkmal', wert: 'ohne Überschrift ein Punkt', pfad: null });
  });

  it('zweispaltiger Fließtext: erst die linke, dann die rechte Spalte', () => {
    const r = roh([
      ['Lage'],
      ['Links beginnt der Satz über die schöne Lage und'],
      ['die Anbindung an die Innenstadt, welche hervorragend ist.'],
    ].map((z) => z), [
      ['Beschreibung'],
      ['Linke Spalte erste Zeile mit genug Text hier', 'Rechte Spalte erste Zeile mit genug Text hier'],
      ['Linke Spalte zweite Zeile mit genug Text hier.', 'Rechte Spalte zweite Zeile mit genug Text hier.'],
    ]);
    const b = r.angaben.find((a) => a.bezeichnung === 'Beschreibung')!;
    expect(b.wert).toBe('Linke Spalte erste Zeile mit genug Text hier Linke Spalte zweite Zeile mit genug Text hier. Rechte Spalte erste Zeile mit genug Text hier Rechte Spalte zweite Zeile mit genug Text hier.');
  });
});

describe('Rohdaten: Kontaktdaten', () => {
  it('E-Mail, Telefon (Mobil/Festnetz), Webseite im Kontaktumfeld → kontakt 1 mit Pfad', () => {
    const r = roh([
      ['Ihr Ansprechpartner'],
      ['Erika Beispiel'],
      ['Beispiel Immobilien GmbH'],
      ['Tel. 0711 1234567 · Mobil 0171 7654321'],
      ['erika.beispiel@beispiel-immobilien.de'],
      ['www.beispiel-immobilien.de'],
    ]);
    const ak = (pfad: string) => r.angaben.find((a) => a.pfad === pfad);
    expect(ak('kontaktperson.name')).toMatchObject({ wert: 'Erika Beispiel', kontakt: 1 });
    expect(ak('kontaktperson.email_direkt')).toMatchObject({ wert: 'erika.beispiel@beispiel-immobilien.de', kontakt: 1 });
    expect(ak('kontaktperson.tel_zentrale')).toMatchObject({ wert: '0711 1234567', kontakt: 1 });
    expect(ak('kontaktperson.tel_handy')).toMatchObject({ wert: '0171 7654321', kontakt: 1 });
    expect(ak('kontaktperson.url')).toMatchObject({ wert: 'www.beispiel-immobilien.de', kontakt: 1 });
  });

  it('+49 1… ist Mobil, +49 7… Festnetz; Fax nach Beschriftung', () => {
    const r = roh([['Kontakt'], ['Tel.: +49 711 7654321'], ['Handy +49 171 1112223'], ['Fax: 0711 7654329']]);
    expect(r.angaben.find((a) => a.wert === '+49 711 7654321')!.pfad).toBe('kontaktperson.tel_zentrale');
    expect(r.angaben.find((a) => a.wert === '+49 171 1112223')!.pfad).toBe('kontaktperson.tel_handy');
    expect(r.angaben.find((a) => a.wert === '0711 7654329')!.pfad).toBe('kontaktperson.tel_fax');
  });

  it('ohne Kontaktumfeld: nur als weitere Angabe (kontakt null, Pfad null)', () => {
    const r = roh([['Der Eigentümer erreicht Sie unter info@beispiel-eigentuemer.de.'], ['Weitere Hinweise siehe Seite 3.']]);
    const mail = r.angaben.find((a) => a.wert === 'info@beispiel-eigentuemer.de')!;
    expect(mail).toMatchObject({ kontakt: null, pfad: null });
  });

  it('keine Telefonnummern aus Daten, Preisen, Kontonummern oder Registerangaben', () => {
    const r = roh([['Ansprechpartner'], ['Stand 11.09.2026, Kaufpreis 1.250.000 €, Flurstück 0123/4567'], ['IBAN DE12 3456 7890 1234 5678 90'], ['Amtsgericht Beispielstadt HRB 123456']]);
    expect(r.angaben.filter((a) => a.pfad?.startsWith('kontaktperson.tel'))).toHaveLength(0);
  });

  it('abgeschnittene E-Mail am Zeilenende wird mit der nächsten Zeile verbunden; Wiederholungen nur einmal', () => {
    const kopf = [['Kontakt'], ['Max.Beispiel@'], ['beispiel-makler.de']];
    const r = roh(kopf, kopf);
    const mails = r.angaben.filter((a) => a.pfad === 'kontaktperson.email_direkt');
    expect(mails.map((m) => m.wert)).toEqual(['Max.Beispiel@beispiel-makler.de']);
  });

  it('Anschrift neben Kontaktdaten gehört zum Kontakt, nicht zum Objekt', () => {
    const r = roh([['Beispiel Immobilien GmbH'], ['Musterweg 18 · 12345 Beispielstadt · info@beispiel-immobilien.de · +49 171 5550000']]);
    expect(r.angaben.find((a) => a.wert === 'Musterweg 18')).toMatchObject({ pfad: 'kontaktperson.strasse', kontakt: 1 });
    expect(r.angaben.find((a) => a.wert === '12345 Beispielstadt')).toMatchObject({ pfad: 'kontaktperson.plz', kontakt: 1 });
    expect(r.angaben.some((a) => a.pfad === 'geo.strasse')).toBe(false);
  });

  it('mit ausdrücklichem Ansprechpartner: Kontaktdaten anderer Seiten (Büroliste, Impressum) sind Kontakt 2', () => {
    const r = roh(
      [['Unsere Büros'], ['Beispiel Immobilien'], ['Tel. 0711 9990000'], ['zentrale@beispiel-immobilien.de']],
      [['Ihr Ansprechpartner:', 'Erika Beispiel'], ['Telefon', '0711 9990011'], ['E-Mail', 'erika@beispiel-immobilien.de']],
    );
    expect(r.angaben.find((a) => a.wert === '0711 9990000')!.kontakt).toBe(2);
    expect(r.angaben.find((a) => a.wert === 'zentrale@beispiel-immobilien.de')!.kontakt).toBe(2);
    expect(r.angaben.find((a) => a.pfad === 'kontaktperson.name')).toMatchObject({ wert: 'Erika Beispiel', kontakt: 1 });
    expect(r.angaben.find((a) => a.wert === 'erika@beispiel-immobilien.de')!.kontakt).toBe(1);
  });

  it('keine Personen raten: ohne Beschriftung kein Name', () => {
    const r = roh([['Beispiel Immobilien GmbH'], ['Erika Beispiel'], ['erika@beispiel-immobilien.de']]);
    expect(r.angaben.some((a) => a.pfad === 'kontaktperson.name')).toBe(false);
  });
});

describe('Rohdaten: Zahl der Einheiten', () => {
  it('aus „Wohneinheiten: 12“, „34 Einheiten“, Wohnen + Gewerbe', () => {
    expect(roh([['Wohneinheiten', '12']]).einheiten_im_dokument).toBe(12);
    expect(roh([['Das Haus mit 34 EINHEITEN am Markt']]).einheiten_im_dokument).toBe(34);
    expect(roh([['Wohneinheiten', '12'], ['Gewerbeeinheiten', '2']]).einheiten_im_dokument).toBe(14);
    expect(roh([['21 Wohnen | 13 Gewerbe']]).einheiten_im_dokument).toBe(34);
    expect(roh([['Kaufpreis', '500.000 €']]).einheiten_im_dokument).toBeNull();
  });

  it('Teilzahlen („3 Einheiten Leerstand“) zählen nicht; die Liste gilt, wenn sie länger ist', () => {
    expect(roh([['3 Einheiten Leerstand im Haus']]).einheiten_im_dokument).toBeNull();
    const r = roh([
      ['Wohneinheiten', '2'],
      ['Nr.', 'Art', 'Fläche', 'Kaltmiete'],
      ['1', 'Wohnung', '50 m²', '500 €'], ['2', 'Wohnung', '60 m²', '600 €'], ['3', 'Stellplatz', '', '40 €'],
    ]);
    expect(r.einheiten_im_dokument).toBe(3);
  });
});

describe('Rohdaten: Zusammenspiel mit der Zuordnung', () => {
  it('Kernfelder landen in gg, Jahresmiete wird über die Zuordnung zur Monatsmiete', () => {
    const r = roh([
      ['Musterweg 12, 12345 Beispielstadt'],
      ['Kaufpreis', '1.200.000 €'], ['Baujahr', '1975'], ['Wohnfläche', '420 m²'], ['Grundstück', '800 m²'], ['Wohneinheiten', '6'],
      ['Mieteinnahmen p.a. (Ist)', '72.000,00 €'], ['Heizung', 'Zentralheizung'], ['Rendite', '6,0 %'],
      ['Ansprechpartner', 'Erika Beispiel'], ['E-Mail', 'erika@beispiel-immobilien.de'], ['Mobil', '0171 1234567'],
    ]);
    const z = zuordnen({ schema: EXPOSE_V2_SCHEMA, felder: null, ...r, einheiten_vollstaendig: true });
    const o = z.pruefdaten.objekt;
    expect(o).toMatchObject({ strasse: 'Musterweg', hausnr: '12', plz: '12345', stadt: 'Beispielstadt', angebotspreis: 1_200_000, baujahr: 1975, wohnflaeche: 420, grundstueck: 800, einheitenAnz: 6, istmiete: 6000, heizungsart: 'Zentralheizung', bruttorendite: 6 });
    expect(z.pruefdaten.makler).toMatchObject({ name: 'Erika Beispiel', email: 'erika@beispiel-immobilien.de', mobiltel: '0171 1234567' });
    expect(z.pruefdaten.kalkulation.kaufpreis).toBe(1_200_000);
  });

  it('jede Angabe erfüllt das Format der Erfassung (Pfad im Katalog, Seite, gg null)', () => {
    const r = roh([['Kaufpreis', '1 €'], ['Rendite', '5 %'], ['E-Mail', 'a@b.de'], ['Lage'], ['Ein langer Text über die Lage des Objekts in der Innenstadt, der weit genug geht.']]);
    for (const a of r.angaben) {
      expect(a.gg).toBeNull();
      expect(a.seite).toBe(1);
      expect(a.bezeichnung).not.toBe('');
      expect(a.wert).not.toBe('');
    }
    const v2 = { schema: EXPOSE_V2_SCHEMA, felder: null, ...r, einheiten_vollstaendig: true } as const;
    expect(() => zuordnen(v2)).not.toThrow();
  });

  it('Angaben stehen in Dokumentreihenfolge (Seite, Zeile)', () => {
    const r = roh([['Baujahr', '1970'], ['Kaufpreis', '1 €']], [['Wohnfläche', '10 m²']]);
    expect(r.angaben.map((a) => [a.seite, a.bezeichnung])).toEqual([[1, 'Baujahr'], [1, 'Kaufpreis'], [2, 'Wohnfläche']]);
  });
});

describe('Rohdaten: Mietlisten — Befunde Protokoll 31 (B9, B10)', () => {
  it('Jahresspalten („Jahresnettokaltmiete“, „Miete p.a.“, „NK/Jahr“): Spalte bleibt wörtlich, die Zuordnung rechnet ÷ 12', () => {
    const r = roh([
      ['Nr.', 'Fläche', 'Jahresnettokaltmiete', 'NK p.a.'],
      ['1', '60 m²', '7.200 €', '1.200 €'], ['2', '55 m²', '6.600 €', '1.080 €'], ['3', '70 m²', '8.400 €', '1.440 €'],
    ]);
    const t = r.einheiten_tabellen[0]!;
    expect(t.spalten.map((s) => s.feld)).toEqual(['nr', 'flaeche', 'kaltmiete', 'nebenkosten']);
    expect(t.zeilen[0]).toEqual(['1', '60 m²', '7.200 €', '1.200 €']);
    const z = zuordnen({ schema: EXPOSE_V2_SCHEMA, felder: null, ...r, einheiten_vollstaendig: true });
    expect(z.pruefdaten.objekt.einheiten.map((e) => e.kaltmiete)).toEqual([600, 550, 700]);
    expect(z.einheitenDetails.map((d) => d?.nebenkosten)).toEqual([100, 90, 120]);
    expect(spaltenFeld('Miete p.a.')).toBe('kaltmiete');
    expect(spaltenFeld('Kaltmiete/Jahr')).toBe('kaltmiete');
  });

  it('dieselbe Mietliste auf zwei Seiten (Übersicht und Anhang) zählt einmal', () => {
    const liste = [['Whg.', 'Fläche', 'Kaltmiete'], ['1', '60 m²', '600 €'], ['2', '55 m²', '550 €'], ['3', '70 m²', '700 €']];
    const r = roh([['Objektübersicht'], ...liste], [['Anlage: Mieterliste'], ...liste]);
    expect(r.einheiten_tabellen).toHaveLength(1);
    expect(r.einheiten_im_dokument).toBe(3);
    const z = zuordnen({ schema: EXPOSE_V2_SCHEMA, felder: null, ...r, einheiten_vollstaendig: true });
    expect(z.pruefdaten.objekt.einheiten).toHaveLength(3);
    // zwei verschiedene Listen bleiben zwei
    const andere = [['Whg.', 'Fläche', 'Kaltmiete'], ['4', '80 m²', '800 €'], ['5', '85 m²', '850 €'], ['6', '90 m²', '900 €']];
    expect(roh(liste, andere).einheiten_tabellen).toHaveLength(2);
  });

  it('Datenschutz ohne Kopfzeile: eine Namensspalte entfällt; „Gewerbemieter“/„Hauptmieter“ im Kopf ebenso', () => {
    const r = roh([
      ['1', 'EG links', 'Erika Beispiel', '65 m²', '450 €'],
      ['2', 'EG rechts', 'Max Muster', '54 m²', '480 €'],
      ['3', 'OG links', 'Lisa Lustig', '70 m²', '500 €'],
    ]);
    expect(r.einheiten_tabellen).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/Erika|Muster|Lustig/);
    expect(r.einheiten_tabellen[0]!.zeilen[0]).toEqual(['1', 'EG links', '65 m²', '450 €']);
    expect(spaltenFeld('Gewerbemieter')).toBe('mieter');
    expect(spaltenFeld('Hauptmieter')).toBe('mieter');
    expect(spaltenFeld('Mietbeginn')).toBe('mietbeginn');
    const k = roh([['Nr.', 'Gewerbemieter', 'Fläche', 'Kaltmiete'], ['1', 'Bäckerei Krume', '120 m²', '1.800 €'], ['2', 'Kanzlei Recht', '90 m²', '1.350 €'], ['3', 'Salon Haar', '60 m²', '900 €']]);
    expect(JSON.stringify(k)).not.toMatch(/Krume|Kanzlei|Salon/);
  });
});
