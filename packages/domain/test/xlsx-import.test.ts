/** Makler-Import aus Tabellen: Spaltenerkennung, Prio, Frequenz, Zeilenauswertung (nach server/index.ts + kontakt-frequenz.ts). */
import { describe, expect, it } from 'vitest';
import { xlsxFrequenz, xlsxMaklerLesen, xlsxPrio, xlsxSpaltenErkennen } from '../src/index.ts';

describe('Makler aus Tabelle', () => {
  it('erkennt Spalten über Teiltreffer in den Überschriften', () => {
    expect(xlsxSpaltenErkennen(['Ansprechpartner', 'Unternehmen', 'Mobil', 'E-Mail', 'Kategorie', 'Turnus', 'Straße', 'Ort', 'Bemerkung']))
      .toEqual({ name: 0, firma: 1, tel: 2, email: 3, prio: 4, kontaktFreq: 5, adresse: 6, stadt: 7, notizen: 8 });
    expect(xlsxSpaltenErkennen(['Spalte A', 'Spalte B'])).toEqual({});
  });

  it('Prio: A/1/hoch, C/3/niedrig, sonst B', () => {
    expect(['A', '1', 'hoch'].map(xlsxPrio)).toEqual(['A', 'A', 'A']);
    expect(['C', '3', 'LOW', 'niedrig'].map(xlsxPrio)).toEqual(['C', 'C', 'C', 'C']);
    expect(['B', '', 'irgendwas'].map(xlsxPrio)).toEqual(['B', 'B', 'B']);
  });

  it('Frequenz: Stufen, Wörter, Zahlen; Unlesbares wird monatlich', () => {
    expect(xlsxFrequenz('Wöchentlich')).toBe('Wöchentlich');
    expect(xlsxFrequenz('quartalsweise')).toBe('Alle 3 Monate');
    expect(xlsxFrequenz('alle 90 Tage')).toBe('Alle 3 Monate');
    expect(xlsxFrequenz('30')).toBe('Monatlich');
    expect(xlsxFrequenz('nicht kontaktieren')).toBe('Nie');
    expect(xlsxFrequenz('')).toBe('Monatlich');
    expect(xlsxFrequenz('bei Gelegenheit')).toBe('Monatlich');
  });

  it('überspringt Zeilen ohne Namen und bekannte E-Mails (auch doppelte in der Datei)', () => {
    const zuordnung = { name: 0, email: 1, prio: 2, kontaktFreq: 3 };
    const { makler, uebersprungen } = xlsxMaklerLesen([
      ['Anna Beispiel', 'ANNA@example.test', '1', 'wöchentlich'],
      ['', 'leer@example.test', '', ''],
      ['Bernd Bekannt', 'bekannt@example.test', '', ''],
      ['Anna Doppelt', 'anna@example.test', '', ''],
      ['Clara Ohne Mail', '', '3', '180'],
    ], zuordnung, ['bekannt@example.test']);
    expect(makler.map((m) => m.name)).toEqual(['Anna Beispiel', 'Clara Ohne Mail']);
    expect(makler[0]).toMatchObject({ email: 'anna@example.test', prio: 'A', kontaktFrequenz: 'Wöchentlich' });
    expect(makler[1]).toMatchObject({ prio: 'C', kontaktFrequenz: 'Alle 6 Monate' });
    expect(uebersprungen).toBe(3);
  });
});
