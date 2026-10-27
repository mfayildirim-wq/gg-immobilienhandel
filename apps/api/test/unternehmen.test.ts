import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray, like, or, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const UEBERNAHME = readFileSync(join(import.meta.dirname, '../../../supabase/migrations/20261019150529_unternehmen_uebernahme.sql'), 'utf8');

describe.skipIf(!url)('Unternehmen der Makler (18.10.2026)', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true } });
  const k = `Untern${Date.now()}`;
  const ids: string[] = [];

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const senden = (methode: string, pfad: string, body: unknown) => app.request(pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const anlegen = async (body: Record<string, unknown>) => { const m = await lies(senden('POST', '/api/makler', body)); ids.push(m.id); return m; };
  const detail = (id: string) => lies(app.request(`/api/makler/${id}`));
  const aendern = async (id: string, body: Record<string, unknown>) => {
    const r = await senden('PATCH', `/api/makler/${id}`, { version: (await detail(id)).version, ...body });
    expect(r.status).toBe(200);
  };
  const roh = async (id: string) => (await db.select().from(schema.makler).where(eq(schema.makler.id, id)))[0]!;
  const unternehmen = async (id: string) => (await db.select().from(schema.unternehmen).where(eq(schema.unternehmen.id, id)))[0]!;

  afterAll(async () => {
    const uids = (await db.select({ u: schema.makler.unternehmenId }).from(schema.makler).where(inArray(schema.makler.id, ids))).map((x) => x.u).filter((x): x is string => !!x);
    await db.delete(schema.makler).where(inArray(schema.makler.id, ids));
    await db.delete(schema.unternehmen).where(or(like(schema.unternehmen.name, `%${k}%`), uids.length ? inArray(schema.unternehmen.id, uids) : undefined));
    await client.end();
  });

  it('Anlegen mit Firma: Unternehmen entsteht, der zweite Makler (andere Schreibweise) landet im selben', async () => {
    const a = await anlegen({ name: 'Anna', firma: `${k} Immobilien GmbH` });
    const b = await anlegen({ name: 'Bernd', firma: `  ${k.toUpperCase()} IMMOBILIEN GMBH ` });
    expect(a.firma).toBe(`${k} Immobilien GmbH`);
    expect(b.firma).toBe(`${k} Immobilien GmbH`);
    const [ra, rb] = [await roh(a.id), await roh(b.id)];
    expect(ra.unternehmenId).toBeTruthy();
    expect(rb.unternehmenId).toBe(ra.unternehmenId);
    expect(ra.firma).toBeNull();
    const d = await detail(a.id);
    expect(d.unternehmen).toMatchObject({ name: `${k} Immobilien GmbH`, makler: [{ id: b.id, name: 'Bernd' }] });
  });

  it('Webseite und Anschrift gelten für alle Makler des Unternehmens', async () => {
    const [a, b] = ids;
    await aendern(a!, { webseite: 'https://www.beispiel-firma.de', strasse: 'Königstr. 1', plz: '70173', ort: 'Stuttgart' });
    expect(await detail(b!)).toMatchObject({ webseite: 'https://www.beispiel-firma.de', strasse: 'Königstr. 1', ort: 'Stuttgart' });
    expect((await unternehmen((await roh(a!)).unternehmenId!)).domain).toBe('beispiel-firma.de');
    // Leeren wirkt — kein Altwert kommt über den Rückfall zurück
    await aendern(b!, { webseite: '' });
    expect((await detail(a!)).webseite).toBeNull();
  });

  it('Wechsel zu einem bestehenden Unternehmen: mitgeschickte Firmenwerte füllen dort nur Lücken', async () => {
    const c = await anlegen({ name: 'Clara', firma: `${k} Makler AG` });
    await aendern(c.id, { webseite: 'www.makler-ag.de' });
    const [a] = ids;
    const vorher = await detail(a!);
    await aendern(a!, { firma: `${k} Makler AG`, webseite: vorher.webseite ?? '', strasse: vorher.strasse ?? '', plz: vorher.plz ?? '', ort: vorher.ort ?? '' });
    const nachher = await detail(a!);
    expect(nachher).toMatchObject({ firma: `${k} Makler AG`, webseite: 'www.makler-ag.de', strasse: 'Königstr. 1' });
    expect((await roh(a!)).unternehmenId).toBe((await roh(c.id)).unternehmenId);
  });

  it('Firma leeren: kein Unternehmen mehr, keine Firma', async () => {
    const c = ids[2]!;
    await aendern(c, { firma: '' });
    expect(await roh(c)).toMatchObject({ unternehmenId: null, firma: null });
    expect((await detail(c)).firma).toBeNull();
  });

  it('Altbestand (nur makler.firma): wird angezeigt und von der Migration zugeordnet — erneut ausgeführt ändert sie nichts', async () => {
    const alt = [`${k}alt1`, `${k}alt2`];
    // In einer Transaktion, die zurückgerollt wird: die Migration betrachtet alle Makler ohne Unternehmen
    let ergebnis: { m1: any; m2: any; u: any; anzahl: number; nochmal: number } | undefined;
    await db.transaction(async (tx) => {
      await tx.insert(schema.makler).values([
        { id: alt[0]!, name: 'Dora', firma: `${k} Bestand KG`, webseite: 'www.bestand.de', weitereKontakte: { namen: ['Emil', 'Fritz'], telefonnummern: [], emails: [] } },
        { id: alt[1]!, name: 'Emil', firma: `${k} bestand kg`, email: 'emil@bestand.de' },
      ]);
      await tx.execute(sql.raw(UEBERNAHME));
      const [m1, m2] = await Promise.all(alt.map(async (id) => (await tx.select().from(schema.makler).where(eq(schema.makler.id, id)))[0]!));
      const [u] = await tx.select().from(schema.unternehmen).where(eq(schema.unternehmen.id, m1!.unternehmenId!));
      const anzahl = (await tx.select().from(schema.unternehmen)).length;
      await tx.execute(sql.raw(UEBERNAHME));
      ergebnis = { m1, m2, u, anzahl, nochmal: (await tx.select().from(schema.unternehmen)).length };
      tx.rollback();
    }).catch(() => undefined);
    expect(ergebnis!.m2.unternehmenId).toBe(ergebnis!.m1.unternehmenId);
    expect(ergebnis!.u).toMatchObject({ name: `${k} Bestand KG`, webseite: 'www.bestand.de', domain: 'bestand.de', weitereKontakte: { namen: ['Fritz'], telefonnummern: [], emails: [] } });
    expect(ergebnis!.nochmal).toBe(ergebnis!.anzahl);
  });

  it('Makler-Liste und Deals zeigen den Namen aus dem Unternehmen', async () => {
    const liste = await lies(app.request('/api/makler'));
    expect(liste.find((x: any) => x.id === ids[1])?.firma).toBe(`${k} Immobilien GmbH`);
  });
});
