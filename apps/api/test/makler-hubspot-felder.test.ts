import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

describe.skipIf(!url)('Makler: Felder aus HubSpot im Profil (19.10.2026)', () => {
  const { db, client } = createDb(url!);
  const app = createApp({ db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true, texterkennung: null } });
  const k = `Felder${Date.now()}`;
  const ids: string[] = [];

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const senden = (methode: string, pfad: string, body: unknown) => app.request(pfad, { method: methode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const detail = (id: string) => lies(app.request(`/api/makler/${id}`));
  const aendern = async (id: string, body: Record<string, unknown>) => {
    const r = await senden('PATCH', `/api/makler/${id}`, { version: (await detail(id)).version, ...body });
    expect(r.status).toBe(200);
  };

  afterAll(async () => {
    await db.delete(schema.makler).where(inArray(schema.makler.id, ids));
    await db.delete(schema.unternehmen).where(like(schema.unternehmen.name, `%${k}%`));
    await client.end();
  });

  it('Felder speichern und lesen; leer heißt null; Fax gilt für das Unternehmen und alle seine Makler', async () => {
    const a = await lies(senden('POST', '/api/makler', { name: `${k} Anna`, firma: `${k} GmbH` }));
    const b = await lies(senden('POST', '/api/makler', { name: `${k} Bernd`, firma: `${k} GmbH` }));
    ids.push(a.id, b.id);
    const felder = { anrede: 'Frau', position: 'Geschäftsführerin', stellung: 'Unternehmer', zustaendig: 'Gerry Weyrich', hinweis: 'nur Stuttgart',
      mailingStatus: 'Keine Mails mehr schicken', mailsAbgemeldet: true, rechtsgrundlage: 'Berechtigtes Interesse – Lead', quelle: 'HubSpot', fax: '0711 1234' };
    await aendern(a.id, felder);
    expect(await detail(a.id)).toMatchObject(felder);
    expect(await detail(b.id)).toMatchObject({ fax: '0711 1234', anrede: null, mailsAbgemeldet: false });

    await aendern(a.id, { position: '', fax: '' });
    expect(await detail(a.id)).toMatchObject({ position: null, fax: null });
  });

  it('ohne Unternehmen wird kein Fax gespeichert', async () => {
    const c = await lies(senden('POST', '/api/makler', { name: `${k} Clara` }));
    ids.push(c.id);
    await aendern(c.id, { fax: '0711 9', anrede: 'Frau' });
    expect(await detail(c.id)).toMatchObject({ fax: null, anrede: 'Frau' });
    expect((await db.select().from(schema.makler).where(eq(schema.makler.id, c.id)))[0]!.unternehmenId).toBeNull();
  });
});
