import { describe, expect, it } from 'vitest';
import { adresseZerlegen, einheitenAusTabellen, einheitTyp, istPlatzhalter, pfadBerichtigen, exposeV2Leer, exposeVorbereiten, GG_ZIELE, KATALOG, MAPPING, v2Traegt, zuordnen } from '../src/index.ts';
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
      // Teil A länger als die Tabelle → Teil A, ohne Zusatz
      const mehr = exposeV2MitFeldern();
      (mehr.felder!.objekt as { einheiten: unknown[] }).einheiten.push({ typ: 'Gewerbe', lage: 'Laden', flaeche: 50, kaltmiete: 900 });
      expect(zuordnen(mehr).pruefdaten.objekt.einheiten).toHaveLength(5);
      expect(zuordnen(mehr).einheitenDetails).toEqual([null, null, null, null, null]);
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

    it('Mobil nur bei Mobilnummer; Ist-Miete über 40 €/m² gilt als Jahresmiete', () => {
      const v2 = exposeV2Leer();
      v2.angaben = [
        { bezeichnung: 'Mobil', wert: '07031-624258', seite: 1, pfad: 'kontaktperson.tel_handy', kontakt: 1, gg: null },
        { bezeichnung: 'Telefon', wert: '+49 171 1234567', seite: 1, pfad: 'kontaktperson.tel_zentrale', kontakt: 1, gg: null },
        { bezeichnung: 'Wohnfläche', wert: '500 m²', seite: 1, pfad: 'flaechen.wohnflaeche', kontakt: null, gg: null },
        { bezeichnung: 'Miete', wert: '72.200 €', seite: 1, pfad: 'preise.mieteinnahmen_ist_monat', kontakt: null, gg: null },
      ];
      const r = zuordnen(v2);
      expect(r.pruefdaten.makler).toMatchObject({ festnetztel: '07031-624258', mobiltel: '+49 171 1234567' });
      expect(r.pruefdaten.objekt.istmiete).toBeCloseTo(6016.67, 2);
      expect(r.warnungen.some((w) => w.includes('als Jahresmiete gelesen'))).toBe(true);
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

  describe('gelernte Zuordnungen (Wörterbuch)', () => {
    const gelernt = { besichtigung: 'details.denkmalschutz', erhaltungsreserve: 'objekt.baujahr' };

    it('eine Angabe ohne Ziel bekommt das gelernte Ziel, mit Wertumwandlung', () => {
      const v2 = exposeV2Beispiel();
      const ohne = zuordnen(v2);
      expect(ohne.zeilen[19]).toMatchObject({ ziel: null, grund: 'keinMapping' });
      const r = zuordnen(v2, null, { besichtigung: 'details.denkmalschutz' });
      expect(r.zeilen[19]).toMatchObject({ ziel: 'details.denkmalschutz', grund: 'zugeordnet', gelernt: true });
      expect(r.werte['details.denkmalschutz']).toBe('nach Vereinbarung');
    });

    it('nicht lesbarer Wert bleibt weitere Angabe', () => {
      const r = zuordnen(exposeV2Beispiel(), null, gelernt);
      // „Erhaltungsreserve: 12.000 €“ ist kein Jahr
      expect(r.zeilen[18]).toMatchObject({ ziel: null, grund: 'keinMapping' });
      expect(r.zeilen[18]!.gelernt).toBeUndefined();
    });

    it('ungültiges gelerntes Ziel wird ignoriert; Mapping-Angaben bleiben unberührt', () => {
      const r = zuordnen(exposeV2Beispiel(), null, { besichtigung: 'gibt.es.nicht', kaufpreis: 'objekt.baujahr' });
      expect(r.zeilen[19]).toMatchObject({ ziel: null });
      expect(r.zeilen[2]).toMatchObject({ ziel: 'objekt.angebotspreis' });
      expect(r.zeilen[2]!.gelernt).toBeUndefined();
    });

    it('Teil A hat Vorrang vor dem gelernten Ziel', () => {
      const v2 = exposeV2MitFeldern();
      v2.angaben[19]!.wert = '1.300.000 €';
      const r = zuordnen(v2, null, { besichtigung: 'objekt.angebotspreis' });
      expect(r.zeilen[19]).toMatchObject({ ziel: null, grund: 'doppelt' });
      expect(r.pruefdaten.objekt.angebotspreis).toBe(1_250_000);
    });
  });
});
