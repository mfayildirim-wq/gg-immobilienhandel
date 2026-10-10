import { describe, expect, it } from 'vitest';
import { belegePruefen, exposeV1Leer, kernfeldDopplung } from '../src/index.ts';
import { beispielV1 } from './fixtures/expose-v1-beispiel.ts';

const seiten = [
  'Exposé\nMusterweg 12,  70173 Stuttgart',
  'Kaufpreis:   1.250.000 €\nWohnfläche ca. 480,5 m²\nGrundstück 620 m²\nBaujahr 1962\n6 Wohneinheiten',
  'Jahresnettokaltmiete 60.000 €',
  'Mietaufstellung',
  'Instandhaltungsrücklage 12.000 €',
  'Endenergieverbrauch 118 kWh/(m²·a)',
];

describe('belegePruefen: Zitat auf der Seite, Zahl im Zitat', () => {
  it('belegt, wenn das Zitat (Leerraum und Groß/Klein egal) auf der Seite steht und die Zahl enthält', () => {
    const { belegt, v1 } = belegePruefen(beispielV1(), seiten);
    expect(belegt).toMatchObject({ kaufpreis: true, wohnflaeche: true, grundstueck: true, baujahr: true, anzahl_we: true, energiekennwert: true, adresse: true });
    expect(v1.belege.kaufpreis.konfidenz).toBe('hoch');
    expect(v1.belege.wohnflaeche.konfidenz).toBe('hoch');
  });

  it('abgeleitete Werte (Jahresmiete / 12): Zahl fehlt im Zitat → nicht belegt, Konfidenz niedrig', () => {
    const { belegt, v1 } = belegePruefen(beispielV1(), seiten);
    expect(belegt.istmiete).toBe(false);
    expect(v1.belege.istmiete.konfidenz).toBe('niedrig');
    expect(v1.preise.mieteinnahmen_ist_monat).toBe(5000);
  });

  it('Zahlformate: 1.250.000, 1250000, 1.250.000,00 und 1,250,000 gelten alle', () => {
    for (const zitat of ['Kaufpreis 1.250.000 €', 'Kaufpreis 1250000 EUR', 'Kaufpreis: 1.250.000,00 €', 'Price 1,250,000']) {
      const v1 = exposeV1Leer();
      v1.preise.kaufpreis = 1_250_000;
      v1.belege.kaufpreis = { seite: 1, zitat, konfidenz: 'hoch' };
      expect(belegePruefen(v1, [`Objekt\n${zitat}\nEnde`]).belegt.kaufpreis, zitat).toBe(true);
    }
    const v1 = exposeV1Leer();
    v1.flaechen.wohnflaeche = 85.5;
    v1.belege.wohnflaeche = { seite: 1, zitat: 'Wohnfläche 85,50 m²', konfidenz: 'hoch' };
    expect(belegePruefen(v1, ['Wohnfläche 85,50 m²']).belegt.wohnflaeche).toBe(true);
    v1.belege.wohnflaeche = { seite: 1, zitat: 'Wohnfläche 86 m²', konfidenz: 'hoch' };
    expect(belegePruefen(v1, ['Wohnfläche 86 m²']).belegt.wohnflaeche).toBe(false);
  });

  it('Zitat nicht auf der Seite, Seite außerhalb 1..n oder ohne Seite → nicht belegt', () => {
    const v1 = beispielV1();
    v1.belege.kaufpreis = { seite: 2, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch' };
    expect(belegePruefen(v1, ['x', 'Preis auf Anfrage']).belegt.kaufpreis).toBe(false);
    v1.belege.kaufpreis = { seite: 9, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch' };
    expect(belegePruefen(v1, seiten).belegt.kaufpreis).toBe(false);
    v1.belege.kaufpreis = { seite: 0, zitat: 'Kaufpreis: 1.250.000 €', konfidenz: 'hoch' };
    expect(belegePruefen(v1, seiten).belegt.kaufpreis).toBe(false);
    v1.belege.kaufpreis = { seite: null, zitat: null, konfidenz: 'hoch' };
    const r = belegePruefen(v1, seiten);
    expect(r.belegt.kaufpreis).toBe(false);
    expect(r.v1.belege.kaufpreis.konfidenz).toBe('niedrig');
  });

  it('Felder ohne Wert werden nicht gezählt; die Eingabe bleibt unverändert', () => {
    const v1 = exposeV1Leer();
    v1.preise.kaufpreis = 100;
    v1.belege.kaufpreis = { seite: 1, zitat: 'Kaufpreis 100 €', konfidenz: 'hoch' };
    v1.belege.baujahr = { seite: 1, zitat: 'Baujahr 1900', konfidenz: 'hoch' };
    const { belegt, v1: neu } = belegePruefen(v1, ['Kaufpreis 100 €']);
    expect(belegt).toEqual({ kaufpreis: true });
    expect(neu.belege.baujahr.konfidenz).toBe('hoch');
    v1.belege.istmiete = { seite: 1, zitat: 'nix', konfidenz: 'hoch' };
    v1.preise.mieteinnahmen_ist_monat = 5;
    const vorher = structuredClone(v1);
    belegePruefen(v1, ['Kaufpreis 100 €']);
    expect(v1).toEqual(vorher);
  });

  it('Adresse: der Straßenname muss im Zitat stehen', () => {
    const v1 = exposeV1Leer();
    v1.geo.strasse = 'Musterweg';
    v1.belege.adresse = { seite: 1, zitat: 'Lage: Musterweg 12', konfidenz: 'hoch' };
    expect(belegePruefen(v1, ['Lage: Musterweg 12']).belegt.adresse).toBe(true);
    v1.belege.adresse = { seite: 1, zitat: 'Lage: Stuttgart', konfidenz: 'hoch' };
    expect(belegePruefen(v1, ['Lage: Stuttgart']).belegt.adresse).toBe(false);
  });
});

describe('kernfeldDopplung: Kernfelder gehören nicht in weitere_angaben', () => {
  it('nennt Zeilen, deren Bezeichnung ein Kernfeld-Synonym trifft', () => {
    const v1 = exposeV1Leer();
    v1.weitere_angaben = [
      { gruppe: 'preise', bezeichnung: 'Kaufpreis', wert: '1.250.000 €', einheit: '€', seite: 2 },
      { gruppe: 'verwaltung', bezeichnung: 'Instandhaltungsrücklage', wert: '12.000 €', einheit: '€', seite: 5 },
      { gruppe: 'flaechen', bezeichnung: 'Wohnfläche gesamt', wert: '480 m²', einheit: 'm²', seite: 2 },
      { gruppe: 'vertrieb', bezeichnung: 'Telefon Büro', wert: '0711 1', einheit: null, seite: 9 },
      { gruppe: 'sonstiges', bezeichnung: 'E-Mail Verwaltung', wert: 'v@x.de', einheit: null, seite: 9 },
      { gruppe: 'sonstiges', bezeichnung: 'Besichtigung', wert: 'nach Absprache', einheit: null, seite: 9 },
    ];
    const w = kernfeldDopplung(v1);
    expect(w).toHaveLength(4);
    expect(w[0]).toMatch(/weitere_angaben\.0/);
    expect(w[0]).toMatch(/Kaufpreis/);
    expect(w[0]).toMatch(/preise\.kaufpreis/);
    expect(w.join('\n')).toMatch(/weitere_angaben\.2/);
    expect(w.join('\n')).toMatch(/weitere_angaben\.3/);
    expect(w.join('\n')).toMatch(/weitere_angaben\.4/);
    expect(w.join('\n')).not.toMatch(/Instandhaltung|Besichtigung/);
  });

  it('ohne weitere Angaben keine Warnung', () => {
    expect(kernfeldDopplung(exposeV1Leer())).toEqual([]);
  });
});
