/** Golden Master: globale Suche über Objekte, Deals und Makler wie in der alten App (globalSearchExec). */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globaleSuche, SUCHE_HINWEIS_KURZ, SUCHE_HINWEIS_OHNE_TREFFER } from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/suche.json'), 'utf8')) as { faelle: any[] };
const zeile = (t: { titel: string; zusatz: string }) => `${t.titel} ${t.zusatz}`.replace(/\s+/g, ' ').trim();

describe('Globale Suche (Golden Master)', () => {
  it.each(g.faelle.map((f) => [`${f.name} „${f.eingabe}"`, f] as const))('%s', (_n, f) => {
    const r = globaleSuche(f.objs, f.deals, f.makler, f.eingabe);
    if (r === null) {
      expect(f.hinweis).toBe(SUCHE_HINWEIS_KURZ);
      return;
    }
    if (f.leer) {
      expect(r.gesamt).toBe(0);
      expect(SUCHE_HINWEIS_OHNE_TREFFER).toBe('Kein Treffer');
      return;
    }
    const erwartet = Object.fromEntries(f.bereiche.map((b: any) => [b.bereich, b]));
    const bereiche = [['🏢 Objekte', r.objekte], ['📋 Deals', r.deals], ['🤝 Makler', r.makler]] as const;
    expect(bereiche.filter(([, t]) => t.length).map(([n]) => n)).toEqual(f.bereiche.map((b: any) => b.bereich));
    for (const [name, treffer] of bereiche) {
      if (!treffer.length) continue;
      expect(treffer.length, `${name} Anzahl`).toBe(erwartet[name].anzahl);
      expect(treffer.map(zeile), `${name} Zeilen`).toEqual(erwartet[name].zeilen);
    }
  });
});
