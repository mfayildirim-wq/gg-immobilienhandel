import { describe, expect, it } from 'vitest';
import { archivSchluessel, budgetErschoepft, eingangAbgelaufen, ersetztSchluessel, SPIEGEL_BUDGET, spiegelPlanen } from '../src/index.ts';

const o = (key: string, groesse = 10, stand = 't1') => ({ key, groesse, stand });
const z = (key: string, groesse: number | null = 10, stand: string | null = 't1', verschwundenSeit: number | null = null) => ({ key, groesse, stand, verschwundenSeit });

describe('Archiv-Spiegel: Plan', () => {
  it('Neues wird kopiert, Unverändertes nicht, der Upload-Eingang nie', () => {
    const p = spiegelPlanen('deal-docs', [o('d1/a.pdf'), o('d1/b.pdf'), o('_eingang/0000')], [z('d1/a.pdf')]);
    expect(p.aufgaben.map((a) => [a.key, a.art, a.archivKey])).toEqual([['d1/b.pdf', 'neu', 'deal-docs/d1/b.pdf']]);
    expect(p.unveraendert).toBe(1);
  });
  it('geändert heißt: andere Größe ODER anderer Stand', () => {
    const p = spiegelPlanen('pdfs', [o('a.pdf', 11, 't1'), o('b.pdf', 10, 't2'), o('c.pdf')], [z('a.pdf'), z('b.pdf'), z('c.pdf')]);
    expect(p.aufgaben.map((a) => [a.key, a.art])).toEqual([['a.pdf', 'geändert'], ['b.pdf', 'geändert']]);
  });
  it('Verschwundenes wird gemeldet — einmal; Zurückgekehrtes auch dann, wenn nichts zu kopieren ist', () => {
    const p = spiegelPlanen('pdfs', [o('wieder.pdf')], [z('weg.pdf'), z('lange-weg.pdf', 10, 't1', 123), z('wieder.pdf', 10, 't1', 456)]);
    expect(p.verschwunden).toEqual(['weg.pdf']);
    expect(p.zurueck).toEqual(['wieder.pdf']);
    expect(p.aufgaben).toEqual([]);
  });
  it('Schlüssel: Archiv nach Bucket geordnet, ersetzte Fassungen mit Zeitstempel fester Breite', () => {
    expect(archivSchluessel('pdfs', 'd1.pdf')).toBe('pdfs/d1.pdf');
    expect(ersetztSchluessel('pdfs', 'd1.pdf', new Date('2026-09-21T01:02:03Z'))).toBe('_superseded/pdfs/d1.pdf.2026-09-21-010203');
  });
});

describe('Archiv-Spiegel: Budget', () => {
  it('die erste Datei geht immer — auch wenn sie größer ist als das ganze Budget', () => {
    expect(budgetErschoepft(SPIEGEL_BUDGET, { bytes: 0, objekte: 0, millis: 0 }, 10 * SPIEGEL_BUDGET.maxBytes)).toBeNull();
    expect(budgetErschoepft(SPIEGEL_BUDGET, { bytes: 1, objekte: 1, millis: 0 }, SPIEGEL_BUDGET.maxBytes)).toBe('datenbudget');
  });
  it('Zeit und Objektzahl begrenzen unabhängig von den Bytes', () => {
    expect(budgetErschoepft(SPIEGEL_BUDGET, { bytes: 0, objekte: 0, millis: SPIEGEL_BUDGET.maxMillis }, 1)).toBe('zeitbudget');
    expect(budgetErschoepft(SPIEGEL_BUDGET, { bytes: 0, objekte: SPIEGEL_BUDGET.maxObjekte, millis: 0 }, 1)).toBe('objektbudget');
  });
});

describe('Upload-Eingang aufräumen', () => {
  const jetzt = Date.parse('2026-09-22T12:00:00Z');
  it('älter als ein Tag → weg; jünger oder ohne lesbaren Zeitpunkt → bleibt', () => {
    expect(eingangAbgelaufen('2026-09-21T11:59:00Z', jetzt)).toBe(true);
    expect(eingangAbgelaufen('2026-09-21T12:01:00Z', jetzt)).toBe(false);
    expect(eingangAbgelaufen('', jetzt)).toBe(false);
  });
});
