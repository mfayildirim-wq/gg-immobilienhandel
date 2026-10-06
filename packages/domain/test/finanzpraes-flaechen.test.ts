import { describe, expect, it } from 'vitest';
import { flaechenVorbelegen, mietflaecheSumme, objektFakten } from '../src/index.ts';

const deal = (einheiten: { typ: string; fl?: number | string | null }[], kaufpreis = 600_000) => ({ kalk: { kaufpreis }, einheiten });

describe('flaechenVorbelegen: beim Vorbelegen Wohn- und Gewerbefläche aus den Einheiten — sonst nichts', () => {
  it('Wohnfläche aus Wohnungen und Sonstigem, Gewerbefläche aus Gewerbe; Stellplätze zählen nicht', () => {
    const d = deal([{ typ: 'Wohnung', fl: 80 }, { typ: 'Sonstiges', fl: '20' }, { typ: 'Gewerbe', fl: 100 }, { typ: 'Stellplatz', fl: null }]);
    expect(flaechenVorbelegen({}, d, { wohnflaeche: 999 })).toMatchObject({ wohnflaeche: '100', gewerbeflaeche: '100' });
  });
  it('Mietfläche und Kaufpreis pro m² bleiben unangetastet', () => {
    const vorher = { mietflaeche: '170', kaufpreisPerM2: '4.779 €/m²' };
    expect(flaechenVorbelegen(vorher, deal([{ typ: 'Wohnung', fl: 80 }, { typ: 'Gewerbe', fl: 100 }]), null)).toMatchObject(vorher);
  });
  it('ohne Flächen in den Einheiten bleibt die Wohnfläche aus dem Objekt, keine Gewerbefläche', () => {
    expect(flaechenVorbelegen({ wohnflaeche: '480' }, deal([]), { wohnflaeche: 480 })).toMatchObject({ wohnflaeche: '480', gewerbeflaeche: '' });
  });
});

describe('mietflaecheSumme: Knopf neben der Mietfläche = Wohnfläche + Gewerbefläche aus dem Formular', () => {
  it('summiert die eingetragenen Werte, auch mit Komma und Tausenderpunkt', () => {
    expect(mietflaecheSumme('120', '80')).toBe('200');
    expect(mietflaecheSumme('1.200,5', '99,5')).toBe('1.300');
    expect(mietflaecheSumme('75,5', '')).toBe('75,5');
  });
  it('beide leer → leer (keine Zeile in der Folie)', () => {
    expect(mietflaecheSumme('', undefined)).toBe('');
  });
});

describe('objektFakten: Reihenfolge der Eckdaten, leere Zeilen fallen weg', () => {
  it('Mietfläche, darunter Wohnfläche und Gewerbefläche, je mit m²', () => {
    const f = objektFakten({ adresse: 'Musterweg 1', stellplaetze: '2', wohnflaeche: '100', gewerbeflaeche: '50', mietflaeche: '150', grundstueck: '400' });
    expect(f.map(([k]) => k)).toEqual(['Adresse', 'Stellplätze', 'Mietfläche', 'Wohnfläche', 'Gewerbefläche', 'Grundstück']);
    expect(f.find(([k]) => k === 'Gewerbefläche')![1]).toBe('50 m²');
  });
  it('nicht ausgefüllt → keine Zeile', () => {
    expect(objektFakten({ wohnflaeche: '100', gewerbeflaeche: '', mietflaeche: '' }).map(([k]) => k)).toEqual(['Wohnfläche']);
  });
});
