import { describe, expect, it } from 'vitest';
import { adresseZerlegen, einheitenAusTabellen, einheitTyp, energieklasseAusText, istPlatzhalter, istUeberschrift, pfadBerichtigen, exposeV2Leer, exposeVorbereiten, GG_ZIELE, KATALOG, MAPPING, v2Traegt, zielWert, zuordnen } from '../src/index.ts';
import { exposeV2Beispiel, exposeV2MitFeldern } from './fixtures/expose-v2-beispiel.ts';

describe('Exposé v2: Mapping Standard → gg (Protokoll 28)', () => {
  it('die Mapping-Tabelle nennt nur Katalog-Pfade und gg-Ziele', () => {
    for (const [pfad, ziele] of Object.entries(MAPPING)) {
      expect(KATALOG[pfad], pfad).toBeDefined();
      for (const z of ziele) expect(GG_ZIELE[z], `${pfad} → ${z}`).toBeDefined();
    }
  });

  it('füllt die Prüfseite aus den wörtlichen Angaben', () => {
    const { pruefdaten: p } = zuordnen(exposeV2Beispiel());
    expect(p.objekt).toMatchObject({
      strasse: 'Musterweg', hausnr: '12', plz: '89073', stadt: 'Ulm', angebotspreis: 1_250_000, istmiete: 2320, wohnflaeche: 240,
      grundstueck: 480, einheitenAnz: 3, baujahr: 1965, heizungsart: 'Gas-Zentralheizung', heizungsbaujahr: 2018,
      energieausweis: { art: 'Verbrauchsausweis', kennwert: 128.4, klasse: 'D' },
      lagebeschreibung: 'Ruhige Wohnlage nahe der Innenstadt. Schulen und Einkauf fußläufig.',
      ausstattung: 'Aufzug: nein',
    });
    expect(p.kalkulation).toMatchObject({ kaufpreis: 1_250_000, makler: 3.57 });
    expect(p.makler).toMatchObject({
      name: 'Anna Beispiel', firma: 'Beispiel Immobilien GmbH', mobiltel: '0171 1234567', festnetztel: '0731 98765-0', tel: '0171 1234567',
      email: 'anna@beispiel.test', alleNamen: ['Anna Beispiel', 'Max Zweit'], alleTelefonnummern: ['0171 1234567', '0731 98765-0', '0731 555'],
    });
    // exposeVorbereiten läuft unverändert auf dem Format der Prüfseite
    expect(exposeVorbereiten(p).deal.kalk.kaufpreis).toBe(1_250_000);
  });

  it('Freitexte bleiben ungekürzt, Jahreswerte werden mit Hinweis Monatswerte', () => {
    const v2 = exposeV2Beispiel();
    v2.angaben[17]!.wert = 'x'.repeat(5000);
    const { pruefdaten, zeilen } = zuordnen(v2);
    expect(pruefdaten.objekt.lagebeschreibung).toHaveLength(5000);
    expect(zeilen[4]).toMatchObject({ ziel: 'objekt.istmiete', wert: 2320, hinweis: 'Jahreswert ÷ 12' });
  });

  it('details, Sammelziele, Makleradresse', () => {
    const { details, werte } = zuordnen(exposeV2Beispiel());
    expect(details).toMatchObject({
      titel: 'Gepflegtes Mehrfamilienhaus in Ulm', provision: '3,57 % inkl. MwSt.', kaufpreisfaktor: 22.9,
      sanierungen: ['Dach: 2015 neu eingedeckt'], energieausweis: { art: 'Verbrauchsausweis', kennwert: 128.4, klasse: 'D' },
    });
    expect(werte).toMatchObject({ 'makler.strasse': 'Hafenstraße 3', 'makler.plz': '89073', 'makler.ort': 'Ulm' });
  });

  it('ohne Mapping → weitere Angabe mit KI-Vorschlag; zweiter Kaufpreis mit anderem Wert → doppelt mit Warnung', () => {
    const { zeilen, warnungen } = zuordnen(exposeV2Beispiel());
    expect(zeilen[18]).toMatchObject({ ziel: null, grund: 'keinMapping', vorschlag: 'details.instandhaltungsruecklage', wert: 12_000 });
    expect(zeilen[19]).toMatchObject({ ziel: null, grund: 'keinMapping', vorschlag: null });
    expect(zeilen[20]).toMatchObject({ ziel: null, grund: 'doppelt' });
    expect(warnungen.some((w) => w.startsWith('Angebotspreis: „1.250.000,00 €“ (S. 1) und „1.300.000 €“ (S. 5)'))).toBe(true);
    // weiterer Kontakt: Name/Telefon zugeordnet, Position bleibt weitere Angabe
    expect(zeilen[28]).toMatchObject({ ziel: 'makler.weitereKontakte', grund: 'zugeordnet' });
    expect(zeilen[30]).toMatchObject({ ziel: null, grund: 'keinMapping' });
  });

  it('ungültiger KI-Vorschlag wird ignoriert; nicht lesbare Zahl bleibt weitere Angabe', () => {
    const v2 = exposeV2Leer();
    v2.angaben = [
      { bezeichnung: 'Kaufpreis', wert: 'auf Anfrage', seite: 1, pfad: 'preise.kaufpreis', kontakt: null, gg: null },
      { bezeichnung: 'X', wert: 'y', seite: 1, pfad: null, kontakt: null, gg: 'gibt.es.nicht' },
    ];
    const { zeilen, pruefdaten } = zuordnen(v2);
    expect(pruefdaten.objekt.angebotspreis).toBeNull();
    expect(zeilen[0]).toMatchObject({ grund: 'keinWert', ziel: null });
    expect(zeilen[1]).toMatchObject({ vorschlag: null });
  });

  it('Einheiten aus der Mieterliste: Summenzeile fällt weg, Leerstand, Stellplatz, Zusatzspalten in details', () => {
    const { einheiten, details } = einheitenAusTabellen(exposeV2Beispiel().einheiten_tabellen);
    expect(einheiten).toEqual([
      { typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, kaltmiete: 800, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'OG', zimmer: 3, flaeche: 80, kaltmiete: 820, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'DG', zimmer: 2.5, flaeche: 80, kaltmiete: 0, vermiet: 'Leerstand' },
      { typ: 'Stellplatz', lage: 'Tiefgarage', zimmer: null, flaeche: null, kaltmiete: 60, vermiet: 'Vermietet' },
    ]);
    expect(details[0]).toEqual({ nr: '1', nebenkosten: 150, mietbeginn: '01.01.2020', seite: 4, weitere: { Kaution: '2.400 €' } });
  });

  it.each(['TG-Stellplatz 3', 'Stpl. 1', 'Garage', 'Carport', 'Außenstellplatz', 'Duplexparker', 'Pkw-Platz', 'Kfz 2', 'SP 4', 'Tiefgarage'])('Stellplatz erkannt: %s', (text) => {
    expect(einheitTyp(text)).toBe('Stellplatz');
  });
  it.each(['Whg. 1', 'EG links', '3-Zi.-Whg.', 'Laden'])('kein Stellplatz: %s', (text) => {
    expect(einheitTyp(text)).not.toBe('Stellplatz');
  });

  it('trägt = Ort ∧ Preis ∧ Einheiten', () => {
    expect(v2Traegt(exposeV2Beispiel())).toBe(true);
    const ohne = exposeV2Beispiel();
    ohne.einheiten_tabellen = [];
    expect(v2Traegt(ohne)).toBe(false);
    expect(v2Traegt(exposeV2Leer())).toBe(false);
  });

  it('unvollständige Einheitenliste → Warnung', () => {
    const v2 = exposeV2Beispiel();
    v2.einheiten_im_dokument = 9;
    expect(zuordnen(v2).warnungen).toContain('Einheitenliste unvollständig: 4 erfasst, 9 im Dokument');
  });

  it('Belegprüfung setzt die Konfidenz der Prüfseite', () => {
    const v2 = exposeV2Beispiel();
    const belegt = v2.angaben.map((_, i) => (i === 2 ? true : i === 6 ? false : null));
    expect(zuordnen(v2, belegt).pruefdaten._konfidenz).toMatchObject({ angebotspreis: 'hoch', wohnflaeche: 'niedrig', baujahr: 'mittel' });
  });

  describe('Teil A (gg-Felder wie früher) gilt zuerst — mindestens wie früher', () => {
    it('übernimmt Teil A vollständig, auch Felder ohne gg-Ziel (Kalkulation, Bundesland)', () => {
      const { pruefdaten: p } = zuordnen(exposeV2MitFeldern());
      expect(p.objekt).toMatchObject({ strasse: 'Musterweg', hausnr: '12', bundesland: 'Baden-Württemberg', bruttorendite: 2.23, ausstattung: 'Balkon, Keller' });
      expect(p.kalkulation).toMatchObject({ kaufpreis: 1_250_000, makler: 3.57, gest: 5 });
      expect(p._konfidenz).toMatchObject({ angebotspreis: 'hoch' });
      // Teil B füllt Lücken: Heizungsbaujahr fehlt in Teil A
      expect(p.objekt.heizungsbaujahr).toBe(2018);
      expect(p.makler.alleNamen).toEqual(['Anna Beispiel', 'Max Zweit']);
    });

    it('Einheiten aus Teil A; Zusatz je Einheit aus der Tabelle, wenn gleich viele', () => {
      const r = zuordnen(exposeV2MitFeldern());
      expect(r.pruefdaten.objekt.einheiten).toHaveLength(4);
      expect(r.pruefdaten.objekt.einheiten[3]).toMatchObject({ typ: 'Stellplatz', lage: 'TG' });
      expect(r.einheitenDetails[0]).toMatchObject({ nebenkosten: 150, weitere: { Kaution: '2.400 €' } });
      // Teil A länger als die Tabelle → Teil A; Zusatz nur bei den Einheiten, die in der Tabelle eine Entsprechung haben (Protokoll 31, B8)
      const mehr = exposeV2MitFeldern();
      (mehr.felder!.objekt as { einheiten: unknown[] }).einheiten.push({ typ: 'Gewerbe', lage: 'Laden', flaeche: 50, kaltmiete: 900 });
      expect(zuordnen(mehr).pruefdaten.objekt.einheiten).toHaveLength(5);
      expect(zuordnen(mehr).einheitenDetails[0]).toMatchObject({ nebenkosten: 150 });
      expect(zuordnen(mehr).einheitenDetails[4]).toBeNull();
      // Tabelle länger (z. B. nach dem Nachfass) → die Tabelle gilt
      const weniger = exposeV2MitFeldern();
      (weniger.felder!.objekt as { einheiten: unknown[] }).einheiten.splice(1);
      expect(zuordnen(weniger).pruefdaten.objekt.einheiten).toHaveLength(4);
    });

    it('gleiche wörtliche Angabe → zugeordnet; abweichende → doppelt mit Warnung; längerer wörtlicher Freitext ersetzt die Kurzfassung', () => {
      const r = zuordnen(exposeV2MitFeldern());
      expect(r.zeilen[2]).toMatchObject({ ziel: 'objekt.angebotspreis', grund: 'zugeordnet' });
      expect(r.zeilen[4]).toMatchObject({ ziel: 'objekt.istmiete', grund: 'zugeordnet' }); // 27.840 € / Jahr = 2.320 €
      expect(r.zeilen[20]).toMatchObject({ grund: 'doppelt' });
      expect(r.warnungen.some((w) => w.includes('„1250000“ (KI-Feld) und „1.300.000 €“ (S. 5)'))).toBe(true);
      expect(r.zeilen[17]).toMatchObject({ ziel: 'objekt.lagebeschreibung', grund: 'zugeordnet' });
      expect(r.pruefdaten.objekt.lagebeschreibung).toBe('Ruhige Wohnlage nahe der Innenstadt. Schulen und Einkauf fußläufig.');
    });

    it('gleich lange Listen: sagt die wörtliche Liste Stellplatz, Teil A aber Wohnung, gilt Stellplatz', () => {
      const v2 = exposeV2MitFeldern();
      (v2.felder!.objekt as { einheiten: { typ: string }[] }).einheiten[3]!.typ = 'Wohnung';
      expect(zuordnen(v2).pruefdaten.objekt.einheiten[3]!.typ).toBe('Stellplatz');
    });

    it('trägt auch, wenn nur Teil A geliefert wurde', () => {
      const v2 = exposeV2MitFeldern();
      v2.angaben = [];
      v2.einheiten_tabellen = [];
      expect(v2Traegt(v2)).toBe(true);
    });
  });

  describe('Befunde aus dem Vergleich main ↔ Branch (12.10.2026)', () => {
    it('mehrere Zahlen in einer Angabe ergeben keinen Zahlwert („7 WE · 500 m² · 5.737 €“ ist keine Soll-Miete)', () => {
      const v2 = exposeV2Leer();
      v2.angaben = [{ bezeichnung: 'Eckdaten', wert: '7 WE · 500 m² · 5.737,00 €', seite: 1, pfad: 'preise.mieteinnahmen_soll_monat', kontakt: null, gg: null }];
      expect(zuordnen(v2).werte['objekt.sollmiete']).toBeUndefined();
      v2.angaben[0]!.wert = '5.737,00 €';
      expect(zuordnen(v2).werte['objekt.sollmiete']).toBe(5737);
    });

    it('Teil A hat die Jahresmiete als Monatsmiete: das Exposé sagt „p.a.“ → Monatswert, Warnung', () => {
      const v2 = exposeV2MitFeldern();
      (v2.felder!.objekt as { istmiete: number }).istmiete = 27_840;
      const r = zuordnen(v2);
      expect(r.pruefdaten.objekt.istmiete).toBe(2320);
      expect(r.zeilen[4]).toMatchObject({ ziel: 'objekt.istmiete', grund: 'zugeordnet' });
      expect(r.warnungen.some((w) => w.startsWith('Ist-Miete je Monat: KI-Feld war der Jahreswert'))).toBe(true);
    });

    it('Platzhalter der KI gelten als leer, echte Angaben nicht', () => {
      for (const p of ['nicht angegeben', 'nicht genannt (Adresse auf Anfrage)', 'k. A.', 'Preis auf Anfrage', '–']) expect(istPlatzhalter(p), p).toBe(true);
      for (const p of ['nicht vorhanden', 'Gas-Zentralheizung', 'Off-Market-Angebot, vertraulich. Adresse und Unterlagen auf Anfrage nach NDA.']) expect(istPlatzhalter(p), p).toBe(false);
      const v2 = exposeV2MitFeldern();
      Object.assign(v2.felder!.objekt as object, { strasse: 'nicht genannt (Adresse auf Anfrage)', heizungsart: 'nicht angegeben' });
      v2.angaben = [];
      expect(zuordnen(v2).pruefdaten.objekt).toMatchObject({ strasse: null, heizungsart: null });
    });

    it('Jahresmiete am Wortlaut erkannt, auch wenn der Pfad „_monat“ sagt', () => {
      const v2 = exposeV2MitFeldern();
      (v2.felder!.objekt as { istmiete: number }).istmiete = 72_200;
      v2.angaben = [{ bezeichnung: 'Vermietungssituation', wert: 'aktuell ca. 72.200 € p.a.', seite: 1, pfad: 'preise.mieteinnahmen_ist_monat', kontakt: null, gg: null }];
      expect(zuordnen(v2).pruefdaten.objekt.istmiete).toBeCloseTo(6016.67, 2);
    });

    it('Adresse: der Abschnitt, der wie eine Straße aussieht', () => {
      expect(adresseZerlegen('Baden-Württembergische Bank, Immobilienvermittlung, Am Hauptbahnhof 2, 70173 Stuttgart')).toEqual(['Am Hauptbahnhof 2', '70173 Stuttgart']);
      expect(adresseZerlegen('Musterweg 12, 89073 Ulm')).toEqual(['Musterweg 12', '89073 Ulm']);
      expect(adresseZerlegen('Glöckelsberg 18 · 77855 Achern')).toEqual(['Glöckelsberg 18', '77855 Achern']);
      expect(adresseZerlegen('Hafenstraße 3')).toEqual(['Hafenstraße 3', undefined]);
      expect(adresseZerlegen('Tübingen-Lustnau, Adresse auf Anfrage')).toEqual([null, undefined]);
    });

    it('Mobil nur bei Mobilnummer; Ist-Miete über 40 €/m² wird nur gewarnt, nicht umgerechnet (E8)', () => {
      const v2 = exposeV2Leer();
      v2.angaben = [
        { bezeichnung: 'Mobil', wert: '07031-624258', seite: 1, pfad: 'kontaktperson.tel_handy', kontakt: 1, gg: null },
        { bezeichnung: 'Telefon', wert: '+49 171 1234567', seite: 1, pfad: 'kontaktperson.tel_zentrale', kontakt: 1, gg: null },
        { bezeichnung: 'Wohnfläche', wert: '500 m²', seite: 1, pfad: 'flaechen.wohnflaeche', kontakt: null, gg: null },
        { bezeichnung: 'Miete', wert: '72.200 €', seite: 1, pfad: 'preise.mieteinnahmen_ist_monat', kontakt: null, gg: null },
      ];
      const r = zuordnen(v2);
      expect(r.pruefdaten.makler).toMatchObject({ festnetztel: '07031-624258', mobiltel: '+49 171 1234567' });
      // Wohn- und Geschäftshaus: 100 m² Wohnen + Gewerbe, die Ist-Miete enthält die Gewerbemiete — ÷ 12 wäre falsch (Protokoll 31, B4)
      expect(r.pruefdaten.objekt.istmiete).toBe(72200);
      expect(r.pruefdaten._konfidenz.istmiete).toBe('niedrig');
      expect(r.warnungen.some((w) => w.includes('Jahresmiete oder Gewerbeanteil') && w.includes('6016.67'))).toBe(true);
    });

    it('E8: Jahreswert nur am Wortlaut — „Jahresmiete 2.320 €/Monat“ bleibt der Monatswert', () => {
      const v2 = exposeV2Leer();
      v2.angaben = [
        { bezeichnung: 'Jahresnettokaltmiete', wert: '27.840 € p.a.', seite: 1, pfad: 'preise.mieteinnahmen_ist_jahr', kontakt: null, gg: null },
      ];
      expect(zuordnen(v2).pruefdaten.objekt.istmiete).toBe(2320);
      v2.angaben = [
        { bezeichnung: 'Jahresmiete', wert: '2.320 €/Monat', seite: 1, pfad: 'preise.mieteinnahmen_ist_jahr', kontakt: null, gg: null },
      ];
      const r = zuordnen(v2);
      expect(r.pruefdaten.objekt.istmiete).toBe(2320);
      expect(r.zeilen.find((z) => z.ziel === 'objekt.istmiete')?.hinweis).toBeUndefined();
    });

    it('E7b: Energieausweis aus per Texterkennung gelesenen Seiten gilt als „niedrig“ und wird gewarnt', () => {
      const v2 = exposeV2MitFeldern();
      (v2.felder!.objekt as { energieausweis: unknown }).energieausweis = { klasse: 'A', kennwert: 75, art: null };
      v2.dokument = { version: 'gg-dokument-v1', seitenGesamt: 1, seiten: [{ nr: 1, typ: 'bild', zeilen: [['Energieausweis (Effizienzklasse)']], ocr: { sicherheit: 80, woerter: 2 } }] };
      const r = zuordnen(v2);
      expect(r.pruefdaten.objekt.energieausweis).toMatchObject({ klasse: 'A', kennwert: 75 });
      expect(r.pruefdaten._konfidenz).toMatchObject({ energieklasse: 'niedrig', energiekennwert: 'niedrig' });
      expect(r.warnungen).toContain('Energieausweis aus per Texterkennung gelesenen Seiten — bitte im Exposé prüfen');
      // ohne Texterkennung: keine Abwertung
      v2.dokument = { version: 'gg-dokument-v1', seitenGesamt: 1, seiten: [{ nr: 1, typ: 'text', zeilen: [['Energieklasse A']], ocr: null }] };
      expect(zuordnen(v2).pruefdaten._konfidenz.energieklasse).toBeUndefined();
    });

    it('Adresse mit Kontaktnummer gehört zum Kontakt; Vorname mit Nachnamen; Festnetz aus Teil A im Feld Mobil', () => {
      const v2 = exposeV2MitFeldern();
      (v2.felder!.makler as Record<string, unknown>).mobiltel = '07151 9842253';
      (v2.felder!.makler as Record<string, unknown>).festnetztel = null;
      (v2.felder!.objekt as Record<string, unknown>).strasse = null;
      v2.angaben = [
        { bezeichnung: 'Kontakt', wert: 'Glöckelsberg 18 · 77855 Achern', seite: 1, pfad: 'geo.strasse', kontakt: 1, gg: null },
        { bezeichnung: 'Ansprechpartner', wert: 'Bülent Genc Güner', seite: 1, pfad: 'kontaktperson.vorname', kontakt: 2, gg: null },
        { bezeichnung: 'Ansprechpartner', wert: 'Güner', seite: 1, pfad: 'kontaktperson.name', kontakt: 2, gg: null },
      ];
      const r = zuordnen(v2);
      expect(r.pruefdaten.objekt.strasse).toBeNull();
      expect(r.werte).toMatchObject({ 'makler.strasse': 'Glöckelsberg 18', 'makler.plz': '77855', 'makler.ort': 'Achern' });
      expect(r.pruefdaten.makler.alleNamen).toContain('Bülent Genc Güner');
      expect(r.pruefdaten.makler).toMatchObject({ mobiltel: null, festnetztel: '07151 9842253', tel: '07151 9842253' });
    });

    it('Tippfehler im Pfad werden berichtigt', () => {
      expect(pfadBerichtigen('preises.x_fache')).toBe('preise.x_fache');
      expect(pfadBerichtigen('preises.mieteinnahmen_ist_jahr')).toBe('preise.mieteinnahmen_ist_jahr');
      expect(pfadBerichtigen('voellig.anders')).toBeNull();
    });
  });
});

