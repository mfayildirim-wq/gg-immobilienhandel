import { describe, expect, it } from 'vitest';
import { verschieben } from './reihenfolge.ts';

describe('verschieben (Zeilen der Einheitenliste umsortieren)', () => {
  it('nach unten und nach oben', () => {
    expect(verschieben(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(verschieben(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });
  it('gleiche Stelle oder außerhalb: unverändert, neue Liste', () => {
    const l = ['a', 'b'];
    expect(verschieben(l, 1, 1)).toEqual(l);
    expect(verschieben(l, 0, 5)).toEqual(['b', 'a']);
    expect(verschieben(l, -1, 0)).toEqual(l);
    expect(verschieben(l, 1, 1)).not.toBe(l);
  });
});
