import { like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { agentKern, bereichVon, type Nutzer } from '../src/kern.ts';
import { drehbuchModell, ki } from '../src/modell.ts';
import { agenten } from '../src/schema.ts';
import { testDb, url } from './db.ts';

describe('bereichVon', () => {
  it('nimmt den ersten Teil des Pfads', () => {
    expect(bereichVon('/')).toBe('/');
    expect(bereichVon('/deals')).toBe('/deals');
    expect(bereichVon('/deals/abc?x=1')).toBe('/deals');
    expect(bereichVon('/einstellungen/agentmode')).toBe('/einstellungen');
  });
});

describe.skipIf(!url)('Kontext: Tagesbeginn und Gesprächsfäden je Bereich', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  afterAll(async () => { if (url) await db.delete(agenten).where(like(agenten.slug, 'test-ktx-%')); await client?.end(); });
  const ziele = [
    { ziel: 'nav.ankauf', beschreibung: 'Seite Ankauf: Cockpit', seite: '/', vorschlaege: ['Was ist heute fällig?', 'Ersten Deal öffnen'] },
    { ziel: 'nav.deals', beschreibung: 'Seite Deals: alle Deals', seite: '/deals', vorschlaege: ['Deals in Prüfung zeigen'] },
    { ziel: 'nav.makler', beschreibung: 'Seite Makler', seite: '/makler' },
  ];
  const basis = { openapi: { paths: {} }, ziele, aufruf: async () => ({ status: 200, text: '{}' }), dna: { slug: `test-ktx-${Date.now()}` } };
  const nutzer: Nutzer = { id: `test-ktx-${Date.now()}@example` };
  const tag = `2101-0${1 + Math.floor(Math.random() * 9)}-1${Math.floor(Math.random() * 9)}`;

  it('fragt beim ersten Öffnen des Tages: weitermachen oder zusammenfassen — ohne Modellaufruf, danach nicht mehr', async () => {
    const modell = drehbuchModell([ki('Notiert.')]);
    const kern = agentKern({ db, modell, ...basis });
    const erst = await kern.kontext(nutzer, { ort: '/', heute: tag });
    expect(erst.art).toBe('tagesbeginn');
    expect(erst.chips.map((c) => c.wert)).toEqual(['morgen', 'neu']);
    // Ein Gespräch im Ankauf …
    await kern.nachricht(nutzer, { text: 'Notiz für Musterweg vorbereiten', ort: '/', kontext: {} });
    const zweiterTag = `${tag.slice(0, 8)}2${tag.slice(9)}`;
    const morgen = await kern.kontext(nutzer, { ort: '/deals', heute: zweiterTag });
    expect(morgen.art).toBe('tagesbeginn');
    expect(morgen.text).toContain('„Notiz für Musterweg vorbereiten“');
    expect(morgen.text).toContain('Ankauf');
    expect(morgen.chips.map((c) => c.wert)).toEqual([`weiter:${morgen.sitzungId}`, 'morgen', 'neu']);
    expect(morgen.chips.every((c) => c.art === 'kontext')).toBe(true);
    // … am selben Tag keine zweite Tagesfrage
    expect((await kern.kontext(nutzer, { ort: '/deals', heute: zweiterTag })).art).not.toBe('tagesbeginn');
    expect(modell.aufrufe.length).toBe(1);
  });

  it('neuer Bereich: sagt, was es hier gibt; zurück im Bereich: weitermachen oder neu', async () => {
    const n: Nutzer = { id: `${nutzer.id}-2` };
    const kern = agentKern({ db, modell: drehbuchModell([ki('Ok.')]), ...basis });
    await kern.kontext(n, { ort: '/', heute: tag });
    const deals = await kern.kontext(n, { ort: '/deals', heute: tag });
    expect(deals).toMatchObject({ art: 'neu', name: 'Deals', sitzungId: null });
    expect(deals.text).toContain('Deals');
    expect(deals.chips.map((c) => c.label)).toEqual(['Deals in Prüfung zeigen']);
    const makler = await kern.kontext(n, { ort: '/makler', heute: tag });
    expect(makler.chips.map((c) => c.label)).toEqual(['Was kann ich hier tun?']);

    const a = await kern.nachricht(n, { text: 'Zeig mir die fälligen Deals', ort: '/', kontext: {} });
    const zurueck = await kern.kontext(n, { ort: '/', heute: tag });
    expect(zurueck).toMatchObject({ art: 'fortsetzen', name: 'Ankauf', sitzungId: a.sitzungId });
    expect(zurueck.text).toContain('„Zeig mir die fälligen Deals“');
    expect(zurueck.chips.map((c) => c.wert)).toEqual([`weiter:${a.sitzungId}`, 'neu']);
    // Anderer Bereich hat seinen eigenen Faden (noch keinen)
    expect((await kern.kontext(n, { ort: '/deals/xyz', heute: tag })).art).toBe('neu');
  });
});
