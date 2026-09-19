import { describe, expect, it } from 'vitest';
import { DEAL_STATUS, imCockpit, pruefeStatuswechsel, schaltetVerkaufFrei, STATUS_SORT } from '../src/index.ts';

describe('Deal-Status (Ist-Verhalten)', () => {
  it('kennt genau sechs Status', () => {
    expect(DEAL_STATUS).toHaveLength(6);
  });

  it('erlaubt jeden Wechsel (Fachfrage 2 offen)', () => {
    for (const von of DEAL_STATUS) {
      for (const nach of DEAL_STATUS) {
        expect(pruefeStatuswechsel(von, nach)).toEqual({ erlaubt: true, aenderung: von !== nach });
      }
    }
  });

  it('zeigt im Cockpit nur die aktiven Status', () => {
    expect(DEAL_STATUS.filter(imCockpit)).toEqual([
      'In Prüfung',
      'Angebot abgegeben',
      'Über Zeit nachfassen',
      'Closing Path',
    ]);
  });

  it('sortiert Closing Path zuerst und Archiv zuletzt', () => {
    const sortiert = [...DEAL_STATUS].sort((a, b) => STATUS_SORT[a] - STATUS_SORT[b]);
    expect(sortiert[0]).toBe('Closing Path');
    expect(sortiert.at(-1)).toBe('Archiv');
  });

  it('schaltet den Verkauf nur bei „Angekauft“ frei', () => {
    expect(DEAL_STATUS.filter(schaltetVerkaufFrei)).toEqual(['Angekauft']);
  });
});
