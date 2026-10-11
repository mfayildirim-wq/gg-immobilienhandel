import { describe, expect, it } from 'vitest';
import { einheitenAusTabellen, exposeV2Leer, exposeVorbereiten, GG_ZIELE, KATALOG, MAPPING, v2Traegt, zuordnen } from '../src/index.ts';
import { exposeV2Beispiel } from './fixtures/expose-v2-beispiel.ts';

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
});
