/** Jede Tabelle des Schemas ist entweder gesichert oder ausdrücklich ausgenommen (wie backup.test.ts der alten App). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SICHERUNG_AUSGENOMMEN, SICHERUNG_TABELLEN } from '../src/services/sicherung.ts';

const schemaQuelle = readFileSync(join(import.meta.dirname, '../../../packages/db/src/schema.ts'), 'utf8');

describe('Sicherung: Vollständigkeit', () => {
  const tabellen = [...schemaQuelle.matchAll(/export const (\w+) = fach/g)].map((m) => m[1]!);

  it('kennt jede Tabelle des Schemas', () => {
    const fehlend = tabellen.filter((t) => !SICHERUNG_TABELLEN.includes(t as never) && !(t in SICHERUNG_AUSGENOMMEN));
    expect(fehlend, `Diese Tabellen sind weder gesichert noch ausgenommen: ${fehlend.join(', ')}`).toEqual([]);
  });

  it('nennt keine Tabelle, die es nicht gibt', () => {
    const unbekannt = [...SICHERUNG_TABELLEN, ...Object.keys(SICHERUNG_AUSGENOMMEN)].filter((t) => !tabellen.includes(t));
    expect(unbekannt).toEqual([]);
  });

  it('sichert und nimmt nicht dieselbe Tabelle aus', () => {
    expect(SICHERUNG_TABELLEN.filter((t) => t in SICHERUNG_AUSGENOMMEN)).toEqual([]);
  });
});
