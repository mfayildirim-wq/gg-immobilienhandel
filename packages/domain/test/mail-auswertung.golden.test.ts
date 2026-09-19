/** Golden Master: Mail-Auswertung (Links, Klartext, Anhänge) wie server/graph.ts der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { anhangEinordnen, anhangRelevant, mailKlartext, mailLinks } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/mail-auswertung.json'), 'utf8')) as { faelle: any[] };

describe('Mail-Auswertung (Golden Master)', () => {
  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    if ('body' in f) {
      expect(mailLinks(f.body)).toEqual(f.links);
      expect(mailKlartext(f.body)).toEqual(f.klartext);
    } else {
      expect(anhangRelevant(f.anhang)).toBe(f.relevant);
      expect(anhangEinordnen(f.anhang)).toEqual(f.eingeordnet);
    }
  });
});
