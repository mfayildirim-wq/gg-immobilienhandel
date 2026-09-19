/** Golden Master: „Alle setzen“ im Reiter Kalkulation (dealBulkRendite, dealBulkKpm2, dealBulkMietsteigerung) wie in der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { einheitenAusErkennung, einheitenErsetzenFrage, sammelKpm2, sammelMietsteigerung, sammelRendite, varianteLaden, varianteSchnappschuss } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/kalkulationswerkzeuge.json'), 'utf8')) as { faelle: any[] };

describe('Kalkulation: Alle setzen (Golden Master)', () => {
  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const ohneId = (es: any[]) => es.map(({ id: _id, ...e }) => e);
    const eingabe = ohneId(varianteLaden({ einheiten: f.einheiten }).einheiten);
    const r = f.art === 'rendite' ? sammelRendite(eingabe, f.eingabe) : f.art === 'kpm2' ? sammelKpm2(eingabe, f.eingabe) : sammelMietsteigerung(eingabe, f.pct);
    if (!r.ok) {
      expect([`error:${r.fehler}`]).toEqual(f.hinweise);
      return;
    }
    expect([r.hinweis]).toEqual(f.hinweise);
    expect(r.einheiten).toEqual(ohneId(varianteLaden({ einheiten: f.ergebnis }).einheiten));
  });
});

describe('Kalkulationsvarianten', () => {
  const einheiten = [
    { typ: 'Wohnung', lage: 'EG', zimmer: 2, flaeche: 55.5, mieteIst: 480, mieteNeu: 520, mieteNeuManuell: true, renditeK: 4.5, verkaufspreis: null, stueck: null },
    { typ: 'Stellplatz', lage: null, zimmer: null, flaeche: null, mieteIst: 50, mieteNeu: null, mieteNeuManuell: false, renditeK: null, verkaufspreis: 12000, stueck: 2 },
  ];
  const sanierungen = [{ beschreibung: 'Dach', betrag: 40000, bereich: 'auf' as const }, { beschreibung: null, betrag: null, bereich: null }];

  it('IDs bleiben erhalten (Verweise aus Kundenkalkulation und Vertriebsliste)', () => {
    const s = varianteSchnappschuss([{ ...einheiten[0]!, id: 'd1:e1' }], [{ ...sanierungen[0]!, id: 'd1:s1' }]);
    expect(s.einheiten[0]!.id).toBe('d1:e1');
    expect(varianteLaden({ einheiten: s.einheiten, sanierungen: s.sanierung })).toMatchObject({ einheiten: [{ id: 'd1:e1' }], sanierungen: [{ id: 'd1:s1' }] });
  });

  it('Schnappschuss im Altformat (dealDE/dealDSAN) und zurück', () => {
    const s = varianteSchnappschuss(einheiten, sanierungen);
    expect(s.einheiten[0]).toEqual({ typ: 'Wohnung', lage: 'EG', zimmer: 2, fl: 55.5, mi_ist: 480, mi_neu: 520, mi_neu_manual: true, rend_k: 4.5, stk: 1 });
    expect(s.sanierung[1]).toEqual({ desc: '', amt: '', scope: 'both' });
    const zurueck = varianteLaden({ einheiten: s.einheiten, sanierungen: s.sanierung });
    expect(zurueck.einheiten[0]).toEqual({ ...einheiten[0], stueck: 1 });
    expect(zurueck.einheiten[1]).toEqual({ ...einheiten[1], lage: null, zimmer: 0, flaeche: 0 });
    expect(zurueck.sanierungen).toEqual([sanierungen[0], { beschreibung: null, betrag: null, bereich: 'both' }]);
  });

  it('Altbestand mit deutschen Zahltexten', () => {
    const v = varianteLaden({ einheiten: [{ typ: 'Wohnung', fl: '1.234,5', mi_ist: '980', rend_k: '5', vkp: '' }], sanierungen: [{ desc: 'Fenster', amt: '12000', scope: 'kaputt' }] });
    expect(v.einheiten[0]).toMatchObject({ flaeche: 1234.5, mieteIst: 980, renditeK: 5, verkaufspreis: null, mieteNeuManuell: false });
    expect(v.sanierungen[0]).toEqual({ beschreibung: 'Fenster', betrag: 12000, bereich: null });
  });
});

describe('Einheiten aus Mieterliste-PDF', () => {
  const erkannt = [
    { typ: 'Wohnung', lage: 'EG li.', zimmer: 3, flaeche: 78.5, kaltmiete: 780 },
    { typ: 'Stellplatz', lage: 'TG', zimmer: null, flaeche: null, kaltmiete: 0, stk: 10 },
    { typ: 'Gewerbe', lage: '', flaeche: 120, kaltmiete: null },
    { typ: 'Wohnung', lage: '1. OG' }, { typ: 'Wohnung', lage: '2. OG' }, { typ: 'Wohnung', lage: 'DG' },
  ];
  it('ersetzt die Liste wie dealExtractUnitsFromPdf (Stellplatz ohne Fläche, Kaltmiete auch als SOLL, Standardrendite)', () => {
    const e = einheitenAusErkennung(erkannt, 5);
    expect(e[0]).toEqual({ typ: 'Wohnung', lage: 'EG li.', zimmer: 3, flaeche: 78.5, mieteIst: 780, mieteNeu: 780, mieteNeuManuell: false, renditeK: 5, verkaufspreis: null, stueck: 1 });
    expect(e[1]).toEqual({ typ: 'Stellplatz', lage: 'TG', zimmer: 0, flaeche: 0, mieteIst: 0, mieteNeu: 0, mieteNeuManuell: false, renditeK: 5, verkaufspreis: null, stueck: 10 });
    expect(e[2]).toMatchObject({ lage: null, zimmer: 0, flaeche: 120, mieteIst: null, mieteNeu: null });
  });
  it('Rückfrage mit Vorschau der ersten fünf', () => {
    expect(einheitenErsetzenFrage(erkannt, 2, 3)).toBe(
      'Aus 2 PDF-Seite(n) wurden 6 Einheit(en) erkannt:\n\n• Wohnung EG li. (78.5 m²) 780 €\n• Stellplatz TG\n• Gewerbe  (120 m²)\n• Wohnung 1. OG\n• Wohnung 2. OG\n… und 1 weitere\n\n⚠️ Die aktuelle Liste mit 3 Einheit(en) wird KOMPLETT ERSETZT. Fortfahren?',
    );
  });
});