describe('Einheiten-Abgleich Teil A ↔ Mietliste (Protokoll 31, B8): über Fläche und Lage, nicht über die Reihenfolge', () => {
  const mitEinheiten = (einheiten: unknown[]) => {
    const v2 = exposeV2MitFeldern();
    (v2.felder!.objekt as { einheiten: unknown[] }).einheiten = einheiten;
    return v2;
  };

  it('Teil A in anderer Reihenfolge als die Tabelle: Typ und Zusatzspalten landen bei der richtigen Einheit', () => {
    // Tabelle (Fixture): EG 80 m² 800 € (NK 150, Kaution) · OG 80 m² 820 € · DG 80 m² leer · Tiefgarage Stellplatz 60 €
    const v2 = mitEinheiten([
      { typ: 'Wohnung', lage: 'TG', zimmer: null, flaeche: null, kaltmiete: 60, vermiet: 'Vermietet' },   // Teil A nennt den Stellplatz zuerst und „Wohnung“
      { typ: 'Wohnung', lage: 'DG', zimmer: 2.5, flaeche: 80, kaltmiete: 0, vermiet: 'Leerstand' },
      { typ: 'Wohnung', lage: 'OG', zimmer: 3, flaeche: 80, kaltmiete: 820, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, kaltmiete: 800, vermiet: 'Vermietet' },
    ]);
    const r = zuordnen(v2);
    expect(r.pruefdaten.objekt.einheiten.map((e) => [e.lage, e.typ])).toEqual([['TG', 'Stellplatz'], ['DG', 'Wohnung'], ['OG', 'Wohnung'], ['EG', 'Wohnung']]);
    // Zusatzspalten der EG-Zeile (NK 150, Kaution) hängen an der EG-Einheit — nicht an der ersten
    expect(r.einheitenDetails[3]).toMatchObject({ nebenkosten: 150, weitere: { Kaution: '2.400 €' } });
    expect(r.einheitenDetails[0]).not.toMatchObject({ nebenkosten: 150 });
  });

  it('keine Entsprechung → keine Zusatzdaten, Typ bleibt', () => {
    const v2 = mitEinheiten([
      { typ: 'Wohnung', lage: '1. OG rechts', zimmer: 4, flaeche: 120, kaltmiete: 1200, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: '2. OG', zimmer: 4, flaeche: 118, kaltmiete: 1180, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'DG', zimmer: 2, flaeche: 61, kaltmiete: 610, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 95, kaltmiete: 950, vermiet: 'Vermietet' },
    ]);
    const r = zuordnen(v2);
    expect(r.pruefdaten.objekt.einheiten.map((e) => e.typ)).toEqual(['Wohnung', 'Wohnung', 'Wohnung', 'Wohnung']);
    expect(r.einheitenDetails).toEqual([null, null, null, null]);
  });

  it('Tabelle länger, aber ohne Kaltmiete: die Tabelle gilt, Mieten aus Teil A bleiben bei den passenden Einheiten', () => {
    const v2 = mitEinheiten([
      { typ: 'Wohnung', lage: 'OG', zimmer: 3, flaeche: 80, kaltmiete: 820, vermiet: 'Vermietet' },
      { typ: 'Wohnung', lage: 'EG', zimmer: 3, flaeche: 80, kaltmiete: 800, vermiet: 'Vermietet' },
    ]);
    const t = v2.einheiten_tabellen[0]!;
    const km = t.spalten.findIndex((s) => s.feld === 'kaltmiete');
    t.spalten = t.spalten.filter((_, i) => i !== km);
    t.zeilen = t.zeilen.map((z) => z.filter((_, i) => i !== km));
    const r = zuordnen(v2);
    const e = r.pruefdaten.objekt.einheiten;
    expect(e).toHaveLength(4);
    expect(e.find((x) => x.lage === 'EG')).toMatchObject({ kaltmiete: 800, zimmer: 3 });
    expect(e.find((x) => x.lage === 'OG')).toMatchObject({ kaltmiete: 820 });
    expect(e.find((x) => x.lage === 'DG')).toMatchObject({ kaltmiete: null });
  });
});

