import { describe, expect, it } from 'vitest';
import { routinenAus, type Episode } from '../src/routinen.ts';

const t0 = Date.parse('2026-09-26T08:00:00Z');
const min = (n: number) => new Date(t0 + n * 60_000).toISOString();
/** Ein Ablauf im Deal `deal` ab Minute `ab`: die Schritte im Minutenabstand */
const ablauf = (deal: string, ab: number, ...schritte: string[]): Episode[] =>
  schritte.map((s, i) => ({ schluessel: s, kontext: { dealId: deal, sitzungId: `s${ab}` }, zeit: min(ab + i) }));

describe('routinenAus', () => {
  it('erkennt Notiz → Erledigt ab drei Deals', () => {
    const e = [
      ...ablauf('d1', 0, 'deal.kommentar', 'deal.erledigt'),
      ...ablauf('d2', 10, 'deal.kommentar', 'deal.erledigt'),
      ...ablauf('d3', 20, 'deal.kommentar', 'deal.erledigt'),
    ];
    expect(routinenAus(e)).toEqual([{ folge: ['deal.kommentar', 'deal.erledigt'], anzahl: 3 }]);
    expect(routinenAus(e.slice(0, 4))).toEqual([]);
  });

  it('trennt nach Kontext und nach Pausen über 30 Minuten; sitzungId zählt nicht zum Kontext', () => {
    const e = [
      // gleicher Deal, aber zwei Stunden dazwischen: kein Ablauf
      ...ablauf('d1', 0, 'deal.kommentar'), ...ablauf('d1', 120, 'deal.erledigt'),
      // verschiedene Deals direkt nacheinander: kein Ablauf
      ...ablauf('d2', 200, 'deal.kommentar'), ...ablauf('d3', 201, 'deal.erledigt'),
      ...ablauf('d4', 300, 'deal.kommentar'), ...ablauf('d4', 305, 'deal.erledigt'),
    ];
    expect(routinenAus(e, { mindestens: 1 })).toEqual([{ folge: ['deal.kommentar', 'deal.erledigt'], anzahl: 1 }]);
  });

  it('zählt Wiederholungen eines Schritts einmal und bevorzugt die längere Folge', () => {
    const e = [1, 2, 3].flatMap((n) => ablauf(`d${n}`, n * 10, 'deal.kommentar', 'deal.kommentar', 'deal.erledigt', 'deal.termin'));
    expect(routinenAus(e)).toEqual([{ folge: ['deal.kommentar', 'deal.erledigt', 'deal.termin'], anzahl: 3 }]);
  });

  it('behält die kürzere Folge, wenn sie öfter vorkommt als die längere', () => {
    const e = [
      ...[1, 2, 3].flatMap((n) => ablauf(`d${n}`, n * 10, 'deal.kommentar', 'deal.erledigt', 'deal.termin')),
      ...[4, 5].flatMap((n) => ablauf(`d${n}`, n * 10, 'deal.kommentar', 'deal.erledigt')),
    ];
    expect(routinenAus(e)).toEqual([
      { folge: ['deal.kommentar', 'deal.erledigt'], anzahl: 5 },
      { folge: ['deal.kommentar', 'deal.erledigt', 'deal.termin'], anzahl: 3 },
    ]);
  });
});
