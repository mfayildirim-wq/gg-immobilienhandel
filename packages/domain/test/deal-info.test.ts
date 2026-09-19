import { describe, expect, it } from 'vitest';
import { dealVorbelegungAusObjekt, maklerMailBetreff, naechsterKontaktNachFrequenz } from '../src/index.ts';

describe('Deal-Info (dealFreqChanged, dealPrefillObj)', () => {
  it('Frequenzwechsel belegt den nächsten Kontakt nur vor, wenn keiner gesetzt ist', () => {
    expect(naechsterKontaktNachFrequenz('Monatlich', '', '2026-09-17')).toBe('2026-10-17');
    expect(naechsterKontaktNachFrequenz('Wöchentlich', null, '2026-12-28')).toBe('2027-01-04');
    expect(naechsterKontaktNachFrequenz('Monatlich', '2026-12-01', '2026-09-17')).toBeNull();
    expect(naechsterKontaktNachFrequenz('Nie', '', '2026-09-17')).toBeNull();
  });

  it('Vorbelegung aus dem Objekt: Kaufpreis, Wohnfläche, Einheiten mit IST- und SOLL-Miete = Kaltmiete', () => {
    expect(dealVorbelegungAusObjekt({ angebotspreis: '1.200.000', wohnflaeche: '480', einheiten: [{ typ: 'Gewerbe', flaeche: '85,5', kaltmiete: 900 }, { kaltmiete: '' }] })).toEqual({
      kalk: { kaufpreis: 1_200_000, wohnflaeche: 480 },
      einheiten: [{ typ: 'Gewerbe', fl: 85.5, mi_ist: 900, mi_neu: 900, rend_k: 4.5 }, { typ: 'Wohnung', fl: 0, mi_ist: '', mi_neu: '', rend_k: 4.5 }],
    });
    expect(dealVorbelegungAusObjekt({})).toEqual({ kalk: { kaufpreis: 0, wohnflaeche: 0 }, einheiten: [] });
  });

  it('Betreff der Makler-Mail', () => {
    expect(maklerMailBetreff({ adresse: 'Hafenweg', hausnr: '3', stadt: 'Hamburg' })).toBe('Anfrage: Hafenweg 3, Hamburg');
    expect(maklerMailBetreff({})).toBe('Anfrage: Objekt');
  });
});
