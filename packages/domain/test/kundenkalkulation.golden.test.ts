import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeKKalk, type KKalkInputs } from '../src/index.ts';

/** Golden Master gegen die Engine der alten App: alle Ausgaben inklusive 50-Jahres-Matrizen exakt gleich. */
const { faelle } = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/kundenkalkulation.json'), 'utf8')) as {
  faelle: { name: string; eingabe: KKalkInputs; ergebnis: unknown }[];
};

describe(`Kundenkalkulation = alte App (${faelle.length} Fälle)`, () => {
  it.each(faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    // Rundreise durch JSON wie beim Erzeugen (−0 → 0, NaN → null)
    expect(JSON.parse(JSON.stringify(computeKKalk(f.eingabe)))).toEqual(f.ergebnis);
  });
});
