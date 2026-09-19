// Port von gg-immohandel src/modules/finanzpraes/finanzpraes-tabelle.test.ts
import { describe, it, expect } from 'vitest';
import {
  FP_ZEILEN_PRO_TABELLENSEITE,
  istSektionsZeile,
  teileTabellenzeilen,
  formatiereFlaeche,
} from '../src/finanzpraesentation/tabelle.ts';

/** Aufteiler-Kalkulation wie computeDealKalkSummary sie baut — mit `posten`
 *  Sanierungszeilen. Ab etwa sieben davon riss die Folie vorher unten ab. */
function aufteilerZeilen(posten: number): string[][] {
  const rows: string[][] = [
    ['PROJEKTKOSTEN', ''],
    ['Kaufpreis', '1.200.000 €'],
    ['+ Notar & Grundbuch (1,50%)', '18.000 €'],
    ['+ Grunderwerbsteuer (5,00%)', '60.000 €'],
    ['+ Maklerprovision (3,57%)', '42.840 €'],
    ['= Anschaffungskosten', '1.320.840 €'],
    ['+ FK-Zinskosten (5,20% p.a. × 1,5 J. auf 85,00% FK)', '104.000 €'],
    ['+ Abschlussgebühr Bank (1,00% auf FK)', '13.300 €'],
    ['– Mieteinnahmen IST (Haltedauer)', '– 54.000 €'],
    ['HERSTELLUNGSKOSTEN', ''],
  ];
  for (let i = 1; i <= posten; i++) rows.push([`+ Sanierungsposten ${i}`, `${i * 10}.000 €`]);
  rows.push(['+ Risikopuffer (10,00%)', '28.000 €']);
  rows.push(['+ Vertriebsprovision (4,00% auf VKP)', '76.000 €']);
  rows.push(['+ Aufteilungskosten', '32.000 €']);
  rows.push(['= Gesamt-Investitionskosten (GIK)', '1.874.000 €']);
  rows.push(['  GIK pro m²', '2.680 €/m²']);
  rows.push(['EXIT AUFTEILER', '']);
  rows.push(['Verkaufserlöse (Σ KP Kunden)', '2.280.000 €']);
  rows.push(['  pro m²', '3.260 €/m²']);
  rows.push(['Gewinn Aufteiler', '406.000 €']);
  rows.push(['Marge auf Verkaufserlöse', '17,8%']);
  return rows;
}

const ersteSpalten = (seite: string[][]) => seite.map((z) => z[0]);

describe('teileTabellenzeilen', () => {
  it('lässt eine kurze Tabelle auf einer Seite', () => {
    const zeilen = aufteilerZeilen(1);
    expect(zeilen.length).toBeLessThanOrEqual(FP_ZEILEN_PRO_TABELLENSEITE);
    expect(teileTabellenzeilen(zeilen)).toEqual([zeilen]);
  });

  it('bricht 8 Sanierungsposten um, GIK/Gewinn/Marge stehen auf der letzten Seite', () => {
    const zeilen = aufteilerZeilen(8);
    const seiten = teileTabellenzeilen(zeilen);
    expect(seiten.length).toBeGreaterThan(1);
    const letzte = ersteSpalten(seiten[seiten.length - 1]!);
    expect(letzte).toContain('= Gesamt-Investitionskosten (GIK)');
    expect(letzte).toContain('Gewinn Aufteiler');
    expect(letzte).toContain('Marge auf Verkaufserlöse');
  });

  it('verliert und vertauscht keine Zeile', () => {
    const zeilen = aufteilerZeilen(14);
    const seiten = teileTabellenzeilen(zeilen);
    expect(seiten.flat()).toEqual(zeilen);
  });

  it('hält jede Seite innerhalb der Zeilengrenze', () => {
    for (const posten of [8, 14, 30, 61]) {
      for (const seite of teileTabellenzeilen(aufteilerZeilen(posten))) {
        expect(seite.length).toBeLessThanOrEqual(FP_ZEILEN_PRO_TABELLENSEITE);
        expect(seite.length).toBeGreaterThan(0);
      }
    }
  });

  it('lässt die letzte Seite nicht mit einer einzelnen Zeile enden', () => {
    // 21 Zeilen bei Grenze 20: „voll, Rest hinterher" ergäbe 20 + 1.
    const zeilen = Array.from({ length: 21 }, (_, i) => [`Posten ${i + 1}`, `${i}`]);
    const seiten = teileTabellenzeilen(zeilen, 20);
    expect(seiten.length).toBe(2);
    expect(seiten[1]!.length).toBeGreaterThan(1);
  });

  it('nimmt eine Sektions-Überschrift auf die nächste Seite mit', () => {
    const zeilen: string[][] = Array.from({ length: 22 }, (_, i) => [`Posten ${i + 1}`, `${i}`]);
    zeilen[7] = ['EXIT AUFTEILER', ''];
    const seiten = teileTabellenzeilen(zeilen, 10);
    expect(seiten[0]![seiten[0]!.length - 1]![0]).not.toBe('EXIT AUFTEILER');
    expect(seiten[1]![0]![0]).toBe('EXIT AUFTEILER');
  });

  it('gibt für eine leere Tabelle keine Seite aus', () => {
    expect(teileTabellenzeilen([])).toEqual([]);
    expect(teileTabellenzeilen(undefined as unknown as string[][])).toEqual([]);
  });
});

describe('istSektionsZeile', () => {
  it('erkennt Überschrift und Zahlenzeile auseinander', () => {
    expect(istSektionsZeile(['PROJEKTKOSTEN', ''])).toBe(true);
    expect(istSektionsZeile(['EXIT AUFTEILER', '', ''])).toBe(true);
    expect(istSektionsZeile(['Kaufpreis', '1.200.000 €'])).toBe(false);
    expect(istSektionsZeile(['', ''])).toBe(false);
    expect(istSektionsZeile(['GESAMT'])).toBe(false);
  });
});

describe('formatiereFlaeche', () => {
  it('schneidet den Fließkomma-Schwanz einer Summe ab', () => {
    expect(formatiereFlaeche(45.5 + 60.3)).toBe('105,8');
    expect(formatiereFlaeche(0.1 + 0.2)).toBe('0,3');
    expect(formatiereFlaeche(45.5 + 60.3)).not.toContain('0000');
  });

  it('setzt Tausenderpunkte und lässt ganze Zahlen ganz', () => {
    expect(formatiereFlaeche(1234.5)).toBe('1.234,5');
    expect(formatiereFlaeche(700)).toBe('700');
  });

  it('antwortet auf Unsinn mit einem Strich', () => {
    expect(formatiereFlaeche(NaN)).toBe('–');
    expect(formatiereFlaeche(Infinity)).toBe('–');
  });
});