describe('Müll aus Nachbarzellen und Platzhalter (16.10.2026, Rückmeldung aus dem Test auf privat)', () => {
  it('Energieklasse: nur die Klasse selbst, A+ bis H', () => {
    expect(energieklasseAusText('E')).toBe('E');
    expect(energieklasseAusText('Energieeffizienzklasse: A+')).toBe('A+');
    expect(energieklasseAusText('Klasse D (Bedarf)')).toBe('D');
    expect(energieklasseAusText('Klasse d')).toBeNull();
    expect(energieklasseAusText('Endenergiebedarf kWh/(m²*a)')).toBeNull();
    expect(energieklasseAusText('Bedarfsausweis')).toBeNull();
    expect(zielWert('objekt.energieausweis.klasse', 'Endenergiebedarf kWh/(m²*a)', null)).toEqual({ wert: null });
    expect(zielWert('objekt.energieausweis.klasse', 'E', null)).toEqual({ wert: 'E' });
  });

  it('eine Zelle, die selbst eine Beschriftung ist (Einheit ohne Zahl), wird kein Textwert', () => {
    expect(istUeberschrift('Endenergiebedarf kWh/(m²*a)')).toBe(true);
    expect(istUeberschrift('Preis in €')).toBe(true);
    expect(istUeberschrift('128,5 kWh/m²a')).toBe(false);
    expect(istUeberschrift('Gas-Zentralheizung')).toBe(false);
    expect(zielWert('details.energietraeger', 'Endenergiebedarf kWh/(m²*a)', null)).toEqual({ wert: null });
  });

  it('„liegt vor“, „vorhanden“, „wird nachgereicht“ sind Platzhalter, „nein“ und „gepflegt“ nicht', () => {
    for (const w of ['liegt vor', 'Liegt bei', 'vorhanden', 'vorh.', 'wird nachgereicht', 'in Erstellung', 'folgt']) expect(istPlatzhalter(w), w).toBe(true);
    for (const w of ['nein', 'ja', 'gepflegt', 'Verbrauchsausweis', 'vorhandene Mieter zahlen pünktlich']) expect(istPlatzhalter(w), w).toBe(false);
    expect(zielWert('objekt.energieausweis.art', 'liegt vor', null)).toEqual({ wert: null });
  });
});

describe('Kachel-Raster ist keine Einheitentabelle (Engel & Völkers, Test auf privat 16.10.2026)', () => {
  it('nur die Zeile mit Fläche und Zimmern wird eine Einheit; Beschriftungs- und Preiszeile fallen weg', () => {
    const t = {
      seite: 2, titel: null,
      spalten: [{ feld: 'flaeche' as const, ueberschrift: 'Wohnfläche' }, { feld: 'zimmer' as const, ueberschrift: 'Anzahl Zimmer' }, { feld: null, ueberschrift: 'Grundstücksfläche' }],
      zeilen: [['~170 m²', '7', '~1.000 m²'], ['Kaufpreis', 'CO2-Emissionsergebnis kg/(m²*a)', 'Heizung'], ['550.000 €', '63,2', 'Zentralheizung, Gas (Heizkörper)']],
    };
    const { einheiten } = einheitenAusTabellen([t]);
    expect(einheiten).toHaveLength(1);
    expect(einheiten[0]).toMatchObject({ flaeche: 170, zimmer: 7 });
  });
});
