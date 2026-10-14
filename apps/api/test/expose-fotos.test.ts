import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { type ExposeBild, kiAttrappe, speicherImSpeicher, testExpose } from '@gg/integrations';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { mitAusgeliefertenStandards } from './standardwerte.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

/** Minimales „JPEG“: nur die Signatur zählt für die Ablage; die Bytes unterscheiden die Bilder. */
const jpeg = (n: number): Uint8Array => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, n, 1, 2, 3, 4, 5, 0xff, 0xd9]);
const bild = (seite: number, n: number): ExposeBild => ({ seite, breite: 800, hoehe: 600, mime: 'image/jpeg', bytes: jpeg(n), hash: `h${n}` });

describe.skipIf(!url)('Exposé-Import: Fotos aus dem Exposé (Fake-Herauslösung, Ablage im Speicher)', () => {
  const { db, client } = createDb(url!);
  const speicher = speicherImSpeicher();
  let bilder: () => Promise<ExposeBild[]> = async () => [];
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher, ki: kiAttrappe(), attrappe: true, bilder: () => bilder() } });
  const kennung = `Fot${Date.now()}`;
  const angelegt = { deals: [] as string[], objekte: [] as string[], makler: [] as string[], importe: [] as string[] };
  mitAusgeliefertenStandards(url!);

  afterAll(async () => {
    if (angelegt.importe.length) await db.delete(schema.exposeImporte).where(inArray(schema.exposeImporte.id, angelegt.importe));
    if (angelegt.deals.length) await db.delete(schema.deals).where(inArray(schema.deals.id, angelegt.deals));
    if (angelegt.objekte.length) {
      await db.delete(schema.objektFotos).where(inArray(schema.objektFotos.objektId, angelegt.objekte));
      await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    }
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await client.end();
  });

  const json = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const analysieren = async (name: string) => {
    const e: any = await (await app.request('/api/expose/eingang', { method: 'POST', body: testExpose(name) })).json();
    const a: any = await (await json('/api/expose/analyse', { key: e.key, dateiname: `${name}.pdf` })).json();
    angelegt.importe.push(a.importId);
    return { key: e.key as string, a };
  };
  const uebernehmen = async (key: string, name: string, a: any, objektId?: string) => {
    const r = await json('/api/expose/uebernehmen', {
      key, dateiname: `${name}.pdf`, extrahiert: a.extrahiert, importId: a.importId,
      objekt: objektId ? { bestehendeId: objektId, daten: a.objekt } : { daten: a.objekt }, makler: { daten: a.makler }, deal: a.deal,
    });
    const erg: any = await r.json();
    expect(r.status, JSON.stringify(erg)).toBe(201);
    angelegt.deals.push(erg.dealId); angelegt.objekte.push(erg.objektId); if (erg.maklerId) angelegt.makler.push(erg.maklerId);
    return erg;
  };
  const eingangsBilder = (importId: string) => [...speicher.inhalt.keys()].filter((k) => k.startsWith(`pdfs/_eingang/${importId}/`));

  it('Analyse legt die Bilder in den Eingang; Route liefert das JPEG; die DB hält nur die Liste', async () => {
    bilder = async () => [bild(3, 2), bild(1, 1)];
    const { a } = await analysieren(kennung);
    expect(a.bilder).toEqual([
      { nr: 0, seite: 1, breite: 800, hoehe: 600, url: `/api/expose/importe/${a.importId}/bilder/0` },
      { nr: 1, seite: 3, breite: 800, hoehe: 600, url: `/api/expose/importe/${a.importId}/bilder/1` },
    ]);
    expect(eingangsBilder(a.importId)).toHaveLength(2);
    const r = await app.request(a.bilder[1].url);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toBe('image/jpeg');
    expect(r.headers.get('cache-control')).toContain('max-age');
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([...jpeg(2)]);
    expect((await app.request(`/api/expose/importe/${a.importId}/bilder/2`)).status).toBe(404);
    expect((await app.request(`/api/expose/importe/00000000-0000-4000-8000-000000000000/bilder/0`)).status).toBe(404);
    const [z] = await db.select({ analyse: schema.exposeImporte.analyse }).from(schema.exposeImporte).where(eq(schema.exposeImporte.id, a.importId));
    const liste = (z!.analyse as any).bilder;
    expect(liste[0]).toMatchObject({ key: `_eingang/${a.importId}/bild-0.jpg`, seite: 1, bytes: jpeg(1).byteLength, hash: 'h1' });
    expect(JSON.stringify(z!.analyse)).not.toContain('"bytes":{');
  });

  it('Fehler beim Herauslösen: Warnung, Analyse läuft weiter', async () => {
    bilder = async () => { throw new Error('kaputt'); };
    const { a } = await analysieren(`${kennung}x`);
    expect(a.bilder).toEqual([]);
    expect(a.warnungen.join(' ')).toContain('Fotos');
    expect(a.objekt.stadt).toBeTruthy();
  });

  it('Übernehmen: neues Objekt bekommt alle Bilder in Seitenreihenfolge, der Eingang ist leer', async () => {
    bilder = async () => [bild(4, 7), bild(2, 6)];
    const name = `${kennung}neu`;
    const { key, a } = await analysieren(name);
    const erg = await uebernehmen(key, name, a);
    expect(erg.fotos).toBe(2);
    const fotos = await db.select().from(schema.objektFotos).where(eq(schema.objektFotos.objektId, erg.objektId)).orderBy(schema.objektFotos.sort);
    expect(fotos.map((f) => f.dateiname)).toEqual(['Exposé S.2-1.jpg', 'Exposé S.4-2.jpg']);
    expect(fotos.map((f) => f.groesseBytes)).toEqual([jpeg(6).byteLength, jpeg(7).byteLength]);
    expect(eingangsBilder(a.importId)).toHaveLength(0);
    const liste = (await (await app.request(`/api/objekte/${erg.objektId}/fotos`)).json()) as unknown[];
    expect(liste).toHaveLength(2);
  });

  it('Übernehmen an bestehendes Objekt: gleiche Bilder (Name + Größe) werden nicht doppelt angehängt', async () => {
    bilder = async () => [bild(1, 9)];
    const name = `${kennung}alt`;
    const { key, a } = await analysieren(name);
    const erst = await uebernehmen(key, name, a);
    expect(erst.fotos).toBe(1);
    // zweites Exposé zum selben Objekt (anderer Makler → keine Deal-Dublette): dasselbe Bild plus ein neues
    bilder = async () => [bild(1, 9), bild(2, 8)];
    const { key: key2, a: a2 } = await analysieren(`${name}b`);
    const zweit = await uebernehmen(key2, name, { ...a2, makler: { ...a2.makler, name: 'Anderer Makler', tel: '', email: '' } }, erst.objektId);
    expect(zweit.fotos).toBe(1);
    const fotos = await db.select().from(schema.objektFotos).where(eq(schema.objektFotos.objektId, erst.objektId));
    expect(fotos).toHaveLength(2);
    expect(eingangsBilder(a2.importId)).toHaveLength(0);
  });
});
