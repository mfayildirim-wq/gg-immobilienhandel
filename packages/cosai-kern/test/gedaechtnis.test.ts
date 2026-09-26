import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gedaechtnis } from '../src/gedaechtnis.ts';
import { testDb, url } from './db.ts';

describe.skipIf(!url)('Gedächtnis', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  const nutzer = 'test-gedaechtnis@example';
  const g = url ? gedaechtnis(db, nutzer) : (null as never);
  beforeAll(async () => { await g.leeren(); });
  afterAll(async () => { await g.leeren(); await client.end(); });

  it('zählt gleiche Formulierungen hoch statt sie zu doppeln', async () => {
    await g.merke('formulierung', 'deal.kommentar', 'Mailbox besprochen, Rückruf Montag', { dealId: 'd1' });
    await g.merke('formulierung', 'deal.kommentar', 'Nicht erreicht');
    const e = await g.merke('formulierung', 'deal.kommentar', '  Mailbox besprochen, Rückruf Montag ');
    expect(e.haeufigkeit).toBe(2);
    const vorschlaege = await g.erinnere('formulierung', 'deal.kommentar');
    expect(vorschlaege.map((v) => v.inhalt)).toEqual(['Mailbox besprochen, Rückruf Montag', 'Nicht erreicht']);
  });

  it('Episoden sind immer neu und bilden den Verlauf', async () => {
    await g.merke('episode', 'deal.kommentar.senden', 'Kommentar gesendet', { sitzungId: 's1', dealId: 'd1' });
    await g.merke('episode', 'deal.kommentar.senden', 'Kommentar gesendet', { sitzungId: 's2' });
    expect(await g.verlauf(10)).toHaveLength(2);
    expect(await g.verlauf(10, 's1')).toHaveLength(1);
  });

  it('löscht nur eigene Einträge', async () => {
    const fremd = gedaechtnis(db, 'jemand-anders@example');
    const e = await fremd.merke('fakt', 'makler.huber', 'nachmittags erreichbar');
    expect(await g.loeschen(e.id!)).toBe(false);
    expect(await fremd.loeschen(e.id!)).toBe(true);
    expect((await g.alles()).every((x) => x.art !== 'fakt')).toBe(true);
  });
});
