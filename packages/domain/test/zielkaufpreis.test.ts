import { describe, expect, it } from 'vitest';
import { berechneAnkauf, globalBeiSollRendite, KALK_STANDARD, kalkMitStandard, zielKaufpreis, zielWerte } from '../src/index.ts';

// 6 Wohnungen à 1.000 € IST-Miete = 6.000 €/Monat, 72.000 €/Jahr; Rendite der Einheiten 4,5 %
const einheiten = Array.from({ length: 6 }, () => ({ typ: 'Wohnung', fl: 70, mi_ist: 1000, rend_k: 4.5 }));
const k = (extra: Record<string, number> = {}) => kalkMitStandard({ kaufpreis: 1_500_000, ...extra }, KALK_STANDARD);

describe('Kaufpreis für Zielmarge', () => {
  it('Global 20 % bei Soll-Rendite 5 % (Faktor 20): Kaufpreis ≈ 1.010.680 €, Marge genau 20 %', () => {
    const z = zielKaufpreis('global', k(), einheiten, [], KALK_STANDARD);
    if (!z.ok) throw new Error(z.grund);
    expect(z.verkaufspreis).toBe(1_440_000);
    expect(z.kaufpreis).toBeGreaterThan(1_010_000);
    expect(z.kaufpreis).toBeLessThan(1_011_000);
    expect(z.marge).toBeGreaterThanOrEqual(20);
    expect(z.marge).toBeCloseTo(20, 4);
  });

  it('Global mit Faktor 30 (Soll-Rendite 3,33 %): Kaufpreis ≈ 1.483.800 €', () => {
    const z = zielKaufpreis('global', k({ rend_glo: 100 / 30 }), einheiten, [], KALK_STANDARD);
    if (!z.ok) throw new Error(z.grund);
    expect(z.verkaufspreis).toBe(2_160_000);
    expect(z.kaufpreis).toBeGreaterThan(1_483_000);
    expect(z.kaufpreis).toBeLessThan(1_484_500);
    expect(z.marge).toBeCloseTo(20, 4);
  });

  it('Aufteiler 15 %: der gesetzte Kaufpreis ergibt in der echten Kalkulation genau 15,00 %', () => {
    const z = zielKaufpreis('aufteiler', k(), einheiten, [], KALK_STANDARD);
    if (!z.ok) throw new Error(z.grund);
    const r = berechneAnkauf({ ...k(), kaufpreis: z.kaufpreis }, einheiten, [], KALK_STANDARD);
    expect(r.aufteiler.marge).toBeGreaterThanOrEqual(15);
    expect(r.kennzahlen.margeAuf).toBe(15);
  });

  it('rechnet Sanierung, Puffer, Provision und eigene Finanzierung mit (Gegenprobe über den Rechenkern)', () => {
    const san = [{ amt: 120_000, scope: 'both' }, { amt: 30_000, scope: 'auf' }];
    const eigen = k({ halt: 18, fk_p: 70, ek_p: 30, aufk: 9_600, ziel_auf: 12, ziel_glo: 18, rend_glo: 4 });
    for (const weg of ['aufteiler', 'global'] as const) {
      const z = zielKaufpreis(weg, eigen, einheiten, san, KALK_STANDARD);
      if (!z.ok) throw new Error(z.grund);
      const r = berechneAnkauf({ ...eigen, kaufpreis: z.kaufpreis }, einheiten, san, KALK_STANDARD);
      const marge = weg === 'aufteiler' ? r.aufteiler.marge : globalBeiSollRendite(r.global.gik, r.jahresnettokaltmieteSoll, 4).marge;
      expect(marge).toBeCloseTo(weg === 'aufteiler' ? 12 : 18, 3);
      // ein Euro mehr Kaufpreis, und das Ziel ist verfehlt
      const r1 = berechneAnkauf({ ...eigen, kaufpreis: z.kaufpreis + 1 }, einheiten, san, KALK_STANDARD);
      const marge1 = weg === 'aufteiler' ? r1.aufteiler.marge : globalBeiSollRendite(r1.global.gik, r1.jahresnettokaltmieteSoll, 4).marge;
      expect(marge1).toBeLessThan(weg === 'aufteiler' ? 12 : 18);
    }
  });

  it('auch bei langer Haltedauer (Rechenkern ohne Zirkelauflösung) bleibt die Rückrechnung exakt', () => {
    const lang = k({ halt: 240 });
    const z = zielKaufpreis('aufteiler', lang, einheiten, [], KALK_STANDARD);
    if (!z.ok) throw new Error(z.grund);
    expect(berechneAnkauf({ ...lang, kaufpreis: z.kaufpreis }, einheiten, [], KALK_STANDARD).aufteiler.marge).toBeCloseTo(15, 3);
  });

  it('ohne Mieten gibt es keinen Vorschlag, sondern einen Grund', () => {
    const z = zielKaufpreis('global', k(), [], [], KALK_STANDARD);
    expect(z.ok).toBe(false);
    expect(zielKaufpreis('aufteiler', k(), [], [], KALK_STANDARD).ok).toBe(false);
  });

  it('sind schon die übrigen Kosten zu hoch, kommt kein negativer Kaufpreis', () => {
    const z = zielKaufpreis('global', k(), einheiten, [{ amt: 5_000_000 }], KALK_STANDARD);
    expect(z).toMatchObject({ ok: false });
  });

  it('Zielwerte: Deal-Wert vor Einstellung vor Werkseinstellung (auch für Standards ohne die neuen Felder)', () => {
    expect(zielWerte({}, KALK_STANDARD)).toEqual({ margeAufteiler: 15, margeGlobal: 20, sollRenditeGlobal: 5 });
    expect(zielWerte({}, { ...KALK_STANDARD, ziel_glo: 25 }).margeGlobal).toBe(25);
    expect(zielWerte({ ziel_glo: 22 }, { ...KALK_STANDARD, ziel_glo: 25 }).margeGlobal).toBe(22);
    const { ziel_auf: _a, ziel_glo: _g, rend_glo: _r, ...altStandard } = KALK_STANDARD;
    expect(zielWerte({}, altStandard).sollRenditeGlobal).toBe(5);
  });

  it('Global zur Soll-Rendite: Faktor und Marge', () => {
    expect(globalBeiSollRendite(1_152_000, 72_000, 5)).toEqual({ verkaufspreis: 1_440_000, gewinn: 288_000, marge: 20, faktor: 20 });
  });
});
