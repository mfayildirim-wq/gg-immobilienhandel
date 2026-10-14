import { describe, expect, it } from 'vitest';
import { einheitenTreffer, feldUrteil, goldAlsMarkdown, goldAusTabellen, goldVergleich, zuordnen } from '../src/index.ts';
import { exposeV2MitFeldern } from './fixtures/expose-v2-beispiel.ts';

const O = (nr: number, feld: string, vorschlag: unknown, pruefung: string, richtig: unknown = '') => [nr, 'a.pdf', feld, '', vorschlag, '', pruefung, richtig];
const E = (nr: number, typ: string, flaeche: unknown, kaltmiete: unknown, pruefung: string) => [nr, 'a.pdf', 1, typ, '', '', flaeche, kaltmiete, '', '', pruefung];

describe('Goldstandard (Protokoll 30, P0)', () => {
  it('liest die Vorlage: ok → Vorschlag, korrigiert → richtiger Wert, „nicht im Exposé“ → null, ungeprüft → fehlt', () => {
    const g = goldAusTabellen(
      [O(8, 'kaufpreis', 1_250_000, 'ok'), O(8, 'baujahr', 1965, 'korrigiert', 1966), O(8, 'energieklasse', 'D', 'nicht im Exposé'), O(8, 'plz', '89073', ''), O(8, 'unbekannt', 1, 'ok')],
      [E(8, 'Wohnung', 80, 800, 'ok'), E(8, 'Stellplatz', '', '60 €', 'korrigiert'), E(8, 'Wohnung', 1, 1, 'streichen'), E(9, 'Wohnung', 50, 500, '')],
    );
    expect(g).toEqual([
      { nr: 8, datei: 'a.pdf', soll: { kaufpreis: 1_250_000, baujahr: 1966, energieklasse: null }, einheiten: [{ typ: 'Wohnung', flaeche: 80, kaltmiete: 800 }, { typ: 'Stellplatz', flaeche: null, kaltmiete: 60 }] },
      { nr: 9, datei: 'a.pdf', soll: {}, einheiten: null },
    ]);
  });

  it('Urteile je Feld', () => {
    expect(feldUrteil('kaufpreis', 1_250_000, 1_250_000)).toBe('richtig');
    expect(feldUrteil('kaufpreis', 1_250_000, 1_300_000)).toBe('falsch');
    expect(feldUrteil('kaufpreis', 1_250_000, null)).toBe('ausgelassen');
    expect(feldUrteil('energieklasse', null, 'D')).toBe('erfunden');
    expect(feldUrteil('energieklasse', null, null)).toBe('richtigLeer');
    expect(feldUrteil('makler_telefon', '+49 171 1234567', '0731 1 | 0171 1234567')).toBe('richtig');
    expect(feldUrteil('strasse', 'Musterweg', 'musterweg')).toBe('richtig');
  });

  it('Einheiten: Treffer je Typ, jede Soll-Einheit nur einmal', () => {
    const t = einheitenTreffer(
      [{ typ: 'Wohnung', flaeche: 80, kaltmiete: 800 }, { typ: 'Wohnung', flaeche: 80, kaltmiete: 820 }, { typ: 'Stellplatz', flaeche: null, kaltmiete: 60 }],
      [{ typ: 'Wohnung', lage: null, zimmer: null, flaeche: 80.4, kaltmiete: 800, vermiet: null }, { typ: 'Wohnung', lage: null, zimmer: null, flaeche: 80, kaltmiete: 800, vermiet: null }],
    );
    expect(t).toMatchObject({ soll: 3, ist: 2, treffer: 1, f1: 0.4, jeTyp: { Wohnung: { treffer: 1 }, Stellplatz: { soll: 1, ist: 0, f1: 0 } } });
  });

  it('Vergleich über Exposés + Markdown ohne Inhalte', () => {
    const p = zuordnen(exposeV2MitFeldern());
    const gold = goldAusTabellen([O(1, 'kaufpreis', 1_250_000, 'ok'), O(1, 'ort', 'Ulm', 'ok'), O(1, 'energieklasse', 'C', 'korrigiert', 'C')], [E(1, 'Stellplatz', '', 60, 'ok')]);
    const r = goldVergleich(gold, new Map([[1, { pruefdaten: p.pruefdaten, details: p.details }]]));
    expect(r.gesamt).toMatchObject({ richtig: 2, falsch: 1, genauigkeit: 0.667 });
    expect(r.einheiten).toMatchObject({ soll: 1, treffer: 1 });
    const md = goldAlsMarkdown({ v2: r });
    expect(md).toContain('| kaufpreis | 100 % (0 f · 0 a · 0 e) |');
    expect(md).not.toContain('Ulm');
  });
});
