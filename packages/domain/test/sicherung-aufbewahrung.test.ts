import { describe, expect, it } from 'vitest';
import { aufbewahrungPlanen, geplanteStufe, sicherungSchluessel, sicherungSchluesselLesen, type SicherungsEintrag, type SicherungsStufe } from '../src/index.ts';

const eintrag = (tag: string, stufe: SicherungsStufe): SicherungsEintrag => {
  const key = sicherungSchluessel(new Date(`${tag}T01:00:00Z`), stufe, { deals: 1, objekte: 1, makler: 1, zeilen: 3 });
  return { ...sicherungSchluesselLesen(key)!, groesseBytes: 10 };
};
const tage = (n: number, stufe: SicherungsStufe, start = 1) => Array.from({ length: n }, (_, i) => eintrag(`2026-08-${String(start + i).padStart(2, '0')}`, stufe));

describe('Sicherungs-Dateiname', () => {
  it('trägt Zeitpunkt, Stufe und Kennzahlen — und lässt sich zurücklesen', () => {
    const key = sicherungSchluessel(new Date('2026-09-21T01:02:03.456Z'), 'weekly', { deals: 273, objekte: 285, makler: 141, zeilen: 9120 });
    expect(key).toBe('sicherung-2026-09-21-010203-weekly-273d-285o-141m-9120z.json');
    expect(sicherungSchluesselLesen(key)).toEqual({ key, ts: '2026-09-21T01:02:03.000Z', stufe: 'weekly', zahlen: { deals: 273, objekte: 285, makler: 141, zeilen: 9120 } });
  });
  it('erkennt Fremdes nicht als Sicherung', () => {
    for (const k of ['notizen.txt', 'sicherung-2026-09-21-010203-hourly-1d-1o-1m-1z.json', 'sicherung-2026-13-45-010203-daily-1d-1o-1m-1z.json', '../sicherung-2026-09-21-010203-daily-1d-1o-1m-1z.json'])
      expect(sicherungSchluesselLesen(k), k).toBeNull();
  });
});

describe('geplante Stufe', () => {
  it('Monatserster schlägt Montag, Montag schlägt Alltag', () => {
    expect(geplanteStufe(new Date('2026-06-01T01:00:00Z'))).toBe('monthly'); // ein Montag
    expect(geplanteStufe(new Date('2026-09-21T01:00:00Z'))).toBe('weekly');
    expect(geplanteStufe(new Date('2026-09-22T01:00:00Z'))).toBe('daily');
  });
});

describe('Aufbewahrung', () => {
  it('behält je Stufe die jüngsten: 7 täglich, 4 wöchentlich, 3 monatlich, 3 Sicherheitskopien', () => {
    const plan = aufbewahrungPlanen([...tage(10, 'daily'), ...tage(6, 'weekly', 11), ...tage(5, 'monthly', 17), ...tage(5, 'safety', 22)]);
    const jeStufe = (s: string) => plan.behalten.filter((e) => e.stufe === s).length;
    expect([jeStufe('daily'), jeStufe('weekly'), jeStufe('monthly'), jeStufe('safety')]).toEqual([7, 4, 3, 3]);
    expect(plan.entfernen.length).toBe(26 - 17);
    expect(plan.entfernen.filter((e) => e.stufe === 'daily').map((e) => e.ts.slice(8, 10))).toEqual(['03', '02', '01']); // die ältesten
  });
  it('gibt den jüngsten Stand nie frei — auch nicht bei Grenze 0', () => {
    const plan = aufbewahrungPlanen(tage(3, 'daily'), { daily: 0 });
    expect(plan.behalten.map((e) => e.ts.slice(8, 10))).toEqual(['03']);
    expect(plan.hinweise[0]).toContain('gibt den letzten Stand nie frei');
  });
  it('leere Liste → leere Löschmenge', () => {
    expect(aufbewahrungPlanen([])).toMatchObject({ behalten: [], entfernen: [] });
  });
});
