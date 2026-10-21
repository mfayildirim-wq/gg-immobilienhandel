// Einheiten ohne Verteilung (Fachentscheidung 16.10.2026, Protokoll 31 §8.4): Gesamtwerte aus dem Exposé landen in der
// ersten offenen Zeile, der Rest bleibt leer — der Nutzer teilt selbst auf. Bewusste Abweichung von der alten App
// (expose-wizard.ts 1424–1456: Flächen gleichmäßig, Mieten nach Fläche verteilt).
import { describe, expect, it } from 'vitest';
import { EINHEITEN_ZEILEN_MAX, einheitenSumme, exposeVorbereiten } from '../src/index.ts';

const mit = (objekt: Record<string, unknown>) => exposeVorbereiten({ objekt, makler: {}, kalkulation: {} });

describe('exposeVorbereiten: Gesamtwerte ohne Verteilung', () => {
  it('Fall A: nur Gesamtwerte und Anzahl → erste Zeile trägt Fläche und Miete, neun Zeilen leer', () => {
    const v = mit({ wohnflaeche: 500, istmiete: 5000, einheitenAnz: 10, einheiten: [] });
    expect(v.objekt.einheiten).toHaveLength(10);
    expect(v.objekt.einheiten[0]).toMatchObject({ typ: 'Wohnung', flaeche: 500, kaltmiete: 5000, hinweis: 'gesamtwert' });
    for (const e of v.objekt.einheiten.slice(1)) expect(e).toMatchObject({ flaeche: null, kaltmiete: null });
    expect(v.objekt.einheiten.slice(1).every((e: { hinweis?: string | null }) => !e.hinweis)).toBe(true);
    expect(v.warnungen).toEqual([]);
  });

  it('Fall A ohne Anzahl → eine Zeile mit den Gesamtwerten; ohne Gesamtwerte und Anzahl → keine Zeile', () => {
    expect(mit({ wohnflaeche: 240 }).objekt.einheiten).toEqual([{ typ: 'Wohnung', lage: null, zimmer: null, flaeche: 240, kaltmiete: null, vermiet: null, hinweis: 'gesamtwert' }]);
    expect(mit({ stadt: 'Ulm' }).objekt.einheiten).toBeUndefined();
    // die Anzahl ist gedeckelt
    expect(mit({ einheitenAnz: 5000 }).objekt.einheiten).toHaveLength(EINHEITEN_ZEILEN_MAX);
  });

  it('Fall B: zwei Zeilen bekannt → Rest in der ersten offenen Zeile, darunter leer; Stellplatz bleibt außen vor', () => {
    const v = mit({
      wohnflaeche: 500, istmiete: 5000,
      einheiten: [
        { typ: 'Wohnung', lage: 'EG', flaeche: 70, kaltmiete: 600 },
        { typ: 'Wohnung', lage: 'OG', flaeche: 130, kaltmiete: 1100 },
        { typ: 'Stellplatz', lage: 'TG', flaeche: null, kaltmiete: null },
        { typ: 'Wohnung', lage: 'DG', flaeche: null, kaltmiete: null },
        { typ: 'Wohnung', lage: 'DG2', flaeche: null, kaltmiete: null },
      ],
    });
    const e = v.objekt.einheiten;
    expect(e[0]).toMatchObject({ flaeche: 70, kaltmiete: 600 });
    expect(e[0].hinweis).toBeUndefined();
    expect(e[2]).toMatchObject({ typ: 'Stellplatz', flaeche: null, kaltmiete: null });
    expect(e[3]).toMatchObject({ flaeche: 300, kaltmiete: 3300, hinweis: 'rest' });
    expect(e[4]).toMatchObject({ flaeche: null, kaltmiete: null });
    expect(v.warnungen).toEqual([]);
  });

  it('Fläche und Miete laufen getrennt: eine Zeile mit Fläche ohne Miete zählt bei der Miete als offen', () => {
    const v = mit({ wohnflaeche: 200, istmiete: 2000, einheiten: [{ typ: 'Wohnung', flaeche: 80, kaltmiete: null }, { typ: 'Wohnung', flaeche: null, kaltmiete: null }] });
    const e = v.objekt.einheiten;
    expect(e[0]).toMatchObject({ flaeche: 80, kaltmiete: 2000, hinweis: 'gesamtwert' }); // Miete: keine Zeile kannte sie → Gesamtwert in die erste
    expect(e[1]).toMatchObject({ flaeche: 120, kaltmiete: null, hinweis: 'rest' });
  });

  it('0 € gilt als bekannt (Leerstand), nicht als offen', () => {
    const v = mit({ istmiete: 1000, einheiten: [{ typ: 'Wohnung', kaltmiete: 0 }, { typ: 'Wohnung', kaltmiete: null }] });
    expect(v.objekt.einheiten[1]).toMatchObject({ kaltmiete: 1000, hinweis: 'rest' });
  });

  it('Fall C: alle Zeilen bekannt → nichts ändern; Abweichung der Summe über 1 % nur als Warnung', () => {
    const passt = mit({ wohnflaeche: 240, istmiete: 2320, einheiten: [{ typ: 'Wohnung', flaeche: 80, kaltmiete: 800 }, { typ: 'Wohnung', flaeche: 80, kaltmiete: 820 }, { typ: 'Wohnung', flaeche: 80, kaltmiete: 700 }] });
    expect(passt.warnungen).toEqual([]);
    expect(passt.objekt.einheiten.every((e: { hinweis?: string | null }) => !e.hinweis)).toBe(true);
    const weicht = mit({ wohnflaeche: 500, istmiete: 5000, einheiten: [{ typ: 'Wohnung', flaeche: 240, kaltmiete: 2400 }, { typ: 'Wohnung', flaeche: 240, kaltmiete: 2400 }] });
    expect(weicht.objekt.einheiten[0]).toMatchObject({ flaeche: 240, kaltmiete: 2400 });
    expect(weicht.warnungen).toEqual([
      'Wohnfläche: Einheiten ergeben 480 m², das Exposé nennt 500 m²',
      'Ist-Miete: Einheiten ergeben 4.800 €, das Exposé nennt 5.000 €',
    ]);
  });

  it('negativer Rest: bekannte Zeilen übersteigen den Gesamtwert → nichts eintragen, Warnung', () => {
    const v = mit({ wohnflaeche: 100, einheiten: [{ typ: 'Wohnung', flaeche: 120 }, { typ: 'Wohnung', flaeche: null }] });
    expect(v.objekt.einheiten[1].flaeche).toBeNull();
    expect(v.warnungen).toEqual(['Wohnfläche: bekannte Einheiten ergeben schon 120 m², das Exposé nennt 100 m² — Rest nicht eingetragen']);
  });

  it('Telefon, Makler und Deal wie bisher; die Eingabe bleibt unverändert', () => {
    const roh = { objekt: { einheiten: [{ typ: 'Wohnung', flaeche: null }], wohnflaeche: 50 }, makler: { festnetztel: '0711 123456' }, kalkulation: { kaufpreis: 1 } };
    const v = exposeVorbereiten(roh);
    expect(v.makler).toMatchObject({ tel: '0711 123456', prio: 'B', kontaktFreq: 'Monatlich' });
    expect(v.deal).toMatchObject({ status: 'In Prüfung', kalk: { kaufpreis: 1 } });
    expect(roh.objekt.einheiten[0]!.flaeche).toBeNull();
  });
});

describe('einheitenSumme (Summenzeile der Prüfseite)', () => {
  it('summiert Fläche und Miete und meldet Abweichungen über 1 % vom Exposé', () => {
    const e = [{ flaeche: 70, kaltmiete: 600 }, { flaeche: 130, kaltmiete: 1100 }, { typ: 'Stellplatz', flaeche: null, kaltmiete: 50 }];
    expect(einheitenSumme(e, 200, 1750)).toEqual({ flaeche: 200, miete: 1750, flaecheWeicht: false, mieteWeicht: false });
    expect(einheitenSumme(e, 500, null)).toMatchObject({ flaecheWeicht: true, mieteWeicht: false });
    expect(einheitenSumme(e, 201, 1760)).toMatchObject({ flaecheWeicht: false, mieteWeicht: false }); // innerhalb 1 %
    expect(einheitenSumme([{ flaeche: '80' }], 80, 0)).toMatchObject({ flaeche: 80, flaecheWeicht: false });
  });
});
