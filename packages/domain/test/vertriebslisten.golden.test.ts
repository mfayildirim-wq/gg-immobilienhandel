/** Golden Master: Vertriebsliste anlegen, Zellen bearbeiten, Rechenspalten und ihre Anzeige wie in der alten App. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeRowValues, createVertriebslisteFromDeal, DEFAULT_COLUMNS, formatComputed, totalWohnflaeche, vlStandardSpalten, vlZellwert } from '../src/index.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/vertriebslisten.json'), 'utf8')) as { faelle: any[]; defaultColumns: unknown };
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('Vertriebslisten (Golden Master)', () => {
  it('Standardspalten wörtlich', () => {
    expect(json(DEFAULT_COLUMNS)).toEqual(g.defaultColumns);
    expect(vlStandardSpalten(undefined)).toEqual(DEFAULT_COLUMNS);
    expect(vlStandardSpalten([])).toEqual(DEFAULT_COLUMNS);
    expect(vlStandardSpalten([{ id: 'x', label: 'X', type: 'text' }])).toEqual([{ id: 'x', label: 'X', type: 'text' }]);
  });

  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    let zaehler = 0;
    const vl = createVertriebslisteFromDeal(f.deal, vlStandardSpalten(undefined), () => `id${++zaehler}`, '2026-09-17');
    expect(json(vl)).toEqual(f.angelegt);

    for (const s of f.schritte) {
      const col = vl.columns.find((c) => c.id === s.spalte);
      const wert = vlZellwert(col, s.spalte, s.wert);
      if (wert !== null) vl.rows[s.zeile]!.data[s.spalte] = wert;
      expect(json(vl.rows[s.zeile]!.data)).toEqual(s.ergebnis);
    }
    expect(totalWohnflaeche(vl)).toBe(f.totalWf);
    vl.rows.forEach((r, i) => {
      const w = computeRowValues(r, f.gik, f.totalWf, f.prov);
      expect(json(w)).toEqual(f.berechnet[i].werte);
      expect(Object.fromEntries(Object.entries(w).map(([k, v]) => [k, formatComputed(k.startsWith('rendite') ? 'percent' : 'euro', v)]))).toEqual(f.berechnet[i].anzeige);
    });
  });
});
