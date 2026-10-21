/** Golden Master: Dublettensuche und Feld-Auflösung wie findAllDuplicates/computeFieldDiffs/resolveField der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { alleDubletten, feldUnterschiede, feldWert, levenshtein, listenWert, nameSimilar, type MergeWahl } from '../src/index.ts';

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

describe('Namensvergleich: schnelle Rechnung entscheidet wie die alte', () => {
  // Die bisherige Rechnung (ganze Tabelle, ohne Abbruch) als Maßstab
  const alt = (a: string, b: string) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        dp[i]![j] = a[i - 1] === b[j - 1] ? dp[i - 1]![j - 1]! : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    return dp[a.length]![b.length]!;
  };
  const altAehnlich = (a: string, b: string) => {
    const na = a.toLowerCase().trim(), nb = b.toLowerCase().trim();
    if (na === nb) return true;
    const maxLen = Math.max(na.length, nb.length);
    return maxLen > 0 && alt(na, nb) / maxLen < 0.3;
  };

  it('gleiche Abstände und gleiche Entscheidungen, auch genau an der Grenze', () => {
    let s = 42;
    const zufall = (n: number) => { s = (s * 1103515245 + 12345) % 2 ** 31; return s % n; };
    const wort = (n: number) => Array.from({ length: n }, () => 'abcde '[zufall(6)]).join('');
    const paare: [string, string][] = [['Anna Müller', 'Anna Mueller'], ['abcdefghij', 'abcdefgxyz'], ['abcdefghij', 'abcdefghxy'], ['A', 'B'], ['', 'x']];
    for (let i = 0; i < 20000; i++) {
      const a = wort(1 + zufall(14));
      // Varianten mit wenigen Änderungen, damit viele Paare nahe an der Grenze liegen
      let b = a.split('');
      for (let k = zufall(5); k > 0; k--) {
        const art = zufall(3), p = zufall(b.length + 1);
        if (art === 0) b.splice(p, 0, 'abcde '[zufall(6)]!); else if (art === 1) b.splice(p, 1); else b[p] = 'abcde '[zufall(6)]!;
      }
      paare.push([a, b.join('')]);
    }
    for (const [a, b] of paare) {
      expect(levenshtein(a, b)).toBe(alt(a, b));
      expect(nameSimilar(a, b), `${a} | ${b}`).toBe(altAehnlich(a, b));
    }
  });
});
