import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

/** Unternehmen der Makler (Normalform 17.10.2026): Firma als Text verknüpft oder legt an; Liste, Ändern, Zusammenführen, Löschen. */
describe.skipIf(!url)('Unternehmen', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, speicher: speicherImSpeicher(), ki: kiAttrappe(), suche: { web: async () => [], news: async () => [] } });
  const kennung = `Unt${Date.now()}`;
  const angelegt = { makler: [] as string[], unternehmen: [] as string[] };

  afterAll(async () => {
    if (angelegt.makler.length) await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    if (angelegt.unternehmen.length) await db.delete(schema.unternehmen).where(inArray(schema.unternehmen.id, angelegt.unternehmen));
    await client.end();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const post = (pfad: string, body: unknown, method = 'POST') => app.request(pfad, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const merken = <T extends { id: string; unternehmenId?: string | null }>(m: T): T => { angelegt.makler.push(m.id); if (m.unternehmenId) angelegt.unternehmen.push(m.unternehmenId); return m; };

  it('Firma als Text: gleiche Schreibweise findet dasselbe Unternehmen, Rechtsform und Domain werden abgeleitet', async () => {
    const a = merken(await lies(post('/api/makler', { name: `${kennung} Anna`, firma: `${kennung} Immobilien GmbH`, email: `anna@${kennung.toLowerCase()}-immo.de` })));
    const b = merken(await lies(post('/api/makler', { name: `${kennung} Bernd`, firma: `  ${kennung}  immobilien GMBH. ` })));
    expect(a.unternehmenId).toBeTruthy();
    expect(b.unternehmenId).toBe(a.unternehmenId);
    expect(b.firma).toBe(`${kennung} Immobilien GmbH`);
    const detail = await lies(app.request(`/api/makler/${a.id}`));
    expect(detail.unternehmen).toMatchObject({ id: a.unternehmenId, name: `${kennung} Immobilien GmbH`, rechtsform: 'GmbH', domain: `${kennung.toLowerCase()}-immo.de`, maklerAnzahl: 2, quelle: 'hand' });
    expect(detail.firma).toBe(`${kennung} Immobilien GmbH`);
    // Liste der Makler zeigt den abgeleiteten Namen
    const liste = await lies(app.request('/api/makler'));
    expect(liste.find((m: { id: string }) => m.id === b.id).firma).toBe(`${kennung} Immobilien GmbH`);
  });

  it('Ändern am Makler: neuer Firmenname legt ein Unternehmen an, leer löst die Verknüpfung, ID hat Vorrang', async () => {
    const m = merken(await lies(post('/api/makler', { name: `${kennung} Carla` })));
    expect(m.unternehmenId).toBeNull();
    const v1 = await lies(post(`/api/makler/${m.id}`, { version: m.version, firma: `${kennung} Zweit AG` }, 'PATCH'));
    const d1 = await lies(app.request(`/api/makler/${m.id}`));
    expect(d1.unternehmen).toMatchObject({ name: `${kennung} Zweit AG`, rechtsform: 'AG', maklerAnzahl: 1 });
    angelegt.unternehmen.push(d1.unternehmenId);
    const v2 = await lies(post(`/api/makler/${m.id}`, { version: v1.version, firma: '' }, 'PATCH'));
    expect((await lies(app.request(`/api/makler/${m.id}`))).unternehmenId).toBeNull();
    const erstes = angelegt.unternehmen[0]!;
    await post(`/api/makler/${m.id}`, { version: v2.version, firma: 'ignoriert', unternehmenId: erstes }, 'PATCH');
    expect((await lies(app.request(`/api/makler/${m.id}`))).unternehmenId).toBe(erstes);
    expect((await post(`/api/makler/${m.id}`, { version: v2.version + 1, unternehmenId: 'gibt-es-nicht' }, 'PATCH')).status).toBe(404);
  });

  it('Unternehmen: Liste mit Maklerzahl, Ändern mit Versionsprüfung und Namenskonflikt, Löschen nur ohne Makler', async () => {
    const liste = await lies(app.request('/api/unternehmen'));
    const u = liste.find((x: { name: string }) => x.name === `${kennung} Immobilien GmbH`);
    expect(u.maklerAnzahl).toBe(3);
    const neu = await lies(post('/api/unternehmen', { name: `${kennung} Solo e.K.`, webseite: 'https://www.solo-immo.de/', ort: 'Stuttgart' }));
    angelegt.unternehmen.push(neu.id);
    expect(neu).toMatchObject({ neu: true, rechtsform: 'e.K.', webseite: 'solo-immo.de', domain: 'solo-immo.de', ort: 'Stuttgart', maklerAnzahl: 0 });
    expect((await lies(post('/api/unternehmen', { name: `${kennung} solo e.k.` }))).neu).toBe(false);
    const g = await lies(post(`/api/unternehmen/${neu.id}`, { version: neu.version, tel: '+49 711 1', strasse: 'Weg 1', plz: '70173' }, 'PATCH'));
    expect(g.version).toBe(neu.version + 1);
    expect((await post(`/api/unternehmen/${neu.id}`, { version: neu.version, tel: 'x' }, 'PATCH')).status).toBe(409);
    const konflikt = await post(`/api/unternehmen/${neu.id}`, { version: g.version, name: `${kennung} immobilien gmbh` }, 'PATCH');
    expect(konflikt.status).toBe(409);
    expect((await lies(konflikt)).fehler).toContain('zusammenführen');
    expect((await post(`/api/unternehmen/${u.id}`, {}, 'DELETE')).status).toBe(409);
    expect((await post(`/api/unternehmen/${neu.id}`, {}, 'DELETE')).status).toBe(200);
    expect((await app.request(`/api/unternehmen/${neu.id}`)).status).toBe(404);
  });

  it('Zusammenführen: Makler wechseln, leere Felder werden ergänzt, das andere Unternehmen liegt im Papierkorb', async () => {
    const weg = await lies(post('/api/unternehmen', { name: `${kennung} Alt Schreibweise`, tel: '+49 711 9', ort: 'Esslingen' }));
    angelegt.unternehmen.push(weg.id);
    const m = merken(await lies(post('/api/makler', { name: `${kennung} Dora`, unternehmenId: weg.id })));
    const liste = await lies(app.request('/api/unternehmen'));
    const behalten = liste.find((x: { name: string }) => x.name === `${kennung} Immobilien GmbH`);
    const erg = await lies(post(`/api/unternehmen/${behalten.id}/zusammenfuehren`, { wegId: weg.id }));
    expect(erg).toEqual({ id: behalten.id, makler: 1 });
    expect((await lies(app.request(`/api/makler/${m.id}`))).unternehmenId).toBe(behalten.id);
    const nachher = await lies(app.request(`/api/unternehmen/${behalten.id}`));
    expect(nachher).toMatchObject({ tel: '+49 711 9', ort: 'Esslingen', maklerAnzahl: 4 });
    expect(nachher.notizen).toContain('Zusammengeführt mit');
    expect((await app.request(`/api/unternehmen/${weg.id}`)).status).toBe(404);
    const [zeile] = await db.select({ deletedAt: schema.unternehmen.deletedAt }).from(schema.unternehmen).where(eq(schema.unternehmen.id, weg.id));
    expect(zeile?.deletedAt).toBeTruthy();
    expect((await post(`/api/unternehmen/${behalten.id}/zusammenfuehren`, { wegId: behalten.id })).status).toBe(400);
  });
});
