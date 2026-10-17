import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { unternehmenAusDomain } from '../src/services/firmendaten.ts';

const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

/**
 * Firmendaten aus dem Impressum (Baustein B, 17.10.2026): Prüfung am Unternehmen füllt leere Felder, meldet Abweichungen,
 * speichert je Domain zwischen; HubSpot-Weg legt ein Unternehmen aus dem Impressum an.
 */
describe.skipIf(!url)('Firmendaten aus dem Impressum', () => {
  const { db, client } = createDb(url!);
  const kennung = `Imp${Date.now()}`;
  const domain = `${kennung.toLowerCase()}-immo.test`;
  const impressum = (firma: string, tel = '0711 123456-0') => `<html><body><h1>Impressum</h1><p>Angaben gemäß § 5 TMG</p>
<p>Firma: ${firma}<br>Straße: Königstraße 12a<br>PLZ: 70173<br>Ort: Stuttgart</p><p>Telefon: ${tel}<br>Fax: 0711 123456-9<br>E-Mail: info@${domain}</p></body></html>`;
  const seiten: Record<string, string> = { [`https://${domain}/impressum`]: impressum(`${kennung} Immobilien GmbH`) };
  const abrufe: string[] = [];
  const abruf = (async (eingabe: string | URL | Request) => {
    const u = String(eingabe);
    abrufe.push(u);
    return seiten[u] ? new Response(seiten[u], { status: 200, headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 });
  }) as typeof fetch;
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, speicher: speicherImSpeicher(), ki: kiAttrappe(), suche: { web: async () => [], news: async () => [] }, firmendaten: { abruf } });
  const angelegt: string[] = [];

  afterAll(async () => {
    if (angelegt.length) await db.delete(schema.unternehmen).where(inArray(schema.unternehmen.id, angelegt));
    await db.delete(schema.firmenAuskuenfte).where(inArray(schema.firmenAuskuenfte.domain, [domain, `ohne-${domain}`, `neu-${domain}`]));
    await db.delete(schema.auditLog).where(eq(schema.auditLog.source, 'unternehmen/impressum')).catch(() => undefined);
    await client.end();
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const post = (pfad: string, body: unknown, method = 'POST') => app.request(pfad, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  it('füllt leere Felder aus dem Impressum, meldet Abweichungen als Vorschlag, setzt geprüft und merkt sich die Domain', async () => {
    const u = await lies(post('/api/unternehmen', { name: `${kennung} Immobilien GmbH`, webseite: `https://www.${domain}/team`, tel: '0711 999' }));
    angelegt.push(u.id);
    const e = await lies(post(`/api/unternehmen/${u.id}/firmendaten`, {}));
    expect(e).toMatchObject({ domain, gefunden: true, url: `https://${domain}/impressum`, ausCache: false, mitKi: true });
    expect(e.ermittelt).toEqual({ name: `${kennung} Immobilien GmbH`, rechtsform: 'GmbH', strasse: 'Königstraße 12a', plz: '70173', ort: 'Stuttgart', tel: '0711 123456-0', fax: '0711 123456-9', email: `info@${domain}` });
    expect(e.uebernommen).toEqual(['strasse', 'plz', 'ort', 'fax', 'email']);
    expect(e.gleich).toEqual(['name', 'rechtsform']);
    expect(e.abweichend).toEqual([{ feld: 'tel', aktuell: '0711 999', ermittelt: '0711 123456-0' }]);
    expect(e.unternehmen).toMatchObject({ strasse: 'Königstraße 12a', plz: '70173', ort: 'Stuttgart', fax: '0711 123456-9', email: `info@${domain}`, tel: '0711 999', version: u.version + 1 });
    expect(e.unternehmen.geprueftAm).toBeTruthy();
    // KI-Kosten im Audit
    const [buchung] = await db.select().from(schema.auditLog).where(eq(schema.auditLog.source, 'unternehmen/impressum')).limit(1);
    expect(buchung).toBeTruthy();
  });

  it('zweiter Aufruf kommt aus dem Zwischenspeicher, „erneut“ holt frisch', async () => {
    const [u] = await db.select({ id: schema.unternehmen.id }).from(schema.unternehmen).where(eq(schema.unternehmen.domain, domain));
    const vorher = abrufe.length;
    const e = await lies(post(`/api/unternehmen/${u!.id}/firmendaten`, {}));
    expect(e.ausCache).toBe(true);
    expect(abrufe.length).toBe(vorher);
    seiten[`https://${domain}/impressum`] = impressum(`${kennung} Immobilien GmbH`, '0711 555');
    const frisch = await lies(post(`/api/unternehmen/${u!.id}/firmendaten`, { erneut: true }));
    expect(frisch.ausCache).toBe(false);
    expect(frisch.abweichend).toEqual([{ feld: 'tel', aktuell: '0711 999', ermittelt: '0711 555' }]);
    expect(abrufe.length).toBeGreaterThan(vorher);
  });

  it('ohne Domain 422; ohne Impressum „nicht gefunden“, aber geprüft', async () => {
    const ohne = await lies(post('/api/unternehmen', { name: `${kennung} Ohne Netz e.K.` }));
    angelegt.push(ohne.id);
    const r = await post(`/api/unternehmen/${ohne.id}/firmendaten`, {});
    expect(r.status).toBe(422);
    expect((await lies(r)).fehler).toContain('Webseite oder zentrale E-Mail');
    const leer = await lies(post('/api/unternehmen', { name: `${kennung} Leer AG`, email: `mail@ohne-${domain}` }));
    angelegt.push(leer.id);
    const e = await lies(post(`/api/unternehmen/${leer.id}/firmendaten`, {}));
    expect(e).toMatchObject({ domain: `ohne-${domain}`, gefunden: false, url: null, ermittelt: null, uebernommen: [], abweichend: [] });
    expect(e.unternehmen.geprueftAm).toBeTruthy();
    expect(e.unternehmen.domain).toBe(`ohne-${domain}`);
  });

  it('HubSpot-Weg: Unternehmen zu einer Domain — vorhandenes finden, sonst aus dem Impressum anlegen (Quelle impressum)', async () => {
    const [bekannt] = await db.select({ id: schema.unternehmen.id }).from(schema.unternehmen).where(eq(schema.unternehmen.domain, domain));
    expect(await unternehmenAusDomain(db, kiAttrappe(), `max@${domain}`, { abruf })).toBe(bekannt!.id);
    const neuDomain = `neu-${domain}`;
    seiten[`https://${neuDomain}/impressum`] = impressum(`${kennung} Neuland GmbH & Co. KG`);
    const id = await unternehmenAusDomain(db, kiAttrappe(), neuDomain, { abruf });
    expect(id).toBeTruthy();
    angelegt.push(id!);
    const u = await lies(app.request(`/api/unternehmen/${id}`));
    expect(u).toMatchObject({ name: `${kennung} Neuland GmbH & Co. KG`, rechtsform: 'GmbH & Co. KG', domain: neuDomain, webseite: neuDomain, strasse: 'Königstraße 12a', plz: '70173', ort: 'Stuttgart', tel: '0711 123456-0', quelle: 'impressum' });
    expect(u.geprueftAm).toBeTruthy();
    expect(await unternehmenAusDomain(db, kiAttrappe(), 'gibt-es-nicht.test', { abruf })).toBeNull();
    await db.delete(schema.firmenAuskuenfte).where(eq(schema.firmenAuskuenfte.domain, 'gibt-es-nicht.test'));
  });
});
