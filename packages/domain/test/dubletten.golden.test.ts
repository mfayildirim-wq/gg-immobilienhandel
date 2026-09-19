/** Golden Master: Dublettensuche und Feld-Auflösung wie findAllDuplicates/computeFieldDiffs/resolveField der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alleDubletten, feldUnterschiede, feldWert, listenWert, type MergeWahl } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/dubletten.json'), 'utf8')) as { faelle: any[] };

describe('Dubletten (Golden Master)', () => {
  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const paare = alleDubletten(f.makler, f.objs, f.deals, f.ignoriert)
      .map((p) => ({ typ: p.typ, a: p.a.id, b: p.b.id, sicherheit: p.sicherheit, grund: p.grund }));
    expect(paare).toEqual(f.paare);

    const { a, b, wahl, diffs, werte, listen } = f.felderFall;
    const neueWahl: MergeWahl = { felder: wahl.fields, listen: wahl.subArrays };
    expect(feldUnterschiede(a, b, ['f1', 'f2', 'f3']).map((d) => ({ field: d.feld, valueA: d.wertA, valueB: d.wertB, conflict: d.konflikt })))
      .toEqual(diffs.map((d: any) => ({ field: d.field, valueA: d.valueA, valueB: d.valueB, conflict: d.conflict })));
    for (const feld of ['f1', 'f2', 'f3']) expect(feldWert(feld, a, b, neueWahl) ?? null).toEqual(werte[feld] ?? null);
    for (const name of ['liste', 'obj']) expect(listenWert(name, a, b, neueWahl) ?? null).toEqual(listen[name] ?? null);
  });
});
