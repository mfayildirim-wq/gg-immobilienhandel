import { createDb, schema } from '@gg/db';
import { count } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { umzugAusfuehren } from '../src/umzug.ts';
import { ALTBESTAND } from './altbestand.ts';

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('Umzug gegen die lokale Datenbank (Probelauf, wird zurückgerollt)', () => {
  const { db, client } = createDb(url!);
  afterAll(() => client.end());

  it('besteht alle Prüfungen und lässt die Datenbank unverändert', async () => {
    const vorher = (await db.select({ n: count() }).from(schema.deals))[0]!.n;

    const bericht = await umzugAusfuehren(db, ALTBESTAND, { trocken: true, stichtag: '2026-09-17T12:00:00.000Z' });

    expect(bericht.pruefungen.filter((p) => !p.ok)).toEqual([]);
    expect(bericht.ok).toBe(true);
    expect(bericht.geschrieben).toBe(false);
    expect(bericht.nochNichtUmgezogen).toEqual({});
    expect((await db.select({ n: count() }).from(schema.deals))[0]!.n).toBe(vorher);
  });

  it('rollt zurück und meldet Fehler bei Datensätzen ohne ID', async () => {
    const bericht = await umzugAusfuehren(db, { 'immo-deals': [{ adresse: 'ohne id' }] }, { trocken: false });
    expect(bericht.ok).toBe(false);
    expect(bericht.geschrieben).toBe(false);
    expect(bericht.befundeJeArt['ohne-id']?.anzahl).toBe(1);
  });
});
