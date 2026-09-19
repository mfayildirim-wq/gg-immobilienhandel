/** Zusammenführen: Felder, verlustfreie Listen, Auswahl je Sub-Struktur (merge.ts der alten App, Felder des Neubaus). */
import { describe, expect, it } from 'vitest';
import { kommentareVereinen, kommunikationVereinen, mergeAbgelaufen, mergeDeal, mergeMakler, mergeObjekt, type MergeWahl } from '../src/index.ts';

const ohneWahl: MergeWahl = { felder: {}, listen: {} };

describe('Dubletten zusammenführen', () => {
  const a = { id: 'm1', name: 'Anna Beispiel', firma: '', tel: '+49 711 1', email: null, prio: 'A', kiSummary: 'alt', kiSummaryAt: '2026-09-01', tags: ['vip'], persoenlich: { geburtsdatum: '03-15' }, kommunikation: [{ id: 'k1', zeitpunkt: '2026-09-02T08:00:00Z', text: 'A' }] };
  const b = { id: 'm2', name: 'Anna Beispil', firma: 'Beispiel GmbH', tel: '+49 711 2', email: 'anna@example.test', prio: 'B', tags: ['neu'], persoenlich: { hobbies: ['Golf'] }, kommunikation: [{ id: 'k2', zeitpunkt: '2026-09-03T08:00:00Z', text: 'B' }, { id: 'k1', zeitpunkt: '2026-09-02T08:00:00Z', text: 'A' }] };

  it('Makler: leere Felder werden gefüllt, Konflikt entscheidet die Wahl, Kommunikation und Tags vereint', () => {
    const m = mergeMakler(a, b, { felder: { prio: 'B' }, listen: { persoenlich: 'union' } });
    expect(m).toMatchObject({ id: 'm1', name: 'Anna Beispiel', firma: 'Beispiel GmbH', tel: '+49 711 1', email: 'anna@example.test', prio: 'B' });
    expect(m.tags).toEqual(['vip', 'neu']);
    expect(m.persoenlich).toEqual({ geburtsdatum: '03-15', hobbies: ['Golf'] });
    expect(m.kommunikation.map((k: { id: string }) => k.id)).toEqual(['k2', 'k1']);
    // Die KI-Zusammenfassung bezog sich auf die alte Kommunikation
    expect(m.kiSummary).toBeNull();
    expect(m.kiSummaryAt).toBeNull();
  });

  it('Makler ohne Wahl: A gewinnt jeden Konflikt, Persönliches bleibt von A', () => {
    const m = mergeMakler(a, b, ohneWahl);
    expect(m).toMatchObject({ name: 'Anna Beispiel', prio: 'A' });
    expect(m.persoenlich).toEqual({ geburtsdatum: '03-15' });
  });

  it('Objekt: Einheiten nach Wahl (A, B oder vereint)', () => {
    const o1 = { id: 'o1', strasse: 'Hauptstraße', hausnr: '12', stadt: null, einheiten: [{ id: 'e1' }] };
    const o2 = { id: 'o2', strasse: 'Hauptstr.', hausnr: '12', stadt: 'Stuttgart', einheiten: [{ id: 'e2' }] };
    expect(mergeObjekt(o1, o2, ohneWahl)).toMatchObject({ id: 'o1', strasse: 'Hauptstraße', stadt: 'Stuttgart', einheiten: [{ id: 'e1' }] });
    expect(mergeObjekt(o1, o2, { felder: { strasse: 'B' }, listen: { einheiten: 'union' } })).toMatchObject({ strasse: 'Hauptstr.', einheiten: [{ id: 'e1' }, { id: 'e2' }] });
    expect(mergeObjekt(o1, o2, { felder: {}, listen: { einheiten: 'B' } }).einheiten).toEqual([{ id: 'e2' }]);
  });

  it('Deal: Kommentare verlustfrei, Kalkulation/Einheiten/Sanierung nach Wahl', () => {
    const d1 = { id: 'd1', status: 'In Prüfung', kalkulation: { kaufpreis: 1 }, einheiten: [{ id: 'x' }], sanierungen: [], kommentare: [{ zeitpunkt: '2026-09-01T10:00:00Z', text: 'gleich' }] };
    const d2 = { id: 'd2', status: 'Archiv', kalkulation: { kaufpreis: 2 }, einheiten: [{ id: 'y' }], sanierungen: [{ id: 's' }], kommentare: [{ zeitpunkt: '2026-09-01T10:00:00Z', text: 'gleich' }, { zeitpunkt: '2026-09-05T10:00:00Z', text: 'neu' }] };
    const m = mergeDeal(d1, d2, { felder: { status: 'B' }, listen: { kalkulation: 'B', sanierungen: 'union' } });
    expect(m).toMatchObject({ id: 'd1', status: 'Archiv', kalkulation: { kaufpreis: 2 } });
    expect(m.einheiten).toEqual([{ id: 'x' }]);
    expect(m.sanierungen).toEqual([{ id: 's' }]);
    expect(m.kommentare.map((k: { text: string }) => k.text)).toEqual(['neu', 'gleich']);
  });

  it('Listen: doppelte Kennungen fallen weg, neueste zuerst', () => {
    expect(kommunikationVereinen([{ id: 'a', zeitpunkt: '2026-01-01T00:00:00Z' }], [{ id: 'a', zeitpunkt: '2026-01-01T00:00:00Z' }, { id: 'b', zeitpunkt: '2026-02-01T00:00:00Z' }]).map((k) => k.id)).toEqual(['b', 'a']);
    expect(kommentareVereinen([{ zeitpunkt: null, text: 'Altbestand' }], [{ zeitpunkt: null, text: 'Altbestand' }]).length).toBe(1);
  });

  it('Rückgängig nur 24 Stunden', () => {
    const jetzt = Date.UTC(2026, 8, 17, 12);
    expect(mergeAbgelaufen(new Date(jetzt - 23 * 3600_000).toISOString(), jetzt)).toBe(false);
    expect(mergeAbgelaufen(new Date(jetzt - 25 * 3600_000).toISOString(), jetzt)).toBe(true);
    expect(mergeAbgelaufen('kaputt', jetzt)).toBe(true);
  });
});
