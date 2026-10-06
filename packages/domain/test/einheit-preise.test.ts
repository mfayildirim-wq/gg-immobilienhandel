import { describe, expect, it } from 'vitest';
import { berechneAnkauf, einheitAlsEingabe, type EinheitDaten, einheitMieteGeaendert, einheitPreisSetzen } from '../src/index.ts';

// 80 m², Miete SOLL 1.000 €/Monat → 12.000 €/Jahr
const wohnung: EinheitDaten = { typ: 'Wohnung', flaeche: 80, mieteIst: 1000, mieteNeu: null, mieteNeuManuell: false, renditeK: 4, verkaufspreis: null, stueck: null };
/** Was die Tabelle zeigt: dieselbe Rechnung wie der Kern. */
const anzeige = (e: EinheitDaten) => {
  const z = berechneAnkauf({}, [einheitAlsEingabe(e)], []).einheiten.zeilen[0]!;
  return { rendite: e.renditeK, vkp: z.verkaufspreis, kpm2: z.verkaufspreisProQm };
};

describe('einheitPreisSetzen: Rendite, VKP und KP/m² hängen zusammen (wie dealUEDirect/dealUEFromVkp/dealUEFromKpm2)', () => {
  it('Rendite: ein von Hand gesetzter VKP fällt weg, VKP und KP/m² folgen aus der Miete SOLL', () => {
    const e = { ...wohnung, ...einheitPreisSetzen({ ...wohnung, verkaufspreis: 999_999 }, 'rendite', 5) };
    expect(e).toMatchObject({ renditeK: 5, verkaufspreis: null });
    expect(anzeige(e)).toEqual({ rendite: 5, vkp: 240_000, kpm2: 3000 });
  });

  it('VKP: die Rendite folgt (eine Nachkommastelle), KP/m² aus der Fläche', () => {
    const e = { ...wohnung, ...einheitPreisSetzen(wohnung, 'vkp', 320_000) };
    expect(e).toMatchObject({ renditeK: 3.8, verkaufspreis: 320_000 }); // 12.000 / 320.000 = 3,75 % → 3,8
    expect(anzeige(e)).toEqual({ rendite: 3.8, vkp: 320_000, kpm2: 4000 });
  });

  it('KP/m²: VKP = KP/m² × Fläche, die Rendite folgt', () => {
    const e = { ...wohnung, ...einheitPreisSetzen(wohnung, 'kpm2', 2500) };
    expect(e).toMatchObject({ renditeK: 6, verkaufspreis: 200_000 });
    expect(anzeige(e)).toEqual({ rendite: 6, vkp: 200_000, kpm2: 2500 });
  });

  it('Miete SOLL von Hand zählt statt der IST-Miete', () => {
    const soll = { ...wohnung, mieteNeu: 1250, mieteNeuManuell: true };
    expect(einheitPreisSetzen(soll, 'vkp', 300_000)).toMatchObject({ renditeK: 5 });
  });

  it('Grenzfälle: ohne Miete bleibt die Rendite, ohne Fläche (Stellplatz) wirkt KP/m² nicht, leeres VKP-Feld rechnet wieder aus der Rendite', () => {
    expect(einheitPreisSetzen({ ...wohnung, mieteIst: null }, 'vkp', 300_000)).toEqual({ renditeK: 4, verkaufspreis: 300_000 });
    const stellplatz = { ...wohnung, typ: 'Stellplatz', flaeche: null, mieteIst: 50, renditeK: 5 };
    expect(einheitPreisSetzen(stellplatz, 'kpm2', 2000)).toEqual({ renditeK: 5, verkaufspreis: null });
    expect(einheitPreisSetzen({ ...wohnung, flaeche: null }, 'kpm2', 2000)).toEqual({ renditeK: 4, verkaufspreis: null });
    expect(einheitPreisSetzen({ ...wohnung, verkaufspreis: 320_000 }, 'vkp', null)).toEqual({ renditeK: 4, verkaufspreis: null });
  });
});

describe('einheitMieteGeaendert: bei festem VKP passt die Rendite zur neuen Miete (bewusst anders als alt)', () => {
  it('fester VKP: Rendite neu aus der Miete', () => {
    expect(einheitMieteGeaendert({ ...wohnung, mieteIst: 1100, verkaufspreis: 330_000, renditeK: 3.6 })).toMatchObject({ renditeK: 4, verkaufspreis: 330_000 });
  });
  it('ohne festen VKP oder ohne Miete bleibt alles, wie es ist', () => {
    expect(einheitMieteGeaendert({ ...wohnung, mieteIst: 1100 })).toMatchObject({ renditeK: 4, verkaufspreis: null });
    expect(einheitMieteGeaendert({ ...wohnung, mieteIst: null, verkaufspreis: 330_000, renditeK: 3.6 })).toMatchObject({ renditeK: 3.6 });
  });
});
