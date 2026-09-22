import { existsSync } from 'node:fs';
import { createDb, schema, verlangeLokaleDatenbank } from '@gg/db';
import { type GraphClient, type OfferMail, speicherImSpeicher } from '@gg/integrations';
import { eq, inArray, like } from 'drizzle-orm';
import { chromium } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { kiAttrappeAutoImport, testPdf, type Testseiten, testseitenStarten } from '../../../packages/integrations/test/autoimport/testseiten.ts';
import { createApp } from '../src/app.ts';
import { mailAlsPdf } from '../src/services/autoImport.ts';

// Nie gegen die Cloud: ein Testlauf löscht und überschreibt Zeilen
const url = process.env.DATABASE_URL ? verlangeLokaleDatenbank(process.env.DATABASE_URL, 'Testlauf') : undefined;
const CHROME = [process.env.CHROME_PFAD, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser']
  .find((p): p is string => !!p && existsSync(p));

describe.skipIf(!url || !CHROME)('Auto-Import über die API (lokale Datenbank, Testseiten, echter Browser)', () => {
  const { db, client } = createDb(url!);
  const speicher = speicherImSpeicher();
  const kennung = `ai-test-${Date.now()}`;
  let seiten: Testseiten;
  let mails: OfferMail[] = [];
  const mail = (uid: string, o: Partial<OfferMail>): OfferMail => ({
    uid: `${kennung}-${uid}`, messageId: `${kennung}-${uid}`, datum: '2026-09-21T08:00:00Z', von: 'makler@example.test', vonName: 'Erika Beispiel',
    betreff: `Exposé ${uid}`, vorschau: '', text: 'Guten Tag, anbei unser Angebot.', anhaenge: [], links: [], anhaengeUnvollstaendig: false, ...o,
  });
  const graph: GraphClient = { wer: async () => ({ name: 'Test', email: 't@example.test' }), angebote: async () => mails, anhang: async () => testPdf('Expose Anhang', 4) };
  const app = createApp({
    db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, speicher, graph, ki: kiAttrappeAutoImport() as never,
    expose: { speicher, ki: kiAttrappeAutoImport() as never, attrappe: true },
    autoImport: { lokaleZieleErlaubt: true, browserStarten: () => chromium.launch({ executablePath: CHROME!, headless: true, args: ['--no-sandbox'] }) },
  });
  const post = (pfad: string, body: unknown) => app.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const lies = async (r: Response | Promise<Response>): Promise<any> => (await r).json();

  beforeAll(async () => {
    seiten = await testseitenStarten();
    mails = [
      mail('anhang', { anhaenge: [{ partId: 'p1', filename: 'Expose Musterstrasse.pdf', sizeMB: 1, mime: 'application/pdf', kind: 'pdf', processable: true }] as never }),
      mail('liste', { links: [`${seiten.basis}/liste`] }),
      mail('agb', { links: [`${seiten.basis}/portal/expose`] }),
    ];
  });
  afterAll(async () => {
    await seiten.stop();
    await db.delete(schema.autoImportRuns).where(like(schema.autoImportRuns.mailUid, `${kennung}%`));
    await db.delete(schema.auditLog).where(inArray(schema.auditLog.source, ['/api/auto-import/lauf', 'auto-import/fill-agb']));
    await client.end();
  });

  it('Anhang: Exposé landet im Exposé-Eingang — dort, wo auch ein Upload von Hand landet; die Mail gilt danach als importiert', async () => {
    const r = await lies(post('/api/auto-import/lauf', { mailUid: `${kennung}-anhang` }));
    expect(r).toMatchObject({ status: 'success', ausgang: 'sicher', dateiname: 'Expose Musterstrasse.pdf' });
    expect(r.eingangKey).toMatch(/^_eingang\/[0-9a-f-]{36}$/);
    expect(Buffer.from(speicher.inhalt.get(`pdfs/${r.eingangKey}`)!.subarray(0, 5)).toString()).toBe('%PDF-');
    // … und der vorhandene Assistent nimmt genau diesen Schlüssel an
    expect((await post('/api/expose/eingang/uebernehmen', { key: r.eingangKey })).status).toBe(201);
    const eingang = await lies(app.request('/api/m365/posteingang?alle=true'));
    expect(eingang.mails.find((m: { uid: string }) => m.uid === `${kennung}-anhang`).importiert).toBe(true);
    expect(eingang.mails.find((m: { uid: string }) => m.uid === `${kennung}-liste`).importiert).toBe(false);
  }, 60_000);

  it('Link: der Browser-Weg läuft durch die API; die Schritte stehen im Verlauf', async () => {
    const r = await lies(post('/api/auto-import/lauf', { mailUid: `${kennung}-liste` }));
    expect(r).toMatchObject({ status: 'success', ausgang: 'sicher' });
    expect(r.schritte.map((s: { schritt: string }) => s.schritt)).toEqual(expect.arrayContaining(['triage', 'open', 'doclist-validate']));
    const verlauf = await lies(app.request('/api/auto-import/verlauf'));
    expect(verlauf.find((l: { runId: string }) => l.runId === r.runId)).toMatchObject({ status: 'success', mailUid: `${kennung}-liste` });
  }, 120_000);

  it('Default-Deny: ohne Freigabe sendet der Bot keine AGB-Bestätigung ab — Grund im Ergebnis, Entscheidung im Audit', async () => {
    const vorher = seiten.aufrufe.length;
    const r = await lies(post('/api/auto-import/lauf', { mailUid: `${kennung}-agb` }));
    expect(r.status).toBe('failed');
    expect(seiten.aufrufe.slice(vorher).some((a) => a.startsWith('POST'))).toBe(false);
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityId, r.runId));
    expect(audit.some((a) => a.action === 'outward-blocked')).toBe(true);
  }, 120_000);

  it('höchstens drei Läufe gleichzeitig; ein Abbruchwunsch steht in der Zeile', async () => {
    const jetzt = Math.floor(Date.now() / 1000);
    const belegt = [1, 2, 3].map((i) => ({ id: `${kennung}-belegt-${i}`, mailUid: `${kennung}-belegt-${i}`, startedAt: jetzt, status: 'running' }));
    await db.insert(schema.autoImportRuns).values(belegt);
    expect((await post('/api/auto-import/lauf', { mailUid: `${kennung}-liste` })).status).toBe(429);
    expect(await lies(post('/api/auto-import/abbrechen', { mailUid: `${kennung}-belegt-1` }))).toEqual({ abgebrochen: 1 });
    const [zeile] = await db.select().from(schema.autoImportRuns).where(eq(schema.autoImportRuns.id, `${kennung}-belegt-1`));
    expect(zeile!.status).toBe('aborting');
    // Verwaiste Läufe (Function abgestürzt) geben ihren Platz nach 15 Minuten frei
    await db.update(schema.autoImportRuns).set({ startedAt: jetzt - 1000 }).where(inArray(schema.autoImportRuns.id, belegt.map((b) => b.id)));
    expect((await post('/api/auto-import/lauf', { mailUid: `${kennung}-unbekannt` })).status).toBe(404); // 404 kommt vor dem Platz
    expect((await post('/api/auto-import/lauf', { mailUid: `${kennung}-anhang` })).status).toBe(200);
  }, 120_000);

  it('Mail als Beleg-PDF: auch mit Zeichen, die die Standardschrift nicht kennt, und mit sehr langen Zeilen', async () => {
    const pdf = await mailAlsPdf({ von: 'm@example.test', betreff: 'Angebot 🏠 MFH „Musterstraße" – 1.250.000 €', datum: '2026-09-21T08:00:00Z', text: `Kaufpreis: 1.250.000 €\n${'sehrlangeswortohneleerzeichen'.repeat(20)}\n\n${'Zeile mit Text. '.repeat(400)}` });
    expect(Buffer.from(pdf.subarray(0, 5)).toString()).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(1500);
  });

  it('abgeschaltet (AUTO_IMPORT_AKTIV): kein Lauf, kein Abbruch, kein Browser — Stand meldet es, der Verlauf bleibt lesbar', async () => {
    let browserGestartet = false;
    const aus = createApp({
      db, auth: { lokalOffen: true, produktion: false, erlaubteEmails: [] }, speicher, graph, ki: kiAttrappeAutoImport() as never,
      autoImport: { aktiv: false, lokaleZieleErlaubt: true, browserStarten: async () => { browserGestartet = true; throw new Error('darf nicht starten'); } },
    });
    const postAus = (pfad: string, body: unknown) => aus.request(pfad, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await lies(aus.request('/api/m365'))).autoImport).toBe(false);
    expect((await lies(app.request('/api/m365'))).autoImport).toBe(true);
    const lauf = await postAus('/api/auto-import/lauf', { mailUid: `${kennung}-liste` });
    expect(lauf.status).toBe(503);
    expect((await lauf.json() as { fehler: string }).fehler).toMatch(/abgeschaltet/);
    expect((await postAus('/api/auto-import/abbrechen', { mailUid: `${kennung}-liste` })).status).toBe(503);
    expect((await aus.request('/api/auto-import/verlauf')).status).toBe(200);
    expect(browserGestartet).toBe(false);
  });
});
