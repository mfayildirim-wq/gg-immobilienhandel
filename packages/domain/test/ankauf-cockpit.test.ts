import { describe, expect, it } from 'vitest';
import {
  anrufErgebnisAnwenden,
  cockpitDeals,
  cockpitMakler,
  cockpitMitGehaltenen,
  faelligKurz,
  dealWaehlliste,
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

  it('ist dieselbe Liste wie „Makler kontaktieren“: ein Rückruf-Datum zählt, heute Erledigtes fällt heraus (Entscheidung 22.09.2026, Fachfrage 7)', () => {
    const makler = [
      mk('rueckruf-heute', { nextContact: HEUTE, lastContact: '2026-09-01' }),          // Frequenz sagte 08.09., Rückruf sagt heute
      mk('rueckruf-spaeter', { nextContact: '2026-10-30', lastContact: '2026-09-01' }), // Rückruf weit weg: nicht in der Liste, obwohl per Frequenz überfällig
      mk('frequenz', { lastContact: '2026-09-10' }),
      mk('heute-erledigt', { lastContact: HEUTE }),                                     // +7 → Woche, aber heute schon kontaktiert
      mk('nie', { kontaktFrequenz: 'Nicht kontaktieren', lastContact: '2026-09-01' }),
    ];
    const r = waehlmaschinenQueue(makler, HEUTE);
    expect(r.map((m) => m.id)).toEqual(['rueckruf-heute', 'frequenz']);
    expect(new Set(r.map((m) => m.id))).toEqual(new Set(cockpitMakler(makler, HEUTE).map((m) => m.id)));
  });

  it('Reihenfolge wie auf der Ankaufseite: heute → überfällig → diese Woche, darin nach Termin, dann Prio', () => {
    const r = waehlmaschinenQueue([
      mk('woche-a', { prio: 'A', lastContact: '2026-09-12' }),        // 19.09.
      mk('heute-c', { prio: 'C', lastContact: '2026-09-10' }),
      mk('heute-a', { prio: 'A', lastContact: '2026-09-10' }),
      mk('ueber-jung-a', { prio: 'A', lastContact: '2026-09-08' }),  // 15.09.
      mk('ueber-alt-c', { prio: 'C', lastContact: '2026-09-01' }),   // 08.09. — ältester Verzug vor der Prio
      mk('woche-frueh-c', { prio: 'C', lastContact: '2026-09-11' }), // 18.09.
    ], HEUTE);
    expect(r.map((m) => m.id)).toEqual(['heute-a', 'heute-c', 'ueber-alt-c', 'ueber-jung-a', 'woche-frueh-c', 'woche-a']);
  });

  it('Deals durchwählen: „Deals nachverfolgen“ in der angezeigten Reihenfolge — heute → überfällig → Woche, darin Termin, dann Status', () => {
    const deal = (id: string, teil: object) => ({ id, status: 'In Prüfung' as const, nachfassFrequenz: 'Wöchentlich', nextContact: null, lastContact: null, ...teil });
    const deals = [
      deal('woche', { nextContact: '2026-09-20' }),
      deal('ueber-jung', { nextContact: '2026-09-15' }),
      deal('heute-pruefung', { nextContact: HEUTE }),
      deal('heute-closing', { status: 'Closing Path', nextContact: HEUTE }),
      deal('ueber-alt', { lastContact: '2026-09-01' }), // +7 → 08.09.
      deal('archiv', { status: 'Archiv', nextContact: HEUTE }),
      deal('zu-weit', { nextContact: '2026-10-30' }),
    ];
    const r = dealWaehlliste(deals, HEUTE);
    expect(r.map((d) => d.id)).toEqual(['heute-closing', 'heute-pruefung', 'ueber-alt', 'ueber-jung', 'woche']);
    expect(new Set(r.map((d) => d.id))).toEqual(new Set(cockpitDeals(deals, HEUTE).map((d) => d.id)));
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

describe('cockpitMitGehaltenen (Karte bleibt nach „1W/1M/…“ stehen, bis „Erledigt“ sie abschließt)', () => {
  it('bei gleichem Termin bleibt die gehaltene Karte an ihrem Platz — nicht hinter den anderen (Kundenmeldung 08.10.2026)', () => {
    const k = (id: string) => ({ id, termin: '2026-10-04', nextContact: '2026-10-04', version: 1, faellig: { klasse: 'ueberfaellig' as const, tage: -4, label: '4T überfällig', sort: 1 as const } });
    const [a, b, c, d] = [k('a'), k('b'), k('c'), k('d')];
    // b war die zweite Karte; nach „1M“ liefert der Server sie nicht mehr — mit der bisherigen Reihenfolge bleibt sie zweite
    const liste = cockpitMitGehaltenen([a, c, d], { b: { ...b, nextContact: '2026-11-04', version: 2 } }, ['a', 'b', 'c', 'd']);
    expect(liste.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    // ohne bekannte Reihenfolge hinten — so sah der Kunde die Karte „verschwinden“ (sie stand unterhalb des Sichtbereichs)
    expect(cockpitMitGehaltenen([a, c, d], { b: { ...b, nextContact: '2026-11-04', version: 2 } }).map((x) => x.id)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('neue Karten vom Server, die in der bisherigen Reihenfolge fehlen, kommen hinter die bekannten mit gleichem Termin', () => {
    const k = (id: string, termin: string) => ({ id, termin, nextContact: termin, version: 1, faellig: { klasse: 'ueberfaellig' as const, tage: -1, label: '1T', sort: 1 as const } });
    const liste = cockpitMitGehaltenen([k('neu', '2026-10-04'), k('a', '2026-10-04'), k('frueher', '2026-10-01')], { b: { ...k('b', '2026-10-04'), nextContact: '2026-11-04', version: 2 } }, ['a', 'b']);
    expect(liste.map((x) => x.id)).toEqual(['frueher', 'a', 'b', 'neu']);
  });

  const karte = (id: string, termin: string, klasse: 'heute' | 'ueberfaellig' | 'woche', nextContact = termin) =>
    ({ id, termin, nextContact, version: 1, faellig: { klasse, tage: 0, label: klasse, sort: 0 as const } });
  const a = karte('a', '2026-09-28', 'ueberfaellig');
  const b = karte('b', '2026-10-02', 'heute');
  const c = karte('c', '2026-10-05', 'woche');

  it('ohne gehaltene Karten bleibt die Liste, wie der Server sie liefert', () => {
    expect(cockpitMitGehaltenen([a, b, c], {})).toEqual([a, b, c]);
  });

  it('eine Karte, die laut Server nicht mehr fällig ist, bleibt an ihrem alten Platz — mit neuem Termin und neuer Version', () => {
    // „1M“ auf Karte a: der Server listet sie nicht mehr; gehalten wird der Stand der Karte mit dem neuen Termin
    const gehalten = { a: { ...a, nextContact: '2026-11-01', version: 2 } };
    const liste = cockpitMitGehaltenen([b, c], gehalten);
    expect(liste.map((k) => k.id)).toEqual(['a', 'b', 'c']);
    expect(liste[0]).toMatchObject({ id: 'a', gehalten: true, nextContact: '2026-11-01', version: 2, termin: '2026-09-28', faellig: { klasse: 'ueberfaellig' } });
    expect(liste[1]).not.toHaveProperty('gehalten');
  });

  it('liefert der Server die Karte weiter (Termin noch in dieser Woche), gelten seine Daten — Platz und Abschnitt bleiben die alten', () => {
    const vomServer = { ...karte('a', '2026-10-06', 'woche'), version: 3 };
    const liste = cockpitMitGehaltenen([b, c, vomServer], { a: { ...a, nextContact: '2026-10-06', version: 2 } });
    expect(liste.map((k) => k.id)).toEqual(['a', 'b', 'c']);
    expect(liste[0]).toMatchObject({ gehalten: true, version: 3, nextContact: '2026-10-06', termin: '2026-09-28', faellig: { klasse: 'ueberfaellig' } });
  });
});

describe('faelligKurz (Fälligkeit auf der Deal-Karte, rechts neben der Adresse)', () => {
  it('überfällig: nur die Tage', () => {
    expect(faelligKurz({ klasse: 'ueberfaellig', tage: -32 })).toBe('32T');
    expect(faelligKurz({ klasse: 'ueberfaellig', tage: -1 })).toBe('1T');
  });
  it('heute und diese Woche bleiben unterscheidbar', () => {
    expect(faelligKurz({ klasse: 'heute', tage: 0 })).toBe('Heute');
    expect(faelligKurz({ klasse: 'woche', tage: 3 })).toBe('in 3T');
  });
});
