import { describe, expect, it } from 'vitest';
import { berechneAnkauf, KALK_STANDARD, kalkMitStandard } from '../src/index.ts';

describe('Kalkulation vorbelegen (ensure der alten App)', () => {
  const sanierung = [{ id: 's1', desc: 'Treppenhaus', amt: 15000 }];
  const eigene = { ...KALK_STANDARD, rp_pct: 0, notar: 2 };

  it('fehlende Felder kommen aus den gespeicherten Standardwerten — auch eine 0', () => {
    expect(kalkMitStandard({ kaufpreis: 500000 }, eigene)).toMatchObject({ kaufpreis: 500000, rp_pct: 0, notar: 2 });
    expect(kalkMitStandard({ rp_pct: null, notar: '' } as never, eigene)).toMatchObject({ rp_pct: 0, notar: 2 });
  });
  it('gesetzte Werte bleiben — auch eine gesetzte 0; die Eingabe wird nicht verändert', () => {
    const k = { kaufpreis: 1, rp_pct: 20, makler: 0 };
    expect(kalkMitStandard(k, eigene)).toMatchObject({ rp_pct: 20, makler: 0 });
    expect(Object.keys(k)).toEqual(['kaufpreis', 'rp_pct', 'makler']);
  });
  it('der Fall aus der Parallelprüfung: Standard-Puffer 0 % → 15.000 € Sanierung, nicht 16.500 €', () => {
    const k = { kaufpreis: 500000 };
    expect(berechneAnkauf(kalkMitStandard(k, eigene), [], sanierung, eigene).sanierungPuffer).toBe(0);
    expect(berechneAnkauf(kalkMitStandard(k, KALK_STANDARD), [], sanierung, KALK_STANDARD).sanierungPuffer).toBe(1500);
  });
});
