/** Golden Master: Default-Deny-Gate (evaluateOutward) wie server/outward-gate.ts der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateOutward } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/outward-gate.json'), 'utf8')) as { faelle: any[] };

describe('Aktionen nach außen (Golden Master)', () => {
  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    expect(evaluateOutward(f.eingabe)).toEqual(f.entscheidung);
  });

  it('ohne Umgebung ist alles gesperrt (Standard im Browser und lokal)', () => {
    const e = evaluateOutward({ action: 'propstack-unit-create', url: 'https://api.propstack.de/v1/units', settings: { allowPropstackWrite: true } });
    expect(e.allowed).toBe(false);
    expect(e.failed).toContain('environment');
  });
});
