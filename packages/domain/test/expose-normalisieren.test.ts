import { describe, expect, it } from 'vitest';
import { jahrAusText, jaNeinAusText, plzOrtTrennen, strasseTrennen, wertNormalisieren, zahlAusText } from '../src/index.ts';

describe('Exposé v2: wörtliche Werte lesen (Protokoll 28)', () => {
  it.each([
    ['1.250.000,00 €', 1_250_000], ['1.250.000 €', 1_250_000], ['1.900000 Euro', 1_900_000], ['2,250000 €', 2_250_000], ['3.1416', 3.1416], ['85.500', 85_500], ['1,25 Mio. €', 1_250_000], ['ca. 85,5 m²', 85.5], ['85.5 qm', 85.5],
    ['3,57 % inkl. MwSt.', 3.57], ['1.250', 1250], ['27.840 € p.a.', 27_840], ['900 Tsd. €', 900_000], ['1,250,000.50', 1_250_000.5],
  ])('zahlAusText(%s) = %s', (text, zahl) => expect(zahlAusText(text)).toBe(zahl));

  it('liest nichts, wo nichts eindeutig ist', () => {
    expect(zahlAusText('auf Anfrage')).toBeNull();
    expect(zahlAusText('k. A.')).toBeNull();
    expect(zahlAusText('–')).toBeNull();
    expect(zahlAusText('80 bis 95 m²', false)).toBeNull();
    expect(zahlAusText('480 m2', false)).toBe(480);
    expect(zahlAusText('128,4 kWh/(m2a)', false)).toBe(128.4);
  });

  it('Jahr, Ja/Nein, Typen', () => {
    expect(jahrAusText('Bj. ca. 1912/2015 saniert')).toBe(1912);
    expect(jahrAusText('neu')).toBeNull();
    expect(jaNeinAusText('Ja, vorhanden')).toBe(true);
    expect(jaNeinAusText('nicht vorhanden')).toBe(false);
    expect(jaNeinAusText('teilweise')).toBeNull();
    expect(wertNormalisieren('3 WE', 'ganzzahl')).toBe(3);
    expect(wertNormalisieren('  Gas- Zentralheizung ', 'text')).toBe('Gas- Zentralheizung');
  });

  it('Straße/Hausnummer und PLZ/Ort trennen', () => {
    expect(strasseTrennen('Musterweg 12a')).toEqual({ strasse: 'Musterweg', hausnr: '12a' });
    expect(strasseTrennen('Straße des 17. Juni 4-6')).toEqual({ strasse: 'Straße des 17. Juni', hausnr: '4-6' });
    expect(strasseTrennen('Am Markt')).toEqual({ strasse: 'Am Markt', hausnr: null });
    expect(plzOrtTrennen('89073 Ulm')).toEqual({ plz: '89073', ort: 'Ulm' });
    expect(plzOrtTrennen('Ulm')).toBeNull();
  });
});
