import { like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { bezuegeAusKontext } from '../src/ergebnisse.ts';
import { agentKern, type Nutzer } from '../src/kern.ts';
import { drehbuchModell, ki } from '../src/modell.ts';
import { agenten, ergebnisse } from '../src/schema.ts';
import { testDb, url } from './db.ts';

describe('bezuegeAusKontext', () => {
  it('macht aus <typ>Id einen Bezug, <typ> ist die Bezeichnung — alles andere bleibt Kontext', () => {
    expect(bezuegeAusKontext({ dealId: 'd1', deal: 'Musterweg 1', objektId: 'o1', seite: 'deal', leer: null }))
      .toEqual([{ typ: 'deal', refId: 'd1', bezeichnung: 'Musterweg 1' }, { typ: 'objekt', refId: 'o1', bezeichnung: '' }]);
    expect(bezuegeAusKontext({})).toEqual([]);
  });
});

describe.skipIf(!url)('Ergebnisse', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  const nutzer: Nutzer = { id: `test-erg-${Date.now()}@example` };
  afterAll(async () => {
    if (url) { await db.delete(ergebnisse).where(like(ergebnisse.nutzer, 'test-erg-%')); await db.delete(agenten).where(like(agenten.slug, 'test-erg-%')); }
    await client?.end();
  });
  const basis = { openapi: { paths: {} }, ziele: [], aufruf: async () => ({ status: 200, text: '{}' }), dna: { slug: `test-erg-${Date.now()}` } };
  const fokus = { dealId: `d-${Date.now()}`, deal: 'Musterweg 1', objektId: `o-${Date.now()}`, objekt: 'Musterweg 1, Esslingen' };

  it('speichert ein Ergebnis erst nach „Ja“ — mit Bezug auf die geöffneten Objekte, Frage, Quellen und Modell', async () => {
    const speichern = ki('', [['ergebnis_speichern', { titel: 'Lage Esslingen', art: 'recherche', inhalt: 'Ø 4.000 €/m², seitwärts.', quellen: [{ titel: 'immowelt', url: 'https://www.immowelt.de/x' }] }]]);
    const a = await agentKern({ db, modell: drehbuchModell([speichern, ki('Gespeichert.')]), ...basis })
      .nachricht(nutzer, { text: 'Analysiere die Lage', ort: '/deals', kontext: fokus });
    expect(a.wartetAuf?.frage).toMatch(/„Lage Esslingen“.*Deal Musterweg 1/);
    const kern = agentKern({ db, modell: drehbuchModell([ki('Gespeichert.')]), ...basis });
    expect(await kern.ergebnisseListe({ typ: 'deal', id: fokus.dealId })).toEqual([]);
    await kern.entscheidung(nutzer, { sitzungId: a.sitzungId, wert: 'ja' });

    const [e, ...rest] = await kern.ergebnisseListe({ typ: 'deal', id: fokus.dealId });
    expect(rest).toEqual([]);
    expect(e).toMatchObject({ titel: 'Lage Esslingen', art: 'recherche', inhalt: 'Ø 4.000 €/m², seitwärts.', frage: 'Analysiere die Lage', modell: 'drehbuch', nutzer: nutzer.id });
    expect(e!.quellen).toEqual([{ titel: 'immowelt', url: 'https://www.immowelt.de/x' }]);
    expect(e!.bezuege.map((b) => `${b.typ}:${b.bezeichnung}`).sort()).toEqual(['deal:Musterweg 1', 'objekt:Musterweg 1, Esslingen']);
    // Auch über das Objekt zu finden — und gezählt für den 🗂-Knopf
    expect((await kern.ergebnisseListe({ typ: 'objekt', id: fokus.objektId })).map((x) => x.id)).toEqual([e!.id]);
    expect(await kern.ergebnisseZaehlen({ typ: 'deal', id: fokus.dealId })).toBe(1);
  });

  it('„Nein“ speichert nichts; ergebnisse_lesen liefert die gespeicherten zum Fokus', async () => {
    const f = { dealId: `d2-${Date.now()}`, deal: 'Hauptstraße 2' };
    const speichern = ki('', [['ergebnis_speichern', { titel: 'Mietanalyse', art: 'dokumentanalyse', inhalt: 'Mieten 20 % unter Markt.' }]]);
    const a = await agentKern({ db, modell: drehbuchModell([speichern, ki('Gut.')]), ...basis }).nachricht(nutzer, { text: 'Analysiere die Mietdokumente', ort: '/', kontext: f });
    await agentKern({ db, modell: drehbuchModell([ki('Gut, nicht gespeichert.')]), ...basis }).entscheidung(nutzer, { sitzungId: a.sitzungId, wert: 'nein' });
    const kern = agentKern({ db, modell: drehbuchModell([]), ...basis });
    expect(await kern.ergebnisseZaehlen({ typ: 'deal', id: f.dealId })).toBe(0);

    const b = await agentKern({ db, modell: drehbuchModell([speichern, ki('Ok.')]), ...basis }).nachricht(nutzer, { text: 'speichern', ort: '/', kontext: f });
    await agentKern({ db, modell: drehbuchModell([ki('Ok.')]), ...basis }).entscheidung(nutzer, { sitzungId: b.sitzungId, wert: 'ja' });
    const lesen = drehbuchModell([ki('', [['ergebnisse_lesen', {}]]), ki('Du hattest eine Mietanalyse.')]);
    await agentKern({ db, modell: lesen, ...basis }).nachricht(nutzer, { text: 'Was hatten wir?', ort: '/', kontext: f });
    expect(JSON.stringify(lesen.aufrufe.at(-1))).toContain('Mieten 20 % unter Markt.');

    const [e] = await kern.ergebnisseListe({ typ: 'deal', id: f.dealId });
    expect(await kern.ergebnisLoeschen(e!.id)).toBe(true);
    expect(await kern.ergebnisseZaehlen({ typ: 'deal', id: f.dealId })).toBe(0);
  });

  it('nimmt Werkzeuge des Hosts auf (z. B. Dokumente der App lesen)', async () => {
    const gelesen: string[] = [];
    const zusatzWerkzeuge = () => [{ name: 'dokument_lesen', beschreibung: 'liest ein Dokument', parameter: z.object({ dokumentId: z.string() }), ausfuehren: async (a: Record<string, unknown>) => { gelesen.push(String(a.dokumentId)); return 'Mieterliste: 6 Einheiten, 7,80 €/m²'; } }];
    const modell = drehbuchModell([ki('', [['dokument_lesen', { dokumentId: 'dok-1' }]]), ki('Die Mieten liegen bei 7,80 €/m².')]);
    const a = await agentKern({ db, modell, zusatzWerkzeuge, ...basis }).nachricht(nutzer, { text: 'Analysiere die Mieterliste', ort: '/', kontext: {} });
    expect(gelesen).toEqual(['dok-1']);
    expect(a.text).toBe('Die Mieten liegen bei 7,80 €/m².');
  });
});
