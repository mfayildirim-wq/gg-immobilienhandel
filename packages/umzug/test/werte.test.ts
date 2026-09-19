import { describe, expect, it } from 'vitest';
import { datum, geloeschtAm, parseNumAlt, zahl, zeitpunkt } from '../src/werte.ts';

const notizen: string[] = [];
const notiz = (feld: string, _w: unknown, hinweis: string) => notizen.push(`${feld}: ${hinweis}`);

describe('parseNumAlt (identisch zur alten App)', () => {
  it.each([
    ['1200000', 1200000],
    ['1.200.000', 1200000],
    ['750.000', 750000],
    ['3.14', 3.14],
    ['12.3456', 12.3456],
    ['1.234,56', 1234.56],
    ['4,76', 4.76],
    ['', 0],
    [480, 480],
  ] as const)('%s → %s', (ein, aus) => expect(parseNumAlt(ein)).toBe(aus));
});

describe('zahl', () => {
  it('liefert null für leer, statt 0', () => {
    expect(zahl('', 'x', notiz)).toBeNull();
    expect(zahl(undefined, 'x', notiz)).toBeNull();
  });
  it('meldet unlesbaren Text', () => {
    expect(zahl('auf Anfrage', 'preis', notiz)).toBeNull();
    expect(notizen.at(-1)).toBe('preis: Text nicht als Zahl lesbar');
  });
  it('lässt echte Nullen durch', () => expect(zahl('0', 'x', notiz)).toBe(0));
  it('verwirft Werte über der Spaltengrenze', () => expect(zahl(5000, 'zimmer', notiz, 1000)).toBeNull());
});

describe('datum', () => {
  it.each([
    ['2026-03-23', '2026-03-23'],
    ['2026-03-23T10:00:00.000Z', '2026-03-23'],
    ['23.03.2026', '2026-03-23'],
    ['3.9.2026', '2026-09-03'],
    ['', null],
  ] as const)('%s → %s', (ein, aus) => expect(datum(ein, 'd', notiz)).toBe(aus));

  it('lehnt unmögliche Daten ab', () => expect(datum('31.02.2026', 'd', notiz)).toBeNull());
});

describe('zeitpunkt', () => {
  it('„Altbestand“ und leer → null', () => {
    expect(zeitpunkt('Altbestand', 't', notiz)).toBeNull();
    expect(zeitpunkt('', 't', notiz)).toBeNull();
  });
  it('deutsches Datum mit Uhrzeit gilt als Berliner Zeit (Sommerzeit)', () => {
    expect(zeitpunkt('17.09.2026 14:05', 't', notiz)).toBe('2026-09-17T12:05:00.000Z');
  });
  it('deutsches Datum mit Uhrzeit im Winter', () => {
    expect(zeitpunkt('15.01.2026, 09:30', 't', notiz)).toBe('2026-01-15T08:30:00.000Z');
  });
  it('Millisekunden und Unix-Sekunden', () => {
    expect(zeitpunkt(1_758_110_700_000, 't', notiz)).toBe('2025-09-17T12:05:00.000Z');
    expect(zeitpunkt(1_758_110_700, 't', notiz)).toBe('2025-09-17T12:05:00.000Z');
  });
  it('ISO bleibt', () => expect(zeitpunkt('2026-03-23T10:00:00.000Z', 't', notiz)).toBe('2026-03-23T10:00:00.000Z'));
});

describe('geloeschtAm', () => {
  const stichtag = '2026-09-17T00:00:00.000Z';
  it('nicht gelöscht → null', () => expect(geloeschtAm({}, stichtag)).toBeNull());
  it('_deleted + _deletedAt (ms)', () =>
    expect(geloeschtAm({ _deleted: true, _deletedAt: 1_758_110_700_000 }, stichtag)).toBe('2025-09-17T12:05:00.000Z'));
  it('Altformat: _deleted ist selbst der Zeitstempel', () =>
    expect(geloeschtAm({ _deleted: 1_758_110_700_000 }, stichtag)).toBe('2025-09-17T12:05:00.000Z'));
  it('_deleted ohne Zeit → Stichtag', () => expect(geloeschtAm({ _deleted: true }, stichtag)).toBe(stichtag));
});
