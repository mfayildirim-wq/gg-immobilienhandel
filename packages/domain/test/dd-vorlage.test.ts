import { describe, expect, it } from 'vitest';
import { DD_STANDARD, ddListeBereinigen } from '../src/index.ts';

describe('DD-Dokumentenliste', () => {
  it('Auslieferungszustand wie die alte App: 34 Positionen, erste und letzte', () => {
    expect(DD_STANDARD.length).toBe(34);
    expect(DD_STANDARD[0]).toEqual({ dokument: 'Fotos (professionell)', quelle: '—' });
    expect(DD_STANDARD[33]).toEqual({ dokument: 'Kaufvertragsentwurf', quelle: 'Notariat' });
  });
  it('Speichern: trimmen, leere Positionen entfallen, fehlende Quelle wird zum Gedankenstrich', () => {
    expect(ddListeBereinigen([{ dokument: '  Grundbuchauszug ', quelle: ' Notariat ' }, { dokument: '   ', quelle: 'x' }, { dokument: 'Mieterliste', quelle: '' }, { dokument: 'Plan' }]))
      .toEqual([{ dokument: 'Grundbuchauszug', quelle: 'Notariat' }, { dokument: 'Mieterliste', quelle: '—' }, { dokument: 'Plan', quelle: '—' }]);
  });
});
