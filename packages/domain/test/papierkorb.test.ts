/** Papierkorb: Bezeichnung, Restlaufzeit, Gruppen, Frist (nach trash.ts/trash-ui.ts der alten App). */
import { describe, expect, it } from 'vitest';
import {
  papierkorbAbgelaufen, papierkorbBezeichnung, papierkorbGruppen, papierkorbLoeschfolge, papierkorbRestTage, papierkorbUebrigHinweis, papierkorbVerwiesenHinweis,
  papierkorbZeile, PAPIERKORB_ABHAENGIG, PAPIERKORB_BEREICHE, PAPIERKORB_TAGE,
} from '../src/index.ts';

const tage = (n: number) => new Date(Date.UTC(2026, 8, 17, 12) - n * 86_400_000).toISOString();
const jetzt = Date.UTC(2026, 8, 17, 12);

describe('Papierkorb', () => {
  it('Bezeichnung: erstes gefülltes Feld, sonst Kennung', () => {
    expect(papierkorbBezeichnung([null, '  ', 'Hauptstraße 1'], 'x')).toBe('Hauptstraße 1');
    expect(papierkorbBezeichnung([undefined, null], 'o1')).toBe('ohne Namen (o1)');
  });

  it('Restlaufzeit zählt angebrochene Tage und wird nicht negativ', () => {
    expect(papierkorbRestTage(tage(0), jetzt)).toBe(PAPIERKORB_TAGE);
    expect(papierkorbRestTage(tage(1), jetzt)).toBe(29);
    expect(papierkorbRestTage(tage(29.5), jetzt)).toBe(1);
    expect(papierkorbRestTage(tage(45), jetzt)).toBe(0);
  });

  it('Zeile warnt ab drei Tagen Restlaufzeit', () => {
    const z = papierkorbZeile({ bereich: 'deals', id: 'd1', bezeichnung: 'Weg 1', geloeschtAm: tage(28) }, jetzt);
    expect(z).toMatchObject({ tage: 2, dringend: true });
    expect(z.text).toBe('gelöscht am 20.8.2026 · noch 2 Tage');
    expect(papierkorbZeile({ bereich: 'deals', id: 'd2', bezeichnung: 'Weg 2', geloeschtAm: tage(29) }, jetzt).text).toMatch(/noch 1 Tag$/);
    expect(papierkorbZeile({ bereich: 'deals', id: 'd3', bezeichnung: 'Weg 3', geloeschtAm: tage(0) }, jetzt).dringend).toBe(false);
  });

  it('Gruppen folgen dem neuesten Eintrag, innerhalb neueste zuerst', () => {
    const g = papierkorbGruppen([
      { bereich: 'deals', id: 'd1', bezeichnung: 'Alt', geloeschtAm: tage(10) },
      { bereich: 'objekte', id: 'o1', bezeichnung: 'Objekt', geloeschtAm: tage(5) },
      { bereich: 'deals', id: 'd2', bezeichnung: 'Neu', geloeschtAm: tage(1) },
    ], jetzt);
    expect(g.map((x) => x.label)).toEqual(['Deals', 'Objekte']);
    expect(g[0]!.eintraege.map((e) => e.bezeichnung)).toEqual(['Neu', 'Alt']);
  });

  it('Frist: älter als 30 Tage wird endgültig entfernt', () => {
    expect(papierkorbAbgelaufen(tage(29), jetzt)).toBe(false);
    expect(papierkorbAbgelaufen(tage(31), jetzt)).toBe(true);
  });
});

describe('Papierkorb: endgültig entfernen in der Reihenfolge der Fremdschlüssel', () => {
  const bereiche = PAPIERKORB_BEREICHE.map((b) => b.bereich);
  // Stand des Schemas: diese Verweise löschen nicht mit (die API liest sie aus dem Schema ab)
  const verweise = [
    { kind: 'deals', eltern: 'objekte' }, { kind: 'begleitscheine', eltern: 'objekte' },
    { kind: 'kundenkalkulationen', eltern: 'deals' }, { kind: 'praesentationen', eltern: 'deals' }, { kind: 'vertriebslisten', eltern: 'deals' },
  ];

  it('Kinder stehen vor ihren Eltern, jeder Bereich genau einmal', () => {
    const folge: string[] = papierkorbLoeschfolge(bereiche, verweise);
    expect([...folge].sort()).toEqual([...bereiche].sort());
    for (const v of verweise) expect(folge.indexOf(v.kind), `${v.kind} vor ${v.eltern}`).toBeLessThan(folge.indexOf(v.eltern));
  });

  it('ohne Verweise bleibt die Reihenfolge der Bereiche', () => {
    expect(papierkorbLoeschfolge(bereiche, [])).toEqual(bereiche);
  });

  it('ein Kreis wird gemeldet', () => {
    expect(() => papierkorbLoeschfolge(['a', 'b'], [{ kind: 'a', eltern: 'b' }, { kind: 'b', eltern: 'a' }])).toThrow(/Kreis/);
  });

  it('Abhängiges geht mit seinen Eltern — ein Deal aber nie stillschweigend mit seinem Objekt', () => {
    const paare = PAPIERKORB_ABHAENGIG.map((a) => `${a.kind}→${a.eltern}`).sort();
    expect(paare).toEqual(['begleitscheine→objekte', 'kundenkalkulationen→deals', 'praesentationen→deals', 'vertriebslisten→deals']);
    for (const a of PAPIERKORB_ABHAENGIG) expect(bereiche).toContain(a.kind);
  });

  it('Hinweise nennen den Bereich, der noch verweist, und zählen, was liegen bleibt', () => {
    expect(papierkorbVerwiesenHinweis('deals')).toBe('Endgültig entfernen geht noch nicht: Unter „Deals“ gibt es Einträge, die hierauf verweisen. Entferne zuerst diese.');
    expect(papierkorbUebrigHinweis(1)).toBe('1 Eintrag bleibt im Papierkorb, weil noch andere Einträge darauf verweisen.');
    expect(papierkorbUebrigHinweis(3)).toBe('3 Einträge bleiben im Papierkorb, weil noch andere Einträge darauf verweisen.');
  });
});
