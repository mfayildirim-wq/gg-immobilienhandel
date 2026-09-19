import { describe, expect, it } from 'vitest';
import {
  anrufErgebnisAnwenden,
  cockpitDeals,
  cockpitMakler,
  dealStagnation,
  deutschesDatum,
  erledigtTermin,
  terminloseMaklerEinplanen,
  waehlmaschinenQueue,
  whatsappNummer,
} from '../src/index.ts';

const HEUTE = '2026-09-17';

describe('Cockpit: Deals nachverfolgen', () => {
  const deal = (id: string, teil: object) => ({ id, status: 'In Prüfung' as const, nachfassFrequenz: 'Wöchentlich', nextContact: null, lastContact: null, ...teil });

  it('zeigt nur aktive Status, bevorzugt gesetzten Termin und sortiert nach Termin, dann Status', () => {
    const r = cockpitDeals([
      deal('archiv', { status: 'Archiv', nextContact: HEUTE }),
      deal('angekauft', { status: 'Angekauft', nextContact: HEUTE }),
      deal('spaeter', { nextContact: '2026-09-20' }),
      deal('heute-pruefung', { nextContact: HEUTE }),
      deal('heute-closing', { status: 'Closing Path', nextContact: HEUTE }),
      deal('aus-frequenz', { lastContact: '2026-09-09' }), // +7 → 16.09. überfällig
      deal('ohne-alles', {}),
      deal('zu-weit', { nextContact: '2026-10-30' }),
    ], HEUTE);
    expect(r.map((d) => [d.id, d.faellig.klasse])).toEqual([
      ['aus-frequenz', 'ueberfaellig'], ['heute-closing', 'heute'], ['heute-pruefung', 'heute'], ['spaeter', 'woche'],
    ]);
  });

  it('blendet heute Erledigtes unter „Diese Woche“ aus, nicht aber Fälliges', () => {
    const r = cockpitDeals([deal('woche', { lastContact: HEUTE, nextContact: '2026-09-19' }), deal('heute', { lastContact: HEUTE, nextContact: HEUTE })], HEUTE);
    expect(r.map((d) => d.id)).toEqual(['heute']);
  });

  it('zeigt einen Deal mit gesetztem Termin auch bei Frequenz „Nie“', () => {
    expect(cockpitDeals([deal('nie', { nachfassFrequenz: 'Nie', nextContact: HEUTE })], HEUTE)).toHaveLength(1);
  });

  it('Ist-Verhalten (Befund): Deal mit „Nie“ wird eine Woche nach dem letzten Kontakt wieder fällig', () => {
    expect(cockpitDeals([deal('nie', { nachfassFrequenz: 'Nie', lastContact: '2026-09-10' })], HEUTE)[0]?.faellig.klasse).toBe('heute');
  });
});

describe('Cockpit: Makler kontaktieren', () => {
  const mk = (id: string, teil: object) => ({ id, prio: 'B', kontaktFrequenz: 'Monatlich', nextContact: null, lastContact: null, ...teil });

  it('überspringt „Nie“, sortiert nach Termin, dann Prio', () => {
    const r = cockpitMakler([mk('c', { prio: 'C', nextContact: HEUTE }), mk('a', { prio: 'A', nextContact: HEUTE }), mk('nie', { kontaktFrequenz: 'Nie', nextContact: HEUTE }), mk('x', { prio: null, nextContact: '2026-09-15' })], HEUTE);
    expect(r.map((m) => m.id)).toEqual(['x', 'a', 'c']);
  });

  it('Standardfrequenz „Monatlich“', () => {
    expect(cockpitMakler([mk('m', { kontaktFrequenz: null, lastContact: '2026-08-18' })], HEUTE)[0]?.termin).toBe('2026-09-17');
  });
});

describe('Wählmaschine', () => {
  const mk = (id: string, teil: object) => ({ id, prio: 'B', kontaktFrequenz: 'Wöchentlich', nextContact: null, lastContact: null, ...teil });

  it('Ist-Verhalten: nur letzter Kontakt + Frequenz, ein Rückruf-Datum zählt nicht (Befund)', () => {
    const r = waehlmaschinenQueue([mk('rueckruf', { nextContact: HEUTE }), mk('frequenz', { lastContact: '2026-09-10' })], HEUTE);
    expect(r.map((m) => m.id)).toEqual(['frequenz']);
  });

  it('sortiert überfällig → heute → Woche, dann Prio', () => {
    const r = waehlmaschinenQueue([
      mk('woche-a', { prio: 'A', lastContact: '2026-09-12' }),
      mk('heute-c', { prio: 'C', lastContact: '2026-09-10' }),
      mk('heute-a', { prio: 'A', lastContact: '2026-09-10' }),
      mk('ueber', { prio: 'C', lastContact: '2026-09-01' }),
    ], HEUTE);
    expect(r.map((m) => m.id)).toEqual(['ueber', 'heute-a', 'heute-c', 'woche-a']);
  });
});

