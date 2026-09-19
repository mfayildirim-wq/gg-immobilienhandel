import { describe, expect, it } from 'vitest';
import { alsDatum, euro, prozent } from './format.ts';

describe('Formatierung', () => {
  it('liest Postgres-Zeitstempel mit kurzem Versatz', () => {
    expect(alsDatum('2026-03-23 00:00:00+00').toISOString()).toBe('2026-03-23T00:00:00.000Z');
    expect(alsDatum('2026-09-17 12:48:21.04164+02').toISOString()).toBe('2026-09-17T10:48:21.041Z');
  });
  it('zeigt Euro und Prozent wie die alte App', () => {
    expect(euro(1575236.6)).toBe('1.575.237 €');
    expect(euro(0)).toBe('–');
    expect(prozent(13.0435)).toBe('13,0 %');
  });
});
