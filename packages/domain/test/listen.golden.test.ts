/** Golden Master: Listen Deals/Objekte/Makler (Zähler, Chip, Suche, gespeicherter Filter, Sortierung, Zellen) und Filter-Engine wie in der alten App. */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  dealAktuelleKriterien, dealListe, describeFilter, FILTER_TEMPLATES, LISTEN_STATUS, maklerAktuelleKriterien, maklerListe, objektAktuelleKriterien, objektListe,
} from '../src/index.ts';

const g = JSON.parse(readFileSync(join(import.meta.dirname, 'golden/listen.json'), 'utf8')) as { faelle: any[]; vorlagen: unknown };
const json = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const zusammen = (...t: string[]) => t.join(' ').replace(/\s+/g, ' ').trim();

describe('Listen und gespeicherte Filter (Golden Master)', () => {
  it('Filtervorlagen wörtlich', () => expect(json(FILTER_TEMPLATES)).toEqual(g.vorlagen));

  it.each(g.faelle.map((f) => [f.name, f] as const))('%s', (_n, f) => {
    const d = dealListe(f.deals, f.objs, f.makler, f.statusD, f.suche, f.filter);
    expect(LISTEN_STATUS.map((s) => `${s}=${d.zaehler[s]}`)).toEqual(f.deal.stats);
    // statusBadge(undefined) schrieb alt „undefined“; im Neubau hat jeder Deal einen Status
    expect(d.zeilen.map((z) => ['', '', String(z.status), zusammen(z.adresse, z.stadt), zusammen(z.makler, z.firma), z.tel ? `📞 ${z.tel}` : '–', z.kaufpreis, z.flaeche, z.jnkm, z.rendite, z.angeboten])).toEqual(f.deal.zeilen);
    expect(dealAktuelleKriterien(f.statusD, f.suche)).toEqual(f.deal.kriterien);

    const o = objektListe(f.objs, f.deals, f.statusO, f.suche, f.filter);
    expect(LISTEN_STATUS.map((s) => `${s}=${o.zaehler[s]}`)).toEqual(f.objekt.stats);
    expect(o.zeilen.map((z) => ['', zusammen(z.adresse, z.ort), z.angeboten, z.makler, z.angebotspreis, z.zielpreis, z.flaeche, z.einheiten, z.kaltmieteJahr, z.status || 'undefined'])).toEqual(f.objekt.zeilen);
    expect(objektAktuelleKriterien(f.statusO, f.suche)).toEqual(f.objekt.kriterien);

    const m = maklerListe(f.makler, f.deals, f.prio, f.suche, f.filter);
    expect([`● Gesamt=${m.zaehler.gesamt}`, `▲ A-Makler=${m.zaehler.A}`, `◆ B-Makler=${m.zaehler.B}`, `○ C-Makler=${m.zaehler.C}`]).toEqual(f.maklerListe.stats);
    expect(m.zeilen.map((z) => [z.prioText, z.name, z.firma, z.tel || '–', z.email || '–', z.frequenz, `${z.aktiveDeals} / ${z.deals}`])).toEqual(f.maklerListe.zeilen);
    expect(maklerAktuelleKriterien(f.prio, f.suche)).toEqual(f.maklerListe.kriterien);

    if (f.filter) expect(describeFilter(f.filter)).toBe(f.beschreibung);
  });
});
