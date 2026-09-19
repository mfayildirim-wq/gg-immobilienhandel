// Port von gg-immohandel src/lib/deutscheZahlEingabe.test.ts (Teil normalisiereDeutscheZahl)
import { describe, expect, test } from 'vitest';
import { normalisiereDeutscheZahl } from '../src/vertriebslisten/zahleneingabe.ts';

describe('normalisiereDeutscheZahl', () => {
  test('der Fund: ein Punkt als Dezimalzeichen wird zum Komma', () => {
    expect(normalisiereDeutscheZahl('85.5')).toBe('85,5');
    expect(normalisiereDeutscheZahl('0.75')).toBe('0,75');
    expect(normalisiereDeutscheZahl('1250.5')).toBe('1250,5');
  });

  test('drei Ziffern hinter dem Punkt: Tausenderzeichen', () => {
    expect(normalisiereDeutscheZahl('1.234')).toBe('1234');
    expect(normalisiereDeutscheZahl('850.000')).toBe('850000');
  });

  test('mehrere Punkte sind immer Tausenderzeichen', () => {
    expect(normalisiereDeutscheZahl('1.234.567')).toBe('1234567');
  });

  test('mit Komma im Text sind die Punkte Tausenderzeichen', () => {
    expect(normalisiereDeutscheZahl('1.234,56')).toBe('1234,56');
    expect(normalisiereDeutscheZahl('1.234.567,89')).toBe('1234567,89');
  });

  test('ohne Punkt bleibt alles unverändert', () => {
    for (const s of ['', '85', '85,5', '1234', '1234,56', 'k. A.']) {
      expect(normalisiereDeutscheZahl(s)).toBe(s);
    }
  });
});

