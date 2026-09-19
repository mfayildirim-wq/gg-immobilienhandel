import { describe, expect, it } from 'vitest';
import { isoPlusTage, normalisiereFrequenz } from '../src/index.ts';

describe('Datum', () => {
  it('rechnet über Monats- und Jahresgrenzen', () => {
    expect(isoPlusTage('2026-12-30', 3)).toBe('2027-01-02');
  });
});

describe('Frequenz normalisieren (Altwerte)', () => {
  it.each([
    ['Nicht kontaktieren', 'Nie'],
    ['Monatlich', 'Monatlich'],
    ['irgendwas', 'Wöchentlich'],
    [null, 'Wöchentlich'],
  ] as const)('%s → %s', (alt, neu) => {
    expect(normalisiereFrequenz(alt)).toBe(neu);
  });
});
