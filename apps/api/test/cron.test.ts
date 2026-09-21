import { createDb, schema } from '@gg/db';
import { sicherungSchluessel } from '@gg/domain';
import { speicherImSpeicher } from '@gg/integrations';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { archivSpiegeln, eingangAufraeumen } from '../src/services/archivSpiegel.ts';

const url = process.env.DATABASE_URL;
const offen = { lokalOffen: true, produktion: false, erlaubteEmails: [] };

describe.skipIf(!url)('Cron: Sicherung, Archiv-Spiegel, Eingang (lokale Datenbank, Ablage im Speicher)', () => {
  const { db, client } = createDb(url!);
  const speicher = speicherImSpeicher();
  const app = createApp({ db, auth: offen, speicher, cronGeheimnis: 'test-geheimnis' });
  const maklerId = `cron-test-${Date.now()}`;
  const text = (s: string) => new TextEncoder().encode(s);
  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();
  const post = (pfad: string, body?: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

  afterAll(async () => {
    await db.delete(schema.makler).where(eq(schema.makler.id, maklerId));
    await db.delete(schema.archiveLedger).where(inArray(schema.archiveLedger.bucket, ['pdfs', 'deal-docs', 'obj-photos']));
    await db.delete(schema.auditLog).where(like(schema.auditLog.source, '/api/cron/%'));
    await db.delete(schema.auditLog).where(like(schema.auditLog.source, '/api/sicherung/auto%'));
    await client.end();
  });

  it('Cron-Routen: ohne oder mit falschem Geheimnis 401 — und ohne gesetztes Geheimnis immer', async () => {
    expect((await app.request('/api/cron/sicherung')).status).toBe(401);
    expect((await app.request('/api/cron/sicherung', { headers: { authorization: 'Bearer falsch' } })).status).toBe(401);
    expect((await app.request('/api/cron/archiv', { headers: { authorization: 'Bearer test-geheimnis-x' } })).status).toBe(401);
    const ohne = createApp({ db, auth: offen, speicher });
    expect((await ohne.request('/api/cron/sicherung', { headers: { authorization: 'Bearer ' } })).status).toBe(401);
    expect((await ohne.request('/api/cron/sicherung', { headers: { authorization: 'Bearer undefined' } })).status).toBe(401);
    // … und die Anmeldeprüfung gilt für alles andere weiter
    const zu = createApp({ db, auth: { lokalOffen: false, produktion: true, erlaubteEmails: [] }, speicher, cronGeheimnis: 'test-geheimnis' });
    expect((await zu.request('/api/sicherung/auto', { headers: { authorization: 'Bearer test-geheimnis' } })).status).toBe(401);
  });

  it('geplante Sicherung: legt eine Datei mit Kennzahlen im Namen ab; die Liste kommt ohne Download aus', async () => {
    const r = await lies(app.request('/api/cron/sicherung', { headers: { authorization: 'Bearer test-geheimnis' } }));
    expect(r.ok).toBe(true);
    expect(r.eintrag.key).toMatch(/^sicherung-\d{4}-\d{2}-\d{2}-\d{6}-(daily|weekly|monthly)-\d+d-\d+o-\d+m-\d+z\.json$/);
    const liste = await lies(app.request('/api/sicherung/auto'));
    expect(liste.eintraege[0]).toMatchObject({ key: r.eintrag.key, zahlen: r.eintrag.zahlen });
    expect(liste.aufbewahrung).toEqual({ daily: 7, weekly: 4, monthly: 3, safety: 3 });
    const datei = await app.request(`/api/sicherung/auto/datei?key=${encodeURIComponent(r.eintrag.key)}`);
    expect(datei.headers.get('content-length')).toBeNull();
    expect(JSON.parse(await datei.text())).toMatchObject({ version: 1 });
    expect((await app.request('/api/sicherung/auto/datei?key=../pdfs/fremd.pdf')).status).toBe(400);
  });

  it('Aufbewahrung: nach dem Anlegen bleiben 7 tägliche — Fremdes im Bucket wird nie angefasst', async () => {
    for (let tag = 1; tag <= 9; tag++) {
      await speicher.ablegen('backups', sicherungSchluessel(new Date(Date.UTC(2026, 6, tag, 1)), 'daily', { deals: 1, objekte: 1, makler: 1, zeilen: 3 }), text('{}'), 'application/json');
    }
    await speicher.ablegen('backups', 'notiz-von-hand.txt', text('bleibt'), 'text/plain');
    const r = await lies(post('/api/sicherung/auto'));
    expect(r.aufbewahrung.entfernt.length).toBeGreaterThanOrEqual(2);
    const liste = (await lies(app.request('/api/sicherung/auto'))).eintraege as { stufe: string; ts: string }[];
    expect(liste.filter((e) => e.stufe === 'daily').length).toBeLessThanOrEqual(7);
    expect(liste.some((e) => e.ts.startsWith('2026-07-01'))).toBe(false); // die ältesten sind weg
    expect(speicher.inhalt.has('backups/notiz-von-hand.txt')).toBe(true);
  });

  it('Wiederherstellen: erst Sicherheitskopie, dann einspielen — Gelöschtes ist wieder da', async () => {
    await db.insert(schema.makler).values({ id: maklerId, name: 'Cron Test', prio: 'B', kontaktFrequenz: 'Monatlich' });
    const { eintrag } = await lies(post('/api/sicherung/auto'));
    await db.delete(schema.makler).where(eq(schema.makler.id, maklerId));
    const plan = await lies(post('/api/sicherung/auto/plan', { key: eintrag.key }));
    expect(plan.zeilen.find((z: { tabelle: string }) => z.tabelle === 'makler').neu).toBe(1);
    expect((await post('/api/sicherung/auto/einspielen', { key: eintrag.key })).status).toBe(400); // ohne ausdrückliche Bestätigung nicht
    const r = await lies(post('/api/sicherung/auto/einspielen', { key: eintrag.key, bestaetigt: true }));
    expect(r.sicherheitskopie).toMatch(/-safety-/);
    expect((await db.select().from(schema.makler).where(eq(schema.makler.id, maklerId))).length).toBe(1);
  });

  it('Archiv-Spiegel: neu kopieren, Geändertes beiseitelegen statt überschreiben, Verschwundenes behalten und datieren', async () => {
    await speicher.ablegen('pdfs', 'd1.pdf', text('Fassung 1'), 'application/pdf');
    await speicher.ablegen('deal-docs', 'd1/a_Plan.pdf', text('Plan'), 'application/pdf');
    await speicher.ablegen('deal-docs', '_eingang/00000000-0000-4000-8000-000000000001', text('abgebrochen'), 'application/pdf');

    let b = await archivSpiegeln(db, speicher);
    expect(b).toMatchObject({ ende: 'fertig', kopiert: 2, ersetzt: 0, offen: 0, fehler: [] });
    expect(new TextDecoder().decode(speicher.inhalt.get('archive/pdfs/d1.pdf'))).toBe('Fassung 1');
    expect([...speicher.inhalt.keys()].some((k) => k.startsWith('archive/deal-docs/_eingang'))).toBe(false);
    expect((await archivSpiegeln(db, speicher)).kopiert).toBe(0); // zweiter Lauf: nichts zu tun

    await speicher.ablegen('pdfs', 'd1.pdf', text('Fassung 2 — länger'), 'application/pdf');
    await speicher.loeschen('deal-docs', ['d1/a_Plan.pdf']);
    b = await archivSpiegeln(db, speicher);
    expect(b).toMatchObject({ kopiert: 1, ersetzt: 1 });
    expect(new TextDecoder().decode(speicher.inhalt.get('archive/pdfs/d1.pdf'))).toBe('Fassung 2 — länger');
    const alt = [...speicher.inhalt.keys()].filter((k) => k.startsWith('archive/_superseded/pdfs/d1.pdf.'));
    expect(alt.length).toBe(1);
    expect(new TextDecoder().decode(speicher.inhalt.get(alt[0]!))).toBe('Fassung 1');
    // In der App gelöscht — im Archiv noch da, im Buch mit Zeitpunkt
    expect(speicher.inhalt.has('archive/deal-docs/d1/a_Plan.pdf')).toBe(true);
    const [zeile] = await db.select().from(schema.archiveLedger).where(eq(schema.archiveLedger.key, 'd1/a_Plan.pdf'));
    expect(zeile!.missingSince).toBeGreaterThan(0);
  });

  it('Budget: die erste Datei geht immer, danach ist Schluss — der Rest bleibt Arbeit für den nächsten Lauf', async () => {
    await speicher.ablegen('obj-photos', 'o1/f1.jpg', new Uint8Array(100), 'image/jpeg');
    await speicher.ablegen('obj-photos', 'o1/f2.jpg', new Uint8Array(100), 'image/jpeg');
    const b = await archivSpiegeln(db, speicher, { budget: { maxBytes: 50, maxMillis: 60_000, maxObjekte: 400 } });
    expect(b).toMatchObject({ ende: 'datenbudget', kopiert: 1, offen: 1 });
    expect((await archivSpiegeln(db, speicher)).kopiert).toBe(1);
  });

  it('Eingang aufräumen: nur, was älter als ein Tag ist', async () => {
    const alt = '_eingang/00000000-0000-4000-8000-0000000000a1';
    const neu = '_eingang/00000000-0000-4000-8000-0000000000a2';
    await speicher.ablegen('pdfs', alt, text('alt'), 'application/pdf');
    await speicher.ablegen('pdfs', neu, text('neu'), 'application/pdf');
    const jetzt = Date.parse(speicher.geaendert.get(`pdfs/${neu}`)!) + 23 * 3600_000;
    speicher.geaendert.set(`pdfs/${alt}`, new Date(jetzt - 25 * 3600_000).toISOString());
    const entfernt = await eingangAufraeumen(speicher, jetzt);
    expect(entfernt).toBeGreaterThanOrEqual(1);
    expect(speicher.inhalt.has(`pdfs/${alt}`)).toBe(false);
    expect(speicher.inhalt.has(`pdfs/${neu}`)).toBe(true);
  });
});
