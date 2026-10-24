import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { GedaechtnisFehler, gedaechtnisAttrappe, type GedaechtnisDienst } from '@gg/integrations';
import { inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const offen = { lokalOffen: true, produktion: false, erlaubteEmails: [] };

describe.skipIf(!url)('Gedächtnis: Ereignisse aus gg und Einträge je Deal/Makler (24.10.2026)', () => {
  const { db, client } = createDb(url!);
  const dienst = gedaechtnisAttrappe();
  const app = createApp({ db, auth: offen, gedaechtnis: dienst });
  const k = `Gedaechtnis${Date.now()}`;
  const angelegt = { makler: [] as string[], objekte: [] as string[] };

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const senden = (methode: string, pfad: string, body?: unknown) =>
    app.request(pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  afterAll(async () => {
    await db.delete(schema.deals).where(inArray(schema.deals.objektId, angelegt.objekte));
    await db.delete(schema.objekte).where(inArray(schema.objekte.id, angelegt.objekte));
    await db.delete(schema.makler).where(inArray(schema.makler.id, angelegt.makler));
    await db.delete(schema.unternehmen).where(like(schema.unternehmen.name, `%${k}%`));
    await client.end();
  });

  it('Makler: Kontakt und Betreuung als ganzer Stand, neuer Stand ersetzt den alten; Name allein meldet nichts Neues', async () => {
    const m = await lies(senden('POST', '/api/makler', { name: `${k} Anna`, firma: `${k} GmbH`, tel: '0711 1' }));
    angelegt.makler.push(m.id);
    const version = async () => (await lies(app.request(`/api/makler/${m.id}`))).version;
    expect((await senden('PATCH', `/api/makler/${m.id}`, { version: await version(), mobil: '0171 5550001' })).status).toBe(200);
    expect((await senden('PATCH', `/api/makler/${m.id}`, { version: await version(), prio: 'A' })).status).toBe(200);
    expect((await senden('PATCH', `/api/makler/${m.id}`, { version: await version(), mobil: '0172 9990002' })).status).toBe(200);

    const { eintraege } = await lies(app.request(`/api/gedaechtnis/makler/${m.id}`));
    const texte = eintraege.map((e: { art: string; text: string }) => `${e.art}: ${e.text}`).sort();
    expect(texte).toHaveLength(2);
    expect(texte[0]).toMatch(/^betreuung: Makler .*Anna .*Priorität A/);
    expect(texte[1]).toMatch(/^kontakt: .*Telefon 0711 1, Mobil 0172 9990002\.$/);
    expect(texte.join(' ')).not.toContain('0171');
  });

  it('Deal: Status ersetzt Status, Kommentare bleiben einzeln; Merken, Ändern, Vergessen über die Oberfläche', async () => {
    const o = await lies(senden('POST', '/api/objekte', { strasse: `${k}weg`, hausnr: '1' }));
    angelegt.objekte.push(o.id);
    const d = await lies(senden('POST', '/api/deals', { objektId: o.id }));
    const version = async () => (await lies(app.request(`/api/deals/${d.id}`))).version;
    expect((await senden('PATCH', `/api/deals/${d.id}/status`, { status: 'Angebot abgegeben', version: await version() })).status).toBe(200);
    expect((await senden('PATCH', `/api/deals/${d.id}/status`, { status: 'Archiv', version: await version(), grund: 'zu teuer' })).status).toBe(200);
    await senden('POST', `/api/deals/${d.id}/kommentare`, { text: 'Bank will Mietliste' });
    await senden('POST', `/api/deals/${d.id}/kommentare`, { text: 'Mietliste geschickt' });

    const liste = async () => (await lies(app.request(`/api/gedaechtnis/deal/${d.id}`))).eintraege.map((e: { text: string }) => e.text).sort();
    expect(await liste()).toEqual([
      `Deal ${k}weg 1: Status Archiv (Grund: zu teuer).`,
      `Kommentar zum Deal ${k}weg 1: Bank will Mietliste`,
      `Kommentar zum Deal ${k}weg 1: Mietliste geschickt`,
    ]);

    const gemerkt = await lies(senden('POST', `/api/gedaechtnis/deal/${d.id}`, { text: 'Verkäufer erst ab November erreichbar' }));
    expect(gemerkt.neu[0]).toMatchObject({ quelle: 'ki', objekt: `gg:deal:${d.id}` });
    const geaendert = await lies(senden('PATCH', `/api/gedaechtnis/eintraege/${gemerkt.neu[0].id}`, { text: 'Verkäufer ab 3. November erreichbar' }));
    expect(geaendert).toMatchObject({ text: 'Verkäufer ab 3. November erreichbar', quelle: 'hand' });
    const treffer = await lies(senden('POST', '/api/gedaechtnis/suchen', { frage: 'Wann ist der Verkäufer erreichbar?', art: 'deal', id: d.id }));
    expect(treffer.treffer[0].text).toBe('Verkäufer ab 3. November erreichbar');
    expect(await lies(senden('DELETE', `/api/gedaechtnis/eintraege/${gemerkt.neu[0].id}`))).toEqual({ id: gemerkt.neu[0].id, geloescht: true });
    expect(await liste()).toHaveLength(3);
  });

  it('Ohne Dienst: Oberfläche bekommt 503, Änderungen in gg laufen trotzdem; ein ausgefallener Dienst hält gg nicht auf', async () => {
    const ohne = createApp({ db, auth: offen, gedaechtnis: null });
    expect(await lies(ohne.request('/api/gedaechtnis'))).toEqual({ verbunden: false });
    expect((await ohne.request('/api/gedaechtnis/deal/x')).status).toBe(503);

    const kaputt: GedaechtnisDienst = { ...dienst, ereignis: async () => { throw new GedaechtnisFehler(503, 'weg'); }, eintraege: async () => { throw new GedaechtnisFehler(401, 'Schlüssel ungültig'); } };
    const mitKaputt = createApp({ db, auth: offen, gedaechtnis: kaputt });
    const m = await lies(mitKaputt.request('/api/makler', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: `${k} Bernd` }) }));
    angelegt.makler.push(m.id);
    const v = (await lies(mitKaputt.request(`/api/makler/${m.id}`))).version;
    const r = await mitKaputt.request(`/api/makler/${m.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: v, prio: 'B' }) });
    expect(r.status).toBe(200);
    const fehler = await mitKaputt.request(`/api/gedaechtnis/makler/${m.id}`);
    expect(fehler.status).toBe(403);
    expect(await fehler.json()).toMatchObject({ fehler: 'Schlüssel ungültig' });
  });
});
