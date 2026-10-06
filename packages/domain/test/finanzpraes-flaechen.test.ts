import { describe, expect, it } from 'vitest';
import { flaechenVorbelegen, objektFakten } from '../src/index.ts';

const deal = (einheiten: { typ: string; fl?: number | string | null }[], kaufpreis = 600_000) => ({ kalk: { kaufpreis }, einheiten });

describe('flaechenVorbelegen (Bank-Präsentation, Objektbeschreibung) — Fachentscheidung 06.10.2026', () => {
  it('Wohnfläche aus Wohnungen und Sonstigem, Gewerbefläche aus Gewerbe, Mietfläche = beides; Stellplätze zählen nicht', () => {
    const d = deal([{ typ: 'Wohnung', fl: 80 }, { typ: 'Sonstiges', fl: '20' }, { typ: 'Gewerbe', fl: 100 }, { typ: 'Stellplatz', fl: null }]);
    expect(flaechenVorbelegen({}, d, { wohnflaeche: 999 })).toMatchObject({ wohnflaeche: '100', gewerbeflaeche: '100', mietflaeche: '200', kaufpreisPerM2: '3.000 €/m²' });
  });
  it('nur Wohnungen: keine Gewerbefläche (bleibt leer, Zeile erscheint nicht)', () => {
    expect(flaechenVorbelegen({}, deal([{ typ: 'Wohnung', fl: 75.5 }]), null)).toMatchObject({ wohnflaeche: '75,5', gewerbeflaeche: '', mietflaeche: '75,5' });
  });
  it('ohne Flächen in den Einheiten bleibt die Wohnfläche aus dem Objekt, Mietfläche folgt ihr', () => {
    expect(flaechenVorbelegen({ wohnflaeche: '480' }, deal([]), { wohnflaeche: 480 })).toMatchObject({ wohnflaeche: '480', gewerbeflaeche: '', mietflaeche: '480' });
  });
});

describe('objektFakten: Reihenfolge der Eckdaten, leere Zeilen fallen weg', () => {
  it('Wohnfläche, Gewerbefläche und Mietfläche untereinander, je mit m²', () => {
    const f = objektFakten({ adresse: 'Musterweg 1', stellplaetze: '2', wohnflaeche: '100', gewerbeflaeche: '50', mietflaeche: '150', grundstueck: '400' });
    expect(f.map(([k]) => k)).toEqual(['Adresse', 'Stellplätze', 'Wohnfläche', 'Gewerbefläche', 'Mietfläche', 'Grundstück']);
    expect(f.find(([k]) => k === 'Gewerbefläche')![1]).toBe('50 m²');
  });
  it('nicht ausgefüllt → keine Zeile', () => {
    expect(objektFakten({ wohnflaeche: '100', gewerbeflaeche: '', mietflaeche: '' }).map(([k]) => k)).toEqual(['Wohnfläche']);
  });
});
