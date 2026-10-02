import { describe, expect, it } from 'vitest';
import { alsDatum, alsZahl, euro, prozent } from './format.ts';

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

describe('alsZahl (Wert eines Mantine-NumberInput)', () => {
  it('Zahl bleibt Zahl, leer wird null', () => {
    expect(alsZahl(1250000)).toBe(1250000);
    expect(alsZahl(0)).toBe(0);
    expect(alsZahl('')).toBeNull();
    expect(alsZahl('  ')).toBeNull();
  });
  it('Zwischenstände beim Tippen kommen als Text — sie sind trotzdem Zahlen', () => {
    // Im Feld steht „0“, der Nutzer tippt „1“: das Feld meldet "01". Früher galt das als leer und das Zeichen war weg.
    expect(alsZahl('01')).toBe(1);
    expect(alsZahl('0.')).toBe(0);
    expect(alsZahl('4.50')).toBe(4.5);
    expect(alsZahl('-12')).toBe(-12);
  });
  it('was keine Zahl ist, bleibt null', () => {
    expect(alsZahl('-')).toBeNull();
    expect(alsZahl('abc')).toBeNull();
    expect(alsZahl(Number.NaN)).toBeNull();
    expect(alsZahl(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
