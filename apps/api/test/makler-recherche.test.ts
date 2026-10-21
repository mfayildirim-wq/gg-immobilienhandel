import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { kiAttrappe, rechercheTestAbruf, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;

describe.skipIf(!url)('Makler-Recherche (21.10.2026): Webseite, ImmoScout, KI-Websuche → Vorschläge → übernehmen', () => {
  const { db, client } = createDb(url!);
  // Ersatz-Internet und KI-Attrappe: kein Abruf verlässt den Rechner
  const app = createApp({
    db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, ki: kiAttrappe(), recherche: { abruf: rechercheTestAbruf(), pauseMs: 0 },
    expose: { speicher: speicherImSpeicher(), ki: kiAttrappe(), attrappe: true, texterkennung: null },
  });
  const k = `Rech${Date.now()}`;
  const ids: string[] = [];
  const laeufe: string[] = [];
  const FIRMA = 'Musterhaus Immobilien GmbH';
  const SEITE = 'https://beispiel-immobilien.example.test/';

  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const senden = (methode: string, pfad: string, body?: unknown) => app.request(pfad, { method: methode, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const makler = async (felder: Record<string, unknown>) => {
    const neu = await lies(senden('POST', '/api/makler', { name: 'Platzhalter' }));
    ids.push(neu.id);
    const r = await senden('PATCH', `/api/makler/${neu.id}`, { version: neu.version, ...felder });
    expect(r.status).toBe(200);
    return neu.id as string;
  };
  const bisFertig = async (laufId: string) => {
    let lauf: any;
    for (let i = 0; i < 10; i++) {
      lauf = await lies(senden('POST', `/api/makler-recherche/laeufe/${laufId}/weiter`));
      if (lauf.status !== 'laeuft') break;
    }
    return lauf;
  };
  const starten = async (maklerIds: string[], mitKi: boolean) => {
    const r = await senden('POST', '/api/makler-recherche/laeufe', { maklerIds, mitKi });
    expect(r.status).toBe(200);
    const lauf = await lies(r);
    laeufe.push(lauf.id);
    return lauf;
  };

  beforeAll(async () => {
    // Reste abgebrochener Testläufe: es darf immer nur einer laufen
    await db.update(schema.rechercheLaeufe).set({ status: 'abgebrochen' }).where(eq(schema.rechercheLaeufe.status, 'laeuft'));
  });

  afterAll(async () => {
    await db.delete(schema.rechercheLaeufe).where(inArray(schema.rechercheLaeufe.id, laeufe.length ? laeufe : ['-']));
    await db.delete(schema.makler).where(inArray(schema.makler.id, ids));
    await db.delete(schema.unternehmen).where(eq(schema.unternehmen.name, FIRMA));
    await client.end();
  });

  it('Lauf: Webseite aus der E-Mail, ImmoScout aus dem Firmennamen, KI-Websuche; Schritte, Status, Kosten, Glocke', async () => {
    const a = await makler({ vorname: 'Anna', nachname: 'Beispiel', email: `anna.${k}@beispiel-immobilien.example.test` });
    const b = await makler({ vorname: 'Max', nachname: `Muster${k}`, firma: FIRMA });
    const c = await makler({ vorname: 'Anna', nachname: 'Beispiel', tel: `0711 ${k.slice(-6)}` });
    const ohne = await makler({ vorname: 'Otto', nachname: `Ohne${k}` });

    const schaetzung = await lies(senden('POST', '/api/makler-recherche/schaetzung', { maklerIds: [a, b, c, ohne], mitKi: true }));
    expect(schaetzung).toMatchObject({ anzahl: 4, mitWebseite: 1, ohneWebseite: 3, kiSucheMakler: 3, warnung: false });

    const lauf = await starten([a, b, c, ohne], true);
    expect(lauf).toMatchObject({ status: 'laeuft', anzahl: 4, erledigt: 0 });
    // Nur einer zur Zeit
    expect((await senden('POST', '/api/makler-recherche/laeufe', { maklerIds: [a], mitKi: false })).status).toBe(409);

    const fertig = await bisFertig(lauf.id);
    expect(fertig).toMatchObject({ status: 'fertig', erledigt: 4, gefunden: 2, fehler: 0, ungesehen: true });
    // KI-Websuche nur, wo weder Webseite noch ImmoScout etwas ergab (C und „ohne“): je 1 Cent (Attrappe: sonst keine Token)
    expect(fertig.kostenEur).toBeCloseTo(2 * 0.01 * 0.92, 4);

    const ra = await lies(app.request(`/api/makler-recherche/makler/${a}`));
    expect(ra).toMatchObject({ webseite: { url: SEITE, quelle: 'email' }, personUrl: `${SEITE}team`, status: 'gefunden' });
    expect(ra.ergebnisse[0].schritte.map((s: any) => s.text).join(' | ')).toMatch(/Webseite beispiel-immobilien\.example\.test \(aus E-Mail\) gelesen: \/, \/impressum, \/team — 1 Seite\(n\) laut robots\.txt ausgelassen/);
    const felder = ra.ergebnisse[0].vorschlaege.map((v: any) => `${v.ziel}.${v.feld}=${v.neu}`);
    expect(felder).toEqual(expect.arrayContaining([
      `unternehmen.webseite=${SEITE}`, 'makler.position=Geschäftsführerin', 'makler.mobil=0171 5550001', `makler.firma=${FIRMA}`, 'unternehmen.ort=Stuttgart',
    ]));
    // Ohne Unternehmen haben Fax und Zentrale keinen Platz
    expect(felder.some((f: string) => f.startsWith('unternehmen.fax'))).toBe(false);

    const rb = await lies(app.request(`/api/makler-recherche/makler/${b}`));
    expect(rb).toMatchObject({ webseite: null, immoscout: { url: 'https://www.immobilienscout24.de/anbieter/profil/musterhaus-immobilien-gmbh', quelle: 'firmenname' }, status: 'nicht_genannt' });

    const rc = await lies(app.request(`/api/makler-recherche/makler/${c}`));
    expect(rc).toMatchObject({ webseite: { url: SEITE, quelle: 'ki' }, status: 'gefunden' });
    expect(rc.ergebnisse[0].schritte.map((s: any) => s.text)).toContain('KI-Websuche (1 Suche): Webseite beispiel-immobilien.example.test');

    const ro = await lies(app.request(`/api/makler-recherche/makler/${ohne}`));
    expect(ro).toMatchObject({ status: 'nichts_gefunden', webseite: null, immoscout: null });

    const zeilen = await lies(app.request('/api/makler-recherche'));
    expect(zeilen.find((z: any) => z.id === a)).toMatchObject({ webseite: { quelle: 'email' }, status: 'gefunden', personUrl: `${SEITE}team` });
    expect(zeilen.find((z: any) => z.id === a).offeneVorschlaege).toBeGreaterThan(3);

    // Glocke aus
    await senden('POST', `/api/makler-recherche/laeufe/${lauf.id}/gesehen`);
    expect((await lies(app.request('/api/makler-recherche/laeufe/aktuell'))).ungesehen).toBe(false);
  });

  it('übernehmen, verwerfen, alle übernehmen; Verworfenes kommt nicht wieder', async () => {
    const a = ids[0]!;
    const vorher = await lies(app.request(`/api/makler-recherche/makler/${a}`));
    const liste = vorher.ergebnisse[0].vorschlaege as any[];
    const index = (feld: string) => liste.findIndex((v) => v.feld === feld);

    const nachPosition = await lies(senden('POST', '/api/makler-recherche/entscheiden', { ergebnisId: vorher.ergebnisse[0].id, index: index('position'), entscheidung: 'uebernommen' }));
    expect(nachPosition.ergebnisse[0].vorschlaege[index('position')].entscheidung).toBe('uebernommen');
    expect((await lies(app.request(`/api/makler/${a}`))).position).toBe('Geschäftsführerin');
    expect((await senden('POST', '/api/makler-recherche/entscheiden', { ergebnisId: vorher.ergebnisse[0].id, index: index('position'), entscheidung: 'verworfen' })).status).toBe(409);
    await senden('POST', '/api/makler-recherche/entscheiden', { ergebnisId: vorher.ergebnisse[0].id, index: index('mobil'), entscheidung: 'verworfen' });

    expect(await lies(senden('POST', '/api/makler-recherche/uebernehmen', { maklerIds: [a] }))).toMatchObject({ fehler: [] });
    const m = await lies(app.request(`/api/makler/${a}`));
    expect(m).toMatchObject({ firma: FIRMA, webseite: SEITE, ort: 'Stuttgart', mobil: null });

    // Zweiter Lauf: Mobil war verworfen, die übernommenen Werte stimmen schon → nur noch das, was jetzt mit Unternehmen geht
    const lauf = await starten([a], false);
    await bisFertig(lauf.id);
    const nachher = await lies(app.request(`/api/makler-recherche/makler/${a}`));
    const neu = nachher.ergebnisse[0].vorschlaege.map((v: any) => v.feld);
    expect(neu).not.toContain('mobil');
    expect(neu).not.toContain('position');
    expect(neu).toEqual(expect.arrayContaining(['fax', 'telefonZentrale']));
  });

  it('KI fällt aus (z. B. Limit): Ergebnis „Fehler“ mit Grund, die gelesene Webseite bleibt gespeichert', async () => {
    const ohneKi = createApp({
      db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, recherche: { abruf: rechercheTestAbruf(), pauseMs: 0 },
      ki: { nachricht: async () => { throw new Error('Nutzungslimit erreicht'); }, dateiHochladen: async () => '', dateiLoeschen: async () => {} },
    });
    const id = await makler({ vorname: 'Ina', nachname: `Limit${k}`, email: `ina.${k}@beispiel-immobilien.example.test` });
    const lauf = await starten([id], false);
    await ohneKi.request(`/api/makler-recherche/laeufe/${lauf.id}/weiter`, { method: 'POST' });
    const r = await lies(app.request(`/api/makler-recherche/makler/${id}`));
    expect(r).toMatchObject({ status: 'fehler', webseite: { url: SEITE, quelle: 'email' } });
    expect(r.ergebnisse[0]).toMatchObject({ status: 'fehler', fehler: 'Nutzungslimit erreicht' });
    expect(r.ergebnisse[0].schritte.map((s: any) => s.text)).toContain('Auswertung fehlgeschlagen: Nutzungslimit erreicht — gefundene Adressen sind gespeichert');
  });

  it('Adressen von Hand; Abbrechen', async () => {
    const c = ids[2]!;
    expect((await senden('PUT', `/api/makler-recherche/makler/${c}/stand`, { immoscoutUrl: 'https://example.test/profil' })).status).toBe(400);
    const gesetzt = await lies(senden('PUT', `/api/makler-recherche/makler/${c}/stand`, { immoscoutUrl: 'https://www.immobilienscout24.de/anbieter/profil/musterhaus-immobilien-gmbh', webseite: null }));
    expect(gesetzt).toMatchObject({ immoscout: { quelle: 'hand' }, webseite: null });

    const lauf = await starten([c, ids[3]!], false);
    const ab = await lies(senden('POST', `/api/makler-recherche/laeufe/${lauf.id}/abbrechen`));
    expect(ab).toMatchObject({ status: 'abgebrochen', ungesehen: true });
    expect((await lies(senden('POST', `/api/makler-recherche/laeufe/${lauf.id}/weiter`))).erledigt).toBe(2);
  });
});
