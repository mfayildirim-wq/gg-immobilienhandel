import { like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { agentKern, type ModellWahl, type Nutzer } from '../src/kern.ts';
import { aufgabeGruendlich, drehbuchModell, ki } from '../src/modell.ts';
import { agenten } from '../src/schema.ts';
import { testDb, url } from './db.ts';

describe('aufgabeGruendlich', () => {
  it('Recherche, Analyse, Dokumente → gründlich; Bedienen, Lesen, Bestätigen → schnell', () => {
    for (const t of ['Analysiere die Lage', 'Recherchiere vergleichbare Angebote', 'Fasse die Mietdokumente zusammen', 'Warum ist der Deal überfällig?']) expect(aufgabeGruendlich(t), t).toBe(true);
    for (const t of ['Was ist heute fällig?', 'Öffne den ersten Deal', 'ja', 'Kommentar: Rückruf Montag. Abschicken.']) expect(aufgabeGruendlich(t), t).toBe(false);
  });
});

describe.skipIf(!url)('Tempo und Messung', () => {
  const { db, client } = url ? testDb() : ({} as ReturnType<typeof testDb>);
  const nutzer: Nutzer = { id: `test-tempo-${Date.now()}@example` };
  afterAll(async () => { if (url) await db.delete(agenten).where(like(agenten.slug, 'test-tempo-%')); await client?.end(); });
  const basis = { openapi: { paths: {} }, ziele: [], aufruf: async () => ({ status: 200, text: '{}' }) };

  it('auto: schnelles Modell fürs Bedienen, das eingestellte für Analysen; gründlich: immer das eingestellte', async () => {
    const gewaehlt: string[] = [];
    const wahl: ModellWahl = async ({ modell }) => { gewaehlt.push(modell); return drehbuchModell([ki('Ok.'), ki('Ok.'), ki('Ok.')]); };
    const kern = agentKern({ db, modell: wahl, ...basis, dna: { slug: `test-tempo-${Date.now()}` } });
    await kern.nachricht(nutzer, { text: 'Öffne den ersten Deal', ort: '/', kontext: {} });
    await kern.nachricht(nutzer, { text: 'Analysiere die Lage', ort: '/', kontext: {} });
    expect(gewaehlt).toEqual(['claude-haiku-4-5-20251001', '']);
    // Einstellung sofort wirksam (Vorrat wird beim Speichern geleert)
    await kern.einstellungenSpeichern({ regeln: [], nie: [], anbieter: '', modell: '', tempo: 'gruendlich' });
    await kern.nachricht(nutzer, { text: 'Öffne den zweiten Deal', ort: '/', kontext: {} });
    expect(gewaehlt.at(-1)).toBe('');
    expect((await kern.einstellungen()).tempo).toBe('gruendlich');
  });

  it('liefert eine Messung mit Dauer und Modellschritten', async () => {
    const kern = agentKern({ db, modell: drehbuchModell([ki('', [['chips', { liste: [{ label: 'A', wert: 'a' }] }]]), ki('Fertig.')]), ...basis, dna: { slug: `test-tempo-m-${Date.now()}` } });
    const a = await kern.nachricht(nutzer, { text: 'Hallo', ort: '/', kontext: {} });
    expect(a.messung?.schritte).toBe(2);
    expect(a.messung?.ms).toBeGreaterThanOrEqual(0);
    expect(a.messung?.tokens).toEqual({ eingabe: 0, cacheGelesen: 0, cacheGeschrieben: 0, ausgabe: 0 });
  });
});
