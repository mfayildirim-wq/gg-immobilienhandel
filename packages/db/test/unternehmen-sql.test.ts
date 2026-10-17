import { unternehmenNameNormieren } from '@gg/domain';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb, verlangeLokaleDatenbank } from '../src/index.ts';

const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

/**
 * Die Daten-Migration `20261017145711_unternehmen_daten` normiert Firmennamen in SQL (`fach.unternehmen_name_normiert`);
 * die API findet Firmen später mit `unternehmenNameNormieren` aus @gg/domain. Beide Regeln müssen dasselbe ergeben,
 * sonst legt die API zu migrierten Firmen Dubletten an.
 */
describe.skipIf(!url)('Unternehmen: SQL-Normierung der Migration = @gg/domain', () => {
  const { db, client } = createDb(url!);
  afterAll(() => client.end());

  it.each([
    '  Beispiel   Immobilien GmbH. ',
    'Engel & Völkers (Schäfer CIO GmbH & Co. KG)',
    'Pflugfelder,',
    'IMMOBILIEN  SERVICE Bärbel Bahr e.K.',
    'Baden-Württembergische Bank / Immobilienvermittlung BW GmbH',
    'Müller & Söhne;',
    '',
    '   ',
  ])('„%s“', async (name) => {
    const [z] = await db.execute<{ n: string }>(sql`select fach.unternehmen_name_normiert(${name}) as n`);
    expect(z!.n).toBe(unternehmenNameNormieren(name));
  });
});