describe('Terminlose Makler einplanen', () => {
  it('verteilt je Frequenz reihum ab morgen und lässt Makler mit Terminen in Ruhe', () => {
    const r = terminloseMaklerEinplanen([
      { id: 'w1', kontaktFrequenz: 'Täglich', nextContact: null, lastContact: null },
      { id: 'w2', kontaktFrequenz: 'Täglich', nextContact: null, lastContact: null },
      { id: 'm1', kontaktFrequenz: null, nextContact: null, lastContact: null },
      { id: 'm2', kontaktFrequenz: 'Monatlich', nextContact: null, lastContact: null },
      { id: 'hat', kontaktFrequenz: 'Monatlich', nextContact: '2026-10-01', lastContact: null },
      { id: 'nie', kontaktFrequenz: 'Nie', nextContact: null, lastContact: null },
      { id: 'nicht', kontaktFrequenz: 'Nicht kontaktieren', nextContact: null, lastContact: null },
    ], HEUTE);
    expect(r).toEqual([
      { id: 'w1', nextContact: '2026-09-18' }, { id: 'w2', nextContact: '2026-09-18' },
      { id: 'm1', nextContact: '2026-09-18' }, { id: 'm2', nextContact: '2026-09-19' },
    ]);
  });
});

describe('Erledigt und Anruf-Ergebnis', () => {
  it('Erledigt behält einen späteren Termin, sonst heute + Frequenz; Ist: „Nie“ rechnet wie wöchentlich', () => {
    expect(erledigtTermin('2026-12-01', HEUTE, 'Monatlich')).toEqual({ lastContact: HEUTE, nextContact: '2026-12-01' });
    expect(erledigtTermin('2026-09-20', HEUTE, 'Monatlich')).toEqual({ lastContact: HEUTE, nextContact: '2026-10-17' });
    expect(erledigtTermin('2026-09-20', HEUTE, null)).toEqual({ lastContact: HEUTE, nextContact: '2026-09-24' });
    expect(erledigtTermin('2026-09-20', HEUTE, 'Nicht kontaktieren')).toEqual({ lastContact: HEUTE, nextContact: '2026-09-24' });
  });

  it('Rückruf setzt das Datum, protokolliert im alten Notizformat', () => {
    expect(anrufErgebnisAnwenden({ ergebnis: 'rueckruf', notiz: ' will zurückrufen ', frequenz: 'Monatlich', rueckrufDatum: '2026-09-24', bestehenderTermin: null, heute: HEUTE })).toEqual({
      kontaktFrequenz: 'Monatlich', lastContact: HEUTE, nextContact: '2026-09-24', notizEintrag: '[17.9.2026 – Rückruf vereinbart] will zurückrufen',
    });
  });

  it('Rückruf ohne Datum lässt den Termin unverändert; ohne Notiz kein Eintrag', () => {
    expect(anrufErgebnisAnwenden({ ergebnis: 'rueckruf', notiz: '', frequenz: 'Monatlich', rueckrufDatum: null, bestehenderTermin: '2026-09-01', heute: HEUTE })).toMatchObject({ nextContact: '2026-09-01', notizEintrag: null });
  });

  it('Erreicht / nicht erreicht rechnen mit der gewählten Frequenz', () => {
    expect(anrufErgebnisAnwenden({ ergebnis: 'nicht', notiz: 'Mailbox', frequenz: 'Wöchentlich', rueckrufDatum: null, bestehenderTermin: null, heute: HEUTE })).toMatchObject({ nextContact: '2026-09-24', notizEintrag: '[17.9.2026 – Nicht erreicht] Mailbox' });
    expect(deutschesDatum('2026-01-05')).toBe('5.1.2026');
  });
});

describe('Hinweise', () => {
  it('Deal-Stagnation ab 14 Tagen, nur aktive Deals', () => {
    expect(dealStagnation([
      { status: 'Angekauft', titel: 'A', letzteAktivitaet: '2026-01-01' },
      { status: 'In Prüfung', titel: 'Lindenstraße 1', letzteAktivitaet: '2026-09-03T10:00:00Z' },
    ], HEUTE)).toBe('Lindenstraße 1: 14 Tage kein Update');
    expect(dealStagnation([{ status: 'In Prüfung', titel: 'x', letzteAktivitaet: '2026-09-04' }], HEUTE)).toBeNull();
  });

  it('WhatsApp-Nummer', () => {
    expect(whatsappNummer('0171 / 123 45')).toBe('+4917112345');
    expect(whatsappNummer('0049 30 1')).toBe('+49301');
    expect(whatsappNummer('+49 30 1')).toBe('+49301');
  });
});
