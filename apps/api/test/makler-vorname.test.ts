import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const MIGRATION = readFileSync(join(import.meta.dirname, '../../../supabase/migrations/20261019140056_makler_vorname_aufteilen.sql'), 'utf8');

describe.skipIf(!url)('Makler: Vorname und Name (19.10.2026)', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true, texterkennung: null } });
  const k = `Vorn${Date.now()}`;
  const ids: string[] = [];

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const senden = (methode: string, pfad: string, body: unknown) => app.request(pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const detail = (id: string) => lies(app.request(`/api/makler/${id}`));
  const aendern = async (id: string, body: Record<string, unknown>) => {
    const r = await senden('PATCH', `/api/makler/${id}`, { version: (await detail(id)).version, ...body });
    expect(r.status).toBe(200);
  };
  const roh = async (id: string) => (await db.select().from(schema.makler).where(eq(schema.makler.id, id)))[0]!;

  afterAll(async () => {
    await db.delete(schema.makler).where(inArray(schema.makler.id, ids));
    await client.end();
  });

  it('Migration: erstes Wort wird Vorname, der Rest bleibt Name — Anrede, Titel und mehrere Personen bleiben ganz', async () => {
    const namen: [string, string | null, string][] = [
      ['Bernd Schmucker', 'Bernd', 'Schmucker'],
      ['  Philipp   von Olnhausen ', 'Philipp', 'von Olnhausen'],
      ['Joachim R. Seeberger', 'Joachim', 'R. Seeberger'],
      ['L. Schweitzer', 'L.', 'Schweitzer'],
      ['Herr Mucha', null, 'Herr Mucha'],
      ['Dr. Frank Urfer', null, 'Dr. Frank Urfer'],
      ['B. Eng. Bernd Zondler', null, 'B. Eng. Bernd Zondler'],
      ['Wolfgang Raichle & Alexander Raichle', null, 'Wolfgang Raichle & Alexander Raichle'],
      ['Dr. Michael Kosche / Volker Merk', null, 'Dr. Michael Kosche / Volker Merk'],
      ['Müller, Anna', null, 'Müller, Anna'],
      ['vsdfsd', null, 'vsdfsd'],
    ];
    const zeilen = namen.map(([name], i) => ({ id: `${k}m${i}`, name }));
    // In einer Transaktion, die zurückgerollt wird: andere Zeilen der lokalen DB bleiben unberührt
    let ergebnis: { id: string; vorname: string | null; name: string | null }[] = [];
    await db.transaction(async (tx) => {
      await tx.insert(schema.makler).values([...zeilen, { id: `${k}schon`, vorname: 'Anna', name: 'Maria Huber' }]);
      await tx.execute(sql.raw(MIGRATION));
      await tx.execute(sql.raw(MIGRATION)); // ein zweiter Lauf ändert nichts
      ergebnis = await tx.select({ id: schema.makler.id, vorname: schema.makler.vorname, name: schema.makler.name }).from(schema.makler)
        .where(inArray(schema.makler.id, [...zeilen.map((z) => z.id), `${k}schon`]));
      tx.rollback();
    }).catch(() => undefined);
    const nach = new Map(ergebnis.map((z) => [z.id, z]));
    namen.forEach(([, vorname, name], i) => expect(nach.get(`${k}m${i}`)).toMatchObject({ vorname, name }));
    expect(nach.get(`${k}schon`)).toMatchObject({ vorname: 'Anna', name: 'Maria Huber' });
  });

  it('Anzeige „Vorname Name“, bearbeiten getrennt; ein voller Name in einem Feld leert den Vornamen', async () => {
    const m = await lies(senden('POST', '/api/makler', { name: `${k} Anna Alt` }));
    ids.push(m.id);
    expect(await detail(m.id)).toMatchObject({ name: `${k} Anna Alt`, vorname: null, nachname: `${k} Anna Alt` });

    await aendern(m.id, { vorname: 'Anna', nachname: `${k}` });
    expect(await roh(m.id)).toMatchObject({ vorname: 'Anna', name: k });
    expect(await detail(m.id)).toMatchObject({ name: `Anna ${k}`, vorname: 'Anna', nachname: k });
    const liste = await lies(app.request('/api/makler'));
    expect(liste.find((x: any) => x.id === m.id)?.name).toBe(`Anna ${k}`);

    await aendern(m.id, { name: `Berta ${k}` });
    expect(await roh(m.id)).toMatchObject({ vorname: null, name: `Berta ${k}` });
  });
});
